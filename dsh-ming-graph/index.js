/**
 * dsh-ming-graph —— 记忆关系图（Host 半端）
 *
 * 只读，不算命：把两侧记忆（DSH 歸檔 notes / Discord 事件）读进来，
 * 自己算成一坨 JSON，经 webServer 路由交给浏览器那半边画。
 * 全程不经过模型。
 *
 * 设计上刻意不做的事：
 *   · 不读 evidence.jsonl（51 MB，读它只是因为报告里要引原文；图上用不着）
 *   · 不给「人和人」连边。11-03 试过按共享词连，连出来的全是噪音
 *     （web_search 401 ↔ WSL 空闲 那种）。这里只在「同一条记忆里一起出现」
 *     这种能核的关系上连边，剩下的用星图表达「有 N 条关于这个人的记忆」。
 */
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as neuronStatic from '../dsh-ming-memory/lib/neuron.mjs'
import {
  readDsh, readDiscord, readPeople, readDiaries, build, parseFront, MEMORY_DEFAULTS,
} from '../dsh-ming-memory/lib/model.mjs'
import { fileURLToPath } from 'node:url'
import { mergePeople } from './people-merge.mjs'
// 2026-11-08：top 栏那个 skill 开关的服务端逻辑（清单 + 写 skills-off.json）。
// 单独一个文件是为了能当场 `node skills-lib.test.mjs` 验——index.js 改一次要重启 DSH，重启归她。
import { listSkills, toggleSkill } from './skills-lib.mjs'
// 2026-11-08：费用页改成自己算（那个插件的账本有 token 没价，见 cost-lib.mjs 顶部）
import { readCost } from './cost-lib.mjs'
// 2026-11-10：「索引费用」——给没定价的模型去网上找价（找不到就借最相似的，并标注公式）
import { indexModels } from './price-index.mjs'
import { fingerprint, singleFlight, sourceLoader, graphDependencies, neuronDependencies, unifiedDependencies } from './fingerprint-cache.mjs'

// 热重载认的是 memory 里那份（两个仓并排放在 C:/dsh 下，按目录关系找；
// 不走包名解析——profile 的 node_modules 是按真路径加载的，包名在这里解析不到）。
const NEURON_URL = new URL('../dsh-ming-memory/lib/neuron.mjs', import.meta.url).href
const NEURON_FILE = fileURLToPath(NEURON_URL)
// 费用：读 sqlite 要扫七万多行，别每个请求都扫一遍
let costCache = null
let costCacheAt = 0
let neuronLoadError = ''
// 「索引费用」同时在跑就复用同一个 promise，别点两下抓两遍网
let costIndexing = null

export const name = 'dsh-ming-graph'

// 工作区：环境变量优先；没有就从本机配置的 diaryDir（<ws>\diary）推，再退 workspace 键。
// 2026-11-15 14:4x：面板第一版上线就撞上这件事——宿主进程里根本没有 MING_WORKSPACE，
// 而本机配置只写了 diaryDir，于是 /acp 读不到账本。同一个坑也让 cost 页的价目表一直指着 '\live\...'。
function resolveWorkspace() {
  if (process.env.MING_WORKSPACE) return process.env.MING_WORKSPACE
  try {
    const central = JSON.parse(readFileSync(path.join(os.homedir(), '.dsh', 'ming-memory.json'), 'utf8'))
    if (central && central.root) return String(central.root)
  } catch { /* first-run setup may not have written the central file yet */ }
  try {
    const f = process.env.MING_GRAPH_CONFIG || path.join(os.homedir(), '.dsh', 'ming-graph.json')
    const j = JSON.parse(readFileSync(f, 'utf8'))
    if (j && j.workspace) return String(j.workspace)
    if (j && j.diaryDir) return path.dirname(String(j.diaryDir).replace(/[\\/]+$/, ''))
  } catch { /* 没本机配置就空着，下面的报错会说明 */ }
  return ''
}
const WORKSPACE = (() => { const w = resolveWorkspace(); return w ? path.normalize(w) : '' })()

const DEFAULTS = {
  // 记忆側預設值（notes、Discord 事件、記憶卡、日記目錄）由 memory 套件提供，
  // 这里展开它，本机配置照旧覆盖（~/.dsh/ming-graph.json）
  ...MEMORY_DEFAULTS,
  syncSeconds: 120,
  // 2026-11-08：skill 开关。cwd 决定「按哪个工作区遮」——跟 dsh-ming-skill-isolate 的 root 是同一个意思；
  // offFile 留空就用 <skillsCwd>/skills-off.json，跟那边写的必须是同一个文件，否则开关写了也不生效。
  skillsCwd: WORKSPACE,
  skillsOffFile: '',
  // 费用价目表：我们自己维护，缺省在 <workspace>/live/cost-prices.json
  costPricesFile: process.env.MING_COST_PRICES || (WORKSPACE ? WORKSPACE + '\\live\\cost-prices.json' : ''),
  // 2026-11-10：「索引费用」按钮写出来的自动价目。人工那份永远压过它。
  costAutoFile: process.env.MING_COST_AUTO || (WORKSPACE ? WORKSPACE + '\\live\\cost-prices.auto.json' : ''),
  workspace: WORKSPACE,
  diaryDir: WORKSPACE ? path.join(WORKSPACE, 'diary') : '',
  discordMemoryFile: WORKSPACE ? path.join(WORKSPACE, 'live', 'discord-memory.jsonl') : '',
}

// ---------- 本地配置 ----------
// 路径、号码、群名这些跟某台机器绑在一起的值不进仓库。
// 放 ~/.dsh/ming-graph.json（或用环境变量 MING_GRAPH_CONFIG 指一个文件），
// 仓库里只留通用默认。沒有這個檔案也能跑：只顯示 DSH 記憶與 Discord 事件。
export function loadLocalConfig(file) {
  const f = file || process.env.MING_GRAPH_CONFIG || path.join(os.homedir(), '.dsh', 'ming-graph.json')
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}
const LOCAL = loadLocalConfig()

// Discord server/channel labels travel with each recorded event.
// Optional roomLabels can provide a local display override.
const GROUP_NAMES = {}

function withRoomLabels(data, cfg) {
  if (!data || typeof data !== 'object') return data
  return { ...data, roomLabels: { ...GROUP_NAMES, ...((cfg && cfg.roomLabels) || {}) } }
}

const ROUTE = '/_dsh/dsh-ming-graph'

// ---------- 委托账本（2026-11-15 14:3x 加） ----------
// Discord 對話轉交的工作一直只有文件、没有界面：
// 想看一条活跑到哪了，得自己 cat 三本 jsonl。这里把它读成一份快照给面板画。
// 只读，不改账本——账本归 ACP 那套插件写。
// 2026-11-15 15:2x：展示页要一点真东西，但不能再去读一遍记忆库（/neurons 那条要扫两侧，
// 冷启动两秒起）。这里只「数目录 + 读最近几个文件的头」：几十毫秒，不建图、不读 Discord 事件日誌。
// 30 秒缓存——展示页反复进出不该反复读盘。
let ovCache = null
let ovCacheAt = 0
export async function readOverview(cfg) {
  if (ovCache && Date.now() - ovCacheAt < 30000) return ovCache
  const out = {
    ok: true,
    at: Date.now(),
    counts: { notes: 0, diaries: 0, people: 0, chapters: 0 },
    recentDiaries: [],
    recentNotes: [],
    errors: [],
  }
  // 归档记忆：readDsh 会把 282 份笔记全读一遍——实测 28ms，比 /neurons 那套便宜两个数量级。
  // 顺手按「创建日」和标签分好，展示页的柱子和环都用这一份，不再多读一次盘。
  try {
    const notes = await readDsh(cfg)
    out.counts.notes = notes.length
    const byDay = new Map()
    const tags = new Map()
    for (const n of notes) {
      const d = String(n.created || '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) byDay.set(d, (byDay.get(d) || 0) + 1)
      for (const t of (n.tags || [])) tags.set(t, (tags.get(t) || 0) + 1)
    }
    out.byDay = [...byDay.entries()].map(([d, n]) => ({ d, n })).sort((a, b) => (a.d < b.d ? -1 : 1))
    out.tagsTop = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => ({ t, n }))
    out.recentNotes = notes.slice()
      .sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')))
      .slice(0, 6)
      .map((n) => ({ id: n.id, title: String(n.title || n.id).slice(0, 80), tags: (n.tags || []).slice(0, 4), at: String(n.created || '') }))
  } catch (e) { out.errors.push('notes: ' + String((e && e.message) || e)) }

  // 日记：只取最近五天，标题取正文里第一个「## 」
  try {
    const dir = cfg.diaryDir || ''
    const files = (await fs.readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    out.counts.diaries = files.length
    for (const f of files.sort().reverse().slice(0, 5)) {
      let title = f.replace(/\.md$/, '')
      try {
        const txt = (await fs.readFile(path.join(dir, f), 'utf8')).slice(0, 4000)
        const m = /^##\s+(.+)$/m.exec(txt)
        if (m) title = m[1].trim().slice(0, 40)
      } catch { /* 读不到就用日期当标题 */ }
      out.recentDiaries.push({ date: f.replace(/\.md$/, ''), title })
    }
  } catch (e) { out.errors.push('diary: ' + String((e && e.message) || e)) }

  // 群友索引 + 记忆卡章数（两个小文件，读不到就空着，不算错）
  try {
    const j = JSON.parse(await fs.readFile(cfg.peopleIndex || '', 'utf8'))
    out.counts.people = Object.keys(j.byId || {}).length
  } catch { /* 没配群友索引 */ }
  try {
    const card = await fs.readFile(cfg.memoryCard || '', 'utf8')
    out.counts.chapters = (card.match(/^##\s+/gm) || []).length
  } catch { /* 没记忆卡 */ }

  ovCache = out
  ovCacheAt = Date.now()
  return out
}

async function readAcp(wsHint) {
  const ws = wsHint || WORKSPACE
  if (!ws) return { ok: false, error: '没配工作区：~/.dsh/ming-graph.json 写 diaryDir 或 workspace，或设环境变量 MING_WORKSPACE', jobs: [], calls: [], counts: {} }
  const live = path.join(ws, 'live')
  const jsonl = (name) => {
    try {
      return readFileSync(path.join(live, name), 'utf8')
        .split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } })
        .filter(Boolean)
    } catch { return [] }
  }
  const files = {}
  try {
    const dir = path.join(live, 'dsh-acp-results')
    for (const f of await fs.readdir(dir)) {
      if (!f.endsWith('.txt')) continue
      try {
        const st = await fs.stat(path.join(dir, f))
        files[f.replace(/\.txt$/, '')] = { bytes: st.size, at: st.mtime.toISOString() }
      } catch { /* 单个文件读不到不影响整张表 */ }
    }
  } catch { /* 没有结果目录就是还没有结论，不算错 */ }

  const ledger = jsonl('dsh-acp-ledger.jsonl')
  // 账本里 status 是好几拨写入方各写各的：running / queued / done / failed / empty / 空。
  // 直接照着显示会得到「23 条在跑」这种假象——那是三天里没人回填，不是真在跑。
  // 所以这里归成四类，再用「多久没动」把陈旧的挑出来。
  const norm = (s) => {
    const v = String(s || '').toLowerCase()
    if (v === 'done' || v === 'ok' || v === 'success') return 'done'
    if (v === 'failed' || v === 'fail' || v === 'error') return 'failed'
    if (v === 'running' || v === 'queued' || v === 'pending') return 'active'
    return 'unknown'
  }
  const atMs = (at) => {
    const t = Date.parse(String(at || '').replace(' ', 'T'))
    return Number.isFinite(t) ? t : 0
  }
  const STALE_MS = 6 * 3600 * 1000
  const now = Date.now()
  const jobs = ledger.map((e) => {
    const state = norm(e.status)
    const t = atMs(e.at)
    return {
      id: e.id,
      at: e.at,
      raw: e.status || '',
      state,
      stale: state === 'active' && t > 0 && now - t > STALE_MS,
      ageHours: t > 0 ? Math.round((now - t) / 360000) / 10 : null,
      mode: e.mode || '',
      by: e.by || '',
      task: String(e.task || '').slice(0, 300),
      result: files[e.id] || null,
    }
  }).reverse()

  const calls = jsonl('dsh-acp-calls.jsonl').slice(-40).reverse().map((e) => ({
    at: e.at,
    ok: !!e.ok,
    seconds: Math.round((e.seconds || 0) * 10) / 10,
    err: String(e.err || '').slice(0, 200),
    task: String(e.task || '').slice(0, 140),
  }))

  const counts = { active: 0, stale: 0, done: 0, failed: 0, unknown: 0 }
  for (const j of jobs) {
    if (j.state === 'active') { if (j.stale) counts.stale += 1; else counts.active += 1 }
    else if (j.state === 'done') counts.done += 1
    else if (j.state === 'failed') counts.failed += 1
    else counts.unknown += 1
  }
  return { ok: true, at: new Date().toISOString(), counts, jobs, calls }
}

// ---------- 读盘 / 算模型已经搬走（2026-11-08） ----------
// 这批函数过去住在这儿，导致「记忆的实现」落在「展示的插件」里。
// 现在它们在 dsh-ming-memory/lib/model.mjs：memory 负责读、负责算，这个插件只负责把它画出来。
// 同一天搬过去的还有 neuron.js（建图 + 统一节点模型），见 memory/lib/neuron.mjs。
export const __internals = { build, readDsh, readDiscord, readPeople, DEFAULTS, readAcp }

// ---------- 服务 ----------
export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...loadLocalConfig(), ...(config || {}) }
  const currentWorkspace = resolveWorkspace()
  if (currentWorkspace) cfg.workspace = currentWorkspace
  // Discord server/channel labels travel with each event; optional roomLabels may override the display name.
  cfg.roomLabels = { ...GROUP_NAMES, ...(cfg.roomLabels || {}) }
  if (cfg.workspace) {
    cfg.skillsCwd = cfg.skillsCwd || cfg.workspace
    cfg.discordMemoryFile = cfg.discordMemoryFile || path.join(cfg.workspace, 'live', 'discord-memory.jsonl')
    cfg.diaryDir = cfg.diaryDir || path.join(cfg.workspace, 'diary')
    cfg.costPricesFile = cfg.costPricesFile || path.join(cfg.workspace, 'live', 'cost-prices.json')
    cfg.costAutoFile = cfg.costAutoFile || path.join(cfg.workspace, 'live', 'cost-prices.auto.json')
  }
  // 2026-11-08：skill 清单来自宿主自己的 skills 服务——跟模型看到的是同一份合并结果，
  // 插件包里自带的那几十个也在里面（自己扫 ~/.dsh/skills 只能看见一半）。
  // 服务没挂上就是 null，listSkills 会自动退回磁盘扫描，不影响开关本身。
  let skillsService = null
  try {
    ctx.inject(['skills'], (c) => { skillsService = c.skills })
  } catch { /* 没这个服务也能跑，只是清单短一点 */ }
  let cache = null
  let cacheKey = ''
  let building = null
  let lastError = ''
  // 「记忆神经元」那套（每条记忆一个点、每条边带 why）单独一份缓存，跟上面那张关系图互不影响
  let nCache = null
  let nKey = ''
  let nBuilding = null

  const keyNow = () => fingerprint(graphDependencies(cfg))

  async function snapshot() {
    const key = await keyNow()
    if (cache && key === cacheKey) return cache
    if (building) return building
    building = (async () => {
      try {
        const [dsh, discord] = await Promise.all([readDsh(cfg), readDiscord(cfg)])
        const names = await readPeople(cfg, discord)
        cache = build(cfg, { dsh, discord, names })
        cacheKey = key
        lastError = ''
      } catch (err) {
        lastError = String((err && err.message) || err)
        return { ...(cache || { generatedAt: 0, sources: {}, people: [], rooms: [], topics: [], edges: [], tags: [], timeline: [], spokes: [], center: { id: 'ming', name: '溟', count: 0 } }), stale: !!cache, error: lastError }
      } finally {
        building = null
      }
      return cache
    })()
    return building
  }

  const neuronKeyNow = () => fingerprint(neuronDependencies(cfg, NEURON_FILE))
  const loadSource = sourceLoader(NEURON_FILE, async url => {
    const m = await import(url)
    if (typeof m.buildNeuron !== 'function') throw Error('neuron module missing buildNeuron')
    return m
  })
  async function loadNeuronImpl() {
    try {
      const m = await loadSource()
      neuronLoadError = ''
      return m
    } catch (err) {
      neuronLoadError = String(err?.message || err)
      throw err // Do not cache a static fallback as a successful new source version.
    }
  }

  async function neuronSnapshot() {
    const key = await neuronKeyNow()
    if (nCache && key === nKey) return nCache
    if (nBuilding) return nBuilding
    nBuilding = (async () => {
      try {
        const impl = await loadNeuronImpl()
        const [dsh, discord] = await Promise.all([
          impl.readDshNotes(cfg.dshMemoryDir),
          impl.readDiscordEvents(cfg.discordMemoryFile || (cfg.workspace ? path.join(cfg.workspace, 'live', 'discord-memory.jsonl') : '')),
        ])
        const names = await readPeople(cfg, discord)
        nCache = mergePeople(impl.buildNeuron({ dsh, discord, cfg, names }))
        if (neuronLoadError) nCache.neuronLoadError = neuronLoadError
        // 自查用：每次算完把当前图落一份（覆盖写）。出了「图上还是旧样子」这种事，
        // 别再靠猜——读这份就知道面板拿到的是什么。
        try {
          const dump = path.join(os.tmpdir(), 'ming-graph-now.json')
          fs.writeFile(dump, JSON.stringify(nCache)).catch(() => {})
          nCache.dumpedTo = dump
        } catch {}
        nKey = key
      } catch (err) {
        return { ...(nCache || { generatedAt: 0, stats: {}, nodes: [], edges: [] }), stale: !!nCache, error: String((err && err.message) || err) }
      } finally {
        nBuilding = null
      }
      return nCache
    })()
    return nBuilding
  }

  // ---------- 统一节点模型（2026-11-07） ----------
  // 两个视图（神经元 / 星图）共用一份节点。这里只做「把三样东西拼起来」：
  // buildNeuron 的结果 + 记忆卡（八章索引，可能不存在）+ 日记（时间星带）。
  // 记忆卡不在就 chapter=null，不编——她说的「疑似真相源」落在这一行上。
  let uCache = null
  let uKey = ''
  const unifiedSnapshot = singleFlight(async () => {
    const base = await neuronSnapshot()
    if (base.error || neuronLoadError) return { ...base, neuronLoadError }
    const key = nKey + '|' + await fingerprint(unifiedDependencies(cfg)) + '|' + (base.generatedAt || 0)
    if (uCache && key === uKey) return uCache
    let card = ''
    if (cfg.memoryCard) { try { card = await fs.readFile(cfg.memoryCard, 'utf8') } catch {} }
    const diaries = await readDiaries(cfg.diaryDir, cfg.diaryDays)
    const impl = await loadNeuronImpl()
    const build = (impl && impl.buildUnified) || neuronStatic.buildUnified
    if (typeof build !== 'function') {
      return { ...base, stats: { ...(base.stats || {}), unifiedError: 'buildUnified 不可用（neuron.js 没导出）' } }
    }
    uCache = build(base, { card, diaries })
    uCache.generatedAt = base.generatedAt || 0
    uCache.neuronLoadError = base.neuronLoadError || ''
    uKey = key
    return uCache
  })

  const respond = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          let method = ''
          try {
            if (webCtx.connection && typeof webCtx.connection.requestRejection === 'function') {
              const rejection = webCtx.connection.requestRejection(req)
              if (rejection !== undefined) { respond(res, rejection || 403, { error: 'rejected' }); return }
            }
            const url = new URL(req.url || '/', 'http://localhost')
            if (!url.pathname.startsWith(ROUTE)) { respond(res, 404, { error: 'not found' }); return }
            method = url.pathname.slice(ROUTE.length).replace(/^\//, '')
            if (method === '' || method === 'snapshot') {
              const snap = await snapshot()
              respond(res, 200, snap)
              return
            }
            if (method === 'refresh') {
              cacheKey = ''
              const snap = await snapshot()
              respond(res, 200, snap)
              return
            }
            // 2026-11-15：展示页的数据口——只数目录、读几个文件头，跟 /neurons 不是一个量级。
            if (method === 'overview') {
              respond(res, 200, await readOverview(cfg))
              return
            }
            if (method === 'neurons' || method === 'neurons/refresh') {
              if (method === 'neurons/refresh') { nKey = ''; nCache = null; neuronImpl = null; neuronImplStamp = '' }
              respond(res, 200, withRoomLabels(await neuronSnapshot(), cfg))
              return
            }
            if (method === 'neurons/unified' || method === 'neurons/unified/refresh') {
              if (method.endsWith('/refresh')) { nKey = ''; nCache = null; uCache = null; uKey = ''; neuronImpl = null; neuronImplStamp = '' }
              respond(res, 200, withRoomLabels(await unifiedSnapshot(), cfg))
              return
            }
            if (method === 'skills' || method === 'skills/refresh') {
              respond(res, 200, await listSkills({
                cwd: cfg.skillsCwd,
                offFile: cfg.skillsOffFile,
                service: skillsService,
              }))
              return
            }
            if (method === 'skills/toggle') {
              if (req.method !== 'POST') { respond(res, 405, { ok: false, error: 'toggle 要 POST' }); return }
              const name = url.searchParams.get('name') || ''
              const onRaw = String(url.searchParams.get('on') || '').toLowerCase()
              const on = onRaw === '1' || onRaw === 'true' || onRaw === 'on'
              respond(res, 200, await toggleSkill(name, on, {
                cwd: cfg.skillsCwd,
                offFile: cfg.skillsOffFile,
                service: skillsService,
              }))
              return
            }
            if (method === 'acp') {
              respond(res, 200, await readAcp(cfg.workspace || WORKSPACE))
              return
            }
            if (method === 'cost' || method === 'cost/refresh') {
              if (method.endsWith('/refresh')) costCache = null
              if (!costCache || Date.now() - costCacheAt > 60000) {
                costCache = readCost({ pricesFile: cfg.costPricesFile, autoFile: cfg.costAutoFile })
                costCacheAt = Date.now()
              }
              respond(res, 200, costCache)
              return
            }
            // 2026-11-10：「索引费用」——给账本里还没定价的模型去网上找一个价。
            // 只写 live/cost-prices.auto.json，不碰人工那份；找完把新账一并回去，前端不用再拉一次。
            if (method === 'cost/index') {
              if (req.method !== 'POST') { respond(res, 405, { ok: false, error: 'cost/index 要 POST' }); return }
              if (costIndexing) { respond(res, 200, await costIndexing); return }
              costIndexing = (async () => {
                const before = readCost({ pricesFile: cfg.costPricesFile, autoFile: cfg.costAutoFile })
                const models = ((before.periods && before.periods.all && before.periods.all.models) || [])
                  .filter((m) => !m.priced).map((m) => m.model)
                if (!models.length) {
                  return { ok: true, models: [], summary: { total: 0 }, message: '没有未定价的模型', cost: before }
                }
                const r = await indexModels({
                  models,
                  manualFile: cfg.costPricesFile,
                  autoFile: cfg.costAutoFile,
                  write: true,
                })
                const after = readCost({ pricesFile: cfg.costPricesFile, autoFile: cfg.costAutoFile })
                costCache = after
                costCacheAt = Date.now()
                return { ...r, models, cost: after }
              })()
              try {
                respond(res, 200, await costIndexing)
              } finally {
                costIndexing = null
              }
              return
            }
            respond(res, 404, { error: 'unknown method ' + method })
          } catch (err) {
            // 2026-11-10（她：刷新时红字 HTTP 500，离开再回来又好了）：
            // 图接口第一次要扫两侧记忆库（约两秒），冷缓存那一下抛错就整段 500，看着像全坏了。
            // 改成 200 + 具体原因 + 空图：前端照常画（0 个点），把那句话摆出来，点刷新就重扫。
            const msg = String((err && err.message) || err) + '（点「刷新」重试；第一次要扫一遍文件，约两秒）'
            if (method === 'neurons' || method === 'neurons/refresh') {
              respond(res, 200, { ok: false, error: msg, nodes: [], edges: [], rooms: [], stats: { memories: 0, edges: 0 } })
              return
            }
            if (method === 'neurons/unified' || method === 'neurons/unified/refresh') {
              respond(res, 200, { ok: false, error: msg, nodes: [], edges: [], rooms: [], roomsById: {} })
              return
            }
            respond(res, 500, { error: String((err && err.message) || err) })
          }
        },
      })
      return dispose
    })
  })

  // 定时重扫：本地文件变了就重算，没变直接命中缓存
  ctx.effect(() => {
    const every = Math.max(15, Number(cfg.syncSeconds) || 120) * 1000
    const timer = setInterval(() => { snapshot().catch(() => {}) }, every)
    snapshot().catch(() => {})
    return () => clearInterval(timer)
  })
}
