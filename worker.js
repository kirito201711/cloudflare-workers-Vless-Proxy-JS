import { connect } from "cloudflare:sockets";

const WS_READY_STATE_OPEN = 1;

class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  get(key) {
    const item = this.cache.get(key);
    if (item && item.expires > Date.now()) {
      this.cache.delete(key);
      this.cache.set(key, item);
      return item.data;
    } else if (item) {
      this.cache.delete(key);
    }
    return null;
  }
  set(key, data, ttl) {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expires: Date.now() + ttl });
  }
}

const nat64DnsCache = new LRUCache(1000);
const udpDnsCache = new LRUCache(500);
const DNS_CACHE_TTL = 5 * 60 * 1000;
const UDP_DNS_CACHE_TTL = 60 * 1000;

// --- 新增部分开始 ---

// Cloudflare IP 范围列表
const CLOUDFLARE_IP_RANGES = [
  '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '104.16.0.0/13',
  '104.24.0.0/14', '108.162.192.0/18', '131.0.72.0/22', '141.101.64.0/18',
  '162.158.0.0/15', '172.64.0.0/13', '173.245.48.0/20', '188.114.96.0/20',
  '190.93.240.0/20', '197.234.240.0/22', '198.41.128.0/17', '2400:cb00::/32',
  '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32'
];

// 将IPv4地址转换为32位整数
function ipv4ToNumber(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

// 将IPv6地址转换为128位BigInt
function ipv6ToBigInt(ip) {
  const parts = ip.split('::');
  let left = [], right = [];
  if (parts.length > 1) {
    left = parts[0].split(':').filter(p => p);
    right = parts[1].split(':').filter(p => p);
  } else {
    left = ip.split(':');
  }
  const fill = Array(8 - left.length - right.length).fill('0');
  const fullParts = [...left, ...fill, ...right];
  let bigInt = 0n;
  for (const part of fullParts) {
    bigInt = (bigInt << 16n) + BigInt(`0x${part || '0'}`);
  }
  return bigInt;
}

/**
 * 检查IP地址是否在指定的CIDR范围内
 * @param {string} ip - 要检查的IP地址 (IPv4 or IPv6)
 * @returns {boolean} - 如果IP在列表中，则返回true，否则返回false
 */
function isIpInCidrList(ip) {
  const isIPv6 = ip.includes(':');
  for (const cidr of CLOUDFLARE_IP_RANGES) {
    try {
      const [range, prefixStr] = cidr.split('/');
      const prefix = parseInt(prefixStr, 10);

      if (isIPv6) {
        if (!range.includes(':')) continue; // IPv6 IP跳过IPv4 CIDR
        const ipBigInt = ipv6ToBigInt(ip);
        const rangeBigInt = ipv6ToBigInt(range);
        const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
        if ((ipBigInt & mask) === (rangeBigInt & mask)) return true;
      } else {
        if (range.includes(':')) continue; // IPv4 IP跳过IPv6 CIDR
        const ipNum = ipv4ToNumber(ip);
        const rangeNum = ipv4ToNumber(range);
        const mask = -1 << (32 - prefix);
        if ((ipNum & mask) === (rangeNum & mask)) return true;
      }
    } catch (e) {
      // 忽略解析错误
    }
  }
  return false;
}

// --- 新增部分结束 ---

function concatArrayBuffers(...buffers) {
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    result.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return result.buffer;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    try {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Hello World!", {
          status: 200,
          headers: { "Content-Type": "text/plain;charset=utf-8" },
        });
      }
      return await handleVlessWebSocket(request, env, ctx);
    } catch (err) {
      return new Response(`Internal Error: ${err.message}`, { status: 500, headers: CORS_HEADERS });
    }
  },
};

async function handleVlessWebSocket(request, env, ctx) {
  const wsPair = new WebSocketPair();
  const [clientWS, serverWS] = Object.values(wsPair);
  serverWS.accept();

  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
  ctx.waitUntil(processWebSocketConnection(serverWS, earlyDataHeader));

  return new Response(null, { status: 101, webSocket: clientWS });
}

async function processWebSocketConnection(serverWS, earlyDataHeader) {
  const wsReadable = createWebSocketReadableStream(serverWS, earlyDataHeader);
  let remoteSocket = null;
  let udpStreamWrite = null;
  let isDns = false;

  wsReadable.pipeTo(new WritableStream({
    async write(chunk) {
      if (isDns && udpStreamWrite) {
        return udpStreamWrite(chunk);
      }
      
      if (remoteSocket) {
        const writer = remoteSocket.writable.getWriter();
        try {
          await writer.write(chunk);
        } finally {
          writer.releaseLock();
        }
        return;
      }

      const result = parseVlessHeader(chunk);
      if (result.hasError) throw new Error(result.message);

      const vlessRespHeader = new Uint8Array([result.vlessVersion[0], 0]);
      const rawClientData = chunk.slice(result.rawDataIndex);

      if (result.isUDP) {
        if (result.portRemote !== 53) throw new Error('UDP代理仅支持DNS(端口53)');
        isDns = true;
        const { write } = await handleUDPOutBound(serverWS, vlessRespHeader);
        udpStreamWrite = write;
        return udpStreamWrite(rawClientData);
      }
      
      async function connectAndWrite(address, port, data) {
        const tcpSocket = await connect({ hostname: address, port });
        remoteSocket = tcpSocket;
        const writer = tcpSocket.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
        return tcpSocket;
      }

      // --- 修改部分开始 ---
      // 检查是否为指定列表中的IPv4地址
      const isDesignatedIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(result.addressRemote) && isIpInCidrList(result.addressRemote);

      if (isDesignatedIPv4) {
        // 如果是，则直接使用NAT64连接，不再尝试直接连接
        try {
          const proxyIP = convertToNAT64IPv6(result.addressRemote);
          const tcpSocket = await connectAndWrite(proxyIP, result.portRemote, rawClientData);
          pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, null); // 成功后不再需要重试
        } catch (err) {
          serverWS.close(1011, `NAT64 connection to designated IP failed: ${err.message}`);
        }
        return; // 处理完毕，退出
      }
      // --- 修改部分结束 ---

      // 对于其他所有地址（域名、非指定IP、指定IPv6），使用原始逻辑
      async function retry() {
        try {
          const proxyIP = await getIPv6ProxyAddress(result.addressRemote);
          const tcpSocket = await connectAndWrite(proxyIP, result.portRemote, rawClientData);
          pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, null);
        } catch (err) {
          serverWS.close(1011, `NAT64 IPv6 connection failed: ${err.message}`);
        }
      }

      try {
        // 首次尝试直接连接
        const tcpSocket = await connectAndWrite(result.addressRemote, result.portRemote, rawClientData);
        pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retry);
      } catch (err) {
        // 如果直接连接失败，则尝试通过NAT64重试
        await retry();
      }
    },
    close() {
      if (remoteSocket) closeSocket(remoteSocket);
    },
    abort(err) {
        if (remoteSocket) closeSocket(remoteSocket);
    }
  })).catch(err => {
    if (remoteSocket) closeSocket(remoteSocket);
    if (serverWS.readyState === WS_READY_STATE_OPEN) {
      serverWS.close(1011, 'Internal Error');
    }
  });
}

function createWebSocketReadableStream(ws, earlyDataHeader) {
  return new ReadableStream({
    start(controller) {
      ws.addEventListener('message', e => controller.enqueue(e.data));
      ws.addEventListener('close', () => controller.close());
      ws.addEventListener('error', e => controller.error(e));
      if (earlyDataHeader) {
        try {
          const decoded = atob(earlyDataHeader.replace(/-/g, '+').replace(/_/g, '/'));
          const data = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) data[i] = decoded.charCodeAt(i);
          controller.enqueue(data.buffer);
        } catch (e) {}
      }
    },
    cancel() {
      ws.close();
    }
  });
}

function parseVlessHeader(buffer) {
  if (buffer.byteLength < 24) return { hasError: true, message: '无效的头部长度' };
  
  const view = new DataView(buffer);
  const version = new Uint8Array(buffer.slice(0, 1));

  const optLength = view.getUint8(17);
  const command = view.getUint8(18 + optLength);
  if (command !== 1 && command !== 2) return { hasError: true, message: '不支持的命令' };

  let offset = 19 + optLength;
  const port = view.getUint16(offset);
  offset += 2;
  const addressType = view.getUint8(offset++);
  let address;

  switch (addressType) {
    case 1:
      address = Array.from(new Uint8Array(buffer.slice(offset, offset + 4))).join('.');
      offset += 4;
      break;
    case 2:
      const domainLength = view.getUint8(offset++);
      address = new TextDecoder().decode(buffer.slice(offset, offset + domainLength));
      offset += domainLength;
      break;
    case 3:
      address = Array.from({ length: 8 }, (_, i) => view.getUint16(offset + i * 2).toString(16)).join(':').replace(/(^|:)0+(\w)/g, '$1$2');
      offset += 16;
      break;
    default: return { hasError: true, message: '不支持的地址类型' };
  }
  return { hasError: false, addressRemote: address, portRemote: port, rawDataIndex: offset, vlessVersion: version, isUDP: command === 2 };
}

function pipeRemoteToWebSocket(remoteSocket, ws, vlessHeader, retry) {
  let headerSent = false;
  let hasIncomingData = false;
  
  remoteSocket.readable.pipeTo(new WritableStream({
    write(chunk) {
      hasIncomingData = true;
      if (ws.readyState === WS_READY_STATE_OPEN) {
        ws.send(headerSent ? chunk : (headerSent = true, concatArrayBuffers(vlessHeader, chunk)));
      }
    },
    close() {
      if (!hasIncomingData && retry) {
          retry();
          return;
      }
      if (ws.readyState === WS_READY_STATE_OPEN) ws.close(1000, '正常关闭');
    },
    abort(err) {
      closeSocket(remoteSocket);
    }
  })).catch(err => {
    closeSocket(remoteSocket);
    if (ws.readyState === WS_READY_STATE_OPEN) ws.close(1011, '传输错误');
  });
}

function closeSocket(socket) {
  if (socket) {
    try {
      socket.close();
    } catch (e) {}
  }
}

function convertToNAT64IPv6(ipv4Address) {
  const parts = ipv4Address.split('.');
  if (parts.length !== 4) throw new Error('无效的IPv4地址');
  const nums = parts.map(part => {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) throw new Error('无效的IPv4地址段');
    return num;
  });
  const hex = nums.map(num => num.toString(16).padStart(2, '0'));
  return `[2001:67c:2960:6464::${hex[0]}${hex[1]}:${hex[2]}${hex[3]}]`;
}

async function getIPv6ProxyAddress(domain) {
  const cached = nat64DnsCache.get(domain);
  if (cached) return cached;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const dnsQuery = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=A`, {
      headers: { 'Accept': 'application/dns-json' },
      signal: controller.signal,
    });
    if (!dnsQuery.ok) throw new Error(`DNS查询失败: ${dnsQuery.status}`);
    const dnsResult = await dnsQuery.json();
    const aRecord = dnsResult.Answer?.find(record => record.type === 1);
    if (!aRecord) throw new Error('未找到A记录');
    
    const ipv6Address = convertToNAT64IPv6(aRecord.data);
    nat64DnsCache.set(domain, ipv6Address, DNS_CACHE_TTL);
    return ipv6Address;
  } catch (err) {
    throw new Error(`DNS解析失败: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleUDPOutBound(webSocket, vlessResponseHeader) {
  let isVlessHeaderSent = false;
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      let index = 0;
      while (index < chunk.byteLength) {
        if (index + 2 > chunk.byteLength) break;
        const len = new DataView(chunk, index, 2).getUint16(0);
        if (index + 2 + len > chunk.byteLength) break;
        controller.enqueue(new Uint8Array(chunk, index + 2, len));
        index += 2 + len;
      }
    }
  });

  transformStream.readable.pipeTo(new WritableStream({
    async write(chunk) {
      const cacheKey = btoa(String.fromCharCode.apply(null, new Uint8Array(chunk)));
      let dnsQueryResult = udpDnsCache.get(cacheKey);
      if (!dnsQueryResult) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        try {
          const resp = await fetch('https://1.1.1.1/dns-query', {
            method: 'POST',
            headers: { 'content-type': 'application/dns-message' },
            body: chunk,
            signal: controller.signal
          });
          dnsQueryResult = await resp.arrayBuffer();
          udpDnsCache.set(cacheKey, dnsQueryResult, UDP_DNS_CACHE_TTL);
        } catch (err) {
          return;
        } finally {
            clearTimeout(timeoutId);
        }
      }
      const udpSize = new Uint8Array([dnsQueryResult.byteLength >> 8, dnsQueryResult.byteLength & 0xff]);
      if (webSocket.readyState === WS_READY_STATE_OPEN) {
        const dataToSend = isVlessHeaderSent ? concatArrayBuffers(udpSize, dnsQueryResult) : concatArrayBuffers(vlessResponseHeader, udpSize, dnsQueryResult);
        webSocket.send(dataToSend);
        isVlessHeaderSent = true;
      }
    }
  })).catch(err => {});

  const writer = transformStream.writable.getWriter();
  return { write: chunk => writer.write(chunk) };
}
