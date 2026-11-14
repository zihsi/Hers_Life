import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { initializeWorkspace, resolveWorkspacePath } from '../lib/workspace-initializer.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-init-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, workspace: path.join(root, 'workspace'), dshHome: path.join(root, '.dsh') }
}

test('creates only the known starter files and required directories', async (t) => {
  const f = await fixture(t)
  const report = await initializeWorkspace({ workspacePath: f.workspace, dshHome: f.dshHome })
  assert.ok(report.created.length >= 10)
  assert.equal(await readFile(path.join(f.workspace, 'live', 'interests.json'), 'utf8').then(JSON.parse).then(x => Array.isArray(x.topics)), true)
  assert.deepEqual(await readFile(path.join(f.workspace, 'live', 'skills-off.json'), 'utf8').then(JSON.parse), { off: [], note: '' })
  assert.equal(await readFile(path.join(f.dshHome, 'memory', 'index.json'), 'utf8').then(JSON.parse).then(x => x.notes.length), 0)
})

test('never overwrites existing user files', async (t) => {
  const f = await fixture(t)
  await mkdir(path.join(f.workspace, 'live'), { recursive: true })
  await writeFile(path.join(f.workspace, 'live', 'interests.json'), '{"topics":[{"name":"keep"}]}\n')
  const report = await initializeWorkspace({ workspacePath: f.workspace, dshHome: f.dshHome })
  assert.ok(report.existing.includes(path.join(f.workspace, 'live', 'interests.json')))
  assert.deepEqual(await readFile(path.join(f.workspace, 'live', 'interests.json'), 'utf8').then(JSON.parse), { topics: [{ name: 'keep' }] })
})

test('uses an existing legacy workspace before falling back to DSH_HOME/workspace', async (t) => {
  const f = await fixture(t)
  const legacy = path.join(f.root, 'old-workspace')
  await mkdir(legacy)
  await mkdir(f.dshHome, { recursive: true })
  await writeFile(path.join(f.dshHome, 'ming-memory.json'), JSON.stringify({ root: legacy }))
  assert.equal(await resolveWorkspacePath({ dshHome: f.dshHome, env: {} }), legacy)
})

test('refuses to initialize a filesystem root', async () => {
  await assert.rejects(initializeWorkspace({ workspacePath: path.parse(os.tmpdir()).root }), /filesystem-root/)
})
