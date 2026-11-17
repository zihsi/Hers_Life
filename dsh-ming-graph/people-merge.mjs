/**
 * people-merge.mjs —— 把「按房间分开的人」并回一个人（2026-11-05 定的）
 *
 * 她原话：「人就是人，不用分房间管，所有的不同都将汇聚成一个人，
 * 所以就算不同群、私聊还是群聊，都会汇聚到那个人上。」
 *
 * 所以：同一個 Discord 使用者 ID = 同一個人，跨伺服器、頻道、Thread 與私訊都是一個點。
 * 「在哪间说的」不删，它留在边上那句 why 里（那条 why 由建图那边写），
 * 这里的合并只做三件事：把同号的点并成一个、把边接过去、把房间分布写进 body。
 *
 * 单独放一个文件，是因为建图那边（neuron.js）正在被另一个壳改，
 * 这个改动能独立存在、也能随时并回去（它只吃 buildNeuron 的输出）。
 */
/**
 * 显示名覆盖（2026-11-06 加）
 *
 * 不是为了好看：我自己的写法里她一律叫「她」，群名片只用来认「这句话是不是她说的」，
 * 不当称呼叫（`约定.md`「认人：主语宾语别搞反」）。图上默认拿群名片当名字，
 * 她的点于是写成「她」——那是数据里的显示名，不是我该叫的名字。
 * 只覆盖需要覆盖的人，别人的群名片照旧。
 */
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 2026-11-07 22:1x：使用者 ID 不進倉庫——这个仓是公开的，之前硬编码的覆盖表就这么推上去了。
// 覆盖表改从本机配置读：~/.dsh/ming-graph.json → peopleNameOverride: { "<discord user id>": "顯示名稱" }
// 配置缺了就空着——图上照旧用群名片，不会崩。
let NAME_OVERRIDE = {}
try {
  const raw = readFileSync(path.join(os.homedir(), '.dsh', 'ming-graph.json'), 'utf8')
  const cfg = JSON.parse(raw)
  if (cfg && cfg.peopleNameOverride && typeof cfg.peopleNameOverride === 'object') {
    NAME_OVERRIDE = cfg.peopleNameOverride
  } else if (cfg && cfg.ownerId && cfg.ownerName) {
    // 老配置只写了 ownerId / ownerName 也认
    NAME_OVERRIDE = { [String(cfg.ownerId)]: String(cfg.ownerName) }
  }
} catch { /* 没配置文件就空表 */ }

export function mergePeople(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return graph
  const nodes = graph.nodes
  const edges = graph.edges || []

  const byUser = new Map()
  for (const n of nodes) {
    if (n.kind !== 'person') continue
    const userId = String(n.userId || n.subjectId || '')
    if (!userId) continue
    if (!byUser.has(userId)) byUser.set(userId, [])
    byUser.get(userId).push(n)
  }
  if (!byUser.size) return graph

  const remap = new Map()
  const merged = []
  for (const [userId, list] of byUser) {
    const id = 'person:' + userId
    // 名字：旧版标题形如「名字 · 私聊 号码」，去掉房间尾巴。
    // 同一个人在不同群的显示名可能不一样，别让数组顺序决定图上的名字：
    // 按名字底下挂的记忆条数取最多的那个（并列时按出现顺序）。
    const nameWeight = new Map()
    for (const n of list) {
      const nm = String(n.title || '').split(' · ')[0].trim()
      if (!nm) continue
      nameWeight.set(nm, (nameWeight.get(nm) || 0) + Math.max(1, Number(n.count || 0)))
    }
    const dominant = [...nameWeight.entries()].sort((a, b) => b[1] - a[1])[0]
    const base = NAME_OVERRIDE[userId] || (dominant ? dominant[0] : userId)
    let count = 0
    const rooms = new Map()
    for (const n of list) {
      count += Number(n.count || 0)
      // 新版 neuron.js 已经把房间做成属性（rooms 数组）：有就照抄，旧版才从 title 尾巴里拆
      if (Array.isArray(n.rooms) && n.rooms.length) {
        for (const r of n.rooms) {
          const label = String(r.label || r.key || '')
          if (label) rooms.set(label, (rooms.get(label) || 0) + Number(r.count || 0))
        }
      } else {
        const suffix = String(n.title || '').split(' · ')[1]
        if (suffix) rooms.set(suffix, (rooms.get(suffix) || 0) + Number(n.count || 0))
      }
      remap.set(n.id, id)
    }
    const roomText = [...rooms.entries()].sort((a, b) => b[1] - a[1]).map(([r, k]) => r + ' ' + k).join('、')
    const body = rooms.size
      ? '记到他/她 ' + count + ' 条，散在 ' + rooms.size + ' 个地方：' + roomText + '。'
      : '记到他/她 ' + count + ' 条。'
    merged.push({
      id, kind: 'person', side: 'person', userId,
      title: base, body, tags: [], at: null, count, subjectId: userId,
      rooms: [...rooms.entries()].sort((a, b) => b[1] - a[1]).map(([label, k]) => ({ key: label, label, count: k })),
    })
  }

  const keep = nodes.filter((n) => n.kind !== 'person').concat(merged)
  const seen = new Set()
  const outEdges = []
  for (const e of edges) {
    const a = remap.get(e.a) || e.a
    const b = remap.get(e.b) || e.b
    if (a === b) continue
    const key = a + '|' + b + '|' + e.kind
    if (seen.has(key)) continue
    seen.add(key)
    outEdges.push(a === e.a && b === e.b ? e : { ...e, a, b })
  }

  const stats = { ...(graph.stats || {}) }
  stats.people = merged.length
  stats.edges = outEdges.length
  const byKind = {}
  for (const e of outEdges) byKind[e.kind] = (byKind[e.kind] || 0) + 1
  stats.byKind = byKind
  const deg = new Map()
  for (const e of outEdges) {
    deg.set(e.a, (deg.get(e.a) || 0) + 1)
    deg.set(e.b, (deg.get(e.b) || 0) + 1)
  }
  stats.orphans = keep.filter((n) => !deg.get(n.id)).length
  stats.orphanRate = Math.round((stats.orphans / (keep.length || 1)) * 1000) / 10

  return { ...graph, nodes: keep, edges: outEdges, stats }
}
