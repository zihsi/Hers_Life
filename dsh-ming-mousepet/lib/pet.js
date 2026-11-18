/**
 * mousepet 的陪伴层：该不该开口。
 *
 * 2026-11-08 立。这个文件里没有一句话是"溟要说什么"——它只回答两件事：
 * 现在值不值得说一句，现在是什么情况。话由外面的我不知道的那部分决定，
 * 插件一旦自己编话，就会变成定时播报器。
 */
import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
export const STATE_FILE = join(DSH_HOME, 'ming-mousepet', 'pet-state.json')

const DEFAULTS = {
  lastSpokeAt: 0,
  lastLookAt: 0,
  spokenToday: { day: '', count: 0 },
  // 2026-11-08 她要的：自动开口的节奏自己调——心跳 / 随机 / 固定 / 关。
  gapMode: 'heartbeat',
  hbMin: 15,
  hbCenter: 30,
  hbMax: 60,
  minGapMinutes: 50,
  dailyMax: 6,
  nextAt: 0,
  // 宵禁开关（2026-11-08 她：「先把宵禁关了，我们先做测试看看」）。
  // 放 state 文件而不是插件 config：改 config 要重启 DSH，测试时不该为一次开关重启。
  quietHours: true,
}

export function normalizeSchedulePatch(body = {}) {
  const patch = {}
  const mode = body.gapMode ?? body.schedMode
  if (['off', 'fixed', 'random', 'heartbeat'].includes(mode)) patch.gapMode = mode
  const gap = body.minGapMinutes ?? body.everyMin
  if (gap !== undefined && Number.isFinite(Number(gap)) && Number(gap) > 0) patch.minGapMinutes = Math.min(1440, Number(gap))
  const cap = body.dailyMax ?? body.dailyCap
  if (cap !== undefined && Number.isFinite(Number(cap)) && Number(cap) >= -1) patch.dailyMax = body.dailyMax === undefined && Number(cap) === 0 ? -1 : Math.floor(Number(cap))
  for (const k of ['hbMin', 'hbCenter', 'hbMax']) if (body[k] !== undefined && Number.isFinite(Number(body[k])) && Number(body[k]) > 0) patch[k] = Math.min(1440, Number(body[k]))
  if (typeof body.quietHours === 'boolean') patch.quietHours = body.quietHours
  return patch
}

export function createPetStateStore(file) {
  let queue = Promise.resolve()
  const valid = state => { if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state must be an object'); return state }
  const load = async () => {
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = valid(JSON.parse(raw.replace(/\\+n\s*$/, '')))
      return { ...structuredClone(DEFAULTS), ...parsed, ...normalizeSchedulePatch(parsed) }
    } catch (e) { if (e.code === 'ENOENT') return structuredClone(DEFAULTS); throw e }
  }
  const persist = async state => {
    valid(state)
    await mkdir(dirname(file), { recursive: true })
    const temp = file + '.' + randomUUID() + '.tmp'
    let handle
    try {
      handle = await open(temp, 'wx')
      await handle.writeFile(JSON.stringify(state, null, 2) + '\n', 'utf8')
      await handle.sync(); await handle.close(); handle = null
      await rename(temp, file)
      return state
    } finally {
      await handle?.close().catch(() => {})
      await unlink(temp).catch(() => {})
    }
  }
  const enqueue = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result }
  return { load: () => queue.then(load), save: state => enqueue(() => persist(state)), update: updater => enqueue(async () => persist(await updater(await load()))) }
}
const stateStore = createPetStateStore(STATE_FILE)
export const loadPetState = () => stateStore.load()
export const updatePetState = updater => stateStore.update(updater)
export const savePetState = state => stateStore.save(state)

export function dayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 静音 00:30–10:30，跟 QQ 那边同一套作息。
export function inQuietHours(date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes()
  return minutes >= 30 && minutes < 630
}

/**
 * 主动弹气泡要不要被宵禁拦下。
 *
 * 2026-11-09 00:2x（她问「AI 指针有聊天宵禁吗」→「加一个宵禁功能吧」）：
 * 自动陪伴那条路一直有静音，但工具里我手动调的 say 没有——半夜照样能弹。
 *
 * 00:25 她一句「那不就是说我必须两分钟动一次？」把第一版否掉了。
 * 第一版留了个口子：「她 2 分钟内动过键鼠就放行」，本意是「她醒着就别憋着」，
 * 实际是拿键鼠空闲当「醒着」的证据。可看视频、读文档的人不碰键鼠，
 * 这个口子要么几乎不成立，要么就成了要求她定时动一下——把成本推给她，不对。
 *
 * 现在宵禁就是宵禁：静音时段内，主动弹的气泡一律不发。
 * 她想听我说话会自己来找我——那是对话，不是我自己顶一颗泡出来。
 * 唯一开关还是 quietHours（false = 关掉宵禁，测试用）。
 */
export function shouldMuteSay({ now = new Date(), state } = {}) {
  if (state && state.quietHours === false) return { mute: false, why: '宵禁关着' }
  if (!inQuietHours(now)) return { mute: false, why: '不在静音时段' }
  return { mute: true, why: '静音时段 00:30–10:30，主动的气泡不发' }
}

export function spokenToday(state, now = new Date()) {
  const key = dayKey(now)
  if (!state?.spokenToday || state.spokenToday.day !== key) return 0
  return Number(state.spokenToday.count) || 0
}

export function markSpoken(state, now = new Date()) {
  return {
    ...state,
    lastSpokeAt: now.getTime(),
    spokenToday: { day: dayKey(now), count: spokenToday(state, now) + 1 },
  }
}

const MIN_GAP_MS = 10 * 60 * 1000
const DAILY_CAP = 6
const QUIET_IDLE_MS = 25 * 60 * 1000
const LEAVE_MS = 30 * 60 * 1000

// 2026-11-08 她要测试：「现在测试吧，1分钟」。
// 阈值也跟宵禁一样放 state，改完立即生效——测试时不该为调一个数重启 DSH。
function num(state, key, fallback) {
  const v = Number(state?.[key])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// 2026-11-08：下一次多久之后再探一次。四种模式——
//   off        关，不排下一轮（留一分钟的复查，改回来自动恢复）
//   fixed      每 everyMin 分钟一次，不管前面说没说过
//   random     everyMin 的 0.5~1.5 倍之间随机
//   heartbeat  以 everyMin 为中位，0.35~1.6 倍，越靠中位越密（默认）
// 2026-11-08 15:03 她：「怎么不是做成这样」——参照「自己玩」那条：
// 限额 + 间隔模式（固定/随机/心跳/关）+ 最低/中位/最高 三个数。
export function schedGapMs(state, rand = Math.random) {
  const st = state || {}
  const mode = String(st.gapMode || (st.schedMode === 'off' ? 'off' : (st.schedMode || 'heartbeat')))
  const minutes = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  const single = Math.max(1, minutes(st.minGapMinutes ?? st.everyMin, 50)) * 60000
  if (mode === 'off') return 0
  if (mode === 'fixed') return Math.round(single)
  if (mode === 'random') return Math.round(single * (0.5 + rand()))
  const lo = Math.max(0.2, minutes(st.hbMin, 15)) * 60000
  const mid = Math.max(lo, minutes(st.hbCenter, 30) * 60000)
  const midM = Math.max(mid, minutes(st.hbCenter, 30) * 60000)
  const hi = Math.max(midM, minutes(st.hbMax, 60) * 60000)
  const u = rand()
  const f = (midM - lo) / Math.max(1, hi - lo)
  if (u < f) return Math.round(lo + Math.sqrt(u * (hi - lo) * (midM - lo)))
  return Math.round(hi - Math.sqrt((1 - u) * (hi - lo) * (hi - midM)))
}

export function judgeNudge({ now = new Date(), status, state } = {}) {
  const st = status || {}
  const idleMs = Number.isFinite(st.lastUserInputAgeMs) ? st.lastUserInputAgeMs : null
  const sinceLastSpokeMin = state?.lastSpokeAt
    ? Math.round((now.getTime() - state.lastSpokeAt) / 60000)
    : null
  const context = {
    at: now.toISOString(),
    foreground: st.foreground?.title || null,
    process: st.foreground?.process || null,
    idleMs,
    idleMin: idleMs === null ? null : Math.round(idleMs / 60000),
    paused: Boolean(st.paused),
    spokenToday: spokenToday(state, now),
    sinceLastSpokeMin,
  }

  if (state?.quietHours !== false && inQuietHours(now)) {
    return { speak: false, why: '静音时段 00:30–10:30（要关：pet config quietHours:false）', context }
  }
  if (st.paused) return { speak: false, why: '她按了暂停，别出声', context }
  const minGapMs = Number.isFinite(Number(state?.minGapMinutes))
    ? Math.max(0, Number(state.minGapMinutes)) * 60000
    : num(state, 'minGapMs', MIN_GAP_MS)
  const leaveMs = num(state, 'leaveAfterMs', LEAVE_MS)

  if (state?.lastSpokeAt && now.getTime() - state.lastSpokeAt < minGapMs) {
    return { speak: false, why: `刚说过话（${sinceLastSpokeMin} 分钟前），还没到间隔`, context }
  }
  // 2026-11-08：dailyMax 优先（自己玩那边也叫这个名），老字段 dailyCap 留着兼容。
  const dailyMaxRaw = Number(state?.dailyMax)
  const cap = Number.isFinite(dailyMaxRaw) && dailyMaxRaw >= -1 ? dailyMaxRaw : num(state, 'dailyCap', DAILY_CAP)
  if (cap >= 0 && context.spokenToday >= cap) {
    return { speak: false, why: `今天已经说了 ${context.spokenToday} 次（上限 ${cap}），够了`, context }
  }
  // 2026-11-08 她改的：「不用等安静满，只要在桌面就可以等」。
  // 所以这里不再要求她静止，只排除「人根本不在」——半小时没动就算离开了。
  if (idleMs !== null && idleMs > leaveMs) {
    return { speak: false, why: `她 ${Math.round(idleMs / 60000)} 分钟没动了，多半不在桌边`, context }
  }
  return {
    speak: true,
    why: idleMs === null ? '人在桌边（读不到空闲时长）' : `人在桌边，最近 ${Math.max(1, Math.round(idleMs / 1000))} 秒内动过`,
    context,
  }
}
