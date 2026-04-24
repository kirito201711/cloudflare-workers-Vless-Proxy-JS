import { connect } from "cloudflare:sockets";
export default {
  fetch(req) {
    let h = req.headers, p = h.get("sec-websocket-protocol"), { 0: c, 1: s } = new WebSocketPair();
    if (h.get("Upgrade") != "websocket") return new Response();
    s.accept();
    let v = (b) => {
      let i = 19 + b[17], port = b[i++] << 8 | b[i++], t = b[i++],
        a = t == 1 ? b.subarray(i, i += 4).join(".") : new TextDecoder().decode(b.subarray(i + 1, i += 1 + b[i])),
        r = connect(a + ":" + port), w = r.writable.getWriter();
      if (b.length > i) w.write(b.subarray(i));
      s.send(new Uint8Array(2));
      r.readable.pipeTo(new WritableStream({ write: d => s.send(d) }));
      s.onmessage = e => w.write(e.data);
    };
    if (p) v(Uint8Array.from(atob(p.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
    else s.onmessage = e => v(new Uint8Array(e.data));
    return new Response(null, { status: 101, webSocket: c, headers: p ? { "sec-websocket-protocol": p } : {} });
  }
};
