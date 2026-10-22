# EP.15 用延迟梯度估带宽

> 对应正文：[模块十五 · 手写 GCC 拥塞控制](../guide/15-handwritten-gcc/basics.md)
> 动手演示：[手写简化版 GCC](../guide/15-handwritten-gcc/practice.md)

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君直播推流，4G 切到 5G，码率设了 3Mbps 没动，丢包率也只有 2%，但 RTT 从 45ms 一路涨到 380ms，观众反馈画面转圈。 |
| ② 揭秘 | 码叔解释 GCC（Google Congestion Control）的核心思想：**不看丢包，看延迟梯度**。到达间隔减发送间隔大于 0 说明路由器的缓冲队列在堆积，网络已拥塞。 |
| ③ 实证 | 像素酱跑简化版 GCC 模拟器：链路容量从 3Mbps 骤降到 1Mbps 再回升到 5Mbps。打印每秒估计码率，看到 overuse 触发后码率乘性下降（×0.5），underuse 后加性爬升（+0.8Mbps）。 |
| ④ 结案 | 最佳实践三条 + 坑点三条：趋势窗口别太短、加性步长别太猛、最小码率别设 0。 |

## 知识点拆解

### ① 为什么丢包率不够敏感

传统拥塞控制（如 TCP Reno）把**丢包**当作拥塞信号。但在实时音视频场景里，丢包有两个致命问题：

1. **延迟不敏感**：等丢包发生时，缓冲队列早已堆满，延迟已经爆了。
2. **误报率高**：无线链路（4G/5G/WiFi）本身就有随机丢包，和拥塞无关。

GCC 换了一个思路：**在丢包发生之前，通过延迟变化提前感知拥塞**。

### ② 延迟梯度（Delay Gradient）怎么算

对连续两个包，计算：

```
Δarrival = recv_time[i]  - recv_time[i-1]   // 到达间隔
Δsend    = send_time[i]  - send_time[i-1]   // 发送间隔

gradient = Δarrival - Δsend
```

- `gradient > 0`：到达比发送慢 → 包在路由器里排队 → **Overuse（过用）**
- `gradient ≈ 0`：到达和发送同步 → 网络刚好满载 → **Normal**
- `gradient < 0`：到达比发送快 → 队列在排空 → **Underuse（欠用）**

实际 GCC 不会只看两个包，而是用**最近 20 个包做线性回归**（Trendline Filter），拟合出延迟随时间的斜率，平滑掉单包抖动。

### ③ 状态机与码率调整

GCC 用一个简单的状态机驱动码率：

```
         ┌─────────┐
         │  Normal │
         └────┬────┘
   gradient ↑ │ gradient ↓
              ▼
         ┌─────────┐    gradient ↓↓    ┌───────────┐
         │ Overuse │ ────────────────→ │ Underuse  │
         └────┬────┘                   └─────┬─────┘
              │                              │
              ▼                              ▼
         est × 0.85                      est + 步长
         (乘性下降，快速压码率)            (加性爬升，缓慢探测)
```

- **Overuse**：估计码率乘性下降（如 ×0.5 或 ×0.85），快速把码率压到安全线以下。
- **Underuse**：估计码率加性爬升（如 +100kbps 或 +8%），缓慢探测可用带宽上限。
- **Normal**：保持当前码率，微调即可。

### ④ 一个极简 GCC 模拟器（Python 思路）

```python
class SimpleGCC:
    def __init__(self, min_bitrate=100_000, max_bitrate=5_000_000):
        self.est = 1_000_000  # 初始估计 1Mbps
        self.min_b = min_bitrate
        self.max_b = max_bitrate
        self.state = "normal"
        self.window = []      # 最近 20 个 (send_ts, recv_ts)

    def on_packet(self, send_ts, recv_ts):
        self.window.append((send_ts, recv_ts))
        if len(self.window) > 20:
            self.window.pop(0)

    def compute_gradient(self):
        if len(self.window) < 5:
            return 0.0
        # 简化版：直接算首尾包的差值
        first, last = self.window[0], self.window[-1]
        delta_send = last[0] - first[0]
        delta_recv = last[1] - first[1]
        return (delta_recv - delta_send) / max(delta_send, 1e-6)

    def update(self):
        g = self.compute_gradient()
        if g > 0.1:
            self.state = "overuse"
            self.est = max(self.min_b, int(self.est * 0.5))
        elif g < -0.1:
            self.state = "underuse"
            self.est = min(self.max_b, self.est + 100_000)
        else:
            self.state = "normal"
            self.est = min(self.max_b, self.est + 50_000)
        return self.est, self.state
```

跑一遍链路容量 3→1→5 Mbps 的模拟，输出大概长这样：

```
t=1s  cap=3.0M  est=2.8M  state=normal
t=2s  cap=1.0M  est=2.8M  state=overuse   ← 骤降触发
t=3s  cap=1.0M  est=1.4M  state=overuse   ×0.5
t=4s  cap=1.0M  est=0.7M  state=overuse   ×0.5
t=5s  cap=5.0M  est=0.8M  state=underuse  ← 回升触发
t=6s  cap=5.0M  est=1.6M  state=normal    +0.8M
t=7s  cap=5.0M  est=2.4M  state=normal    +0.8M
```

## 坑点清单（FAQ）

- **Q：趋势窗口设多少个包合适？** GCC 默认 20 个。少于 5 个时单包抖动会主导梯度值，容易把正常网络波动误判成 overuse。建议最少 10 个，且覆盖至少 100ms 的时间跨度。
- **Q：Underuse 时加性步长设多大？** 步长太大（如 +1Mbps）会导致码率来回撞墙、振荡；步长太小（如 +10kbps）会爬升太慢，浪费带宽。推荐 **+8% 当前码率** 或 **+100kbps** 的小步快跑策略。
- **Q：最小码率为什么不能设 0？** 极端 overuse 下估计码率会一路乘到 0，导致视频完全静默、音频和信令也发不出去。必须设下限（如 100kbps），保证最基本的通信通道不断。
- **Q：GCC 和 TCP BBR 有什么区别？** GCC 是**发送端**基于延迟梯度做带宽估计，专为实时音视频设计；BBR 是**发送端**基于带宽和 RTT 测量做瓶颈带宽估计，专为 TCP 吞吐优化。两者目标不同：GCC 保延迟，BBR 保吞吐。

## 自测 3 题（含答案）

1. 写出延迟梯度的计算公式，并解释 `gradient > 0` 代表什么网络状态。
2. 在 GCC 状态机中，Overuse 和 Underuse 分别触发什么码率调整策略？为什么一个用乘性、一个用加性？
3. 手写简化版 GCC 时，最小码率设 0 会导致什么后果？生产环境应该设多少？

<details>
<summary>答案</summary>

1.
```
gradient = (recv_time[i] - recv_time[i-1]) - (send_time[i] - send_time[i-1])
```
`gradient > 0` 表示包的到达间隔大于发送间隔，说明数据包在路由器缓冲队列中排队时间变长，网络已处于 **Overuse（过用）** 状态，即发送速率超过了链路实际容量。

2. **Overuse 触发乘性下降**（如 est × 0.5），因为拥塞时需要**快速**把码率压到安全线以下，避免延迟继续爆炸；**Underuse 触发加性爬升**（如 est + 100kbps），因为带宽充足时需要**缓慢**探测上限，避免一步跨太大又触发拥塞。乘性快降 + 加性慢升是拥塞控制的经典策略（类似 TCP 的 AIMD）。

3. 最小码率设 0 会导致极端 overuse 下估计码率一路乘到 0，视频完全静默，音频和信令通道也会中断，观众端直接黑屏。生产环境建议设 **100kbps 左右** 的下限，保证最基本的音频和信令能持续传输。
</details>
