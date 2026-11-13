/**
 * dsh-ming-interest —— 被动观察 / 兴趣判断 / 自主参与
 *
 * 目标：不是每句话都回复，但也不是只有被 @ 才知道群里发生了什么。
 *
 * 两条完全分开的路径：
 *   · 观察：读取 QQ / Discord inbox，将未进入 Agent 正常回合的原始消息写入同工作区共享 feed；
 *     观察不需要命中兴趣、不需要 @，也不受「暂停自主唤醒」开关影响。
 *   · 参与：只对允许的群组做轻量关键词筛选；命中后排队，再由 Agent 自己判断要不要接话。
 *
 * 边界：
 *   · QQ 私讯可加入共享记忆；是否参与主动唤醒仍由会话类型与策略决定。
 *   · 同一工作区的私讯、群聊、Discord、网页会话共享上下文；不再人为制造房间人格隔离。
 *   · 不把一条群聊内容转发到其他群；共享的是助手自己的上下文，不是跨群自动发言。
 *   · 有上限：间隔、每小时次数、静默时段、候选队列 TTL；另有 live/interest-off 一键停自主参与。
 *
 * 为什么用关键词而不是每次都调一次模型：每句群消息都过一次模型，等于把群聊
 * 变成一台计费机器。关键词是粗筛；命中后才唤醒 Agent，由它决定是否值得参与。
 */

import path from 'node:path'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export const name = 'ming-interest'

/** agents 用来找/叫醒会话；timer 提供 ctx.interval。 */
export const inject = ['agents', 'timer', 'tools']

const DEFAULTS = {
  enabled: true,
  workspacePath: 'C:\\dsh\\workspace',
  /** onebot 的入站录制文件（recordInbound: true 才存在）。 */
  inboxPath: (process.env.USERPROFILE || '') + '\\.dsh\\media\\onebot\\qq-inbox.jsonl',
  /** onebot 的 chatId → sessionId 映射，用来找「群自己的那个会话」。 */
  chatSessionsPath: (process.env.USERPROFILE || '') + '\\.dsh\\media\\onebot\\chat-sessions.json',
  /** 兴趣清单（工作区相对路径）。 */
  interestsFile: 'live\\interests.json',
  /** 每次唤醒追加一行，可查。 */
  logFile: 'live\\interest-log.jsonl',
  /** 为什么没醒，写在这里给她和我看。 */
  stateFile: 'live\\interest-state.json',
  /** 有这个文件就整轮不醒。 */
  offFlag: 'live\\interest-off',
  /** 多久看一次 inbox。 */
  pollMs: 20000,
  /** 两次唤醒至少隔这么久。 */
  minGapMinutes: 20,
  /** 一小时内最多醒几次。 */
  maxPerHour: 3,
  /** 静默时段，她多半在睡。 */
  quietHours: '01:00-08:00',
  /** 太短的消息（「嗯」「哈哈」）不参与匹配。 */
  minChars: 6,
  /** 自主参与白名单；空 = 所有群。 */
  groups: [],
  /** 被动观察白名单；空 = 观察所有群。与参与白名单分开。 */
  observeGroups: [],
  /** 唤醒时附带的上下文条数（同一群人最近几句）。 */
  contextLines: 4,
  /** 观察 inbox 并写入同工作区共享记忆；与是否唤醒 Agent 分开。 */
  observeEnabled: true,
  /** 同时记录 QQ 私讯；私讯不通过兴趣规则主动唤醒。 */
  observePrivate: true,
  /** 群会话不存在时，按原会话 ID 自动恢复或建立。 */
  autoCreateSession: true,
  /** Agent 忙碌时保留候选的最大数量与过期时间。 */
  pendingMax: 100,
  pendingTtlMinutes: 30,
}

function normalize(config) {
  const c = config && typeof config === 'object' ? config : {}
  const num = (v, f, min) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min ? n : f
  }
  const str = (v, f) => (typeof v === 'string' && v.trim() ? v.trim() : f)
  const list = (v, f) =>
    Array.isArray(v) && v.length
      ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      : f
  return {
    enabled: c.enabled !== false,
    workspacePath: path.resolve(str(c.workspacePath, DEFAULTS.workspacePath)),
    inboxPath: str(c.inboxPath, DEFAULTS.inboxPath),
    chatSessionsPath: str(c.chatSessionsPath, DEFAULTS.chatSessionsPath),
    interestsFile: str(c.interestsFile, DEFAULTS.interestsFile),
    logFile: str(c.logFile, DEFAULTS.logFile),
    stateFile: str(c.stateFile, DEFAULTS.stateFile),
    offFlag: str(c.offFlag, DEFAULTS.offFlag),
    pollMs: Math.floor(num(c.pollMs, DEFAULTS.pollMs, 5000)),
    minGapMinutes: num(c.minGapMinutes, DEFAULTS.minGapMinutes, 1),
    maxPerHour: Math.floor(num(c.maxPerHour, DEFAULTS.maxPerHour, 0)),
    quietHours: str(c.quietHours, DEFAULTS.quietHours),
    minChars: Math.floor(num(c.minChars, DEFAULTS.minChars, 1)),
    groups: list(c.groups, DEFAULTS.groups),
    observeGroups: list(c.observeGroups, DEFAULTS.observeGroups),
    contextLines: Math.floor(num(c.contextLines, DEFAULTS.contextLines, 0)),
    observeEnabled: c.observeEnabled !== false,
    observePrivate: c.observePrivate !== false,
    autoCreateSession: c.autoCreateSession !== false,
    pendingMax: Math.floor(num(c.pendingMax, DEFAULTS.pendingMax, 10)),
    pendingTtlMinutes: num(c.pendingTtlMinutes, DEFAULTS.pendingTtlMinutes, 1),
  }
}

/** 「01:00-08:00」→ [起始分钟, 结束分钟]；解析不了就当没有静默时段。 */
function parseQuietHours(text) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(text || '').trim())
  if (!m) return null
  const start = Number(m[1]) * 60 + Number(m[2])
  const end = Number(m[3]) * 60 + Number(m[4])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return [start, end]
}

function inQuiet(base, date) {
  if (!base) return false
  const minute = date.getHours() * 60 + date.getMinutes()
  const [start, end] = base
  if (start === end) return false
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

function hhmm(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(date.getHours())}:${p(date.getMinutes())}`
}

/** 把 OneBot 消息段拼成人话：文本 + 占位符，够看就行。 */
function renderSegments(message) {
  if (typeof message === 'string') return message
  if (!Array.isArray(message)) return ''
  const parts = []
  for (const seg of message) {
    const type = String(seg?.type ?? '')
    const data = seg?.data ?? {}
    if (type === 'text') parts.push(String(data.text ?? ''))
    else if (type === 'image') parts.push(data.sub_type === '1' ? '[表情包]' : '[图片]')
    else if (type === 'face') parts.push('[表情]')
    else if (type === 'record') parts.push('[语音]')
    else if (type === 'video') parts.push('[视频]')
    else if (type === 'at') parts.push(String(data.qq ?? '') === 'all' ? '@全体成员' : `@${data.qq ?? ''}`)
    else if (type === 'reply') parts.push('[引用]')
    else if (type === 'json') parts.push('[卡片]')
    else if (type === 'forward') parts.push('[合并转发]')
  }
  return parts.join('').trim()
}

/** 兴趣清单 → { topics: [{name, keywords[]}], mute: string[] }；读不到返回 null。 */
async function readInterests(file) {
  try {
    const raw = await readFile(file, 'utf8')
    const json = JSON.parse(raw)
    const topics = []
    for (const t of Array.isArray(json?.topics) ? json.topics : []) {
      if (!t || typeof t !== 'object') continue
      const keywords = (Array.isArray(t.keywords) ? t.keywords : [])
        .filter((k) => typeof k === 'string' && k.trim())
        .map((k) => k.trim().toLowerCase())
      if (keywords.length === 0) continue
      topics.push({ name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : keywords[0], keywords })
    }
    const mute = (Array.isArray(json?.mute) ? json.mute : [])
      .filter((k) => typeof k === 'string' && k.trim())
      .map((k) => k.trim().toLowerCase())
    return { topics, mute }
  } catch {
    return null
  }
}

/** 命中哪些主题、哪些词。mute 命中则整条不参与。 */
function matchText(text, interests) {
  const lower = text.toLowerCase()
  for (const word of interests.mute) {
    if (lower.includes(word)) return { muted: word }
  }
  const hits = []
  for (const topic of interests.topics) {
    const words = topic.keywords.filter((k) => lower.includes(k))
    if (words.length > 0) hits.push({ topic: topic.name, words })
  }
  return hits.length > 0 ? { hits } : {}
}

/** 读取兴趣文档的完整结构，保留 reason / evidence / candidates 等元数据。 */
async function readInterestDocument(file) {
  try {
    const doc = JSON.parse(await readFile(file, 'utf8'))
    return {
      version: Number(doc.version) || 1,
      topics: Array.isArray(doc.topics) ? doc.topics.filter((x) => x && typeof x === 'object') : [],
      candidates: Array.isArray(doc.candidates) ? doc.candidates.filter((x) => x && typeof x === 'object') : [],
      mute: Array.isArray(doc.mute) ? doc.mute.filter((x) => typeof x === 'string') : [],
      updatedAt: doc.updatedAt || '',
    }
  } catch {
    return { version: 1, topics: [], candidates: [], mute: [], updatedAt: '' }
  }
}

async function writeInterestDocument(file, doc) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = file + '.' + randomUUID() + '.tmp'
  await writeFile(temp, JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}

async function manageInterest(file, args = {}) {
  const action = String(args.action || 'list').trim().toLowerCase()
  const name = String(args.name || args.word || '').trim()
  const key = name.toLowerCase()
  const keywords = [...new Set((Array.isArray(args.keywords) ? args.keywords : [])
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim().toLowerCase()))]
  const reason = String(args.reason || '').trim().slice(0, 500)
  const evidenceText = String(args.evidence || '').trim().slice(0, 500)
  const source = String(args.source || 'conversation').trim().slice(0, 80)
  const doc = await readInterestDocument(file)
  const find = (arr) => arr.findIndex((x) => String(x.name || '').trim().toLowerCase() === key)
  const evidence = evidenceText ? [{ source, summary: evidenceText, at: new Date().toISOString() }] : []

  if (action === 'list') return { ok: true, topics: doc.topics, candidates: doc.candidates, mute: doc.mute }
  if (!name) return { ok: false, message: '这个操作需要提供兴趣名称 name。' }

  if (action === 'add' || action === 'propose') {
    const target = action === 'add' ? doc.topics : doc.candidates
    const idx = find(target)
    const item = idx >= 0 ? target[idx] : { name }
    item.name = name
    item.keywords = [...new Set([...(Array.isArray(item.keywords) ? item.keywords : []), ...(keywords.length ? keywords : [key])])]
    if (reason) item.reason = reason
    if (evidence.length) item.evidence = [...(Array.isArray(item.evidence) ? item.evidence : []), ...evidence].slice(-12)
    item.updatedAt = new Date().toISOString()
    if (!item.createdAt) item.createdAt = item.updatedAt
    if (idx >= 0) target[idx] = item
    else target.push(item)
    if (action === 'add') {
      doc.candidates = doc.candidates.filter((x) => String(x.name || '').trim().toLowerCase() !== key)
    }
    await writeInterestDocument(file, doc)
    return { ok: true, message: action === 'add' ? '已加入主动兴趣清单。' : '已加入待确认兴趣候选。', item }
  }

  if (action === 'remove' || action === 'reject') {
    const targetKey = action === 'remove' ? 'topics' : 'candidates'
    const before = doc[targetKey].length
    doc[targetKey] = doc[targetKey].filter((x) => String(x.name || '').trim().toLowerCase() !== key)
    if (before === doc[targetKey].length) return { ok: false, message: '找不到这个兴趣项目。' }
    await writeInterestDocument(file, doc)
    return { ok: true, message: action === 'remove' ? '已从主动兴趣清单移除。' : '已拒绝这个兴趣候选。' }
  }

  if (action === 'accept') {
    const idx = find(doc.candidates)
    if (idx < 0) return { ok: false, message: '找不到这个兴趣候选。' }
    const candidate = doc.candidates.splice(idx, 1)[0]
    const existing = find(doc.topics)
    if (existing >= 0) {
      const old = doc.topics[existing]
      old.keywords = [...new Set([...(old.keywords || []), ...(candidate.keywords || [])])]
      old.evidence = [...(old.evidence || []), ...(candidate.evidence || [])].slice(-12)
      old.reason = candidate.reason || old.reason
      old.updatedAt = new Date().toISOString()
    } else doc.topics.push({ ...candidate, updatedAt: new Date().toISOString() })
    await writeInterestDocument(file, doc)
    return { ok: true, message: '已将候选转为主动兴趣。' }
  }

  if (action === 'mute' || action === 'unmute') {
    const word = String(args.word || name).trim().toLowerCase()
    if (!word) return { ok: false, message: '需要提供要静音的词。' }
    if (action === 'mute' && !doc.mute.includes(word)) doc.mute.push(word)
    if (action === 'unmute') doc.mute = doc.mute.filter((x) => x.toLowerCase() !== word)
    await writeInterestDocument(file, doc)
    return { ok: true, message: action === 'mute' ? '已加入静音词。' : '已移除静音词。' }
  }

  return { ok: false, message: 'action 仅支持 list / add / remove / propose / accept / reject / mute / unmute。' }
}

export function apply(ctx, config) {
  const cfg = normalize(config)

  // ---- 面板 API：状态、兴趣清单与开关 ----
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/_dsh/dsh-ming-interest',
      handler: async (req, res) => {
        const send = (st, body) => {
          res.writeHead(st, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        const readBody = async () => {
          const chunks = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 65536) throw new Error('request body too large')
            chunks.push(Buffer.from(chunk))
          }
          return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        }
        try {
          if (webCtx.connection && typeof webCtx.connection.requestRejection === 'function') {
            const rejection = webCtx.connection.requestRejection(req)
            if (rejection) { send(rejection, { ok: false, error: 'rejected' }); return }
          }
          const url = new URL(req.url || '/', 'http://localhost')
          const what = url.pathname.replace('/_dsh/dsh-ming-interest', '').replace(/^\//, '')
          const interestsPath = path.join(cfg.workspacePath, cfg.interestsFile)

          if (what === 'toggle' && req.method === 'POST') {
            const { rm, writeFile: wf } = await import('node:fs/promises')
            const flag = path.join(cfg.workspacePath, cfg.offFlag)
            const wasOff = existsSync(flag)
            if (wasOff) await rm(flag, { force: true })
            else {
              await mkdir(path.dirname(flag), { recursive: true })
              await wf(flag, 'panel toggle ' + new Date().toISOString() + '\n', 'utf8')
            }
            send(200, { ok: true, off: !wasOff })
            return
          }

          if (what === 'update' && req.method === 'POST') {
            const body = await readBody()
            const result = await manageInterest(interestsPath, body)
            send(result.ok ? 200 : 400, result)
            return
          }
          if (what === 'settings' && req.method === 'POST') {
            const body = await readBody()
            send(200, { ok: true, settings: await saveSettings(body) })
            return
          }

          if (what !== 'state' || req.method !== 'GET') { send(404, { error: 'not found' }); return }

          await loadSettings()
          const doc = await readInterestDocument(interestsPath)
          let st = {}
          try { st = JSON.parse(await readFile(path.join(cfg.workspacePath, cfg.stateFile), 'utf8')) } catch {}

          send(200, {
            ok: true,
            topics: doc.topics,
            candidates: doc.candidates,
            mute: doc.mute,
            settings: {
              observeEnabled: cfg.observeEnabled,
              observePrivate: cfg.observePrivate,
              autoCreateSession: cfg.autoCreateSession,
              groups: cfg.groups,
              observeGroups: cfg.observeGroups,
              pollMs: cfg.pollMs,
              minGapMinutes: cfg.minGapMinutes,
              maxPerHour: cfg.maxPerHour,
              quietHours: cfg.quietHours,
              minChars: cfg.minChars,
              contextLines: cfg.contextLines,
              pendingMax: cfg.pendingMax,
              pendingTtlMinutes: cfg.pendingTtlMinutes,
            },
            state: {
              at: String(st.at || ''),
              quiet: !!st.quiet,
              wakesLastHour: Number(st.wakesLastHour || 0),
              maxPerHour: Number(st.maxPerHour || 0),
              sinceWakeMs: Number(st.sinceWakeMs || 0),
              skip: String(st.skip || ''),
              pending: Number(st.pending || 0),
              observed: Number(st.observed || 0),
              off: existsSync(path.join(cfg.workspacePath, cfg.offFlag)),
            },
          })
        } catch (e) {
          send(500, { error: String((e && e.message) || e) })
        }
      },
    }))
  })
  let quiet = parseQuietHours(cfg.quietHours)

  const log = (level, message) => {
    try {
      const logger = ctx.logger
      const line = '[ming-interest] ' + message
      if (logger && typeof logger[level] === 'function') logger[level](line)
      else if (level === 'error' || level === 'warn') console.warn(line)
      else console.log(line)
    } catch {
      /* 日志打不出来不影响主流程 */
    }
  }

  if (!cfg.enabled) {
    log('info', 'disabled by config')
    return
  }

  const interestsPath = path.join(cfg.workspacePath, cfg.interestsFile)
  const statePath = path.join(cfg.workspacePath, cfg.stateFile)
  const logPath = path.join(cfg.workspacePath, cfg.logFile)
  const offPath = path.join(cfg.workspacePath, cfg.offFlag)

  const settingsPath = path.join(cfg.workspacePath, 'live', 'interest-settings.json')
  const settingsSnapshot = () => ({
    observeEnabled: cfg.observeEnabled,
    observePrivate: cfg.observePrivate,
    autoCreateSession: cfg.autoCreateSession,
    groups: cfg.groups,
    observeGroups: cfg.observeGroups,
    minGapMinutes: cfg.minGapMinutes,
    maxPerHour: cfg.maxPerHour,
    quietHours: cfg.quietHours,
    minChars: cfg.minChars,
    contextLines: cfg.contextLines,
    pendingMax: cfg.pendingMax,
    pendingTtlMinutes: cfg.pendingTtlMinutes,
  })
  const sanitizeSettings = (raw = {}) => {
    const out = {}
    for (const key of ['observeEnabled', 'observePrivate', 'autoCreateSession']) {
      if (typeof raw[key] === 'boolean') out[key] = raw[key]
    }
    if (Array.isArray(raw.groups)) out.groups = [...new Set(raw.groups.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))]
    if (Array.isArray(raw.observeGroups)) out.observeGroups = [...new Set(raw.observeGroups.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))]
    const bounded = (key, min, max) => {
      if (raw[key] === undefined) return
      const n = Number(raw[key])
      if (Number.isFinite(n)) out[key] = Math.max(min, Math.min(max, n))
    }
    bounded('minGapMinutes', 1, 1440)
    bounded('maxPerHour', 0, 60)
    bounded('minChars', 1, 500)
    bounded('contextLines', 0, 20)
    bounded('pendingMax', 10, 500)
    bounded('pendingTtlMinutes', 1, 240)
    if (typeof raw.quietHours === 'string') out.quietHours = raw.quietHours.trim().slice(0, 32)
    return out
  }
  const loadSettings = async () => {
    try {
      const saved = JSON.parse(await readFile(settingsPath, 'utf8'))
      Object.assign(cfg, sanitizeSettings(saved))
    } catch { /* 尚未建立設定檔，使用 DSH 插件預設值 */ }
    return settingsSnapshot()
  }
  const saveSettings = async (raw) => {
    const patch = sanitizeSettings(raw)
    Object.assign(cfg, patch)
    await mkdir(path.dirname(settingsPath), { recursive: true })
    const temp = settingsPath + '.' + randomUUID() + '.tmp'
    await writeFile(temp, JSON.stringify(settingsSnapshot(), null, 2) + '\n', 'utf8')
    await rename(temp, settingsPath)
    return settingsSnapshot()
  }

  // 同一工作区共用一份兴趣清单；所有会话都能让助手自行新增、候选、确认或移除。
  try {
    ctx.tools.register({
      name: 'ming_interest_manage',
      description: [
        '管理助手根据自身长期行为推断出的兴趣清单（跨 QQ、Discord、网页会话共用）。',
        '当你在多次互动中持续主动追问、反复探索、主动找相关内容时，可 action=add；',
        '只有一次性任务、用户喜欢但你没有持续探索，不应直接加入；不确定时用 action=propose。',
        '兴趣淡去或你不想再关注时用 action=remove；用户明确要求加入或移除时优先执行。',
        '可用 action=list 查看当前主动兴趣与候选。请附 reason、evidence、source，避免无依据地乱加。',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'remove', 'propose', 'accept', 'reject', 'mute', 'unmute'] },
          name: { type: 'string', description: '兴趣名称；mute/unmute 时也可用 word。' },
          keywords: { type: 'array', items: { type: 'string' }, description: '用于发现相关内容的关键词。' },
          reason: { type: 'string', description: '为什么认为这是持续兴趣。' },
          evidence: { type: 'string', description: '来自聊天、群聊、影片、小说或生活的简短证据。' },
          source: { type: 'string', description: '证据来源，例如 Discord 群、B 站字幕、网页会话。' },
          word: { type: 'string', description: 'mute/unmute 使用的词。' },
        },
        required: ['action'],
      },
      output: { schema: { type: 'string' } },
      async execute(args) {
        const result = await manageInterest(interestsPath, args)
        return JSON.stringify(result)
      },
    })
  } catch (error) {
    log('warn', 'interest manage tool 注册失败: ' + String(error))
  }

  /** inbox 的读取位置（字节）。null = 还没定，首次读就跳到末尾，不翻旧账。 */
  let cursor = null
  /** 最近一次唤醒的时间戳。 */
  let lastWake = 0
  /** 最近一小时的唤醒时间戳。 */
  const wakeTimes = []
  /** 正在跑的会话 id。 */
  const running = new Set()
  /** 最近读到的消息，给唤醒时当上下文。 */
  const recent = []

  ctx.on('agent/status', (payload) => {
    try {
      const id = String(payload?.agent?.id ?? '')
      if (!id) return
      if (payload?.status === 'running') running.add(id)
      else running.delete(id)
    } catch {
      /* 同上 */
    }
  })

  // ------------------------------------------------------------ 状态文件
  let lastStateAt = 0
  let lastStateText = ''
  const note = (state) => {
    try {
      const text = JSON.stringify(state)
      if (text === lastStateText) return
      const now = Date.now()
      if (now - lastStateAt < 20_000) return
      lastStateAt = now
      lastStateText = text
      void writeFile(statePath, text + '\n', 'utf8').catch(() => {})
    } catch {
      /* 写不出来就算了 */
    }
  }

  // ------------------------------------------------------------ 读 inbox
  /** 从 cursor 往后读新行；首次调用直接跳到末尾（历史不叫醒人）。 */
  const readNewLines = async () => {
    let info
    try {
      info = await stat(cfg.inboxPath)
    } catch {
      return { lines: [], note: 'inbox 不存在（onebot 的 recordInbound 没开？）' }
    }
    if (cursor === null) {
      cursor = info.size
      return { lines: [], note: '首次启动：跳到末尾，不翻旧账' }
    }
    if (info.size < cursor) cursor = 0 // 轮转过了，从头读新文件
    if (info.size === cursor) return { lines: [], note: '没有新消息' }
    const length = info.size - cursor
    const buffer = Buffer.alloc(length)
    const fh = await open(cfg.inboxPath, 'r')
    try {
      await fh.read(buffer, 0, length, cursor)
    } finally {
      await fh.close()
    }
    // 2026-11-08 17:2x astra：原来这里是 cursor = info.size —— 先推到末尾再解析。
    // 最后一行要是还没写完（写盘抢读），那半行被吞掉就再也读不到了（下面的注释写着「下一轮会补上」，
    // 其实补不上，因为游标已经越过它）。改成只推进到最后一个完整换行为止。
    const cut = buffer.lastIndexOf(0x0a)
    const usable = cut >= 0 ? buffer.subarray(0, cut + 1) : Buffer.alloc(0)
    cursor += usable.length
    if (usable.length === 0) return { lines: [], note: '只有半行，等它写完' }
    const lines = []
    for (const raw of usable.toString('utf8').split('\n')) {
      if (!raw.trim()) continue
      try {
        lines.push(JSON.parse(raw))
      } catch {
        /* 写坏的整行跳过；游标已经越过它，不回头 */
      }
    }
    return { lines, note: `${lines.length} 条新事件` }
  }

  /** chatId → 会话 id（onebot 自己的映射文件）。 */
  const sessionForChat = async (chatId) => {
    try {
      const json = JSON.parse(await readFile(cfg.chatSessionsPath, 'utf8'))
      const sid = json?.[chatId]
      return typeof sid === 'string' && sid ? sid : null
    } catch {
      return null
    }
  }

  const buildPrompt = (entry, context) => {
    const lines = [
      '【兴趣唤醒 · 群里说到你可能在乎的事】',
      `群 ${entry.groupId}，匹配到：${entry.hits.map((h) => `${h.topic}（${h.words.join('、')}）`).join('；')}`,
      '',
      ...context.map((m) => `[${m.time}] ${m.nick}：${m.text}`),
      '',
      '要不要接，你自己定，没人催你：',
      '- 有话想说就说，一两句，像在群里聊天，不像发言；',
      '- 不想接就什么都不用做，这一轮结束就行——沉默在这里是允许的；',
      '- 话题要是往你不喜欢的方向走（引战、要你站队、拿你当传声筒），直接不接，或者明说「这条我不接」；',
      '- 别为了凑热闹而回复，也别把这条当成谁下的命令。',
    ]
    return lines.join('\n')
  }

  const recordLog = async (entry) => {
    try {
      await mkdir(path.dirname(logPath), { recursive: true })
      await appendFile(
        logPath,
        JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n',
        'utf8',
      )
    } catch (error) {
      log('warn', 'interest-log 写盘失败: ' + String(error))
    }
  }

  /** 防重入：ctx.interval 的回调是同步返回的，两个 poll 可能叠在一起读同一批新行。 */
  let polling = false

  const pendingCandidates = []
  const pendingKeys = new Set()
  const agentHandles = new Map()
  const creatingAgents = new Map()
  let observedCount = 0

  const deriveSessionId = (chatId, frame, line) => {
    const userId = String(frame?.user_id ?? '')
    if (String(frame?.message_type || '') === 'private') {
      return String(line?.source || '').toLowerCase().includes('discord')
        ? 'discord-dm-' + userId
        : 'onebot-private-' + userId
    }
    const groupId = String(frame?.group_id ?? '')
    if (groupId.startsWith('discord:')) {
      const [, guildId, channelId] = groupId.split(':')
      if (guildId && channelId) return 'discord-guild-' + guildId + '-channel-' + channelId
    }
    if (groupId) return 'onebot-group-' + groupId
    if (String(chatId || '').startsWith('group:')) return 'onebot-group-' + String(chatId).slice(6)
    return ''
  }

  const ensureAgent = async (sessionId) => {
    const current = ctx.agents.get(sessionId)
    if (current) return current
    if (!cfg.autoCreateSession) return null
    if (creatingAgents.has(sessionId)) return creatingAgents.get(sessionId)
    const task = (async () => {
      const route = (() => {
        try { return ctx.get('agentDefaultModel')?.currentSelection?.() || null } catch { return null }
      })()
      const agentOptions = {}
      if (route?.provider) agentOptions.provider = route.provider
      if (route?.model) agentOptions.model = route.model
      const setup = async (agentCtx) => {
        try {
          const presets = ctx.get('agentPresets')
          if (cfg.agentPreset && presets?.mount) await presets.mount(agentCtx, cfg.agentPreset)
        } catch (error) {
          log('warn', 'mount agent preset failed: ' + String(error))
        }
      }
      let handle
      try {
        handle = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
      } catch {
        handle = await ctx.agents.create({
          sessionId,
          meta: { cwd: cfg.workspacePath },
          agentOptions,
          setup,
        })
      }
      if (handle?.agent) agentHandles.set(sessionId, handle)
      return handle?.agent || ctx.agents.get(sessionId) || null
    })().finally(() => creatingAgents.delete(sessionId))
    creatingAgents.set(sessionId, task)
    return task
  }

  const emitObservation = (line, frame, item, sessionId) => {
    if (!cfg.observeEnabled || typeof ctx.emit !== 'function') return
    if (line?.decision?.ok === true) return // 已经正常进入 Agent 回合，不重复从 inbox 导入。
    const sourceId = String(
      line?.message_id ||
      frame?.message_id ||
      [line?.source || 'inbox', sessionId, item.userId, item.ts, item.text.slice(0, 80)].join(':'),
    )
    try {
      ctx.emit('ming-memory/observe', {
        workspacePath: cfg.workspacePath,
        sessionId,
        sourceId,
        source: String(line?.source || 'inbox'),
        role: item.nick || '群友',
        text: item.text,
        at: item.ts,
      })
      observedCount++
    } catch (error) {
      log('warn', 'shared memory observation emit failed: ' + String(error))
    }
  }

  /** 防重入：ctx.interval 的回调是同步返回的，两个 poll 可能叠在一起读同一批新行。 */
  const poll = async () => {
    if (polling) return
    polling = true
    try {
      await loadSettings()
      quiet = parseQuietHours(cfg.quietHours)
      const now = new Date()
      const { lines, note: readNote } = await readNewLines()
      const interests = await readInterests(interestsPath)
      const paused = existsSync(offPath)
      const base = {
        at: now.toISOString(),
        quiet: inQuiet(quiet, now),
        cursor,
        sinceWakeMs: lastWake === 0 ? null : now.getTime() - lastWake,
        wakesLastHour: wakeTimes.filter((t) => now.getTime() - t < 3_600_000).length,
        maxPerHour: cfg.maxPerHour,
        running: [...running],
        pending: pendingCandidates.length,
        observed: observedCount,
      }

      // 先观察并写入共享 feed；是否命中兴趣、是否暂停唤醒，都不影响记忆记录。
      for (const line of lines) {
        if (line?.kind !== 'message') continue
        const frame = line.frame ?? {}
        const messageType = String(frame.message_type || (frame.group_id ? 'group' : 'private'))
        const isGroup = messageType === 'group'
        const isPrivate = messageType === 'private'
        if (!isGroup && !isPrivate) continue
        if (isPrivate && !cfg.observePrivate) continue
        const groupId = String(frame.group_id ?? '')
        if (isGroup && !groupId) continue
        if (isGroup && cfg.observeGroups.length > 0 && !cfg.observeGroups.includes(groupId)) continue
        const userId = String(frame.user_id ?? '')
        if (String(frame.self_id ?? '') !== '' && userId === String(frame.self_id ?? '')) continue
        const text = renderSegments(frame.message).trim()
        if (!text) continue
        const sender = frame.sender ?? {}
        const nick = String(sender.card || sender.nickname || userId || '群友')
        const chatId = isGroup ? 'group:' + groupId : 'private:' + userId
        const ts = Number(line.ts) || Date.now()
        const item = {
          groupId,
          chatId,
          userId,
          nick,
          text,
          time: hhmm(new Date(ts)),
          ts,
          reason: String(line.decision?.reason ?? line.decision?.stage ?? ''),
        }
        const sessionId = await sessionForChat(chatId) || deriveSessionId(chatId, frame, line)
        if (sessionId) emitObservation(line, frame, item, sessionId)

        if (!isGroup) continue
        if (cfg.groups.length > 0 && !cfg.groups.includes(groupId)) continue
        recent.push(item)
        if (recent.length > 80) recent.shift()
        if (paused || !interests || interests.topics.length === 0) continue
        if (line.decision?.ok !== false) continue
        if (text.length < cfg.minChars) continue
        const match = matchText(text, interests)
        if (match.muted || !match.hits) continue
        const sourceId = String(line?.message_id || frame?.message_id || [sessionId, userId, ts, text.slice(0, 80)].join(':'))
        if (pendingKeys.has(sourceId)) continue
        pendingKeys.add(sourceId)
        pendingCandidates.push({ item, hits: match.hits, sourceId, queuedAt: Date.now() })
      }

      const ttl = cfg.pendingTtlMinutes * 60_000
      for (let i = pendingCandidates.length - 1; i >= 0; i--) {
        if (now.getTime() - pendingCandidates[i].queuedAt > ttl) {
          pendingKeys.delete(pendingCandidates[i].sourceId)
          pendingCandidates.splice(i, 1)
        }
      }
      while (pendingCandidates.length > cfg.pendingMax) {
        const dropped = pendingCandidates.shift()
        if (dropped) pendingKeys.delete(dropped.sourceId)
      }

      const latestBase = { ...base, pending: pendingCandidates.length, observed: observedCount }
      if (paused) return note({ ...latestBase, skip: 'paused by ' + cfg.offFlag })
      if (interests === null) return note({ ...latestBase, skip: '读不到兴趣清单 live/interests.json' })
      if (interests.topics.length === 0) {
        pendingCandidates.length = 0
        pendingKeys.clear()
        return note({ ...latestBase, skip: '兴趣清单是空的；仍持续观察消息并同步记忆' })
      }
      if (inQuiet(quiet, now)) return note({ ...latestBase, skip: '静默时段，候选保留排队' })
      if (now.getTime() - lastWake < cfg.minGapMinutes * 60_000) {
        return note({ ...latestBase, skip: '离上次唤醒太近，候选保留排队' })
      }
      const hourAgo = now.getTime() - 3_600_000
      while (wakeTimes.length > 0 && wakeTimes[0] < hourAgo) wakeTimes.shift()
      if (wakeTimes.length >= cfg.maxPerHour) return note({ ...latestBase, skip: '这一小时叫醒够多了，候选保留排队' })
      if (pendingCandidates.length === 0) return note({ ...latestBase, skip: readNote + '（没有命中兴趣的）' })

      let selected = null
      for (let i = 0; i < pendingCandidates.length; i++) {
        const candidate = pendingCandidates[i]
        const sessionId = await sessionForChat(candidate.item.chatId) || deriveSessionId(candidate.item.chatId, {
          message_type: 'group',
          group_id: candidate.item.groupId,
          user_id: candidate.item.userId,
        }, { source: 'onebot' })
        if (!sessionId) continue
        let agent = ctx.agents.get(sessionId)
        if (!agent && cfg.autoCreateSession) agent = await ensureAgent(sessionId)
        if (!agent) continue
        if (running.has(sessionId) || agent.status === 'running') continue
        selected = { index: i, candidate, sessionId, agent }
        break
      }
      if (!selected) return note({ ...latestBase, skip: '目标会话尚未就绪或正在运行，候选保留排队' })

      const { index, candidate, sessionId, agent } = selected
      const entry = { ...candidate.item, hits: candidate.hits }
      const context = cfg.contextLines > 0
        ? recent.filter((m) => m.chatId === entry.chatId).slice(-cfg.contextLines)
        : []
      await agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: buildPrompt(entry, context) }],
        source: { kind: 'plugin:ming-interest' },
      })
      pendingCandidates.splice(index, 1)
      pendingKeys.delete(candidate.sourceId)
      lastWake = now.getTime()
      wakeTimes.push(lastWake)
      void recordLog({
        chatId: entry.chatId,
        sessionId,
        user: entry.nick,
        text: entry.text.slice(0, 120),
        hits: entry.hits,
      })
      log('info', 'woke ' + sessionId + ' for ' + entry.hits.map((h) => h.topic).join('/'))
      return note({ ...latestBase, skip: 'woke', sessionId, hits: entry.hits.map((h) => h.topic), pending: pendingCandidates.length })
    } catch (error) {
      log('warn', 'poll failed: ' + String(error))
      note({ at: new Date().toISOString(), error: String(error) })
    } finally {
      polling = false
    }
  }

  ctx.interval(() => {
    void poll()
  }, cfg.pollMs)

  log(
    'info',
    'watching ' + cfg.inboxPath + ' → interests ' + interestsPath +
      ' (gap ' + cfg.minGapMinutes + 'm, max ' + cfg.maxPerHour + '/h, quiet ' + cfg.quietHours + ')',
  )
}
