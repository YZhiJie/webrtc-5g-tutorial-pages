# EP.14 乱序包排队进直播间

> 对应正文：[模块十四 · 手写 Jitter Buffer](../guide/14-handwritten-jitterbuffer/basics.md)
> 动手演示：[手写 JitterBuffer 模拟器](../guide/14-handwritten-jitterbuffer/practice.md)

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君看自家直播：测速 100Mbps、RTT 才 30ms，画面却一顿一顿，声音还先出后入——"网络明明不差，怎么卡成 PPT？" |
| ② 揭秘 | 码叔揭秘：延迟大不可怕，**延迟不稳定（抖动）**才要命。Jitter Buffer 把乱序到达的包按 `seq` 落位重排、囤够深度，再按 `timestamp` 匀速放行给播放器。三大任务：重排、消抖、控延迟。 |
| ③ 实证 | 像素酱用 Node.js 模拟器跑 100 帧（5% 丢包 + 20% 乱序）：深度 60ms 停顿 480ms，120ms 停顿 420ms，220ms 只剩 100ms ✅，400ms 几乎不卡但端到端延迟爆表。结论：最佳深度要按抖动 `J` 自适应尾随。 |
| ④ 结案 | 码叔口诀：**按序放行、宁缺毋滥、见好就收**。坑点三条：音频 buffer 别照抄视频逻辑；帧未齐不要强行播放；NACK 等太久会错过播放时点。 |

## 知识点拆解

### ① 抖动 ≠ 延迟

延迟是"包走了多久"，抖动是**相邻包到达间隔的忽长忽短**。接收端看不到发送端时钟，只能算每个包的 Transit Time：

```
transit = arrivalTime - timestamp          // 到达时刻 - 发送时刻
D(i)  = transit(i) - transit(i-1)          // 相邻包 transit 之差 = 瞬时抖动
J    += (|D| - J) / 16                     // RFC 3550 指数滑动平均
```

- `D > 0`：这个包比上一个晚到得更多，抖动在变大
- `D < 0`：后来居上，抖动在收敛
- `J` 是 Jitter Buffer 定深度的核心输入，突发抖动会拉高它、随后慢慢回落

### ② Jitter Buffer 的三大任务

1. **乱序重排（Reorder）**：包不按 `seq` 到达，先用 `Map<seq, packet>` 落位，天然去重；
2. **消除抖动（De-jitter）**：播放器每 20ms 匀速取一帧，早到的包囤着，给晚到的包留追赶时间；
3. **控制延迟（Latency Control）**：囤得越久越不卡，但端到端延迟越大——必须在"不卡顿"和"低延迟"之间找平衡。

```
乱序到达  seq=5  seq=7  seq=4  seq=6
            ↓ push() 按 seq 落位
┌─ Map<seq, pkt> ────────────┐
│   4 ✓   5 ✓   6 ✓   7 ✓    │  ← 重排完成
└────────────────────────────┘
            ↓ getFrame(now - depth) 到期才放行
匀速播放  seq=4 → 5 → 6 → 7（每 20ms 一帧）
```

### ③ 手写核心：push 与 getFrame

模拟器的两个关键方法（完整可运行代码见 [practice.md](../guide/14-handwritten-jitterbuffer/practice.md)）：

```js
push(packet) {
  if (this.packets.has(packet.seq)) return;   // 重复包，丢弃
  if (packet.seq < this.nextSeq) return;      // 来得太晚，已被跳过
  this.packets.set(packet.seq, packet);       // 按 seq 落位
  // …顺带用 RFC 3550 公式更新抖动估计 J
}

getFrame(targetTime) {
  const pkt = this.packets.get(this.nextSeq);
  if (pkt && pkt.timestamp <= targetTime) return { status: 'ok', frame: pkt };
  // nextSeq 缺失：先等，等够 maxWaitMs 才判丢失并跳过
  if (targetTime - this.gapSince >= this.maxWaitMs) {
    this.nextSeq++;
    return { status: 'missing' };
  }
  return { status: 'waiting' };
}
```

要点：`nextSeq` 永远只跟踪"下一个该播谁"；发现空洞用 `gapSince` 记下时刻，等够 `maxWaitMs` 才放弃——**不等会误判丢包，死等会把卡顿放大**。

### ④ 固定深度 vs 自适应深度

| 策略 | 做法 | 问题 |
| --- | --- | --- |
| 固定深度 | 播放点始终比最新包慢 N ms（如 120ms） | 网络变好时白等，变差时断粮 |
| 自适应深度 | `depth = clamp(base + k·J, min, max)` 尾随抖动 | 实现复杂，依赖准确的 J 估计 |

典型参数：`base` 20~50ms（解码渲染保底）、`k` 3~5、`min` 40~60ms、`max` 400~600ms。WebRTC 的 NetEq（音频）与视频 JitterBuffer 都是自适应思路——模拟器里 `suggestDepthMs()` 就是这个公式的最简版。

## 坑点清单（FAQ）

- **Q：音频能直接复用视频的 Jitter Buffer 逻辑吗？** 不能。音频帧小且独立解码（20ms Opus 一包一帧），丢了用 PLC 插值糊过去，NetEq 甚至做加速/减速播放来消化积压；视频一帧可能分多包（FU-A）还有帧间依赖。两者底层结构相似，**上层策略完全不同**。
- **Q：帧未齐就强行解码播放会怎样？** 视频帧缺包硬解 = 花屏，而且 P 帧坏了会传染后续所有依赖它的帧。**宁可丢整帧等下一个关键帧，也不要播半成品**。
- **Q：NACK 重传应该等多久？** 看播放时点：如果重传回来也赶不上播放 deadline，等它就是纯浪费——还堵住后面的帧。工程上给 `maxWaitMs`（如 100ms）封顶，到点判丢跳过。
- **Q：seq 是 16 位会回绕怎么办？** 用模 2^16 差值比较先后（如 `(a - b + 65536) % 65536 < 32768`），不能直接 `a < b`。本模拟器为简化未处理，详见 [advanced.md](../guide/14-handwritten-jitterbuffer/advanced.md)。

## 自测 3 题（含答案）

1. 包 A：timestamp=1000ms、arrival=1050ms；包 B：timestamp=1020ms、arrival=1095ms。求瞬时抖动 D，并用 RFC 3550 公式更新 J（假设旧 J=10ms）。
2. 直播场景把 Jitter Buffer 深度从 120ms 加到 400ms，卡顿率下降，但观众反馈"主播回复弹幕慢半拍"，为什么？应该怎么调？
3. `maxWaitMs` 设置过小（比如 20ms）会有什么后果？设置过大呢？

<details>
<summary>答案</summary>

1. `transit(A) = 1050-1000 = 50ms`，`transit(B) = 1095-1020 = 75ms`，`D = 75-50 = +25ms`（抖动变大）。`J = 10 + (|25| - 10) / 16 ≈ 10.9ms`。
2. 缓冲深度直接加在端到端延迟上：400ms 深度意味着主播说完话 400ms+ 观众才听到，弹幕互动自然"慢半拍"。**卡顿率与延迟不可兼得**——连麦互动场景应压低 max（如 200ms），并配合 GCC / Simulcast 从源头减少丢包乱序；纯观看场景才放大 depth 保流畅。
3. 过小：大量只是"迟到"的乱序包被误判丢失，白白丢帧，出现本可避免的破损；过大：每次真丢包都要死等很久才跳过，停顿被拉长，等到的包也已错过播放时点——越等越卡。
</details>
