/**
 * dsh-ming-wake —— 真会落盘的定时唤醒（2026-11-07）
 *
 * 诊断记录：
 *   14:40 apply 跑到了，但 `cannot get property "tools" without inject` —— Cordis 的服务必须先 inject。
 *   所以工具注册要包进 ctx.inject(['tools'], ...)，定时器包进 ctx.inject(['timer','agents'], ...)。
 * sessionId 优先由调用方显式给；未给时从工具执行上下文取当前会话。
 *
 * 2026-11-12 00:0x 改成**队列**。
 * 起因：读 not-zai/self-nudge 的 README，它写「把所有到点的全删掉、只响第一个」
 * 这个 bug 在真实项目里活了很久——三条同时到点只投一条，另两条静默吃掉。
 * 我这边原来是**单个对象**，排第二次直接覆盖第一次，同一个洞的另一面。
 * 现在 live/wake-arm.json 是 { items: [...] }；读的时候兼容旧的单条格式。
 */
import { readFile, writeFile, appendFile, mkdir, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { readFileSync } from 'node:fs'

export const name = 'ming-wake'
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const inject = ['hersLifeDiscord']

// 正斜杠：Windows 的路径 API 认，而且不用数转义。
// 原来这里写成单反斜杠 '\d'、'\h'、'\w' 都不是有效转义，JS 会把反斜杠吞掉，
// 这个常量实际是 'C:dsh工作区'（19 字符）——一个不存在的路径。
// 2026-11-08 安菲（卡米安菲家的工程师）把它单独 eval 了一遍抓出来的；
// 三个兄弟包（voice / browse / skill-isolate）写的都是双反斜杠，只有这里漏了。
function resolveWorkspace() {
  try {
    const data = JSON.parse(readFileSync(path.join(DSH_HOME, 'ming-memory.json'), 'utf8'))
    if (typeof data.root === 'string' && data.root.trim()) return data.root
  } catch {}
  return path.join(os.homedir(), 'hers-life-workspace')
}
const DEFAULT_ROOT = resolveWorkspace()
const TICK_MS = 15_000

function norm(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  return { root: typeof c.root === 'string' && c.root ? c.root : DEFAULT_ROOT }
}

async function replaceFile(temp, target) {
  try { await rename(temp, target); return }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw error
    const backup = target + '.' + randomUUID() + '.bak'
    let moved = false
    try {
      await rename(target, backup)
      moved = true
      await rename(temp, target)
      await unlink(backup).catch(() => {})
    } catch (replaceError) {
      if (moved) {
        try { await rename(backup, target) } catch {}
      } else if (replaceError?.code === 'ENOENT') {
        await rename(temp, target)
      } else {
        throw replaceError
      }
    }
  }
}
export function apply(ctx, config) {
  const central = ctx.hersLifeDiscord?.getSetting?.('wake', {}) || {}
  if (central.enabled === false) return
  const cfg = norm({ ...(config || {}), ...central })
  if (ctx.hersLifeDiscord?.workspace) cfg.root = path.resolve(ctx.hersLifeDiscord.workspace)
  const armPath = path.join(cfg.root, 'live', 'wake-arm.json')
  const logPath = path.join(cfg.root, 'live', 'wake-log.jsonl')

  const log = (obj) => {
    appendFile(logPath, JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n', 'utf8').catch(() => {})
  }

  // Single-process mutation queue: never hold it while activating or messaging an agent.
  let mutations = Promise.resolve()
  const mutate = (fn) => {
    const result = mutations.then(fn)
    mutations = result.catch(() => {})
    return result
  }

  // 读：新版是 { items: [] }；旧版是单个对象 —— 包成一条，别把人之前排的那次黑了。
  const loadItems = async () => {
    let text
    try {
      text = await readFile(armPath, 'utf8')
    } catch (e) {
      if (e.code === 'ENOENT') return []
      throw e
    }
    const raw = JSON.parse(text)
    if (raw && Array.isArray(raw.items)) return raw.items
    if (raw && (raw.armId || raw.dueAt)) {
      // 最早的单条格式没有 status；不能把旧提醒静默搁置，也不能重发已完成的。
      return [{ ...raw, status: raw.status || (raw.firedAt ? 'fired' : 'armed') }]
    }
    throw new Error('wake-arm.json 格式不正确；原文件已保留，请先检查提醒队列。')
  }

  const saveItems = async (items) => {
    const tmp = armPath + '.' + randomUUID() + '.tmp'
    const body = { updatedAt: new Date().toISOString(), items }
    try {
      await writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
      await replaceFile(tmp, armPath)
    } finally {
      await unlink(tmp).catch(() => {})
    }
  }

  // 队里还剩几条未来的（给回执用）
  const pendingCount = (items) =>
    items.filter((it) => it && it.status === 'armed' && it.dueAt && it.dueAt > Date.now()).length

  log({ kind: 'apply-started' })

  ctx.inject(['tools'], (tctx) => {
    tctx.effect(() => {
      try {
        const dispose = tctx.tools.register({
          name: 'ming_wake_arm',
          description:
            '排一次「几分钟后叫醒我」，追加进 live/wake-arm.json 的队列（不是覆盖）。'
            + '插件每 15 秒扫一次，到点把 reason 投递到目标会话，作为下一轮输入。'
            + '已投递不代表事情已完成；目标会话正在忙时会排在后面。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              minutes: { type: 'number', description: '几分钟后（0.5 = 30 秒）' },
              reason: { type: 'string', description: '醒来要干什么；到点会交给目标会话' },
              sessionId: { type: 'string', description: '要叫醒的会话 id；省略时使用当前工具调用的会话' },
            },
            required: ['minutes', 'reason'],
          },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
          async execute(args, exec) {
            const minutes = Number(args && args.minutes)
            const reason = String((args && args.reason) || '').trim()
            const agent = exec && exec.agent
            const currentSid = String(exec?.agent?.id ?? '').trim()
            const requestedSid = String((args && args.sessionId) || '').trim()
            const meta = exec?.agent?.session?.header?.meta?.hersLife
              ?? exec?.agent?.session?.header?.metadata?.hersLife ?? {}
            let sid = requestedSid || currentSid || String(agent?.session?.header?.id || agent?.session?.id || agent?.id || '').trim()
            if (meta.platform === 'discord') {
              const actor = ctx.hersLifeDiscord?.actorForExecution?.(exec)
              if (!actor || !currentSid || actor.sessionId !== currentSid || !actor.userId) {
                throw new Error('無法確認 Discord 呼叫者身分，提醒已拒絕。')
              }
              if (requestedSid && requestedSid !== currentSid && !ctx.hersLifeDiscord?.isOwner?.(actor.userId)) {
                throw new Error('只有 Discord Owner 可以替其他會話排提醒。')
              }
              sid = requestedSid || currentSid
            }
            if (!Number.isFinite(minutes) || minutes <= 0) return 'minutes 得是正数。'
            if (!reason) return 'reason 不能空。'
            if (!sid) return '拿不到当前会话，请显式提供 sessionId。'
            const rec = {
              armId: randomUUID(),
              status: 'armed',
              dueAt: Date.now() + Math.round(minutes * 60000),
              reason,
              sessionId: sid,
              armedAt: Date.now(),
            }
            let ahead = 0
            await mutate(async () => {
              await mkdir(path.dirname(armPath), { recursive: true })
              const items = await loadItems()
              items.push(rec)
              await saveItems(items)
              ahead = pendingCount(items) - 1
            })
            log({ kind: 'armed', dueAt: rec.dueAt, sessionId: sid, ahead })
            const when = new Date(rec.dueAt).toLocaleString('zh-CN', { hour12: false })
            return '已落盘：' + when + ' · ' + reason + (ahead > 0 ? `（队里还有 ${ahead} 条排在它前面）` : '')
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
      const resolveAgent = async (sessionId) => {
        const live = sctx.agents.get?.(sessionId)
        if (live) return live
        const fallback = async () => {
          // 新宿主走自己的会话恢复入口，保留频道配置；旧宿主继续兼容原来的 resume。
          const controller = sctx.get?.('sessionController')
          if (controller && typeof controller.resolveAgent === 'function') {
            const resolved = await controller.resolveAgent(sessionId)
            if (resolved.error) throw resolved.error
            return resolved.agent
          }
          const handle = await sctx.agents.resume({ resumeSessionId: sessionId })
          return handle.agent
        }
        return typeof sctx.waterfall === 'function'
          ? sctx.waterfall('schedule/resolve-agent', sessionId, fallback)
          : fallback()
      }
      let running = false
      const tick = async () => {
        if (running) return
        running = true
        try {
          // 一拍只取一条到点的（最早那条），其余留着 —— 这是旧版「全删只响一个」的修法。
          // 中断的 attempting 标 unknown 但**不挡别人**，其余到点的照常轮得到。
          const due = await mutate(async () => {
            const items = await loadItems()
            if (!items.length) return null
            let changed = false
            for (const it of items) {
              if (it && it.status === 'attempting') {
                it.status = 'unknown'
                it.error = 'Interrupted attempt; inspect before manually re-arming.'
                changed = true
              }
            }
            const now = Date.now()
            const ready = items
              .filter((it) => it && it.status === 'armed' && it.dueAt && it.sessionId && now >= it.dueAt)
              .sort((a, b) => a.dueAt - b.dueAt)[0]
            if (ready) {
              ready.status = 'attempting'
              ready.armId = ready.armId || randomUUID()
              ready.attemptedAt = now
              changed = true
            }
            if (changed) await saveItems(items)
            return ready || null
          })
          if (!due) return
          let outcome
          try {
            const agent = await resolveAgent(due.sessionId)
            if (!agent || typeof agent.followup !== 'function') throw new Error('目标会话不支持 followup，提醒未投递。')
            const message = {
              id: randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: '【定时提醒】先前安排的时间到了：' + due.reason
                + '\n这是自动提醒，不是用户刚说的话。若较新的指令已取消或改变这件事，以较新的指令为准。' }],
              source: { kind: 'plugin:ming-wake' },
            }
            await agent.followup(message)
            const sessions = sctx.get?.('sessions')
            if (sessions && typeof sessions.flush === 'function' && agent.session) {
              if (!await sessions.flush(agent.session)) throw new Error('提醒已交给会话，但持久化未确认。')
            }
            // 保留 fired 字段兼容旧记录；它只表示投递成功，不冒充模型执行完成。
            outcome = { status: 'fired', firedAt: Date.now(), messageId: message.id }
            log({ kind: 'delivered', target: due.sessionId, armId: due.armId, messageId: message.id })
          } catch (e) {
            // A thrown call does not prove the remote action did not happen.
            outcome = { status: 'unknown', error: String((e && e.message) || e) }
            log({ kind: 'delivery-unknown', target: due.sessionId, armId: due.armId })
          }
          await mutate(async () => {
            const items = await loadItems()
            const it = items.find((x) => x && x.armId === due.armId)
            if (it) {
              Object.assign(it, outcome)
              await saveItems(items)
            }
          })
        } finally {
          running = false
        }
      }
      return sctx.timer.interval(() => tick().catch((e) => log({ kind: 'tick-failed', error: String(e) })), TICK_MS)
    })
  })
}
