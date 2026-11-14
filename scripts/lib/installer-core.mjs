import { createHash } from 'node:crypto'
import { access, copyFile, lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const BUNDLE_NAME = 'dsh-hers-life'
export const PROFILE_FILES = ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
export const CHILDREN = [
  'dsh-ming-core-memory', 'dsh-ming-memory', 'dsh-ming-graph',
  'dsh-ming-discord', 'dsh-ming-interest', 'dsh-ming-bilibili-account',
  'dsh-ming-browse', 'dsh-ming-voice', 'dsh-ming-wake',
  'dsh-ming-resume', 'dsh-ming-skill-isolate', 'dsh-ming-mousepet',
]
export const BASELINE_COMMIT = '4880c98e00c634997103c6bc2192a88e7934e05f'
export const BRANCH = 'codex/unified-settings-20261114'

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
}

export function parseArgs(argv, booleanFlags = []) {
  const out = {}
  const bools = new Set(booleanFlags)
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) throw new Error('Unexpected positional argument: ' + token)
    const key = token.slice(2)
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error('Invalid option: ' + token)
    if (Object.hasOwn(out, key)) throw new Error('Duplicate option: ' + token)
    if (bools.has(key)) {
      out[key] = true
      continue
    }
    const value = argv[++i]
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + token)
    out[key] = value
  }
  return out
}

export function validateProfileName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('Profile name is missing or invalid; use only letters, digits, dot, underscore, and hyphen.')
  }
  return name
}

export async function resolveProfileDir(args, env = process.env) {
  if (args['profile-dir']) {
    if (!path.isAbsolute(args['profile-dir'])) throw new Error('--profile-dir must be an absolute path.')
    return realpath(args['profile-dir'])
  }
  const dshHome = args['dsh-home'] || env.DSH_HOME
  const profileName = args['profile-name']
  if (!dshHome || !profileName) {
    throw new Error('Specify --profile-dir, or both --profile-name and --dsh-home (or DSH_HOME). No default path is guessed.')
  }
  validateProfileName(profileName)
  if (!path.isAbsolute(dshHome)) throw new Error('--dsh-home must be an absolute path.')
  return realpath(path.join(dshHome, 'profiles', profileName))
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

export async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

export function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

export async function readProfile(profileDir) {
  const info = await stat(profileDir)
  if (!info.isDirectory()) throw new Error('The selected profile path is not a directory.')
  const manifest = await readJson(path.join(profileDir, 'package.json'))
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) throw new Error('Profile package.json is missing dsh.profile.bundles; refusing to treat it as a DSH profile.')
  if (!manifest.dependencies || typeof manifest.dependencies !== 'object') {
    throw new Error('Profile package.json has no dependencies object.')
  }
  return { manifest, bundles }
}

export async function createBackup(profileDir, backupDir) {
  const profile = await realpath(profileDir)
  const target = path.resolve(backupDir)
  if (!path.isAbsolute(backupDir)) throw new Error('--backup-dir must be an absolute path.')
  if (isWithin(profile, target) || isWithin(target, profile)) {
    throw new Error('Backup directory must be outside the profile directory.')
  }
  try {
    await access(target)
    throw new Error('Backup destination already exists; refusing to overwrite it.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const parent = path.dirname(target)
  await mkdir(parent, { recursive: true })
  await mkdir(target, { recursive: false })
  const files = []
  for (const name of PROFILE_FILES) {
    const source = path.join(profile, name)
    try {
      const meta = await lstat(source)
      if (!meta.isFile()) throw new Error('Refusing to copy non-regular profile metadata file: ' + name)
      await copyFile(source, path.join(target, name))
      files.push({ name, size: meta.size, sha256: await sha256(path.join(target, name)) })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (!files.some(file => file.name === 'package.json')) {
    throw new Error('Profile package.json was not backed up; backup is incomplete.')
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'hers-life-profile-metadata-backup',
    createdAt: new Date().toISOString(),
    profilePath: profile,
    bundleName: BUNDLE_NAME,
    baselineCommit: BASELINE_COMMIT,
    files,
    excluded: ['node_modules', 'workspace', 'memory', 'diary', 'QQ Inbox', 'Discord sessions', 'Edge profile', 'Mousepet skins', 'AI Cursor PNGs', 'credentials'],
  }
  await writeFile(path.join(target, 'backup-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return manifest
}

export async function verifyBackup(backupDir, profileDir) {
  const backup = await realpath(backupDir)
  const manifest = await readJson(path.join(backup, 'backup-manifest.json'))
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'hers-life-profile-metadata-backup') {
    throw new Error('Unrecognized backup manifest.')
  }
  const profile = await realpath(profileDir)
  if (path.resolve(manifest.profilePath) !== path.resolve(profile)) {
    throw new Error('Backup belongs to a different profile path.')
  }
  for (const file of manifest.files || []) {
    if (!PROFILE_FILES.includes(file.name)) throw new Error('Backup manifest contains an unexpected file: ' + file.name)
    if (await sha256(path.join(backup, file.name)) !== file.sha256) {
      throw new Error('Backup integrity check failed: ' + file.name)
    }
  }
  if (!(manifest.files || []).some(file => file.name === 'package.json')) {
    throw new Error('Backup manifest does not include package.json.')
  }
  return manifest
}

export async function checkHealth(profileDir, rootDir = repoRoot()) {
  const { manifest, bundles } = await readProfile(profileDir)
  const dependency = manifest.dependencies[BUNDLE_NAME]
  const installedManifestPath = path.join(profileDir, 'node_modules', BUNDLE_NAME, 'package.json')
  let installedManifest = null
  try {
    installedManifest = await readJson(installedManifestPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const rootPackage = await readJson(path.join(rootDir, 'package.json'))
  const rootSpec = await readJson(path.join(rootDir, 'hers-life.install.json'))
  const staticPatch = await readFile(path.join(rootDir, 'cordis.patch.yml'), 'utf8')
  const checks = {
    profileManifestValid: true,
    dependencyDeclared: typeof dependency === 'string',
    bundleSelected: bundles.includes(BUNDLE_NAME),
    packageFilesPresent: installedManifest?.name === BUNDLE_NAME,
    privacyGateTemplateDisabled: /disabled:\s*true/.test(staticPatch) && /privacyReady:\s*false/.test(staticPatch),
    pinnedBaseline: rootSpec.baselineCommit === BASELINE_COMMIT,
    all12ChildrenDeclared: CHILDREN.every(name => Object.hasOwn(rootPackage.dependencies || {}, name)),
  }
  const ok = Object.values(checks).every(Boolean)
  return {
    ok,
    checks,
    effectiveRuntimeConfigVerified: false,
    note: 'This is a filesystem/static check only. It does not boot DSH or prove the effective config after profile/home overrides.',
  }
}

export function buildDshRemoveArgs(profileName) {
  validateProfileName(profileName)
  return ['plugin', '--profile', profileName, 'remove', BUNDLE_NAME]
}

export function runDshRemove(profileName, dshBin = 'dsh') {
  const args = buildDshRemoveArgs(profileName)
  if (process.platform === 'win32') {
    if (/["\r\n&|<>^%]/.test(dshBin)) throw new Error('--dsh-bin contains characters unsafe for cmd.exe.')
    const command = '"' + dshBin + '" ' + args.map(value => '"' + value + '"').join(' ')
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { stdio: 'inherit' })
  }
  return spawnSync(dshBin, args, { stdio: 'inherit' })
}
