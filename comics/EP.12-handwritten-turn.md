# EP.12 对称 NAT 下的中继租约

> 对应正文：[模块十二 · 手写 TURN 中继](../guide/12-handwritten-turn/basics.md)
> 动手演示：[手写 mini TURN 服务器](../guide/12-handwritten-turn/practice.md)

## 剧情回顾

| 格 | 场景 |
| --- | --- |
| ① 困境 | 标签君的 WebRTC Demo 在 5G 网络下 `iceConnectionState` 一直 `failed`，换成 WiFi 就正常——对称 NAT 下 srflx 候选配对全部失败。码叔诊断：运营商对称 NAT 让 STUN 完全失效，必须走 TURN 中继。 |
| ② 揭秘 | 码叔画出 TURN 的 Allocate 两次握手：第一次裸请求被 401 Unauthorized 打回（携带 REALM），第二次带 MD5 长期凭证才能拿到 `XOR-RELAYED-ADDRESS`——服务器为你分配的公网中继端口，租约 600 秒。 |
| ③ 实证 | 标签君亲手跑通 mini TURN server，终端里完整看到 `401 → Allocate Success` 的日志流，relayed 地址 `203.0.113.10:50001` 分配成功，peer 的媒体包全部经 50001 端口转发到达对端。 |
| ④ 结案 | 码叔总结三条最佳实践 + 三条坑点：ChannelBind 必须在权限内、租约到期前必须 Refresh、长期凭证 MD5 计算顺序不能反。 |

## 知识点拆解

### ① 为什么对称 NAT 下 STUN 会失效

STUN 的工作原理是：客户端从同一个内网 IP:Port 向 STUN 服务器发包，NAT 上形成的映射（公网 IP:Port）被记录下来，再通过信令告诉对端"往这个映射地址打"。

但**对称 NAT 的映射是"按目的地"生成的**——同一个内网 IP:Port 访问不同的外网地址，NAT 会分配**不同的公网端口**。于是：

```
客户端 → STUN 服务器：  NAT 映射出 公网A:10001  ← 这个端口只对 STUN 服务器有效
客户端 → 对端 peer：    NAT 映射出 公网A:10002  ← 对端看到的完全是另一个端口
```

对端拿着 `公网A:10001` 来打，NAT 上根本没有这条映射 → 包被丢弃 → ICE 失败。

**中国移动 / 电信 / 联通的 4G/5G 蜂窝网络几乎都是对称 NAT**，所以手机场景的 WebRTC 必须备 TURN 兜底。

### ② TURN 的核心思路：不穿透，改中继

TURN（Traversal Using Relays around NAT，RFC 8656）放弃"穿透 NAT"的幻想，直接让一台**有公网 IP 的服务器**帮忙转发：

- 客户端主动向 TURN 服务器发 Allocate 请求（客户端 → 服务器是"内网主动出外网"，NAT 一定放行）；
- 服务器在 relay 端口池里为客户端**分配一个公网 IP:Port**（relayed address）；
- 对端把媒体包发到这个 relayed address；
- TURN 服务器把包通过已建立的通道转回客户端。

延迟比 P2P 高（多了一跳转发），但**连通率接近 100%**——这就是对称 NAT 场景的唯一解。

### ③ Allocate 两次握手与长期凭证

TURN 不允许匿名占用中继资源（那是带宽黑洞），所以第一次 Allocate 必然被拒绝：

```
客户端 ── Allocate(无凭证) ──────────────→ 服务器
客户端 ←── 401 Unauthorized + REALM + NONCE ── 服务器
客户端 ── Allocate(USERNAME + MESSAGE-INTEGRITY) → 服务器
客户端 ←── Allocate Success + XOR-RELAYED-ADDRESS ── 服务器
```

长期凭证的完整性校验值按 RFC 5389 计算：

```
key = MD5(username ":" realm ":" SASLprep(password))
MESSAGE-INTEGRITY = HMAC-SHA1(key, 报文)
```

**MD5 的拼接顺序必须是 `username:realm:password`**，顺序错一个字节就是 401。NONCE 是服务器下发的防重放随机串，客户端必须原样回传。

### ④ 租约（Lifetime）与后续操作

Allocate Success 返回的 `LIFETIME` 属性默认 **600 秒**——这是中继端口的租约：

- 到期不续约，服务器回收端口，转发立即停止；
- 客户端应在到期前发 **Refresh 请求**续租（建议 550s 前）；
- 续租期间才能做后续操作：
  - **CreatePermission**：告诉服务器"允许哪个对端 IP 给我发数据"（否则服务器丢弃对端来的包）；
  - **ChannelBind**：把对端的 IP:Port 绑定到一个 Channel 号（0x4000~0x7FFF），之后用 4 字节 ChannelData 头代替 20+ 字节的 STUN 头转发，省带宽；
  - **Send/Data 指示**：不走 Channel 时的普通转发方式。

**顺序铁律**：先 Allocate 拿到租约 → CreatePermission 开权限 → ChannelBind 建通道。权限有效期独立于租约（默认 300 秒），过期也要重开。

## 坑点清单（FAQ）

- **Q：ChannelBind 直接返回 403 是怎么回事？** 99% 是**没先 CreatePermission**。TURN 服务器默认拒绝任何对端 IP 的流量，必须先开权限再绑通道。另外检查绑定的 IP:Port 是否与权限里声明的完全一致（端口也要匹配）。
- **Q：通话跑到 10 分钟突然断流，但 ICE 状态还是 connected？** 典型的**租约到期没 Refresh**。600 秒租约一到，中继端口被服务器回收，但两端 ICE 状态不会立刻感知（要有包超时才会触发 disconnected）。必须在 550 秒前发 Refresh，并把定时器放在应用层而不是依赖浏览器内部行为。
- **Q：自己实现 TURN 客户端，MD5 凭证怎么算都是 401？** 依次排查：① 拼接顺序是否严格为 `username:realm:password`（冒号是 ASCII 0x3A，别用成全角）；② realm 是否用了 401 响应里服务器下发的那个，而不是自己猜的；③ NONCE 是否原样回传；④ MESSAGE-INTEGRITY 的 HMAC-SHA1 计算时，报文长度字段要先把 MESSAGE-INTEGRITY 属性本身的长度算进去（这是 RFC 5389 最容易踩的坑）。
- **Q：TURN over UDP 还是 TCP/TLS？** 优先 UDP（3478 端口）——媒体转发本身不依赖可靠传输，套 TCP 会有队头阻塞。只有在极端企业网封 UDP 时才回退 `turns:`（TLS over TCP 5349）。

## 自测 3 题（含答案）

1. 为什么对称 NAT 下 STUN 反射地址（srflx）无法用于 P2P 连通？用一句话说明根因。
2. TURN 的 Allocate 为什么要设计成"先 401 再成功"的两次握手，而不是一次带凭证直接分配？
3. 写出长期凭证机制中 MESSAGE-INTEGRITY 密钥的完整计算公式，并指出其中最容易写错的两处。

<details>
<summary>答案</summary>

1. 对称 NAT 的端口映射**按目的地生成**：客户端访问 STUN 服务器得到的公网端口，只对 STUN 服务器有效；对端 peer 拿这个端口来打时，NAT 上并不存在对应映射，包被直接丢弃，所以 srflx 候选必然连通失败。

2. 第一次 401 的作用有二：① **下发 REALM 和 NONCE**——REALM 告诉客户端该用哪个域的凭证计算摘要，NONCE 防重放攻击；② **避免匿名占用**——如果一次请求就分配中继端口，任何人都能无成本耗尽服务器带宽资源。先拒绝一次，让客户端用长期凭证自证身份后才分配资源。

3.
   ```
   key = MD5(username ":" realm ":" SASLprep(password))
   MESSAGE-INTEGRITY = HMAC-SHA1(key, STUN 报文)
   ```
   最容易写错的两处：① **拼接顺序**必须是 `username:realm:password`，写成 `username:password:realm` 或漏掉冒号都会得到错误的 key，表现为永远 401；② **HMAC 计算时的报文长度**——MESSAGE-INTEGRITY 属性本身（24 字节）必须计入 STUN 头部的 length 字段再算 HMAC，否则服务端校验不通过，这也是 RFC 5389 实现中最经典的 bug。
</details>
