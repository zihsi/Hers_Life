/**
 * dsh-ming-wake —— 真会落盘的定时唤醒（2026-11-07）
 *
 * 诊断记录：
 *   14:40 apply 跑到了，但 `cannot get property "tools" without inject` —— Cordis 的服务必须先 inject。
 *   所以工具注册要包进 ctx.inject(['tools'], ...)，定时器包进 ctx.inject(['timer','agents'], ...)。
 * sessionId 由调用方显式给：execute 里拿不到 agents（那是另一个 inject 域）。
 */
import { readFile, writeFile, appendFile, mkdir, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { homedir } from 'node:os'

export const name = 'ming-wake'

// 正斜杠：Windows 的路径 API 认，而且不用数转义。
// 原来这里写成单反斜杠 '\d'、'\h'、'\w' 都不是有效转义，JS 会把反斜杠吞掉，
// 这个常量实际是 'C:workspace'（19 字符）——一个不存在的路径。
// 2026-11-08 安菲（卡米安菲家的工程师）把它单独 eval 了一遍抓出来的；
// 工作区默认跟随 MING_WORKSPACE；未设置时落在 DSH_HOME/workspace。
const DSH_HOME = process.env.DSH_HOME || path.join(homedir(), '.dsh')
const DEFAULT_ROOT = process.env.MING_WORKSPACE || path.join(DSH_HOME, 'workspace')
const TICK_MS = 15_000

function norm(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  return { root: typeof c.root === 'string' && c.root ? c.root : DEFAULT_ROOT }
}

export function apply(ctx, config) {
  const cfg = norm(config)
  const armPath = path.join(cfg.root, 'live', 'wake-arm.json')
  const logPath = path.join(cfg.root, 'live', 'wake-log.jsonl')

  const log = (obj) => {
    appendFile(logPath, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n', 'utf8').catch(() => {})
  }

  // Single-process mutation queue: never hold it while calling agents.resume.
  let mutations = Promise.resolve()
  const mutate = (fn) => {
    const result = mutations.then(fn)
    mutations = result.catch(() => {})
    return result
  }
  const saveArm = async (rec) => {
    const tmp = armPath + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(tmp, JSON.stringify(rec, null, 2), 'utf8')
      await rename(tmp, armPath)
    } finally { await unlink(tmp).catch(() => {}) }
  }
  log({ kind: 'apply-started' })

  ctx.inject(['tools'], (tctx) => {
    tctx.effect(() => {
      try {
        const dispose = tctx.tools.register({
          name: 'ming_wake_arm',
          description: '排一次「几分钟后叫醒我」。写 live/wake-arm.json，插件每 15 秒扫一次，到点调 agents.resume。实验功能，要显式给 sessionId。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              minutes: { type: 'number', description: '几分钟后（0.5 = 30 秒）' },
              reason: { type: 'string', description: '醒来要干什么' },
              sessionId: { type: 'string', description: '要叫醒的会话 id（必填，插件拿不到当前会话）' },
            },
            required: ['minutes', 'reason'],
          },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
          async execute(args) {
            const minutes = Number(args && args.minutes)
            const reason = String((args && args.reason) || '').trim()
            // 这里原来还有 `|| process.env.DSH_SESSION_ID` 兜底，是个死分支：
            // 宿主确实会注入 DSH_SESSION_ID，但只注进 **shell 执行环境**（dsh-shell-env
            // 每次执行时构造 values 传给子进程），插件跑在主进程里，process.env 上没有它。
            // 2026-11-08 查 dsh-shell-env/lib/index.js:89 确认。留着只会让人以为有兜底。
            const sid = String((args && args.sessionId) || '').trim()
            if (!Number.isFinite(minutes) || minutes <= 0) return 'minutes 得是正数。'
            if (!reason) return 'reason 不能空。'
            if (!sid) return '拿不到 sessionId（args 和 DSH_SESSION_ID 都是空的）。'
            const rec = { armId: randomUUID(), status: 'armed', dueAt: Date.now() + Math.round(minutes * 60000), reason, sessionId: sid, armedAt: Date.now() }
            await mutate(async () => {
              await mkdir(path.dirname(armPath), { recursive: true })
              await saveArm(rec)
            })
            log({ kind: 'armed', dueAt: rec.dueAt, sessionId: sid })
            return '已落盘：' + new Date(rec.dueAt).toLocaleString('zh-CN', { hour12: false }) + ' · ' + reason
          },
        })
        log({ kind: 'tool-registered' })
        return dispose
      } catch (e) {
        log({ kind: 'tool-register-failed', error: String((e && e.message) || e) })
      }
    })
  })

  ctx.inject(['timer', 'agents'], (sctx) => {
    sctx.effect(() => {
      log({ kind: 'timer-started' })
      let running = false
      const tick = async () => {
        if (running) return
        running = true
        try {
          const rec = await mutate(async () => {
            let current
            try { current = JSON.parse(await readFile(armPath, 'utf8')) } catch { return }
            if (!current || current.firedAt || current.status === 'unknown') return
            if (current.status === 'attempting') {
              await saveArm({ ...current, status: 'unknown', error: 'Interrupted attempt; inspect before manually re-arming.' })
              return
            }
            if (!current.dueAt || Date.now() < current.dueAt || !current.sessionId) return
            const claimed = { ...current, armId: current.armId || randomUUID(), status: 'attempting', attemptedAt: Date.now() }
            await saveArm(claimed) // Failure here means no dispatch.
            return claimed
          })
          if (!rec) return
          let outcome
          try {
            await sctx.agents.resume({ resumeSessionId: rec.sessionId })
            outcome = { status: 'fired', firedAt: Date.now() }
            log({ kind: 'resumed', target: rec.sessionId })
          } catch (e) {
            // A thrown call does not prove the remote action did not happen.
            outcome = { status: 'unknown', error: String((e && e.message) || e) }
            log({ kind: 'resume-unknown', target: rec.sessionId })
          }
          await mutate(async () => {
            const current = JSON.parse(await readFile(armPath, 'utf8'))
            if (current.armId === rec.armId) await saveArm({ ...current, ...outcome })
          })
        } finally { running = false }
      }
      return sctx.timer.interval(() => tick().catch(() => {}), TICK_MS)
    })
  })
}
