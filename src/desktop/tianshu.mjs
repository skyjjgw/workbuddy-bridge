import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function locateTianshu() {
  const portableCandidates = process.platform === 'win32'
    ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(drive =>
      join(`${drive}:\\`, 'tianshu', 'app', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'))
    : []
  const candidates = [
    process.env['TIANSHU_SERVER_INFO'],
    ...(process.env['TIANSHU_HOME']
      ? [join(process.env['TIANSHU_HOME'], 'TianshuData', '.rivet', 'server-info.json')]
      : []),
    join(process.env['LOCALAPPDATA'] ?? '', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'),
    join(process.env['APPDATA'] ?? '', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'),
    join(process.env['ProgramFiles'] ?? '', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'),
    join(homedir(), 'AppData', 'Local', 'Tianshu', 'TianshuData', '.rivet', 'server-info.json'),
    ...portableCandidates,
  ].filter(Boolean)
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      const info = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
      if (info?.port && info?.token) {
        return { port: Number(info.port), token: String(info.token), file }
      }
    } catch { /* 继续尝试下一个候选 */ }
  }
  return null
}

async function callTianshu(tianshu, path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${tianshu.port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${tianshu.token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 500) } }
  return { ok: response.ok, status: response.status, body }
}

function providerPayload(config, region) {
  const providerName = region === 'cn' ? 'workbuddy' : 'workbuddy-global'
  return {
    providerName,
    baseUrl: `http://${config.host}:${config.ports[region]}/v1`,
    apiKey: config.token,
    protocol: 'openai',
    force: true,
    models: config.models[region],
  }
}

export async function registerProviders(config) {
  const tianshu = locateTianshu()
  if (tianshu === null) throw new Error('没有找到正在运行的天枢，请先启动天枢桌面端')
  const regions = {}
  for (const region of ['cn', 'global']) {
    const payload = providerPayload(config, region)
    try {
      const result = await callTianshu(tianshu, '/config/providers/custom', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      regions[region] = result.ok && result.body?.ok === true
        ? { ok: true, provider: payload.providerName, models: payload.models.length }
        : { ok: false, error: result.body?.error ?? `HTTP ${result.status}` }
    } catch (error) {
      regions[region] = { ok: false, error: `无法连接天枢：${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { ok: Object.values(regions).every(result => result.ok), regions }
}

export async function testTianshu(config) {
  const tianshu = locateTianshu()
  if (tianshu === null) return { ok: false, error: '天枢未运行或未找到 server-info.json' }
  const regions = {}
  for (const region of ['cn', 'global']) {
    const payload = providerPayload(config, region)
    try {
      const result = await callTianshu(tianshu, '/config/providers/test-key', {
        method: 'POST',
        body: JSON.stringify({
          provider: `workbuddy-bridge-${region}`,
          apiKey: payload.apiKey,
          baseUrl: payload.baseUrl,
          protocol: 'openai',
        }),
      })
      regions[region] = result.ok && result.body?.ok === true
        ? { ok: true, models: result.body.models?.length ?? 0 }
        : { ok: false, error: result.body?.error ?? `HTTP ${result.status}` }
    } catch (error) {
      regions[region] = { ok: false, error: `无法连接天枢：${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { ok: Object.values(regions).every(result => result.ok), regions }
}
