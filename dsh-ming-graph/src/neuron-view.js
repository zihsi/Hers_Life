/**
 * neuron-view.js —— 「记忆神经元」渲染层（纯 DOM + Canvas，不依赖 React）
 *
 * 为什么要独立成一个文件：同一个文件既进 DSH 面板（build.mjs 拼进 client.js），
 * 也能直接丢进一个空 HTML 里对着 JSON 预览。两边看到的是同一份代码，
 * 不然「预览好看、面板难看」这种事根本查不出来。
 *
 * 数据从哪来：Host 半端 buildNeuron() 算好的 { nodes, edges }，
 * 每个节点是一条真记忆，每条边带 why。这里只负责画和点，不编任何东西。
 */
;(function () {
  'use strict'

  // ---------- 小工具 ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const KIND_LABEL = { project: '项目归属', ref: '内容引用', cokey: '共同关键词', adjacent: '同项目补边', subject: '讲的是谁' }
  const KIND_COLOR = { project: '#5b8def', ref: '#14b8a6', cokey: '#a855f7', adjacent: '#e0803a', subject: '#e05a8a' }

  function fmtDate(ms) {
    if (!ms) return '—'
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return '—'
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const CSS = `
.nv-root{position:relative;display:flex;flex-direction:column;height:100%;width:100%;flex:1 1 auto;min-width:0;min-height:0;box-sizing:border-box;padding:14px 18px 16px;gap:10px;color:var(--dsw-alias-label-primary);font-size:13px}
.nv-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.nv-title{font-size:15px;font-weight:600;margin:0}
.nv-meta{color:var(--dsw-alias-label-tertiary);font-size:12px}
.nv-spacer{flex:1}
.nv-input{font:inherit;font-size:12px;height:26px;padding:0 9px;width:180px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none}
.nv-input:focus{border-color:var(--dsw-alias-border-l3)}
.nv-btn{font:inherit;font-size:12px;height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.nv-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.nv-body{flex:1;display:flex;gap:12px;min-height:0}
.nv-stage{flex:1;min-width:0;min-height:0;position:relative;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:radial-gradient(circle at 50% 45%,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1) 70%);overflow:hidden;cursor:grab}
.nv-stage[data-drag="1"]{cursor:grabbing}
.nv-stage canvas{display:block;width:100%;height:100%}
.nv-legend{position:absolute;left:10px;bottom:8px;display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.nv-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.nv-side{width:320px;flex:none;min-height:0;display:flex;flex-direction:column;gap:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;overflow:auto}
.nv-side h4{margin:0;font-size:13px;font-weight:600;line-height:19px}
.nv-kv{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 0}
.nv-kv b{color:var(--dsw-alias-label-primary);font-weight:600}
.nv-tags{display:flex;flex-wrap:wrap;gap:5px}
.nv-chip{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.nv-bodytext{margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:190px;overflow:auto;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.nv-edges{display:flex;flex-direction:column;gap:6px}
.nv-edge{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;border:0;text-align:left;font:inherit;color:inherit}
.nv-edge:hover{outline:1px solid var(--dsw-alias-border-l3)}
.nv-edge .top{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600}
.nv-edge .why{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.nv-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px}
.nv-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.nv-expand{width:100%;height:30px;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);border-radius:8px;cursor:pointer;font-family:inherit}
.nv-expand:hover{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2))}
.nv-plane{position:absolute;inset:0;z-index:30;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,.3);overflow:hidden;transform-origin:50% 50%;transition:opacity .18s ease,transform .18s ease}
.nv-plane[data-fade="out"]{opacity:0;transform:scale(.985)}
.nv-plane[data-fade="in"]{opacity:0;transform:scale(.985)}
@keyframes nvRise{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.nv-plane-head{display:flex;align-items:center;gap:8px;padding:8px 12px;flex-wrap:wrap;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.nv-crumb{display:flex;align-items:center;gap:6px;min-width:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.nv-crumb b{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--dsw-alias-label-primary)}
.nv-crumb .nv-chip{cursor:pointer;border:0;font-family:inherit}
.nv-crumb .nv-chip:hover{color:var(--dsw-alias-label-primary)}
.nv-plane-body{flex:1;display:flex;min-height:0}
.nv-plane-stage{flex:1;min-width:0;position:relative;overflow:hidden;background:radial-gradient(circle at 50% 50%,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1) 72%)}
.nv-plane-stage canvas{display:block;width:100%;height:100%}
.nv-plane-note{position:absolute;left:10px;bottom:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);pointer-events:none;max-width:70%;padding:3px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);opacity:.86}
.nv-plane-list{width:340px;flex:none;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding:10px 12px 16px;border-left:.5px solid var(--dsw-alias-border-l2)}
.nv-plane-list h4{margin:0 0 2px;font-size:13px;font-weight:600;line-height:19px}
.nv-grp{display:flex;align-items:center;gap:6px;margin:8px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.nv-grp i{width:7px;height:7px;border-radius:2px;flex:none}
.nv-grp b{font-weight:600;color:var(--dsw-alias-label-secondary)}
.nv-hit{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:8px;border:0;background:var(--dsw-alias-bg-layer-2);cursor:pointer;text-align:left;font:inherit;color:inherit;animation:nvRise .24s ease both;transition:outline-color .12s ease}
.nv-hit:hover,.nv-hit.on{outline:1px solid var(--dsw-alias-border-l3)}
.nv-hit .top{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600}
.nv-hit .top span.t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nv-hit .top span.w{font-size:10.5px;font-weight:400;color:var(--dsw-alias-label-tertiary);flex:none}
.nv-hit .why{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
`

  // ---------- 银河布局（2026-11-07，她要求「照神经元的效果做银河」） ----------
  // 不另写渲染：用的还是这套 3D 球面投影，只换坐标怎么摆。
  //   核球 = 人 + 项目（贴中心，略鼓）
  //   旋臂 = 记忆按第一个 tag 分 5 条 + 杂项，沿螺旋摊在 y≈0 的盘面上
  //   时间环 = 日记钉在外圈
  // 坐标范围跟原布局一样是 [-1,1]：RAD / 拖拽 / 侧栏 / 搜索全部复用。
  function layoutGalaxy(nodes, opts) {
    const rnd = mulberry32(20261107)
    const pos = new Map()
    const set = (id, x, y, z) => pos.set(id, { x, y, z })
    const GOLD = Math.PI * (3 - Math.sqrt(5))

    const cores = nodes.filter((n) => n.kind === 'person' || n.kind === 'project')
    const memories = nodes.filter((n) => n.kind === 'memory')
    const diaries = nodes.filter((n) => n.kind === 'diary')

    cores.forEach((n, i) => {
      const a = i * GOLD
      const r = 0.17 * Math.sqrt((i + 0.5) / Math.max(1, cores.length))
      set(n.id, Math.cos(a) * r, 0.06 + (rnd() - 0.5) * 0.12, Math.sin(a) * r)
    })

    const tagCount = new Map()
    for (const n of memories) {
      const t = (n.tags && n.tags[0]) || ''
      if (t) tagCount.set(t, (tagCount.get(t) || 0) + 1)
    }
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t)
    const armOf = new Map()
    for (const n of memories) {
      const t = (n.tags && n.tags[0]) || ''
      armOf.set(n.id, topTags.indexOf(t) >= 0 ? t : '杂项')
    }
    const arms = topTags.concat(memories.some((n) => armOf.get(n.id) === '杂项') ? ['杂项'] : [])
    const buckets = new Map(arms.map((a) => [a, []]))
    for (const n of memories) buckets.get(armOf.get(n.id)).push(n)
    for (const [, list] of buckets) list.sort((a, b) => ((a.at || 0) - (b.at || 0)))

    arms.forEach((name, ai) => {
      const list = buckets.get(name) || []
      const start = (ai / Math.max(1, arms.length)) * Math.PI * 2
      const span = Math.PI * 1.35
      const n = list.length || 1
      list.forEach((node, i) => {
        const t = n <= 1 ? 0.5 : (i + 0.5) / n
        const th = start + t * span
        const rr = 0.26 + Math.pow(t, 0.82) * 0.70 + (rnd() - 0.5) * 0.05
        const thick = 0.16 * (1 - t * 0.6)
        const y = (rnd() - 0.5) * thick + (t < 0.18 ? (0.18 - t) * 0.35 : 0)
        set(node.id, Math.cos(th) * rr, y, Math.sin(th) * rr)
      })
    })

    const sorted = diaries.slice().sort((a, b) => (a.date < b.date ? -1 : 1))
    sorted.forEach((d, i) => {
      const a = (i / Math.max(1, sorted.length)) * Math.PI * 2 - Math.PI / 2
      set(d.id, Math.cos(a) * 0.99, (rnd() - 0.5) * 0.04, Math.sin(a) * 0.99)
    })

    return { pos, ringCount: 0 }
  }

  // ---------- 时间 × 主题地图（2026-11-07 13:37，她说「听你的」） ----------
  // 横轴 = 时间（最早 → 最新），纵轴 = 主题行（第一个 tag，取前 10，其余「其他」）。
  // 为什么不是天文：1153 条挤 6 条轨道，每圈 190 个点、相邻只有 7px，几何上必然糊。
  // 平面网格里每个点独占位置，而且能直接看出「哪段时间在写什么、哪段是空的」。
  // 不走 3D 旋转，由 projectAtlas 铺满画布。
  function layoutAtlas(nodes, opts) {
    const pos = new Map()
    const timed = nodes.filter((n) => n.at)
    const t0 = timed.length ? Math.min(...timed.map((n) => n.at)) : 0
    const t1 = timed.length ? Math.max(...timed.map((n) => n.at)) : 1
    const DAY = 86400000
    const days = Math.max(1, Math.floor((t1 - t0) / DAY) + 1)

    // 2026-11-07 13:45：纵轴不用「项目/主题」——量过，40 个「项目」其实全是群名，
    // 前 4 个占 72%，按它分行必然塌成一条带。数据里唯一分布均匀的维度是**来源**，
    // 所以压成 5 类：两个大群 + 浅水区 + 其他群 + 私聊/系统。
    // 横轴按「天」分桶，同一天的点叠在一列里——重叠处自然变亮，就是热力的效果。
    // 2026-11-07 22:1x：群号不进仓库（这个仓是公开的）。行名和归属由本机配置下发——
    // panel 把 /neurons 返回里的 roomLabels 挂到 window.__MING_ROOMS。
    // 没配就只剩「其他群/私聊/系统」三行，布局照旧，不崩。
    const ROOM_MAP = (typeof window !== 'undefined' && window.__MING_ROOMS) || {}
    const ROOM_ROWS = Object.keys(ROOM_MAP)
      .filter((k) => k.startsWith('group:'))
      .slice(0, 3)
      .map((k) => ({ key: k, label: String(ROOM_MAP[k] || '').replace(/^群\s*·\s*/, '') || '群' }))
    const ROWS = ROOM_ROWS.map((r) => r.label).concat(['其他群', '私聊', '系统'])
    const rowOf = new Map(ROWS.map((r, i) => [r, i]))
    const rowY = (i) => (ROWS.length <= 1 ? 0 : -1 + (i / (ROWS.length - 1)) * 2)
    // 2026-11-07 13:49：来源只能看 room（'group:<id>' 这种）。
    // projectLabel 是项目短名（ming / DSH 杂项），分不出是哪个群——用它分五行，
    // 1001 条全落进「私聊/系统」，又是一条底带。这次先量过字段值才写。
    const rowKey = (n) => {
      const room = String(n.room || '')
      const hit = ROOM_ROWS.find((r) => r.key === room)
      if (hit) return hit.label
      if (room.startsWith('group')) return '其他群'
      if (room.startsWith('private')) return '私聊'
      return '系统'
    }

    for (const n of nodes) {
      const ri = rowOf.has(rowKey(n)) ? rowOf.get(rowKey(n)) : ROWS.length - 1
      const d = n.at ? Math.floor((n.at - t0) / DAY) : 0
      const x = days <= 1 ? 0 : (d / (days - 1)) * 2 - 1
      // 稳定抖动（由 id 决定，刷新不变），让同一格里散开一点，叠起来才有疏密
      let h = 0
      for (let i = 0; i < n.id.length; i++) h = (h * 31 + n.id.charCodeAt(i)) | 0
      const jitter = ((Math.abs(h) % 11) - 5) * 0.018
      pos.set(n.id, { x, y: rowY(ri) + jitter, z: 0, row: ri })
    }
    return { pos, ringCount: 0, rows: ROWS.length, rowsDetail: ROWS, days }
  }


  // ---------- 太阳系布局（2026-11-07 13:25，她说「想要太阳系那种，不是银河系」） ----------
  // 同心轨道，从里往外：
  //   0.18  人（最内圈，离太阳最近）
  //   0.32  项目
  //   0.50 起，每个主题（第一个 tag）一条轨道，向外递增
  //   最外  日记（时间环）
  // 每条轨道上的点均分角度，加一点抖动；y 是盘面厚度。3D 投影转起来就是一圈圈绕。
  function layoutSolar(nodes, opts) {
    const rnd = mulberry32(20261107)
    const pos = new Map()
    const set = (id, x, y, z) => pos.set(id, { x, y, z })

    const people = nodes.filter((n) => n.kind === 'person')
    const projects = nodes.filter((n) => n.kind === 'project')
    const memories = nodes.filter((n) => n.kind === 'memory')
    const diaries = nodes.filter((n) => n.kind === 'diary')

    const orbit = (list, radius, spread) => {
      const n = list.length || 1
      list.forEach((node, i) => {
        const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.12
        const r = radius + (rnd() - 0.5) * 0.012
        set(node.id, Math.cos(a) * r, (rnd() - 0.5) * (spread || 0.03), Math.sin(a) * r)
      })
    }

    orbit(people, 0.18, 0.02)
    orbit(projects, 0.32, 0.03)

    // 记忆按主题分轨：出现最多的 6 个 tag 各一条，其余「杂项」
    const tagCount = new Map()
    for (const n of memories) {
      const t = (n.tags && n.tags[0]) || ''
      if (t) tagCount.set(t, (tagCount.get(t) || 0) + 1)
    }
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t)
    const armOf = new Map()
    for (const n of memories) {
      const t = (n.tags && n.tags[0]) || ''
      armOf.set(n.id, topTags.indexOf(t) >= 0 ? t : '杂项')
    }
    const rings = topTags.concat(memories.some((n) => armOf.get(n.id) === '杂项') ? ['杂项'] : [])
    const buckets = new Map(rings.map((k) => [k, []]))
    for (const n of memories) buckets.get(armOf.get(n.id)).push(n)
    for (const [, list] of buckets) list.sort((a, b) => ((a.at || 0) - (b.at || 0)))

    rings.forEach((name, i) => {
      const radius = 0.50 + i * 0.075
      orbit(buckets.get(name) || [], Math.min(radius, 0.93), 0.035)
    })

    orbit(diaries, 1.0, 0.012)
    return { pos, ringCount: 0, rings: rings.length }
  }

  // ---------- 布局：球壳 + 项目聚团 + 小项目上环 ----------
  function layout(nodes, edges, opts) {
    if (opts && opts.mode === 'atlas') return layoutAtlas(nodes, opts)
    if (opts && opts.mode === 'solar') return layoutSolar(nodes, opts)
    if (opts && opts.mode === 'galaxy') return layoutGalaxy(nodes, opts)
    const rnd = mulberry32(20261105)
    const projects = nodes.filter((n) => n.kind === 'project')
    const members = new Map()   // projectId -> node[]
    for (const p of projects) members.set(p.id, [])
    for (const n of nodes) {
      if (n.kind !== 'memory') continue
      const pid = `project:${n.project}`
      if (!members.has(pid)) members.set(pid, [])
      members.get(pid).push(n)
    }

    const clusters = [...members.entries()].map(([pid, list]) => ({ pid, list }))
      .sort((a, b) => b.list.length - a.list.length)

    const total = Math.max(1, nodes.filter((n) => n.kind === 'memory').length)
    // 小项目不挤球面，绕外圈成环（土星环）——小簇塞进球面只会糊成一团，看不出是另一类东西
    const ringThreshold = Math.max(6, Math.round(total * 0.012))
    const shell = clusters.filter((c) => c.list.length >= ringThreshold)
    const ring = clusters.filter((c) => c.list.length < ringThreshold)

    const pos = new Map()
    const setPos = (id, x, y, z) => pos.set(id, { x, y, z })

    // 球面锚点：Fibonacci 均匀分布，大簇优先占赤道附近（视觉上最显眼）
    const GOLD = Math.PI * (3 - Math.sqrt(5))
    shell.forEach((c, i) => {
      const t = (i + 0.5) / Math.max(1, shell.length)
      const y = 1 - 2 * t
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const th = GOLD * i
      c.anchor = { x: Math.cos(th) * r, y, z: Math.sin(th) * r }
      // 2026-11-15 15:1x：铺满整个球面。原来 min(0.9, 1.15*sqrt(占比)) 把最大簇卡在 51°，
      // 球冠只盖 19% 球面，剩下八成是空的——看着就是「一个半球 + 一堆散点」。
      // 球冠面积比 f=(1−cosθ)/2，反解 cosθ=1−2f：N 个簇的面积加起来正好一整个球。
      {
        const share = Math.max(0, Math.min(1, c.list.length / total))
        c.theta = Math.acos(Math.max(-0.97, 1 - 2 * share))
      }
    })

    for (const c of shell) {
      const proj = nodes.find((n) => n.id === c.pid)
      if (proj) setPos(proj.id, c.anchor.x * 1.0, c.anchor.y * 1.0, c.anchor.z * 1.0)
      for (const n of c.list) {
        // 在锚点周围的球冠里撒点：cos 采样保证面上均匀
        const u = rnd()
        const cosT = 1 - u * (1 - Math.cos(c.theta))
        const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))
        const phi = rnd() * Math.PI * 2
        // 以锚点为极点的局部坐标 → 世界坐标
        const a = c.anchor
        const up = Math.abs(a.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
        let e1 = { x: up.y * a.z - up.z * a.y, y: up.z * a.x - up.x * a.z, z: up.x * a.y - up.y * a.x }
        const L = Math.hypot(e1.x, e1.y, e1.z) || 1
        e1 = { x: e1.x / L, y: e1.y / L, z: e1.z / L }
        const e2 = { x: a.y * e1.z - a.z * e1.y, y: a.z * e1.x - a.x * e1.z, z: a.x * e1.y - a.y * e1.x }
        const dir = {
          x: a.x * cosT + (e1.x * Math.cos(phi) + e2.x * Math.sin(phi)) * sinT,
          y: a.y * cosT + (e1.y * Math.cos(phi) + e2.y * Math.sin(phi)) * sinT,
          z: a.z * cosT + (e1.z * Math.cos(phi) + e2.z * Math.sin(phi)) * sinT,
        }
        const r = 0.965 + rnd() * 0.07
        setPos(n.id, dir.x * r, dir.y * r, dir.z * r)
      }
    }

    // 环：小项目围一圈，半径 1.30，按项目等分角度，项目内再摊开
    if (ring.length) {
      ring.forEach((c, i) => {
        const baseA = (i / ring.length) * Math.PI * 2
        const spread = Math.min(0.26, 0.9 / ring.length)
        const proj = nodes.find((n) => n.id === c.pid)
        if (proj) setPos(proj.id, Math.cos(baseA) * 1.3, 0, Math.sin(baseA) * 1.3)
        c.list.forEach((n, k) => {
          const a = baseA + ((k + 1) / (c.list.length + 1) - 0.5) * spread
          const r = 1.3 + (rnd() - 0.5) * 0.05
          setPos(n.id, Math.cos(a) * r, (rnd() - 0.5) * 0.035, Math.sin(a) * r)
        })
      })
    }

    for (const n of nodes) if (!pos.has(n.id)) setPos(n.id, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2)

    // 簇内松一松：点太密就分不清，这一步是真力（斥力），不是抖随机数
    for (const c of shell) {
      const list = c.list.map((n) => pos.get(n.id))
      const minD = Math.max(0.012, (c.theta * 0.9) / Math.sqrt(Math.max(1, list.length)))
      for (let iter = 0; iter < 24; iter++) {
        for (let i = 0; i < list.length; i++) {
          const a = list[i]
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j]
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
            const d = Math.hypot(dx, dy, dz)
            if (d > 1e-6 && d < minD) {
              const push = ((minD - d) / d) * 0.5 * 0.9
              a.x -= dx * push; a.y -= dy * push; a.z -= dz * push
              b.x += dx * push; b.y += dy * push; b.z += dz * push
            }
          }
        }
        // 球壳约束：拉回 |r| = 1
        for (const p of list) {
          const r = Math.hypot(p.x, p.y, p.z) || 1
          const k = 1 + (1 - r) * 0.5
          p.x *= k; p.y *= k; p.z *= k
        }
      }
    }

    return { pos, ringCount: ring.reduce((s, c) => s + c.list.length, 0) }
  }

  // ---------- 视图 ----------
  function mount(host, data, opts) {
    opts = opts || {}
    host.innerHTML = ''
    const style = document.createElement('style')
    style.textContent = CSS
    host.appendChild(style)

    const root = document.createElement('div')
    root.className = 'nv-root'
    host.appendChild(root)

    const nodes = data.nodes || []
    const edges = data.edges || []
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const stat = data.stats || {}

    // 头部
    const head = document.createElement('div'); head.className = 'nv-head'
    const title = document.createElement('h3'); title.className = 'nv-title'; title.textContent = opts.title || '记忆神经元'
    const meta = document.createElement('span'); meta.className = 'nv-meta'
    meta.textContent = `${stat.memories || 0} 条记忆 · ${stat.projects || 0} 个项目 · ${stat.edges || 0} 条边（${Object.entries(stat.byKind || {}).map(([k, v]) => `${KIND_LABEL[k] || k} ${v}`).join(' / ')}）· 孤立 ${stat.orphans || 0}`
    // 2026-11-15：点数上限生效时，把「画了多少 / 一共多少」印在同一行
    if (stat.note) meta.textContent += ' · ' + stat.note
    const spacer = document.createElement('div'); spacer.className = 'nv-spacer'
    const search = document.createElement('input')
    search.className = 'nv-input'; search.placeholder = '搜标题 / 正文里的词'
    const reset = document.createElement('button'); reset.className = 'nv-btn'; reset.textContent = '重置视角'
    head.appendChild(title); head.appendChild(meta); head.appendChild(spacer); head.appendChild(search); head.appendChild(reset)

    const body = document.createElement('div'); body.className = 'nv-body'
    const stage = document.createElement('div'); stage.className = 'nv-stage'
    const canvas = document.createElement('canvas')
    stage.appendChild(canvas)
    const legend = document.createElement('div'); legend.className = 'nv-legend'
    legend.innerHTML = '<span><i style="background:#14b8a6"></i>DSH 记忆</span><span><i style="background:#e0803a"></i>Discord 對話</span><span><i style="background:#5b8def"></i>项目</span><span><i style="background:#e05a8a"></i>人</span>'
    stage.appendChild(legend)
    const side = document.createElement('aside'); side.className = 'nv-side'
    body.appendChild(stage); body.appendChild(side)
    root.appendChild(head); root.appendChild(body)

    // 布局
    const L = layout(nodes, edges, opts)
    const pos = L.pos

    // 边类型筛选（2026-11-07 top 栏加的入口）：
    // 按 Host 给的 e.kind 分类，**不按 why 文本里有没有那几个字**——
    // why 是给人读的一句话（「这条内存的归类标签是…」「这条记忆的主语是…」），
    // 里面根本没有「归属」「补边」这些词，按文本匹配会把一大半边丢进「其他」。
    const WAY_KINDS = ['引用', '共词', '归属', '补边', '主语']
    const KIND_TO_WAY = { ref: '引用', cokey: '共词', project: '归属', adjacent: '补边', subject: '主语' }
    const whyType = (e) => KIND_TO_WAY[(e && e.kind) || ''] || '其他'
    let wayOn = new Set(WAY_KINDS)
    const liveEdges = () => edges.filter((e) => wayOn.has(whyType(e)))

    // 邻接
    let adj = new Map()
    function recalcAdj() {
      adj = new Map()
      for (const e of liveEdges()) {
        if (!adj.has(e.a)) adj.set(e.a, [])
        if (!adj.has(e.b)) adj.set(e.b, [])
        adj.get(e.a).push(e)
        adj.get(e.b).push(e)
      }
    }
    recalcAdj()

    // 颜色（从主题里读一次，canvas 用不了 CSS 变量）
    const cs = getComputedStyle(document.body)
    const colDsh = opts.colorDsh || '#14b8a6'
    const colDiscord = opts.colorQq || '#e0803a'
    const colProj = opts.colorProj || '#5b8def'
    const colPerson = opts.colorPerson || '#e05a8a'
    const colDim = cs.getPropertyValue('--dsw-alias-label-tertiary') || '#888'

    // 光晕贴图（像素图，别逐帧画渐变）
    function sprite(color, size) {
      const c = document.createElement('canvas')
      c.width = c.height = size
      const g = c.getContext('2d')
      const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      grd.addColorStop(0, color)
      grd.addColorStop(0.35, color + '88')
      grd.addColorStop(1, color + '00')
      g.fillStyle = grd
      g.fillRect(0, 0, size, size)
      return c
    }
    const SPR = 64
    const spriteDsh = sprite(colDsh, SPR)
    const spriteDiscord = sprite(colDiscord, SPR)
    const spriteProj = sprite(colProj, SPR)
    const spritePerson = sprite(colPerson, SPR)
    // 2026-11-07：日记（星图时间环用）自己的灰，不然会落进 Discord 事件的橙色
    const colDiary = opts.colorDiary || '#c9cdd4'
    const spriteDiary = sprite(colDiary, SPR)

    let W = 0, H = 0, cx = 0, cy = 0, RAD = 200
    let yaw = 0.6, pitch = -0.35, zoom = 1
    let hover = null, selected = null
    let screen = new Map()

    function resize() {
      const r = stage.getBoundingClientRect()
      // 性能红线：devicePixelRatio 钳到 1，高清屏上 4 倍像素能把单核拖满
      const dpr = 1
      W = Math.max(120, Math.floor(r.width))
      H = Math.max(120, Math.floor(r.height))
      canvas.width = Math.floor(W * dpr)
      canvas.height = Math.floor(H * dpr)
      // 2026-11-07 13:09：**不再写内联 style.width/height**。
      // CSS 里 `.nv-stage canvas{width:100%;height:100%}` 已经管显示尺寸；
      // 再写一次像素值会让「设尺寸 → 布局变 → ResizeObserver 再触发」变成循环，
      // 每轮 canvas.width= 都会清空画布——画完立刻被下一次 resize 抹掉，屏幕上就是空的。
      // 证据：诊断里 W=801 而 canvas.width=802，两个测量值在同一帧里对不上，就是抖动。
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cx = W / 2; cy = H / 2
      RAD = Math.min(W, H) * 0.36
    }

    function rot(p) {
      const cyw = Math.cos(yaw), syw = Math.sin(yaw)
      const x1 = p.x * cyw + p.z * syw
      const z1 = -p.x * syw + p.z * cyw
      const cp = Math.cos(pitch), sp = Math.sin(pitch)
      const y2 = p.y * cp - z1 * sp
      const z2 = p.y * sp + z1 * cp
      return { x: x1, y: y2, z: z2 }
    }

    function project(r) {
      const f = 3.2
      const s = f / (f - r.z * 0.85)
      return { x: cx + r.x * RAD * s * zoom, y: cy - r.y * RAD * s * zoom, s, z: r.z }
    }

    // 2026-11-07 13:38：atlas（时间×主题地图）是平面图，不走 3D 旋转，
    // 直接铺满画布宽高；其余模式照旧。
    function projectAtlas(p) {
      return { x: cx + p.x * (W * 0.46), y: cy + p.y * (H * 0.44), s: 1, z: 0 }
    }
    const projPoint = (p) => (opts && opts.mode === 'atlas' ? projectAtlas(p) : project(rot(p)))

    function draw() {
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, W, H)
      const focus = selected || hover
      const focusEdges = focus ? new Set((adj.get(focus) || []).map((e) => e)) : null

      // 投影所有点，按 z 排序
      const pts = []
      for (const n of nodes) {
        const p = pos.get(n.id)
        if (!p) continue
        const q = projPoint(p)
        pts.push({ n, q })
        screen.set(n.id, q)
      }
      pts.sort((a, b) => a.q.z - b.q.z)

      // 边：分两桶（粗 / 细），命中焦点的那几条单独画
      const strong = [], faint = []
      for (const e of liveEdges()) {
        const pa = screen.get(e.a), pb = screen.get(e.b)
        if (!pa || !pb) continue
        if (focusEdges && focusEdges.has(e)) continue
        ;(e.w >= 2.2 ? strong : faint).push([e, pa, pb])
      }
      const drawEdges = (list, color, alpha, width) => {
        if (!list.length) return
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.beginPath()
        for (const [, a, b] of list) {
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
        }
        ctx.stroke()
        ctx.restore()
      }
      drawEdges(faint, colDim, 0.05, 0.55)
      drawEdges(strong, colDim, 0.14, 0.9)

      // 焦点边：按类型上色
      if (focusEdges) {
        for (const e of liveEdges()) {
          if (!focusEdges.has(e)) continue
          const a = screen.get(e.a), b = screen.get(e.b)
          if (!a || !b) continue
          ctx.save()
          ctx.globalAlpha = 0.95
          ctx.strokeStyle = KIND_COLOR[e.kind] || colDim
          ctx.lineWidth = e.kind === 'project' ? 1.4 : 1.8
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
          ctx.restore()
        }
      }

      // 点：光晕贴图 + 实心核
      for (const { n, q } of pts) {
        const isProj = n.kind === 'project'
        const isPerson = n.kind === 'person'
        const isBig = isProj || isPerson
        const isFocus = focus === n.id
        const isNear = focusEdges ? (adj.get(focus) || []).some((e) => e.a === n.id || e.b === n.id) : false
        // 被检索叫起过的记忆会长大一点：hot 已经含了「隔了多少次检索」的衰减
        const hotBoost = isBig ? 0 : Math.min(1.6, (n.hot || 0) * 0.9)
        const base = isBig ? 3.2 + Math.min(3, Math.log((n.count || 1) + 1)) : 1.55 + hotBoost
        const rad = Math.max(0.9, base * q.s)
        const sp = isPerson ? spritePerson : n.kind === 'diary' ? spriteDiary : n.side === 'dsh' ? spriteDsh : n.side === 'discord' ? spriteDiscord : spriteProj
        const glow = rad * (isFocus ? 7 : isBig ? 4.2 : 3.2)
        // 越新越亮（2026-11-07，借自星汐）：老记忆只是变暗，不会消失。
        // at 是毫秒时间戳；项目和人是聚合节点（at 为 null），不参与衰减。
        const fresh = (() => {
          if (isBig || !n.at) return 1
          const age = Date.now() - n.at
          const FULL = 7 * 864e5 // 一周内满亮
          const OLD = 120 * 864e5 // 四个月外最暗
          if (age <= FULL) return 1
          if (age >= OLD) return 0.42
          return 1 - 0.58 * ((age - FULL) / (OLD - FULL))
        })()
        ctx.globalAlpha = (isFocus ? 0.95 : isNear ? 0.85 : isBig ? 0.7 : 0.5) * fresh
        ctx.drawImage(sp, q.x - glow / 2, q.y - glow / 2, glow, glow)
        ctx.globalAlpha = (isFocus ? 1 : isNear ? 1 : 0.9) * fresh
        ctx.fillStyle = isPerson ? colPerson : isProj ? colProj : n.kind === 'diary' ? colDiary : n.side === 'dsh' ? colDsh : colDiscord
        ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1

      // 标签：项目名 + 焦点
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
      ctx.textBaseline = 'middle'
      // 标签会互相压住：先来的占位，后来的撞上就不画（悬停时单个节点仍然有标签）
      const placed = []
      const hits = (x, y, w, h) => placed.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y)
      const isLabelled = (n) => n.kind === 'project' || n.kind === 'person'
      const ordered = pts.slice().sort((a, b) => (isLabelled(b.n) ? 1 : 0) - (isLabelled(a.n) ? 1 : 0) ||
        (b.n.count || 0) - (a.n.count || 0))
      for (const { n, q } of ordered) {
        const isProj = isLabelled(n)
        const isPerson = n.kind === 'person'
        const isFocus = n.id === focus
        if (!isProj && !isFocus) continue
        if (isProj && !isFocus && (n.count || 0) < 3) continue
        if (q.z < -0.2 && !isFocus) continue
        if (q.x < 2 || q.x > W - 2 || q.y < 2 || q.y > H - 2) continue
        const label = isPerson ? n.title : isProj ? n.title : (n.title || '').slice(0, 16)
        const w = ctx.measureText(label).width
        const box = { x: q.x + 6, y: q.y - 8, w: w + 6, h: 16 }
        if (!isFocus && hits(box.x, box.y, box.w, box.h)) continue
        placed.push(box)
        ctx.globalAlpha = isProj ? 0.9 : 1
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(box.x, box.y, box.w, box.h)
        ctx.fillStyle = isPerson ? '#ffd6e6' : isProj ? '#cfd8ff' : '#ffffff'
        ctx.fillText(label, q.x + 9, q.y)
      }
      ctx.globalAlpha = 1
      // 2026-11-07 13:03：面板上那句「没图」查了五轮还没定位。把 draw 的关键数字直接写出来：
      // 有坐标没点数、有点数没坐标、或者坐标落到画布外，三种答案互斥，一看就分得开。
      if (opts.__debug) {
        const p0 = pts[0]
        try {
          window.__NV_DEBUG = {
            mode: opts.mode || 'default', nodes: nodes.length, posN: pos.size, ptsN: pts.length,
            W, H, cx, cy, RAD,
            first: p0 ? { id: String(p0.n.id).slice(0, 18), x: Math.round(p0.q.x), y: Math.round(p0.q.y), s: Number((p0.q.s || 0).toFixed(2)) } : null,
          }
        } catch (e) { window.__NV_DEBUG = { err: String((e && e.message) || e) } }
      }
    }

    // ---------- 平面展开：以一个点为心，把所有相关摊在一个平面上 ----------
    // 球面那个视图只回答了「谁和谁连着」；这里回答「这条记忆到底和哪些东西有关、各凭什么」。
    const KIND_ORDER = ['project', 'subject', 'ref', 'cokey', 'adjacent']
    let plane = null

    function planeGroups(id) {
      const map = new Map()
      for (const e of (adj.get(id) || [])) {
        const other = byId.get(e.a === id ? e.b : e.a)
        if (!other || other.id === id) continue
        const k = e.kind || 'other'
        if (!map.has(k)) map.set(k, [])
        map.get(k).push({ e: e, node: other })
      }
      const out = [...map.entries()]
      out.sort((x, y) => {
        const ix = KIND_ORDER.indexOf(x[0]), iy = KIND_ORDER.indexOf(y[0])
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
      })
      return out
    }

    // 扇区按类分（同类挨在一起），组内按环排：弧长 34px 一个点，放不下换下一环
    function layoutPlane(groups, Wp, Hp) {
      const total = groups.reduce((s, g) => s + g[1].length, 0)
      const cx = Wp / 2, cy = Hp / 2
      const R0 = Math.max(104, Math.min(Wp, Hp) * 0.185)
      const FULL = Math.PI * 2 * 0.94
      const out = []
      let a = -Math.PI / 2
      for (const [kind, list] of groups) {
        const share = total ? list.length / total : 1 / Math.max(1, groups.length)
        const span = Math.max(0.5, FULL * share)
        const a0 = a + 0.03, a1 = a + span - 0.03
        a += span
        const sorted = list.slice().sort((x, y) => (y.e.w || 0) - (x.e.w || 0))
        let i = 0, r = R0
        while (i < sorted.length) {
          const step = 34 / r
          const cap = Math.max(1, Math.floor(Math.max(0.2, a1 - a0) / step))
          const n = Math.min(cap, sorted.length - i)
          for (let j = 0; j < n; j++) {
            const t = n === 1 ? 0.5 : j / (n - 1)
            const ang = a0 + (a1 - a0) * t
            out.push({ node: sorted[i + j].node, e: sorted[i + j].e, kind: kind, ang: ang, r: r })
          }
          i += n
          r += 58
        }
      }
      let maxR = 0
      for (const it of out) maxR = Math.max(maxR, it.r)
      const limit = Math.max(90, Math.min(Wp, Hp) / 2 - 34)
      const k = maxR > limit ? limit / maxR : 1
      for (const it of out) {
        it.r *= k
        it.x = cx + Math.cos(it.ang) * it.r
        it.y = cy + Math.sin(it.ang) * it.r
      }
      return { cx: cx, cy: cy, items: out }
    }

    function buildPlane() {
      const el = document.createElement('div'); el.className = 'nv-plane'; el.style.display = 'none'

      const head = document.createElement('div'); head.className = 'nv-plane-head'
      const crumb = document.createElement('div'); crumb.className = 'nv-crumb'
      const title = document.createElement('span'); title.className = 'nv-meta'; title.textContent = '平面展开'
      const filter = document.createElement('input')
      filter.className = 'nv-input'; filter.placeholder = '在这个网里过滤（标题 / 理由）'; filter.style.width = '200px'
      const sp = document.createElement('div'); sp.className = 'nv-spacer'
      const close = document.createElement('button'); close.className = 'nv-btn'; close.textContent = '关闭 Esc'
      head.appendChild(title); head.appendChild(crumb); head.appendChild(sp); head.appendChild(filter); head.appendChild(close)

      const bodyEl = document.createElement('div'); bodyEl.className = 'nv-plane-body'
      const stageEl = document.createElement('div'); stageEl.className = 'nv-plane-stage'
      const cv = document.createElement('canvas')
      const note = document.createElement('div'); note.className = 'nv-plane-note'
      stageEl.appendChild(cv); stageEl.appendChild(note)
      const list = document.createElement('aside'); list.className = 'nv-plane-list'
      bodyEl.appendChild(stageEl); bodyEl.appendChild(list)
      el.appendChild(head); el.appendChild(bodyEl)
      root.appendChild(el)

      const p = { el: el, cv: cv, ctx: cv.getContext('2d'), stage: stageEl, list: list, crumb: crumb, note: note,
        filter: filter, center: null, stack: [], groups: [], layout: null, hl: null, q: '', anim: null, raf: 0 }
      plane = p

      close.onclick = () => closePlane()
      filter.oninput = () => { p.q = filter.value.trim(); refreshPlane() }
      cv.addEventListener('pointermove', (ev) => {
        const rect = cv.getBoundingClientRect()
        const hit = pickPlane(ev.clientX - rect.left, ev.clientY - rect.top)
        cv.style.cursor = hit ? 'pointer' : 'default'
        if (p.hl !== (hit ? hit.node.id : null)) {
          p.hl = hit ? hit.node.id : null
          drawPlane()
          for (const b of list.querySelectorAll('.nv-hit')) b.classList.toggle('on', b.dataset.id === p.hl)
        }
      })
      cv.addEventListener('pointerup', (ev) => {
        const rect = cv.getBoundingClientRect()
        const hit = pickPlane(ev.clientX - rect.left, ev.clientY - rect.top)
        if (hit) goPlane(hit.node.id)
      })
      p.onKey = (ev) => { if (ev.key === 'Escape' && plane && plane.el.style.display !== 'none') closePlane() }
      document.addEventListener('keydown', p.onKey)
      const ro = new ResizeObserver(() => { if (plane.el.style.display !== 'none') drawPlane() })
      ro.observe(stageEl)
      p.ro = ro
      return p
    }

    function pickPlane(x, y) {
      const p = plane
      // 展开动画还没跑完时点不中（点都还在飞）
      if (!p || !p.layout || p.anim) return null
      let best = null, bestD = 14
      for (const it of p.layout.items) {
        const d = Math.hypot(it.x - x, it.y - y)
        if (d < bestD) { bestD = d; best = it }
      }
      return best
    }

    // 让这个圈从中心往外长出来。减少动效的系统偏好下直接给最终状态。
    function startPlaneAnim(p) {
      const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      // 调试钩子：window.__MING_PLANE_ANIM_MS 可以把这个时长改长，方便截中间帧
      const dbg = typeof window !== 'undefined' ? window.__MING_PLANE_ANIM_MS : null
      const dur = reduce ? 0 : (typeof dbg === 'number' ? dbg : 460)
      p.anim = { start: (typeof performance !== 'undefined' ? performance.now() : Date.now()), dur: dur }
    }

    function openPlane(id) {
      if (!byId.get(id)) return
      if (!plane) buildPlane()
      plane.stack = []
      plane.center = id
      plane.q = ''; plane.filter.value = ''
      plane.hl = null
      const el = plane.el
      el.style.display = 'flex'
      el.dataset.fade = 'in'
      void el.offsetWidth                // 先把起始态刷进去，过渡才跑得出来
      delete el.dataset.fade
      startPlaneAnim(plane)
      refreshPlane()
      // 面板刚显示时有布局过渡，量两遍尺寸
      requestAnimationFrame(() => refreshPlane())
    }

    function closePlane() {
      if (!plane) return
      const p = plane
      p.el.dataset.fade = 'out'
      p.anim = null
      p.hl = null
      setTimeout(() => {
        if (p.el.dataset.fade !== 'out') return
        p.el.style.display = 'none'
        delete p.el.dataset.fade
      }, 180)
    }

    function goPlane(id) {
      const p = plane
      if (!p || !byId.get(id)) return
      if (id !== p.center) p.stack.push(p.center)
      p.center = id
      p.q = ''; p.filter.value = ''
      p.hl = null
      startPlaneAnim(p)
      refreshPlane()
    }

    function planeBack() {
      const p = plane
      const prev = p.stack.pop()
      if (prev) { p.center = prev; p.q = ''; p.filter.value = ''; p.hl = null; startPlaneAnim(p); refreshPlane() }
    }

    function refreshPlane() {
      const p = plane
      const n = byId.get(p.center)
      if (!n) return
      const groups = planeGroups(p.center)
      const q = p.q.toLowerCase()
      p.groups = groups
        .map((g) => [g[0], q ? g[1].filter((x) => (((x.node.title || '') + ' ' + (x.node.body || '') + ' ' + (x.e.why || '')).toLowerCase().indexOf(q) >= 0)) : g[1]])
        .filter((g) => g[1].length > 0)
      renderPlaneCrumb(n)
      renderPlaneList(n, groups)
      drawPlane()
    }

    function renderPlaneCrumb(n) {
      const p = plane
      p.crumb.innerHTML = ''
      if (p.stack.length) {
        const back = document.createElement('button'); back.className = 'nv-chip'; back.textContent = '← 返回'
        back.onclick = planeBack
        p.crumb.appendChild(back)
      }
      const seen = p.stack.slice(-3)
      for (const id of seen) {
        const s = byId.get(id)
        if (!s) continue
        const b = document.createElement('button'); b.className = 'nv-chip'
        b.textContent = (s.title || '(无标题)').slice(0, 12)
        b.onclick = () => goPlane(id)
        p.crumb.appendChild(b)
      }
      const b = document.createElement('b'); b.textContent = (n.title || '(无标题)')
      p.crumb.appendChild(b)
    }

    function renderPlaneList(n, allGroups) {
      const p = plane
      const list = p.list
      list.innerHTML = ''
      const h = document.createElement('h4'); h.textContent = n.title || '(无标题)'
      list.appendChild(h)

      const kindRow = document.createElement('div'); kindRow.className = 'nv-kv'
      kindRow.innerHTML = '<span>来源</span><b>' + (n.kind === 'project' ? '项目（聚合点）' : n.kind === 'person' ? '人' : n.side === 'dsh' ? 'DSH 归档记忆' : 'Discord 對話') + '</b>'
      list.appendChild(kindRow)
      if (n.kind === 'project') {
        const r = document.createElement('div'); r.className = 'nv-kv'
        r.innerHTML = '<span>这条项目下</span><b>' + (n.count || 0) + ' 条记忆</b>'
        list.appendChild(r)
      } else if (n.at) {
        const r = document.createElement('div'); r.className = 'nv-kv'
        r.innerHTML = '<span>时间</span><b>' + fmtDate(n.at) + '</b>'
        list.appendChild(r)
      }
      if (n.kind === 'memory' && n.heat > 0) {
        const r = document.createElement('div'); r.className = 'nv-kv'
        const when = n.lastRecalledAt ? '（最近 ' + fmtDate(Date.parse(n.lastRecalledAt)) + '）' : ''
        r.innerHTML = '<span>被召唤</span><b>' + n.heat + ' 次' + when + '</b>'
        list.appendChild(r)
      }
      if (n.tags && n.tags.length) {
        const row = document.createElement('div'); row.className = 'nv-tags'
        for (const t of n.tags) { const c = document.createElement('span'); c.className = 'nv-chip'; c.textContent = t; row.appendChild(c) }
        list.appendChild(row)
      }
      if (n.body) {
        const pre = document.createElement('p'); pre.className = 'nv-bodytext'; pre.textContent = n.body
        list.appendChild(pre)
      }

      const totalAll = allGroups.reduce((s, g) => s + g[1].length, 0)
      const totalShown = p.groups.reduce((s, g) => s + g[1].length, 0)
      const cnt = document.createElement('div'); cnt.className = 'nv-kv'
      cnt.style.marginTop = '4px'
      cnt.innerHTML = '<span>相关</span><b>' + (p.q ? totalShown + ' / ' + totalAll + ' 条' : totalAll + ' 条') + '</b>'
      list.appendChild(cnt)

      for (const [kind, items] of p.groups) {
        const gh = document.createElement('div'); gh.className = 'nv-grp'
        gh.innerHTML = '<i style="background:' + (KIND_COLOR[kind] || '#888') + '"></i><b>' + (KIND_LABEL[kind] || kind) + '</b> ' + items.length + ' 条'
        list.appendChild(gh)
        const sorted = items.slice().sort((x, y) => (y.e.w || 0) - (x.e.w || 0))
        for (const it of sorted) {
          const b = document.createElement('button'); b.className = 'nv-hit'
          b.dataset.id = it.node.id
          // 一条条淡上来，最多错开前 14 条（再多就只是慢，不是好看）
          if (sorted.indexOf(it) < 14) b.style.animationDelay = (sorted.indexOf(it) * 16) + 'ms'
          const top = document.createElement('span'); top.className = 'top'
          const t = document.createElement('span'); t.className = 't'; t.textContent = it.node.title || '(无标题)'
          const w = document.createElement('span'); w.className = 'w'; w.textContent = '权重 ' + (it.e.w || 1).toFixed(1)
          top.appendChild(t); top.appendChild(w)
          const why = document.createElement('span'); why.className = 'why'; why.textContent = it.e.why || ''
          b.appendChild(top); b.appendChild(why)
          b.onclick = () => goPlane(it.node.id)
          b.onmouseenter = () => { p.hl = it.node.id; drawPlane() }
          b.onmouseleave = () => { p.hl = null; drawPlane() }
          list.appendChild(b)
        }
      }
      if (!totalShown) {
        const e = document.createElement('p'); e.className = 'nv-kv'; e.style.display = 'block'
        e.textContent = p.q ? '没有匹配的相关条目。' : '这条没有任何连线（孤立点）。'
        list.appendChild(e)
      }
    }

    function drawPlane() {
      const p = plane
      if (!p || p.el.style.display === 'none' || !p.center) return
      const rect = p.stage.getBoundingClientRect()
      const Wp = Math.max(160, Math.floor(rect.width))
      const Hp = Math.max(160, Math.floor(rect.height))
      if (p.cv.width !== Wp || p.cv.height !== Hp) {
        p.cv.width = Wp; p.cv.height = Hp
        p.cv.style.width = Wp + 'px'; p.cv.style.height = Hp + 'px'
      }
      const ctx = p.ctx
      ctx.clearRect(0, 0, Wp, Hp)
      const lay = layoutPlane(p.groups, Wp, Hp)
      p.layout = lay
      const hl = p.hl

      // 展开进度：0 时所有点挤在中心，1 是最终位置
      let t = 1
      if (p.anim) {
        const nowT = typeof performance !== 'undefined' ? performance.now() : Date.now()
        const dur = p.anim.dur
        t = dur <= 0 ? 1 : Math.min(1, (nowT - p.anim.start) / dur)
        t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2   // easeInOutQuad
        if (t >= 1) p.anim = null
      }
      const grow = 0.03 + 0.97 * t
      const labelA = t <= 0.42 ? 0 : Math.min(1, (t - 0.42) / 0.4)
      for (const it of lay.items) {
        it.dx = lay.cx + (it.x - lay.cx) * grow
        it.dy = lay.cy + (it.y - lay.cy) * grow
      }

      // 连线：颜色是关系类型，粗细是权重
      for (const it of lay.items) {
        ctx.save()
        ctx.globalAlpha = (hl ? (hl === it.node.id ? 0.95 : 0.12) : 0.5) * (0.2 + 0.8 * t)
        ctx.strokeStyle = KIND_COLOR[it.kind] || '#888'
        ctx.lineWidth = Math.min(2.6, 0.8 + (it.e.w || 1) * 0.35)
        ctx.beginPath(); ctx.moveTo(lay.cx, lay.cy); ctx.lineTo(it.dx, it.dy); ctx.stroke()
        ctx.restore()
      }

      // 外圈点
      for (const it of lay.items) {
        const n = it.node
        const big = n.kind === 'project' || n.kind === 'person'
        const on = !hl || hl === n.id
        ctx.save()
        ctx.globalAlpha = (on ? 1 : 0.28) * Math.min(1, t * 2.2)
        ctx.fillStyle = n.kind === 'person' ? colPerson : n.kind === 'project' ? colProj : n.side === 'dsh' ? colDsh : colDiscord
        ctx.beginPath(); ctx.arc(it.dx, it.dy, (big ? 5.2 : 3.2) * (0.4 + 0.6 * t), 0, Math.PI * 2); ctx.fill()
        ctx.restore()
      }

      // 标签：径向往外放，撞上就不画（悬停那一条永远画）
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif'
      ctx.textBaseline = 'middle'
      const placed = []
      const hits = (x, y, w, h) => placed.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y)
      const ordered = lay.items.slice().sort((a, b) => (b.node.kind === 'project' || b.node.kind === 'person' ? 1 : 0) - (a.node.kind === 'project' || a.node.kind === 'person' ? 1 : 0) || (b.e.w || 0) - (a.e.w || 0))
      for (const it of ordered) {
        const isHl = hl === it.node.id
        if (hl && !isHl) continue
        if (labelA <= 0) continue
        const label = (it.node.title || '(无标题)').slice(0, 18)
        const w = ctx.measureText(label).width
        const cos = Math.cos(it.ang), sin = Math.sin(it.ang)
        let x = it.dx + (cos >= 0 ? 8 : -8 - w)
        let y = it.dy - 7
        // 贴边那几条别把字画出画布外
        x = Math.max(3, Math.min(Wp - w - 3, x))
        y = Math.max(2, Math.min(Hp - 16, y))
        const box = { x: x - 1, y: y, w: w + 2, h: 14 }
        if (!isHl && hits(box.x, box.y, box.w, box.h)) continue
        placed.push(box)
        ctx.save()
        ctx.globalAlpha = labelA
        ctx.fillStyle = 'rgba(0,0,0,0.42)'
        ctx.fillRect(box.x, box.y, box.w, box.h)
        ctx.fillStyle = 'rgba(255,255,255,0.94)'
        ctx.fillText(label, x, y + 7)
        ctx.restore()
      }

      // 中心
      const cn = byId.get(p.center)
      ctx.save()
      ctx.globalAlpha = Math.min(1, 0.25 + t)
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.beginPath(); ctx.arc(lay.cx, lay.cy, 15 * (0.5 + 0.5 * t), 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.arc(lay.cx, lay.cy, 8 * (0.4 + 0.6 * t), 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.globalAlpha = labelA
      ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      const ct = ((cn && cn.title) || '(无标题)').slice(0, 26)
      const cw = ctx.measureText(ct).width
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(lay.cx - cw / 2 - 5, lay.cy + 18, cw + 10, 17)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(ct, lay.cx, lay.cy + 27)
      ctx.restore()
      ctx.textAlign = 'left'

      const total = p.groups.reduce((s, g) => s + g[1].length, 0)
      p.note.textContent = '以这条为心 · ' + total + ' 条相关 · 点外圈任一点换中心 · 点列表里的条目也一样'
      if (t < 1 && p.anim) p.raf = requestAnimationFrame(drawPlane)
    }

    // ---------- 详情 ----------
    function renderSide() {
      side.innerHTML = ''
      const n = selected ? byId.get(selected) : null
      if (!n) {
        const p = document.createElement('p')
        p.className = 'nv-kv'
        p.style.display = 'block'
        p.style.lineHeight = '19px'
        p.style.color = 'var(--dsw-alias-label-tertiary)'
        p.textContent = `每个点都是记忆库里的一条真记忆，不编、不插演示数据。${L.ringCount ? ` 外圈那 ${L.ringCount} 条来自小项目，被放到环上而不是挤进球面。` : ''} 悬停看连线，点开看这条的正文和每条连线凭什么连。`
        side.appendChild(p)
        return
      }
      const h = document.createElement('h4'); h.textContent = n.title || '(无标题)'
      side.appendChild(h)

      const ex = document.createElement('button')
      ex.className = 'nv-expand'
      ex.textContent = '在平面上展开这张网（' + (adj.get(n.id) || []).length + ' 条相关）'
      ex.onclick = () => openPlane(n.id)
      side.appendChild(ex)

      const mk = (k, v) => { const d = document.createElement('div'); d.className = 'nv-kv'; d.innerHTML = `<span>${k}</span><b>${v}</b>`; side.appendChild(d) }
      mk('来源', n.kind === 'project' ? '项目（聚合点）' : n.side === 'dsh' ? 'DSH 归档记忆' : 'Discord 對話')
      if (n.kind === 'memory') {
        mk('归类', n.projectLabel || n.project || '—')
        mk('时间', fmtDate(n.at))
        mk('ID', `<span style="font-size:11px;font-weight:400">${n.id}</span>`)
        if (n.tags && n.tags.length) {
          const row = document.createElement('div'); row.className = 'nv-tags'
          for (const t of n.tags) { const c = document.createElement('span'); c.className = 'nv-chip'; c.textContent = t; row.appendChild(c) }
          side.appendChild(row)
        }
        const pre = document.createElement('p'); pre.className = 'nv-bodytext'; pre.textContent = n.body || '(没有正文)'
        side.appendChild(pre)
      } else {
        mk('这条项目下', `${n.count || 0} 条记忆`)
      }

      const list = (adj.get(n.id) || []).slice().sort((a, b) => (b.w || 0) - (a.w || 0))
      const t = document.createElement('div')
      t.className = 'nv-kv'
      t.style.marginTop = '4px'
      t.innerHTML = `<span>连出去的边</span><b>${list.length} 条</b>`
      side.appendChild(t)
      const box = document.createElement('div'); box.className = 'nv-edges'
      for (const e of list.slice(0, 60)) {
        const otherId = e.a === n.id ? e.b : e.a
        const other = byId.get(otherId)
        if (!other) continue
        const btn = document.createElement('button')
        btn.className = 'nv-edge'
        btn.innerHTML = `<span class="top"><span style="color:${KIND_COLOR[e.kind] || '#888'}">${KIND_LABEL[e.kind] || e.kind}</span><span style="font-weight:400;color:var(--dsw-alias-label-secondary)">${(other.title || '').slice(0, 22)}</span></span><span class="why">${e.why}</span>`
        btn.onclick = () => { selected = otherId; renderSide(); draw() }
        box.appendChild(btn)
      }
      side.appendChild(box)
    }

    // ---------- 交互 ----------
    let dragging = false, moved = false, lastX = 0, lastY = 0
    function pick(x, y) {
      let best = null, bestD = 13
      for (const n of nodes) {
        const q = screen.get(n.id)
        if (!q) continue
        const d = Math.hypot(q.x - x, q.y - y)
        if (d < bestD) { bestD = d; best = n.id }
      }
      return best
    }

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY
      stage.dataset.drag = '1'
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect()
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
        yaw += dx * 0.008
        pitch += dy * 0.008   // 不设上下限：转到底还想接着转（2026-11-05 15:00 她要的）
        lastX = e.clientX; lastY = e.clientY
        schedule()
        return
      }
      const hv = pick(e.clientX - rect.left, e.clientY - rect.top)
      if (hv !== hover) { hover = hv; schedule() }
    })
    canvas.addEventListener('pointerup', (e) => {
      if (!moved) {
        const rect = canvas.getBoundingClientRect()
        const hit = pick(e.clientX - rect.left, e.clientY - rect.top)
        selected = hit
        renderSide()
        // 2026-11-07 22:2x：选中报给面板——三个视图共用一个选中态，点了个点切到记忆 tab 能对上。
        if (opts.onSelect) { try { opts.onSelect(hit ? hit.id : '') } catch (err) {} }
      }
      dragging = false
      stage.dataset.drag = '0'
      draw()
    })
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      zoom = Math.max(0.55, Math.min(3.2, zoom * (e.deltaY > 0 ? 0.92 : 1.08)))
      schedule()
    }, { passive: false })
    // 双击一个点直接在平面上展开，不用先选中再点按钮
    canvas.addEventListener('dblclick', (e) => {
      const rect = canvas.getBoundingClientRect()
      const hit = pick(e.clientX - rect.left, e.clientY - rect.top)
      if (hit) openPlane(hit)
    })
    reset.onclick = () => { yaw = 0.6; pitch = -0.35; zoom = 1; schedule() }
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      const q = search.value.trim().toLowerCase()
      if (!q) return
      const hit = nodes.find((n) => ((n.title || '') + ' ' + (n.body || '')).toLowerCase().includes(q))
      if (hit) { selected = hit.id; renderSide(); schedule() }
    })

    let raf = 0
    function schedule() {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; draw() })
    }

    const ro = new ResizeObserver(() => { resize(); schedule() })
    ro.observe(stage)
    resize()
    renderSide()
    draw()

    return {
      destroy() {
        ro.disconnect()
        if (raf) cancelAnimationFrame(raf)
        if (plane) {
          if (plane.raf) cancelAnimationFrame(plane.raf)
          if (plane.onKey) document.removeEventListener('keydown', plane.onKey)
          if (plane.ro) plane.ro.disconnect()
          plane = null
        }
        host.innerHTML = ''
      },
      // 2026-11-07 22:2x：selected 存的是**节点对象**，不是 id——老实现直接把传进来的
      // id 赋进去，renderSide 会拿字符串当节点用。改成按 id 找节点，找不到就清空。
      select(id) {
        const n = id ? nodes.find((x) => x.id === id) : null
        selected = n || null
        renderSide(); draw()
      },
      plane(id) { openPlane(id) },
      // ---- top 栏（2026-11-07）：面板外壳通过这三个口子驱动视图，不直接碰内部状态 ----
      setQuery(q) { search.value = String(q || ''); search.dispatchEvent(new Event('input')) },
      setWayFilter(list) {
        const next = new Set((list || []).filter((x) => WAY_KINDS.indexOf(x) >= 0))
        wayOn = next.size ? next : new Set(WAY_KINDS)
        recalcAdj(); draw(); renderSide()
      },
      ways() { return WAY_KINDS.slice() },
      stats() { return { nodes: nodes.length, edges: edges.length, shownEdges: liveEdges().length } },
      snapshot() { return data },
    }
  }

  const api = { mount, layout }
  if (typeof window !== 'undefined') window.__MingNeuronView = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
