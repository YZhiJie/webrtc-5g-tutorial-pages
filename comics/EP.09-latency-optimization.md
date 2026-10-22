# EP.09 一帧画面的 100ms 旅行

> 对应正文：[模块九 · 延迟优化与弱网对抗](../guide/09-optimization/index.md)
> 动手演示：Chrome webrtc-internals 实时诊断 · GCC vs BBR 对比实验

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君的直播间偶发"卡成 PPT"，但 WebRTC Stats 里 RTT 才 30ms——明明网络延迟很低，为什么画面还是卡？帧到底慢在哪一站了？ |
| ② 揭秘 | 码叔画出完整延迟预算分解：采集 1ms → 编码 10ms → 传输 10ms → SFU 10ms → 传输 10ms → 解码 10ms → **Jitter Buffer 20~100ms** → 渲染 5ms。**Jitter Buffer 才是最大变数**，弱网时自动膨胀。 |
| ③ 实证 | 像素酱问 GCC 是什么，码叔展示 Chrome 默认开启的 GCC 拥塞控制 + simulcast 分层如何自动对抗弱网：硬扛爆了 → GCC 自动降码率稳住 → +simulcast 给 SFU 发多层。 |
| ④ 结案 | 码叔总结延迟优化三板斧：GCC 拥塞控制 / simulcast 分层 / 编码器调优。三条坑点：Jitter Buffer 是延迟大户、bframes=0 硬约束、Pacer 节奏不能乱。 |

## 知识点拆解

### ① 一帧画面的完整延迟预算

理解延迟问题，必须知道**每一帧花在什么地方**：

| 环节 | 典型延迟 | 谁控制 | 可否优化 |
| --- | --- | --- | --- |
| 摄像头采集 | 1ms | 浏览器内核 | ❌ |
| 视频编码 | 5~20ms | 浏览器 + GPU | ✅ 编码器配置 |
| Pacer 排队 | 5~15ms | 浏览器 Pacer | ⚠ 默认最优 |
| 网络传输（上行） | 5~30ms | 运营商网络 | ❌ |
| SFU 转发 | 2~10ms | SFU 服务器 | ✅ 就近部署 |
| 网络传输（下行） | 5~30ms | 运营商网络 | ❌ |
| **Jitter Buffer** | **20~150ms** | 浏览器 / WebRTC | ⚠ 弱网自动膨胀 |
| 视频解码 | 5~20ms | 浏览器 + GPU | ✅ 硬件加速 |
| 浏览器渲染 | 2~10ms | 浏览器合成器 | ❌ |

**关键发现**：RTT 低 ≠ 端到端延迟低。RTT 只是网络往返那一段（约 = 上行 + 下行），编码、Pacer、Jitter Buffer 加起来轻松超过 50ms。

### ② Jitter Buffer：延迟大户

**Jitter** = 数据包到达时间的波动。网络传输不是匀速的——有的包 28ms 到，有的 45ms 到，还有的直接丢了。Jitter Buffer 的任务就是**把到达时间不均匀的数据包缓存起来，然后匀速吐给解码器**。

```
弱网好的情况（RTT=30ms，抖动=±3ms）：
  Buffer 只需缓存 30~50ms 就够了

弱网差的情况（RTT=80ms，抖动=±20ms）：
  Buffer 必须膨胀到 100~150ms 才能平滑输出
  → 画面延迟肉眼可见，就是"卡成 PPT"
```

**解法**：不是硬调小 Jitter Buffer（会导致解码器没数据 → 黑屏），而是**让网络不要丢包**：
- GCC 拥塞控制实时探测带宽，自动降码率避免溢出
- Simulcast 让 SFU 只转发能接住的那一层
- 5G MEC 边缘部署减少 RTT 波动

### ③ GCC 拥塞控制原理

Google Congestion Control（GCC）是 WebRTC 默认的拥塞控制算法：

```typescript
// 你代码里不用写任何东西，Chrome 默认就是 GCC
// 浏览器内部循环：
setInterval(() => {
  // 1. 算带宽：根据 RTP 包到达间隔（不是 RTT！）
  const bandwidthEstimate = 计算实际到达速率();
  
  // 2. 和当前发送速率对比
  if (sendRate > bandwidthEstimate) {
    // 超了 → 减 10% 发送速率
    sendRate *= 0.9;
  } else {
    // 还有余量 → 加 5% 发送速率
    sendRate *= 1.05;
  }
  
  // 3. 告诉编码器：降到 X kbps
  encoder.setBitrate(sendRate);
}, 500); // 每 500ms 探测一次
```

**观察方法**：`chrome://webrtc-internals` → 找到 `RTCSender` → 看 `qualityLimitationReason`：
- `none` = 正常
- `bandwidth` = GCC 在限带宽
- `cpu` = 编码器在限 CPU

### ④ 编码器延迟优化（bframes = 0）

B 帧（Bi-predictive frame）需要参考**前后两帧**才能解码。

```
有 B 帧的 GOP：I ─ P ─ B ─ B ─ P ─ B ─ I
                ↑ 解码 B 帧必须等 P 帧到了
                → 最低延迟 = 一个 GOP 的间隔
```

**关闭 B 帧**（`bframes = 0`）让编码器只输出 I/P 帧：
- 解码不需要等待未来帧
- 最低延迟 = 单帧编码时间 ≈ 10ms

```bash
# ffmpeg libx264 编码
ffmpeg -i input -c:v libx264 -bf 0 -preset veryfast -tune zerolatency output.mp4

# WebRTC 场景下不用自己写，浏览器 VP8/VP9 默认就是 bframes=0
# H264 需要确认 H264Profile 不是 High（High 支持 B 帧）
```

### ⑤ Pacer：别乱调

Pacer 是浏览器的**发包调度器**。WebRTC 不是把编码好的帧立刻丢到网络，而是放进 Pacer 队列，按合适节奏匀速发送——避免突发流量把路由器缓冲撑爆（Bufferbloat）。

- 默认：Chrome Pacer 队列 10ms 内的包会被聚合发送
- **不要关闭 Pacer**（有人试过，结果丢包率翻倍）
- **不要改 Pacer 间隔**（除非你是专家）

## 坑点清单（FAQ）

- **Q：Chrome 里能手动调小 Jitter Buffer 吗？** 理论上可以改 `chrome://flags/#webrtc-jitter-buffer-max-packets`，但**强烈不建议**——调小了弱网直接丢帧黑屏，调大了延迟更高。Jitter Buffer 的膨胀是 GCC 没跟上的信号，根因是码率太高，不是 Buffer 太小。
- **Q：为什么 5G 下延迟还是偶尔飙 200ms？** 5G 空口时延低但核心网仍有抖动。尤其是 5G NSA（非独立组网）下信令还走 4G 核心网，抖动比 5G SA 大。**必须用 5G SA + MEC 边缘 SFU** 才能稳住。
- **Q：GCC 和 BBR 选哪个？** WebRTC 用 GCC，QUIC/WebTransport 用 BBR。不要混——SFU 只能用一种拥塞控制算法处理 WebRTC 流量。GCC 是为实时音视频优化的，BBR 是为通用 QUIC 数据传输设计的。
- **Q：如何测量端到端延迟？** 在**主播端**打时间戳写进 RTP Extension，**观众端**读出计算差值。参考 [Chrome RTCStats API](https://developer.mozilla.org/en-US/docs/Web/API/RTCRemoteInboundRtpStreamStats)：`totalRoundTripTime` 和 `jitter`。

## 自测（Quiz）

1. Chrome `webrtc-internals` 显示 RTT = 30ms，但用户反馈"画面拖了 1 秒才到"。根据延迟预算分解表，最可能是哪一段有问题？
2. 主播端 H264 编码默认开启了 B 帧，对 WebRTC 直播有什么影响？怎么解决？
3. GCC 拥塞控制的带宽估算依据是什么？为什么不直接用 RTT 变化来降码率？

<details>
<summary>答案</summary>

1. RTT 低（网络传输没问题）但画面延迟高，最可能的两个嫌疑人：**Jitter Buffer 膨胀**（弱网抖动大，Chrome 被迫加大缓存到 100~500ms）和 **Pacer 队列异常**（不过这个少见）。诊断方法：`chrome://webrtc-internals` → `RTCInboundRtpStreamStats` → 看 `jitterBufferEmittedCount` vs `jitterBufferPendingCount` 的比例——如果 pending 很高就是 Jitter Buffer 膨胀了。
2. B 帧需要参考"未来"的 P 帧才能解码，导致最低延迟 = GOP 间隔（比如 2 秒）。解决：关闭 B 帧（`bframes=0`），让编码器只输出 I/P 帧。WebRTC 场景下 Chrome 的 VP8/VP9 默认就是 0 B 帧；H264 需要确认用的是 Baseline Profile（不支持 B 帧）。
3. GCC 用的是 **RTP 包到达间隔的方差**（delay gradient），而不是 RTT。原因：RTT 变化反映的是**路由器排队延迟**（Bufferbloat），但排队延迟上升时丢包可能还没发生——GCC 要在丢包真正出现之前就感知到网络变拥塞了。到达间隔的抖动比 RTT 更敏感地反映"管道快满了"这个信号。
</details>
