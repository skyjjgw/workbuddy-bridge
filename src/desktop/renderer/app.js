const api = window.workbuddyBridge
const regionsEl = document.querySelector('#regions')
const statusEl = document.querySelector('#bridge-status')
const statusDot = document.querySelector('#status-dot')
const totalEl = document.querySelector('#model-total')
const toastEl = document.querySelector('#toast')
const autostartEl = document.querySelector('#autostart')
const previewMode = new URLSearchParams(location.search).has('preview')
let snapshot
let toastTimer

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

function toast(message, error = false) {
  clearTimeout(toastTimer)
  toastEl.textContent = message
  toastEl.className = `toast show${error ? ' error' : ''}`
  toastTimer = setTimeout(() => { toastEl.className = 'toast' }, 4200)
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return '未知上下文'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M 上下文`
  return `${Math.round(value / 1000)}K 上下文`
}

function accountHtml(region) {
  const selected = region.accounts.find(account => account.selected) ?? region.accounts[0]
  if (!selected) {
    return `<div class="account-box"><div class="account-meta"><strong>尚未登录</strong><span>可直接从本软件发起网页登录</span></div></div>`
  }
  const credit = selected.credits
  return `<div class="account-box">
    <div class="account-meta"><strong>${escapeHtml(selected.name)}</strong><span>${escapeHtml(selected.domain)} · ${selected.source === 'desktop' ? '桌面端' : '网页登录'}</span></div>
    <div class="credit"><strong>${credit ? formatNumber(credit.total) : '—'}</strong><span>${credit ? '剩余积分' : '积分暂不可用'}</span></div>
  </div>`
}

function modelsHtml(models) {
  if (models.length === 0) return '<p class="empty">登录并刷新后显示模型列表。</p>'
  return models.map(model => {
    const multiplier = typeof model.creditMultiplier === 'number'
      ? `<span class="multiplier${model.creditMultiplier === 0 ? ' free' : ''}">${model.creditMultiplier === 0 ? '免费' : `×${formatNumber(model.creditMultiplier)}`}</span>`
      : '<span class="multiplier">倍率未知</span>'
    return `<div class="model-row">
      <div class="model-name"><strong title="${escapeHtml(model.id)}">${escapeHtml(model.name || model.id)}</strong><span>${formatTokens(model.contextWindow)}${model.multimodal ? ' · 视觉' : ''}</span></div>
      ${multiplier}
      <button class="button ghost compact smoke" data-region="${escapeHtml(model.region)}" data-model="${escapeHtml(model.id)}">实测</button>
    </div>`
  }).join('')
}

function render(data) {
  snapshot = data
  const entries = [
    ['cn', 'CN', '国内版', 'copilot.tencent.com'],
    ['global', 'AI', '国际版', 'workbuddy.ai'],
  ]
  const total = entries.reduce((sum, [key]) => sum + (data.regions[key]?.models.length ?? 0), 0)
  totalEl.textContent = String(total)
  statusEl.textContent = data.ok ? '本地桥接正在运行' : '桥接启动异常'
  statusDot.classList.toggle('bad', !data.ok)
  regionsEl.innerHTML = entries.map(([key, icon, title, subtitle]) => {
    const region = data.regions[key]
    const models = region.models.map(model => ({ ...model, region: key }))
    return `<article class="region-card panel">
      <div class="region-head">
        <div class="region-title"><div class="region-icon">${icon}</div><div><h3>${title}</h3><p>${subtitle} · 127.0.0.1:${region.port}</p></div></div>
        <span class="chip${region.listening ? '' : ' bad'}">${region.listening ? '运行中' : '端口异常'}</span>
      </div>
      ${accountHtml(region)}
      <div class="model-head"><strong>模型与倍率</strong><span>${models.length} 个模型</span></div>
      <div class="model-list">${modelsHtml(models)}</div>
      <div class="region-actions">
        <button class="button ghost login" data-region="${key}">${region.accounts.length ? '添加账号' : '立即登录'}</button>
        <button class="button secondary compact region-refresh" data-region="${key}">刷新</button>
      </div>
    </article>`
  }).join('')
}

async function unwrap(promise) {
  const result = await promise
  if (!result.ok) throw new Error(result.error || '操作失败')
  return result.data
}

async function load(refresh = false) {
  try {
    const data = await unwrap(refresh ? api.refresh() : api.snapshot())
    render(data)
  } catch (error) {
    toast(error.message, true)
    statusEl.textContent = '无法读取桥接状态'
    statusDot.classList.add('bad')
  }
}

async function login(region) {
  try {
    const started = await unwrap(api.startLogin(region))
    if (started.error) throw new Error(started.error)
    toast('登录页已打开，请完成确认；软件会自动同步账号。')
    const deadline = Date.now() + started.expiresIn * 1000
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      const answer = await unwrap(api.pollLogin(region, started.loginId))
      if (!answer.done) continue
      if (answer.error) throw new Error(answer.error)
      toast(`登录成功：${answer.accountName}`)
      await load(true)
      return
    }
    throw new Error('登录已超时，请重新开始')
  } catch (error) {
    toast(`登录失败：${error.message}`, true)
  }
}

regionsEl.addEventListener('click', async event => {
  const target = event.target.closest('button')
  if (!target) return
  if (target.classList.contains('login')) {
    target.disabled = true
    await login(target.dataset.region)
    target.disabled = false
  } else if (target.classList.contains('region-refresh')) {
    target.disabled = true
    await load(true)
    target.disabled = false
  } else if (target.classList.contains('smoke')) {
    target.disabled = true
    try {
      const result = await unwrap(api.smokeTest(target.dataset.region, target.dataset.model))
      if (!result.cancelled) toast(result.ok ? `模型实测通过：${result.text}` : '模型返回了空结果', !result.ok)
    } catch (error) { toast(`模型实测失败：${error.message}`, true) }
    target.disabled = false
  }
})

document.querySelector('#refresh').addEventListener('click', () => load(true))
document.querySelector('#test-all').addEventListener('click', async event => {
  event.currentTarget.disabled = true
  try {
    const result = await unwrap(api.test())
    toast(result.ok ? '检测通过：桥接与天枢链路均正常' : '检测未全部通过，请确认天枢已经启动', !result.ok)
  } catch (error) { toast(error.message, true) }
  event.currentTarget.disabled = false
})
document.querySelector('#register').addEventListener('click', async event => {
  event.currentTarget.disabled = true
  try {
    const result = await unwrap(api.registerTianshu())
    toast(result.ok ? '已接入天枢：workbuddy 与 workbuddy-global' : '部分服务商注册失败', !result.ok)
  } catch (error) { toast(`接入失败：${error.message}`, true) }
  event.currentTarget.disabled = false
})
autostartEl.addEventListener('change', async () => {
  try { autostartEl.checked = await unwrap(api.setAutostart(autostartEl.checked)) }
  catch (error) { toast(error.message, true) }
})

if (previewMode) {
  render({
    ok: true,
    regions: {
      cn: {
        port: 8791,
        listening: true,
        accounts: [{ name: 'WorkBuddy 用户', domain: 'www.workbuddy.cn', source: 'desktop', selected: true, credits: { total: 2196.61 } }],
        models: [
          { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1_000_000, creditMultiplier: 0.79 },
          { id: 'hy4-preview', name: 'Hy4 Preview', contextWindow: 1_000_000, creditMultiplier: 0 },
          { id: 'kimi-k3', name: 'Kimi-K3', contextWindow: 1_000_000, creditMultiplier: 1.62 },
        ],
      },
      global: {
        port: 8792,
        listening: true,
        accounts: [{ name: 'WorkBuddy AI 用户', domain: 'www.workbuddy.ai', source: 'dsh', selected: true, credits: { total: 980 } }],
        models: [
          { id: 'gpt-6-astra', name: 'GPT-6-Astra', contextWindow: 1_000_000, creditMultiplier: 6.67, multimodal: true },
          { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', contextWindow: 1_000_000, creditMultiplier: 0.14 },
          { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1_000_000, creditMultiplier: 0 },
        ],
      },
    },
  })
  autostartEl.checked = true
} else {
  Promise.all([load(), unwrap(api.getAutostart()).then(value => { autostartEl.checked = value })])
}
