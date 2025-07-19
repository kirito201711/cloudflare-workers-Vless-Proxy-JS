## 速度优化配置指南

### 第一步：优选 Cloudflare IP

在进行任何配置之前，您需要先找到一个适合您当前网络环境的、延迟低、速度快的Cloudflare IP地址。

1.  使用相关工具（如 CloudflareSpeedTest）找到最适合您的 **优选IP**。
2.  记录下这个IP地址（例如 `1.1.1.1`）及其 **地理位置**（例如 德国 法兰克福）。这是后续选择NAT64服务的依据。

### 第二步：修改 Worker 脚本以使用 NAT64

#### 2.1 选择最优的 NAT64 前缀

根据第一步找到的优选IP的地理位置，在下方的“公共NAT64服务列表”中，选择一个地理位置与您的优选IP最接近的服务，并复制其 `NAT64 Prefix`。

**例如**：如果您的优选IP位于德国，您可以优先选择 `level66.services` 或 `Kasper Dupont` 在德国的NAT64服务。

<br>

**公共NAT64服务列表**
| Provider | Country / City | DNS64 Server | NAT64 Prefix | DoH | DoT | Remarks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Kasper Dupont | Germany / Nürnberg | `2a00:1098:2b::1`<br>`2a00:1098:2c::1`<br>`2a01:4f8:c2c:123f::1` | `2a00:1098:2b::`<br>`2a00:1098:2c:1::`<br>`2a01:4f8:c2c:123f:64::`<br>`2a01:4f9:c010:3f02:64::` | | `dot.nat64.dk` | |
| Kasper Dupont | United Kingdom / London | `2a00:1098:2b::1`<br>`2a00:1098:2c::1`<br>`2a01:4f8:c2c:123f::1` | `2a00:1098:2b::`<br>`2a00:1098:2c:1::`<br>`2a01:4f8:c2c:123f:64::`<br>`2a01:4f9:c010:3f02:64::` | | `dot.nat64.dk` | |
| Kasper Dupont | Finland / Helsinki | `2a00:1098:2b::1`<br>`2a00:1098:2c::1`<br>`2a01:4f8:c2c:123f::1` | `2a00:1098:2b::`<br>`2a00:1098:2c:1::`<br>`2a01:4f8:c2c:123f:64::`<br>`2a01:4f9:c010:3f02:64::` | | `dot.nat64.dk` | |
| **level66.services** | **Germany / Anycast** | `2001:67c:2960::64`<br>`2001:67c:2960::6464` | **`2001:67c:2960:6464::`** | | | |
| Trex | Finland / Tampere | `2001:67c:2b0::4`<br>`2001:67c:2b0::6` | `2001:67c:2b0:db32:0:1::` | | | |
| ZTVI | U.S.A. / Fremont | `dns64.fm2.ztvi.org`<br>`2602:fc59:b0:9e::64` | `2602:fc59:b0:64::` | | | |
| ZTVI | U.S.A. / Chicago | `dns64.cmi.ztvi.org`<br>`2602:fc59:11:1::64` | `2602:fc59:11:64::` | | | |

#### 2.2 修改代码

找到您 Worker 脚本中的第346行（或类似的代码行），将其中的NAT64前缀替换为您在上一步中选定的前缀。

**修改前 (原始代码):**
```javascript
// 使用 level66.services 在德国的 NAT64 服务
return `[2001:67c:2960:6464::${hex[0]}${hex[1]}:${hex[2]}${hex[3]}]`;
```

**修改后 (示例):**
假设您选择了 `Kasper Dupont` 在英国的服务，其前缀之一是 `2a00:1098:2b::`。

```javascript
// 将前缀替换为 Kasper Dupont (UK) 的服务
return `[2a00:1098:2b::${hex[0]}${hex[1]}:${hex[2]}${hex[3]}]`;
```

### 第三步：配置 Mihomo 客户端

根据您的需求和域名情况，选择使用80端口或443端口，并相应地修改配置文件。

> **重要提示**：如果你的域名质量不佳或受到干扰，直接使用80端口可能会失败。**建议优先尝试443端口并开启TLS**，因为它的兼容性和抗干扰性更好。

#### 方案A：使用 80 端口 (HTTP)

```yaml
- name: "CFWorkers-NAT64-80"
  type: vless
  # 需替换为第一步中找到的优选IP
  server: 141.101.122.83
  port: 80
  uuid: "1" # 可任意填写
  udp: true
  tls: false
  network: ws
  skip-cert-verify: true
  ws-opts:
    path: "/?ed=2560"
    headers:
      # 需替换为绑定Worker的自定义域名
      Host: "your-worker-domain.com"
```

#### 方案B：使用 443 端口 (HTTPS/TLS)

```yaml
- name: "CFWorkers-NAT64-443"
  type: vless
  # 需替换为第一步中找到的优选IP
  server: 141.101.122.83
  port: 443
  uuid: "1" # 可任意填写
  udp: true
  tls: true
  network: ws
  # 如果你的域名证书有效，可以设为 false
  skip-cert-verify: true
  # servername 需与 Host 保持一致
  servername: "your-worker-domain.com"
  ws-opts:
    path: "/?ed=2560"
    headers:
      # 需替换为绑定Worker的自定义域名
      Host: "your-worker-domain.com"
```
