/**
 * dsh-ming-bilibili-account —— 溟的 B 站账号工具（登录 / 查身份 / 改名）
 *
 * 为什么要单独写：现成的 dsh-plugin-bilibili 是匿名只读的，没有登录态，也做不了
 * 「我是谁」这类操作。这里只补这一块，不碰它的搜索/视频工具。
 *
 * 登录态怎么拿：扫码。生成 qrcode_key → 你在手机 B 站上确认 → 轮询换 cookie。
 * 密码和 cookie 都不经过聊天框。
 *
 * 登录态由 lib/account.mjs 统一管理：优先使用 DSH credentials service，同时写入 DSH_HOME 下的凭证文件。
 * 退出会写 tombstone，防止旧文件把已退出的登录态复活；Cookie 不写入聊天、日记或日志。
 */
export const name = 'ming-bilibili-account'

/**
 * tools 必须有；systemPrompt / credentials 都声明上（宿主里都有），
 * 但下面每一处调用都另做了一次「服务在不在」的判断，缺哪个都不至于整个插件挂掉。
 */
export const inject = ['tools', 'systemPrompt', 'credentials', 'hersLifeDiscord']

// —— B站取数：从 dsh-plugin-bilibili 搬过来的 provider 与五个工具（原样 vendored）——
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
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
import { createProviderHolder } from './lib/provider-holder.mjs'
// 2026-11-17（核查 R01）：统一账号状态。内存 / 凭证服务 / 文件三处只由它一个人写。
import { createAccount } from './lib/account.mjs'
// 社交面（评论/发评/历史/关注/收藏夹/动态/私信会话）：实现都在 social.js，这里只接线。
import { applyBilibiliSocialTools } from './lib/social.js'

/** 凭证文件默认位置。配置项 credentialFile 覆盖它；DSH_HOME 由宿主提供。 */
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DEFAULT_CREDENTIAL_FILE = join(DSH_HOME, 'bili-duty', 'bili_credential.json')
const SEARCH_MAX_PAGE_SIZE = 20
const TOOL_TIMEOUT_MS = 30_000

/** cookie 的四段；缺哪段跳过哪段。JSON 里的字段名按小写比对，格式不同的写法也能认。 */
const CREDENTIAL_FIELDS = [
  ['SESSDATA', 'sessdata'],
  ['bili_jct', 'bili_jct'],
  ['buvid3', 'buvid3'],
  ['DedeUserID', 'dedeuserid'],
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

/**
 * 2026-11-17（核查 R01）：**一个账号，一个权威**。
 *   accountRef —— lib/account.mjs 的实例：内存 + 凭证服务 + 文件，三处由它一个人写；
 *   profile    —— 只放显示用的名字，不参与鉴权。
 * 以前这里是第四份状态 session：登录工具写它、provider 从别处拿、社交面又自己读文件，
 * 于是「退出后被恢复」「显示已登录但 provider 没换」都能发生。
 * 现在所有「这个号现在是登录吗」都走 session()，它只读 accountRef。
 */
let accountRef = null
const profile = { uname: '', uid: '' }
let pendingKey = null

/** 这一轮该用的登录态（所有读状态的地方都从这里取，别再新开一条路）。 */
function session() {
  const cur = accountRef ? accountRef.current() : { cookie: '', gen: 0, loggedIn: false }
  return {
    cookie: cur.cookie,
    gen: cur.gen,
    loggedIn: !!cur.cookie,
    csrf: cookieValue(cur.cookie, 'bili_jct'),
    uid: profile.uid || cookieValue(cur.cookie, 'DedeUserID'),
    uname: profile.uname,
  }
}

function cookieHeader() {
  return session().cookie
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

// 2026-11-17（R01）：原来这里有个模块级的 applyRestore，它在 apply 外面引用 apply 里面的
// rebuildProvider —— 名字不在作用域里，一进去就 ReferenceError，被 catch 吞掉：
// 结果「显示已登录」，provider 没换、nav 也没校验。恢复流程现在在 apply 里面（见 restoreLogin）。

function requireBilibiliOwner(ctx, exec, operation) {
  const meta = exec?.agent?.session?.header?.meta?.hersLife
    ?? exec?.agent?.session?.header?.metadata?.hersLife ?? {}
  if (meta.platform !== 'discord') return
  const actor = ctx.hersLifeDiscord?.actorForExecution?.(exec)
  const agentId = String(exec?.agent?.id ?? '')
  if (!actor || !agentId || actor.sessionId !== agentId || !actor.userId
    || typeof ctx.hersLifeDiscord?.isOwner !== 'function'
    || !ctx.hersLifeDiscord.isOwner(actor.userId)) {
    throw new Error('B 站帳號與私人資料工具僅限 Discord Owner 使用（' + String(operation || 'account') + '）。')
  }
}

export function apply(ctx, config) {
  const central = ctx.hersLifeDiscord?.getSetting?.('bilibili', {}) || {}
  if (central.enabled === false) return
  // ——— B站取数（搜索 / 视频详情 / 字幕 / 直链 / 抽帧） ———
  // 配置走纯对象，不挂 schemastery：少一个依赖就少一处加载失败。
  const cfg = { ...(config && typeof config === 'object' ? config : {}), ...central }
  const credentialFile = cfg.credentialFile || DEFAULT_CREDENTIAL_FILE

  // 2026-11-17（核查 R01）：一个账号一个权威。内存 / 凭证服务 / 文件只由 account 写。
  // 宿主的 credentials 是 resolve/set（unset 不一定有），lib 的契约是 get/set/unset ——
  // 适配放在这里；两个名字不同的对象不能直接互塞。
  const credService = ctx.credentials && typeof ctx.credentials.resolve === 'function'
    ? {
      get: async (key) => {
        try {
          const r = await ctx.credentials.resolve(key)
          return r && typeof r.value === 'string' ? r.value : ''
        } catch { return '' }
      },
      set: (key, value) => ctx.credentials.set(key, value),
      unset: typeof ctx.credentials.unset === 'function' ? (key) => ctx.credentials.unset(key) : undefined,
    }
    : null
  const account = createAccount({
    file: credentialFile,
    readText: (f) => readFile(f, 'utf8'),
    writeText: (f, t) => writeFile(f, t, 'utf8'),
    service: credService,
    serviceKey: CRED_REF,
  })
  accountRef = account
  ctx.hersLifeDiscord?.registerStatusProvider?.('bilibili', () => {
    const current = account.current()
    return {
      loggedIn: Boolean(current?.cookie),
      userName: String(profile.uname || ''),
      userId: String(profile.uid || ''),
      credentialFile,
    }
  })

  // 2026-11-17（G.5 第二轮）：provider 构造时会把 cookie 抄成自己的字段，之后改 options 它不看。
  // 所以这里留一个可替换的真身 + 一个代理：工具闭包里拿到的永远是代理，
  // 登录/退出/恢复时只换真身，不用重启 DSH。
  const baseOptions = {
    baseUrl: BILIBILI_DEFAULT_BASE_URL,
    userAgent: BILIBILI_DEFAULT_USER_AGENT,
    requestTimeoutMs: BILIBILI_DEFAULT_REQUEST_TIMEOUT_MS,
    subtitleLanguage: BILIBILI_DEFAULT_SUBTITLE_LANGUAGE,
  }
  const providerHolder = createProviderHolder(
    (opts) => new BilibiliOfficialProvider(opts),
    baseOptions,
    '',
  )
  const provider = providerHolder.proxy
  const rebuildProvider = (ck) => providerHolder.swap(ck)

  // 启动恢复：服务优先、文件兜底、tombstone 优先于两者。恢复完**才**换 provider；
  // 恢复失败就当没登录——绝不保留「显示已登录、provider 没换」的半截状态。
  const restoreLogin = async () => {
    try {
      const r = await account.restore()
      const cur = account.current()
      if (!cur.cookie) {
        if (r && r.reason === 'logged-out-before') console.error('[ming-bilibili] 上次退出过，本次按未登录启动')
        return
      }
      rebuildProvider(cur.cookie)
      const me = await api('/x/web-interface/nav')
      const d = me.json && me.json.data
      if (d && d.isLogin) {
        profile.uname = String(d.uname || '')
        profile.uid = String(d.mid || '')
      } else {
        account.drop() // 过期了：清内存，不写 tombstone（下次还能从服务恢复新扫的）
        rebuildProvider('')
      }
    } catch (e) {
      console.error('[ming-bilibili] 恢复登录态失败：' + String((e && e.message) || e))
    }
  }
  void restoreLogin()

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
  // 2026-11-17（核查 R01）：凭证不再由 social 自己读文件——那会绕开退出标记和代次。
  // 统一从这里取当前那一代 cookie（没有就空 = 匿名）。
  // 整段包一层：新工具注册不成功，搜索/字幕/登录那一批照旧。
  try {
    applyBilibiliSocialTools(ctx, {
      credentialFile: cfg.credentialFile || DEFAULT_CREDENTIAL_FILE,
      timeoutMs: toolTimeout,
      cookieProvider: () => session(),
      authorize: (exec, name) => requireBilibiliOwner(ctx, exec, name),
    })
  } catch (e) {
    console.error('[ming-bilibili] 社交面工具整体注册失败（其余工具不受影响）：' + String((e && e.message) || e))
  }

  ctx.tools.register({
    name: 'bili_login',
    description:
      '登录 B 站账号（扫码）。action=start 返回一个手机可打开的登录链接；你在手机 B 站确认后，'
      + '用 action=poll 轮询结果。登录成功后同时写进 DSH 凭证服务和本地凭证文件，重启能自己恢复；'
      + 'action=logout 三层一起清并写退出标记。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['start', 'poll', 'logout', 'status'] },
      },
      required: ['action'],
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args, exec) {
      requireBilibiliOwner(ctx, exec, 'bili_login')
      const action = args && args.action

      if (action === 'status') {
        const s = session()
        if (!s.loggedIn) return '当前没有登录态。'
        return '已登录：' + (s.uname || s.uid) + '（uid ' + (s.uid || '?') + '）'
      }

      if (action === 'logout') {
        pendingKey = null
        // 2026-11-17（R01）：退出由 account 一个人做——内存清零、服务 unset、文件写 tombstone，
        // 并且代次 +1：正在飞的那次扫码结果回来会被认成过期的，不许把号又登回去。
        const r = await account.clear()
        rebuildProvider('')
        profile.uname = ''
        profile.uid = ''
        return '已退出：' + (r.service ? '凭证服务已清' : '凭证服务没清成（可能本来就没有）') + '，'
          + (r.tombstone ? '文件已写退出标记（不会被旧 cookie 复活）' : '文件没写成功，下次启动可能从旧文件恢复')
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
        // 记下这一轮开始时是第几代：结果回来时若已经退出/换号，就不许写回（R01 的迟到结果）。
        const genAtStart = account.current().gen
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

        pendingKey = null
        // 迟到结果：期间退出 / 又扫了另一次，这一条就是过期的，不入账。
        if (account.isStale(genAtStart)) {
          return '这次扫码的结果回来时登录状态已经变了（期间退出或换了号），没写回。要登录请重新 start。'
        }
        // 写：内存 + 凭证服务 + 文件一次做完，哪一层没写成功都如实报。
        const saved = await account.save(cookie)
        // G.5：登录后立刻把 provider 换成带新 cookie 的那一份（不等重启）
        rebuildProvider(account.current().cookie)

        const me = await api('/x/web-interface/nav')
        const d = me.json && me.json.data
        const s = session()
        if (d && d.isLogin) {
          profile.uname = String(d.uname || '')
          profile.uid = String(d.mid || '')
        }
        return '登录成功：' + (session().uname || '(名字待查)') + '（uid ' + (session().uid || '?') + '）\n'
          + '保存：' + (saved.service ? '凭证服务 ✓' : '凭证服务 ✗') + ' / ' + (saved.file ? '文件 ✓' : '文件 ✗')
          + '\n接着用 bili_me 看账号状态。'
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
    async execute(args, exec) {
      requireBilibiliOwner(ctx, exec, 'bili_me')
      const action = args && args.action
      if (!session().loggedIn) return '还没登录。先 bili_login action=start。'

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
        const body = new URLSearchParams({ uname: nick, nick, csrf: session().csrf })
        const r = await api('/x/member/web/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
        const j = r.json || {}
        if (j.code === 0) {
          profile.uname = nick
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
          fd.append('csrf', session().csrf)
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
