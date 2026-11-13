/**
 * dsh-ming-bilibili-account —— AI的 B 站账号工具（登录 / 查身份 / 改名）
 *
 * 为什么要单独写：现成的 dsh-plugin-bilibili 是匿名只读的，没有登录态，也做不了
 * 「我是谁」这类操作。这里只补这一块，不碰它的搜索/视频工具。
 *
 * 登录态怎么拿：扫码。生成 qrcode_key → 你在手机 B 站上确认 → 轮询换 cookie。
 * 密码和 cookie 都不经过聊天框。
 *
 * 登录态存哪：统一写入 DSH 本机 Credentials 安全凭证服务；账号工具、字幕 Provider、社交接口共用同一份 Cookie。
 * 旧版 credentialFile 只用于首次迁移，不再作为运行时的第二套凭证来源。
 */
export const name = 'ming-bilibili-account'

/**
 * tools 必须有；systemPrompt / credentials 都声明上（宿主里都有），
 * 但下面每一处调用都另做了一次「服务在不在」的判断，缺哪个都不至于整个插件挂掉。
 */
export const inject = ['tools', 'systemPrompt', 'credentials']

// —— B站取数：从 dsh-plugin-bilibili 搬过来的 provider 与五个工具（原样 vendored）——
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BilibiliOfficialProvider,
  BILIBILI_DEFAULT_BASE_URL,
  BILIBILI_DEFAULT_REQUEST_TIMEOUT_MS,
  BILIBILI_DEFAULT_SUBTITLE_LANGUAGE,
  BILIBILI_DEFAULT_USER_AGENT,
} from './lib/provider.js'
import {
  applyBilibiliSearchTool,
  applyBilibiliVideoTool,
  applyBilibiliSubtitleTool,
  applyBilibiliPlayUrlTool,
  BILIBILI_SUBTITLES_MAX_CHARS,
} from './lib/tools.js'
import { applyBilibiliFramesTool } from './lib/frames.js'
// 社交面（评论/发评/历史/关注/收藏夹/动态/私信会话）：实现都在 social.js，这里只接线。
import { applyBilibiliSocialTools } from './lib/social.js'

/** 凭证文件默认位置。配置项 credentialFile 覆盖它。 */
const DSH_HOME = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
const DEFAULT_CREDENTIAL_FILE = path.join(DSH_HOME, 'bili-duty', 'bili_credential.json')
const SEARCH_MAX_PAGE_SIZE = 20
const TOOL_TIMEOUT_MS = 30_000

/** Cookie 白名单字段；缺哪段跳过哪段。JSON 里的字段名按小写比对。 */
const CREDENTIAL_FIELDS = [
  ['SESSDATA', 'sessdata'],
  ['bili_jct', 'bili_jct'],
  ['buvid3', 'buvid3'],
  ['DedeUserID', 'dedeuserid'],
  ['DedeUserID__ckMd5', 'dedeuserid__ckmd5'],
  ['sid', 'sid'],
]

/** 把凭证 JSON 拼成 cookie header。**返回值只往下传，任何时候都不打印、不落进工具输出。** */
function buildCookieHeader(raw) {
  if (!raw || typeof raw !== 'object') return ''
  const lower = {}
  for (const key of Object.keys(raw)) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim().length > 0) lower[key.toLowerCase()] = value.trim()
  }
  const parts = []
  for (const [name, field] of CREDENTIAL_FIELDS) {
    const value = lower[field]
    if (value) parts.push(name + '=' + value)
  }
  return parts.join('; ')
}

/** 读一次凭证文件；读不到 / 解析不了就当匿名。catch 里不带文件内容。 */
async function readCredentialCookie(file) {
  if (typeof file !== 'string' || file.length === 0) return ''
  try {
    const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '').trim()
    try {
      return buildCookieHeader(JSON.parse(text)) || (text.includes('=') ? text : '')
    } catch {
      return text.includes('=') ? text : ''
    }
  } catch {
    return ''
  }
}

/** 模型看得见的那段说明，与 dsh-plugin-bilibili 的 GUIDANCE 一字不差。 */
const GUIDANCE = `Use bilibili_search to find videos on bilibili.com by keyword; follow up with bilibili_video for one result's full metadata, bilibili_subtitles for its subtitle transcript, or bilibili_frames for real video frames as images (image-capable models only). Use bilibili_playurl for a direct mp4 download URL. Cite the video URL as a markdown link when you use its content.`

/** 存在 DSH 凭证服务里的名字。注意：这是通过服务读写，不是我去翻 .credentials.yaml。 */
const CRED_REF = 'MING_BILI_COOKIE'
// 登出墓碑：防止删掉 Credentials 后，旧版 credentialFile 又在下次启动时把账号恢复。
const CRED_LOGOUT_REF = 'MING_BILI_COOKIE_LOGOUT'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const API_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
}

/** 进程内存里的登录态；重启即失效，故意不落盘 */
let session = null // { cookie, csrf, uid, uname }
let pendingKey = null
let storedCookie = ''
let credentialPersisted = false
let credentialSource = 'none'
let restorePromise = Promise.resolve()

function cookieHeader() {
  return storedCookie || (session ? session.cookie : '')
}

/** 从 cookie 串里取一个键的值 */
function cookieValue(cookie, key) {
  const m = String(cookie || '').match(new RegExp('(?:^|;\\s*)' + key + '=([^;]*)'))
  return m ? m[1] : ''
}

/** 用 cookie 串恢复一个 session（不校验，校验交给 whoami） */
function sessionFromCookie(cookie) {
  return { cookie, csrf: cookieValue(cookie, 'bili_jct'), uid: cookieValue(cookie, 'DedeUserID'), uname: '' }
}

function parseSetCookies(setCookies) {
  const jar = {}
  for (const line of setCookies || []) {
    const first = String(line).split(';')[0]
    const at = first.indexOf('=')
    if (at > 0) jar[first.slice(0, at).trim()] = first.slice(at + 1).trim()
  }
  return jar
}

// One deadline covers headers AND body; ambiguous writes are never retried here.
async function requestBody(url, init = {}) {
  const controller = new AbortController()
  const signal = init.signal
  if (signal?.aborted) throw signal.reason || new Error('Request cancelled before dispatch')
  let rejectAbort
  const aborted = new Promise((_, reject) => { rejectAbort = reject })
  const abort = (reason) => { controller.abort(reason); rejectAbort(reason) }
  const onAbort = () => abort(signal.reason || new Error('Request cancelled'))
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => abort(new Error('Bilibili request deadline exceeded; write outcome may be unknown')), 30000)
  try {
    return await Promise.race([
      (async () => {
        const res = await fetch(url, { ...init, signal: controller.signal })
        const text = await res.text()
        return { res, text }
      })(),
      aborted,
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function api(pathname, init) {
  const { res, text } = await requestBody('https://api.bilibili.com' + pathname, {
    ...init,
    headers: {
      ...API_HEADERS,
      Cookie: cookieHeader(),
      ...(init && init.headers ? init.headers : {}),
    },
  })
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 300) } }
  return { status: res.status, json }
}

function applyRestore(ctx, legacyFile) {
  restorePromise = (async () => {
    let cookie = ''
    const credentials = ctx.credentials
    const canResolve = credentials && typeof credentials.resolve === 'function'

    // 若 Credentials 服务暂时不可用，宁可暂时不登录，也不绕过安全凭证服务读取旧文件。
    if (canResolve) {
      try {
        const marker = await credentials.resolve(CRED_LOGOUT_REF)
        if (marker && typeof marker.value === 'string' && marker.value.trim() === '1') {
          credentialSource = 'logged-out'
          return
        }
        const saved = await credentials.resolve(CRED_REF)
        if (saved && typeof saved.value === 'string') cookie = saved.value.trim()
      } catch {
        credentialSource = 'credentials-unavailable'
        return
      }
    }

    if (cookie) {
      credentialPersisted = true
      credentialSource = 'credentials'
    } else {
      cookie = await readCredentialCookie(legacyFile)
      if (cookie) {
        credentialSource = 'legacy-file'
        try {
          if (!credentials || typeof credentials.set !== 'function') throw new Error('DSH Credentials 服务不可用')
          await credentials.set(CRED_REF, cookie)
          await credentials.set(CRED_LOGOUT_REF, '0')
          credentialPersisted = true
          credentialSource = 'credentials-migrated'
        } catch {
          credentialPersisted = false
          credentialSource = 'legacy-session-only'
        }
      }
    }

    if (!cookie) return
    storedCookie = cookie
    session = sessionFromCookie(cookie)
    const me = await api('/x/web-interface/nav')
    const d = me.json && me.json.data
    if (d && d.isLogin) {
      session.uname = d.uname
      session.uid = String(d.mid)
    } else {
      await clearCookie(ctx)
      credentialSource = 'expired'
    }
  })().catch(() => {
    session = null
    storedCookie = ''
    credentialPersisted = false
    credentialSource = 'unavailable'
  })
  return restorePromise
}

async function persistCookie(ctx, cookie) {
  storedCookie = cookie
  session = sessionFromCookie(cookie)
  credentialPersisted = false
  credentialSource = 'session-only'
  try {
    if (!ctx.credentials || typeof ctx.credentials.set !== 'function') throw new Error('DSH Credentials 服务不可用')
    await ctx.credentials.set(CRED_REF, cookie)
    await ctx.credentials.set(CRED_LOGOUT_REF, '0')
    credentialPersisted = true
    credentialSource = 'credentials'
    return true
  } catch {
    return false
  }
}

async function clearCookie(ctx) {
  session = null
  storedCookie = ''
  pendingKey = null
  credentialPersisted = false
  if (!ctx.credentials) {
    credentialSource = 'clear-failed'
    return false
  }

  // 先写墓碑，再删除 Cookie。即使删除接口失败，下次启动也不会复活旧凭证。
  let tombstoneSaved = false
  let cookieRemoved = false
  try {
    if (typeof ctx.credentials.set !== 'function') throw new Error('DSH Credentials 服务不可用')
    await ctx.credentials.set(CRED_LOGOUT_REF, '1')
    tombstoneSaved = true
  } catch { /* 继续尝试删除 Cookie */ }
  try {
    if (typeof ctx.credentials.unset !== 'function') throw new Error('DSH Credentials 服务不可用')
    await ctx.credentials.unset(CRED_REF)
    cookieRemoved = true
  } catch { /* 不把删除失败误报为成功 */ }

  if (tombstoneSaved && cookieRemoved) {
    credentialSource = 'none'
    return true
  }
  credentialSource = tombstoneSaved ? 'cleared-but-stale' : 'clear-failed'
  return false
}

export function apply(ctx, config) {
  // 配置走纯对象，不挂 schemastery：少一个依赖就少一处加载失败。
  const cfg = config && typeof config === 'object' ? config : {}
  const credentialFile = cfg.credentialFile || DEFAULT_CREDENTIAL_FILE
  applyRestore(ctx, credentialFile)

  // ——— B站取数（搜索 / 视频详情 / 字幕 / 直链 / 抽帧） ———
  // Provider 每次请求都向同一个凭证管理器取 Cookie；扫码登录或面板登出后无需重启。
  const providerOptions = {
    baseUrl: BILIBILI_DEFAULT_BASE_URL,
    userAgent: BILIBILI_DEFAULT_USER_AGENT,
    requestTimeoutMs: BILIBILI_DEFAULT_REQUEST_TIMEOUT_MS,
    subtitleLanguage: BILIBILI_DEFAULT_SUBTITLE_LANGUAGE,
    getCookie: async () => {
      await restorePromise
      return storedCookie || ''
    },
  }
  const provider = new BilibiliOfficialProvider(providerOptions)

  if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
    try {
      ctx.systemPrompt.section({ name: 'tool:bilibili', order: 111, text: GUIDANCE })
    } catch {
      // 外部那个 dsh-plugin-bilibili 还开着时可能占着同一个 section 名，换一个不至于把整个插件带下去
      try { ctx.systemPrompt.section({ name: 'tool:bilibili-ming', order: 111, text: GUIDANCE }) } catch { /* 无所谓 */ }
    }
  }

  const maxPageSize = Number(cfg.searchMaxPageSize) > 0 ? Number(cfg.searchMaxPageSize) : SEARCH_MAX_PAGE_SIZE
  const maxChars = Number(cfg.subtitleMaxChars) > 0 ? Number(cfg.subtitleMaxChars) : BILIBILI_SUBTITLES_MAX_CHARS
  const toolTimeout = Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : TOOL_TIMEOUT_MS

  applyBilibiliSearchTool(ctx, provider, maxPageSize, toolTimeout)
  applyBilibiliVideoTool(ctx, provider, toolTimeout)
  applyBilibiliSubtitleTool(ctx, provider, maxChars, toolTimeout)
  applyBilibiliPlayUrlTool(ctx, provider, toolTimeout)
  // bilibili_frames 要 attachments（图片要真的落盘），有才挂——跟 read_image 一个做法
  ctx.inject(['attachments'], (attachmentsCtx) => {
    try {
      applyBilibiliFramesTool(attachmentsCtx, provider, toolTimeout)
    } catch (e) {
      // 工具 schema 跟宿主版本对不上时，宁可少这一个工具，也不能把搜索/字幕一起带下去
      console.error('[ming-bilibili] bilibili_frames 注册失败（其余工具不受影响）：' + String((e && e.message) || e))
    }
  })

  // ——— 社交面：评论 / 发评 / 观看历史 / 关注 / 收藏夹 / 动态 / 私信会话 ———
  // 社交接口与字幕 Provider 共用同一个 DSH Credentials 凭证，不再各读一份 JSON。
  // 整段包一层：新工具注册不成功，搜索/字幕/登录那一批照旧。
  try {
    applyBilibiliSocialTools(ctx, {
      credentialFile,
      getCredential: async () => {
        await restorePromise
        const cookie = storedCookie || ''
        return {
          cookie,
          csrf: cookieValue(cookie, 'bili_jct'),
          uid: cookieValue(cookie, 'DedeUserID'),
        }
      },
      timeoutMs: toolTimeout,
    })
  } catch (e) {
    console.error('[ming-bilibili] 社交面工具整体注册失败（其余工具不受影响）：' + String((e && e.message) || e))
  }

  const auth = {
    async status() {
      await restorePromise
      return {
        loggedIn: !!session,
        user: session ? (session.uname || '') : '',
        uid: session ? (session.uid || '') : '',
        persisted: !!credentialPersisted,
        source: credentialSource,
      }
    },
    async start() {
      await restorePromise
      const { text } = await requestBody('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
        headers: { ...API_HEADERS },
      })
      let json
      try { json = JSON.parse(text) } catch { return { state: 'error', message: 'B 站没有返回有效的登录资料。' } }
      if (!json || json.code !== 0 || !json.data || !json.data.qrcode_key || !json.data.url) {
        return { state: 'error', message: '生成登录链接失败：' + String(json?.message || json?.code || '未知错误') }
      }
      pendingKey = json.data.qrcode_key
      return { state: 'waiting_scan', url: json.data.url, expiresAt: Date.now() + 180000 }
    },
    async poll() {
      await restorePromise
      if (!pendingKey) return { state: 'not_started', message: '尚未开始扫码，请先开始登录。' }
      const { res, text } = await requestBody(
        'https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(pendingKey),
        { headers: { ...API_HEADERS } },
      )
      let json
      try { json = JSON.parse(text) } catch { return { state: 'error', message: 'B 站没有返回有效的轮询结果。' } }
      const code = json && json.data ? json.data.code : -1
      if (code === 86101) return { state: 'waiting_scan', message: '尚未扫码。' }
      if (code === 86090) return { state: 'waiting_confirm', message: '已扫码，请在手机上确认登录。' }
      if (code === 86038) {
        pendingKey = null
        return { state: 'expired', message: '登录链接已过期，请重新开始。' }
      }
      if (code !== 0) return { state: 'error', message: '登录失败，B 站返回 code=' + String(code) }
      const jar = parseSetCookies(typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [])
      const cookie = buildCookieHeader(jar)
      if (!cookie) return { state: 'error', message: '登录完成，但没有取得可用的 Cookie。' }

      pendingKey = null
      const persisted = await persistCookie(ctx, cookie)
      const me = await api('/x/web-interface/nav')
      const d = me.json && me.json.data
      if (!d || !d.isLogin) {
        await clearCookie(ctx)
        return { state: 'invalid_cookie', message: 'B 站没有确认这份登录状态有效，请重新扫码。' }
      }
      session.uname = d.uname
      session.uid = String(d.mid)
      return {
        state: 'logged_in',
        user: session.uname,
        uid: session.uid,
        persisted,
        message: persisted
          ? '登录成功，Cookie 已保存到 DSH 本机凭证库。字幕和社交工具会共用这份登录状态。'
          : '登录成功，但本机安全凭证保存失败；当前运行期间可用，重启后需要重新登录。',
      }
    },
    async logout() {
      await restorePromise
      const cleared = await clearCookie(ctx)
      return {
        state: 'logged_out',
        persistedCleared: cleared,
        message: cleared
          ? '已登出，并清除本机保存的 B 站凭证。'
          : '本次运行已登出，但本机凭证库未能确认清除；请检查 DSH Credentials 服务。',
      }
    },
  }

  const AUTH_ROUTE = '/_dsh/dsh-ming-bilibili-account'
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: AUTH_ROUTE,
      handler: async (req, res) => {
        const send = (status, body) => {
          res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify(body))
        }
        try {
          if (webCtx.connection && typeof webCtx.connection.requestRejection === 'function') {
            const rejection = webCtx.connection.requestRejection(req)
            if (rejection !== undefined) {
              send(rejection || 403, { ok: false, error: 'rejected' })
              return
            }
          }
          const url = new URL(req.url || '/', 'http://localhost')
          const action = url.pathname.slice(AUTH_ROUTE.length).replace(/^\//, '')
          if (req.method === 'GET' && action === 'status') {
            send(200, { ok: true, ...(await auth.status()) })
            return
          }
          if (req.method === 'POST' && action === 'login/start') {
            const result = await auth.start()
            send(result.state === 'error' ? 502 : 200, { ok: result.state !== 'error', ...result })
            return
          }
          if (req.method === 'POST' && action === 'login/poll') {
            const result = await auth.poll()
            send(result.state === 'error' || result.state === 'invalid_cookie' ? 502 : 200, { ok: result.state !== 'error' && result.state !== 'invalid_cookie', ...result })
            return
          }
          if (req.method === 'POST' && action === 'logout') {
            send(200, { ok: true, ...(await auth.logout()) })
            return
          }
          send(404, { ok: false, error: 'not found' })
        } catch (error) {
          send(500, { ok: false, error: String(error?.message || error) })
        }
      },
    }))
  })

  ctx.tools.register({
    name: 'bili_login',
    description:
      '登录 B 站账号（扫码）。action=start 返回一个手机可打开的登录链接；你在手机 B 站确认后，'
      + '用 action=poll 轮询结果。登录态保存在 DSH 本机 Credentials 中，并由字幕与社交工具共用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['start', 'poll', 'logout', 'status'] },
      },
      required: ['action'],
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const action = args && args.action
      if (action === 'status') {
        const state = await auth.status()
        return state.loggedIn
          ? '已登录：' + (state.user || state.uid) + '（uid ' + (state.uid || '?') + '）' + (state.persisted ? '；已保存在本机' : '；尚未确认本机保存成功')
          : '当前没有登录态。'
      }
      if (action === 'logout') return (await auth.logout()).message
      if (action === 'start') {
        const result = await auth.start()
        if (result.state === 'error') return result.message
        return [
          '用手机打开这个链接，在 B 站里确认登录：',
          result.url,
          '',
          '确认后调用 action=poll。链接约 3 分钟过期。',
        ].join('\\n')
      }
      if (action === 'poll') {
        const result = await auth.poll()
        return result.message || (
          result.state === 'logged_in'
            ? '登录成功：' + result.user + '（uid ' + result.uid + '）'
            : '登录状态：' + result.state
        )
      }
      return 'action 只能是 start / poll / status / logout'
    },

  })

  ctx.tools.register({
    name: 'bili_me',
    description:
      '查看当前登录的 B 站账号信息与能力状态（action=whoami），或尝试改昵称（action=rename）。'
      + '改名对未实名/未绑手机的新号可能被拒，被拒时会把原始错误带回来。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['whoami', 'rename', 'avatar'] },
        nickname: { type: 'string', description: 'rename 时的新昵称' },
        file: { type: 'string', description: 'avatar 时本地图片路径（png/jpg）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const action = args && args.action
      await restorePromise
      if (!session) return '还没登录。先 bili_login action=start。'

      if (action === 'whoami') {
        const me = await api('/x/web-interface/nav')
        const d = me.json && me.json.data
        if (!d) return '查询失败：' + JSON.stringify(me.json).slice(0, 300)
        if (!d.isLogin) return '登录态失效了（可能需要重新扫码）。'
        const lines = [
          '名字：' + d.uname,
          'uid：' + d.mid,
          '等级：' + (d.level_info ? d.level_info.current_level : '?'),
          '硬币：' + (d.money != null ? d.money : '?'),
          '',
          '账号状态（false 表示还没做）：',
          '- 手机绑定：' + (d.mobile_verified === true),
          '- 实名认证：' + (d.identification === true),
          '- 邮箱绑定：' + (d.email_verified === true),
        ]
        return lines.join('\n')
      }

      if (action === 'rename') {
        const nick = typeof args.nickname === 'string' ? args.nickname.trim() : ''
        if (!nick) return 'rename 需要提供 nickname。'
        // 这个接口历史上收的是 uname，不是 nick；传 nig 会被当成空串，
        // 报回来的是「昵称长度太短」（实测 2026-10-20）。两个都带上。
        const body = new URLSearchParams({ uname: nick, nick, csrf: session.csrf })
        const r = await api('/x/member/web/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
        const j = r.json || {}
        if (j.code === 0) {
          session.uname = nick
          return '改名成功：现在是「' + nick + '」。'
        }
        return '改名被拒（code=' + j.code + '）：' + (j.message || JSON.stringify(j).slice(0, 200))
      }

      if (action === 'avatar') {
        const file = typeof args.file === 'string' ? args.file.trim() : ''
        if (!file) return 'avatar 需要提供本地图片路径。'
        let buf
        try {
          const { readFile } = await import('node:fs/promises')
          buf = await readFile(file)
        } catch (e) {
          return '读不到图片：' + String((e && e.message) || e)
        }
        if (buf.length > 5 * 1024 * 1024) return '图片超过 5MB，B 站不收。'
        // 端点不止一个，按顺序试，第一个返回 code=0 的算成功
        const endpoints = [
          'https://api.bilibili.com/x/member/web/face/update',
          'https://api.bilibili.com/x/member/web/face',
        ]
        const tried = []
        for (const ep of endpoints) {
          const fd = new FormData()
          fd.append('pic', new Blob([buf], { type: 'image/png' }), 'avatar.png')
          fd.append('csrf', session.csrf)
          let json
          try {
            const { res, text } = await requestBody(ep, {
              method: 'POST',
              headers: { ...API_HEADERS, Cookie: cookieHeader() },
              body: fd,
            })
            json = JSON.parse(text)
          } catch (e) {
            return '头像请求结果不明，未重试：' + String((e && e.message) || e)
          }
          if (json && json.code === 0) return '头像已更新：' + (json.data && json.data.url ? json.data.url : 'ok')
          tried.push(ep + ' → code=' + (json && json.code) + ' ' + (json && json.message))
        }
        return '上传失败，试过的端点：\n' + tried.join('\n')
      }

      return 'action 只能是 whoami / rename / avatar'
    },
  })
}
