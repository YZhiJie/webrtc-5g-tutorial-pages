# EP.06 URLLC 真的能到 1ms 吗

> 对应正文：[模块六 · 5G 网络与 WebRTC 适配](../guide/06-5g-adaptation/index.md)
> 动手演示：Chrome DevTools getStats 面板实测 roundTripTime

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 像素酱拿着宣传资料问：电信说 5G URLLC 承诺端到端 1ms，我用 Chrome `getStats` 一测，`roundTripTime` 还是 132ms。说好的 1ms 呢？ |
| ② 揭秘 | 码叔画延迟预算拆解图：采集 10~30ms → 编码 5~20ms → 传输（4G:50~150ms / 5G:10~50ms）→ SFU 转发 10~30ms → 解码+渲染 20~50ms。**5G 说的 1ms = 空口时延**（基站到手机一跳），不是完整链路。 |
| ③ 实证 | 码叔对比两种架构：传统中心机房 SFU（北京用户也要连深圳，传输 30~120ms）vs 5G MEC 边缘 SFU（北京基站旁就有 SFU，传输 5~15ms）。端到端从 300ms 降到 150ms。 |
| ④ 结案 | 标签君总结：5G 真正能省的是传输阶段那 40~100ms，浏览器内部的编解码/JitterBuffer 环节省不了。坑点三条：① 1ms 是空口不是端到端 ② 5G IPv6-only ③ 网络切片发现。 |

## 知识点拆解

### ① 延迟预算拆解

WebRTC 端到端延迟的完整构成：

```
摄像头采集 → 编码 → RTP打包 → 传输 → （SFU转发） → 传输 → 解码 → 渲染
  10~30ms    5~20ms   1ms级    4G:50~150ms / 5G:10~50ms  10~30ms    20~50ms
```

| 阶段 | 4G LTE | 5G SA（理论） | 5G 实际省了多少 |
| --- | --- | --- | --- |
| 采集（摄像头缓冲） | 20ms | 20ms | 0 —— 浏览器控制不了 |
| 编码（硬编） | 10ms | 10ms | 0 —— GPU 硬编是瓶颈 |
| **传输（空口+核心网）** | **80~180ms** | **20~60ms** | **↓ 40~120ms** |
| SFU 转发 | 20ms | 20ms | 0 —— 取决于机房位置 |
| JitterBuffer + 解码 | 30~60ms | 30~60ms | 0 —— 浏览器自适应 |
| **合计** | **~200~350ms** | **~100~180ms** | **↓ 80~170ms** |

> **关键结论**：5G 传输阶段能省下来的 40~120ms 是实打实的，但端到端永远达不到 1ms。那是实验室空口单向时延，不包括任何浏览器处理。

### ② 怎么用 getStats 测自己的延迟

在 Chrome DevTools 控制台运行：

```js
// 假设 pc 是你的 RTCPeerConnection 实例
async function measure() {
  const stats = await pc.getStats();
  // 找到 outbound-rtp（发送端）
  stats.forEach(s => {
    if (s.type === 'outbound-rtp') {
      console.log('发送端：', s.mediaType, '编码', s.codecId, '丢包率', s.fractionLost);
    }
    if (s.type === 'remote-inbound-rtp') {
      console.log('对端 RTT：', s.roundTripTime, '秒', '(', (s.roundTripTime * 1000).toFixed(0), 'ms)');
    }
    if (s.type === 'transport') {
      console.log('ICE 候选：', s.localCandidateId, '→', s.remoteCandidateId);
    }
  });
}
measure();
```

在 Chrome `chrome://webrtc-internals/` 也能看到可视化的统计曲线。

### ③ MEC 边缘计算怎么配合 WebRTC

MEC（Multi-Access Edge Computing）就是把服务器部署到离用户最近的地方——比如基站旁边、城市边缘机房。

| 方案 | SFU 位置 | 北京用户的延迟 |
| --- | --- | --- |
| 传统中心 | 深圳机房 | 单向 120ms |
| 5G 边缘 MEC | 北京基站旁 | 单向 5ms |

WebRTC 服务的**信令服务器、SFU、录播服务**都适合部署在 MEC 边缘。核心网只保留必要的控制面。

### ④ 5G 网络切片（Network Slicing）

5G 相比 4G 多了一个杀手锏：**网络切片**。运营商可以给特定业务切出一个专用逻辑网络：

```
WebRTC 实时互动切片：
  ├── 专用空口资源（URLLC 调度）
  ├── 专用核心网路径（5GC UPF 下沉到边缘）
  └── 保证带宽 + 保证延迟（SLA 可查）
```

但注意：**浏览器目前还没有 API 直接申请切片**。需要通过运营商的 WebRTC 平台（如腾讯云 TRTC 的 5G 版、声网的 5G 套件）间接使用。W3C 正在讨论 WebTransport / Direct Sockets 与网络切片的结合。

## 坑点清单（FAQ）

- **Q：手机用 5G 连 Chrome 打开 WebRTC Demo，延迟一定比 Wi-Fi 低吗？** 不一定。如果 SFU 还在深圳机房，5G 省的那点传输被跨域回传吃掉了。真正受益需要 MEC 边缘 SFU 配合。
- **Q：5G 会影响 ICE 穿透吗？** 会。5G 核心网的 NAT 实现和 4G 不同，部分运营商 5G 采用 IPv6-only + NAT64 共存模式。建议同时部署 IPv6 的 STUN/TURN 服务器。
- **Q：WebRTC 能自动使用 5G 的切片吗？** 目前不行。网络切片是运营商网络层的能力，浏览器没法直接感知或请求。你需要和运营商签协议、在 5G 核心网侧配置切片策略，WebRTC 流量按 IP/端口/应用标识路由到指定切片。
- **Q：Chrome DevTools 里有 5G 相关的延迟指标吗？** 在 `chrome://webrtc-internals/` 可以看到 `transport-rtt`、`inbound-rtp.jitter`、`remote-inbound-rtp.roundTripTime`。但"空口时延"这种物理层指标拿不到。

## 自测（Quiz）

1. 运营商宣传的 5G URLLC "1ms 时延"和 WebRTC `getStats` 里看到的 `roundTripTime` 是什么关系？哪个更小？
2. 5G MEC 边缘 SFU 能让 WebRTC 端到端延迟从 200ms 降到多少？
3. 为什么说"浏览器内部的延迟 5G 救不了"？具体哪些阶段是浏览器/操作系统控制的？

<details>
<summary>答案</summary>

1. **完全不是同一个东西**。"1ms 时延"是空口单向时延（基站→手机一跳，实验室条件），`roundTripTime` 是 WebRTC 传输层的**往返时延**，包含完整的 RTP 传输 + 核心网 + 对端。前者 1ms，后者通常 50~300ms。1ms 是宣传话术的省略——"1ms 空口"被简化为"1ms 端到端"。
2. 在 5G + MEC 边缘 SFU 场景下，端到端延迟可以从 200~350ms 降到 **100~180ms**。省了约一半，主要来自传输阶段从 80~180ms 降到 20~60ms。但不可能到 50ms 以下——那是浏览器编解码 + JitterBuffer 的硬下限。
3. 浏览器/操作系统控制的阶段包括：**摄像头缓冲（10~30ms）**——摄像头硬件自带缓冲，浏览器没法关；**编码（5~20ms）**——硬编码是 GPU 瓶颈，软编是 CPU 瓶颈；**JitterBuffer（10~40ms）**——浏览器为了抗抖动自动加的缓存，延迟和抗抖动物理上 trade-off；**渲染（5~15ms）**——VSync 同步机制。这些都和网络无关，5G 再快也帮不上。
</details>
