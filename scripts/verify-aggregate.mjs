/**
 * Static contract checks for the Hers Life integration bundle.
 * No dependencies, profile writes, or external commands are required.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFile(path.join(root, p), 'utf8')
const pkg = JSON.parse(await read('package.json'))
const spec = JSON.parse(await read('hers-life.install.json'))
const patch = await read('cordis.patch.yml')
const client = await read('client.js')
const index = await read('index.js')

const expected = [
  'dsh-ming-core-memory', 'dsh-ming-memory', 'dsh-ming-graph',
  'dsh-ming-discord', 'dsh-ming-interest', 'dsh-ming-bilibili-account',
  'dsh-ming-browse', 'dsh-ming-voice', 'dsh-ming-wake',
  'dsh-ming-resume', 'dsh-ming-skill-isolate', 'dsh-ming-mousepet',
]
assert.equal(pkg.name, 'dsh-hers-life')
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
assert.equal(pkg.dsh?.client, undefined, 'client UI must remain unregistered until the privacy phase')
assert.equal(pkg.exports?.['./client'], './client.js')
assert.deepEqual(Object.keys(pkg.dependencies).sort(), [...expected].sort())
const expectedPeers = {
  "@deepseek-ai/cordis": "^4.0.1",
  "@deepseek-ai/dsh-tools": "*",
  "@deepseek-ai/dsh-attachment": "*",
  "@deepseek-ai/dsh-llm": "*",
  "react": "^18.2.0"
}

assert.deepEqual(pkg.peerDependencies, expectedPeers)
assert.deepEqual(pkg.devDependencies, expectedPeers)
assert.equal(spec.install.postInstallAssertion.name, 'dsh-hers-life')
assert.equal(spec.install.postInstallAssertion.version, pkg.version)
for (const name of expected) {
  const target = pkg.dependencies[name]
  assert.ok(target.includes(spec.source.dependencyCommit), `${name} must be pinned to dependencyCommit`)
  assert.ok(target.endsWith(`path:/${name}`), `${name} must target its repository subdirectory`)
}
assert.equal(spec.repository, 'zihsi/Hers_Life')
assert.equal(spec.branch, 'codex/unified-settings-20261114')
assert.equal(spec.baselineCommit, '4880c98e00c634997103c6bc2192a88e7934e05f')
assert.equal(spec.install.agent.action, 'install_bundle')
assert.equal(spec.install.postInstallAssertion.name, pkg.name)
assert.equal(spec.privacyGate.clientEntryRegistered, false)
assert.match(patch, /name:\s*dsh-hers-life/)
assert.match(patch, /disabled:\s*true/)
assert.match(patch, /privacyReady:\s*false/)
assert.match(index, /config\?\.security\?\.privacyReady !== true/)
assert.ok(index.indexOf('config?.security?.privacyReady !== true') < index.indexOf('await import(packageName)'), 'child modules must not evaluate before the privacy gate')
for (const id of ['dsh-ming-memory', 'dsh-ming-graph', 'dsh-ming-mousepet', 'dsh-hers-life']) {
  assert.ok(client.includes(`id: '${id}'`), `missing client module ${id}`)
}
assert.ok(!/DISCORD_BOT_TOKEN\s*[:=]\s*['"][^'"]+['"]/.test(JSON.stringify(pkg) + patch + JSON.stringify(spec)))
console.log('PASS: integration bundle manifest, 12 pinned child packages, privacy gate, and client composition.')
