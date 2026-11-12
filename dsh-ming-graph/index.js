/**
 * dsh-ming-graph —— 记忆关系图（Host 半端）
 *
 * 只读，不算命：把两侧记忆（DSH 归档 notes / QQ-Agent observations）读进来，
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
  readDsh, readQQ, readPeople, readDiaries, build, MEMORY_DEFAULTS,
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

const DEFAULTS = {
  // 记忆侧默认值（notes 目录、QQ 观察库、群友索引、记忆卡、日记目录）在 memory 那边，
  // 这里展开它，本机配置照旧覆盖（~/.dsh/ming-graph.json）
  ...MEMORY_DEFAULTS,
  syncSeconds: 120,
  // 2026-11-08：skill 开关。cwd 决定「按哪个工作区遮」——跟 dsh-ming-skill-isolate 的 root 是同一个意思；
  // offFile 留空就用 <skillsCwd>/skills-off.json，跟那边写的必须是同一个文件，否则开关写了也不生效。
  skillsCwd: process.env.MING_WORKSPACE || '',
  skillsOffFile: '',
  // 费用价目表：我们自己维护，缺省在 <workspace>/live/cost-prices.json
  costPricesFile: process.env.MING_COST_PRICES || ((process.env.MING_WORKSPACE || '') + '\\live\\cost-prices.json'),
  // 2026-11-10：「索引费用」按钮写出来的自动价目。人工那份永远压过它。
  costAutoFile: process.env.MING_COST_AUTO || ((process.env.MING_WORKSPACE || '') + '\\live\\cost-prices.auto.json'),
}

// ---------- 本地配置 ----------
// 路径、号码、群名这些跟某台机器绑在一起的值不进仓库。
// 放 ~/.dsh/ming-graph.json（或用环境变量 MING_GRAPH_CONFIG 指一个文件），
// 仓库里只留通用默认。没有这个文件也能跑：只是不读 QQ 侧、不显示昵称。
export function loadLocalConfig(file) {
  const f = file || process.env.MING_GRAPH_CONFIG || path.join(os.homedir(), '.dsh', 'ming-graph.json')
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}
const LOCAL = loadLocalConfig()

// 2026-11-07 19:4x：她问「关系图里还有一堆 QQ 号，能不能自动认出来」。
// 群名本机拿不到（config.json 里只有号码），得 QQ 侧调 OneBot 的 get_group_list 写出来。
// 这里读 live/qq-groups.json（形状 { "<群号>": "<群名>", ... } 或 { groups:[{id,name}] }），
// 跟手填的 roomLabels 合并，手填优先。
function loadGroupNames() {
  const out = {}
  // 2026-11-07 22:1x：默认路径不写进仓库（这个仓是公开的）。没配 MING_WORKSPACE 就不读，返回空表。
  const ws = process.env.MING_WORKSPACE || ''
  if (!ws) return out
  const f = path.join(ws, 'live', 'qq-groups.json')
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    if (Array.isArray(j.groups)) {
      for (const g of j.groups) if (g && g.id && g.name) out['group:' + String(g.id)] = String(g.name)
    } else if (j && typeof j === 'object') {
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === 'string' && /^\d{5,12}$/.test(k)) out['group:' + k] = v
        else if (v && typeof v === 'object' && v.name) out['group:' + k] = String(v.name)
      }
    }
  } catch {}
  return out
}
const GROUP_NAMES = loadGroupNames()

/**
 * 2026-11-07 22:1x：群号不进仓库（这个仓是公开的）。
 *
 * 客户端的「群」分带原来写死三个群号，现在改成从这里下发：本机配置 + live/qq-groups.json 合起来。
 * 仓库里没有号，没配就是空表——视图会把所有群并进「其他群」，布局照旧，不崩。
 */
function withRoomLabels(data, cfg) {
  if (!data || typeof data !== 'object') return data
  return { ...data, roomLabels: { ...GROUP_NAMES, ...((cfg && cfg.roomLabels) || {}) } }
}

const ROUTE = '/_dsh/dsh-ming-graph'
const IDENTITY_ROUTE = '/_dsh/dsh-ming-memory/identity'

// ---------- 读盘 / 算模型已经搬走（2026-11-08） ----------
// 这批函数过去住在这儿，导致「记忆的实现」落在「展示的插件」里。
// 现在它们在 dsh-ming-memory/lib/model.mjs：memory 负责读、负责算，这个插件只负责把它画出来。
// 同一天搬过去的还有 neuron.js（建图 + 统一节点模型），见 memory/lib/neuron.mjs。
export const __internals = { build, readDsh, readQQ, readPeople, DEFAULTS }

// ---------- 服务 ----------
export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...LOCAL, ...(config || {}) }
  // 群名两处来源：本机 live/qq-groups.json（GROUP_NAMES）+ 配置里手填的 roomLabels。
  // 以前在 build() 里现查两次，现在并进 cfg 一次——手填的优先，读盘那边只看 cfg.roomLabels。
  cfg.roomLabels = { ...GROUP_NAMES, ...(cfg.roomLabels || {}) }
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
        const [dsh, qq, names] = await Promise.all([readDsh(cfg), readQQ(cfg), readPeople(cfg)])
        cache = build(cfg, { dsh, qq, names })
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
        const [dsh, qq, names] = await Promise.all([impl.readDshNotes(cfg.dshMemoryDir), impl.readQqObservations(cfg.qqObservations), readPeople(cfg)])
        nCache = mergePeople(impl.buildNeuron({ dsh, qq, cfg, names }))
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

  // 身份与称呼设置由 Graph 自己提供 API，避免依赖 memory bundle 的加载顺序。
  // 数据只写入工作区 live/identity.json；不把个人身份内容放进插件源码或仓库。
  const identityDefaults = {
    selfName: '大肥鱼',
    selfFullName: '大肥鱼',
    selfDesc: '',
    userName: '主人',
    qqName: '',
    identity: true,
  }
  const identityFile = path.join(
    cfg.skillsCwd || process.env.MING_WORKSPACE || process.cwd(),
    'live',
    'identity.json',
  )
  const identityFields = ['selfName', 'selfFullName', 'selfDesc', 'userName', 'qqName', 'identity']
  const readIdentity = async () => {
    try {
      const saved = JSON.parse(await fs.readFile(identityFile, 'utf8'))
      const identity = { ...identityDefaults }
      for (const key of identityFields) {
        if (key === 'identity') {
          if (typeof saved?.[key] === 'boolean') identity[key] = saved[key]
        } else if (typeof saved?.[key] === 'string') {
          identity[key] = saved[key].slice(0, 2000)
        }
      }
      return { identity, onboarded: true }
    } catch (err) {
      if (err?.code === 'ENOENT') return { identity: { ...identityDefaults }, onboarded: false }
      throw err
    }
  }

  ctx.inject(['connection', 'webServer'], (identityCtx) => {
    identityCtx.effect(() => {
      const dispose = identityCtx.webServer.register({
        kind: 'prefix',
        path: IDENTITY_ROUTE,
        handler: async (req, res) => {
          const send = (status, body) => {
            res.writeHead(status, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify(body))
          }
          try {
            if (identityCtx.connection && typeof identityCtx.connection.requestRejection === 'function') {
              const rejection = identityCtx.connection.requestRejection(req)
              if (rejection !== undefined) {
                send(rejection || 403, { ok: false, error: 'rejected' })
                return
              }
            }

            const url = new URL(req.url || '/', 'http://localhost')
            if (url.pathname !== IDENTITY_ROUTE) {
              send(404, { ok: false, error: 'not found' })
              return
            }

            if (req.method === 'GET') {
              const result = await readIdentity()
              send(200, { ok: true, ...result })
              return
            }

            if (req.method !== 'POST') {
              send(405, { ok: false, error: 'method not allowed' })
              return
            }

            const declaredLength = Number(req.headers?.['content-length'] || 0)
            if (declaredLength > 65536) {
              send(413, { ok: false, error: 'payload too large (64 KB maximum)' })
              return
            }

            const chunks = []
            let size = 0
            for await (const chunk of req) {
              size += chunk.length
              if (size > 65536) {
                send(413, { ok: false, error: 'payload too large (64 KB maximum)' })
                return
              }
              chunks.push(chunk)
            }

            let incoming
            try {
              incoming = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              send(400, { ok: false, error: 'invalid JSON' })
              return
            }
            if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
              send(400, { ok: false, error: 'expected a JSON object' })
              return
            }

            const identity = { ...identityDefaults }
            for (const key of identityFields) {
              if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue
              if (key === 'identity') {
                if (typeof incoming[key] === 'boolean') identity[key] = incoming[key]
              } else if (typeof incoming[key] === 'string') {
                identity[key] = incoming[key].slice(0, 2000)
              }
            }

            await fs.mkdir(path.dirname(identityFile), { recursive: true })
            const tempFile = identityFile + '.' + process.pid + '.' + Date.now() + '.tmp'
            try {
              await fs.writeFile(tempFile, JSON.stringify(identity, null, 2) + '\n', 'utf8')
              await fs.rename(tempFile, identityFile)
            } catch (error) {
              await fs.rm(tempFile, { force: true }).catch(() => {})
              throw error
            }

            send(200, { ok: true, identity, onboarded: true })
          } catch (error) {
            send(500, { ok: false, error: String(error?.message || error) })
          }
        },
      })
      return dispose
    })
  })


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
