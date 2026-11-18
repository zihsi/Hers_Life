import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from './index.js'

test('Owner DM, guild channel and non-Owner DM share the same persona and public diary', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ming-persona-consistency-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  await mkdir(path.join(root, 'persona'), { recursive: true })
  await mkdir(path.join(root, 'diary'), { recursive: true })
  await writeFile(path.join(root, 'persona', 'identity.md'), '唯一人格核心：藍白色的小鯨魚。', 'utf8')
  await writeFile(path.join(root, 'diary', '2026-11-18.md'), '- 今天和爸爸討論了共享記憶。', 'utf8')

  const handlers = new Map()
  const ctx = {
    on(name, fn) { handlers.set(name, fn) },
    inject(services, fn) {
      if (services.includes('connection') && services.includes('webServer')) {
        fn({
          connection: { requestRejection: () => 0 },
          webServer: { register() {} },
          effect(run) { return run() },
        })
      }
    },
    hersLifeDiscord: {
      workspace: root,
      isOwner(id) { return String(id) === 'owner-1' },
      async ensurePrivacy() { return { entriesMoved: 0 } },
    },
  }
  apply(ctx, {
    root,
    personaFiles: ['persona/identity.md'],
    diaryDir: 'diary',
    diaryCount: 3,
    selfName: '小鯨魚',
    selfFullName: '小鯨魚',
    selfDesc: '藍白色的 AI 角色',
    userName: '爸爸',
  })

  const makeAgent = (id, conversationType, userId) => {
    const sections = []
    const contexts = []
    return {
      id,
      session: {
        header: {
          id,
          cwd: root,
          meta: { hersLife: { platform: 'discord', conversationType, userId } },
        },
      },
      ctx: {
        systemPrompt: {
          section(value) { sections.push(value) },
          context(value) { contexts.push(value) },
        },
      },
      sections,
      contexts,
    }
  }

  const created = handlers.get('agent/created')
  assert.equal(typeof created, 'function')
  const ownerDm = makeAgent('owner-dm', 'dm', 'owner-1')
  const guildChannel = makeAgent('guild-channel', 'channel', 'owner-1')
  const otherDm = makeAgent('other-dm', 'dm', 'member-2')
  await created({ agent: ownerDm })
  await created({ agent: guildChannel })
  await created({ agent: otherDm })

  const opening = agent => agent.sections.find(section => section.name === 'ming:opening')?.text() ?? ''
  const ownerText = opening(ownerDm)
  const guildText = opening(guildChannel)
  const otherDmText = opening(otherDm)
  assert.ok(ownerText.includes('唯一人格核心：藍白色的小鯨魚。'))
  assert.ok(ownerText.includes('今天和爸爸討論了共享記憶。'))
  assert.equal(guildText, ownerText, 'public guild sessions must receive the same persona and shared diary')
  assert.equal(otherDmText, ownerText, 'non-Owner DMs must not become a different personality either')

  const publicLive = guildChannel.contexts[0]?.text?.() ?? ''
  assert.doesNotMatch(publicLive, /重啟接續|私人工作狀態/)
  for (const agent of [ownerDm, guildChannel, otherDm]) handlers.get('agent/disposed')?.({ agent })
})
