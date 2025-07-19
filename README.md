访问使用cloudflare CDN的网站通过 
return `[2001:67c:2960:6464::${hex[0]}${hex[1]}:${hex[2]}${hex[3]}]`;

以下为公共NAT64服务列表：

| Provider             | Country / City        | DNS64 Server                                                                 | NAT64 Prefix                                                                                                 | DoH | DoT             | Remarks |
|----------------------|-----------------------|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|-----|-----------------|---------|
| Kasper Dupont        | Germany / Nürnberg    | 2a00:1098:2b::1<br>2a00:1098:2c::1<br>2a01:4f8:c2c:123f::1                  | 2a00:1098:2b::/96<br>2a00:1098:2c:1::/96<br>2a01:4f8:c2c:123f:64::/96<br>2a01:4f9:c010:3f02:64::/96         |     | dot.nat64.dk    |         |
| Kasper Dupont        | United Kingdom / London | 2a00:1098:2b::1<br>2a00:1098:2c::1<br>2a01:4f8:c2c:123f::1                  | 2a00:1098:2b::/96<br>2a00:1098:2c:1::/96<br>2a01:4f8:c2c:123f:64::/96<br>2a01:4f9:c010:3f02:64::/96         |     | dot.nat64.dk    |         |
| Kasper Dupont        | United Kingdom / London | 2a00:1098:2b::1<br>2a00:1098:2c::1<br>2a01:4f8:c2c:123f::1                  | 2a00:1098:2b::/96<br>2a00:1098:2c:1::/96<br>2a01:4f8:c2c:123f:64::/96<br>2a01:4f9:c010:3f02:64::/96         |     | dot.nat64.dk    |         |
| Kasper Dupont        | Finland / Helsinki    | 2a00:1098:2b::1<br>2a00:1098:2c::1<br>2a01:4f8:c2c:123f::1                  | 2a00:1098:2b::/96<br>2a00:1098:2c:1::/96<br>2a01:4f8:c2c:123f:64::/96<br>2a01:4f9:c010:3f02:64::/96         |     | dot.nat64.dk    |         |
| level66.services     | Germany / Anycast     | 2001:67c:2960::64<br>2001:67c:2960::6464                                    | 2001:67c:2960:6464::/96                                                                                     |     |                 |         |
| Trex                 | Finland / Tampere     | 2001:67c:2b0::4<br>2001:67c:2b0::6                                          | 2001:67c:2b0:db32:0:1::/96                                                                                  |     |                 |         |
| ZTVI                 | U.S.A. / Fremont      | dns64.fm2.ztvi.org<br>2602:fc59:b0:9e::64                                   | 2602:fc59:b0:64::/96                                                                                        |     |                 |         |
| ZTVI                 | U.S.A. / Chicago      | dns64.cmi.ztvi.org<br>2602:fc59:11:1::64                                    | 2602:fc59:11:64::/96                                                                                        |     |                 |         |


### mihomo配置

```yaml
name: "CFWorkers"
type: vless
server: 141.101.122.83       # 需替换为实际优选IP
port: 80
uuid: "1"                    # 可任意填写
udp: true
tls: false
network: ws
skip-cert-verify: true
ws-opts:
  path: "/?ed=2560"
  headers:
    Host: "xxxxxxxxx.com"    # 需替换为绑定Worker的自定义域名
