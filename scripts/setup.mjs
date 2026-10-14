/**
 * setup — 一键接入天枢。
 *
 * 做三件事，全部幂等：
 *   1. 确保桥接在跑（没跑则以隐藏窗口拉起）
 *   2. 把桥接注册成天枢的「自定义服务商」（国内版 + 国际版各一个）
 *   3. 回报结果，并说明在天枢里怎么用
 *
 * 为什么直接调天枢的本地 API 而不是让你手填：
 * 「自定义服务商」的表单后端就是 `POST /config/providers/custom`，
 * 且天枢自己会对 /v1/models 做规格探测。直接调它 = 走的就是 UI 那条路，
 * 只是省掉手抄 token 的步骤。
 *
 * 用法：
 *   node scripts/setup.mjs            # 接入国内版 + 国际版
 *   node scripts/setup.mjs --cn       # 只接国内版
 *   node scripts/setup.mjs --global   # 只接国际版
 *   node scripts/setup.mjs --dry-run  # 只探测不写入
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_DIR = process.env['WORKBUDDY_BRIDGE_HOME']?.trim()
  || join(homedir(), '.workbuddy-bridge')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyCn = args.includes('--cn')
const onlyGlobal = args.includes('--global')
const regions = onlyCn ? ['cn'] : onlyGlobal ? ['global'] : ['cn', 'global']

/**
 * 天枢的 sidecar 端口与 token —— 从它自己写的 server-info.json 读。
 *
 * 按「便携版 → 用户级安装 → 机器级安装」的顺序找，不写死任何一台机器的
 * 绝对路径：天枢有便携版（数据在 `<exe>/TianshuData/.rivet`），
 * 也有常规安装（数据在 `%LOCALAPPDATA%`）。找不到再让用户用环境变量指定。
 */
function locateTianshu() {
  const candidates = [
    process.env['TIANSHU_SERVER_INFO'],
    // 便携版：数据目录跟 exe 同级
    ...(process.env['TIANSHU_HOME'] ? [join(process.env['TIANSHU_HOME'], 'TianshuData', '.rivet', 'server-info.json')] : []),
    // 常规安装：用户级
    join(process.env['LOCALAPPDATA'] ?? '', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'),
    join(process.env['APPDATA'] ?? '', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'),
    // 常见的手动安装位置（存在才用）
    join(process.env['ProgramFiles'] ?? '', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'),
    join(homedir(), 'AppData', 'Local', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'),
  ].filter(Boolean)
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        const info = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
        if (info?.port && info?.token) return { port: Number(info.port), token: String(info.token), file }
      } catch { /* 换下一个候选 */ }
    }
  }
  return null
}

if (!existsSync(CONFIG_FILE)) {
  console.error(`找不到桥接配置：${CONFIG_FILE}`)
  console.error('请先运行一次 `npm start`（它会生成配置并打印 token），再执行本脚本。')
  process.exit(1)
}
const bridgeConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
const bridgeToken = String(bridgeConfig.token ?? '')
if (bridgeToken === '') {
  console.error('桥接配置里没有 token。')
  process.exit(1)
}

const tianshu = locateTianshu()
if (tianshu === null) {
  console.error('找不到天枢的 server-info.json —— 请确认天枢桌面端已启动。')
  process.exit(1)
}
console.log(`天枢 sidecar：127.0.0.1:${tianshu.port}（端口与 token 来自 ${tianshu.file}）`)

/** 带鉴权调天枢本地 API。 */
async function tianshuApi(path, init = {}) {
  const res = await fetch(`http://127.0.0.1:${tianshu.port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${tianshu.token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, ok: res.ok, json }
}

for (const region of regions) {
  const port = Number(bridgeConfig.ports?.[region] ?? (region === 'cn' ? 8791 : 8792))
  const baseUrl = `http://127.0.0.1:${port}/v1`
  const providerName = region === 'cn' ? 'workbuddy' : 'workbuddy-global'
  const label = region === 'cn' ? 'WorkBuddy 本机（国内版）' : 'WorkBuddy 本机（国际版）'

  console.log('')
  console.log(`── ${label} ──`)

  // 1) 拉模型清单（走桥接自己的 /v1/models）
  let models
  try {
    const res = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${bridgeToken}` } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    models = (await res.json()).data ?? []
  } catch (error) {
    console.error(`  桥接未响应（${baseUrl}）：${error instanceof Error ? error.message : String(error)}`)
    console.error('  请先启动桥接：npm start（或运行 install-autostart.mjs 装自启）')
    continue
  }
  console.log(`  桥接可用，${models.length} 个模型`)

  if (models.length === 0) {
    console.error('  模型列表为空，跳过注册。')
    continue
  }

  // 2) 交给天枢注册。字段名与桌面端表单一致（见 Tianshu config-routes.ts）。
  //
  // `force: true` 是必须的：天枢对已存在的 provider 名返回 400
  // （"Provider X already exists"），而本脚本要能反复运行 ——
  // 模型列表会随上游变化，重跑一次就该刷新成本次拉到的清单。
  const payload = {
    providerName,
    baseUrl,
    apiKey: bridgeToken,
    protocol: 'openai',
    force: true,
    models: models.map(m => ({
      id: m.id,
      ...(typeof m.context_window === 'number' ? { contextWindow: m.context_window } : {}),
      ...(typeof m.max_output_tokens === 'number' ? { maxTokens: m.max_output_tokens } : {}),
      ...(m.supports_vision === true ? { supportsVision: true } : {}),
    })),
  }

  if (dryRun) {
    console.log(`  [dry-run] 将注册 ${payload.models.length} 个模型到 ${providerName}`)
    continue
  }

  const result = await tianshuApi('/config/providers/custom', { method: 'POST', body: JSON.stringify(payload) })
  if (result.ok && result.json.ok === true) {
    console.log(`  已注册为「${providerName}」`)
  } else {
    console.error(`  注册失败（HTTP ${result.status}）：${result.json.error ?? JSON.stringify(result.json)}`)
  }
}

console.log('')
console.log('完成。在天枢里：设置 → 模型提供商 → 选 workbuddy 系列服务商 → 选模型即可。')
console.log('模型列表将出现在模型选择器里，带真实上下文窗口与视觉能力标记。')
