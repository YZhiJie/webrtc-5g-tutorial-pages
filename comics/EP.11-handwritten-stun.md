# EP.11 20 字节头部里的魔法饼干

> 对应正文：[模块十一 · 手写 STUN 协议](../guide/11-handwritten-stun/basics.md)
> 动手演示：[手写 STUN Server 与 Client](../guide/11-handwritten-stun/practice.md)

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君照着 RFC 5389 写 STUN 解析，Wireshark 抓出来的 20 字节头部每个字节都认识、连起来却读不懂——Magic Cookie 到底"魔"在哪？ |
| ② 揭秘 | 码叔把 20 字节拆成四个字段：Type（2B）+ Length（2B）+ Magic Cookie（4B，固定 0x2112A442）+ Transaction ID（12B），并点明前 2 位置 0 是为了和 RTP 区分。 |
| ③ 实证 | 像素酱在 Node.js 里跑 `stun-client.js`，用 `readUInt32BE(4)` 读出 Magic Cookie 恰好等于 `0x2112A442`，Transaction ID 被服务器原样回传，请求/响应配对成功。 |
| ④ 结案 | 码叔总结：吃透 20 字节头部，TLV 属性只是循环解析。坑点三条：前 2 位必须置 0、Length 按 4 字节对齐、Transaction ID 必须原样回传。 |

## 知识点拆解

### ① 20 字节固定头部的四个字段

STUN（RFC 5389）每个报文都以 20 字节固定头部开头：

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|0 0|     STUN Message Type     |         Message Length        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Magic Cookie                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Transaction ID (12 bytes)                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

| 字段 | 偏移 | 长度 | 说明 |
| --- | --- | --- | --- |
| Message Type | 0 | 2B | 前 2 位固定 0；后 14 位 = Class（2 位）+ Method（12 位） |
| Message Length | 2 | 2B | 报文体长度（**不含头部**），必须是 4 的倍数 |
| Magic Cookie | 4 | 4B | 固定 `0x2112A442`，STUN 报文的"身份证" |
| Transaction ID | 8 | 12B | 客户端随机生成，服务器**原样回传**，用于配对请求/响应 |

用 Node.js 解析就是四行：

```js
const type  = buf.readUInt16BE(0);   // 0x0001 = Binding Request
const len   = buf.readUInt16BE(2);   // 报文体长度
const magic = buf.readUInt32BE(4);   // 必须 === 0x2112A442
const tid   = buf.subarray(8, 20);   // 12 字节事务 ID
```

### ② Magic Cookie 0x2112A442 到底"魔"在哪

Magic Cookie 本身没有任何加密能力，它的作用是**识别与分流**：

1. **识别 STUN 报文**：UDP 端口上可能混跑 RTP/RTCP/DTLS，先读偏移 4 的 4 个字节，等于 `0x2112A442` 才按 STUN 解析，否则直接丢弃。
2. **区分新旧版本**：RFC 3489（旧版 STUN）没有 Magic Cookie，前 4 字节属于 16 字节 Transaction ID。检测到没有 Cookie 的报文可识别为旧版并降级处理。
3. **辅助指纹计算**：FINGERPRINT 属性 = `CRC32(报文) XOR 0x5354554e`，XOR-MAPPED-ADDRESS 也要用 Cookie 做异或密钥。

> 头部前 2 位固定为 0 也是同理——RTP 包前 2 位是版本号 `10`，两者在同一 5 元组上共存（ICE 复用端口）时靠这两类标记互相区分。

### ③ 消息分类：Class + Method 的位编码

Message Type 的后 14 位不是单纯的整数，而是 Class（2 位）和 Method（12 位）穿插编码：

| 类型 | 编码值 | Class | 说明 |
| --- | --- | --- | --- |
| Binding Request | `0x0001` | 00 | 客户端问"我的公网地址是什么" |
| Binding Indication | `0x0011` | 01 | 单向通知，服务器不回复 |
| Binding Success Response | `0x0101` | 10 | 服务器回带映射地址 |
| Binding Error Response | `0x0111` | 11 | 出错，携带 ERROR-CODE 属性 |

RFC 5389 只定义了 Binding 这一种 Method；Allocate / Refresh / Send / Data 等方法是 RFC 5766（TURN）扩展的——下一个模块手写 TURN 会用到。

### ④ TLV 属性与 4 字节对齐

头部之后是零个或多个属性，每个属性都是 **Type（2B）+ Length（2B）+ Value（变长）**：

- `Length` 只算 Value 的字节数，**不含** Type/Length 自身；
- Value 必须 **4 字节对齐**，不足补 0，补的 0 不计入 Length；
- 常见属性：MAPPED-ADDRESS `0x0001`、XOR-MAPPED-ADDRESS `0x0020`、MESSAGE-INTEGRITY `0x0008`、FINGERPRINT `0x8028`。

解析循环：从头读 4 字节拿到 Type/Length → 按 `len + ((4 - len % 4) % 4)` 跳到下一个属性，直到消费完 `Message Length` 指定的字节数。

## 坑点清单（FAQ）

- **Q：为什么解析出来的属性全是乱的？** 九成是 4 字节对齐没处理。Value 长度不是 4 的倍数时后面有补零，跳偏移必须用补齐后的长度；另外 Length 是**报文体**长度，不含 20 字节头部，校验总长应该是 `buf.length === 20 + bodyLen`。
- **Q：服务器能"优化"一下 Transaction ID 再回传吗？** 不能。Transaction ID 是客户端匹配请求/响应的唯一凭据，必须 **12 个字节原样回传**，改写任何一位客户端都会判定响应无效。
- **Q：收到 Magic Cookie 不对的包怎么办？** 直接丢弃。它要么是旧版 RFC 3489 报文（前 4 字节属于 16 字节 tid），要么根本不是 STUN。同一 UDP 端口上混跑 RTP/DTLS 是常态，校验 Cookie 是解码器的第一道工序。

## 自测 3 题（含答案）

1. 一个 Binding Success Response 的 hex 开头是 `01 01 00 38 21 12 a4 42 ...`，它的消息类型、报文体长度、Magic Cookie 各是多少？总报文长度是多少字节？
   <details><summary>答案</summary>Message Type = <code>0x0101</code>（Binding Success Response）；Body Length = <code>0x0038</code> = 56 字节；Magic Cookie = <code>0x2112A442</code> ✓。总长度 = 20 + 56 = <strong>76 字节</strong>。</details>

2. 为什么 STUN 头部前 2 位必须固定为 0？
   <details><summary>答案</summary>为了和 RTP/RTCP 区分——RTP 包前 2 位是版本号 <code>10</code>。ICE 复用同一 UDP 端口跑 STUN 和 RTP 时，靠这 2 位（加上 Magic Cookie）就能判断报文归属，不会把 RTP 包误当 STUN 解析。</details>

3. 客户端收到响应后，凭什么确定这个响应对应自己发出去的哪个请求？
   <details><summary>答案</summary>凭 <strong>Transaction ID</strong>。客户端发请求时随机生成 12 字节 tid 并本地记录，服务器在响应中原样回传；客户端比对 tid 一致才接受响应，否则丢弃（可能是过期或伪造的包）。</details>
