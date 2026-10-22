# EP.01 浏览器里藏着一整套 RTC 栈

> 对应正文：[1.1 WebRTC 是什么](../guide/01-overview/basics.md) · [1.2 5G 重塑实时通信](../guide/01-overview/advanced.md) · [1.3 5G 场景优势定位](../guide/01-overview/practice.md)

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君疑惑"为什么抖音直播连麦能这么低延迟"，以为要自己写 UDP 传输层。 |
| ② 揭秘 | 码叔画了三层架构图：浏览器把整套 RTC 栈（采集/编解码/SRTP/ICE）打包成了 JS API，开发者只调三个 API 就够了。 |
| ③ 实证 | 码叔展示了 5G 网络下 WebRTC 端到端实测 70ms vs RTMP 1.8s 的差距，像素酱问"那 5G 真能到 1ms？" |
| ④ 结案 | 码叔讲清楚 5G 1ms 是空口时延不是端到端，WebRTC 三件套 + 5G MEC = 直播互动最优解。 |

## 知识点拆解

### ① WebRTC 三件套

| API | 作用 |
| --- | --- |
| `getUserMedia` | 采集音视频（摄像头 / 麦克风 / 屏幕共享） |
| `RTCPeerConnection` | 建立 P2P 连接、交换媒体流、拥塞控制 |
| `RTCDataChannel` | P2P 之间传输任意数据（文本、文件、二进制） |

> 浏览器底层还做了一堆你看不到的事：DTLS 密钥协商、SRTP 加密、Jitter Buffer 抖动缓冲、拥塞控制（GCC / BBR）、ICE 候选选择——全是内建的。

### ② 5G 延迟 ≠ 1ms 端到端

容易混淆的点：

- **5G 空口时延**：1~10ms（这是 5G 基站 ↔ 手机之间的时间）
- **WebRTC 端到端**：采集 → 编码 → 传输 → 转发 → 解码 → 渲染，5G 下实际 **50~120ms**
- **4G + RTMP**：约 1.5~2.5 秒（GOP 缓存 + HLS 切片）

5G 的核心贡献：把传输时延从 30~50ms 压到 5~15ms，再配合 MEC 边缘 SFU 减少跨区域转发。

### ③ 何时用 WebRTC vs RTMP

**一条判断标准**：是否需要互动。

| 场景 | 选谁 |
| --- | --- |
| 电商带货纯播放 | RTMP / HLS（CDN 分发便宜） |
| 连麦 PK / 在线教育 | **WebRTC**（必须双向互动） |
| 竞技直播 | **WebRTC + 5G MEC**（低延迟 + 边缘分发） |
| 云游戏 | **WebRTC + 专用编码器**（端到端 < 100ms） |

现在主流做法是**WebRTC 做互动层 + RTMP 做分发层**——主播用 WebRTC 推流，SFU 同时转 RTMP 给传统 CDN，兼顾低延迟互动和大规模分发。

### ④ 5G 四大赋能 WebRTC 的特性

1. **eMBB 上行增强**：上行从 500Mbps 到 10Gbps → 手机也能推 4K
2. **URLLC 低时延**：空口 1~10ms → 端到端 50ms 量级
3. **网络切片**：运营商为 WebRTC 直播切独立虚拟网络，保障 QoS
4. **MEC 边缘计算**：SFU 部署到基站旁，减少 3~5 跳

## 坑点清单（FAQ）

- **Q：WebRTC 替代 RTMP 了吗？** 没有。WebRTC 解决**互动**问题，RTMP 解决**大规模分发**问题。现在是互补关系：WebRTC + SFU + RTMP 转推给 CDN。
- **Q：5G 手机一定比 4G 快吗？** 不一定。取决于基站密度、室内覆盖、运营商策略。但在密集城区，5G SA（独立组网）的空口时延优势很明显。
- **Q：WebRTC 延迟稳定吗？** 网络好时很稳定（±10ms）。但弱网下会自动增 jitter buffer 导致延迟上涨。模块 9 会讲如何控制。
- **Q：为什么不用 QUIC + WebTransport 替代 WebRTC？** QUIC/WebTransport 适合**数据传输**，但音视频编码、SRTP、ICE 这些 WebRTC 已经成熟几十年了的组件，重造轮子没必要。现在的趋势是 WebRTC 底层逐步迁移到 QUIC（HTTP/3）。

## 自测（Quiz）

1. WebRTC 的三件套 API 分别是什么？各起什么作用？
2. 5G URLLC 宣称的 1ms 指的是哪一段的时延？WebRTC 端到端实际能到多少？
3. 电商直播主播和观众互动（连麦 PK）应该用什么技术？纯观看的 10w+ 并发观众呢？

<details>
<summary>答案</summary>

1. `getUserMedia`（采集音视频）、`RTCPeerConnection`（建立 P2P 音视频连接）、`RTCDataChannel`（P2P 间传输任意数据）。
2. 1ms 是**空口时延**（基站 ↔ 手机），不是端到端。5G SA 下 WebRTC 端到端实际 50~120ms。
3. 连麦 PK 用 **WebRTC + SFU**（必须双向低延迟互动）。10w+ 纯观看观众用 **RTMP 推流 + CDN HLS 分发**（WebRTC 做不了这么大规模的分发，SFU 成本过高）。
</details>
