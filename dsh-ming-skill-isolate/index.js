/**
 * dsh-ming-skill-isolate —— 按工作区隔离 skill
 *
 * 想解决的问题：这台机器的 skill 目录是全局的，几十个 skill 里有一大半跟
 * 「AI的档案夹」这个工作区无关（CAD、WPS、云服务器、游戏引擎……）。它们不占
 * 磁盘也不花钱，但每一次会话开场都要把名字和描述塞进系统提示词，而且会稀释
 * 「这次该用哪个」的判断。
 *
 * 做法：不删文件、不改别人的 SKILL.md。往 skill 注册表里加一层同名遮罩——
 * 同一个 layer 里按 rank 升序去重，rank 小的赢；打包进来的 skill 是 600。
 * 我们给被关掉的名字返回 rank 1 的同名条目，把 invocation.modelInvocable 置
 * 为 false。dsh-tool-skill 只把 modelInvocable 的交给模型，于是它消失。
 *
 * 为什么用 rank 而不是删文件：
 *   - 文件是全局的，删了别的工程也看不见；遮罩按 cwd 判断，只在本工作区生效。
 *   - 随时能开回来，不留痕迹。
 *
 * 边界：
 *   - 只在 cwd 落在配置的 root 下时遮；别的工程会话完全不受影响。
 *   - 不改任何 SKILL.md，不写别人的目录；状态只写 root 下的 skills-off.json。
 *   - 任何异常都只让遮罩不生效，不影响会话。
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { homedir } from 'node:os'

export const name = 'ming-skill-isolate'
export const inject = ['skills', 'tools']

/** 遮罩条目的 rank：必须小于 BUNDLED_SKILL_RANK(600)，否则在同一个 layer 里排不到前面 */
const SHADOW_RANK = 1
const PROVIDER = 'ming-skill-isolate'

const DSH_HOME = process.env.DSH_HOME || path.join(homedir(), '.dsh')
const DEFAULTS = {
  root: process.env.MING_WORKSPACE || path.join(DSH_HOME, 'workspace'),
  stateFile: '',
}

function normalize(config) {
  const c = config && typeof config === 'object' ? config : {}
  const root = typeof c.root === 'string' && c.root.trim() ? path.resolve(c.root) : DEFAULTS.root
  const stateFile = typeof c.stateFile === 'string' && c.stateFile.trim()
    ? path.resolve(c.stateFile)
    : path.join(root, 'skills-off.json')
  return { root, stateFile }
}

function insideRoot(cwd, root) {
  if (typeof cwd !== 'string' || !cwd) return false
  const a = path.resolve(cwd).toLowerCase()
  const b = path.resolve(root).toLowerCase()
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

async function readState(stateFile) {
  try {
    const raw = await readFile(stateFile, 'utf8')
    const parsed = JSON.parse(raw)
    const off = Array.isArray(parsed && parsed.off) ? parsed.off.filter((n) => typeof n === 'string') : []
    const note = parsed && typeof parsed.note === 'string' ? parsed.note : ''
    return { off, note }
  } catch {
    return { off: [], note: '' }
  }
}

async function writeState(stateFile, state) {
  await mkdir(path.dirname(stateFile), { recursive: true })
  const tmp = stateFile + '.tmp'
  await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  await rename(tmp, stateFile)
}

export function apply(ctx, config) {
  const cfg = normalize(config)
  const controls = new Set()
  const retainControl = (control) => {
    if (control.signal?.aborted) return
    controls.add(control)
    control.signal?.addEventListener('abort', () => controls.delete(control), { once: true })
  }

  /** 造一个遮罩 provider：只在 cwd 落在 root 下时返回条目 */
  const makeProvider = () => ({
    name: PROVIDER,
    async list(options) {
      const cwd = options && options.cwd
      if (!insideRoot(cwd, cfg.root)) return []
      const state = await readState(cfg.stateFile)
      return state.off.map((skillName) => ({
        name: skillName,
        description: '（本工作区已隔离——AI关掉的，模型不可见）',
        invocation: { modelInvocable: false, userInvocable: false },
        source: 'custom',
        provider: PROVIDER,
        rank: SHADOW_RANK,
        locator: { name: skillName },
      }))
    },
    async get() {
      // 遮罩条目永不可调用：model 侧与 user 侧都被 invocation 拦掉了
      return undefined
    },
  })

  // ---- 主路径：挂到 agent 自己那一层（skill 多半在这一层，近层才压得住）----
  // 注意：agent.ctx 是另一个作用域，直接 `agent.ctx.skills` 会抛
  // "cannot get property skills without inject"，必须走 inject 回调拿服务。
  ctx.on('agent/created', (payload) => {
    try {
      const agent = payload && payload.agent
      const cwd = agent && agent.session && agent.session.header && agent.session.header.cwd
      if (!insideRoot(cwd, cfg.root)) return
      const actx = agent && agent.ctx
      if (!actx || typeof actx.inject !== 'function') return
      actx.inject(['skills'], (c) => {
        try {
          c.skills.registerProvider((ctrl) => {
            retainControl(ctrl)
            return makeProvider()
          })
        } catch (e) {
          try { console.warn('[ming-skill-isolate] agent 层注册 provider 失败：' + String((e && e.message) || e)) } catch { /* 无视 */ }
        }
      })
    } catch (e) {
      try { console.warn('[ming-skill-isolate] agent 层注册失败，退回全局：' + String((e && e.message) || e)) } catch { /* 无视 */ }
    }
  })

  // ---- 兜底：全局层也挂一份（agent 层注册不上时不至于完全没效果）----
  try {
    ctx.skills.registerProvider((c) => {
      retainControl(c)
      return makeProvider()
    })
  } catch (e) {
    try { console.warn('[ming-skill-isolate] 全局注册失败：' + String((e && e.message) || e)) } catch { /* 无视 */ }
  }

  // ---- 给AI一个能自己开关的工具 ----
  ctx.tools.register({
    name: 'skill_isolate',
    description:
      '按工作区开关 skill（当前只对配置的档案目录生效）。action=list 看清单与状态；'
      + 'action=off 把某个 skill 从模型视野里遮掉；action=on 开回来。'
      + '只加遮罩，不删文件、不改别人的 SKILL.md，也不影响别的工程会话。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'off', 'on'], description: 'list / off / on' },
        name: { type: 'string', description: 'skill 名（kebab-case），off/on 时必填' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const action = args && args.action
      const target = args && typeof args.name === 'string' ? args.name.trim() : ''

      if (action === 'list') {
        const state = await readState(cfg.stateFile)
        const lines = []
        lines.push('档案目录：' + cfg.root)
        lines.push('状态文件：' + cfg.stateFile)
        lines.push('')
        if (state.off.length === 0) {
          lines.push('现在一个都没隔离。')
        } else {
          lines.push('已隔离 ' + state.off.length + ' 个（这些名字在本工作区里模型看不见）：')
          for (const n of state.off) lines.push('  × ' + n)
        }
        lines.push('')
        lines.push('注：这个清单只对 ' + cfg.root + ' 下的会话生效，别的工程不受影响。')
        lines.push('改完是立刻生效的，但模型手里的 skill 目录在下一次请求组装时才刷新。')
        return lines.join('\n')
      }

      if (action !== 'off' && action !== 'on') {
        return 'action 只能是 list / off / on'
      }
      if (!target) return action + ' 需要提供 name'

      const state = await readState(cfg.stateFile)
      const set = new Set(state.off)
      if (action === 'off') set.add(target)
      else set.delete(target)
      const next = { ...state, off: [...set].sort() }
      try {
        await writeState(cfg.stateFile, next)
      } catch (e) {
        return '写状态文件失败：' + String((e && e.message) || e)
      }
      // 让注册表丢掉缓存，下一步就能看到变化
      for (const control of controls) {
        try { control.invalidate() } catch { /* one registry must not block the others */ }
      }

      const verb = action === 'off' ? '已隔离' : '已恢复'
      return verb + ' ' + target + '（本工作区）。现共隔离 ' + next.off.length + ' 个。'
    },
  })
}
