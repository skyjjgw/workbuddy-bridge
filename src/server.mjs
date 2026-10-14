/**
 * workbuddy-bridge — 把本机 WorkBuddy 桌面端已登录的模型，暴露成本地
 * OpenAI 兼容端点，供天枢（Tianshu）的「自定义服务商」直接接入。
 *
 * 架构：
 *   天枢 ──(OpenAI /v1)──▶ 本桥接 ──(WorkBuddy /v2)──▶ copilot.tencent.com / workbuddy.ai
 *
 * 复用 dsh-connect-workbuddy 的 shim / auth / upstream / catalog 四个核心模块
 * （见 src/core.ts，打包进 lib/core.mjs，零第三方依赖），不改动其源码。
 *
 * 与 DSH 版的关键差别，仅在于「谁来当宿主」：
 *   - 不注册 DSH provider / 不做设置卡片；
 *   - 监听固定端口（而非随机端口），因为天枢要手填 baseUrl；
 *   - bearer 用固定 token（而非进程内随机 secret），因为天枢要手填 API Key；
 *   - 天枢只用 OpenAI 的 /v1/models 与 /v1/chat/completions 两个面。
 */

import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  createWorkBuddyShim,
  WorkBuddyCatalog,
  WorkBuddyCredentialStore,
  WorkBuddyUpstreamClient,
  regionOf,
} from '../lib/core.mjs'

// ── 区域定义：国内版与国际版是两套并行的上游栈 ──────────────────
const REGIONS = ['cn', 'global']

/** 每个区域一个固定端口：天枢按「服务商」分别填写 baseUrl。 */
const DEFAULT_PORTS = { cn: 8791, global: 8792 }

/**
 * 配置目录。默认放用户主目录；`WORKBUDDY_BRIDGE_HOME` 可覆盖
 * （便携部署、多实例并存、或把配置放进工作区时用）。
 */
const CONFIG_DIR = process.env['WORKBUDDY_BRIDGE_HOME']?.trim()
  || join(homedir(), '.workbuddy-bridge')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

/**
 * 读取配置。首次运行时生成一份，含随机 bearer token —— 与 DSH 版
 * 「进程内随机 secret」同一安全立场：端口只绑回环，且必须有 token。
 *
 * 两条纪律，都是实测踩出来的：
 *
 * 1. **容忍 BOM**。记事本、PowerShell 的 `Set-Content -Encoding UTF8`、
 *    以及不少编辑器都会在 UTF-8 文件开头写 `\uFEFF`，而 `JSON.parse`
 *    见到它就抛。用户手改端口时几乎必定踩到，所以这里先剥掉再解析。
 *
 * 2. **解析失败绝不静默重建**。以前的行为是打一行日志然后覆盖成新配置 ——
 *    后果是用户的 token 被换掉、天枢里存的那个 API Key 当场失效，
 *    而桥接照常启动、看起来一切正常。配置解析不了是**要人修**的状态，
 *    不是可以自行"修复"的状态，所以直接 fail-closed 退出并保留原文件。
 */
function loadConfig() {
  if (existsSync(CONFIG_FILE)) {
    const raw = readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.error(`[bridge] 配置文件不是合法 JSON，已停止启动（原文件未改动）：${CONFIG_FILE}`)
      console.error(`[bridge] ${error instanceof Error ? error.message : String(error)}`)
      console.error('[bridge] 修好它，或删掉它让桥接重新生成一份（注意：重新生成会换掉 token，')
      console.error('[bridge] 天枢里存的那个 API Key 需要一起更新）。')
      process.exit(1)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.error(`[bridge] 配置文件顶层必须是对象：${CONFIG_FILE}`)
      process.exit(1)
    }
    return parsed
  }
  const fresh = {
    host: '127.0.0.1',
    ports: { ...DEFAULT_PORTS },
    token: randomBytes(24).toString('base64url'),
  }
  mkdirSync(dirname(CONFIG_FILE), { recursive: true })
  writeFileSync(CONFIG_FILE, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8')
  return fresh
}

const config = loadConfig()
const HOST = typeof config.host === 'string' && config.host.trim() !== '' ? config.host : '127.0.0.1'
const TOKEN = typeof config.token === 'string' && config.token.trim() !== '' ? config.token : undefined
const PORTS = { ...DEFAULT_PORTS, ...(config.ports ?? {}) }

if (TOKEN === undefined) {
  console.error('[bridge] 配置里缺少 token；请在 config.json 里设置一个非空 token。')
  process.exit(1)
}

const log = (...args) => console.error('[bridge]', ...args)

// ── 每个区域：一套 store / catalog / shim ────────────────────────
/**
 * 上游客户端在区域之间共享：它只是传输 + 解析，本身不持有凭据，
 * 凭据每次由调用方传入（见 upstream.ts 的 chatStream/fetchModels 签名）。
 */
const client = new WorkBuddyUpstreamClient(message => log('upstream:', message))

const stacks = {}

for (const region of REGIONS) {
  const store = new WorkBuddyCredentialStore({
    region,
    refresh: credential => client.refreshToken(credential),
  })
  const catalog = new WorkBuddyCatalog(region)

  // 先按该区域的静态 fallback 目录注册，保证上游不可达时端点也不为空
  // （与 DSH 版同一立场：provider 始终可用，目录随后被真实刷新替换）。
  const shim = createWorkBuddyShim({
    store,
    client,
    catalog,
    logger: {
      warn: (...a) => log('shim:warn', ...a),
      error: (...a) => log('shim:error', ...a),
    },
  })

  stacks[region] = { store, catalog, shim, models: [], account: null }
}

/**
 * 刷新一个区域的模型目录。
 *
 * 天枢的「从接口拉取模型列表」会打 GET /v1/models，所以这里必须在启动时
 * 以及被请求时保证目录是真实的。刷新失败不致命：保留 fallback 目录，
 * 并在日志里说明，用户仍能看到（可能过时的）模型名。
 */
async function refreshCatalog(region) {
  const stack = stacks[region]
  try {
    const credential = await stack.store.resolve()
    const models = await client.fetchModels(credential)
    stack.catalog.set(models)
    stack.models = models
    stack.account = { region, domain: credential.domain, id: credential.id ?? null }
    log(`${region}: 已刷新 ${models.length} 个模型（账号 ${credential.domain}）`)
    return { ok: true, count: models.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stack.account = { region, error: message }
    log(`${region}: 模型目录刷新失败，继续使用内置列表 — ${message}`)
    return { ok: false, error: message }
  }
}

// ── HTTP 层：固定端口 + 固定 bearer + 回环绑定 ────────────────────
/**
 * 天枢会带 `Authorization: Bearer <apiKey>` 访问 /v1/*。核心 shim 用的是
 * 进程内随机 secret，外部无法预知，因此这里在它前面放一层极薄的转发：
 * 校验我们自己的固定 token，然后把请求原样转给该区域的核心 shim。
 *
 * 这一层刻意保持「无状态、无解析」：不做请求体重写、不做 SSE 改写，
 * 只搬运字节，所以上游协议的行为与 DSH 版逐字一致。
 */
function proxyTo(region) {
  return async (req, res) => {
    const stack = stacks[region]

    // 鉴权：与核心 shim 同样的常量时间立场由它负责；这里只挡住明显错误的 token。
    const header = req.headers.authorization
    const presented = typeof header === 'string' && /^Bearer\s+(.+)$/i.test(header.trim())
      ? /^Bearer\s+(.+)$/i.exec(header.trim())[1]
      : undefined
    if (presented !== TOKEN) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: { message: 'invalid bridge token', type: 'unauthorized', code: 'unauthorized' },
      }))
      return
    }

    const target = `${stack.shim.baseUrl()}${req.url ?? '/'}`
    const headers = { ...req.headers }
    // 换成核心 shim 认得的 bearer；Host 也要改成回环，否则它的
    // hostIsLoopback 守卫会 403（这是它的设计，不是 bug）。
    headers['authorization'] = `Bearer ${stack.shim.token()}`
    headers['host'] = new URL(stack.shim.baseUrl()).host
    delete headers['origin']

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : req,
        duplex: 'half',
      })
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers))
      if (upstream.body === null) {
        res.end()
        return
      }
      // 逐块搬运，保持 SSE 的实时性（不要 buffer 整个流）。
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) {
          await new Promise(resolve => res.once('drain', resolve))
        }
      }
      res.end()
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          error: {
            message: `bridge upstream failed: ${error instanceof Error ? error.message : String(error)}`,
            type: 'server_error',
          },
        }))
      } else {
        res.end()
      }
    }
  }
}

/**
 * 天枢「从接口拉取模型列表」的应答。
 *
 * 为什么不直接转发核心 shim 的 /v1/models：那个端点只回裸 id
 * （`{id, object, created, owned_by}`），而天枢的探测会额外读取
 * `data[].context_window` 与 `data[].max_output_tokens`
 * （见 Tianshu-harness `src/api/provider-probe.ts` 的 `parseModelIds` 附近）。
 * 少了这两个字段，天枢会把所有模型按兜底值处理 —— 后果是**过早压缩上下文**，
 * 长会话被腰斩。所以这里用目录里已有的真实规格自行组装应答。
 *
 * 刻意**不**带 WorkBuddy 的积分倍率：天枢的模型 schema 没有承载它的字段
 * （只有按 token 计价的 `pricing`，语义不同，套上去会让成本核算显示假数字），
 * 塞进 description 又只是装饰。用不上就不做。
 */
function modelsPayload(region) {
  const models = stacks[region].catalog.current()
  return {
    object: 'list',
    data: models.map(model => ({
      id: model.id,
      object: 'model',
      created: 0,
      owned_by: 'workbuddy',
      // 天枢读取的两个键（snake_case，勿改成 camelCase）
      ...model.contextWindow > 0 ? { context_window: model.contextWindow } : {},
      ...model.maxTokens > 0 ? { max_output_tokens: model.maxTokens } : {},
      // 别名是天枢的展示层信息；优先用上游给的可读名。
      ...model.name && model.name !== model.id ? { name: model.name } : {},
      ...model.multimodal === true ? { supports_vision: true } : {},
    })),
  }
}

const servers = []

for (const region of REGIONS) {
  const port = Number(PORTS[region])
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    // /v1/models 由本层直接应答：需要补上核心 shim 不提供的规格字段。
    if (req.method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
      const header = req.headers.authorization
      const presented = typeof header === 'string' && /^Bearer\s+(.+)$/i.test(header.trim())
        ? /^Bearer\s+(.+)$/i.exec(header.trim())[1]
        : undefined
      if (presented !== TOKEN) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          error: { message: 'invalid bridge token', type: 'unauthorized', code: 'unauthorized' },
        }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(modelsPayload(region)))
      return
    }
    void proxyTo(region)(req, res)
  })
  server.on('error', error => {
    log(`${region}: 端口 ${port} 监听失败 — ${error.message}`)
  })
  server.listen(port, HOST, () => {
    log(`${region}: 已监听 http://${HOST}:${port}/v1  （baseUrl 填这个）`)
  })
  servers.push(server)
}

// 等两个核心 shim 起来后再刷新目录，否则 baseUrl() 会抛。
await Promise.all(REGIONS.map(region => stacks[region].shim.ready))

log(`bridge token: ${TOKEN}`)
log(`配置文件: ${CONFIG_FILE}`)
log('')
log('天枢「自定义服务商」填写：')
for (const region of REGIONS) {
  log(`  ${region === 'cn' ? '国内版' : '国际版'}  baseUrl = http://${HOST}:${PORTS[region]}/v1`)
}
log(`  API Key = ${TOKEN}`)

await Promise.all(REGIONS.map(refreshCatalog))

// 周期性刷新：上游的目录与凭据都会过期。
const REFRESH_MS = 30 * 60_000
setInterval(() => {
  for (const region of REGIONS) void refreshCatalog(region)
}, REFRESH_MS).unref()

// 优雅退出：让端口立刻释放，避免重启时 EADDRINUSE。
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`收到 ${signal}，正在退出…`)
    for (const server of servers) server.close()
    void Promise.all(REGIONS.map(region => stacks[region].shim.close())).finally(() => process.exit(0))
  })
}
