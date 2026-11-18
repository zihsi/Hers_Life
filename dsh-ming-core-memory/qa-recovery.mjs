import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'ming-recovery-'))
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 3 }))
  process.env.DSH_HOME = home
  const base = path.join(home, 'memory')
  await mkdir(path.join(base, 'notes'), { recursive: true })
  const { apply } = await import('./lib/index.js')
  const note = async (id, extra = '') => {
    const text = '---\nid: ' + id + '\ntitle: ' + id + '\ncreated: 2026-11-01\n' + extra + '\n---\nBODY_' + id + '\n'
    await writeFile(path.join(base, 'notes', id + '.md'), text)
    return text
  }
  const boot = async () => {
    const tools = {}
    apply({ on() {}, tools: { register(d) { tools[d.name] = d } }, systemPrompt: { section() {} }, inject() {} })
    // 此写操作排在启动恢复之后，仅修改合成的核心记忆，用来等待串行初始化完成。
    const result = await tools.memory_core.execute({ action: 'append', section: 'test', text: 'barrier' })
    assert.ok(!result.startsWith('错误'), result)
    return tools
  }
  return { base, note, boot, index: async () => JSON.parse(await readFile(path.join(base, 'index.json'), 'utf8')) }
}

test('missing index recovers existing notes without modifying their contents', async t => {
  const h = await fixture(t)
  const original = await h.note('existing')
  const tools = await h.boot()
  assert.equal((await h.index()).notes.length, 1)
  assert.match(await tools.memory_list.execute({}), /existing/)
  assert.equal(await readFile(path.join(h.base, 'notes/existing.md'), 'utf8'), original)
})

test('corrupt index is backed up; merge, supersession and status survive recovery', async t => {
  const h = await fixture(t)
  await h.note('one', 'status: superseded\nsuperseded_by: merged\nsource: direct_observation')
  await h.note('two', 'status: superseded\nsuperseded_by: merged')
  await h.note('merged', 'status: active\nmerged_from: one, two\nsupersedes: prior\nlast_confirmed: 2026-11-15\ntags: a, b')
  await h.note('deleted', 'deleted: true')
  await writeFile(path.join(h.base, 'index.json'), '{broken')
  const tools = await h.boot()
  const notes = (await h.index()).notes
  const merged = notes.find(n => n.id === 'merged')
  assert.deepEqual(merged.merged_from, ['one', 'two'])
  assert.equal(merged.supersedes, 'prior')
  assert.equal(merged.last_confirmed, '2026-11-15')
  assert.deepEqual(merged.tags, ['a', 'b'])
  assert.equal(notes.find(n => n.id === 'one').superseded_by, 'merged')
  assert.equal(notes.find(n => n.id === 'one').status, 'superseded')
  assert.equal(notes.find(n => n.id === 'one').source, 'direct_observation')
  assert.equal(notes.some(n => n.id === 'deleted'), false)
  assert.match(await tools.memory_read.execute({ id: 'merged' }), /合并自 2 条/)
  const backups = (await readdir(h.base)).filter(n => n.includes('.recovery-'))
  assert.equal(backups.length, 1)
  assert.equal(await readFile(path.join(h.base, backups[0]), 'utf8'), '{broken')
  await h.boot()
  assert.equal((await readdir(h.base)).filter(n => n.includes('.recovery-')).length, 1)
})

test('valid empty index left by old bootstrap recovers notes and keeps backup', async t => {
  const h = await fixture(t)
  await h.note('hidden')
  const old = JSON.stringify({ version: 1, notes: [] })
  await writeFile(path.join(h.base, 'index.json'), old)
  await h.boot()
  assert.equal((await h.index()).notes[0].id, 'hidden')
  const backup = (await readdir(h.base)).find(n => n.includes('.recovery-'))
  assert.equal(await readFile(path.join(h.base, backup), 'utf8'), old)
})

test('valid nonempty index is left unchanged', async t => {
  const h = await fixture(t)
  await h.note('existing')
  const old = JSON.stringify({ version: 1, notes: [{ id: 'existing', title: 'existing', custom: 'preserve' }] })
  await writeFile(path.join(h.base, 'index.json'), old)
  await h.boot()
  assert.equal(await readFile(path.join(h.base, 'index.json'), 'utf8'), old)
})

test('fresh install and deleted-only library stay empty', async t => {
  const h = await fixture(t)
  await h.boot()
  assert.deepEqual((await h.index()).notes, [])
  await h.note('deleted', 'deleted: true')
  await h.boot()
  assert.deepEqual((await h.index()).notes, [])
  assert.equal((await readdir(h.base)).some(n => n.includes('.recovery-')), false)
})

test('runtime rebuild also retains merged_from', async t => {
  const h = await fixture(t)
  await h.note('merged', 'merged_from: one, two')
  const tools = await h.boot()
  await writeFile(path.join(h.base, 'index.json'), '{broken-after-start')
  assert.match(await tools.memory_read.execute({ id: 'merged' }), /合并自 2 条/)
})
