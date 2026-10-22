# EP.07 两个标签页的握手日记

> 对应正文：[模块七 · 最小可用的 WebRTC 通话](../guide/07-basic-call/index.md)
> 动手演示：[Basic Peer Connection Demo](../../public/demos/basic-call/)

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君照着教程写 Demo，A 标签页开了摄像头、createOffer、setLocalDescription，通过 BroadcastChannel 发给 B 页。B 页收到、setRemoteDescription、createAnswer、发回去。结果 B 页黑屏——**忘记调用 addTrack 了**！SDP 里没有 media section，协商了个寂寞。 |
| ② 揭秘 | 码叔画出最小闭环 8 步：① 采集 getUserMedia → ② addTrack（**关键！**）→ ③ createOffer → ④ setLocalDescription → ⑤ 信令（BroadcastChannel / WebSocket）→ ⑥ setRemoteDescription → ⑦ createAnswer → ⑧ 对方 setRemoteDescription。 |
| ③ 实证 | 跑通后用 DevTools 验证：`iceConnectionState` 变成 `'connected'`，`pc.getSenders().length` 有 2（audio + video），`ontrack` 事件触发后 `video.srcObject = e.streams[0]` 画面出来。 |
| ④ 结案 | 像素酱提醒：BroadcastChannel 只是**本地实验道具**（同一浏览器同源页面之间通信）。跨设备、跨网络必须有**信令服务器**（WebSocket / Firebase Realtime DB / Pusher）。三条红线：HTTPS/Localhost、双方都 addTrack、BroadcastChannel ≠ 真 P2P。 |

## 知识点拆解

### ① 完整闭环代码（caller 侧）

```js
// ============ 公共：两边都要做的 ============
const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
const bc = new BroadcastChannel('webrtc-demo');

// ============ ① caller（A 标签页）============
async function startCall() {
  // 1. 采集本地媒体
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = stream; // 本地预览

  // 2. ⭐⭐⭐ 把轨道加进 PeerConnection（别忘这步！）
  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  // 3. 创建 Offer
  const offer = await pc.createOffer();

  // 4. 设置本地描述（必须在发 Offer 之前）
  await pc.setLocalDescription(offer);

  // 5. 通过信令发给 callee
  bc.postMessage({ type: 'offer', sdp: pc.localDescription });
}

// ============ ② callee（B 标签页）============
bc.onmessage = async (e) => {
  if (e.data.type === 'offer') {
    // 6. 设置远端描述（Offer）
    await pc.setRemoteDescription(e.data.sdp);

    // callee 也采集自己的摄像头（双向通话）
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    // 7. 创建 Answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // 8. 通过信令发回给 caller
    bc.postMessage({ type: 'answer', sdp: pc.localDescription });
  }

  if (e.data.type === 'answer') {
    // caller 收到 Answer，设置远端描述
    await pc.setRemoteDescription(e.data.sdp);
  }
};

// ============ 两边都要监听：远端轨道到达 ============
pc.ontrack = (event) => {
  console.log('🎬 收到远端轨道！', event.streams[0]);
  remoteVideo.srcObject = event.streams[0]; // ← 画面从这里出来
};
```

### ② 为什么 addTrack 这么重要

`addTrack` 告诉 PeerConnection："我**要发送**这些轨道"。它会在 SDP 里生成对应的 `m=` section：

```sdp
// 没 addTrack 的 Offer：
m=video 0 UDP/TLS/RTP/SAVPF   ← port=0 = 我不发视频
m=audio 0 UDP/TLS/RTP/SAVPF   ← port=0 = 我不发音频

// 有 addTrack 的 Offer：
m=video 9 UDP/TLS/RTP/SAVPF 96 97 100   ← port=9 = 我要发视频
a=sendrecv                               ← 我也想收
m=audio 11 UDP/TLS/RTP/SAVPF 111         ← port=11 = 我要发音频
```

**少了 addTrack，即使 ICE 连通了，也永远收不到对方的媒体**——因为双方约定的就是"我不发、我不收"。

### ③ BroadcastChannel 是什么

BroadcastChannel 是浏览器原生 API，让**同一源**的所有标签页/iframe/Worker 之间可以发消息：

```js
const bc = new BroadcastChannel('my-channel');
bc.postMessage({ hello: 'world' });
bc.onmessage = (e) => console.log(e.data); // 在同一 origin 的所有页面都能收到
```

但注意：

| 特性 | BroadcastChannel | WebSocket 信令服务器 |
| --- | --- | --- |
| 跨标签页 | ✅ | ✅ |
| 跨浏览器 | ❌ | ✅ |
| 跨设备 | ❌ | ✅ |
| 跨网络 | ❌ | ✅ |
| 需要后端 | ❌ | ✅ |

所以 **BroadcastChannel 只适合本地多标签页实验**。真上线必须搞信令服务器。

### ④ ICE 连接状态怎么监听

```js
pc.oniceconnectionstatechange = () => {
  switch (pc.iceConnectionState) {
    case 'new': console.log('🔄 ICE 初始化中'); break;
    case 'checking': console.log('🔍 ICE 候选配对中...'); break;
    case 'connected': console.log('✅ ICE 连通！可以传数据了'); break;
    case 'completed': console.log('✅ ICE 全部候选配对完成'); break;
    case 'failed': console.log('❌ ICE 穿透失败，需要 TURN 服务器'); break;
    case 'disconnected': console.log('⚠ 对端掉线'); break;
  }
};
```

`connected` → `completed` 之间会触发多次 `onicecandidate`（Trickle ICE），这期间 `oniceconnectionstatechange` 会从 `checking` → `connected` → `completed`。**建议在 `connected` 时就开始监听 `ontrack`，不用等 `completed`**。

## 坑点清单（FAQ）

- **Q：setLocalDescription 必须在 createAnswer 之前吗？** 不，但**发出去之前必须 set**。正确顺序：caller 先 createOffer → setLocalDescription → 发 offer；callee 先 setRemoteDescription(offer) → createAnswer → setLocalDescription(answer) → 发 answer。callee 不能在 setRemoteDescription 之前 createAnswer——浏览器需要知道 Offer 里有哪些媒体 section 才能构造正确的 Answer。
- **Q：onicecandidate 里 e.candidate 为 null 是什么意思？** 表示 ICE gathering 完成（所有候选都收集好了）。正常的 Trickle ICE 流程是：先触发几次有值的 candidate（本地网络很快），最后来一个 null。建议**有 candidate 就发，null 可以不发**（对方已经收到了所有有用的了）。
- **Q：两个标签页在不同浏览器（Chrome vs Firefox）BroadcastChannel 能互通吗？** **不能**。BroadcastChannel 只在同一浏览器同源标签页之间有效。跨浏览器你需要一个 WebSocket 信令服务器。
- **Q：为什么 peerConnection 的 localDescription 和 remoteDescription 属性读出来是 null？** 因为 setLocalDescription / setRemoteDescription 是异步的，你要 `await` 它们完成后再读。或者监听 `pc.onnegotiationneeded` 事件。

## 自测（Quiz）

1. 在 WebRTC 完整闭环中，`addTrack` 调用应该发生在哪个 API 之前？`createOffer` 之前？还是 `setLocalDescription` 之后？
2. 假设 A 标签页忘记调用 `addTrack`，B 标签页正确调用了。协商会失败吗？ICE 能连通吗？B 能看到 A 的画面吗？
3. BroadcastChannel 能用于两个不同设备之间的 WebRTC 信令吗？如果不能，推荐什么替代方案？

<details>
<summary>答案</summary>

1. **必须在 `createOffer` 之前**。`createOffer` 会根据当前已添加的轨道生成 SDP。如果你先 createOffer 再 addTrack，SDP 里没有 media section，协商出来的就是空的媒体协商。正确顺序：getUserMedia → **addTrack** → createOffer → setLocalDescription。

2. **协商会"成功"，但结果是双方都不收发媒体**。A 没 addTrack → Offer 里 video/audio section port=0；B 有 addTrack → Answer 里 video/audio 是 recvonly 或 sendrecv。但因为 Offer 里 port=0，B 的 Answer 也必须 port=0（SDP 规则：Answer 必须回应 Offer 的每个 media section，port 不能变零为非零）。ICE 能连通（因为 ICE 和媒体协商是两套独立流程），但双方都不会收到任何媒体轨道——B 永远等不到 `ontrack` 事件，画面就是黑屏。

3. **不能**。BroadcastChannel 只在**同一浏览器、同一源、同一机器**的标签页/iframe/Worker 间通信。跨设备信令需要一个**中心化信令服务器**。推荐方案：
   - 自建：Node.js + Socket.IO（最灵活）
   - 托管：Firebase Realtime DB / Pusher / PubNub（不用写后端）
   - 极简：`wt` + 公共中继 WebSocket 服务（仅本地测试）
</details>
