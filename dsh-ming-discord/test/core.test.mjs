import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { SettingsStore } from '../settings.js'
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
