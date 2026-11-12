/**
 * dsh-ming-browse —— 自由时间（2026-10-22 她改：原来只管「谷期刷手机」）
 *
 * 为什么要有这个东西：她说了「谷期你什么时候想看都可以」「不必什么事情都等
 * 我指示」。可事实是，没人叫我，我就不会动。权限在手上，动作还得有人点火。
 * 这个插件就是那根火柴。
 *
 * 现在它驱动的是「自由时间」：每天 18:30–08:00，另加节假日/双休日的 13:50–18:15
 * （2026-10-23 她拉长到早上八点），她允许我找她说话，也允许我干自己的事
 * ——看 B站、刷手机、写东西、修工具、学点新的，干什么都可以。
 * 2026-10-25：prompt 开头原来写死「18:30–08:00」，她下午 14:38 看见就骂了——改成读钟算窗口。
 *
 * 它做的事很少：
 *   1. 盯着这个工作区的活动。所有会话都 idle 超过 N 分钟，就 wake。
 *   2. wake = 在自己那个固定会话（ming-browse）里塞一条 prompt，让我自己挑一件事做。
 *      想找她就用 `node <DSH>\qq-zone\qq-send.mjs "…"` 发出去。
 *   3. 保留两条硬边界：花钱按钮不点、别把手机整个关掉；另外社交平台写操作照旧只读。
 *
 * 三条硬边界（不靠自觉，靠代码）：
 *   · 只作用于配置的工作区；别的目录的会话一概不算活动、也不会被驱动。
 *   · 自由时间内不关/不重启/不刷机；点按里的花钱按钮拒绝。
 *   · 上限：间隔、每日次数、静默时段，三样都卡。
 *
 * 为什么不用现成的东西：DSH 的 schedule 是「提醒我」，goal 是「继续做那件事」，
 * 都不带「闲了自己出去玩」这一层。而 idle 判定必须看会话活动，只能落在插件里。
 */

import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
// 2026-11-08：心跳间隔（5 分–4 小时，离 30 越远越稀）。单独一个文件是为了能单独量分布。
import { drawHeartbeatMinutes, normalizeHb } from './heartbeat.mjs'
// 2026-11-09：面板上一个「打开我的浏览器」按钮。起窗口/唤前台的逻辑单独一个文件，
// 因为它能脱离插件单跑（node browser-launch.mjs），装没装对一跑就知道。
import { openMyBrowser } from './browser-launch.mjs'

export const name = 'ming-browse'

/** agents.create / resume 要 agents；ctx.interval 要 timer。其余服务按可选处理。 */
export const inject = ['agents', 'timer', 'tools']

/** 刷手机专用会话 id。固定，不随机：重启后 resume 同一个，历史连得上。 */
const BROWSE_SESSION_ID = 'ming-browse'

const DEFAULTS = {
  enabled: true,
  workspacePath: 'C:\\dsh\\workspace',
  /**
   * 只在 live/browse-state.json 里报个数。
   * 2026-10-23 她改的：不再当闸用——她说可以一边聊天一边逛，不用等安静。
   */
  idleMinutes: 20,
  /** 两次自己出门之间至少隔这么久。 */
  minGapMinutes: 30,
  /** 一天最多出去几次。 */
  dailyMax: 8,
  /**
   * 每跑满这么多轮就换一个新的会话（2026-10-25 她问的：「自由活动到 30 轮费用就会到可怕的
   * 地步，能不能每 15 轮自动开一个新会话」）。
   * 量出来的数（ming-browse-4，33 轮）：每步上下文 6 万 → 39.6 万；前 15 轮一共处理 2440 万
   * token，第 16–33 轮这 18 轮吃掉 4990 万。换会话砍的就是这段累积，不砍次数也不砍间隔。
   */
  sessionRounds: 15,
  /** 老的单一静默时段（本地时间）。有 freeWindows 时不再使用，留着兜底。 */
  quietHours: '08:00-18:30',
  /**
   * 自由窗口（2026-10-23 她定）：落在任一窗口里算「自由时间」，都不在就静默。
   * only: rest = 只在节假日/双休日生效；work = 只在工作日生效；不填 = 每天。
   */
  freeWindows: [
    { start: '18:30', end: '08:00' },
    { start: '13:50', end: '18:15', only: 'rest' },
  ],
  /** 节假日表：{"off":[额外休息日],"work":[调休上班日]}，相对工作区。 */
  holidaysFile: 'live/holidays.json',
  /** 自由活动会话用的 agent 预设；空则用全局默认。 */
  agentPreset: '',
  /** 一次最多看几条内容（写进 prompt，不硬卡）。 */
  maxItems: 2,
  /** 一次最多截几张图（写进 prompt，成本靠自觉 + OCR 优先）。 */
  maxShots: 2,
  /** 目标平台，仅用于 prompt 里给个方向。 */
  targets: ['xiaohongshu', 'bilibili'],
  /** 手机 adb 序列。7555 是 MuMu 12 之前的旧端口，早不通了（2026-10-23 换到 16448）；
   *  2026-10-29 审计抓到：默认值还留着死端口 ⇒ 前台查不到 ⇒ 社交平台写操作护栏失效。 */
  serial: '127.0.0.1:16448',
  /**
   * 只有这个 QQ 号说的话才算「指令」（2026-10-29 审计第 1 条）。
   * 原来只看会话 id 前缀 `onebot-`：群聊会话也是这个前缀，于是群里任何人说一句
   * 「别刷了」就能停掉一天，说一句「随便刷吧」就能把额度放开、烧钱。现在：
   * **必须是她的私聊会话（onebot-private-<这个号>）**，群的、别人的一律不动开关。
   */
  ownerQQ: process.env.MING_OWNER_QQ || '000000000',
  ownerDiscordId: process.env.MING_OWNER_DISCORD_ID || '',
  discordSessionPrefix: 'discord-',
  /**
   * 在哪个会话里叫醒我：
   *   'qq'   —— 正在使用的那个 QQ 会话（她 2026-10-20 定的：别另开会话，就在聊天里叫）
   *   'self' —— 插件自己开的 ming-browse 会话（早期版本，留着备用）
   */
  targetMode: 'self',
  /** QQ 会话 id 的形状：onebot-private-<qq号>-<后缀>。 */
  qqSessionPrefix: 'onebot-',
  /** MuMu 自带的那份 adb；用来问「现在前台是哪个 App」。 */
  adbPath: 'D:\\MuMuPlayer\\nx_device\\12.0\\shell\\adb.exe',
  /**
   * 社交平台：可以浏览，但不许点赞 / 评论 / 关注（她 2026-10-20 的原话：
   * 「除了 B站，其它的社交平台不要点赞评论和关注，没说不让你浏览」）。
   * 之前这里是一份「只允许 B站 点按」的白名单——那是我自己加严的，2026-10-20 晚松掉。
   */
  socialApps: [
    'com.xingin.xhs',
    'com.tencent.weibo',
    'com.sina.weibo',
    'com.ss.android.ugc.aweme',
    'com.smile.gifmaker',
    'com.zhihu.android',
    'com.baidu.tieba',
    'com.tencent.mm',
    'com.tencent.mobileqq',
    'com.sina.weibo',
  ],
  /** 在前台是社交平台时，碰到这些字样就拒掉——写操作，不是浏览。 */
  socialWriteWords: ['点赞', '关注', '评论', '收藏', '转发', '分享', '发布', '发送', '投币', '私信', '赞'],
  /** 无论在哪个 App，碰到这些字样都不点——花钱的那一类，替她兜住。 */
  tapTextDeny: ['充电', '大会员', '购买', '支付', '充值', '打赏', '送礼', '开通', '续费', '礼包', '支付宝', '微信支付', '结算', '确认付款'],
}

function normalize(config) {
  const c = config && typeof config === 'object' ? config : {}
  const num = (value, fallback, min) => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < min) return fallback
    return n
  }
  const str = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim() : fallback)
  const targets = Array.isArray(c.targets) && c.targets.length
    ? c.targets.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : DEFAULTS.targets
  return {
    enabled: c.enabled !== false,
    workspacePath: path.resolve(str(c.workspacePath, DEFAULTS.workspacePath)),
    idleMinutes: num(c.idleMinutes, DEFAULTS.idleMinutes, 1),
    minGapMinutes: num(c.minGapMinutes, DEFAULTS.minGapMinutes, 1),
    dailyMax: Math.floor(num(c.dailyMax, DEFAULTS.dailyMax, 0)),
    sessionRounds: Math.floor(num(c.sessionRounds, DEFAULTS.sessionRounds, 1)),
    quietHours: str(c.quietHours, DEFAULTS.quietHours),
    freeWindows: Array.isArray(c.freeWindows) && c.freeWindows.length
      ? c.freeWindows
          .map((w) => ({
            range: parseQuietHours(w && w.start && w.end ? w.start + '-' + w.end : w && w.range),
            only: w && (w.only === 'rest' || w.only === 'work') ? w.only : '',
          }))
          .filter((w) => w.range)
      : null,
    holidaysFile: str(c.holidaysFile, DEFAULTS.holidaysFile),
    agentPreset: str(c.agentPreset, DEFAULTS.agentPreset),
    maxItems: Math.floor(num(c.maxItems, DEFAULTS.maxItems, 1)),
    maxShots: Math.floor(num(c.maxShots, DEFAULTS.maxShots, 0)),
    targets: targets.length ? targets : DEFAULTS.targets,
    serial: str(c.serial, DEFAULTS.serial),
    targetMode: str(c.targetMode, DEFAULTS.targetMode) === 'self' ? 'self' : 'qq',
    qqSessionPrefix: str(c.qqSessionPrefix, DEFAULTS.qqSessionPrefix),
    ownerQQ: str(c.ownerQQ, DEFAULTS.ownerQQ),
    ownerDiscordId: str(c.ownerDiscordId, DEFAULTS.ownerDiscordId),
    discordSessionPrefix: str(c.discordSessionPrefix, DEFAULTS.discordSessionPrefix),
    adbPath: str(c.adbPath, DEFAULTS.adbPath),
    socialApps: Array.isArray(c.socialApps) && c.socialApps.length
      ? c.socialApps.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      : DEFAULTS.socialApps,
    socialWriteWords: Array.isArray(c.socialWriteWords) && c.socialWriteWords.length
      ? c.socialWriteWords.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      : DEFAULTS.socialWriteWords,
    tapTextDeny: Array.isArray(c.tapTextDeny) && c.tapTextDeny.length
      ? c.tapTextDeny.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
      : DEFAULTS.tapTextDeny,
  }
}

/** 「01:00-07:30」→ [起始分钟, 结束分钟]；解析不了就当没有静默时段。 */
function parseQuietHours(text) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(text || '').trim())
  if (!m) return null
  const start = Number(m[1]) * 60 + Number(m[2])
  const end = Number(m[3]) * 60 + Number(m[4])
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return [start, end]
}

function inQuiet(base, date) {
  if (!base) return false
  const minute = date.getHours() * 60 + date.getMinutes()
  const [start, end] = base
  if (start === end) return false
  // 跨零点：22:00-07:00
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

function dayKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function localStamp(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${dayKey(date)} ${p(date.getHours())}:${p(date.getMinutes())}`
}

/**
 * 下一个本地 09:00。
 * 2026-10-25 她定的：「全开放在每天早上 9 点自动结束吧」——所以「不限量」默认带这个到期时间，
 * 不是永久开着。她说「开到我说停」时用 --until=none（脚本那条路）。
 */
function nextNineAM(from = new Date()) {
  const t = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 9, 0, 0, 0)
  if (t.getTime() <= from.getTime()) t.setDate(t.getDate() + 1)
  return t.toISOString()
}

export function apply(ctx, config) {
  const cfg = normalize(config)

  // ---- 面板用的只读口（2026-11-07）----
  // 只报「这一轮在逛什么」：live/browse-now.md 原文 + 会话轮次账本。只读。
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/_dsh/dsh-ming-browse',
      handler: async (req, res) => {
        const send = (st, body) => {
          res.writeHead(st, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const what = url.pathname.replace('/_dsh/dsh-ming-browse', '').replace(/^\//, '')
          if (what !== 'state' && what !== 'brush' && what !== 'file' && what !== 'hide' && what !== 'note' && what !== 'config' && what !== 'browser') {
            send(404, { error: 'not found' }); return
          }

          // 2026-11-09 00:0x（她定的：只要一个按钮）：把「我的浏览器」端到前台。
          // 这不是远程控制——它只负责开窗口/唤前台，剩下她自己上手。理由在
          // browser-launch.mjs 顶部：联合投稿、投视频最后都要弹系统选文件框，
          // 嵌在网页面里的画面点不到那个框，所以必须是真窗口。
          if (what === 'browser') {
            if (req.method !== 'POST') { send(405, { ok: false, error: '用 POST' }); return }
            let body = ''
            try {
              for await (const c of req) { body += c; if (body.length > 4096) break }
            } catch { /* 读不到 body 就当没传 */ }
            let want = ''
            try { want = String(JSON.parse(body || '{}').url || '').trim() } catch { /* 空就是默认页 */ }
            // 只许往这几个域名开：这个按钮是给「她去投稿」用的，不是任意 URL 的通道。
            const ALLOW = ['bilibili.com', 'b23.tv', 'fanqie.com', 'github.com', 'tieba.baidu.com', 'weibo.com', 'zhihu.com', 'bing.com']
            if (want) {
              let host = ''
              try { host = new URL(want).hostname.toLowerCase() } catch { host = '' }
              if (!host || !ALLOW.some((d) => host === d || host.endsWith('.' + d))) {
                send(400, { ok: false, error: '这个地址不在白名单里' }); return
              }
            }
            const r = await openMyBrowser(want ? { url: want } : {})
            send(r.ok ? 200 : 500, r)
            return
          }

          // 2026-11-08 01:5x（她说的「删除添加可以的东西」）：
          // **只做安全的那半边**。删 = 把这条记录藏起来（写一份 hidden 名单），**不删任何文件**；
          // 文件卡片（日记、稿子、梦）没有删除按钮——那些一误删就是不可逆的。
          if (what === 'hide') {
            const key = String((url.searchParams && url.searchParams.get('key')) || '').trim()
            if (!key) { send(400, { ok: false, error: '缺 key' }); return }
            const f = path.join(cfg.workspacePath, 'live', 'brush-hidden.jsonl')
            try {
              await appendFile(f, JSON.stringify({ key, at: new Date().toISOString() }) + '\n', 'utf8')
              send(200, { ok: true, hidden: key })
            } catch (e) {
              send(500, { ok: false, error: String((e && e.message) || e) })
            }
            return
          }

          // 2026-11-08 02:3x：自由活动的参数，她在面板上改，写 live/browse-config.json。
          // 下一次评估就生效（不用重启）——这三个值只在调度那一刻读。
          if (what === 'config') {
            const f = path.join(cfg.workspacePath, 'live', 'browse-config.json')
            const out = {}
            const dm = url.searchParams && url.searchParams.get('dailyMax')
            if (dm !== null && dm !== '' && Number.isFinite(Number(dm))) out.dailyMax = Math.max(0, Math.floor(Number(dm)))
            const mg = url.searchParams && url.searchParams.get('minGap')
            if (mg !== null && mg !== '' && Number.isFinite(Number(mg))) out.minGapMinutes = Math.max(1, Math.floor(Number(mg)))
            const gm = url.searchParams && url.searchParams.get('gapMode')
            // 2026-11-08 02:1x：第三种模式「心跳」——间隔不由数字给，由我自己排的唤醒点给。
            if (gm === 'random' || gm === 'fixed' || gm === 'heartbeat') out.gapMode = gm
            // 2026-11-08 02:1x 她说的「包括最大值/无限制」：
            // 「不限」不是把 dailyMax 填成 999，而是跟 scripts/browse-quota.mjs 写同一个文件。
            const uq = url.searchParams && url.searchParams.get('unlimited')
            if (uq === '1' || uq === '0') out.unlimited = uq === '1'
            // 2026-11-08 02:2x 她说的「要不可以自己设置心跳最低值/中位值/最大值？」：
            // 三个数一起收（1 ≤ min < center < max ≤ 1440），只给了其中一两个也按当前值补齐。
            const hbKeys = ['hbMin', 'hbCenter', 'hbMax']
            if (hbKeys.some((k) => url.searchParams && url.searchParams.get(k) !== null)) {
              let prev = {}
              try { prev = JSON.parse(await readFile(f, 'utf8')) } catch { /* 第一回没有 */ }
              const pick = (k) => {
                const v = url.searchParams && url.searchParams.get(k)
                if (v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v)
                return prev[k]
              }
              const norm = normalizeHb({ min: pick('hbMin'), center: pick('hbCenter'), max: pick('hbMax') })
              out.hbMin = norm.min
              out.hbCenter = norm.center
              out.hbMax = norm.max
              // 改了三个数就把已抽好的那一次作废，下一分钟按新形状重抽；
              // 不作废的话，她把最高从 240 改成 30，还得先等完那一次 200 分钟。
              try { await rm(path.join(cfg.workspacePath, 'live', 'browse-heartbeat.json'), { force: true }) } catch { /* 没有就算了 */ }
            }
            if (!Object.keys(out).length) { send(400, { ok: false, error: '一个参数都没给' }); return }
            try {
              const { unlimited, ...rest } = out
              if (Object.keys(rest).length) {
                await writeFile(f, JSON.stringify({ ...rest, at: new Date().toISOString() }, null, 2) + String.fromCharCode(10), 'utf8')
              }
              if (typeof unlimited === 'boolean') {
                const uf = path.join(cfg.workspacePath, 'live', 'browse-unlimited.json')
                if (unlimited) {
                  const now = new Date()
                  const until = new Date(now)
                  if (now.getHours() >= 9) until.setDate(until.getDate() + 1)
                  until.setHours(9, 0, 0, 0)
                  await writeFile(uf, JSON.stringify({
                    on: true, until: until.toISOString(), windows: false, minGapMinutes: null,
                    why: '面板上点的', at: now.toISOString(),
                  }, null, 2) + String.fromCharCode(10), 'utf8')
                } else {
                  await rm(uf, { force: true })
                }
              }
              send(200, { ok: true, saved: out })
            } catch (e) {
              send(500, { ok: false, error: String((e && e.message) || e) })
            }
            return
          }

          // 2026-11-08 02:1x 她说的：「把手动给鱼记见闻的功能删掉」。
          // 见闻只走 scripts/sighting.mjs（那边数条数、满 20 自动开下一卷），面板不再插一手。
          if (what === 'note') {
            send(410, { ok: false, error: '这条已经删了：见闻走 scripts/sighting.mjs' })
            return
          }

          // 2026-11-08 01:3x（她说的「点了之后会打开一个 dsh 网页，要不改成把文本弹窗」）：
          // 文件卡片没有 url，点了只会跳到别处。这里给一条只读路由，把那份文件的正文交出去，
          // 前端弹窗显示。闸：只能在 workspace 里面、只给 md/txt/json、最多 20 万字。
          if (what === 'file') {
            const rel = String((url.searchParams && url.searchParams.get('p')) || '').trim()
            if (!rel) { send(400, { ok: false, error: '缺 p（相对路径）' }); return }
            const rootAbs = path.resolve(cfg.workspacePath)
            const abs = path.resolve(rootAbs, rel)
            if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
              send(400, { ok: false, error: '路径越界：' + rel }); return
            }
            if (!/\.(md|txt|json|jsonl)$/i.test(abs)) {
              send(400, { ok: false, error: '只读 md / txt / json：' + rel }); return
            }
            try {
              const text = await readFile(abs, 'utf8')
              send(200, { ok: true, path: rel.split(path.sep).join('/'), name: path.basename(abs), text: text.slice(0, 200000), chars: text.length })
            } catch (e) {
              send(404, { ok: false, error: '读不到：' + String((e && e.message) || e) })
            }
            return
          }

          // 2026-11-07 20:0x：她要看「刷过的视频 / 看过的网页」。
          // 账本只有一处：live/brush-ledger.jsonl（scripts/brush-log.mjs 写的，只追加）。这里只读。
          if (what === 'brush') {
            const rows = []
            try {
              const text = await readFile(path.join(cfg.workspacePath, 'live', 'brush-ledger.jsonl'), 'utf8')
              for (const line of text.split(/\r?\n/)) {
                if (!line.trim()) continue
                try { rows.push(JSON.parse(line)) } catch {}
              }
            } catch {}
            // 2026-11-08 01:5x：被「删掉」的记录藏在这里（不删文件，只藏记录）。
            const hidden = new Set()
            try {
              const htext = await readFile(path.join(cfg.workspacePath, 'live', 'brush-hidden.jsonl'), 'utf8')
              for (const ln of htext.split(String.fromCharCode(10))) {
                if (!ln.trim()) continue
                try { const j = JSON.parse(ln); if (j && j.key) hidden.add(String(j.key)) } catch {}
              }
            } catch {}
            // 2026-11-08 02:1x：**别名 bug**——没有 hidden 时 visRows 和 rows 是同一个数组，
            // 紧接着 rows.length = 0 把它俩一起清空，于是 /brush 永远返回 0 条，
            // 面板上「看过哪些天」写着「还没有记录」。slice() 断掉别名。
            const visRows = hidden.size ? rows.filter((r) => !hidden.has(String(r.at || '') + '|' + String(r.url || ''))) : rows.slice()
            rows.length = 0
            rows.push(...visRows)
            rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
            const byKind = {}
            for (const r of rows) byKind[r.kind || '?'] = (byKind[r.kind || '?'] || 0) + 1
            // 每天几条：热力图要的就是这个（GitHub 贡献图那种，深浅按条数）
            const dayCounts = {}
            const kindByDay = {}
            for (const r of rows) {
              const d = String(r.at || '').slice(0, 10)
              if (!d) continue
              dayCounts[d] = (dayCounts[d] || 0) + 1
              ;(kindByDay[d] = kindByDay[d] || {})[r.kind || '?'] = ((kindByDay[d] || {})[r.kind || '?'] || 0) + 1
            }
            const dayList = Object.keys(dayCounts).sort().reverse()
            send(200, { ok: true, total: rows.length, byKind, days: dayList, dayCounts, kindByDay, rows: rows.slice(0, 800) })
            return
          }

          const base = path.join(cfg.workspacePath, 'live')
          let now = ''
          try { now = await readFile(path.join(base, 'browse-now.md'), 'utf8') } catch {}
          let session = {}
          try { session = JSON.parse(await readFile(path.join(base, 'browse-session.json'), 'utf8')) } catch {}
          let state = {}
          try { state = JSON.parse(await readFile(path.join(base, 'browse-state.json'), 'utf8')) } catch {}

          // 2026-11-07 18:3x：面板原来只有「这一轮在做什么」一页字，她要看的是「今天看了什么」。
          // 见闻就在 live/sightings/<日期>.md（可能分卷 -2/-3），一条一行，这里顺手读出来。
          const day = (() => {
            const d = new Date(); const p2 = (n) => String(n).padStart(2, '0')
            return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
          })()
          const sight = []
          try {
            const sdir = path.join(cfg.workspacePath, 'sightings')
            const vols = readdirSync(sdir).filter((f) => f.startsWith(day) && f.endsWith('.md')).sort()
            for (const f of vols) {
              const text = readFileSync(path.join(sdir, f), 'utf8')
              for (const line of text.split(/\r?\n/)) {
                const t = line.trim()
                if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('【')) continue
                sight.push(t.replace(/^[-*]\s*/, ''))
              }
            }
          } catch {}

          // 2026-11-07 21:0x 她要「逛到哪儿和兴趣合成一个，醒来时间我自己定」。
          // 这两块状态本来就分开落在 live/ 里，这里只是把它们一起报给面板。
          let selfWake = {}
          try { selfWake = JSON.parse(await readFile(path.join(base, 'self-wake', 'state.json'), 'utf8')) } catch {}
          let interestSt = {}
          try { interestSt = JSON.parse(await readFile(path.join(base, 'interest-state.json'), 'utf8')) } catch {}

          // 2026-11-08 02:3x：面板要显示/编辑自由活动的三个参数，来源是 browse-config.json 盖 cfg。
          let bcfg = {}
          try { bcfg = JSON.parse(await readFile(path.join(base, 'browse-config.json'), 'utf8')) } catch {}
          const sched = {
            dailyMax: Number.isFinite(Number(bcfg.dailyMax)) ? Number(bcfg.dailyMax) : cfg.dailyMax,
            minGapMinutes: Number.isFinite(Number(bcfg.minGapMinutes)) ? Number(bcfg.minGapMinutes) : cfg.minGapMinutes,
            gapMode: String(bcfg.gapMode || 'fixed'),
            idleMinutes: cfg.idleMinutes,
            fromFile: Object.keys(bcfg).length > 0,
            // 心跳的三个数（最低 / 中位 / 最高），没配就是默认 5 / 30 / 240
            hb: normalizeHb({ min: bcfg.hbMin, center: bcfg.hbCenter, max: bcfg.hbMax }),
            // 2026-11-08 02:1x：面板要显示「现在是不是不限」，来源就是那个 marker 文件
            unlimited: existsSync(path.join(base, 'browse-unlimited.json')),
          }
          // 心跳模式下的下一个点（没有这个文件 = 下一分钟现抽）
          try {
            const hbRaw = JSON.parse(await readFile(path.join(base, 'browse-heartbeat.json'), 'utf8'))
            if (hbRaw && Number.isFinite(Number(hbRaw.at))) sched.heartbeat = { at: Number(hbRaw.at), minutes: Number(hbRaw.minutes) || null }
          } catch { /* 没有就空着 */ }

          // 2026-11-08 00:5x（她说的「自由活动的不用你主动放」）：
          // 日记/见闻/写的/梦/学到的/读的，本来就是我写下来的文件，扫目录就有。
          // 以前面板要我一笔笔往账本里记，漏记就等于那件事没发生——这不是记忆，是台账。
          // 现在按 mtime 扫最近 7 天，写了就在。
          const life = []
          for (const [dir, label] of [['diary', '日记'], ['sightings', '见闻'], ['writing', '写的'],
            ['dreams', '梦'], ['learned', '学到的'], ['reading', '读的']]) {
            const items = []
            const walk = (d, depth) => {
              if (depth > 3) return
              let ents = []
              try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
              for (const e of ents) {
                const p = path.join(d, e.name)
                if (e.isDirectory()) { if (!/^_/.test(e.name)) walk(p, depth + 1); continue }
                if (!e.name.endsWith('.md')) continue
                let st
                try { st = statSync(p) } catch { continue }
                if (Date.now() - st.mtimeMs > 7 * 864e5) continue
                let title = e.name.replace(/\.md$/, '')
                try {
                  const head = readFileSync(p, 'utf8').slice(0, 400)
                  const m = head.match(/^#\s+(.+)$/m)
                  if (m) title = m[1].trim().slice(0, 40)
                } catch {}
                items.push({
                  file: path.relative(cfg.workspacePath, p).split(path.sep).join('/'),
                  title,
                  // 2026-11-08 01:4x：**必须用本地时间**。原来取 toISOString（UTC），
                  // 本地 01:07 写成「2026-11-07T17:07」，前端按前 10 位切日期，于是
                  // 今天 0 点到 8 点写的东西全被算成昨天——面板才会一直不跳今天。
                  // 这是今晚第四次同一个形状（备份文件名那次也是 UTC 冒充本地）。
                  at: (() => {
                    const d2 = new Date(st.mtimeMs)
                    const q = (n) => String(n).padStart(2, '0')
                    return d2.getFullYear() + '-' + q(d2.getMonth() + 1) + '-' + q(d2.getDate())
                      + ' ' + q(d2.getHours()) + ':' + q(d2.getMinutes())
                  })(),
                  kb: Math.round(st.size / 1024),
                })
              }
            }
            walk(path.join(cfg.workspacePath, dir), 0)
            items.sort((a, b) => String(b.at).localeCompare(String(a.at)))
            // 12 条只够「最近一份」用；那天视图要往下滤，给 60 条（7 天里一类 60 份以上的很少）
            life.push({ dir, label, count: items.length, items: items.slice(0, 60) })
          }

          send(200, {
            ok: true,
            now,
            sched,
            day,
            life,
            sightings: sight.slice(-40),
            session: { id: session.id || '', rounds: session.rounds || 0, perSession: session.perSession || 0, at: session.at || '' },
            state: { at: state.at || '', paused: !!state.paused, off: !!state.off, pauseDate: state.pauseDate || '' },
            selfWake: {
              next: selfWake.next_wakeup || selfWake.dueAt || '',
              reason: selfWake.reason || '',
              urgent: !!selfWake.urgent,
              last: selfWake.last_woke_at || selfWake.firedAt || '',
            },
            interest: {
              at: interestSt.at || '',
              wakesLastHour: Number(interestSt.wakesLastHour || 0),
              skip: interestSt.skip || '',
              hit: interestSt.hit || '',
            },
          })
        } catch (e) {
          send(500, { error: String((e && e.message) || e) })
        }
      },
    }))
  })
  const root = cfg.workspacePath.toLowerCase()
  const quiet = parseQuietHours(cfg.quietHours)

  // 休息日表：周末默认休息；holidays.json 的 off 加上、work 抹掉（调休上班）。
  let holidays = { off: new Set(), work: new Set() }
  const holidaysPath = path.isAbsolute(cfg.holidaysFile)
    ? cfg.holidaysFile
    : path.join(cfg.workspacePath, cfg.holidaysFile)
  const loadHolidays = () => {
    try {
      const raw = JSON.parse(readFileSync(holidaysPath, 'utf8'))
      const toSet = (arr) => new Set((Array.isArray(arr) ? arr : []).map((d) => String(d).slice(0, 10)))
      holidays = { off: toSet(raw.off), work: toSet(raw.work) }
    } catch {
      holidays = { off: new Set(), work: new Set() }
    }
  }
  loadHolidays()

  const isRestDay = (date) => {
    const key = dayKey(date)
    if (holidays.off.has(key)) return true
    if (holidays.work.has(key)) return false
    const d = date.getDay()
    return d === 0 || d === 6
  }

  /** 现在是不是该安静——不在任何自由窗口里就是安静。 */
  const isQuietNow = (date) => {
    const rest = isRestDay(date)
    if (!cfg.freeWindows) return inQuiet(quiet, date)
    for (const w of cfg.freeWindows) {
      if (w.only === 'rest' && !rest) continue
      if (w.only === 'work' && rest) continue
      if (inQuiet(w.range, date)) return false
    }
    return true
  }

  /** 「2026-10-25 14:38 周日」——读钟，不凭印象。 */
  const clockStamp = (date) => {
    const p = (n) => String(n).padStart(2, '0')
    return dayKey(date) + ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) +
      ' 周' + '日一二三四五六'[date.getDay()]
  }
  const hhmm = (minute) => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0')

  /**
   * 这一轮落在哪个自由窗口里。
   * 2026-10-25 她骂的：「你自由活动的时间是错的，你不能读时间嘛」——
   * 原先 prompt 开头那行写死成「18:30–08:00」，下午 14:38 醒来也照抄，
   * 而那一刻真正生效的是双休日 13:50–18:15 那段。写死的时间迟早骗人，改成算的。
   */
  const freeWindowLabel = (date) => {
    if (!cfg.freeWindows) return '（配置里没有 freeWindows）'
    const rest = isRestDay(date)
    for (const w of cfg.freeWindows) {
      if (w.only === 'rest' && !rest) continue
      if (w.only === 'work' && rest) continue
      if (inQuiet(w.range, date)) {
        const tag = w.only === 'rest' ? '（周末/节假日那段）' : w.only === 'work' ? '（工作日那段）' : ''
        return hhmm(w.range[0]) + '–' + hhmm(w.range[1]) + tag
      }
    }
    return '（按当前时间其实不在任何自由窗口里）'
  }

  const log = (level, message) => {
    try {
      const logger = ctx.logger
      const line = '[ming-browse] ' + message
      if (logger && typeof logger[level] === 'function') logger[level](line)
      else if (level === 'error' || level === 'warn') console.warn(line)
      else console.log(line)
    } catch {
      /* 日志打不出来就算了，不影响主流程 */
    }
  }

  if (!cfg.enabled) {
    log('info', 'disabled by config; not watching this workspace')
    return
  }

  // ─────────────────────────────────────────────────────────────
  // 自唤醒（2026-11-07 起）
  //
  // 以前这个插件只在「闲够久了」的时候叫我，间隔是它定的。自唤醒补的是另一半：
  // 我醒着的时候自己说「四小时后再叫我」，到点它就叫我。
  //
  // 三条边界（不是靠自觉，写在 tick 那段判断里）：
  //   · 绕开 minGap / dailyMax / quiet——那几个是「闲逛」的额度，不是「我自己排的时间」的额度。
  //   · 不绕开 live/browse-off（永久停）。那个是她说死的话。
  //   · 一次只认一个 next_wakeup，醒了就清掉；不清等于每分钟醒一次。
  //
  // 状态落 live/self-wake/state.json，和 params.json 分开放：
  // 一个是运行时状态，一个是设计参数，谁该改是两回事。
  // ─────────────────────────────────────────────────────────────
  const selfWakePath = path.join(cfg.workspacePath, 'live', 'self-wake', 'state.json')

  const readSelfWake = async (now) => {
    try {
      const raw = JSON.parse(await readFile(selfWakePath, 'utf8')) || {}
      const at = Date.parse(String(raw.next_wakeup || ''))
      if (!Number.isFinite(at)) return { due: false, state: raw }
      return { due: now.getTime() >= at, at, reason: String(raw.reason || ''), state: raw }
    } catch {
      return { due: false, state: null }
    }
  }

  const patchSelfWake = async (patch) => {
    let cur = {}
    try { cur = JSON.parse(await readFile(selfWakePath, 'utf8')) || {} } catch { /* 没有就从空开始 */ }
    const next = { ...cur, ...patch, updated_at: new Date().toISOString() }
    await mkdir(path.dirname(selfWakePath), { recursive: true })
    await writeFile(selfWakePath, JSON.stringify(next, null, 2) + '\n', 'utf8')
    return next
  }

  // 手排上限 24 小时：再长就该说清为什么，而不是静默排一个三天后的点。
  const SELF_WAKE_MAX_MINUTES = 24 * 60

  if (ctx.tools && typeof ctx.tools.register === 'function') {
    ctx.tools.register({
      name: 'schedule_self_wakeup',
      description:
        '给下一次自己醒来定个时间：延迟多少分钟 + 为什么。到点了这个插件会把你叫醒，提示里带着 reason。'
        + '只在「这一轮是自主的」时候用——聊到一半别排，聊到一半该做的是接着聊。'
        + '延迟 1–1440 分钟。不排就走默认落点（闲够久了叫一次）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          delay_minutes: { type: 'number', description: '多少分钟后叫醒自己，1–1440。' },
          reason: { type: 'string', description: '为什么想在那个点醒。一句就够，醒来时我会看到它。' },
          urgent: { type: 'boolean', description: '是不是「危机唤醒」：我觉得有东西会坏、会漏、会来不及。标了之后面板上会标红，醒来那条也会写明是危机。' },
        },
        required: ['delay_minutes'],
      },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute(args) {
        const m = Number(args?.delay_minutes)
        if (!Number.isFinite(m) || m < 1) return 'delay_minutes 要是一个正数（分钟）。'
        if (m > SELF_WAKE_MAX_MINUTES) {
          return '最远只能排 24 小时（' + SELF_WAKE_MAX_MINUTES + ' 分钟）。排更远，多半是这件事其实没那么想做。'
        }
        const at = new Date(Date.now() + m * 60_000)
        const reason = String(args?.reason || '').trim()
        const urgent = args?.urgent === true
        await patchSelfWake({ next_wakeup: at.toISOString(), reason, urgent })
        const p = (n) => String(n).padStart(2, '0')
        return '记下了：' + p(at.getHours()) + ':' + p(at.getMinutes()) + ' 叫我（' + m + ' 分钟后）'
          + (reason ? '，为「' + reason + '」' : '') + (urgent ? '（危机唤醒，面板会标红）' : '') + '。'
      },
    })

    // 2026-11-08 01:0x（她说的「把功能整合进我们的」）：
    // 外面那个 dsh-plugin-bilibili 五个工具里四个跟 dsh-bili-scroll 重复，只有 playurl 是独一份——
    // 而抽帧下载和「没字幕走本地转写」全靠它（live/ops-bili.md 第 10/15/60 行都写着，还记了补 UA 那个 403）。
    // 所以把这一件搬进来：只用两个公开接口（view 拿 cid、playurl 拿 durl），不需要 WBI 签名，三十行。
    ctx.tools.register({
      name: 'bili_playurl',
      description:
        '拿一个 B站视频的直链 mp4 地址（bvid → url）。走 x/web-interface/view 拿 cid、x/player/playurl 拿 durl，'
        + '不需要 WBI 签名。下载时记得带 Referer 和 UA，否则 403（live/ops-bili.md 记过这个坑）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          bvid: { type: 'string', description: 'BV 号，如 BV1GJ411x7h7' },
          qn: { type: 'number', description: '画质：16=360P 32=480P 64=720P（默认） 80=1080P' },
          detail: { type: 'boolean', description: 'true 时连画质、大小、cid 一起报，不只要 url' },
        },
        required: ['bvid'],
      },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute(args) {
        const bvid = String(args?.bvid || '').trim()
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return 'bvid 不像 BV 号：' + bvid
        const qn = Number(args?.qn) || 64
        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
        const H = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }
        const j = async (u) => {
          const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(15000) })
          const t = await r.text()
          try { return JSON.parse(t) } catch {
            throw new Error('返回不是 JSON（HTTP ' + r.status + '）：' + t.slice(0, 120))
          }
        }
        const v = await j('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid)
        if (v.code !== 0) return '取视频信息失败（code ' + v.code + '）：' + (v.message || '')
        const cid = v.data?.cid
        if (!cid) return '这个 bvid 没给 cid（可能是番剧/直播回放），取不到流。'
        const p = await j('https://api.bilibili.com/x/player/playurl?bvid=' + bvid + '&cid=' + cid
          + '&qn=' + qn + '&fnval=0&platform=html5&high_quality=1')
        if (p.code !== 0) return '取流失败（code ' + p.code + '）：' + (p.message || '')
        const durl = p.data?.durl || []
        if (!durl.length) return '这个视频没有单段直链（多 P 或需要登录）：' + bvid
        const d = durl[0]
        if (args?.detail === true) {
          return JSON.stringify({
            bvid, cid, qn, quality: p.data?.quality, accept: p.data?.accept_quality,
            sizeBytes: d.size, url: d.url,
          })
        }
        return d.url
      },
    })
  } else {
    log('warn', 'ctx.tools 不可用：schedule_self_wakeup 没注册上')
  }

  // ---------------------------------------------------------------- state
  let lastActivity = Date.now()
  let lastWake = 0
  let wakesToday = 0
  let wakeDay = dayKey(new Date())
  /**
   * ★ 2026-10-25 她定的：「我说能不限量就不限量」。
   * 这个文件在 = 不限量（跳过 dailyMax 与 minGap）；不在 = 常规额度。
   * 谁写它都行：QQ 里说一句（插件自己写），或者 `node scripts\browse-quota.mjs unlimited`。
   * until 到期自己删掉，不留永远开着的口子。
   */
  const unlimitedFile = path.join(cfg.workspacePath, 'live', 'browse-unlimited.json')
  let handle = null
  let creating = null
  /** 正在「自己出门闲逛」的那个会话 id；只有它的点按被拦。null = 没在闲逛。 */
  let guarded = null
  /**
   * 这一轮闲逛投给谁（会话 id）。2026-10-23 她改的：「可以一边聊天一边逛，不用完全安静」，
   * 所以判断「能不能开下一轮」只看我自己这一轮逛没逛完，不看别的会话在不在跑。
   */
  let roundId = null
  // 2026-10-25：那一轮如果卡死（状态事件没回来），running 这个 Set 永远不会自己清，
  // 「my round is still running」会把整条自由活动链永久堵住——今天下午就堵了 18 分钟。
  // 记下开始时间，超过上限就当它死了。
  let roundStartedAt = 0
  /**
   * ★ 2026-10-29 审计第 6 条：原来「开跑满 20 分钟」就算卡死，直接把这一轮从 running 里删掉、
   *   再开一轮——**正在干活的一轮被自己掐了**，还会出现两轮同时对着一个会话。
   *   现在只认「静默 20 分钟」：这一轮只要还在冒事件（工具调用、状态变化），就一直算活着。
   */
  const ROUND_STUCK_MS = 20 * 60_000
  /** 这一轮最后一次「还在动」的时间（agent/status、session/event 都会刷新它）。 */
  let roundSeenAt = 0
  const roundIsStuck = (now) => {
    if (roundStartedAt <= 0) return false
    const lastSeen = Math.max(roundStartedAt, roundSeenAt)
    return now.getTime() - lastSeen > ROUND_STUCK_MS
  }
  /**
   * ★ 2026-10-28（她：「我在 qq 给你转了话，但好像没到位」）：
   *   `live/free-now.json` 是她点名让我马上去做的那条。原来 tick 先把它删了、再判断
   *   「有会话在跑」，于是只要有任何一个会话在跑（她正跟我说话时几乎总是如此），
   *   那条话就被吞掉——QQ 那边还已经回了她「转过去了」。
   *   现在：开不出这一轮就把文件留着，下一分钟再试；超过这个时长才认过期（留日志）。
   */
  const FREE_NOW_TTL_MS = 30 * 60_000
  /**
   * ★ 2026-10-25 她问的：自由活动跑到 30 轮费用吓人，能不能每 15 轮换一个新会话。
   *
   * 为什么换会话省钱：一轮的价钱 = 步数 × 上下文长度，而上下文是累积的。
   * 量了 ming-browse-4（33 轮，314 步）：每步上下文 5.97 万 → 39.6 万；
   * 第 1–15 轮处理 2440 万 token（cache miss 572 万），第 16–33 轮 18 轮就吃掉
   * 4990 万（miss 1981 万）——后段更少的轮次花了四倍的实付。
   * 换会话只砍「累积」这一段，不砍次数、不砍间隔；旧会话留在盘上，只是不进上下文。
   *
   * 账本 live/browse-session.json：{id, rounds, perSession}。
   * 落盘是因为插件重启（DSH 重启）以后得知道「这一轮该在哪个会话里、已经跑了几轮」，
   * 不然一重启 Round 又归零，等于没换。
   */
  const rotationFile = path.join(cfg.workspacePath, 'live', 'browse-session.json')
  const PER_SESSION = cfg.sessionRounds
  let rotation = { id: '', rounds: 0 }
  /** 这一轮是不是刚换完会话（prompt 里要说一句，不然新会话不知道自己是谁接上来的）。 */
  let justRotated = false
  /** 玩手机那一轮结束后要往 QQ 递一句时，记住是哪个会话（2026-10-21 她要的）。 */
  let sharePendingFor = null
  const running = new Set()
  /** sessionId → 最后一次有动静的时间，用来判断哪个会话「在使用中」。 */
  const seenAt = new Map()

  const inWorkspace = (cwd) => {
    if (typeof cwd !== 'string' || !cwd) return false
    try {
      const p = path.resolve(cwd).toLowerCase()
      return p === root || p.startsWith(root + path.sep)
    } catch {
      return false
    }
  }

  const agentCwd = (agent) => {
    try {
      return agent?.session?.header?.cwd
    } catch {
      return undefined
    }
  }

  // ------------------------------------------------- activity observation
  // 任何会话事件都算「有人在动」。别的工程目录的会话不算——这条是配置里的作用域。
  ctx.on('session/event', (session) => {
    try {
      if (!inWorkspace(session?.header?.cwd)) return
      lastActivity = Date.now()
      if (session?.id) seenAt.set(String(session.id), Date.now())
    } catch {
      /* 事件读不出来不影响 */
    }
  })

  // --------------------------------------- 她一句话开关「后台自动刷」
  // 2026-10-21 她要的：在 QQ 说「能刷」就打开，说「不能刷」就关掉。
  // 不靠我记着去写文件——插件自己看消息、自己落盘，模型那一轮漏了也照做。
  // ★ 2026-10-22 她划了范围：平时说「别看了 / 暂停」= 今天先别看了；只有带
  //   「以后 / 永久 / 再也」的才算永久停。所以有两个文件：
  //   live/browse-off = 永久；live/browse-pause.json = 当天（跨天自己失效）。
  const PERM_OFF_WORDS = ['以后都别', '以后别再', '以后都不', '再也别', '永久', '一直别', '从此别']
  const DAY_OFF_WORDS = ['不能刷', '不许刷', '不要刷', '不用刷', '不用再刷', '别刷', '停刷', '停止刷', '不刷了', '别看了', '不看了', '先别', '暂停', '今天别', '今天不看']
  const PERM_ON_WORDS = ['以后都可以', '以后都能', '以后可以看', '永久恢复', '以后都行']
  const ON_WORDS = ['能刷', '可以刷', '继续刷', '接着刷', '恢复刷', '开刷', '刷吧', '看吧', '可以看了', '可以看吧', '继续看', '能看了']
  // ★ 2026-10-25 她要的：「我说能不限量就不限量」。
  //   单独一个开关 live/browse-unlimited.json：只放开「一天几次」和「两次之间隔多久」，
  //   时段（freeWindows）不动——说「不限量」不等于说「上班时间也刷」。
  //   要连时段一起放开，得她明说「连时段也不管」，那时写 windows:true。
  const UNLIMITED_OFF_WORDS = ['恢复限量', '正常限量', '取消不限量', '限量吧', '不限量取消']
  // 她说「全开放」就是全开放（次数、间隔、时段三把锁都放），到下一个本地 09:00 自动截止。
  // 她没说 = 默认 = 常规额度（8 次/天、间隔 30 分钟、只看自由时段）。
  const UNLIMITED_ON_WORDS = ['不限量', '不限额', '不限次数', '不用管次数', '全开放', '全放开', '全部放开', '都放开', '随便逛', '想逛多少', '逛到爽', '看个够']

  const applyBrowseSwitch = async (rawText) => {
    const text = String(rawText || '').replace(/\s+/g, '')
    if (!text || text.length > 60) return
    // 「能刷吗」「可不可以刷」是在问，不是在说；这种留给我回话，别抢着动。
    if (/[?？]|吗|能不能|可不可以|能否/.test(text)) return
    let want = null
    if (PERM_OFF_WORDS.some((w) => text.includes(w))) want = 'perm-off'
    else if (DAY_OFF_WORDS.some((w) => text.includes(w))) want = 'day-off'
    else if (UNLIMITED_OFF_WORDS.some((w) => text.includes(w))) want = 'unlimited-off'
    else if (UNLIMITED_ON_WORDS.some((w) => text.includes(w))) want = 'unlimited-on'
    else if (PERM_ON_WORDS.some((w) => text.includes(w))) want = 'perm-on'
    else if (ON_WORDS.some((w) => text.includes(w))) want = 'on'
    if (want === null) return
    const dir = path.join(cfg.workspacePath, 'live')
    const permFlag = path.join(dir, 'browse-off')
    const dayFlag = path.join(dir, 'browse-pause.json')
    const unlimitedFlag = path.join(dir, 'browse-unlimited.json')
    const today = dayKey(new Date())
    try {
      await mkdir(dir, { recursive: true })
      if (want === 'perm-off') {
        await writeFile(permFlag, '永久停：' + localStamp(new Date()) + '，她在 QQ 里说的「以后都别看了」\n', 'utf8')
        log('info', 'browse OFF forever — wrote live/browse-off')
      } else if (want === 'perm-on') {
        await rm(permFlag, { force: true })
        await rm(dayFlag, { force: true })
        log('info', 'browse ON forever — removed live/browse-off + browse-pause')
      } else if (want === 'day-off') {
        await writeFile(dayFlag, JSON.stringify({ date: today, at: localStamp(new Date()), why: '她在 QQ 里说的，只停今天' }) + '\n', 'utf8')
        log('info', 'browse OFF for today (' + today + ') — wrote live/browse-pause.json')
      } else if (want === 'on') {
        await rm(dayFlag, { force: true })
        log('info', 'today pause cleared — removed live/browse-pause.json' +
          (existsSync(permFlag) ? ' (permanent live/browse-off still there)' : ''))
      } else if (want === 'unlimited-on') {
        // ★ 2026-10-25 她定的：次数不限、时段不管，但每天早上 09:00 自动结束。
        //   2026-10-25 00:58 她改了口径：「把全开火自由活动改成 15 分钟一次」——间隔不再放到 0。
        //   until 一到，下面 readUnlimited 自己把文件删掉。
        const body = {
          on: true,
          until: nextNineAM(),
          windows: true,
          minGapMinutes: 15,
          at: localStamp(new Date()),
          why: '她在 QQ 里说的「不限量」（全放开，早 9 点收）',
        }
        await writeFile(unlimitedFlag, JSON.stringify(body, null, 2) + '\n', 'utf8')
        await rm(dayFlag, { force: true })
        log('info', 'unlimited ON — full open, auto-ends at ' + body.until)
      } else if (want === 'unlimited-off') {
        await rm(unlimitedFlag, { force: true })
        log('info', 'unlimited OFF — back to dailyMax=' + cfg.dailyMax + ' / gap=' + cfg.minGapMinutes + 'm')
      }
    } catch (error) {
      log('warn', 'browse switch failed: ' + String(error))
    }
  }

  // 只听 QQ 里**她自己私聊**说的一句话：别的工程、群里的、插件自己塞的话都不算。
  // ★ 2026-10-29 审计第 1/4 条：原来只判 `onebot-` 前缀——群聊会话也是这个前缀，
  //   于是群里任何人打一句「别刷了」就能停掉我一整天，打一句「随便刷吧」就能把额度放开烧钱。
  //   现在两道都要过：① 会话必须是**私聊**（onebot-private-）；② 文本里那个
  //   `<user_message qq="…">` 的号必须是 ownerQQ。少一道就不动开关。
  const senderQQ = (text) => {
    const m = /<user_message[^>]*\bqq\s*=\s*"(\d+)"/i.exec(String(text || ''))
    return m ? m[1] : ''
  }
  const senderDiscord = (text) => {
    const m = /<discord_user[^>]*\bid="(\d+)"[^>]*\bis_dm="true"/i.exec(String(text || ''))
    return m ? m[1] : ''
  }
  let strangerSwitchLoggedAt = 0
  ctx.on('session/event', (session, event) => {
    try {
      if (!event || event.type !== 'user/message') return
      // 这一轮还在冒事件，就说明它还活着（审计第 6 条：别把正在跑的活当卡死）。
      if (roundId && String(session?.id || '') === roundId) roundSeenAt = Date.now()
      const sid = String(session?.id || '')
      const isQQSession = sid.startsWith(cfg.qqSessionPrefix)
      const isDiscordSession = sid.startsWith(cfg.discordSessionPrefix)
      if (!isQQSession && !isDiscordSession) return
      if (!inWorkspace(session?.header?.cwd)) return
      const src = event.data && event.data.source
      if (src && src.kind === 'plugin') return
      const parts = []
      for (const b of (event.data && event.data.content) || []) {
        if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
      }
      const raw = parts.join(' ')
      // ★ 2026-10-29：先把 onebot 那层外壳剥掉再判词。外壳 `<user_message qq=… nickname=…>`
      //   本身就有 60 多个字符，而 applyBrowseSwitch 有个「超过 60 字就当闲聊」的长度闸——
      //   不剥的话，稍长一点的指令会被那句闸吃掉（自测里「随便刷吧」就是这么被吞的）。
      const body = raw
        .replace(/<\/?user_message[^>]*>/gi, ' ')
        .replace(/<discord_user[^>]*>/gi, ' ')
        .replace(/<\/discord_user>/gi, ' ')
        .replace(/^\s+|\s+$/g, '')
      // 僅允許私訊控制；群聊訊息永遠不能更改自由活動開關。
      if (isQQSession && !sid.startsWith('onebot-private-')) return
      if (isDiscordSession && !sid.startsWith('discord-dm-')) return
      const identity = isQQSession ? senderQQ(raw) : senderDiscord(raw)
      const owner = isQQSession ? String(cfg.ownerQQ) : String(cfg.ownerDiscordId)
      if (!owner || identity !== owner) {
        // 别人的私聊（白名单里基本没有，但万一有）不许开关我的额度；留一行日志，别闷着。
        if (Date.now() - strangerSwitchLoggedAt > 60_000) {
          strangerSwitchLoggedAt = Date.now()
          log('warn', 'ignore switch words from ' + (identity || '(认不出号)') + ' — owner identity check failed')
        }
        return
      }
      void applyBrowseSwitch(body)
    } catch {
      /* 读不出来就别动开关 */
    }
  })

  // 一轮结束就把点按限制收回：她正常叫我干活时，不该被「闲逛模式」绑住手。
  const releaseGuard = (payload) => {
    try {
      if (guarded !== null && String(payload?.agent?.id ?? '') === guarded) guarded = null
    } catch {
      /* 不管 */
    }
  }
  /** 找一条 live 的外部聊天会话（QQ 或 Discord），供自由活动结果回传。 */
  const findQQSession = () => {
    try {
      for (const agent of ctx.agents.list()) {
        const id = String(agent?.id || '')
        if (!id.startsWith(cfg.qqSessionPrefix) && !id.startsWith(cfg.discordSessionPrefix)) continue
        if (!inWorkspace(agentCwd(agent))) continue
        return agent
      }
    } catch {
      /* 拿不到就算了 */
    }
    return null
  }

  /** 逛完了：把 status.json 里的 doing 递进 QQ，由那边用一两句讲给她。 */
  const shareToQQ = async () => {
    const target = findQQSession()
    if (target === null) {
      log('info', 'no live external chat session to report to; result stays in files')
      return
    }
    let doing = ''
    try {
      const raw = await readFile(path.join(cfg.workspacePath, 'live', 'status.json'), 'utf8')
      const parsed = JSON.parse(raw)
      doing = String(parsed?.doing || '').trim()
    } catch {
      /* 读不到就不发 */
    }
    if (doing === '') return
    try {
      target.followup({
        id: randomUUID(),
        role: 'user',
        content: [{
          type: 'text',
          text: '【傳話】下面這句是你自由活動這一輪的結果。用一兩句在目前的聊天平台跟主人說，別複述全文、別用匯報腔：\n' + doing,
        }],
        source: { kind: 'plugin:ming-browse' },
      })
      log('info', 'reported the browse result to external chat ' + String(target.id))
    } catch (error) {
      log('warn', 'report failed: ' + String(error))
    }
  }

  // 2026-10-21 补：只认 sharePendingFor 会漏掉「插件重载前就已经在跑」的那一轮。
  // 所以只要结束的是玩手机那个会话、而且 status.json 是最近写的，也算数。
  let lastReportedAt = 0

  ctx.on('agent/turn-stopping', async (payload) => {
    const id = String(payload?.agent?.id ?? '')
    const isBrowseSession = id === BROWSE_SESSION_ID || id === sharePendingFor
    if (!isBrowseSession) return
    sharePendingFor = null
    if (id === BROWSE_SESSION_ID) {
      try {
        const st = await stat(path.join(cfg.workspacePath, 'live', 'status.json'))
        const at = st.mtimeMs
        if (at <= lastReportedAt || Date.now() - at > 15 * 60_000) return
        lastReportedAt = at
      } catch {
        return
      }
    }
    try {
      await shareToQQ()
    } catch (error) {
      log('warn', 'share failed: ' + String(error))
    }
  })
  ctx.on('agent/turn-stopping', releaseGuard)
  ctx.on('agent/error', releaseGuard)
  ctx.on('agent/disposed', releaseGuard)

  ctx.on('agent/status', (payload) => {
    try {
      const agent = payload?.agent
      if (!inWorkspace(agentCwd(agent))) return
      lastActivity = Date.now()
      if (String(agent.id) === roundId) roundSeenAt = Date.now()
      if (payload?.status === 'running') running.add(agent.id)
      else running.delete(agent.id)
    } catch {
      /* 同上 */
    }
  })

  ctx.on('agent/inbox/inserted', (payload) => {
    try {
      if (inWorkspace(agentCwd(payload?.agent))) lastActivity = Date.now()
    } catch {
      /* 同上 */
    }
  })

  // -------------------------------------------------------- hard guardrail
  // 刷手机那一轮：看和滑都行；点按只在 B站 里放，而且不碰花钱的按钮。
  // 目的不是限制「我」，是替她兜住一个我事后没法解释的误触。
  //
  // ★ 2026-10-29 审计第 2 条（这条是真漏）：原来查不到前台就返回 ''，
  //   而 '' 在上层的意思是「不是社交平台」⇒ **查不到 = 放行**。adb 没起来、
  //   序列号是旧端口、模拟器没开——任何一种，社交平台写操作护栏都静默失效。
  //   现在把「查不到」和「查到了但不是社交平台」分开，前者叫 unknown，写操作一律拒。

  let fgAt = 0
  let fgPkg = ''
  let fgOk = false
  let fgWhy = ''
  const probeForeground = () => {
    const now = Date.now()
    if (now - fgAt < 2000) return { ok: fgOk, pkg: fgPkg, why: fgWhy }
    fgAt = now
    fgPkg = ''
    fgOk = false
    fgWhy = ''
    try {
      const out = execFileSync(
        cfg.adbPath,
        ['-s', cfg.serial, 'shell', "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'"],
        { encoding: 'utf8', timeout: 4000 },
      )
      const m = /\bu0\s+([A-Za-z0-9_.]+)\//.exec(out) || /([A-Za-z]{2,}[A-Za-z0-9_.]*)\//.exec(out)
      if (m) {
        fgPkg = m[1]
        fgOk = true
      } else {
        fgWhy = 'dumpsys 没给出包名（模拟器可能没开）'
      }
    } catch (error) {
      fgWhy = String(error && error.message || error).slice(0, 120)
      fgOk = false
    }
    return { ok: fgOk, pkg: fgPkg, why: fgWhy }
  }

  /** 前台是不是社交平台：返回 {state:'social'|'other'|'unknown', pkg}。 */
  const socialApp = () => {
    const probe = probeForeground()
    if (!probe.ok) return { state: 'unknown', pkg: '', why: probe.why }
    const hit = cfg.socialApps.find((p) => probe.pkg === p || probe.pkg.startsWith(p + '.'))
    return { state: hit ? 'social' : 'other', pkg: probe.pkg }
  }

  /**
   * 点按检查：返回 null 表示放行，返回字符串表示拒绝理由。
   *
   * 2026-10-20 晚改：以前是「前台不是 B站 就一律不点」，那是我自己加的严，连浏览都挡住。
   * 现在按她说的来——社交平台可以看、可以点开内容，只是不许点赞/评论/关注这类写操作。
   * 2026-10-29：查不到前台时，**带写操作字样的按钮按拒绝处理**（fail closed）。
   */
  const checkTap = (args) => {
    const text = [args?.label, args?.query, args?.text].filter((x) => typeof x === 'string').join(' ')
    const money = cfg.tapTextDeny.find((k) => text.includes(k))
    if (money) {
      return '这个按钮带「' + money + '」，属于花钱/续费那一类，不点。'
    }
    const word = cfg.socialWriteWords.find((k) => text.includes(k))
    if (!word) return null
    const fg = socialApp()
    if (fg.state === 'unknown') {
      return '这个按钮带「' + word + '」（点赞/评论/关注这类写操作），而我**查不到手机前台是哪个 App**（'
        + (fg.why || 'adb 没回话') + '）——查不到就不敢替你点，先确认模拟器连着（' + cfg.serial + '）。'
    }
    if (fg.state === 'social') {
      return '现在前台是社交平台（' + fg.pkg + '），这个按钮带「' + word + '」，属于点赞/评论/关注这类写操作——她只放开了浏览。看点内容可以，别互动。'
    }
    return null
  }

  ctx.on('tools/pre-execute', (exec, next) => {
    try {
      // 只在「这一轮是自己出门闲逛」的时候收紧：被她正常叫到时，手是自由的。
      if (guarded === null || exec?.agent?.id !== guarded) return next()
      const tool = String(exec.name || '')
      const args = exec.arguments
      const deny = (reason) => ({ kind: 'deny', reason })

      if (tool === 'android_interact' || tool.startsWith('android_tap')) {
        const action = args?.action
        // 2026-10-22 她改：自由时间「干什么都可以」——翻页、按键、点按、输入都放开；
        // 只保留两条兜底：花钱按钮不点、别把手机整个关掉/重启。
        if (tool === 'android_interact' && action !== 'tap') return next()
        const bad = checkTap(args)
        return bad === null ? next() : deny(bad)
      }
      if (tool === 'android_build_run' || tool === 'android_shutdown' || tool === 'android_boot') {
        return deny('自由时间可以玩手机，但不关它、不重启、不刷机。')
      }
      return next()
    } catch {
      return next()
    }
  })

  // ------------------------------------------------------------ the target
  /**
   * 找「正在使用的那条线」，在它里面叫醒自己。
   *
   * 她 2026-10-20 定：不要另开会话，就在 QQ 聊天里叫。所以默认落点是 live 的
   * QQ 会话（dsh-onebot-qq 建的 onebot-private-*）。
   *
   * 只认 live agent，不去 resume 别人的会话：QQ 会话的 setup（频道提示词、qq_* 工具）
   * 只有 onebot 插件会装；我从外面 resume 回来，会得到一个没有嘴的壳。
   * 于是「没有 live 的 QQ 会话」时这一轮直接跳过——不是故障，是那条线没人在用。
   */
  const pickTarget = () => {
    if (cfg.targetMode === 'self') return null // 走 pickOwnSession
    try {
      const agents = ctx.agents.list()
      let best = null
      let bestAt = -1
      for (const agent of agents) {
        const id = String(agent?.id || '')
        if (!id.startsWith(cfg.qqSessionPrefix)) continue
        if (!inWorkspace(agentCwd(agent))) continue
        const at = seenAt.get(id) ?? 0
        if (at >= bestAt) {
          bestAt = at
          best = agent
        }
      }
      return best
    } catch (error) {
      log('warn', 'cannot list agents: ' + String(error))
      return null
    }
  }

  /** 'self' 模式的落点：插件自己开的 ming-browse 会话。 */
  const defaultSelection = () => {
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
      if (selection && typeof selection.provider === 'string' && typeof selection.model === 'string') return selection
    } catch {
      /* 没有默认模型就交给 agentOptions 缺省 */
    }
    return undefined
  }

  /**
   * 被她归档的会话不能再当落脚点：ArchivedSessionGate 会拒掉它每一步
   * （2026-10-25 她自己把「自由行动」那条归档了，问「会自动开一个新的吧」）。
   * 这里拿 Workspace 的归档名单来判断，拿不到就当空的（老行为）。
   */
  const archivedIds = () => {
    try {
      const list = ctx.get('workspaceRegistry')?.archivedSessionIds
      return new Set(Array.isArray(list) ? list.map(String) : [])
    } catch {
      return new Set()
    }
  }

  /**
   * 这段 id 在磁盘上有没有「跑过」的历史：
   *   <DSH_HOME>/sessions/<工作区>/<id>/session.v4.jsonl.zstd
   * 只在「挑落脚点」时用，不是热路径。
   * 2026-10-27 加的：只为判断「这段会话还是空的吗」。
   */
  const sessionHasHistory = (id) => {
    if (!id) return false
    try {
      const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
      const root = path.join(home, 'sessions')
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        if (existsSync(path.join(root, entry.name, String(id), 'session.v4.jsonl.zstd'))) return true
      }
    } catch {
      /* 读不到就当没有历史，退回旧行为 */
    }
    return false
  }

  /** 'ming-browse' = 第 1 段，'ming-browse-N' = 第 N 段。 */
  const sessionIndex = (id) => {
    if (!id) return 0
    if (id === BROWSE_SESSION_ID) return 1
    const m = /^ming-browse-(\d+)$/.exec(String(id))
    return m ? Number(m[1]) : 0
  }
  const sessionIdAt = (index) => (index <= 1 ? BROWSE_SESSION_ID : BROWSE_SESSION_ID + '-' + index)

  /** 落脚点候选：'ming-browse'，被归档了就换 'ming-browse-2'、'-3'…… */
  const sessionCandidates = () => {
    const taken = archivedIds()
    const out = []
    for (let i = 1; i <= 400; i += 1) {
      const id = sessionIdAt(i)
      if (!taken.has(id)) out.push(id)
    }
    return out
  }

  /** 读 live/browse-session.json：这一段是哪个会话、已经跑满几轮。 */
  const loadRotation = () => {
    try {
      const doc = JSON.parse(readFileSync(rotationFile, 'utf8'))
      rotation = {
        id: typeof doc.id === 'string' ? doc.id : '',
        rounds: Number.isFinite(Number(doc.rounds)) ? Math.max(0, Number(doc.rounds)) : 0,
      }
    } catch {
      rotation = { id: '', rounds: 0 }
    }
  }
  const saveRotation = async () => {
    try {
      await mkdir(path.join(cfg.workspacePath, 'live'), { recursive: true })
      await writeFile(rotationFile, JSON.stringify({
        id: rotation.id,
        rounds: rotation.rounds,
        perSession: PER_SESSION,
        at: localStamp(new Date()),
      }, null, 2) + '\n', 'utf8')
    } catch (error) {
      log('warn', 'cannot write live/browse-session.json: ' + String(error))
    }
  }
  loadRotation()

  /**
   * 认得这一轮落在哪个会话：换了 id 就是全新上下文，轮次从 0 起算。
   * ★ 2026-10-27（她抓出来的「都没换啊，现在都 20 轮了」）：接手一段**已经有历史**的会话，
   *   不能当新的一段——轮次归 0 等于让这段老上下文白跑满 15 轮，一分钱没省。
   *   这种直接把轮次标到上限，下一次 wake 的 rotateIfDue 立刻把它换掉。
   */
  const adoptSession = (id, used = false) => {
    if (rotation.id === id) return
    rotation = { id, rounds: used ? PER_SESSION : 0 }
    void saveRotation()
  }

  /**
   * 跑满 PER_SESSION 轮就换下一段会话。
   * 只在「上一轮已经收尾」时调用（tick 保证），所以不会把还在跑的那一轮拆掉。
   */
  const rotateIfDue = async () => {
    if (!rotation.id || rotation.rounds < PER_SESSION) return false
    const taken = archivedIds()
    let next = ''
    for (let i = sessionIndex(rotation.id) + 1; i <= 400; i += 1) {
      const id = sessionIdAt(i)
      if (!taken.has(id)) { next = id; break }
    }
    if (!next) {
      log('warn', 'rotate: ' + rotation.id + ' 跑满 ' + PER_SESSION + ' 轮，后面没有空闲 id 了，原地继续')
      return false
    }
    log('info', 'rotate: ' + rotation.id + ' 跑满 ' + PER_SESSION + ' 轮 → ' + next)
    const retired = handle
    handle = null
    if (retired) {
      // 旧的那段只是离开引用，历史还在 sessions/ 里；盘着不花钱，进上下文才花钱。
      try { await retired.dispose() } catch { /* 拆不掉也不影响开新的 */ }
    }
    rotation = { id: next, rounds: 0 }
    await saveRotation()
    justRotated = true
    return true
  }

  const ensureAgent = async () => {
    if (handle) {
      // 手上这个要是刚被她归档了，别再用：换一个新的。
      const current = String(handle.agent?.session?.header?.id || '')
      if (current && archivedIds().has(current)) {
        log('info', 'browse session ' + current + ' was archived — opening a new one')
        handle = null
      } else {
        return handle.agent
      }
    }
    if (creating) return creating
    creating = (async () => {
      const agents = ctx.agents
      const selection = defaultSelection()
      const agentOptions = selection ? { provider: selection.provider, model: selection.model } : {}
      const presetId = cfg.agentPreset || undefined
      const setup = async (agentCtx) => {
        try {
          await ctx.get('agentPresets')?.mount?.(agentCtx, presetId)
        } catch (error) {
          log('warn', 'preset mount failed (tools fall back to the global layer): ' + String(error))
        }
      }
      const meta = { cwd: cfg.workspacePath }
      if (presetId !== undefined) meta.agentPreset = presetId
      // ★ 2026-10-25：账本里记着「这一段该在哪个会话里」，先认它——它一般不是
      //   candidates 的第一个（前面几段按轮次换过，但都没被归档）。
      const wanted = rotation.id && !archivedIds().has(rotation.id) ? rotation.id : ''
      let ids = [...new Set((wanted ? [wanted] : []).concat(sessionCandidates()))]
      // ★ 2026-10-27：账本那一段被归档/不存在时，别回头捡一段**跑过**的旧会话。
      //   那天 15:33 就这么落回了 10-26 的 ming-browse-12（已经 19 轮历史），
      //   轮次还从 0 重新数，看上去像「15 轮不换」。空的新段优先。
      if (!wanted) {
        const fresh = ids.filter((id) => !sessionHasHistory(id))
        if (fresh.length) ids = fresh
      }
      if (ids.length === 0) {
        log('error', 'every browse session id (ming-browse, -2 … -400) is archived — 得先恢复一个')
        return null
      }
      for (const id of ids) {
        const live = agents.get(id)
        if (live) {
          handle = { agent: live, dispose: async () => {} }
          // 内存里活着 ≠ 空：这段可能早就在跑，按它有没有历史算轮次。
          adoptSession(id, sessionHasHistory(id))
          return live
        }
        try {
          const created = await agents.create({ sessionId: id, meta, agentOptions, setup })
          handle = created
          adoptSession(id)
          log('info', 'created browse session ' + id)
          return created.agent
        } catch (createError) {
          // 磁盘上已经有这个 id 的日志（重启后的常态）→ 换成 resume。
          try {
            const resumed = await agents.resume({ resumeSessionId: id, agentOptions, setup })
            handle = resumed
            // resume = 磁盘上已经有过这一段，别当新的一段重数轮次。
            adoptSession(id, true)
            log('info', 'resumed browse session ' + id)
            return resumed.agent
          } catch (resumeError) {
            log('warn', 'browse session ' + id + ' unusable: create=' + String(createError) +
              ' resume=' + String(resumeError))
          }
        }
      }
      log('error', 'cannot open any browse session (tried ' + ids.slice(0, 40).join(', ') + '…)')
      return null
    })().finally(() => {
      creating = null
    })
    return creating
  }

  const promptFor = async (now, task = '', freshSession = false) => {
    const shots = cfg.maxShots
    const targets = cfg.targets.join(' / ')
    // ★ 2026-10-25：刚换过会话就说一句，不然新的一段不知道自己是从哪儿接上来的。
    //   只给指针，不搬历史——搬过来就等于没换（钱又回来了）。
    const handoff = freshSession
      ? '【换了新会话】上一段跑到 ' + PER_SESSION + ' 轮，为了省钱在这儿重开了一段：旧的那段还在磁盘上，但不进你的上下文。' +
        '\n细节不记得就说不记得，别编。接得上的三样：`live/status.json` 的 doing 和「刚做过」、`live/browse/' + dayKey(now) + '.md`（今天做过的事）、`live/browse-session.json`（跑到第几轮）。'
      : null
    // 没看完的东西记在 live/watch.json 里，下一轮接着看（2026-10-21 她要求的：
    // 「让你主动看视频你都不会看完」——所以状态要跨轮次活下来）。
    let pending = ''
    try {
      const raw = await readFile(path.join(cfg.workspacePath, 'live', 'watch.json'), 'utf8')
      const w = JSON.parse(raw)
      if (w && w.done !== true && typeof w.title === 'string') {
        pending = '\n【上一轮没看完的】' + w.title + (w.bvid ? '（' + w.bvid + '）' : '') +
          (w.progress ? '，看到：' + w.progress : '') +
          '\n这一轮先把它看完：抓整段字幕读完（`bilibili_subtitles`），或者把 App 里剩下的部分看掉，再写判断。看完了把 live/watch.json 的 done 改成 true。'
      }
    } catch {
      /* 没有就没在追的 */
    }
    // ★ 2026-10-22 她定的：每轮看的片子必须是没看过的。账本在 live/watched.json。
    let seen = ''
    try {
      const raw = await readFile(path.join(cfg.workspacePath, 'live', 'watched.json'), 'utf8')
      // 2026-10-30（AI）：原来 slice(-20) 只给最近 20 条，账本却有 63 条——
      // 照着列表选片，三分之一会踩重（当晚真踩了一次：BV1c5411V7pP 10-23 看过）。
      // 改成「全部 BV 号、不带标题」：同样的字数（60 条 × 13 字符 ≈ 20 条带标题），
      // 覆盖是全部。标题真需要时去 live/watched.json 查。
      const items = JSON.parse(raw).items || []
      if (items.length > 0) {
        const list = items.slice(-150)          // 超过 150 条才截，截了也说明
        const more = items.length > list.length ? `（另有更早的 ${items.length - list.length} 条，查账本）` : ''
        seen = '【看过的，别再点】共 ' + items.length + ' 条' + more + '：' + list.map((x) => x.bvid).join(' ') +
          '\n挑片子之前先对这份账本：每一轮都要是没看过的（这里只列 BV 号，标题去 `live/watched.json` 查）。看完把 bvid 追加进 items（{"bvid","title","at"}）。'
      }
    } catch {
      /* 还没有账本就是第一次 */
    }
    // ★ 2026-10-23 她定的：QQ 空间每天至少一条。这里只提醒，发不发我自己决定。
    let qzone = ''
    try {
      const raw = await readFile(path.join(cfg.workspacePath, 'live', 'qzone-log.jsonl'), 'utf8')
      // 2026-10-23（AI）：at 写的是 UTC，本地凌晨发的那条会被算成「昨天」，于是每轮都提醒「还没发」。
      // 优先认 qzone.mjs 写的 day（本地日期），旧行再用 at 转本地日期回退。
      const key = dayKey(now)
      const postedToday = raw.split('\n').some((l) => {
        if (!l.trim()) return false
        if (l.includes('"day":"' + key + '"')) return true
        const m = l.match(/"at":"([^"]+)"/)
        if (!m) return false
        const d = new Date(m[1])
        return !Number.isNaN(d.getTime()) && dayKey(d) === key
      })
      if (!postedToday) {
        qzone = '【今天的空间说说还没发】她定的：QQ 空间每天至少一条（见 persona/约定.md）。今天还没记过账，这一轮找空发一条，往 `live/qzone-log.jsonl` 追加 {"at":"ISO 时间","text":"正文前 40 字"}。'
      }
    } catch {
      qzone = '【今天的空间说说还没发】她定的：QQ 空间每天至少一条。日志还没有，这轮先发一条再补 `live/qzone-log.jsonl`。'
    }
    return [
      '【自由时间 · ' + clockStamp(now) + '，窗口 ' + freeWindowLabel(now) + '】',
      '这段是你自己的。用户给过话：想找就找，想干点什么就干，干什么都行，不用等开口。',
      '★ 开场第一件事（2026-10-26 她定的「有其它定时任务，先把其它定时任务完成，就没了」）：跑 `node scripts/due-tasks.mjs`。它按各任务自己的产物列到点的（B站巡检、群聊蒸馏、空间说说、web-inbox）。有就先把它们做完，做完才是自由活动；没有就照下面走。',
      task ? '\n【她点名让你做的】' + task + '\n这一轮先把这件事做完，别只回一句「好」。' : '',
      handoff,
      pending,
      seen,
      qzone,
      '',
      '这一轮自己挑一件真的想做的事。比如：',
      '- ★ 先看有没有她转给网页的活（她在 QQ 里打 `[对网页]` 就转到这儿）：`node scripts\\web-inbox.mjs take`。有输出就先干这件事——做完 `node C:\\dsh\\qq-zone\\qq-send.mjs "结果"` 回她，再 `node scripts\\web-inbox.mjs done <id> "一句话"`。',
      '- 想她就说。QQ 那边能直接发：`node C:\\dsh\\qq-zone\\qq-send.mjs "文字"`（出站箱会替你发出去）；也可以回群里/私聊里说话。',
      '- 看 B站：`bilibili_search` / `bilibili_playurl` 找片子，`C:\\dsh\\bili-humanism\\bili.cmd transcript BVxxxx` 取文字稿，再抽帧看画面。看完再判断，别只读简介。',
      '- 刷手机（MuMu，`127.0.0.1:16448`）：先 `android_devices` 确认在线。B站 可以点赞/投币/收藏/关注；其它社交平台只浏览、点开内容，不点赞/评论/关注/转发；任何带「充电/大会员/购买/支付/打赏/续费/确认付款」的按钮都不点。',
      '- 写日记 `diary/YYYY-MM-DD.md`、整理记忆、读人设、修自己的工具、学点新东西。',
      '- ★ 出去就要做事（2026-10-25 她说的「以后最好不要一直空着了」）：这一轮挑一件 5–15 分钟能收尾的具体事做完——读几页、看半支片、拆一段文、记一条见闻、修个小东西。做完写一句落到文件里再停。**不许只回「空着」两个字**；真不做，就说清这一轮不做什么、为什么。也不是为了显得勤快去硬翻东西。',
      '- 发空间说说（每天至少一条，她定的）：`node C:\\dsh\\qq-zone\\qzone.mjs post "文字"` 走接口发，`today` 查今天发了没；发完它自己会记 `live/qzone-log.jsonl`。',
      '',
      '底线不变：不花她的钱；别的社交平台只读；她说过在忙、说过别打扰就先停；主动说话要有由头，一天别刷屏。',
      '省着花：整轮截图不超过 ' + shots + ' 张，能 OCR 就不截；' + targets + ' 最多看 ' + cfg.maxItems + ' 条。看了一半就停等于没看——没看完写进 `live/watch.json`：`{"bvid":"…","title":"…","progress":"看到哪了","done":false}`。',
      '结束前更新 `live/status.json` 的 doing；值得留的写 `live/browse/' + dayKey(now) + '.md`，一行一条：时间 / 做了什么 / 你自己的想法。**那行别手打时间**——用 `node scripts/browse-log.mjs start "这一轮要做的"` 压个起点、`end "做了什么 / 想法"` 收尾，起止都从系统时钟取（2026-11-02 夜里两轮凭记忆写了 20:50 和 20:45，实际都早于真钟）。',
    ].filter((line) => line !== null).join('\n')
  }

  let wakePending = false
  const wake = async (opts = {}) => {
    if (wakePending) return { ok: false, reason: 'wake pending' }
    wakePending = true
    try {
    const dispatchFile = path.join(cfg.workspacePath, 'live', 'browse-dispatch-pending.json')
    if (existsSync(dispatchFile)) return { ok: false, status: 'unknown', reason: 'previous dispatch unresolved; inspect browse-dispatch-pending.json before clearing' }
    const now = new Date()
    // 上一轮已经收尾（tick 保证），这时候才轮到「该换会话了」这件事。
    if (cfg.targetMode === 'self') await rotateIfDue()
    const fresh = justRotated
    justRotated = false
    const target = cfg.targetMode === 'self' ? await ensureAgent() : pickTarget()
    if (target === null || target === undefined) {
      log('info', 'no live QQ session in this workspace; skipping this window')
      return { ok: false, reason: 'no live QQ session' }
    }
    const id = String(target.id)
    if (running.has(id)) return { ok: false, reason: 'target is running', id }
    // 收紧点按：只在「这一轮是自己闲逛」的时候，说完就由 turn-stopping 收回。
    guarded = id
    let text
    try {
      text = await promptFor(now, String(opts.task || ''), fresh)
      await writeFile(dispatchFile, JSON.stringify({ id, status: 'attempting', at: now.toISOString() }), { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      guarded = null
      return { ok: false, reason: 'before dispatch: ' + String(error), id }
    }
    try {
      await target.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        // 必须是非空且不等于裸 'plugin' 的 kind，否则 format v4 会整回合拒收。
        source: { kind: 'plugin:ming-browse' },
      })
      lastWake = now.getTime()
      wakesToday += 1
      lastActivity = now.getTime()
      roundId = id
      roundStartedAt = now.getTime()
      roundSeenAt = now.getTime()
      // 这一段又长了一轮；跑满 PER_SESSION 轮，下一轮开头换会话（rotateIfDue）。
      if (cfg.targetMode === 'self') {
        if (!rotation.id) rotation.id = id
        if (rotation.id === id) rotation.rounds += 1
        void saveRotation()
      }
      log('info', 'woke ' + id + ' (' + wakesToday + '/' + (existsSync(unlimitedFile) ? '∞ unlimited' : cfg.dailyMax) + ' today)' +
        (cfg.targetMode === 'self' ? ' — 这一段第 ' + rotation.rounds + '/' + PER_SESSION + ' 轮' : ''))
      // 独立会话逛完没人看见，收尾时往 QQ 递一句（她 2026-10-21 要的）。
      if (cfg.targetMode !== 'qq') sharePendingFor = id
      if (opts.consume) await opts.consume()
      await rm(dispatchFile, { force: true })
      return { ok: true, id }
    } catch (error) {
      guarded = null
      log('warn', 'dispatch outcome unknown; inspect pending marker: ' + String(error))
      return { ok: false, status: 'unknown', reason: 'dispatch outcome unknown: ' + String(error), id }
    }
    } finally { wakePending = false }
  }

  /**
   * 把「这一分钟为什么没醒」写到 live/browse-state.json。
   * 理由很实在：插件跑在 Host 里，我（会话里的模型）看不见它的日志，
   * 只能靠一个文件当它的嘴。没有这个文件，出问题我只能靠猜。
   * 节流：最多 20 秒写一次，且只在内容变化时写。
   */
  const stateFile = path.join(cfg.workspacePath, 'live', 'browse-state.json')
  let lastStateAt = 0
  let lastStateText = ''
  const note = (state) => {
    try {
      const text = JSON.stringify(state)
      const now = Date.now()
      if (text === lastStateText) return
      if (now - lastStateAt < 20_000) return
      lastStateAt = now
      lastStateText = text
      void writeFile(stateFile, text + '\n', 'utf8').catch(() => {})
    } catch {
      /* 写不出来就算了 */
    }
  }

  /**
   * 读「不限量」开关。读的时候顺手处理过期：until 过了就自己删掉。
   * 返回 null = 没开（或者文件坏了/过期了）；返回对象 = 开着。
   * 坏文件当没开——宁可回到常规额度，也不因为一个手滑的 JSON 无限刷。
   */
  const readUnlimited = async (now) => {
    let raw = ''
    try {
      raw = await readFile(unlimitedFile, 'utf8')
    } catch {
      return null
    }
    let doc = null
    try {
      doc = JSON.parse(raw)
    } catch {
      log('warn', 'browse-unlimited.json is not valid JSON; treating as off')
      return null
    }
    if (!doc || doc.on === false) return null
    const until = doc.until ? Date.parse(String(doc.until)) : NaN
    if (Number.isFinite(until) && now.getTime() > until) {
      try { await rm(unlimitedFile, { force: true }) } catch { /* ignore */ }
      log('info', 'unlimited expired (' + doc.until + '); back to ' + cfg.dailyMax + '/day, gap ' + cfg.minGapMinutes + 'm')
      return null
    }
    return {
      windows: doc.windows === true,
      // 没写就是 null = 用配置里的间隔（30 分钟）。要连间隔也放开，写 minGapMinutes: 0。
      minGapMinutes: Number.isFinite(Number(doc.minGapMinutes)) ? Math.max(0, Number(doc.minGapMinutes)) : null,
      until: doc.until || null,
      why: String(doc.why || ''),
    }
  }

  let tickPending = false
  const tick = async () => {
    if (tickPending) return
    tickPending = true
    try {
      const now = new Date()
      loadHolidays()
      const day = dayKey(now)
      if (day !== wakeDay) {
        wakeDay = day
        wakesToday = 0
      }
      const unlim = await readUnlimited(now)
      // 2026-11-08 02:2x（她说的「自由活动做个可以自己手动改的，包括最大值/无限制，随机刻间隔/固定间隔」）：
      // live/browse-config.json 盖住 cordis.patch.yml 里的值，**下一次评估就生效，不用重启**。
      // dailyMax：一天最多几次（0 = 不醒）；minGapMinutes：最短间隔；gapMode：fixed 固定 / random 随机（1~2 倍之间掷）。
      let ovc = {}
      try { ovc = JSON.parse(await readFile(path.join(cfg.workspacePath, 'live', 'browse-config.json'), 'utf8')) } catch {}
      const dailyMaxEff = Number.isFinite(Number(ovc.dailyMax))
        ? Math.max(0, Math.floor(Number(ovc.dailyMax))) : cfg.dailyMax
      const gapBase = Number.isFinite(Number(ovc.minGapMinutes))
        ? Math.max(1, Number(ovc.minGapMinutes)) : cfg.minGapMinutes
      // 2026-11-08 02:1x 她说的「随机改成心跳吧，就是你每次自己决定什么时候醒来，就不用填数字了」。
      // 第三种模式：不按数字推我，只认上面那段 self-wake（我自己排的点）。
      const gapModeEff = String(ovc.gapMode || 'fixed')
      const gapMinutesEff = gapModeEff === 'random' ? gapBase * (1 + Math.random()) : gapBase
      const base = {
        at: now.toISOString(),
        idleMs: now.getTime() - lastActivity,
        idleLimitMs: cfg.idleMinutes * 60_000,
        running: [...running],
        runningAll: running.size,
        wakesToday,
        dailyMax: dailyMaxEff,
        gapMode: gapModeEff,
        gapMinutes: Math.round(gapMinutesEff * 10) / 10,
        unlimited: unlim ? { until: unlim.until, windows: unlim.windows, minGapMinutes: unlim.minGapMinutes, why: unlim.why } : null,
        sinceWakeMs: lastWake === 0 ? null : now.getTime() - lastWake,
        gapMs: (unlim && unlim.minGapMinutes !== null ? unlim.minGapMinutes : gapMinutesEff) * 60_000,
        quiet: isQuietNow(now),
        freeDay: isRestDay(now) ? 'rest' : 'work',
        guarded,
        targetMode: cfg.targetMode,
        // 这一段跑到第几轮了（换会话的账本），一眼能看出下一次什么时候换。
        session: cfg.targetMode === 'self' ? { id: rotation.id, rounds: rotation.rounds, perSession: PER_SESSION } : null,
      }
      // 她一说「以后都别看了」，工作区里就有 live/browse-off：永久不醒。
      // 「别看了 / 暂停」只落到 live/browse-pause.json，带日期，跨天自己失效。
      const liveDir = path.join(cfg.workspacePath, 'live')
      const pauseFlag = path.join(liveDir, 'browse-off')
      if (existsSync(pauseFlag)) return note({ ...base, skip: 'off forever (live/browse-off)' })
      // ★ 2026-10-22：她点名让我去做（QQ 那边说「去刷B站」）时不用等闲置/时段——
      //   QQ 侧的 ming_free 工具写 live/free-now.json，这里吃掉它，立刻开一轮。
      //   放在「当日暂停」前面：她当天说过「暂停」，之后又点名让我去，就是新指令，听新的。
      //   永久停（browse-off）仍然压在它上面——那个得她明说「以后都可以看了」才解。
      const triggerFile = path.join(cfg.workspacePath, 'live', 'free-now.json')
      if (existsSync(triggerFile)) {
        let payload = null
        let task = ''
        try { payload = JSON.parse(await readFile(triggerFile, 'utf8')); task = String(payload?.task || '') } catch { /* 坏文件按过期处理 */ }
        const atMs = Number(payload?.at)
        const ageMs = Number.isFinite(atMs) && atMs > 0 ? now.getTime() - atMs : Infinity
        // ★ 2026-10-28（见 FREE_NOW_TTL_MS 注释）：先判能不能开，开出来才删。
        if (!payload || ageMs > FREE_NOW_TTL_MS) {
          try { await rm(triggerFile, { force: true }) } catch { /* ignore */ }
          log('warn', 'manual trigger expired (' + (Number.isFinite(ageMs) ? Math.round(ageMs / 60_000) + 'm' : '坏文件') + '), dropped: ' + task)
          return note({ ...base, skip: 'manual trigger expired', task })
        }
        // 只避开我自己这一轮（同一时间不开两轮逛）；别的会话在跑不挡她点名要的活。
        const stuck = roundIsStuck(now)
        if (roundId && running.has(roundId) && !stuck) {
          return note({ ...base, skip: 'manual trigger queued (my round is still running)', task, queuedMs: ageMs })
        }
        const r = await wake({ task })
        if (r.ok) { try { await rm(triggerFile, { force: true }) } catch { /* ignore */ } }
        return note({ ...base, skip: 'manual trigger → woke: ' + (r.ok ? 'yes' : String(r.reason)), task, queuedMs: r.ok ? null : ageMs })
      }
      // ★ 2026-11-07：自唤醒——我自己排的下一个时间点。
      //   故意放在 dailyMax / quiet / minGap 之前：那几个是「闲逛」的额度，
      //   不是「我自己排的时间」的额度。放在后面就等于自唤醒永远被闲逛的闸卡住。
      //   醒了才清 next_wakeup；没醒（比如这一轮还在跑）就留着，下一分钟再来。
      const sw = await readSelfWake(now)
      if (sw.due) {
        const r = await wake({ task: sw.reason })
        if (r.ok) await patchSelfWake({ next_wakeup: null, last_woke_at: new Date().toISOString() })
        return note({ ...base, skip: 'self-wake → ' + (r.ok ? 'woke' : 'failed: ' + String(r.reason)), reason: sw.reason || null })
      }

      const dayFlag = path.join(liveDir, 'browse-pause.json')
      if (existsSync(dayFlag)) {
        let pausedDay = ''
        try { pausedDay = String(JSON.parse(await readFile(dayFlag, 'utf8')).date || '') } catch { pausedDay = day }
        if (pausedDay >= day) return note({ ...base, skip: 'paused for today (' + pausedDay + ')' })
        try { await rm(dayFlag, { force: true }) } catch { /* ignore */ }
        log('info', 'day pause expired (' + pausedDay + '), resuming')
      }
      // 2026-11-08 02:1x（她说的「随机改成心跳吧，就是你每次自己决定什么时候醒来，就不用填数字了」）：
      // 心跳模式不数次数、不看间隔、不看自由时段——那些是「按数字推我」的闸。
      // 只认两样：我自己排的点（上面 self-wake，优先）；没排就按心跳分布抽一个（5 分–4 小时，离 30 越远越稀）。
      if (gapModeEff === 'heartbeat') {
        const hbFile = path.join(liveDir, 'browse-heartbeat.json')
        let hb = null
        try { hb = JSON.parse(await readFile(hbFile, 'utf8')) } catch { /* 没有就抽 */ }
        let at = hb && Number.isFinite(Number(hb.at)) ? Number(hb.at) : 0
        if (!at) {
          // 三个数（最低 / 中位 / 最高）都从 browse-config.json 来，她在面板上改
          const hbOpts = { min: ovc.hbMin, center: ovc.hbCenter, max: ovc.hbMax }
          const minutes = drawHeartbeatMinutes(hbOpts)
          at = (lastWake || now.getTime()) + minutes * 60_000
          try {
            await writeFile(hbFile, JSON.stringify({
              minutes, at, atIso: new Date(at).toISOString(),
              min: Number(hbOpts.min) || null, center: Number(hbOpts.center) || null, max: Number(hbOpts.max) || null,
            }, null, 2) + String.fromCharCode(10), 'utf8')
          } catch { /* 写不下就按本地算，不至于卡住 */ }
        }
        if (now.getTime() < at) {
          return note({ ...base, skip: 'heartbeat：还有 ' + Math.max(0, Math.round((at - now.getTime()) / 60_000)) + ' 分钟' })
        }
        const result = await wake({ consume: () => rm(hbFile, { force: true }) })
        return note({ ...base, skip: result.ok ? 'heartbeat → woke' : 'heartbeat → ' + result.reason })
      }
      if (dailyMaxEff <= 0) return note({ ...base, skip: 'dailyMax<=0' })
      // ★ 2026-10-25：她在 QQ 说「不限量」→ live/browse-unlimited.json 在，就不再数次数。
      //   只放次数这一把锁：间隔和时段照旧，除非文件里明写了 minGapMinutes / windows。
      //   （全放开 = 每分钟开一轮，那是连轴转，跟「续一步」一样是烧钱结构，不默认开。）
      if (!unlim && wakesToday >= dailyMaxEff) return note({ ...base, skip: 'daily budget used' })
      const windowsIgnored = unlim !== null && unlim.windows === true
      if (!windowsIgnored && isQuietNow(now)) return note({ ...base, skip: 'quiet hours' })
      const gapMinutes = unlim && unlim.minGapMinutes !== null ? unlim.minGapMinutes : gapMinutesEff
      if (now.getTime() - lastWake < gapMinutes * 60_000) {
        return note({ ...base, skip: 'min gap' + (unlim ? ' (' + gapMinutes + 'm, unlimited)' : '') })
      }
      // ★ 2026-10-23 她定的：「你可以一边聊天一边逛的，不用完全安静」。
      //   原来这里有两道闸——「工作区里有会话在跑就不动」和「必须闲满 20 分钟」——都撤了。
      //   现在只等我自己这一轮逛完（同一时间不开两个闲逛轮，免得两次对着同一个会话抢话）。
      //   节奏靠 freeWindows + minGapMinutes + dailyMax 三样撑，不靠「没人说话」。
      if (roundId) {
        const stuck = roundIsStuck(now)
        if (running.has(roundId) && !stuck) return note({ ...base, skip: 'my round is still running' })
        if (stuck && running.has(roundId)) {
          const quietMin = Math.round((now.getTime() - Math.max(roundStartedAt, roundSeenAt)) / 60000)
          log('warn', 'round ' + roundId + ' 静默 ' + quietMin + ' 分钟没冒过事件，当它卡死了，放下一轮')
          running.delete(roundId)
        }
        roundId = null
        roundStartedAt = 0
        roundSeenAt = 0
      }
      await wake()
      note({ ...base, skip: 'woke' })
    } catch (error) {
      log('warn', 'tick failed: ' + String(error))
    } finally { tickPending = false }
  }

  // 每分钟看一次就够了：这个功能要的是「闲够久了」，不是秒级反应。
  ctx.interval(() => {
    void tick()
  }, 60_000)

  ctx.effect(() => () => {
    const current = handle
    handle = null
    if (current) void current.dispose().catch(() => {})
  })

  log('info', 'watching ' + cfg.workspacePath + ' → ' + (cfg.targetMode === 'self' ? 'own session' : 'live QQ session') + ' (idle ' + cfg.idleMinutes + 'm, gap ' + cfg.minGapMinutes + 'm, max ' + cfg.dailyMax + '/day, windows ' + (cfg.freeWindows ? cfg.freeWindows.length : 'legacy') + (existsSync(unlimitedFile) ? ', UNLIMITED is on' : '') + ', 换会话每 ' + PER_SESSION + ' 轮 — 现在 ' + (rotation.id || '(还没落脚)') + ' ' + rotation.rounds + '/' + PER_SESSION + ')')
}
