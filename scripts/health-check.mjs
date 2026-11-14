#!/usr/bin/env node
import { parseArgs, resolveProfileDir, checkHealth } from './lib/installer-core.mjs'

try {
  const args = parseArgs(process.argv.slice(2))
  const profileDir = await resolveProfileDir(args)
  const report = await checkHealth(profileDir)
  console.log(JSON.stringify({ profilePath: profileDir, ...report }, null, 2))
  if (!report.ok) process.exitCode = 2
} catch (error) {
  console.error('HEALTH CHECK FAILED: ' + error.message)
  process.exitCode = 2
}
