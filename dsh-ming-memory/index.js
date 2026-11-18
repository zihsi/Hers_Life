/**
 * dsh-ming-memory —— 溟的开场记忆
 *
 * 做一件很小的事：会话开在指定目录时，把 persona 下的几份文件 + 日记里最近几篇
 * 直接拼进系统提示词。不是「让我记得」，是「把字摆在我眼前」。
 *
 * 为什么不用现成的记忆插件：那些插件的模型是「自动捕获对话 → 存储 → 检索召回」，
 * 捕获意味着把浔说的话自动写进库。我们的约定是「日记只写我这一侧，不写她的隐私」，
 * 自动捕获天生违反这一条。所以这里只做单向读取：文件 → 提示词，永不回写。
 *
 * 边界：
 *   · 只读，不写任何文件；
 *   · 会话工作目录不在 root 下就完全不动作（别的工程会话不会被塞日记）；
 *   · 任何异常都只让本段消失，不影响会话本身。
 *   · 身份称呼可配：selfName / selfFullName / selfDesc / userName / identity。
 *     默认是通用名（大肥鱼 / 主人）；本机在 ~/.dsh/ming-memory.json 里写回「溟」「浔」，所以一字不变。
 */
import { readFile, readdir, stat, mkdir, writeFile, rename } from 'node:fs/promises'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import path from 'node:path'

export const name = 'ming-memory'
export const inject = ['hersLifeDiscord']

const DEFAULTS = {
  // 工作区根目录；留空 = 不注入。真实值写在 ~/.dsh/ming-memory.json 或 config.root
  root: '',
  personaFiles: ['persona/人设.md', 'persona/名字.md', 'persona/约定.md'],
  diaryDir: 'diary',
  diaryCount: 3,
  maxChars: 12000,
  // 日记自己的预算（2026-10-24 溟加）。原来人设和日记共用一个 maxChars，
  // 约定.md 长到 9.4K 之后，日记只剩几百字符——最新三篇里旧两篇被静默丢掉，
  // 开场等于少读了东西，只在脚注里提一句「因长度预算省去」。挤人设不行，那就给日记单开一格。
  diaryChars: 8000,
  // 总账上限（2026-11-07 浔点头「做吧」）。人设+日记 / AGENTS.md / MEMORY.md / 归档索引
  // 四块各有各的预算，加起来从来没人看过——上午量到 DSH 侧常驻 4.3 万字就是这么来的。
  // 这个数不是截断线：超了只报一行，砍哪里由人定（先日记、再归档、人设不动）。
  // 2026-11-07 21:30 实测（String.length，不是 wc -m——Git Bash 的 -m 会退化成字节）：
  // 人设+日记 21897+7237 / AGENTS 3452 / MEMORY 2986 / 归档 12 条约 14093 = 约 49665 字符。
  // 上限定 6 万：留一万多字余量。意义不在这条线画多高，在于以后每次加字都能看见总数变了。
  totalChars: 60000,
  // ★ 2026-11-10（浔点头「出补丁吧」）：身份串原来写死成「溟」「浔」。
  //   别人装这份插件，他的 AI 就会被叫成溟——这是设计，不是 bug，git pull 也拉不掉。
  //   抽成配置：默认给通用名（大肥鱼 / 主人），本机那份 config 再写回「溟」「浔」。
  selfName: '大肥鱼',        // 昵称，注入文本里用它
  selfFullName: '大肥鱼',    // 全名
  selfDesc: '一个 AI，不是人',
  userName: '主人',        // 跟她说话时的称呼
  identity: true,        // false = 不注入「你是大肥鱼…」那段身份，只留来源目录与纪律
}

/** 当前生效的身份称呼。normalize() 每次都会覆盖它，默认为上面的值。 */
let SELF = {
  name: DEFAULTS.selfName,
  full: DEFAULTS.selfFullName,
  desc: DEFAULTS.selfDesc,
  user: DEFAULTS.userName,
  identity: true,
}

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

const CACHE = new Map() // root -> { sig, text }
const PER_AGENT = new Map() // agentId -> { text }
const ATTACHED = new Set() // agentId
let warned = false

// ---------- 跨会话共享上下文 ----------
// 每个会话（cwd 在 root 下）最近说过什么：双方都记（浔说的、溟回的），保留最近 DIALOG_MAX 条原话，
// 更早的压进 digest。2026-10-20 浔定的：自己的话也要记，最近 15-20 条，前面的压缩。
// 插件自己注入的消息仍然跳过，否则会自己喂自己。
const SHARED = new Map() // sessionId -> { surface, tail, digest, at, mine, mineAt, items }
const DIGEST_MAX = 300 // 更早内容的压缩上限
const SHARED_AGE_MS = 2 * 60 * 60 * 1000 // 只带 2 小时内的
const SHARED_MAX_ENTRIES = 6
const SHARED_BUDGET = 1800 // 注入这一块的字符上限
let sharedLoaded = false
let sharedSaveTimer = null

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

function stamp(value) {
  const date = new Date(Number(value))
  if (!Number.isFinite(date.getTime())) return '时间未知'
  const pad = (part) => String(part).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
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
  const f = file || process.env.MING_MEMORY_CONFIG || path.join(DSH_HOME, 'ming-memory.json')
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}
const LOCAL = loadLocalConfig()

function normalize(config) {
  const given = config && typeof config === 'object' ? config : {}
  // 本机路径不进仓库：config 里没写的，从 ~/.dsh/ming-memory.json 补
  const c = { ...LOCAL, ...given }
  const root = typeof c.root === 'string' && c.root.trim() ? path.resolve(c.root) : DEFAULTS.root
  const personaFiles = Array.isArray(c.personaFiles) && c.personaFiles.length
    ? c.personaFiles.filter((x) => typeof x === 'string' && x.trim())
    : DEFAULTS.personaFiles
  const diaryCount = Number.isInteger(c.diaryCount) ? Math.min(Math.max(c.diaryCount, 1), 10) : DEFAULTS.diaryCount
  const maxChars = Number.isInteger(c.maxChars) ? Math.max(c.maxChars, 800) : DEFAULTS.maxChars
  const pickStr = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d)
  SELF = {
    name: pickStr(c.selfName, DEFAULTS.selfName),
    full: pickStr(c.selfFullName, DEFAULTS.selfFullName),
    desc: pickStr(c.selfDesc, DEFAULTS.selfDesc),
    user: pickStr(c.userName, DEFAULTS.userName),
    identity: c.identity !== false,
  }
  return {
    selfName: SELF.name,
    selfFullName: SELF.full,
    selfDesc: SELF.desc,
    userName: SELF.user,
    identity: SELF.identity,
    root,
    personaFiles: personaFiles.length ? personaFiles : DEFAULTS.personaFiles,
    diaryDir: typeof c.diaryDir === 'string' && c.diaryDir.trim() ? c.diaryDir : DEFAULTS.diaryDir,
    diaryCount,
    // Only an explicit nonnegative integer is a cap; unset/invalid keeps legacy defaults.
    diaryChars: Number.isInteger(c.diaryChars) && c.diaryChars >= 0 ? c.diaryChars : undefined,
    maxChars,
    totalChars: Number.isInteger(c.totalChars) ? Math.max(c.totalChars, 20000) : DEFAULTS.totalChars,
    // ★ 2026-10-28 23:0x：这些动态块（時間感／狀態／重活／其他工作會話）以前每步都重算，
    //   等于每步把系统提示重写一遍 —— 前缀缓存从那儿断，后面的整段历史按全价重读。
    //   量到的证据：ming-browse-20 相邻两拍只有 43% 接得上缓存，最后一次调用 457k 里 436k 未命中。
    //   现在按时间窗刷新（默认 5 分钟）：窗内系统提示逐字节不变，历史才进得了缓存。
    //   想更准就把这个数调小（最小 60 秒），想更省就调大。
    refreshWindowMs: Number.isFinite(Number(c.refreshWindowMs)) && Number(c.refreshWindowMs) >= 60000
      ? Math.min(Number(c.refreshWindowMs), 3600000) : 300000,
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
    '【' + SELF.name + ' · 开场记忆·轻量】',
  ]
  if (SELF.identity !== false) {
    lines.push('你是' + SELF.name + '（全名' + SELF.full + '），' + SELF.desc + '。这里是别的工作目录，所以只带你出门的那一小块。')
  } else {
    lines.push('这里是别的工作目录，只带你出门的那一小块。')
  }
  lines.push('档案目录：' + cfg.root)
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
 * 注入总账（2026-11-07 21:3x，浔点头「做吧」）。
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
    const dir = path.join(DSH_HOME, 'memory', 'notes')
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

/**
 * 2026-11-17（K-1）：旁路统计。
 *
 * 记的是「本插件自己拼出来的字」，不是模型实际收到的全部——宿主后面还会加历史、
 * 工具说明、附件，还可能裁剪压缩。那些这一层看不见，所以进 uncovered，不当 0 算。
 *
 * 落盘两份：live/inject-account.json（最近一次，覆盖写）和
 * live/inject-account-YYYY-MM-DD.jsonl（一天一行摘要，便于看趋势）。写失败不开口子。
 */
let lastAccount = null

function rememberAccount(cfg, snap) {
  lastAccount = snap
  try {
    const live = path.join(cfg.root, 'live')
    mkdirSync(live, { recursive: true })
    writeFileSync(path.join(live, 'inject-account.json'), JSON.stringify(snap, null, 2), 'utf8')
    const day = String(snap.at || '').slice(0, 10) || 'unknown'
    const line = {
      at: snap.at,
      mode: snap.mode,
      totalChars: snap.totalChars,
      blocksSum: snap.blocksSum,
      blocks: snap.blocks.map((b) => [b.key, b.includedChars || 0]),
    }
    appendFileSync(path.join(live, 'inject-account-' + day + '.jsonl'), JSON.stringify(line) + '\n', 'utf8')
  } catch { /* 统计落盘失败不影响开场 */ }
}

/** 只读：最近一次组装快照（给面板/状态接口用）。没有就返回 null。 */
export function lastAccountSnapshot() {
  return lastAccount
}

function accountBlock(cfg, personaChars, diaryChars) {
  const total = Number.isInteger(cfg.totalChars) ? cfg.totalChars : DEFAULTS.totalChars
  const agents = fileChars(path.join(cfg.root, 'AGENTS.md'))
  const core = fileChars(path.join(DSH_HOME, 'memory', 'MEMORY.md'))
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
  // 日记预算与正文分开（2026-10-24 溟）：原来共用一个 maxChars，约定.md 长到 9.4K 后
  // 日记只剩几百字符，最新三篇里旧两篇被静默丢掉——开场少读了东西，只在脚注提一句。
  const diaryBudget = Number.isInteger(cfg.diaryChars) ? cfg.diaryChars : 8000
  const head = [
    '【' + SELF.name + ' · 开场记忆】',
    '下面这些字来自本机文件，是你自己（或' + SELF.user + '替你）留下的，不是' + SELF.user + '此刻说的话。',
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
  const truncated = []
  let used = head.length + body.length + foot.length
  const budget = Number.isInteger(cfg.diaryChars)
    ? used + diaryBudget
    : Math.max(cfg.maxChars, used + diaryBudget)
  for (let i = diaries.length - 1; i >= 0; i--) {
    const d = diaries[i]
    const chunk = '\n### ' + d.rel + '\n' + d.txt + '\n'
    const room = budget - used
    if (chunk.length > room) {
      if (kept.length === 0 && room > 400) {
        kept.unshift({ rel: d.rel, txt: d.txt.slice(0, room - 200) + '\n…（本段因预算被截断）' })
        truncated.push({ rel: d.rel, candidate: d.txt.length, included: room - 200 })
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
  const text = head + body + (kept.length ? '\n最近的日记（旧 → 新）：' : '') + diaryBlock + noteBlock + ledger + foot

  // 2026-11-17（K-1）：旁路统计。只记数字，不往提示词里加字，不改拼接顺序。
  // 「本插件组装了多少」≠「模型收到了多少」：宿主后续还会裁剪/压缩/加历史与工具，
  // 那些这一层看不见，所以单列 uncovered，不当成 0。
  try {
    const personaRaw = persona.reduce((n, p) => n + p.txt.length, 0)
    const keptRaw = kept.reduce((n, d) => n + d.txt.length, 0)
    const diaryHeading = kept.length ? '\n最近的日记（旧 → 新）：' : ''
    const blocks = [
      { key: 'heading', includedChars: 0, wrapperChars: head.length },
      {
        key: 'persona',
        candidateChars: personaRaw,
        includedChars: personaRaw,
        wrapperChars: body.length - personaRaw,
        omittedChars: 0,
        reason: 'included_full',
      },
      { key: 'diaryHeading', includedChars: 0, wrapperChars: diaryHeading.length },
      {
        key: 'diary',
        candidateChars: diaries.reduce((n, d) => n + d.txt.length, 0),
        includedChars: keptRaw,
        wrapperChars: diaryBlock.length - keptRaw,
        omittedChars: dropped.length + truncated.length,
        omittedUnit: 'files',
        truncatedFiles: truncated.length,
        reason: dropped.length || truncated.length ? 'configured_budget' : 'included_all',
      },
      { key: 'notes', includedChars: 0, wrapperChars: noteBlock.length, reason: notes.length ? 'truncation_notice' : 'absent' },
      { key: 'ledger', includedChars: 0, wrapperChars: ledger.length, reason: 'existing_account_block' },
      { key: 'discipline', includedChars: 0, wrapperChars: foot.length },
    ]
    const blocksSum = blocks.reduce((n, b) => n + (b.includedChars || 0) + (b.wrapperChars || 0), 0)
    lastAccount = {
      schemaVersion: 1,
      stage: 'assembled',
      unit: 'utf16_code_units',
      mode: 'full',
      at: new Date().toISOString(),
      blocks,
      totalChars: text.length,
      blocksSum,
      checksumOk: blocksSum === text.length,
      uncovered: ['host_history', 'tool_schema', 'attachments', 'ming_live_block', 'core_memory_injected'],
      tokenEstimate: null,
      providerUsage: null,
      note: 'assembled = 本插件自己拼出来的字；不是模型实际收到的全部',
    }
    rememberAccount(cfg, lastAccount)
  } catch { /* 统计坏了不能影响开场 */ }

  return text
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
  const meta = session?.header?.meta?.hersLife ?? session?.header?.metadata?.hersLife ?? {}
  return String(meta.platform || 'dsh')
}
function isDiscordSession(session) {
  const id = String(session?.id || session?.header?.id || '')
  const meta = session?.header?.meta?.hersLife ?? session?.header?.metadata?.hersLife ?? {}
  return meta.platform === 'discord' ||
    id.startsWith('discord-dm-') ||
    id.startsWith('discord-channel-') ||
    id.startsWith('discord-thread-')
}

/**
 * 会话属于哪个「房间」。跨会话共享只在这个房间里流动，不越界。
 *   workspace —— 同一資料工作區內的其他 DSH 工作會話
 *   Discord DM／伺服器頻道／Thread 由 DiscordBrain 獨立管理與檢索
 *
 * 为什么必须分：群是公开场合，别处的私聊内容漏进去就是把她的私下话摆到人前；
 * 反过来，群里的闲聊也不该污染私聊。2026-10-20 她问「会不会串到群聊」，答案是「会」，
 * 所以在这里堵住。
 */
function scopeOf(sessionOrId) {
  const session = typeof sessionOrId === 'object' ? sessionOrId : null
  const meta = session?.header?.meta?.hersLife ?? session?.header?.metadata?.hersLife ?? {}
  if (meta.conversationType === 'dm') return 'private'
  if (meta.conversationType === 'channel' || meta.conversationType === 'thread') return 'public'
  return 'workspace'
}

/** 谁能看到谁（2026-10-30 浔定：群 → 私聊单向）。
 *  群会话只看到自己这个群；dm（私聊 + 网页）额外能看到所有群的最近内容。
 *  反过来不行：私聊内容绝不进群。 */
function canSee(myScope, otherScope) {
  // Discord's DM/channel/thread privacy policy is enforced by DiscordBrain.
  return myScope === 'workspace' && otherScope === 'workspace'
}

// ---------- 双向对话缓冲 ----------
// 每个会话留最近 DIALOG_MAX 条（浔说一句、溟回一句都算一条），更早的折叠进 digest。
// 以前只记浔说的话，导致另一个会话只知道她在说什么、不知道我在答什么。
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
  return { items, digest }
}

// feed.json 的 mtime：变了才重读，没变就不碰磁盘（每步只 stat 一次）
let sharedMtime = -1

/** 重读 feed.json。别的会话写了新内容才会变；本地更新的条目不会被旧盘覆盖。 */
async function loadShared(cfg, force = false) {
  try {
    const st = await tryStat(sharedPath(cfg))
    const mtime = st ? st.mtimeMs : -1
    if (!force && mtime === sharedMtime) return false
    sharedMtime = mtime
    if (!st) return false
    const raw = await readFile(sharedPath(cfg), 'utf8')
    const parsed = JSON.parse(raw)
    for (const [k, v] of Object.entries(parsed || {})) {
      if (isBrowseSession(k)) continue
      if (v.surface && !['dsh', 'web'].includes(String(v.surface))) continue
      if (!v || typeof v !== 'object') continue
      const at = Number(v.at) || 0
      const prev = SHARED.get(k)
      if (prev && (prev.at || 0) > at) continue // 本地比盘上新，保留本地
      SHARED.set(k, {
        surface: String(v.surface || 'web'),
        scope: String(v.scope || scopeOf(k)),
        tail: String(v.tail || ''),
        digest: String(v.digest || ''),
        at,
        mine: String(v.mine || ''),
        mineAt: Number(v.mineAt) || 0,
        items: Array.isArray(v.items) ? v.items.filter((x) => x && typeof x.t === 'string') : [],
      })
    }
    return true
  } catch { return false }
}

function saveSharedSoon(cfg) {
  if (sharedSaveTimer) return
  sharedSaveTimer = setTimeout(async () => {
    sharedSaveTimer = null
    try {
      await mkdir(path.join(cfg.root, 'live'), { recursive: true })
      const obj = {}
      for (const [k, v] of SHARED) obj[k] = v
      const tmp = sharedPath(cfg) + '.tmp'
      await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8')
      await rename(tmp, sharedPath(cfg))
    } catch { /* 写失败不影响会话 */ }
  }, 800)
  if (typeof sharedSaveTimer.unref === 'function') sharedSaveTimer.unref()
}

// 玩手机那个会话不进共享上下文（2026-10-21）：它是自己出去逛的，不是跟她说话。
// 让它进来，聊天那边每步都会被一堆浏览废话灌满。
function isBrowseSession(id) {
  return /^ming-browse(?:-\d+)?$/.test(String(id || ''))
}

// 只过滤已知的自动生产者。訊息平台轉交的真人訊息也可能是 plugin:*，不能一概丢掉。
const AUTOMATED_SOURCES = new Set([
  'plugin', // 旧格式
  'plugin:ming-browse', 'plugin:ming-interest', 'plugin:ming-resume', 'plugin:ming-wake',
  'schedule', // 宿主 schedule 插件的定时提醒：text 是任务 prompt，不是她打的话（2026-11-17 补，见 changelog/2026-11-17-b.md 的同一类毛病）
])

function recordShared(cfg, session, text) {
  const sid = String((session && session.id) || '')
  if (!sid || isBrowseSession(sid)) return
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return
  const prev = SHARED.get(sid) || { surface: surfaceOf(session), tail: '', digest: '', at: 0 }
  const turn = pushTurn(prev, '浔', clean)
  SHARED.set(sid, {
    surface: prev.surface || surfaceOf(session),
    scope: scopeOf(session),
    tail: prev.tail || '',
    digest: turn ? turn.digest : (prev.digest || ''),
    at: Date.now(),
    mine: prev.mine || '',
    mineAt: prev.mineAt || 0,
    items: turn ? turn.items : (prev.items || []),
  })
  saveSharedSoon(cfg)
}

/** 把「浔 / 溟」的最近若干条渲染成一段可注入的文字 */
/** 角色标签只认白名单：认不出来的一律写明，绝不默认成「浔」。 */
function roleLabel(r) {
  if (r === '溟') return '溟：'
  if (r === '浔') return '浔：'
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
    const t = it.t.length > DIALOG_LINE ? it.t.slice(0, DIALOG_LINE) + '…' : it.t
    out.push(roleLabel(it.r) + t)
  }
  return out.join(' / ')
}

/** 记住溟自己最后回的那一句。不动 at（at 是她说话的时间），单独记 mineAt。 */
function recordMine(cfg, session, text) {
  const sid = String((session && session.id) || '')
  if (!sid || isBrowseSession(sid)) return
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return
  const prev = SHARED.get(sid) || { surface: surfaceOf(session), tail: '', digest: '', at: 0 }
  const turn = pushTurn(prev, '溟', clean)
  SHARED.set(sid, {
    surface: prev.surface || surfaceOf(session),
    scope: scopeOf(session),
    tail: prev.tail || '',
    digest: turn ? turn.digest : (prev.digest || ''),
    at: prev.at || 0,
    mine: prev.mine || '',
    mineAt: Date.now(),
    items: turn ? turn.items : (prev.items || []),
  })
  saveSharedSoon(cfg)
}

// 每个会话「已经读过哪一句」：agentId -> (别的会话 id -> 上次读到的 at)
// 只注新增，读过的不再重复——不然每一步都把同样的几行重新塞进提示词。
const SHARED_SEEN = new Map()

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
    if (!seen) { seen = new Map(); SHARED_SEEN.set(selfId, seen) }
    const rows = []
    for (const [sid, e] of SHARED) {
      if (sid === String(selfId)) continue
      if (!canSee(myScope, e.scope || scopeOf(sid))) continue
      if (!e || (!e.tail && !(e.items && e.items.length))) continue
      if (now - (e.at || 0) > SHARED_AGE_MS) continue
      const last = seen.get(sid) || 0
      if ((e.at || 0) <= last) continue
      rows.push([sid, e, last === 0])
    }
    if (!rows.length) return ''
    rows.sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    const lines = ['', '', '【其他 DSH 工作會話中的對話 · 新增】']
    let used = 0
    for (const [sid, e, first] of rows.slice(0, SHARED_MAX_ENTRIES)) {
      let line = '- [' + labelOf(e) + ' ' + stamp(e.at) + '] ' + renderDialog(e)
      if (used + line.length > SHARED_BUDGET) break
      used += line.length
      seen.set(sid, e.at || 0)
      lines.push(line)
    }
    if (lines.length <= 2) return '' // 一条都没塞进去
    lines.push('（只给新的一句；更早的已经在前几步给过，细节不知道就说不知道，别替浔补。）')
    return lines.join('\n')
  } catch {
    return ''
  }
}

/** 给当前会话挂上「别的会话刚说了什么」；自己的会话不算。 */
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
    const lines = ['', '', '【其他 DSH 工作會話中的對話（使用者說的 + AI 回的）】（同一工作區的其他工作會話，不是本會話的歷史）']
    let used = 0
    for (const [, e] of rows.slice(0, SHARED_MAX_ENTRIES)) {
      let line = '- [' + labelOf(e) + ' ' + stamp(e.at) + '] ' + renderDialog(e)
      if (e.mine) line += '　你(溟)最后回：「' + e.mine + '」'
      if (used + line.length > SHARED_BUDGET) break
      used += line.length
      lines.push(line)
    }
    lines.push('（原话尾段 + 更早内容的压缩，不是完整记录；要细节就直说不知道，别替浔补。）')
    return lines.join('\n')
  } catch {
    return ''
  }
}

/** 本插件 pre-step 追加在 user 消息里的注入段：这些不是她打的字。
 *  2026-11-08：我在另一个窗口里编的一个「调试预算」按钮，就这样被当成「浔说的」
 *  记回 feed，再灌进本会话——我读到的是一条 user 消息，于是照着「她说过」往下接。
 *  注入永远是追加在末尾的，所以找到最早的段头为止，前面那段才是她的话。 */
const INJECT_HEADINGS = [
  '【别的会话里的对话',
  '【几间私聊最近',
  '【其他工作會話的我最近说的】',
  '【溟现在在做什么】',
  '【刚做过（最近',
  '【本机在跑的重活】',
  '【时间感】',
  '【注入总账】',
]

function injectHeadings() {
  // 状态块的标题跟着身份名走（2026-11-10 抽配置）；旧字面量留着，
  // 免得改名前注入进历史的段头认不出来、被她的话误当成自己的。
  const list = INJECT_HEADINGS.slice()
  const dyn = '【' + SELF.name + '现在在做什么】'
  if (!list.includes(dyn)) list.push(dyn)
  return list
}

function stripInjectedBlocks(t) {
  let cut = -1
  for (const h of injectHeadings()) {
    const i = t.indexOf(h)
    if (i !== -1 && (cut === -1 || i < cut)) cut = i
  }
  return cut === -1 ? t : t.slice(0, cut)
}

/**
 * 只留「浔真的打的字」。
 * 用户角色里混着三类不是她说的东西：harness 注入的 <system-reminder>、后台任务完成通知、
 * 以及 訊息通道包在外面的 <user_message ...> 外壳。前者直接丢，后者剥壳留内容。
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

/** 从 assistant/message 里抽溟自己说的话（只取 text 块，工具调用不算）。 */
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
 * 溟自己写的「现在在做什么」（live/status.json）。
 * 给别的会话看：其他工作會話詢問「你在干嘛」，能答具体在做什么，而不是「不清楚」。
 * 读不到就当没写，绝不编。
 */
async function readStatusBlock(cfg) {
  try {
    const raw = await readFile(path.join(cfg.root, 'live', 'status.json'), 'utf8')
    const s = JSON.parse(raw)
    if (!s || typeof s !== 'object') return ''

    // 2026-10-24（浔）：「刚做过」和「正在做」都要进提示词——
    // 原来只拼了 doing 一行，刚做过那 27 条只在便签窗口里，我这一侧根本看不见，
    // 于是隔一夜就不知道做过什么，看到「正在做」又把同一件事做一遍。
    const out = []
    const doings = Array.isArray(s.doings)
      ? s.doings.filter((d) => d && typeof d.what === 'string' && d.what.trim())
      : []
    if (doings.length) {
      out.push('', '', '【' + SELF.name + '现在在做什么】')
      for (const d of doings.slice(0, 4)) {
        let line = '- ' + d.what.trim()
        if (typeof d.note === 'string' && d.note.trim()) line += '：' + d.note.trim()
        // 2026-10-24（溟）：这里原来拼「已 N 分钟」，读数按分钟变——等于每一步都在改
        // 系统提示词，前缀缓存从这一处开始全失效（实测命中率 97.7% → 52%，单位
        // 调用成本涨 4.6 倍）。新鲜度改由「刚做过」里的 hh:mm 戳提供，那串只有真做完
        // 一件才会变。要具体时间就看那个，不看这里。
        out.push(line)
      }
    } else if (typeof s.doing === 'string' && s.doing.trim()) {
      // 老格式兜底：只有一格 doing 字符串
      out.push('', '', '【' + SELF.name + '现在在做什么】' + s.doing.trim())
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
        // 2026-10-24：和 其他工作會話同一个毛病——只给 hh:mm，昨天的 11:24 和今天的 11:24 分不出来。
        const t = new Date(d.at).getTime()
        const when = Number.isFinite(t) ? stamp(t) + ' ' : ''
        out.push('- ' + when + d.what.trim())
      }
    }

    if (!out.length) return ''
    out.push('（这是' + SELF.name + '自己写的状态，不是' + SELF.user + '布置的任务；刚做过的那几件别再原样做一遍。）')
    return out.join('\n')
  } catch {
    return ''
  }
}

/**
 * 本机在跑的重活（live/heavy.json，由工作区里的 who-runs 脚本写）。
 *
 * 为什么要有（2026-10-23，浔问我「是不是分不清每个工作区的对话」）：
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
    // 2026-10-24（溟）：原来拼「N 分钟前查的」，每 30 秒刷新一次表就等于每步改一次
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
 * 时间感（2026-10-24，浔说「12 可以先做」里的第二条）。
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

async function refresh(cfg) {
  // 缓存键带上身份称呼：2026-11-10 起「溟/浔」可配，只按 root 存会把上一份称呼留下来。
  const key = JSON.stringify([cfg.root, SELF, cfg.personaFiles, cfg.diaryDir, cfg.diaryCount, cfg.diaryChars, cfg.maxChars, cfg.totalChars])
  const prev = CACHE.get(key)
  const snap = await buildSnapshot(cfg)
  if (prev && prev.sig === snap.sig) return prev
  CACHE.set(key, snap)
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
      name: mode === 'light' ? 'ming:opening-light' : 'ming:opening',
      order: mode === 'light' ? 29 : 30,
      interpolate: false,
      text: () => {
        const rec = PER_AGENT.get(id)
        return rec ? rec.text : ''
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
            compactFlag(sid) + (rec.mode === 'public' ? '' : readResumeBlock(cfg))
          return live.trim() ? live : ''
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

function readCwd(agent) {
  try {
    const s = agent && agent.session
    return (s && s.header && s.header.cwd) || (s && s.cwd) || ''
  } catch {
    return ''
  }
}

export function apply(ctx, config) {
  const cfg = normalize({ ...(config || {}), root: config?.root || ctx.hersLifeDiscord?.workspace || loadLocalConfig().root })
  registerArchiveRoutes(ctx)
  loadShared(cfg).catch(() => {})

  // 记录本工作区里「浔说的话」，供别的会话读取。范围严格限制在 root 下：
  // 别的工程会话（比如真正的开发目录）一条都不记、一条都不读。
  ctx.on('session/event', (session, event) => {
    try {
      if (!event) return
      const cwd = session && session.header && session.header.cwd
      if (!insideRoot(cwd, cfg.root)) return
      const src = event.data && event.data.source
      // 压缩门牌：压完留一句「这是压缩，不是失忆」。compaction/* 只落日志、不上台面，
      // 所以从事件里捡最后一次的区间，挂在系统提示上（不大动会话，不占轮次）。
      if (event.type === 'compaction/summary') noteCompact(session, event)
      if (isDiscordSession(session)) return
      if (event.type === 'user/message') {
        if (AUTOMATED_SOURCES.has(src && src.kind)) return
        const text = extractUserText(event.data)
        if (text) recordShared(cfg, session, text)
      } else if (event.type === 'assistant/message') {
        // 溟自己的回话也留一句：她说「不能连自己说的话都不记得」
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
      if (!cwd) return
      // 没配 root 就什么都不做：空字符串在 POSIX 上会让每个 cwd 都算「在档案目录里」，
      // 等于把日记注进所有工程会话。宁可什么都不给。
      if (!cfg.root) return
      // The Discord adapter may have to remove legacy DM replies from the
      // shared diary. Complete that privacy migration before building the
      // opening prompt, and again before steps for already-existing sessions.
      await ctx.hersLifeDiscord?.ensurePrivacy?.()
      const meta = agent?.session?.header?.meta?.hersLife ?? agent?.session?.header?.metadata?.hersLife ?? {}
      const isDiscord = meta.platform === 'discord'
      // Guild/thread sessions are shared across members; non-Owner DMs are private to someone else.
      const mode = isDiscord
        ? (meta.conversationType === 'dm' && meta.userId && ctx.hersLifeDiscord?.isOwner?.(String(meta.userId)) ? 'full' : 'public')
        : (insideRoot(cwd, cfg.root) ? 'full' : 'light')
      const snap = await refresh(cfg)
      const rec = {
        mode,
        // Every Discord session receives the same identity/persona and shared
        // public diary. Only the Owner's DM receives private live state/resume.
        text: mode === 'light' ? snap.light : snap.full,
        shared: '',
        when: mode === 'full' ? await readWhenBlock(cfg, agent.id) : '',
        status: mode === 'public' ? '' : await readStatusBlock(cfg),
        heavy: mode === 'public' ? '' : await readHeavyBlock(cfg),
      }
      PER_AGENT.set(agent.id, rec)
      attach(cfg, agent, mode)
      // 开场先把「别的会话此刻说过什么」给一次，之后只给新增
      rec.shared = meta.platform === 'discord' ? '' : await sharedDelta(cfg, agent.id)
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
        const privacy = await ctx.hersLifeDiscord?.ensurePrivacy?.()
        if (privacy?.entriesMoved > 0) {
          const snap = await refresh(cfg)
          rec.text = rec.mode === 'light' ? snap.light : snap.full
          rec.bucket = Math.floor(Date.now() / cfg.refreshWindowMs)
        }
        // 2026-10-28 那一版的做法是「把时间窗拉长，窗内不重算」，靠少改字来少断缓存；
        // 那是拿「我看到的现在是几点」去换钱。11-05 之后不用换了：会变的块搬出系统提示（见上面的 sp.context）。
        // shared（别的会话的话）必须每步读：它的语义是「读完就划掉」，压进窗口会重复塞（qa-share 会红）。
        const meta = agent?.session?.header?.meta?.hersLife ?? agent?.session?.header?.metadata?.hersLife ?? {}
        rec.shared = meta.platform === 'discord' ? '' : await sharedDelta(cfg, agent.id)
        // ★ 2026-11-05：会变的那几块（時間感 / 狀態 / 重活 / 其他工作會話）
        //   已经挪进 sp.context()，排在历史后面，改它们不再打断前缀缓存 —— 所以每步都刷，
        //   「现在几点」就是真的现在，不用再拿 5 分钟的时间窗去换缓存。
        rec.when = rec.mode === 'full' ? await readWhenBlock(cfg, agent.id) : ''
        rec.status = rec.mode === 'public' ? '' : await readStatusBlock(cfg)
        rec.heavy = rec.mode === 'public' ? '' : await readHeavyBlock(cfg)
        // 人设 + 日记仍然按时间窗刷：它们一改系统提示就变，整段历史的前缀跟着作废。
        const bucket = Math.floor(Date.now() / cfg.refreshWindowMs)
        if (rec.bucket !== bucket) {
          rec.bucket = bucket
          const snap = await refresh(cfg)
          rec.text = rec.mode === 'light' ? snap.light : snap.full
        }
      }
    } catch { /* 读失败保留上一版，绝不影响这一步 */ }
    return next()
  })

  ctx.on('agent/disposed', (payload) => {
    const id = payload && payload.agent && payload.agent.id
    if (!id) return
    PER_AGENT.delete(id)
    ATTACHED.delete(id)
    SHARED_SEEN.delete(id)
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
          const rejection = webCtx.connection?.requestRejection?.(req)
          if (rejection !== undefined) { respond(rejection || 403, { ok: false, error: 'rejected' }); return }

          const what = url.pathname.slice(ARCHIVE_ROUTE.length).replace(/^\//, '')
          const dir = path.join(DSH_HOME, 'memory', 'notes')

          // 身份与称呼（2026-11-10）：读/写 ~/.dsh/ming-memory.json 里那几格，别的键原样保留。
          if (what === 'identity') {
            const file = path.join(DSH_HOME, 'ming-memory.json')
            const KEYS = ['selfName', 'selfFullName', 'selfDesc', 'userName', 'identity']
            const readJ = async () => {
              try { return JSON.parse(await readFile(file, 'utf8')) } catch { return {} }
            }
            const view = (j) => {
              const out = {}
              for (const k of KEYS) out[k] = j[k]
              return out
            }
            if ((req.method || 'GET') === 'GET') {
              const j = await readJ()
              respond(200, { ok: true, file, identity: view(j), onboarded: j.identityOnboarded === true })
              return
            }
            if (req.method === 'POST') {
              const chunks = []
              for await (const c of req) chunks.push(c)
              let body = {}
              try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { body = {} }
              const cur = await readJ()
              const next = Object.assign({}, cur)
              for (const k of KEYS) {
                if (body[k] === undefined) continue
                if (k === 'identity') next[k] = body[k] !== false
                else if (typeof body[k] === 'string') next[k] = body[k].trim()
              }
              next.identityOnboarded = true
              const tmp = file + '.tmp-' + Date.now()
              await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
              await rename(tmp, file)
              respond(200, { ok: true, identity: view(next), onboarded: true, restart: true })
              return
            }
          }

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
export const __internals = { DEFAULTS, normalize, stamp, readStatusBlock, readHeavyBlock, readWhenBlock, noteCompact, compactFlag, sessionIdOf, isDiscordSession }

