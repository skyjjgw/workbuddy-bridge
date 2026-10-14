// 工具调用验证：天枢作为编程 agent 必须能拿到结构化 tool_calls
const TOKEN = process.argv[2]
const PORT = process.argv[3] ?? '8791'
const MODEL = process.argv[4] ?? 'hy3'

const body = {
  model: MODEL,
  messages: [
    { role: 'system', content: 'You are a coding agent. Use the provided tools when needed.' },
    { role: 'user', content: '请读取文件 E:\\dshgf\\AGENTS.md 的前几行。' },
  ],
  tools: [{
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from disk',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute path' } },
        required: ['path'],
      },
    },
  }],
  stream: true,
  max_tokens: 256,
}

const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
})
console.log('HTTP', res.status)

let text = ''
const toolCalls = new Map()
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
    if (payload === '[DONE]') continue
    let j
    try { j = JSON.parse(payload) } catch { continue }
    const d = j.choices?.[0]?.delta
    if (!d) continue
    if (typeof d.content === 'string') text += d.content
    for (const tc of d.tool_calls ?? []) {
      const key = tc.index ?? 0
      const cur = toolCalls.get(key) ?? { id: '', name: '', args: '' }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.name = tc.function.name
      if (tc.function?.arguments) cur.args += tc.function.arguments
      toolCalls.set(key, cur)
    }
  }
}
console.log('text:', JSON.stringify(text.slice(0, 200)))
console.log('tool_calls:', toolCalls.size)
for (const [i, tc] of toolCalls) {
  console.log(`  [${i}] name=${tc.name} id=${tc.id ? 'yes' : 'no'}`)
  console.log(`      args=${tc.args}`)
}
