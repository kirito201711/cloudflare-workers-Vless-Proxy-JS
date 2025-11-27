import { connect } from "cloudflare:sockets";
export default {
  fetch(req) {
    if (req.headers.get("Upgrade") != "websocket") return new Response();
    const { 0: c, 1: s } = new WebSocketPair();
    s.accept();
    const p = (b) => {
      let i = 19 + b[17];
      const port = (b[i] << 8) | b[i + 1];
      const t = b[i + 2]; i += 3;
      const a = t == 1 ? b.subarray(i, i += 4).join(".") : new TextDecoder().decode(b.subarray(i + 1, i += 1 + b[i]));
      const r = connect({ hostname: a, port });
      const w = r.writable.getWriter();
      if (b.length > i) w.write(b.subarray(i));
      s.send(new Uint8Array([0, 0]));
      r.readable.pipeTo(new WritableStream({ write: v => s.send(v) }));
      s.addEventListener('message', e => w.write(new Uint8Array(e.data)));
    };
    const h = req.headers.get("sec-websocket-protocol");
    if (h) p(Uint8Array.from(atob(h.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
    else s.addEventListener('message', e => p(new Uint8Array(e.data)), { once: true });
    return new Response(null, { status: 101, webSocket: c });
  }
};
