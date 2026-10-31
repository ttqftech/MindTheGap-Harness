# tangent MCP — HTTP / HTTPS 说明

内置示例 MCP 服务器（求正切），零依赖、只用 Node 标准库。
**HTTP 与 HTTPS 同时监听**，两个端口各自独立，一个挂了不影响另一个。

| 传输 | 默认地址 | 环境变量 |
|---|---|---|
| HTTP（默认，本应用内置配置指向这里） | `http://127.0.0.1:3927/mcp` | `TANGENT_MCP_PORT` |
| HTTPS（自签证书） | `https://127.0.0.1:3928/mcp` | `TANGENT_MCP_TLS_PORT` |

其他开关：

| 环境变量 | 作用 |
|---|---|
| `TANGENT_MCP_HOST` | 监听地址，默认 `127.0.0.1`（只回环）。`::` = 双栈（同时收 IPv4/IPv6，公网 IPv6 直连用这个），`0.0.0.0` = 只听 IPv4 |
| `TANGENT_MCP_TOKEN` | 设了就对所有请求校验 `Authorization: Bearer <值>`（`OPTIONS` 预检放行）；留空 = 无鉴权 |
| `TANGENT_MCP_TLS=off` | 关掉 HTTPS，只留 HTTP |
| `TANGENT_MCP_TLS_CERT` | 证书路径，默认 `certs/server.crt` |
| `TANGENT_MCP_TLS_KEY` | 私钥路径，默认 `certs/server.key` |
| `TANGENT_MCP_LOG=1` | 每个请求打一行日志（`方法 路径 → 状态` + `accept` + `ua`），排查客户端问题用 |

规则是「有证书就起 HTTPS」：**证书不存在时只起 HTTP，并在 stderr 打一行提示**，不会自动生成文件、不会退出。
HTTPS 端口被占用或证书读不了，也只是降级成 HTTP 单跑。

## 协议层行为（给各种客户端留的路）

| 请求 | 行为 |
|---|---|
| `POST` | JSON-RPC（唯一的业务入口）。`initialize` 会**回带客户端要的 protocolVersion**（2024-11-05 / 2025-03-26 / 2025-06-18 都能接），避免版本不匹配被判握手失败 |
| `GET` + `Accept: text/event-stream` | 200 + 一条只做保活的事件流（符合 Streamable HTTP 的 GET 探测） |
| `GET`（普通） | 200 + 一页说明 HTML，页面上有按钮可在浏览器里直接试调 `tools/list` |
| `OPTIONS` | 204 + 全套 CORS 头（`Allow-Origin/Methods/Headers` + `Expose-Headers: Mcp-Session-Id`） |
| `DELETE` | 204（会话终止） |

⚠️ **本服务器没有任何鉴权**，永远不会回 `401` / `WWW-Authenticate`。
早期版本对 `GET` 回 `405`，某些客户端会把「探测不到预期响应」笼统显示成**「需要认证」** —— 现在这类探测都会拿到 200，如果界面还提示需要认证，那问题在客户端侧（见下）。

## 「显示需要认证」怎么定位

按顺序排除，一步就能定位：

1. **在 Tabbit 地址栏直接打开 `https://127.0.0.1:3928/mcp`**
   - 看到「tangent-mcp 在线」的说明页 → 证书已受信、服务可达、协议没问题 → 是客户端面板在要求 OAuth/令牌（跳第 3 条）。
   - 看到证书错误（`NET::ERR_CERT_AUTHORITY_INVALID`）→ 证书装错了存储，必须装在**「受信任的根证书颁发机构」**；装在「个人」无效。改完重启浏览器。
   - 连接被拒 / 打不开 → 进程没在跑，或端口不对。
2. 点页面上的**「在浏览器里试调 tools/list」**按钮，出 JSON 说明浏览器侧 `fetch` 完全可用。
3. 如果 1、2 都正常但面板仍要认证 → 那是该客户端把「远程 MCP」默认按 OAuth 处理（照 ChatGPT Connector 那套），它期待的是 `401 + WWW-Authenticate` 触发的 OAuth 流程。本服务器刻意不提供鉴权，这时要么在它那边找「无认证 / 本地 / Header 令牌」之类的开关，要么别用它接本机 MCP（换成 Cursor / Claude Code / 本应用这类支持裸 Streamable HTTP 的客户端）。

排查时把 `TANGENT_MCP_LOG=1` 打开跑一次，日志能直接看出客户端到底发了什么（有没有 `GET`、`Accept` 是什么、UA 是谁）：`tangent-mcp` 的输出里只多几行 stderr，不影响协议本身。

---

## HTTPS 需要手动做的两步

自签证书没有被任何系统信任，客户端默认会拒绝（`self-signed certificate`）。所以：

```
1. 生成证书   node create-cert.mjs
2. 信任证书   node create-cert.mjs --force --install      # 或按下面手工步骤
```

### 1. 生成证书

```bash
cd mcp-servers/tangent
node create-cert.mjs            # 已存在则拒绝覆盖
node create-cert.mjs --force    # 重新生成（旧证书若导入过系统，需手动删掉）
```

产出：

```
certs/server.crt   证书（SAN = localhost / 127.0.0.1 / ::1，397 天有效）
certs/server.key   私钥（明文 PEM，仅本机；certs/ 已 gitignore）
```

依赖 `openssl`（Git for Windows 自带，脚本会自动去 `C:\Program Files\Git\usr\bin` 等常见路径找；
macOS / Linux 一般自带）。找不到时脚本会直接打印等价的 openssl 命令，你自己跑完把两个文件放进 `certs/` 即可。

### 2. 信任证书（按客户端分别处理，两种信任是分开的）

**a) 浏览器 / curl / 系统级客户端 → 导入 Windows 根存储**

```powershell
# 当前用户，不需要管理员
certutil -addstore -user Root "I:\Code\electro-bun\mindTheGap-Harness\mcp-servers\tangent\certs\server.crt"
```

或图形界面：双击 `server.crt` → 安装证书 → 本地计算机/当前用户 → **将所有的证书都放入下列存储** →
**受信任的根证书颁发机构** → 完成。

验证：

```bash
curl -s -X POST https://127.0.0.1:3928/mcp -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

> 导入后如仍报错，`curl --ssl-no-revoke` 试试（Windows schannel 会去查自签证书的吊销状态，查不到可能报错）。

**b) 本应用里当 MCP 客户端用 → 要额外让 Node 信任它**

⚠️ 关键点：Node 的 `fetch`（undici）**不读 Windows 根存储**，只认内置的 Mozilla 根证书 + `NODE_EXTRA_CA_CERTS`。
所以想让本应用的后端通过 HTTPS 连上 tangent，仅导入系统根存储**不够**（如果运行时用的是 schannel 就走系统存储，那就够 —— 视版本而定，实测为准）。

做法是在启动服务/应用的环境里加上：

```powershell
$env:NODE_EXTRA_CA_CERTS = "I:\Code\electro-bun\mindTheGap-Harness\mcp-servers\tangent\certs\server.crt"
```

验证（Node 侧）：

```bash
NODE_EXTRA_CA_CERTS=<同上路径> node -e "fetch('https://localhost:3928/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})}).then(r=>r.json()).then(j=>console.log(j))"
```

要在应用里真的走 HTTPS，还要把 `settings.mcpServers` 里 tangent 的 `url` 从
`http://127.0.0.1:3927/mcp` 改成 `https://127.0.0.1:3928/mcp`（设置页「MCP 服务器」里改，或改 `~/.mindthegap-harness/settings.json`
后重启服务）。**内置默认值仍是 HTTP**，没特殊需要保持原样就好。

---

## 让外网 / 别的机器连上（公网 IPv6、域名、隧道）

默认只绑 `127.0.0.1` —— 外网连不上不是配置错，是**根本没收那个网卡的包**。要放开一共四件事：

**1. 改监听地址 + 加鉴权（两件必须一起做）**

```bash
TANGENT_MCP_HOST=::  TANGENT_MCP_TOKEN=<随便一长串>  node index.js
```

`::` 是双栈，IPv4 / IPv6 都能进。**一旦监听地址不是回环，就必须设 `TANGENT_MCP_TOKEN`**，否则等于把这个工具端点公开在互联网上（启动时也会打一行警告）。

> 由本应用托管的进程怎么设？设置页的 `launch` 只有 command / args，没有 env —— 直接改 `~/.mindthegap-harness/settings.json` 里该项的
> `"launch": { "command": "node", "args": ["…/index.js"], "env": { "TANGENT_MCP_HOST": "::", "TANGENT_MCP_TOKEN": "xxx" } }`
> （后端支持 `launch.env`，UI 没暴露）。改完重启应用或重新保存 MCP。

**2. 防火墙放行端口（管理员 PowerShell）**

```powershell
netsh advfirewall firewall add rule name="tangent-mcp 3928" dir=in action=allow protocol=TCP localport=3928
```

**3. 用域名访问时，域名必须进证书 SAN**

```bash
node create-cert.mjs --host ttqfmsi-1.ddns.ttqf.tech --force
certutil -addstore -user Root certs\server.crt   # 旧证书作废，必须重装
```

⚠️ 重新生成证书后**必须重启服务进程**（PEM 只在启动时读一次），否则还是拿旧证书握手。

**4. 公网别用自签证书 —— 第三方服务不认它**

自签证书只对「你能把 CA 装进它信任库」的客户端有用（自己的浏览器 / Node 的 `NODE_EXTRA_CA_CERTS`）。
**云端服务（比如浏览器厂商的 MCP 代理、ChatGPT/Cursor 的远程连接器）一律不认自签**，无论 SAN 写得多正确，它们都会报证书错误。
公网要让这类服务连上，只有两条：

- **隧道（最省事）**：`cloudflared tunnel --url http://127.0.0.1:3927`（隧道这端用明文 HTTP，Cloudflare 边缘给一张真正受信任的证书，还不用开防火墙）
- **真证书**：域名解析到本机，用 Caddy / Let's Encrypt 申请（TLS-ALPN 需要 443、HTTP-01 需要 80），再反代到 `127.0.0.1:3928`

## 手工自测

```bash
node index.js
# 另开一个终端

# HTTP
curl -s -X POST http://127.0.0.1:3927/mcp -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# HTTPS（还没信任证书时用 -k 跳过校验，只看连通性）
curl -sk -X POST https://127.0.0.1:3928/mcp -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tangent","arguments":{"angle":45,"unit":"deg"}}}'

# HTTPS（信任后，不带 -k）
curl -s --cacert certs/server.crt -X POST https://localhost:3928/mcp -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":3,"method":"ping"}'
```

启动日志正常时是两行：

```
[tangent-mcp] 已启动，端口 3927
[tangent-mcp] HTTPS 已启动，端口 3928
```

## 注意

- 自签证书只适合本机调试；`certs/` 里的私钥不要提交、不要复制到别人机器上复用（各自生成各的）。
- 换机器/换项目目录后 `NODE_EXTRA_CA_CERTS` 的路径要跟着改。
- 改了 `index.js` 之后，应用内由后端托管拉起的 tangent 进程还是旧代码 —— 需要在设置页把 MCP 重新保存一次（触发 `syncAll` 重启），或重启应用。
- ⚠️ **证书装在「个人」存储里是无效的**，服务器证书必须装在「**受信任的根证书颁发机构**」。
- ⚠️ **`--force` 重新生成证书后必须重启服务进程**：进程只在启动时读一次 `server.crt`，不重启就还是拿旧证书握手，而系统里信任的是新证书 —— 表现就是「明明装了证书，浏览器仍报证书错误 / 客户端提示需要认证」。
  核对两边是不是同一张：`openssl x509 -in certs/server.crt -noout -fingerprint -sha1` 与 `certutil -user -store Root` 里那条的指纹比对。
