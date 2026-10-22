import{_ as a,o as n,c as t,a2 as p}from"./chunks/framework.B4hAkGey.js";const o=JSON.parse('{"title":"10.3 实战案例：服务端架构与性能监控","description":"","frontmatter":{},"headers":[],"relativePath":"guide/10-production/practice.md","filePath":"guide/10-production/practice.md","lastUpdated":1792683941000}'),i={name:"guide/10-production/practice.md"};function e(l,s,d,r,h,c){return n(),t("div",null,[...s[0]||(s[0]=[p(`<h1 id="_10-3-实战案例-服务端架构与性能监控" tabindex="-1">10.3 实战案例：服务端架构与性能监控 <a class="header-anchor" href="#_10-3-实战案例-服务端架构与性能监控" aria-label="Permalink to &quot;10.3 实战案例：服务端架构与性能监控&quot;">​</a></h1><blockquote><p>完整的生产级 WebRTC 直播系统架构图、监控面板设计、告警规则。</p></blockquote><hr><h2 id="_10-3-1-生产级架构图" tabindex="-1">10.3.1 生产级架构图 <a class="header-anchor" href="#_10-3-1-生产级架构图" aria-label="Permalink to &quot;10.3.1 生产级架构图&quot;">​</a></h2><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│  客户端（Web / iOS / Android / 小程序）                                  │</span></span>
<span class="line"><span>│  ┌─────────────────────────────────────────────────────────────────────┐ │</span></span>
<span class="line"><span>│  │ WebRTC SDK（采集 + PeerConnection + QoE 上报 + 弱网自适应）         │ │</span></span>
<span class="line"><span>│  └─────────────────────────────────────────────────────────────────────┘ │</span></span>
<span class="line"><span>└─────────────┬───────────────────────────────────────────────────────────┘</span></span>
<span class="line"><span>              │ HTTPS/WSS</span></span>
<span class="line"><span>┌─────────────┴───────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│  接入层（高可用负载均衡）                                                 │</span></span>
<span class="line"><span>│  ┌─────────────────────────────────────────────────────────────────────┐ │</span></span>
<span class="line"><span>│  │ Nginx / Cloudflare / ALB（TLS 终止 + WSS 转发 + IP 白名单）         │ │</span></span>
<span class="line"><span>│  └─────────────────────────────────────────────────────────────────────┘ │</span></span>
<span class="line"><span>└─────────────┬───────────────────────────────────────────────────────────┘</span></span>
<span class="line"><span>              │</span></span>
<span class="line"><span>┌─────────────┴───────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│  信令层                                                                   │</span></span>
<span class="line"><span>│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                │</span></span>
<span class="line"><span>│  │ 信令服务 A   │   │ 信令服务 B   │   │ 信令服务 C   │                │</span></span>
<span class="line"><span>│  │ Node.js + ws │   │ Node.js + ws │   │ Node.js + ws │                │</span></span>
<span class="line"><span>│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘                │</span></span>
<span class="line"><span>│         │                  │                  │                         │</span></span>
<span class="line"><span>│         └──────────┬───────┴──────────────────┘                        │</span></span>
<span class="line"><span>│                    ▼                                                    │</span></span>
<span class="line"><span>│         ┌──────────────────────┐                                        │</span></span>
<span class="line"><span>│         │ Redis 集群（Pub/Sub）│  ← 跨实例消息广播 + 房间状态           │</span></span>
<span class="line"><span>│         └──────────────────────┘                                        │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────────────────┘</span></span>
<span class="line"><span>              │</span></span>
<span class="line"><span>┌─────────────┴───────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│  媒体层（5G MEC 边缘 + 中心机房）                                         │</span></span>
<span class="line"><span>│                                                                          │</span></span>
<span class="line"><span>│  ┌─────────────────────────┐              ┌─────────────────────────┐   │</span></span>
<span class="line"><span>│  │ 5G MEC 边缘节点         │              │ 中心机房节点           │   │</span></span>
<span class="line"><span>│  │ ┌─────────────────────┐ │              │ ┌─────────────────────┐ │   │</span></span>
<span class="line"><span>│  │ │ Mediasoup SFU 集群  │ │              │ │ Mediasoup SFU 集群  │ │   │</span></span>
<span class="line"><span>│  │ │ (就近接入低延迟)    │ │              │ │ (兜底 + 跨区域路由)  │ │   │</span></span>
<span class="line"><span>│  │ └─────────────────────┘ │              │ └─────────────────────┘ │   │</span></span>
<span class="line"><span>│  │ ┌─────────────────────┐ │              │ ┌─────────────────────┐ │   │</span></span>
<span class="line"><span>│  │ │ Coturn TURN         │ │              │ │ Coturn TURN         │ │   │</span></span>
<span class="line"><span>│  │ │ (边缘中继)          │ │              │ │ (中心中继)          │ │   │</span></span>
<span class="line"><span>│  │ └─────────────────────┘ │              │ └─────────────────────┘ │   │</span></span>
<span class="line"><span>│  └─────────────────────────┘              └─────────────────────────┘   │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────────────────┘</span></span>
<span class="line"><span>              │</span></span>
<span class="line"><span>┌─────────────┴───────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│  分发层                                                                   │</span></span>
<span class="line"><span>│  ┌─────────────────────────────────────────────────────────────────────┐ │</span></span>
<span class="line"><span>│  │ ffmpeg 转码（WebRTC Producer → RTMP）→ CDN → HLS 拉流观众          │ │</span></span>
<span class="line"><span>│  └─────────────────────────────────────────────────────────────────────┘ │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────────────────┘</span></span>
<span class="line"><span>              │</span></span>
<span class="line"><span>┌─────────────┴───────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│  观测层（监控 + 日志 + 告警）                                             │</span></span>
<span class="line"><span>│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │</span></span>
<span class="line"><span>│  │Prometheus│──► Grafana │  │ ELK 栈    │  │ Sentry   │               │</span></span>
<span class="line"><span>│  │(指标采集)│  │(面板)    │  │(日志)     │  │(错误追踪)│               │</span></span>
<span class="line"><span>│  └──────────┘  └────┬─────┘  └──────────┘  └──────────┘               │</span></span>
<span class="line"><span>│                     │                                                    │</span></span>
<span class="line"><span>│                告警规则 ──► Lark / Slack / 电话                           │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────────────────┘</span></span></code></pre></div><hr><h2 id="_10-3-2-核心监控指标" tabindex="-1">10.3.2 核心监控指标 <a class="header-anchor" href="#_10-3-2-核心监控指标" aria-label="Permalink to &quot;10.3.2 核心监控指标&quot;">​</a></h2><h3 id="信令层" tabindex="-1">信令层 <a class="header-anchor" href="#信令层" aria-label="Permalink to &quot;信令层&quot;">​</a></h3><table tabindex="0"><thead><tr><th>指标</th><th>说明</th><th>告警阈值</th></tr></thead><tbody><tr><td>信令消息 QPS</td><td>Redis Pub/Sub 消息量</td><td>&gt; 10k/s 持续 5 分钟</td></tr><tr><td>房间创建成功率</td><td>创建房间成功 / 总请求</td><td>&lt; 99%</td></tr><tr><td>Join 超时率</td><td>Join 后 5 秒内没收到 room-members</td><td>&gt; 5%</td></tr><tr><td>信令延迟</td><td>join → room-members 时间</td><td>&gt; 100ms p95</td></tr></tbody></table><h3 id="sfu-层" tabindex="-1">SFU 层 <a class="header-anchor" href="#sfu-层" aria-label="Permalink to &quot;SFU 层&quot;">​</a></h3><table tabindex="0"><thead><tr><th>指标</th><th>说明</th><th>告警阈值</th></tr></thead><tbody><tr><td>每节点 Concurrent Peer</td><td>Mediasoup Worker 上的 Peer 数</td><td>&gt; 1000/Worker</td></tr><tr><td>Producer 数量</td><td>发布中的 Producer</td><td>—</td></tr><tr><td>Consumer 数量</td><td>订阅中的 Consumer</td><td>—</td></tr><tr><td>带宽利用率</td><td>SFU 出口带宽</td><td>&gt; 80%</td></tr><tr><td>转码延迟</td><td>ffmpeg 合流延迟</td><td>&gt; 2s</td></tr></tbody></table><h3 id="客户端-qoe-通过信令回传" tabindex="-1">客户端 QoE（通过信令回传） <a class="header-anchor" href="#客户端-qoe-通过信令回传" aria-label="Permalink to &quot;客户端 QoE（通过信令回传）&quot;">​</a></h3><table tabindex="0"><thead><tr><th>指标</th><th>说明</th><th>告警阈值</th></tr></thead><tbody><tr><td>WebRTC 端到端延迟</td><td>发送时间戳 → 接收时间戳</td><td>&gt; 500ms p95</td></tr><tr><td>接收丢包率</td><td>inbound-rtp.packetsLost</td><td>&gt; 10% p95</td></tr><tr><td>重连率</td><td>1 小时内重连次数</td><td>&gt; 2 次/用户</td></tr><tr><td>ICE 穿透成功率</td><td>成功建立连接 / 总尝试</td><td>&lt; 95%</td></tr><tr><td>HLS 降级率</td><td>降级 HLS 的用户占比</td><td>&gt; 20%</td></tr></tbody></table><h3 id="系统层" tabindex="-1">系统层 <a class="header-anchor" href="#系统层" aria-label="Permalink to &quot;系统层&quot;">​</a></h3><table tabindex="0"><thead><tr><th>指标</th><th>说明</th><th>告警阈值</th></tr></thead><tbody><tr><td>CPU 使用率</td><td>SFU / TURN 节点</td><td>&gt; 80%</td></tr><tr><td>内存使用率</td><td>所有节点</td><td>&gt; 85%</td></tr><tr><td>磁盘 IO</td><td>录制节点</td><td>&gt; 80%</td></tr><tr><td>网络丢包</td><td>节点间</td><td>&gt; 1%</td></tr></tbody></table><hr><h2 id="_10-3-3-grafana-监控面板设计" tabindex="-1">10.3.3 Grafana 监控面板设计 <a class="header-anchor" href="#_10-3-3-grafana-监控面板设计" aria-label="Permalink to &quot;10.3.3 Grafana 监控面板设计&quot;">​</a></h2><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>┌──────────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│  WebRTC 直播系统监控面板                                         │</span></span>
<span class="line"><span>├────────────────────┬────────────────────┬────────────────────────┤</span></span>
<span class="line"><span>│  实时在线           │  今日峰值           │  系统健康度            │</span></span>
<span class="line"><span>│  ┌──────────────┐  │  ┌──────────────┐  │  ┌──────────────────┐ │</span></span>
<span class="line"><span>│  │ 12,345 人    │  │  │ 15,678 人    │  │  │ ✅ 95% 正常       │ │</span></span>
<span class="line"><span>│  │ 其中互动 890  │  │  │              │  │  │ ⚠️ 边缘 SFU 1 高  │ │</span></span>
<span class="line"><span>│  └──────────────┘  │  └──────────────┘  │  └──────────────────┘ │</span></span>
<span class="line"><span>├────────────────────┴────────────────────┴────────────────────────┤</span></span>
<span class="line"><span>│  QoE 指标趋势（最近 1 小时）                                       │</span></span>
<span class="line"><span>│  ┌────────────────────────────────────────────────────────────┐  │</span></span>
<span class="line"><span>│  │  [延迟 ms]────[丢包率 %]────[ICE 成功率 %]────[重连率]     │  │</span></span>
<span class="line"><span>│  └────────────────────────────────────────────────────────────┘  │</span></span>
<span class="line"><span>├──────────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│  边缘节点健康                                                      │</span></span>
<span class="line"><span>│  ┌────────────────────────────────────────────────────────────┐  │</span></span>
<span class="line"><span>│  │ 节点  CPU  内存  带宽  在线Peer  Producer  Consumer  状态  │  │</span></span>
<span class="line"><span>│  │ 边缘-1  45%  52%  62%   3,200      890      9,500    ✅    │  │</span></span>
<span class="line"><span>│  │ 边缘-2  78%  65%  71%   2,800      720      8,200    ⚠️    │  │</span></span>
<span class="line"><span>│  │ 中心-1  30%  45%  40%   1,100      340      3,400    ✅    │  │</span></span>
<span class="line"><span>│  └────────────────────────────────────────────────────────────┘  │</span></span>
<span class="line"><span>├──────────────────────────────────────────────────────────────────┤</span></span>
<span class="line"><span>│  错误日志实时流（ELK）                                             │</span></span>
<span class="line"><span>└──────────────────────────────────────────────────────────────────┘</span></span></code></pre></div><hr><h2 id="_10-3-4-告警规则-prometheus-alertmanager" tabindex="-1">10.3.4 告警规则（Prometheus Alertmanager） <a class="header-anchor" href="#_10-3-4-告警规则-prometheus-alertmanager" aria-label="Permalink to &quot;10.3.4 告警规则（Prometheus Alertmanager）&quot;">​</a></h2><div class="language-yaml vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">yaml</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># ICE 穿透率过低</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">- </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">alert</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">LowICESuccessRate</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  expr</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">rate(ice_connection_success[5m]) / rate(ice_connection_attempt[5m]) &lt; 0.95</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  for</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">5m</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  labels</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    severity</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">warning</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  annotations</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    summary</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&quot;ICE 穿透率低于 95%: {{ $value | humanizePercentage }}&quot;</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    description</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">&quot;最近 5 分钟 ICE 成功/尝试: {{ $value }}&quot;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># TURN 带宽接近瓶颈</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">- </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">alert</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">TURNBandwidthHigh</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  expr</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">turn_outbound_bytes &gt; 85000000000</span><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">  # 85Gbps</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  for</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">3m</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  labels</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    severity</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">critical</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># SFU CPU 过载</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">- </span><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">alert</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">SFUHighCPU</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  expr</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">mediasoup_worker_cpu &gt; 80</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  for</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">5m</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">  labels</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">:</span></span>
<span class="line"><span style="--shiki-light:#22863A;--shiki-dark:#85E89D;">    severity</span><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">: </span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">warning</span></span></code></pre></div><hr><h2 id="_10-3-5-合规与安全清单" tabindex="-1">10.3.5 合规与安全清单 <a class="header-anchor" href="#_10-3-5-合规与安全清单" aria-label="Permalink to &quot;10.3.5 合规与安全清单&quot;">​</a></h2><table tabindex="0"><thead><tr><th>项</th><th>要求</th></tr></thead><tbody><tr><td><strong>HTTPS/WSS</strong></td><td>全站 HTTPS，信令 WSS</td></tr><tr><td><strong>DTLS + SRTP</strong></td><td>WebRTC 强制加密 ✅</td></tr><tr><td><strong>凭证管理</strong></td><td>TURN 用短期凭证（TURN REST API），不要硬编码密码</td></tr><tr><td><strong>用户隐私</strong></td><td>合规区域（GDPR / CCPA / 国内《个人信息保护法》）</td></tr><tr><td><strong>内容安全</strong></td><td>直播内容审核（AI 鉴黄 + 人工巡检）</td></tr><tr><td><strong>数据主权</strong></td><td>存储国内用户的视频数据在国内</td></tr><tr><td><strong>录制存储</strong></td><td>录制需用户授权，存储加密，定期清理</td></tr></tbody></table><hr><h2 id="🎉-恭喜-你已经完成了-webrtc-×-5g-实时互动直播的完整学习路径" tabindex="-1">🎉 恭喜！你已经完成了 WebRTC × 5G 实时互动直播的完整学习路径 <a class="header-anchor" href="#🎉-恭喜-你已经完成了-webrtc-×-5g-实时互动直播的完整学习路径" aria-label="Permalink to &quot;🎉 恭喜！你已经完成了 WebRTC × 5G 实时互动直播的完整学习路径&quot;">​</a></h2><table tabindex="0"><thead><tr><th>你现在应该能</th><th></th></tr></thead><tbody><tr><td>✅ 跑通一对一 WebRTC 音视频通话</td><td>模块 7</td></tr><tr><td>✅ 搭建 Coturn TURN 服务器</td><td>模块 4</td></tr><tr><td>✅ 搭建 Mediasoup SFU 多人直播</td><td>模块 7~8</td></tr><tr><td>✅ 理解 ICE / SDP / 编解码器协商</td><td>模块 3~5</td></tr><tr><td>✅ 做 5G MEC 边缘部署</td><td>模块 6</td></tr><tr><td>✅ 搭建完整监控 + 告警</td><td>模块 10</td></tr><tr><td>✅ 设计生产级弱网降级策略</td><td>模块 9~10</td></tr></tbody></table><hr><h2 id="下一章-→-精通之路" tabindex="-1">下一章 → 精通之路 <a class="header-anchor" href="#下一章-→-精通之路" aria-label="Permalink to &quot;下一章 → 精通之路&quot;">​</a></h2><p>会用 WebRTC ≠ 懂 WebRTC。想知道浏览器黑盒里每个字节怎么流动？从手写 STUN 开始，把整套协议栈亲手实现一遍：</p><p>→ <a href="./../11-handwritten-stun/basics">模块十一 · 手写 STUN 协议</a></p>`,31)])])}const E=a(i,[["render",e]]);export{o as __pageData,E as default};
