#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs, readProfile, resolveProfileDir, CHILDREN, BASELINE_COMMIT, BRANCH } from './lib/installer-core.mjs'

const fail = (message) => { console.error('BLOCKED: ' + message); process.exitCode = 2 }
try {
  const args = parseArgs(process.argv.slice(2), ['plugin-manager-available'])
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const spec = JSON.parse(await readFile(new URL('../hers-life.install.json', import.meta.url), 'utf8'))
  const profileDir = await resolveProfileDir(args)
  const { manifest, bundles } = await readProfile(profileDir)
  const errors = []
  const warnings = []
  if (process.versions.node.split('.')[0] < 22) errors.push('Installer runtime Node.js must be >=22.')
  if (pkg.name !== 'dsh-hers-life') errors.push('Root package name does not match dsh-hers-life.')
  if (pkg.version !== spec.install.postInstallAssertion?.version || pkg.version !== '0.1.0') errors.push('Root package version differs from the install spec.')
  const expectedPeers = {
    '@deepseek-ai/cordis': '^4.0.1',
    '@deepseek-ai/dsh-tools': '*',
    '@deepseek-ai/dsh-attachment': '*',
    '@deepseek-ai/dsh-llm': '*',
    react: '^18.2.0',
  }
  if (JSON.stringify(pkg.peerDependencies) !== JSON.stringify(expectedPeers) ||
      JSON.stringify(pkg.devDependencies) !== JSON.stringify(expectedPeers)) {
    errors.push('DSH runtime peer declarations do not match the reviewed compatibility contract.')
  }
  if (spec.branch !== BRANCH || spec.baselineCommit !== BASELINE_COMMIT) errors.push('Install spec branch or research baseline changed unexpectedly.')
  for (const name of CHILDREN) {
    const target = pkg.dependencies?.[name]
    if (typeof target !== 'string' || !target.includes(spec.source.dependencyCommit) || !target.endsWith('path:/' + name)) {
      errors.push('Pinned child dependency is invalid: ' + name)
    }
  }
  if (!args['plugin-manager-available']) warnings.push('DSH Plugin Manager availability has not been confirmed by the running Host.')
  if (!args['host-version']) warnings.push('Running DSH version was not supplied; do not assume compatibility.')
  const alreadyInstalled = Object.hasOwn(manifest.dependencies, 'dsh-hers-life') || bundles.includes('dsh-hers-life')
  if (alreadyInstalled) warnings.push('dsh-hers-life is already present in this Profile; do not install it again. Run the health check or plan a separate upgrade.')
  const report = {
    readyForPluginManagerAttempt: errors.length === 0 && !alreadyInstalled && args['plugin-manager-available'] === true && Boolean(args['host-version']),
    hostCompatibilityConfirmed: false,
    errors,
    warnings,
    runtime: { node: process.versions.node, hostDshVersion: args['host-version'] || null },
    profile: { path: profileDir, name: args['profile-name'] || null, alreadyInstalled },
    bundle: { name: pkg.name, branch: spec.branch, baselineCommit: spec.baselineCommit, children: CHILDREN.length },
    authority: 'The running DSH Plugin Manager remains authoritative for Host compatibility, package-manager invocation, permissions, and installation.'
  }
  console.log(JSON.stringify(report, null, 2))
  if (errors.length) process.exitCode = 2
  else if (!report.readyForPluginManagerAttempt) process.exitCode = 3
} catch (error) {
  fail(error.message)
}
