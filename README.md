### mihomo配置

```yaml
name: "🇺🇸美国-CFWorkers"
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
