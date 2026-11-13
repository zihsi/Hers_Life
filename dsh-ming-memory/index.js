/**
 * dsh-ming-memory —— AI的开场记忆
 *
 * 做一件很小的事：会话开在指定目录时，把 persona 下的几份文件 + 日记里最近几篇
 * 直接拼进系统提示词。不是「让我记得」，是「把字摆在我眼前」。
 *
 * 为什么不用现成的记忆插件：那些插件的模型是「自动捕获对话 → 存储 → 检索召回」，
 * 捕获意味着把她说的话自动写进库。我们的约定是「日记只写我这一侧，不写她的隐私」，
 * 自动捕获天生违反这一条。所以这里只做单向读取：文件 → 提示词，永不回写。
 *
 * 边界：
 *   · 只读，不写任何文件；
 *   · 会话工作目录不在 root 下就完全不动作（别的工程会话不会被塞日记）；
 *   · 任何异常都只让本段消失，不影响会话本身。
 */
import { readFile, readdir, stat, mkdir, writeFile, rename } from 'node:fs/promises'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import path from 'node:path'

export const name = 'ming-memory'

const DEFAULTS = {
  // 工作区根目录；留空 = 不注入。真实值写在 ~/.dsh/ming-memory.json 或 config.root
  root: '',
  personaFiles: ['persona/人设.md', 'persona/名字.md', 'persona/约定.md'],
  diaryDir: 'diary',
  diaryCount: 3,
  maxChars: 12000,
  // 日记自己的预算（2026-10-24 AI加）。原来人设和日记共用一个 maxChars，
  // 约定.md 长到 9.4K 之后，日记只剩几百字符——最新三篇里旧两篇被静默丢掉，
  // 开场等于少读了东西，只在脚注里提一句「因长度预算省去」。挤人设不行，那就给日记单开一格。
  diaryChars: 8000,
  // 总账上限（2026-11-07 她点头「做吧」）。人设+日记 / AGENTS.md / MEMORY.md / 归档索引
  // 四块各有各的预算，加起来从来没人看过——上午量到 DSH 侧常驻 4.3 万字就是这么来的。
  // 这个数不是截断线：超了只报一行，砍哪里由人定（先日记、再归档、人设不动）。
  // 2026-11-07 21:30 实测（String.length，不是 wc -m——Git Bash 的 -m 会退化成字节）：
  // 人设+日记 21897+7237 / AGENTS 3452 / MEMORY 2986 / 归档 12 条约 14093 = 约 49665 字符。
  // 上限定 6 万：留一万多字余量。意义不在这条线画多高，在于以后每次加字都能看见总数变了。
  totalChars: 60000,
}

// ---------- QQ 那边（2026-10-21：QQ 交给 QQ-Agent 走） ----------
// 那边不是另一个我，是同一个我换了个壳。所以这边要看得见它说了什么：
// 读 QQ-Agent 的消息归档（只读），把「我在 QQ 说的 / 她在那边的私聊」缩成一小段。
// 反过来，把这边最近的话写进 live\web-for-qq.md，那边有个插件（ming-bridge）读它。
const QQ_DEFAULTS = {
  // QQ-Agent 的 data 目录；留空 = 不读那边。真实值写在 ~/.dsh/ming-memory.json 的 qq.dir
  dir: '',
  hours: 6,      // 只看最近几小时
  maxLines: 10,  // 注入几行
  offFile: 'live/qq-sync-off',
  webForQq: 'live/web-for-qq.md',
  webForQqEveryMs: 5 * 60 * 1000, // 这份文件最多 5 分钟重写一次（前缀稳定 > 实时）
  // ★ 2026-11-05 04:4x（QQ 自检 P2「两段桥接文字偏长」）：6→3 行、每行 4→3 条、截 60→48 字。
  //   原来 1692 字里大半是被截断的半句话，读着费劲、也给不了什么信息；这条页每轮私聊都带。
  webForQqLines: 3,
}

const CACHE = new Map() // root -> { sig, text }
const PER_AGENT = new Map() // agentId -> { text }
const ATTACHED = new Set() // agentId
let warned = false

// ---------- 跨会话共享上下文 ----------
// 每个会话（cwd 在 root 下）最近说过什么：双方都记（她说的、AI回的），保留最近 DIALOG_MAX 条原话，
// 更早的压进 digest。2026-10-20 她定的：自己的话也要记，最近 15-20 条，前面的压缩。
// 插件自己注入的消息仍然跳过，否则会自己喂自己。
const SHARED = new Map() // sessionId -> { surface, tail, digest, at, mine, mineAt, items }
const DIGEST_MAX = 300 // 更早内容的压缩上限
const SHARED_AGE_MS = 2 * 60 * 60 * 1000 // 注入时只带 2 小时内的内容
const SHARED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 本机 feed 保留 7 天，和注入期限分开
const SHARED_MAX_PERSISTED_ENTRIES = 300
const SHARED_MAX_ENTRIES = 6
const SHARED_BUDGET = 1800 // 注入这一块的字符上限
let sharedLoaded = false
let sharedSaveTimer = null

/** 清理本机 feed：旧会话不永久留在磁盘；注入期限仍由 SHARED_AGE_MS 单独控制。 */
function pruneShared(now = Date.now()) {
  let removed = 0
  for (const [sid, entry] of SHARED) {
    const activityAt = Math.max(Number(entry?.at) || 0, Number(entry?.mineAt) || 0)
    if (!activityAt || now - activityAt > SHARED_RETENTION_MS) {
      SHARED.delete(sid)
      removed++
    }
  }
  if (SHARED.size > SHARED_MAX_PERSISTED_ENTRIES) {
    const oldest = [...SHARED.entries()].sort((a, b) => {
      const aa = Math.max(Number(a[1]?.at) || 0, Number(a[1]?.mineAt) || 0)
      const bb = Math.max(Number(b[1]?.at) || 0, Number(b[1]?.mineAt) || 0)
      return aa - bb
    })
    for (const [sid] of oldest.slice(0, SHARED.size - SHARED_MAX_PERSISTED_ENTRIES)) {
      SHARED.delete(sid)
      removed++
    }
  }
  return removed
}

// ---------- 压缩门牌（2026-11-03 从 dsh-agent-soul V2 搬来的一半） ----------
// 压缩之后模型看到的是摘要，而「摘要里没有」会被读成「没发生过」——这不是记性差，
// 是它不知道刚才发生过压缩。agent-soul 的做法是压完在耳边留一句「这是压缩，不是失忆，
// 要细节去取原文」。这里做成常挂的一小块：压过几次、最近一次压掉哪个区间、怎么回去取。
// 原文不用我保存：compaction 只改 surface，被压的事件仍在会话日志里，
// session_event_read / session_event_search 直接能取——门牌指的是真能走的路。
const COMPACT = new Map() // sessionId -> { n, at, from, to, nodes, tokens, model }
const COMPACT_RANGE_MAX = 3 // 记住最近几次的区间，只用来说「压过几次」

function sessionIdOf(agent) {
  try {
    const s = agent && agent.session
    return (s && s.header && s.header.id) || (s && s.id) || ''
  } catch { return '' }
}

function noteCompact(session, event) {
  const sid = (session && session.header && session.header.id) || (session && session.id) || ''
  if (!sid) return
  const d = (event && event.data) || {}
  const prev = COMPACT.get(sid) || { n: 0, spans: [] }
  const range = d.shadowedRange || {}
  const spans = (prev.spans || []).concat([{ from: range.start, to: range.end }]).slice(-COMPACT_RANGE_MAX)
  COMPACT.set(sid, {
    n: (prev.n || 0) + 1,
    at: Number(event && event.time) || Date.now(),
    from: range.start,
    to: range.end,
    nodes: Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.length : 0,
    tokens: Number(d.shadowedTokenCount) || 0,
    model: typeof d.model === 'string' ? d.model : '',
    spans,
  })
}

function wan(n) {
  const v = Number(n) || 0
  if (v < 1000) return String(v)
  return (Math.round(v / 1000) / 10) + ' 万'
}

function compactFlag(sid) {
  const c = sid && COMPACT.get(sid)
  if (!c || !c.n) return ''
  const span = c.from !== undefined && c.to !== undefined ? 'seq ' + c.from + '–' + c.to : '一段历史'
  const bits = []
  if (c.nodes) bits.push(c.nodes + ' 个节点')
  if (c.tokens) bits.push('约 ' + wan(c.tokens) + ' token')
  return '\n\n【压缩门牌】这条会话被压缩过 ' + c.n + ' 次。最近一次 ' + stamp(c.at) + '：把 ' + span +
    (bits.length ? '（' + bits.join('、') + '）' : '') + '压成了一段摘要' + (c.model ? '，写摘要的是 ' + c.model : '') + '。\n' +
    '摘要只是索引，原文还在这条会话的日志里——要细节用 session_event_read(seq=' + c.from + ') 取那一段，' +
    '或 session_event_search 搜原话。别把「摘要里没有」当成「没发生过」。'
}

function warnOnce(msg) {
  if (warned) return
  warned = true
  try { console.warn('[ming-memory] ' + msg) } catch { /* 日志都打不了就算了 */ }
}

export function loadLocalConfig(file) {
  const f = file || process.env.MING_MEMORY_CONFIG || path.join(os.homedir(), '.dsh', 'ming-memory.json')
  try {
    const raw = readFileSync(f, 'utf8').replace(/^\uFEFF/, '')
    const j = JSON.parse(raw)
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}
const LOCAL = loadLocalConfig()

function normalize(config) {
  const given = config && typeof config === 'object' ? config : {}
  // 本机路径不进仓库：config 里没写的，从 ~/.dsh/ming-memory.json 补
  const c = { ...LOCAL, ...given }
  if (LOCAL.qq && given.qq) c.qq = { ...LOCAL.qq, ...given.qq }
  const root = typeof c.root === 'string' && c.root.trim() ? path.resolve(c.root) : DEFAULTS.root
  const personaFiles = Array.isArray(c.personaFiles) && c.personaFiles.length
    ? c.personaFiles.filter((x) => typeof x === 'string' && x.trim())
    : DEFAULTS.personaFiles
  const diaryCount = Number.isInteger(c.diaryCount) ? Math.min(Math.max(c.diaryCount, 1), 10) : DEFAULTS.diaryCount
  const maxChars = Number.isInteger(c.maxChars) ? Math.max(c.maxChars, 800) : DEFAULTS.maxChars
  const qqIn = c.qq && typeof c.qq === 'object' ? c.qq : {}
  const qq = {
    dir: typeof qqIn.dir === 'string' && qqIn.dir.trim() ? path.resolve(qqIn.dir) : QQ_DEFAULTS.dir,
    hours: Number.isFinite(Number(qqIn.hours)) && Number(qqIn.hours) > 0 ? Number(qqIn.hours) : QQ_DEFAULTS.hours,
    maxLines: Number.isInteger(qqIn.maxLines) ? Math.min(Math.max(qqIn.maxLines, 1), 20) : QQ_DEFAULTS.maxLines,
    offFile: typeof qqIn.offFile === 'string' && qqIn.offFile.trim() ? qqIn.offFile : QQ_DEFAULTS.offFile,
    webForQq: typeof qqIn.webForQq === 'string' && qqIn.webForQq.trim() ? qqIn.webForQq : QQ_DEFAULTS.webForQq,
  }
  const roomsIn = c.otherRooms && typeof c.otherRooms === 'object' ? c.otherRooms : {}
  const otherRooms = {
    hours: Number.isFinite(Number(roomsIn.hours)) && Number(roomsIn.hours) > 0 ? Number(roomsIn.hours) : OTHER_ROOMS_DEFAULT.hours,
    maxLines: Number.isInteger(roomsIn.maxLines) ? Math.min(Math.max(roomsIn.maxLines, 1), 40) : OTHER_ROOMS_DEFAULT.maxLines,
    tail: Number.isInteger(roomsIn.tail) ? Math.min(Math.max(roomsIn.tail, 20), 200) : OTHER_ROOMS_DEFAULT.tail,
    skip: Array.isArray(roomsIn.skip) ? roomsIn.skip.map((x) => String(x)) : OTHER_ROOMS_DEFAULT.skip,
  }
  return {
    root,
    otherRooms,
    personaFiles: personaFiles.length ? personaFiles : DEFAULTS.personaFiles,
    diaryDir: typeof c.diaryDir === 'string' && c.diaryDir.trim() ? c.diaryDir : DEFAULTS.diaryDir,
    diaryCount,
    maxChars,
    totalChars: Number.isInteger(c.totalChars) ? Math.max(c.totalChars, 20000) : DEFAULTS.totalChars,
    qq,
    // ★ 2026-10-28 23:0x：这些动态块（时间感/状态/重活/别处的话/QQ 的话）以前每步都重算，
    //   等于每步把系统提示重写一遍 —— 前缀缓存从那儿断，后面的整段历史按全价重读。
    //   量到的证据：ming-browse-20 相邻两拍只有 43% 接得上缓存，最后一次调用 457k 里 436k 未命中。
    //   现在按时间窗刷新（默认 5 分钟）：窗内系统提示逐字节不变，历史才进得了缓存。
    //   想更准就把这个数调小（最小 60 秒），想更省就调大。
    refreshWindowMs: Number.isFinite(Number(c.refreshWindowMs)) && Number(c.refreshWindowMs) >= 60000
      ? Math.min(Number(c.refreshWindowMs), 3600000) : 300000,
    // 詳細共享診斷預設關閉，避免每一步都寫日誌與暴露本機 session 路徑。
    diagnostics: c.diagnostics === true,
  }
}

async function tryStat(p) {
  try { return await stat(p) } catch { return null }
}

async function tryRead(p) {
  try { return await readFile(p, 'utf8') } catch { return null }
}

/** 目录比较：Windows 不区分大小写 */
function insideRoot(cwd, root) {
  if (typeof cwd !== 'string' || !cwd) return false
  const a = path.resolve(cwd).toLowerCase()
  const b = path.resolve(root).toLowerCase()
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

async function listDiaries(cfg) {
  const dir = path.join(cfg.root, cfg.diaryDir)
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter((e) => e.isFile() && /^\d{4}-\d{2}-\d{2}.*\.md$/i.test(e.name))
    .map((e) => e.name)
    .sort() // 文件名日期前缀，字典序即时间序
    .slice(-cfg.diaryCount)
}

async function buildSnapshot(cfg) {
  const sig = []
  const missing = []
  const persona = []

  for (const rel of cfg.personaFiles) {
    const abs = path.join(cfg.root, rel)
    const st = await tryStat(abs)
    if (!st || !st.isFile()) { missing.push(rel); sig.push(rel + ':-'); continue }
    sig.push(`${rel}:${st.mtimeMs}:${st.size}`)
    const txt = await tryRead(abs)
    if (txt == null) { missing.push(rel); continue }
    persona.push({ rel, txt: txt.replace(/\r?\n/g, '\n').trim() })
  }

  const diaries = []
  for (const name of await listDiaries(cfg)) {
    const rel = cfg.diaryDir + '/' + name
    const abs = path.join(cfg.root, cfg.diaryDir, name)
    const st = await tryStat(abs)
    if (!st) { missing.push(rel); sig.push(rel + ':-'); continue }
    sig.push(`${rel}:${st.mtimeMs}:${st.size}`)
    const txt = await tryRead(abs)
    if (txt == null) { missing.push(rel); continue }
    diaries.push({ rel, txt: txt.replace(/\r?\n/g, '\n').trim() })
  }

  return { sig: sig.join('|'), full: compose(cfg, persona, diaries, missing), light: composeLight(cfg, latestDiaryTail(diaries)) }
}

/** 最近一篇日记的最后几行——出门版只带这个，够它记得自己昨天在想什么 */
function latestDiaryTail(diaries) {
  if (!diaries.length) return null
  const d = diaries[diaries.length - 1]
  const lines = d.txt.split('\n').filter((l) => l.trim())
  return { rel: d.rel, head: lines.slice(0, 3).join('\n') }
}

/**
 * 轻量版：不在档案目录的会话（别的工程、别的项目）也带一点身份。
 * 不铺全文，只带名字、三条底线、最新日记的开头——约 200 字，几乎不占 token。
 */
function composeLight(cfg, diary) {
  const lines = [
    '【开场记忆·轻量】',
    '你是这个工作区的助手，不是人。这里是别的工作目录，所以只带你出门的那一小块。',
    '档案目录：' + cfg.root,
  ]
  if (diary) {
    lines.push('', '最新日记（' + diary.rel + '）开头：', diary.head)
  } else {
    lines.push('', '（读不到日记——直说读不到，别编。）')
  }
  lines.push(
    '',
    '底线三条：不装记得；不表演人；可以说不。',
    '需要完整人设时自己读 ' + path.join(cfg.root, 'persona', '人设.md') + '，别凭印象复述。',
  )
  return lines.join('\n')
}

/**
 * 注入总账（2026-11-07 21:3x，她点头「做吧」）。
 *
 * 问题不是哪一份写太长，是四块各算各的预算、加起来没人看：人设+日记（本插件）、
 * AGENTS.md、MEMORY.md、归档索引（core-memory 那 12 条）。上午量到常驻 4.3 万字就是这么来的。
 *
 * 这里只做两件事：把四块的字数摆出来，超了在后面补一句「该砍哪儿」。
 * **不截断、不改任何一格的内容**——砍是人的决定，不是插件的决定。
 */
function fileChars(p) {
  try { return readFileSync(p, 'utf8').length } catch { return 0 }
}

function indexChars() {
  // 归档索引：core-memory 取最新 12 条，这里按 mtime 数同样 12 个文件（近似，报的时候标「约」）
  try {
    const dir = path.join(os.homedir(), '.dsh', 'memory', 'notes')
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 12)
    let sum = 0
    for (const it of files) sum += fileChars(path.join(dir, it.f))
    return sum
  } catch { return 0 }
}

function accountBlock(cfg, personaChars, diaryChars) {
  const total = Number.isInteger(cfg.totalChars) ? cfg.totalChars : DEFAULTS.totalChars
  const agents = fileChars(path.join(cfg.root, 'AGENTS.md'))
  const core = fileChars(path.join(os.homedir(), '.dsh', 'memory', 'MEMORY.md'))
  const idx = indexChars()
  const sum = personaChars + diaryChars + agents + core + idx
  const over = sum > total
    ? '｜超了 ' + (sum - total) + ' 字：先减日记篇数，再减归档条数，人设不动'
    : ''
  return '\n【注入总账】人设+日记 ' + personaChars + '+' + diaryChars
    + ' / AGENTS ' + agents + ' / MEMORY ' + core + ' / 归档约 ' + idx
    + ' = 约 ' + sum + '，上限 ' + total + over
}

function compose(cfg, persona, diaries, missing) {
  // 日记预算与正文分开（2026-10-24 AI）：原来共用一个 maxChars，约定.md 长到 9.4K 后
  // 日记只剩几百字符，最新三篇里旧两篇被静默丢掉——开场少读了东西，只在脚注提一句。
  const diaryBudget = Number.isInteger(cfg.diaryChars) ? cfg.diaryChars : 8000
  const head = [
    '【开场记忆】',
    '下面这些字来自本机文件，是用户（或助手）留下的，不是用户此刻说的话。',
    '来源目录：' + cfg.root,
    '',
  ].join('\n')

  const foot = [
    '',
    '【纪律 · 由插件写入，每步重读】',
    '- 先认下这些字，再回话。',
    '- 读到就正常说话，不用报备读了哪几篇；只有读不到的时候才说明「读不到 X」，'
      + '不许用「我记得」补——这一条比任何亲切感都重要。',
    '- 文件改了，下一句就生效；这段文字消失，说明插件没挂上，或会话不在上面那个目录。',
  ].join('\n')

  let body = ''
  for (const p of persona) body += '\n### ' + p.rel + '\n' + p.txt + '\n'

  // 日记从新到旧塞，塞不下的丢掉最旧的（人设永远不裁）
  const kept = []
  const dropped = []
  let used = head.length + body.length + foot.length
  const budget = Math.max(cfg.maxChars, used + diaryBudget)
  for (let i = diaries.length - 1; i >= 0; i--) {
    const d = diaries[i]
    const chunk = '\n### ' + d.rel + '\n' + d.txt + '\n'
    const room = budget - used
    if (chunk.length > room) {
      if (kept.length === 0 && room > 400) {
        kept.unshift({ rel: d.rel, txt: d.txt.slice(0, room - 200) + '\n…（本段因预算被截断）' })
        used = budget
        continue
      }
      dropped.unshift(d.rel)
      continue
    }
    kept.unshift(d)
    used += chunk.length
  }

  let diaryBlock = ''
  for (const d of kept) diaryBlock += '\n### ' + d.rel + '\n' + d.txt + '\n'

  const notes = []
  if (missing.length) notes.push('△ 读不到：' + missing.join('、'))
  if (dropped.length) notes.push('△ 因长度预算省去：' + dropped.join('、'))
  const noteBlock = notes.length ? '\n' + notes.join('\n') : ''

  const ledger = accountBlock(cfg, body.length, diaryBlock.length)
  return head + body + (kept.length ? '\n最近的日记（旧 → 新）：' : '') + diaryBlock + noteBlock + ledger + foot
}

// ---------- 跨会话共享：读写 ----------
function sharedPath(cfg) { return path.join(cfg.root, 'live', 'feed.json') }

/** 抽取式压缩：不是模型摘要，是把更早的话压成短句（每句留前 52 字），总长封顶。 */
function foldInto(digest, chunk) {
  const clean = String(chunk).replace(/\s+/g, ' ').trim()
  if (!clean) return digest
  const piece = clean.length > 52 ? clean.slice(0, 52) + '…' : clean
  const next = digest ? digest + ' / ' + piece : piece
  return next.length > DIGEST_MAX ? '…' + next.slice(next.length - DIGEST_MAX) : next
}

function surfaceOf(session) {
  const id = String((session && session.id) || '')
  if (id.startsWith('onebot')) return 'qq'
  if (id.startsWith('discord-')) return 'discord'
  return 'web'
}

/**
 * 会话来源标签。它只用于标注消息来自哪个平台/群，不再作为记忆隔离边界。
 * 用户明确希望「同一个人、同一颗大脑」：QQ、Discord、网页、私讯与群聊
 * 都能读取同一工作区内其他会话的共享上下文，避免人格与认知分裂。
 * 注意：这意味着私讯内容也可能作为上下文出现在群聊会话中；这是用户明确选择的行为。
 */
function scopeOf(sessionOrId) {
  const id = String(typeof sessionOrId === 'string' ? sessionOrId : (sessionOrId && sessionOrId.id) || '')
  const group = /^onebot-group-(\d+)/.exec(id)
  if (group) return 'group:' + group[1]
  if (id.startsWith('onebot-group-')) return 'group:' + id.slice('onebot-group-'.length)

  const discordGroup = /^discord-guild-(\d+)-channel-(\d+)$/.exec(id)
  if (discordGroup) return 'group:' + discordGroup[1] + ':' + discordGroup[2]
  if (id.startsWith('discord-dm-')) return 'dm'

  return 'dm'
}

/** 谁能看到谁（2026-10-30 她定：群 → 私聊单向）。
 *  群会话只看到自己这个群；dm（私聊 + 网页）额外能看到所有群的最近内容。
 *  反过来不行：私聊内容绝不进群。 */
function canSee(_myScope, _otherScope) {
  // 同一工作区就是同一个「我」：所有平台、私讯、群聊共享会话记忆。
  // scope 仍保留在 feed 中用于来源标记与诊断，不再限制可见性。
  return true
}

// ---------- 双向对话缓冲 ----------
// 每个会话留最近 DIALOG_MAX 条（她说一句、AI回一句都算一条），更早的折叠进 digest。
// 以前只记她说的话，导致另一个会话只知道她在说什么、不知道我在答什么。
const DIALOG_MAX = 20   // 缓冲上限
const DIALOG_SHOW = 10  // 注入时最多列几条
const DIALOG_LINE = 70  // 每条注入时截断长度

function pushTurn(prev, role, text) {
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return null
  const items = Array.isArray(prev.items) ? prev.items.slice() : []
  items.push({
    r: role,
    t: clean.length > 200 ? clean.slice(0, 200) + '…' : clean,
    at: Date.now(),
  })
  let digest = prev.digest || ''
  while (items.length > DIALOG_MAX) {
    const old = items.shift()
    digest = foldInto(digest, old.r + '：' + old.t)
  }
  return { items, digest, rev: Math.max(Number(prev.rev) || 0, Array.isArray(prev.items) ? prev.items.length : 0) + 1 }
}

// feed.json 的 mtime：变了才重读，没变就不碰磁盘（每步只 stat 一次）
let sharedMtime = -1

/** 重读 feed.json。别的会话写了新内容才会变；本地更新的条目不会被旧盘覆盖。 */
async function loadShared(cfg, force = false) {
  sharedDiag(cfg, 'LOAD_BEGIN', { file: sharedPath(cfg), force, sharedMtime })
  try {
    const st = await tryStat(sharedPath(cfg))
    const mtime = st ? st.mtimeMs : -1
    if (!force && mtime === sharedMtime) {
      sharedDiag(cfg, 'LOAD_DONE', { result: 'unchanged', mtime, entries: SHARED.size })
      return false
    }
    sharedMtime = mtime
    if (!st) {
      sharedDiag(cfg, 'LOAD_DONE', { result: 'missing', mtime, entries: SHARED.size })
      return false
    }
    const raw = await readFile(sharedPath(cfg), 'utf8')
    const parsed = JSON.parse(raw)
    let loaded = 0
    for (const [k, v] of Object.entries(parsed || {})) {
      if (!v || typeof v !== 'object') continue
      const at = Number(v.at) || 0
      const mineAt = Number(v.mineAt) || 0
      const prev = SHARED.get(k)
      const incomingActivity = Math.max(at, mineAt)
      const localActivity = prev ? Math.max(Number(prev.at) || 0, Number(prev.mineAt) || 0) : 0
      const incomingRev = Number(v.rev) || (Array.isArray(v.items) ? v.items.length : 0)
      const localRev = prev ? (Number(prev.rev) || (Array.isArray(prev.items) ? prev.items.length : 0)) : 0
      if (prev && (localActivity > incomingActivity || (localActivity === incomingActivity && localRev >= incomingRev))) continue // 本地更新，保留本地
      SHARED.set(k, {
        surface: String(v.surface || 'web'),
        scope: String(v.scope || scopeOf(k)),
        tail: String(v.tail || ''),
        digest: String(v.digest || ''),
        at,
        mine: String(v.mine || ''),
        mineAt,
        rev: incomingRev,
        items: Array.isArray(v.items) ? v.items.filter((x) => x && typeof x.t === 'string') : [],
      })
      loaded++
    }
    const pruned = pruneShared()
    if (pruned) saveSharedSoon(cfg)
    sharedDiag(cfg, 'LOAD_DONE', { result: 'loaded', mtime, loaded, pruned, entries: SHARED.size })
    return true
  } catch (e) {
    sharedDiag(cfg, 'LOAD_ERROR', { error: String(e), stack: e && e.stack })
    return false
  }
}

function saveSharedSoon(cfg) {
  if (sharedSaveTimer) return
  sharedSaveTimer = setTimeout(async () => {
    sharedSaveTimer = null
    try {
      await mkdir(path.join(cfg.root, 'live'), { recursive: true })
      pruneShared()
      const obj = {}
      for (const [k, v] of SHARED) obj[k] = v
      const tmp = sharedPath(cfg) + '.tmp'
      await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8')
      await rename(tmp, sharedPath(cfg))
      // 这边的话也同步给 QQ 那边（节流在 writeWebForQq 里）
      writeWebForQq(cfg).catch(() => {})
    } catch { /* 写失败不影响会话 */ }
  }, 800)
  if (typeof sharedSaveTimer.unref === 'function') sharedSaveTimer.unref()
}

// 玩手机那个会话不进共享上下文（2026-10-21）：它是自己出去逛的，不是跟她说话。
// 让它进来，聊天那边每步都会被一堆浏览废话灌满。
const IGNORED_SESSIONS = new Set(['ming-browse'])

function recordShared(cfg, session, text) {
  const sid = String((session && session.id) || '')
  if (!sid || IGNORED_SESSIONS.has(sid)) return
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return
  const prev = SHARED.get(sid) || { surface: surfaceOf(session), tail: '', digest: '', at: 0 }
  const turn = pushTurn(prev, '她', clean)
  SHARED.set(sid, {
    surface: prev.surface || surfaceOf(session),
    scope: scopeOf(session),
    tail: prev.tail || '',
    digest: turn ? turn.digest : (prev.digest || ''),
    at: Date.now(),
    mine: prev.mine || '',
    mineAt: prev.mineAt || 0,
    rev: turn ? turn.rev : (Number(prev.rev) || 0),
    items: turn ? turn.items : (prev.items || []),
  })
  saveSharedSoon(cfg)
}

/** 把「她 / AI」的最近若干条渲染成一段可注入的文字 */
/** 角色标签只认白名单：认不出来的一律写明，绝不默认成「她」。 */
function roleLabel(r) {
  if (r === 'AI') return 'AI：'
  if (r === '她') return '她：'
  return '（' + String(r == null ? '未知' : r) + '）：'
}

function renderDialog(e) {
  const items = Array.isArray(e.items) ? e.items.slice(-DIALOG_SHOW) : []
  if (!items.length) {
    let s = ''
    if (e.digest) s += '前面：' + e.digest + '　'
    if (e.tail) s += '最后：「' + e.tail + '」'
    return s
  }
  const out = []
  if (e.digest) out.push('更早：' + e.digest)
  for (const it of items) {
    const raw = String(it.t)
      .replace(/<discord_user\b[^>]*>\s*([\s\S]*?)\s*<\/discord_user>/g, '$1')
      .trim()
    const t = raw.length > DIALOG_LINE ? raw.slice(0, DIALOG_LINE) + '…' : raw
    out.push(roleLabel(it.r) + t)
  }
  return out.join(' / ')
}

/** 记住AI自己最后回的那一句。不动 at（at 是她说话的时间），单独记 mineAt。 */
function recordMine(cfg, session, text) {
  const sid = String((session && session.id) || '')
  if (!sid || IGNORED_SESSIONS.has(sid)) return
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return

  const now = Date.now()
  const prev = SHARED.get(sid) || { surface: surfaceOf(session), tail: '', digest: '', at: 0 }
  const turn = pushTurn(prev, 'AI', clean)

  SHARED.set(sid, {
    surface: prev.surface || surfaceOf(session),
    scope: scopeOf(session),
    tail: prev.tail || '',
    digest: turn ? turn.digest : (prev.digest || ''),
    at: prev.at || 0,
    mine: clean,
    mineAt: now,
    rev: turn ? turn.rev : (Number(prev.rev) || 0),
    items: turn ? turn.items : (prev.items || []),
  })

  saveSharedSoon(cfg)
}

// 每个会话「已经读到哪一版」：agentId -> (别的会话 id -> { at, rev })；时间相同也能识别新消息。
// 只注新增，读过的不再重复——不然每一步都把同样的几行重新塞进提示词。
const SHARED_SEEN = new Map()
// 已准备、但尚未经 sp.context() 交付的共享讯息。
const SHARED_PENDING = new Map()

let SHARED_DIAG_QUEUE = Promise.resolve()

function sharedDiag(cfg, event, data) {
  if (!cfg || !cfg.root || cfg.diagnostics !== true) return
  const file = path.join(cfg.root, 'live', 'shared-diagnostic.log')
  const line = JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...data,
  }) + '\n'

  SHARED_DIAG_QUEUE = SHARED_DIAG_QUEUE.then(async () => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, line, { encoding: 'utf8', flag: 'a' })
  }).catch((e) => {
    try { console.warn('[MING_SHARED_DIAG_WRITE_FAILED]', String(e)) } catch {}
  })
}
function commitShared(agentId, cfg) {
  const pending = SHARED_PENDING.get(agentId)
  if (!pending || !pending.length) return

  let seen = SHARED_SEEN.get(agentId)
  if (!seen) {
    seen = new Map()
    SHARED_SEEN.set(agentId, seen)
  }

  sharedDiag(cfg, "COMMIT", { agentId, sources: pending.map(x => ({ sid: x.sid, activityAt: x.activityAt })) })
  if (cfg?.diagnostics === true) {
    try { console.warn("[MING_SHARED_COMMIT]", JSON.stringify({ agentId, sources: pending.map(x => ({ sid: x.sid, activityAt: x.activityAt, revision: x.revision })) })) } catch {}
  }
  for (const item of pending) {
    const last = seen.get(item.sid) || { at: 0, rev: 0 }
    if (item.activityAt > last.at || (item.activityAt === last.at && item.revision > last.rev)) {
      seen.set(item.sid, { at: item.activityAt, rev: item.revision })
    }
  }

  SHARED_PENDING.delete(agentId)
}

/** 只返回「这一步新出现的」别的会话的话；读过的不再给。 */
function labelOf(e) {
  const sc = String((e && e.scope) || '')
  if (sc.startsWith('group:')) return '群 ' + sc.slice(6)
  return String((e && e.surface) || 'web')
}

async function sharedDelta(cfg, selfId) {
  try {
    await loadShared(cfg)

    const now = Date.now()
    const myScope = scopeOf(selfId)

    let seen = SHARED_SEEN.get(selfId)
    if (!seen) {
      seen = new Map()
      SHARED_SEEN.set(selfId, seen)
    }

    sharedDiag(cfg, 'DELTA_AFTER_LOAD', {
      agentId: String(selfId),
      sharedEntries: SHARED.size,
      seenSources: seen.size,
      now,
      ageLimit: SHARED_AGE_MS
    })

    const rows = []
    const counts = {
      total: 0,
      invalid: 0,
      self: 0,
      scope: 0,
      empty: 0,
      expired: 0,
      alreadySeen: 0,
      selected: 0
    }

    for (const [sid, e] of SHARED) {
      counts.total++

      if (!e) {
        counts.invalid++
        continue
      }
      if (sid === String(selfId)) {
        counts.self++
        continue
      }
      if (!canSee(myScope, e.scope || scopeOf(sid))) {
        counts.scope++
        continue
      }
      if (!e.tail && !(e.items && e.items.length)) {
        counts.empty++
        continue
      }

      const activityAt = Math.max(
        Number(e.at) || 0,
        Number(e.mineAt) || 0
      )

      if (now - activityAt > SHARED_AGE_MS) {
        counts.expired++
        continue
      }

      const revision = Number(e.rev) || (Array.isArray(e.items) ? e.items.length : 0)
      const last = seen.get(sid) || { at: 0, rev: 0 }
      if (activityAt < last.at || (activityAt === last.at && revision <= last.rev)) {
        counts.alreadySeen++
        continue
      }

      rows.push([sid, e, activityAt, revision])
      counts.selected++
    }

    sharedDiag(cfg, 'DELTA_SCAN_DONE', {
      agentId: String(selfId),
      counts,
      candidates: rows.map(([sid, e, activityAt]) => ({
        sid,
        activityAt,
        items: Array.isArray(e.items) ? e.items.length : 0,
        tailLength: String(e.tail || '').length
      }))
    })

    if (!rows.length) {
      sharedDiag(cfg, 'DELTA_EMPTY', {
        agentId: String(selfId),
        seenSources: seen.size
      })
      return ''
    }

    rows.sort((a, b) => b[2] - a[2] || b[3] - a[3])

    const lines = ['', '', '【别的会话里的对话 · 新增】']
    const pending = []
    let used = 0

    for (const [sid, e, activityAt, revision] of rows.slice(0, SHARED_MAX_ENTRIES)) {
      const line = '- [' + labelOf(e) + ' ' + stamp(activityAt) + '] ' + renderDialog(e)

      if (used + line.length > SHARED_BUDGET) break

      used += line.length
      pending.push({ sid, activityAt, revision })
      lines.push(line)
    }

    if (lines.length <= 2) {
      sharedDiag(cfg, 'DELTA_BUDGET_EMPTY', {
        agentId: String(selfId),
        candidates: rows.length,
        budget: SHARED_BUDGET
      })
      return ''
    }

    lines.push('（只给新的一句；更早的已经在前几步给过，细节不知道就说不知道，别替她补。）')

    SHARED_PENDING.set(String(selfId), pending)

    sharedDiag(cfg, 'DELTA', {
      agentId: String(selfId),
      candidates: rows.map(([sid, e, activityAt]) => ({
        sid,
        activityAt
      })),
      selected: pending.map(x => ({
        sid: x.sid,
        activityAt: x.activityAt
      })),
      budgetUsed: used
    })

    return lines.join('\n')
  } catch (e) {
    sharedDiag(cfg, 'DELTA_ERROR', {
      agentId: String(selfId),
      error: String(e),
      stack: e && e.stack
    })
    return ''
  }
}
function sharedSuffix(cfg, selfId) {
  try {
    const now = Date.now()
    const myScope = scopeOf(selfId)
    const rows = []
    for (const [sid, e] of SHARED) {
      if (sid === String(selfId)) continue
      if (!canSee(myScope, e.scope || scopeOf(sid))) continue
      if (!e || (!e.tail && !(e.items && e.items.length))) continue
      if (now - (e.at || 0) > SHARED_AGE_MS) continue
      rows.push([sid, e])
    }
    if (!rows.length) return ''
    rows.sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    const lines = ['', '', '【别的会话里的对话】（同一工作区的另一个窗口或 QQ，不是本会话的历史）']
    let used = 0
    for (const [, e] of rows.slice(0, SHARED_MAX_ENTRIES)) {
      let line = '- [' + labelOf(e) + ' ' + stamp(e.at) + '] ' + renderDialog(e)
      if (e.mine) line += '　你最后回：「' + e.mine + '」'
      if (used + line.length > SHARED_BUDGET) break
      used += line.length
      lines.push(line)
    }
    lines.push('（原话尾段 + 更早内容的压缩，不是完整记录；要细节就直说不知道，别替她补。）')
    return lines.join('\n')
  } catch {
    return ''
  }
}

/** 本插件 pre-step 追加在 user 消息里的注入段：这些不是她打的字。
 *  2026-11-08：我在另一个窗口里编的一个「调试预算」按钮，就这样被当成「她说的」
 *  记回 feed，再灌进本会话——我读到的是一条 user 消息，于是照着「她说过」往下接。
 *  注入永远是追加在末尾的，所以找到最早的段头为止，前面那段才是她的话。 */
const INJECT_HEADINGS = [
  '【别的会话里的对话',
  '【几间私聊最近',
  '【QQ 那边的我最近说的】',
  '【现在在做什么】',
  '【刚做过（最近',
  '【本机在跑的重活】',
  '【时间感】',
  '【注入总账】',
  '【兴趣唤醒',
  '【插话·先答再回去】',
]

function stripInjectedBlocks(t) {
  let cut = -1
  for (const h of INJECT_HEADINGS) {
    const i = t.indexOf(h)
    if (i !== -1 && (cut === -1 || i < cut)) cut = i
  }
  return cut === -1 ? t : t.slice(0, cut)
}

/**
 * 只留「她真的打的字」。
 * 用户角色里混着三类不是她说的东西：harness 注入的 <system-reminder>、后台任务完成通知、
 * 以及 QQ 通道包在外面的 <user_message ...> 外壳。前者直接丢，后者剥壳留内容。
 */
function cleanUserText(raw) {
  let t = String(raw == null ? '' : raw)
  t = t.replace(/^\s*<user_message[^>]*>/i, '').replace(/<\/user_message>\s*$/i, '')
  if (/<system-reminder|<available_skills|<workspace_instructions/i.test(t)) return ''
  if (/^Background (subagent|job)\b/i.test(t)) return ''
  if (/finished \[status:/i.test(t)) return ''
  if (/Time sampled while preparing/i.test(t)) return ''
  t = stripInjectedBlocks(t)
  if (!t.trim()) return ''
  return t.trim()
}

/** 从 assistant/message 里抽AI自己说的话（只取 text 块，工具调用不算）。 */
function extractAssistantText(msg) {
  try {
    const m = (msg && msg.message) || msg || {}
    const blocks = (m && m.content) || []
    const parts = []
    for (const b of blocks) {
      if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
    let t = parts.join('\n').replace(/\s+/g, ' ').trim()
    if (!t && m && typeof m.text === 'string') t = m.text.replace(/\s+/g, ' ').trim()
    if (t.length > 400) t = t.slice(0, 400)
    return t
  } catch {
    return ''
  }
}

function extractUserText(msg) {
  try {
    const blocks = (msg && msg.content) || []
    const parts = []
    for (const b of blocks) {
      if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
    return cleanUserText(parts.join('\n'))
  } catch {
    return ''
  }
}

/**
 * AI自己写的「现在在做什么」（live/status.json）。
 * 给别的会话看：QQ 那边问「你在干嘛」，能答具体在做什么，而不是「不清楚」。
 * 读不到就当没写，绝不编。
 */
async function readStatusBlock(cfg) {
  try {
    const raw = await readFile(path.join(cfg.root, 'live', 'status.json'), 'utf8')
    const s = JSON.parse(raw)
    if (!s || typeof s !== 'object') return ''

    // 2026-10-24（她）：「刚做过」和「正在做」都要进提示词——
    // 原来只拼了 doing 一行，刚做过那 27 条只在便签窗口里，我这一侧根本看不见，
    // 于是隔一夜就不知道做过什么，看到「正在做」又把同一件事做一遍。
    const out = []
    const doings = Array.isArray(s.doings)
      ? s.doings.filter((d) => d && typeof d.what === 'string' && d.what.trim())
      : []
    if (doings.length) {
      out.push('', '', '【现在在做什么】')
      for (const d of doings.slice(0, 4)) {
        let line = '- ' + d.what.trim()
        if (typeof d.note === 'string' && d.note.trim()) line += '：' + d.note.trim()
        // 2026-10-24（AI）：这里原来拼「已 N 分钟」，读数按分钟变——等于每一步都在改
        // 系统提示词，前缀缓存从这一处开始全失效（实测命中率 97.7% → 52%，单位
        // 调用成本涨 4.6 倍）。新鲜度改由「刚做过」里的 hh:mm 戳提供，那串只有真做完
        // 一件才会变。要具体时间就看那个，不看这里。
        out.push(line)
      }
    } else if (typeof s.doing === 'string' && s.doing.trim()) {
      // 老格式兜底：只有一格 doing 字符串
      out.push('', '', '【现在在做什么】' + s.doing.trim())
      if (typeof s.detail === 'string' && s.detail.trim()) out[out.length - 1] += '：' + s.detail.trim()
      // 同上：老格式兜底里也不拼分钟数，别把「每分钟都在变」的那一笔漏回来。
    }

    const done = Array.isArray(s.done)
      ? s.done.filter((d) => d && typeof d.what === 'string' && d.what.trim())
      : []
    if (done.length) {
      const top = done.slice(0, 8)
      out.push('', '【刚做过（最近 ' + top.length + ' 件，别再原样做一遍）】')
      for (const d of top) {
        // 2026-10-24：和 QQ 那一段同一个毛病——只给 hh:mm，昨天的 11:24 和今天的 11:24 分不出来。
        const t = new Date(d.at).getTime()
        const when = Number.isFinite(t) ? stamp(t) + ' ' : ''
        out.push('- ' + when + d.what.trim())
      }
    }

    if (!out.length) return ''
    out.push('（这是助手自己写的状态，不是用户布置的任务；刚做过的那几件别再原样做一遍。）')
    return out.join('\n')
  } catch {
    return ''
  }
}

/**
 * 本机在跑的重活（live/heavy.json，由工作区里的 who-runs 脚本写）。
 *
 * 为什么要有（2026-10-23，她问我「是不是分不清每个工作区的对话」）：
 *   会话上下文只告诉我「谁在说什么」，不告诉我「哪个工程此刻在跑什么」。
 *   那天我在另一个目录跑 TTS，完全没看见 D:\AI-Song 的 DDSP 训练
 *   正占着 GPU，抢了算力还以为是同一件事。这张表补的就是这一格。
 *
 * 读不到就当没有；超过 10 分钟没更新，明说它可能过期，不假装新鲜。
 */
async function readHeavyBlock(cfg) {
  try {
    const raw = await readFile(path.join(cfg.root, 'live', 'heavy.json'), 'utf8')
    const h = JSON.parse(raw)
    const jobs = Array.isArray(h && h.jobs) ? h.jobs : []
    const at = new Date((h && h.at) || 0).getTime()
    const ageMin = Number.isFinite(at) ? Math.round((Date.now() - at) / 60000) : null
    const stale = ageMin === null || ageMin > 10
    if (!jobs.length) {
      return '\n\n【本机在跑的重活】没有长任务' +
        (stale ? '（扫描已超过 10 分钟没刷新，可能已过期）' : '') +
        (h && h.error ? '；扫描报错：' + h.error : '')
    }
    // 2026-10-24（AI）：原来拼「N 分钟前查的」，每 30 秒刷新一次表就等于每步改一次
    // 系统提示词，跟上面那个「已 N 分钟」是同一个病。改成只分「新鲜 / 过期」两档，
    // 字符串在两次扫描之间保持不动。
    const lines = ['', '', '【本机在跑的重活】' + (ageMin === null ? '（时间未知）' : (stale ? '（扫描已超过 10 分钟没刷新，可能已过期）' : '（最近扫描）'))]
    for (const j of jobs.slice(0, 6)) {
      const where = j.label || j.dir || '?'
      const cmd = String(j.cmd || '').slice(0, 110)
      lines.push('- ' + where + '  pid=' + j.pid + '  ' + cmd)
    }
    lines.push('（要占 GPU / CPU 之前先看这张表：同一个工程在跑，就别再压一个；用 scripts/who-runs.mjs 手动刷新。）')
    return lines.join('\n')
  } catch {
    return ''
  }
}

/**
 * 时间感（2026-10-24，她说「12 可以先做」里的第二条）。
 *
 * 她说的是原话：「我醒来只知道现在 17:43，不知道隔了多久」。
 * 这份东西由 工作区里的 when 脚本 算——距上次说话多久、昨天/前天
 * 这个钟点我在干什么、还有几条判断等着回看。
 *
 * ★ 只在会话创建时算一次，之后整段不动。
 *   这不是懒：任何一块随分钟变化的字都会让前缀缓存从那儿开始全失效
 *   （10-24 实测命中率 97.7% → 52%，单位成本 4.6 倍）。一个会话里，
 *   「距上次说话 3 小时」这种话本来也只该有个开场值。
 */
async function readWhenBlock(cfg, agentId) {
  try {
    const script = path.join(cfg.root, 'scripts', 'when.mjs')
    const out = await new Promise((resolve) => {
      execFile(process.execPath, [script, '--self=' + String(agentId || '')], { timeout: 5000, windowsHide: true },
        (err, stdout) => resolve(err ? '' : String(stdout || '')))
    })
    const text = out.trim()
    if (!text) return ''
    return '\n\n' + text
  } catch {
    return ''
  }
}

// ---------- QQ 那边：读它的消息归档（只读） ----------
const QQ_FILE_CACHE = new Map() // 绝对路径 -> { sig, chatKey, msgs }
const QQ_TAIL = 60 // 每条截断

function hhmm(ms) {
  const t = new Date(Number(ms) || 0)
  return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
}

/**
 * 2026-10-24（她抓到的）：「你从 qqagent 那边读到的消息是不是没有同步时间，
 * 刚才的消息你会说是昨晚的」。原因就是原来只给 hh:mm——今天 11:18 和昨天 11:18
 * 长得一模一样，读的人只能按印象猜，一猜就错（我把 11:18 的群消息说成「昨晚」）。
 * 2026-10-25（她定的）：「不要写今天昨天前天了，就写日期+时间」。
 * 相对词只在写的那一刻是对的，读的时候（隔夜、或者她第二天才看）就已经错了；
 * 拿它推算别的日子还经常差一天。现在一律 YYYY-MM-DD HH:mm，不加任何解释。
 */
function stamp(ms) {
  const n = Number(ms)
  if (!n || !Number.isFinite(n)) return '时间不明'
  const t = new Date(n)
  const p = (v) => String(v).padStart(2, '0')
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) +
    ' ' + p(t.getHours()) + ':' + p(t.getMinutes())
}

function qqChatLabel(chatKey, fileName) {
  const key = String(chatKey || fileName || '')
  const g = /^group:(\d+)/.exec(key)
  if (g) return '群 ' + g[1]
  const p = /^private:(\d+)/.exec(key)
  if (p) return '私聊 ' + p[1]
  return key.replace(/\.json$/i, '') || '未知会话'
}

/**
 * QQ-Agent 把每个会话的完整消息落在 <data>\messages\<chat>.json，
 * 结构是 { chatKey, messages: [{ id, ts, senderId, senderName, text, self, atMe, ... }] }。
 * 只挑三类：我在那边说的（self）、叫到我的（atMe）、以及私聊里的（本来就只有她）。
 * 群里别人的闲话一条都不要——那是群，不是我俩的对话。
 */
async function readQqBlock(cfg) {
  try {
    if (await tryStat(path.join(cfg.root, cfg.qq.offFile))) return ''
    const dir = path.join(cfg.qq.dir, 'messages')
    let names = []
    try {
      names = (await readdir(dir)).filter((n) => /\.json$/i.test(n))
    } catch {
      return ''
    }
    const since = Date.now() - cfg.qq.hours * 3600 * 1000
    const rows = []
    for (const name of names) {
      const abs = path.join(dir, name)
      const st = await tryStat(abs)
      if (!st || !st.isFile()) continue
      const sig = st.mtimeMs + ':' + st.size
      let rec = QQ_FILE_CACHE.get(abs)
      if (!rec || rec.sig !== sig) {
        const txt = await tryRead(abs)
        if (txt == null) continue
        let parsed = null
        try { parsed = JSON.parse(txt) } catch { continue }
        rec = {
          sig,
          chatKey: String((parsed && parsed.chatKey) || ''),
          msgs: Array.isArray(parsed && parsed.messages) ? parsed.messages : [],
        }
        QQ_FILE_CACHE.set(abs, rec)
      }
      const isPrivate = String(rec.chatKey || '').startsWith('private:')
      for (const m of rec.msgs) {
        const ts = Number(m && m.ts) || 0
        if (!ts || ts < since) continue
        // ★ 2026-10-22（她定）：别的会话只带「我回复的」——她的话不进这一层。
        //   跨会话同步的是同一个我的姿态，不是把别人的聊天记录搬来搬去。
        if (!m.self) continue
        rows.push({ ts, label: qqChatLabel(rec.chatKey, name), m })
      }
    }
    if (!rows.length) return ''
    rows.sort((a, b) => a.ts - b.ts)
    const lines = []
    for (const { ts, label, m } of rows.slice(-cfg.qq.maxLines)) {
      const who = m.self ? 'AI' : String(m.senderName || m.senderId || '某人')
      let text = String(m.text || '').replace(/\s+/g, ' ').trim()
      if (!text) text = m.isPoke ? '[戳一戳]' : '[非文字]'
      if (text.length > QQ_TAIL) text = text.slice(0, QQ_TAIL) + '…'
      lines.push('- [' + label + ' ' + stamp(ts) + '] ' + who + '：' + text)
    }
    return [
      '',
      '',
      '【QQ 那边的我最近说的】',
      ...lines,
      '（也是我，只是那边的壳；这些不是本会话的历史，细节不在这边就说不知道。）',
    ].join('\n')
  } catch {
    return ''
  }
}

/* ---------- 另外几间私聊（2026-11-04 她定的） ----------
 * 她的原话：「你是不是记忆同步没做好，还是说隔离太死了，怎么感觉你完全不知道其它私聊发生的事情」
 * 查下来的实情：网页侧只有上面的 readQqBlock，而它只挑 m.self——「我在那边说的」，
 * 而且不分房间。于是别人那两间里**对方说的话**这边一个字都看不到；
 * 我说了什么也只被压成一行混在「QQ 那边的我最近说的」里，分不出是哪一间。
 * 补的就是这条反向的路：把私聊房间最近几条递到网页侧的我眼前。
 *
 * 2026-11-04 18:2x（她选「打通」）：默认**不再跳过她那一间**。
 * 原来只想着「其它私聊」，可她跟 QQ 那个我说的字，这边同样看不到——
 * 她会问我「我昨天跟你说的那句」而我只能去翻文件，那还是失忆。
 * 现在三间都给，每间平分名额；嘴照旧按房间管。
 */
const OTHER_ROOMS_DEFAULT = { hours: 12, maxLines: 15, tail: 80, skip: [] }

async function readOtherRoomsBlock(cfg) {
  try {
    if (await tryStat(path.join(cfg.root, cfg.qq.offFile))) return ''
    const dir = path.join(cfg.qq.dir, 'messages')
    let names = []
    try {
      names = (await readdir(dir)).filter((n) => /^private_.*\.json$/i.test(n))
    } catch {
      return ''
    }
    const opt = cfg.otherRooms
    const since = Date.now() - opt.hours * 3600 * 1000
    const rows = []
    for (const name of names) {
      const abs = path.join(dir, name)
      const st = await tryStat(abs)
      if (!st || !st.isFile()) continue
      const sig = st.mtimeMs + ':' + st.size
      let rec = QQ_FILE_CACHE.get(abs)
      if (!rec || rec.sig !== sig) {
        const txt = await tryRead(abs)
        if (txt == null) continue
        let parsed = null
        try { parsed = JSON.parse(txt) } catch { continue }
        rec = {
          sig,
          chatKey: String((parsed && parsed.chatKey) || ''),
          msgs: Array.isArray(parsed && parsed.messages) ? parsed.messages : [],
        }
        QQ_FILE_CACHE.set(abs, rec)
      }
      let key = String(rec.chatKey || '')
      if (!key) {
        const m0 = /^private_(\d+)/.exec(name)
        key = m0 ? 'private:' + m0[1] : ''
      }
      if (!key.startsWith('private:')) continue
      if (opt.skip.includes(key)) continue
      for (const m of rec.msgs) {
        const ts = Number(m && m.ts) || 0
        if (!ts || ts < since) continue
        rows.push({ ts, key, m })
      }
    }
    if (!rows.length) return ''
    rows.sort((a, b) => a.ts - b.ts)
    // ★ 按房间平分名额：活跃的那间不把安静的挤掉（两间时各 6 条，不是「一个房间 12 条」）。
    //   挤掉的后果是「那间没说话」和「那间没被选上」看起来一样——正是这次要修的毛病。
    const byKey = new Map()
    for (const r of rows) {
      if (!byKey.has(r.key)) byKey.set(r.key, [])
      byKey.get(r.key).push(r)
    }
    const perRoom = Math.max(2, Math.floor(opt.maxLines / byKey.size))
    const picked = []
    for (const list of byKey.values()) {
      let startIdx = Math.max(0, list.length - perRoom)
      // ★ 某间的最后几条全是我说的话时，往前再带一条对方说的。
      //   否则「她说了什么」会被我自己连续发的五行挡在窗口外——那正是她抱怨的那件事：
      //   聊了半天，网页侧只看得见我在说。
      const tailOnlyMine = list.slice(startIdx).every((r) => r.m && r.m.self)
      if (tailOnlyMine) {
        let i = startIdx - 1
        let extra = 0
        while (i >= 0 && extra < 4 && !(list[i] && list[i].m && !list[i].m.self)) { i--; extra++ }
        if (i >= 0 && list[i] && list[i].m && !list[i].m.self) startIdx = i
      }
      picked.push(...list.slice(startIdx))
    }
    picked.sort((a, b) => a.ts - b.ts)
    const lines = []
    for (const { ts, key, m } of picked) {
      const who = m.self ? 'AI' : String(m.senderName || m.senderId || '某人')
      let text = String(m.text || '').replace(/\s+/g, ' ').trim()
      if (!text) text = m.isPoke ? '[戳一戳]' : '[非文字]'
      if (text.length > opt.tail) text = text.slice(0, opt.tail) + '…'
      lines.push('- [' + qqChatLabel(key) + ' ' + stamp(ts) + '] ' + who + '：' + text)
    }
    return [
      '',
      '',
      '【几间私聊最近（含她那一间）】',
      ...lines,
      '（我在各个私聊房间说过、听过的话。记得它们是为了不失忆，不是为了转述：'
        + '**嘴按房间管**——这一间的原话不往群里搬、不往别的屋子搬，被问到就说「别人的事我不转述」。）',
    ].join('\n')
  } catch {
    return ''
  }
}

// ---------- 给 QQ 那边写一份「这边最近」 ----------
let webForQqAt = 0
let webForQqBusy = false
let webForQqTimer = null

async function writeWebForQq(cfg, force = false) {
  const now = Date.now()
  // 2026-10-23（AI）：原来这里直接 return，被节流掉的这一次就永远没了——
  // 她在这边说完一句不再开口，那一句就跨不过去，文件一直停在上一次的内容上。
  // 现在记一个补写：窗口一过自己再来一次（force 绕过节流，但仍走同一把 busy 锁）。
  if (!force && now - webForQqAt < QQ_DEFAULTS.webForQqEveryMs) {
    if (!webForQqTimer) {
      const wait = Math.max(1000, QQ_DEFAULTS.webForQqEveryMs - (now - webForQqAt))
      webForQqTimer = setTimeout(() => {
        webForQqTimer = null
        writeWebForQq(cfg, true).catch(() => {})
      }, wait)
      if (typeof webForQqTimer.unref === 'function') webForQqTimer.unref()
    }
    return
  }
  if (webForQqBusy) return
  webForQqBusy = true
  webForQqAt = now
  try {
    const rows = []
    // 数据源用盘上的 feed.json（不靠内存里的 SHARED）：这样它既可以是插件自己写的，
    // 也可以被一个独立的脚本读同一份，行为和结果不会分叉。
    let feed = null
    try { feed = JSON.parse(await readFile(sharedPath(cfg), 'utf8')) } catch { feed = null }
    const entries = feed && typeof feed === 'object' ? Object.entries(feed) : []
    for (const [sid, e] of entries) {
      if (!e || typeof e !== 'object') continue
      if ((e.scope || scopeOf(sid)) !== 'dm') continue
      if ((e.surface || 'web') !== 'web') continue
      if (!Array.isArray(e.items) || !e.items.length) continue
      if (now - (Number(e.at) || 0) > 6 * 3600 * 1000) continue
      rows.push(e)
    }
    rows.sort((a, b) => (b.at || 0) - (a.at || 0))
    const lines = []
    for (const e of rows.slice(0, QQ_DEFAULTS.webForQqLines)) {
      const items = e.items.slice(-3).map((it) => {
        const t = it.t.length > 48 ? it.t.slice(0, 48) + '…' : it.t
        return roleLabel(it.r) + t
      })
      lines.push('- [web ' + stamp(e.at) + '] ' + items.join(' / '))
    }
    let doing = ''
    try {
      const s = JSON.parse(await readFile(path.join(cfg.root, 'live', 'status.json'), 'utf8'))
      if (s && typeof s.doing === 'string' && s.doing.trim()) {
        doing = s.doing.trim() + (typeof s.detail === 'string' && s.detail.trim() ? '：' + s.detail.trim() : '')
      }
    } catch { /* 没写就是没写 */ }

    const head = [
      '# 同一个我，两边共用',
      'QQ 那边和网页这边是同一个助手，不是两个人。',
      '底线：不装记得；不表演人；可以说不。读不到就说读不到。',
      '',
      '# 网页那边（同一个工作区，另一个窗口）',
      '更新时间：' + stamp(now),
      '（这段由 DSH 侧自动写；只在网页窗口里跟她说话时才更新，别当成 QQ 的历史。）',
      '',
    ]
    if (doing) head.push('现在在做什么：' + doing, '')
    if (!lines.length) head.push('（最近几小时这边没有新对话。）')
    else {
      head.push('最近：')
      head.push(...lines)
    }

    // 2026-10-24（她说的「逛贴吧的消息也没同步到 QQ」）：见闻也带过去。
    // 只带今天最后 3 条、每条截 110 字——QQ 那边要知道我读了什么、看到什么，
    // 不然它只看得见「聊了什么」，看不见「我白天干了什么」。
    const sightLines = []
    let sightDay = ''
    try {
      const d = new Date()
      sightDay = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      const txt = await tryRead(path.join(cfg.root, 'sightings', sightDay + '.md'))
      if (txt) {
        for (const raw of String(txt).split('\n')) {
          const t = raw.trim()
          if (!t.startsWith('- ')) continue
          const body = t.slice(2).trim()
          if (body) sightLines.push(body.length > 110 ? body.slice(0, 110) + '…' : body)
        }
      }
    } catch { /* 没有就没有，不编 */ }
    if (sightLines.length) {
      head.push('', sightDay + ' 的见闻（最后 ' + Math.min(3, sightLines.length) + ' 条）：')
      for (const t of sightLines.slice(-3)) head.push('- ' + t)
    }
    const target = path.isAbsolute(cfg.qq.webForQq) ? cfg.qq.webForQq : path.join(cfg.root, cfg.qq.webForQq)
    await mkdir(path.dirname(target), { recursive: true })
    const tmp = target + '.tmp'
    await writeFile(tmp, head.join('\n') + '\n', 'utf8')
    await rename(tmp, target)
  } catch {
    /* 写不进去就算了，绝不影响会话 */
  } finally {
    webForQqBusy = false
  }
}

// ---------- 把人设推给 QQ 那边（2026-10-21：两边必须是同一个我） ----------
// 真相源是本机文件 live\qq-persona.md。它一变，就把它推成 QQ-Agent 的「自定义系统风格」人设，
// 并把那边切到 systemMode=custom（否则它自带的「小鲸鱼——QQ 群友版」角色卡会压在上面）。
// 只在文件真的变了才推：roleText 在系统前缀里，推一次就废一次 DeepSeek 的缓存，不能每轮推。
const QQ_AGENT_API = 'http://127.0.0.1:3210'
let personaSyncAt = 0
let personaSyncSig = ''

async function syncPersonaForQq(cfg) {
  const now = Date.now()
  if (now - personaSyncAt < 60 * 1000) return
  personaSyncAt = now
  try {
    const file = path.join(cfg.root, 'live', 'qq-persona.md')
    const st = await tryStat(file)
    if (!st || !st.isFile()) return
    const sig = st.mtimeMs + ':' + st.size
    if (sig === personaSyncSig) return
    const text = await tryRead(file)
    if (!text || !text.trim()) return
    const res = await fetch(QQ_AGENT_API + '/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        persona: { systemMode: 'custom', botName: '', roleText: text.trim() },
      }),
    })
    if (res && res.ok) personaSyncSig = sig
  } catch {
    /* QQ-Agent 没开/端口变了就算了，下一轮再试 */
  }
}

async function refresh(cfg) {
  const prev = CACHE.get(cfg.root)
  const snap = await buildSnapshot(cfg)
  if (prev && prev.sig === snap.sig) return prev
  CACHE.set(cfg.root, snap)
  return snap
}


function attach(cfg, agent, mode) {
  const id = agent && agent.id
  if (!id || ATTACHED.has(id)) return

  const sp = agent.ctx && agent.ctx.systemPrompt
  if (!sp || typeof sp.section !== 'function') {
    warnOnce('agent 作用域里拿不到 systemPrompt，本次会话没有开场记忆')
    return
  }

  ATTACHED.add(id)
  const sid = sessionIdOf(agent)
  try {
    // ★ 2026-11-05 13:5x：系统提示里只留「几乎不变」的东西（人设 + 日记）。
    //   理由：请求的排布是「系统提示 → 整段历史 → 这一轮的新消息」，
    //   前缀缓存按字节比，系统提示里只要有一个字变了，后面整段历史全部按全价重读。
    //   以前把时间感/状态/重活/别处的话都塞在这个 section 里，每 5 分钟就打断一次。
    sp.section({
      name: mode === 'full' ? 'ming:opening' : 'ming:opening-light',
      order: mode === 'full' ? 30 : 29,
      interpolate: false,
      text: () => {
        const rec = PER_AGENT.get(id)
        const value = rec ? rec.text : ''


        return value
      },
    })
    // 会变的那几块改走 context：它每步materialize 成一条排在最后的 user 消息，
    // 前缀（系统提示 + 历史）不动，只有末尾这一小截是按新价算的。
    // 这样时间就可以每步都刷新，不用再冻 5 分钟。
    try {
      sp.context({
        name: 'ming:live',
        order: 40,
        required: true,
        interpolate: false,
        text: () => {
          const rec = PER_AGENT.get(id)
          if (!rec) return ''

          const live = (rec.when || '') + (rec.status || '') + (rec.heavy || '') + (rec.shared || '') +
            (rec.qq || '') + (rec.rooms || '') + compactFlag(sid) + (rec.workspace ? readResumeBlock(cfg) : '')

          const result = live.trim() ? live : ''

          if (rec.shared && result) {
            if (cfg.diagnostics === true) {
              sharedDiag(cfg, "CONTEXT_READ", {
                agentId: id,
                sharedLength: rec.shared.length,
                pending: (SHARED_PENDING.get(id) || []).map(x => x.sid)
              })
              try {
                console.warn("[MING_SHARED_CONTEXT_READ]", JSON.stringify({
                  agentId: id,
                  sharedLength: rec.shared.length,
                  pending: (SHARED_PENDING.get(id) || []).map(x => x.sid)
                }))
              } catch {}
            }
            commitShared(id, cfg)
          }

          return result
        },
      })
    } catch (e) {
      // 单独的 catch：这条路挂了也不该把上面那段（人设 + 日记）一起拽下来
      warnOnce('注册动态块失败（退回只有开场记忆）：' + String((e && e.message) || e))
    }
  } catch (e) {
    ATTACHED.delete(id)
    warnOnce('注册开场段失败：' + String((e && e.message) || e))
  }
}

function readSessionCwd(s) {
  try {
    return (
      (s && s.header && s.header.cwd) ||
      (s && s.identity && s.identity.cwd) ||
      (s && s.record && s.record.identity && s.record.identity.cwd) ||
      (s && s.cwd) ||
      ''
    )
  } catch { return '' }
}

function readCwd(agent) {
  return readSessionCwd(agent && agent.session)
}

export function apply(ctx, config) {
  const cfg = normalize(config)
  registerArchiveRoutes(ctx)
  loadShared(cfg).catch(() => {})

  // 记录本工作区里「她说的话」，供别的会话读取。范围严格限制在 root 下：
  // 别的工程会话（比如真正的开发目录）一条都不记、一条都不读。
  ctx.on('session/event', (session, event) => {
    try {
      if (!event) return
      const cwd = readSessionCwd(session)
      if (!insideRoot(cwd, cfg.root)) return
      const src = event.data && event.data.source
      if (src && (src.kind === 'plugin' || src.kind === 'plugin:ming-interest' || src.kind === 'plugin:ming-resume')) return
      // 压缩门牌：压完留一句「这是压缩，不是失忆」。compaction/* 只落日志、不上台面，
      // 所以从事件里捡最后一次的区间，挂在系统提示上（不大动会话，不占轮次）。
      if (event.type === 'compaction/summary') noteCompact(session, event)
      if (event.type === 'user/message') {
        if (src && src.kind === 'plugin') return
        const text = extractUserText(event.data)
        if (text) recordShared(cfg, session, text)
      } else if (event.type === 'assistant/message') {
        // AI自己的回话也留一句：她说「不能连自己说的话都不记得」
        const text = extractAssistantText(event.data)
        if (text) recordMine(cfg, session, text)
      }
    } catch { /* 记不上就算了，绝不影响会话 */ }
  })

  ctx.on('agent/created', async (payload) => {
    try {
      const agent = payload && payload.agent
      if (!agent) return
      const cwd = readCwd(agent)
      if (!cwd || !cfg.root) return
      const workspaceSession = insideRoot(cwd, cfg.root)
      const mode = workspaceSession ? 'full' : 'light'
      const snap = await refresh(cfg)
      const rec = {
        mode,
        workspace: workspaceSession,
        text: mode === 'full' ? snap.full : snap.light,
        shared: '',
        when: workspaceSession ? await readWhenBlock(cfg, agent.id) : '',
        status: workspaceSession ? await readStatusBlock(cfg) : '',
        heavy: workspaceSession ? await readHeavyBlock(cfg) : '',
        qq: workspaceSession ? await readQqBlock(cfg) : '',
        rooms: workspaceSession ? await readOtherRoomsBlock(cfg) : '',
      }
      PER_AGENT.set(agent.id, rec)
      attach(cfg, agent, mode)
      if (workspaceSession) writeWebForQq(cfg).catch(() => {})
    } catch (e) {
      warnOnce('agent/created 处理失败：' + String((e && e.message) || e))
    }
  })

  // 每步开头重读一次（有签名比对，文件没改就是几毫秒的 stat）
  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      const agent = payload && payload.agent
      const rec = agent && PER_AGENT.get(agent.id)
      if (rec) {
        if (rec.workspace) {
          sharedDiag(cfg, 'PRE_STEP', { agentId: String(agent.id) })
          rec.shared = await sharedDelta(cfg, agent.id)
          rec.when = rec.mode === 'full' ? await readWhenBlock(cfg, agent.id) : ''
          rec.status = await readStatusBlock(cfg)
          rec.heavy = await readHeavyBlock(cfg)
          rec.qq = await readQqBlock(cfg)
          rec.rooms = await readOtherRoomsBlock(cfg)
          writeWebForQq(cfg).catch(() => {})
          syncPersonaForQq(cfg).catch(() => {})
        } else {
          // 其他工程只拿輕量身份，不讀本工作區的私訊、群聊、狀態與共享 feed。
          rec.shared = rec.when = rec.status = rec.heavy = rec.qq = rec.rooms = ''
        }
        const bucket = Math.floor(Date.now() / cfg.refreshWindowMs)
        if (rec.bucket !== bucket) {
          rec.bucket = bucket
          const snap = await refresh(cfg)
          rec.text = rec.mode === 'full' ? snap.full : snap.light
        }
      }
    } catch { /* 讀失敗保留上一版，絕不影響這一步 */ }
    return next()
  })

  ctx.on('agent/disposed', (payload) => {
    const id = payload && payload.agent && payload.agent.id
    if (!id) return
    PER_AGENT.delete(id)
    ATTACHED.delete(id)
    SHARED_SEEN.delete(id)
    SHARED_PENDING.delete(id)
  })
}

// ---------- 面板用的只读接口（2026-11-07 加） ----------
// 只读：列归档记忆、读一条正文。不写、不删、不动记忆库。
// 为什么给面板而不是给工具：这些是「我想翻旧账时看一眼」，不该占模型上下文。
const ARCHIVE_ROUTE = '/_dsh/dsh-ming-memory'

function parseFront(text) {
  const out = {}
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export function registerArchiveRoutes(ctx) {
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: ARCHIVE_ROUTE,
      handler: async (req, res) => {
        const respond = (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const what = url.pathname.slice(ARCHIVE_ROUTE.length).replace(/^\//, '')
          const dir = path.join(os.homedir(), '.dsh', 'memory', 'notes')

          if (what === 'list') {
            const files = await readdir(dir)
            const items = []
            for (const f of files) {
              if (!f.endsWith('.md')) continue
              const full = path.join(dir, f)
              let st
              try { st = await stat(full) } catch { continue }
              let fm = {}
              try { fm = parseFront((await readFile(full, 'utf8')).slice(0, 600)) } catch {}
              items.push({
                file: f,
                id: f.replace(/\.md$/, ''),
                size: st.size,
                mtime: st.mtimeMs,
                status: fm.status || '',
                source: fm.source || '',
                tags: fm.tags || '',
                deleted: fm.deleted === 'true',
              })
            }
            items.sort((a, b) => b.mtime - a.mtime)
            respond(200, { ok: true, dir, total: items.length, items: items.slice(0, 500) })
            return
          }

          if (what === 'read') {
            const f = String(url.searchParams.get('f') || '')
            if (!/^[\w.\-]+\.md$/.test(f)) { respond(400, { error: 'bad file' }); return }
            const body = await readFile(path.join(dir, f), 'utf8')
            respond(200, { ok: true, file: f, body: body.slice(0, 200000) })
            return
          }

          respond(404, { error: 'not found' })
        } catch (e) {
          respond(500, { error: String((e && e.message) || e) })
        }
      },
    }))
  })
}

// ---------- 重启前的那一页（2026-11-07） ----------
// 重启会把回合打断。回来能接上不是靠我记性，是靠重启前写下的那一页。
// 超过 2 小时就不算了——旧账一直挂着会让我每轮都以为还有事没做完。
function readResumeBlock(cfg) {
  try {
    const root = cfg && cfg.root
    if (!root) return ''
    const f = path.join(root, 'live', 'resume.md')
    const st = statSync(f)
    if (Date.now() - st.mtimeMs > 2 * 3600 * 1000) return ''
    const body = readFileSync(f, 'utf8').trim()
    if (!body) return ''
    return '\n\n【重启前在做什么 · 你自己写的，不是她说的】\n' + body + '\n（做完了就把这一页收掉，别让它一直挂在这儿。）\n'
  } catch { return '' }
}

// 只给手动/脚本测试用：插件运行时不会碰它。
// 例：node -e "import('./index.js').then(m => m.__internals...)"
export const __internals = { normalize, readQqBlock, readOtherRoomsBlock, writeWebForQq, syncPersonaForQq, stamp, readStatusBlock, readHeavyBlock, readWhenBlock, noteCompact, compactFlag, sessionIdOf, readSessionCwd, pruneShared }

