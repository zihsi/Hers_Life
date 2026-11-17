import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, __internals } from './index.js'

const steer = (text = '刚才那个是什么？', id = 'one') => [{ id, source: { kind: 'plugin:hers-life-discord' }, content: [{ type: 'text', text }] }]
async function setup(t, { failRead = false, pauseMediaOnInterrupt = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ming-resume-test-'))
  await mkdir(path.join(root, 'live'))
  await writeFile(path.join(root, 'live/status.json'), '{"doing":"fake task"}')
  const handlers = {}, keys = []
  let playing = true, syncCalls = 0
  const originalAsync = childProcess.execFile, originalSync = childProcess.execFileSync
  childProcess.execFileSync = () => { syncCalls++; throw Error('synchronous ADB must not be used') }
  childProcess.execFile = (_file, args, _options, callback) => queueMicrotask(() => {
    if (args.includes('dumpsys audio')) {
      if (failRead) callback(Error('offline'))
      else callback(null, playing ? 'state:started USAGE_MEDIA' : '')
      return
    }
    const key = Number(args.at(-1)); keys.push(key)
    playing = key === 85 ? !playing : key === 126
    callback(null, '')
  })
  syncBuiltinESMExports()
  t.after(async () => {
    childProcess.execFile = originalAsync; childProcess.execFileSync = originalSync; syncBuiltinESMExports()
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  })
  apply({ on: (name, fn) => { handlers[name] = fn }, inject() {} }, { root, pauseMediaOnInterrupt })
  return { keys, syncCalls: () => syncCalls,
    step: (agent, turn, messages = [], signal) => handlers['agent/pre-step']({ agent, turn, messages, signal }, async () => ({ kind: 'enter', messages: [] })),
    stop: (agent, turn, signal) => handlers['agent/turn-stopping']({ agent, turn, signal }) }
}

test('ordinary interruption pauses and resumes asynchronously for its owning turn', async t => {
  const h = await setup(t), a = { id: 'a' }
  const result = await h.step(a, 0, steer())
  assert.deepEqual(h.keys, [85]); assert.equal(h.syncCalls(), 0)
  assert.match(result.messages[0].content[0].text, /只有普通插话/)
  await h.stop({ id: 'b' }, 0); await h.stop(a, 1); assert.deepEqual(h.keys, [85])
  await h.stop(a, 0); assert.deepEqual(h.keys, [85, 85])
})
test('unknown playback state does not send keys or claim idle', async t => {
  const h = await setup(t, { failRead: true }), result = await h.step({ id: 'a' }, 0, steer())
  assert.deepEqual(h.keys, []); assert.match(result.messages[0].content[0].text, /未知/)
})
test('explicit stop does not force old task or automatically restart video', async t => {
  const h = await setup(t), a = { id: 'a' }
  const result = await h.step(a, 0, steer('停下，不要继续原任务了')), text = result.messages[0].content[0].text
  assert.match(text, /明确的停止、暂停或换任务指令/)
  assert.ok(!text.includes('然后立刻回到')); assert.ok(!text.includes('直接继续'))
  assert.deepEqual(h.keys, [85]); await h.step(a, 0); await h.stop(a, 0); assert.deepEqual(h.keys, [85])
})
test('stop after an ordinary interruption relinquishes automatic playback', async t => {
  const h = await setup(t), a = { id: 'a' }
  await h.step(a, 0, steer()); await h.step(a, 0, steer('<user_message discord="123">请暂停</user_message>', 'two'))
  await h.stop(a, 0); assert.deepEqual(h.keys, [85])
})
test('host cancellation does not resume media paused by this plugin', async t => {
  const h = await setup(t), a = { id: 'a' }
  const abort = new AbortController()
  await h.step(a, 0, steer(), abort.signal); abort.abort()
  // 取消时宿主可能跳过 turn-stopping；新回合也不得继承旧的自动续播。
  await h.step(a, 1); await h.stop(a, 0, abort.signal); assert.deepEqual(h.keys, [85])
})
test('new task gets a conditional reminder, never unconditional continuation', async t => {
  const h = await setup(t), a = { id: 'a' }
  const result = await h.step(a, 0, steer('换个任务，先帮我找图片')), text = result.messages[0].content[0].text
  assert.match(text, /改任务要求优先/); assert.match(text, /不要自动回到旧任务/)
  assert.match(text, /fake task/)
  await h.step(a, 0); await h.stop(a, 0); assert.deepEqual(h.keys, [85])
})
test('same steer is injected once and non-steer messages are unchanged', async t => {
  const h = await setup(t, { pauseMediaOnInterrupt: false }), a = { id: 'a' }
  assert.equal((await h.step(a, 0, steer())).messages.length, 1)
  assert.equal((await h.step(a, 0, steer())).messages.length, 0)
  assert.equal((await h.step(a, 0, [{ id: 'user', source: { kind: 'user' }, content: [] }])).messages.length, 0)
})
test('pause matching distinguishes direct commands from negation, quotes and questions', () => {
  for (const text of ['停下', '请暂停', '取消原任务', '先不要继续了', '不要恢复播放', 'please stop', 'pause the video', '换个任务', '请改做别的'])
    assert.equal(__internals.requestsPause(steer(text)[0]), true, text)
  for (const text of ['不要停止原任务', '别停，继续吧', '停止按钮在哪里', '“停下”是什么意思', '他说暂停，我没这么说', '取消订阅怎么操作', '刚才的视频挺好看'])
    assert.equal(__internals.requestsPause(steer(text)[0]), false, text)
})
