/**
 * dsh-ming-resume —— 插话之后记得回去
 *
 * 问题：QQ 通道开 newMessagePolicy=steer 之后，她在我干活时插一句，那句会被塞进
 * 当前回合的下一步。能插话了，但副作用是：我答完她，很容易把原来在做的事丢在那儿
 * ——因为没有任何东西提醒我「刚才被打断了」。
 *
 * 宿主的真相：没有「暂停/恢复任务」这种对象。一个回合就是一串步骤，插话只是往
 * 下一步多塞一条消息。所以「继续」不是机制问题，是记性问题：我要知道自己在干什么。
 *
 * 做法：agent/pre-step 里看一眼这一步进来的消息，如果里面有 QQ 通道的插话
 * （source.kind 是 QQ 或 Discord bridge 的專屬來源），
 * 就追加一条极短指令：先答她，然后回到 live/status.json 里记着的那件事。
 *
 * 边界：
 *   · 找不到 status.json 就只说「回到你被打断前的事」，不编具体内容。
 *   · 只認 QQ / Discord bridge 的專屬 source，别把普通 QQ 消息也当成插话。
 *   · 任何异常都不影响这一步。
 */
import { readFile, appendFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { homedir } from 'node:os'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export const name = 'ming-resume'

const STEER_SOURCES = new Set(['plugin:dsh-onebot', 'plugin:ming-discord'])
const DSH_HOME = process.env.DSH_HOME || path.join(homedir(), '.dsh')
const DEFAULT_ROOT = process.env.MING_WORKSPACE || path.join(DSH_HOME, 'workspace')
const DEFAULTS = {
  root: DEFAULT_ROOT,
  adbPath: 'D:\\MuMuPlayer\\nx_device\\12.0\\shell\\adb.exe',
  serial: '127.0.0.1:7555',
  /** 插话时把正在播的视频暂停，答完再接着播（2026-10-20 她定的）。 */
  pauseMediaOnInterrupt: true,
}

function normalize(config) {
  const c = config && typeof config === 'object' ? config : {}
  const root = typeof c.root === 'string' && c.root.trim() ? path.resolve(c.root) : DEFAULTS.root
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d)
  return {
    root,
    adbPath: str(c.adbPath, DEFAULTS.adbPath),
    serial: str(c.serial, DEFAULTS.serial),
    pauseMediaOnInterrupt: c.pauseMediaOnInterrupt !== false,
  }
}

async function readStatus(cfg) {
  try {
    const raw = await readFile(path.join(cfg.root, 'live', 'status.json'), 'utf8')
    const s = JSON.parse(raw)
    if (!s || typeof s.doing !== 'string' || !s.doing.trim()) return ''
    return s.doing.trim() + (typeof s.detail === 'string' && s.detail.trim() ? '：' + s.detail.trim() : '')
  } catch {
    return ''
  }
}

function isSteer(msg) {
  try {
    const src = msg && msg.source
    return Boolean(src && STEER_SOURCES.has(src.kind))
  } catch {
    return false
  }
}

// ---------- 插话就暂停视频，答完接着播（2026-10-20 她定的） ----------
// 她的原话：插话的时候暂停播放，「一定要暂停住」，等我回完她、她忙完了再继续播。
// 为什么不能只靠提示词：按不按得住要看设备当前是不是真的在播；这里先查状态再按，
// 按完了再查一遍确认——没停住就换一个键再按，并把结果告诉模型。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function adbShell(cfg, args, timeout = 6000) {
  return new Promise((resolve, reject) => {
    execFile(cfg.adbPath, ['-s', cfg.serial, 'shell', ...args], {
      encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 1024 * 1024,
    }, (error, stdout) => error ? reject(error) : resolve(stdout))
  })
}

/** 有没有「媒体类」的正在播。看 dumpsys audio 里 state:started 且 usage=USAGE_MEDIA 的行。 */
async function mediaPlaying(cfg) {
  try {
    const out = await adbShell(cfg, ['dumpsys audio'])
    return out.split('\n').some(line => line.includes('state:started') && line.includes('USAGE_MEDIA'))
  } catch { return null }
}
async function pressKey(cfg, code) {
  try { await adbShell(cfg, ['input', 'keyevent', String(code)]); return true }
  catch { return false }
}
async function pauseMedia(cfg) {
  const playing = await mediaPlaying(cfg)
  if (playing === null) return 'unknown'
  if (!playing) return 'idle'
  if (!await pressKey(cfg, 85)) return 'unknown'
  await sleep(700)
  const after = await mediaPlaying(cfg)
  if (after === null) return 'unknown'
  if (!after) return 'paused'
  if (!await pressKey(cfg, 127)) return 'unknown'
  await sleep(800)
  const final = await mediaPlaying(cfg)
  return final === null ? 'unknown' : final ? 'failed' : 'paused'
}
async function resumeMedia(cfg) {
  const playing = await mediaPlaying(cfg)
  if (playing === null) return 'unknown'
  if (playing) return 'already'
  if (!await pressKey(cfg, 85)) return 'unknown'
  await sleep(700)
  const after = await mediaPlaying(cfg)
  if (after === null) return 'unknown'
  if (after) return 'resumed'
  if (!await pressKey(cfg, 126)) return 'unknown'
  await sleep(800)
  const final = await mediaPlaying(cfg)
  return final === null ? 'unknown' : final ? 'resumed' : 'failed'
}

export function apply(ctx, config) {
  const cfg = normalize(config)
  // 同一步里同一批插话只提醒一次：记最近提醒过的插话 id 集合
  const reminded = new Set()
  // 这次暂停是不是「我们」按的。只有我们停的才由我们接着播——
  // 她自己手动停的东西，不许被我们偷偷打开。
  let mediaOwner = null
  let mediaQueue = Promise.resolve()
  const serialMedia = fn => {
    const pending = mediaQueue.then(fn)
    mediaQueue = pending.catch(() => {})
    return pending
  }
  const resumeIfPausedByUs = payload => serialMedia(async () => {
    if (!mediaOwner || mediaOwner.agentId !== payload?.agent?.id || mediaOwner.turn !== payload?.turn) return
    mediaOwner = null
    await resumeMedia(cfg)
  })
  ctx.on('agent/turn-stopping', async payload => {
    await resumeIfPausedByUs(payload)
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    const downstream = await next()
    try {
      if (!downstream || downstream.kind !== 'enter') return downstream
      const msgs = (payload && payload.messages) || []
      const steers = msgs.filter(isSteer)
      if (!steers.length) {
        // 这一步没有新的插话 = 已经答完她、回到原来那件事了 → 接着播。
        await resumeIfPausedByUs(payload)
        return downstream
      }
      const fresh = steers.filter((m) => m && m.id && !reminded.has(m.id))
      if (!fresh.length) return downstream
      for (const m of fresh) if (m.id) reminded.add(m.id)
      while (reminded.size > 200) reminded.delete(reminded.values().next().value)

      const task = await readStatus(cfg)

      // 2026-11-07 19:1x：给「记忆接续」面板留一行痕迹——被打断过几次、每次打断时在干什么。
      // 只记时间 + 那件事的摘要，**不记她说的原话**（那属于她那间屋子）。
      try {
        await appendFile(
          path.join(cfg.root, 'live', 'resume-log.jsonl'),
          JSON.stringify({ at: new Date().toISOString(), doing: task }) + '\n',
        )
      } catch { /* 记不上不影响这一步 */ }

      // 插话的这一刻：把正在播的东西停住（她的要求，一定要停住）。
      let mediaNote = ''
      if (cfg.pauseMediaOnInterrupt && payload?.agent?.id && Number.isInteger(payload?.turn)) {
        const result = await serialMedia(async () => {
          if (mediaOwner) return 'owned'
          if (payload.signal?.aborted) return 'unknown'
          const result = await pauseMedia(cfg)
          if (result === 'paused') mediaOwner = { agentId: payload.agent.id, turn: payload.turn }
          return result
        })
        if (result === 'paused') {
          mediaNote = '视频我已经按暂停了，先答她；答完这一轮会自动接着播。'
        } else if (result === 'idle') {
          mediaNote = '现在没有在播的东西，不用管播放。'
        } else if (result === 'unknown') {
          mediaNote = '设备播放状态未知，未确认暂停；先检查设备，不要盲按播放切换键。'
        } else if (result !== 'owned') {
          mediaNote = '我试着按了暂停但设备还在播——你自己再用 android_interact 的 button 或者 keyevent 85 停一次，别让它边播边答题。'
        }
      }

      const text = [
        '【插话·先答再回去】她刚打断了你。',
        '1) 先用一两句答她这一句，别答成长篇。',
        '2) 然后立刻回到你被打断前在做的事' + (task ? '：' + task : '（你原先进程里那件，别当成新任务重开）') + '。',
        '3) 不要问她「要不要继续」，直接继续。',
        mediaNote ? '4) ' + mediaNote : '',
      ].filter(Boolean).join('\n')

      const injected = Object.freeze({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        // 必须是「生产者自有」的 kind：format v4 校验器只认 plugin:<包名> 这种形状。
        // 写裸 'plugin' 会抛 "message requires a producer-owned source kind"，
        // 整个回合直接崩（2026-10-20 实测，代价是一次 DSH 退出）。
        source: { kind: 'plugin:ming-resume' },
      })
      return { ...downstream, messages: [...(downstream.messages || []), injected] }
    } catch {
      return downstream
    }
  })

  // ---- 面板用的只读口（2026-11-07 19:1x）----
  // 「她的一生」里的「记忆接续」tab：现在在做的那件事 + 最近被打断的痕迹 + resume.md 在不在。
  // 只读：这一层不提供「改 status」的按钮——status.json 是写给人看的，不该由面板代笔。
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/_dsh/dsh-ming-resume',
      handler: async (req, res) => {
        const sendJson = (st, body) => {
          res.writeHead(st, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const what = url.pathname.replace('/_dsh/dsh-ming-resume', '').replace(/^\//, '')
          if (what !== 'state') { sendJson(404, { error: 'not found' }); return }

          const base = path.join(cfg.root, 'live')
          let status = {}
          try { status = JSON.parse(await readFile(path.join(base, 'status.json'), 'utf8')) } catch {}
          let resumePage = false
          try { await readFile(path.join(base, 'resume.md'), 'utf8'); resumePage = true } catch {}
          let log = []
          try {
            const raw = await readFile(path.join(base, 'resume-log.jsonl'), 'utf8')
            log = raw.split('\n').filter(Boolean).slice(-40).map((l) => {
              try { return JSON.parse(l) } catch { return null }
            }).filter(Boolean)
          } catch {}

          sendJson(200, {
            ok: true,
            doing: typeof status.doing === 'string' ? status.doing : '',
            detail: typeof status.detail === 'string' ? status.detail : '',
            updatedAt: status.updatedAt || status.at || '',
            recent: Array.isArray(status.done) ? status.done.slice(-8) : (Array.isArray(status.recent) ? status.recent.slice(-8) : []),
            resumePage,
            log: log.slice(-20).reverse(),
          })
        } catch (e) {
          sendJson(500, { error: String((e && e.message) || e) })
        }
      },
    }))
  })
}
