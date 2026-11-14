import os from 'node:os'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { initializeWorkspace, resolveWorkspacePath } from './lib/workspace-initializer.mjs'

export const name = 'hers-life'

const stringList = () => z.array(z.string()).default([])
const emptyObject = () => z.object({}).default({})

/**
 * Volatile sections are edited through DSH Settings. Secret values are never
 * part of this schema: they belong in DSH Credentials and are referenced by
 * their stable credential names.
 */
export const Config = z.object({
  security: z.object({
    // Deliberately NOT volatile and never rendered in the settings UI.
    privacyReady: z.boolean().default(false),
  }).default({}),
  workspacePath: z.string().default('').volatile(),
  environment: z.object({
    pythonPath: z.string().default(''),
    ffmpegPath: z.string().default(''),
    ffplayPath: z.string().default(''),
    powershellPath: z.string().default(''),
    adbPath: z.string().default(''),
    dshToolsPath: z.string().default(''),
  }).default({}).volatile(),
  coreMemory: emptyObject().volatile(),
  memory: z.object({
    root: z.string().default(''),
    personaFiles: z.array(z.string()).default(['persona/人設.md', 'persona/名字.md', 'persona/約定.md']),
    diaryDir: z.string().default('diary'),
    diaryCount: z.number().step(1).min(0).default(3),
    maxChars: z.number().step(1).min(1000).default(12000),
    diaryChars: z.number().step(1).min(0).default(8000),
    totalChars: z.number().step(1).min(1000).default(60000),
    qq: z.object({
      dir: z.string().default(''),
      hours: z.number().step(1).min(0).default(6),
      maxLines: z.number().step(1).min(0).default(10),
      offFile: z.string().default('live/qq-sync-off'),
      webForQq: z.string().default('live/web-for-qq.md'),
      webForQqEveryMs: z.number().step(1).min(1000).default(300000),
      webForQqLines: z.number().step(1).min(0).default(3),
    }).default({}),
  }).default({}).volatile(),
  graph: z.object({
    syncSeconds: z.number().step(1).min(5).default(120),
    qqObservations: z.string().default(''),
    peopleIndex: z.string().default(''),
    ownerId: z.string().default(''),
    ownerName: z.string().default('我'),
    maxPeople: z.number().step(1).min(1).default(120),
    maxTopics: z.number().step(1).min(1).default(55),
    maxEdges: z.number().step(1).min(1).default(160),
    timelineDays: z.number().step(1).min(1).default(30),
    memoryCard: z.string().default(''),
    diaryDir: z.string().default(''),
    diaryDays: z.number().step(1).min(1).default(60),
    dshMemoryDir: z.string().default(''),
    skillsCwd: z.string().default(''),
    skillsOffFile: z.string().default(''),
    costPricesFile: z.string().default(''),
    costAutoFile: z.string().default(''),
    roomLabels: z.dict(z.string()).default({}),
  }).default({}).volatile(),
  discord: z.object({
    enabled: z.boolean().default(false),
    workspacePath: z.string().default(''),
    ownerUserId: z.string().default(''),
    allowedGuildIds: stringList(),
    allowedChannelIds: stringList(),
    allowedUserIds: stringList(),
    ownerUserIds: stringList(),
    mentionRequired: z.boolean().default(true),
    directMessages: z.boolean().default(true),
    observeUnmentioned: z.boolean().default(false),
    provider: z.string().default(''),
    model: z.string().default(''),
    agentPreset: z.string().default(''),
    maxAttachmentBytes: z.number().step(1).min(1024).default(10485760),
    inboxPath: z.string().default(''),
    chatSessionsPath: z.string().default(''),
  }).default({}).volatile(),
  qq: z.object({
    ownerQQ: z.string().default(''),
    inboxPath: z.string().default(''),
    chatSessionsPath: z.string().default(''),
  }).default({}).volatile(),
  interest: z.object({
    enabled: z.boolean().default(false),
    observeEnabled: z.boolean().default(false),
    observePrivate: z.boolean().default(false),
    workspacePath: z.string().default(''),
    inboxPath: z.string().default(''),
    chatSessionsPath: z.string().default(''),
    interestsFile: z.string().default('live/interests.json'),
    logFile: z.string().default('live/interest-log.jsonl'),
    stateFile: z.string().default('live/interest-state.json'),
    offFlag: z.string().default('live/interest-off'),
    pollMs: z.number().step(1).min(1000).default(20000),
    minGapMinutes: z.number().step(1).min(0).default(20),
    maxPerHour: z.number().step(1).min(0).default(3),
    quietHours: z.string().default('01:00-08:00'),
    minChars: z.number().step(1).min(0).default(6),
    contextLines: z.number().step(1).min(0).default(4),
    groups: stringList(),
    observeGroups: stringList(),
    pendingMax: z.number().step(1).min(1).default(80),
    pendingTtlMinutes: z.number().step(1).min(1).default(30),
  }).default({}).volatile(),
  bilibiliAccount: emptyObject().volatile(),
  browse: z.object({
    enabled: z.boolean().default(false),
    workspacePath: z.string().default(''),
    idleMinutes: z.number().step(1).min(1).default(20),
    minGapMinutes: z.number().step(1).min(1).default(30),
    dailyMax: z.number().step(1).min(0).default(8),
    sessionRounds: z.number().step(1).min(1).default(6),
    quietHours: z.string().default('08:00-18:30'),
    holidaysFile: z.string().default('live/holidays.json'),
    agentPreset: z.string().default(''),
    maxItems: z.number().step(1).min(1).default(2),
    maxShots: z.number().step(1).min(0).default(2),
    serial: z.string().default(''),
    targetMode: z.string().default('self'),
    qqSessionPrefix: z.string().default('onebot-'),
    ownerQQ: z.string().default(''),
    ownerDiscordId: z.string().default(''),
    discordSessionPrefix: z.string().default('discord-'),
    adbPath: z.string().default(''),
  }).default({}).volatile(),
  voice: z.object({
    root: z.string().default(''),
    voice: z.string().default('zh-CN-XiaoxiaoNeural'),
    rate: z.string().default('+0%'),
    python: z.string().default(''),
    ffmpeg: z.string().default(''),
    powershell: z.string().default(''),
    timeoutMs: z.number().step(1).min(1000).default(60000),
  }).default({}).volatile(),
  wake: z.object({
    root: z.string().default(''),
  }).default({}).volatile(),
  resume: z.object({
    root: z.string().default(''),
    adbPath: z.string().default(''),
    serial: z.string().default(''),
    pauseMediaOnInterrupt: z.boolean().default(true),
  }).default({}).volatile(),
  skillIsolate: z.object({
    root: z.string().default(''),
    stateFile: z.string().default(''),
  }).default({}).volatile(),
  mousepet: z.object({
    cursorMode: z.string().default('companion'),
    cursorHoldMs: z.number().step(1).min(0).default(2600),
    cursorSize: z.number().step(1).min(16).max(256).default(64),
    toolsPath: z.string().default(''),
    companion: z.object({ enabled: z.boolean().default(false), tickMs: z.number().step(1).min(0).default(0) }).default({}),
  }).default({}).volatile(),
})

const CHILDREN = [
  ['coreMemory', 'dsh-ming-core-memory'],
  ['memory', 'dsh-ming-memory'],
  ['graph', 'dsh-ming-graph'],
  ['discord', 'dsh-ming-discord'],
  ['interest', 'dsh-ming-interest'],
  ['bilibiliAccount', 'dsh-ming-bilibili-account'],
  ['browse', 'dsh-ming-browse'],
  ['voice', 'dsh-ming-voice'],
  ['wake', 'dsh-ming-wake'],
  ['resume', 'dsh-ming-resume'],
  ['skillIsolate', 'dsh-ming-skill-isolate'],
  ['mousepet', 'dsh-ming-mousepet'],
]

function valueOf(value) {
  return value && typeof value.get === 'function' ? value.get() : value
}

function sectionOf(config, key) {
  const value = valueOf(config?.[key])
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
}

function unique(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]
}

function dshHome() {
  return path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
}

function absoluteOrWorkspace(value, workspacePath) {
  if (typeof value !== 'string' || !value.trim()) return ''
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspacePath, value)
}

export async function apply(ctx, rawConfig = {}) {
  const config = rawConfig || {}
  const security = valueOf(config.security) || {}
  const environment = sectionOf(config, 'environment')
  const childConfigs = Object.fromEntries(CHILDREN.map(([key]) => [key, sectionOf(config, key)]))
  const home = dshHome()
  const workspacePath = await resolveWorkspacePath({
    workspacePath: valueOf(config.workspacePath),
    memoryRoot: childConfigs.memory.root,
    dshHome: home,
  })

  const memory = childConfigs.memory
  memory.root = memory.root || workspacePath
  const graph = childConfigs.graph
  graph.ownerId = graph.ownerId || childConfigs.qq.ownerQQ || ''
  graph.dshMemoryDir = graph.dshMemoryDir || path.join(home, 'memory')
  graph.skillsCwd = graph.skillsCwd || workspacePath
  graph.skillsOffFile = graph.skillsOffFile || path.join(workspacePath, 'skills-off.json')
  graph.qqObservations = absoluteOrWorkspace(graph.qqObservations, workspacePath) || path.join(workspacePath, 'live', 'qq-observations.jsonl')
  if (graph.diaryDir) graph.diaryDir = absoluteOrWorkspace(graph.diaryDir, workspacePath)

  const onebotInbox = path.join(home, 'media', 'onebot', 'qq-inbox.jsonl')
  const chatSessions = path.join(home, 'media', 'onebot', 'chat-sessions.json')
  const qq = childConfigs.qq
  const discord = childConfigs.discord
  discord.workspacePath = discord.workspacePath || workspacePath
  discord.ownerUserIds = unique([...(discord.ownerUserIds || []), discord.ownerUserId])
  discord.inboxPath = discord.inboxPath || onebotInbox
  discord.chatSessionsPath = discord.chatSessionsPath || chatSessions

  const interest = childConfigs.interest
  interest.workspacePath = interest.workspacePath || workspacePath
  interest.inboxPath = interest.inboxPath || qq.inboxPath || onebotInbox
  interest.chatSessionsPath = interest.chatSessionsPath || qq.chatSessionsPath || chatSessions

  const browse = childConfigs.browse
  browse.workspacePath = browse.workspacePath || workspacePath
  browse.ownerQQ = qq.ownerQQ || browse.ownerQQ || process.env.MING_OWNER_QQ || ''
  browse.ownerDiscordId = discord.ownerUserId || browse.ownerDiscordId || process.env.MING_OWNER_DISCORD_ID || ''
  if (environment.adbPath) browse.adbPath = environment.adbPath

  const voice = childConfigs.voice
  voice.root = voice.root || workspacePath
  if (environment.pythonPath) voice.python = environment.pythonPath
  if (environment.ffmpegPath) voice.ffmpeg = environment.ffmpegPath
  if (environment.powershellPath) voice.powershell = environment.powershellPath

  const wake = childConfigs.wake
  wake.root = wake.root || workspacePath
  const resume = childConfigs.resume
  resume.root = resume.root || workspacePath
  resume.adbPath = environment.adbPath || resume.adbPath || browse.adbPath || ''
  resume.serial = resume.serial || browse.serial || ''
  const mousepet = childConfigs.mousepet
  if (environment.dshToolsPath) mousepet.toolsPath = environment.dshToolsPath
  const skillIsolate = childConfigs.skillIsolate
  skillIsolate.root = skillIsolate.root || workspacePath
  skillIsolate.stateFile = skillIsolate.stateFile || graph.skillsOffFile

  const init = await initializeWorkspace({
    workspacePath,
    dshHome: home,
    qqObservationsPath: graph.qqObservations,
  })
  if (init.created.length) ctx.logger.info('[hers-life] 已自動建立 %d 個缺少的預設檔案。', init.created.length)
  if (init.failed.length) ctx.logger.warn('[hers-life] 有 %d 個預設檔案無法建立；不會覆蓋既有資料。', init.failed.length)

  if (security.privacyReady !== true) {
    ctx.logger.info('[hers-life] 設定中心與資料初始化已啟動；12 個功能插件仍受隱私閘門保護，尚未載入。')
    return
  }

  for (const [key, packageName] of CHILDREN) {
    const module = await import(packageName)
    if (!module || typeof module.apply !== 'function') {
      throw new TypeError('[dsh-hers-life] invalid child plugin: ' + packageName)
    }
    const plugin = (childCtx, childConfig) => module.apply(childCtx, childConfig)
    Object.defineProperties(plugin, {
      name: { value: typeof module.name === 'string' ? module.name : key, configurable: true },
      inject: { value: Array.isArray(module.inject) ? module.inject : [], configurable: true },
    })
    await ctx.plugin(plugin, childConfigs[key])
  }
}
