# EP.03 编解码大战：VP8 vs H264 vs Opus

> 对应正文：[模块三 · 编解码协商与 5G 下的比特率控制](../guide/03-codecs/index.md)
> 动手演示：打开 Chrome 和 Safari 各自跑同一个 WebRTC Demo，观察 SDP Offer / Answer 里的 codec 交集

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 像素酱发现 Chrome 和 Safari 连不上：Chrome 默认 VP8 优先级最高，但 Safari 只认 H264，SDP 协商直接崩了。 |
| ② 揭秘 | 码叔把三家浏览器的编解码支持情况列出来：Chrome/Edge/Firefox 都有 VP8+VP9+H264，Safari 只有 H264。音频三家统一用 Opus。结论：跨浏览器**必须支持 H264**。 |
| ③ 实证 | 码叔演示 5G 场景下调高 minBitrate（150kbps 底线）+ Simulcast 三层编码（full/half/quarter），但 Safari 不支持 sendEncodings，必须降级单层。 |
| ④ 结案 | 三条铁律：Safari 只认 H264、Simulcast 要检测 Safari 降级、H264 profile 加 bframes=0。 |

## 知识点拆解

### ① SDP 协商怎么选编解码

WebRTC 的协商流程就像"双方各自报菜名，取交集，按**发起方优先级**排"：

```
Chrome（Offer方）按优先级报：[VP8, VP9, H264, AV1]
Safari（Answer方）按优先级报：[H264, HEVC]
交集 = [H264] → 最终选 H264 ✅
```

但如果 Chrome Offer 时没把 H264 放在最前，某些 Safari 版本可能协商异常。最佳实践是**发送前强制 H264 优先**：

```js
// Chrome：在 addTransceiver 时指定 codec
const pc = new RTCPeerConnection()
pc.addTransceiver('video', {
  direction: 'sendrecv',
  sendEncodings: [{
    rid: 'f',
    codec: 'H264'  // 显式指定
  }]
})
```

### ② Simulcast 是什么

Simulcast 是"一路推流同时发多层分辨率/码率"，SFU 根据下游能力选择合适层转发。适用于多观众场景（有人看 4K，有人只看 quarter 层）。

```js
// Chrome 支持 Simulcast：
pc.addTransceiver('video', {
  sendEncodings: [
    { rid: 'f', maxBitrate: 4_000_000, scaleResolutionDownBy: 1 },  // full
    { rid: 'h', maxBitrate: 1_500_000, scaleResolutionDownBy: 2 },  // half
    { rid: 'q', maxBitrate:   600_000, scaleResolutionDownBy: 4 },  // quarter
  ]
})
```

**Safari 不支持 Simulcast**：检测到 Safari 时必须降级成单层 `sendEncodings: [{ maxBitrate: 4_000_000 }]`。

### ③ H264 的 bframes=0 是什么

WebRTC 的 H264 profile 必须加 `bframes=0`，因为：
- B 帧需要**前后各参考一帧**才能解码，引入了 1~2 帧的额外延迟
- 实时通信场景不要这个延迟，用 Baseline Profile（没有 B 帧）
- Chrome 内部做 H264 编码时默认就是 Baseline Profile

在 SDP 里可以看到：

```
a=rtpmap:98 H264/90000
a=fmtp:98 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
//            ^^^ Baseline Profile
```

### ④ 5G 下怎么调比特率

5G 带宽足（通常下行 500Mbps+、上行 200Mbps+），可以把 GCC 的"保守下限"拉高：

```js
const sender = pc.getSenders().find(s => s.track?.kind === 'video')
const params = sender.getParameters()

// minBitrate 不能设太激进（比如 5Mbps 下限），弱网会被卡死
// 5G 推荐：min 150k → 避免 GCC 压到看不清
//         max 4M   → 给 1080p60fps 留空间
params.encodings[0].minBitrate = 150_000
params.encodings[0].maxBitrate = 4_000_000

await sender.setParameters(params)
```

## 坑点清单（FAQ）

- **Q：Safari 15 以后支持 VP8 了吗？** Safari 15 开始**接收** VP8（从 Chrome 收到 VP8 流可以解码），但**发送**端仍然只编码 H264。兼容性判断以发送端为准——Safari 永远发 H264。
- **Q：AV1 什么时候能用？** Chrome 95+ 和 Firefox 100+ 支持硬件 AV1 解码，编码走软件。延迟略高于 H264/VP8。跨浏览器场景暂时不要强制 AV1，让浏览器自己在优先级里选。
- **Q：Simulcast 有层数上限吗？** Chrome 最多 3 层（f/h/q），rid 分别是 `f`、`h`、`q`。SFU 下游订阅时用 `setPreferredLayers({ rid: 'h' })`。
- **Q：音频编解码为什么三家都用 Opus？** Opus 是 IETF 标准 WebRTC 推荐音频编解码，所有 WebRTC 实现都**必须**支持。采样率 48kHz，比传统 AAC/G.722 音质好 30%+，同时低码率下抗丢包更强。

## 自测（Quiz）

1. 写一段 JS 代码，在 Chrome 上 addTransceiver 时强制优先发送 H264 编码视频（包含 sendEncodings 或 codec 指定）。
2. Simulcast 的 rid 参数 f/h/q 分别代表什么？为什么 Safari 不能用？
3. 以下哪些编解码在 Safari 上**只能接收不能发送**？a. H264 b. VP8 c. VP9 d. Opus。

<details>
<summary>答案</summary>

1. 参考上方 ① 小节：`pc.addTransceiver('video', { direction: 'sendrecv', sendEncodings: [{ codec: 'H264' }] })`，更稳妥的方式是在 `createOffer` 后手动改 SDP 里的 codec 顺序（把 H264 相关的 rtpmap 行移到 m=video 行的最前面）。
2. `f` = full（原始分辨率）、`h` = half（高宽各缩 2 倍）、`q` = quarter（缩 4 倍）。Safari 的 WebRTC 实现（基于 iOS/macOS 的 VideoToolbox 硬件编码）不支持同时编码多层，所以 `sendEncodings` 的 rid 参数会被忽略，只能传单层。
3. **b 和 c（VP8、VP9）**。Safari 15+ 可以**解码** Chrome 发来的 VP8/VP9 流（接收端没问题），但 Safari 的**发送端**只编码 H264。H264 和 Opus Safari 发送接收都支持。
</details>
