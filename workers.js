import { connect } from "cloudflare:sockets";
const WS_READY_STATE_OPEN = 1;
const textDecoder = new TextDecoder();
export default {
  async fetch(request) {
    if (request.headers.get("Upgrade") != "websocket") {
      return new Response("Hello myapp");
    }
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.handleWebSocket(server, request).catch(err => {
      console.error(err);
      if (server.readyState === WS_READY_STATE_OPEN) {
        server.close(1011, "Internal Error");
      }
    });
    return new Response(null, { status: 101, webSocket: client });
  },
  async handleWebSocket(server, request) {
    let remoteSocket;
    const readable = new ReadableStream({
      start(controller) {
        const earlyData = request.headers.get("sec-websocket-protocol");
        if (earlyData) {
          try {
            const decoded = atob(earlyData.replace(/-/g, "+").replace(/_/g, "/"));
            controller.enqueue(Uint8Array.from(decoded, c => c.charCodeAt(0)));
          } catch {}
        }
        server.onmessage = e => controller.enqueue(e.data);
        server.onclose = () => controller.close();
        server.onerror = () => controller.error("WebSocket error");
      },
      cancel: () => remoteSocket?.close(),
    });
    const reader = readable.getReader();
    const { value: firstChunk, done } = await reader.read();
    if (done) return;
    const { addr, port, offset, ver } = parseHeader(firstChunk);
    remoteSocket = connect({ hostname: addr, port });
    const writer = remoteSocket.writable.getWriter();
    await writer.write(firstChunk.subarray(offset));
    writer.releaseLock();
    reader.releaseLock();
    const safeSend = (chunk) => server.readyState === WS_READY_STATE_OPEN && server.send(chunk);
    const safeClose = () => server.readyState === WS_READY_STATE_OPEN && server.close();
    const closeAll = () => { remoteSocket?.close(); safeClose(); };
    await Promise.all([
      readable.pipeTo(remoteSocket.writable, { preventClose: true }),
      remoteSocket.readable.pipeTo(new WritableStream({
        start: () => safeSend(new Uint8Array([ver, 0])),
        write: safeSend,
        close: safeClose,
      }))
    ]).catch(closeAll);
  }
};
function parseHeader(buf) {
  if (buf.byteLength < 24) throw "False";
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ver = buf[0];
  const optLen = buf[17];
  if (buf[18 + optLen] !== 1) throw "False";
  let off = 19 + optLen;
  const port = view.getUint16(off);
  off += 2;
  const type = buf[off++];
  let addr;
  if (type === 1) {
    addr = `${buf[off]}.${buf[off+1]}.${buf[off+2]}.${buf[off+3]}`;
    off += 4;
  } else if (type === 2) {
    const len = buf[off++];
    addr = textDecoder.decode(buf.subarray(off, off + len));
    off += len;
  } else if (type === 3) {
    const b = buf.subarray(off, off + 16);
    addr = Array.from({length:8}, (_,i) => ((b[i*2]<<8)|b[i*2+1]).toString(16)).join(":").replace(/(^|:)0+(\w)/g, "$1$2").replace(/:{3,}/, "::");
    off += 16;
  } else {
    throw `Unknown address type: ${type}`;
  }
  return { addr, port, offset: off, ver };
}
