
#### Mihomo客户端配置：使用 443 端口 (HTTPS/TLS)

```yaml
- name: "CFWorkers-443"
  type: vless
  server: 141.101.122.83                   # 优选IP
  port: 443
  uuid: "1"                                # 如果使用的uuid版，请改为你设置的
  udp: true
  tls: true
  network: ws
  skip-cert-verify: true 
  ws-opts:
    path: "/?ed=2560"
    headers:
      Host: "your-worker-domain.com"       # 需替换为绑定Worker的自定义域名
```
