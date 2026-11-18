/**
 * dsh-ming-resume —— 插话之后记得回去
 *
 * 问题：Discord 通道开 newMessagePolicy=steer 之后，她在我干活时插一句，那句会被塞进
 * 当前回合的下一步。能插话了，但副作用是：我答完她，很容易把原来在做的事丢在那儿
 * ——因为没有任何东西提醒我「刚才被打断了」。
 *
 * 宿主的真相：没有「暂停/恢复任务」这种对象。一个回合就是一串步骤，插话只是往
 * 下一步多塞一条消息。所以「继续」不是机制问题，是记性问题：我要知道自己在干什么。
 *
 * 做法：agent/pre-step 里看一眼这一步进来的消息，如果里面有 Discord 通道的插话
 * （source.kind === 'plugin:hers-life-discord'，这是 bridge.steerMessage 的唯一写法），
 * 就追加一条接续提示：普通插话后回到原任务；停止、暂停或改任务时服从新指令。
 *
 * 边界：
 *   · 找不到 status.json 就只说「回到你被打断前的事」，不编具体内容。
 *   · 只认 plugin:hers-life-discord 这个 source，别把普通 Discord 訊息也当成插话。
 *   · 任何异常都不影响这一步。
 */
import { readFile, appendFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'

export const name = 'ming-resume'
const DSH_HOME = process.env.DSH_HOME || path.join(DSH_HOME)
export const inject = ['hersLifeDiscord']
function resolveWorkspace() {
  if (process.env.MING_WORKSPACE) return process.env.MING_WORKSPACE
  try {
    const data = JSON.parse(readFileSync(path.join(DSH_HOME, 'ming-memory.json'), 'utf8'))
    if (typeof data.root === 'string' && data.root.trim()) return data.root
  } catch {}
  return path.join(os.homedir(), 'hers-life-workspace')
}

const STEER_SOURCE = 'plugin:hers-life-discord'
const DEFAULTS = {
  root: resolveWorkspace(),
  adbPath: 'D:\\MuMuPlayer\\nx_device\\12.0\\shell\\adb.exe',
  serial: '127.0.0.1:7555',
  /** 插话时把正在播的视频暂停，答完再接着播（2026-10-20 浔定的）。 */
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
    return Boolean(src && src.kind === STEER_SOURCE)
  } catch {
    return false
  }
}

// 只识别明确的停止/换任务指令来取消自动续播；一般自然语言意图仍由模型结合最新消息判断。
// 不用“包含停止二字”判断，避免把「不要停止」「停止按钮在哪」或引用的话误当命令。
function requestsPause(msg) {
  const text = (Array.isArray(msg?.content) ? msg.content : [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
    .replace(/^\s*<user_message[^>]*>/i, '').replace(/<\/user_message>\s*$/i, '').trim()
  return text.split(/[，,。！!？?；;\n]/).some((part) => {
    const s = part.trim()
    return /^(?:(?:请|麻烦你)\s*)?(?:(?:先)?(?:停下|停一下|暂停|停止|取消)(?=$|[吧了来]|原任务|这|当前|任务|视频|播放|浏览|工作)|(?:先)?(?:别|不要|不用|不必|无需)(?:再)?(?:继续|恢复|做了|执行|播放|播了))/.test(s)
      || /^(?:please\s+)?(?:stop|pause|cancel)(?:\s+(?:it|this|that|the\s+(?:task|video|playback)))?\s*$/i.test(s)
      || /^(?:(?:请|麻烦你)\s*)?(?:换(?:个|一个)?任务|改做别的)(?:吧|了)?$/.test(s)
  })
}

// ---------- 插话就暂停视频，答完接着播（2026-10-20 浔定的） ----------
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
  if (ctx.hersLifeDiscord?.workspace) cfg.root = path.resolve(ctx.hersLifeDiscord.workspace)
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
    // 取消的回合不一定会发 turn-stopping；后续任何一步都可清掉其续播权。
    if (mediaOwner?.signal?.aborted) { mediaOwner = null; return }
    if (!mediaOwner || mediaOwner.agentId !== payload?.agent?.id || mediaOwner.turn !== payload?.turn) return
    mediaOwner = null
    if (payload.signal?.aborted) return
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

      const holdMedia = fresh.some(requestsPause)
      if (holdMedia) await serialMedia(async () => {
        if (mediaOwner?.agentId === payload?.agent?.id) mediaOwner = null
      })

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
          if (mediaOwner?.signal?.aborted) mediaOwner = null
          if (mediaOwner) return 'owned'
          if (payload.signal?.aborted) return 'unknown'
          const result = await pauseMedia(cfg)
          if (result === 'paused' && !holdMedia && !payload.signal?.aborted) {
            mediaOwner = { agentId: payload.agent.id, turn: payload.turn, signal: payload.signal }
          }
          return result
        })
        if (result === 'paused') {
          mediaNote = holdMedia
            ? '视频已暂停；本插件不会自动续播，等待新的播放指令。'
            : '视频我已经按暂停了，先答她；普通插话结束后会自动接着播。'
        } else if (result === 'idle') {
          mediaNote = '现在没有在播的东西，不用管播放。'
        } else if (result === 'unknown') {
          mediaNote = '设备播放状态未知，未确认暂停；先检查设备，不要盲按播放切换键。'
        } else if (result !== 'owned') {
          mediaNote = '我试着按了暂停但设备还在播——你自己再用 android_interact 的 button 或者 keyevent 85 停一次，别让它边播边答题。'
        }
      }

      const text = [
        '【插话·按最新指令接续】她刚打断了你。',
        '1) 先回应她最新的消息；最新的停止、暂停、取消或改任务要求优先。',
        '2) 只有普通插话、她没有改变安排时，才接着做被打断前的事' + (task ? '：' + task : '（你原先进程里那件）') + '。',
        '3) 若她要求停止、暂停或换任务，就按新要求处理，不要自动回到旧任务；状态文件只是旧进度，不是继续执行的授权。',
        holdMedia ? '她这次有明确的停止、暂停或换任务指令，不要把它当成普通插话。' : '',
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
          const rejection = webCtx.connection?.requestRejection?.(req)
          if (rejection !== undefined) { sendJson(rejection || 403, { error: 'rejected' }); return }

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

// 使用真实模块测试媒体状态机；不启动设备或改变运行依赖。
export const __internals = { requestsPause }
