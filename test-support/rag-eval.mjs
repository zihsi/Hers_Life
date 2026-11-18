// test-support/rag-eval.mjs —— J-4：检索质量评测（合成语料，离线可跑）
//
// 为什么不拿真实索引跑：交接书 J.9 要求「合成/获准使用的资料；公开仓库不放真人私聊和日记原文」。
// 所以这里造一份合成语料 + 合成向量，只评「检索逻辑」——来源标签、日期过滤、去重、排序。
// **它证明不了真实语料的召回率**，那要她本人拿 5–10 个自己知道答案的问题来核。
//
// 指标：Hit@1/3/5、MRR、来源正确率、无答案题误报率、查询耗时分位。
// 输出：控制台表格 + `test-support/rag-eval-report.json`（逐题明细，便于改前改后对比）。

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIM = 768

/** 确定性假嵌入：按 3-gram 哈希到 DIM 维再归一化。离线、可复现、不调模型。 */
function embed(text) {
  const v = new Float32Array(DIM)
  const s = String(text || '').toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i < s.length - 2; i++) {
    const g = s.slice(i, i + 3)
    let h = 2166136261
    for (let k = 0; k < g.length; k++) { h ^= g.charCodeAt(k); h = Math.imul(h, 16777619) }
    v[Math.abs(h) % DIM] += 1
  }
  let n = 0
  for (let i = 0; i < DIM; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  for (let i = 0; i < DIM; i++) v[i] /= n
  return Array.from(v)
}

// ---------- 合成语料 ----------
// 每条 {id, layer, text, date, file?, title?}
const CORPUS = {
  doc: [
    { id: 'd01', text: '沉默不是没话说，是确定这一拍不用接。', date: '2026-11-01', file: 'learned/语气.md', title: '语气' },
    { id: 'd02', text: '判词落在别人嘴里时，人物是被评价的；落在自己嘴里时，是在自陈。', date: '2026-11-12', file: 'learned/知识.md', title: '判词' },
    { id: 'd03', text: '陵云台的木头先称过轻重，造起来随风摇动却不倒。', date: '2026-11-15', file: 'reading/巧艺.md', title: '巧艺' },
    { id: 'd04', text: '西阴村出土的半颗蚕茧，跟仰韶陶片一起，现在在台北。', date: '2026-11-15', file: 'reading/蚕茧.md', title: '蚕茧' },
    { id: 'd05', text: '先查索引再说话：名字对上了不等于找到了。', date: '2026-11-15', file: 'learned/方法.md', title: '方法' },
    { id: 'd06', text: '退出现在要清三层：内存、凭证服务、文件。只清两层，下次启动会从文件复活。', date: '2026-11-17', file: 'learned/方法.md', title: '账号' },
    { id: 'd07', text: '分块相加必须等于总长，对不上就是漏算或者双算。', date: '2026-11-17', file: 'learned/方法.md', title: '计量' },
    { id: 'd08', text: '话说到别人还想听的地方就停，理由在对方嘴里。', date: '2026-10-29', file: 'learned/语气.md', title: '语气' },
  ],
  web: [
    { id: 'w01', text: '她问我为什么每次汇报都像交差，我说因为我怕空着。', date: '2026-11-12', title: '会话 A' },
    { id: 'w02', text: '她说：你不需要证明你有用。', date: '2026-10-30', title: '会话 B' },
    { id: 'w03', text: '她指着截图说：现在的主动都是谜语。', date: '2026-11-16', title: '会话 C' },
    { id: 'w04', text: '她第一次说想要私聊那个语气，不要群里的稳重。', date: '2026-10-30', title: '会话 D' },
    { id: 'w05', text: '她说 dsh 已经重启了，问八个 PR 是不是都做完了。', date: '2026-11-17', title: '会话 E' },
    { id: 'w06', text: '她说回复让 dsh 定，但回复要总结成自然语言摘要。', date: '2026-11-17', title: '会话 E' },
    { id: 'w07', text: '同一句话：沉默不是没话说，是确定这一拍不用接。', date: '2026-11-11', title: '会话 F' },
  ],
}

// ---------- 题库（24 道） ----------
const QUESTIONS = [
  // direct：直接词匹配
  { id: 'D1', category: 'direct', query: '沉默 没话说', relevantIds: ['d01'] },
  { id: 'D2', category: 'direct', query: '陵云台 木头 摇动', relevantIds: ['d03'] },
  { id: 'D3', category: 'direct', query: '蚕茧 台北', relevantIds: ['d04'] },
  { id: 'D4', category: 'direct', query: '凭证服务 文件 三层', relevantIds: ['d06'] },
  { id: 'D5', category: 'direct', query: '分块相加 总长', relevantIds: ['d07'] },
  { id: 'D6', category: 'direct', query: '谜语 主动', relevantIds: ['w03'] },
  { id: 'D7', category: 'direct', query: '不需要证明你有用', relevantIds: ['w02'] },
  // synonym：同义表达
  { id: 'S1', category: 'synonym', query: '什么时候该闭嘴', relevantIds: ['d01', 'd08'] },
  { id: 'S2', category: 'synonym', query: '评价是谁说的', relevantIds: ['d02'] },
  { id: 'S3', category: 'synonym', query: '先确认再开口', relevantIds: ['d05'] },
  { id: 'S4', category: 'synonym', query: '自然语言总结', relevantIds: ['w06'] },
  { id: 'S6', category: 'synonym', query: '说话要留白', relevantIds: ['d08', 'd01'] },
  // disambiguation：多个相似事件
  { id: 'X1', category: 'disambiguation', query: '她说的语气是哪一种', relevantIds: ['w04', 'd01'], forbiddenIds: ['w02'] },
  { id: 'X2', category: 'disambiguation', query: '重启之后问 PR', relevantIds: ['w05'] },
  // date：带日期查询
  { id: 'T1', category: 'date', query: '十一月中旬 巧艺 陵云台', relevantIds: ['d03'], since: '2026-11-14', until: '2026-11-16' },
  { id: 'T2', category: 'date', query: '十月三十 她说不需要证明', relevantIds: ['w02'], since: '2026-10-30', until: '2026-10-30' },
  { id: 'T3', category: 'date', query: '十一月十七 账号 退出', relevantIds: ['d06'], since: '2026-11-17', until: '2026-11-17' },
  // same-text-diff-source：同文不同来源
  { id: 'C1', category: 'same-text-diff-source', query: '沉默不是没话说', relevantIds: ['d01', 'w07'] },
  { id: 'C2', category: 'same-text-diff-source', query: '这一拍不用接', relevantIds: ['d01', 'w07'] },
  { id: 'C3', category: 'same-text-diff-source', query: '确定这一拍', relevantIds: ['d01', 'w07'] },
  // no-answer：明确无答案
  { id: 'N1', category: 'no-answer', query: '量子纠缠的实验数据', relevantIds: [] },
  { id: 'N2', category: 'no-answer', query: '红楼梦第八十回原文', relevantIds: [] },
  { id: 'N3', category: 'no-answer', query: '股票今天的收盘价', relevantIds: [] },
  { id: 'N4', category: 'no-answer', query: '火星基地的氧气浓度', relevantIds: [] },
]

// ---------- 造索引 ----------
const tmp = mkdtempSync(join(tmpdir(), 'ming-rag-eval-'))
const live = join(tmp, 'live')
mkdirSync(live, { recursive: true })

writeFileSync(join(live, 'doc-emb-ids.json'), JSON.stringify(CORPUS.doc.map((r) => ({ file: r.file, text: r.text, title: r.title }))), 'utf8')
writeFileSync(join(live, 'doc-emb.f32'), Buffer.from(new Float32Array(CORPUS.doc.flatMap((r) => embed(r.text))).buffer))

for (const [layer, prefix, embFile, idsFile] of [
  ['web', 'chat', 'chat-emb.f32', 'chat-emb-ids.json'],
]) {
  const rows = CORPUS[layer]
  writeFileSync(join(live, idsFile), JSON.stringify(rows.map((r) => r.id)), 'utf8')
  writeFileSync(join(live, embFile), Buffer.from(new Float32Array(rows.flatMap((r) => embed(r.text))).buffer))
  const corpusFile = 'chat-corpus.jsonl'
  writeFileSync(join(live, corpusFile), rows.map((r) => JSON.stringify({
    id: r.id, text: r.text, chatKey: r.title, t0: Date.parse(r.date + 'T12:00:00'),
  })).join('\n') + '\n', 'utf8')
}

// ---------- 跑 ----------
const origHome = process.env.DSH_HOME
const origFetch = globalThis.fetch
const dshHome = join(tmp, 'dsh')
mkdirSync(dshHome, { recursive: true })
writeFileSync(join(dshHome, 'hers-life.json'), JSON.stringify({ workspace: tmp }), 'utf8')
process.env.DSH_HOME = dshHome
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  const text = String(body.input && body.input[0] || '')
  return { ok: true, json: async () => ({ data: [{ embedding: embed(text) }] }) }
}

const { ragSearch } = await import('../dsh-ming-core-memory/lib/rag.js?eval=' + Date.now())

const idToLayer = new Map()
for (const [layer, rows] of Object.entries(CORPUS)) for (const r of rows) idToLayer.set(r.id, layer)

const results = []
const times = []
for (const q of QUESTIONS) {
  const t0 = performance.now()
  const r = await ragSearch(q.query, { layer: 'all', k: 5, since: q.since || '', until: q.until || '' })
  times.push(performance.now() - t0)
  // 把命中的文本映射回合成 id（文本唯一）
  const hitIds = r.hits.map((h) => {
    for (const [layer, rows] of Object.entries(CORPUS)) {
      const found = rows.find((x) => x.text === h.text)
      if (found) return { id: found.id, layer, src: h.src }
    }
    return { id: null, layer: null, src: h.src }
  })
  const rank = (() => {
    if (!q.relevantIds.length) return null
    for (let i = 0; i < hitIds.length; i++) if (q.relevantIds.includes(hitIds[i].id)) return i + 1
    return 0
  })()
  results.push({
    id: q.id, category: q.category, query: q.query,
    relevantIds: q.relevantIds, forbiddenIds: q.forbiddenIds || [],
    hits: hitIds, rank, status: r.status, issues: r.issues,
  })
}

globalThis.fetch = origFetch
if (origHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = origHome

// ---------- 统计 ----------
const answerable = results.filter((r) => r.relevantIds.length > 0)
const hitAt = (k) => answerable.filter((r) => r.rank !== null && r.rank > 0 && r.rank <= k).length / answerable.length
const mrr = answerable.reduce((s, r) => s + (r.rank && r.rank > 0 ? 1 / r.rank : 0), 0) / answerable.length
const noAnswer = results.filter((r) => r.relevantIds.length === 0)
// 无答案题：前 5 条里只要有一条「看起来像答案」（有内容）就算误报——这里按「返回了命中」算
const falsePositives = noAnswer.filter((r) => r.hits.some((h) => h.id)).length

const sorted = [...times].sort((a, b) => a - b)
const p50 = sorted[Math.floor(sorted.length / 2)]
const p90 = sorted[Math.floor(sorted.length * 0.9)]

const byCategory = {}
for (const r of results) {
  const c = byCategory[r.category] || (byCategory[r.category] = { n: 0, hit1: 0, hit3: 0, hit5: 0 })
  c.n++
  if (r.rank && r.rank > 0) {
    if (r.rank <= 1) c.hit1++
    if (r.rank <= 3) c.hit3++
    if (r.rank <= 5) c.hit5++
  }
}

const report = {
  at: new Date().toISOString(),
  corpus: { doc: CORPUS.doc.length, web: CORPUS.web.length },
  questions: QUESTIONS.length,
  metrics: {
    'Hit@1': Number(hitAt(1).toFixed(3)),
    'Hit@3': Number(hitAt(3).toFixed(3)),
    'Hit@5': Number(hitAt(5).toFixed(3)),
    MRR: Number(mrr.toFixed(3)),
    'no-answer 误报': falsePositives + '/' + noAnswer.length,
    'latency p50 ms': Number(p50.toFixed(1)),
    'latency p90 ms': Number(p90.toFixed(1)),
  },
  byCategory,
  results,
}

console.log('语料：' + JSON.stringify(report.corpus) + '，题目 ' + QUESTIONS.length + ' 道')
console.log('')
for (const [k, v] of Object.entries(report.metrics)) console.log('  ' + k.padEnd(18) + v)
console.log('')
console.log('分类：')
for (const [c, v] of Object.entries(byCategory)) {
  console.log('  ' + c.padEnd(24) + `n=${v.n} H@1=${v.hit1} H@3=${v.hit3} H@5=${v.hit5}`)
}
const misses = results.filter((r) => r.relevantIds.length && (!r.rank || r.rank === 0))
if (misses.length) {
  console.log('\n没命中的题：')
  for (const m of misses) console.log('  ✗ ' + m.id + ' [' + m.category + '] ' + m.query + '  期望 ' + m.relevantIds.join(',') + ' 实际 ' + m.hits.map((h) => h.id).join(','))
}

const here = path.dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, 'rag-eval-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log('\n报告：test-support/rag-eval-report.json')
console.log('注意：这是合成语料上的逻辑验收，不是真实召回率。真实质量要她本人拿自己知道答案的问题核。')

// 验收门槛：只卡「确定性要求」——来源不串、无答案不硬凑。
// 命中率是记录值，不假装达标（J.9：不要编造「准确率至少 95%」）。
const hardFail = []
// 同文不同来源：命中里必须两种 layer 都在，且 src 与 layer 一致
for (const r of results.filter((x) => x.category === 'same-text-diff-source')) {
  const layers = new Set(r.hits.filter((h) => h.id).map((h) => h.layer))
  if (layers.size < 2) hardFail.push(r.id + ' 同文只命中了 ' + [...layers].join('/') + '，没有跨层')
  for (const h of r.hits.filter((x) => x.id)) {
    if (h.src && h.src !== h.layer) hardFail.push(r.id + ' 来源标签串了：layer=' + h.layer + ' src=' + h.src)
  }
}
if (hardFail.length) { console.error('\n硬性失败：' + hardFail.join('；')); process.exit(1) }
console.log('\n确定性检查：同文不同来源的 ' + results.filter((x) => x.category === 'same-text-diff-source').length + ' 道题全部跨层命中、来源标签没错。')
console.log('说明：no-answer 的「误报」不是 bug——检索层不做相关性阈值，它只按相似度排前 k。')
console.log('     要「没答案就说没答案」，得在消费端加阈值，那是另一件事，不在本评测范围。')
process.exit(0)
