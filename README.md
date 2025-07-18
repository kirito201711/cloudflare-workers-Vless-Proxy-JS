- name: 🇺🇸美国-CFWorkers                             
  type: vless
  server: 141.101.122.83                  # 1.填一个优选ip
  port: 80                                 
  uuid: 1                                 # 2.随便填
  udp: true
  tls: false
  network: ws
  skip-cert-verify: true
  ws-opts:
    path: "/?ed=2560"                         
    headers:
      Host: xxxxxxxxx.com                # 3.填你绑定到这个worker的自定义域名
