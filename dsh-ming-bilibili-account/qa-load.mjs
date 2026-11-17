// Import the complete plugin in a clean ESM environment; only host packages are stubs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

test('Git package payload contains all ESM modules and declares its DSH runtime peers', async () => {
  const packageDir = dirname(fileURLToPath(import.meta.url))
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  const requiredPeers = ['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-attachment', '@deepseek-ai/dsh-llm']
  for (const name of requiredPeers) {
    assert.equal(typeof manifest.peerDependencies?.[name], 'string', `${name} must be a runtime peer`)
    assert.equal(typeof manifest.devDependencies?.[name], 'string', `${name} must be available for local development`)
  }
  assert.ok(manifest.files.some(entry => entry === 'lib' || entry === 'lib/**'), 'the complete lib directory must be packed')
  const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageDir, encoding: 'utf8', shell: process.platform === 'win32',
  }))[0].files.map(file => file.path)
  for (const file of ['lib/account.mjs', 'lib/provider-holder.mjs', 'lib/tools.js', 'lib/frames.js']) {
    assert.ok(packed.includes(file), `${file} must be present in the Git package payload`)
  }
})

test('complete ESM entry and social tools load without require or real credentials', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ming-bili-load-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(new URL('.', import.meta.url), join(root, 'plugin'), { recursive: true })
  const stubs = {
    'dsh-tools': 'export const defineTool = x => x;',
    'dsh-attachment': 'export const AttachmentId = x => x;',
    'dsh-llm': 'export const createUserMessage = x => x;',
  }
  for (const [name, code] of Object.entries(stubs)) {
    const dir = join(root, 'node_modules', '@deepseek-ai', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
    await writeFile(join(dir, 'index.js'), code)
  }
  const originalFetch = globalThis.fetch
  const originalError = console.error
  const errors = []
  globalThis.fetch = () => { throw new Error('network must not run while loading') }
  console.error = (...args) => errors.push(args.join(' '))
  t.after(() => { globalThis.fetch = originalFetch; console.error = originalError })
  const { apply } = await import(pathToFileURL(join(root, 'plugin/index.js')))
  const definitions = []
  const ctx = { tools: { register: d => {
      assert.ok(d.output && d.output.schema && typeof d.output.render === 'function', `${d.name} must satisfy the DSH output contract`)
      definitions.push(d)
    } }, systemPrompt: { section() {} },
    inject(_deps, fn) { fn(this) }, attachments: {} }
  apply(ctx, { credentialFile: join(root, 'absent-credentials.json') })
  const names = definitions.map(d => d.name)
  for (const name of ['bili_login', 'bili_me', 'bilibili_search', 'bilibili_video', 'bilibili_subtitles', 'bilibili_playurl', 'bilibili_frames'])
    assert.ok(names.includes(name), name + ' should register')
  assert.ok(names.some(n => /comment/.test(n)), 'social tools should register')
  assert.deepEqual(errors, [], 'no swallowed registration errors')
})
