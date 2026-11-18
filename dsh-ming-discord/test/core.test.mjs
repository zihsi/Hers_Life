import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, mkdir, readdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { readDiscord } from '../../dsh-ming-memory/lib/model.mjs'
import { readDiscordEvents } from '../../dsh-ming-memory/lib/neuron.mjs'
import { SettingsStore, isDiaryFilename, isDiaryPath } from '../settings.js'
import { DiscordSessionPool } from '../pool.js'
import { DiscordBrain } from '../memory.js'
import { DiscordInterestStore } from '../interests.js'
import { quarantinePrivateDmDiary } from '../privacy.js'
import { DiscordBridge } from '../discord/bridge.js'
import { DaveSession } from '../discord/dave.js'
import { VoiceConnection, VoiceManager } from '../discord/voice.js'
import { apply as applyDiscord, ensureWorkspace, syncBrowseSettings, syncMemorySettings } from '../index.js'
import { apply as applyMemory, inject as memoryInject, __internals as memoryInternals } from '../../dsh-ming-memory/index.js'
import { apply as applyVoice } from '../../dsh-ming-voice/index.js'
import { getEmbeddingConfig } from '../../dsh-ming-core-memory/lib/rag.js'

test('Core Memory embedding endpoint and model come from the Hers Life settings UI', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-embedding-settings-'))
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = root
    const settings = new SettingsStore({ workspace: path.join(root, 'workspace') }, { home: root })
    await settings.patch({ coreMemory: {
      embeddingEndpoint: 'http://127.0.0.1:19091/v1/embeddings',
      embeddingModel: 'bge-custom-v2',
    } })
    assert.deepEqual(getEmbeddingConfig(), {
      endpoint: 'http://127.0.0.1:19091/v1/embeddings',
      model: 'bge-custom-v2',
    })

    await settings.patch({ coreMemory: {
      embeddingEndpoint: 'file:///etc/passwd',
      embeddingModel: 'bge-custom-v2',
    } })
    assert.deepEqual(getEmbeddingConfig(), {
      endpoint: 'http://127.0.0.1:18091/v1/embeddings',
      model: 'bge-custom-v2',
    })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('Persona and diary UI paths are synchronized to the Memory plugin config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-memory-settings-'))
  try {
    const settings = new SettingsStore({
      workspace: root,
      personaFiles: ['persona/custom/voice.md'],
      diaryDir: 'records/journal',
      diaryCount: 5,
      diaryChars: 9000,
      maxChars: 15000,
    }, { home: path.join(root, '.dsh') })
    await syncMemorySettings(settings)
    const file = path.join(settings.home, 'ming-memory.json')
    const first = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(first.root, root)
    assert.deepEqual(first.personaFiles, ['persona/custom/voice.md'])
    assert.equal(first.diaryDir, 'records/journal')
    assert.equal(first.diaryCount, 5)
    assert.equal(first.diaryChars, 9000)
    assert.equal(first.maxChars, 15000)

    settings.patch({ diaryDir: 'records/new-journal' })
    await syncMemorySettings(settings)
    const second = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(second.diaryDir, 'records/new-journal')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Discord package contains the DSH startup patch declared by its manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = String(manifest.dsh?.bundle?.patch || '').replace(/^\.\//, '')
  assert.ok(patch, 'the Discord package must declare its DSH bundle patch')
  assert.ok(manifest.files.includes(patch), 'npm package files whitelist must include the DSH patch')
  assert.ok((await readFile(new URL('../' + patch, import.meta.url), 'utf8')).length > 0)
})

test('Browse settings UI values are fully synchronized to the live runtime config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-browse-settings-'))
  try {
    const settings = new SettingsStore({ workspace: root }, { home: path.join(root, '.dsh') })
    await settings.patch({
      browse: {
        enabled: true,
        idleMinutes: 7,
        minGapMinutes: 12,
        dailyMax: 9,
        sessionRounds: 17,
        allowSocialWrites: true,
        freeWindows: [{ start: '18:00', end: '23:00' }],
        agentPreset: 'browse-agent',
        adbPath: 'C:\\tools\\adb.exe',
        serial: '127.0.0.1:16448',
        targets: ['bilibili'],
        socialApps: ['com.example.social'],
        socialWriteWords: ['發布'],
      },
    })
    await syncBrowseSettings(settings)
    const file = path.join(root, 'live', 'browse-config.json')
    const first = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(first.idleMinutes, 7)
    assert.equal(first.allowSocialWrites, true)
    assert.equal(first.agentPreset, 'browse-agent')
    assert.equal(first.adbPath, 'C:\\tools\\adb.exe')
    assert.deepEqual(first.freeWindows, [{ start: '18:00', end: '23:00' }])
    assert.deepEqual(first.targets, ['bilibili'])

    await settings.patch({ browse: { idleMinutes: 11, allowSocialWrites: false } })
    await syncBrowseSettings(settings)
    const second = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(second.idleMinutes, 11)
    assert.equal(second.allowSocialWrites, false)
    assert.equal(second.adbPath, 'C:\\tools\\adb.exe')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace initialization creates custom persona files and diary folders automatically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-custom-workspace-'))
  try {
    const customPersona = path.join(root, 'persona', 'custom', 'voice.md')
    const result = await ensureWorkspace(root, {
      personaFiles: ['persona/custom/voice.md'],
      diaryDir: 'records/private-diary',
    })
    const persona = await readFile(customPersona, 'utf8')
    const diaryReadme = await readFile(path.join(root, 'records', 'private-diary', 'README.md'), 'utf8')
    assert.match(persona, /^# voice/m)
    assert.match(diaryReadme, /按日期自動建立/)
    assert.ok(result.created.includes('persona/custom/voice.md'))
    assert.ok(result.created.includes('records/private-diary/README.md'))

    await writeFile(customPersona, '# Existing custom persona\\nDo not overwrite.\\n', 'utf8')
    await ensureWorkspace(root, {
      personaFiles: ['persona/custom/voice.md'],
      diaryDir: 'records/private-diary',
    })
    assert.equal(await readFile(customPersona, 'utf8'), '# Existing custom persona\\nDo not overwrite.\\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workspace initialization rejects persona paths that escape through directory symlinks', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-workspace-link-'))
  const outside = await mkdtemp(path.join(os.tmpdir(), 'hers-life-outside-'))
  try {
    const link = path.join(root, 'persona', 'external')
    await mkdir(path.dirname(link), { recursive: true })
    try {
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t.skip('this runner does not permit directory symlinks')
        return
      }
      throw error
    }
    await assert.rejects(
      ensureWorkspace(root, { personaFiles: ['persona/external/secret.md'] }),
      /符號連結離開工作區/,
    )
    await assert.rejects(
      readFile(path.join(outside, 'secret.md'), 'utf8'),
      { code: 'ENOENT' },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('the selected core-memory directory is shared by Discord notes and Graph config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-core-memory-dir-'))
  try {
    const home = path.join(root, '.dsh')
    const settings = new SettingsStore({
      workspace: path.join(root, 'workspace'),
      coreMemory: { directory: 'vault/shared-memory' },
    }, { home })
    await settings.load()
    const expected = path.join(home, 'vault', 'shared-memory')
    assert.equal(settings.resolve().coreMemoryDir, expected)
    const brain = new DiscordBrain({ workspace: settings.resolve().workspace, settings, logger: null })
    await brain.writeNote({ title: '共同記憶路徑測試', body: '這條筆記必須放在自訂核心記憶資料夾。' })
    const files = await readdir(path.join(expected, 'notes'))
    assert.equal(files.length, 1)
    assert.match(await readFile(path.join(expected, 'notes', files[0]), 'utf8'), /自訂核心記憶資料夾/)
    await assert.rejects(readdir(path.join(home, 'memory', 'notes')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Discord journal writes respect the configured diary folder', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-journal-'))
  try {
    const settings = { get(key, fallback) { return key === 'diaryDir' ? 'custom-notes/daily' : fallback } }
    const brain = new DiscordBrain({ workspace: root, settings, logger: null })
    await brain.writeJournal('public reply')
    const date = new Date().toISOString().slice(0, 10)
    const written = await readFile(path.join(root, 'custom-notes', 'daily', date + '.md'), 'utf8')
    assert.match(written, /public reply/)
    await assert.rejects(readFile(path.join(root, 'diary', date + '.md'), 'utf8'), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('voice plugin uses official DSH Agent id and the latest shared workspace/TTS settings', async () => {
  let currentWorkspace = path.join(os.tmpdir(), 'hers-life-voice-old')
  let route
  let registeredTool
  const cfg = { root: path.join(os.tmpdir(), 'hers-life-voice-default') }
  const ctx = {
    hersLifeDiscord: {
      get workspace() { return currentWorkspace },
      actorForExecution(exec) {
        return { userId: 'owner-1', sessionId: exec.agent.id, channelId: 'channel-1' }
      },
      getSetting(key, fallback) {
        if (key === 'voice.ttsVoice') return 'zh-TW-HsiaoChenNeural'
        if (key === 'voice.ttsRate') return '+12%'
        if (key === 'voice.ffmpeg') return 'C:/tools/ffmpeg.exe'
        return fallback
      },
    },
    tools: { register(tool) { registeredTool = tool } },
    inject(_deps, callback) {
      callback({
        effect(fn) { fn() },
        webServer: { register(value) { route = value } },
      })
    },
  }
  applyVoice(ctx, cfg)
  assert.ok(registeredTool)
  assert.equal(await registeredTool.execute({ text: '   ' }, { agent: { id: 'session-voice' } }), 'text 是空的，没东西可合成。')

  currentWorkspace = path.join(os.tmpdir(), 'hers-life-voice-new')
  const response = {
    status: 0, headers: null, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
  await route.handler({ url: '/_dsh/dsh-ming-voice/state' }, response)
  assert.equal(response.status, 200)
  const payload = JSON.parse(response.body)
  assert.equal(payload.dir, path.join(currentWorkspace, 'live', 'voice'))
  assert.equal(payload.voice, 'zh-TW-HsiaoChenNeural')
  assert.equal(payload.rate, '+12%')
})

test('legacy private DM diary entries are quarantined before shared memory reads them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-privacy-'))
  const workspace = path.join(root, 'workspace')
  const privateHome = path.join(root, '.dsh')
  const diary = path.join(workspace, 'custom-notes', 'daily')
  await mkdir(diary, { recursive: true })
  try {
    const file = path.join(diary, '2026-11-18.md')
    await writeFile(file, [
      '- 2026-11-18T01:00:00.000Z 私聊 Alice — private secret line',
      'private continuation that must move with the DM entry',
      '- 2026-11-18T02:00:00.000Z #general @ Server — public journal line',
      '- 2026-11-18T03:00:00.000Z 私聊 Bob — another private secret',
      'second private continuation',
      '',
    ].join('\n'), 'utf8')

    const result = await quarantinePrivateDmDiary(workspace, privateHome, path.join('custom-notes', 'daily'))
    assert.equal(result.filesChanged, 1)
    assert.equal(result.entriesMoved, 2)

    const cleaned = await readFile(file, 'utf8')
    assert.match(cleaned, /public journal line/)
    assert.doesNotMatch(cleaned, /private secret|private continuation|another private/)

    const archiveFiles = await (await import('node:fs/promises')).readdir(result.archiveDir)
    assert.equal(archiveFiles.length, 1)
    const archive = await readFile(path.join(result.archiveDir, archiveFiles[0]), 'utf8')
    assert.match(archive, /private secret line/)
    assert.match(archive, /private continuation that must move/)
    assert.match(archive, /another private secret/)
    assert.match(archive, /second private continuation/)

    const repeated = await quarantinePrivateDmDiary(workspace, privateHome, path.join('custom-notes', 'daily'))
    assert.equal(repeated.entriesMoved, 0)
    assert.equal(repeated.alreadyDone, true)
    await assert.rejects(
      quarantinePrivateDmDiary(workspace, privateHome, '../outside'),
      /escapes workspace/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('private diary quarantine never marks completion after an incomplete scan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-privacy-failure-'))
  const workspace = path.join(root, 'workspace')
  const privateHome = path.join(root, '.dsh')
  const diary = path.join(workspace, 'diary')
  await mkdir(path.join(diary, '2026-11-18.md'), { recursive: true })
  try {
    await assert.rejects(quarantinePrivateDmDiary(workspace, privateHome), /EISDIR|illegal operation/i)
    await assert.rejects(readdir(path.join(privateHome, 'privacy-quarantine')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('private diary quarantine propagates directory scan errors instead of marking done', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-privacy-scan-'))
  const workspace = path.join(root, 'workspace')
  const privateHome = path.join(root, '.dsh')
  await mkdir(workspace, { recursive: true })
  await writeFile(path.join(workspace, 'diary'), 'not a directory', 'utf8')
  try {
    await assert.rejects(quarantinePrivateDmDiary(workspace, privateHome), { code: 'ENOTDIR' })
    await assert.rejects(readdir(path.join(privateHome, 'privacy-quarantine')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('SettingsStore migrates the old Memory workspace and persona/diary settings without overriding Hers Life choices', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-legacy-settings-'))
  try {
    const oldWorkspace = path.join(root, 'old-workspace')
    const dshHome = path.join(root, '.dsh')
    await mkdir(dshHome, { recursive: true })
    await writeFile(path.join(dshHome, 'ming-memory.json'), JSON.stringify({
      root: oldWorkspace,
      personaFiles: ['persona/legacy-voice.md'],
      diaryDir: 'records/old-diary',
      diaryCount: 7,
      diaryChars: 6500,
      maxChars: 14000,
    }), 'utf8')
    const migrated = new SettingsStore({}, { home: dshHome })
    assert.equal(migrated.resolve().workspace, oldWorkspace)
    assert.deepEqual(migrated.get('personaFiles'), ['persona/legacy-voice.md'])
    assert.equal(migrated.get('diaryDir'), 'records/old-diary')
    assert.equal(migrated.get('diaryCount'), 7)
    await migrated.load()
    const persisted = JSON.parse(await readFile(path.join(dshHome, 'hers-life.json'), 'utf8'))
    assert.equal(persisted.workspace, oldWorkspace)
    assert.deepEqual(persisted.personaFiles, ['persona/legacy-voice.md'])
    assert.equal(persisted.diaryDir, 'records/old-diary')

    const selectedWorkspace = path.join(root, 'selected-workspace')
    await writeFile(path.join(dshHome, 'hers-life.json'), JSON.stringify({
      workspace: selectedWorkspace,
      personaFiles: ['persona/selected.md'],
    }), 'utf8')
    const selected = new SettingsStore({}, { home: dshHome })
    assert.equal(selected.resolve().workspace, selectedWorkspace)
    assert.deepEqual(selected.get('personaFiles'), ['persona/selected.md'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Discord settings store follows the host-provided DSH_HOME directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-dsh-home-'))
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = root
    const settings = new SettingsStore({})
    assert.equal(settings.home, path.resolve(root))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('DM, guild channels and threads keep separate sessions but mount the same DSH Agent preset', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-pool-'))
  try {
    const settings = new SettingsStore({ workspace: root, agentPreset: 'shared-hers-life-preset' }, { home: root })
    await settings.load()
    const created = []
    const ctx = {
      get(name) {
        if (name === 'agentPresets') return {
          async mount(agentCtx, preset) { agentCtx.mountedPreset = preset },
        }
        return undefined
      },
      agents: {
        get() { return undefined },
        async create({ sessionId, meta, setup }) {
          const agentCtx = {}
          await setup?.(agentCtx)
          const agent = { id: sessionId, session: { id: sessionId }, status: 'idle' }
          created.push({ sessionId, preset: agentCtx.mountedPreset, meta })
          return { agent }
        },
        async resume() { throw new Error('no stored session') },
      },
    }
    const pool = new DiscordSessionPool({ ctx, settings })
    await pool.load()
    const dm = { kind: 'dm', channelId: 'dm-100', userId: 'owner-1' }
    const channelOne = { kind: 'channel', channelId: 'chan-1', guildId: 'guild-1' }
    const channelTwo = { kind: 'channel', channelId: 'chan-2', guildId: 'guild-1' }
    const thread = { kind: 'channel', channelId: 'thread-1', guildId: 'guild-1', thread: true }
    const targets = [dm, channelOne, channelTwo, thread]
    const sessionIds = targets.map((target) => pool.sessionIdFor(target))
    assert.equal(new Set(sessionIds).size, targets.length)
    await Promise.all(targets.map((target) => pool.acquire(target)))
    assert.equal(new Set(created.map((item) => item.sessionId)).size, targets.length)
    assert.equal(pool.list().length, targets.length)
    assert.ok(created.every((item) => item.preset === 'shared-hers-life-preset'), 'every independent session must mount the same Agent preset')
    assert.ok(created.every((item) => item.meta.hersLife.platform === 'discord'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('Discord turns serialize per channel while different sessions remain concurrent', async () => {
  const bridge = new DiscordBridge({ ctx: {}, settings: {}, rest: {}, gateway: null, events: {} })
  let activeA = 0
  let maxA = 0
  let activeAll = 0
  let maxAll = 0
  const order = []
  const job = (channel, label) => bridge.enqueueSession(channel, async () => {
    if (channel === 'channel-a') {
      activeA += 1
      maxA = Math.max(maxA, activeA)
    }
    activeAll += 1
    maxAll = Math.max(maxAll, activeAll)
    order.push(label + ':start')
    await new Promise((resolve) => setTimeout(resolve, 25))
    order.push(label + ':end')
    activeAll -= 1
    if (channel === 'channel-a') activeA -= 1
  })

  await Promise.all([
    job('channel-a', 'a1'),
    job('channel-a', 'a2'),
    job('channel-b', 'b1'),
  ])
  assert.equal(maxA, 1, 'one Session must never run two Discord turns at once')
  assert.ok(maxAll >= 2, 'different Sessions should still run in parallel')
  assert.ok(order.indexOf('a1:end') < order.indexOf('a2:start'), 'same-channel turns must preserve arrival order')
  assert.equal(bridge.sessionQueues.size, 0, 'completed queue entries should be released')
})


test('cross-guild memory follows the same Owner without exposing other members or Owners', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-shared-memory-'))
  try {
    const values = {
      'memory.enabled': true,
      'memory.shareAcrossChannels': true,
      'memory.shareAcrossGuilds': true,
      'memory.sharePrivateToOwner': true,
      'memory.allowPrivateContextInGuild': true,
      'memory.maxRecall': 12,
      'memory.maxAgeDays': 365,
      'memory.maxEvents': 20000,
      'diaryDir': 'diary',
    }
    const settings = {
      home: path.join(root, '.dsh'),
      get(key, fallback) { return Object.hasOwn(values, key) ? values[key] : fallback },
      isOwner(userId) { return String(userId) === 'owner-1' },
    }
    const brain = new DiscordBrain({ workspace: root, settings, logger: null })
    await brain.load()
    const ownerOrigin = {
      botId: 'bot-1', messageId: 'm-owner', guildId: 'guild-1', guildName: 'Group One',
      channelId: 'channel-1', channelName: 'general', conversationType: 'channel',
      authorId: 'owner-1', authorName: 'Owner',
    }
    brain.feedAdd('session-guild-one', { label: '#general @ Group One', who: 'me', text: '星河專案的進度是 42。', kind: 'channel' }, ownerOrigin)
    brain.feedAdd('session-guild-one', { label: '#general @ Group One', who: 'her', text: '我會記得星河專案的進度。', kind: 'channel' }, {
      ...ownerOrigin, messageId: 'reply-1', authorId: 'bot-1', authorName: 'Hers Life',
      participantId: 'owner-1', participantName: 'Owner',
    })
    brain.feedAdd('session-guild-one', { label: '#general @ Group One', who: 'me', text: '另一位成員的私人議題。', kind: 'channel' }, {
      ...ownerOrigin, messageId: 'm-member', authorId: 'member-2', authorName: 'Member Two',
    })
    brain.feedAdd('session-guild-one-channel-two', { label: '#dev @ Group One', who: 'me', text: '同伺服器跨頻道的藍圖 B。', kind: 'channel' }, {
      ...ownerOrigin, messageId: 'm-owner-channel-two', channelId: 'channel-2', channelName: 'dev',
    })
    brain.feedAdd('session-guild-two', { label: '#general @ Group Two', who: 'me', text: '另一個伺服器的海風計畫 C。', kind: 'channel' }, {
      ...ownerOrigin, messageId: 'm-owner-guild-two', guildId: 'guild-2', guildName: 'Group Two',
      channelId: 'channel-22', channelName: 'general',
    })
    brain.feedAdd('session-dm-owner', { label: '私訊 Owner', who: 'me', text: '私訊中提到的藍色計畫。', kind: 'dm' }, {
      botId: 'bot-1', messageId: 'dm-1', channelId: 'dm-channel', channelName: 'Owner DM',
      conversationType: 'dm', authorId: 'owner-1', authorName: 'Owner',
    })
    await brain.queue

    const ownerInGroupTwo = { kind: 'channel', channelId: 'channel-2', guildId: 'guild-2', userId: 'owner-1' }
    const ownerInGroupOneOtherChannel = { kind: 'channel', channelId: 'channel-3', guildId: 'guild-1', userId: 'owner-1' }
    const ownerInGroupOne = { kind: 'channel', channelId: 'channel-1', guildId: 'guild-1', userId: 'owner-1' }
    const memberInGroupTwo = { kind: 'channel', channelId: 'channel-2', guildId: 'guild-2', userId: 'member-2' }
    const ownerDm = { kind: 'dm', channelId: 'dm-two', userId: 'owner-1' }
    const sameGuildCross = await brain.recallContext('星河專案', ownerInGroupOneOtherChannel, 'session-guild-one-channel-three')
    assert.match(sameGuildCross, /Group One \/ #general/, 'channel one must be remembered in channel two')
    const sameGuildReverse = await brain.recallContext('藍圖 B', ownerInGroupOne, 'session-guild-one')
    assert.match(sameGuildReverse, /Group One \/ #dev/, 'channel two must be remembered in channel one')
    const ownerCross = await brain.recallContext('星河專案', ownerInGroupTwo, 'session-guild-two')
    assert.match(ownerCross, /Group One \/ #general/)
    assert.match(ownerCross, /星河專案/)
    assert.equal(await brain.recallContext('星河專案', memberInGroupTwo, 'session-member-two'), '')
    const ownerContinuity = await brain.recallContext('私人議題', ownerInGroupTwo, 'session-guild-two')
    assert.doesNotMatch(ownerContinuity, /另一位成員的私人議題/, 'recent continuity must never import another member\'s message')
    const guildMemoryInDm = await brain.recallContext('星河專案', ownerDm, 'session-owner-dm-two')
    assert.match(guildMemoryInDm, /Group One \/ #general/)
    assert.match(guildMemoryInDm, /Discord 私訊 \/ Owner DM/, 'DM recall must retain the destination conversation label')
    const reverseCrossGuild = await brain.recallContext('海風計畫', ownerInGroupOne, 'session-guild-one')
    assert.match(reverseCrossGuild, /Group Two \/ #general/, 'Group Two must be remembered in Group One')

    const privateInOwnerGuild = await brain.recallContext('藍色計畫', ownerInGroupTwo, 'session-guild-two')
    assert.match(privateInOwnerGuild, /Owner 私訊背景（不得公開）/)
    assert.match(privateInOwnerGuild, /不得對頻道使用者透露/)
    assert.equal(await brain.recallContext('藍色計畫', memberInGroupTwo, 'session-member-two'), '')
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

test('DAVE protocol zero is rejected and never enables plaintext passthrough', () => {
  const dave = Object.create(DaveSession.prototype)
  let nativeExecute = 0
  let passthrough = 0
  dave.logger = null
  dave.userId = 'bot-1'
  dave.channelId = 'voice-1'
  dave.protocolVersion = 1
  dave.degraded = false
  dave.pendingTransitions = new Map([[9, 0]])
  dave.session = {
    executeTransition() { nativeExecute += 1; return true },
    setPassthroughMode() { passthrough += 1 },
  }
  assert.throws(() => dave.reinit(0), /protocol version 0.*plaintext voice fallback is disabled/)
  assert.throws(() => dave.prepareTransition({ transition_id: 10, protocol_version: 0 }), /protocol version 0/)
  assert.throws(() => dave.executeTransition(9), /protocol version 0.*unencrypted voice fallback/)
  assert.equal(dave.protocolVersion, 1)
  assert.equal(nativeExecute, 0, 'native MLS state must not be switched into an unencrypted mode')
  assert.equal(passthrough, 0, 'DAVE passthrough must never be activated')

  dave.reinit = version => {
    if (version <= 0) throw new Error('DAVE protocol version 0 would disable end-to-end encryption')
  }
  assert.throws(() => dave.prepareEpoch({ epoch: 1, protocol_version: 0 }), /protocol version 0/)
})

test('DAVE never passes Opus through while inactive or after an encryption error', () => {
  const dave = Object.create(DaveSession.prototype)
  dave.protocolVersion = 1
  dave.session = { ready: false }
  dave.logger = null
  const opus = Buffer.from([1, 2, 3, 4])
  assert.equal(dave.encrypt(opus), null, 'pre-MLS outbound Opus must be dropped')
  assert.equal(dave.decrypt('speaker-1', opus), null, 'pre-MLS inbound Opus must be dropped')

  dave.session = {
    ready: true,
    encryptOpus() { throw new Error('native encrypt failed') },
  }
  assert.equal(dave.encrypt(opus), null, 'native encryption failure must not return plaintext')

  let sent = 0
  const connection = Object.create(VoiceConnection.prototype)
  connection.dave = dave
  connection.udp = { send() { sent += 1 } }
  connection.remote = { address: '127.0.0.1', port: 9000 }
  assert.equal(connection.buildRtpPacket(opus), null)
  assert.equal(connection.sendFrame(opus), false)
  assert.equal(sent, 0, 'no RTP datagram may be sent without a DAVE ciphertext')
})

test('voice Session Description without a positive DAVE version fails the connection', () => {
  let left = 0
  let rejected = null
  const connection = new VoiceConnection({
    gateway: { leaveVoice() { left += 1 } },
    rest: {},
    logger: null,
    guildId: 'guild-1',
    channelId: 'voice-1',
    userId: 'bot-1',
  })
  connection.on('error', () => {})
  connection.readyReject = error => { rejected = error }
  connection.onSessionDescription({ secret_key: [], dave_protocol_version: 0 })
  assert.equal(connection.state, 'failed')
  assert.match(rejected?.message ?? '', /did not negotiate DAVE E2EE/)
  assert.equal(left, 1, 'failed E2EE negotiation must leave the Discord voice gateway')
})

test('voice join waits for DAVE readiness and playback refuses inactive E2EE', async () => {
  const connection = new VoiceConnection({
    gateway: { leaveVoice() {} }, rest: {}, logger: null,
    guildId: 'guild-ready', channelId: 'voice-ready', userId: 'bot-ready',
  })
  connection.state = 'ready'
  connection.dave = { active: false }
  const waiting = connection.waitForDAVE(500)
  setTimeout(() => {
    connection.dave.active = true
    connection.markDAVEReady()
  }, 5)
  assert.equal(await waiting, connection)
  assert.equal(connection.daveReady, true)

  let repeatedJoinWaitedForDAVE = false
  const manager = Object.create(VoiceManager.prototype)
  manager.connections = new Map([['guild-ready', {
    channelId: 'voice-ready', state: 'ready', ready: Promise.resolve(),
    async waitForDAVE() { repeatedJoinWaitedForDAVE = true },
  }]])
  assert.equal(await manager.join('guild-ready', 'voice-ready'), manager.connections.get('guild-ready'))
  assert.equal(repeatedJoinWaitedForDAVE, true, 'a second caller must not bypass the first caller’s MLS wait')

  const notReady = new VoiceConnection({
    gateway: { leaveVoice() {} }, rest: {}, logger: null,
    guildId: 'guild-not-ready', channelId: 'voice-not-ready', userId: 'bot-not-ready',
  })
  notReady.state = 'ready'
  notReady.dave = { active: false, destroy() {} }
  await assert.rejects(notReady.playPackets([]), /DAVE MLS is not ready/)
  // The test bypasses the gateway handshake, so consume the constructor's
  // pending readiness rejection before explicitly tearing the fixture down.
  notReady.ready.catch(() => {})
  await notReady.leave()
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
      return bridge.actorForExecution({ agent: { id: 'session-1' } }).userId
    }),
    bridge.actorStorage.run(memberActor, async () => {
      await delay(5)
      return bridge.actorForExecution({ agent: { id: 'session-1' } }).userId
    }),
  ])
  assert.equal(ownerResult, 'owner-1')
  assert.equal(memberResult, 'member-2')
  assert.throws(() => bridge.actorForExecution({ agent: { id: 'session-1' } }), /目前正在處理 Discord 訊息/)
  assert.throws(() => bridge.actorStorage.run(ownerActor, () =>
    bridge.actorForExecution({ agent: { id: 'another-session' } })), /目前正在處理 Discord 訊息/)
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
    bridge.sessionQueues = new Map()
    bridge.limiter = { run: task => task() }
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

test('remembered DM notes stay private to the exact Owner and survive restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-private-notes-'))
  try {
    const ownerId = '123456789012345678'
    const settings = {
      home: root,
      ownerIds() { return [ownerId] },
      isOwner(id) { return String(id) === ownerId },
      get(_key, fallback) { return fallback },
    }
    const brain = new DiscordBrain({ workspace: root, settings })
    await brain.load()
    await brain.writeNote({
      title: '私訊專案備忘',
      body: '這是只屬於 Owner 私訊的秘密代號：藍鯨-739。',
      private: true,
      ownerId,
    })
    assert.equal(brain.search('藍鯨-739').length, 0, 'private DM notes must not enter the shared note index')
    const ownerDm = await brain.recallContext('藍鯨-739', { kind: 'dm', channelId: 'dm-1', userId: ownerId }, 'dm-session')
    assert.match(ownerDm, /藍鯨-739/)
    assert.equal(await brain.recallContext('藍鯨-739', {
      kind: 'channel', channelId: 'guild-chan', guildId: 'guild-1', userId: ownerId,
    }, 'guild-session'), '', 'private notes must never be injected into public channels')
    assert.equal(await brain.recallContext('藍鯨-739', {
      kind: 'dm', channelId: 'dm-2', userId: '999999999999999999',
    }, 'other-dm-session'), '', 'another Owner must not retrieve this private note')

    const restored = new DiscordBrain({ workspace: root, settings })
    await restored.load()
    const afterRestart = await restored.recallContext('藍鯨-739', {
      kind: 'dm', channelId: 'dm-1', userId: ownerId,
    }, 'dm-session-restarted')
    assert.match(afterRestart, /藍鯨-739/, 'private DM notes must survive restart')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('shared memory recalls across guilds and hides private source attribution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-memory-'))
  try {
    await mkdir(path.join(root, 'live'), { recursive: true })
    const config = {
      ownerIds: ['owner-1', 'owner-2'],
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
      isOwner(id) { return ['owner-1', 'owner-2'].includes(String(id)) },
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
      channelName: 'hardware', authorId: 'owner-1', authorName: 'Owner',
    })
    await brain.queue
    const ownerTarget = { kind: 'channel', channelId: 'chan-b', guildId: 'guild-b', userId: 'owner-1' }
    assert.equal(brain.events[1]?.scope, 'guild')
    assert.equal(brain.events[1]?.authorId, 'owner-1')
    assert.equal(brain.canRecall(brain.events[1], ownerTarget, 'discord-channel-guild-b-chan-b'), true)
    const ownerPrompt = await brain.recallContext('RTX 5080', ownerTarget, 'discord-channel-guild-b-chan-b')
    assert.match(ownerPrompt, /Server A \/ #hardware/)
    assert.match(ownerPrompt, /RTX 5080/)
    assert.match(ownerPrompt, /Owner 私訊背景（不得公開）/)
    assert.match(ownerPrompt, /Owner 私訊背景（不得公開）/, 'the model can identify the source while being instructed not to disclose it')
    assert.doesNotMatch(ownerPrompt, /owner-secret/)

    const ownerDmPrompt = await brain.recallContext('RTX 5080', {
      kind: 'dm', channelId: 'dm-2', userId: 'owner-1',
    }, 'discord-dm-owner-1')
    assert.match(ownerDmPrompt, /Server A \/ #hardware/, 'Owner DM can recall their own public channel conversation')
    assert.match(ownerDmPrompt, /RTX 5080/)

    // Other members cannot inspect another guild's conversations.
    const memberPrompt = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-b', guildId: 'guild-b', userId: 'member-3',
    }, 'discord-channel-guild-b-chan-b')
    assert.equal(memberPrompt, '')

    brain.feedAdd('discord-channel-guild-b-chan-b', { who: 'me', text: '伺服器 B 也討論了同一張 RTX 5080 顯示卡。', label: '#general' }, {
      botId: 'bot-1', messageId: 'guild-msg-2', conversationType: 'channel',
      guildId: 'guild-b', guildName: 'Server B', channelId: 'chan-b',
      channelName: 'general', authorId: 'owner-1', authorName: 'Owner',
    })
    await brain.queue
    const reversePrompt = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-a', guildId: 'guild-a', userId: 'owner-1',
    }, 'discord-channel-guild-a-chan-a')
    assert.match(reversePrompt, /Server B \/ #general/, 'Owner can recall Server B conversation back in Server A')
    const vagueFollowup = await brain.recallContext('那件事呢？', {
      kind: 'channel', channelId: 'chan-a', guildId: 'guild-a', userId: 'owner-1',
    }, 'discord-channel-guild-a-chan-a')
    assert.match(vagueFollowup, /Server B \/ #general/, 'short follow-ups retain recent context from another session')

    const sameGuildPrompt = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-c', guildId: 'guild-a', userId: 'owner-1',
    }, 'discord-channel-guild-a-chan-c')
    assert.match(sameGuildPrompt, /Server A \/ #hardware/, 'channel 2 can recall the Owner conversation from channel 1')
    const memberSameGuild = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-c', guildId: 'guild-a', userId: 'member-3',
    }, 'discord-channel-guild-a-member-3')
    assert.equal(memberSameGuild, '', 'non-Owners cannot use cross-channel recall to inspect other channels')

    config.memory.shareAcrossChannels = false
    const channelIsolated = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-c', guildId: 'guild-a', userId: 'owner-1',
    }, 'discord-channel-guild-a-chan-c')
    assert.doesNotMatch(channelIsolated, /Server A \/ #hardware|伺服器 A 曾討論/, 'disabling cross-channel sharing blocks public channel events')
    assert.match(channelIsolated, /Owner 私訊背景（不得公開）/, 'the independent Owner-private-context toggle remains effective')
    const crossGuildStillShared = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-b', guildId: 'guild-b', userId: 'owner-1',
    }, 'discord-channel-guild-b-independent')
    assert.match(crossGuildStillShared, /Server A \/ #hardware/, 'cross-guild sharing remains independent of same-guild channel sharing')
    config.memory.shareAcrossChannels = true

    config.memory.allowPrivateContextInGuild = false
    const noPrivate = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-b', guildId: 'guild-b', userId: 'owner-1',
    }, 'discord-channel-guild-b-chan-b')
    assert.doesNotMatch(noPrivate, /主人提過 RTX 5080/)

    // A second configured Owner is still a different person: Owner A's
    // private DM must not become background for Owner B's DM or public turn.
    const otherOwnerDm = await brain.recallContext('RTX 5080', {
      kind: 'dm', channelId: 'dm-2', userId: 'owner-2',
    }, 'discord-dm-2')
    assert.doesNotMatch(otherOwnerDm, /主人提過 RTX 5080|Owner 私訊背景（不得公開）/)

    const otherOwnerPublic = await brain.recallContext('RTX 5080', {
      kind: 'channel', channelId: 'chan-c', guildId: 'guild-c', userId: 'owner-2',
    }, 'discord-channel-guild-c-chan-c')
    assert.doesNotMatch(otherOwnerPublic, /主人提過 RTX 5080|Owner 私訊背景（不得公開）/)

    // With cross-guild sharing disabled, a DM has no guild identity to match;
    // it must not become a wildcard that sees every server's public messages.
    config.memory.allowPrivateContextInGuild = true
    config.memory.shareAcrossGuilds = false
    const dmWithoutCrossGuild = await brain.recallContext('RTX 5080', {
      kind: 'dm', channelId: 'dm-1', userId: 'owner-1',
    }, 'discord-dm-1b')
    assert.doesNotMatch(dmWithoutCrossGuild, /伺服器 A/)
    assert.match(dmWithoutCrossGuild, /主人提過 RTX 5080/)
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

test('SettingsStore safely replaces settings and secrets repeatedly on Windows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-settings-replace-'))
  try {
    const settings = new SettingsStore({ workspace: root }, { home: root })
    await settings.save()
    await settings.patch({ diaryCount: 4 })
    await settings.save()
    await settings.patch({ diaryCount: 5 })
    await settings.save()
    await settings.saveToken('first-token')
    await settings.saveToken('second-token')
    const saved = JSON.parse(await readFile(settings.file, 'utf8'))
    const secrets = JSON.parse(await readFile(settings.secretsFile, 'utf8'))
    assert.equal(saved.diaryCount, 5)
    assert.equal(secrets.discordBotToken, 'second-token')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Discord memory compaction safely replaces an existing JSONL file on Windows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hers-life-memory-compact-'))
  try {
    const file = path.join(root, 'live', 'discord-memory.jsonl')
    await mkdir(path.dirname(file), { recursive: true })
    const event = {
      id: 'duplicate-event', at: new Date().toISOString(), platform: 'discord',
      botId: 'bot-1', messageId: 'same-message', channelId: 'channel-1',
      sessionId: 'discord-channel-channel-1', role: 'user', text: 'Windows compaction test',
      scope: 'guild', guildId: 'guild-1', authorId: 'owner-1',
    }
    await writeFile(file, JSON.stringify(event) + '\n' + JSON.stringify({ ...event, id: 'duplicate-event-copy' }) + '\n', 'utf8')
    const settings = {
      home: root,
      ownerIds() { return [] },
      isOwner() { return false },
      get(_key, fallback) { return fallback },
    }
    const brain = new DiscordBrain({ workspace: root, settings })
    await brain.load()
    const rows = (await readFile(file, 'utf8')).trim().split(/\r?\n/)
    assert.equal(rows.length, 1)
    assert.equal(brain.events.length, 1)
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
  const sendFileTool = definitions.find(item => item.name === 'discord_send_file')
  assert.deepEqual(sendFileTool.parameters.required, ['path'])
  assert.deepEqual(Object.keys(sendFileTool.parameters.properties).sort(), ['caption', 'path'])
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
