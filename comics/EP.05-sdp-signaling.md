# EP.05 Offer / Answer 里到底写了什么

> 对应正文：[模块五 · 信令与 SDP 协商](../guide/05-signaling-sdp/index.md)
> 动手演示：[BroadcastChannel 跨标签页 Offer/Answer](../../public/demos/sdp-chat/)

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君调用 `createOffer()` 成功，控制台打印出一坨 `v=0 o=- 4217 2 IN IP4 127.0.0.1 ...` 的文本。既看不懂，`setRemoteDescription` 还报错。像素酱追问：这堆 ASCII 怎么从 A 漂到 B 的？ |
| ② 揭秘 | 码叔画出信令流程图：Offer（caller 发起的 SDP）→ Answer（callee 回应的 SDP）→ ICE Trickle（候选增量上报）。SDP 是浏览器自动生成的"相亲简历"，描述我能支持的 codecs、带宽、ICE ufrag 等。 |
| ③ 实证 | 标签君用 `BroadcastChannel` 在两个浏览器标签页之间做 Offer/Answer：A 页创建 Offer → setLocalDescription → 广播；B 页收到 → setRemoteDescription → createAnswer → setLocalDescription → 广播回去。 |
| ④ 结案 | 码叔总结：信令服务器只做转发，不解释、不改动。坑点三条：① Trickle ICE 别关 ② Plan B vs Unified Plan ③ 不要用 SDP 内容做业务逻辑。 |

## 知识点拆解

### ① SDP 是什么？

SDP（Session Description Protocol）是 IETF 定义的**会话描述格式**，全是纯 ASCII 文本。WebRTC 用它告诉对方：

- 我能支持哪些音频/视频编解码器（`m=` 行）
- 我期望的带宽上限（`b=` 行）
- 我的 ICE ufrag / pwd（`a=ice-ufrag` / `a=ice-pwd`）
- DTLS 指纹（`a=fingerprint`）
- 媒体流的收发意图（`a=sendrecv` / `a=recvonly` / `a=inactive`）

一个典型 Offer 片段：

```sdp
v=0
o=- 4217 2 IN IP4 127.0.0.1
s=-
t=0 0
m=video 9 UDP/TLS/RTP/SAVPF 96 97 100
a=rtpmap:96 VP8/90000
a=ice-ufrag:RGlk
a=ice-pwd:abc123...
a=fingerprint:sha-256 AA:BB:CC:DD...
```

### ② 信令的两次交换

WebRTC 连接建立需要**两轮 SDP 交换**：

```
caller                          callee
  │                                │
  │── createOffer() ──► Offer SDP  │
  │                                │
  │                    setRemoteDescription(offer)
  │                                │
  │◄───── Answer SDP ── createAnswer()
  │                                │
  │ setRemoteDescription(answer)   │
  │                                │
  │════════ P2P 连接就绪 ══════════│
```

Offer 和 Answer 必须严格遵循 **SDP 协商规则**（JSEP）：callee 的 Answer 必须精确回应 Offer 里的每一条 media section。如果 Offer 有 video section，Answer 要么同意（带 codec），要么拒绝（port=0）。

### ③ ICE Trickle 为什么重要

ICE 候选的上报有两种模式：

| 模式 | 行为 | 影响 |
| --- | --- | --- |
| **Trickle ICE**（推荐） | `onicecandidate` 逐个触发，边收集边发送 | 连接建立快 1~3 秒 |
| Complete ICE Gathering | 等所有候选收集完一次性打包进 SDP | 对服务器 NAT 场景很慢 |

**别关 Trickle**！错误做法：

```js
// ❌ 不要等 iceGatheringState === 'complete' 才发送
pc.onicegatheringstatechange = () => {
  if (pc.iceGatheringState === 'complete') {
    server.sendSdp(pc.localDescription); // 晚了 3 秒
  }
};
```

正确做法：

```js
// ✅ 候选来一个发一个
pc.onicecandidate = e => {
  if (e.candidate) {
    server.sendIceCandidate(e.candidate); // Trickle
  }
};
pc.setLocalDescription(offer).then(() => {
  server.sendSdp(pc.localDescription); // 先把骨架发了
});
```

### ④ Plan B vs Unified Plan

WebRTC 支持两种 SDP 规划模式：

| 模式 | 特点 | 状态 |
| --- | --- | --- |
| **Plan B** | 一个 `m=` section 承载多个 track（旧 Firefox/Safari） | 已废弃 |
| **Unified Plan** | 每个 track 一个独立 `m=` section | Chrome 72+ 强制 |

**生产注意**：Safari 还在 Unified Plan，Firefox 也已切换。如果你需要兼容老版本，可以显式指定：

```js
const pc = new RTCPeerConnection({ sdpSemantics: 'unified-plan' }); // Chrome 72+ 默认
```

## 坑点清单（FAQ）

- **Q：setRemoteDescription 报错 "InvalidStateError" 是什么意思？** 通常是你没按 Offer → Answer 的顺序来，或者本地 SDP 还没 set 就 set remote 了。检查调用顺序：caller 先 setLocalDescription(offer)，callee 收到后先 setRemoteDescription(offer) 再 createAnswer。
- **Q：信令服务器需要理解 SDP 内容吗？** **绝对不要**。信令服务器的唯一职责就是"收到 A 的消息转发给 B"。如果你尝试解析 SDP 内容做业务判断，不同浏览器生成的 SDP 格式会让你崩溃。
- **Q：为什么我的 SDP 里 codecs 只有 H264？** Chrome 在 macOS 上默认优先 H264（硬件编码效率高），VP8 是 fallback。可以通过 `addTransceiver` 显式指定 codec 优先级。
- **Q：createOffer 和 createAnswer 的约束参数有什么区别？** `createOffer({ offerToReceiveVideo: true })` 是 caller 表达"我想收到视频"；callee 不需要这个参数，它的 Answer 是对 Offer 的回应。

## 自测（Quiz）

1. Offer 和 Answer 之间是什么关系？callee 的 Answer 可以完全无视 Offer 的内容吗？
2. Trickle ICE 和 Complete ICE Gathering 的区别是什么？为什么推荐前者？
3. 以下哪种做法会导致 setRemoteDescription 报错？A）offer 还没 setLocalDescription 就把 Offer 发给 callee；B）callee 还没 setRemoteDescription 就 createAnswer；C）信令服务器篡改了 SDP 的一行

<details>
<summary>答案</summary>

1. Answer 必须**精确回应** Offer 的每一个 `m=` section。callee 不能凭空加 Offer 里没有的媒体类型，也不能把 Offer 里要 `sendrecv` 的改成 `inactive` 就了事——只能同意或拒绝（port=0）。
2. Trickle ICE 在候选收集过程中边收集边通过 `onicecandidate` 上报；Complete Gathering 是等所有候选都收完一次性发。推荐 Trickle 是因为它能让 P2P 连接的建立时间缩短 1~3 秒，对实时互动影响巨大。
3. **B**。callee 必须先 `setRemoteDescription(offer)` 才能 `createAnswer()`——浏览器需要知道 Offer 里有哪些媒体 section 才能构造正确的 Answer。A 不会报错（offer 对象本身就是完整的），C 可能导致协商失败但不是立刻 InvalidStateError。
</details>
