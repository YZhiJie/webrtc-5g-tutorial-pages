# EP.00 浏览器安全模型那道坎

> 对应正文：[模块零 · 浏览器与网络基础自查](../guide/00-prerequisites/index.md)
> 动手演示：浏览器控制台自检（`isSecureContext` / `RTCPeerConnection` / `getUserMedia`）

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君双击 html 打开 WebRTC 示例，控制台报 `NotAllowedError: Permission denied`，getUserMedia 被拒。 |
| ② 揭秘 | 码叔摆出浏览器安全模型：WebRTC API 只在**安全上下文**（HTTPS / localhost / 127.0.0.1）下开放，`file://` 和公网 `http://` 都不行。 |
| ③ 实证 | 标签君跑 `npx serve .` 起本地服务，浏览器控制台验证三项：`isSecureContext: true`、`RTCPeerConnection` 存在、`getUserMedia` 可用。三道门一次过。 |
| ④ 结案 | 码叔总结学前必过的三道门槛：① HTTPS ② ES6 异步 ③ WebSocket 信令。坑点三条：部署忘 HTTPS / Chrome 升级报错 / 手机同网段连不上。 |

## 知识点拆解

### ① file:// 协议是 WebRTC 的死敌

浏览器把 `file://` 协议的 `origin` 视为 `null`，完全不符合同源策略，因此 WebRTC API 一律拒绝。这不是 bug，是 W3C 安全设计。

**解法只有一条**：让文件跑在 HTTP(S) 服务器上。开发期最方便的选择：

```bash
# 零配置方案（任选其一）
npx serve .                       # 推荐，轻量
npx http-server -p 3000           # 另一个轻量方案
# VSCode Live Server 插件一键启动
```

### ② 安全上下文的判定规则

浏览器通过 `window.isSecureContext` 暴露判定结果。判定逻辑：

| 来源 | 安全上下文？ |
| --- | --- |
| `https://*` | ✅ |
| `wss://*`（WebSocket Secure） | ✅ |
| `http://localhost:*` | ✅ |
| `http://127.0.0.1:*` | ✅ |
| `file://*` | ❌ |
| `http://<lan-ip>:*` | ❌ |

> 注意：`localhost` 是特例——浏览器默认认为本机可信。但同局域网另一台设备访问 `http://你的IP:端口` 仍视为非安全。

### ③ 本地开发服务器的三条命令

起好服务后，在新标签页验证：

```js
// 复制到浏览器控制台运行
[
  ['isSecureContext', window.isSecureContext],
  ['RTCPeerConnection', typeof RTCPeerConnection === 'function'],
  ['getUserMedia', !!navigator.mediaDevices?.getUserMedia],
]
.forEach(([k, v]) => console.log(v ? '✅' : '❌', k))
```

预期三项都是 ✅。

### ④ 生产环境部署必加 HTTPS

部署上线前，获取 HTTPS 证书的三种主流方式：

1. **Let's Encrypt（免费）**：`certbot --nginx --standalone`，90 天自动续期
2. **Cloudflare 一键 HTTPS**：DNS 托管到 Cloudflare 后自动提供
3. **自签名证书 + 手动信任**：仅内网测试用

## 坑点清单（FAQ）

- **Q：本地用 IP 访问（http://192.168.x.x:3000）为什么 getUserMedia 被拒？** 因为 Chrome 只把 `localhost` 和 `127.0.0.1` 视为安全上下文，局域网 IP 不行。解决：VSCode 的 Live Server 有"Remote Connect"功能，或用 ngrok / frp 做内网穿透得到临时 HTTPS。
- **Q：Safari 上 WebRTC 支持吗？** Safari 11+ 支持。但 Safari 的 PeerConnection 默认走 `RTP` 不是 `SRTP`，需要显式配置。iPhone Safari 需要手动"允许相机/麦克风"权限，Android Chrome 自动弹窗。
- **Q：必须用 WebSocket 做信令吗？** 不必须。HTTP 轮询 / SSE / Firebase Realtime DB / Pusher 等任何双向消息通道都行。WebSocket 只是最直接、延迟最低的方案。
- **Q：WebRTC API 在 Chrome 和 Edge 上有差异吗？** 几乎没有。两者都基于 Chromium 内核。Firefox 有几处行为差异（主要是 SDP 的 `plan-b` vs `unified-plan`，已在 2022 年统一到 `unified-plan`）。

## 自测（Quiz）

1. 在 Chrome 里双击打开 `demo.html` 运行 `getUserMedia`，控制台会报什么错？根本原因是什么？
2. 以下哪个 URL 下 `window.isSecureContext` 返回 `true`？`https://a.com` / `http://localhost:3000` / `http://192.168.1.5:3000` / `file:///demo.html`
3. 本地开发时，让同网段另一台手机访问你电脑上的 WebRTC Demo 并正常使用，需要做什么？

<details>
<summary>答案</summary>

1. `NotAllowedError` 或 `SecurityError`（取决于浏览器版本）。根本原因是 `file://` 协议下浏览器**不认为当前上下文安全**，WebRTC API 被屏蔽。
2. `https://a.com` 和 `http://localhost:3000` 都返回 `true`；`http://192.168.1.5` 和 `file://` 返回 `false`。
3. 需要让手机访问 HTTPS 地址——用内网穿透工具（ngrok / frp / cloudflared）将本地服务暴露为 `https://xxxx.ngrok-free.app`，或给局域网 IP 配置自签名 HTTPS 证书并在手机上信任根证书。最简单的方案是 `cloudflared tunnel`：`cloudflared tunnel --url http://localhost:3000`。
</details>
