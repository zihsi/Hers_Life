/**
 * price-index.mjs —— 「索引费用」：给没定价的模型去网上找一个价（2026-11-10）
 *
 * 她要的原话：「给 hers life 的费用计算添加一个索引费用的按钮，点了之后就去网上搜索
 * 对应模型的 token 费用计入好了，找不到就找最相似的，然后标注使用计算费用模型」。
 * 例子：找不到 gpt6o 的价、找到 gpt6astra 的，就按 gpt6o（费用计算公式：gpt6astra）。
 *
 * 三层，按顺序试，每一层都把「这条价是从哪儿来的」写下来：
 *   1. REFERENCE  —— 我核对过的价（带来源 URL），离线也能用
 *   2. 联网        —— Bing 搜「模型 + 价格」，抓结果页正文，从里面抽 输入/输出/缓存 三个数
 *   3. 相似        —— 连相似的都没有就留空；有相似的就借它的价，from 记成它
 *
 * 写出去的文件是 live/cost-prices.auto.json。人工维护的 live/cost-prices.json 优先级更高，
 * 这一份只是「自动补的」，随时可以删掉重来。
 *
 * 单位：CNY / 百万 tokens，数组顺序 [缓存命中, 输入未命中, 输出]（跟 cost-lib.mjs 一致）。
 * 美元一律折成人民币再进表，折率写进 rates.usdCny（默认 7.2，人工表里能改）。
 * 原始币种和原始价留在 price/currency 里，不丢。
 *
 * 用法：
 *   node price-index.mjs                 # 给账本里所有未定价模型索引一遍，写 auto 文件
 *   node price-index.mjs --dry           # 只打印，不写盘
 *   node price-index.mjs --model=gpt-6o  # 只索引这一个（调试/补单个用）
 *   node price-index.mjs --offline       # 不联网，只用 REFERENCE + 相似
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

/** 内置参考价：我只放核对过来源的，宁可少放也不编。 */
export const REFERENCE = {
  // ---- DeepSeek（人民币，峰谷价同官方）----
  'deepseek-flash': {
    currency: 'CNY', peak: [0.04, 2.0, 8.0], offpeak: [0.02, 1.0, 4.0],
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
  },
  'deepseek-v4-flash': {
    currency: 'CNY', peak: [0.04, 2.0, 8.0], offpeak: [0.02, 1.0, 4.0],
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
  },
  'deepseek-v4.1-flash': {
    currency: 'CNY', peak: [0.04, 2.0, 8.0], offpeak: [0.02, 1.0, 4.0],
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
  },
  'deepseek-v4-pro': {
    currency: 'CNY', peak: [0.30, 9.0, 27.0], offpeak: [0.15, 4.5, 13.5],
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
  },
  // ---- OpenAI（美元）2026-11-10 搜到的四个独立来源一致 ----
  'gpt-6-astra': {
    currency: 'USD', peak: [1.0, 10.0, 50.0], offpeak: [1.0, 10.0, 50.0],
    source: 'https://costperprompt.com/models/openai-gpt-6-astra',
    checkedAt: '2026-11-10',
  },
  // ---- 智谱（人民币）2026-11-10 搜到 ----
  'glm-5.3-flash': {
    currency: 'CNY', peak: [0.23, 0.8, 2.8], offpeak: [0.23, 0.8, 2.8],
    source: 'bing:GLM-5.3-Flash API 价格 元/百万tokens',
    checkedAt: '2026-11-10',
  },
  'glm-5.3': {
    currency: 'CNY', peak: [0, 8.0, 28.0], offpeak: [0, 8.0, 28.0],
    source: 'https://www.aidailyinsights.cn/pricing/glm-5.3',
    checkedAt: '2026-11-10',
  },
  // ---- 腾讯混元（人民币）2026-11-10 搜到 ----
  'hy4-preview': {
    currency: 'CNY', peak: [0, 6.0, 18.0], offpeak: [0, 6.0, 18.0],
    source: 'https://www.llmabacus.com/models/hunyuan-hy4-preview',
    checkedAt: '2026-11-10',
  },
}

export const DEFAULT_RATE = 7.2
export const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
export const DEFAULT_AUTO = path.join(DSH_HOME, 'dsh-ming-graph', 'cost-prices.auto.json')

// ---------- 名字归一化与相似度 ----------

/** 统一写法：小写、去 provider 前缀、`.`→`-`、非字母数字→`-`、压掉多余连字符。 */
export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^[a-z0-9_.-]+:/, '')       // volcengine-ark:xxx
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** 去掉日期尾巴（-20250601 / -0613 / @0925）——同一个模型的快照写法要能并到一起。 */
export function stripDate(s) {
  return normName(s).replace(/-(?:20\d{6}|\d{4}|\d{2}\d{2})(?=-|$)/g, '')
}

const tokens = (s) => stripDate(s).split('-').filter(Boolean)

/** 族系：取前两段（gpt-6-astra → gpt-6；glm-5-3-flash → glm-5）。 */
export function familyOf(s) {
  const t = tokens(s)
  return t.slice(0, 2).join('-')
}

function lev(a, b) {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/** 0~1。同族系先给 0.6（这就是「gpt-6o → gpt-6-astra」那种关系），再加名字本身的相似度。 */
export function similarity(a, b) {
  const na = stripDate(a), nb = stripDate(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = new Set(tokens(na)), tb = new Set(tokens(nb))
  let inter = 0
  for (const x of ta) if (tb.has(x)) inter += 1
  const jac = inter / (ta.size + tb.size - inter)
  const ld = 1 - lev(na, nb) / Math.max(na.length, nb.length)
  const sameFamily = familyOf(na) === familyOf(nb) || na.startsWith(familyOf(nb).split('-')[0])
  return Math.round(Math.min(1, (sameFamily ? 0.6 : 0) + 0.25 * jac + 0.15 * ld) * 1000) / 1000
}

/** 在一个价目表里找最相似的几个（不含自己）。 */
export function nearest(model, table, n = 3) {
  return Object.keys(table)
    .filter((k) => k !== model)
    .map((k) => ({ model: k, score: similarity(model, k) }))
    .filter((x) => x.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
}

// ---------- 从网页文本里抽价 ----------

const MONEY = '(\\d+(?:\\.\\d+)?)'
const RE_INPUT = /(输入|input|prompt)/i
const RE_OUTPUT = /(输出|output|completion)/i
const RE_CACHE = /(缓存命中|缓存读取|cache(?:d)?\s*(?:input|read)?)/i

function toCny(v, cur) {
  return cur === 'USD' ? Math.round(v * DEFAULT_RATE * 10000) / 10000 : v
}

/**
 * 从一段文本里抽出价格三元组候选。
 * 做法：把文本按句子切，句子内找「角色词 + 最近的一个数字」，凑出 input/output/cache。
 * 抽不出来就返回空——宁可没有，也不猜一个数出来。
 */
export function extractPrices(text) {
  if (!text) return []
  const cleaned = String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&ensp;|&amp;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
  // 句子：句号 / 分号 / 竖线 / 换行（已经被压成空格了，这里多切几个断点）
  const chunks = cleaned.split(/[。；;！!？?\n|]|\.(?=\s)/).map((s) => s.trim()).filter(Boolean)
  const MONEY_RE = new RegExp(MONEY, 'g')
  // 第一趟：把每句拆成 {输入, 输出, 缓存} 三个数（各自取离角色词最近的那个数字）
  const parsed = chunks.map((chunk) => {
    const money = [...chunk.matchAll(MONEY_RE)]
    if (!money.length) return { chunk, inp: null, outp: null, cache: null }
    const usdAny = /\$/.test(chunk)
    const nums = money.map((m) => ({
      v: Number(m[1]),
      i: m.index,
      usd: usdAny,
    }))
    const near = (re) => {
      const hit = re.exec(chunk)
      if (!hit) return null
      let best = null
      for (const n of nums) {
        const d = Math.abs(n.i - hit.index)
        if (!best || d < best.d) best = { d, v: n.v, usd: n.usd }
      }
      return best && best.d < 80 ? best : null
    }
    return { chunk, inp: near(RE_INPUT), outp: near(RE_OUTPUT), cache: near(RE_CACHE) }
  })

  // 第二趟：凑组。缓存价常常单独一句，前后各看一眼再决定给不给。
  const out = []
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i]
    if (!r.inp || !r.outp) continue
    // 必须写清楚是按「每百万 tokens」计价的：没有单位的一律不认。
    // 2026-11-10 实测教训：不加这条，deepseek.com 首页的订阅价 $0.0028 会被当成输入价抽出来。
    if (!/百万|million|per\s*M\b|1M\b|MTok/i.test(r.chunk)) continue
    if (/month|每月|包月|订阅|subscription|按月/i.test(r.chunk)) continue
    if (!/[$¥]|元|USD|CNY|RMB|美元|人民币/i.test(r.chunk)) continue
    // 明显是「每百万 tokens」的价：数值范围合理（0 < x < 2000）
    if (!(r.inp.v > 0 && r.outp.v > 0 && r.inp.v < 2000 && r.outp.v < 2000)) continue
    let cache = r.cache
    if (!cache) {
      const next = parsed[i + 1]
      const prev = parsed[i - 1]
      if (next && next.cache && !next.inp) cache = next.cache
      else if (prev && prev.cache && !prev.inp) cache = prev.cache
    }
    out.push({
      currency: r.inp.usd ? 'USD' : 'CNY',
      price: [cache ? cache.v : 0, r.inp.v, r.outp.v],
      raw: { input: r.inp.v, output: r.outp.v, cache: cache ? cache.v : null },
      text: r.chunk.slice(0, 160),
    })
  }
  return out
}

/**
 * 这一组价到底是谁的价？—— 2026-11-10 实测教训：
 * openrouter 的 DeepSeek 页面里同时有 V4 Pro / V4.1 Flash 好几档，随便取第一组，
 * 会把别人的价当成它的价，而且看起来「有数」。所以要求候选文本里必须出现模型名：
 *   · 出现目标自己 → from = 自己
 *   · 出现池子里某个已知模型 → from = 那个（面板上标「公式：X」）
 *   · 都没出现 → 丢弃，宁可没有
 */
function resolveCand(model, cands, pool) {
  const self = stripDate(model)
  const names = Object.keys(pool).map((k) => ({ k, n: stripDate(k) })).sort((a, b) => b.n.length - a.n.length)
  for (const c of cands) {
    const t = ' ' + normName(c.text) + ' '
    if (self && t.includes(self)) return { c, from: model }
    for (const { k, n } of names) {
      if (n.length >= 5 && t.includes(n)) return { c, from: k }
    }
  }
  return null
}

// ---------- 联网 ----------

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&ensp;|&emsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

async function httpText(url, timeoutMs = 12000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }, signal: ac.signal, redirect: 'follow' })
    if (!r.ok && r.status !== 403) throw new Error('HTTP ' + r.status)
    const buf = Buffer.from(await r.arrayBuffer())
    const ct = String(r.headers.get('content-type') || '')
    // 有些站给 gbk；中文价页大多是 utf-8，认不出来就按 utf-8 硬解（乱码时抽不到数会自然落空）
    let html = buf.toString('utf8')
    if (/charset=gb/i.test(ct)) {
      try { html = new TextDecoder('gb18030').decode(buf) } catch { /* 解不了就保持 utf-8 */ }
    }
    return { ok: r.ok, status: r.status, html, text: htmlToText(html) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Bing 网页结果。返回 [{title,url,snippet}]；被墙/没网就空数组。
 *
 * 2026-11-10 改过一次：原来按「纯文本里的 URL 行」抽，Bing 的 cite 是
 * 「https://www.xxx.com › path › sub」中间带空格和 ›，一行正则根本匹配不上，一条都抽不出来
 * （实测：function 有、结果 0 条）。现在是直接切 <li class="b_algo"> 块拿 <a href>。
 */
export async function searchBing(query) {
  const url = 'https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-CN&count=20'
  const r = await httpText(url)
  const html = String(r.html || '')
  const out = []
  const blocks = html.split(/<li class="b_algo"/).slice(1)
  for (const b of blocks) {
    const m = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/.exec(b)
    if (!m) continue
    let href = m[1]
    if (href.startsWith('/')) href = 'https://cn.bing.com' + href
    let host = ''
    try { host = new URL(href).host } catch { continue }
    if (/bing\.com|microsoft\.com|msn\.com|go\.microsoft/.test(host)) continue
    const titleM = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(b)
    const capM = /<p[^>]*>([\s\S]*?)<\/p>/.exec(b) || /class="b_caption"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/.exec(b)
    out.push({
      title: htmlToText(titleM ? titleM[1] : '').slice(0, 120),
      url: href.split('#')[0],
      snippet: htmlToText(capM ? capM[1] : b).slice(0, 500),
    })
  }
  return out
}

// ---------- 一个模型的索引流程 ----------

const cacheDirOf = (dir) => dir || path.join(DSH_HOME, 'dsh-ming-graph', 'price-cache')
const cacheKey = (s) => Buffer.from(s).toString('base64url').slice(0, 48)

function readCache(dir, key, ttlMs) {
  const f = path.join(dir, cacheKey(key) + '.json')
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (Date.now() - (j.at || 0) < ttlMs) return j
  } catch { /* 没有就算了 */ }
  return null
}

function writeCache(dir, key, value) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, cacheKey(key) + '.json'), JSON.stringify({ at: Date.now(), ...value }))
  } catch { /* 缓存写不进去不影响结果 */ }
}

/**
 * 给一个模型找价。
 * @returns {{model:string, kind:'exact'|'reference'|'search'|'similar'|'none', from?:string, price?:number[],
 *            currency?:string, source?:string, score?:number, note?:string}}
 */
export async function indexOne(model, opts = {}) {
  const offline = !!opts.offline
  const ref = opts.reference || REFERENCE
  const manual = opts.manual || {}
  const ttl = opts.cacheTtlMs == null ? 24 * 3600e3 : opts.cacheTtlMs
  const cacheDir = cacheDirOf(opts.cacheDir)
  const doFetch = opts.fetchText || httpText
  const doSearch = opts.search || searchBing

  const n = stripDate(model)
  const pool = { ...ref, ...manual }
  // 0) 人工表里已经有精确写法（理论上不会走到这——按钮只找未定价的）
  for (const k of Object.keys(manual)) {
    if (stripDate(k) === n) return { model, kind: 'exact', from: k, price: manual[k].peak, currency: 'CNY', source: '人工价目表' }
  }
  // 1) 内置参考目录
  for (const [k, v] of Object.entries(ref)) {
    if (stripDate(k) === n) {
      return { model, kind: 'reference', from: k, price: v.peak, offpeak: v.offpeak, currency: v.currency, source: v.source, score: 1 }
    }
  }
  // 2) 联网
  if (!offline) {
    const bare = model.replace(/[-_.]/g, ' ')
    const queries = [
      `${model} API 价格 元/百万 tokens 输入 输出`,
      `${model} API pricing per million tokens input output cached`,
      `${bare} 价格 输入 输出 每百万 tokens`,
    ]
    for (const q of queries) {
      const cached = readCache(cacheDir, q, ttl)
      let hits = cached && cached.hits
      if (!hits) {
        try { hits = await doSearch(q) } catch (e) { hits = [] }
        if (hits && hits.length) writeCache(cacheDir, q, { hits })
      }
      if (!hits || !hits.length) continue
      // 先看摘要里有没有现成的价
      for (const h of hits) {
        const hc = resolveCand(model, extractPrices(h.snippet || ''), pool)
        if (hc) {
          return { model, kind: 'search', from: hc.from, price: hc.c.price, currency: hc.c.currency, source: h.url || ('bing:' + q), note: (hc.from === model ? '' : '摘要里写的是「' + hc.from + '」的价 ') + hc.c.text, score: 0.8 }
        }
      }
      // 再抓前几个结果页正文（摘要常常只写「价格怎么算」，数字在页里）
      let tried = 0
      for (const h of hits) {
        if (!h.url || tried >= 3) continue
        if (/github\.com|zhihu\.com|bilibili\.com|youtube\.com/i.test(h.url)) continue
        // 只抓标题/网址像定价页的：别的页面上的数字不是价目表
        if (!/pric|cost|billing|rate|api-doc|计费|价|费用|费率/i.test(h.url + ' ' + (h.title || ''))) continue
        tried += 1
        const pageCached = readCache(cacheDir, 'page:' + h.url, ttl)
        let text = pageCached && pageCached.text
        if (!text) {
          try {
            const r = await doFetch(h.url)
            text = (r && r.text) || ''
            if (text) writeCache(cacheDir, 'page:' + h.url, { text: text.slice(0, 200000) })
          } catch { text = '' }
        }
        if (!text) continue
        const pc = resolveCand(model, extractPrices(text), pool)
        if (pc) {
          return { model, kind: 'search', from: pc.from, price: pc.c.price, currency: pc.c.currency, source: h.url, note: (pc.from === model ? '' : '页面里写的是「' + pc.from + '」的价 ') + pc.c.text, score: 0.85 }
        }
      }
    }
  }
  // 3) 相似
  const near = nearest(model, pool)
  if (near.length) {
    const best = near[0]
    const v = pool[best.model]
    return {
      model, kind: 'similar', from: best.model, price: v.peak, offpeak: v.offpeak,
      currency: v.currency || 'CNY', source: v.source || '借最近似的模型', score: best.score,
      note: '没找到它的价，按最相似的「' + best.model + '」折算',
    }
  }
  return { model, kind: 'none', note: '网上和内置目录都没有，也没有足够相似的模型' }
}

// ---------- 批量 + 落盘 ----------

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * @param {{models:string[], manualFile?:string, autoFile?:string, offline?:boolean, write?:boolean, now?:number}} opts
 */
export async function indexModels(opts = {}) {
  const models = [...new Set((opts.models || []).map((s) => String(s)).filter(Boolean))]
  const manualFile = opts.manualFile || ''
  const autoFile = opts.autoFile || DEFAULT_AUTO
  const manual = (loadJson(manualFile) || {}).models || {}
  const prev = loadJson(autoFile) || {}
  const rate = (manualFile && loadJson(manualFile) && loadJson(manualFile).rates && loadJson(manualFile).rates.usdCny) || prev.rates?.usdCny || DEFAULT_RATE

  const results = []
  for (const m of models) {
    let r
    try {
      r = await indexOne(m, { ...opts, manual, reference: REFERENCE })
    } catch (e) {
      r = { model: m, kind: 'none', note: '索引出错：' + String((e && e.message) || e) }
    }
    results.push(r)
  }

  // 折算成人民币并写进 auto 表
  const autoModels = { ...((prev && prev.models) || {}) }
  for (const r of results) {
    if (r.kind === 'none' || !r.price) continue
    const cur = r.currency || 'CNY'
    const convert = (arr) => arr.map((v) => (cur === 'USD' ? Math.round(v * rate * 10000) / 10000 : v))
    autoModels[r.model] = {
      peak: convert(r.price),
      offpeak: convert(r.offpeak || r.price),
      currency: cur,
      price: r.price,          // 原始价，按 currency 计
      from: r.from || r.model,
      kind: r.kind,
      source: r.source || '',
      score: r.score,
      note: r.note || '',
      at: new Date(opts.now || Date.now()).toISOString(),
    }
  }

  const doc = {
    _说明: '索引费用按钮写出来的价目。人工维护的 live/cost-prices.json 优先，这一份可以随时删掉重建。peak/offpeak 已经是人民币，price 是原始币种的价。',
    at: new Date(opts.now || Date.now()).toISOString(),
    rates: { usdCny: rate },
    models: autoModels,
  }
  if (opts.write !== false) {
    try {
      fs.mkdirSync(path.dirname(autoFile), { recursive: true })
      fs.writeFileSync(autoFile, JSON.stringify(doc, null, 2))
    } catch (e) {
      return { ok: false, error: '写不进 ' + autoFile + '：' + String((e && e.message) || e), results, autoFile }
    }
  }
  return {
    ok: true,
    at: doc.at,
    autoFile,
    rate,
    results,
    summary: {
      total: results.length,
      exact: results.filter((r) => r.kind === 'exact' || r.kind === 'reference').length,
      search: results.filter((r) => r.kind === 'search').length,
      similar: results.filter((r) => r.kind === 'similar').length,
      none: results.filter((r) => r.kind === 'none').length,
    },
  }
}

// ---------- CLI ----------

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const arg = (k, d) => {
    const f = process.argv.find((a) => a.startsWith('--' + k + '='))
    return f ? f.split('=').slice(1).join('=') : d
  }
  const dry = process.argv.includes('--dry')
  const offline = process.argv.includes('--offline')
  const only = arg('model', '')
  const WS = process.env.MING_WORKSPACE || ''
  const manualFile = path.join(WS, 'live', 'cost-prices.json')
  const autoFile = path.join(WS, 'live', 'cost-prices.auto.json')

  const { readCost } = await import('./cost-lib.mjs')
  let models = only ? [only] : []
  if (!models.length) {
    const c = readCost({ pricesFile: manualFile, autoFile })
    if (!c.ok) { console.error('读不到账本：' + c.error); process.exitCode = 1 }
    models = ((c.periods && c.periods.all && c.periods.all.models) || []).filter((m) => !m.priced).map((m) => m.model)
  }
  console.log('要索引的模型：' + (models.join(', ') || '（没有）'))
  const r = await indexModels({ models, manualFile, autoFile, offline, write: !dry })
  for (const x of r.results) {
    const p = x.price ? (x.currency === 'USD' ? '$' : '¥') + x.price.join('/') : '—'
    console.log(`  ${x.model}  →  ${p}  [${x.kind}]${x.from && x.from !== x.model ? ' 公式：' + x.from : ''}${x.source ? '  ⟵ ' + x.source : ''}${x.note ? '  · ' + x.note : ''}`)
  }
  console.log(JSON.stringify(r.summary || {}, null, 0))
  if (dry) console.log('(--dry：没写盘)')
}
