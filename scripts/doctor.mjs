/**
 * doctor — 自检：桥接是否真的能用了。
 *
 * 逐项检查并给出可操作的结论，而不是只报一个 true/false：
 *   1. 核心产物是否自包含（不得有非 node: 依赖）
 *   2. 配置与 token 是否就绪
 *   3. 两个区域的凭据是否发现得到（WorkBuddy 桌面端登录态）
 *   4. 端口是否可监听
 *   5. 天枢的本地 API 是否可达（可达则顺带用它的探测链真测一次）
 */

import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_DIR = process.env['WORKBUDDY_BRIDGE_HOME']?.trim()
  || join(homedir(), '.workbuddy-bridge')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}`)
  if (detail) for (const line of String(detail).split('\n')) console.log(`         ${line}`)
}

// 1) 核心产物自包含
const coreFile = join(ROOT, 'lib', 'core.mjs')
if (!existsSync(coreFile)) {
  record('核心产物存在', false, '缺少 lib/core.mjs —— 请先运行 `npm run build`')
} else {
  const text = readFileSync(coreFile, 'utf8')
  const bare = [...text.matchAll(/^import\s[^\n]*from\s+"([^"]+)"/gm)]
    .map(m => m[1])
    .filter(s => !s.startsWith('node:'))
  record(
    '核心产物自包含（仅 node:* 依赖）',
    bare.length === 0,
    bare.length === 0 ? `${(text.length / 1024).toFixed(0)} KB` : `发现外部依赖：${[...new Set(bare)].join(', ')}`,
  )
}

// 2) 配置与 token
//
// 首次运行时配置还不存在，这是**正常状态**而非故障：server.mjs 会在第一次
// 启动时生成它。所以这里只提示、不计入失败 —— 否则 start.cmd 的
// `if errorlevel 1` 会在全新安装上把用户拦下来（实测踩到）。
let config = null
if (!existsSync(CONFIG_FILE)) {
  console.log('  INFO  配置文件尚未生成（首次启动桥接时会自动创建）')
  console.log(`         ${CONFIG_FILE}`)
} else {
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    const hasToken = typeof config.token === 'string' && config.token.trim() !== ''
    record('配置与 token', hasToken, hasToken ? CONFIG_FILE : '配置里缺少非空 token')
  } catch (error) {
    record('配置文件可解析', false, error instanceof Error ? error.message : String(error))
  }
}

// 3) 凭据发现（直接复用插件核心的扫描逻辑）
try {
  // Windows 上裸盘符路径不是合法 ESM URL，必须转成 file:// 形态。
  const { WorkBuddyCredentialStore } = await import(pathToFileURL(coreFile).href)
  for (const region of ['cn', 'global']) {
    try {
      const store = new WorkBuddyCredentialStore({ region })
      const accounts = await store.accounts()
      record(
        `${region} 区域登录态`,
        accounts.length > 0,
        accounts.length > 0
          ? `${accounts.length} 个账号：${accounts.map(a => a.id.slice(0, 12) + '…').join(', ')}`
          : '未发现该区域的 WorkBuddy 登录凭据 —— 请先登录 WorkBuddy 桌面端',
      )
    } catch (error) {
      record(`${region} 区域登录态`, false, error instanceof Error ? error.message : String(error))
    }
  }
} catch (error) {
  record('加载核心模块', false, error instanceof Error ? error.message : String(error))
}

// 4) 端口可用性
// 用 config?.ports 的默认值，而不是「没配置就跳过」——首次安装时恰恰
// 最需要知道端口通不通（被别的程序占了就该换）。
{
  for (const region of ['cn', 'global']) {
    const port = Number(config?.ports?.[region] ?? (region === 'cn' ? 8791 : 8792))
    // 探测端口是否空闲。用 once 而非 on：成功路径 close() 后若监听器仍在，
    // Windows 上会在句柄已关闭时再次回调，触发 libuv 断言崩溃。
    const free = await new Promise(resolve => {
      const probe = createServer()
      probe.once('error', () => resolve(false))
      probe.once('listening', () => { probe.close(() => resolve(true)) })
      probe.listen(port, '127.0.0.1')
    })
    record(
      `${region} 端口 ${port}`,
      true,
      free ? '当前空闲' : '已被占用 —— 若正是本桥接在跑则正常；否则请改 config.json 的 ports',
    )
  }
}

// 5) 天枢本地 API + 用它自己的探测链真测
const TIANSHU_PORT = Number(process.env['TIANSHU_PORT'] ?? 0)
const TIANSHU_TOKEN = process.env['TIANSHU_TOKEN'] ?? ''
if (TIANSHU_PORT > 0 && TIANSHU_TOKEN !== '') {
  for (const region of ['cn', 'global']) {
    const port = Number(config?.ports?.[region] ?? (region === 'cn' ? 8791 : 8792))
    const body = {
      provider: `wb-bridge-${region}`,
      apiKey: config?.token,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      protocol: 'openai',
    }
    try {
      const res = await fetch(`http://127.0.0.1:${TIANSHU_PORT}/config/providers/test-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TIANSHU_TOKEN}` },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      record(
        `天枢探测链真测（${region}）`,
        json.ok === true,
        json.ok === true
          ? `天枢认到 ${json.models?.length ?? 0} 个模型`
          : `失败：${json.error ?? res.status}`,
      )
    } catch (error) {
      record(`天枢探测链真测（${region}）`, false, error instanceof Error ? error.message : String(error))
    }
  }
} else {
  console.log('  SKIP  天枢探测链真测（未提供 TIANSHU_PORT / TIANSHU_TOKEN 环境变量）')
}

const failed = results.filter(r => !r.ok).length
console.log('')
console.log(failed === 0 ? '全部通过。' : `${failed} 项需要处理。`)

/**
 * 退出方式刻意不用 `process.exit()`。
 *
 * 第 5 步经 undici 打过天枢的本地 API，其连接池在进程退出瞬间仍持有
 * keep-alive 句柄；此时强杀会在 Windows 上触发 libuv 断言
 * （`!(handle->flags & UV_HANDLE_CLOSING)`，退出码 0xC0000409），
 * 把一个「全部通过」的自检变成崩溃退出。改为显式收池 + 置 exitCode，
 * 让事件循环自然排空。
 */
try {
  const { getGlobalDispatcher } = await import('node:undici').catch(() => ({}))
  if (typeof getGlobalDispatcher === 'function') await getGlobalDispatcher().close()
} catch { /* 收池失败不影响结论 */ }

process.exitCode = failed === 0 ? 0 : 1
