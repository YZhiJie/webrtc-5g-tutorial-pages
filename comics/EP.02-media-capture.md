# EP.02 getUserMedia 怎么把摄像头变成流

> 对应正文：[模块二 · 媒体采集与管线](../guide/02-media-capture/index.md)
> 动手演示：打开浏览器控制台执行 `await navigator.mediaDevices.getUserMedia({video:true})`，观察返回值结构

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君第一次调 getUserMedia，以为返回的是 &lt;video&gt; 元素，结果控制台里是个叫 MediaStream 的陌生对象，直接 appendChild 失败。 |
| ② 揭秘 | 码叔画出三层管线：getUserMedia() → MediaStream（一整条河）→ MediaStreamTrack（河道里的一条船，video 或 audio）→ video.srcObject = stream 自动渲染。 |
| ③ 实证 | 码叔演示 getDisplayMedia 屏幕共享，强调**必须在用户手势（click）回调里调用**，异步层出去就被浏览器静默拒。 |
| ④ 结案 | 媒体管线三板斧。坑点三条：track.stop() vs enabled 的区别、iOS 必须 playsinline、getDisplayMedia 不能在异步层调用。 |

## 知识点拆解

### ① MediaStream vs MediaStreamTrack

getUserMedia 返回的不是 &lt;video&gt;，也不是二进制数据——它返回一个 **MediaStream** 对象，里面包含若干条 MediaStreamTrack：

| 层级 | 含义 | 怎么访问 |
| --- | --- | --- |
| MediaStream | 一整条媒体管线的容器 | `stream.getVideoTracks()` / `stream.getAudioTracks()` |
| MediaStreamTrack | 单个视频轨或音频轨 | `track.kind`（`'video'`/`'audio'`）、`track.enabled`、`track.readyState` |

渲染方式只有一条：

```js
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
video.srcObject = stream   // 正确 ✅
// video.src = URL.createObjectURL(stream)  // 旧方案，已废弃 ❌
```

### ② 停止流：stop() vs enabled

```js
// A. 彻底释放硬件
track.stop()
// → 摄像头灯灭 → 硬件释放 → track.readyState === 'ended'
// → 整个 stream 空了，浏览器自动断开视频源

// B. 只是让画面变黑
track.enabled = false
// → 摄像头灯依然亮着 → 只是传黑屏帧 → 再次 enabled=true 立刻恢复
```

**场景选择**：美颜/滤镜应用中间暂停处理帧用 `enabled=false`；用户退出房间/不再需要摄像头时必须 `track.stop()`，否则浏览器会一直占着硬件资源。

### ③ getDisplayMedia 屏幕共享

```js
// 必须写在 click / pointerdown / touchend 等用户手势回调里
document.querySelector('#shareBtn').addEventListener('click', async () => {
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false   // 不要带系统音频，会产生回声
    })
    video.srcObject = display
    // 用户停止共享时 track 会自动触发 ended 事件
    display.getVideoTracks()[0].addEventListener('ended', () => {
      video.srcObject = null
    })
  } catch (e) {
    console.log('用户取消共享或非手势触发：', e.name)
  }
})
```

**严格限制**：Chrome / Safari 都要求 `getDisplayMedia` 必须在用户手势的**同步调用栈**里。外层套 `setTimeout` 或 `.then` 里再调都会被浏览器直接抛出 `NotAllowedError`。

### ④ iOS Safari 的 playsinline

```html
<!-- 必须加 playsinline，否则 iPhone 上 getUserMedia 成功后 -->
<!-- video 自动进入全屏，无法在页面内嵌渲染 -->
<video id="local" autoplay playsinline muted></video>
```

Android Chrome 默认已支持内嵌渲染，不需要 playsinline；但写上也无害，是跨平台保险项。

## 坑点清单（FAQ）

- **Q：getUserMedia 能拿到哪几路音视频？** 默认取"系统默认摄像头 + 默认麦克风"。用 `{ video: { deviceId: 'xxx' } }` 可以指定特定设备；Safari 15+ 支持多摄切换，需要用户显式授权 `devicechange` 事件。
- **Q：Safari 上 video 没有声音？** iOS 的 &lt;video&gt; 默认**静音**播放（自动播放策略），在用户点击前不会响。解决：加 `muted` 属性先让它自动播放，用户点"取消静音"时移除 muted。
- **Q：getDisplayMedia 能同时共享多个屏幕吗？** Chrome 可以（用户在弹窗里选"整个屏幕"），Safari 只允许共享当前标签页或窗口。macOS 还要先在"系统设置 → 隐私 → 屏幕录制"里给浏览器授权。
- **Q：多个 Tab 同时 getUserMedia 会怎样？** Chrome 会**复用同一个摄像头硬件**，给每个 stream 共享同一份 track（克隆机制）。Safari 可能让后一个请求排队，前一个释放后才给。

## 自测（Quiz）

1. getUserMedia 返回值赋给 &lt;video&gt; 的正确方式是？为什么不能直接 appendChild？
2. 写出 getDisplayMedia 能正常工作的完整 click 事件处理示例（包含 try/catch 和 track ended 清理）。
3. 以下哪个会被浏览器拒绝？a. setTimeout 里调 getDisplayMedia；b. click 回调里 await getDisplayMedia；c. Promise.then 里调 getDisplayMedia。

<details>
<summary>答案</summary>

1. `video.srcObject = stream`。getUserMedia 返回的是 MediaStream 对象（一个媒体管线容器），不是 HTMLVideoElement DOM 节点，所以不能 appendChild。旧方案 `video.src = URL.createObjectURL(stream)` 已被废弃。
2. 参考上方 ③ 小节的完整示例，关键点：在 click 同步回调内 await；audio 设 false；给 videoTrack 监听 'ended' 事件后清理 srcObject。
3. **a 和 c 都会被拒绝**，只有 b 可以。浏览器要求 getDisplayMedia 必须在**用户手势的同步调用栈**内被首次调用——setTimeout / fetch.then / Promise.then 都属于脱离了同步栈的异步层，会被静默拒绝并抛出 NotAllowedError。
</details>
