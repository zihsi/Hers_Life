import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { readDiscord } from '../../dsh-ming-memory/lib/model.mjs'
import { readDiscordEvents } from '../../dsh-ming-memory/lib/neuron.mjs'
import { SettingsStore, isDiaryFilename, isDiaryPath } from '../settings.js'
import { DiscordSessionPool } from '../pool.js'
import { DiscordBrain } from '../memory.js'
import { DiscordInterestStore } from '../interests.js'
import { DiscordBridge } from '../discord/bridge.js'
import { apply as applyDiscord } from '../index.js'
import { apply as applyMemory, inject as memoryInject, __internals as memoryInternals } from '../../dsh-ming-memory/index.js'

test('DM, guild channel and thread get distinct durable session ids', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-pool-'))
  try {
    const settings = new SettingsStore({ workspace: root }, { home: root })
    await settings.load()
    const created = []
    const ctx = {
      get() { return undefined },
      agents: {
        get() { return undefined },
        async create({ sessionId }) {
          const agent = { id: sessionId, session: { id: sessionId }, status: 'idle' }
          created.push(sessionId)
          return { agent }
        },
        async resume() { throw new Error('no stored session') },
      },
    }
    const pool = new DiscordSessionPool({ ctx, settings })
    await pool.load()
    const dm = { kind: 'dm', channelId: 'dm-100', userId: 'owner-1' }
    const channel = { kind: 'channel', channelId: 'chan-1', guildId: 'guild-1' }
    const thread = { kind: 'channel', channelId: 'thread-1', guildId: 'guild-1', thread: true }
    assert.notEqual(pool.sessionIdFor(dm), pool.sessionIdFor(channel))
    assert.notEqual(pool.sessionIdFor(channel), pool.sessionIdFor(thread))
    assert.notEqual(pool.sessionIdFor(dm), pool.sessionIdFor(thread))
    await Promise.all([pool.acquire(dm), pool.acquire(channel), pool.acquire(thread)])
    assert.equal(new Set(created).size, 3)
    assert.equal(pool.list().length, 3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('interest pause state is reversible and reports its skip reason', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-interest-'))
  try {
    const config = { interest: { enabled: true, quietHours: '00:00-00:00', minGapMinutes: 20, maxPerHour: 3, channelGapMinutes: 45 } }
    const settings = {
      get(key, fallback) {
        const value = key.split('.').reduce((at, part) => at == null ? undefined : at[part], config)
        return value === undefined ? fallback : value
      },
    }
    const store = new DiscordInterestStore({ workspace: root, settings })
    await store.load()
    assert.equal(store.snapshot().state.off, false)
    await store.setOff(true)
    assert.equal(store.snapshot().state.off, true)
    assert.match(store.snapshot().state.skip, /已手動暫停/)
    await store.setOff(false)
    assert.equal(store.snapshot().state.off, false)
    assert.doesNotMatch(store.snapshot().state.skip, /已手動暫停/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Discord PNG, APNG and GIF stickers are passed to the model as images', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-sticker-'))
  try {
    const downloaded = []
    const stored = []
    const bridge = Object.create(DiscordBridge.prototype)
    bridge.settings = {
      get(key, fallback) { return key === 'discord.maxAttachmentMb' ? 1 : fallback },
      resolve() { return { dataRoot: root } },
    }
    bridge.ctx = {
      get(name) {
        assert.equal(name, 'attachments')
        return {
          storeImage(input) {
            stored.push({ name: input.name, mediaType: input.mediaType, bytes: input.data.length })
            return { ref: { id: 'image-' + stored.length } }
          },
        }
      },
    }
    bridge.rest = {
      async download(url, maxBytes) {
        downloaded.push({ url, maxBytes })
        return {
          buffer: Buffer.from('image-bytes'),
          mediaType: url.endsWith('.gif') ? 'image/gif' : 'image/png',
        }
      },
    }
    bridge.logger = null
    const content = await bridge.buildContent({
      id: 'sticker-message',
      attachments: [],
      sticker_items: [
        { id: '1001', name: 'png-sticker', format_type: 1 },
        { id: '1002', name: 'apng-sticker', format_type: 2 },
        { id: '1003', name: 'gif-sticker', format_type: 4 },
        { id: '1004', name: 'lottie-sticker', format_type: 3 },
      ],
    }, '')
    assert.equal(downloaded.length, 3)
    assert.ok(downloaded.some(x => x.url === 'https://cdn.discordapp.com/stickers/1001.png'))
    assert.ok(downloaded.some(x => x.url === 'https://cdn.discordapp.com/stickers/1002.png'))
    assert.ok(downloaded.some(x => x.url === 'https://media.discordapp.net/stickers/1003.gif'))
    assert.equal(stored.length, 3)
    assert.equal(content.filter(block => block.type === 'image').length, 3)
    assert.ok(content.some(block => block.type === 'text' && /lottie-sticker/.test(block.text)))
    assert.equal(downloaded[0].maxBytes, 1024 * 1024)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('slash commands and model tools inherit Discord actor and Owner permissions', async () => {
  const bridge = Object.create(DiscordBridge.prototype)
  const config = {
    discord: {
      enabled: true, allowDm: true, dmPolicy: 'owner',
      guildIds: ['guild-1'], channelIds: ['channel-1'], mode: 'mention',
    },
  }
  bridge.settings = {
    get(key, fallback) {
      const value = key.split('.').reduce((at, part) => at == null ? undefined : at[part], config)
      return value === undefined ? fallback : value
    },
    isOwner(id) { return String(id) === 'owner-1' },
  }
  assert.equal(bridge.authorizeInteraction({
    user: { id: 'owner-1' }, channel_id: 'dm-1',
  }), '')
  assert.match(bridge.authorizeInteraction({
    user: { id: 'member-1' }, channel_id: 'dm-2',
  }), /私訊政策/)
  assert.equal(bridge.authorizeInteraction({
    member: { user: { id: 'member-2' } }, guild_id: 'guild-1', channel_id: 'channel-1',
  }), '')
  assert.match(bridge.authorizeInteraction({
    member: { user: { id: 'member-2' } }, guild_id: 'guild-2', channel_id: 'channel-1',
  }), /伺服器不在允許清單/)
  assert.match(bridge.authorizeInteraction({
    member: { user: { id: 'member-2' } }, guild_id: 'guild-1', channel_id: 'channel-2',
  }), /頻道不在允許清單/)
  assert.match(bridge.authorizeInteraction({
    member: { user: { id: 'member-2' } }, guild_id: 'guild-1', channel_id: 'channel-1',
  }, { ownerOnly: true }), /僅限 Owner/)
  config.discord.mode = 'own'
  assert.match(bridge.authorizeInteraction({
    member: { user: { id: 'member-2' } }, guild_id: 'guild-1', channel_id: 'channel-1',
  }), /只允許 Owner/)
  assert.equal(bridge.authorizeInteraction({
    member: { user: { id: 'owner-1' } }, guild_id: 'guild-1', channel_id: 'channel-1',
  }), '')

  bridge.actorStorage = new AsyncLocalStorage()
  const ownerActor = { userId: 'owner-1', sessionId: 'session-1', channelId: 'channel-1' }
  const memberActor = { userId: 'member-2', sessionId: 'session-1', channelId: 'channel-1' }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  const [ownerResult, memberResult] = await Promise.all([
    bridge.actorStorage.run(ownerActor, async () => {
      await delay(20)
      return bridge.actorForExecution({ agent: { session: { id: 'session-1' } } }).userId
    }),
    bridge.actorStorage.run(memberActor, async () => {
      await delay(5)
      return bridge.actorForExecution({ agent: { session: { id: 'session-1' } } }).userId
    }),
  ])
  assert.equal(ownerResult, 'owner-1')
  assert.equal(memberResult, 'member-2')
  assert.throws(() => bridge.actorForExecution({ agent: { session: { id: 'session-1' } } }), /目前正在處理 Discord 訊息/)
  assert.throws(() => bridge.actorStorage.run(ownerActor, () =>
    bridge.actorForExecution({ agent: { session: { id: 'another-session' } } })), /目前正在處理 Discord 訊息/)
})

test('slash command dispatcher excludes private DMs from shared interaction events', async () => {
  const { Interactions } = await import('../discord/commands.js')
  const pushed = []
  const callbacks = []
  const interactions = new Interactions({
    rest: {
      async interactionCallback(id, token, payload) { callbacks.push({ id, token, payload }); return {} },
    },
    logger: null,
    events: { push(...args) { pushed.push(args) } },
    eventAllowed: interaction => interaction.guild_id === 'guild-1' && interaction.channel_id === 'channel-1',
  })
  interactions.handle('ask', async () => 'ok')
  await interactions.dispatch({
    id: 'dm-interaction', token: 'token', type: 2,
    user: { id: 'owner-1', username: 'Owner' },
    channel_id: 'dm-channel', data: { name: 'ask', options: [] },
  })
  assert.equal(pushed.length, 0)
  await interactions.dispatch({
    id: 'guild-interaction', token: 'token-2', type: 2,
    guild_id: 'guild-1', channel_id: 'channel-1',
    member: { user: { id: 'member-1', username: 'Member' } },
    data: { name: 'ask', options: [] },
  })
  assert.equal(pushed.length, 1)
  assert.equal(pushed[0][0], 'INTERACTION_CREATE')
  await interactions.dispatch({
    id: 'blocked-guild-interaction', token: 'token-3', type: 2,
    guild_id: 'guild-2', channel_id: 'channel-1',
    member: { user: { id: 'member-2', username: 'OtherGuild' } },
    data: { name: 'ask', options: [] },
  })
  assert.equal(pushed.length, 1, 'blocked guild interactions must not enter shared event history')
  assert.equal(callbacks.length, 3)
})

test('private DM messages and activity never enter the shared event preview', () => {
  const events = []
  const bridge = Object.create(DiscordBridge.prototype)
  bridge.channels = new Map()
  bridge.events = { push(...args) { events.push(args) } }
  bridge.logger = null
  const eventConfig = { discord: { enabled: true, guildIds: ['guild-1'], channelIds: ['public-channel-id'] } }
  bridge.settings = { get(key, fallback) { return key.split('.').reduce((at, part) => at == null ? undefined : at[part], eventConfig) ?? fallback } }

  bridge.recordEvent('MESSAGE_CREATE', {
    id: 'private-message-id', channel_id: 'private-channel-id',
    author: { id: 'private-user-id', username: 'PrivateUser' },
    content: 'highly private message text',
  })
  bridge.recordEvent('MESSAGE_REACTION_ADD', {
    message_id: 'private-message-id', channel_id: 'private-channel-id',
    user_id: 'private-user-id', emoji: { name: '🔒' },
  })
  bridge.recordEvent('TYPING_START', {
    channel_id: 'private-channel-id', user_id: 'private-user-id',
  })
  bridge.recordEvent('INTERACTION_CREATE', {
    id: 'private-interaction-id', user: { id: 'private-user-id', username: 'PrivateUser' },
    data: { name: 'ask' },
  })
  assert.equal(events.length, 0)

  bridge.recordEvent('MESSAGE_CREATE', {
    id: 'public-message-id', guild_id: 'guild-1', channel_id: 'public-channel-id',
    author: { id: 'member-1', username: 'Member' },
    content: 'public channel message',
  })
  assert.equal(events.length, 1)
  assert.match(events[0][1], /public channel message/)

  bridge.recordEvent('MESSAGE_CREATE', {
    id: 'blocked-channel-message', guild_id: 'guild-1', channel_id: 'not-allowed-channel',
    author: { id: 'member-2', username: 'BlockedChannel' }, content: 'blocked channel secret',
  })
  bridge.recordEvent('MESSAGE_CREATE', {
    id: 'blocked-guild-message', guild_id: 'not-allowed-guild', channel_id: 'public-channel-id',
    author: { id: 'member-3', username: 'BlockedGuild' }, content: 'blocked guild secret',
  })
  assert.equal(events.length, 1, 'messages outside configured guild/channel allowlists must not enter shared event history')
  assert.doesNotMatch(JSON.stringify(events), /private-message-id|private-user-id|highly private|blocked-channel-message|blocked-guild-message|blocked channel secret|blocked guild secret/)
})

test('private DMs never train shared interests or write into the shared diary', async () => {
  const createBridge = (target, calls) => {
    const entry = { sessionId: 'session-1', agent: { session: { seq: 0, id: 'session-1' } } }
    const bridge = Object.create(DiscordBridge.prototype)
    bridge.actorStorage = new AsyncLocalStorage()
    bridge.settings = {
      get(key, fallback) {
        if (key === 'discord.typing') return false
        if (key === 'discord.reactions') return false
        if (key === 'brain.journal') return true
        return fallback
      },
    }
    bridge.brain = {
      feedAdd(...args) { calls.feed.push(args) },
      async recallContext() { return '' },
      async writeJournal(line) { calls.journal.push(line) },
    }
    bridge.pool = {
      async acquire() { return entry },
      async touch() {},
    }
    bridge.rest = { async send() {}, async react() {} }
    bridge.describeTarget = async () => target
    bridge.cleanContent = () => 'a private project detail'
    bridge.buildContent = async () => [{ type: 'text', text: 'a private project detail' }]
    bridge.stream = async () => ({ id: 'reply-1', text: 'a private answer' })
    bridge.learnFrom = async (text) => { calls.learned.push(text) }
    bridge.selfId = 'bot-1'
    bridge.logger = null
    return bridge
  }
  const message = {
    id: '1234567890',
    channel_id: 'dm-channel',
    author: { id: 'owner-1', username: 'Owner' },
    content: 'a private project detail',
  }
  const privateCalls = { feed: [], journal: [], learned: [] }
  await createBridge({ kind: 'dm', channelId: 'dm-channel', userId: 'owner-1', label: 'Private DM' }, privateCalls)
    .handle(message, true)
  assert.equal(privateCalls.feed.length, 2, 'the DM event and its reply remain in private-scope conversation memory')
  assert.equal(privateCalls.journal.length, 0, 'private replies never enter the diary injected into all sessions')
  assert.equal(privateCalls.learned.length, 0, 'private text never promotes globally shared public interests')

  const publicCalls = { feed: [], journal: [], learned: [] }
  await createBridge({ kind: 'channel', channelId: 'guild-channel', guildId: 'guild-1', label: '#public' }, publicCalls)
    .handle({ ...message, channel_id: 'guild-channel', guild_id: 'guild-1' }, false)
  assert.equal(publicCalls.journal.length, 1, 'public replies retain diary recording')
  assert.equal(publicCalls.learned.length, 1, 'public text retains interest learning')
})

test('shared memory recalls across guilds and hides private source attribution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-memory-'))
  try {
    await mkdir(path.join(root, 'live'), { recursive: true })
    const config = {
      ownerIds: ['owner-1'],
      memory: {
        enabled: true, shareAcrossChannels: true, shareAcrossGuilds: true,
        sharePrivateToOwner: true, allowPrivateContextInGuild: true,
        maxRecall: 8, maxAgeDays: 365, maxEvents: 1000,
      },
    }
    const settings = {
      home: root,
      get(key, fallback) {
        const value = key.split('.').reduce((at, part) => at == null ? undefined : at[part], config)
        return value === undefined ? fallback : value
      },
      isOwner(id) { return String(id) === 'owner-1' },
    }
    const brain = new DiscordBrain({ workspace: root, settings })
    await brain.load()
    brain.feedAdd('discord-dm-1', { who: 'me', text: '主人提過 RTX 5080 的散熱與風扇曲線。', label: 'Owner DM' }, {
      botId: 'bot-1', messageId: 'dm-msg-1', conversationType: 'dm',
      channelId: 'dm-1', authorId: 'owner-1', authorName: 'owner-secret',
    })
    brain.feedAdd('discord-channel-guild-a-chan-a', { who: 'me', text: '伺服器 A 曾討論 RTX 5080 的功耗。', label: '#hardware' }, {
      botId: 'bot-1', messageId: 'guild-msg-1', conversationType: 'channel',
      guildId: 'guild-a', guildName: 'Server A', channelId: 'chan-a',
      channelName: 'hardware', authorId: 'member-2', authorName: 'member-two',
    })
    await brain.queue
    const ownerPrompt = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-b', guildId: 'guild-b', userId: 'owner-1',
    }, 'discord-channel-guild-b-chan-b')
    assert.match(ownerPrompt, /伺服器 A/)
    assert.match(ownerPrompt, /RTX 5080/)
    assert.match(ownerPrompt, /私人背景（來源隱去）/)
    assert.doesNotMatch(ownerPrompt, /Discord 私訊/)
    assert.doesNotMatch(ownerPrompt, /owner-secret/)

    // Other members may recall public cross-guild events, but never Owner DM context.
    const memberPrompt = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-b', guildId: 'guild-b', userId: 'member-3',
    }, 'discord-channel-guild-b-chan-b')
    assert.match(memberPrompt, /伺服器 A/)
    assert.doesNotMatch(memberPrompt, /主人背景：/)
    assert.doesNotMatch(memberPrompt, /主人提過 RTX 5080/)
    assert.doesNotMatch(memberPrompt, /owner-secret/)

    config.memory.allowPrivateContextInGuild = false
    const noPrivate = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-b', guildId: 'guild-b', userId: 'owner-1',
    }, 'discord-channel-guild-b-chan-b')
    assert.doesNotMatch(noPrivate, /主人提過 RTX 5080/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('settings never return legacy plaintext tokens and reject paths outside workspace', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-settings-'))
  try {
    const settings = new SettingsStore({
      workspace: root,
      discord: { token: 'legacy-secret-token', botToken: 'legacy-bot-secret' },
    }, { home: root })
    const publicConfig = settings.publicConfig()
    assert.equal(publicConfig.discord.tokenConfigured, false)
    assert.doesNotMatch(JSON.stringify(publicConfig), /legacy-secret-token|legacy-bot-secret/)
    await assert.rejects(settings.patch({ personaFiles: ['../outside.md'] }), /相對路徑/)
    const diarySettings = new SettingsStore({ workspace: root }, { home: root })
    await assert.rejects(diarySettings.patch({ diaryDir: '../outside' }), /相對路徑/)
    assert.equal(isDiaryFilename('2026-11-18.md'), true)
    assert.equal(isDiaryFilename('2026-13-40.md'), false)
    assert.equal(isDiaryPath('diary/2026-11-18.md', 'diary'), true)
    assert.equal(isDiaryPath('diary/../2026-11-18.md', 'diary'), false)
    assert.equal(isDiaryPath('../diary/2026-11-18.md', 'diary'), false)
    assert.equal(isDiaryPath('diary/sub/2026-11-18.md', 'diary'), false)
    assert.equal(isDiaryFilename('notes.md'), false)

    const legacyHome = path.join(root, 'legacy')
    await mkdir(legacyHome, { recursive: true })
    const oldSettingsFile = path.join(legacyHome, 'hers-life.json')
    await writeFile(oldSettingsFile, JSON.stringify({ discord: { token: 'legacy-migrated-token' } }), 'utf8')
    const migrated = new SettingsStore({}, { home: legacyHome })
    await migrated.load()
    assert.equal(migrated.hasToken(), true)
    assert.doesNotMatch(await readFile(oldSettingsFile, 'utf8'), /legacy-migrated-token/)
    assert.match(await readFile(path.join(legacyHome, 'hers-life-secrets.json'), 'utf8'), /legacy-migrated-token/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Discord memory model and graph retain guild, channel, thread and author provenance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-provenance-'))
  try {
    const file = path.join(root, 'live', 'discord-memory.jsonl')
    await mkdir(path.dirname(file), { recursive: true })
    const event = {
      id: 'event-1', at: '2026-11-18T00:00:00.000Z', platform: 'discord',
      messageId: 'message-1', sessionId: 'discord-thread-guild-1-thread-1',
      role: 'user', text: 'Thread 裡提到跨伺服器共同記憶。',
      guildId: 'guild-1', guildName: 'Lab',
      channelId: 'thread-1', channelName: 'project-chat', threadId: 'thread-1',
      conversationType: 'thread', authorId: 'user-1', authorName: 'tester',
      scope: 'guild',
    }
    await writeFile(file, JSON.stringify(event) + '\n', 'utf8')
    const modelRows = await readDiscord({ workspace: root, discordMemoryFile: file })
    assert.equal(modelRows.length, 1)
    assert.equal(modelRows[0].side, 'discord')
    assert.equal(modelRows[0].subjectId, 'user-1')
    assert.match(modelRows[0].roomLabel, /Lab.*#project-chat.*Thread thread-1/)
    const neuronRows = await readDiscordEvents(file)
    assert.equal(neuronRows.length, 1)
    assert.equal(neuronRows[0].guildId, 'guild-1')
    assert.equal(neuronRows[0].guildName, 'Lab')
    assert.equal(neuronRows[0].channelId, 'thread-1')
    assert.equal(neuronRows[0].channelName, 'project-chat')
    assert.equal(neuronRows[0].authorId, 'user-1')
    assert.equal(neuronRows[0].messageId, 'message-1')
    assert.equal(neuronRows[0].threadId, 'thread-1')
    assert.equal(neuronRows[0].subjectName, 'tester')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Discord memory ledger deduplicates and compacts to the configured event limit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-compact-'))
  try {
    await mkdir(path.join(root, 'live'), { recursive: true })
    const file = path.join(root, 'live', 'discord-memory.jsonl')
    const rows = []
    for (let i = 0; i < 1002; i += 1) {
      rows.push({
        id: 'event-' + i, at: new Date(Date.now() - (1002 - i) * 1000).toISOString(),
        botId: 'bot', channelId: 'channel', messageId: 'message-' + i,
        role: 'user', text: 'provenance item ' + i,
      })
    }
    // Same Discord message key: newest entry wins.
    rows.push({ ...rows[1001], id: 'event-duplicate', text: 'latest duplicate revision' })
    await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
    const config = { memory: { maxEvents: 1000 } }
    const settings = { home: root, get(key, fallback) {
      const value = key.split('.').reduce((at, part) => at == null ? undefined : at[part], config)
      return value === undefined ? fallback : value
    } }
    const brain = new DiscordBrain({ workspace: root, settings })
    await brain.load()
    await brain.queue
    assert.equal(brain.events.length, 1000)
    const persisted = (await readFile(file, 'utf8')).trim().split(/\r?\n/)
    assert.equal(persisted.length, 1000)
    assert.ok(persisted.some((line) => JSON.parse(line).text === 'latest duplicate revision'))
    assert.ok(!persisted.some((line) => JSON.parse(line).messageId === 'message-0'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('Discord plugin activation registers DSH-valid tools and provides the service required by memory', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hers-life-plugin-home-'))
  const workspace = path.join(home, 'workspace')
  const oldHome = process.env.HOME
  const oldUserProfile = process.env.USERPROFILE
  process.env.HOME = home
  if (process.platform === 'win32') process.env.USERPROFILE = home
  t.after(async () => {
    if (oldHome === undefined) delete process.env.HOME
    else process.env.HOME = oldHome
    if (oldUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = oldUserProfile
    await rm(home, { recursive: true, force: true })
  })

  const services = new Map()
  const definitions = []
  const namedLoggers = []
  const makeLogger = name => {
    namedLoggers.push(name)
    return { name, debug() {}, info() {}, warn() {}, error() {} }
  }
  const logger = name => makeLogger(name)
  for (const method of ['debug', 'info', 'warn', 'error']) {
    Object.defineProperty(logger, method, { value() {}, configurable: true })
  }
  const listeners = new Map()
  const ctx = {
    logger,
    tools: {
      register(definition) {
        assert.ok(definition.output && definition.output.schema, `${definition.name} must declare canonical output`)
        assert.equal(typeof definition.output.render, 'function', `${definition.name} must render canonical output`)
        assert.equal(definition.output.schema.type, 'string')
        definitions.push(definition)
        return () => {}
      },
    },
    inject() { return () => {} },
    provide(name, value) {
      services.set(name, value)
      return () => services.delete(name)
    },
    get hersLifeDiscord() { return services.get('hersLifeDiscord') },
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
  }

  applyDiscord(ctx, { enabled: false, workspace })
  assert.deepEqual(definitions.map(item => item.name), ['discord_send_to_owner', 'discord_send_file'])
  assert.ok(namedLoggers.includes('hers-life-discord'))
  const discordService = services.get('hersLifeDiscord')
  assert.ok(discordService, 'Discord must publish hersLifeDiscord before dependent plugins load')
  assert.equal(discordService.workspace, workspace)

  const marker = path.join(workspace, 'diary', 'README.md')
  const deadline = Date.now() + 5000
  let workspaceReady = false
  while (Date.now() < deadline) {
    try { await readFile(marker, 'utf8'); workspaceReady = true; break } catch {}
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(workspaceReady, true, 'Discord workspace initialization should complete without a token')

  await writeFile(path.join(workspace, 'persona', '人设.md'), '# 測試人設\\nSERVICE-WORKSPACE-MARKER\\n', 'utf8')
  assert.deepEqual(memoryInject, ['hersLifeDiscord'])
  assert.equal(typeof memoryInternals.stamp, 'function', 'memory timestamp formatter must be defined at module load')
  applyMemory(ctx, {})
  const onCreated = listeners.get('agent/created')
  assert.equal(typeof onCreated, 'function', 'memory should activate after the Discord service is provided')

  const sections = []
  const agent = {
    id: 'hers-life-test-agent',
    session: { id: 'discord-dm-test', header: { cwd: workspace } },
    ctx: {
      systemPrompt: {
        section(definition) { sections.push(definition); return () => {} },
        context(definition) { sections.push({ ...definition, kind: 'context' }); return () => {} },
      },
    },
  }
  await onCreated({ agent })
  const opening = sections.find(section => section.name === 'ming:opening')
  assert.ok(opening, 'memory should attach its opening section to an agent in the Discord workspace')
  assert.ok(opening.text().includes('SERVICE-WORKSPACE-MARKER'), 'memory should resolve its root from hersLifeDiscord.workspace')
  listeners.get('agent/disposed')?.({ agent })
})
