// dsh-ming-core-memory/qa-rag-generation.mjs —— 读端认指针（核查 R09）
//
// 要证明的一件事：查询读的是**同一代**的四个文件。
// 以前 rag.js 直接读 live/ 里几个散文件，生成器边写边查就会读到「新向量 + 旧正文」。
// 现在指针指向的那一代是不可变目录，读端从目录里一次取齐。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIM = 768
const root = mkdtempSync(join(tmpdir(), 'ming-rag-gen-'))
const originalDshHome = process.env.DSH_HOME
const dshHome = join(root, 'dsh')
mkdirSync(dshHome, { recursive: true })
writeFileSync(join(dshHome, 'hers-life.json'), JSON.stringify({
  workspace: root,
  coreMemory: { embeddingModel: 'bge-base-zh-v1.5-q8_0' },
}))
process.env.DSH_HOME = dshHome
const live = join(root, 'live')
mkdirSync(live, { recursive: true })

const vec = (hot) => {
  const f = new Float32Array(DIM)
  f[0] = hot
  return Buffer.from(f.buffer)
}
const ids = (text) => JSON.stringify([{ id: 'a1', text, file: 'live-entry.md' }])

// live/：老路径那份（内容是 LIVE-TEXT）
writeFileSync(join(live, 'doc-emb.f32'), vec(1))
writeFileSync(join(live, 'doc-emb-ids.json'), ids('LIVE-TEXT'))

// 指针 + 一代快照（内容是 GEN-TEXT）
const genDir = join(live, 'rag-index', 'generations', 'gen-1', 'doc')
mkdirSync(genDir, { recursive: true })
writeFileSync(join(genDir, 'vectors.f32'), vec(1))
writeFileSync(join(genDir, 'ids.json'), ids('GEN-TEXT'))
writeFileSync(join(genDir, 'manifest.json'), JSON.stringify({
  schemaVersion: 1,
  layer: 'doc',
  generation: 'gen-1',
  embedding: { model: 'bge-base-zh-v1.5-q8_0', dimensions: DIM },
  rowCount: 1,
  files: {},
}))
mkdirSync(join(live, 'rag-index'), { recursive: true })
writeFileSync(join(live, 'rag-index', 'current.json'), JSON.stringify({ generation: 'gen-1', at: '2026-11-17T10:00:00Z' }))

// 嵌入服务：假网络，给一个和两组向量都能算分的查询向量
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ data: [{ embedding: Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0)) }] }),
})

const { ragSearch } = await import(pathToFileURL(join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, 'lib', 'rag.js')).href)

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}

// 1) 指针完整 → 读那一代
{
  const r = await ragSearch('任意', { layer: 'doc', k: 3 })
  const texts = (r.hits || []).map((h) => h.text).join('|')
  ok('R09 有指针时读的是那一代', texts.includes('GEN-TEXT') && !texts.includes('LIVE-TEXT'), texts)
}

// 2) 那一代缺文件 → 退回 live，并说明为什么
{
  rmSync(join(genDir, 'ids.json'))
  const r = await ragSearch('任意', { layer: 'doc', k: 3 })
  const texts = (r.hits || []).map((h) => h.text).join('|')
  ok('R09 代不完整时退回 live', texts.includes('LIVE-TEXT'), texts)
}

// 3) 没有指针（老工作区）→ 照旧读 live
{
  rmSync(join(live, 'rag-index', 'current.json'))
  const r = await ragSearch('任意', { layer: 'doc', k: 3 })
  const texts = (r.hits || []).map((h) => h.text).join('|')
  ok('R09 老工作区零配置照读 live', texts.includes('LIVE-TEXT'), texts)
}

rmSync(root, { recursive: true, force: true })
if (originalDshHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = originalDshHome
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
