import { connect } from "cloudflare:sockets";
export default {
  fetch(q) {
    const h = q.headers, p = h.get("sec-websocket-protocol"), [c, s] = Object.values(new WebSocketPair());
    if (h.get("Upgrade") != "websocket") return new Response();
    s.accept();
    s.binaryType = "arraybuffer";
    const v = (b) => {
      let i = 19 + b[17], port = b[i++] << 8 | b[i++], t = b[i++],
        a = t == 1 ? b.subarray(i, i += 4).join(".") : new TextDecoder().decode(b.subarray(i + 1, i += 1 + b[i])),
        r = connect(a + ":" + port), w = r.writable.getWriter();
      s.send(new Uint8Array([b[0], 0]));
      if (b.length > i) w.write(b.subarray(i));
      s.onmessage = e => w.write(new Uint8Array(e.data));
      r.readable.pipeTo(new WritableStream({ write: d => s.send(d) })).catch(() => {});
    };
    p ? v(Uint8Array.from(atob(p.replace(/-/g, "+").replace(/_/g, "/")), x => x.charCodeAt(0))) : s.onmessage = e => v(new Uint8Array(e.data));
    return new Response(null, { status: 101, webSocket: c, headers: p ? { "sec-websocket-protocol": p } : {} });
  }
};
