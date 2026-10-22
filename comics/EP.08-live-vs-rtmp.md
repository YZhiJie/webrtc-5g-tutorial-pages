# EP.08 WebRTC 直播 vs 传统 RTMP

> 对应正文：[模块八 · 直播场景的技术选型](../guide/08-live-streaming/index.md)
> 动手演示：Mediasoup SFU + ffmpeg 转推 RTMP 的完整 Demo

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君的电商直播项目：现有 RTMP 推 CDN 支撑 10w+ 纯观看观众没问题，但老板要加**连麦 PK** 功能，RTMP 根本没有双向互动能力。 |
| ② 揭秘 | 码叔画出三种架构：方案 A 纯 RTMP（单向无互动）、方案 B 纯 WebRTC+SFU（互动但成本高）、方案 C **混合架构**（WebRTC 做互动层 + ffmpeg 转推 RTMP 给 CDN 做大规模分发）。 |
| ③ 实证 | 展示 Mediasoup SFU 接收主播 WebRTC 流，同时 fork 两路：一路给连麦观众（WebRTC 低延迟），一路通过 ffmpeg 转成 RTMP 推 CDN 给 10w 纯观看观众。 |
| ④ 结案 | 像素酱确认 WebRTC 和 RTMP 是互补而非竞争关系。码叔列三条坑点：SFU 成本算 simulcast 带宽、编码器必须开 simulcast、TURN 转发流量要预留预算。 |

## 知识点拆解

### ① 为什么 RTMP 做不了连麦？

RTMP 本质是一个**单向推流协议**——设计目标就是"一个主播推给 N 个观众"，没有"观众把自己的流推回去"的路径。HLS 更极端，直接把视频切片放 HTTP 服务器上，连实时性都牺牲了。

| 协议 | 延迟 | 互动 | 分发规模 | 成本 |
| --- | --- | --- | --- | --- |
| RTMP 推流 + CDN HLS 分发 | 3~10s | ❌ 无 | 百万级 | 低（CDN 边缘缓存） |
| WebRTC + SFU | 50~200ms | ✅ 双向 | 万级 | 中高（SFU 服务器） |
| 混合架构 | 互动 100ms / 观看 3s | ✅ 混合 | 百万级 | 中（CDN + 部分 SFU） |

### ② 混合架构的完整链路

这是当前主流直播平台（抖音、快手、B站、Twitch）都在用的架构：

```
主播（手机/网页）
  │ WebRTC（带 simulcast 3 层）
  ▼
SFU 服务器（Mediasoup / Janus / Pion）
  ├─▶ 连麦观众 A（WebRTC 拉最低可用层，~100ms）
  ├─▶ 连麦观众 B（WebRTC 拉中等层，~100ms）
  ├─▶ 连麦嘉宾 C（WebRTC 拉最高层，~100ms）
  │
  └─▶ ffmpeg 子进程（从 SFU 的本地录制端口读取流）
        │ RTMP
        ▼
        CDN 推流节点
          │ HLS/DASH
          ▼
          10w+ 纯观看观众（延迟 ~3s）
```

**关键实现细节**：SFU 需要把多路 WebRTC Producer 聚合成一条，编码成 RTMP 推给 CDN。常用方式：

1. **SFU 内置转推**：Mediasoup 的 `record()` API / Janus 的录制模块
2. **ffmpeg + SRT**：SFU 暴露 SRT 接收端口，ffmpeg `-i srt://sfu-host:9000` 再转 RTMP
3. **录屏桥接**：用一个"虚拟观众"身份连接 SFU，拿到流后交给 ffmpeg（hack 但有效）

### ③ Simulcast 为什么是 SFU 必需？

**Simulcast** = 编码器同时输出多路不同分辨率/码率的视频流：

```typescript
// 主播端：Chrome 自动开 simulcast（VP8/VP9）
const sender = pc.addTrack(track, stream);
// SFU 会拿到 3 路 track：180p / 360p / 720p
// 然后按观众带宽发不同层
```

不开 simulcast 的后果：
- 编码器只输出**一路最高码率**的流
- SFU 必须给所有观众转发这一路
- 弱网观众：卡成 PPT（带宽不够）
- SFU 必须硬转码才能适配不同观众 → **CPU 炸了**（转码成本是转发的 10~100 倍）

> H264 的 simulcast 需要用 SVC（Scalable Video Coding），Chrome 的 H264 默认不支持 SVC，VP8/VP9 原生支持 simulcast。**生产环境建议主播端用 VP9 编码**，SFU 端按需转 H264 给 CDN。

### ④ TURN 流量成本估算

不是所有用户都能走 P2P 直连——对称 NAT 或企业防火墙后面的用户必须走 TURN 中继。估算公式：

```
TURN 流量 = 连麦人数 × 平均码率 × 2（上下行）× 0.25（假设 25% 走 TURN）
```

举例：1000 人连麦，平均上行 2Mbps、下行 4Mbps：
- 总 TURN 带宽 ≈ 1000 × (2+4) × 0.25 = **1500 Mbps**
- 月流量 ≈ 1500 × 3600 × 24 × 30 / 8 ≈ **20 TB**

云厂商 TURN 中继价格：$0.08~$0.15 / GB，**约 $1600~$3000 / 月**。

## 坑点清单（FAQ）

- **Q：能不能让 RTMP 也支持互动？** 不能。RTMP 是单向推送设计。有人尝试过 RTMP 拉流回推主播（"连麦"），但延迟至少 3~5s，实际体验就是"你喊了对方半秒才听到"。
- **Q：SFU 选 Mediasoup 还是 Janus？** Mediasoup 性能更好（纯 Node.js + C++ addon，单核 5000 并发），Janus 功能更全（内置录制、转码、插件系统）。**国内直播平台大多用 Mediasoup**，Janus 在开源社区更火。
- **Q：ffmpeg 转 RTMP 会丢帧吗？** 不会（用 `-c:v copy -c:a copy` 直接 copy）。但如果从 WebRTC 的 VP8/VP9 转 H264（CDN 要求 H264），需要硬编码——记得加 `-preset veryfast -tune zerolatency` 控制延迟在 500ms 内。
- **Q：CDN 支持 WebRTC 吗？** 新兴 CDN 比如 Cloudflare Stream、阿里云 RTC、腾讯云 TRTC 都原生支持 WebRTC 分发。传统 CDN（网宿、七牛）主要做 HLS/DASH，但也在加速 WebRTC 支持。
- **Q：10w+ 连麦观众怎么办？** 连麦人数一般不会超过 100~500 人（体验限制）。超过 1000 人连麦就要用**分层 SFU**（中心 SFU 接边缘 SFU，边缘 SFU 接终端），或者让"观众"降级为纯观看，只保留主播和 TOP N 嘉宾用 WebRTC。

## 自测（Quiz）

1. 你的直播产品需求：1w 纯观看观众 + 10 人连麦 PK。用纯 RTMP 方案行得通吗？为什么？给出正确架构。
2. 什么是 simulcast？SFU 为什么必须依赖它？如果主播端编码器不开 simulcast，会发生什么？
3. 估算：1000 人连麦的直播间，平均码率上行 2Mbps、下行 4Mbps，假设 25% 用户走 TURN 中继，你需要预留多少 TURN 带宽？

<details>
<summary>答案</summary>

1. 纯 RTMP 方案**完全不行**——RTMP 是单向推流协议，没有观众上行推流的路径，连麦功能从根本上无法实现。正确架构：**WebRTC + SFU 做连麦互动层 + ffmpeg 从 SFU 转推 RTMP 给 CDN 做大规模分发**。主播用 WebRTC 推流到 SFU，10 个连麦嘉宾也用 WebRTC 接 SFU，SFU 同时把混合后的流转成 RTMP 推给 CDN 供 1w 纯观看用户通过 HLS/DASH 消费。
2. Simulcast 是视频编码器同时输出多路不同分辨率/码率的视频流（如 180p / 360p / 720p）。SFU 依赖 simulcast 来给不同网络条件的观众发不同码率层级——带宽好的发高层，带宽差的发低层。如果主播端不开 simulcast，SFU 只能给所有观众转发**最高码率那一路**，弱网观众卡成 PPT，SFU 只能被迫在服务端硬转码（CPU 成本是转发的 10~100 倍），生产环境撑不住。
3. TURN 带宽 = 连麦人数 × 平均总码率（上行+下行）× TURN 比例 = 1000 × (2 + 4) × 0.25 = **1500 Mbps**。如果每人 8 小时连麦，月流量约 1500 Mbps × 3600s × 8h × 30d / 8 = 162 TB，云厂商成本约 $13,000~$24,000/月——这就是为什么 TURN 成本必须提前算进预算。
</details>
