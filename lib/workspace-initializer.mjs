import os from 'node:os'
import path from 'node:path'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'

const DEFAULT_PERSONA = {
  '人設.md': '# 人設\n\n<!-- 在這裡描述人格與互動風格；此檔只在不存在時自動建立。 -->\n',
  '名字.md': '# 名字與稱呼\n\n<!-- 在這裡記錄名字、稱呼與身份約定。 -->\n',
  '約定.md': '# 互動約定\n\n<!-- 在這裡記錄長期有效的互動規則。 -->\n',
}

const DEFAULT_FILES = [
  ['live/interests.json', JSON.stringify({ version: 1, topics: [], mute: [] }, null, 2) + '\n'],
  ['live/interest-log.jsonl', ''],
  ['live/interest-state.json', '{}\n'],
  ['live/skills-off.json', JSON.stringify({ off: [], note: '' }, null, 2) + '\n'],
  ['live/qq-observations.jsonl', ''],
  ['live/qq-groups.json', '{}\n'],
  ['live/holidays.json', JSON.stringify({ off: [], work: [] }, null, 2) + '\n'],
  ['live/onebot/qq-inbox.jsonl', ''],
  ['live/onebot/chat-sessions.json', '{}\n'],
]

const CORE_MEMORY = [
  '# DSH 核心記憶',
  '',
  '> 由 dsh-ming-core-memory 維護。只保存機器、環境、專案與工具事實。',
  '',
  '## 環境',
  '- ',
  '',
  '## 專案',
  '- ',
  '',
].join('\n')

async function isDirectory(value) {
  try {
    const info = await (await import('node:fs/promises')).stat(value)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function readLegacyWorkspace(dshHome, env) {
  const file = env.MING_MEMORY_CONFIG || path.join(dshHome, 'ming-memory.json')
  try {
    const value = JSON.parse(await readFile(file, 'utf8').then(text => text.replace(/^\uFEFF/, '')))
    return typeof value.root === 'string' && value.root.trim() ? value.root.trim() : ''
  } catch {
    return ''
  }
}

export async function resolveWorkspacePath(options = {}) {
  const env = options.env || process.env
  const dshHome = path.resolve(options.dshHome || env.DSH_HOME || path.join(os.homedir(), '.dsh'))
  const explicit = [options.workspacePath, options.memoryRoot, env.MING_WORKSPACE]
    .find(value => typeof value === 'string' && value.trim())
  if (explicit) return path.resolve(explicit)
  const legacy = await readLegacyWorkspace(dshHome, env)
  if (legacy && await isDirectory(path.resolve(legacy))) return path.resolve(legacy)
  return path.join(dshHome, 'workspace')
}

async function createIfMissing(file, content, report) {
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    report.created.push(file)
    return
  } catch (error) {
    if (error?.code === 'EEXIST') {
      report.existing.push(file)
      return
    }
    throw error
  }
}

/**
 * Create only known, safe starter files. Existing files are never opened for
 * writing, parsed-and-rewritten, renamed, or deleted.
 */
export async function initializeWorkspace(options = {}) {
  const workspacePath = path.resolve(options.workspacePath)
  const dshHome = path.resolve(options.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
  if (!path.isAbsolute(workspacePath) || workspacePath === path.parse(workspacePath).root) {
    throw new Error('Refusing to initialize an empty or filesystem-root workspace path.')
  }
  const report = { workspacePath, dshHome, created: [], existing: [], failed: [] }
  const directories = [
    workspacePath,
    path.join(workspacePath, 'persona'),
    path.join(workspacePath, 'diary'),
    path.join(workspacePath, 'live'),
    path.join(workspacePath, 'live', 'onebot'),
    path.join(workspacePath, 'live', 'sightings'),
    path.join(workspacePath, 'live', 'voice'),
    path.join(workspacePath, 'live', 'self-wake'),
    path.join(dshHome, 'memory'),
    path.join(dshHome, 'memory', 'notes'),
    path.join(dshHome, 'media', 'onebot'),
  ]
  for (const directory of directories) {
    try { await mkdir(directory, { recursive: true }) }
    catch (error) { report.failed.push({ path: directory, reason: error?.code || 'mkdir-failed' }) }
  }

  for (const [name, content] of Object.entries(DEFAULT_PERSONA)) {
    const file = path.join(workspacePath, 'persona', name)
    try { await createIfMissing(file, content, report) }
    catch (error) { report.failed.push({ path: file, reason: error?.code || 'write-failed' }) }
  }
  for (const [relative, content] of DEFAULT_FILES) {
    const file = path.join(workspacePath, relative)
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await createIfMissing(file, content, report)
    } catch (error) { report.failed.push({ path: file, reason: error?.code || 'write-failed' }) }
  }

  const memoryFiles = [
    [path.join(dshHome, 'memory', 'MEMORY.md'), CORE_MEMORY],
    [path.join(dshHome, 'memory', 'index.json'), JSON.stringify({ version: 1, notes: [] }, null, 2) + '\n'],
  ]
  for (const [file, content] of memoryFiles) {
    try { await createIfMissing(file, content, report) }
    catch (error) { report.failed.push({ path: file, reason: error?.code || 'write-failed' }) }
  }

  const extraObservationPath = options.qqObservationsPath
  if (typeof extraObservationPath === 'string' && extraObservationPath.trim()) {
    const file = path.resolve(workspacePath, extraObservationPath)
    try {
      await mkdir(path.dirname(file), { recursive: true })
      await createIfMissing(file, '', report)
    } catch (error) { report.failed.push({ path: file, reason: error?.code || 'write-failed' }) }
  }

  return report
}
