import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { readDiscord } from '../../dsh-ming-memory/lib/model.mjs'
import { readDiscordEvents } from '../../dsh-ming-memory/lib/neuron.mjs'
import { SettingsStore, isDiaryFilename, isDiaryPath } from '../settings.js'
import { DiscordSessionPool } from '../pool.js'
import { DiscordBrain } from '../memory.js'

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
    assert.doesNotMatch(memberPrompt, /私人背景/)
    assert.doesNotMatch(memberPrompt, /主人提過 RTX 5080/)

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
