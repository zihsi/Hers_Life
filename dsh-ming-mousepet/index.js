/**
 * dsh-ming-mousepet · 独立鼠标键盘
 *
 * 只做“输入”这一层：鼠标、键盘、滚轮、拖拽、截图定位。
 * 默认走 UIA / 窗口消息，不移动主人的真实光标、不抢键盘焦点；
 * 物理输入是显式回退，主人一碰鼠标键盘就暂停并还原光标。
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InputEngine } from './lib/engine.js'
import { judgeNudge, shouldMuteSay, loadPetState, savePetState, spokenToday , updatePetState, normalizeSchedulePatch } from './lib/pet.js'
import { ensureWorkspace, resolveCardPath, startTalker } from './lib/talker.js'
import { listSessions } from './lib/sessions.js'
import { createCardSessionBridge } from './lib/card-session.js'
import { createCard } from './lib/card.js'

export const name = 'ming-mousepet'
export const inject = ['tools', 'attachments', 'webServer']

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PREVIEW_DIR = join(PLUGIN_DIR, 'assets', 'previews')
const SETTINGS_FILE = join(DSH_HOME, 'ming-mousepet', 'settings.json')
// 2026-11-08：用户自己加的皮肤。内置那十五只只读，这里的是可增可删的。
const SKINS_DIR = join(DSH_HOME, 'ming-mousepet', 'skins')
const SKIN_NAME_RE = /^[a-z0-9_-]{1,40}$/i
const STYLE_IDS = [
  'pointer', 'work', 'unavailiable', 'link', 'text',
  'cross', 'busy', 'move', 'vert', 'horz',
  'help', 'handwriting', 'dgn1', 'dgn2', 'alternate',
]

function toLosslessJson(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(toLosslessJson)
  const out = {}
  for (const [key, item] of Object.entries(value)) out[key] = toLosslessJson(item)
  return out
}

async function loadDefineTool(overridePath = '') {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    if (mod?.defineTool) return mod.defineTool
  } catch { /* 本地测试时走环境变量 */ }
  const override = overridePath || process.env.DSH_TOOLS_PATH
  if (override) {
    const { pathToFileURL } = await import('node:url')
    const mod = await import(pathToFileURL(override).href)
    if (mod?.defineTool) return mod.defineTool
  }
  // 最小兜底：只在没有 DSH 的单元测试里用；真实宿主一定有 dsh-tools。
  return (definition) => definition
}

function statusText(s) {
  const paused = s?.paused ? `已暂停（${s.pauseReason || '主人接管'}）` : '运行中'
  const age = Number.isFinite(s?.lastUserInputAgeMs) && s.lastUserInputAgeMs >= 0
    ? `${Math.round(s.lastUserInputAgeMs)}ms 前`
    : '还没记录'
  const fg = s?.foreground?.title || s?.foreground?.className || '未知'
  const cursor = s?.cursor ? `(${s.cursor.x}, ${s.cursor.y})` : '未知'
  const mode = s?.cursorMode === 'clean'
    ? `整洁模式（动作后约 ${s?.cursorHoldMs || 2600}ms 收起，${s?.cursorSize || 64}px · ${s?.cursorState || 'pointer'}）`
    : `陪伴模式（一直显示，${s?.cursorSize || 64}px · ${s?.cursorState || 'pointer'}）`
  const lines = [
    `独立输入：${paused}`,
    `主人最近一次真实输入：${age}`,
    `真实光标：${cursor} · AI 光标：${s?.overlay ? '显示' : '隐藏'} · ${mode}`,
    (s?.cursorOverlay?.hasLast
      ? `AI 光标坐标：(${s.cursorOverlay.x}, ${s.cursorOverlay.y})（物理像素）`
      : 'AI 光标坐标：还没落过位'),
    `前台窗口：${fg}`,
  ]
  if (s?.paused) {
    lines.push('⚠ 主人已经暂停/接管输入。不要继续操作；等主人说“继续”，再调用 action:"resume"。')
  } else {
    lines.push(`主人随时可按 ${s?.hotkey || 'Ctrl+Alt+Q'} 暂停。`)
  }
  return lines.join('\n')
}

function windowsText(r) {
  const list = Array.isArray(r?.windows) ? r.windows : []
  if (!list.length) return '没读到可用窗口。'
  const lines = list.slice(0, 24).map((w) => {
    const rect = w.rect ? `${w.rect.x},${w.rect.y} ${w.rect.w}x${w.rect.h}` : '?'
    const mark = w.foreground ? ' ★前台' : ''
    return `hwnd ${w.hwnd} · ${w.title} · ${rect} · ${w.process || ''}${mark}`.trim()
  })
  if (list.length > 24) lines.push(`……还有 ${list.length - 24} 个窗口未列出`)
  return lines.join('\n')
}

function resultText(action, r) {
  if (!r || typeof r !== 'object') return `已执行 ${action}。`
  if (r.paused) {
    return `⚠ 主人已经暂停/接管输入，动作没有执行。\n${r.note || '等主人说继续，再 action:"resume"。'}`
  }
  if (r.ok === false) {
    const bits = [`未完成（${r.reason || '未知原因'}）`]
    if (r.name) bits.push(`目标：${r.name}`)
    if (r.type) bits.push(`类型：${r.type}`)
    if (r.note) bits.push(r.note)
    if (r.needsPhysical) bits.push('如果必须物理点击，明确传 mode:"physical"。')
    return bits.join('\n')
  }
  if (action === 'capture') {
    return `截图已保存：${r.path}\n${r.attached ? '图已附在本条结果里。' : '用 read_image 看它。'}`
  }
  if (action === 'overlay') {
    if (r.visible === false) return 'AI 光标已隐藏；主人的真实光标没有移动。'
    const mode = r.cursorMode === 'clean' ? '整洁模式（一会儿自动收起）' : '陪伴模式（一直显示）'
    return `AI 光标已到 (${r.x ?? '?'}, ${r.y ?? '?'}) · ${mode} · ${r.cursorSize || 64}px · ${r.cursorState || 'pointer'}；主人的真实光标没有移动。`
  }
  if (action === 'move') {
    const mode = r.cursorMode === 'clean' ? '整洁模式（一会儿自动收起）' : '陪伴模式（一直显示）'
    return `AI 光标已到 (${r.x ?? '?'}, ${r.y ?? '?'}) · ${mode} · ${r.cursorSize || 64}px · ${r.cursorState || 'pointer'}；主人的真实光标没有移动。`
  }
  const via = r.via || 'unknown'
  if (via === 'uia') {
    return `UIA 已执行（${r.pattern || 'pattern'}）${r.name ? `：${r.name}` : ''}${r.type ? ` · ${r.type}` : ''}`
  }
  if (via === 'wm_settext') {
    return `已直接写入控件${r.verified ? '（已回读确认）' : ''}；没有移动光标，也没有抢焦点。`
  }
  if (via === 'uia-focus+physical') {
    return `UIA 聚焦“${r.name || '目标'}”后用独立键盘输入；鼠标没有移动。`
  }
  if (via === 'uia+message') {
    return `UIA 没有可用模式，已改用窗口消息聚焦并输入${r.verified ? '（已确认）' : '（需截图确认）'}。`
  }
  if (via === 'message') {
    const target = r.title ? `“${r.title}”` : (r.hwnd ? `hwnd ${r.hwnd}` : '目标')
    return `窗口消息已投递给 ${target}${r.verified ? '（已确认）' : '（不一定被处理，请截图确认）'}。`
  }
  if (via === 'physical') {
    return `物理输入完成；主人光标已还原。${r.note || ''}`
  }
  return `已执行 ${action}：${JSON.stringify(r).slice(0, 600)}`
}

function toolSpec() {
  return {
    name: 'pet_input',
    description:
      '独立鼠标键盘：默认用 UIA / 窗口消息操作屏幕，**不移动主人的真实光标、不抢键盘焦点**，所以主人随时可以继续用鼠标键盘、暂停或提意见。\n\n'
      + '用法顺序：\n'
      + '1. 先 `status` 看是否 paused、前台窗口、真实光标位置；paused 就停手，等主人说继续。\n'
      + '2. 用 `windows` 或 `capture` 拿目标坐标（屏幕绝对像素；`capture` 的图会直接附在结果里）。\n'
      + '3. 用 `click` / `type` / `key` / `scroll` / `drag`，默认 `mode:"auto"`：UIA → 窗口消息；只有明确 `mode:"physical"` 才动用真实光标/键盘。\n'
      + '4. 每个动作后截图确认，不要假设点中了。\n\n'
      + 'AI 光标：开始操作时用 `move` 让它出现。两种模式 —— `companion`（陪伴，默认，一直显示到收工）'
      + '和 `clean`（整洁，动作后约 2.6 秒自动收起）。插件 config 里改 `cursorMode` / `cursorSize`（24–192，默认 64）；'
      + '光标外观按操作**自动切换**（默认 pointer、输入 text、可点元素 link、滚动 vert、拖拽 move/dgn1/dgn2、精确点击 cross、暂停 unavailiable、失败 help），不用手选。'
      + '运行中也可以 `overlay({cursorMode:"clean", cursorSize:96})` 切换；收工用 `overlay({show:false})` 收起。\n\n'
      + '安全规则：\n'
      + '- 物理模式会短暂使用真实光标；主人一碰鼠标键盘就立刻暂停并把光标放回原处。\n'
      + '- 主人按 **Ctrl+Alt+Q** 随时暂停；下一次动作会返回 paused，必须停下。\n'
      + '- 不要用这个工具做破坏性操作（删文件、关窗口、支付），除非主人明确要求。\n\n'
      + 'actions: status / windows / capture / click / type / key / scroll / drag / move / pause / resume / overlay / probe / calscan。\\n\\n'
      + '排查坐标用 `probe`（这只窗口该去哪、记成哪、实际在哪）和 `calscan`（给一个点，量系统读回的是不是同一个点——'
      + '用来分清「逻辑像素 / 物理像素」到底哪个环节没对上）。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'status | windows | capture | lastshot | click | type | key | scroll | drag | move | pause | resume | overlay | probe | calscan | shake',
      },
      go: { type: 'boolean', description: 'calscan：true 才真的移动一次真实光标去量（测完自动还原）；省略只报口径' },
      on: { type: 'boolean', description: 'shake：true 开 / false 关，默认开' },
      level: { type: 'string', description: 'shake：灵敏度 low | medium（默认）| high' },
      x: { type: 'number', description: '屏幕绝对 x（click/type/scroll/drag 的起点/move/overlay）' },
      y: { type: 'number', description: '屏幕绝对 y' },
      toX: { type: 'number', description: 'drag 终点 x' },
      toY: { type: 'number', description: 'drag 终点 y' },
      button: { type: 'string', description: 'left（默认）或 right' },
      count: { type: 'integer', description: '点击次数，默认 1；2 = 双击' },
      text: { type: 'string', description: 'type 要输入的文字' },
      replace: { type: 'boolean', description: 'type：true 覆盖原内容，false（默认）追加' },
      keys: { type: 'string', description: 'key：组合键，如 "ctrl+c"、"alt+tab"、"enter"' },
      mode: {
        type: 'string',
        description: 'auto（默认）| uia | message | physical。auto 先 UIA 再窗口消息，不用真实光标；physical 才动用真实光标/键盘',
      },
      delta: { type: 'number', description: 'scroll 滚轮量：正数向上、负数向下，默认 -120' },
      durationMs: { type: 'number', description: 'drag 持续时间，默认 400ms' },
      hwnd: { type: 'number', description: '可选：type/key 的 physical 模式先聚焦这个窗口' },
      path: { type: 'string', description: 'capture 保存 PNG 的绝对路径；省略则自动放 DSH_HOME/ming-mousepet/shots/' },
      rect: { type: 'string', description: 'capture 区域："x,y,w,h" 或 "full"；省略则截当前前台窗口' },
      show: { type: 'boolean', description: 'overlay：false 隐藏 AI 光标，true/省略 显示' },
      cursorMode: {
        type: 'string',
        description: 'overlay：companion（陪伴，一直显示，默认）| clean（整洁，动作后自动收起）',
      },
      cursorSize: {
        type: 'number',
        description: 'overlay：AI 光标大小（像素，24–192，默认 64）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          images: { type: 'array', items: { type: 'object', additionalProperties: true } },
          meta: { type: 'object', additionalProperties: true },
        },
      },
      render(_args, value) {
        const blocks = []
        for (const image of value.images || []) blocks.push({ type: 'image', attachment: image })
        blocks.push({ type: 'text', text: value.text })
        return blocks
      },
    },
    timeoutMs: 120000,
    isConcurrencySafe() {
      return false
    },
  }
}

function normalizeSettings(input, fallback = {}) {
  const merged = { ...(fallback || {}), ...(input || {}) }
  const mode = merged.cursorMode === 'clean' ? 'clean' : 'companion'
  const hold = Number(merged.cursorHoldMs)
  const size = Number(merged.cursorSize)
  const wanted = String(merged.cursorState || '').toLowerCase()
  let style = 'pointer'
  if (wanted.startsWith('custom:') && SKIN_NAME_RE.test(wanted.slice(7))) style = wanted
  else if (STYLE_IDS.includes(wanted)) style = wanted
  return {
    cursorMode: mode,
    cursorHoldMs: Number.isFinite(hold) ? Math.max(300, Math.min(10000, Math.round(hold))) : 2600,
    cursorSize: Number.isFinite(size) ? Math.max(24, Math.min(192, Math.round(size))) : 64,
    // 2026-11-08：皮肤。15 只光标换着用，面板上点一下就是这个。
    cursorState: style,
    // 2026-11-08（她提的「桌面那只只能用默认模型」）：自动开口用哪个模型。
    // 存这里的目的是能在页面上换；留空就退回 cordis.patch.yml 的 companion.provider / companion.model。
    // 只收字符串——写坏了自动开口就起不来，宁可退回默认。
    talkProvider: typeof merged.talkProvider === 'string' ? merged.talkProvider.trim().slice(0, 80) : '',
    talkModel: typeof merged.talkModel === 'string' ? merged.talkModel.trim().slice(0, 120) : '',
    // 2026-11-10（她：「记得保存用户配置，不要每次重启 dsh 都变成默认配置」）：
    //   晃动检测以前只活在内存里，重启就回「开 / 中」。现在跟着 settings.json 走。
    shake: {
      on: merged && merged.shake && typeof merged.shake.on === 'boolean' ? merged.shake.on : true,
      level: merged && merged.shake && ['low', 'medium', 'high'].includes(String(merged.shake.level))
        ? String(merged.shake.level)
        : 'medium',
    },
  }
}

async function loadSavedSettings(log = () => {}) {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function persistSettings(settings) {
  await mkdir(dirname(SETTINGS_FILE), { recursive: true })
  await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('请求不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

export async function apply(ctx, rawConfig = {}) {
  const defineTool = await loadDefineTool(rawConfig?.toolsPath || '')
  const log = (message) => { try { ctx?.logger?.info?.(`[ming-mousepet] ${message}`) } catch { /* ignore */ } }
  const saved = await loadSavedSettings(log)
  let current = normalizeSettings(saved, normalizeSettings(rawConfig))
  // 2026-11-08 21:1x 她：「点按桌宠直接进行一次不记次数的活动，长按拖动」。
  // sidecar 判出「这是一次轻点」才抛 tap；这里把它接成「桌宠说一句」，不占每日配额、不动 nextAt。
  let lastTapAt = 0
  // 2026-11-09 她的想法：晃一下鼠标 → 我的光标飞过去 → 气泡说一句。
  // 只报位置的是 sidecar；说什么、飞不飞这里决定。故意不调模型——晃一下不该烧一轮。
  let lastShakeAt = 0
  // 2026-11-09：卡片追问时带上的上下文——她刚指过的网页、刚框过的块。
  // 只留一句注记，不留全文：全文再读一遍成本高，窗口里本来就有。
  let lastPickNote = ''
  // 2026-11-09 21:1x：框选/指认之后用哪一档回答。默认简易（气泡），右键菜单可改。
  let answerMode = 'quick'
  const engine = new InputEngine({
    log,
    ...current,
    onTap: (evt) => {
      const now = Date.now()
      if (now - lastTapAt < 2500) return // 连点、抖手只算一次
      lastTapAt = now
      const poke = stopTalker && stopTalker.poke
      if (typeof poke === 'function') {
        Promise.resolve(poke(evt)).catch((error) => log(`点一下没应上：${error?.message || error}`))
        return
      }
      // 自动开口没开也得有反应，不然点了像坏了。就一个字，不替模型编话。
      engine.request('say', { text: '在', ms: 1600 }, 8000).catch(() => {})
    },
    onShake: (evt) => {
      const now = Date.now()
      if (now - lastShakeAt < 2500) return // 连晃只算一次
      lastShakeAt = now
      const x = Number(evt?.x) || 0
      const y = Number(evt?.y) || 0
      // 2026-11-09 她：「框哪块」出来太晚，一边移动一边问就行。
      // 所以这里不等模型——先秒出一句短的，同时让光标滑过去、把框弹出来。
      engine.request('say', { text: '框哪块？', x, y, ms: 3200 }, 6000).catch(() => {})
      engine.request('glide', { x, y, ms: 260 }, 6000).catch(() => {})
      engine.request('select', { timeoutMs: 12000 }, 8000).catch(() => {})
    },
    onSelect: (evt) => {
      // 她框完了一块：交给 handleRect——先看这块能不能读，再存图、读字、说一句。
      if (!evt || evt.event !== 'select-done' || !evt.rect) return
      Promise.resolve(handleRect(evt.rect, '框选')).catch((error) => log(`框选后没接上：${error?.message || error}`))
    },
    onPick: (evt) => {
      // 2026-11-09：她「指了一下」——悬停取块、回车确认。和拖框走同一条管线。
      if (!evt || evt.event !== 'pick' || !evt.rect) {
        if (evt && evt.event === 'pick-none') log(`指一下取消：${evt.why || ''}`)
        return
      }
      const tag = evt.name ? `：${evt.name}` : evt.fallback ? '（聚焦框）' : ''
      lastPickNote = `她刚指了屏幕上一块${tag}`
      Promise.resolve(handleRect(evt.rect, '指认')).catch((error) => log(`指认后没接上：${error?.message || error}`))
    },
    onWebPick: () => {
      // 浏览器扩展刚 POST 进来一段网页选中的字（存在 webpick.json）。
      Promise.resolve()
        .then(async () => {
          const file = join(DSH_HOME, 'ming-mousepet', 'webpick.json')
          const raw = await readFile(file, 'utf8')
          const pick = JSON.parse(String(raw).replace(/^﻿/, ''))
          if (!pick || !pick.text) return
          log(`网页取文：${pick.title || pick.url || '无标题'}（${String(pick.text).length} 字）`)
          lastPickNote = `她刚指了网页上一块：${pick.title || pick.url || ''}${pick.bv ? `（BV ${pick.bv}）` : ''}`
          const sw = stopTalker && stopTalker.speakWeb
          if (typeof sw === 'function') await sw(pick)
        })
        .catch((error) => log(`网页取文没接上：${error?.message || error}`))
    },
    onAsk: (evt) => {
      // 她在卡片里按了回车。答案流回卡片，不走会话桥——这边有 llm.stream。
      const q = String(evt?.text || '').trim()
      if (!q) return
      Promise.resolve(sessionCard.askCard(q, lastPickNote ? [lastPickNote] : [])).catch((error) =>
        log(`卡片没答上：${error?.message || error}`),
      )
    },
    onMenu: (evt) => {
      // 右键菜单里点了东西：回答档要记进 pet-state，晃动检测只要记一行日志。
      const action = String(evt?.action || '')
      if (action === 'answer') {
        answerMode = evt?.mode === 'full' ? 'full' : 'quick'
        log(`回答档改成：${answerMode === 'full' ? '完整（卡片）' : '简易（气泡）'}`)
        Promise.resolve(loadPetState())
          .then((state) => updatePetState((st) => ({ ...st, answerMode })))
          .catch((error) => log(`回答档没存上：${error?.message || error}`))
      } else if (action === 'shake') {
        const on = evt?.on !== false
        log(`晃动检测：${on ? '开' : '关'}`)
        // 2026-11-10 她：右键改的也要存——不然下次重启又回默认。
        current = { ...current, shake: { on, level: current.shake?.level || 'medium' } }
        persistSettings(current).catch((error) => log(`晃动开关没存上：${error?.message || error}`))
      } else if (action === 'ambient') {
        // 2026-11-10 她：右键开/关常态识别。菜单在 sidecar 那边弹，这边只负责落地和记账。
        const on = evt?.on !== false
        Promise.resolve(on ? ambientCtl.start() : ambientCtl.stop())
          .then((r) => {
            log(`常态识别：${r?.enabled ? '开' : '关'}（每 ${r?.intervalMs} ms，阈值 ${r?.threshold}%）`)
            return updatePetState((st) => ({ ...st, ambient: on }))
          })
          .catch((error) => log(`常态识别没切过来：${error?.message || error}`))
      }
    },
    onCardClosed: () => {
      // 关掉就忘：下次开是新的对话，别把上一轮的上下文拖过来。
      lastPickNote = ''
      try {
        sessionCard.reset()
      } catch {
        /* ignore */
      }
    },
  })

  // 框选和指认共用这一段：先看这块能不能读（密码框/登录支付不读），再存图、读字、说一句。
  async function handleRect(rect, how = '框选') {
    const parts = String(rect).split(',').map(Number)
    const cx = Math.round((parts[0] || 0) + (parts[2] || 0) / 2)
    const cy = Math.round((parts[1] || 0) + (parts[3] || 0) / 2)
    const g = await engine.request('guard', { x: cx, y: cy }, 6000).catch(() => null)
    if (g && g.blocked) {
      const why =
        g.reason === 'password'
          ? '这块是密码框，不读。'
          : g.reason === 'elevated'
            ? '这个程序是管理员权限，不读。'
            : '这块像登录/支付，不读。'
      await engine.request('say', { text: why, x: cx, y: cy, ms: 3000 }, 8000).catch(() => {})
      log(`${how}拦下：${g.reason}（${g.title || '无标题'}）`)
      return
    }
    const ui = await engine.request('uiainfo', { x: cx, y: cy }, 6000).catch(() => null)
    const capDir = PET_CAPTURE_DIR
    const stamp = localStamp()
    const shot = join(capDir, `${stamp}.png`)
    await mkdir(capDir, { recursive: true })
    await engine.request('capture', { path: shot, rect }, 15000)
    await writeFile(join(capDir, 'index.md'), `- ${stamp} rect=${rect} via=${how}
`, { flag: 'a' })
    log(`${how}住一块：${shot}（${rect}）`)
    const sw = stopTalker && stopTalker.speakWith
    if (typeof sw !== 'function') return
    const said = await sw(rect, ui)
    if (said && said.line) {
      await writeFile(join(capDir, 'index.md'), `  说了：${said.line}
`, { flag: 'a' }).catch(() => {})
    }
  }

  // 2026-11-10：常态识别。节奏在 Node 这边（setInterval），sidecar 只负责「看一眼」。
  //   起因：sidecar 自己的线程里 GDI 截图会卡死，主线程（请求线程）同一份代码正常——
  //   所以把定时挪到这边，一次 tick 一个请求。
  let ambTimer = null
  let ambBusy = false
  const ambientCtl = {
    async start(opts = {}) {
      const r = await engine.request('ambient', {
        op: 'start',
        intervalMs: opts.intervalMs,
        threshold: opts.threshold,
        maxFrames: opts.maxFrames,
      }, 15000)
      const every = Math.max(500, Math.min(30000, Number(r?.intervalMs) || 3000))
      if (ambTimer) clearInterval(ambTimer)
      ambTimer = setInterval(async () => {
        if (ambBusy) return
        ambBusy = true
        try { await engine.request('ambient', { op: 'tick' }, 15000) } catch { /* 一次没看成，下一轮再看 */ }
        finally { ambBusy = false }
      }, every)
      if (typeof ambTimer.unref === 'function') ambTimer.unref()
      return r
    },
    async stop() {
      if (ambTimer) { clearInterval(ambTimer); ambTimer = null }
      ambBusy = false
      return engine.request('ambient', { op: 'stop' }, 15000).catch(() => null)
    },
    running() {
      return Boolean(ambTimer)
    },
  }

  // 2026-11-09：卡片独立于「自动开口」。她关了自动开口，照样能在桌面上问一句。
  const cardCtl = createCard({
    llm: () => llmRef,
    engine,
    cardPath: resolveCardPath(String(rawConfig?.companion?.workspace || '') || process.cwd()),
    // 2026-11-09 17:0x：卡片这一档也得说清用哪条模型线——
    // 宿主 GenerateOptions.provider/model 必填，不传就选不到适配器（症状是「模型给的空话」）。
    // 读的是同一个 talkerOptions，所以页面上换模型，卡片下一次开口就跟着换。
    callModel: () => ({ provider: talkerOptions.provider, model: talkerOptions.model }),
    log,
  })
  const sessionCard = createCardSessionBridge({
    engine,
    cardCtl,
    controller: () => sessionRef,
  })

  // 2026-11-09 21:2x：开机把存档里的回答档推给 sidecar——菜单里的勾要跟存档一致。
  Promise.resolve(loadPetState())
    .then((st) => {
      if (st && (st.answerMode === 'full' || st.answerMode === 'quick')) {
        answerMode = st.answerMode
        return engine.request('menustate', { answer: answerMode }, 5000)
      }
      return null
    })
    .catch((error) => log(`回答档没推上去：${error?.message || error}`))

  // 2026-11-10：常态识别也记在存档里——DSH / sidecar 重起之后接着看，不用她再点一次菜单。
  Promise.resolve(loadPetState())
    .then((st) => (st && st.ambient === true ? ambientCtl.start() : null))
    .then((r) => { if (r) log(`常态识别接回来了：每 ${r.intervalMs} ms，阈值 ${r.threshold}%`) })
    .catch((error) => log(`常态识别没接回来：${error?.message || error}`))

  const toolConfig = toolSpec()

  const tool = {
    ...toolConfig,
    async execute(args = {}) {
      const action = String(args.action || 'status').toLowerCase()
      try {
        if (action === 'probe') {
          // 2026-11-08 17:0x 诊断：要它去哪 / 它记成哪 / 窗口实际在哪，一次说清
          const r = await engine.request('probe', { x: args.x, y: args.y }, 15000)
          const bits = [
            '要它去 (' + (r.asked && r.asked.x) + ', ' + (r.asked && r.asked.y) + ')',
            '记成 (' + (r.last && r.last.x) + ', ' + (r.last && r.last.y) + ')',
            '窗口实际在 (' + (r.form && r.form.x) + ', ' + (r.form && r.form.y) + ')',
            'dpiScale ' + r.dpiScale,
            '屏幕 ' + (r.screen && r.screen.w) + '×' + (r.screen && r.screen.h),
          ]
          return toLosslessJson({ text: 'probe：' + bits.join(' · '), meta: r })
        }
        if (action === 'calscan') {
          // 2026-11-08 17:2x astra：probe 被入口排除在换算之外，它量的是「逻辑空间里的摆放」，
          // 不能拿来证明物理落点。这条对着物理落点量：给一个点，看系统读回的是不是它。
          const r = await engine.request('calscan', { x: args.x, y: args.y, go: args.go === true }, 20000)
          if (r && r.moved === false) {
            const t = 'calscan：虚拟屏 ' + (r.virtualScreen && r.virtualScreen.w) + '×' + (r.virtualScreen && r.virtualScreen.h)
              + ' · 主屏 Bounds ' + (r.primaryBounds && r.primaryBounds.w) + '×' + (r.primaryBounds && r.primaryBounds.h)
              + ' · dpiScale ' + r.dpiScale
              + '（只报口径；要真量加 go:true）'
            return toLosslessJson({ text: t, meta: r })
          }
          const ex = r && r.error ? r.error.x : null
          const ey = r && r.error ? r.error.y : null
          const t = 'calscan：给它 (' + (r.asked && r.asked.x) + ', ' + (r.asked && r.asked.y) + ')'
            + ' · 系统读回 (' + (r.readBack && r.readBack.x) + ', ' + (r.readBack && r.readBack.y) + ')'
            + ' · 偏差 (' + ex + ', ' + ey + ')'
          return toLosslessJson({ text: t, meta: r })
        }

        if (action === 'status') {
          const s = await engine.request('status', {}, 10000)
          return toLosslessJson({ text: statusText(s), meta: s })
        }
        if (action === 'windows') {
          const r = await engine.request('windows', {}, 15000)
          return toLosslessJson({ text: windowsText(r), meta: r })
        }
        if (action === 'pause') {
          const s = await engine.request('pause', {}, 10000)
          return toLosslessJson({ text: `已暂停。\n${statusText(s)}`, meta: s })
        }
        if (action === 'resume') {
          const s = await engine.request('resume', {}, 10000)
          return toLosslessJson({ text: `已恢复。\n${statusText(s)}`, meta: s })
        }
        if (action === 'shake') {
          const on = args.on !== false
          const level = String(args.level || 'medium')
          const r = await engine.request('shake', { on, level }, 10000)
          // 2026-11-10：工具改的也存——三处入口（右键 / 设置页 / 工具）写同一份 settings。
          current = { ...current, shake: { on, level } }
          persistSettings(current).catch(() => {})
          return toLosslessJson({ text: `晃动检测：${r.enabled ? '开' : '关'}（${r.level}）`, meta: r })
        }
        if (action === 'move') {
          const r = await engine.request('move', { x: args.x, y: args.y }, 10000)
          const meta = { ...r, cursorMode: engine.cursorMode, cursorSize: engine.cursorSize, cursorState: engine.cursorState }
          return toLosslessJson({ text: resultText('move', meta), meta })
        }
        if (action === 'overlay') {
          let modeResult = null
          let sizeResult = null
          if (args.cursorMode) {
            if (args.cursorMode !== 'clean' && args.cursorMode !== 'companion') {
              throw new Error('cursorMode 只能是 clean 或 companion')
            }
            modeResult = await engine.setCursorMode(args.cursorMode)
          }
          if (args.cursorSize !== undefined) {
            sizeResult = await engine.setCursorSize(args.cursorSize)
          }
          const mode = modeResult?.cursorMode || engine.cursorMode
          const size = sizeResult?.cursorSize || engine.cursorSize
          if (args.show === false) {
            const r = await engine.request('overlay', { show: false }, 10000)
            return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, ...modeResult, ...sizeResult } })
          }
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            const r = await engine.request('overlay', { show: true, x: args.x, y: args.y }, 10000)
            return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, ...modeResult, ...sizeResult } })
          }
          if (modeResult || sizeResult) {
            const modeZh = mode === 'clean'
              ? `整洁模式：动作后约 ${modeResult?.cursorHoldMs || engine.cursorHoldMs}ms 自动收起`
              : '陪伴模式：一直显示到收工'
            return toLosslessJson({
              text: `AI 光标已切换：${modeZh} · ${size}px。`,
              meta: { ...(modeResult || {}), ...(sizeResult || {}), cursorMode: mode, cursorSize: size, cursorState: engine.cursorState, ok: true },
            })
          }
          const r = await engine.request('overlay', { show: true }, 10000)
          return toLosslessJson({ text: resultText('overlay', { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState }), meta: { ...r, cursorMode: mode, cursorSize: size, cursorState: engine.cursorState } })
        }
        if (action === 'click') {
          // 让它先飞过去（2026-11-08）：她要看见是「这只光标」在点，不是屏幕某处自己闪一下。
          // 150ms 是让它落位、她来得及看见；光标没开着也不影响动作本身。
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            try { await engine.request('glide', { x: Math.max(0, args.x - 26), y: Math.max(0, args.y - 22), ms: 600 }, 8000) } catch { /* 光标没开着就算了 */ }
            // 2026-11-08 16:4x：滑行是 600ms，只等 150ms 就会在半路上点下去。等它落地再动手。
            await new Promise((r2) => setTimeout(r2, 700))
            // 2026-11-08 17:0x：glide 滑完之后位置会飘（probe 证明 DisplayAt 本身是准的：400,300→401,302），
            // 所以滑行只当动画，落点用一次 move 校正——差的那几像素看不出来，但点得准。
            try { await engine.request('move', { x: Math.max(0, args.x - 26), y: Math.max(0, args.y - 22) }, 8000) } catch { /* 光标没开着就算了 */ }
          }
          const r = await engine.request('click', {
            x: args.x, y: args.y, button: args.button, count: args.count, mode: args.mode,
          }, 30000)
          return toLosslessJson({ text: resultText('click', r), meta: r })
        }
        if (action === 'type') {
          const r = await engine.request('type', {
            x: args.x, y: args.y, text: args.text, replace: args.replace,
            mode: args.mode, hwnd: args.hwnd,
          }, 60000)
          return toLosslessJson({ text: resultText('type', r), meta: r })
        }
        if (action === 'key') {
          const r = await engine.request('key', {
            keys: args.keys, mode: args.mode, hwnd: args.hwnd,
          }, 30000)
          return toLosslessJson({ text: resultText('key', r), meta: r })
        }
        if (action === 'scroll') {
          // 让它先飞过去（2026-11-08）：她要看见是「这只光标」在点，不是屏幕某处自己闪一下。
          // 150ms 是让它落位、她来得及看见；光标没开着也不影响动作本身。
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            try { await engine.request('glide', { x: Math.max(0, args.x - 26), y: Math.max(0, args.y - 22), ms: 600 }, 8000) } catch { /* 光标没开着就算了 */ }
            // 2026-11-08 16:4x：滑行是 600ms，只等 150ms 就会在半路上点下去。等它落地再动手。
            await new Promise((r2) => setTimeout(r2, 700))
          }
          const r = await engine.request('scroll', {
            x: args.x, y: args.y, delta: args.delta, mode: args.mode,
          }, 30000)
          return toLosslessJson({ text: resultText('scroll', r), meta: r })
        }
        if (action === 'drag') {
          // 起点先飞过去，拖完停在终点（2026-11-08）
          if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
            try { await engine.request('glide', { x: Math.max(0, args.x - 26), y: Math.max(0, args.y - 22), ms: 600 }, 8000) } catch { /* 光标没开着就算了 */ }
            // 2026-11-08 16:4x：滑行是 600ms，只等 150ms 就会在半路上点下去。等它落地再动手。
            await new Promise((r2) => setTimeout(r2, 700))
          }
          const r = await engine.request('drag', {
            x: args.x, y: args.y, toX: args.toX, toY: args.toY,
            durationMs: args.durationMs, mode: args.mode,
          }, 90000)
          if (Number.isFinite(args.toX) && Number.isFinite(args.toY)) {
            try { await engine.request('move', { x: Math.max(0, args.toX - 26), y: Math.max(0, args.toY - 22) }, 8000) } catch { /* 光标没开着就算了 */ }
          }
          return toLosslessJson({ text: resultText('drag', r), meta: r })
        }
        if (action === 'capture') {
          return await capture(ctx, engine, args)
        }
        if (action === 'lastshot') {
          return await lastShot(ctx)
        }
        return {
          text: '未知 action。可用：status / windows / capture / click / type / key / scroll / drag / move / pause / resume / overlay。',
          meta: { ok: false, action },
        }
      } catch (error) {
        return toLosslessJson({
          text: `独立输入没完成：${error?.message || error}`,
          meta: { ok: false, action },
        })
      }
    },
  }

  const dispose = ctx.tools.register(defineTool(tool))

  const petOutput = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        images: { type: 'array', items: { type: 'object', additionalProperties: true } },
        meta: { type: 'object', additionalProperties: true },
      },
    },
    render(_args, value) {
      const blocks = []
      for (const image of value.images || []) blocks.push({ type: 'image', attachment: image })
      blocks.push({ type: 'text', text: value.text })
      return blocks
    },
  }

  const petTool = {
    name: 'pet',
    description:
      '桌面上陪着她：看得见、会说话、也能动手，但**默认只读**。\n\n'
      + '- `status` 现在什么情况（前台窗口、她多久没动、光标状态、今天说过几次）。\n'
      + '- `look` 看一眼屏幕（可裁），图直接附上来。\n'
      + '- `watch` 连拍几秒，只回变化大的帧——静止画面只回一张，比连拍便宜。\n'
      + '- `ambient` 常态识别：`{on:true}` 一直看（画面动了才留一帧，静止时几乎不花什么）；'
      + '`{on:false}` 关；不带就报状态；带 `frames:4` 取最近几帧和时间线（附图）。\n'
      + '- `say` 在桌面上说一句话：无边框气泡浮在她光标上方，几秒自己消失，不抢焦点、不打断她。\n'
      + '- `nudge` 问「现在值不值得开口」：回 speak 与否、为什么、现在什么情况。它**不生成话**——话得自己写。\n'
      + '- `cursor` 控制 AI 光标（显示 / 隐藏 / 移动 / 大小 / 模式）。\n\n'
      + '开口的规矩：先 `nudge`，说不要就别硬说；一天最多 6 次、两次至少隔 10 分钟、'
      + '她 15 秒内动过电脑就别说、静音 00:30–10:30。一次一句，别连发；'
      + '说的时候要有由头（她安静久了、屏幕上有什么、时间），没由头就不说。'
      + 'card：开一张能追问的小卡片——带 question 就是问一句，答案流式写进去；'
      + '不带就开空卡，她在卡片里打字，回车发问。关掉即忘，下次是新对话。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'status | look | watch | ambient | say | point | cursor | drift | nudge | config | card | pick | sessions | ask',
      },
      text: { type: 'string', description: 'say / point：要说的话，一句，40 字以内最好' },
      question: { type: 'string', description: 'card：要问的一句；不带就只开一张空卡' },
      op: { type: 'string', description: 'card：close 关掉；不带就按「带 question 就问，不带就开」' },
      sessionId: { type: 'string', description: 'ask：丢给哪个会话；省略或 "new" 就新开一个' },
      capture: { type: 'string', description: 'ask：要一起交给会话的原文（会包进 <抓取内容>）' },
      cwd: { type: 'string', description: 'ask：新会话的工作目录（省略用默认）' },
      ms: { type: 'number', description: 'say：气泡停留毫秒，默认 3200' },
      x: { type: 'number', description: 'say/cursor：屏幕绝对 x；say 省略就浮在光标上方' },
      y: { type: 'number', description: 'say/cursor：屏幕绝对 y' },
      rect: { type: 'string', description: 'look：截图区域 "x,y,w,h" 或 "full"；省略截前台窗口' },
      path: { type: 'string', description: 'look：存 PNG 的路径；省略自动放 DSH_HOME/ming-mousepet/shots/' },
      seconds: { type: 'number', description: 'watch：看几秒，默认 4（0.5–20）' },
      fps: { type: 'number', description: 'watch：每秒采样几次，默认 4（0.5–10）' },
      frames: { type: 'integer', description: 'watch：最多留几帧，默认 4（1–9）；ambient：取最近几帧（给这个就是取帧）' },
      intervalMs: { type: 'number', description: 'ambient：多少毫秒看一次，默认 3000' },
      threshold: { type: 'number', description: 'ambient：画面变化多少百分比才留帧，默认 3' },
      quietHours: { type: 'boolean', description: 'config：宵禁开关；false = 00:30–10:30 也开口（测试用）' },
      on: { type: 'boolean', description: 'drift / ambient：true 开 / false 关' },
      show: { type: 'boolean', description: 'cursor：false 收起 AI 光标' },
      cursorMode: { type: 'string', description: 'cursor：companion（一直显示）| clean（用完就收）' },
      cursorSize: { type: 'number', description: 'cursor：24–192 像素' },
    },
    output: petOutput,
    timeoutMs: 120000,
    isConcurrencySafe() {
      return false
    },
    async execute(args = {}) {
      const action = String(args.action || 'status').toLowerCase()
      const now = new Date()
      try {
        if (action === 'status') {
          const s = await engine.request('status', {}, 10000)
          const state = await loadPetState()
          // 2026-11-09：版本握手结果挂在这里，一眼能看出「跑的是不是文件里那份」。
          const hs = engine.handshake
          const hsLine = hs
            ? hs.ok
              ? `sidecar 版本 ${hs.actual}（与文件一致，指纹 ${hs.fileHash}）`
              : `⚠ sidecar 版本对不上：文件 ${hs.expected ?? '?'} / 进程 ${hs.actual ?? '?'}——ps1 改过但 sidecar 没重启？`
            : 'sidecar 版本：还没握手（进程没起）'
          return toLosslessJson({
            text: `${petStatusText(s, state, now)}\n${hsLine}`,
            meta: { ...s, handshake: hs },
          })
        }
        if (action === 'sessions') {
          // 看得见哪些会话（不激活 Agent）。
          const r = await listSessions(sessionRef)
          if (!r.ok) return toLosslessJson({ text: `列不出来：${r.why}`, meta: r })
          const lines = r.items.slice(0, 12).map((it, i) =>
            `${i + 1}. ${it.short}${it.title ? ` · ${it.title}` : ''}${it.running ? ' · 在跑' : ''}${it.blank ? ' · 空' : ''}`,
          )
          return toLosslessJson({
            text: lines.length ? `会话（新→旧）：\n${lines.join('\n')}` : '没有可见的会话',
            meta: { ok: true, items: r.items.slice(0, 12) },
          })
        }
        if (action === 'ask') {
          // 把一句丢进真会话去办，答案流式写进卡片。sessionId 缺省就新开一个。
          const say0 = String(args.text || args.question || '').trim()
          if (!say0) return toLosslessJson({ text: '要说点什么', meta: { ok: false } })
          const r = await sessionCard.ask(args)
          const sid = r.sessionId || args.sessionId || args.session || ''
          return toLosslessJson({
            text: r.ok
              ? `会话 ${String(sid).replace(/^session-/, '')} 回了 ${String(r.text || '').length} 字，动了 ${r.tools} 次手`
              : `没成：${r.why}`,
            meta: r,
          })
        }
        if (action === 'pick') {
          // 2026-11-09：指一下——不拖框。
          const r = await engine.request('pick', { op: 'start', timeoutMs: Number(args.ms) || 30000 }, 8000)
          return toLosslessJson({
            text: r.started ? '指一下：光标停在哪就框哪块，回车确认，[ ] 收放，Esc 取消' : '指一下没起来（可能在全屏里）',
            meta: r,
          })
        }
        if (action === 'card') {
          // 2026-11-09：能追问的小卡片。带 text 就是「问一句」，不带就是「开一张空卡」。
          const op = String(args.op || '').toLowerCase()
          if (op === 'close') {
            lastPickNote = ''
            const r = await sessionCard.close()
            return toLosslessJson({ text: '卡片关了', meta: r })
          }
          if (op === 'follow') {
            // 2026-11-09 17:2x：她问「卡片能不能跟桌宠走」。跟随默认就是开的，
            // 这个 op 只是在她说「别跟了」或想重新贴上去时拨一下。
            const on = args.on !== false
            const r = await engine.request('card', { op: 'follow', on }, 8000)
            return toLosslessJson({
              text: r.follow ? `卡片跟着桌宠（${r.bounds || '位置读不到'}）` : '卡片钉在原地了',
              meta: r,
            })
          }
          const q = String(args.text || args.question || '').trim()
          if (q) {
            const r = await sessionCard.askCard(q, lastPickNote ? [lastPickNote] : [])
            return toLosslessJson({
              text: r.ok ? `卡片里答了 ${String(r.text || '').length} 字` : `卡片没答成：${r.why}`,
              meta: { ok: r.ok, why: r.why || '' },
            })
          }
          const r = await engine.request('card', { op: 'open', title: '溟' }, 8000)
          return toLosslessJson({ text: r.open ? `卡片开在 ${r.bounds}` : '卡片没开成', meta: r })
        }
        if (action === 'look') {
          return await capture(ctx, engine, args)
        }
        if (action === 'watch') {
          const r = await engine.request('watch', {
            seconds: args.seconds,
            fps: args.fps,
            frames: args.frames,
            out: args.out,
          }, 60000)
          const list = Array.isArray(r?.frames) ? r.frames : []
          let images = []
          if (list.length) {
            const top = list.slice().sort((a, b) => (b.diff || 0) - (a.diff || 0))[0]
            images = await attachImages(ctx, [top.path])
          }
          const lines = [`看了 ${r?.seconds ?? '?'} 秒，抓 ${r?.captured ?? 0} 帧，留下 ${list.length} 帧：`]
          for (const f of list) lines.push(`  ${f.t}s · 变化 ${f.diff}% · ${f.path}`)
          if (!list.length) lines.push('  画面一直没动。')
          return toLosslessJson({ text: lines.join('\n'), images, meta: r })
        }
        if (action === 'ambient') {
          // 2026-11-10 她：常态识别——开启之后一直看，只在画面动了才留一帧。
          // 不给 on 也不给 frames 就是报状态；给 frames 就是取最近几帧回来（附图）。
          if (args.frames !== undefined) {
            const n = Math.max(1, Math.min(9, Number(args.frames) || 4))
            const r = await engine.request('ambient', { op: 'dump', n }, 15000)
            const items = Array.isArray(r?.items) ? r.items : []
            const images = await attachImages(ctx, items.map((x) => x.path).filter(Boolean))
            const lines = [
              `常态识别：${r?.enabled ? '开着' : '关着'} · 每 ${r?.intervalMs ?? '?'} ms 看一次 · 最近 ${items.length} 帧`,
            ]
            for (const it of items) lines.push(`  ${it.at} · ${it.path}`)
            if (!items.length) lines.push('  还没有帧——刚开起来，或者画面一直没动。')
            return toLosslessJson({ text: lines.join('\n'), images, meta: r })
          }
          const op = args.on === true ? 'start' : args.on === false ? 'stop' : 'status'
          let r
          if (op === 'start') {
            r = await ambientCtl.start({ intervalMs: args.intervalMs, threshold: args.threshold })
          } else if (op === 'stop') {
            r = await ambientCtl.stop()
          } else {
            r = await engine.request('ambient', { op: 'status' }, 15000)
          }
          if (op !== 'status') {
            // 记下来：DSH 重启、sidecar 重起之后按这个把常态识别接回去。
            await updatePetState((st) => ({ ...st, ambient: op === 'start' })).catch(() => {})
          }
          const head = `常态识别${r?.enabled ? '开着' : '关着'} · 每 ${r?.intervalMs ?? '?'} ms 一次 · 阈值 ${r?.threshold ?? '?'}% · 已看 ${r?.ticks ?? 0} 次，留了 ${r?.kept ?? 0} 帧`
          const extra = r?.lastAt ? `\n最近一次变化 ${r.lastAt}${r.lastTitle ? `（${r.lastTitle}）` : ''}` : ''
          const err = r?.error ? `\n⚠ ${r.error}` : ''
          const dir = r?.dir ? `\n帧在 ${r.dir}` : ''
          return toLosslessJson({ text: head + extra + err + dir, meta: r })
        }
        if (action === 'say') {
          const text = String(args.text || '').trim()
          if (!text) throw new Error('say 需要 text')
          // 2026-11-09 00:2x（她问「AI 指针有聊天宵禁吗」，然后「加一个宵禁功能吧」）：
          // 自动陪伴那条路一直有 00:30–10:30 的静音，但**我主动调的这个 say 没有**——
          // 半夜照样能弹气泡。缺口在这儿，补上。判据收在 lib/pet.js 的 shouldMuteSay。
          // 00:25 她一句「那不就是说我必须两分钟动一次」否掉了「她在动就放行」的第一版：
          // 拿键鼠空闲当「醒着」的证据，等于要她定时动一下。现在没有例外。
          const st0 = await loadPetState()
          const gate = shouldMuteSay({ now, state: st0 })
          if (gate.mute) {
            return toLosslessJson({
              text: '没弹：' + gate.why,
              meta: { skipped: 'quiet-hour' },
            })
          }
          const r = await engine.request('say', { text, ms: args.ms, x: args.x, y: args.y }, 15000)
          // 2026-11-08 19:47：工具触发的 say 不再计入「陪伴主动开口」配额，也不重置间隔。
          // 起因：spokenToday 记到 42、dailyMax 是 6，于是自动陪伴每一轮都判「够了」，
          // token 照烧、一句话不说；而 42 次里绝大多数是我自己调的 say。
          // 判据：配额管的是「它自己想不想开口」，不是「屏幕上弹过几次泡」。
          return toLosslessJson({
            text: r?.ok ? `说了：「${text}」` : `没说出来：${r?.error || '未知原因'}`,
            meta: r,
          })
        }
        if (action === 'nudge') {
          const s = await engine.request('status', {}, 10000)
          const state = await loadPetState()
          const verdict = judgeNudge({ now, status: s, state })
          const c = verdict.context
          const lines = [
            verdict.speak ? '可以开口。' : '先别说。',
            `为什么：${verdict.why}`,
            `现在：${c.foreground || '前台未知'}${c.process ? ` · ${c.process}` : ''}`,
            `她安静：${c.idleMin === null ? '读不到' : `${c.idleMin} 分钟`}`
              + ` · 今天说过 ${c.spokenToday} 次`
              + (c.sinceLastSpokeMin === null ? '' : ` · 上次 ${c.sinceLastSpokeMin} 分钟前`),
          ]
          return toLosslessJson({ text: lines.join('\n'), meta: verdict })
        }
        if (action === 'config') {
          const state = await loadPetState()
          const next = { ...state }
          if (args.quietHours !== undefined) next.quietHours = Boolean(args.quietHours)
          await savePetState(next)
          return toLosslessJson({
            text: `宵禁：${next.quietHours === false ? '关着，随时能开口' : '开着，00:30–10:30 不说话'}`,
            meta: { quietHours: next.quietHours },
          })
        }
        if (action === 'drift') {
          const r = await engine.request('drift', { on: args.on !== false }, 10000)
          return toLosslessJson({ text: r?.drift === false ? '光标不晃了。' : '光标开始轻轻晃。', meta: r })
        }
        if (action === 'point') {
          if (!Number.isFinite(args.x) || !Number.isFinite(args.y)) throw new Error('point 需要 x 和 y')
          // 2026-11-08：手指过去要缓动，不是闪现。
          const moved = await engine.request('glide', { x: args.x, y: args.y, ms: args.glideMs || 800 }, 10000)
          await new Promise((r) => setTimeout(r, 860))
          const text = String(args.text || '').trim()
          if (!text) {
            return toLosslessJson({ text: `光标指到 ${args.x},${args.y}。`, meta: moved })
          }
          const said = await engine.request('say', { text, ms: args.ms, x: args.x, y: args.y }, 15000)
          // 同 say：只是屏幕上弹了一次泡，不算「陪伴自己开口」的一次。
          return toLosslessJson({
            text: said?.ok ? `指着那里说：「${text}」` : `指过去了，话没说出来：${said?.error || '未知'}`,
            meta: { ...moved, ...said },
          })
        }
        if (action === 'cursor') {
          if (args.cursorMode) await engine.setCursorMode(args.cursorMode)
          if (args.cursorSize !== undefined) await engine.setCursorSize(args.cursorSize)
          if (args.show === false) {
            const r = await engine.request('overlay', { show: false }, 10000)
            return toLosslessJson({ text: 'AI 光标收起来了。', meta: r })
          }
          const r = await engine.request('overlay', {
            show: true,
            ...(Number.isFinite(args.x) ? { x: args.x } : {}),
            ...(Number.isFinite(args.y) ? { y: args.y } : {}),
          }, 10000)
          return toLosslessJson({
            text: `AI 光标亮着（${engine.cursorSize}px · ${engine.cursorMode}）。`,
            meta: r,
          })
        }
        return toLosslessJson({
          text: `未知 action。可用：status / look / watch / say / point / cursor / drift / nudge / config。`,
          meta: { ok: false, action },
        })
      } catch (error) {
        return toLosslessJson({
          text: `pet 没做成：${error?.message || error}`,
          meta: { ok: false, action },
        })
      }
    },
  }

  const disposePet = ctx.tools.register(defineTool(petTool))

  const applySettings = async (next) => {
    await engine.setCursorSize(next.cursorSize)
    await engine.setCursorMode(next.cursorMode, next.cursorHoldMs)
    // 2026-11-08：换模型不用重启——talker 每轮醒来看一眼 talkerOptions，
    //   这里把新值写进去，下一次开口就是新的。留空则退回 patch.yml 里那份。
    try {
      talkerOptions.provider = next.talkProvider || companionCfg.provider
      talkerOptions.model = next.talkModel || companionCfg.model
    } catch { /* apply 还没走到那一步时不该有人改设置；真赶上了就等下次生效 */ }
    if (next.cursorState) {
      try {
        if (next.cursorState.startsWith('custom:')) {
          const file = join(SKINS_DIR, `${next.cursorState.slice(7)}.png`)
          await engine.request('setSkin', { path: file }, 15000)
        } else {
          await engine.setCursorStyle(next.cursorState)
        }
      } catch { /* 换皮肤失败不该拦住其它设置 */ }
    }
  }

  const API_PREFIX = '/dsh-ming-mousepet/api'
  const ASSET_PREFIX = '/dsh-ming-mousepet/assets'

  // 2026-11-10 她：「不要每次重启 dsh 都变成默认配置」。
  //   原来 settings.json 只是存着，开机没人推——光标大小、模式、皮肤、晃动检测全都回默认。
  //   这里把存下来的那份开机先推一遍；推不动就记一行，不拦启动。
  applySettings(current)
    .then(() => engine.request('shake', { on: current.shake?.on !== false, level: current.shake?.level || 'medium' }, 10000))
    .then(() => log(`开机设置已恢复：光标 ${current.cursorMode}/${current.cursorSize}px/${current.cursorState}，晃动 ${current.shake?.on === false ? '关' : '开'}·${current.shake?.level || 'medium'}`))
    .catch((error) => log(`开机设置没恢复：${error?.message || error}`))

  // 2026-11-10：晃一下鼠标 → 光标飞过去说一句。开关和灵敏度要在设置页里能改，
  // 所以给它一个 HTTP 口（原来只有 pet_input 的工具能碰）。
  // 2026-11-10 改：不再只活在内存里——存进 settings.json，重启后按存档恢复。
  const shakeState = {
    on: current.shake?.on !== false,
    level: current.shake?.level || 'medium',
  }

  const apiHandler = async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith(API_PREFIX)) {
      if (typeof next === 'function') return next()
      return json(res, 404, { ok: false, error: 'not found' })
    }
    const route = url.pathname.slice(API_PREFIX.length) || '/'
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }
    try {
      // 2026-11-08（她提的「桌面那只只能用默认模型」）：把能选的模型列出来。
      //   来源是宿主 llm：listProviders() + 每个 provider 的 listModels()。
      //   某个 provider 列不出来（没目录接口 / 没登录）单独报错，不影响别的。
      if (req.method === 'GET' && route === '/models') {
        const out = {
          ok: true,
          current: {
            provider: current.talkProvider || companionCfg.provider,
            model: current.talkModel || companionCfg.model,
            fromSettings: Boolean(current.talkModel),
            defaultProvider: companionCfg.provider,
            defaultModel: companionCfg.model,
            talkerRunning: Boolean(stopTalker),
          },
          providers: [],
          errors: [],
        }
        if (!llmRef || typeof llmRef.listProviders !== 'function') {
          out.errors.push('宿主没给模型服务（llm），只能手填')
          return json(res, 200, out)
        }
        let list = []
        try {
          list = (await llmRef.listProviders()) || []
        } catch (error) {
          out.errors.push(`列 provider 失败：${error?.message || error}`)
        }
        for (const p of list) {
          const id = String(p?.id || '')
          if (!id) continue
          const entry = { id, name: String(p?.name || id), models: [] }
          try {
            const models = typeof llmRef.listModels === 'function' ? await llmRef.listModels(id) : []
            entry.models = (models || [])
              .map((m) => ({ id: String(m?.id || ''), name: String(m?.name || m?.id || '') }))
              .filter((m) => m.id)
          } catch (error) {
            entry.error = String(error?.message || error)
          }
          out.providers.push(entry)
        }
        return json(res, 200, out)
      }
      if (req.method === 'GET' && route === '/settings') {
        return json(res, 200, { ok: true, settings: current })
      }
      // 晃动识别（2026-11-10 光标页要能开关 + 调灵敏度）
      if (route === '/shake' && req.method !== 'POST') {
        return json(res, 200, { ok: true, shake: shakeState })
      }
      if (route === '/shake' && req.method === 'POST') {
        const body = await readBody(req)
        if (typeof body.on === 'boolean') shakeState.on = body.on
        if (['low', 'medium', 'high'].includes(body.level)) shakeState.level = body.level
        try { await engine.request('shake', { on: shakeState.on, level: shakeState.level }, 10000) } catch { /* 光标没开着就算了 */ }
        // 2026-11-10：存下来，重启后按这个恢复。
        current = { ...current, shake: { on: shakeState.on, level: shakeState.level } }
        try { await persistSettings(current) } catch { /* 存不下来不影响这次生效 */ }
        return json(res, 200, { ok: true, shake: shakeState })
      }
      if (req.method === 'POST' && route === '/settings') {
        const body = await readBody(req)
        const nextSettings = normalizeSettings(body, current)
        await applySettings(nextSettings)
        await persistSettings(nextSettings)
        current = nextSettings
        return json(res, 200, { ok: true, settings: current })
      }
      if (req.method === 'GET' && route === '/skins') {
        let custom = []
        try {
          const files = await readdir(SKINS_DIR)
          custom = files
            .filter((f) => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
            .map((f) => f.replace(/\.[^.]+$/, ''))
        } catch { /* 目录还没有就是没有 */ }
        return json(res, 200, { ok: true, builtin: STYLE_IDS, custom })
      }
      if (req.method === 'GET' && route === '/skin-image') {
        const name = new URL(req.url, 'http://127.0.0.1').searchParams.get('name') || ''
        if (!SKIN_NAME_RE.test(name)) return json(res, 400, { ok: false, error: '名字不合法' })
        try {
          const buffer = await readFile(join(SKINS_DIR, `${name}.png`))
          res.statusCode = 200
          res.setHeader('content-type', 'image/png')
          res.setHeader('cache-control', 'no-store')
          res.setHeader('content-length', buffer.length)
          return res.end(buffer)
        } catch {
          return json(res, 404, { ok: false, error: '没有这张皮肤' })
        }
      }
      if (req.method === 'POST' && route === '/skins') {
        const body = await readBody(req)
        const name = String(body?.name || '').trim()
        if (!SKIN_NAME_RE.test(name)) return json(res, 400, { ok: false, error: '名字只能用字母数字、- 和 _（1–40 字）' })
        const raw = String(body?.data || '')
        const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
        if (!base64) return json(res, 400, { ok: false, error: '没有图片数据' })
        const buffer = Buffer.from(base64, 'base64')
        if (!buffer.length || buffer.length > 3 * 1024 * 1024) {
          return json(res, 400, { ok: false, error: '图片太大（上限 3MB）或读不出来' })
        }
        await mkdir(SKINS_DIR, { recursive: true })
        await writeFile(join(SKINS_DIR, `${name}.png`), buffer)
        return json(res, 200, { ok: true, name, bytes: buffer.length })
      }
      if (req.method === 'DELETE' && route.startsWith('/skins')) {
        const name = new URL(req.url, 'http://127.0.0.1').searchParams.get('name') || ''
        if (!SKIN_NAME_RE.test(name)) return json(res, 400, { ok: false, error: '名字不合法' })
        try {
          await unlink(join(SKINS_DIR, `${name}.png`))
          return json(res, 200, { ok: true })
        } catch {
          return json(res, 404, { ok: false, error: '没有这张皮肤' })
        }
      }
      // 2026-11-08：给「独立的桌面壳」开两个口子。
      // 壳不是 DSH 插件，拿不到工具，只能走这里。
      if (req.method === 'GET' && route === '/pet-status') {
        const [status, state] = await Promise.all([
          engine.request('status', {}, 10000),
          loadPetState(),
        ])
        return json(res, 200, { ok: true, status, petState: state, now: Date.now() })
      }
      if (req.method === 'GET' && route === '/pet-debug') {
        // 光标窗到底画没画出来：hwnd / visible / rect / exStyle。排查「show 说成功但看不见」。
        const info = await engine.request('debug', {}, 10000)
        return json(res, 200, { ok: true, debug: info })
      }
      if (req.method === 'POST' && route === '/pet-tap') {
        // 等价于「她轻点了一下桌宠」：说一句，不记次数。给独立桌面壳和调试用。
        const poke = stopTalker && stopTalker.poke
        if (typeof poke !== 'function') return json(res, 200, { ok: false, error: '自动开口没开着' })
        const r = await poke()
        return json(res, 200, { ok: Boolean(r?.spoken), ...r })
      }
      if (req.method === 'POST' && route === '/pet-tick') {
        // 手动催一轮，不用等 30 秒。调试用；跑完看 companion.log 就知道卡在哪。
        const manual = stopTalker && stopTalker.manual
        if (typeof manual !== 'function') return json(res, 200, { ok: false, error: '自动开口没开着' })
        await manual()
        return json(res, 200, { ok: true })
      }
      if (req.method === 'GET' && route === '/pet-nudge') {
        const [status, state] = await Promise.all([
          engine.request('status', {}, 10000),
          loadPetState(),
        ])
        const verdict = judgeNudge({ now: new Date(), status, state })
        return json(res, 200, { ok: true, ...verdict })
      }
      if (req.method === 'POST' && route === '/pet-say') {
        const body = await readBody(req)
        const text = String(body?.text || '').trim()
        if (!text) return json(res, 400, { ok: false, error: 'text 不能为空' })
        const r = await engine.request('say', { text, ms: body?.ms, x: body?.x, y: body?.y }, 15000)
        // 同 say：HTTP 这条口子也不占配额。
        return json(res, 200, { ok: Boolean(r?.ok), result: r })
      }
      if (req.method === 'POST' && route === '/hide') {
        await engine.request('overlay', { show: false }, 15000)
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST' && route === '/show') {
        await engine.request('overlay', { show: true }, 30000)
        return json(res, 200, { ok: true })
      }
      if (route === '/schedule') {
        // 2026-11-08 15:03：字段跟「自己玩」对齐——
        // gapMode(fixed|random|heartbeat|off) / hbMin / hbCenter / hbMax / minGapMinutes / dailyMax / nextAt。
        const view = (st) => {
          const n = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d }
          return {
            ok: true,
            gapMode: String(st.gapMode || st.schedMode || 'heartbeat'),
            schedMode: String(st.gapMode || st.schedMode || 'heartbeat'),
            everyMin: n(st.minGapMinutes ?? st.everyMin, 50),
            dailyCap: n(st.dailyMax ?? st.dailyCap, 6) < 0 ? 0 : n(st.dailyMax ?? st.dailyCap, 6),
            hbMin: n(st.hbMin, 15),
            hbCenter: n(st.hbCenter, 30),
            hbMax: n(st.hbMax, 60),
            minGapMinutes: n(st.minGapMinutes ?? st.everyMin, 50),
            dailyMax: n(st.dailyMax ?? st.dailyCap, 6),
            nextAt: n(st.nextAt, 0),
            quietHours: st.quietHours !== false,
            spokenToday: spokenToday(st),
          }
        }
        if (req.method === 'GET') {
          return json(res, 200, view(await loadPetState()))
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          const patch = normalizeSchedulePatch(body)
          const next = await updatePetState(st => ({ ...st, ...patch, nextAt: 0 }))
          await stopTalker?.reschedule?.()
          return json(res, 200, view(await loadPetState()))
        }
      }
      return json(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      log(`http ${req.method} ${route}: ${error?.message || error}`)
      return json(res, 500, { ok: false, error: String(error?.message || error) })
    }
  }

  const assetHandler = async (req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (!url.pathname.startsWith(ASSET_PREFIX)) {
      if (typeof next === 'function') return next()
      return json(res, 404, { ok: false, error: 'not found' })
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      return res.end()
    }
    try {
      const name = url.pathname.slice(ASSET_PREFIX.length).replace(/^\//, '').replace(/\.png$/i, '').toLowerCase()
      if (!STYLE_IDS.includes(name)) return json(res, 404, { ok: false, error: 'unknown style' })
      const buffer = await readFile(join(PREVIEW_DIR, `${name}.png`))
      res.statusCode = 200
      res.setHeader('content-type', 'image/png')
      res.setHeader('cache-control', 'public, max-age=3600')
      res.setHeader('content-length', buffer.length)
      return res.end(buffer)
    } catch (error) {
      log(`asset ${url.pathname}: ${error?.message || error}`)
      return json(res, 404, { ok: false, error: 'not found' })
    }
  }

  try {
    if (ctx?.webServer && typeof ctx.effect === 'function') {
      ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler: apiHandler }), 'ming-mousepet: api')
      ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ASSET_PREFIX, handler: assetHandler }), 'ming-mousepet: assets')
    } else {
      log('webServer 不可用：设置页 API 没挂上')
    }
  } catch (error) {
    log(`设置页 API 挂载失败：${error?.message || error}`)
  }

  // ---------------------------------------------------------------- 自动开口
  // 2026-11-08 她要的：一个开关，开了就有个会说话的桌宠，不用另开会话、不用另给 key。
  // 走宿主自己的模型通道（ctx.llm），模型名写在插件 config 里。
  const companionCfg = {
    enabled: Boolean(rawConfig?.companion?.enabled),
    tickMs: Number(rawConfig?.companion?.tickMs) || 90000,
    provider: String(rawConfig?.companion?.provider || 'wb-proxy'),
    model: String(rawConfig?.companion?.model || ''),
    bubbleMs: Number(rawConfig?.companion?.bubbleMs) || 4200,
    workspace: String(rawConfig?.companion?.workspace || '') || process.cwd(),
  }
  let stopTalker = null
  let sessionRef = null
  let llmRef = null

  // 2026-11-08（她提的「桌面那只只能用默认模型」）：用哪个模型不再只由 patch.yml 定。
  //   settings.json 里的 talkProvider / talkModel 有值就压过 config，留空就退回 config。
  //   talker 每一轮都从这同一个对象上读，所以页面上改完，下一次开口就用新的，不用重启。
  const talkerOptions = {
    ...companionCfg,
    provider: current.talkProvider || companionCfg.provider,
    model: current.talkModel || companionCfg.model,
    cardPath: resolveCardPath(companionCfg.workspace),
    // 框选/指认后的回答档：菜单改的就是它。
    answerMode: () => answerMode,
    // 2026-11-08：静默读屏那个脚本，每轮醒来跑一次。
    screenScript: join(PLUGIN_DIR, 'scripts', 'read-screen.ps1'),
    logFile: join(DSH_HOME, 'ming-mousepet', 'companion.log'),
  }

  // 2026-11-09：会话桥。她要「真去动手」时把一句丢进 DSH 会话里跑，
  // 卡片的文字只是窗口；真正干活的是会话那边。拿不到就当这条功能不存在。
  try {
    ctx.inject(['sessionController'], (sctx) => {
      sessionRef = sctx.sessionController
    })
  } catch (error) {
    log(`会话桥没挂上：${error?.message || error}`)
  }

  // llm 无条件拿一次：设页里列模型（/models）要用它，不以自动开口开没开为前提。
  // 建子工作区不阻塞；但 ctx.inject 必须在这一层同步调用——
  // 放进 .then() 里就失效，llm 永远拿不到（2026-11-08 踩过）。
  if (companionCfg.enabled) ensureWorkspace(companionCfg.workspace, log).catch(() => {})
  try {
    ctx.inject(['llm'], (sctx) => {
      llmRef = sctx.llm
      if (!companionCfg.enabled) return
      if (!talkerOptions.model) {
        log('companion.enabled 开了，但没写 companion.model —— 自动开口起不来')
        return
      }
      sctx.effect(() => {
        stopTalker = startTalker({
          llm: sctx.llm,
          engine,
          log,
          options: talkerOptions,
        })
        return () => {
          try { stopTalker?.() } catch { /* ignore */ }
          stopTalker = null
        }
      })
    })
  } catch (error) {
    log(`自动开口没挂上：${error?.message || error}`)
  }

  // 陪伴模式下，插件一加载就让光标出现在桌面上——藏着的陪伴不叫陪伴。
  // 2026-11-08 她问「你的虚拟鼠标呢」，就是因为它要手动 show 才出来。
  if (current.cursorMode === 'companion') {
    engine.request('overlay', { show: true }, 20000).catch((error) => {
      log(`AI 光标没能显示：${error?.message || error}`)
    })
  }

  return () => {
    sessionCard.dispose()
    try { dispose?.() } catch { /* ignore */ }
    try { disposePet?.() } catch { /* ignore */ }
    try { stopTalker?.() } catch { /* ignore */ }
    engine.stop()
  }
}

function fmtSince(ms) {
  if (!Number.isFinite(ms)) return '读不到'
  if (ms < 60000) return `${Math.round(ms / 1000)} 秒`
  if (ms < 3600000) return `${Math.round(ms / 60000)} 分钟`
  return `${(ms / 3600000).toFixed(1)} 小时`
}

function petStatusText(s, state, now) {
  const fg = s?.foreground
  const lines = [
    `鼠标键盘：${s?.paused ? `已暂停（${s?.pauseReason || '她接管了'}）` : '运行中'}`,
    `她多久没动：${fmtSince(s?.lastUserInputAgeMs)}`,
    `前台：${fg?.process ? `${fg.process} · ` : ''}${fg?.title || '未知'}`,
    `AI 光标：${s?.overlay ? '亮着' : '藏着'} · ${s?.cursorMode === 'clean' ? '整洁模式' : '陪伴模式'} ${s?.cursorSize || 64}px`,
    `今天说过：${spokenToday(state, now)} 次`,
  ]
  return lines.join('\n')
}

async function attachImages(ctx, paths) {
  const svc = ctx?.attachments
  if (!svc?.saveImage) return []
  const out = []
  for (const p of paths) {
    try {
      const data = await readFile(p)
      // 2026-11-10：常态识别的帧是 JPEG，别一律当 PNG 报（媒体类型错了图就出不来）。
      const jpeg = /\.jpe?g$/i.test(String(p))
      const ref = await svc.saveImage.call(svc, {
        data,
        mediaType: jpeg ? 'image/jpeg' : 'image/png',
        name: `ming-mousepet-${Date.now()}.${jpeg ? 'jpg' : 'png'}`,
      })
      out.push(ref)
    } catch {
      // 读不回来就不带图，别把整次调用弄挂。
    }
  }
  return out
}

// 2026-11-09：文件名用本地时间（原来写 UTC，看着像凌晨七点）。
function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const PET_CAPTURE_DIR = join(DSH_HOME, 'ming-mousepet', 'captures')

// 她问「刚才框的哪儿」时用：拿最新那张，附上图。
async function lastShot(ctx) {
  let files = []
  try {
    files = (await readdir(PET_CAPTURE_DIR)).filter((f) => f.toLowerCase().endsWith('.png')).sort()
  } catch { files = [] }
  if (!files.length) return toLosslessJson({ text: '还没框过（live/pet-capture 是空的）。', images: [] })
  const path = join(PET_CAPTURE_DIR, files[files.length - 1])
  let images = []
  try {
    const data = await readFile(path)
    const svc = ctx?.attachments
    if (svc?.saveImage) {
      images = [await svc.saveImage.call(svc, { data, mediaType: 'image/png', name: `ming-lastshot-${Date.now()}.png` })]
    }
  } catch (error) {
    ctx?.logger?.warn?.(`[ming-mousepet] 最近那张读不回来：${error?.message || error}`)
  }
  return toLosslessJson({
    text: `最近框的一块：${path}（一共 ${files.length} 张）`,
    images,
    meta: { path, count: files.length },
  })
}

async function capture(ctx, engine, args) {
  let rect = typeof args.rect === 'string' ? args.rect.trim() : ''
  if (rect.toLowerCase() === 'full' || rect === '0,0,0,0') rect = '0,0,0,0'
  if (!rect) {
    const status = await engine.request('status', {}, 10000)
    const hwnd = status?.foreground?.hwnd
    if (hwnd) {
      const info = await engine.request('winInfo', { hwnd }, 10000)
      const r = info?.rect
      if (r && r.w > 0 && r.h > 0) rect = `${r.x},${r.y},${r.w},${r.h}`
    }
    if (!rect) rect = '0,0,0,0'
  }

  const path = args.path || join(DSH_HOME, 'ming-mousepet', 'shots', `shot-${Date.now()}.png`)
  await mkdir(dirname(path), { recursive: true })
  const saved = await engine.request('capture', { path, rect }, 30000)

  let images = []
  try {
    const data = await readFile(path)
    const svc = ctx?.attachments
    if (svc?.saveImage) {
      const ref = await svc.saveImage.call(svc, {
        data,
        mediaType: 'image/png',
        name: `ming-mousepet-${Date.now()}.png`,
      })
      images = [ref]
    }
  } catch (error) {
    ctx?.logger?.warn?.(`[ming-mousepet] 截图读不回来：${error?.message || error}`)
  }

  return toLosslessJson({
    text: resultText('capture', { ok: true, path: saved.path, attached: images.length > 0 }),
    images,
    meta: { ok: true, path: saved.path, rect, attached: images.length > 0 },
  })
}
