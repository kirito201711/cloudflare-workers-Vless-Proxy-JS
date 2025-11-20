import { connect } from "cloudflare:sockets";
export default {
  async fetch(req) {
    const u = req.headers.get("Upgrade");
    if (u !== "websocket") return new Response(null, { status: 200 });
    const { 0: c, 1: s } = new WebSocketPair();
    s.accept();
    const e = req.headers.get("sec-websocket-protocol");
    if (e) {
      const str = atob(e.replace(/-/g, "+").replace(/_/g, "/"));
      const buf = Uint8Array.from(str, c => c.charCodeAt(0));
      h(s, buf);
    } else {
      s.addEventListener('message', (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          h(s, new Uint8Array(ev.data));
        } else {
          s.close();
        }
      }, { once: true });
    }
    return new Response(null, { status: 101, webSocket: c });
  }
};
async function h(s, b) {
  const optLen = b[17];
  let off = 19 + optLen;
  const p = (b[off] << 8) | b[off + 1];
  off += 2;
  const t = b[off++];
  let a;
  if (t === 1) {
    a = `${b[off]}.${b[off+1]}.${b[off+2]}.${b[off+3]}`;
    off += 4;
  } else if (t === 2) {
    const n = b[off++];
    a = new TextDecoder().decode(b.subarray(off, off + n));
    off += n;
  } else {
    const hx = [];
    for (let i = 0; i < 8; i++) {
      hx.push(((b[off + i*2] << 8) | b[off + i*2 + 1]).toString(16));
    }
    a = hx.join(":");
    off += 16;
  }
  const r = connect({ hostname: a, port: p });
  const w = r.writable.getWriter();
  if (b.length > off) {
    w.write(b.subarray(off));
  }
  s.send(new Uint8Array([b[0], 0]));
  r.readable.pipeTo(new WritableStream({
    write(v) { s.send(v); },
    close() { s.close(); }
  })).catch(() => s.close());
  s.addEventListener('message', async (e) => {
    if (e.data instanceof ArrayBuffer) {
      await w.write(new Uint8Array(e.data));
    }
  });
}
