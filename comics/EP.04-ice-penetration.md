# EP.04 两个 NAT 背后的人怎么握手

> 对应正文：[模块四 · ICE / STUN / TURN](../guide/04-ice-stun-turn/index.md)
> 动手演示：`chrome://webrtc-internals` 观察候选收集过程；浏览器控制台 `pc.getConfiguration()` 看 ICE 候选配置

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君在同一个浏览器两个窗口跑 Demo，`iceConnectionState` 一直是 `'failed'`——两个 NAT 背后的设备根本互相看不见。 |
| ② 揭秘 | 码叔画出 NAT 四档（Full Cone → Symmetric），ICE 会按优先级收集四类候选：Host → SRFLX（STUN 反射）→ PRFLX（STUN Ping）→ Relayed（TURN 中继）。运营商 NAT 基本都是 Symmetric，STUN 大概率不中。 |
| ③ 实证 | 码叔对比三种候选的延迟：同局域网 Host 直连 5~15ms 🏆；STUN 穿透 P2P 30~80ms ✅；TURN 中继 150~300ms ⚠。并推荐免费 STUN 和自建 TURN 方案。 |
| ④ 结案 | 穿透口诀：Host 优先 → STUN 试试 → TURN 兜底。坑点三条：运营商 NAT 必须 TURN、同局域网 Host 直连、Trickle ICE 别关。 |

## 知识点拆解

### ① 什么是 NAT，为什么它挡了 WebRTC

NAT（网络地址转换）的作用是让多个内网设备共享一个公网 IP。但它有个副作用：**外网设备无法主动向内网设备发 UDP 包**——因为 NAT 不知道该把包转给内网哪台机器。

WebRTC 的 P2P 连接需要**双方都能收到对方发来的 UDP 包**，这就是 NAT 穿透要解决的问题。

### ② NAT 的四种类型（从好到坏）

| NAT 类型 | 描述 | STUN 能穿透？ | 代表场景 |
| --- | --- | --- | --- |
| Full Cone NAT | 内网机器每次只出一个端口，外网都能打到 | ✅ | 很少见（家庭宽带） |
| Restricted Cone NAT | 只允许之前响应过的外网 IP 打过来 | ✅ | 家庭宽带 |
| Port-Restricted Cone NAT | 只允许之前响应过的外网 IP+端口打过来 | ⚠ 大概率不行 | 企业网 |
| **Symmetric NAT** | 每次外连 IP 都映射不同公网端口 | ❌ 不行 | **运营商 4G/5G 网络** |

**中国移动 / 中国电信 / 中国联通** 的蜂窝网络基本都是 **Symmetric NAT**——这就是为什么"手机对手机"的 P2P 连接成功率特别低，必须备 TURN 中继。

### ③ ICE 候选收集流程

```js
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },   // 免费 STUN
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:turn.yourdomain.com:3478',     // 自建 TURN
      username: 'xxx',
      credential: 'yyy',
    }
  ],
  iceTransportPolicy: 'all'  // 'relay' = 强制只用 TURN（对称 NAT 兜底）
})
```

浏览器会自动按优先级顺序尝试候选配对：

```
1. Host candidates（本机内网 IP，192.168.x.x）
   → 同局域网设备互连时，直接命中这一层，延迟 < 10ms

2. SRFLX candidates（STUN 反射后的公网 IP）
   → STUN 服务器帮你问 NAT："你刚才出去用的公网 IP:端口是什么？"
   → 拿到后告诉对端，让它用这个地址打回来

3. PRFLX candidates（STUN Ping 探测出来的临时候选）

4. Relayed candidates（TURN 中继 IP）
   → 实在不行就走 TURN 服务器，双方都连到中继，由中继转发
   → 延迟增加，但**100% 能连通**
```

### ④ Trickle ICE 是什么

传统方式：必须等**所有候选都收集完**才能交换 SDP → 连接时间长（2~5 秒）。

Trickle ICE（默认开启）：边收集边把候选通过信令通道发给对端 → 连接时间压到 **500ms~1 秒**。

**除非你要和旧版 WebRTC 客户端互通，否则不要关它**。

## 坑点清单（FAQ）

- **Q：只配 STUN 不配 TURN 会怎样？** 局域网场景没问题（Host 直连命中）。但跨运营商蜂窝网络（Symmetric NAT）→ `iceConnectionState` 永远是 `'failed'`。**生产环境必须配 TURN**。
- **Q：TURN 费用很贵吗？** coturn（开源）自建几乎免费，只要你有一台公网带宽够的服务器。云服务商有托管 TURN：Twilio / Metered / Xirsys，按时长计费，1000 并发月费约 $50。
- **Q：Chrome 和 Safari 的穿透成功率一样吗？** 一样。ICE 逻辑是浏览器内建的，和 WebRTC 实现相关，两家都基于同一套 ICE/STUN/TURN 规范。但 Safari 的 `iceConnectionState` 事件触发时序略有差异。
- **Q：`iceTransportPolicy: 'relay'` 什么时候用？** 明确知道对方在 Symmetric NAT 后面、或者跨区域必须走中继时可以强制只用 TURN，避免浪费时间在注定失败的 Host/SRFLX 候选上。

## 自测（Quiz）

1. 写一段 RTCPeerConnection 配置，包含 Google STUN + 你自己的 TURN 服务器（turn:turn.example.com:3478，用户名 web 和密码 pass）。
2. 四种 NAT 类型里，哪种 STUN 完全穿透不了？手机 4G/5G 网络属于哪一种？
3. Trickle ICE 默认是开的还是关的？关掉后会有什么后果？什么情况下应该关？

<details>
<summary>答案</summary>

1.
```js
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:turn.example.com:3478', username: 'web', credential: 'pass' }
  ],
  iceTransportPolicy: 'all'
})
```

2. **Symmetric NAT**（第 4 档）STUN 完全穿透不了。中国移动 / 中国电信 / 中国联通的 4G/5G 蜂窝网络基本都是 Symmetric NAT——这就是为什么手机对手机 P2P 连接成功率特别低。

3. Trickle ICE **默认开启**。关掉后必须等所有 ICE 候选都收集完才能交换 SDP，连接建立时间从 ~1 秒翻倍到 3~5 秒。**现代开发永远不要关它**——除非你要和 2015 年以前的旧版 WebRTC 客户端互通（这些客户端不支持 Trickle ICE）。
</details>
