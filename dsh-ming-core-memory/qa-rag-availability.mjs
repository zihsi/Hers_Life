import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('RAG availability uses synthetic files and never a real service', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ming-rag-'))
  const original = { workspace: process.env.MING_WORKSPACE, home: process.env.DSH_HOME, fetch: globalThis.fetch }
  process.env.MING_WORKSPACE = root
  process.env.DSH_HOME = join(root, 'dsh')
  const live = join(root, 'live')
  await mkdir(live)
  let calls = 0
  const vector = Array(768).fill(0); vector[0] = 1
  const goodFetch = async () => { calls++; return { ok: true, json: async () => ({ data: [{ embedding: vector }] }) } }
  globalThis.fetch = goodFetch
  t.after(async () => {
    globalThis.fetch = original.fetch
    for (const [key, value] of [['MING_WORKSPACE', original.workspace], ['DSH_HOME', original.home]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  })
  let serial = 0
  const load = async () => (await import('./lib/rag.js?fixture=' + serial++)).ragSearch
  const doc = async (ids = [{ file: 'note.md', text: 'A known project fact' }], values = vector) => {
    await writeFile(join(live, 'doc-emb-ids.json'), JSON.stringify(ids))
    await writeFile(join(live, 'doc-emb.f32'), Buffer.from(new Float32Array(values).buffer))
  }
  await t.test('all missing indexes are unavailable and do not call the model', async () => {
    const r = await (await load())('fact')
    assert.equal(r.status, 'unavailable')
    assert.equal(r.issues.length, 2) // doc + web 各回報一次阻斷原因
    assert.equal(calls, 0)
  })
  await t.test('working layer survives missing layers and reports partial coverage', async () => {
    await doc()
    const r = await (await load())('fact')
    assert.equal(r.status, 'partial')
    assert.deepEqual(r.layers, ['doc'])
    assert.equal(r.hits[0].text, 'A known project fact')
    assert.equal(r.issues.length, 2) // web 缺失 + doc 无清单（info）；每层只记录一次状态
  })
  await t.test('loaded empty index is an actual empty search', async () => {
    await doc([], [])
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'ready')
    assert.deepEqual(r.hits, [])
  })
  await t.test('truncated vectors and mismatched IDs are unavailable', async () => {
    await doc(undefined, [1, 0])
    let r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.issues[0].status, 'invalid')
    await doc([], vector)
    r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'unavailable')
  })
  await t.test('missing corpus row is not silently reported as no match', async () => {
    await writeFile(join(live, 'chat-emb.f32'), Buffer.from(new Float32Array(vector).buffer))
    await writeFile(join(live, 'chat-emb-ids.json'), '["missing"]')
    await writeFile(join(live, 'chat-corpus.jsonl'), '')
    const r = await (await load())('fact', { layer: 'web' })
    assert.equal(r.status, 'unavailable')
  })
  await t.test('embedding outage and non-finite output are explicit', async () => {
    await doc()
    globalThis.fetch = async () => { throw new Error('offline') }
    assert.equal((await (await load())('fact', { layer: 'doc' })).service, 'unavailable')
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [{ embedding: Array(768).fill(null) }] }) })
    assert.equal((await (await load())('fact', { layer: 'doc' })).service, 'unavailable')
    globalThis.fetch = goodFetch
  })
  await t.test('tool reports partial and wholly unavailable searches truthfully', async () => {
    const tools = {}
    const { apply } = await import('./lib/index.js')
    apply({ tools: { register(d) { tools[d.name] = d } }, systemPrompt: { section() {} }, inject() {} })
    await tools.memory_core.execute({ action: 'append', section: 'test', text: 'fixture' })
    const partial = await tools.rag_recall.execute({ query: 'fact' })
    assert.match(partial, /部分资料/)
    const missing = await tools.rag_recall.execute({ query: 'fact', layer: 'doc' })
    assert.match(missing, /不可用/)
    assert.doesNotMatch(missing, /没搜到/)
  })
})
