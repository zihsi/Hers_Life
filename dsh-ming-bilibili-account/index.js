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
const DEFAULT_CREDENTIAL_FILE = (process.env.USERPROFILE || '') + '\\.dsh\\bili-duty\\bili_credential.json'
const SEARCH_MAX_PAGE_SIZE = 20
const TOOL_TIMEOUT_MS = 30_000

/** cookie 的四段；缺哪段跳过哪段。JSON 里的字段名按小写比对，格式不同的写法也能认。 */
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
    return buildCookieHeader(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return ''
  }
}

/** 模型看得见的那段说明，与 dsh-plugin-bilibili 的 GUIDANCE 一字不差。 */
const GUIDANCE = `Use bilibili_search to find videos on bilibili.com by keyword; follow up with bilibili_video for one result's full metadata, bilibili_subtitles for its subtitle transcript, or bilibili_frames for real video frames as images (image-capable models only). Use bilibili_playurl for a direct mp4 download URL. Cite the video URL as a markdown link when you use its content.`

/** 存在 DSH 凭证服务里的名字。注意：这是通过服务读写，不是我去翻 .credentials.yaml。 */
const CRED_REF = 'MING_BILI_COOKIE'

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
    try {
      if (ctx.credentials && typeof ctx.credentials.resolve === 'function') {
        const saved = await ctx.credentials.resolve(CRED_REF)
        if (saved && typeof saved.value === 'string') cookie = saved.value.trim()
      }
    } catch { /* credentials 服务不可用时尝试迁移旧文件 */ }

    if (cookie) {
      credentialPersisted = true
      credentialSource = 'credentials'
    } else {
      cookie = await readCredentialCookie(legacyFile)
      if (cookie) {
        credentialSource = 'legacy-file'
        try {
          if (!ctx.credentials || typeof ctx.credentials.set !== 'function') throw new Error('DSH Credentials 服务不可用')
          await ctx.credentials.set(CRED_REF, cookie)
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
      session = null
      storedCookie = ''
      credentialPersisted = false
      credentialSource = 'expired'
      try { await ctx.credentials.unset(CRED_REF) } catch { /* 失效凭证清理失败也不能影响插件启动 */ }
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
  try {
    if (!ctx.credentials || typeof ctx.credentials.unset !== 'function') throw new Error('DSH Credentials 服务不可用')
    await ctx.credentials.unset(CRED_REF)
    credentialSource = 'none'
    return true
  } catch {
    credentialSource = 'clear-failed'
    return false
  }
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

  ctx.tools.register({
    name: 'bili_login',
    description:
      '登录 B 站账号（扫码）。action=start 返回一个手机可打开的登录链接；你在手机 B 站确认后，'
      + '用 action=poll 轮询结果。登录态只存在内存里，DSH 重启就要重新扫。',
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
        if (!session) return '当前没有登录态。'
        return '已登录：' + (session.uname || session.uid) + '（uid ' + (session.uid || '?') + '）'
      }

      if (action === 'logout') {
        session = null
        pendingKey = null
        try { await ctx.credentials.unset(CRED_REF) } catch { /* 无所谓 */ }
        return '已清掉登录态（内存和凭证服务里都清了）。'
      }

      if (action === 'start') {
        const { res, text } = await requestBody('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
          headers: { ...API_HEADERS },
        })
        const json = JSON.parse(text)
        if (!json || json.code !== 0 || !json.data) return '生成登录二维码失败：' + JSON.stringify(json).slice(0, 200)
        pendingKey = json.data.qrcode_key
        return [
          '用手机打开这个链接，在 B 站里确认登录（我没给你二维码图，链接一样能用）：',
          json.data.url,
          '',
          '确认完回来告诉我，我再轮询一次。二维码大约 3 分钟过期。',
        ].join('\n')
      }

      if (action === 'poll') {
        if (!pendingKey) return '还没有开始登录。先调用 action=start。'
        const { res, text } = await requestBody(
          'https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' + encodeURIComponent(pendingKey),
          { headers: { ...API_HEADERS } },
        )
        const json = JSON.parse(text)
        const code = json && json.data ? json.data.code : -1
        if (code === 86101) return '还没扫码。'
        if (code === 86090) return '扫了，但还没在手机上点确认。'
        if (code === 86038) { pendingKey = null; return '二维码过期了，重新 start 一次。' }
        if (code !== 0) return '登录失败，code=' + code + ' ' + JSON.stringify(json).slice(0, 200)

        const jar = parseSetCookies(typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [])
        const cookie = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']
          .filter((k) => jar[k])
          .map((k) => k + '=' + jar[k])
          .join('; ')
        if (!cookie) return '拿到了成功码，但没解析出 cookie。'

        session = { cookie, csrf: jar.bili_jct || '', uid: jar.DedeUserID || '', uname: '' }
        pendingKey = null
        // 落进凭证服务：DSH 重启后能自己恢复，不用再扫
        try { await ctx.credentials.set(CRED_REF, cookie) } catch { /* 存不进也不影响这次登录 */ }

        const me = await api('/x/web-interface/nav')
        const d = me.json && me.json.data
        if (d && d.isLogin) {
          session.uname = d.uname
          session.uid = String(d.mid)
        }
        return '登录成功：' + (session.uname || '(名字待查)') + '（uid ' + (session.uid || '?') + '）\n接着用 bili_me 看账号状态。'
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
