import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from './index.js'

const due = (id = 'first') => ({ armId: id, dueAt: 1, armedAt: 1, sessionId: 'fake', reason: 'synthetic reminder', status: 'armed' })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function harness(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ming-wake-test-'))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }))
  await mkdir(path.join(root, 'live'))
  const file = path.join(root, 'live/wake-arm.json')
  const write = value => writeFile(file, JSON.stringify(value))
  await write(options.initial ?? { items: [due()] })
  let tick, tool, resumes = 0
  const sent = []
  const agent = { id: 'fake', session: { header: { id: 'fake' } },
    followup(message) { sent.push(message); return options.followup?.(message) } }
  const ctx = {
    inject(_services, fn) { fn(this) }, effect(fn) { return fn() },
    tools: { register(def) { tool = def } },
    timer: { interval(fn) { tick = fn; return () => {} } },
    get: name => options.services?.[name],
    ...(options.discord ? {
      hersLifeDiscord: {
        actorForExecution: exec => ({ sessionId: String(exec?.agent?.id || ''), userId: options.userId || 'member' }),
        isOwner: userId => userId === 'owner',
      },
    } : {}),
    agents: {
      get: () => options.live ? agent : undefined,
      async resume(args) { resumes++; assert.equal(args.resumeSessionId, 'fake'); return options.resume ? options.resume(agent) : { agent, dispose: async () => {} } },
    },
  }
  if (options.resolve) ctx.waterfall = (name, id, next) => {
    assert.equal(name, 'schedule/resolve-agent'); return options.resolve(id, next, agent)
  }
  apply(ctx, { root })
  const discordExec = (userId = 'member') => ({
    agent: {
      ...agent,
      session: { header: { id: 'fake', meta: { hersLife: { platform: 'discord', conversationType: 'channel', userId } } } },
    },
  })
  return { tick: () => tick(), read: async () => JSON.parse(await readFile(file, 'utf8')),
    write, file, tool: () => tool, sent, agent, discordExec, resumes: () => resumes }
}

test('idle session receives reason via followup before being marked fired', async t => {
  const h = await harness(t); await h.tick()
  const item = (await h.read()).items[0]
  assert.equal(h.resumes(), 1); assert.equal(h.sent.length, 1)
  assert.match(h.sent[0].content[0].text, /synthetic reminder/)
  assert.equal(h.sent[0].source.kind, 'plugin:ming-wake')
  assert.equal(item.status, 'fired'); assert.equal(item.messageId, h.sent[0].id)
  await h.tick(); assert.equal(h.sent.length, 1)
})
test('live agent receives followup without a second resume', async t => {
  const h = await harness(t, { live: true }); await h.tick()
  assert.equal(h.resumes(), 0); assert.equal(h.sent.length, 1)
})
test('channel owner resolver is used for inactive sessions', async t => {
  let resolved = false
  const h = await harness(t, { resolve(id, _next, agent) { assert.equal(id, 'fake'); resolved = true; return agent } })
  await h.tick(); assert.equal(resolved, true); assert.equal(h.resumes(), 0); assert.equal(h.sent.length, 1)
})
test('resolver delegates to the host controller when available', async t => {
  let calls = 0, controllerAgent
  const h = await harness(t, { resolve: (_id, next) => next(),
    services: { sessionController: { async resolveAgent(id) { calls++; assert.equal(id, 'fake'); return { agent: controllerAgent } } } } })
  controllerAgent = h.agent; await h.tick()
  assert.equal(calls, 1); assert.equal(h.resumes(), 0); assert.equal(h.sent.length, 1)
})
test('failed resume is unknown and never retried blindly', async t => {
  const h = await harness(t, { resume() { throw Error('ambiguous activation') } }); await h.tick()
  const item = (await h.read()).items[0]
  assert.equal(item.status, 'unknown'); assert.equal(item.firedAt, undefined)
  await h.tick(); assert.equal(h.resumes(), 1)
})
test('failed followup stays unknown without a duplicate delivery', async t => {
  const h = await harness(t, { followup() { throw Error('ambiguous delivery') } }); await h.tick()
  assert.equal((await h.read()).items[0].status, 'unknown')
  await h.tick(); assert.equal(h.sent.length, 1)
})
test('missing followup capability is not reported as success', async t => {
  const h = await harness(t, { resume: async () => ({ agent: {} }) }); await h.tick()
  assert.equal((await h.read()).items[0].status, 'unknown'); assert.equal(h.sent.length, 0)
})
test('unacknowledged persistence after delivery stays unknown', async t => {
  const h = await harness(t, { services: { sessions: { flush: async () => false } } }); await h.tick()
  assert.equal((await h.read()).items[0].status, 'unknown')
  await h.tick(); assert.equal(h.sent.length, 1)
})
test('overlapping timer ticks and concurrent arm preserve both records', async t => {
  const started = deferred(), finish = deferred()
  const h = await harness(t, { resume(agent) { started.resolve(); return finish.promise.then(() => ({ agent })) } })
  const first = h.tick(); await started.promise; await h.tick(); assert.equal(h.resumes(), 1)
  await h.tool().execute({ minutes: 1, reason: 'new reminder', sessionId: 'new-fake' })
  finish.resolve(); await first
  const items = (await h.read()).items
  assert.equal(items.length, 2)
  assert.equal(items.find(i => i.armId === 'first').status, 'fired')
  assert.equal(items.find(i => i.sessionId === 'new-fake').status, 'armed')
  assert.equal(h.sent.length, 1)
})
test('interrupted attempt becomes unknown and does not block next reminder', async t => {
  const h = await harness(t, { initial: { items: [{ ...due('crash'), status: 'attempting' }, due('next')] } }); await h.tick()
  const items = (await h.read()).items
  assert.equal(items[0].status, 'unknown'); assert.equal(items[1].status, 'fired'); assert.equal(h.sent.length, 1)
})
test('multiple due reminders are delivered once on successive ticks', async t => {
  const h = await harness(t, { live: true, initial: { items: [due('one'), due('two')] } })
  await h.tick(); await h.tick(); await h.tick()
  assert.equal(h.sent.length, 2); assert.ok((await h.read()).items.every(i => i.status === 'fired'))
})
test('old single record without status is delivered; old fired record is not repeated', async t => {
  const old = due(); delete old.status; delete old.armId
  const h = await harness(t, { initial: old }); await h.tick(); assert.equal(h.sent.length, 1)
  await h.write({ ...old, firedAt: 123 }); await h.tick(); assert.equal(h.sent.length, 1)
})
test('tool takes current session from execution context and respects explicit target', async t => {
  const h = await harness(t, { initial: { items: [] } })
  await h.tool().execute({ minutes: 1, reason: 'current' }, { agent: h.agent })
  await h.tool().execute({ minutes: 2, reason: 'other', sessionId: 'other' }, { agent: h.agent })
  assert.deepEqual((await h.read()).items.map(i => i.sessionId), ['fake', 'other'])
  assert.match(await h.tool().execute({ minutes: 1, reason: 'no context' }), /sessionId/)
  assert.equal((await h.read()).items.length, 2)
})
test('corrupt queue is preserved rather than overwritten by a new arm', async t => {
  const h = await harness(t)
  await writeFile(h.file, '{broken')
  await assert.rejects(h.tool().execute({ minutes: 1, reason: 'new', sessionId: 'fake' }))
  await h.tick()
  assert.equal(await readFile(h.file, 'utf8'), '{broken')
  assert.equal(h.sent.length, 0)
})

test('non-Owner Discord member can only arm the current channel session', async t => {
  const h = await harness(t, { initial: { items: [] }, discord: true, userId: 'member' })
  await assert.rejects(
    h.tool().execute({ minutes: 1, reason: 'other', sessionId: 'private-session' }, h.discordExec()),
    /只有 Discord Owner/
  )
  await h.tool().execute({ minutes: 1, reason: 'this channel' }, h.discordExec())
  assert.deepEqual((await h.read()).items.map(i => i.sessionId), ['fake'])
})

test('Discord Owner may explicitly target another session', async t => {
  const h = await harness(t, { initial: { items: [] }, discord: true, userId: 'owner' })
  await h.tool().execute({ minutes: 1, reason: 'cross session', sessionId: 'private-session' }, h.discordExec('owner'))
  assert.deepEqual((await h.read()).items.map(i => i.sessionId), ['private-session'])
})
