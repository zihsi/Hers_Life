// qa-auth.mjs —— Bilibili account / subtitle / social credential sharing regression tests.
import assert from 'node:assert/strict'
import { BilibiliOfficialProvider } from './lib/provider.js'
import { SocialClient } from './lib/social.js'

const COOKIE = 'SESSDATA=test-session; bili_jct=test-csrf; DedeUserID=12345; sid=test-sid'
const requests = []
const originalFetch = globalThis.fetch

function fakeResponse(url) {
  return {
    status: 200,
    headers: {
      getSetCookie: () => [],
      get: () => null,
    },
    async json() { return { code: 0, data: {} } },
    async text() { return JSON.stringify({ code: 0, data: {} }) },
    async arrayBuffer() { return new ArrayBuffer(0) },
  }
}

try {
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), headers: init.headers || {} })
    return fakeResponse(url)
  }

  let activeCookie = COOKIE
  const provider = new BilibiliOfficialProvider({
    getCookie: async () => activeCookie,
  })
  await provider.requestJson('/x/web-interface/nav', {})
  assert.equal(requests[0].headers.cookie, COOKIE, '字幕 Provider 应从统一凭证管理器取得 Cookie')

  const social = new SocialClient({
    getCredential: async () => ({
      cookie: activeCookie,
      csrf: 'test-csrf',
      uid: '12345',
    }),
  })
  await social.send({ path: '/x/web-interface/nav' })
  assert.equal(requests[1].headers.cookie, COOKIE, '社交 API 应使用与字幕相同的 Cookie')

  activeCookie = ''
  const loggedOut = await social.credential()
  assert.equal(loggedOut.cookie, '', '登出后不能回退到 SocialClient 旧 Cookie 缓存')

  const unavailable = new SocialClient({ getCredential: async () => { throw new Error('Credentials unavailable') } })
  unavailable.credentialCache = { cookie: COOKIE, csrf: 'test-csrf', uid: '12345' }
  const failedClosed = await unavailable.credential()
  assert.equal(failedClosed.cookie, '', '统一凭证服务不可用时不能退回旧 Cookie 缓存')

  await provider.fetchBytes('https://subtitle-cdn.example/image.png')
  assert.equal(requests[2].headers.cookie, undefined, 'Cookie 不得泄漏到字幕／图片 CDN 主机')

  console.log('PASS  subtitle Provider uses shared Cookie')
  console.log('PASS  social APIs use the same Cookie')
  console.log('PASS  logout clears the social client credential cache')
  console.log('PASS  credential service failures fail closed instead of using stale cookies')
  console.log('PASS  Cookie is not sent to external CDN hosts')
  console.log('★ qa-auth: 4/4')
} finally {
  globalThis.fetch = originalFetch
}
