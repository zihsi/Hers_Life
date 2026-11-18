import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 2026-11-17（J-2）：索引清单。全部用合成索引，不碰真实索引目录、不连嵌入服务。
test('RAG manifest: 旧格式照读、清单不符就报、不混向量空间', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ming-rag-manifest-'))
  const original = { home: process.env.DSH_HOME, fetch: globalThis.fetch }
  process.env.DSH_HOME = join(root, 'dsh')
  await mkdir(process.env.DSH_HOME, { recursive: true })
  await writeFile(join(process.env.DSH_HOME, 'hers-life.json'), JSON.stringify({ workspace: root }), 'utf8')
  const live = join(root, 'live')
  await mkdir(live)

  const vector = Array(768).fill(0); vector[0] = 1
  let calls = 0
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ data: [{ embedding: vector }] }) } }

  t.after(async () => {
    globalThis.fetch = original.fetch
    if (original.home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = original.home
    await rm(root, { recursive: true, force: true })
  })

  let serial = 0
  // 每次换一个 import 串，绕开模块级 cache（cache 的键是文件签名，但 manifest 也在签名里，
  // 为避免测试之间互相污染，仍然重新加载模块）。
  const load = async () => (await import('./lib/rag.js?manifest=' + serial++)).ragSearch

  const writeDoc = async (ids = [{ file: 'note.md', text: 'A known project fact' }]) => {
    await writeFile(join(live, 'doc-emb-ids.json'), JSON.stringify(ids))
    await writeFile(join(live, 'doc-emb.f32'), Buffer.from(new Float32Array(vector).buffer))
  }
  const writeManifest = async (patch = {}) => {
    const m = {
      schemaVersion: 1,
      layer: 'doc',
      generation: 'synthetic-001',
      createdAt: '2026-11-17T00:00:00Z',
      embedding: { model: 'bge-base-zh-v1.5-q8_0', revision: 'unknown', dimensions: 768, dtype: 'float32' },
      chunker: { version: '1', maxChars: 800, overlapChars: 100 },
      rowCount: 1,
      ...patch,
    }
    await writeFile(join(live, 'doc-emb.manifest.json'), JSON.stringify(m))
    return m
  }
  const clearManifest = async () => rm(join(live, 'doc-emb.manifest.json'), { force: true })

  await writeDoc()

  await t.test('没有清单：照旧能查，只记一条 info，不把状态打成 partial', async () => {
    await clearManifest()
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'ready')
    assert.equal(r.hits[0].text, 'A known project fact')
    assert.ok(r.issues.some(i => i.code === 'manifest-missing' && i.severity === 'info'))
  })

  await t.test('清单齐且对得上：ready，没有任何 issue', async () => {
    await writeManifest()
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'ready')
    assert.deepEqual(r.issues, [])
    assert.equal(r.hits.length, 1)
  })

  await t.test('维度不符：该层不参与检索，报 dim-mismatch', async () => {
    await writeManifest({ embedding: { model: 'bge-base-zh-v1.5-q8_0', dimensions: 512 } })
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'unavailable')
    assert.deepEqual(r.layers, [])
    assert.ok(r.issues.some(i => i.code === 'manifest-dim-mismatch' && i.severity === 'error'))
  })

  await t.test('模型不同（维度相同）：拒，不混向量空间', async () => {
    await writeManifest({ embedding: { model: 'some-other-model', dimensions: 768 } })
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'unavailable')
    assert.ok(r.issues.some(i => i.code === 'manifest-model-mismatch'))
  })

  await t.test('条数不符：拒', async () => {
    await writeManifest({ rowCount: 7 })
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'unavailable')
    assert.ok(r.issues.some(i => i.code === 'manifest-rowcount-mismatch'))
  })

  await t.test('清单 layer 写错：当损坏，不当别层索引', async () => {
    await writeManifest({ layer: 'web' })
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'unavailable')
    assert.ok(r.issues.some(i => i.layer === 'doc' && i.status === 'invalid'))
  })

  await t.test('清单版本不认识：拒，不猜字段', async () => {
    await writeManifest({ schemaVersion: 2 })
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'unavailable')
    assert.ok(r.issues.some(i => i.status === 'invalid'))
  })

  await t.test('files 里出现目录穿越：拒', async () => {
    await writeManifest({ files: { vectors: { name: '../../secret.f32' } } })
    const r = await (await load())('fact', { layer: 'doc' })
    assert.equal(r.status, 'unavailable')
    assert.ok(r.issues.some(i => i.code === 'manifest-path-unsafe'))
  })

  await t.test('清单坏了但别的层能查：状态 partial，好的层照常出结果', async () => {
    await writeManifest({ rowCount: 7 }) // doc 坏
    // 再造一个能用的 web 层（无清单 = 旧格式照读）
    await writeFile(join(live, 'chat-emb-ids.json'), JSON.stringify(['q1']))
    await writeFile(join(live, 'chat-emb.f32'), Buffer.from(new Float32Array(vector).buffer))
    await writeFile(join(live, 'chat-corpus.jsonl'), JSON.stringify({ id: 'q1', text: 'a web hit', chatKey: 'k', t0: Date.now() }) + '\n')
    const r = await (await load())('fact')
    assert.equal(r.status, 'partial')
    assert.deepEqual(r.layers, ['web'])
    assert.equal(r.hits[0].text, 'a web hit')
    assert.equal(r.hits[0].src, 'web')
  })

  await t.test('全程没有因为清单问题多调一次模型', async () => {
    // 前面每一次查询都会调一次嵌入（成功的话）；这里只确认没有异常放大：<= 之前累计的查询数
    assert.ok(calls <= 9, 'calls=' + calls)
  })
})
