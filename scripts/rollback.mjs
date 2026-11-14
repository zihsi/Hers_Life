#!/usr/bin/env node
import { parseArgs, resolveProfileDir, verifyBackup, assertFreshInstallBackup, readProfile, runDshRemove, BUNDLE_NAME } from './lib/installer-core.mjs'

try {
  const args = parseArgs(process.argv.slice(2), ['confirm'])
  if (!args.confirm) throw new Error('Rollback is destructive to the installed bundle. Re-run with --confirm after reviewing the dry-run output.')
  if (!args['profile-name']) throw new Error('--profile-name is required; rollback never guesses the DSH profile name.')
  if (!args['backup-dir']) throw new Error('--backup-dir is required; a verified pre-install metadata backup is mandatory.')
  const profileDir = await resolveProfileDir(args)
  const backup = await verifyBackup(args['backup-dir'], profileDir)
  assertFreshInstallBackup(backup)
  const { manifest, bundles } = await readProfile(profileDir)
  const present = Object.hasOwn(manifest.dependencies, BUNDLE_NAME) || bundles.includes(BUNDLE_NAME)
  if (!present) {
    console.log(JSON.stringify({ ok: true, changed: false, message: 'Hers Life bundle is not present; no action taken.' }, null, 2))
    process.exit(0)
  }
  console.log(JSON.stringify({
    action: 'dsh plugin --profile ' + args['profile-name'] + ' remove ' + BUNDLE_NAME,
    profilePath: profileDir,
    verifiedBackupAt: backup.createdAt,
    scope: 'Remove only dsh-hers-life through the DSH package manager. Do not restore or overwrite profile files.',
    preserved: backup.excluded,
  }, null, 2))
  const result = runDshRemove(args['profile-name'], args['dsh-bin'] || 'dsh')
  if (result.error) throw new Error('Could not launch DSH Plugin Manager: ' + result.error.message)
  if (result.status !== 0) throw new Error('DSH Plugin Manager removal failed with exit code ' + result.status)
  const after = await readProfile(profileDir)
  if (Object.hasOwn(after.manifest.dependencies, BUNDLE_NAME) || after.bundles.includes(BUNDLE_NAME)) {
    throw new Error('Removal command returned success but the bundle remains in the profile manifest.')
  }
  console.log('PROFILE ROLLBACK COMPLETE: only ' + BUNDLE_NAME + ' was removed through DSH Plugin Manager. If this Host has no HMR or reports restart-required, restart DSH before treating the running composition as rolled back.')
} catch (error) {
  console.error('ROLLBACK FAILED: ' + error.message)
  process.exitCode = 2
}
