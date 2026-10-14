/**
 * 构建脚本：把桥接所需的插件核心模块打包成单个自包含 ESM 文件。
 *
 * 为什么需要构建：插件源码是 TypeScript，且用了 Node 的 strip-only 模式
 * 不支持的语法（构造函数参数属性）。构建产物 lib/core.mjs 只依赖 node:*
 * 内置模块 —— 已在打包后用 `grep '^import .* from "'` 验证过。
 *
 * 用 esbuild CLI（而非 JS API）：JS API 需要 spawn 子进程，在受限环境下
 * 会 EPERM；CLI 由 shell 直接执行，不受此限。
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 上游仓库。核心模块（WorkBuddy 接入逻辑）源自这里，MIT 授权，
 * 见 LICENSE 与 THIRD_PARTY_NOTICES.md。本仓**不修改**它的源码，
 * 只做收拢 + 打包（见下方 core.ts 的生成）。
 */
const UPSTREAM_REPO = process.env['WORKBUDDY_PLUGIN_REPO']
  ?? 'https://github.com/dingminhua/dsh-connect-workbuddy.git'

/** 插件核心模块的依赖闭包（从 shim.ts 出发静态解析得出，8 个文件）。 */
const NEEDED = [
  'shim.ts',
  'upstream.ts',
  'auth.ts',
  'catalog.ts',
  'oauth.ts',
  'dsml-recovery.ts',
  'host-peers.ts',
  'at-rest.ts',
  'status-paths.ts',
]

/**
 * 插件源码位置。
 *
 * 顺序：环境变量 → 仓库内已收拢的 vendor/ → 同级目录的检出 → 自动克隆上游。
 *
 * 最后那条是给「刚 clone 本仓的人」用的：vendor/ 不入库（它是构建输入），
 * 所以全新工作区里没有源码。此时自动从上游拉一份浅克隆 ——
 * 否则重建就得靠人工去 clone 一个仓库、还得摆对位置。
 */
function locatePluginSource() {
  const candidates = [
    process.env['WORKBUDDY_PLUGIN_SRC'],
    join(ROOT, 'vendor', 'dsh-connect-workbuddy'),
    join(ROOT, '..', 'wb-tmp', 'src'),
  ].filter(Boolean)
  for (const dir of candidates) {
    if (NEEDED.every(name => existsSync(join(dir, name)))) return dir
  }

  // 自动拉上游。浅克隆即可 —— 我们只要当前版本的源码。
  const upstreamDir = join(ROOT, '.upstream')
  const srcDir = join(upstreamDir, 'src')
  if (!existsSync(join(srcDir, 'shim.ts'))) {
    console.log('本地没有插件源码，正在从上游拉取（浅克隆）…')
    rmSync(upstreamDir, { recursive: true, force: true })
    try {
      execFileSync('git', [
        'clone', '--depth', '1',
        UPSTREAM_REPO, upstreamDir,
      ], { stdio: 'inherit' })
    } catch {
      throw new Error(
        `自动拉取上游失败。请手动克隆 ${UPSTREAM_REPO}，`
        + '并用 WORKBUDDY_PLUGIN_SRC 指向其 src/ 目录。',
      )
    }
  }
  if (existsSync(join(srcDir, 'shim.ts'))) return srcDir

  throw new Error(
    `找不到插件源码。请设置 WORKBUDDY_PLUGIN_SRC 指向 dsh-connect-workbuddy 的 src/ 目录，`
    + `或把源码放到 vendor/dsh-connect-workbuddy/。上游：${UPSTREAM_REPO}`,
  )
}
function locateEsbuild() {
  const candidates = [
    join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    join(ROOT, '..', 'Tianshu-harness', 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    join(ROOT, '..', 'Tianshu-harness', 'node_modules', '.bin', 'esbuild'),
    join(ROOT, 'node_modules', '.bin', 'esbuild'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  throw new Error('找不到 esbuild。请在 wb-bridge 下 `npm i -D esbuild`，或安装到天枢的 node_modules。')
}

const pluginSrc = locatePluginSource()
const esbuild = locateEsbuild()

// 把源码收进 vendor/，让本仓不依赖外部检出即可重建。
// 若来源本来就是 vendor/（重复构建），跳过复制 —— cpSync 拒绝 src == dest。
const vendorDir = join(ROOT, 'vendor', 'dsh-connect-workbuddy')
mkdirSync(vendorDir, { recursive: true })
if (resolve(pluginSrc) !== resolve(vendorDir)) {
  for (const name of NEEDED) {
    const from = join(pluginSrc, name)
    if (!existsSync(from)) throw new Error(`缺少核心模块：${from}`)
    cpSync(from, join(vendorDir, name))
  }
  console.log(`已收拢 ${NEEDED.length} 个核心模块 → vendor/dsh-connect-workbuddy/`)
} else {
  console.log('源码就在 vendor/ 内，跳过收拢步骤。')
}

// 生成 vendor 版的 core.ts（把相对路径指向 vendor）。
const coreTs = `/**
 * 桥接所需的核心导出。由 scripts/build.mjs 生成，请勿手改。
 *
 * 这些模块直接取自 dsh-connect-workbuddy（MIT），未经修改 ——
 * 依赖闭包内零第三方 specifier，故可脱离 DSH 宿主运行。
 */
export { createWorkBuddyShim } from './shim.ts'
export type { WorkBuddyShim } from './shim.ts'
export { WorkBuddyCredentialStore, workbuddyAccountId } from './auth.ts'
export { WorkBuddyUpstreamClient, regionOf } from './upstream.ts'
export type { WorkBuddyCredential, WorkBuddyRegion } from './upstream.ts'
export { WorkBuddyCatalog, fallbackModelsFor } from './catalog.ts'
export { oauthPoll, oauthStart, regionOfOAuthAccount } from './oauth.ts'
`
writeFileSync(join(vendorDir, 'core.ts'), coreTs, 'utf8')

const outDir = join(ROOT, 'lib')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const outFile = join(outDir, 'core.mjs')
execFileSync(esbuild, [
  join(vendorDir, 'core.ts'),
  '--bundle',
  '--platform=node',
  '--target=node22',
  '--format=esm',
  `--outfile=${outFile}`,
  '--log-level=warning',
], { stdio: 'inherit' })

// 验收：产物不得出现任何非 node: 的裸导入。
const bundled = readFileSync(outFile, 'utf8')
const bare = [...bundled.matchAll(/^import\s[^\n]*from\s+"([^"]+)"/gm)]
  .map(m => m[1])
  .filter(spec => !spec.startsWith('node:'))

if (bare.length > 0) {
  console.error('构建产物含有非内置依赖，无法脱离宿主运行：')
  for (const b of new Set(bare)) console.error('  ' + b)
  process.exit(1)
}

console.log(`构建完成 → lib/core.mjs（${(bundled.length / 1024).toFixed(0)} KB，仅依赖 node:* 内置模块）`)
