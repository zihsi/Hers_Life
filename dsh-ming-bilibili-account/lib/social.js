/**
 * 社交面：评论 / 发评 / 观看历史 / 关注列表 / 收藏夹 / 动态 / 私信会话列表。
 *
 * 三条硬规矩写在这一层，不在工具里各写一遍：
 *   1. 在 Hers_Life 中 Cookie 由统一 DSH Credentials 管理器提供；独立使用时才回退旧凭证文件。**Cookie 只进请求头。**
 *   2. 相邻两次请求至少隔 1.5 秒；失败先按可重试判一次，重试仍失败才抛。
 *   3. 读是默认，写必须显式确认（confirm:true），没给就在本地拦下、不发请求。
 *
 * 依赖只用 node 内置 + 同目录的 wbi.js / types.js。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BilibiliError } from './types.js'
import { wbiSign } from './wbi.js'

/** 凭证文件默认位置；配置项 credentialFile 覆盖它。 */
const SOCIAL_DSH_HOME = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
export const SOCIAL_DEFAULT_CREDENTIAL_FILE = path.join(SOCIAL_DSH_HOME, 'bili-duty', 'bili_credential.json')
/** 相邻两次请求的最小间隔（ms）。B 站 -412 风控就是被连打出来的。 */
export const SOCIAL_MIN_INTERVAL_MS = 1500
/** 工具层默认超时。 */
export const SOCIAL_DEFAULT_TOOL_TIMEOUT_MS = 30_000

const API_HOST = 'https://api.bilibili.com'
/** 私信在 vc 那台机器上；api.bilibili.com 上 /x/im/web/session/list 是 404。 */
const VC_HOST = 'https://api.vc.bilibili.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const REFERER = 'https://www.bilibili.com/'
const WBI_KEY_TTL_MS = 12 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 20_000
/** 值得再试一次的：风控、限流、服务端 5xx、网络层失败。 */
const RETRYABLE_CODES = new Set([-412, -352, -509, -799])

/** cookie 的四段；JSON 字段名按小写比对。 */
const CREDENTIAL_FIELDS = [
  ['SESSDATA', 'sessdata'],
  ['bili_jct', 'bili_jct'],
  ['buvid3', 'buvid3'],
  ['DedeUserID', 'dedeuserid'],
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 把凭证 JSON 拼成 cookie header。
 * **返回值只往下传**：不打印、不拼进错误信息、不进工具输出。读不到就是空串（匿名）。
 * @param {unknown} raw 解析后的 JSON。
 * @returns {string} cookie header，或空串。
 */
export function buildCookieHeader(raw) {
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

/**
 * 运行时读一次凭证。每次调用都读，文件很小，这样换了 cookie 不用重启。
 * catch 里不带任何文件内容。
 * @param {string} file 凭证文件路径。
 * @returns {{cookie: string, csrf: string, uid: string}}
 */
export function readCredential(file) {
  if (typeof file !== 'string' || file.length === 0) return { cookie: '', csrf: '', uid: '' }
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { cookie: '', csrf: '', uid: '' }
  }
  const cookie = buildCookieHeader(raw)
  const pick = (field) => {
    if (!raw || typeof raw !== 'object') return ''
    for (const key of Object.keys(raw)) {
      if (key.toLowerCase() === field && typeof raw[key] === 'string') return raw[key].trim()
    }
    return ''
  }
  return { cookie, csrf: pick('bili_jct'), uid: pick('dedeuserid') }
}

/** 非空字符串，否则 undefined。 */
const str = (value) => (typeof value === 'string' && value.length > 0 ? value : undefined)
/** 有限数字，否则 fallback。 */
const num = (value, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
/**
 * B 站时间戳 → ISO；无效给空串。
 * 各家字段的单位不统一（私信的 session_ts 是**微秒**，1.79e15；时间线是秒），
 * 所以按量级判：>1e14 当微秒、>1e11 当毫秒、其余当秒。不做这层，
 * `new Date(1.79e18)` 会直接抛 "Invalid time value"（2026-11-08 实测）。
 */
function isoFromSeconds(value) {
  const raw = num(value, 0)
  if (raw <= 0) return ''
  const seconds = raw > 1e14 ? raw / 1e6 : raw > 1e11 ? raw / 1000 : raw
  const date = new Date(seconds * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}
/** 对象断言，非对象给空对象。 */
const asRecord = (value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {})
/** 对象数组断言。 */
const asRecordArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item)) : []

/** 业务码 → 带机器可路由 code 的错误。message 只放 B 站自己的文案，绝不放 cookie。 */
function businessError(code, message) {
  const detail = typeof message === 'string' && message.length > 0 ? '：' + message : ''
  if (code === -412) return new BilibiliError('B 站风控拒绝了这次请求' + detail, 'BILIBILI_RISK_CONTROL', { bilibiliCode: code })
  if (code === -352) return new BilibiliError('B 站风控校验失败（-352）' + detail, 'BILIBILI_RISK_CONTROL', { bilibiliCode: code })
  if (code === -509) return new BilibiliError('B 站限流（-509）' + detail, 'BILIBILI_RISK_CONTROL', { bilibiliCode: code })
  if (code === -101) return new BilibiliError('这个接口要登录态' + detail, 'BILIBILI_LOGIN_REQUIRED', { bilibiliCode: code })
  if (code === -403) return new BilibiliError('B 站拒绝了这次请求' + detail, 'BILIBILI_FORBIDDEN', { bilibiliCode: code })
  if (code === -404) return new BilibiliError('B 站找不到这个对象' + detail, 'BILIBILI_NOT_FOUND', { bilibiliCode: code })
  return new BilibiliError('B 站接口错误 ' + String(code) + detail, 'BILIBILI_API_ERROR', { bilibiliCode: code })
}

/**
 * 进程级请求闸。**不能放在实例上**：插件里一个实例、测试里另起一个实例时，
 * 两条队列交替打出去就是 68ms 一发（2026-11-08 实测踩到）。
 * B 站按 IP 算风控，所以间隔必须按进程算，不按对象算。
 */
const gate = { tail: Promise.resolve(), lastAt: 0 }

/**
 * 社交接口客户端：自带 WBI 钥匙缓存和一次重试；节流走进程级 gate。
 */
export class SocialClient {
  /** @type {{cookie: string, csrf: string, uid: string} | null} 上一次读到的凭证（只在本实例内用） */
  credentialCache = null
  wbiKeyPair = undefined

  constructor(options = {}) {
    this.options = options
    this.minIntervalMs = Number(options.minIntervalMs) > 0 ? Number(options.minIntervalMs) : SOCIAL_MIN_INTERVAL_MS
    this.credentialFile = typeof options.credentialFile === 'string' && options.credentialFile.length > 0
      ? options.credentialFile
      : SOCIAL_DEFAULT_CREDENTIAL_FILE
    this.getCredential = typeof options.getCredential === 'function' ? options.getCredential : null
  }

  /** 统一凭证服务优先；独立使用旧版插件时才回退到 legacy JSON 文件。 */
  async credential() {
    if (this.getCredential) {
      try {
        const fresh = await this.getCredential()
        if (fresh && typeof fresh.cookie === 'string') {
          // 统一凭证服务是唯一真相源；空 Cookie 代表已登出，不能退回旧缓存。
          this.credentialCache = fresh
          return fresh
        }
      } catch {
        // 统一凭证服务读失败时 fail closed：不能继续使用旧 Cookie 缓存。
        return { cookie: '', csrf: '', uid: '' }
      }
      return this.credentialCache ?? { cookie: '', csrf: '', uid: '' }
    }
    const fresh = readCredential(this.credentialFile)
    if (fresh.cookie.length > 0) {
      this.credentialCache = fresh
      return fresh
    }
    return this.credentialCache ?? fresh
  }

  /**
   * 串行闸：全进程一条队列，相邻两次请求至少隔 minIntervalMs。
   * 间隔从**上一次请求结束**算起，所以慢接口后面也不会贴太紧。
   */
  withSlot(task) {
    const run = gate.tail.then(async () => {
      const gap = this.minIntervalMs - (Date.now() - gate.lastAt)
      if (gap > 0) await sleep(gap)
      try {
        return await task()
      } finally {
        gate.lastAt = Date.now()
      }
    })
    gate.tail = run.then(() => undefined, () => undefined)
    return run
  }

  /** 一次 HTTP：拼 URL、带 cookie、拒绝跟随重定向、非 JSON 直接判坏。 */
  async send(spec) {
    const url = new URL(spec.path, spec.host ?? API_HOST)
    for (const [key, value] of Object.entries(spec.params ?? {})) url.searchParams.set(key, String(value))
    const headers = {
      'user-agent': UA,
      referer: REFERER,
      origin: 'https://www.bilibili.com',
      accept: 'application/json, text/plain, */*',
    }
    const cred = await this.credential()
    if (cred.cookie.length > 0) headers.cookie = cred.cookie
    if (spec.method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded'
    const init = { method: spec.method ?? 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    if (spec.method === 'POST') init.body = new URLSearchParams(spec.params ?? {}).toString()

    let response
    try {
      response = await fetch(url, init)
    } catch (cause) {
      throw new BilibiliError('请求没发到 B 站（网络层失败）', 'BILIBILI_REQUEST_FAILED', { cause })
    }
    if (response.status >= 300 && response.status < 400) {
      throw new BilibiliError('B 站返回了重定向（HTTP ' + String(response.status) + '），已拒绝跟随', 'BILIBILI_REDIRECT_REFUSED')
    }
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new BilibiliError('B 站返回的不是 JSON（HTTP ' + String(response.status) + '）', 'BILIBILI_BAD_RESPONSE')
    }
    const envelope = asRecord(body)
    const code = num(envelope.code, -1)
    if (code !== 0) {
      const error = businessError(code, str(envelope.message))
      if (response.status >= 500) error.code = 'BILIBILI_REQUEST_FAILED'
      throw error
    }
    return envelope
  }

  /** 带一次重试：风控/限流/网络失败才重试，其余立刻抛。 */
  async sendWithRetry(spec) {
    let lastError
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.withSlot(() => this.send(spec))
      } catch (error) {
        lastError = error
        // 按 code 判，不依赖 instanceof：跨模块/被包装过的同形错误也要认得出。
        const kind = error && typeof error === 'object' ? error.code : undefined
        const biliCode = error && typeof error === 'object' ? error.bilibiliCode : undefined
        const retryable = kind === 'BILIBILI_REQUEST_FAILED'
          || (typeof biliCode === 'number' && RETRYABLE_CODES.has(biliCode))
        if (!retryable || attempt === 1) throw error
      }
    }
    throw lastError
  }

  /** WBI 钥匙对，缓存 12 小时。 */
  async wbiKeys() {
    const cached = this.wbiKeyPair
    if (cached !== undefined && Date.now() - cached.fetchedAt < WBI_KEY_TTL_MS) return cached
    const envelope = await this.sendWithRetry({ path: '/x/web-interface/nav', params: {} })
    const data = asRecord(envelope.data)
    const img = asRecord(data.wbi_img)
    const stem = (url) => {
      const text = str(url)
      if (text === undefined) return undefined
      const base = text.slice(text.lastIndexOf('/') + 1)
      const dot = base.lastIndexOf('.')
      const value = dot === -1 ? base : base.slice(0, dot)
      return value.length > 0 ? value : undefined
    }
    const imgKey = stem(img.img_url)
    const subKey = stem(img.sub_url)
    if (imgKey === undefined || subKey === undefined) {
      throw new BilibiliError('B 站没有返回可用的 WBI 钥匙', 'BILIBILI_WBI_KEYS_UNAVAILABLE')
    }
    const pair = { imgKey, subKey, fetchedAt: Date.now() }
    this.wbiKeyPair = pair
    return pair
  }

  /**
   * 业务请求：先按需 WBI 签名，再走带重试的那一步。
   * @param {{path: string, host?: string, params?: object, method?: 'GET'|'POST', signed?: boolean, login?: boolean}} spec
   */
  async request(spec) {
    const cred = await this.credential()
    if (spec.login === true && cred.cookie.length === 0) {
      throw new BilibiliError('这个接口要登录态，但凭证文件里没有可用 cookie', 'BILIBILI_LOGIN_REQUIRED')
    }
    let params = { ...(spec.params ?? {}) }
    if (spec.signed === true) {
      const pair = await this.wbiKeys()
      params = { ...params, ...wbiSign(params, pair.imgKey, pair.subKey, Math.floor(Date.now() / 1000)) }
    }
    const envelope = await this.sendWithRetry({ path: spec.path, host: spec.host, params, method: spec.method })
    return envelope.data
  }

  /** bvid → { aid, cid, title, ... }。 */
  async video(bvid) {
    const data = asRecord(await this.request({ path: '/x/web-interface/view', params: { bvid } }))
    const aid = num(data.aid, 0)
    if (aid === 0) throw new BilibiliError('这条视频取不到 aid（可能已删除或不可见）', 'BILIBILI_NOT_FOUND')
    return { aid, cid: num(data.cid, 0), title: str(data.title) ?? '' }
  }

  /** 评论列表（只读）。 */
  async comments({ bvid, page = 1, pageSize = 20, sort = 1 }) {
    const video = await this.video(bvid)
    const data = asRecord(await this.request({
      path: '/x/v2/reply',
      params: { type: 1, oid: video.aid, sort, ps: pageSize, pn: page },
    }))
    const pageInfo = asRecord(data.page)
    const items = asRecordArray(data.replies).map((row) => {
      const member = asRecord(row.member)
      const content = asRecord(row.content)
      return {
        rpid: String(num(row.rpid, 0)),
        author: str(member.uname) ?? '',
        authorMid: String(num(member.mid, 0)),
        content: str(content.message) ?? '',
        like: num(row.like, 0),
        replyCount: num(row.rcount, 0),
        publishedAt: isoFromSeconds(row.ctime),
      }
    })
    return {
      bvid,
      aid: String(video.aid),
      title: video.title,
      page,
      pageSize,
      total: num(pageInfo.count, items.length),
      items,
    }
  }

  /** 发一条评论。csr 从凭证文件的 bili_jct 现读。 */
  async postComment({ bvid, message }) {
    const cred = await this.credential()
    if (cred.cookie.length === 0) throw new BilibiliError('没有登录态，发不了评论', 'BILIBILI_LOGIN_REQUIRED')
    if (cred.csrf.length === 0) throw new BilibiliError('凭证里没有 bili_jct，发不了评论', 'BILIBILI_LOGIN_REQUIRED')
    const video = await this.video(bvid)
    const data = asRecord(await this.request({
      path: '/x/v2/reply/add',
      method: 'POST',
      params: { type: 1, oid: video.aid, message, csrf: cred.csrf },
    }))
    const reply = asRecord(data.reply)
    return {
      posted: true,
      bvid,
      aid: String(video.aid),
      rpid: String(num(reply.rpid ?? data.rpid, 0)),
      message,
    }
  }

  /** 观看历史（要 WBI + 登录）。 */
  async history({ pageSize = 20, max = 0, viewAt = 0, business = '' }) {
    const data = asRecord(await this.request({
      path: '/x/web-interface/history/cursor',
      signed: true,
      login: true,
      params: { max, view_at: viewAt, business, ps: pageSize },
    }))
    const cursor = asRecord(data.cursor)
    const items = asRecordArray(data.list).map((row) => {
      const hist = asRecord(row.history)
      return {
        title: str(row.title) ?? '',
        bvid: str(hist.bvid) ?? '',
        aid: String(num(hist.oid, 0)),
        cid: String(num(hist.cid, 0)),
        author: str(row.author_name) ?? '',
        business: str(hist.business) ?? '',
        watchedAt: isoFromSeconds(row.view_at),
        progress: num(row.progress, 0),
        finished: num(row.progress, 0) === -1,
      }
    })
    return {
      pageSize,
      total: num(cursor.count, items.length),
      cursor: { max: String(num(cursor.max, 0)), viewAt: String(num(cursor.view_at, 0)), business: str(cursor.business) ?? '' },
      hasMore: items.length >= pageSize,
      items,
    }
  }

  /** 关注列表（要登录）。vmid 省略 = 自己。 */
  async followings({ vmid, page = 1, pageSize = 20 }) {
    const cred = await this.credential()
    const target = vmid !== undefined && String(vmid).length > 0 ? String(vmid) : cred.uid
    if (target.length === 0) throw new BilibiliError('不知道自己是谁（凭证里没有 DedeUserID）', 'BILIBILI_LOGIN_REQUIRED')
    const data = asRecord(await this.request({
      path: '/x/relation/followings',
      signed: true,
      login: true,
      params: { vmid: target, pn: page, ps: pageSize, order: 'desc', order_type: 'attention' },
    }))
    const items = asRecordArray(data.list).map((row) => ({
      uname: str(row.uname) ?? '',
      mid: String(num(row.mid, 0)),
      sign: str(row.sign) ?? '',
      followedAt: isoFromSeconds(row.mtime),
    }))
    return { vmid: target, page, pageSize, total: num(data.total, items.length), items }
  }

  /** 自己建的收藏夹。 */
  async favFolders() {
    const cred = await this.credential()
    if (cred.uid.length === 0) throw new BilibiliError('不知道自己是谁（凭证里没有 DedeUserID）', 'BILIBILI_LOGIN_REQUIRED')
    const data = asRecord(await this.request({
      path: '/x/v3/fav/folder/created/list-all',
      signed: true,
      login: true,
      params: { up_mid: cred.uid, web_location: '333.1387' },
    }))
    return asRecordArray(data.list).map((row) => ({
      id: String(num(row.id, 0)),
      title: str(row.title) ?? '',
      mediaCount: num(row.media_count, 0),
    }))
  }

  /** 某个收藏夹里的内容。 */
  async favItems({ mediaId, page = 1, pageSize = 20 }) {
    const data = asRecord(await this.request({
      path: '/x/v3/fav/resource/list',
      signed: true,
      login: true,
      params: { media_id: mediaId, pn: page, ps: pageSize, platform: 'web', order: 'mtime', type: 0, tid: 0 },
    }))
    const info = asRecord(data.info)
    const items = asRecordArray(data.medias).map((row) => {
      const upper = asRecord(row.upper)
      const count = asRecord(row.cnt_info)
      return {
        bvid: str(row.bvid) ?? '',
        title: str(row.title) ?? '',
        author: str(upper.name) ?? '',
        play: num(count.play, 0),
        duration: num(row.duration, 0),
        addedAt: isoFromSeconds(row.pubtime),
      }
    })
    return {
      mediaId: String(mediaId),
      title: str(info.title) ?? '',
      page,
      pageSize,
      total: num(info.media_count, items.length),
      hasMore: Boolean(data.has_more),
      items,
    }
  }

  /** 关注动态。 */
  async dynamics({ page = 1, offset = '', type = 'all', pageSize = 20 }) {
    const params = { type, page, features: 'itemOpusStyle' }
    if (offset.length > 0) params.offset = offset
    const data = asRecord(await this.request({
      path: '/x/polymer/web-dynamic/v1/feed/all',
      signed: true,
      login: true,
      params,
    }))
    const items = asRecordArray(data.items).slice(0, pageSize).map((row) => {
      const modules = asRecord(row.modules)
      const author = asRecord(modules.module_author)
      const dynamic = asRecord(modules.module_dynamic)
      const desc = asRecord(dynamic.desc)
      const major = asRecord(dynamic.major)
      const archive = asRecord(major.archive)
      const opus = asRecord(major.opus)
      const idStr = str(row.id_str) ?? ''
      const bvid = str(archive.bvid)
      const text = str(desc.text) ?? str(archive.title) ?? str(asRecord(opus.summary).text) ?? ''
      return {
        id: idStr,
        type: str(row.type) ?? '',
        author: str(author.name) ?? '',
        publishedAt: isoFromSeconds(author.pub_ts),
        text,
        url: bvid !== undefined ? 'https://www.bilibili.com/video/' + bvid : 'https://t.bilibili.com/' + idStr,
      }
    })
    return {
      page,
      count: items.length,
      offset: String(str(data.offset) ?? ''),
      hasMore: Boolean(data.has_more),
      items,
    }
  }

  /**
   * 私信会话列表（只读，不读消息正文以外的任何东西）。
   * 说明：官方 web 端新接口 /x/im/web/session/list 在 api.bilibili.com 与 api.vc.bilibili.com
   * 上都是 404（实测），能用的是 vc 上的 session_svr/get_sessions。
   */
  async dmSessions() {
    const data = asRecord(await this.request({
      path: '/session_svr/v1/session_svr/get_sessions',
      host: VC_HOST,
      params: { session_type: 1, group_id: 0, build: 0, mobi_app: 'web', platform: 'web' },
      login: true,
    }))
    const items = asRecordArray(data.session_list).map((row) => {
      const last = asRecord(row.last_msg)
      let preview = ''
      const content = str(last.content)
      if (content !== undefined) {
        try {
          const parsed = asRecord(JSON.parse(content))
          preview = str(parsed.content) ?? ''
        } catch {
          preview = ''
        }
      }
      return {
        talkerId: String(num(row.talker_id, 0)),
        sessionType: num(row.session_type, 0),
        unread: num(row.unread_count, 0),
        updatedAt: isoFromSeconds(row.session_ts),
        lastSenderUid: String(num(last.sender_uid, 0)),
        preview: preview.length > 60 ? preview.slice(0, 60) + '…' : preview,
      }
    })
    return { count: items.length, items }
  }
}

// ————————————————————— 工具层 —————————————————————

/** 校验 bvid。 */
function needBvid(args) {
  const bvid = typeof args?.bvid === 'string' ? args.bvid.trim() : ''
  if (bvid.length === 0) throw new Error('bvid 不能为空')
  return bvid
}

/** 正整数 + 上限。 */
function boundedInt(value, fallback, max, name) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(name + ' 必须是正整数')
  return Math.min(value, max)
}

const fmtTime = (iso) => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 16).replace('T', ' ') : '-')

/** 工具统一的输出壳子：字符串交给宿主渲染。 */
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

/**
 * 注册社交面工具。每个工具独立 try：一个 schema 不被宿主接受，不影响其它工具，
 * 更不影响已经挂好的取数/账号那七个。
 * @param {any} ctx 宿主上下文。
 * @param {{credentialFile?: string, getCredential?: () => Promise<{cookie:string,csrf:string,uid:string}>, timeoutMs?: number}} options
 */
export function applyBilibiliSocialTools(ctx, options = {}) {
  const client = new SocialClient({
    credentialFile: options.credentialFile || SOCIAL_DEFAULT_CREDENTIAL_FILE,
    getCredential: options.getCredential,
  })
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : SOCIAL_DEFAULT_TOOL_TIMEOUT_MS
  const registered = []
  /** 逐个注册；失败的单个工具只记一行日志（不带任何凭证）。 */
  const add = (tool) => {
    try {
      ctx.tools.register({ ...tool, timeoutMs, output: textOutput })
      registered.push(tool.name)
    } catch (error) {
      console.error('[ming-bilibili] ' + tool.name + ' 注册失败（其余工具不受影响）：' + String((error && error.message) || error))
    }
  }

  add({
    name: 'bilibili_comments',
    description: '读某个 BV 号视频的评论（只读）。返回每条评论的作者昵称、内容、点赞数、时间、rpid。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bvid: { type: 'string', description: 'BV 号，如 BV185sd6qEBq' },
        page: { type: 'number', description: '第几页，默认 1' },
        pageSize: { type: 'number', description: '每页几条，默认 20，上限 49' },
        sort: { type: 'number', enum: [0, 1, 2], description: '排序：0 按时间 1 按点赞（默认） 2 按回复' },
      },
      required: ['bvid'],
    },
    async execute(args) {
      const result = await client.comments({
        bvid: needBvid(args),
        page: boundedInt(args.page, 1, 200, 'page'),
        pageSize: boundedInt(args.pageSize, 20, 49, 'pageSize'),
        sort: args.sort === 0 || args.sort === 2 ? args.sort : 1,
      })
      const head = '《' + (result.title || result.bvid) + '》aid=' + result.aid
        + ' 共 ' + String(result.total) + ' 条评论（第 ' + String(result.page) + ' 页，本次 ' + String(result.items.length) + ' 条）'
      if (result.items.length === 0) return head + '\n这一页没有评论。'
      const lines = result.items.map((item) => '- ' + item.author + '（赞 ' + String(item.like) + '，' + fmtTime(item.publishedAt) + '，rpid ' + item.rpid + '）：' + item.content)
      return [head, ...lines].join('\n')
    },
  })

  add({
    name: 'bilibili_comment_post',
    description: '在某个 BV 号视频下发表一条评论（写操作）。**必须显式传 confirm:true 才会真的发**；没传就只说一句要确认的话，不发请求。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bvid: { type: 'string', description: 'BV 号' },
        message: { type: 'string', description: '评论正文' },
        confirm: { type: 'boolean', description: '必须为 true 才真的发送' },
      },
      required: ['bvid', 'message'],
    },
    async execute(args) {
      const bvid = needBvid(args)
      const message = typeof args?.message === 'string' ? args.message.trim() : ''
      if (message.length === 0) return '评论正文不能为空。要 confirm:true 才发。'
      if (args?.confirm !== true) return '要 confirm:true 才发。'
      const result = await client.postComment({ bvid, message })
      return '已发出：' + bvid + ' 下 rpid=' + result.rpid + '\n' + message
    },
  })

  add({
    name: 'bilibili_history',
    description: '登录账号的 B 站观看历史（只读，要登录态）。返回每条视频的标题、BV 号、UP 主、观看时间、进度。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        pageSize: { type: 'number', description: '取几条，默认 20，上限 30' },
        max: { type: 'number', description: '翻页游标：上一页返回的 cursor.max，首屏传 0' },
        viewAt: { type: 'number', description: '翻页游标：上一页返回的 cursor.viewAt，首屏传 0' },
        business: { type: 'string', description: '翻页游标：上一页返回的 cursor.business，首屏留空' },
      },
    },
    async execute(args) {
      const result = await client.history({
        pageSize: boundedInt(args?.pageSize, 20, 30, 'pageSize'),
        max: Number.isFinite(args?.max) ? args.max : 0,
        viewAt: Number.isFinite(args?.viewAt) ? args.viewAt : 0,
        business: typeof args?.business === 'string' ? args.business : '',
      })
      if (result.items.length === 0) return '没有更多观看历史了。'
      const lines = result.items.map((item) => {
        const mark = item.finished ? '（看完）' : ''
        const link = item.bvid.length > 0 ? 'https://www.bilibili.com/video/' + item.bvid : ''
        return '- ' + fmtTime(item.watchedAt) + ' 《' + item.title + '》' + mark
          + (item.author.length > 0 ? ' · UP ' + item.author : '') + (link.length > 0 ? ' ' + link : '')
      })
      const head = '观看历史 ' + String(result.items.length) + ' 条'
        + (result.hasMore ? '（还有更早的：max=' + result.cursor.max + ' viewAt=' + result.cursor.viewAt + '）' : '')
      return [head, ...lines].join('\n')
    },
  })

  add({
    name: 'bilibili_followings',
    description: '登录账号的 B 站关注列表（只读，要登录态）。返回昵称、mid、签名、关注时间。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        page: { type: 'number', description: '第几页，默认 1' },
        pageSize: { type: 'number', description: '每页几个，默认 20，上限 50' },
        vmid: { type: 'string', description: '看谁的关注列表，默认自己' },
      },
    },
    async execute(args) {
      const result = await client.followings({
        page: boundedInt(args?.page, 1, 200, 'page'),
        pageSize: boundedInt(args?.pageSize, 20, 50, 'pageSize'),
        vmid: typeof args?.vmid === 'string' ? args.vmid.trim() : undefined,
      })
      if (result.items.length === 0) return '关注列表是空的（或者这一页没有）。'
      const lines = result.items.map((item) => '- ' + item.uname + '（mid ' + item.mid + '，' + fmtTime(item.followedAt) + '）'
        + (item.sign.length > 0 ? '：' + item.sign : ''))
      return ['关注 ' + String(result.total) + ' 人（第 ' + String(result.page) + ' 页，本次 ' + String(result.items.length) + ' 个）', ...lines].join('\n')
    },
  })

  add({
    name: 'bilibili_favorites',
    description: '自己建的 B 站收藏夹（只读，要登录态）。action=list 列夹子；action=items 给某个夹子的内容（要 mediaId）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'items'], description: 'list 列收藏夹 / items 看某个夹子的内容' },
        mediaId: { type: 'string', description: 'action=items 时的收藏夹 id' },
        page: { type: 'number', description: 'items 时第几页，默认 1' },
        pageSize: { type: 'number', description: 'items 时每页几个，默认 20，上限 40' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args?.action
      if (action === 'list') {
        const folders = await client.favFolders()
        if (folders.length === 0) return '没有自己建的收藏夹。'
        const lines = folders.map((f) => '- ' + f.title + '（id ' + f.id + '，' + String(f.mediaCount) + ' 个内容）')
        return ['收藏夹 ' + String(folders.length) + ' 个', ...lines].join('\n')
      }
      if (action === 'items') {
        const mediaId = typeof args?.mediaId === 'string' ? args.mediaId.trim() : ''
        if (mediaId.length === 0) return 'action=items 需要 mediaId（先用 action=list 查）。'
        const result = await client.favItems({
          mediaId,
          page: boundedInt(args?.page, 1, 200, 'page'),
          pageSize: boundedInt(args?.pageSize, 20, 40, 'pageSize'),
        })
        if (result.items.length === 0) return '《' + (result.title || mediaId) + '》这一页没有内容。'
        const lines = result.items.map((item) => '- 《' + item.title + '》'
          + (item.author.length > 0 ? ' · UP ' + item.author : '')
          + ' · 播放 ' + String(item.play)
          + (item.bvid.length > 0 ? ' https://www.bilibili.com/video/' + item.bvid : ''))
        return ['收藏夹《' + (result.title || mediaId) + '》共 ' + String(result.total) + ' 个，本次 ' + String(result.items.length) + ' 个', ...lines].join('\n')
      }
      return 'action 只能是 list / items'
    },
  })

  add({
    name: 'bilibili_dynamics',
    description: '关注动态（只读，要登录态）。返回每条动态的作者、发布时间、正文摘要和链接。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', description: '动态类型：all（默认）/ video / article / 等' },
        page: { type: 'number', description: '第几页，默认 1' },
        offset: { type: 'string', description: '翻页游标：上一页返回的 offset，首屏留空' },
        pageSize: { type: 'number', description: '最多几条，默认 20，上限 30' },
      },
    },
    async execute(args) {
      const result = await client.dynamics({
        type: typeof args?.type === 'string' && args.type.trim().length > 0 ? args.type.trim() : 'all',
        page: boundedInt(args?.page, 1, 100, 'page'),
        offset: typeof args?.offset === 'string' ? args.offset.trim() : '',
        pageSize: boundedInt(args?.pageSize, 20, 30, 'pageSize'),
      })
      if (result.items.length === 0) return '这一页没有动态。'
      const lines = result.items.map((item) => {
        const text = item.text.length > 120 ? item.text.slice(0, 120) + '…' : item.text
        return '- ' + fmtTime(item.publishedAt) + ' ' + item.author + '（' + item.type + '）：' + (text.length > 0 ? text : '(无正文)') + ' ' + item.url
      })
      const head = '动态 ' + String(result.count) + ' 条' + (result.hasMore ? '（还有更多：offset=' + result.offset + '）' : '')
      return [head, ...lines].join('\n')
    },
  })

  add({
    name: 'bilibili_dm_sessions',
    description: 'B 站私信会话列表（只读，要登录态）。只读会话，不读消息历史。返回每个会话的对方 uid、未读数、最后一条的时间和摘要。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    async execute() {
      const result = await client.dmSessions()
      if (result.items.length === 0) return '私信会话列表是空的。'
      const lines = result.items.map((item) => '- uid ' + item.talkerId
        + '（未读 ' + String(item.unread) + '，' + fmtTime(item.updatedAt) + '）'
        + (item.preview.length > 0 ? '：' + item.preview : ''))
      return ['私信会话 ' + String(result.count) + ' 个', ...lines].join('\n')
    },
  })

  if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
    try {
      ctx.systemPrompt.section({
        name: 'tool:bilibili-social',
        order: 112,
        text: 'Use bilibili_comments to read a video\'s comments and bilibili_comment_post to publish one (only with confirm:true). bilibili_history, bilibili_followings, bilibili_favorites, bilibili_dynamics and bilibili_dm_sessions read the logged-in account\'s own data and require a valid credential.',
      })
    } catch { /* section 名冲突不影响工具 */ }
  }

  return registered
}
