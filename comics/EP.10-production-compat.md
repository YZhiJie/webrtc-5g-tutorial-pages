# EP.10 兼容性矩阵那一张大表

> 对应正文：[模块十 · 生产环境落地与兼容性](../guide/10-production/index.md)
> 动手演示：Can I Use WebRTC API 检测 · 浏览器能力探针

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君直播产品上线，iOS Safari 用户反馈"屏幕共享按钮灰了点不动"，微信内置浏览器里 `navigator.mediaDevices` 直接 `undefined`——写了 WebRTC 代码等于没写。老板："为什么我 iPhone 用不了？" |
| ② 揭秘 | 码叔摆出兼容性矩阵：Chrome/Edge 完美 ✅、Safari Mac 有限 ⚠（屏幕共享只能共享窗口）、iOS Safari 根本不支持屏幕共享 ❌、**微信浏览器直接屏蔽所有 WebRTC API** ❌。每个平台都有自己的规矩。 |
| ③ 实证 | 像素酱问"不支持的用户怎么办"，码叔展示客户端降级策略：`if (RTCPeerConnection && navigator.mediaDevices)` → 走 WebRTC 互动，else → 走 HLS 纯观看兜底。同时还要做 QoE 监控面板实时上报。 |
| ④ 结案 | 码叔三条坑点：Safari 不支持 VP8/VP9 硬编（SFU 要转码）、iOS 切后台会杀 PeerConnection（回前台要重协商）、中国合规要做隐私弹窗引导。 |

## 知识点拆解

### ① WebRTC 兼容性矩阵（2025 年版）

| 浏览器 | getUserMedia | 屏幕共享 | PeerConnection | 备注 |
| --- | --- | --- | --- | --- |
| Chrome / Edge (桌面) | ✅ 完整 | ✅ 完整 | ✅ 完整 | 主力平台 |
| Safari (macOS 14+) | ✅ 完整 | ⚠ 仅限窗口 | ✅ 可用 | 屏幕共享不能选单个 tab |
| iOS Safari (17+) | ✅ 可用 | ❌ 无 | ⚠ 有限 | **无屏幕共享**，编码只有 H264 |
| Android Chrome | ✅ 完整 | ⚠ 部分 | ✅ 完整 | Android 14+ 屏幕共享不稳定 |
| 微信浏览器 | ❌ API 屏蔽 | ❌ 无 | ❌ 不支持 | **完全封杀 WebRTC** |
| QQ 浏览器 | ⚠ 部分 | ❌ 无 | ❌ 不支持 | 只支持基础 getUserMedia |
| Firefox | ✅ 完整 | ✅ 完整 | ✅ 完整 | SDP 默认 plan-b（Chrome 已 unified-plan） |

> 实时兼容性数据查：[caniuse.com/webrtc](https://caniuse.com/webrtc) · [webrtc.org/web-apis](https://webrtc.org/web-apis/)

### ② 能力检测代码

不要用 `if (webrtcSupported)` 这种静态判断，**运行时探针最准**：

```typescript
// 生产级 WebRTC 能力检测
export function detectWebRTCCapabilities() {
  const result = {
    supported: false,
    getUserMedia: false,
    getDisplayMedia: false,
    peerConnection: false,
    screenShareIOS: false,
    codecs: { video: [], audio: [] as string[] } as { video: string[]; audio: string[] },
    isSafari: /Safari/.test(navigator.userAgent) && /Apple Computer/.test(navigator.vendor),
    isWeChat: /MicroMessenger/.test(navigator.userAgent),
    isIOS: /iPhone|iPad|iPod/.test(navigator.userAgent),
  };

  // 微信直接 return false（完全屏蔽）
  if (result.isWeChat) return result;

  try {
    result.getUserMedia = !!navigator.mediaDevices?.getUserMedia;
    result.getDisplayMedia = !!navigator.mediaDevices?.getDisplayMedia;
    result.peerConnection = !!window.RTCPeerConnection;
  } catch { /* IE 11 这种老浏览器 */ }

  // iOS 上 getDisplayMedia 存在但调用会失败，标记
  if (result.isIOS && result.getDisplayMedia) {
    // iOS Safari 17.2+ 才支持屏幕共享，iOS 16 及之前 getDisplayMedia() 会抛 NotSupportedError
    result.screenShareIOS = false;
  }

  // 探测编解码器
  if (result.peerConnection && window.RTCRtpSender?.getCapabilities) {
    const caps = RTCRtpSender.getCapabilities('video');
    result.codecs.video = caps?.codecs.map(c => c.mimeType) || [];
  }

  result.supported = result.peerConnection && result.getUserMedia;
  return result;
}
```

### ③ Safari 编码限制 → SFU 转码成本

Safari 的 WebRTC 实现是**单独开发的**（不是 Chromium 内核），不支持 VP8/VP9 硬件编码：

```
主播（Chrome）推 VP9 流到 SFU：
  ├─ Chrome 观众 → 直接转发 VP9（零转码成本）
  └─ Safari 观众 → 必须转成 H264（SFU 需要 CPU 转码）
```

**解法**：
1. 主播端同时推 VP9 + H264（用 simulcast 的不同编码）—— 但 Chrome 的 `addTransceiver` 不太好同时推两个编码器
2. SFU 端实时转码：`ffmpeg -i vp9_input -c:v libx264 -preset veryfast -b:v 1M output`
3. 部署 GPU 转码节点（NVIDIA NVENC），10 并发以内用 CPU 够，超过就要 GPU

### ④ iOS 后台挂起 → 重协商

iOS Safari 对后台有严格限制：

```
iOS Safari 切后台：
  t + 0s：页面进入 background
  t + 5s：RTCPeerConnection 被系统降频
  t + 10s：RTP 包停止发送/接收（但连接还在）
  t + 30s：连接超时 → ICE 候选失效
  t + 60s：回前台后需要重新 createOffer → setLocalDescription → setRemoteDescription
```

**解法**：
1. 前台恢复事件监听：`document.addEventListener('visibilitychange', onBackToForeground)`
2. 回到前台后立即重建 Offer/Answer 协商
3. 给用户提示"正在重连…"，不要静默重连让用户以为断了
4. 必要时用 `navigator.mediaDevices.getUserMedia` 重建 MediaStreamTrack

### ⑤ 微信 / QQ 浏览器策略

微信内置浏览器**完全屏蔽 WebRTC API**——这是微信的产品策略，无法绕过。解法只有三种：

| 方案 | 成本 | 用户体验 | 落地难度 |
| --- | --- | --- | --- |
| **引导跳转**（推荐） | 免费 | 中 | 低：显示大按钮"请在浏览器中打开" |
| 下载 App | 高 | 高（App 完整支持） | 中：需要开发 App |
| 微信 SDK（企业） | 付费 | 中 | 高：微信 RTC SDK 单独对接 |

**推荐实现**：页面加载时检测到微信 → 显示全屏引导遮罩 + "右上角三个点 → 在浏览器中打开" 的图示。

### ⑥ QoE 监控面板

生产环境必须有**实时质量监控**，发现问题第一时间定位：

```typescript
// 每 2 秒上报一次
setInterval(async () => {
  const stats = await pc.getStats();
  for (const report of stats.values()) {
    if (report.type === 'inbound-rtp') {
      monitor.report('inbound', {
        bytesReceived: report.bytesReceived,
        packetsLost: report.packetsLost,
        jitter: report.jitter,
        frameRate: report.framesPerSecond,
        qualityReason: report.qualityLimitationReason,
      });
    }
    if (report.type === 'remote-inbound-rtp') {
      monitor.report('roundtrip', {
        rtt: report.roundTripTime,
      });
    }
  }
}, 2000);
```

## 坑点清单（FAQ）

- **Q：Safari Mac 上屏幕共享选不了单个 tab 怎么办？** Safari 的 `getDisplayMedia` 目前只支持"共享整个屏幕"和"共享某个窗口"，不支持像 Chrome 那样选单个 browser tab。这是 Safari 的功能缺失，只能等苹果更新。可检测 `navigator.mediaDevices.getDisplayMedia` 是否存在后提示 Safari 用户。
- **Q：iOS Safari getUserMedia 不弹窗？** iOS Safari 要求**页面必须是 HTTPS**（安全上下文）+ **用户主动触发**（click/tap 事件里调用）。如果你在 `DOMContentLoaded` 里自动调用，iOS Safari 会静默失败。
- **Q：能绕过微信的 WebRTC 屏蔽吗？** 不能。微信在 JSCore 里把整个 `navigator.mediaDevices` API 移除了，不是权限问题是 API 不存在。只能引导用户用系统浏览器。
- **Q：production 环境 TURN 服务器放哪？** 全球多地域部署：中国大陆（阿里云/腾讯云）+ 香港/新加坡（东南亚）+ 美东/美西（北美）+ 欧洲。WebRTC 默认选延迟最低的 TURN 服务器（trickle ICE 会探测）。
- **Q：如何处理 Safari 和 Chrome 的 SDP 差异？** 2022 年之后所有浏览器统一到 `unified-plan`，但 Safari 偶尔还有差异。**最佳实践**：SFU 不要自己解析 SDP 字段来做判断，让 libwebrtc 帮你处理。

## 自测（Quiz）

1. 你的产品需要同时支持 Chrome/Edge 桌面用户和微信用户，技术策略怎么定？各走什么路径？
2. iOS Safari 用户切到后台接了个电话（约 2 分钟），回到直播间后画面卡住了没有声音。根因是什么？修复方案是什么？
3. 主播推 VP9 流到 SFU，100 个 Chrome 用户和 100 个 iOS Safari 用户同时在线。SFU 需要做什么处理？不做会有什么后果？

<details>
<summary>答案</summary>

1. **分两条路径**：Chrome/Edge/Android iOS Safari 支持 WebRTC 的用户 → 走完整 WebRTC + SFU 互动链路；**微信/QQ 浏览器**等屏蔽 WebRTC 的环境 → 引导用户跳转（右上角菜单 → 系统浏览器打开），或降级到 HLS 纯观看。技术实现上**运行时能力检测**（不要用 UA 判断），分 `detectWebRTCCapabilities()` 返回 `supported: true/false` 后走不同分支。
2. **根因**：iOS Safari 切后台超过 10s 后，WebRTC 的 RTP 流被系统暂停（省电策略）。2 分钟后回到前台，ICE 候选可能已经超时失效，PeerConnection 状态变成 `disconnected` 或 `failed`，但页面的 WebRTC 状态机没有做恢复处理。**修复方案**：① 监听 `visibilitychange` / `pageshow` 事件；② 检测回前台后检查 `pc.iceConnectionState`；③ 若已断开，重新生成 Offer → setLocalDescription → 通过信令发出去 → setRemoteDescription 做重协商；④ 给用户明确提示"正在重连…"。
3. SFU 需要**检测 Safari 用户并触发实时转码**：Chrome 用户直接转发原始 VP9 流（零 CPU 成本），Safari 用户必须把 VP9 转成 H264（因为 iOS Safari 不支持 VP8/VP9 硬解码）。不做转码的后果是 Safari 用户收不到任何视频帧——`inbound-rtp` stats 里 `framesDecoded = 0`，解码端直接丢弃不支持的编码格式。100 个 Safari 用户同时在线约需要 **2~4 核 CPU** 做实时转码，建议部署 GPU 转码节点（NVIDIA NVENC 单核可转 30+ 路 720p）。
</details>
