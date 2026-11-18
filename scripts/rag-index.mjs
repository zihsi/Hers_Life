#!/usr/bin/env node
// scripts/rag-index.mjs —— 两层索引的代际快照、校验与回退（交接书 J.6 / J.11 的最小实现）
//
// 它**不生成向量**——生成仍由 doc-emb.mjs / chat-embed.mjs 做。
// 这里只管三件事：给一次生成结果拍快照、验它完整、能退回上一代。
//
// 为什么需要：现在索引只有 live/ 里那一份。重建一次写坏了，就没有「上一代」可回。
// J.6 要求「保留至少上一代用于回退」，且「切代不能只写一半」。
//
// 布局（2026-11-17 起读端也认这个指针：指针指的那一代完整、且不比 live 旧，就从那一代读）：
//   live/rag-index/
//     current.json                 → {generation, at, layers:{doc:{...},web:...}}
//     generations/<generation>/
//       doc/{manifest.json,vectors.f32,ids.json}
//       web/{manifest.json,vectors.f32,ids.json,corpus.jsonl}
//       qq/{...}
//
// 用法：
//   node scripts/rag-index.mjs list
//   node scripts/rag-index.mjs verify                 # 验当前这份 live 索引
//   node scripts/rag-index.mjs snapshot [--keep=3]    # 给 live 拍一代快照并切 current
//   node scripts/rag-index.mjs rollback <generation>  # 先把现在这份存成 pre-rollback 代，再拷回

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const argv = process.argv.slice(2)
const flag = (k, d = '') => {
  const a = argv.find((x) => x.startsWith('--' + k + '='))
  if (a) return a.slice(k.length + 3)
  const i = argv.indexOf('--' + k)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return d
}
const cmd = argv.find((x) => !x.startsWith('--')) || 'list'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
let centralSettings = {}
try { centralSettings = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'hers-life.json'), 'utf8')) } catch {}
const workspace = String(centralSettings.workspace || process.env.MING_WORKSPACE || '')
const LIVE = flag('live') || path.join(workspace, 'live')
const ROOT = path.join(LIVE, 'rag-index')
const GEN = path.join(ROOT, 'generations')
const CURRENT = path.join(ROOT, 'current.json')

const LAYERS = [
  { name: 'doc', emb: 'doc-emb.f32', ids: 'doc-emb-ids.json', corpus: null, manifest: 'doc-emb.manifest.json' },
  { name: 'web', emb: 'chat-emb.f32', ids: 'chat-emb-ids.json', corpus: 'chat-corpus.jsonl', manifest: 'chat-emb.manifest.json' },
]

const DIM = 768

function statSafe(p) {
  try { return fs.statSync(p) } catch { return null }
}

/** 验一层：文件在、条数与字节数对得上、维度推得出来。返回 {ok, issues, rowCount, dimensions}。 */
function verifyLayer(layer) {
  const issues = []
  const emb = path.join(LIVE, layer.emb)
  const ids = path.join(LIVE, layer.ids)
  const corpus = layer.corpus ? path.join(LIVE, layer.corpus) : null
  const se = statSafe(emb)
  const si = statSafe(ids)
  if (!se) issues.push('缺向量文件 ' + layer.emb)
  if (!si) issues.push('缺 ids 文件 ' + layer.ids)
  if (corpus && !statSafe(corpus)) issues.push('缺语料文件 ' + layer.corpus)
  if (issues.length) return { ok: false, issues, rowCount: 0, dimensions: 0 }

  let idsArr
  try { idsArr = JSON.parse(fs.readFileSync(ids, 'utf8')) } catch { issues.push('ids 不是合法 JSON'); return { ok: false, issues, rowCount: 0, dimensions: 0 } }
  if (!Array.isArray(idsArr) || !idsArr.length) issues.push('ids 是空数组')
  const n = idsArr.length
  const dim = se.size / 4 / n
  if (!Number.isInteger(dim) || dim <= 0) issues.push('维度推不出来：' + se.size + ' / 4 / ' + n)
  else if (dim !== DIM) issues.push('维度 ' + dim + ' 与读取端 ' + DIM + ' 不符')

  // manifest 对得上就更硬
  const mf = path.join(LIVE, layer.manifest)
  const sm = statSafe(mf)
  if (!sm) issues.push('没有 manifest（旧格式可读，但没法定代）')
  else {
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'))
      if (Number(m.rowCount) !== n) issues.push('manifest rowCount=' + m.rowCount + '，实际 ' + n)
      if (m.embedding && Number(m.embedding.dimensions) !== dim) issues.push('manifest 维度=' + m.embedding.dimensions + '，实际 ' + dim)
    } catch { issues.push('manifest 不是合法 JSON') }
  }
  return { ok: issues.length === 0, issues, rowCount: n, dimensions: dim }
}

function verifyAll() {
  const out = {}
  for (const l of LAYERS) out[l.name] = verifyLayer(l)
  return out
}

function copyLayer(layer, dest) {
  const dir = path.join(dest, layer.name)
  fs.mkdirSync(dir, { recursive: true })
  const pairs = [[layer.emb, 'vectors.f32'], [layer.ids, 'ids.json'], [layer.manifest, 'manifest.json']]
  if (layer.corpus) pairs.push([layer.corpus, 'corpus.jsonl'])
  for (const [src, name] of pairs) {
    const from = path.join(LIVE, src)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, name))
  }
}

function restoreLayer(layer, from) {
  const dir = path.join(from, layer.name)
  if (!fs.existsSync(dir)) return false
  const pairs = [[path.join(dir, 'vectors.f32'), layer.emb], [path.join(dir, 'ids.json'), layer.ids], [path.join(dir, 'manifest.json'), layer.manifest]]
  if (layer.corpus) pairs.push([path.join(dir, 'corpus.jsonl'), layer.corpus])
  for (const [src, dst] of pairs) {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(LIVE, dst))
  }
  return true
}

function readCurrent() {
  try { return JSON.parse(fs.readFileSync(CURRENT, 'utf8')) } catch { return null }
}

function genName() {
  // 精确到秒不够：同一秒里连发两次会撞名（实测过），撞名就覆盖上一代 = 白丢一次。
  const base = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  let name = base
  let i = 2
  while (fs.existsSync(path.join(GEN, name))) name = base + '-' + i++
  return name
}

function listGens() {
  try {
    return fs.readdirSync(GEN).filter((d) => fs.statSync(path.join(GEN, d)).isDirectory()).sort()
  } catch { return [] }
}

function pruneGens(keep) {
  const gens = listGens()
  if (gens.length <= keep) return []
  const cur = readCurrent()
  // 正在用的那一代永远不删
  const drop = gens.slice(0, gens.length - keep).filter((g) => !cur || g !== cur.generation)
  for (const g of drop) fs.rmSync(path.join(GEN, g), { recursive: true, force: true })
  return drop
}

const report = {}

const argFlag = (k) => argv.includes('--' + k)

if (cmd === 'plan') {
  // 2026-11-17（J.3 dry-run）：只看不动——显示「将新增/修改/删除多少源和块」。
  // 不调模型、不写任何文件、不动 current。块数按 400 字/块粗估，标「约」。
  const WS = path.dirname(LIVE)
  const mf = path.join(LIVE, 'doc-emb-manifest.json')
  let old = {}
  try { old = JSON.parse(fs.readFileSync(mf, 'utf8')).files || {} } catch { old = {} }
  // manifest 里存的可能是绝对路径（doc-emb 早期版本），先相对化到工作区再取顶层目录。
  const toRel = (p) => {
    const abs = path.isAbsolute(p) ? p : path.join(WS, p)
    return path.relative(WS, abs).split(path.sep).join('/')
  }
  const dirs = new Set()
  const normOld = new Map()
  for (const [rel0, v] of Object.entries(old)) {
    const rel = toRel(rel0)
    normOld.set(rel, v)
    const top = rel.split('/')[0]
    if (top && !top.startsWith('..')) dirs.add(top)
  }
  old = Object.fromEntries(normOld)
  if (!dirs.size) {
    console.log('没有现成 manifest，推不出源目录。先跑一次 doc-emb build，或手动传 --dirs=a,b。')
    const manual = flag('dirs', '')
    if (!manual) process.exit(2)
    for (const d of manual.split(',')) if (d.trim()) dirs.add(d.trim())
  }
  const CHUNK = 400
  const seen = new Map()
  const walk = (rel) => {
    const abs = path.join(WS, rel)
    let st
    try { st = fs.statSync(abs) } catch { return }
    if (st.isDirectory()) {
      // 与 doc-emb 的 listMd 保持同一口径：这几个目录不进 doc 层（它们由别的层覆盖）。
      const SKIP = new Set(['verbatim', 'backup', 'qqagent-chat', 'group-digest', 'qq-sources'])
      let entries = []
      try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        if (e.isDirectory() && SKIP.has(e.name)) continue
        walk(rel + '/' + e.name)
      }
      return
    }
    // doc 层只收 .md——doc-emb 就是这样，收别的会报出一堆假「新增」。
    if (!/\.md$/i.test(rel)) return
    let chars = 0
    try { chars = fs.readFileSync(abs, 'utf8').length } catch { return }
    seen.set(rel.split(path.sep).join('/'), { mtime: Math.round(st.mtimeMs), size: st.size, chunks: Math.max(1, Math.ceil(chars / CHUNK)) })
  }
  for (const d of dirs) walk(d)

  const added = []
  const changed = []
  const same = []
  for (const [rel, cur] of seen) {
    const prev = old[rel]
    if (!prev) { added.push({ rel, ...cur }); continue }
    // manifest 里的 mtime 可能存的是毫秒或 ISO；两种都比一下
    const pm = typeof prev.mtime === 'number' ? prev.mtime : Date.parse(prev.mtime || '') || 0
    if (Math.abs((pm || 0) - cur.mtime) > 1000 || Number(prev.size) !== cur.size) changed.push({ rel, ...cur })
    else same.push(rel)
  }
  const removed = Object.keys(old).filter((rel) => !seen.has(String(rel).split(path.sep).join('/')))
  const sum = (arr) => arr.reduce((n, x) => n + (x.chunks || 0), 0)
  const out = {
    at: new Date().toISOString(),
    layer: 'doc',
    sourceDirs: [...dirs],
    files: { total: seen.size, added: added.length, changed: changed.length, removed: removed.length, unchanged: same.length },
    estimatedChunks: { added: sum(added), changed: sum(changed), removed: removed.length, reused: same.length },
    samples: { added: added.slice(0, 5).map((x) => x.rel), changed: changed.slice(0, 5).map((x) => x.rel), removed: removed.slice(0, 5) },
    note: '只估 doc 层；web 层的源是聊天记录，要读数据库，本命令不估。块数按 400 字/块粗估。',
  }
  if (argFlag('json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0) }
  console.log('doc 层 · 源目录 ' + out.sourceDirs.join(', '))
  console.log('  文件：共 ' + out.files.total + '｜新增 ' + out.files.added + '｜修改 ' + out.files.changed
    + '｜删除 ' + out.files.removed + '｜未变（复用向量） ' + out.files.unchanged)
  console.log('  块（约）：新增 ' + out.estimatedChunks.added + '｜重算 ' + out.estimatedChunks.changed
    + '｜删除源 ' + out.estimatedChunks.removed + ' 个')
  if (out.samples.added.length) console.log('  新增样例：' + out.samples.added.join(', '))
  if (out.samples.changed.length) console.log('  修改样例：' + out.samples.changed.join(', '))
  if (out.samples.removed.length) console.log('  删除样例：' + out.samples.removed.join(', '))
  console.log('\n' + out.note)
  console.log('这一步没调模型、没写文件、没动 current。')
  process.exit(0)
}

if (cmd === 'list') {
  const cur = readCurrent()
  const gens = listGens()
  console.log('索引目录：' + ROOT)
  console.log('当前代：' + (cur ? cur.generation + '（' + cur.at + '）' : '（没有 current.json）'))
  console.log('saved 代：' + (gens.length ? gens.join(', ') : '（空）'))
  for (const g of gens.slice(-3)) {
    const st = statSafe(path.join(GEN, g))
    console.log('  ' + g + '  ' + (st ? st.mtime.toISOString() : ''))
  }
  process.exit(0)
}

if (cmd === 'verify') {
  const r = verifyAll()
  let bad = 0
  for (const [name, v] of Object.entries(r)) {
    console.log((v.ok ? 'OK   ' : 'BAD  ') + name.padEnd(4) + ' 条数 ' + v.rowCount + ' 维度 ' + v.dimensions)
    for (const i of v.issues) console.log('       - ' + i)
    if (!v.ok) bad++
  }
  console.log('\n' + (bad ? bad + ' 层有问题' : '两层都完整'))
  process.exit(bad ? 1 : 0)
}

if (cmd === 'snapshot') {
  const keep = Number(flag('keep', '3')) || 3
  const r = verifyAll()
  const bad = Object.entries(r).filter(([, v]) => !v.ok)
  // 只警告「没有 manifest」这种可容忍项；维度/条数对不上就不许发布（J.6：不能只写一半）
  const fatal = bad.filter(([, v]) => v.issues.some((i) => !/没有 manifest/.test(i)))
  if (fatal.length) {
    console.error('拒绝发布：' + fatal.map(([n]) => n).join(',') + ' 有问题')
    for (const [n, v] of fatal) console.error('  ' + n + ': ' + v.issues.filter((i) => !/没有 manifest/.test(i)).join('；'))
    process.exit(1)
  }
  fs.mkdirSync(GEN, { recursive: true })
  const gen = genName()
  const dest = path.join(GEN, gen)
  for (const l of LAYERS) copyLayer(l, dest)
  const cur = {
    generation: gen,
    at: new Date().toISOString(),
    layers: Object.fromEntries(Object.entries(r).map(([n, v]) => [n, { rowCount: v.rowCount, dimensions: v.dimensions }])),
    note: 'snapshot of live/; reader (dsh-ming-core-memory/lib/rag.js) reads this generation when it is complete and not older than live/ 的清单',
  }
  const tmp = CURRENT + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2), 'utf8')
  fs.renameSync(tmp, CURRENT) // 原子切指针：先写临时再改名
  console.log('已发布代：' + gen + '（' + LAYERS.map((l) => l.name + '=' + (r[l.name].rowCount || 0)).join(' ') + '）')
  const dropped = pruneGens(keep)
  if (dropped.length) console.log('清掉旧代：' + dropped.join(', '))
  process.exit(0)
}

if (cmd === 'rollback') {
  const want = flag('to') || argv[argv.indexOf('rollback') + 1] || ''
  const gens = listGens()
  if (!want || !gens.includes(want)) {
    console.error('要给一个存在的代：' + (gens.join(', ') || '（没有）'))
    process.exit(2)
  }
  // 先把现在这份存成 pre-rollback，别把当前丢掉
  const pre = 'pre-rollback-' + genName()
  const dest = path.join(GEN, pre)
  fs.mkdirSync(dest, { recursive: true })
  for (const l of LAYERS) copyLayer(l, dest)
  console.log('当前这份已存成：' + pre)
  for (const l of LAYERS) restoreLayer(l, path.join(GEN, want))
  const cur = readCurrent()
  const next = { ...(cur || {}), generation: want, at: new Date().toISOString(), rolledBackFrom: pre }
  fs.writeFileSync(CURRENT + '.tmp', JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(CURRENT + '.tmp', CURRENT)
  console.log('已回退到：' + want + '（读端按 current.json 取那一代；让它重载才生效）')
  process.exit(0)
}

console.error('用法：list | verify | snapshot [--keep=3] | rollback <generation>')
process.exit(2)
