// 端到端验证：模拟天枢发起的真实 chat/completions（stream:true，SSE）
const TOKEN = process.argv[2]
const PORT = process.argv[3] ?? '8791'
const MODEL = process.argv[4] ?? 'hy3'

const body = {
  model: MODEL,
  messages: [{ role: 'user', content: '用一句话回答：你是什么模型？' }],
  stream: true,
  max_tokens: 128,
}

const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
})

console.log('HTTP', res.status, '| content-type:', res.headers.get('content-type'))

let text = ''
let frames = 0
let sawDone = false
const decoder = new TextDecoder()
let buf = ''
for await (const chunk of res.body) {
  buf += decoder.decode(chunk, { stream: true })
  let idx
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') { sawDone = true; continue }
    frames++
    try {
      const j = JSON.parse(payload)
      const d = j.choices?.[0]?.delta
      if (typeof d?.content === 'string') text += d.content
    } catch { /* 非 JSON 行忽略 */ }
  }
}
console.log('SSE frames:', frames, '| [DONE]:', sawDone)
console.log('assistant text:', JSON.stringify(text.slice(0, 300)))
