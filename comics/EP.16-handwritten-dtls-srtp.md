# EP.16 UDP 之上的握手与加密

> 对应正文：[模块十六 · 手写 DTLS + SRTP](../guide/16-handwritten-dtls-srtp/basics.md)
> 动手演示：[模拟 DTLS 握手与 SRTP 加解密](../guide/16-handwritten-dtls-srtp/practice.md)

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君抓包看自研 Demo 的媒体流量：RTP 头（`80 60 …`）清晰可辨，payload 却是一堆随机字节——"我发的明明是 hello，被劫持了？"其实是 WebRTC 强制加密，没有密钥就只能看到密文。 |
| ② 揭秘 | 码叔拆解：DTLS 就是"UDP 上的 TLS"。ClientHello → HelloVerifyRequest+cookie → 带 cookie 重发 → ServerHello/Certificate → ECDHE 密钥交换，最后用 `EXTRACTOR-dtls_srtp` 标签导出 SRTP 密钥。证书不用 CA，靠 SDP `a=fingerprint` 带外比对指纹。 |
| ③ 实证 | 像素酱跑 Node.js 模拟：ECDHE 握手 → 校验证书指纹 == SDP `a=fingerprint` → `srtp.protect()` / `unprotect()`。打印显示：线上包里 RTP 头保持明文，payload 变随机字节，末尾多出 10 字节 auth tag。 |
| ④ 结案 | 码叔总结：DTLS 管握手、SRTP 管加密、指纹校验是信任锚。坑点三条：指纹不匹配=中间人、verify-then-decrypt 顺序不能反、auth tag 别乱截 32-bit。 |

## 知识点拆解

### ① DTLS 握手为什么需要 cookie（HelloVerifyRequest）

TLS 跑在 TCP 上，三次握手已经验证了源地址真实性；DTLS 跑在 UDP 上，UDP 无连接、源地址可伪造——攻击者可以伪造受害者 IP 发一个 ClientHello，服务器就会回一个**更大的** Certificate 消息砸向受害者（DoS 放大攻击）。

DTLS（RFC 6347）的解法是**无状态 cookie 机制**：

```
Client                    Server
  |── ClientHello ────────>|            （无 cookie）
  |<── HelloVerifyRequest ─|            （服务端回一个 cookie，自己不存状态）
  |── ClientHello+cookie ─>|            （客户端原样带回，证明"我能收到发到我 IP 的包"）
  |<── ServerHello … ──────|            （验证通过，才开始真正的握手）
```

cookie 通常是对客户端 IP 的 HMAC，服务端**不保存任何状态**，验证通过才分配握手资源。这和 SYN cookie 是同一个思想。

### ② 密钥导出：EXTRACTOR-dtls_srtp

DTLS 握手产出的是 TLS session 密钥，SRTP 用的密钥**不直接用**它，而是通过 TLS Exporter（RFC 5705 / 5764）导出：

```
key_material = TLS_exporter(
    label = "EXTRACTOR-dtls_srtp",
    context = "",
    length = 2 × (master_key_len + master_salt_len)
)
// 按序切成四段：client_write_key | server_write_key
//               | client_write_salt | server_write_salt
```

双向各拿各的 key+salt，发送用自己的 `client_write_key`，接收用对端的。这样做的好处：SRTP 密钥与 TLS 会话密钥**密码学隔离**，就算 SRTP 密钥泄露也反推不出 TLS 密钥。

### ③ SRTP AES-CM 的 IV 构造

SRTP 默认用 AES-CM（Counter Mode）：加密 = 用 AES 生成 keystream 再和 payload 异或。 keystream 的输入 IV 不是随机的，而是从**包内可推导的公开字段**构造：

```
IV = (salt << 16) ⊕ (SSRC << 64) ⊕ (packet_index << 16)
packet_index = (ROC << 16) | sequence_number
```

- 每个包的 seq 不同 → IV 不同 → keystream 不同，天然满足 CTR 模式"nonce 不重用"的硬性要求；
- 收端按同样公式重建 IV，所以 **IV 不需要随包传输**，零开销；
- RTP 头不加密（QoS 设备、SFU 要读 SSRC/seq/pt），但会被 auth tag 覆盖保护——改头也会验签失败。

### ④ 重放保护与 ROC

`sequence_number` 只有 16 位，65535 之后就回绕。SRTP 用 **ROC（Roll-Over Counter，回绕计数器）** 把包索引扩展成 48 位：`index = ROC × 65536 + seq`。ROC 不出现在包里，由收发双方各自维护——seq 从 65535 跳回小数值时 ROC++。

重放保护靠一个**滑动窗口**（默认 64 包）：记录已验证通过的最大 index，凡是落在窗口左侧（太旧）或已标记收过的包，直接丢弃。注意顺序：**先验 auth tag，再查重放窗口**——没验签的包不得更新窗口状态，否则攻击者可以用伪造包把窗口"推走"，造成合法包被误杀。

## 坑点清单（FAQ）

- **Q：为什么 WebRTC 不用 CA 证书体系？指纹不匹配意味着什么？** WebRTC 两端是浏览器，没有固定域名可绑证书，所以用**自签名证书 + SDP `a=fingerprint` 带外比对**。信令通道（你的 HTTPS/WSS）必须是可信的，JS 把 SDP 里的指纹和 DTLS 握手收到的证书指纹逐字节比对。**不匹配 = 有人在中间人转发**（比如抓包代理、配置错误的 SFU），必须直接挂断。
- **Q：收到 SRTP 包，先解密还是先验签？** **永远 verify-then-decrypt**。先算 HMAC-SHA1 比对 auth tag，通过后才解密。反过来的话，攻击者可以构造任意密文观察你的解密反应（padding oracle / 时序侧信道），逐字节推出明文。验签失败的包直接丢，不产生任何解密行为。
- **Q：auth tag 可以截断吗？截多短算危险？** SRTP 允许 80-bit（默认）或 32-bit 标签。32-bit 意味着伪造一个合法包的期望尝试次数只有 2³²≈40 亿次——对在线暴力来说并非遥不可及；而 80-bit 是 2⁸⁰。语音小流苏场景曾为省带宽用 32-bit，**自己实现时一律用 80-bit**，别为每包 6 字节冒被注入假包的风险。

## 自测 3 题（含答案）

1. DTLS 握手中 HelloVerifyRequest + cookie 解决的是什么攻击？为什么 TLS 不需要这一步？
2. SRTP 的加密密钥从哪来？写出 AES-CM 模式下 IV 的构造公式，并说明为什么 IV 不用随包发送。
3. 一个 SRTP 会话里 seq 回绕了两次，收端收到 seq=100 的包，怎么判断它属于哪一轮？如果这时收到一个"重复"的包，正确处理顺序是什么？

<details>
<summary>答案</summary>

1. 解决**基于源地址伪造的 DoS 放大攻击**：UDP 无连接，攻击者可伪造受害者 IP 发 ClientHello，诱导服务器把更大的 Certificate 消息发到受害者。cookie 要求客户端证明自己能收到发往其 IP 的包（带回服务端签发的 HMAC cookie），且服务端验证前不分配任何状态。TLS 跑在 TCP 上，三次握手已完成源地址验证（伪造 IP 收不到 SYN-ACK，握手无法完成），所以不需要。

2. 密钥来自 **DTLS 握手后的 TLS Exporter**：`TLS_exporter("EXTRACTOR-dtls_srtp", "", len)`，导出后切成 client/server 双向的 master key + master salt。IV 构造公式：

   ```
   IV = (salt << 16) ⊕ (SSRC << 64) ⊕ (index << 16)，index = (ROC << 16) | seq
   ```

   因为 SSRC、ROC、seq 都是收发双方**各自可推导**的（SSRC 在头里明文，seq 在头里明文，ROC 本地维护），收端用同一公式重建 IV，所以无需随包传输，省带宽。同时每包 seq 唯一 → IV 唯一 → keystream 不重用，满足 CTR 模式安全前提。

3. 收端维护 ROC（回绕计数器）：看到 seq 从接近 65535 跳回小数值就 ROC++，包的真实索引 = `ROC × 65536 + seq`。回绕两次后 ROC=2，seq=100 的包 index = 2×65536+100 = 131172。
   
   收到"重复"包（index 落在已收记录里）的正确处理顺序：
   1. **先验 auth tag**（HMAC-SHA1），不通过直接丢，**不得更新任何状态**；
   2. 验签通过后**查重放窗口**：该 index 是否已标记收过 / 是否落在窗口左侧；
   3. 是重放 → 丢弃并计重放统计；不是 → 更新窗口位图，再交给 unprotect 解密。
   
   顺序反了（先更新窗口再验签）会让攻击者用伪造包污染窗口，把合法包误判成重放——这也是"verify-then-decrypt"铁律在重放保护上的延伸。
</details>
