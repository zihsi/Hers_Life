import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  parseArgs, validateProfileName, isWithin, createBackup, verifyBackup, resolveProfileDir,
  readProfile, buildDshRemoveArgs, checkHealth, assertFreshInstallBackup, CHILDREN, BUNDLE_NAME,
} from './lib/installer-core.mjs'

async function fixture(t) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hers-life-installer-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const profile = path.join(temp, 'profiles', 'test-profile')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-test-profile', private: true,
    dependencies: { [BUNDLE_NAME]: 'git+https://example.invalid/Hers_Life.git' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', BUNDLE_NAME] } },
  }, null, 2))
  await writeFile(path.join(profile, 'cordis.patch.yml'), '# user overrides\n')
  await writeFile(path.join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  await writeFile(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  return { temp, profile }
}

test('profile resolution requires explicit path or DSH_HOME and profile name', async (t) => {
  const { temp, profile } = await fixture(t)
  assert.equal(await resolveProfileDir({ 'dsh-home': temp, 'profile-name': 'test-profile' }, {}), profile)
  await assert.rejects(resolveProfileDir({}, {}), /No default path is guessed/)
  await assert.rejects(resolveProfileDir({ 'profile-dir': 'relative/path' }, {}), /absolute path/)
})

test('argument parser rejects positional and duplicate options', () => {
  assert.throws(() => parseArgs(['oops']), /positional/)
  assert.throws(() => parseArgs(['--profile-name', 'a', '--profile-name', 'b']), /Duplicate/)
  assert.deepEqual(parseArgs(['--confirm'], ['confirm']), { confirm: true })
})

test('profile names are constrained before being passed to the shell', () => {
  assert.equal(validateProfileName('desktop_1'), 'desktop_1')
  assert.throws(() => validateProfileName('test & del *'), /invalid/)
  assert.deepEqual(buildDshRemoveArgs('desktop'), ['plugin', '--profile', 'desktop', 'remove', BUNDLE_NAME])
  assert.throws(() => buildDshRemoveArgs('desktop & calc'), /invalid/)
})

test('path containment detects nested paths', () => {
  assert.equal(isWithin('/a/profile', '/a/profile/backup'), true)
  assert.equal(isWithin('/a/profile', '/a/backup'), false)
})

test('backup copies only profile metadata and records integrity hashes', async (t) => {
  const { temp, profile } = await fixture(t)
  await mkdir(path.join(profile, 'diary'))
  await writeFile(path.join(profile, 'diary', 'private.md'), 'must not be copied')
  await mkdir(path.join(profile, 'node_modules'))
  const backupDir = path.join(temp, 'backups', 'first')
  const manifest = await createBackup(profile, backupDir)
  assert.deepEqual(manifest.files.map(file => file.name).sort(), [
    'cordis.patch.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  ])
  assert.equal(manifest.excluded.includes('diary'), true)
  assert.equal((await verifyBackup(backupDir, profile)).kind, 'hers-life-profile-metadata-backup')
  await assert.rejects(readFile(path.join(backupDir, 'diary', 'private.md')))
})

test('backup refuses overwrite and any path overlapping the profile', async (t) => {
  const { temp, profile } = await fixture(t)
  await assert.rejects(createBackup(profile, path.join(profile, 'backup')), /outside/)
  const backupDir = path.join(temp, 'backup')
  await createBackup(profile, backupDir)
  await assert.rejects(createBackup(profile, backupDir), /already exists/)
})

test('backup records whether the bundle existed before backup and rollback refuses old installs', async (t) => {
  const { temp, profile } = await fixture(t)
  const backupWithExistingBundle = await createBackup(profile, path.join(temp, 'existing-backup'))
  assert.throws(() => assertFreshInstallBackup(backupWithExistingBundle), /first-time install/)
  const profileManifest = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'))
  delete profileManifest.dependencies[BUNDLE_NAME]
  profileManifest.dsh.profile.bundles = profileManifest.dsh.profile.bundles.filter(name => name !== BUNDLE_NAME)
  await writeFile(path.join(profile, 'package.json'), JSON.stringify(profileManifest))
  const cleanBackup = await createBackup(profile, path.join(temp, 'clean-backup'))
  assert.deepEqual(cleanBackup.bundleState, { dependencyPresent: false, selected: false })
  assert.doesNotThrow(() => assertFreshInstallBackup(cleanBackup))
})

test('backup verification rejects a backup directory inside the profile', async (t) => {
  const { profile } = await fixture(t)
  const inside = path.join(profile, 'nested-backup')
  await mkdir(inside)
  await assert.rejects(verifyBackup(inside, profile), /outside the profile/)
})

test('backup integrity verification catches changed files and wrong profiles', async (t) => {
  const { temp, profile } = await fixture(t)
  const backupDir = path.join(temp, 'backup')
  await createBackup(profile, backupDir)
  await writeFile(path.join(backupDir, 'package.json'), '{}')
  await assert.rejects(verifyBackup(backupDir, profile), /integrity/)
  const other = path.join(temp, 'other')
  await mkdir(other)
  await writeFile(path.join(other, 'package.json'), '{}')
  await assert.rejects(verifyBackup(backupDir, other), /different profile/)
})

test('health check verifies installed dependency and selected bundle without booting DSH', async (t) => {
  const { temp, profile } = await fixture(t)
  const root = path.join(temp, 'repo')
  await mkdir(root, { recursive: true })
  await mkdir(path.join(profile, 'node_modules', BUNDLE_NAME), { recursive: true })
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: BUNDLE_NAME, dependencies: Object.fromEntries(CHILDREN.map(name => [name, 'git+https://example.invalid/path'])),
  }))
  await writeFile(path.join(root, 'hers-life.install.json'), JSON.stringify({
    baselineCommit: '4880c98e00c634997103c6bc2192a88e7934e05f',
  }))
  await writeFile(path.join(profile, 'node_modules', BUNDLE_NAME, 'cordis.patch.yml'), '- insert:\n    - id: hers-life\n      disabled: true\n      config:\n        security:\n          privacyReady: false\n')
  await writeFile(path.join(profile, 'node_modules', BUNDLE_NAME, 'index.js'), "if (config?.security?.privacyReady !== true) return\n")
  await writeFile(path.join(profile, 'node_modules', BUNDLE_NAME, 'package.json'), JSON.stringify({ name: BUNDLE_NAME, dependencies: Object.fromEntries(CHILDREN.map(name => [name, 'git+https://example.invalid/path'])) }))
  const report = await checkHealth(profile, root)
  assert.equal(report.ok, true)
  assert.equal(report.effectiveRuntimeConfigVerified, false)
  assert.equal(report.checks.privacyGateTemplateDisabled, true)
})

test('health check reports missing package without changing the profile', async (t) => {
  const { temp, profile } = await fixture(t)
  const root = path.join(temp, 'repo')
  await mkdir(root)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: BUNDLE_NAME, dependencies: {} }))
  await writeFile(path.join(root, 'hers-life.install.json'), JSON.stringify({ baselineCommit: '4880c98e00c634997103c6bc2192a88e7934e05f' }))
  await writeFile(path.join(root, 'cordis.patch.yml'), '')
  const report = await checkHealth(profile, root)
  assert.equal(report.ok, false)
  assert.equal(report.checks.packageFilesPresent, false)
})

test('profile parser rejects a non-profile package manifest', async (t) => {
  const { profile } = await fixture(t)
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'not-a-profile' }))
  await assert.rejects(readProfile(profile), /dsh.profile.bundles/)
})
