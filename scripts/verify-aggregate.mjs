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
const settingsPkg = JSON.parse(await read('dsh-hers-life-settings/package.json'))
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
const supportPackages = ['dsh-hers-life-settings']
assert.deepEqual(Object.keys(pkg.dependencies).sort(), [...expected, ...supportPackages].sort())
assert.deepEqual(spec.children, expected)
assert.deepEqual(spec.supportPackages, supportPackages)
assert.equal(pkg.dependencies['dsh-hers-life-settings'], `git+https://github.com/zihsi/Hers_Life.git#${spec.source.settingsDependencyCommit}&path:/dsh-hers-life-settings`)
assert.equal(settingsPkg.name, 'dsh-hers-life-settings')
assert.equal(settingsPkg.dsh?.client?.platform, 'web')
assert.equal(settingsPkg.dsh?.client?.immediately, true)
const expectedPeers = {
  "@deepseek-ai/cordis": "^4.0.1",
  "@deepseek-ai/dsh-tools": "*",
  "@deepseek-ai/dsh-attachment": "*",
  "@deepseek-ai/dsh-llm": "*",
  "@deepseek-ai/schemastery": "^3.19.0",
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
assert.doesNotMatch(patch, /disabled:\s*true/)
assert.match(patch, /name:\s*dsh-hers-life-settings/)
assert.match(patch, /privacyReady:\s*false/)
assert.match(index, /security\.privacyReady !== true/)
assert.match(index, /initializeWorkspace/)
assert.match(index, /export const Config = z\.object/)
assert.ok(index.indexOf('if (security.privacyReady !== true)') < index.indexOf('await import(packageName)'), 'child modules must not evaluate before the privacy gate')
const settingsClient = await read('dsh-hers-life-settings/client.js')
const discord = await read('dsh-ming-discord/index.js')
assert.match(settingsClient, /ctx\.configForms\.get\('hers-life'\)/)
assert.match(settingsClient, /ctx\.remote\.credentials\.set/)
assert.match(settingsClient, /autoComplete: 'new-password'/)
assert.match(discord, /ctx\.credentials\.resolve/)
assert.match(discord, /!cfg\.allowedGuildIds\.length/)
for (const id of ['dsh-ming-memory', 'dsh-ming-graph', 'dsh-ming-mousepet', 'dsh-hers-life']) {
  assert.ok(client.includes(`id: '${id}'`), `missing client module ${id}`)
}
assert.ok(!/DISCORD_BOT_TOKEN\s*[:=]\s*['"][^'"]+['"]/.test(JSON.stringify(pkg) + patch + JSON.stringify(spec)))
console.log('PASS: integration manifest, 12 functional children, settings companion, credential boundary, and privacy gate.')
