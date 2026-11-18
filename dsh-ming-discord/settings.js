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
  voice: { enabled: true, ffmpeg: 'ffmpeg', python: 'python', timeoutMs: 60000, heartbeat: true, ttsVoice: 'zh-CN-XiaoxiaoNeural', ttsRate: '+0%' },
  interest: { enabled: true, minChars: 6, contextLines: 4, groups: [], minGapMinutes: 20, maxPerHour: 3, quietHours: '01:00-08:00', channelGapMinutes: 45 },
  browse: {
    enabled: true, idleMinutes: 20, minGapMinutes: 30, dailyMax: 8, sessionRounds: 15,
    quietHours: '08:00-18:30', gapMode: 'fixed', hbMin: 5, hbCenter: 30, hbMax: 240,
    freeWindows: [{ start: '18:30', end: '08:00' }, { start: '13:50', end: '18:15', only: 'rest' }],
    holidaysFile: 'live/holidays.json', maxItems: 2, maxShots: 2,
    serial: '127.0.0.1:16448', adbPath: 'D:\\MuMuPlayer\\nx_device\\12.0\\shell\\adb.exe',
    socialApps: ['com.xingin.xhs', 'com.tencent.weibo', 'com.sina.weibo', 'com.ss.android.ugc.aweme', 'com.smile.gifmaker', 'com.zhihu.android', 'com.baidu.tieba', 'com.tencent.mm'],
    socialWriteWords: ['点赞', '关注', '评论', '收藏', '转发', '分享', '发布', '发送', '投币', '私信', '赞'],
    targets: ['xiaohongshu', 'bilibili'],
  },
  resume: { enabled: true, adbPath: 'D:\\MuMuPlayer\\nx_device\\12.0\\shell\\adb.exe', serial: '127.0.0.1:7555', pauseMediaOnInterrupt: true },
  wake: { enabled: true },
  mousepet: {
    enabled: true, cursorMode: 'companion', cursorHoldMs: 2600, cursorSize: 64, cursorState: 'pointer', webpickDir: '',
    shake: { on: true, level: 'medium' },
    companion: { enabled: true, tickMs: 0, provider: 'wb-proxy', model: 'hy4-preview', bubbleMs: 4200, workspace: '' },
  },
  bilibili: { enabled: true, credentialFile: '', searchMaxPageSize: 20, subtitleMaxChars: 16000, timeoutMs: 30000 },
  activities: { enabled: true },
  skillIsolate: { enabled: true, stateFile: '' },
  graph: { enabled: true, syncSeconds: 120, costPricesFile: '', costAutoFile: '' },
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
function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}
function cleanTimeWindows(value, fallback) {
  const source = Array.isArray(value) ? value : fallback
  return source.map((row) => {
    if (!row || typeof row !== 'object') return null
    const start = String(row.start || '')
    const end = String(row.end || '')
    if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(start) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(end)) return null
    return { start, end, ...(row.only === 'rest' ? { only: 'rest' } : {}) }
  }).filter(Boolean)
}
function normalizePluginSettings(settings) {
  settings.browse = { ...DEFAULTS.browse, ...(settings.browse || {}) }
  settings.resume = { ...DEFAULTS.resume, ...(settings.resume || {}) }
  settings.wake = { ...DEFAULTS.wake, ...(settings.wake || {}) }
  settings.mousepet = { ...DEFAULTS.mousepet, ...(settings.mousepet || {}), shake: { ...DEFAULTS.mousepet.shake, ...(settings.mousepet?.shake || {}) }, companion: { ...DEFAULTS.mousepet.companion, ...(settings.mousepet?.companion || {}) } }
  settings.bilibili = { ...DEFAULTS.bilibili, ...(settings.bilibili || {}) }
  settings.activities = { ...DEFAULTS.activities, ...(settings.activities || {}) }
  settings.skillIsolate = { ...DEFAULTS.skillIsolate, ...(settings.skillIsolate || {}) }
  settings.graph = { ...DEFAULTS.graph, ...(settings.graph || {}) }
  settings.browse.idleMinutes = clampNumber(settings.browse.idleMinutes, 1, 1440, DEFAULTS.browse.idleMinutes)
  settings.browse.minGapMinutes = clampNumber(settings.browse.minGapMinutes, 0, 1440, DEFAULTS.browse.minGapMinutes)
  settings.browse.dailyMax = clampNumber(settings.browse.dailyMax, 0, 500, DEFAULTS.browse.dailyMax)
  settings.browse.sessionRounds = clampNumber(settings.browse.sessionRounds, 1, 100, DEFAULTS.browse.sessionRounds)
  settings.browse.maxItems = clampNumber(settings.browse.maxItems, 1, 50, DEFAULTS.browse.maxItems)
  settings.browse.maxShots = clampNumber(settings.browse.maxShots, 0, 50, DEFAULTS.browse.maxShots)
  settings.browse.gapMode = ['fixed', 'random', 'heartbeat'].includes(settings.browse.gapMode) ? settings.browse.gapMode : DEFAULTS.browse.gapMode
  settings.browse.hbMin = clampNumber(settings.browse.hbMin, 1, 1438, DEFAULTS.browse.hbMin)
  settings.browse.hbCenter = clampNumber(settings.browse.hbCenter, 2, 1439, DEFAULTS.browse.hbCenter)
  settings.browse.hbMax = clampNumber(settings.browse.hbMax, 3, 1440, DEFAULTS.browse.hbMax)
  if (!(settings.browse.hbMin < settings.browse.hbCenter && settings.browse.hbCenter < settings.browse.hbMax)) {
    settings.browse.hbMin = DEFAULTS.browse.hbMin
    settings.browse.hbCenter = DEFAULTS.browse.hbCenter
    settings.browse.hbMax = DEFAULTS.browse.hbMax
  }
  settings.browse.freeWindows = cleanTimeWindows(settings.browse.freeWindows, DEFAULTS.browse.freeWindows)
  for (const key of ['socialApps', 'socialWriteWords', 'targets']) settings.browse[key] = cleanStringList(settings.browse[key])
  settings.resume.pauseMediaOnInterrupt = settings.resume.pauseMediaOnInterrupt !== false
  settings.voice.timeoutMs = clampNumber(settings.voice.timeoutMs, 1000, 600000, DEFAULTS.voice.timeoutMs)
  settings.mousepet.cursorMode = ['companion', 'clean'].includes(settings.mousepet.cursorMode) ? settings.mousepet.cursorMode : DEFAULTS.mousepet.cursorMode
  settings.mousepet.cursorHoldMs = clampNumber(settings.mousepet.cursorHoldMs, 0, 60000, DEFAULTS.mousepet.cursorHoldMs)
  settings.mousepet.cursorSize = clampNumber(settings.mousepet.cursorSize, 24, 192, DEFAULTS.mousepet.cursorSize)
  settings.mousepet.companion.tickMs = clampNumber(settings.mousepet.companion.tickMs, 0, 86400000, DEFAULTS.mousepet.companion.tickMs)
  settings.mousepet.companion.bubbleMs = clampNumber(settings.mousepet.companion.bubbleMs, 500, 60000, DEFAULTS.mousepet.companion.bubbleMs)
  settings.bilibili.searchMaxPageSize = clampNumber(settings.bilibili.searchMaxPageSize, 1, 50, DEFAULTS.bilibili.searchMaxPageSize)
  settings.bilibili.subtitleMaxChars = clampNumber(settings.bilibili.subtitleMaxChars, 1000, 100000, DEFAULTS.bilibili.subtitleMaxChars)
  settings.bilibili.timeoutMs = clampNumber(settings.bilibili.timeoutMs, 1000, 120000, DEFAULTS.bilibili.timeoutMs)
  settings.graph.syncSeconds = clampNumber(settings.graph.syncSeconds, 15, 3600, DEFAULTS.graph.syncSeconds)
  return settings
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
    this.home = path.resolve(options.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
    this.file = path.join(this.home, 'hers-life.json')
    this.secretsFile = path.join(this.home, 'hers-life-secrets.json')
    let saved = {}
    try { saved = JSON.parse(readFileSync(this.file, 'utf8')) } catch {}
    // The workspace must be visible synchronously to dependent plugins during
    // their apply() phase; token loading remains asynchronous and secret-only.
    this.settings = normalizePluginSettings(merge(merge(DEFAULTS, config), saved))
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
    const allowed = ['enabled', 'workspace', 'ownerIds', 'agentPreset', 'personaFiles', 'diaryDir', 'diaryCount', 'diaryChars', 'maxChars', 'discord', 'memory', 'voice', 'interest', 'browse', 'resume', 'wake', 'mousepet', 'bilibili', 'activities', 'skillIsolate', 'graph', 'advanced']
    const picked = {}
    for (const key of allowed) if (patch[key] !== undefined) picked[key] = patch[key]
    if (picked.discord) {
      picked.discord = { ...picked.discord }
      delete picked.discord.token
      delete picked.discord.tokenInput
      delete picked.discord.tokenConfigured
    }
    this.settings = normalizePluginSettings(merge(this.settings, picked))
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
