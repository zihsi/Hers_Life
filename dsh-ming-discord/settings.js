import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULTS = {
  enabled: false,
  workspace: path.join(os.homedir(), 'hers-life-workspace'),
  ownerIds: [],
  agentPreset: '',
  personaFiles: ['persona/人设.md', 'persona/名字.md', 'persona/约定.md'],
  diaryDir: 'diary',
  diaryCount: 3,
  diaryChars: 8000,
  maxChars: 12000,
  discord: {
    enabled: false, mode: 'mention', allowDm: true, dmPolicy: 'owner',
    guildIds: [], channelIds: [], whitelist: [], typing: true,
    streamEdits: true, replyToMessage: true, reactions: true,
    shareImages: true, chunkLimit: 1900, maxAttachmentMb: 24,
    progressInDm: true, showTools: false, learnInterests: true,
  },
  memory: {
    enabled: true, shareAcrossChannels: true, shareAcrossGuilds: true,
    sharePrivateToOwner: true, allowPrivateContextInGuild: true, maxRecall: 6,
    maxEvents: 20000, maxAgeDays: 365,
  },
  voice: { enabled: true, ffmpeg: 'ffmpeg', heartbeat: true },
  interest: { enabled: true, minChars: 6, contextLines: 4, groups: [], minGapMinutes: 20, maxPerHour: 3, quietHours: '01:00-08:00', channelGapMinutes: 45 },
  advanced: { turnTimeoutMinutes: 15 },
}
function merge(base, patch) {
  const out = { ...base }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) out[key] = merge(base[key], value)
    else out[key] = value
  }
  return out
}
function cleanStringList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))]
}
function safeRelativePath(value, fallback = '') {
  const raw = String(value ?? '').trim().replace(/\\/g, '/')
  if (!raw) return fallback
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('路徑必須是工作區內的相對路徑，不能包含 .. 或絕對路徑')
  }
  return raw
}
function safeRelativeList(value, fallback) {
  const source = Array.isArray(value) ? value : fallback
  return [...new Set(source.map((item) => safeRelativePath(item)).filter(Boolean))]
}
export function isDiaryFilename(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(path.posix.basename(String(value ?? '')))
  if (!match) return false
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  if (year < 1000) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
export function isDiaryPath(value, diaryDir) {
  const relative = String(value ?? '').replace(/\\/g, '/')
  const root = safeRelativePath(diaryDir, DEFAULTS.diaryDir)
  if (!relative || relative.startsWith('/') || /^[a-zA-Z]:/.test(relative)) return false
  const parts = relative.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return false
  return parts.length === root.split('/').length + 1 &&
    relative.startsWith(root + '/') && isDiaryFilename(relative)
}
export class SettingsStore {
  constructor(config = {}, options = {}) {
    this.home = options.home || path.join(os.homedir(), '.dsh')
    this.file = path.join(this.home, 'hers-life.json')
    this.secretsFile = path.join(this.home, 'hers-life-secrets.json')
    let saved = {}
    try { saved = JSON.parse(readFileSync(this.file, 'utf8')) } catch {}
    // The workspace must be visible synchronously to dependent plugins during
    // their apply() phase; token loading remains asynchronous and secret-only.
    this.settings = merge(merge(DEFAULTS, config), saved)
    this.settings.workspace = path.resolve(String(this.settings.workspace || DEFAULTS.workspace))
    this.settings.ownerIds = cleanStringList(this.settings.ownerIds)
    this.settings.personaFiles = safeRelativeList(this.settings.personaFiles, DEFAULTS.personaFiles)
    this.settings.diaryDir = safeRelativePath(this.settings.diaryDir, DEFAULTS.diaryDir)
    this.token = ''
  }
  async load() {
    await mkdir(this.home, { recursive: true })
    try { this.settings = merge(this.settings, JSON.parse(await readFile(this.file, 'utf8'))) } catch {}
    try {
      const secret = JSON.parse(await readFile(this.secretsFile, 'utf8'))
      this.token = typeof secret.discordBotToken === 'string' ? secret.discordBotToken.trim() : ''
    } catch {}
    // Migrate any legacy plaintext token into the separate secret file, then
    // remove token-shaped fields from the ordinary settings JSON.
    const legacyToken = this.settings.discord?.token || this.settings.discord?.botToken
    const hadLegacySecret = ['token', 'botToken', 'tokenInput', 'tokenConfigured']
      .some((key) => Object.prototype.hasOwnProperty.call(this.settings.discord || {}, key))
    if (!this.token && typeof legacyToken === 'string' && legacyToken.trim()) await this.saveToken(legacyToken)
    for (const key of ['token', 'botToken', 'tokenInput', 'tokenConfigured']) delete this.settings.discord[key]
    this.settings.workspace = path.resolve(String(this.settings.workspace || DEFAULTS.workspace))
    this.settings.ownerIds = cleanStringList(this.settings.ownerIds)
    this.settings.personaFiles = safeRelativeList(this.settings.personaFiles, DEFAULTS.personaFiles)
    this.settings.diaryDir = safeRelativePath(this.settings.diaryDir, DEFAULTS.diaryDir)
    if (hadLegacySecret) await this.save()
    return this
  }
  get(key, fallback) {
    const value = String(key).split('.').reduce((at, part) => at == null ? undefined : at[part], this.settings)
    return value === undefined ? fallback : value
  }
  resolve() {
    const workspace = path.resolve(String(this.settings.workspace || DEFAULTS.workspace))
    return { workspace, dataRoot: path.join(workspace, 'live'), ffmpeg: String(this.get('voice.ffmpeg', 'ffmpeg') || 'ffmpeg') }
  }
  ownerIds() { return cleanStringList(this.settings.ownerIds) }
  isOwner(id) { return this.ownerIds().includes(String(id ?? '')) }
  hasToken() { return this.token.length > 0 }
  publicConfig() {
    const discord = { ...this.settings.discord }
    // Tokens belong only in hers-life-secrets.json; never echo legacy plaintext
    // token fields back through the settings API.
    delete discord.token
    delete discord.botToken
    delete discord.tokenInput
    delete discord.tokenConfigured
    return {
      ...this.settings,
      workspace: this.resolve().workspace,
      ownerIds: this.ownerIds(),
      discord: { ...discord, tokenConfigured: this.hasToken() },
    }
  }
  async save() {
    await mkdir(this.home, { recursive: true })
    const tmp = this.file + '.tmp-' + process.pid
    await writeFile(tmp, JSON.stringify(this.settings, null, 2) + '\n', 'utf8')
    await rename(tmp, this.file)
  }
  async saveToken(token) {
    this.token = String(token ?? '').trim()
    await mkdir(this.home, { recursive: true })
    const tmp = this.secretsFile + '.tmp-' + process.pid
    await writeFile(tmp, JSON.stringify({ discordBotToken: this.token }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, this.secretsFile)
  }
  async patch(patch = {}, token) {
    const allowed = ['enabled', 'workspace', 'ownerIds', 'agentPreset', 'personaFiles', 'diaryDir', 'diaryCount', 'diaryChars', 'maxChars', 'discord', 'memory', 'voice', 'interest', 'advanced']
    const picked = {}
    for (const key of allowed) if (patch[key] !== undefined) picked[key] = patch[key]
    if (picked.discord) {
      picked.discord = { ...picked.discord }
      delete picked.discord.token
      delete picked.discord.tokenInput
      delete picked.discord.tokenConfigured
    }
    this.settings = merge(this.settings, picked)
    this.settings.workspace = path.resolve(String(this.settings.workspace || DEFAULTS.workspace))
    this.settings.ownerIds = cleanStringList(this.settings.ownerIds)
    this.settings.personaFiles = safeRelativeList(this.settings.personaFiles, DEFAULTS.personaFiles)
    this.settings.diaryDir = safeRelativePath(this.settings.diaryDir, DEFAULTS.diaryDir)
    if (!['all', 'mention', 'own'].includes(this.settings.discord.mode)) this.settings.discord.mode = 'mention'
    if (!['owner', 'anyone', 'whitelist'].includes(this.settings.discord.dmPolicy)) this.settings.discord.dmPolicy = 'owner'
    this.settings.discord.guildIds = cleanStringList(this.settings.discord.guildIds)
    this.settings.discord.channelIds = cleanStringList(this.settings.discord.channelIds)
    this.settings.discord.whitelist = cleanStringList(this.settings.discord.whitelist)
    if (token !== undefined && String(token).trim() !== '') await this.saveToken(token)
    await this.save()
    return this.publicConfig()
  }
}
