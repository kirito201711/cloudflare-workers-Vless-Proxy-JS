import { connect } from "cloudflare:sockets";
let userID = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
function parseUUID(uuidString) {
  const hex = uuidString.replaceAll('-', '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
const userIDBytes = parseUUID(userID);
function timingSafeCompare(a, b) {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  const viewA = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const viewB = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (viewA.getBigUint64(0) !== viewB.getBigUint64(0)) {
    return false;
  }
  if (viewA.getBigUint64(8) !== viewB.getBigUint64(8)) {
    return false;
  }
  return true;
}

const WS_READY_STATE_OPEN = 1;
const cn_hostnames = [''];

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
// 使用 LRU 缓存
const nat64DnsCache = new LRUCache(1000);
const udpDnsCache = new LRUCache(500);
const DNS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const UDP_DNS_CACHE_TTL = 60 * 1000; // 1 minute

// 优化字节操作
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

// 预分配常用的响应头
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
        return handleHttpRequest(request);
      }
      return await handleVlessWebSocket(request, env, ctx);
    } catch (err) {
      return new Response(`Internal Error: ${err.message}`, { status: 500, headers: CORS_HEADERS });
    }
  },
};

function handleHttpRequest(request) {
  const url = new URL(request.url);
  if (cn_hostnames.includes('')) {
    return new Response(JSON.stringify(request.cf, null, 4), {
      status: 200,
      headers: { "Content-Type": "application/json;charset=utf-8", ...CORS_HEADERS },
    });
  }
  
  const randomHostname = cn_hostnames[Math.floor(Math.random() * cn_hostnames.length)];
  const newHeaders = new Headers(request.headers);
  newHeaders.set("cf-connecting-ip", "1.2.3.4");
  newHeaders.set("x-forwarded-for", "1.2.3.4");
  newHeaders.set("x-real-ip", "1.2.3.4");
  newHeaders.set("referer", "https://www.google.com/search?q=edtunnel");
  
  const proxyUrl = `https://${randomHostname}${url.pathname}${url.search}`;
  
  return fetch(new Request(proxyUrl, {
    method: request.method,
    headers: newHeaders,
    body: request.body,
    redirect: "manual",
  })).then(response => {
    if ([301, 302].includes(response.status)) {
      return new Response(`Redirects to ${randomHostname} are not allowed.`, { status: 403, statusText: "Forbidden", headers: CORS_HEADERS });
    }
    return response;
  });
}

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

      // 优化点 2: 调用 parseVlessHeader 时传入预计算的 userIDBytes
      const result = parseVlessHeader(chunk, userIDBytes);
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
        const tcpSocket = await connectAndWrite(result.addressRemote, result.portRemote, rawClientData);
        pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retry);
      } catch (err) {
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
        } catch (e) {
        }
      }
    },
    cancel() {
      ws.close();
    }
  });
}

// 优化点 3: 修改 parseVlessHeader 以接受字节数组并进行二进制比较
function parseVlessHeader(buffer, userIDBytes) {
  if (buffer.byteLength < 24) return { hasError: true, message: '无效的头部长度' };
  
  const view = new DataView(buffer);
  const version = new Uint8Array(buffer.slice(0, 1));
  
  // 直接从 buffer 中获取 16 字节的 UUID
  const receivedUUIDBytes = new Uint8Array(buffer.slice(1, 17));

  // 使用高效、安全的二进制比较
  if (!timingSafeCompare(receivedUUIDBytes, userIDBytes)) {
    return { hasError: true, message: '无效的用户' };
  }

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

// 优化点 4: formatUUIDFast 函数已不再需要，可以安全删除。

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
