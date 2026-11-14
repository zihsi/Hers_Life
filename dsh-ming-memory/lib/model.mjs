/**
 * dsh-ming-memory / lib/model.mjs —— 记忆数据层（读盘 + 算模型）
 *
 * 为什么在这儿：神经元、星图、「她的一生」三个视图吃的是同一批数据。
 * 2026-11-08 之前这批读盘函数住在 dsh-ming-graph/index.js 里 —— 也就是说
 * 「记忆」这件事的实现落在「展示」那个插件里，memory 只剩往系统提示里塞开场词。
 * 现在反过来：memory 负责读、负责算，graph 只负责把它画出来。
 *
 * 纯读，不写盘。读不到就是空数组/空表，不编、不拿假货顶上。
 *
 * 来源：2026-11-08 从 dsh-ming-graph/index.js 第 120–422 行 + readDiaries 整段搬来，
 * 逻辑一行未改；只把 GROUP_NAMES 那个进程级常量收进 cfg.roomLabels，函数加了 export。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// 记忆侧的默认值：graph 的 DEFAULTS 从这份展开，本机配置照旧覆盖它
export const MEMORY_DEFAULTS = {
  // DSH 侧归档记忆（index.json 可能滞后，notes 目录才是全的，所以扫目录）
  dshMemoryDir: path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'memory'),
  // QQ-Agent 侧的观察库；留空 = 不读 QQ 侧
  qqObservations: '',
  // 群友档案索引（号码 → 昵称；昵称会改，认人只认号）；留空 = 不读
  peopleIndex: '',
  // 星图中心那个人；留空 = 不特指谁
  ownerId: '',
  ownerName: '我',
  maxPeople: 120,
  maxTopics: 55,
  maxEdges: 160,
  timelineDays: 30,
  // 统一节点模型的两个来源：记忆卡（八章索引）+ 日记（时间星带）
  memoryCard: '',
  diaryDir: '',
  diaryDays: 60,
  // 房间名：'group:<群号>' / 'private:<号码>' → 显示名
  roomLabels: {},
}

// ---------- 关键词 ----------
// 单字虚词：以它们开头/结尾的双字组合基本都不是主题
const HEAD_STOP = '会在也都还又就才很太更最已将要不没被把给对从到和与而并但或是这那个些类样时地得比如若则'
const TAIL_STOP = '的了着过吗呢吧啊呀嘛'
const TWO_STOP = new Set(('这类 那种 这种 有点 比较 非常 真的 其实 就是 也是 都是 不是 还有 没有 不会 不能 不要 不用 ' +
  '知道 自己 什么 怎么 因为 所以 但是 如果 而且 然后 还是 已经 可以 应该 现在 一下 一点 觉得 感觉 时候 一个 一些 ' +
  '爱用 会用 一句 比如 认为 起哄 里面 之前 之后 一边 一直 一定 一样 这种 几次 好像 似乎 应该 可能 需要 觉得 常用 话爱 会说').split(/\s+/))
const LATIN_STOP = new Set(('the and for with you are not but this that from have was were has had its our your his her they them ' +
  'what when how who why can will would could should may might must http https com www json mjs tmp exe the').split(/\s+/))

const VERB_TAIL = '爱会能想要常好做去来说话看'
const QUANT_HEAD = '条个次份组把点样'
// 以虚词开头、但本身是真词的几个例外（不然「要求」「对话」会被误杀）
const HEAD_EXCEPT = new Set(['要求', '对话', '有趣', '所有', '有些', '时间', '地方', '事件', '被动'])

export function keepTerm(t) {
  if (!t) return false
  if (t.length < 2 || t.length > 6) return false
  if (TWO_STOP.has(t)) return false
  if (/^[0-9]+$/.test(t)) return false
  if (/^[A-Za-z]/.test(t)) return !LATIN_STOP.has(t.toLowerCase())
  if (!/[\u4e00-\u9fa5]/.test(t)) return false
  if ([...t].some((ch) => TAIL_STOP.includes(ch))) return false
  // 虚词开头的丢（会直接 / 会追问 / 在群里 / 对机器），两字留几个真词例外
  if (HEAD_STOP.includes(t[0]) && !HEAD_EXCEPT.has(t)) {
    if (t.length >= 3 || t.length === 2) return false
  }
  if (QUANT_HEAD.includes(t[0])) return false
  // 三字里以动词/副词收尾的（说话爱 / 常用）多半是 n-gram 碎片
  if (t.length === 3 && VERB_TAIL.includes(t[2])) return false
  return true
}

export function rawTerms(text) {
  const out = new Set()
  if (!text) return out
  for (const m of text.matchAll(/[“"「『]([^”"」』]{2,16})[”"」』]/g)) out.add(m[1].trim())
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9_\-.#+]{1,}/g)) out.add(m[0])
  const cjk = text.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const chunk of cjk.split(/\s+/)) {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= chunk.length; i++) out.add(chunk.slice(i, i + n))
    }
  }
  return out
}

export function pickTerms(docs, { minDf = 3, maxDf = 0.45, limit = 70 } = {}) {
  const df = new Map()
  const form = new Map() // 小写 → 首次出现的样子（QQ / qq 归一）
  const perDoc = []
  for (const text of docs) {
    const set = new Set([...rawTerms(text)].filter(keepTerm))
    perDoc.push(set)
    for (const t of set) {
      const key = t.toLowerCase()
      if (!form.has(key)) form.set(key, t)
      df.set(key, (df.get(key) || 0) + 1)
    }
  }
  const N = docs.length || 1
  const cap = Math.max(minDf, Math.floor(N * maxDf))
  // 长词优先：短词被更长的词包含、且频次接近，就丢（机器 / 器人 / 机器人）
  const cands = [...df.entries()].filter(([t, c]) => c >= minDf && c <= cap)
  const drop = new Set()
  for (const [a, ca] of cands) {
    if (drop.has(a)) continue
    for (const [b, cb] of cands) {
      if (b === a || b.length <= a.length || !b.includes(a)) continue
      if (cb >= ca * 0.6) { drop.add(a); break }
    }
  }
  const kept = cands.filter(([t]) => !drop.has(t)).sort((x, y) => y[1] - x[1]).slice(0, limit)
  const terms = kept.map(([key, count]) => ({ term: form.get(key) || key, key, count, idf: Math.round(Math.log(N / count) * 100) / 100 }))
  return { terms, perDoc }
}

export function coOccur(perDoc, terms, maxEdges) {
  const wanted = new Map(terms.map((t) => [t.key || t.term.toLowerCase(), t]))
  const pair = new Map()
  for (const doc of perDoc) {
    const hit = [...doc].map((t) => t.toLowerCase()).filter((t) => wanted.has(t))
    for (let i = 0; i < hit.length; i++) {
      for (let j = i + 1; j < hit.length; j++) {
        // 父子关系不是关联（说话 / 说话简短）
        if (hit[i].includes(hit[j]) || hit[j].includes(hit[i])) continue
        const k = hit[i] < hit[j] ? hit[i] + '\u0000' + hit[j] : hit[j] + '\u0000' + hit[i]
        pair.set(k, (pair.get(k) || 0) + 1)
      }
    }
  }
  const rows = [...pair.entries()]
    .map(([k, n]) => {
      const [ka, kb] = k.split('\u0000')
      const a = wanted.get(ka), b = wanted.get(kb)
      return { a: a.term, b: b.term, w: n, score: n * Math.min(a.idf || 1, b.idf || 1) }
    })
    .filter((e) => e.w >= 2)
    .sort((x, y) => y.score - x.score)
    .slice(0, maxEdges)
  return rows.map(({ a, b, w: n }) => ({ a, b, w: n }))
}

// ---------- 读 ----------
// 老笔记没有 frontmatter.created，但文件名是 20261020-123127-xxx
export function dateFromId(s) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(String(s || ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : ''
}

export function parseFront(text) {  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (!k) continue
    if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    }
    out[k] = v
  }
  return out
}

export async function readDsh(cfg) {
  const notesDir = path.join(cfg.dshMemoryDir, 'notes')
  const files = (await fs.readdir(notesDir)).filter((f) => f.endsWith('.md'))
  const notes = []
  const chunk = 40
  for (let i = 0; i < files.length; i += chunk) {
    const batch = await Promise.all(files.slice(i, i + chunk).map(async (f) => {
      try {
        const txt = await fs.readFile(path.join(notesDir, f), 'utf8')
        const fm = parseFront(txt)
        const tags = Array.isArray(fm.tags) ? fm.tags : String(fm.tags || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        return {
          id: String(fm.id || f.replace(/\.md$/, '')),
          title: String(fm.title || f.replace(/\.md$/, '')),
          tags,
          created: fm.created || fm.last_confirmed || dateFromId(fm.id || f),
          status: fm.status || 'active',
          source: fm.source || '',
        }
      } catch { return null }
    }))
    for (const n of batch) if (n) notes.push(n)
  }
  return notes
}

export async function readQQ(cfg) {
  if (!cfg.qqObservations) return []
  let raw
  try { raw = await fs.readFile(cfg.qqObservations, 'utf8') } catch { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      if (o && o.t === 'obs') out.push(o)
    } catch { /* 坏行跳过 */ }
  }
  return out
}

export async function readPeople(cfg) {
  try {
    const j = JSON.parse(await fs.readFile(cfg.peopleIndex, 'utf8'))
    const map = new Map()
    for (const [id, arr] of Object.entries(j.byId || {})) {
      if (arr && arr[0] && arr[0].name) map.set(id, arr[0].name)
    }
    return map
  } catch { return new Map() }
}

// ---------- 算 ----------
export const dayOf = (ms) => {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 时间戳或 ISO 串都能吃
export function dayOfValue(v) {
  if (typeof v === 'number') return dayOf(v)
  const s = String(v || '')
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  if (/^\d{10,}$/.test(s)) return dayOf(Number(s))
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : dayOf(t)
}

export function build(cfg, { dsh, qq, names }) {
  const now = Date.now()

  // ---- QQ：人 + 房间 ----
  const people = new Map()
  const rooms = new Map()
  for (const o of qq) {
    const sid = String(o.subjectId ?? '')
    if (!sid || sid === 'undefined' || sid === 'null') continue
    if (o.status && o.status !== 'active') continue
    const room = String(o.chatKey || (o.scope === 'global' ? 'global' : '?'))
    const p = people.get(sid) || { id: sid, name: names.get(sid) || '', count: 0, rooms: new Map(), types: {}, lastAt: 0, claims: [] }
    p.count++
    p.rooms.set(room, (p.rooms.get(room) || 0) + 1)
    p.types[o.type || '?'] = (p.types[o.type || '?'] || 0) + 1
    const at = Number(o.at || o.createdAt || 0)
    if (at > p.lastAt) p.lastAt = at
    if (o.claim && p.claims.length < 4) p.claims.push(String(o.claim).slice(0, 160))
    people.set(sid, p)

    const r = rooms.get(room) || { key: room, count: 0, people: new Set() }
    r.count++
    r.people.add(sid)
    rooms.set(room, r)
  }

  const peopleList = [...people.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, cfg.maxPeople)
    .map((p) => ({
      id: p.id,
      name: p.name || p.id,
      isOwner: p.id === String(cfg.ownerId),
      count: p.count,
      rooms: [...p.rooms.entries()].map(([key, count]) => ({ key, label: ((cfg.roomLabels || {})[key] || key), count })).sort((a, b) => b.count - a.count),
      types: p.types,
      lastAt: p.lastAt,
      claims: p.claims,
    }))

  const roomList = [...rooms.values()]
    .map((r) => ({
      key: r.key,
      label: ((cfg.roomLabels || {})[r.key] || (r.key.startsWith('group:') ? '群 ' + r.key.slice(6) : r.key === 'global' ? '全局' : r.key.replace(/^private:/, ''))),
      kind: r.key.startsWith('group:') ? 'group' : r.key === 'global' ? 'global' : 'private',
      count: r.count,
      people: r.people.size,
    }))
    .sort((a, b) => b.count - a.count)

  // ---- 主题（QQ claim 与 DSH title/tags 分开算，别串味） ----
  const qqDocs = qq.filter((o) => o.claim && (!o.status || o.status === 'active')).map((o) => String(o.claim))
  const qqTopics = pickTerms(qqDocs, { minDf: 3, limit: cfg.maxTopics })
  const dshDocs = dsh.filter((n) => n.status === 'active').map((n) => `${n.title} ${(n.tags || []).join(' ')}`)
  const dshTopics = pickTerms(dshDocs, { minDf: 2, maxDf: 0.5, limit: 30 })

  const topics = [
    ...qqTopics.terms.map((t) => ({ ...t, source: 'qq', label: t.term })),
    ...dshTopics.terms.map((t) => ({ ...t, source: 'dsh', label: t.term })),
  ]

  const qqEdges = coOccur(qqTopics.perDoc, qqTopics.terms, cfg.maxEdges).map((e) => ({ ...e, source: 'qq' }))
  const dshEdges = coOccur(dshTopics.perDoc, dshTopics.terms, Math.floor(cfg.maxEdges / 2)).map((e) => ({ ...e, source: 'dsh' }))

  // ---- DSH 的 tag 频次（结构化，比词频干净） ----
  const tagCount = new Map()
  for (const n of dsh) {
    if (n.status !== 'active') continue
    for (const t of n.tags || []) {
      if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) continue
      const key = t.toLowerCase()
      const cur = tagCount.get(key) || { tag: t, count: 0 }
      cur.count++
      tagCount.set(key, cur)
    }
  }
  const tags = [...tagCount.values()].sort((a, b) => b.count - a.count).slice(0, 40)

  // ---- 时间线 ----
  const tl = new Map()
  const bump = (day, k) => { if (!day) return; const r = tl.get(day) || { date: day, qq: 0, dsh: 0 }; r[k]++; tl.set(day, r) }
  for (const o of qq) bump(dayOfValue(Number(o.at || o.createdAt || 0)), 'qq')
  for (const n of dsh) bump(dayOfValue(n.created), 'dsh')
  const timeline = [...tl.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-cfg.timelineDays)

  // ---- 星图：AI 与每个人 ----
  const center = { id: 'ming', name: 'AI', count: peopleList.filter((p) => !p.isOwner).reduce((s, p) => s + p.count, 0) }
  const spokes = peopleList.filter((p) => !p.isOwner).map((p) => ({ a: 'ming', b: p.id, w: p.count }))

  return {
    generatedAt: now,
    sources: {
      qq: { count: qq.length, active: qq.filter((o) => !o.status || o.status === 'active').length },
      dsh: { count: dsh.length, active: dsh.filter((n) => n.status === 'active').length },
    },
    center,
    people: peopleList,
    rooms: roomList,
    topics,
    edges: [...qqEdges, ...dshEdges],
    tags,
    timeline,
    spokes,
  }
}

export async function readDiaries(dir, days) {
  if (!dir) return []
  const out = []
  const since = Date.now() - Math.max(1, days || 60) * 86400000
  let list = []
  try { list = await fs.readdir(dir) } catch { return [] }
  for (const f of list) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
    if (!m) continue
    const at = Date.parse(m[1] + 'T00:00:00+08:00')
    if (!(at >= since)) continue
    let body = ''
    try { body = await fs.readFile(path.join(dir, f), 'utf8') } catch { continue }
    out.push({ date: m[1], title: m[1], at, body: body.slice(0, 4000) })
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1))
  return out
}
