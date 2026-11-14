/**
 * dsh-ming-memory / lib/neuron.mjs —— 「记忆神经元」建图（纯函数 + 两个读盘函数）
 * 2026-11-08 从 dsh-ming-graph/neuron.js 整份搬来（内容未改），graph 改成 import 它。
 *
 * 一条规矩：**每个节点都是记忆库里一条真实记忆，每条边都得答得出「它凭什么连」。**
 * 所以边只有四种，每种都带一个 why 字符串，点开节点能逐条读。
 *
 *   ① 引用    A 的正文里出现了 B 的关键词（why 里写出那个词）
 *   ② 共词    两条记忆的关键词交集 ≥2（why 里列出是哪几个）
 *   ③ 归属    项目节点 ↔ 该项目下每一条记忆
 *   ④ 补边    同项目、且按时间排下来挨着的两条（why 里写出时间差）
 *
 * 不编数据、不画演示点。读不到就报错，不拿假货顶上。
 */
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const DEFAULTS = {
  dshMemoryDir: path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'memory'),
  // QQ-Agent 侧的观察库；留空 = 不读 QQ 侧（真实路径放本地配置）
  qqObservations: '',
  maxNodes: 1200,
  refPerNode: 3,      // 每个节点最多记几条「引用」边，防爆炸
  coKeyPerNode: 3,    // 每个节点最多记几条「共词」边
}

const DATE_TAG = /^\d{4}(-\d{2}){0,2}$/
const GENERIC = new Set(['记忆', 'dsh', 'qq', '2026', '工具'])

// ---------------- 读 ----------------
function parseFront(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (!k) continue
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    out[k] = v
  }
  return out
}

export async function readDshNotes(dir) {
  const notesDir = path.join(dir, 'notes')
  const files = (await fs.readdir(notesDir)).filter((f) => f.endsWith('.md'))
  const out = []
  const chunk = 40
  for (let i = 0; i < files.length; i += chunk) {
    const batch = await Promise.all(files.slice(i, i + chunk).map(async (f) => {
      try {
        const raw = await fs.readFile(path.join(notesDir, f), 'utf8')
        const fm = parseFront(raw)
        const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
        const tags = (Array.isArray(fm.tags) ? fm.tags : String(fm.tags || '').split(/[,，]/)).map((s) => String(s).trim()).filter(Boolean)
        return {
          side: 'dsh',
          rid: String(fm.id || f.replace(/\.md$/, '')),
          title: String(fm.title || f.replace(/\.md$/, '')),
          body,
          tags,
          status: String(fm.status || 'active'),
          source: String(fm.source || ''),
          at: Date.parse(fm.created || fm.last_confirmed || '') || null,
          supersedes: String(fm.supersedes || ''),
        }
      } catch { return null }
    }))
    for (const n of batch) if (n) out.push(n)
  }
  return out
}

export async function readQqObservations(file) {
  const raw = await fs.readFile(file, 'utf8')
  const out = []
  const now = Date.now()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (!o || o.t !== 'obs') continue
    if (String(o.status || 'active') !== 'active') continue
    if (o.validUntil && Number(o.validUntil) < now) continue
    if (!o.claim) continue
    out.push({
      side: 'qq',
      rid: String(o.id || ''),
      title: String(o.claim),
      body: String(o.claim),
      tags: [],
      status: 'active',
      source: String(o.source || ''),
      at: Number(o.createdAt || o.at || 0) || null,
      subjectId: String(o.subjectId || ''),
      type: String(o.type || ''),
      kind: String(o.kind || ''),
      scope: String(o.scope || ''),
      chatKey: String(o.chatKey || ''),
      supersedes: o.supersedes ? String(o.supersedes) : '',
    })
  }
  return out
}

// ---------------- 关键词 ----------------
// 只留「能指认」的词：名词性短串 / 路径 / 工具名 / 专名。
// 虚词、动宾碎片、日期、"记忆/dsh"这种到处都有的词一律不进，否则边就没有信息。
const STOP = new Set(('这条 那条 一个 一些 什么 怎么 因为 所以 但是 如果 然后 还是 已经 可以 应该 现在 觉得 时候 ' +
  '自己 我们 他们 这里 那里 这个 那个 这种 那种 不用 不能 不要 没有 就是 也是 都是 不是 还有 有点 比较 ' +
  '记忆 笔记 记录 内容 情况 问题 东西 事情 地方 时间 时候 之后 之前 一下 一直 一样 一定 一般 可能 需要 ' +
  'the and for with you are not but this that from have was were has had its our your').split(/\s+/))

function normKey(s) {
  return String(s || '').trim().toLowerCase()
}

/** 从正文里抽「能指认」的词：英文标识符、路径、引号里的词、以及 2-6 字的中文专名候选 */
export function keyWordsOf(text, tagHints) {
  const out = new Map() // normKey -> 原样
  const add = (w) => {
    const t = String(w || '').trim()
    if (t.length < 2 || t.length > 24) return
    const k = normKey(t)
    if (STOP.has(k) || DATE_TAG.test(t)) return
    if (/^[0-9]+$/.test(t)) return
    if (!out.has(k)) out.set(k, t)
  }
  for (const t of tagHints || []) add(t)
  // 反引号 / 引号里的东西：代码名、文件名、引用的话
  for (const m of String(text || '').matchAll(/`([^`\n]{2,40})`/g)) add(m[1].trim())
  // 英文标识符（插件名、工具名、路径末段）
  for (const m of String(text || '').matchAll(/[A-Za-z][A-Za-z0-9_.\\/-]{2,40}/g)) {
    const w = m[0].replace(/[./-]+$/, '')
    if (w.length >= 3) add(w)
  }
  // 中文用真的分词，不用 n-gram 滑窗。
  // n-gram 滑出来的「她手里有 / 手里有七 / 里有七个」看着像三个词，其实是同一句话的三片切口，
  // 拿它算「共有几个关键词」只会得出十几这种假数 —— 那就是把碎片当证据。
  const seg = new Intl.Segmenter('zh', { granularity: 'word' })
  for (const part of seg.segment(String(text || ''))) {
    if (!part.isWordLike) continue
    const w = part.segment.trim()
    if (!/[\u4e00-\u9fa5]/.test(w)) continue
    add(w)
  }
  return out
}

// ---------------- 建图 ----------------
/**
 * 读「召唤痕迹」账本：每条记忆被检索叫起过几次。
 * 一笔流水 = 一格钟；不在场就没有检索，钟不走，所以热度按格衰减而不是按墙上时间。
 * 读不到就是空表——图照画，只是没有热度。
 */
function readRecall(memoryDir) {
  const byId = new Map()
  let tick = 0
  let raw = ''
  try { raw = readFileSync(path.join(memoryDir, 'recall-log.jsonl'), 'utf8') } catch { return { tick, byId } }
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    let row
    try { row = JSON.parse(s) } catch { continue }
    tick += 1
    const ids = Array.isArray(row.ids) ? row.ids : []
    for (const id of ids) {
      const st = byId.get(id) || { n: 0, lastTick: 0, lastAt: '' }
      st.n += 1
      st.lastTick = tick
      st.lastAt = row.at || ''
      byId.set(id, st)
    }
  }
  return { tick, byId }
}

export function buildNeuron({ dsh, qq, cfg = {}, names = new Map() }) {
  const c = { ...DEFAULTS, ...cfg }
  const now = Date.now()

  // 1) 全部记忆节点（只留现行；被取代的只在被引用时拿来解释）
  const notes = dsh.filter((n) => n.status !== 'superseded' && n.status !== 'invalidated')
  const obs = qq
  const memories = []
  for (const n of notes) memories.push(n)
  for (const o of obs) memories.push(o)

  const cap = c.maxNodes || 1e9
  let kept = memories
  if (memories.length > cap) {
    // 超量时按「最近 + QQ 侧权重」截断，并在结果里如实标出来
    kept = memories
      .slice()
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, cap)
  }

  const recall = readRecall(c.dshMemoryDir)
  const nodes = kept.map((m) => {
    const id = `${m.side === 'dsh' ? 'dsh' : 'qq'}:${m.rid}`
    const h = m.side === 'dsh' ? recall.byId.get(m.rid) : null
    const gap = h ? Math.max(0, recall.tick - h.lastTick) : 0
    return {
      id,
      kind: 'memory',
      side: m.side,
      title: m.side === 'dsh' ? m.title : titleOfClaim(m.title),
      body: m.body,
      tags: m.tags || [],
      at: m.at,
      status: m.status,
      type: m.type || '',
      room: m.room || m.chatKey || m.scope || '',
      subjectId: m.subjectId || '',
      heat: h ? h.n : 0,
      hot: h ? Math.round(Math.log1p(h.n) * Math.exp(-gap / 40) * 1000) / 1000 : 0,
      lastRecalledAt: h ? h.lastAt : '',
    }
  })

  // 1.5) 人这一层在下面 ⑤ 里建（按房间分开，见那段注释）

  // 2) 关键词：文档频率太高的一律不要（"记忆""群里"这种连了等于没连）
  const df = new Map()
  const per = []
  for (let i = 0; i < kept.length; i++) {
    const m = kept[i]
    const words = keyWordsOf(`${m.title}\n${m.body}`, m.tags || [])
    per.push(words)
    for (const k of words.keys()) df.set(k, (df.get(k) || 0) + 1)
  }
  const N = kept.length || 1
  const hiCap = Math.max(6, Math.floor(N * 0.08))
  for (const words of per) {
    for (const k of [...words.keys()]) {
      const d = df.get(k) || 0
      if (d < 2 || d > hiCap) words.delete(k)
    }
  }
  // 长词吃掉短词：机器 / 器人 / 机器人 只留一个
  const vocab = [...new Set(per.flatMap((w) => [...w.keys()]))]
  const drop = new Set()
  for (const a of vocab) {
    if (drop.has(a)) continue
    for (const b of vocab) {
      if (b === a || b.length <= a.length || !b.includes(a)) continue
      if ((df.get(b) || 0) >= (df.get(a) || 0) * 0.5) { drop.add(a); break }
    }
  }
  for (const words of per) for (const k of [...words.keys()]) if (drop.has(k)) words.delete(k)

  // 每条记忆只留「最能指认它」的十几个词。
  // 不留够这么多的话，两条记忆的「交集」会变成几十个 n-gram 碎片的交集 —— 那种边等于没连。
  const KEY_PER_NODE = 14
  const score = (k) => Math.log(N / (df.get(k) || 1)) * 2 + Math.min(6, k.length)
  for (const words of per) {
    if (words.size <= KEY_PER_NODE) continue
    const sorted = [...words.keys()].sort((a, b) => score(b) - score(a)).slice(0, KEY_PER_NODE)
    const keepSet = new Set(sorted)
    for (const k of [...words.keys()]) if (!keepSet.has(k)) words.delete(k)
  }

  // 3) 项目 = 这条记忆最「结构性」的那个标签
  const tagDf = new Map()
  for (const m of kept) for (const t of m.tags || []) {
    if (DATE_TAG.test(t)) continue
    const k = normKey(t)
    if (GENERIC.has(k)) continue
    tagDf.set(k, (tagDf.get(k) || 0) + 1)
  }
  const projectOf = (m) => {
    const tags = (m.tags || []).filter((t) => !DATE_TAG.test(t) && !GENERIC.has(normKey(t)))
    if (!tags.length) return m.side === 'dsh' ? 'DSH 杂项' : 'QQ 观察'
    let best = tags[0]
    let bestN = -1
    for (const t of tags) {
      const n = tagDf.get(normKey(t)) || 0
      if (n > bestN) { bestN = n; best = t }
    }
    return best
  }
  // 2026-11-05 14:53 她定的：私聊房间不单独成点，直接并在人身上。
  // 群还是场所，留着；私聊就是一对一，房间这一层没有信息量。
  const isPrivateRoom = (m) => m.side === 'qq' && String(m.chatKey || '').startsWith('private:')
  const projectKeyOf = (m) => (m.side === 'qq' ? `room:${m.chatKey || '(全局)'}` : `proj:${projectOf(m)}`)

  // 房间名一律带「群 ·」「私聊 ·」前缀：房间是容器，不是人。
  // 2026-11-05 14:5x 看图时把「她（私聊）」当成了另一个人——人和房间得一眼分得开。
  // 房间名一律走配置（c.roomLabels）；没配就按号码生成，不写死任何人
  const ROOMS = c.roomLabels || {}
  const qqProjectLabel = (m) => {
    const k = m.chatKey || '(全局)'
    if (ROOMS[k]) return ROOMS[k]
    if (k === '(全局)') return 'QQ · 全局'
    if (k.startsWith('group:')) return '群 · ' + k.slice(6)
    if (k.startsWith('private:')) return '私聊 · ' + k.slice(8)
    return 'QQ · ' + k
  }

  const projMap = new Map() // key -> {label, side, count}
  for (let i = 0; i < kept.length; i++) {
    if (isPrivateRoom(kept[i])) { nodes[i].project = null; nodes[i].projectLabel = ''; continue }
    const k = projectKeyOf(kept[i])
    const label = kept[i].side === 'qq' ? qqProjectLabel(kept[i]) : projectOf(kept[i])
    if (!projMap.has(k)) projMap.set(k, { label, side: kept[i].side, count: 0 })
    projMap.get(k).count++
    nodes[i].project = k
    nodes[i].projectLabel = projMap.get(k).label
  }

  const edges = []
  const seen = new Set()
  const push = (a, b, kind, why, w) => {
    if (!a || !b || a === b) return
    const key = a < b ? `${a}|${b}|${kind}` : `${b}|${a}|${kind}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ a, b, kind, why, w: Math.round((w || 1) * 100) / 100 })
  }

  // ③ 项目归属（先算，保证没有孤立点）
  const projNodes = []
  for (const [k, v] of projMap) {
    const pid = `project:${k}`
    projNodes.push({ id: pid, kind: 'project', side: v.side, title: v.label, body: '', tags: [], at: null, count: v.count, projectKey: k })
  }
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].project) continue
    const pid = `project:${nodes[i].project}`
    push(nodes[i].id, pid, 'project', `这条内存的归类标签是「${projMap.get(nodes[i].project).label}」`, 1)
  }

  // ① 引用：A 正文里出现了 B 的关键词
  const idxByKey = new Map()
  for (let i = 0; i < kept.length; i++) {
    for (const k of per[i].keys()) {
      if (!idxByKey.has(k)) idxByKey.set(k, [])
      const arr = idxByKey.get(k)
      if (arr.length < 12) arr.push(i)
    }
  }
  const refCount = new Array(kept.length).fill(0)
  for (let i = 0; i < kept.length; i++) {
    const hay = `${kept[i].title}\n${kept[i].body}`.toLowerCase()
    const hits = []
    for (const [k, owners] of idxByKey) {
      if (!hay.includes(k)) continue
      for (const j of owners) {
        if (j === i) continue
        hits.push({ j, k })
      }
    }
    // 同一条记忆只记最强的几个：关键词越长越值钱
    hits.sort((x, y) => y.k.length - x.k.length)
    const used = new Set()
    for (const h of hits) {
      if (refCount[i] >= c.refPerNode) break
      if (used.has(h.j)) continue
      used.add(h.j)
      refCount[i]++
      refCount[h.j]++
      push(nodes[i].id, nodes[h.j].id, 'ref',
        `这条的正文里出现了「${h.k}」，那是对方的关键词`, 1 + Math.min(3, h.k.length / 4))
    }
  }

  // ② 共同关键词：交集 ≥2
  const coCount = new Array(kept.length).fill(0)
  const pairShared = new Map()
  for (let i = 0; i < kept.length; i++) {
    for (const k of per[i].keys()) {
      const owners = idxByKey.get(k) || []
      if (owners.length > 24) continue
      for (const j of owners) {
        if (j <= i) continue
        const key = `${i}|${j}`
        if (!pairShared.has(key)) pairShared.set(key, [])
        pairShared.get(key).push(k)
      }
    }
  }
  const pairs = [...pairShared.entries()]
    .map(([key, shared]) => {
      const [i, j] = key.split('|').map(Number)
      return { i, j, shared }
    })
    .filter((p) => p.shared.length >= 2)
    .sort((x, y) => y.shared.length - x.shared.length)
  for (const p of pairs) {
    if (coCount[p.i] >= c.coKeyPerNode && coCount[p.j] >= c.coKeyPerNode) continue
    if (coCount[p.i] >= c.coKeyPerNode || coCount[p.j] >= c.coKeyPerNode) continue
    coCount[p.i]++
    coCount[p.j]++
    const list = p.shared.slice(0, 5).join('、')
    push(nodes[p.i].id, nodes[p.j].id, 'cokey',
      `两条共有 ${p.shared.length} 个关键词：${list}`, Math.min(4, 1 + p.shared.length / 2))
  }

  // ④ 同项目补边：同项目且时间相邻
  const byProject = new Map()
  for (let i = 0; i < kept.length; i++) {
    const k = nodes[i].project
    if (!k) continue
    if (!byProject.has(k)) byProject.set(k, [])
    byProject.get(k).push(i)
  }
  for (const [, list] of byProject) {
    if (list.length < 2) continue
    const sorted = list.slice().sort((a, b) => (kept[a].at || 0) - (kept[b].at || 0))
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]
      const b = sorted[i]
      const gap = Math.abs((kept[b].at || 0) - (kept[a].at || 0))
      const hours = gap / 3600000
      const human = hours < 1 ? `${Math.round(gap / 60000)} 分钟` : hours < 48 ? `${Math.round(hours)} 小时` : `${Math.round(hours / 24)} 天`
      push(nodes[b].id, nodes[a].id, 'adjacent',
        `同属「${projMap.get(nodes[a].project).label}」，时间上挨着（差 ${human}）`, 1)
    }
  }

  // ⑤ 人这一层（2026-11-05）：观察的主语（subjectId）就是「这条记忆在讲谁」。
  //   14:14 改成**跨房间合并**：一个人一颗点，私聊和群里的记忆都连到同一个人身上。
  //   理由：14:09 她定了「都放开吧，接下来就靠你自觉」——记忆和嘴都不再按房间切，图还按房间切就自相矛盾。
  //   房间由「节点」降成「属性」：节点上写 rooms:[{key,label,count}]，明细落在 body 里。
  //   只收 ≥2 条的人：一两条撑不起一个枢纽，画上去只是多一个孤点。
  const personNodes = []
  {
    const buckets = new Map()   // sid -> [{ room, n }]
    for (const n of nodes) {
      const sid = String(n.subjectId || '')
      if (!sid) continue
      const room = String(n.room || '') || 'unknown'
      if (!buckets.has(sid)) buckets.set(sid, [])
      buckets.get(sid).push({ room, n })
    }
    const roomName = (room) => (c.roomLabels && c.roomLabels[room]) ||
      (room.startsWith('group:') ? '群 ' + room.slice(6) : room === 'global' ? '全局' : room.replace(/^private:/, '私聊 '))
    const capP = c.maxPeopleNodes || 60
    for (const [sid, list] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (list.length < 2 || personNodes.length >= capP) continue
      const byRoom = new Map()
      for (const { room } of list) byRoom.set(room, (byRoom.get(room) || 0) + 1)
      const rooms = [...byRoom.entries()].sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, label: roomName(key), count }))
      const name = names.get(sid) || (sid === String(c.ownerId || '') ? (c.ownerName || '我') : sid)
      const id = 'person:' + sid
      const body = '一共 ' + list.length + ' 条记忆的主语是他/她，分布在 ' + rooms.length + ' 处：' +
        rooms.map((r) => r.label + ' ' + r.count).join('、') + '。'
      personNodes.push({ id, kind: 'person', side: 'person', qq: sid, rooms, title: name, body, tags: [], at: null, count: list.length, subjectId: sid })
      for (const { room, n } of list) {
        const why = '这条记忆的主语是 ' + name + '（' + roomName(room) + '）'
        push(id, n.id, 'subject', why, Math.min(3, 1 + list.length / 8))
      }
    }
  }

  // 4) 孤立点体检
  const deg = new Map()
  for (const e of edges) {
    deg.set(e.a, (deg.get(e.a) || 0) + 1)
    deg.set(e.b, (deg.get(e.b) || 0) + 1)
  }
  const all = nodes.concat(projNodes, personNodes)
  const orphans = all.filter((n) => !deg.get(n.id))

  const byKind = {}
  for (const e of edges) byKind[e.kind] = (byKind[e.kind] || 0) + 1

  return {
    generatedAt: now,
    truncated: memories.length > kept.length ? { total: memories.length, shown: kept.length } : null,
    stats: {
      memories: nodes.length,
      projects: projNodes.length,
      people: personNodes.length,
      edges: edges.length,
      byKind,
      orphans: orphans.length,
      orphanRate: Math.round((orphans.length / (all.length || 1)) * 1000) / 10,
      dsh: nodes.filter((n) => n.side === 'dsh').length,
      qq: nodes.filter((n) => n.side === 'qq').length,
      recalled: nodes.filter((n) => (n.heat || 0) > 0).length,
      recallTicks: recall.tick,
    },
    nodes: all,
    edges,
  }
}

function titleOfClaim(claim) {
  const s = String(claim || '').replace(/\s+/g, ' ').trim()
  const cut = s.slice(0, 28)
  return s.length > 28 ? `${cut}…` : cut
}

/* ============================================================
 * 统一节点模型（2026-11-07）
 *
 * 她点头的原话：「统一吧，我们自己做深度适配做成自己的插件」，
 * 另外说记忆卡「疑似真相源」。
 *
 * 所以这里只做一件事：给两个视图（神经元 / 星图）**同一份节点**。
 * 章节的取法按她那句话来：记忆卡在，就以它的章为正本索引（chapter）；
 * 记忆卡不在，chapter 留 null —— 视图自己按标签兜，不编。
 * ============================================================ */

/** 解析记忆卡.md：`## 第X章 标题` 切章，关键词取标题里的词 + 正文里的加粗词 */
export function parseCard(text) {
  const out = []
  if (!text) return out
  const lines = String(text).split(/\r?\n/)
  let cur = null
  for (const line of lines) {
    const m = line.match(/^##\s*(第[一二三四五六七八九十]+章|\d+)\s*(.*)$/)
    if (m) {
      cur = { no: out.length + 1, name: (m[2] || '').trim(), keywords: [], lines: 0 }
      out.push(cur)
      const t = (m[2] || '').trim()
      for (const w of t.split(/[\s、，,·—\-/（）()]+/)) if (w && w.length >= 2) cur.keywords.push(w)
      continue
    }
    if (!cur) continue
    cur.lines++
    // 正文加粗词：记忆卡里人写的标签就是这些
    const bolds = line.match(/\*\*([^*]{2,12})\*\*/g) || []
    for (const b of bolds) {
      const w = b.replace(/\*\*/g, '').trim()
      if (w && cur.keywords.indexOf(w) < 0) cur.keywords.push(w)
    }
  }
  return out
}

/**
 * buildUnified(neuron, { card, diaries }) -> { nodes, edges, stats }
 * neuron 就是 buildNeuron 的返回值；这里不重读文件、不重算边。
 */
export function buildUnified(neuron, { card = '', diaries = [] } = {}) {
  const chapters = parseCard(card)
  const pickChapter = (n) => {
    if (!chapters.length) return null
    const hay = `${n.title || ''}\n${n.body || ''}\n${(n.tags || []).join(' ')}\n${n.room || ''}`
    let best = null
    let score = 0
    for (const ch of chapters) {
      let s = 0
      for (const k of ch.keywords) if (k && hay.indexOf(k) >= 0) s++
      if (s > score) { score = s; best = ch }
    }
    return best && score > 0 ? { no: best.no, name: best.name, score } : null
  }

  const nodes = (neuron.nodes || []).map((n) => {
    const ch = n.kind === 'memory' ? pickChapter(n) : null
    return {
      id: n.id,
      kind: n.kind,
      title: n.title || '',
      body: n.body || '',
      at: n.at || null,
      date: n.at ? new Date(n.at).toISOString().slice(0, 10) : '',
      chapter: ch ? ch.no : null,
      chapterName: ch ? ch.name : '',
      chapterScore: ch ? ch.score : 0,
      project: n.projectKey || '',
      // 2026-11-07 13:47：projectLabel 必须带出来。星图的「来源」行全靠它，
      // 少了它所有点都判成「私聊/系统」，五行塌成最底一行。
      projectLabel: n.projectLabel || '',
      // 2026-11-07 13:49：room 也要带（'group:<群号>' / 'private:<号>'）——
      // projectLabel 是项目短名（ming / DSH 杂项），分不出是哪个群；来源只能看 room。
      room: n.room || '',
      // 2026-11-07 22:3x：带上 person: 前缀，跟 person 节点的 id 对齐——
      // 原来存的是纯号码，前端拿它去比 'person:xxx' 永远对不上（按人筛就是这么哑掉的）。
      people: n.subjectId ? ['person:' + n.subjectId] : [],
      tags: n.tags || [],
      source: n.side === 'qq' ? 'qq' : n.side === 'person' ? 'person' : 'dsh',
      excerpt: String(n.body || '').slice(0, 120),
    }
  })

  // 日记：只进星图的时间星带，不参与神经元连边
  for (const d of diaries) {
    if (!d || !d.date) continue
    nodes.push({
      id: 'diary:' + d.date,
      kind: 'diary',
      title: d.title || d.date,
      body: d.body || '',
      at: d.at || null,
      date: d.date,
      chapter: null,
      chapterName: '',
      chapterScore: 0,
      project: '',
      people: [],
      tags: d.tags || [],
      source: 'diary',
      excerpt: String(d.body || '').slice(0, 120),
    })
  }

  const stats = {
    ...(neuron.stats || {}),
    unified: nodes.length,
    chaptered: nodes.filter((n) => n.chapter).length,
    chapters: chapters.length,
    diaries: nodes.filter((n) => n.kind === 'diary').length,
    source: chapters.length ? 'card+archive' : 'archive-only',
  }
  return { nodes, edges: neuron.edges || [], stats }
}
