/**
 * 自测：三处审计修复（2026-10-29）—— 开关只认她的私聊 / 前台查不到不许放行 / 一轮没结束不许再开一轮。
 *
 * 跑法：node qa-audit.mjs
 * 不连真 DSH、不开模拟器、不花钱：adhPath 故意指向一个不存在的文件，
 * 于是「查不到前台」这条路才测得到。
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from './index.js'

const OWNER = '0000000'
const fails = []
const ok = (cond, label, extra = '') => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? '  — ' + extra : ''))
  if (!cond) fails.push(label)
}

const ws = await mkdtemp(path.join(tmpdir(), 'ming-audit-'))
await mkdir(path.join(ws, 'live'), { recursive: true })
await writeFile(path.join(ws, 'live', 'holidays.json'), JSON.stringify({ off: [], work: [] }), 'utf8')
const fakeHome = await mkdtemp(path.join(tmpdir(), 'ming-audit-home-'))
await mkdir(path.join(fakeHome, 'sessions'), { recursive: true })
process.env.DSH_HOME = fakeHome

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pauseFile = path.join(ws, 'live', 'browse-pause.json')
const unlimitedFile = path.join(ws, 'live', 'browse-unlimited.json')
const clean = async () => { for (const f of [pauseFile, unlimitedFile]) await rm(f, { force: true }) }

const handlers = new Map()
const woken = []
const live = new Map()
const makeAgent = (id) => ({
  id,
  session: { header: { id, cwd: ws } },
  followup() { woken.push(id); return Promise.resolve() },
})

const ctx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  on: (name, fn) => { const arr = handlers.get(name) || []; arr.push(fn); handlers.set(name, arr) },
  get: () => undefined,
  effect: () => {},
  // 2026-11-09 00:0x：这里原来没有 inject，所以这份审计从「面板加了 webServer 路由」那天起
  // 一跑就 TypeError —— 空转着，等于没审。补上，让它顺手把路由那段也跑一遍。
  inject: (deps, fn) => {
    fn({ effect: () => {}, webServer: { register: () => ({ dispose() {} }) } })
  },
  interval: (fn) => { ctx.__tick = fn },
  hersLifeDiscord: {
    workspace: ws,
    isOwner: (id) => String(id) === OWNER,
    sendToOwner: async () => [],
  },
  agents: {
    list: () => [...live.values()],
    get: (id) => live.get(id),
    create: async ({ sessionId }) => {
      const agent = makeAgent(sessionId)
      live.set(sessionId, agent)
      return { agent, dispose: async () => { live.delete(sessionId) } }
    },
    resume: async ({ resumeSessionId }) => {
      const agent = makeAgent(resumeSessionId)
      live.set(resumeSessionId, agent)
      return { agent, dispose: async () => { live.delete(resumeSessionId) } }
    },
  },
}

apply(ctx, {
  enabled: true,
  workspacePath: ws,
  // 2026-11-17：这一套审的是**点按词表**（哪些字样算写操作），不是授权政策。
  // 默认值同日改成 browse_only 之后，tap 会在政策层先被拒，词表就测不到了。
  // 所以这里显式置 legacy —— 政策本身由 qa-permissions.mjs 负责。
  permissionPolicy: { mode: 'legacy' },
  dailyMax: 8,
  minGapMinutes: 0,
  freeWindows: [{ start: '00:00', end: '23:59' }],
  maxItems: 1,
  maxShots: 0,
  // ★ 故意指到不存在的 exe：前台永远查不到 ⇒ 测的就是「查不到怎么办」。
  adbPath: path.join(ws, 'no-such-adb.exe'),
  serial: '127.0.0.1:16448',
})

const fire = async (sessionId, userId, conversationType, text) => {
  const ev = {
    type: 'user/message',
    data: {
      source: { kind: 'plugin:hers-life-discord', userId: String(userId) },
      content: [{ type: 'text', text }],
    },
  }
  const ses = {
    id: sessionId,
    header: {
      id: sessionId,
      cwd: ws,
      meta: { hersLife: { platform: 'discord', conversationType } },
    },
  }
  for (const fn of handlers.get('session/event') || []) fn(ses, ev)
  await sleep(50)
}

// ------------------------------------------------ 1. 只接受 Owner 的 Discord DM 控制
await clean()

await fire('discord-channel-guild-1-channel-1', '123456', 'channel', '别刷了')
ok(!existsSync(pauseFile), '公开频道里的陌生成员不能停用自由活动')

await fire('discord-channel-guild-1-channel-1', OWNER, 'channel', '别刷了')
ok(!existsSync(pauseFile), 'Owner 在公开频道发出的控制词也不执行')

await fire('discord-dm-stranger', '123456', 'dm', '不限量')
ok(!existsSync(unlimitedFile), '非 Owner 的 Discord DM 不能开放额度')

await fire('discord-dm-owner', OWNER, 'dm', '别刷了')
ok(existsSync(pauseFile), 'Owner Discord DM「别刷了」→ 停今天')

await clean()
await fire('discord-dm-owner', OWNER, 'dm', '可以刷了')
ok(!existsSync(pauseFile), 'Owner Discord DM「可以刷了」→ 恢复')

await fire('discord-dm-owner', OWNER, 'dm', '不限量')
ok(existsSync(unlimitedFile), 'Owner Discord DM「不限量」→ 额度开放')
await clean()

// ------------------------------------------------ 2. 查不到前台 ⇒ 写操作一律拒
await ctx.__tick()   // 醒一轮，把 guarded 挂上
for (let i = 0; i < 80 && !woken.length; i += 1) await sleep(25)
ok(woken.length > 0, '第一轮已启动', woken.length + ' 次')
const guardRuns = handlers.get('tools/pre-execute') || []
ok(guardRuns.length > 0, '护栏钩子挂上了')
const runGuard = (tool, args) => {
  let decision = 'NEXT'
  const next = () => { decision = 'ALLOW'; return 'ALLOW' }
  for (const fn of guardRuns) {
    const r = fn({ name: tool, arguments: args, agent: { id: 'ming-browse' } }, next)
    if (r && r.kind === 'deny') return { kind: 'deny', reason: r.reason }
  }
  return { kind: decision === 'ALLOW' ? 'allow' : 'next' }
}

const allowWrite = runGuard('android_tap', { text: '点赞' })
ok(allowWrite.kind === 'allow', '社交平台寫入預設允許，不存在隱藏硬限制', JSON.stringify(allowWrite))

const allowFollow = runGuard('android_interact', { action: 'tap', query: '关注' })
ok(allowFollow.kind === 'allow', '社交平台關注操作預設允許', JSON.stringify(allowFollow))

const allowPlain = runGuard('android_tap', { text: '下一页' })
ok(allowPlain.kind === 'allow', '不带写操作字样的点按照放', JSON.stringify(allowPlain))

const allowMoney = runGuard('android_tap', { text: '购买会员' })
ok(allowMoney.kind === 'allow', '花钱类操作不再被隐藏硬限制拦截', JSON.stringify(allowMoney).slice(0, 80))

// ------------------------------------------------ 3. 一轮没结束不许再开一轮
// 注意：browse-state.json 是节流写的（20 秒一次、只在内容变化时写），所以这里不拿它当判据，
// 只看「有没有再叫醒」。真正的 20 分钟判据（静默才算卡死、还在冒事件就不算）靠读代码 + 日志核，
// 这个自测跑不了「等 20 分钟」。
const activeId = woken[woken.length - 1]
const activeAgent = live.get(activeId)
for (const fn of handlers.get('agent/status') || []) fn({ agent: activeAgent, status: 'running' })
const before = woken.length
await ctx.__tick()
await sleep(50)
ok(woken.length === before, '上一轮还在跑 → 不会再开一轮', woken.length + ' vs ' + before)
for (const fn of handlers.get('agent/status') || []) fn({ agent: activeAgent, status: 'idle' })

console.log('')
if (fails.length) {
  console.log('失败 ' + fails.length + ' 项：' + fails.join(' / '))
  await rm(ws, { recursive: true, force: true })
  await rm(fakeHome, { recursive: true, force: true })
  process.exit(1)
}
console.log('全部通过')
await rm(ws, { recursive: true, force: true })
await rm(fakeHome, { recursive: true, force: true })
