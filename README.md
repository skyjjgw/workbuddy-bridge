# workbuddy-bridge

把 **WorkBuddy**（腾讯 CodeBuddy / WorkBuddy AI）账号与模型接进
**天枢（Tianshu）** 的「自定义服务商」。2.0 起提供独立桌面控制台，
可以直接登录账号、查看积分与模型倍率、检测链路并一键接入天枢。

```
天枢 ──(OpenAI /v1)──▶ 本桥接 ──(WorkBuddy /v2)──▶ copilot.tencent.com / workbuddy.ai
```

不需要另外买 API Key，用的是你 WorkBuddy 账号自己的额度。

---

## 给使用者（只想用，不想看代码）

1. 装好并启动**天枢**
2. 下载 `WorkBuddy-Bridge-<版本>-portable.exe`
3. 双击运行；已有 WorkBuddy 登录会自动识别，没有账号时可在软件内网页登录
4. 点击“接入天枢”

之后打开天枢 → **设置 → 模型提供商** → 选 `workbuddy`（国内版）或
`workbuddy-global`（国际版）。

> 天枢自带 Node 运行时（`node-runtime\win-x64\tianshu-runtime.exe`），
> 所以**不需要另外安装 Node**。脚本会自己找。

旧版脚本 ZIP 仍可用，但新的桌面版是推荐入口。

桌面控制台会显示：

- 国内版与国际版账号、剩余积分
- 上游真实模型目录、上下文规格、视觉能力与积分倍率
- 桥接端口、天枢联通检测结果
- 真实模型实测（执行前会明确提示该操作消耗少量积分）
- 开机自启和系统托盘后台运行

## 给开发者

```bash
npm run build      # 打包核心 → lib/core.mjs（已入库，通常不用重跑）
npm start          # 启动桥接
npm run desktop    # 启动桌面控制台
npm run test       # OAuth 与桌面安全边界测试
npm run pack:desktop # 打 Windows 便携 EXE → dist-desktop/
node scripts/setup.mjs    # 一键注册进天枢
npm run doctor     # 自检：凭据 / 端口 / 产物自包含性
npm run pack       # 打发布包 → dist/*.zip
```

### 目录

| 路径 | 作用 |
| --- | --- |
| `src/server.mjs` | 桥接本体：固定端口 + 固定 token + 路由及桌面端受信接口 |
| `src/desktop/` | Electron 主进程、天枢接入、预加载与控制台界面 |
| `lib/core.mjs` | 打包好的核心（**已入库**，自包含，仅依赖 `node:*`） |
| `scripts/build.mjs` | 收拢上游源码并打包成 `lib/core.mjs` |
| `scripts/setup.mjs` | 调天枢本地 API 注册服务商 |
| `scripts/doctor.mjs` | 自检 |
| `scripts/pack.mjs` | 打发布包 |
| `vendor/` | 构建输入（不入库，构建时自动从上游同步） |

### 它复用了什么

核心逻辑（凭据发现与刷新、上游协议、SSE 直通、DSML 工具调用恢复、
账号故障转移）**不是重写的**，而是复用
[`dsh-connect-workbuddy`](https://github.com/dingminhua/dsh-connect-workbuddy)
（MIT，Copyright (c) 2026 LaoDing）的 8 个模块：

```
shim.ts  upstream.ts  auth.ts  catalog.ts
dsml-recovery.ts  host-peers.ts  at-rest.ts  status-paths.ts
```

**这个闭包只有 8 个文件、零第三方依赖** —— 打包后只剩 `node:*` 内置模块。
构建脚本每次都会验收这一点，一旦产物出现外部依赖就直接失败。这也是它能脱离
原宿主独立运行的原因。

本仓**不修改**上游源码，只做收拢 + 打包（见 `scripts/build.mjs`）。

与上游 DSH 插件的差别，仅在于「谁来当宿主」：

| | 上游（DSH 插件） | 本桥接 |
| --- | --- | --- |
| 形态 | DSH 插件 | 独立程序 |
| 端口 | 随机 | 固定（天枢要手填 baseUrl） |
| 鉴权 | 进程内随机 secret | 固定 token（天枢要手填 API Key） |
| 注册 | DSH 插件系统 | 天枢「自定义服务商」 |
| 界面 | 设置卡片（React） | 独立桌面控制台 |

上游协议行为逐字一致：强制 `stream:true`、`tool_choice` 压平、
CLI 形态请求头、DSML 工具调用恢复、账号池故障转移。

## 安全

- **只绑回环**（`127.0.0.1`），不对外网暴露。
- **必须有 token**：错误 token 一律 401。
- **不修改 WorkBuddy 登录文件**：发现或刷新的凭据保存在当前用户的
  `~/.dsh/workbuddy-vault/`，供网页登录账号和桥接续期使用；页面进程拿不到凭据。
- 配置在 `~/.workbuddy-bridge/config.json`（含 token）。
  用 `WORKBUDDY_BRIDGE_HOME` 可改到别处。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `WORKBUDDY_BRIDGE_HOME` | 配置目录（默认 `~/.workbuddy-bridge`） |
| `WORKBUDDY_BRIDGE_NODE` | 指定 Node 可执行文件 |
| `WORKBUDDY_PLUGIN_SRC` | 构建时：上游 `src/` 的位置 |
| `WORKBUDDY_PLUGIN_REPO` | 构建时：上游仓库地址 |
| `TIANSHU_SERVER_INFO` | 天枢 `server-info.json` 路径（自动找不到时用） |
| `TIANSHU_HOME` | 天枢安装目录（便携版） |
| `WORKBUDDY_AUTH_FILE` | 指定 WorkBuddy 凭据文件 |
| `WORKBUDDY_APP_EXECUTABLE` | 指定 WorkBuddy 可执行文件（凭据字段加密时需要） |

## 已知限制

- **只支持 Windows 的安装脚本**。核心 `lib/core.mjs` 是跨平台的，
  只差 `start.cmd` / 自启那层外壳。
- **必须使用自己的 WorkBuddy 账号**。可以复用桌面端登录，也可以从独立软件
  发起腾讯网页登录；不存在「装完就能用别人的额度」这回事。
- **凭据字段加密**：新版 WorkBuddy 桌面端可能把 `accessToken` 等字段用
  AES-256-GCM 封装，解密密钥来自 App 构建期内置。若 `doctor` 报
  「凭据字段已加密且拿不到密钥」，请设 `WORKBUDDY_APP_EXECUTABLE`。
  本机实测两个区域均为纯字符串形态，不需要这一步。
- **上游节流**：WorkBuddy 限流按**请求体积**触发，且 429 不返回
  `Retry-After`（重置时间写在响应体里）。桥接如实透传上游报错，
  不编造倒计时。

## 许可

MIT。核心模块来自 `dsh-connect-workbuddy`（MIT, Copyright (c) 2026 LaoDing），
详见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
