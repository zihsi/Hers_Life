#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs, readProfile, repoRoot, resolveProfileDir, CHILDREN, BASELINE_COMMIT, BRANCH } from './lib/installer-core.mjs'

const fail = (message) => { console.error('BLOCKED: ' + message); process.exitCode = 2 }
try {
  const args = parseArgs(process.argv.slice(2), ['plugin-manager-available'])
  const root = repoRoot()
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const spec = JSON.parse(await readFile(new URL('../hers-life.install.json', import.meta.url), 'utf8'))
  const profileDir = await resolveProfileDir(args)
  const { manifest, bundles } = await readProfile(profileDir)
  const errors = []
  const warnings = []
  if (process.versions.node.split('.')[0] < 22) errors.push('Installer runtime Node.js must be >=22.')
  if (pkg.name !== 'dsh-hers-life') errors.push('Root package name does not match dsh-hers-life.')
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
  const report = {
    ready: errors.length === 0 && args['plugin-manager-available'] === true && Boolean(args['host-version']),
    errors,
    warnings,
    runtime: { node: process.versions.node, hostDshVersion: args['host-version'] || null },
    profile: { path: profileDir, name: args['profile-name'] || null, alreadyInstalled },
    bundle: { name: pkg.name, branch: spec.branch, baselineCommit: spec.baselineCommit, children: CHILDREN.length },
    authority: 'The running DSH Plugin Manager remains authoritative for Host compatibility, package-manager invocation, permissions, and installation.'
  }
  console.log(JSON.stringify(report, null, 2))
  if (errors.length) process.exitCode = 2
  else if (!report.ready) process.exitCode = 3
} catch (error) {
  fail(error.message)
}
