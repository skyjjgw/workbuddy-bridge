import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  oauthPoll,
  oauthStart,
  regionOfOAuthAccount,
} from '../lib/core.mjs'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('OAuth 登录流程能从 state 轮询到可保存凭据', async () => {
  const started = await oauthStart('cn', {
    fetchImpl: async url => {
      assert.match(String(url), /\/v2\/plugin\/auth\/state/)
      return jsonResponse({ code: 0, data: { state: 'state-1', authUrl: 'https://example.test/login' } })
    },
  })
  assert.equal('error' in started, false)
  const answer = await oauthPoll(started.loginId, 'cn', {
    fetchImpl: async url => {
      if (String(url).includes('/auth/token')) {
        return jsonResponse({
          code: 0,
          data: {
            accessToken: 'access-for-test',
            refreshToken: 'refresh-for-test',
            expiresIn: 3600,
            domain: 'codebuddy.cn',
          },
        })
      }
      return jsonResponse({ code: 0, data: { uid: 'uid-for-test', nickname: '测试账号' } })
    },
  })
  assert.equal(answer.done, true)
  assert.equal('account' in answer, true)
  assert.equal(answer.account.nickname, '测试账号')
  assert.equal(regionOfOAuthAccount(answer.account), 'cn')
})

test('渲染页面启用 CSP 且不启用远程脚本', async () => {
  const html = await readFile(new URL('../src/desktop/renderer/index.html', import.meta.url), 'utf8')
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /script-src 'self'/)
  assert.doesNotMatch(html, /https?:\/\/[^"']+\.js/)
})

test('preload 只暴露窄 IPC 接口', async () => {
  const preload = await readFile(new URL('../src/desktop/preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /contextBridge\.exposeInMainWorld/)
  assert.doesNotMatch(preload, /nodeIntegration\s*:\s*true/)
})
