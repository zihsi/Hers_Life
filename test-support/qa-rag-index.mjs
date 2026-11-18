// test-support/qa-rag-index.mjs —— J.6 代际快照与回退的离线验收
//
// 用极小的合成索引（1 条 768 维）跑真实的 scripts/rag-index.mjs：
//   · 完整 → verify 通过；缺文件/条数不符 → 拒绝
//   · snapshot 发布后 current.json 指向新代、文件齐全
//   · 坏索引不许发布（不能只写一半）
//   · keep 只留最近几代，且绝不删当前正在用的那代
//   · rollback 把旧代拷回 live，且先把当前存成 pre-rollback
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(here, '..', 'scripts', 'rag-index.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'ming-rag-index-'))
const LIVE = join(tmp, 'live')
mkdirSync(LIVE, { recursive: true })

const DIM = 768
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args, '--live=' + LIVE], { encoding: 'utf8', timeout: 60000 })

function writeLayer(name, files, rowCount = 1, dim = DIM) {
  const vec = Buffer.alloc(4 * dim * rowCount)
  for (let i = 0; i < dim; i++) vec.writeFloatLE(i === 0 ? 1 : 0, i * 4)
  writeFileSync(join(LIVE, files.emb), vec)
  writeFileSync(join(LIVE, files.ids), JSON.stringify(files.idsValue || (name === 'doc' ? [{ file: 'a.md', text: 'hello' }] : ['id1'])))
  if (files.corpus) writeFileSync(join(LIVE, files.corpus), JSON.stringify({ id: 'id1', text: 'hello', chatKey: 'k', t0: Date.now() }) + '\n')
  writeFileSync(join(LIVE, files.manifest), JSON.stringify({
    schemaVersion: 1, layer: name, generation: 'test-' + name, createdAt: new Date().toISOString(),
    embedding: { model: 'test-model', dimensions: dim }, rowCount, files: {},
  }))
}

const L = {
  doc: { emb: 'doc-emb.f32', ids: 'doc-emb-ids.json', manifest: 'doc-emb.manifest.json' },
  web: { emb: 'chat-emb.f32', ids: 'chat-emb-ids.json', corpus: 'chat-corpus.jsonl', manifest: 'chat-emb.manifest.json' },
}
for (const [n, f] of Object.entries(L)) writeLayer(n, f)

// 1) 完整 → verify 通过
let r = run(['verify'])
ok('完整索引 verify 退出 0', r.status === 0, r.stdout.slice(-200) + r.stderr.slice(-200))
ok('verify 报两层都完整', /两层都完整/.test(r.stdout))

// 2) 坏索引不许发布：维度对不上
{
  const bad = Buffer.alloc(4 * 512 * 1) // 512 维
  writeFileSync(join(LIVE, 'doc-emb.f32'), bad)
  const s = run(['snapshot'])
  ok('维度不符时拒绝发布', s.status !== 0, 'status=' + s.status)
  ok('拒绝时说明是哪层', /doc/.test(s.stderr + s.stdout))
  ok('拒绝时没写 current.json', !existsSync(join(LIVE, 'rag-index', 'current.json')))
  // 修回来
  writeLayer('doc', L.doc)
}

// 3) 发布第一代
r = run(['snapshot'])
ok('发布第一代成功', r.status === 0, r.stderr.slice(-200))
const cur1 = JSON.parse(readFileSync(join(LIVE, 'rag-index', 'current.json'), 'utf8'))
ok('current.json 有 generation', !!cur1.generation)
ok('快照里两层目录都在', ['doc', 'web'].every((n) => existsSync(join(LIVE, 'rag-index', 'generations', cur1.generation, n, 'vectors.f32'))))
ok('快照里带了 manifest', existsSync(join(LIVE, 'rag-index', 'generations', cur1.generation, 'doc', 'manifest.json')))

// 4) 改内容再发一代
writeFileSync(join(LIVE, 'doc-emb-ids.json'), JSON.stringify([{ file: 'b.md', text: 'second' }]))
writeFileSync(join(LIVE, 'doc-emb.manifest.json'), JSON.stringify({
  schemaVersion: 1, layer: 'doc', generation: 'test-doc-2', createdAt: new Date().toISOString(),
  embedding: { model: 'test-model', dimensions: DIM }, rowCount: 1, files: {},
}))
r = run(['snapshot'])
ok('发布第二代成功', r.status === 0)
const cur2 = JSON.parse(readFileSync(join(LIVE, 'rag-index', 'current.json'), 'utf8'))
ok('current 指向新的一代', cur2.generation !== cur1.generation)
const gens = readdirSync(join(LIVE, 'rag-index', 'generations'))
ok('两代都在', gens.length === 2, gens.join(','))

// 5) 回退：把第一代拷回来（这一步要在 prune 之前做——prune 会删旧代，那就没得回了）
const target = gens.find((g) => g !== cur2.generation)
r = run(['rollback', target])
ok('回退退出 0', r.status === 0, r.stderr.slice(-200))
const ids = JSON.parse(readFileSync(join(LIVE, 'doc-emb-ids.json'), 'utf8'))
ok('live 里的内容回到旧代', ids[0].file === 'a.md', JSON.stringify(ids))
ok('回退前先存了 pre-rollback', readdirSync(join(LIVE, 'rag-index', 'generations')).some((g) => g.startsWith('pre-rollback-')))
const curR = JSON.parse(readFileSync(join(LIVE, 'rag-index', 'current.json'), 'utf8'))
ok('current 记着回退到哪一代', curR.generation === target)

// 6) keep：只留最近几代，但当前代永远不删
r = run(['snapshot', '--keep=2'])
const after = readdirSync(join(LIVE, 'rag-index', 'generations'))
const cur3 = JSON.parse(readFileSync(join(LIVE, 'rag-index', 'current.json'), 'utf8'))
ok('keep=2 时不超过 2 代', after.length <= 2, after.join(','))
ok('当前代永远留着', after.includes(cur3.generation))

// 7) dry-run plan：只看不动
{
  // 造一个工作区：两块 md + manifest 记着它们
  const ws = join(tmp, 'ws')
  mkdirSync(join(ws, 'diary'), { recursive: true })
  writeFileSync(join(ws, 'diary', 'a.md'), '# a\n' + 'x'.repeat(800), 'utf8')
  writeFileSync(join(ws, 'diary', 'b.md'), '# b\n' + 'y'.repeat(400), 'utf8')
  const wl = join(ws, 'live')
  mkdirSync(wl, { recursive: true })
  const st = (p) => { const s = statSync(p); return { mtime: Math.round(s.mtimeMs), size: s.size } }
  const a = st(join(ws, 'diary', 'a.md'))
  const b = st(join(ws, 'diary', 'b.md'))
  writeFileSync(join(wl, 'doc-emb-manifest.json'), JSON.stringify({
    files: {
      [join(ws, 'diary', 'a.md')]: { ...a, chunks: 2 },
      [join(ws, 'diary', 'b.md')]: { ...b, chunks: 1 },
    },
  }), 'utf8')
  const runWs = (args) => spawnSync(process.execPath, [SCRIPT, ...args, '--live=' + wl], { encoding: 'utf8', timeout: 30000 })

  let r = runWs(['plan', '--json'])
  let j = null
  try { j = JSON.parse(r.stdout) } catch {}
  ok('plan 能跑且 JSON 可解析', r.status === 0 && !!j, r.stdout.slice(0, 200) + r.stderr.slice(0, 200))
  ok('plan 认全未变', j && j.files.unchanged === 2 && j.files.added === 0 && j.files.changed === 0)
  ok('plan 不动 current（没有 current.json）', !existsSync(join(wl, 'current.json')))

  // 改一个、加一个
  writeFileSync(join(ws, 'diary', 'a.md'), '# a\n' + 'x'.repeat(1600), 'utf8')
  writeFileSync(join(ws, 'diary', 'c.md'), '# c\n' + 'z'.repeat(400), 'utf8')
  r = runWs(['plan', '--json'])
  try { j = JSON.parse(r.stdout) } catch { j = null }
  ok('plan 认出修改 1', j && j.files.changed === 1, JSON.stringify(j && j.files))
  ok('plan 认出新增 1', j && j.files.added === 1)
  ok('plan 估出新增块数', j && j.estimatedChunks.added >= 1)

  // 删一个
  rmSync(join(ws, 'diary', 'b.md'))
  r = runWs(['plan', '--json'])
  try { j = JSON.parse(r.stdout) } catch { j = null }
  ok('plan 认出删除 1', j && j.files.removed === 1)

  // plan 只收 .md：塞个 txt 进去不算新增
  writeFileSync(join(ws, 'diary', 'junk.txt'), 'should not count', 'utf8')
  r = runWs(['plan', '--json'])
  try { j = JSON.parse(r.stdout) } catch { j = null }
  ok('plan 不收 .txt（与 doc-emb 同口径）', j && j.files.added === 1, JSON.stringify(j && j.files))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
