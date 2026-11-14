#!/usr/bin/env node
import { parseArgs, resolveProfileDir, createBackup } from './lib/installer-core.mjs'

try {
  const args = parseArgs(process.argv.slice(2))
  if (!args['backup-dir']) throw new Error('Required: --backup-dir <absolute-path>')
  const profileDir = await resolveProfileDir(args)
  const manifest = await createBackup(profileDir, args['backup-dir'])
  console.log(JSON.stringify({
    ok: true,
    profilePath: manifest.profilePath,
    backupPath: args['backup-dir'],
    files: manifest.files.map(file => ({ name: file.name, size: file.size, sha256: file.sha256 })),
    excluded: manifest.excluded,
  }, null, 2))
} catch (error) {
  console.error('BACKUP FAILED: ' + error.message)
  process.exitCode = 2
}
