import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('explicit diary budget controls real prompt without shortening persona', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ming-budget-'))
  const before = process.env.DSH_HOME
  const dshHome = join(root, '.dsh')
  process.env.DSH_HOME = dshHome
  await mkdir(dshHome, { recursive: true })
  await writeFile(join(dshHome, 'ming-memory.json'), JSON.stringify({ diaryChars: 2000 }))
  t.after(async () => {
    if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, 'diary'))
  await mkdir(join(root, 'persona'))
  await mkdir(join(root, 'noqq'))
  const persona = 'P'.repeat(14000) + 'PERSONA_END'
  await writeFile(join(root, 'persona/test.md'), persona)
  await writeFile(join(root, 'diary/2026-11-17.md'), 'D'.repeat(12000) + 'DIARY_END')
  const { mount, agentFor } = await import('./qa-lib.mjs')
  let n = 0
  const prompt = async patch => {
    const m = mount({ root, personaFiles: ['persona/test.md'], diaryCount: 1, maxChars: 100000,
      qq: { dir: join(root, 'noqq') }, identity: false, ...patch })
    const a = agentFor('budget-' + n++, root)
    await m.created(a.agent)
    return a.prompt()
  }
  await t.test('local config works and high maxChars cannot bypass the explicit cap', async () => {
    const text = await prompt({})
    assert.ok(text.includes(persona))
    assert.ok((text.match(/D/g) || []).length < 2000)
    assert.match(text, /因预算被截断/)
  })
  await t.test('explicit plugin setting overrides local setting and zero omits diaries', async () => {
    const larger = await prompt({ diaryChars: 15000 })
    assert.match(larger, /DIARY_END/)
    const zero = await prompt({ diaryChars: 0 })
    assert.ok(zero.includes(persona))
    assert.ok(!zero.includes('DDDD'))
    assert.match(zero, /因长度预算省去/)
  })
  await t.test('absent or invalid explicit value retains legacy default behavior', async () => {
    for (const value of [undefined, -1, '100', 1.5]) {
      const text = await prompt({ diaryChars: value })
      assert.match(text, /DIARY_END/)
      assert.ok(text.includes(persona))
    }
  })
})
