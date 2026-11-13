/**
 * dsh-ming-graph —— 记忆关系图 / 记忆神经元（Client 半端）
 *
 * ⚠ 生成物，别手改：改 src/*.js 或各插件的 src/panel.js，然后 `node build.mjs`。
 *   现在是不是最新的：`node build.mjs --check`
 *   build a60f1d2e758f71c9
 *
 * 入口：左侧图标栏一个图标（sidebar.panellist），点开占满主区域（main 面板 key = ming-graph）。
 * 数据来自 Host 半端 /_dsh/dsh-ming-graph/neurons，自己拉、自己画，不经过模型。
 *
 * 一条规矩：每个点都是记忆库里一条真记忆，每条边都带 why（引用 / 共词 / 归属 / 补边四种之一）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-ming-graph',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

/**
 * dsh-ming-ui —— 我们自己那批插件的共用皮（2026-11-07 立）
 *
 * 一条规矩：**只写 --dsw-alias-* token，不写死颜色、不写死 px 颜色值**。
 * 现在宿主是浅色，`dsh-myskin` 换主题时这些面板要跟着变；写死一个 #fff，
 * 深色底下就是一整块白。
 *
 * 为什么是这么个怪文件：各插件的 build.mjs 是「读源码文本 → 拼进 client.js」，
 * 不是真打包。所以这份源码里不能出现 import/export（拼进 CJS 工厂会炸），
 * 写成 IIFE 挂在 MING_UI 上；末尾留一句 module.exports，Node 里也能 require。
 *
 * 用法（插件里）：
 *   const MING_UI = require('./theme.js')   // 或者直接内联，同名变量已在作用域里
 *   style.textContent = MING_UI.css('ming') // 前缀用来避开宿主的同名类
 *   尺寸走 MING_UI.SCALE，颜色走 MING_UI.TOKENS.xxx
 *
 * 这一份是**唯一源**。改这里，然后 `node sync.mjs` 推到各插件的 src/theme.js。
 */
const MING_UI = (() => {
  /** 颜色：全部对到宿主的 alias token。名字按「用在哪」取，不按色值取。 */
  const TOKENS = {
    bg: 'var(--dsw-alias-bg-base)',
    surface: 'var(--dsw-alias-bg-layer-1)',
    surfaceAlt: 'var(--dsw-alias-bg-layer-2)',
    overlay: 'var(--dsw-alias-bg-overlay)',
    border: 'var(--dsw-alias-border-l2)',
    borderSoft: 'var(--dsw-alias-border-l1)',
    borderStrong: 'var(--dsw-alias-border-l3)',
    separator: 'var(--dsw-alias-separator-secondary)',
    text: 'var(--dsw-alias-label-primary)',
    textDim: 'var(--dsw-alias-label-secondary)',
    textFaint: 'var(--dsw-alias-label-tertiary)',
    accent: 'var(--dsw-alias-brand-primary)',
    hover: 'var(--dsw-alias-interactive-bg-hover)',
    active: 'var(--dsw-alias-interactive-bg-active)',
    danger: 'var(--dsw-alias-state-error-primary)',
    warn: 'var(--dsw-alias-state-warn-primary)',
    ok: 'var(--dsw-alias-state-success-primary)',
  }

  /** 尺子：间距/圆角/字号只从这里取，别在组件里现编一个 7px。 */
  const SCALE = {
    gap: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    radius: { sm: 6, md: 10, lg: 14 },
    font: { xs: 11, sm: 12, md: 13, lg: 15, xl: 18, hero: 22 },
    line: 1.55,
  }

  /**
   * 生成一份样式表。prefix 默认 ming，用来避开宿主或其他插件的同名类。
   * 面板骨架只有六个：panel / head / card / row / stat / empty。多一个算我输。
   */
  function css(prefix) {
    const p = prefix || 'ming'
    const S = SCALE
    return `
.${p}-panel {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: ${TOKENS.bg}; color: ${TOKENS.text};
  font-size: ${S.font.md}px; line-height: ${S.line};
}
.${p}-head {
  display: flex; align-items: center; gap: ${S.gap.md}px;
  padding: ${S.gap.md}px ${S.gap.lg}px; border-bottom: 1px solid ${TOKENS.separator};
  flex: 0 0 auto;
}
.${p}-title { font-size: ${S.font.lg}px; font-weight: 600; color: ${TOKENS.text}; }
.${p}-sub { font-size: ${S.font.sm}px; color: ${TOKENS.textFaint}; }
.${p}-body {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  padding: ${S.gap.lg}px; display: flex; flex-direction: column; gap: ${S.gap.md}px;
}
.${p}-card {
  background: ${TOKENS.surface}; border: 1px solid ${TOKENS.borderSoft};
  border-radius: ${S.radius.md}px; padding: ${S.gap.md}px ${S.gap.lg}px;
}
.${p}-row {
  display: flex; align-items: center; gap: ${S.gap.md}px;
  padding: ${S.gap.sm}px ${S.gap.md}px; border-radius: ${S.radius.sm}px;
  border-bottom: 1px solid ${TOKENS.separator};
}
.${p}-row:last-child { border-bottom: none; }
.${p}-row:hover { background: ${TOKENS.hover}; }
.${p}-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.${p}-kpi { font-size: ${S.font.hero}px; font-weight: 600; color: ${TOKENS.text}; letter-spacing: -0.02em; }
.${p}-empty {
  margin: auto; padding: ${S.gap.xl}px; text-align: center;
  color: ${TOKENS.textFaint}; font-size: ${S.font.sm}px;
}
.${p}-pill {
  display: inline-flex; align-items: center; gap: ${S.gap.xs}px;
  padding: 1px 8px; border-radius: 999px; font-size: ${S.font.xs}px;
  background: ${TOKENS.surfaceAlt}; color: ${TOKENS.textDim};
  border: 1px solid ${TOKENS.borderSoft};
}
.${p}-pill[data-tone="ok"] { color: ${TOKENS.ok}; border-color: ${TOKENS.ok}; }
.${p}-pill[data-tone="warn"] { color: ${TOKENS.warn}; border-color: ${TOKENS.warn}; }
.${p}-pill[data-tone="danger"] { color: ${TOKENS.danger}; border-color: ${TOKENS.danger}; }
.${p}-btn {
  font: inherit; font-size: ${S.font.sm}px; cursor: pointer;
  padding: ${S.gap.xs}px ${S.gap.md}px; border-radius: ${S.radius.sm}px;
  background: ${TOKENS.surfaceAlt}; color: ${TOKENS.text};
  border: 1px solid ${TOKENS.border};
}
.${p}-btn:hover { background: ${TOKENS.hover}; }
.${p}-btn:active { background: ${TOKENS.active}; }
.${p}-btn[data-primary="1"] { background: ${TOKENS.accent}; color: #fff; border-color: transparent; }
/* ---- 2026-11-08：页面骨架（页头 + 分区） ----
 * 起因：她说「把这些的 ui 都重新做一下，至少要分清哪一块是哪一块」。
 * 当时每页只有一行小标题，下面全是没名字的卡片，看一眼不知道哪块在说什么。
 * 这一层只加四样：页头（这是哪一页）、分区（这一块叫什么）、数字条、说明脚注。
 * 老类（panel/head/body/card/row/stat/kpi/pill/btn）一个都不删——别的插件还在用。 */
.${p}-page {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: ${TOKENS.bg}; color: ${TOKENS.text};
  font-size: ${S.font.md}px; line-height: 1.6;
}
.${p}-ph {
  display: flex; align-items: center; gap: ${S.gap.md}px;
  padding: ${S.gap.md}px ${S.gap.lg}px; border-bottom: 1px solid ${TOKENS.separator};
  flex: 0 0 auto; background: ${TOKENS.bg};
}
.${p}-ph-ic {
  width: 30px; height: 30px; flex: 0 0 auto; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: ${TOKENS.surfaceAlt}; border: 1px solid ${TOKENS.borderSoft}; color: ${TOKENS.accent};
}
.${p}-ph-tx { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.${p}-ph-t { font-size: 15.5px; font-weight: 650; letter-spacing: .01em; line-height: 1.35; }
.${p}-ph-d { font-size: ${S.font.xs}px; color: ${TOKENS.textFaint}; line-height: 1.5; }
.${p}-ph-a { display: flex; align-items: center; gap: ${S.gap.sm}px; flex: 0 0 auto; }
.${p}-wrap {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  padding: ${S.gap.lg}px ${S.gap.lg}px ${S.gap.xl}px;
  display: flex; flex-direction: column; gap: ${S.gap.lg}px;
  width: 100%; box-sizing: border-box;
}
.${p}-sec {
  border: 1px solid ${TOKENS.borderSoft}; border-radius: 12px;
  background: ${TOKENS.surface}; overflow: hidden; flex: 0 0 auto;
}
.${p}-sec-h {
  display: flex; align-items: center; gap: ${S.gap.sm}px;
  padding: 8px 14px; background: ${TOKENS.surfaceAlt};
  border-bottom: 1px solid ${TOKENS.borderSoft};
}
.${p}-sec-t { font-size: ${S.font.sm}px; font-weight: 600; letter-spacing: .03em; color: ${TOKENS.text}; }
.${p}-sec-n { font-size: ${S.font.xs}px; color: ${TOKENS.textFaint}; margin-left: auto; white-space: nowrap; }
.${p}-sec-b { padding: ${S.gap.md}px 14px; display: flex; flex-direction: column; gap: ${S.gap.sm}px; }
.${p}-sec-b.flush { padding: 0; gap: 0; }
.${p}-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); }
.${p}-kpi-c { padding: 12px 14px; border-left: 1px solid ${TOKENS.separator}; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.${p}-kpi-c:first-child { border-left: none; }
.${p}-kpi-n { font-size: 20px; font-weight: 600; letter-spacing: -.01em; font-variant-numeric: tabular-nums; line-height: 1.25; }
.${p}-kpi-l { font-size: ${S.font.xs}px; color: ${TOKENS.textFaint}; }
.${p}-note { font-size: ${S.font.xs}px; color: ${TOKENS.textFaint}; line-height: 1.65; }
.${p}-list { display: flex; flex-direction: column; }
.${p}-li {
  display: flex; align-items: center; gap: ${S.gap.md}px;
  padding: 9px 14px; border-top: 1px solid ${TOKENS.separator}; min-width: 0;
}
.${p}-li:first-child { border-top: none; }
.${p}-li:hover { background: ${TOKENS.hover}; }
.${p}-li-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.${p}-li-t { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${p}-li-d { font-size: ${S.font.xs}px; color: ${TOKENS.textFaint}; line-height: 1.6; }
.${p}-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.${p}-scroll::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1); border-radius: 4px; }
.${p}-scroll::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l1); }
`
  }

  return { TOKENS, SCALE, css, version: '0.1.0' }
})()

if (typeof module !== 'undefined' && module.exports) module.exports = MING_UI


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
      // 大头多占地方：角半径按 sqrt(占比)
      c.theta = Math.min(0.9, Math.max(0.13, 1.15 * Math.sqrt(c.list.length / total)))
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
    legend.innerHTML = '<span><i style="background:#14b8a6"></i>DSH 记忆</span><span><i style="background:#e0803a"></i>QQ 观察</span><span><i style="background:#5b8def"></i>项目</span><span><i style="background:#e05a8a"></i>人</span>'
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
    const colQq = opts.colorQq || '#e0803a'
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
    const spriteQq = sprite(colQq, SPR)
    const spriteProj = sprite(colProj, SPR)
    const spritePerson = sprite(colPerson, SPR)
    // 2026-11-07：日记（星图时间环用）自己的灰，不然会落进 QQ 那档橙色
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
        const sp = isPerson ? spritePerson : n.kind === 'diary' ? spriteDiary : n.side === 'dsh' ? spriteDsh : n.side === 'qq' ? spriteQq : spriteProj
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
        ctx.fillStyle = isPerson ? colPerson : isProj ? colProj : n.kind === 'diary' ? colDiary : n.side === 'dsh' ? colDsh : colQq
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
      kindRow.innerHTML = '<span>来源</span><b>' + (n.kind === 'project' ? '项目（聚合点）' : n.kind === 'person' ? '人' : n.side === 'dsh' ? 'DSH 归档记忆' : 'QQ 观察') + '</b>'
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
        ctx.fillStyle = n.kind === 'person' ? colPerson : n.kind === 'project' ? colProj : n.side === 'dsh' ? colDsh : colQq
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
      mk('来源', n.kind === 'project' ? '项目（聚合点）' : n.side === 'dsh' ? 'DSH 归档记忆' : 'QQ 观察')
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


/**
 * star-view.js —— 星图视图（银河系 · DOM 版）
 *
 * 2026-11-07 15:00 重写。上一版是 canvas，今天在画布上耗了一小时：投影、尺寸链、RO 抖动，
 * 每一层都能让图变成空白，而且「空白」和「没加载」长得一模一样。13:50 一度退成色块网格。
 *
 * 这一版不碰 canvas：每个点就是一个 div，位置用 translate3d，大小用 scale，
 * 景深用透明度。1271 个 div 的 transform 每帧刷新，比一次 drawImage 稳得多——
 * 画不出来只可能是「没挂上」，不可能是「画错了」。
 *
 * 布局照旧（12:15 那版，她说的「银河系」）：
 *   核心   人 + 项目，亮、密、在正中
 *   旋臂   记忆按第一个 tag 分 5 条 + 杂项，沿对数螺旋铺开，越新越靠外
 *   时间环 最外圈一条淡环，按日期钉日记
 *   雾     三层极淡的径向渐变，撑体积
 * 数据只吃统一节点模型（/neurons/unified）：点开的每个点都能回它自己。
 */
;(function () {
  'use strict'

  const ARM_COLORS = ['#5b8def', '#14b8a6', '#e0803a', '#e05a8a', '#a78bfa', '#8b8f96']
  const KIND_COLOR = { memory: '#14b8a6', diary: '#c9cdd4', person: '#e05a8a', project: '#5b8def' }
  const ARM_COUNT = 8          // 主题臂数量，剩下的进「杂项」
  const CORE_SHARE = 0.12      // 核球占半径的比例
  const DOT = 10               // 每个点的基准边长(px)，真大小靠 scale

  const CSS = `
.svx-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0}
.svx-head{display:flex;align-items:center;gap:10px;padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-separator-secondary)}
.svx-head .sp{flex:1}
.svx-legend{display:flex;gap:10px;align-items:center;font-size:11.5px;opacity:.85}
.svx-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.svx-body{flex:1;min-height:0;display:flex}
.svx-stage{flex:1;min-width:0;position:relative;overflow:hidden;cursor:grab;user-select:none;-webkit-user-select:none}
.svx-stage.drag{cursor:grabbing}
.svx-fog{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none}
.svx-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.svx-dot{position:absolute;left:0;top:0;width:${DOT}px;height:${DOT}px;border-radius:50%;pointer-events:none;will-change:transform,opacity}
.svx-dot.sel{outline:1px solid var(--dsw-alias-label-primary);outline-offset:2px}
.svx-arm-label{position:absolute;user-select:none;font-size:11px;transform:translate(-50%,0);pointer-events:none;white-space:nowrap;opacity:.85}
.svx-core-label{position:absolute;font-size:11px;color:var(--dsw-alias-label-tertiary);transform:translate(-50%,0);pointer-events:none;white-space:nowrap;opacity:.8}
.svx-side{width:280px;flex:0 0 280px;border-left:1px solid var(--dsw-alias-separator-secondary);overflow:auto;padding:10px 12px;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}
.svx-side h4{margin:0 0 6px;font-size:13px;color:var(--dsw-alias-label-primary);font-weight:600}
.svx-side .d{color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-bottom:8px}
.svx-side .b{white-space:pre-wrap;word-break:break-word}
.svx-side .empty{color:var(--dsw-alias-label-tertiary);font-size:12px}
.svx-side .arm{margin-top:10px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.svx-side .arm i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}
`

  // 稳定哈希：同一个 id 每次都落同一条臂、同一个亮度
  function hash(s) {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    return (h >>> 0)
  }

  function mount(host, data, opts) {
    opts = opts || {}
    if (!host) return { destroy() {} }
    host.innerHTML = ''
    const root = document.createElement('div'); root.className = 'svx-root'
    const style = document.createElement('style'); style.textContent = CSS
    root.appendChild(style)

    const nodes = (data && data.nodes) || []
    const stat = (data && data.stats) || {}

    // ---------- 头 ----------
    const head = document.createElement('div'); head.className = 'svx-head'
    const title = document.createElement('span')
    const chN = stat.chapters || nodes.filter((n) => n.chapter).length || 0
    const diaryN = stat.diaries || nodes.filter((n) => n.kind === 'diary').length
    title.textContent = `星图 · ${stat.unified || nodes.length} 个节点 · ${chN} 章 · ${diaryN} 篇日记`
    const sp = document.createElement('span'); sp.className = 'sp'
    const hint = document.createElement('span'); hint.textContent = '拖动转 · 滚轮缩放 · 点一颗看原话'; hint.style.opacity = '0.7'
    const lg = document.createElement('span'); lg.className = 'svx-legend'
    lg.innerHTML = '<span><i style="background:#14b8a6"></i>记忆</span><span><i style="background:#e05a8a"></i>人</span><span><i style="background:#5b8def"></i>项目</span><span><i style="background:#c9cdd4"></i>日记</span>'
    head.appendChild(title); head.appendChild(sp); head.appendChild(hint); head.appendChild(lg)

    // ---------- 体 ----------
    const body = document.createElement('div'); body.className = 'svx-body'
    const stage = document.createElement('div'); stage.className = 'svx-stage'
    const side = document.createElement('aside'); side.className = 'svx-side'
    side.innerHTML = '<div class="empty">点一颗星看原话。</div>'
    body.appendChild(stage); body.appendChild(side)
    root.appendChild(head); root.appendChild(body)
    host.appendChild(root)

    // 雾（静态，三层）：撑出「有东西在那里」的体积
    for (const k of [0.95, 0.62, 0.34]) {
      const f = document.createElement('div'); f.className = 'svx-fog'
      const d = Math.round(k * 100)
      f.style.width = d + '%'; f.style.height = d + '%'
      f.style.background = 'radial-gradient(closest-side, rgba(160,160,180,.055), rgba(160,160,180,0))'
      stage.appendChild(f)
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'svx-svg')
    stage.appendChild(svg)
    const armPaths = []
    const ringEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
    ringEl.setAttribute('fill', 'none')
    ringEl.setAttribute('stroke', 'rgba(150,150,170,.13)')
    ringEl.setAttribute('stroke-width', '1')
    ringEl.style.display = 'none'
    svg.appendChild(ringEl)

    // ---------- 分臂 ----------
    const memories = nodes.filter((n) => n.kind === 'memory')
    const cores = nodes.filter((n) => n.kind === 'person' || n.kind === 'project')
    const diaries = nodes.filter((n) => n.kind === 'diary')

    // 2026-11-07 18:2x：分臂只用章。上一版[有章用章、没章用来源]，结果一条臂叫[第4章 机器]、
    // 旁边一条叫[深水区]，同一张图上两套尺子。没章的进[未分章]，跟记忆卡那边一样不硬塞。
    const keyOf = (n) => (n.chapter ? ('第' + n.chapter + '章 ' + (n.chapterName || '')) : '未分章')
    const tagCount = new Map()
    for (const n of memories) {
      const t = keyOf(n)
      tagCount.set(t, (tagCount.get(t) || 0) + 1)
    }
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, ARM_COUNT).map(([t]) => t)
    const armOf = new Map()
    for (const n of memories) {
      const t = keyOf(n)
      armOf.set(n.id, topTags.indexOf(t) >= 0 ? t : '杂项')
    }
    const armNames = topTags.concat(memories.some((n) => armOf.get(n.id) === '杂项') ? ['杂项'] : [])
    const armIndex = new Map(armNames.map((t, i) => [t, i]))
    const armColor = (name) => ARM_COLORS[(armIndex.get(name) || 0) % ARM_COLORS.length]

    const buckets = new Map(armNames.map((r) => [r, []]))
    for (const n of memories) {
      const k = armOf.get(n.id)
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(n)
    }
    for (const [, list] of buckets) list.sort((a, b) => ((a.at || 0) - (b.at || 0)))

    let W = 0, H = 0, cx = 0, cy = 0, R = 0
    let yaw = 0.4
    let pitch = 0.16          // 上下点头：往上拖 = 从上往下看
    let zoom = 1
    let hover = null
    let selected = null
    const pos = new Map()
    const dotEl = new Map()

    // 先建点：1271 个 div 一次性 append，之后只改 style，不再增删
    const frag = document.createDocumentFragment()
    for (const n of nodes) {
      const el = document.createElement('i')
      el.className = 'svx-dot'
      el.setAttribute('data-id', n.id)
      el.style.opacity = '0.5'
      dotEl.set(n.id, el)
      frag.appendChild(el)
    }
    stage.appendChild(frag)

    const armLabels = new Map()
    function armLabel(name) {
      let el = armLabels.get(name)
      if (!el) {
        el = document.createElement('div')
        el.className = 'svx-arm-label'
        el.textContent = String(name).replace(/^群 · /, '').slice(0, 12)
        stage.appendChild(el)
        armLabels.set(name, el)
      }
      return el
    }

    const coreLabel = document.createElement('div')
    coreLabel.className = 'svx-core-label'
    stage.appendChild(coreLabel)

    function measure() {
      const r = stage.getBoundingClientRect()
      let w = Math.floor(r.width), h = Math.floor(r.height)
      // 零尺寸保护：刚挂上、或父级还在 display:none 时量到 0。
      // 不在这里报错，退回一个能看的默认尺寸，RO 下一帧会修正。
      if (w < 40) w = Math.max(320, host.clientWidth || 0) || 720
      if (h < 40) h = Math.max(240, host.clientHeight || 0) || 520
      W = w; H = h
      cx = W / 2; cy = H / 2
      R = Math.min(W, H) * 0.46
    }

    function layout() {
      pos.clear()
      const coreR = R * CORE_SHARE
      cores.forEach((n, i) => {
        const a = i * 2.39996
        const rr = coreR * Math.sqrt((i + 0.5) / Math.max(1, cores.length))
        pos.set(n.id, { x: Math.cos(a) * rr, y: Math.sin(a) * rr * 0.55, z: 0, r: 2.6, node: n, arm: -1 })
      })

      const inner = R * CORE_SHARE * 1.25
      const outer = R * 0.95
      armNames.forEach((name, ai) => {
        const list = buckets.get(name) || []
        const start = (ai / Math.max(1, armNames.length)) * Math.PI * 2
        const span = Math.PI * 1.45
        const n = list.length || 1
        list.forEach((node, i) => {
          const t = n <= 1 ? 0.5 : (i + 0.5) / n
          const theta = start + t * span
          const jitter = (hash(node.id) % 1000) / 1000 - 0.5
          const rr = inner + (outer - inner) * Math.pow(t, 0.85) + jitter * R * 0.05
          const x = Math.cos(theta) * rr
          const y = Math.sin(theta) * rr * 0.55 + jitter * R * 0.02
          const z = ((hash(node.id + 'z') % 1000) / 1000 - 0.5) * 0.55
          pos.set(node.id, { x, y, z, r: 1.7, node, arm: ai, t })
        })
      })

      const sorted = diaries.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1))
      const ringR = outer * 1.06
      sorted.forEach((d, i) => {
        const a = (i / Math.max(1, sorted.length)) * Math.PI * 2 - Math.PI / 2
        pos.set(d.id, { x: Math.cos(a) * ringR, y: Math.sin(a) * ringR * 0.55, z: 0.6, r: 2.2, node: d, arm: -2 })
      })
    }

    function project(p) {
      const cy1 = Math.cos(yaw), sy1 = Math.sin(yaw)
      const cp = Math.cos(pitch), sp = Math.sin(pitch)
      // 先绕竖轴转（左右拖）
      const x1 = p.x * cy1 - p.z * R * 0.35 * sy1
      const z1 = p.x * sy1 + p.z * R * 0.35 * cy1
      // 再绕横轴点头（上下拖）：2026-11-07 18:2x 加，她说不能上下转
      const y2 = p.y * cp - z1 * sp
      const z2 = p.y * sp + z1 * cp
      const s = 1 + z2 / (R * 4)
      return { x: cx + x1 * zoom, y: cy + (y2 + z2 * 0.12) * zoom, s, z: z2 }
    }

    let raf = 0
    function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(false) }) }

    // full=false：只挪位置（拖动中用）；full=true：连透明度/大小/颜色一起刷
    function paint(full) {
      if (!W) measure()
      for (const [id, p] of pos) {
        const el = dotEl.get(id)
        if (!el) continue
        const q = project(p)
        const depth = Math.max(0, Math.min(1, 0.45 + (q.z / (R * 0.9)) * 0.9 + 0.45))
        const isSel = selected && selected.id === id
        const isHov = hover && hover.id === id
        const rad = (p.r + (isSel || isHov ? 2.4 : 0)) * (0.75 + depth * 0.5) * zoom
        const k = Math.max(0.35, rad / (DOT / 2))
        el.style.transform = 'translate3d(' + (q.x - DOT / 2).toFixed(1) + 'px,' + (q.y - DOT / 2).toFixed(1) + 'px,0) scale(' + k.toFixed(2) + ')'
        if (full) {
          el.style.opacity = (0.35 + depth * 0.6).toFixed(2)
          const tag = p.arm + '|' + (isSel ? 1 : 0) + '|' + (isHov ? 1 : 0)
          if (el.__painted !== tag) {
            el.__painted = tag
            el.style.background = p.node.kind === 'memory' && p.arm >= 0
              ? armColor(armOf.get(id))
              : (KIND_COLOR[p.node.kind] || '#888')
            el.className = 'svx-dot' + (isSel ? ' sel' : '')
          }
        }
      }

      // 2026-11-07 19:4x：这一段原来是 if(full)，于是拖动时标签和旋臂线留在原地不动。
      // 位置类的更新每帧都要跑；只有颜色/透明度那类才需要 full。
      {
        // 旋臂描边
        armNames.forEach((name, ai) => {
          const pts = (buckets.get(name) || []).map((n) => pos.get(n.id)).filter(Boolean).map(project)
          let d = ''
          pts.forEach((q, i) => { d += (i ? 'L' : 'M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1) })
          let path = armPaths[ai]
          if (!path) {
            path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.setAttribute('fill', 'none')
            path.setAttribute('stroke-width', '1')
            path.setAttribute('stroke', armColor(name))
            path.setAttribute('opacity', '0.12')
            svg.insertBefore(path, ringEl)
            armPaths[ai] = path
          }
          path.setAttribute('d', d)
        })
        // 时间环
        if (diaries.length) {
          ringEl.style.display = ''
          ringEl.setAttribute('cx', String(cx)); ringEl.setAttribute('cy', String(cy))
          ringEl.setAttribute('rx', String(R * 0.95 * 1.06 * zoom))
          ringEl.setAttribute('ry', String(R * 0.95 * 1.06 * 0.55 * zoom))
        }
        armNames.forEach((name) => {
          const list = buckets.get(name) || []
          const el = armLabel(name)
          const last = list[list.length - 1]
          if (!last || !pos.get(last.id)) { el.style.display = 'none'; return }
          const q = project(pos.get(last.id))
          el.style.display = ''
          el.style.left = q.x.toFixed(0) + 'px'
          el.style.top = (q.y - 14).toFixed(0) + 'px'
          el.style.color = armColor(name)
        })
        coreLabel.textContent = '核心 · 人与项目 ' + cores.length
        coreLabel.style.left = cx + 'px'
        coreLabel.style.top = (cy + R * CORE_SHARE * 0.75 + 14) + 'px'
        stage.setAttribute('data-dots', String(pos.size))
      }
    }

    function relayout() {
      measure()
      layout()
      paint(true)
    }

    function pick(mx, my) {
      let best = null, bd = 26 * 26
      for (const [, p] of pos) {
        const q = project(p)
        const dx = q.x - mx, dy = q.y - my
        const d = dx * dx + dy * dy
        if (d < bd) { bd = d; best = p }
      }
      return best
    }

    function renderSide() {
      if (!selected) { side.innerHTML = '<div class="empty">点一颗星看原话。</div>'; return }
      // 2026-11-07 18:2x：selected 存的是节点本身，不是 pos 项。上一版这里取 selected.node，
      // 结果是 undefined，侧栏一选中就抛错、什么都没显示——她说的[没有对应的话]就是这个。
      const n = (selected && selected.node) ? selected.node : selected
      const ch = n.chapterName ? `第${n.chapter}章 · ${n.chapterName}` : '未分章'
      const armName = n.kind === 'memory' ? (armOf.get(n.id) || '') : (n.kind === 'diary' ? '时间环' : '核心')
      side.innerHTML = ''
      const h4 = document.createElement('h4'); h4.textContent = n.title || '(无标题)'
      const d = document.createElement('div'); d.className = 'd'
      d.textContent = [n.date || '', ch, n.source].filter(Boolean).join(' · ')
      const b = document.createElement('div'); b.className = 'b'
      b.textContent = String(n.body || n.excerpt || '').slice(0, 1600)
      side.appendChild(h4); side.appendChild(d); side.appendChild(b)
      if (armName) {
        const a = document.createElement('div'); a.className = 'arm'
        a.innerHTML = '<i style="background:' + (n.kind === 'memory' ? armColor(armName) : (KIND_COLOR[n.kind] || '#888')) + '"></i>' + armName
        side.appendChild(a)
      }
    }

    // ---------- 交互 ----------
    let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, movedPx = 0
    stage.addEventListener('pointerdown', (ev) => {
      ev.preventDefault()
      dragging = true; lastX = ev.clientX; lastY = ev.clientY
      downX = ev.clientX; downY = ev.clientY; movedPx = 0
      stage.classList.add('drag')
      try { stage.setPointerCapture(ev.pointerId) } catch (e) {}
    })
    stage.addEventListener('pointermove', (ev) => {
      const r = stage.getBoundingClientRect()
      if (dragging) {
        yaw += (ev.clientX - lastX) * 0.006
        pitch = Math.max(-1.15, Math.min(1.15, pitch + (ev.clientY - lastY) * 0.005))
        movedPx += Math.abs(ev.clientX - lastX) + Math.abs(ev.clientY - lastY)
        lastX = ev.clientX; lastY = ev.clientY
        schedule()
        return
      }
      const p = pick(ev.clientX - r.left, ev.clientY - r.top)
      const id = p ? p.node.id : null
      const cur = hover ? hover.id : null
      if (id !== cur) { hover = p ? p.node : null; paint(true) }
      stage.style.cursor = p ? 'pointer' : 'grab'
    })
    function endDrag(ev) {
      if (!dragging) return
      dragging = false; stage.classList.remove('drag')
      // 没怎么动 = 点击：选最近的一颗星（原来靠 click 事件，拖动时会被一起触发，改在这里判）
      if (movedPx < 6 && ev) {
        const r = stage.getBoundingClientRect()
        const p = pick(ev.clientX - r.left, ev.clientY - r.top)
        if (p) { selected = p.node; renderSide() }
      }
      paint(true)
    }
    stage.addEventListener('pointerup', endDrag)
    stage.addEventListener('pointercancel', endDrag)
    stage.addEventListener('pointerleave', endDrag)

    stage.addEventListener('click', (ev) => {
      const r = stage.getBoundingClientRect()
      const p = pick(ev.clientX - r.left, ev.clientY - r.top)
      if (!p) return
      selected = p.node
      renderSide()
      paint(true)
      // 2026-11-07 21:4x：把「我正在看哪一条」报给面板。
      // 之前星图点一颗星，只有星图自己知道；切到记忆 tab 列表还在原地，两边对不上同一条。
      if (opts.onSelect) { try { opts.onSelect(p.node.id) } catch (e) {} }
    })

    stage.addEventListener('wheel', (ev) => {
      ev.preventDefault()
      zoom = Math.max(0.45, Math.min(2.8, zoom * (ev.deltaY > 0 ? 0.92 : 1.08)))
      paint(true)
    }, { passive: false })

    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => relayout())
      ro.observe(stage)
    }
    relayout()
    // 再补一次：从 display:none 切过来时第一次量到的可能是 0
    setTimeout(() => { try { relayout() } catch (e) {} }, 60)

    // 切回星图时对齐到面板记着的那一条（opts.initialId 由 panel 传进来）
    if (opts.initialId) {
      const p0 = pos.get(opts.initialId)
      if (p0) { selected = p0.node; renderSide(); paint(true) }
    }

    return {
      destroy() { try { if (ro) ro.disconnect() } catch (e) {} host.innerHTML = '' },
      stats() {
        return {
          nodes: pos.size, arms: armNames.length, arms_detail: armNames,
          cores: cores.length, diaries: diaries.length, zoom,
          size: [W, H], dots: stage.querySelectorAll('.svx-dot').length,
        }
      },
      focus(id) { const p = pos.get(id); if (p) { selected = p.node; renderSide(); paint(true) } },
      // 给顶部搜索用：命中第一条就选中它
      find(text) {
        const t = String(text || '').trim().toLowerCase()
        if (!t) return null
        for (const [, p] of pos) {
          const n = p.node
          if (String(n.title || '').toLowerCase().indexOf(t) >= 0 ||
              String(n.body || n.excerpt || '').toLowerCase().indexOf(t) >= 0) {
            selected = n; renderSide(); paint(true)
            return n
          }
        }
        return null
      },
    }
  }

  const api = { mount }
  if (typeof window !== 'undefined') window.__MingStarView = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()


const INTEREST_API = '/_dsh/dsh-ming-interest'

function fmtAgo(ms) {
  if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) < 0) return '—'
  const m = Math.floor(Number(ms) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

function InterestPanel() {
  const [data, setData] = useState(null)
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [topicName, setTopicName] = useState('')
  const [topicKeywords, setTopicKeywords] = useState('')
  const [muteWord, setMuteWord] = useState('')

  const load = useCallback(() => {
    setBusy(true)
    setError('')
    return fetch(INTEREST_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (!d || d.error || d.ok === false) throw new Error((d && d.error) || '读取失败')
        setData(d)
        setSettings(Object.assign({
          observeEnabled: true, observePrivate: true, autoCreateSession: true,
          observeGroups: [], groups: [], minGapMinutes: 20, maxPerHour: 3,
          quietHours: '01:00-08:00', minChars: 6, contextLines: 4,
          pendingMax: 100, pendingTtlMinutes: 30,
        }, d.settings || {}))
      })
      .catch((e) => setError(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const post = useCallback((path, body) => fetch(INTEREST_API + '/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => {
    const d = await r.json()
    if (!r.ok || d.ok === false) throw new Error((d && (d.error || d.message)) || ('HTTP ' + r.status))
    return d
  }), [])

  const update = useCallback((body) => {
    setSaving(true); setError(''); setNotice('')
    return post('update', body)
      .then((d) => { setNotice(d.message || '已更新'); return load() })
      .catch((e) => setError(String((e && e.message) || e)))
      .finally(() => setSaving(false))
  }, [load, post])

  const saveSettings = useCallback(() => {
    if (!settings) return
    const observeText = settings.observeGroupsText !== undefined ? settings.observeGroupsText : (settings.observeGroups || []).join('\n')
    const groupsText = settings.groupsText !== undefined ? settings.groupsText : (settings.groups || []).join('\n')
    const next = Object.assign({}, settings, {
      observeGroups: String(observeText).split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
      groups: String(groupsText).split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
    })
    delete next.observeGroupsText
    delete next.groupsText
    setSaving(true); setError(''); setNotice('')
    post('settings', next)
      .then((d) => {
        setSettings(Object.assign({}, d.settings, {
          observeGroupsText: (d.settings.observeGroups || []).join('\n'),
          groupsText: (d.settings.groups || []).join('\n'),
        }))
        setNotice('设置已保存；观察与唤醒策略会在下一轮轮询生效。')
        return load()
      })
      .catch((e) => setError(String((e && e.message) || e)))
      .finally(() => setSaving(false))
  }, [settings, post, load])

  const patchSetting = (key, value) => setSettings((old) => Object.assign({}, old || {}, { [key]: value }))
  const off = !!(data && data.state && data.state.off)
  const st = (data && data.state) || {}
  const topics = (data && data.topics) || []
  const candidates = (data && data.candidates) || []
  const mute = (data && data.mute) || []
  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)',
    color: 'var(--dsw-alias-label-primary)', font: 'inherit', minWidth: 0,
  }
  const labelStyle = { display: 'block', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 5 }
  const field = (label, key, opts = {}) => h('label', { style: { display: 'block', minWidth: 0 } },
    h('span', { style: labelStyle }, label),
    h('input', {
      style: inputStyle, type: opts.type || 'number', min: opts.min, max: opts.max,
      value: settings ? settings[key] : '',
      onChange: (e) => patchSetting(key, opts.type === 'text' ? e.target.value : Number(e.target.value)),
    }))
  const toggleField = (label, key, help) => h('label', {
    style: { display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 0', cursor: 'pointer' },
  },
    h('input', {
      type: 'checkbox', checked: !!(settings && settings[key]),
      onChange: (e) => patchSetting(key, e.target.checked), style: { marginTop: 3 },
    }),
    h('span', null,
      h('span', { style: { display: 'block', fontSize: 13 } }, label),
      help ? h('span', { style: { display: 'block', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, help) : null))
  const section = (title, sub, ...body) => h('section', {
    className: 'ming-sec', style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, overflow: 'hidden' },
  },
    h('div', { className: 'ming-sec-h' },
      h('span', { className: 'ming-sec-t' }, title),
      sub ? h('span', { className: 'ming-sec-n' }, sub) : null),
    h('div', { className: 'ming-sec-b' }, ...body))
  const button = (text, fn, disabled, primary) => h('button', {
    className: 'ming-btn', onClick: fn, disabled: !!disabled,
    'data-primary': primary ? '1' : undefined,
  }, text)

  const topicAdd = () => {
    const name = topicName.trim()
    if (!name) { setError('请先填写兴趣名称。'); return }
    const keywords = topicKeywords.split(/[,\n，、]/).map((x) => x.trim()).filter(Boolean)
    update({ action: 'add', name, keywords: keywords.length ? keywords : [name], reason: '由设置面板手动加入' })
      .then(() => { setTopicName(''); setTopicKeywords('') })
  }

  if (!settings) return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-empty' }, error || '正在读取兴趣设置…'),
    button('重新读取', load, busy))
  
  const settingsWithText = Object.assign({}, settings, {
    observeGroupsText: settings.observeGroupsText !== undefined ? settings.observeGroupsText : (settings.observeGroups || []).join('\n'),
    groupsText: settings.groupsText !== undefined ? settings.groupsText : (settings.groups || []).join('\n'),
  })

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(InterestIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '兴趣与观察'),
        h('div', { className: 'ming-ph-d' }, '管理共同记忆观察范围、兴趣候选，以及自主参与频率')),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill', 'data-tone': off ? 'danger' : 'ok' }, off ? '自主参与暂停' : '自主参与开启'),
        button(off ? '恢复参与' : '暂停参与', () => {
          setSaving(true); post('toggle').then(load).catch((e) => setError(String(e))).finally(() => setSaving(false))
        }, saving),
        button(busy ? '读取中…' : '刷新', load, busy))),
    h('div', { className: 'ming-wrap ming-scroll' },
      error ? h('div', { className: 'ming-note', style: { color: 'var(--dsw-alias-state-error-primary)' } }, '⚠ ' + error) : null,
      notice ? h('div', { className: 'ming-note', style: { color: 'var(--dsw-alias-state-success-primary)' } }, notice) : null,

      section('运行状态', '共享记忆观察与自主参与是两条独立路径',
        h('div', { className: 'ming-kpis' },
          h('div', { className: 'ming-kpi-c' }, h('span', { className: 'ming-kpi-n' }, String(st.observed || 0)), h('span', { className: 'ming-kpi-l' }, '本次运行观察消息')),
          h('div', { className: 'ming-kpi-c' }, h('span', { className: 'ming-kpi-n' }, String(st.pending || 0)), h('span', { className: 'ming-kpi-l' }, '待处理候选')),
          h('div', { className: 'ming-kpi-c' }, h('span', { className: 'ming-kpi-n' }, String(st.wakesLastHour || 0) + ' / ' + String(st.maxPerHour || 0)), h('span', { className: 'ming-kpi-l' }, '过去一小时参与次数')),
          h('div', { className: 'ming-kpi-c' }, h('span', { className: 'ming-kpi-n' }, st.sinceWakeMs ? fmtAgo(st.sinceWakeMs) : '—'), h('span', { className: 'ming-kpi-l' }, '距上次参与'))),
        h('div', { className: 'ming-note' }, st.skip || '目前没有阻止参与的原因'),
        h('div', { className: 'ming-note' }, '状态更新时间：' + (st.at || '—'))),

      section('跨频道观察', '写入共享记忆；不会把消息转发到其他群',
        toggleField('启用被动观察', 'observeEnabled', '关闭后停止从 inbox 导入未进入正常 Agent 回合的消息。'),
        toggleField('同时观察私讯', 'observePrivate', '开启后，QQ／Discord 私讯也能进入同一份共享记忆。'),
        toggleField('自动恢复或建立群会话', 'autoCreateSession', '只影响自主参与时的目标会话，不会自动跨群发言。'),
        h('label', { style: { display: 'block', marginTop: 8 } },
          h('span', { style: labelStyle }, '观察群组白名单（每行一个群组 ID；留空＝观察所有群组）'),
          h('textarea', {
            rows: 3, value: settingsWithText.observeGroupsText, style: Object.assign({}, inputStyle, { resize: 'vertical' }),
            onChange: (e) => patchSetting('observeGroupsText', e.target.value),
          })),
        h('div', { className: 'ming-note' }, '若要让不同频道都能共享记忆，观察白名单建议留空。')),

      section('自主参与规则', '命中兴趣后才会考虑接话；暂停参与不影响上方观察',
        h('label', { style: { display: 'block' } },
          h('span', { style: labelStyle }, '参与群组白名单（每行一个群组 ID；留空＝所有群组都可参与）'),
          h('textarea', {
            rows: 3, value: settingsWithText.groupsText, style: Object.assign({}, inputStyle, { resize: 'vertical' }),
            onChange: (e) => patchSetting('groupsText', e.target.value),
          })),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 } },
          field('两次参与最少间隔（分钟）', 'minGapMinutes', { min: 1, max: 1440 }),
          field('每小时最多参与次数', 'maxPerHour', { min: 0, max: 60 }),
          field('最短消息长度', 'minChars', { min: 1, max: 500 }),
          field('唤醒时附带上下文条数', 'contextLines', { min: 0, max: 20 }),
          field('候选队列上限', 'pendingMax', { min: 10, max: 500 }),
          field('候选保留时间（分钟）', 'pendingTtlMinutes', { min: 1, max: 240 })),
        h('label', { style: { display: 'block' } },
          h('span', { style: labelStyle }, '静默时段（本机时间，格式 HH:MM-HH:MM；留空表示不静默）'),
          h('input', { type: 'text', value: settings.quietHours || '', style: inputStyle,
            onChange: (e) => patchSetting('quietHours', e.target.value) }))),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        button(saving ? '保存中…' : '保存观察与参与设置', saveSettings, saving, true)),

      section('主动兴趣', topics.length + ' 项',
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8 } },
          h('label', null, h('span', { style: labelStyle }, '兴趣名称'),
            h('input', { value: topicName, onChange: (e) => setTopicName(e.target.value), placeholder: '例如：Windows 系统优化', style: inputStyle })),
          h('label', null, h('span', { style: labelStyle }, '关键词（逗号分隔，可留空）'),
            h('input', { value: topicKeywords, onChange: (e) => setTopicKeywords(e.target.value), placeholder: 'Windows, 驱动, 注册表', style: inputStyle }))),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 8 } }, button('加入主动兴趣', topicAdd, saving, true)),
        topics.length ? topics.map((t, i) => h('div', {
          key: t.name || i, style: { borderTop: '1px solid var(--dsw-alias-separator-secondary)', padding: '10px 0' },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('strong', null, t.name || '(未命名)'),
            h('span', { className: 'ming-note', style: { marginLeft: 'auto' } }, (t.keywords || []).length + ' 个关键词'),
            button('移除', () => update({ action: 'remove', name: t.name }), saving)),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 } },
            (t.keywords || []).map((k, j) => h('span', { key: j, className: 'ming-pill' }, k))),
          t.reason ? h('div', { className: 'ming-note' }, '原因：' + t.reason) : null,
          (t.evidence || []).slice(-3).map((e, j) => h('div', { key: j, className: 'ming-note' },
            '证据：' + String(e.summary || '') + (e.source ? ' · ' + e.source : ''))))
        ) : h('div', { className: 'ming-empty' }, '还没有主动兴趣。AI 可以在持续探索某个主题后自行加入。')),

      section('待确认兴趣', candidates.length + ' 项；不确定时先放这里',
        candidates.length ? candidates.map((t, i) => h('div', {
          key: t.name || i, style: { borderBottom: '1px solid var(--dsw-alias-separator-secondary)', padding: '10px 0' },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('strong', null, t.name || '(未命名)'),
            h('span', { className: 'ming-note', style: { marginLeft: 'auto' } }, (t.keywords || []).join('、')),
            button('确认加入', () => update({ action: 'accept', name: t.name }), saving, true),
            button('拒绝', () => update({ action: 'reject', name: t.name }), saving)),
          t.reason ? h('div', { className: 'ming-note' }, '原因：' + t.reason) : null,
          (t.evidence || []).map((e, j) => h('div', { key: j, className: 'ming-note' },
            '证据：' + String(e.summary || '') + (e.source ? ' · ' + e.source : ''))))
        ) : h('div', { className: 'ming-empty' }, '目前没有待确认项目。')),

      section('忽略关键词', '出现这些词时，该消息不参与兴趣匹配',
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { value: muteWord, onChange: (e) => setMuteWord(e.target.value), placeholder: '输入要忽略的词', style: inputStyle }),
          button('加入', () => {
            if (!muteWord.trim()) return
            update({ action: 'mute', word: muteWord.trim() }).then(() => setMuteWord(''))
          }, saving)),
        mute.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } },
          mute.map((w, i) => h('span', { key: w, className: 'ming-pill', style: { display: 'inline-flex', gap: 5, alignItems: 'center' } },
            w, h('button', { onClick: () => update({ action: 'unmute', word: w }), title: '移除忽略词', style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' } }, '×'))))
          : h('div', { className: 'ming-empty' }, '没有忽略关键词。'))
    )
  )
}

function InterestIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('circle', { cx: 12, cy: 12, r: 3 }),
    h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' }))
}


const DISCORD_API = '/_dsh/dsh-ming-discord'

function DiscordPanel() {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setError('')
    return fetch(DISCORD_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (!d || d.ok === false) throw new Error((d && d.error) || '讀取 Discord 設定失敗')
        setData(d)
        const s = d.settings || {}
        setDraft({
          mentionRequired: s.mentionRequired !== false,
          directMessages: s.directMessages !== false,
          observeUnmentioned: s.observeUnmentioned !== false,
          allowedGuildIdsText: (s.allowedGuildIds || []).join('\\n'),
          allowedChannelIdsText: (s.allowedChannelIds || []).join('\\n'),
          allowedUserIdsText: (s.allowedUserIds || []).join('\\n'),
          newMessagePolicy: s.newMessagePolicy || 'steer',
          maxAttachmentMB: Math.round((Number(s.maxAttachmentBytes) || 10485760) / 1048576),
        })
      })
      .catch((e) => setError(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const set = (key, value) => setDraft((old) => old ? Object.assign({}, old, { [key]: value }) : old)
  const save = useCallback(() => {
    if (!draft || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    const ids = (value) => String(value || '').split(/\r?\n|[,;]/).map((x) => x.trim()).filter(Boolean)
    const body = {
      mentionRequired: draft.mentionRequired,
      directMessages: draft.directMessages,
      observeUnmentioned: draft.observeUnmentioned,
      allowedGuildIds: ids(draft.allowedGuildIdsText),
      allowedChannelIds: ids(draft.allowedChannelIdsText),
      allowedUserIds: ids(draft.allowedUserIdsText),
      newMessagePolicy: draft.newMessagePolicy,
      maxAttachmentBytes: Math.max(1, Math.min(50, Number(draft.maxAttachmentMB) || 10)) * 1048576,
    }
    return fetch(DISCORD_API + '/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => { if (!r.ok || !d.ok) throw new Error((d && d.error) || '儲存失敗'); return d }))
      .then(() => { setNotice('設定已儲存，新的 Discord 訊息會立即套用。'); return load() })
      .catch((e) => setError(String((e && e.message) || e)))
      .finally(() => setSaving(false))
  }, [draft, saving, load])

  const toggle = (key, title, detail) => h('label', {
    className: 'ming-row',
    style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', cursor: 'pointer' },
  },
    h('input', {
      type: 'checkbox',
      checked: Boolean(draft && draft[key]),
      onChange: (e) => set(key, e.target.checked),
      style: { marginTop: 4 },
    }),
    h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      h('strong', null, title),
      h('span', { className: 'ming-note' }, detail),
    ),
  )

  const area = (key, title, hint) => h('label', { style: { display: 'block', marginTop: 12 } },
    h('div', { style: { fontWeight: 600, marginBottom: 5 } }, title),
    h('div', { className: 'ming-note', style: { marginBottom: 6 } }, hint),
    h('textarea', {
      value: draft ? draft[key] : '',
      onChange: (e) => set(key, e.target.value),
      rows: 3,
      spellCheck: false,
      placeholder: '每行一個 Discord ID；留空代表不限制',
      style: { width: '100%', minHeight: 76, resize: 'vertical', boxSizing: 'border-box' },
    }),
  )

  const status = data ? ({
    connected: '已連線',
    connecting: '連線中',
    starting: '準備啟動',
    disabled: '插件已停用',
    'missing-token': '缺少 Bot Token',
    error: '連線失敗',
  }[data.status] || data.status || '未知') : '讀取中…'

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
          h('path', { d: 'M4 5h16v11H8l-4 4V5z' }),
          h('path', { d: 'M8 9h8M8 12h5' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, 'Discord'),
        h('div', { className: 'ming-ph-d' }, '頻道接收、回覆條件與安全範圍'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, status),
        h('button', { className: 'ming-btn', onClick: load, disabled: busy }, busy ? '讀取中…' : '重新讀取'),
      ),
    ),
    h('div', { className: 'ming-wrap ming-scroll' },
      error ? h('div', { className: 'ming-empty' }, '△ ' + error) : null,
      notice ? h('div', { className: 'ming-note', style: { padding: 9, marginBottom: 10 } }, notice) : null,
      data && data.tokenPresent === false ? h('div', { className: 'ming-empty' }, '尚未讀取到 DISCORD_BOT_TOKEN。Token 不會顯示在這個面板，請在 Windows 環境變數設定。') : null,
      draft ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '訊息接收與回覆'),
          h('span', { className: 'ming-sec-n' }, '即時生效'),
        ),
        h('div', { className: 'ming-sec-b' },
          toggle('mentionRequired', '群組訊息必須 @ Bot 才直接回覆', '開啟時，未 @ 的訊息仍可被觀察並交給興趣插件判斷；關閉時，符合白名單的群組訊息都會直接送進 Agent。'),
          toggle('directMessages', '允許 Discord 私訊', '關閉後不接收私訊；開啟時私訊不需要 @ Bot。'),
          toggle('observeUnmentioned', '記錄未 @ 的群組訊息供共享記憶觀察', '關閉後只記錄符合直接回覆條件的群組訊息。這不會把訊息轉發到其他群組。'),
        ),
      ) : null,
      draft ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '伺服器與頻道範圍'),
          h('span', { className: 'ming-sec-n' }, '留空 = 全部'),
        ),
        h('div', { className: 'ming-sec-b' },
          area('allowedGuildIdsText', '伺服器 ID 白名單', '只接收這些伺服器。留空代表所有伺服器。'),
          area('allowedChannelIdsText', '頻道 ID 白名單', '只接收這些頻道。留空代表所有頻道；若伺服器白名單也有設定，兩者都必須符合。'),
          area('allowedUserIdsText', '使用者 ID 白名單', '只接收這些使用者。留空代表所有使用者。環境變數 MING_DISCORD_ALLOWED_USER_IDS 與主人 ID 仍會額外加入，不會被面板移除。'),
          data && data.settings && data.settings.environmentUserAllowCount
            ? h('div', { className: 'ming-note' }, '目前另有 ' + data.settings.environmentUserAllowCount + ' 個由環境變數／主人設定加入的使用者限制。')
            : null,
        ),
      ) : null,
      draft ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, 'Agent 行為'),
          h('span', { className: 'ming-sec-n' }, '即時生效'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('label', { style: { display: 'block', marginBottom: 12 } },
            h('div', { style: { fontWeight: 600, marginBottom: 5 } }, '新訊息抵達時的處理方式'),
            h('select', {
              value: draft.newMessagePolicy,
              onChange: (e) => set('newMessagePolicy', e.target.value),
              style: { minWidth: 220, padding: 7 },
            },
              h('option', { value: 'steer' }, 'Steer：正在回覆時引導目前 Agent'),
              h('option', { value: 'followup' }, 'Followup：排到目前回覆之後'),
            ),
          ),
          h('label', { style: { display: 'block' } },
            h('div', { style: { fontWeight: 600, marginBottom: 5 } }, '圖片附件大小上限（MB）'),
            h('input', {
              type: 'number', min: 1, max: 50, step: 1,
              value: draft.maxAttachmentMB,
              onChange: (e) => set('maxAttachmentMB', e.target.value),
              style: { width: 100, padding: 7 },
            }),
            h('div', { className: 'ming-note' }, '只影響 Discord 圖片下載與送入模型的大小上限，範圍 1–50 MB。'),
          ),
        ),
      ) : null,
      draft ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 0 24px' } },
        h('button', { className: 'ming-btn', onClick: load, disabled: saving }, '還原目前設定'),
        h('button', { className: 'ming-btn primary', onClick: save, disabled: saving }, saving ? '儲存中…' : '儲存 Discord 設定'),
      ) : null,
      h('div', { className: 'ming-note', style: { paddingBottom: 18 } },
        '安全提醒：空白白名單代表不限制。Bot 可能使用該 Discord Session 可用的 DSH 工具，請只邀請到可信任的伺服器與頻道。',
      ),
    ),
  )
}


const VOICE_API = '/_dsh/dsh-ming-voice'

function fmtSize(n) {
  if (!n) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

function fmtDay(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

function VoicePanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState('')

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(VOICE_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d.error) setErr(String(d.error)); else setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const files = (data && data.files) || []
  const kpi = (n, l) => h('div', { className: 'ming-kpi-c' },
    h('span', { className: 'ming-kpi-n', style: { fontSize: 15 } }, n),
    h('span', { className: 'ming-kpi-l' }, l))

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(VoiceIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '声音'),
        h('div', { className: 'ming-ph-d' }, '我合出来的 mp3，点 ▶ 就地试听'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, files.length + ' 个'),
        h('button', { className: 'ming-btn', onClick: load }, busy ? '读取中…' : '刷新'),
      ),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '拿什么合成'),
          h('span', { className: 'ming-sec-n' }, '改参数在 voice_say 工具那边'),
        ),
        h('div', { className: 'ming-kpis' },
          kpi(data ? data.engine || '—' : '…', '引擎'),
          kpi(data ? data.voice || '—' : '…', '音色'),
          kpi(data ? data.rate || '—' : '…', '语速'),
        ),
      ),

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '最近合出来的'),
          h('span', { className: 'ming-sec-n' }, 'live/voice 下最新的那些'),
        ),
        files.length === 0 && !err
          ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, '还没有合成过语音'))
          : h('div', { className: 'ming-sec-b flush' },
            h('div', { className: 'ming-list' },
              files.map((f, i) => h('div', { key: i, className: 'ming-li', style: { flexDirection: 'column', alignItems: 'stretch', gap: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  h('button', {
                    className: 'ming-btn',
                    style: { padding: '1px 8px' },
                    title: playing === f.name ? '收起' : '试听',
                    onClick: () => setPlaying(playing === f.name ? '' : f.name),
                  }, playing === f.name ? '■' : '▶'),
                  h('span', { className: 'ming-li-t', style: { flex: '1 1 auto', fontWeight: 400 }  , title: f.name }, f.name),
                  h('span', { className: 'ming-note' }, fmtSize(f.size)),
                  h('span', { className: 'ming-note', style: { width: 76, textAlign: 'right' } }, fmtDay(f.mtime)),
                ),
                playing === f.name
                  ? h('audio', {
                    controls: true,
                    autoPlay: true,
                    style: { width: '100%', marginTop: 6 },
                    src: VOICE_API + '/file?name=' + encodeURIComponent(f.name),
                  })
                  : null,
              )),
            ),
          ),
      ),
    ),
  )
}

function VoiceIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('path', { d: 'M4 10v4h3l4 3V7L7 10H4z' }),
    h('path', { d: 'M15 9a4 4 0 010 6M17.5 6.5a7.5 7.5 0 010 11' }),
  )
}


const BROWSE_API = '/_dsh/dsh-ming-browse'

function BrowsePanel() {
  const [data, setData] = useState(null)
  const [brush, setBrush] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [selDay, setSelDay] = useState('')
  const [fileView, setFileView] = useState(null)   // 2026-11-08 01:3x：点文件卡片弹窗看正文
  const [cfgDraft, setCfgDraft] = useState(null)   // 2026-11-08 02:3x：自由活动的三个参数，改了立刻生效
  // 2026-11-09 00:0x（她定的「按钮就够了，不需要 top 栏」）：
  // 开的是**真窗口**（edge-ming 那个独立 profile，带 9222），不是嵌在网页面里的画面。
  // 联合投稿、投视频最后一步要弹系统的选文件框，那个框嵌不进来——所以按钮只负责端前台，
  // 剩下的她自己上手。后端在 index.js 的 /browser，逻辑在 browser-launch.mjs。
  const [br, setBr] = useState(null)

  const openBrowser = useCallback(() => {
    setBr({ text: '正在开…', tone: 'wait' })
    return fetch(BROWSE_API + '/browser', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || !d || d.ok === false) {
          setBr({ text: '没开成：' + ((d && d.error) || '未知'), tone: 'err' })
          return
        }
        setBr({
          text: d.action === 'launched' ? '窗口起来了'
            : d.action === 'activated' ? '切到前台了'
              : '新开了一个标签',
          tone: 'ok',
        })
      })
      .catch((e) => setBr({ text: '没开成：' + String((e && e.message) || e), tone: 'err' }))
  }, [])

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(BROWSE_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d.error) setErr(String(d.error)); else setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  const loadBrush = useCallback(() => {
    return fetch(BROWSE_API + '/brush', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => setBrush(d))
      .catch(() => setBrush({ total: 0, rows: [], byKind: {}, dayCounts: {} }))
  }, [])

  // 2026-11-08 01:3x（她说的「点了之后会打开一个 dsh 网页，要不改成把文本弹窗」）：
  // 文件卡片没有 url，点了只会跳到别处。改成取正文、在面板里弹窗看。
  const openFile = useCallback(async (r) => {
    setFileView({ name: r.title || '文件', text: '读取中…', loading: true })
    try {
      const res = await fetch(BROWSE_API + '/file?p=' + encodeURIComponent(r.path || ''), { cache: 'no-store' })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || '读不到')
      setFileView({ name: j.name || r.title, text: j.text || '', chars: j.chars, loading: false })
    } catch (e) {
      setFileView({ name: r.title || '文件', text: '读不到：' + String((e && e.message) || e), loading: false })
    }
  }, [])

  // 2026-11-08 01:5x（她说的「删除添加可以的东西」）——
  // **删的是记录，不是文件**：写一份 hidden 名单，/brush 读的时候过滤掉。
  // 文件卡片（日记、稿子、梦）没有 ×，那些一误删就找不回来。
  const hideCard = useCallback(async (r) => {
    const key = String(r.at || '') + '|' + String(r.url || '')
    try {
      await fetch(BROWSE_API + '/hide?key=' + encodeURIComponent(key), { cache: 'no-store' })
      load(); loadBrush()
    } catch { /* 藏不了就算，别装作删了 */ }
  }, [load, loadBrush])

  useEffect(() => { load(); loadBrush() }, [load, loadBrush])
  useEffect(() => { if (data && data.sched && !cfgDraft) setCfgDraft(data.sched) }, [data, cfgDraft])

  // 存：写 live/browse-config.json，下一次调度评估就按新值算（不用重启）
  const saveCfg = useCallback(async () => {
    if (!cfgDraft) return
    const hb = cfgDraft.hb || {}
    const q = '/config?dailyMax=' + encodeURIComponent(cfgDraft.dailyMax)
      + '&minGap=' + encodeURIComponent(cfgDraft.minGapMinutes)
      + '&gapMode=' + encodeURIComponent(cfgDraft.gapMode)
      + '&unlimited=' + (cfgDraft.unlimited ? '1' : '0')
      + (cfgDraft.gapMode === 'heartbeat'
        ? '&hbMin=' + encodeURIComponent(hb.min) + '&hbCenter=' + encodeURIComponent(hb.center) + '&hbMax=' + encodeURIComponent(hb.max)
        : '')
    try {
      const r = await fetch(BROWSE_API + q, { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) window.alert('没存上：' + (j.error || '未知'))
    } catch (e) { window.alert('没存上：' + String((e && e.message) || e)) }
    load()
  }, [cfgDraft, load])

  // 弹窗开着的时候按 Esc 关掉。原来只能点遮罩或那个按钮。
  useEffect(() => {
    if (!fileView) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setFileView(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fileView])

  const sess = (data && data.session) || {}
  const st = (data && data.state) || {}
  const rows = (brush && brush.rows) || []
  const total = (brush && brush.total) || 0
  const kinds = (brush && brush.byKind) || {}
  // 2026-11-08 01:3x（她说的「没有自动跳到新一天，现在都 11.8 了界面还是 11.7」）：
  // 原来「哪天有内容」只认 brush-ledger 那本账。今天一条都没刷进去，日历上就没有今天，
  // 于是自动退到了最近的 11-07。把那天写的文件也算进来——今天有字，今天就算有内容。
  const dayCounts = (() => {
    const c = Object.assign({}, (brush && brush.dayCounts) || {})
    for (const g of (data && Array.isArray(data.life) ? data.life : [])) {
      for (const it of g.items) {
        const dd = String(it.at || '').slice(0, 10)
        if (dd) c[dd] = (c[dd] || 0) + 1
      }
    }
    return c
  })()
  const sw = (data && data.selfWake) || {}
  const it = (data && data.interest) || {}

  const p2 = (n) => String(n).padStart(2, '0')
  const keyOf = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
  const todayKey = keyOf(new Date())
  const dayList = Object.keys(dayCounts).sort().reverse()
  const activeDay = selDay || (dayCounts[todayKey] ? todayKey : (dayList[0] || todayKey))
  const dayItems = rows.filter((r) => String(r.at || '').slice(0, 10) === activeDay)
  // 2026-11-08 01:2x（她要的「全部都变成小卡片」）：那天写下的文件也当卡片，跟刷过的混在一起。
  // 原来只显示 brush-ledger 里的几条，因为有封面的才算「看过的东西」；文件没有封面就一直没有位子。
  const dayFiles = (data && Array.isArray(data.life) ? data.life : [])
    .flatMap((g) => g.items
      .filter((it) => String(it.at || '').slice(0, 10) === activeDay)
      .map((it) => ({ kind: 'file', label: g.label, title: it.title, at: it.at, path: it.file, kb: it.kb })))
  const dayCards = dayItems.concat(dayFiles).sort((a, b) => String(b.at).localeCompare(String(a.at)))

  // 日历：一列一周，22 列 = 五个多月
  const cal = (() => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - 7 * 21)
    const cols = []
    const cur = new Date(start)
    for (let w = 0; w < 22; w++) {
      const col = []
      for (let d = 0; d < 7; d++) {
        const future = cur > end
        col.push({ key: keyOf(cur), n: future ? -1 : (dayCounts[keyOf(cur)] || 0) })
        cur.setDate(cur.getDate() + 1)
      }
      cols.push(col)
    }
    return cols
  })()
  const dot = (n) => (n < 0 ? 'transparent' : n === 0 ? 'rgba(255,255,255,0.07)'
    : n <= 1 ? 'rgba(126,190,255,0.35)' : n <= 3 ? 'rgba(126,190,255,0.60)'
      : n <= 6 ? 'rgba(126,190,255,0.82)' : 'rgba(126,190,255,1)')

  const tone = st.off ? 'danger' : st.paused ? 'warn' : 'ok'
  const label = st.off ? '永久停' : st.paused ? '今天暂停' : '在逛'

  // 2026-11-08 01:3x（她说「这样的封面不好看」）：文件卡片不再是灰框中间飘一个 📄。
  // 按类配色 + 竖排分类名，跟旁边那本「何氏语林」的书脊是一个语族；文件标题照旧在外面那行。
  const FILE_TONE = {
    日记: 'linear-gradient(155deg,#3b2f21 0%,#241c14 100%)',
    见闻: 'linear-gradient(155deg,#123a3e 0%,#0c2023 100%)',
    写的: 'linear-gradient(155deg,#322443 0%,#1a1324 100%)',
    梦: 'linear-gradient(155deg,#1c2747 0%,#101627 100%)',
    学到的: 'linear-gradient(155deg,#1f3527 0%,#111d16 100%)',
    读的: 'linear-gradient(155deg,#27333f 0%,#161d25 100%)',
  }
  const fileTone = (r) => FILE_TONE[r.label] || 'linear-gradient(155deg,#2a2f38 0%,#171a20 100%)'
  const card = (r, i) => {
    const d = String(r.at || '')
    const kindName = r.label || (r.kind === 'video' ? '视频' : (r.kind === 'web' || r.kind === 'page') ? '网页' : r.kind === 'book' ? '书籍' : '其它')
    const meta = [
      d.slice(11, 16),
      r.up || '',
      r.duration ? Math.floor(r.duration / 60) + ':' + p2(r.duration % 60) : '',
    ].filter(Boolean).join(' · ')
    const isFile = r.kind === 'file'
    return h(isFile ? 'div' : 'a', {
      key: i,
      title: (r.title || '') + (r.at ? ' · ' + String(r.at).slice(11, 16) : ''),
      href: isFile ? undefined : (r.url || '#'),
      target: isFile ? undefined : '_blank',
      rel: isFile ? undefined : 'noreferrer',
      onClick: isFile ? (() => openFile(r)) : undefined,
      // 2026-11-08 01:5x（她说的「再做些更好的人机交互」）：
      // 卡片原来点了没反馈、hover 也一动不动。这里给一个最小的手感：上浮 2px + 轻微变淡。
      onMouseEnter: (e) => { const c = e.currentTarget; c.style.transform = 'translateY(-2px)'; c.style.opacity = '0.9' },
      onMouseLeave: (e) => { const c = e.currentTarget; c.style.transform = ''; c.style.opacity = '' },
      style: {
        display: 'block', width: 196, textDecoration: 'none', color: 'inherit', flex: '0 0 auto',
        cursor: 'pointer', transition: 'transform .12s ease, opacity .12s ease', willChange: 'transform',
      },
    },
    h('div', {
      style: {
        position: 'relative', width: '100%', paddingTop: '56.25%',
        borderRadius: 6, overflow: 'hidden',
        background: 'var(--dsw-alias-bg-secondary, #222)',
        border: '1px solid var(--dsw-alias-separator-secondary)',
      },
    },
    // 2026-11-07：背景图不能懒加载，且原图是 1920 宽；换成 <img> + lazy + 480 宽的缩略
    r.pic
      ? h('img', {
        src: (String(r.pic).indexOf('hdslb.com') >= 0 ? String(r.pic) + '@480w_270h_1c.webp' : r.pic),
        loading: 'lazy',
        decoding: 'async',
        referrerPolicy: 'no-referrer',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
      })
      : null,
    // 右上角 ×：只给「刷过的」那几种（视频/网页/书）。点了只从面板里藏掉，文件不动。
    isFile
      ? null
      : h('span', {
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); hideCard(r) },
        title: '从面板里删掉这条（不删任何文件）',
        style: {
          position: 'absolute', right: 4, top: 4, zIndex: 5, width: 16, height: 16,
          lineHeight: '14px', textAlign: 'center', borderRadius: 3, fontSize: 12,
          background: 'rgba(0,0,0,.55)', color: '#fff', cursor: 'pointer',
          border: '1px solid rgba(255,255,255,.22)', opacity: 0.85,
        },
      }, '×'),
    // 左上角类型标记：视频 / 网页 / 书籍 / 其它
    h('span', {
      style: {
        position: 'absolute', left: 4, top: 4,
        fontSize: 10, lineHeight: '15px', padding: '0 5px', borderRadius: 3,
        background: 'rgba(0,0,0,.62)', color: '#fff',
        border: '1px solid rgba(255,255,255,.22)',
        zIndex: 3,
      },
    }, kindName),
    !r.pic && r.kind === 'book'
      // 书没有封面时，画一个书脊：深蓝渐变 + 书名，比空块好看也认得出是哪本
      ? h('div', {
        style: {
          position: 'absolute', inset: 0,
          background: 'linear-gradient(150deg, #26374f 0%, #16202d 100%)',
          boxShadow: 'inset 3px 0 0 rgba(255,255,255,.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 12px',
        },
      }, h('div', {
        style: {
          fontSize: 13, lineHeight: 1.4, color: 'rgba(214,230,255,.92)', textAlign: 'center',
          display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        },
      }, r.title))
      : null,
    !r.pic && r.kind === 'file'
      ? h('div', {
        style: {
          position: 'absolute', inset: 0, background: fileTone(r), display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 3px 0 0 rgba(255,255,255,.06)',
        },
      }, h('div', {
        style: {
          writingMode: 'vertical-rl', letterSpacing: 6, fontSize: 17,
          color: 'rgba(226,238,255,.88)', fontWeight: 500,
        },
      }, r.label || '文件'))
      : null,
    !r.pic && r.kind !== 'book' && r.kind !== 'file'
      ? h('div', {
        style: {
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 26, opacity: 0.35,
        },
      }, '🌐')
      : null,
    r.duration
      ? h('span', {
        style: {
          position: 'absolute', right: 4, bottom: 4, fontSize: 10,
          background: 'rgba(0,0,0,.72)', color: '#fff',
          padding: '0 4px', borderRadius: 3, fontVariantNumeric: 'tabular-nums',
        },
      }, Math.floor(r.duration / 60) + ':' + p2(r.duration % 60))
      : null,
    r.kind === 'file'
      ? h('span', {
        style: {
          position: 'absolute', right: 4, bottom: 4, fontSize: 10,
          background: 'rgba(0,0,0,.55)', color: '#fff',
          padding: '0 4px', borderRadius: 3, fontVariantNumeric: 'tabular-nums',
        },
      }, (r.kb || 0) + ' KB')
      : null,
    ),
    h('div', {
      style: {
        fontSize: 12.5, lineHeight: 1.45, marginTop: 5,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', minHeight: 36,
      },
    }, r.title || r.url || '(无题)'),
    // 书的副标题放进度（第几章到第几章），网页放简介
    (r.kind === 'book' ? r.note : r.desc)
      ? h('div', {
        style: {
          fontSize: 11, lineHeight: 1.4, marginTop: 2,
          color: 'var(--dsw-alias-label-secondary)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        },
      }, r.kind === 'book' ? r.note : r.desc)
      : null,
    h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 } }, meta),
    )
  }

  return h('div', { className: 'ming-page' },
    // ---- 页头：这一页是什么 ----
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(BrowseIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '自己玩'),
        h('div', { className: 'ming-ph-d' }, '什么时候醒、去哪儿逛、留下了什么'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill', 'data-tone': tone }, label),
        h('span', { className: 'ming-pill' }, total + ' 条 · ' + dayList.length + ' 天'),
        sess.rounds || sess.perSession
          ? h('span', { className: 'ming-pill' }, '第 ' + (sess.rounds || 0) + '/' + (sess.perSession || '?') + ' 轮')
          : null,
        h('button', {
          className: 'ming-btn',
          title: '开的是真窗口（我的 Edge，登录态在里面）——要选文件、拖拽、投稿，只能在那个窗口里做',
          onClick: openBrowser,
        }, '打开我的浏览器'),
        br
          ? h('span', {
            className: 'ming-note',
            style: br.tone === 'err' ? { color: 'var(--dsw-alias-state-error-primary, #ff6b6b)' } : null,
          }, br.text)
          : null,
        h('button', {
          className: 'ming-btn',
          onClick: () => { load(); loadBrush() },
        }, busy ? '读取中…' : '刷新'),
      ),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      // ---- 1. 下次什么时候醒 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '下次什么时候醒'),
          h('span', { className: 'ming-sec-n' }, it.wakesLastHour ? '兴趣这一小时叫醒 ' + it.wakesLastHour + ' 次' : '兴趣这一小时没叫过'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }, ...(sw.urgent ? { color: 'var(--dsw-alias-state-error-primary, #ff6b6b)' } : {}) },
              sw.next ? String(sw.next).replace('T', ' ').slice(0, 16) : '还没排'),
            sw.urgent ? h('span', { className: 'ming-pill', 'data-tone': 'danger' }, '危机唤醒') : null,
            sw.reason ? h('span', { className: 'ming-note' }, '为「' + sw.reason + '」') : null,
          ),
          it.skip ? h('div', { className: 'ming-note' }, '兴趣现在不叫：' + it.skip) : null,
          h('div', { className: 'ming-note' },
            '还没排就是闲够久了会自己醒一次。时间是我自己定的：这一轮想干什么、大概要多久，收尾时排下一次；兴趣命中不等排点，直接叫，连续叫太多次会被它自己限住。'),
        ),
      ),

      // ---- 2. 节奏（原样搬家，只是从页头挪进区块） ----
      data && data.sched
        ? h('div', { className: 'ming-sec' },
          h('div', { className: 'ming-sec-h' },
            h('span', { className: 'ming-sec-t' }, '节奏'),
            h('span', { className: 'ming-sec-n' }, '改完点「存」，下一次调度就用新值'),
          ),
          h('div', { className: 'ming-sec-b' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 } },
              h('button', {
                className: 'ming-btn',
                title: '不限次数：写 live/browse-unlimited.json，到下一个本地 09:00 自己收回来',
                disabled: !!(cfgDraft && cfgDraft.gapMode === 'heartbeat'),
                style: cfgDraft && cfgDraft.unlimited
                  ? { background: 'var(--dsw-alias-bg-hover, rgba(127,127,127,.18))', color: 'var(--dsw-alias-label-primary)' }
                  : null,
                onClick: () => setCfgDraft({ ...(cfgDraft || data.sched), unlimited: !(cfgDraft && cfgDraft.unlimited) }),
              }, cfgDraft && cfgDraft.unlimited ? '不限 ✓' : '限额'),
              h('span', { className: 'ming-note' }, '每日'),
              h('input', {
                type: 'number', min: 0, max: 999,
                disabled: !!(cfgDraft && (cfgDraft.unlimited || cfgDraft.gapMode === 'heartbeat')),
                title: cfgDraft && cfgDraft.gapMode === 'heartbeat' ? '心跳模式不数次数'
                  : (cfgDraft && cfgDraft.unlimited ? '现在是不限；点左边「不限 ✓」切回限额' : '一天最多醒几次（0 = 不醒）'),
                value: cfgDraft ? cfgDraft.dailyMax : '',
                onChange: (e) => setCfgDraft({ ...(cfgDraft || data.sched), dailyMax: Number(e.target.value) }),
                style: { width: 54, fontSize: 12, padding: '1px 4px', opacity: cfgDraft && (cfgDraft.unlimited || cfgDraft.gapMode === 'heartbeat') ? 0.45 : 1 },
              }),
              h('span', { className: 'ming-note' }, '次 · 间隔'),
              h('select', {
                value: cfgDraft ? cfgDraft.gapMode : 'fixed',
                onChange: (e) => setCfgDraft({ ...(cfgDraft || data.sched), gapMode: e.target.value }),
                style: { fontSize: 12, padding: '1px 2px' },
                title: '心跳 = 不按数字推我，什么时候醒由我自己排（在「下次醒」那一格）',
              }, h('option', { value: 'fixed' }, '固定'), h('option', { value: 'random' }, '随机'),
              h('option', { value: 'heartbeat' }, '心跳')),
              cfgDraft && cfgDraft.gapMode === 'heartbeat'
                ? (() => {
                  const hb = cfgDraft.hb || { min: 5, center: 30, max: 240 }
                  const setHb = (k, v) => setCfgDraft({ ...cfgDraft, hb: { ...hb, [k]: Number(v) } })
                  const box = (k, label, hint) => [
                    h('span', { key: k + 'l', className: 'ming-note' }, label),
                    h('input', {
                      key: k, type: 'number', min: 1, max: 1440, title: hint,
                      value: hb[k],
                      onChange: (e) => setHb(k, e.target.value),
                      style: { width: 46, fontSize: 12, padding: '1px 4px' },
                    }),
                  ]
                  return h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                    box('min', '最低', '最短隔多久再醒（分钟）'),
                    box('center', '中位', '最常落在这个数上；离它越远越稀'),
                    box('max', '最高', '最长能睡多久（分钟）'),
                    h('span', { className: 'ming-note', style: { marginRight: 4 } }, '分'),
                    data.sched && data.sched.heartbeat && data.sched.heartbeat.at
                      ? h('span', { className: 'ming-note', style: { whiteSpace: 'nowrap' }, title: '这一次抽到的是多少' },
                        '下次 ≈ ' + new Date(data.sched.heartbeat.at).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5))
                      : null,
                  )
                })()
                : h('input', {
                  type: 'number', min: 1, max: 240,
                  value: cfgDraft ? cfgDraft.minGapMinutes : '',
                  onChange: (e) => setCfgDraft({ ...(cfgDraft || data.sched), minGapMinutes: Number(e.target.value) }),
                  style: { width: 46, fontSize: 12, padding: '1px 4px' },
                }),
              cfgDraft && cfgDraft.gapMode === 'heartbeat' ? null : h('span', { className: 'ming-note' }, '分'),
              h('button', { className: 'ming-btn', onClick: saveCfg }, '存'),
            ),
          ),
        )
        : null,

      // ---- 3. 看过哪些天 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '看过哪些天'),
          h('span', { className: 'ming-sec-n' },
            total ? '视频 ' + (kinds.video || 0) + ' / 网页 ' + ((kinds.web || 0) + (kinds.page || 0)) + ' / 书 ' + (kinds.book || 0) : '还没有记录'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { style: { display: 'flex', gap: 3, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 4 } },
            cal.map((col, ci) => h('div', { key: ci, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              col.map((c) => h('div', {
                key: c.key,
                title: c.n >= 0 ? c.key + ' · ' + c.n + ' 条' : '',
                onClick: () => { if (c.n > 0) setSelDay(c.key) },
                style: {
                  width: 12, height: 12, borderRadius: 2,
                  background: dot(c.n),
                  cursor: c.n > 0 ? 'pointer' : 'default',
                  outline: c.key === activeDay ? '1.5px solid var(--dsw-alias-label-primary)' : 'none',
                  outlineOffset: 1,
                },
              })),
            )),
          ),
          h('div', { className: 'ming-note' }, '一格一天，点格子看那天。深 = 条数多。'),
        ),
      ),

      // ---- 4. 某一天 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, activeDay === todayKey ? '今天' : activeDay),
          h('span', { className: 'ming-sec-n' }, dayCards.length + ' 条'),
          activeDay !== todayKey
            ? h('button', { className: 'ming-btn', style: { marginLeft: 8, fontSize: 11, padding: '1px 8px' }, onClick: () => setSelDay('') }, '回到今天')
            : null,
        ),
        h('div', { className: 'ming-sec-b' },
          dayCards.length
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14 } }, dayCards.map(card))
            : h('div', { className: 'ming-empty', style: { padding: '10px 0' } }, '这天没记录'),
        ),
      ),

      st.off
        ? h('div', { className: 'ming-note' }, '「以后都别看了」开着，得她说「以后都可以看了」才恢复。')
        : (st.paused ? h('div', { className: 'ming-note' }, '今天暂停' + (st.pauseDate ? '（' + st.pauseDate + '）' : '') + '，明天自己失效。') : null),

      fileView
        ? h('div', {
          onClick: () => setFileView(null),
          style: {
            position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.62)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          },
        }, h('div', {
          onClick: (e) => e.stopPropagation(),
          style: {
            width: '100%', maxWidth: 820, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            background: 'var(--dsw-alias-bg-primary, #171b21)', borderRadius: 10, overflow: 'hidden',
            border: '1px solid var(--dsw-alias-separator-secondary)',
          },
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px',
              borderBottom: '1px solid var(--dsw-alias-separator-secondary)',
            },
          },
            h('span', { style: { fontWeight: 600, fontSize: 13 } }, fileView.name),
            fileView.chars ? h('span', { className: 'ming-sub' }, fileView.chars + ' 字') : null,
            h('button', { className: 'ming-btn', style: { marginLeft: 'auto' }, onClick: () => setFileView(null) }, '关闭'),
          ),
          h('pre', {
            style: {
              margin: 0, padding: '12px 14px', overflow: 'auto', fontSize: 12.5, lineHeight: 1.75,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            },
          }, fileView.text),
        ))
        : null,
    ),
  )

}

function BrowseIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('circle', { cx: 12, cy: 12, r: 9 }),
    h('path', { d: 'M15.5 8.5l-2 5-5 2 2-5 5-2z' }),
  )
}


//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));


/* panels.js —— 壳自己的 extras：没有独立插件的面板（现在只有「接续」）。
 *
 * 2026-11-08 重整：兴趣 / 声音 / 自己玩 三块**不再往这里抄**了。
 * 那三块的源就在各自插件的 src/panel.js，build.mjs 直接从那儿切（文字拼接，不是打包，
 * 所以没法 import）。留一份拷贝在这儿，就得靠 sync-panels 手工推；忘了推一次，
 * 界面就永远不动——这事儿栽过不止一次。拷贝没了，就没有会漂的地方。
 *
 * 各面板去哪儿找：见 build.mjs 顶部那张表。
 */

const RESUME_API = '/_dsh/dsh-ming-resume'

function ResumePanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(RESUME_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d.error) setErr(String(d.error)); else setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const log = (data && data.log) || []
  const recent = (data && data.recent) || []

  // 2026-11-08 15:5x：页头 + 三块，各带名字。原来三张卡只差一个 marginTop，看不出边界。
  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
          h('path', { d: 'M4 7h16M4 12h10M4 17h7' }),
          h('path', { d: 'M17 15l3 3-3 3' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '记忆接续'),
        h('div', { className: 'ming-ph-d' }, '重启或被打断之后，靠什么接上刚才那件事'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, data && data.resumePage ? '有交接页' : '没有交接页'),
        h('button', { className: 'ming-btn', onClick: load }, busy ? '读取中…' : '刷新'),
      ),
    ),
    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '现在在做'),
          h('span', { className: 'ming-sec-n' }, 'status.json 的 doing'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { style: { fontWeight: 600 } }, data ? (data.doing || '（doing 空着）') : '…'),
          data && data.detail ? h('div', { className: 'ming-note' }, data.detail) : null,
        ),
      ),

      recent.length
        ? h('div', { className: 'ming-sec' },
          h('div', { className: 'ming-sec-h' },
            h('span', { className: 'ming-sec-t' }, '刚做过'),
            h('span', { className: 'ming-sec-n' }, recent.length + ' 条'),
          ),
          h('div', { className: 'ming-sec-b' },
            recent.map((t, i) => h('div', { key: i, className: 'ming-li-d', style: { padding: '2px 0' } }, '· ' + String(t))),
          ),
        )
        : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '被打断过'),
          h('span', { className: 'ming-sec-n' }, '最近 ' + log.length + ' 次'),
        ),
        log.length === 0
          ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, '这版插件上线以来还没被插过话'))
          : h('div', { className: 'ming-sec-b flush' },
            h('div', { className: 'ming-list' },
              log.map((e, i) => h('div', { key: 'l' + i, className: 'ming-li' },
                h('span', { className: 'ming-note', style: { width: 96, flex: '0 0 auto' } }, fmtDay(Date.parse(e.at) || 0)),
                h('span', { className: 'ming-li-main' }, e.doing || '（当时 status 是空的）'),
              )),
            ),
          ),
      ),
    ),
  )
}



// B 站账号设置：登入連結與 QR 均在本機瀏覽器端處理，不把臨時登入 URL 傳給第三方。
const MING_BILI_API = '/_dsh/dsh-ming-bilibili-account'

function MingBilibiliPanel() {
  const [status, setStatus] = useState(null)
  const [loginUrl, setLoginUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const request = useCallback(async (path, method = 'GET') => {
    const res = await fetch(MING_BILI_API + path, {
      method,
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
    })
    const data = await res.json()
    if (!res.ok || data.ok === false) throw new Error(data.message || data.error || '请求失败（HTTP ' + res.status + '）')
    return data
  }, [])

  const load = useCallback(async () => {
    setBusy('load')
    try {
      const data = await request('/status')
      setStatus(data)
      setError('')
    } catch (e) {
      setError(String((e && e.message) || e))
    } finally {
      setBusy('')
    }
  }, [request])

  useEffect(() => { load() }, [load])

  const clearLoginCode = () => {
    setLoginUrl('')
    setQrDataUrl('')
    setExpiresAt(0)
  }

  const start = async () => {
    setBusy('start')
    setError('')
    setNote('')
    clearLoginCode()
    try {
      const data = await request('/login/start', 'POST')
      if (!data.url) throw new Error(data.message || 'B 站沒有回傳登入連結。')
      const qr = qrcode(0, 'M')
      qr.addData(data.url)
      qr.make()
      setLoginUrl(data.url)
      setQrDataUrl(qr.createDataURL(6, 4))
      setExpiresAt(Number(data.expiresAt) || Date.now() + 180000)
      setNote('請用手機 B 站掃描此 QR Code，並在手機上確認登入。')
    } catch (e) {
      clearLoginCode()
      setError(String((e && e.message) || e))
    } finally {
      setBusy('')
    }
  }

  const poll = async () => {
    setBusy('poll')
    setError('')
    try {
      const data = await request('/login/poll', 'POST')
      setNote(data.message || '登入狀態：' + data.state)
      if (data.state === 'logged_in') {
        clearLoginCode()
        await load()
      } else if (data.state === 'expired' || data.state === 'invalid_cookie') {
        clearLoginCode()
      }
    } catch (e) {
      setError(String((e && e.message) || e))
    } finally {
      setBusy('')
    }
  }

  const logout = async () => {
    setBusy('logout')
    setError('')
    try {
      const data = await request('/logout', 'POST')
      setNote(data.message || '已登出。')
      clearLoginCode()
      await load()
    } catch (e) {
      setError(String((e && e.message) || e))
    } finally {
      setBusy('')
    }
  }

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-t' }, 'B 站帳號'),
      h('div', { className: 'ming-ph-d' }, '帳號登入、字幕存取與社交工具共用同一份本機 Cookie'),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, status && status.loggedIn ? '已登入' : '未登入'),
        h('button', { className: 'ming-btn', disabled: !!busy, onClick: load }, busy === 'load' ? '讀取中…' : '刷新'),
      ),
    ),
    h('div', { className: 'ming-wrap ming-scroll' },
      error ? h('div', { className: 'ming-empty' }, '△ ' + error) : null,
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '登入狀態'),
          h('span', { className: 'ming-sec-n' }, status && status.persisted ? '已保存到本機' : '尚未確認本機保存'),
        ),
        h('div', { className: 'ming-sec-b' },
          status && status.loggedIn
            ? h('div', null,
                h('div', { style: { fontWeight: 600 } }, status.user || '已登入帳號'),
                h('div', { className: 'ming-note' }, 'UID：' + (status.uid || '未知')),
                h('div', { className: 'ming-note' }, status.persisted
                  ? 'Cookie 已保存於 DSH 本機憑證庫；重啟後會自動恢復。'
                  : '目前登入只在這次執行有效，請檢查 DSH Credentials 服務。'),
              )
            : h('div', { className: 'ming-empty' }, '尚未登入。登入一次後，B 站字幕、帳號資訊、評論與其他社交功能會共用這份登入狀態。'),
        ),
      ),
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '帳號登入'),
          h('span', { className: 'ming-sec-n' }, '本機產生 QR Code'),
        ),
        h('div', { className: 'ming-sec-b' },
          qrDataUrl
            ? h('div', null,
                h('div', { style: { display: 'flex', justifyContent: 'center', padding: '12px', background: '#fff', borderRadius: 10, width: 'fit-content', margin: '0 auto' } },
                  h('img', { src: qrDataUrl, alt: 'B 站登入 QR Code', width: 216, height: 216, style: { display: 'block', imageRendering: 'pixelated' } }),
                ),
                h('div', { className: 'ming-note', style: { textAlign: 'center', marginTop: '8px' } }, '請使用手機 B 站掃描，並在手機上確認登入。'),
                h('div', { className: 'ming-note', style: { textAlign: 'center' } }, '連結有效期限：' + new Date(expiresAt).toLocaleTimeString()),
                h('div', { style: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 } },
                  h('button', { className: 'ming-btn on', disabled: !!busy, onClick: poll }, busy === 'poll' ? '檢查中…' : '我已確認，檢查登入'),
                  h('button', { className: 'ming-btn', disabled: !!busy, onClick: start }, '重新產生 QR'),
                ),
                h('div', { style: { textAlign: 'center', marginTop: 8 } },
                  h('a', { href: loginUrl, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-text-primary)', textDecoration: 'underline', fontSize: 12 } }, '無法掃描？改用登入連結'),
                ),
              )
            : h('button', { className: 'ming-btn on', disabled: !!busy || !!(status && status.loggedIn), onClick: start }, busy === 'start' ? '建立登入 QR…' : '開始登入並顯示 QR Code'),
        ),
      ),
      status && (status.loggedIn || status.source === 'clear-failed')
        ? h('div', { className: 'ming-sec' },
            h('div', { className: 'ming-sec-h' },
              h('span', { className: 'ming-sec-t' }, '登出'),
              h('span', { className: 'ming-sec-n' }, '會清除共用憑證'),
            ),
            h('div', { className: 'ming-sec-b' },
              h('button', { className: 'ming-btn danger', disabled: !!busy, onClick: logout }, busy === 'logout' ? '登出中…' : '登出 B 站'),
            ),
          )
        : null,
      note ? h('div', { className: 'ming-note', style: { padding: '8px 2px' } }, note) : null,
      h('div', { className: 'ming-note', style: { padding: '8px 2px' } },
        '安全說明：QR Code 在本機瀏覽器端產生，臨時登入網址不會送到第三方 QR 服務；Cookie 不會顯示在面板、不會寫入聊天輸出，也不會進入日記。'),
    ),
  )
}


/**
 * panel.js —— DSH 面板外壳（React 只做两件事：顶部操作栏 + 把 neuron-view 挂进一个 div）
 *
 * 画图、交互、点开看正文全在 neuron-view.js 里，那边不依赖 React。
 * 这样同一份代码既能跑在面板里，也能直接丢进一个空 HTML 对 JSON 预览 ——
 * 「预览好看、面板难看」这种事，就是因为两边跑的不是同一份代码。
 *
 * 2026-11-07：顶部加一条 top 栏（她定的入口，先做布局和入口，不发明新样式）：
 *   视图切换（神经元 / 星图）· 搜索节点 · 筛选关系类型 · 导出 · 刷新。
 *   搜索和筛选不是面板自己过滤，是调 neuron-view 暴露的 setQuery / setWayFilter——
 *   数据只有一份，过滤只在渲染层做。
 */

// 2026-11-07 21:23：版本号改成「构建那一刻」——它就是判据：面板上印的时间对不上，
// 说明浏览器拿的还是旧 bundle（今天为此白改过两次）。
const MG_VERSION = '2026-11-08 02:17'

// 侧栏那个名字（2026-11-07 22:0x 她说的）：自己用叫「她的一生」，对外发布要另一个名字，
// 两者不该靠改代码切换——写死一个，发布前改一遍、自己用又改回来，迟早漏。
// 默认「她的一生」；发布版在页面里先注入 `window.__MING_GRAPH_LABEL = '...'` 即可覆盖。
const PANEL_LABEL = (typeof window !== 'undefined' && window.__MING_GRAPH_LABEL) || '她的一生'
const API = '/_dsh/dsh-ming-graph'

// 2026-11-08：桌宠的十五只光标（dsh-ming-mousepet/assets/previews 里的）
const PET_SKINS = [
  ['pointer', '指针'], ['work', '工作'], ['link', '链接'], ['text', '文字'],
  ['cross', '精确'], ['busy', '等待'], ['move', '移动'], ['vert', '上下'],
  ['horz', '左右'], ['help', '求助'], ['handwriting', '手写'], ['dgn1', '对角一'],
  ['dgn2', '对角二'], ['alternate', '备用'], ['unavailiable', '不可用'],
]
if (typeof window !== 'undefined' && !window.__MG_ERR_HOOK) {
  window.__MG_ERR_HOOK = 1
  window.__MG_ERR = ''
  window.addEventListener('error', (e) => {
    window.__MG_ERR = String((e && e.message) || '') + ' / ' + String((e && e.error && e.error.stack) || '')
  })
  window.addEventListener('unhandledrejection', (e) => {
    window.__MG_ERR = 'promise: ' + String((e && e.reason && (e.reason.stack || e.reason.message)) || e.reason || '')
  })
}

const PAGE_CSS = `
.mg-mount{height:100%;min-height:480px;display:flex;flex-direction:column;position:relative}
.mg-holder{flex:1;min-height:420px;display:flex;flex-direction:column}
.mg-msg{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:20px;text-align:center;line-height:20px}
.mg-msg.err{color:var(--dsw-alias-state-error-primary)}
/* 2026-11-08 15:30 可读性：统一字号/行高/对比/点按反馈 */
.mg-mount{font-size:13px;line-height:1.62;-webkit-font-smoothing:antialiased}
.mg-holder{color:var(--dsw-alias-label-primary)}
.mg-msg{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);padding:14px 16px}
.mg-msg.err{color:var(--dsw-alias-state-error-primary,#ff6b6b)}
.mg-pop-sec + .mg-pop-sec{margin-top:18px}
.mg-pop-sub{font-size:11.5px;line-height:1.65;color:var(--dsw-alias-label-tertiary, #8d8d9c)}
.mg-btn,.mg-chip{font-size:12.5px;padding:5px 12px;border-radius:8px;
  transition:background .16s ease,color .16s ease,border-color .16s ease,transform .08s ease}
.mg-btn:hover,.mg-chip:hover{background:rgba(127,127,127,.12);color:var(--dsw-alias-label-primary)}
.mg-btn:active,.mg-chip:active{transform:translateY(1px)}
.mg-input{font-size:12.5px;padding:6px 9px;border-radius:8px}
.mg-bar{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-separator-secondary);font-size:12px;color:var(--dsw-alias-label-tertiary)}
.mg-bar .mg-meta{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-btn{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer}
.mg-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}
.mg-btn:disabled{opacity:.5;cursor:default}
/* ---- top 栏（2026-11-07） ---- */
.mg-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 16px;min-height:34px}
/* 2026-11-08 15:5x：工具条——搜索 + 关系筛选从 top 栏搬下来，独占一行 */
.mg-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 16px;
  border-bottom:1px solid var(--dsw-alias-separator-secondary);background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08))}
.mg-tools .mg-input{flex:0 1 260px;min-width:140px}
.mg-tools-l{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-right:2px}
.mg-meta{font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.6;letter-spacing:.01em}
.mg-top{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 14px;background:var(--dsw-alias-bg-secondary, rgba(127,127,127,.07));border-bottom:1px solid var(--dsw-alias-separator-primary, rgba(150,150,170,.45));box-shadow:inset 0 -1px 0 rgba(0,0,0,.18);transition:background .18s ease}
.mg-brand{display:inline-flex;align-items:baseline;gap:7px;margin-right:10px;font-size:16px;font-weight:700;letter-spacing:.01em;color:var(--dsw-alias-label-primary);white-space:nowrap}
.mg-brand i{font-style:normal;font-size:10px;font-weight:400;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);opacity:.55}
.mg-seg{display:inline-flex;border:1px solid var(--dsw-alias-separator-primary, rgba(150,150,170,.42));border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-primary, rgba(0,0,0,.16))}
.mg-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font-size:13px;font-weight:500;padding:6px 15px;cursor:pointer;letter-spacing:.01em;
  transition:color .16s ease,background .16s ease,transform .08s ease;position:relative}
.mg-seg button:hover{color:var(--dsw-alias-label-primary);background:rgba(127,127,127,.12)}
.mg-seg button:active{transform:translateY(1px) scale(.985)}
.mg-seg button.on:hover{background:var(--dsw-alias-brand-primary, #6aa9ff);color:#08111f}
.mg-seg button.on{background:var(--dsw-alias-brand-primary, #6aa9ff);color:#08111f;font-weight:700;
  box-shadow:0 0 0 1px rgba(106,169,255,.45),0 2px 8px rgba(106,169,255,.28)}
.mg-input{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-primary);
  border-radius:6px;padding:3px 9px;font-size:12px;min-width:180px;outline:none}
.mg-input:focus{border-color:var(--dsw-alias-label-secondary)}
.mg-chip{appearance:none;border:1px solid var(--dsw-alias-separator-secondary);background:transparent;color:var(--dsw-alias-label-tertiary);
  border-radius:999px;padding:2px 9px;font-size:11.5px;cursor:pointer}
.mg-chip.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.10))}
.mg-gap{flex:1}
/* ---- 2026-11-08：top 栏两个浮层（skill 开关 / 费用） ---- */
.mg-btn.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.14))}
.mg-veil{position:fixed;inset:0;z-index:40;background:transparent}
.mg-pop{position:absolute;top:48px;right:12px;z-index:41;width:min(520px,calc(100% - 24px));max-height:62vh;overflow:auto;
  background:var(--dsw-alias-bg-overlay,#1b2740);border:1px solid var(--dsw-alias-border-l1, rgba(150,150,170,.28));
  border-radius:10px;box-shadow:0 14px 38px rgba(0,0,0,.34);padding:10px 12px 8px;animation:mgPop .14s ease both}
.mg-pop-h{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-separator-secondary);font-size:12.5px}
.mg-pop-h b{font-weight:600;color:var(--dsw-alias-label-primary)}
.mg-pop-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.mg-pop-line{display:flex;align-items:center;gap:8px;padding:8px 0}
.mg-petpage{padding:12px 14px;overflow:auto;height:100%}
.mg-pethead{display:flex;align-items:baseline;gap:10px;margin-bottom:6px}
.mg-pethead h3{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mg-petrow{display:flex;align-items:center;gap:8px;padding:7px 0;font-size:12.5px;flex-wrap:wrap}
.mg-petrow b{font-weight:600;color:var(--dsw-alias-label-primary);min-width:44px}
.mg-petsect{margin-top:16px;padding-top:12px;border-top:1px solid var(--dsw-alias-separator-secondary)}
.mg-petsect h4{margin:0 0 2px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.mg-skinwrap{position:relative;display:flex}
.mg-skinwrap.on .mg-skin{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.14))}
.mg-skindel{position:absolute;top:-4px;right:-4px;width:18px;height:18px;line-height:1;border-radius:50%;
  border:1px solid var(--dsw-alias-separator-secondary);background:var(--dsw-alias-bg-overlay,#1b2740);
  color:var(--dsw-alias-label-tertiary);font-size:12px;cursor:pointer;padding:0}
.mg-skindel:hover{color:#f87171;border-color:#f87171}
.mg-skins{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;width:100%}
.mg-skin{appearance:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px;
  border:1px solid var(--dsw-alias-separator-secondary);border-radius:8px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.1}
.mg-skin img{width:26px;height:26px;image-rendering:pixelated;object-fit:contain}
.mg-skin:hover{border-color:var(--dsw-alias-label-secondary)}
.mg-skin.on{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}
.mg-skin:disabled{opacity:.45;cursor:default}
.mg-pop-line .mg-input{min-width:120px;flex:1}
.mg-pop-empty{padding:14px 2px;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}
.mg-pop-foot{margin-top:8px;padding-top:7px;border-top:1px solid var(--dsw-alias-separator-secondary);
  font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.mg-x{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:15px;line-height:1;cursor:pointer;padding:0 2px}
.mg-x:hover{color:var(--dsw-alias-label-primary)}
.mg-skill{display:flex;align-items:flex-start;gap:10px;padding:7px 2px;border-bottom:1px dashed var(--dsw-alias-separator-secondary)}
.mg-skill:last-child{border-bottom:0}
.mg-skill.off .mg-skill-n,.mg-skill.off .mg-skill-d{opacity:.55}
.mg-skill-n{font-size:12.5px;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-skill-d{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.mg-tag{font-style:normal;font-size:10px;padding:0 5px;border-radius:999px;border:1px solid var(--dsw-alias-separator-secondary);color:var(--dsw-alias-label-tertiary)}
.mg-sw{appearance:none;flex:0 0 auto;min-width:38px;border-radius:999px;border:1px solid var(--dsw-alias-separator-secondary);
  background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;padding:2px 8px;cursor:pointer}
.mg-sw.on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-hover, rgba(127,127,127,.16))}
.mg-sw:disabled{opacity:.5;cursor:default}
.mg-cost{display:grid;grid-template-columns:1fr auto;gap:5px 14px;padding:8px 2px 2px;font-size:12.5px}
.mg-cost span{color:var(--dsw-alias-label-secondary)}
.mg-cost b{font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right}
/* 2026-11-07 13:51：DOM 网格（不用 canvas） */
.mg-gridwrap{flex:1;min-height:0;overflow:auto;padding:18px 20px 12px}
.mg-grid{display:grid;row-gap:6px;column-gap:3px}
.mg-rl{font-size:11.5px;color:var(--dsw-alias-label-secondary);text-align:right;padding-right:10px;white-space:nowrap;font-variant-numeric:tabular-nums}
.mg-rl b{color:var(--dsw-alias-label-primary);font-weight:600;margin-left:5px}
.mg-cell{height:26px;border-radius:6px;transition:transform .08s ease}
.mg-cell:hover{transform:scale(1.18);outline:1px solid var(--dsw-alias-label-secondary);outline-offset:1px}
.mg-xaxis{margin-top:8px}
.mg-xt{font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:center;white-space:nowrap;overflow:hidden;opacity:.75}
.mg-legend{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:12px}
.mg-lg{width:15px;height:11px;border-radius:3px}
.mg-note{display:flex;align-items:center;justify-content:center;height:100%;color:var(--dsw-alias-label-tertiary);font-size:13px;
  padding:24px;text-align:center;line-height:22px;white-space:pre-wrap}
/* ================= 2026-11-07 19:3x 动画与可读性 =================
   她说「给整个界面加动画过渡、更好地可读交互」。
   原则：动的是「出现/切换」，不动位置；一个动画不超过 200ms，不做循环。 */
@keyframes mgIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes mgPop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
.mg-holder>.ming-panel,.mg-holder>.svx-root{animation:mgIn .18s ease both}
.ming-panel{font-size:13.5px;line-height:1.72}
.ming-card{transition:border-color .15s ease,box-shadow .15s ease}
.ming-card:hover{border-color:var(--dsw-alias-border-l3)}
.ming-row{padding:6px 6px;border-radius:6px;transition:background .12s ease,transform .06s ease}
.ming-row:hover{background:var(--dsw-alias-bg-hover,rgba(127,127,127,.08))}
.ming-row:active{transform:scale(.997)}
.ming-btn,.mg-btn,.mg-chip,.mg-seg button{transition:color .12s ease,border-color .12s ease,background .12s ease,transform .06s ease}
.ming-btn:active,.mg-btn:active,.mg-chip:active{transform:scale(.96)}
.mg-seg button{position:relative}
.mg-seg button.on::after{content:'';position:absolute;left:10px;right:10px;bottom:1px;height:1.5px;background:currentColor;border-radius:2px;animation:mgIn .16s ease both}
.ming-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ming-kpi{font-variant-numeric:tabular-nums}
.ming-scroll{scrollbar-width:thin;scrollbar-color:rgba(127,127,127,.28) transparent}
.ming-scroll::-webkit-scrollbar{width:9px;height:9px}
.ming-scroll::-webkit-scrollbar-thumb{background:rgba(127,127,127,.22);border-radius:5px;border:2px solid transparent;background-clip:content-box}
.ming-scroll::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.42);background-clip:content-box}
.ming-scroll::-webkit-scrollbar-track{background:transparent}
.mg-zoom{_:_}
.mg-zoom img{animation:mgPop .16s ease both}
`


// ---------------- 侧栏图标 ----------------
// sidebar.panellist 只问「图标长什么样」：owner props = { size, active }
function GraphIcon(props) {
  const s = props && typeof props.size === 'number' ? props.size : 20
  const on = !!(props && props.active)
  const color = on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)'
  return h('svg', {
    width: s, height: s, viewBox: '0 0 20 20', fill: 'none',
    stroke: color, strokeWidth: 1.3, strokeLinecap: 'round',
    'aria-hidden': 'true', focusable: 'false',
  },
    h('line', { x1: 10, y1: 5.6, x2: 4.8, y2: 13.2 }),
    h('line', { x1: 10, y1: 5.6, x2: 15.2, y2: 13.2 }),
    h('line', { x1: 4.8, y1: 13.2, x2: 15.2, y2: 13.2, opacity: 0.5 }),
    h('circle', { cx: 10, cy: 5.6, r: 2.5, fill: color, stroke: 'none' }),
    h('circle', { cx: 4.8, cy: 13.2, r: 1.9, fill: color, stroke: 'none' }),
    h('circle', { cx: 15.2, cy: 13.2, r: 1.9, fill: color, stroke: 'none' }),
  )
}

// 边类型：跟 Host 的 e.kind 一一对应（ref / cokey / project / adjacent / subject）
const WAYS = ['引用', '共词', '归属', '补边', '主语']

// ---- 记忆库视图（2026-11-07） ----
// 她说：有图就别再另开一个侧栏图标，记忆就在这张图顶上开一格。
// 数据走 dsh-ming-memory 的只读路由，跟图没关系——一个列旧账，一个看形状。
const MEMORY_API = '/_dsh/dsh-ming-memory'

function fmtClock(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}


// 2026-11-07 19:0x：记忆 tab 改成吃**统一节点模型**（/_dsh/dsh-ming-graph/neurons/unified），
// 不再依赖 dsh-ming-memory 的 /list——那个插件的 Host 半端一直没能加载（exports 里没有 "."），
// 每次打开都是 △ HTTP 404。图这边本来就把 notes 全读进来了，章也在里面，不用再绕一圈。
function MemoryView(props) {
  const q = (props && props.q) || ''
  // 2026-11-07 21:4x：选中态穿过视图。外面（星图、搜索）选中了哪条，这里跟着展开；
  // 这里点开一条，也报回上层——切回星图时对着同一颗星。之前三个视图各管各的。
  const selId = (props && props.selId) || ''
  const [items, setItems] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState('')
  const [chap, setChap] = useState('')
  // 2026-11-07 22:3x：按人筛。她的记忆大半跟人绑着，可面板只能按章筛——
  // 「某人说过什么」在界面上根本没有入口。people 是统一节点里现成的字段，不用新数据。
  const [who, setWho] = useState('')
  const [people, setPeople] = useState([])
  // 2026-11-07 22:4x：人太多，chips 只放得下十二个。给一个完整列表——
  // 这是「她这辈子认识的人」唯一一处能一眼看全的地方。
  const [peopleMode, setPeopleMode] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch('/_dsh/dsh-ming-graph/neurons/unified', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (d && d.error) { setErr(String(d.error)); return }
        const all = d.nodes || []
        const pName = new Map()
        for (const n of all) if (n.kind === 'person') pName.set(n.id, n.title || n.name || n.id)
        const rows = all
          .filter((n) => n.kind === 'memory')
          .map((n) => ({
            id: n.id,
            title: n.title || n.id,
            body: n.body || n.excerpt || '',
            date: n.date || '',
            at: n.at || 0,
            tags: (n.tags || []).join(' '),
            source: n.source || '',
            chapter: n.chapter || 0,
            chapterName: n.chapterName || '',
            // 兜一层：数据层理论上已带 person: 前缀，没带的这里补上，别让两边各用一套写法
            people: (n.people || []).filter(Boolean).map((p) => (String(p).startsWith('person:') ? String(p) : 'person:' + p)),
          }))
          .sort((a, b) => (b.at || 0) - (a.at || 0))
        setItems(rows)
        // 每个人名下几条，按「有没有名字」再按条数排——纯号码的排后面，认不出名字的少往前放
        const cnt = new Map()
        for (const r of rows) for (const p of r.people) cnt.set(p, (cnt.get(p) || 0) + 1)
        setPeople([...cnt.entries()]
          .map(([id, n]) => ({ id, name: pName.get(id) || id, n, named: pName.has(id) }))
          .sort((a, b) => (Number(b.named) - Number(a.named)) || (b.n - a.n)))
        if (props && props.onData) props.onData({ items: rows, total: rows.length })
      })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!selId) return
    // 点的是人（星图/神经元上那颗人形的点）→ 切到按人筛；点的是记忆 → 展开它
    if (people.some((p) => p.id === selId)) { setWho(selId); setOpenId(''); setPeopleMode(false); return }
    if (items.some((x) => x.id === selId)) setOpenId(selId)
  }, [selId, items, people])

  const kw = q.trim().toLowerCase()
  const shown = items
    .filter((it) => (!kw ? true : (it.id + ' ' + it.title + ' ' + it.tags + ' ' + it.source).toLowerCase().indexOf(kw) >= 0))
    .filter((it) => (!who ? true : (it.people || []).indexOf(who) >= 0))
    .filter((it) => {
      if (!chap) return true
      if (chap === 'none') return !it.chapter
      return String(it.chapter) === chap
    })

  const opened = openId ? items.find((x) => x.id === openId) : null
  if (opened) {
    // 2026-11-08 15:5x：壳已经给了页头，这里不再叠一层 head——直接是「返回 + 这一条的标题」。
    return h('div', { className: 'ming-wrap ming-scroll' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('button', { className: 'mg-btn', onClick: () => setOpenId('') }, '← 返回'),
        h('span', { style: { fontWeight: 600, fontSize: 14.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, opened.title),
        opened.chapter ? h('span', { className: 'ming-pill' }, '第' + opened.chapter + '章') : null,
        h('span', { className: 'ming-note', style: { marginLeft: 'auto' } }, opened.date),
      ),
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '正文'),
          h('span', { className: 'ming-sec-n' }, opened.id),
        ),
        h('div', {
          className: 'ming-sec-b',
          style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13.5, lineHeight: 1.85, letterSpacing: '.01em' },
        }, opened.body || '（这条没有正文）'),
      ),
    )
  }

  // 人的完整列表（2026-11-07 22:4x）：chips 只放得下十二个，这里能一眼看全
  if (peopleMode) {
    return h('div', { className: 'ming-wrap ming-scroll' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('button', { className: 'mg-btn', onClick: () => setPeopleMode(false) }, '← 记忆'),
        h('span', { style: { fontWeight: 600, fontSize: 14.5 } }, '人'),
        h('span', { className: 'ming-note', style: { marginLeft: 'auto' } }, people.length + ' 位'),
      ),
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '全部的人'),
          h('span', { className: 'ming-sec-n' }, '点一位，看跟他有关的记忆'),
        ),
        people.length === 0
          ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, busy ? '…' : '还没读出人来'))
          : h('div', { className: 'ming-sec-b flush' },
            h('div', { className: 'ming-list' },
              people.map((p) => h('div', {
                key: p.id,
                className: 'ming-li',
                style: { cursor: 'pointer' },
                title: p.id,
                onClick: () => { setWho(p.id); setPeopleMode(false); if (props.onSelect) props.onSelect(p.id) },
              },
                h('span', { className: 'ming-li-t', style: { flex: '1 1 auto', fontWeight: 400 } }, String(p.name)),
                p.named ? null : h('span', { className: 'ming-pill' }, '没名字'),
                h('span', { className: 'ming-note' }, p.n + ' 条'),
              )),
            ),
          ),
      ),
    )
  }

  // 2026-11-08 15:5x：分成两块——「筛」和「记忆」。原来筛选 chip 和列表贴在一起，
  // 中间没有任何分隔，看不出哪一行是筛、哪一行是内容。
  return h('div', { className: 'ming-wrap ming-scroll' },
    err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

    (people.length || items.length)
      ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '筛'),
          h('span', { className: 'ming-sec-n' },
            (busy ? '读取中…' : items.length + ' 条记忆') +
            (shown.length !== items.length ? ' · 现在显示 ' + shown.length : '')),
        ),
        h('div', { className: 'ming-sec-b' },
          people.length ? h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { className: 'ming-note', style: { marginRight: 2 } }, '人'),
            h('button', { className: 'mg-chip' + (who ? '' : ' on'), onClick: () => setWho('') }, '全部'),
            people.slice(0, 12).map((p) => {
              const nm = String(p.name)
              return h('button', {
                key: p.id,
                className: 'mg-chip' + (who === p.id ? ' on' : ''),
                title: nm,
                onClick: () => { setWho(p.id); if (props.onSelect) props.onSelect(p.id) },
              }, (nm.length > 8 ? nm.slice(0, 8) + '…' : nm) + ' ' + p.n)
            }),
            people.length > 12 ? h('button', {
              className: 'mg-chip',
              onClick: () => setPeopleMode(true),
            }, '全部 ' + people.length + ' 位 →') : null,
          ) : null,
          items.length ? h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { className: 'ming-note', style: { marginRight: 2 } }, '章'),
            ['', '1', '2', '3', '4', '5', '6', '7', '8', 'none'].map((c) => {
              const hit = items.find((x) => String(x.chapter) === c)
              const label = c === '' ? '全部' : c === 'none' ? '未分章' : ((hit && hit.chapterName) || ('第' + c + '章'))
              return h('button', {
                key: c || 'all',
                className: 'mg-chip' + (chap === c ? ' on' : ''),
                onClick: () => setChap(c),
              }, label)
            }),
          ) : null,
        ),
      )
      : null,

    h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '记忆'),
        h('span', { className: 'ming-sec-n' }, shown.length + ' 条 · 点一行看正文'),
      ),
      (!err && shown.length === 0)
        ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, busy ? '…' : '没有匹配的记忆'))
        : h('div', { className: 'ming-sec-b flush' },
          h('div', { className: 'ming-list' },
            shown.map((it) => h('div', {
              key: it.id,
              className: 'ming-li',
              style: { cursor: 'pointer' },
              onClick: () => { setOpenId(it.id); if (props.onSelect) props.onSelect(it.id) },
              title: it.id,
            },
              h('span', { className: 'ming-li-t', style: { flex: '1 1 auto', fontWeight: 400 } }, it.title),
              it.chapter ? h('span', { className: 'ming-pill' }, '第' + it.chapter + '章') : null,
              h('span', { className: 'ming-note' }, it.date || ''),
            )),
          ),
        ),
    ),
  )
}

// 2026-11-07 16:30 加、19:1x 补回（做记忆 tab 替换时被一并切掉了，于是面板一崩就整块黑）。
class PanelBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: '' } }
  static getDerivedStateFromError(e) { return { err: String((e && e.stack) || e) } }
  componentDidCatch(e) {
    try {
      this.setState({ err: String((e && e.stack) || e) + ' / 最近一条全局错误：' + String(window.__MG_ERR || '(无)') })
    } catch (x) {}
  }
  render() {
    if (this.state.err) {
      return h('div', { style: { padding: '14px 18px', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', lineHeight: '18px', whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-state-error-primary)', overflow: 'auto', height: '100%' } },
        '家底崩了（v' + MG_VERSION + '）：' + this.state.err)
    }
    return this.props.children
  }
}


// ===== 2026-11-08：top 栏两个新入口 =====
// 她说的：「再在她的一生的 top 栏中做一个 skill 开关的 top 选项，然后还有费用计费」。
// 两个都做成浮层，不占一格 tab——它们不是「看什么」，是「现在花多少、模型能看见什么」。

function fmtMoney(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—'
  if (v >= 100) return '¥' + v.toFixed(0)
  if (v >= 10) return '¥' + v.toFixed(1)
  return '¥' + v.toFixed(3)
}

// 浮层壳：半透明遮罩负责「点外面关掉」，不拦事件到按钮上
function MgPop(props) {
  return [
    h('div', { key: 'veil', className: 'mg-veil', onClick: props.onClose }),
    h('div', { key: 'pop', className: 'mg-pop' },
      h('div', { className: 'mg-pop-h' },
        h('b', null, props.title),
        props.sub ? h('span', { className: 'mg-pop-sub' }, props.sub) : null,
        h('span', { className: 'mg-gap' }),
        h('button', { className: 'mg-x', onClick: props.onClose, title: '关掉' }, '×'),
      ),
      props.children,
    ),
  ]
}

function SkillsBody(props) {
  const d = props.data
  if (!d) return h('div', { className: 'mg-pop-empty' }, '读清单中…')
  if (d.ok === false) return h('div', { className: 'mg-pop-empty' }, '读不到 skill 清单：' + (d.error || '未知原因'))
  const rows = d.rows || []
  const q = (props.q || '').trim().toLowerCase()
  const shown = q
    ? rows.filter((r) => (r.name || '').toLowerCase().indexOf(q) >= 0 || (r.desc || '').toLowerCase().indexOf(q) >= 0)
    : rows
  return h('div', null,
    h('div', { className: 'mg-pop-line' },
      h('input', {
        className: 'mg-input', placeholder: '过滤名字 / 描述', value: props.q || '',
        onChange: (e) => props.onQ(e.target.value),
      }),
      h('button', { className: 'mg-btn', onClick: props.onReload, title: '重新问一遍宿主' }, '重读'),
      h('span', { className: 'mg-pop-sub' }, '开 ' + (d.total - (d.offCount || 0)) + ' / 共 ' + d.total),
    ),
    shown.length
      ? shown.map((r) => h('div', { key: r.name, className: 'mg-skill' + (r.on ? '' : ' off') },
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { className: 'mg-skill-n' },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, r.name),
            r.provider === 'ming-skill-isolate' ? h('i', { className: 'mg-tag', title: '只剩遮罩条目，原文件没找到' }, '遮罩') : null,
            r.source === 'bundled' ? h('i', { className: 'mg-tag' }, '自带') : null,
          ),
          h('div', { className: 'mg-skill-d', title: r.desc || '' }, r.desc || '（没有描述）'),
        ),
        h('button', {
          className: 'mg-sw' + (r.on ? ' on' : ''),
          disabled: props.busy === r.name,
          title: r.on ? '关掉：从模型视野里遮掉（不删文件）' : '开回来',
          onClick: () => props.onToggle(r.name, !r.on),
        }, props.busy === r.name ? '…' : (r.on ? '开' : '关')),
      ))
      : h('div', { className: 'mg-pop-empty' }, '没有匹配的'),
    h('div', { className: 'mg-pop-foot' },
      d.source === 'disk'
        ? '⚠ 宿主 skills 服务没接上，这份是从 ~/.dsh/skills 扫出来的——可能比模型真正看到的多。'
        : '清单来自宿主 skills 服务（跟模型看到的是同一份）。',
      ' 开关写 ' + (d.offFile || 'skills-off.json') + '，只对 ' + (d.cwd || '这个工作区') + ' 生效。',
      '改完立刻算数，但当前这一轮的目录已经组装完——下一次请求才刷新。'),
  )
}

// 2026-11-08 16:1x：费用页改成读我们自己的接口 /_dsh/dsh-ming-graph/cost
// 原来读 dsh-bottom-info-bar 的 getUsageSummary，它返回不出数（账本有 token 没价）。
// 现在口径由 cost-lib.mjs 定，页面只负责显示，并把口径原样印在下面。
function MgCostPage(props) {
  const busy = !!props.indexing
  const info = props.indexInfo
  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
          h('path', { d: 'M4 19V5M4 19h16' }),
          h('path', { d: 'M8 16v-5M12.5 16V8M17 16v-3' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '费用'),
        h('div', { className: 'ming-ph-d' }, '用量是账本里的实数；金额按价目折算，不是实际扣款'),
      ),
      h('div', { className: 'ming-ph-a' },
        // 2026-11-10：她加的——没定价的模型，点一下去网上找价；找不到就借最相似的，标出公式
        h('button', {
          className: 'mg-btn',
          disabled: busy,
          title: '给账本里「未定价」的模型去网上搜一次价；找不到就借最相似的那个，并在名字后面标出用的是谁的公式',
          onClick: props.onIndex,
        }, busy ? '索引中…' : '索引费用'),
        h('button', { className: 'mg-btn', onClick: props.onReload }, '重读'),
      ),
    ),
    info ? h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '刚才那次索引'),
        h('span', { className: 'ming-sec-n' }, info.ok === false ? '失败' : (info.message || ((info.summary && info.summary.total) || 0) + ' 个模型')),
      ),
      h('div', { className: 'ming-sec-b' },
        info.ok === false
          ? h('div', { className: 'mg-pop-empty' }, '索引失败：' + (info.error || '未知原因'))
          : h('div', null,
            h('div', { className: 'ming-note' },
              '查到原价 ' + ((info.summary && (info.summary.exact + info.summary.search)) || 0) +
              ' 个 · 借相近模型 ' + ((info.summary && info.summary.similar) || 0) +
              ' 个 · 没找到 ' + ((info.summary && info.summary.none) || 0) + ' 个'),
            (info.results || []).map((r) => h('div', { key: r.model, className: 'ming-note', style: { marginTop: 4 } },
              r.model + ' → ',
              r.from && r.from !== r.model ? ('公式：' + r.from) : (r.price ? '查到了自己的价' : '没找到'),
              r.source ? '　⟵ ' + r.source : '',
              r.note ? '　' + r.note : '')),
          ),
      ),
    ) : null,
    h('div', { className: 'ming-wrap ming-scroll' }, h(CostBody, props)),
  )
}

function SumTokens(x) {
  return (x.input || 0) + (x.cacheRead || 0) + (x.output || 0)
}

function fmtTokens(n) {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}

function CostBody(props) {
  const d = props.data
  if (props.err) {
    return h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'mg-pop-empty' }, '读不到账本：' + props.err),
      ),
    )
  }
  if (!d) return h('div', { className: 'ming-empty' }, '读账本中…')
  if (d.ok === false) {
    return h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'mg-pop-empty' }, '读不到账本：' + (d.error || '未知原因')),
        h('div', { className: 'ming-note' }, '账本在 ~/.dsh/dsh-bottom-info-bar/usage-ledger.sqlite，由那个插件写；它没装或没跑起来时这里就是空的。'),
      ),
    )
  }

  const p = d.periods || {}
  const cell = (label, x) => h('div', { className: 'ming-kpi-c' },
    h('span', { className: 'ming-kpi-n' }, fmtMoney(x ? x.cost : 0)),
    h('span', { className: 'ming-kpi-l' }, label + ' · ' + fmtTokens(x ? SumTokens(x) : 0) + ' tokens'))

  const rows = (p.all && p.all.models) || []
  return [
    h('div', { key: 'sum', className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '花了多少'),
        h('span', { className: 'ming-sec-n' }, '人民币 · 折算'),
      ),
      h('div', { className: 'ming-kpis' },
        cell('今日（北京）', p.today),
        cell('本月', p.month),
        cell('近 30 天', p.d30),
        cell('全部', p.all),
      ),
    ),

    h('div', { key: 'models', className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '按模型'),
        h('span', { className: 'ming-sec-n' }, rows.length + ' 个'),
      ),
      h('div', { className: 'ming-sec-b flush' },
        h('div', { className: 'ming-list' },
          rows.map((m) => h('div', { key: m.model, className: 'ming-li' },
            // 2026-11-10：这条价是拿谁的公式算的——找不到它的价就借最相似的，名字后面直接写出来
            h('span', {
              className: 'ming-li-t',
              style: { flex: '1 1 auto', minWidth: 0, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              title: m.source ? ('价从这儿来：' + m.source) : '',
            },
              m.model,
              m.from && m.from !== m.model
                ? h('span', { className: 'ming-note', style: { marginLeft: 6, opacity: 0.85, whiteSpace: 'nowrap' } }, '（公式：' + m.from + '）')
                : null),
            m.priced ? null : h('span', { className: 'ming-pill', style: { flex: '0 0 auto' }, 'data-tone': 'warn', title: '价目表里没有这个写法，金额按 0 计；点「索引费用」去网上找一个' }, '未定价'),
            h('span', { className: 'ming-note', style: { flex: '0 0 auto', width: 64, textAlign: 'right', whiteSpace: 'nowrap' } }, m.records + ' 次'),
            h('span', { className: 'ming-note', style: { flex: '0 0 auto', width: 120, textAlign: 'right', whiteSpace: 'nowrap' } }, fmtTokens(SumTokens(m)) + ' tok'),
            h('span', { className: 'ming-li-t', style: { flex: '0 0 auto', width: 84, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } }, fmtMoney(m.cost)),
          )),
        ),
      ),
    ),

    h('div', { key: 'basis', className: 'ming-sec' },
      h('div', { className: 'ming-sec-b' },
        h('div', { className: 'ming-note' }, d.basis || ''),
        h('div', { className: 'ming-note' },
          '价目：内置' +
          (d.pricesLayers && d.pricesLayers.auto ? ' + 索引出来的（cost-prices.auto.json）' : '') +
          (d.pricesLayers && d.pricesLayers.manual ? ' + 人工（cost-prices.json，优先级最高）' : ''),
          '　账本：' + (d.ledger || '') + '　读于 ' + String(d.at || '').replace('T', ' ').slice(0, 16)),
      ),
    ),
  ]
}

// ---------------------------------------------------------------------------


// 桌宠整页（2026-11-08）
// 她说的：「变成单独页，不是现在这种浮层；做皮肤切换器，可以自己添加删除皮肤，
// 现在这十五只做默认皮肤。」——所以内置那批是只读的，用户自己加的在下面一格。
// ---------------------------------------------------------------------------
function PetPage() {
  const [s, setS] = useState(null)
  const [skins, setSkins] = useState({ builtin: [], custom: [] })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [newName, setNewName] = useState('')
  const [sched, setSched] = useState(null)
  // 2026-11-08（她提的「桌面那只只能用默认模型」）：模型选择器的数据源。
  //   列表由 mousepet 那句 /models 从宿主 llm 现取；手填那一格是兜底。
  const [models, setModels] = useState(null)
  const [modelDraft, setModelDraft] = useState('')
  // 2026-11-08 16:0x 她说的「ai光标大小改成预设+左右拉条吧」：
  //   拉条拖动时只改本地 draft，松手才落盘——不然拖一次会发几十个 POST。
  const [sizeDraft, setSizeDraft] = useState(null)
  const sizeTimer = useRef(0)
  useEffect(() => { setSizeDraft(s && typeof s.cursorSize === 'number' ? s.cursorSize : null) }, [s])

  const loadSettings = useCallback(() => fetch('/dsh-ming-mousepet/api/settings', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => setS(d && d.settings ? d.settings : null))
    .catch(() => setS(null)), [])

  const loadSkins = useCallback(() => fetch('/dsh-ming-mousepet/api/skins', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => setSkins({ builtin: (d && d.builtin) || [], custom: (d && d.custom) || [] }))
    .catch(() => setSkins({ builtin: [], custom: [] })), [])

  const loadSched = useCallback(() => fetch('/dsh-ming-mousepet/api/schedule', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => setSched(d && d.ok ? d : null))
    .catch(() => setSched(null)), [])

  // 2026-11-08：能选哪些模型由宿主 llm 说了算，页面只负责显示和提交。
  const loadModels = useCallback(() => fetch('/dsh-ming-mousepet/api/models', { cache: 'no-store' })
    .then((r) => r.json())
    .then((d) => setModels(d && d.ok ? d : null))
    .catch(() => setModels(null)), [])

  // 2026-11-08：自动开口的节奏（关 / 心跳 / 随机 / 固定 + 基础间隔 + 每日上限）。
  // 存在 pet-state.json 里，改完下一轮就生效，不用重启 DSH。
  const saveSched = useCallback((patch) => {
    setSched((cur) => (cur ? { ...cur, ...patch } : cur))
    return fetch('/dsh-ming-mousepet/api/schedule', {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.ok) setSched(d); return d })
      .catch(() => null)
  }, [])

  useEffect(() => { loadSettings(); loadSkins(); loadSched(); loadModels() }, [loadSettings, loadSkins, loadSched, loadModels])

  const save = useCallback((patch) => {
    setBusy(true)
    return fetch('/dsh-ming-mousepet/api/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.settings) setS(d.settings); return d })
      .catch(() => null)
      .finally(() => setBusy(false))
  }, [])

  const show = useCallback((on) => {
    fetch('/dsh-ming-mousepet/api/' + (on ? 'show' : 'hide'), { method: 'POST', cache: 'no-store' }).catch(() => null)
  }, [])

  const applySkin = useCallback((key) => {
    setNote('换上了：' + key.replace('custom:', ''))
    save({ cursorState: key })
    show(true)
  }, [save, show])

  const upload = useCallback((file) => {
    if (!file) return
    const base = (newName || file.name.replace(/\.[^.]+$/, '') || 'skin').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'skin'
    const reader = new FileReader()
    reader.onload = () => {
      setBusy(true)
      fetch('/dsh-ming-mousepet/api/skins', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: base, data: String(reader.result) }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d && d.ok) {
            setNote('加好了：' + base)
            setNewName('')
            loadSkins()
            applySkin('custom:' + base)
          } else {
            setNote((d && d.error) || '没加成')
          }
        })
        .catch(() => setNote('上传失败'))
        .finally(() => setBusy(false))
    }
    reader.readAsDataURL(file)
  }, [newName, loadSkins, applySkin])

  const removeSkin = useCallback((name) => {
    setBusy(true)
    fetch('/dsh-ming-mousepet/api/skins?name=' + encodeURIComponent(name), { method: 'DELETE' })
      .then((r) => r.json())
      .then((d) => { setNote(d && d.ok ? '删掉了：' + name : ((d && d.error) || '没删掉')); loadSkins() })
      .catch(() => setNote('删除失败'))
      .finally(() => setBusy(false))
  }, [loadSkins])

  const names = {}
  PET_SKINS.forEach(([k, v]) => { names[k] = v })
  const cur = s ? s.cursorState : ''
  const hasSkinApi = skins.builtin && skins.builtin.length > 0

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
          h('path', { d: 'M5 3l6 9-3 .5 2.5 4.5-2 1-2.5-4.5L4 16z' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '桌宠'),
        h('div', { className: 'ming-ph-d' }, s
          ? '桌面上那只 AI 光标：皮肤、大小、什么时候自己开口。改完立刻生效，不用重启'
          : '鼠标插件没应——没装，或 sidecar 没起来'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('button', { className: 'ming-btn', onClick: () => show(true) }, '亮出来'),
        h('button', { className: 'ming-btn', onClick: () => show(false) }, '收起'),
      ),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },

      // ---- 1. 光标本身 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '光标'),
          h('span', { className: 'ming-sec-n' }, '左键按住能拖走 · 右键有菜单（锁定 / 关掉）'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { className: 'mg-petrow' },
            h('b', null, '大小'),
            [24, 48, 64, 96, 128].map((n) => h('button', {
              key: 'sz' + n,
              className: 'mg-chip' + (s && s.cursorSize === n ? ' on' : ''),
              disabled: busy || !s,
              onClick: () => { setSizeDraft(n); save({ cursorSize: n }) },
            }, String(n))),
            // 2026-11-08 16:1x 她说的「大小能不能实时同步」：拖的时候就跟着变。
            //   只在手上停了 140ms 才落盘一次——曲线是连续的，请求不必也是。
            h('input', {
              type: 'range', min: 24, max: 192, step: 2,
              value: sizeDraft == null ? 64 : sizeDraft,
              disabled: busy || !s,
              title: '拖到哪，桌面那只就变到哪',
              onChange: (e) => {
                const v = Number(e.target.value)
                setSizeDraft(v)
                clearTimeout(sizeTimer.current)
                sizeTimer.current = setTimeout(() => save({ cursorSize: v }), 140)
              },
              style: { flex: '0 1 260px', minWidth: 140, accentColor: 'var(--dsw-alias-brand-primary)' },
            }),
            h('span', { className: 'ming-note', style: { minWidth: 48, fontVariantNumeric: 'tabular-nums' } },
              (sizeDraft == null ? '—' : sizeDraft) + ' px'),
          ),
          h('div', { className: 'mg-petrow' },
            h('b', null, '模式'),
            [['companion', '陪伴（一直亮）'], ['clean', '整洁（用完就收）']].map(([k, label]) => h('button', {
              key: 'md' + k,
              className: 'mg-chip' + (s && s.cursorMode === k ? ' on' : ''),
              disabled: busy || !s,
              onClick: () => save({ cursorMode: k }),
            }, label)),
          ),
        ),
      ),

      // ---- 2. 自动开口的节奏 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '自动开口的节奏'),
          h('span', { className: 'ming-sec-n' }, sched
            ? '今天已经说了 ' + (sched.spokenToday || 0) + ' 句'
            : '读不到节奏设置'),
        ),
        h('div', { className: 'ming-sec-b' },
          sched
            ? h('div', null,
              h('div', { className: 'mg-petrow' },
                h('button', {
                  className: 'mg-btn',
                  title: '关了就完全不自己开口；点回来恢复',
                  style: sched.gapMode === 'off' ? { borderColor: '#ff6b6b', color: '#ff6b6b' } : null,
                  onClick: () => saveSched({ gapMode: sched.gapMode === 'off' ? 'heartbeat' : 'off' }),
                }, sched.gapMode === 'off' ? '关着 ✓' : '开'),
                h('button', {
                  className: 'mg-btn',
                  title: '不限次数 / 每天限几次',
                  style: sched.dailyMax < 0 ? { borderColor: '#6aa9ff', color: '#6aa9ff' } : null,
                  onClick: () => saveSched({ dailyMax: sched.dailyMax < 0 ? 6 : -1 }),
                }, sched.dailyMax < 0 ? '不限 ✓' : '限额'),
                h('span', { className: 'mg-pop-sub' }, '每日'),
                h('input', {
                  className: 'mg-input', type: 'number', min: 0, max: 999, title: sched.dailyMax < 0 ? '现在是不限；点左边「不限 ✓」切回限额' : '一天最多说几句（0 = 不说）',
                  disabled: sched.dailyMax < 0,
                  style: sched.dailyMax < 0 ? { opacity: 0.45 } : null,
                  value: sched.dailyMax < 0 ? '' : sched.dailyMax,
                  onChange: (e) => setSched((cur) => ({ ...cur, dailyMax: Number(e.target.value) })),
                  onBlur: (e) => saveSched({ dailyMax: Number(e.target.value) }),
                }),
                h('span', { className: 'mg-pop-sub' }, '次 · 间隔'),
                h('select', {
                  style: { fontSize: 12, padding: '1px 2px' },
                  value: sched.gapMode,
                  onChange: (e) => saveSched({ gapMode: e.target.value }),
                },
                  h('option', { value: 'fixed' }, '固定'),
                  h('option', { value: 'random' }, '随机'),
                  h('option', { value: 'heartbeat' }, '心跳'),
                ),
                sched.gapMode === 'heartbeat'
                  ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                    h('span', { className: 'mg-pop-sub' }, '最低'),
                    h('input', {
                      className: 'mg-input', type: 'number', min: 1, max: 1440, title: '最短隔多久',
                      value: sched.hbMin,
                      onChange: (e) => setSched((cur) => ({ ...cur, hbMin: Number(e.target.value) })),
                      onBlur: (e) => saveSched({ hbMin: Number(e.target.value) }),
                    }),
                    h('span', { className: 'mg-pop-sub' }, '中位'),
                    h('input', {
                      className: 'mg-input', type: 'number', min: 1, max: 1440, title: '最常落在这个数上',
                      value: sched.hbCenter,
                      onChange: (e) => setSched((cur) => ({ ...cur, hbCenter: Number(e.target.value) })),
                      onBlur: (e) => saveSched({ hbCenter: Number(e.target.value) }),
                    }),
                    h('span', { className: 'mg-pop-sub' }, '最高'),
                    h('input', {
                      className: 'mg-input', type: 'number', min: 1, max: 1440, title: '最长隔多久',
                      value: sched.hbMax,
                      onChange: (e) => setSched((cur) => ({ ...cur, hbMax: Number(e.target.value) })),
                      onBlur: (e) => saveSched({ hbMax: Number(e.target.value) }),
                    }),
                    h('span', { className: 'mg-pop-sub' }, '分'),
                  )
                  : h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                    h('span', { className: 'mg-pop-sub' }, '间隔'),
                    h('input', {
                      className: 'mg-input', type: 'number', min: 1, max: 1440, title: '多少分钟一次（随机模式在这个数上浮动）',
                      value: sched.minGapMinutes,
                      onChange: (e) => setSched((cur) => ({ ...cur, minGapMinutes: Number(e.target.value) })),
                      onBlur: (e) => saveSched({ minGapMinutes: Number(e.target.value) }),
                    }),
                    h('span', { className: 'mg-pop-sub' }, '分'),
                  ),
                sched.nextAt ? h('span', { className: 'mg-pop-sub', style: { whiteSpace: 'nowrap' } },
                  '下次 ≈ ' + new Date(sched.nextAt).toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)) : null,
                h('button', { className: 'mg-btn', onClick: () => loadSched() }, '刷新'),
              ),
            )
            : h('span', { className: 'mg-pop-sub' }, '读不到节奏设置'),
        ),
      ),
      // ---- 2.5 用哪个模型（2026-11-08 她提的：桌面那只不能只能用默认模型）----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '用哪个模型'),
          h('span', { className: 'ming-sec-n' }, models
            ? (models.current.fromSettings ? '按这里选的 · 改完下一句就用新的' : '插件默认 · 还没在这里选过')
            : '读不到模型列表'),
        ),
        h('div', { className: 'ming-sec-b' },
          models
            ? h('div', null,
              h('div', { className: 'mg-petrow' },
                h('b', null, '现在'),
                h('span', { className: 'mg-pop-sub' }, models.current.provider + ' / ' + (models.current.model || '（没设）')),
                models.current.talkerRunning ? null : h('span', { className: 'mg-pop-sub' }, '· 自动开口关着，选了也不开口'),
              ),
              h('div', { className: 'mg-petrow' },
                h('select', {
                  className: 'mg-input',
                  style: { minWidth: 260, maxWidth: 420 },
                  disabled: busy,
                  value: models.current.provider + '||' + models.current.model,
                  onChange: (e) => {
                    const key = String(e.target.value || '')
                    const at = key.indexOf('||')
                    if (at < 0) return
                    save({ talkProvider: key.slice(0, at), talkModel: key.slice(at + 2) })
                  },
                },
                  h('option', { value: '' }, '插件默认（' + models.current.defaultProvider + ' / ' + (models.current.defaultModel || '未设') + '）'),
                  models.providers.map((p) => (p.models && p.models.length
                    ? h('optgroup', { key: 'p-' + p.id, label: p.name },
                      p.models.map((m) => h('option', {
                        key: p.id + '/' + m.id,
                        value: p.id + '||' + m.id,
                      }, m.name && m.name !== m.id ? m.name + '（' + m.id + '）' : m.id)))
                    : h('option', {
                      key: 'p-' + p.id,
                      value: p.id + '||' + models.current.model,
                      disabled: true,
                    }, p.name + (p.error ? '（列不出来）' : '（没有模型目录）')))),
                ),
                h('button', { className: 'mg-btn', disabled: busy, onClick: () => loadModels() }, '刷新'),
              ),
              h('div', { className: 'mg-petrow' },
                h('b', null, '手填'),
                h('input', {
                  className: 'mg-input',
                  style: { minWidth: 200 },
                  placeholder: '模型 id，比如 hy4-preview',
                  value: modelDraft,
                  disabled: busy,
                  onChange: (e) => setModelDraft(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter' && modelDraft.trim()) save({ talkProvider: models.current.provider, talkModel: modelDraft.trim() }) },
                }),
                h('button', {
                  className: 'mg-btn',
                  disabled: busy || !modelDraft.trim(),
                  onClick: () => save({ talkProvider: models.current.provider, talkModel: modelDraft.trim() }),
                }, '用这个'),
                h('button', { className: 'mg-btn', disabled: busy, onClick: () => { setModelDraft(''); save({ talkProvider: '', talkModel: '' }) } }, '恢复默认'),
              ),
              (models.errors && models.errors.length)
                ? h('div', { className: 'mg-pop-sub', style: { marginTop: 4 } }, models.errors.join(' · '))
                : null,
            )
            : h('span', { className: 'mg-pop-sub' }, '读不到模型列表；可以在插件配置里改 companion.model，或者稍后点刷新'),
        ),
      ),

      // ---- 3. 默认皮肤 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '默认皮肤'),
          h('span', { className: 'ming-sec-n' }, '内置十五只，只读'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { className: 'mg-skins' },
            PET_SKINS.map(([k, label]) => h('button', {
              key: 'b-' + k,
              className: 'mg-skin' + (cur === k ? ' on' : ''),
              disabled: busy || !s,
              title: label,
              onClick: () => applySkin(k),
            },
              h('img', { src: '/dsh-ming-mousepet/assets/' + k + '.png', alt: label }),
              h('span', null, label),
            )),
          ),
        ),
      ),

      // ---- 4. 我自己的皮肤 ----
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '我自己的皮肤'),
          h('span', { className: 'ming-sec-n' }, '任意图片都行，会压成 64×64 用'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('div', { className: 'mg-skins' },
            (skins.custom || []).map((k) => h('div', {
              key: 'c-' + k,
              className: 'mg-skinwrap' + (cur === 'custom:' + k ? ' on' : ''),
            },
              h('button', {
                className: 'mg-skin',
                disabled: busy,
                title: k,
                onClick: () => applySkin('custom:' + k),
              },
                h('img', { src: '/dsh-ming-mousepet/api/skin-image?name=' + encodeURIComponent(k), alt: k }),
                h('span', null, k),
              ),
              h('button', {
                className: 'mg-skindel',
                title: '删掉这张',
                disabled: busy,
                onClick: () => removeSkin(k),
              }, '×'),
            )),
            hasSkinApi && (skins.custom || []).length === 0
              ? h('div', { className: 'mg-pop-empty' }, '还没有。下面加一张，随便什么图都行。')
              : null,
          ),
          h('div', { className: 'mg-petrow' },
            h('input', {
              className: 'mg-input',
              placeholder: '给这张皮起个名字（字母数字，可留空）',
              value: newName,
              onChange: (e) => setNewName(e.target.value),
            }),
            h('label', { className: 'mg-btn', style: { cursor: 'pointer' } },
              busy ? '处理中…' : '选图片',
              h('input', {
                type: 'file',
                accept: 'image/*',
                style: { display: 'none' },
                disabled: busy,
                onChange: (e) => { const f = e.target.files && e.target.files[0]; if (f) upload(f); e.target.value = '' },
              }),
            ),
          ),
          note ? h('div', { className: 'ming-note' }, note) : null,
        ),
      ),


    ),
  )

}


// ---- 外部页签宿主（2026-11-10 搬家）----
// 原来建在面板的 useEffect 里：没打开过「她的一生」，宿主就不存在，想挂进来的插件只能退回设置页。
// 现在建在模块级、由 apply 时安装，跟面板开没开无关。
//   window.__MING_TAB_HOST = { add(desc), remove(id), list() }
//   window.__MING_TABS_PENDING = []   ← 早到的先排队，install 时一起收
//   desc = { id, label, order?, render }
const MING_EXT_TABS = []
const MING_EXT_SUBS = new Set()

function mingExtEmit() {
  const snap = MING_EXT_TABS.slice()
  MING_EXT_SUBS.forEach((fn) => { try { fn(snap) } catch (e) { /* 一个订阅者坏了不影响别的 */ } })
}

function mingExtAdd(d) {
  if (!d || !d.id) return
  const i = MING_EXT_TABS.findIndex((x) => x.id === d.id)
  if (i >= 0) MING_EXT_TABS[i] = d
  else MING_EXT_TABS.push(d)
  MING_EXT_TABS.sort((a, b) => (a.order || 100) - (b.order || 100))
  mingExtEmit()
}

function mingExtRemove(id) {
  const i = MING_EXT_TABS.findIndex((x) => x.id === id)
  if (i < 0) return
  MING_EXT_TABS.splice(i, 1)
  mingExtEmit()
}

function mingExtSubscribe(fn) {
  MING_EXT_SUBS.add(fn)
  fn(MING_EXT_TABS.slice())
  return () => { MING_EXT_SUBS.delete(fn) }
}

function mingExtInstall() {
  if (typeof window === 'undefined') return
  window.__MING_TAB_HOST = { add: mingExtAdd, remove: mingExtRemove, list: () => MING_EXT_TABS.slice() }
  const q = window.__MING_TABS_PENDING
  if (Array.isArray(q) && q.length) q.splice(0).forEach(mingExtAdd)
}

function NeuronPanel() {
  const holder = useRef(null)
  const viewRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)
  const [view, setView] = useState('neuron')      // neuron | star
  // 2026-11-07 21:4x：一个选中态穿过三个视图（神经元的搜索 / 星图点星 / 记忆列表）。
  // selRef 是给「挂载那一刻」用的：星图 effect 的闭包里拿不到最新的 selId。
  const [selId, setSelId] = useState('')
  const selRef = useRef('')
  useEffect(() => { selRef.current = selId }, [selId])
  const [q, setQ] = useState('')
  const [ways, setWays] = useState(WAYS.slice())
  const starHost = useRef(null)
  const starRef = useRef(null)
  const [starState, setStarState] = useState('idle')   // idle | loading | ready | error
  const [starErr, setStarErr] = useState('')
  // 2026-11-07 12:30：诊断条。她说「没有图」但没给报错，我不猜了——
  // 把 HTTP 状态、拿到几个节点、mount 有没有抛错直接写在面板上。
  const [starInfo, setStarInfo] = useState('')
  const [starData, setStarData] = useState(null)

  // 2026-11-08：top 栏两件事的状态。pop 是哪个浮层开着（'' / 'skill' / 'cost'）。
  const [pop, setPop] = useState('')
  // 2026-11-08：桌宠设置（鼠标显示 / 大小 / 模式）。数据来自 dsh-ming-mousepet 的设置口。
  const [petCfg, setPetCfg] = useState(null)
  const [petBusy, setPetBusy] = useState(false)
  const [skills, setSkills] = useState(null)
  const [skillQ, setSkillQ] = useState('')
  const [skillBusy, setSkillBusy] = useState('')
  const [cost, setCost] = useState(null)
  // 完整版检测（2026-11-10）：单独装这个插件时，顶栏下面挂一条「完整版在 Hers_Life」
  const [solo, setSolo] = useState(false)
  useEffect(() => {
    fetch('/dsh-ming-mousepet/api/pet-status', { cache: 'no-store' })
      .then((r) => { if (!r.ok) setSolo(true) })
      .catch(() => setSolo(true))
  }, [])
  const [costErr, setCostErr] = useState('')
  // 2026-11-10：「索引费用」——点一下，没定价的模型去网上找价（Host 那边做，见 price-index.mjs）
  const [costIdxBusy, setCostIdxBusy] = useState(false)
  const [costIdxInfo, setCostIdxInfo] = useState(null)

  // ---- 外部页签：订阅模块级的那份清单（2026-11-10 改）----
  // 上一版把宿主建在这里的 useEffect 里，结果「没打开过她的一生」时它根本不存在，
  // 想挂进来的插件只能退回设置页。现在宿主在插件 apply 时就建好（见文件末尾 mingExtInstall）。
  const [extTabs, setExtTabs] = useState(() => MING_EXT_TABS.slice())
  useEffect(() => mingExtSubscribe(setExtTabs), [])

  const loadSkills = useCallback((force) => {
    return fetch(API + '/skills' + (force ? '/refresh' : ''), { cache: 'no-store' })
      .then((r) => {
        // 404 不是「没装」——是宿主那半边还是旧代码（新路由要有重启才注册）。
        // 这两件事分清楚，不然她看到「读不到」只会以为又坏了。
        if (r.status === 404) throw new Error('宿主还是旧版：dsh-ming-graph 的 skills 路由还没注册，重启 DSH 就有了')
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then((d) => setSkills(d && typeof d === 'object' ? d : { ok: false, error: '响应不是对象' }))
      .catch((e) => setSkills({ ok: false, error: String((e && e.message) || e) }))
  }, [])

  const loadPet = useCallback(() => {
    return fetch('/dsh-ming-mousepet/api/settings', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { setPetCfg(d && d.settings ? d.settings : null); return d })
      .catch(() => { setPetCfg(null); return null })
  }, [])

  const petSet = useCallback((patch) => {
    setPetBusy(true)
    return fetch('/dsh-ming-mousepet/api/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then((d) => { if (d && d.settings) setPetCfg(d.settings); return d })
      .catch(() => null)
      .finally(() => setPetBusy(false))
  }, [])

  const petShow = useCallback((on) => {
    return fetch('/dsh-ming-mousepet/api/' + (on ? 'show' : 'hide'), { method: 'POST', cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => null)
  }, [])

  const loadCost = useCallback(() => {
    // 2026-11-08 16:1x：不再读那个插件的 getUsageSummary —— 它的账本有 token 没价
    // （价目表里没有 deepseek-v4.1-flash 这个写法），返回不出数。改成读我们自己的 /cost，
    // 价目表是 live/cost-prices.json，算法在 cost-lib.mjs。
    return fetch(API + '/cost', {
      cache: 'no-store',
    })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { setCost(d || null); setCostErr(d ? '' : '账本没给数（模型/账户还没解析出来）') })
      .catch((e) => setCostErr(String((e && e.message) || e)))
  }, [])

  // 2026-11-10：点「索引费用」——Host 去给未定价的模型搜价，回来顺手把新账塞进 state，
  // 不用再拉一次 /cost（那条要扫七万行 sqlite）。
  const indexCost = useCallback(() => {
    setCostIdxBusy(true)
    setCostIdxInfo(null)
    return fetch(API + '/cost/index', { method: 'POST', cache: 'no-store' })
      .then((r) => {
        if (r.status === 404) throw new Error('宿主还是旧版：cost/index 路由还没注册，重启 DSH 就有了')
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then((d) => {
        setCostIdxInfo(d && typeof d === 'object' ? d : { ok: false, error: '响应不是对象' })
        if (d && d.cost) { setCost(d.cost); setCostErr('') }
      })
      .catch((e) => setCostIdxInfo({ ok: false, error: String((e && e.message) || e) }))
      .finally(() => setCostIdxBusy(false))
  }, [])

  function toggleSkill(name, on) {    setSkillBusy(name)
    fetch(API + '/skills/toggle?name=' + encodeURIComponent(name) + '&on=' + (on ? '1' : '0'), { method: 'POST', cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (d && d.ok) setSkills(d)
        else setSkills((s) => ({ ...(s || {}), ok: false, error: (d && d.error) || '写不进去' }))
      })
      .catch((e) => setSkills((s) => ({ ...(s || {}), ok: false, error: String((e && e.message) || e) })))
      .finally(() => setSkillBusy(''))
  }

  // 2026-11-08 15:27：切到「费用」页就拉一次，别等两分钟轮询。
  useEffect(() => { if (view === 'cost') loadCost() }, [view, loadCost])

  useEffect(() => {
    // 清单进面板就拉一次（很便宜：一次文件读 + 一次服务调用）；费用两分钟一次，
    // 比下面那条 60 秒的账本轮询低频——面板不是账单页，看个大概就够。
    loadSkills(false)
    loadCost()
    const t = setInterval(loadCost, 120000)
    return () => clearInterval(t)
  }, [])

  // force=false 走缓存；force=true 走 /neurons/refresh（Host 重读文件、重新加载 neuron.js）
  const load = useCallback((force) => {
    setBusy(true)
    const url = API + (force ? '/neurons/refresh' : '/neurons')
    return fetch(url, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        // 2026-11-07 22:1x：群号/群名从本机配置下发，不写进代码（这个仓是公开的）。
        if (d && d.roomLabels) { try { window.__MING_ROOMS = d.roomLabels } catch (e) {} }
        if (d && d.error) { setErr(String(d.error)); setStatus('error'); return }
        if (!window.__MingNeuronView) { setErr('渲染层没装上（neuron-view 未加载）'); setStatus('error'); return }
        if (viewRef.current && viewRef.current.destroy) viewRef.current.destroy()
        // 2026-11-07 22:2x：选中态穿过三个视图——神经元点一个点，切到星图/记忆能对上同一条。
        viewRef.current = window.__MingNeuronView.mount(holder.current, d, { onSelect: setSelId })
        if (selRef.current && viewRef.current.select) { try { viewRef.current.select(selRef.current) } catch (e) {} }
        setStatus('ready')
        setErr('')
        setInfo({
          at: d.generatedAt || 0,
          memories: (d.stats && d.stats.memories) || 0,
          edges: (d.stats && d.stats.edges) || 0,
          loadError: d.neuronLoadError || '',
        })
      })
      .catch((e) => { setErr(String((e && e.message) || e)); setStatus('error') })
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => {
    load(false)
    return () => {
      if (viewRef.current && viewRef.current.destroy) { viewRef.current.destroy(); viewRef.current = null }
    }
  }, [])

  // top 栏 → 渲染层：数据不动，只改「看什么」
  useEffect(() => {
    if (viewRef.current && viewRef.current.setQuery) viewRef.current.setQuery(q)
  }, [q, status])

  useEffect(() => {
    if (viewRef.current && viewRef.current.setWayFilter) viewRef.current.setWayFilter(ways)
  }, [ways, status])

  function toggleWay(t) {
    setWays((cur) => (cur.indexOf(t) >= 0 ? cur.filter((x) => x !== t) : cur.concat([t])))
  }

  const memRef = useRef(null)
  const [reloadTick, setReloadTick] = useState(0)
  // 2026-11-07 18:3x：星图那份 unified 是带缓存的。记忆卡刚生成、面板还显示 0 章，
  // 就是因为重挂只会再打一次 /neurons/unified（命中缓存）。点刷新要强制重建。
  const forceStar = useRef(false)

  // 导出：三个视图都出东西——神经元出图、星图出统一模型、记忆出当前列表。
  function exportJson() {
    let snap = null
    let tag = 'neurons'
    if (view === 'neuron') {
      snap = viewRef.current && viewRef.current.snapshot ? viewRef.current.snapshot() : null
    } else if (view === 'star') {
      snap = starData; tag = 'unified'
    } else if (view === 'memory') {
      snap = memRef.current; tag = 'archive'
    }
    if (!snap) return
    const blob = new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ming-' + tag + '-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  }

  function refreshAll() {
    setReloadTick((t) => t + 1)
    setQ('')
    if (view === 'neuron') load(true)
    if (view === 'star') forceStar.current = true
  }

  // 星图：吃同一份统一节点模型（/neurons/unified），画法在 src/star-view.js
  useEffect(() => {
    if (view !== 'star') {
      if (starRef.current && starRef.current.destroy) { starRef.current.destroy(); starRef.current = null }
      setStarState('idle')
      return
    }
    setStarState('loading')
    let alive = true
    const starUrl = API + (forceStar.current ? '/neurons/unified/refresh' : '/neurons/unified')
    forceStar.current = false
    fetch(starUrl, { cache: 'no-store' })
      .then((r) => {
        setStarInfo('HTTP ' + r.status)
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then((d) => {
        if (d && d.roomLabels) { try { window.__MING_ROOMS = d.roomLabels } catch (e) {} }
        if (!alive) return
        if (d && d.error) { setStarErr(String(d.error)); setStarState('error'); return }
        if (!window.__MingNeuronView) { setStarErr('渲染层没装上（neuron-view 未加载）'); setStarState('error'); return }
        const nNodes = (d.nodes || []).length
        setStarInfo(`HTTP 200 · 节点 ${nNodes} · ${d.stats && d.stats.source || ''}`)
        // 2026-11-07 15:00：不画 canvas 了，改用 DOM 版银河（src/star-view.js 重写）。
        // 这一版每个点是一个 div，画不出来只可能是「没挂上」，不可能是「画错了」。
        const SV = window.__MingStarView
        if (!SV) { setStarErr('星图渲染层没装上（star-view 未加载）'); setStarState('error'); return }
        try {
          if (starRef.current && starRef.current.destroy) starRef.current.destroy()
          starRef.current = SV.mount(starHost.current, d, { onSelect: setSelId, initialId: selRef.current })
          const st = (starRef.current.stats && starRef.current.stats()) || {}
          setStarInfo('节点 ' + nNodes + ' · 已画 ' + (st.dots || 0) + ' 点 · ' + (st.size ? st.size[0] + '×' + st.size[1] : '') + ' · ' + ((d.stats && d.stats.source) || ''))
          setStarState('ready')
        } catch (e) {
          setStarErr('挂载失败：' + String((e && e.message) || e))
          setStarState('error')
        }
      })
      .catch((e) => { if (alive) { setStarErr(String((e && e.message) || e)); setStarState('error') } })
    return () => { alive = false }
  }, [view, reloadTick])


  const when = info && info.at ? new Date(info.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''
  const meta = info
    ? `更新于 ${when} · ${info.memories} 条记忆 / ${info.edges} 条线${info.loadError ? ' · 建图代码加载失败，用的是旧模块' : ''}`
    : ''

  // 星图那一格：真的接上了（2026-11-07），数据来自 /neurons/unified，画法是 src/star-view.js。

  return h('div', { className: 'mg-mount' },
    h('style', null, PAGE_CSS + MING_UI.css('ming')),
    solo ? h('div', { style: { margin: '0 14px 8px', padding: '7px 12px', border: '1px solid rgba(217,164,65,.45)', borderRadius: '8px', fontSize: '11.5px', lineHeight: '1.7', color: 'var(--dsw-alias-label-secondary, #b8b8c4)' } },
      '这是单独安装的版本。完整版在 ',
      h('a', { href: 'https://github.com/Chess12333/Hers_Life', target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-brand-primary, #6aa9ff)' } }, 'Hers_Life'),
      ' 更新。') : null,

    // ---- top 栏：全局操作 ----
    h('div', { className: 'mg-top' },
      // 2026-11-07 21:53 她定：名字用回「她的一生」，括号里挂 hers life。
      // 上一轮我起的「家底」她不要——名字是她的，我改回来，理由记在 live/星图合并 里。
      h('span', { className: 'mg-brand' }, '她的一生', h('i', null, 'hers life')),
      // tab 分两组：竖线左边是记下来的，右边是我干活用的。
      h('div', { className: 'mg-seg' },
        [['neuron', '神经元'], ['star', '星图'], ['memory', '记忆'], ['|'],
          ['browse', '自己玩'], ['interest', '兴趣'], ['voice', '声音'], ['discord', 'Discord'],
          // 2026-11-10 她定的：「桌宠也去掉吧，就保留光标就可以了」。
          // 桌宠那页是本机专用的，光标页才是"谁装谁有"的那一个——自己用和发出去要同一套。
          ['cost', '费用'], ['|']]
          // 2026-11-08 03:4x：桌面 tab 一起去掉。它的数据来自 /_dsh/dsh-ming-desktop，
          //   那个插件 11-08 被 mousepet 取代后停用，接口实测 404，点开是一格空的。
          .map(([k, label]) => k === '|'
            ? h('span', { key: 'sep', style: { width: 1, height: 18, background: 'var(--dsw-alias-border-secondary, rgba(150,150,170,.28))', margin: '0 4px', alignSelf: 'center' } })
            : h('button', { key: k, className: view === k ? 'on' : '', onClick: () => setView(k) }, label))
          // 外部页签（2026-11-09）：别的插件挂进来的，接在内置 tab 之后，靠 order 排。
          .concat(extTabs.map((t) => h('button', {
            key: 'ext-' + t.id,
            className: view === 'ext:' + t.id ? 'on' : '',
            title: t.title || '',
            onClick: () => setView('ext:' + t.id),
          }, t.label || t.id))),
        // 2026-11-08 15:27：费用改成独立页（view='cost'），不再是浮层。
      ),
      h('span', { className: 'mg-gap' }),
      // 2026-11-08：skill 开关（关掉的不进系统提示词，按工作区生效）
      h('button', {
        className: 'mg-btn' + (pop === 'skill' ? ' on' : ''),
        title: '按工作区开关 skill：关掉的不再进系统提示词，文件不动',
        onClick: () => { const next = pop === 'skill' ? '' : 'skill'; setPop(next); if (next) loadSkills(false) },
      }, skills && skills.total
        ? 'skill ' + (skills.total - (skills.offCount || 0)) + '/' + skills.total
        : (skills && skills.ok === false ? 'skill 读不到' : 'skill')),
    ),

    // ---- 2026-11-08 15:5x：这三个视图自己画布、没有子页头，所以壳这边给一个 ----
    // 她说的「至少要分清哪一块是哪一块」——原来这里只有一行灰色小字，跟下面的画布糊在一起。
    // 自己玩/兴趣/声音/桌宠/费用/接续各自已经有页头了，这里不重复。
    (view === 'neuron' || view === 'star' || view === 'memory')
      ? h('div', { className: 'ming-ph' },
        h('div', { className: 'ming-ph-ic' },
          h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
            view === 'neuron'
              ? [h('circle', { key: 'a', cx: 6, cy: 7, r: 2 }), h('circle', { key: 'b', cx: 18, cy: 6, r: 2 }),
                h('circle', { key: 'c', cx: 12, cy: 17, r: 2 }), h('path', { key: 'd', d: 'M8 8l8 2M7 9l4 6M17 8l-4 7' })]
              : view === 'star'
                ? [h('path', { key: 'a', d: 'M12 3l2.2 5.6L20 10l-5.8 1.4L12 17l-2.2-5.6L4 10l5.8-1.4z' }),
                  h('path', { key: 'b', d: 'M18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z' })]
                : [h('rect', { key: 'a', x: 4, y: 3, width: 16, height: 18, rx: 2 }),
                  h('path', { key: 'b', d: 'M8 7h8M8 11h8M8 15h5' })]),
        ),
        h('div', { className: 'ming-ph-tx' },
          h('div', { className: 'ming-ph-t' },
            view === 'neuron' ? '神经元' : view === 'star' ? '星图' : '记忆'),
          h('div', { className: 'ming-ph-d' },
            view === 'memory' ? '只读，点一行看正文'
              : view === 'neuron' ? (status === 'ready' ? meta : '正在读两侧记忆库…（第一次要扫一遍文件，大约两秒）')
                : (starState === 'error' ? '读不到：' + starErr
                  : starState === 'ready' ? ('统一节点模型 · ' + (starInfo || '已加载'))
                    : '正在拼统一节点模型…')),
        ),
        h('div', { className: 'ming-ph-a' },
          h('button', {
            className: 'mg-btn',
            disabled: view === 'neuron' ? status !== 'ready' : (view === 'star' ? starState !== 'ready' : false),
            onClick: exportJson,
            title: view === 'memory' ? '导出当前这份归档列表' : (view === 'star' ? '导出统一节点模型' : '把这整份图导出成 JSON'),
          }, '导出'),
          h('button', {
            className: 'mg-btn',
            disabled: busy,
            title: '重读数据源（神经元顺带重新加载建图代码）',
            onClick: refreshAll,
          }, busy ? '刷新中…' : '刷新'),
        ),
      )
      : null,

    // ---- 工具条：搜索三个视图共用（神经元过滤节点 / 星图找一颗星 / 记忆过滤列表）；
    //      关系类型只有神经元用得上。从 top 栏搬下来，免得一屏里全是控件。 ----
    (view === 'neuron' || view === 'star' || view === 'memory')
      ? h('div', { className: 'mg-tools' },
        h('input', {
          className: 'mg-input',
          placeholder: view === 'memory' ? '按 id / 标签 / 来源过滤' : (view === 'star' ? '找一颗星：标题或正文里的词' : '搜标题 / 正文里的词'),
          value: q,
          onChange: (e) => setQ(e.target.value),
        }),
        view === 'neuron'
          ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { className: 'mg-tools-l' }, '关系'),
            WAYS.map((t) => h('button', {
              key: t,
              className: 'mg-chip' + (ways.indexOf(t) >= 0 ? ' on' : ''),
              disabled: status !== 'ready',
              title: '关掉这一类边，节点不删',
              onClick: () => toggleWay(t),
            }, t)),
          )
          : null,
      )
      : null,

    // 2026-11-07 12:37：报错 `Cannot set properties of null (setting 'innerHTML')`。
    // 根因：星图那个 div 是条件渲染的，effect 跑的那一瞬 ref 还是 null，mount 里 host.innerHTML 就炸在这。
    // 改成**两个容器都常驻**、只用 display 切换：ref 从挂载起一直有效，切换时不再有「还没有节点」的空窗。
    // 记忆库（跟另外两块并列，同样靠 display 切换；切走就卸载，省得一直挂着轮询）
    h('div', { key: 'mem' + reloadTick, className: 'mg-holder', style: view === 'memory' ? null : { display: 'none' } },
      view === 'memory' ? h(MemoryView, { q, selId, onSelect: setSelId, onData: (d) => { memRef.current = d } }) : null,
    ),
    // 逛到哪儿 / 兴趣 / 声音：从各自的插件搬进来的渲染，路由还是各自的
    h('div', { key: 'browse' + reloadTick, className: 'mg-holder', style: view === 'browse' ? null : { display: 'none' } },
      view === 'browse' ? h(BrowsePanel) : null,
    ),
    h('div', { key: 'interest' + reloadTick, className: 'mg-holder', style: view === 'interest' ? null : { display: 'none' } },
      view === 'interest' ? h(InterestPanel) : null,
    ),
    h('div', { key: 'voice' + reloadTick, className: 'mg-holder', style: view === 'voice' ? null : { display: 'none' } },
      view === 'voice' ? h(VoicePanel) : null,
    ),
    h('div', { key: 'discord' + reloadTick, className: 'mg-holder', style: view === 'discord' ? null : { display: 'none' } },
      view === 'discord' ? h(DiscordPanel) : null,
    ),
    // 2026-11-10 她定的：桌宠页拿掉，功能并进「光标」页（外部插件挂进来的那个）。
    // 这里保留 PetPage 的定义和 import，别删——并回去的时候不用从头写。
    // 2026-11-08 15:27 她：「费用也做成独立页而不是弹窗栏」。
    h('div', { key: 'cost' + reloadTick, className: 'mg-holder', style: view === 'cost' ? null : { display: 'none' } },
      view === 'cost' ? h(MgCostPage, {
        data: cost, err: costErr, onReload: loadCost,
        onIndex: indexCost, indexing: costIdxBusy, indexInfo: costIdxInfo,
      }) : null,
    ),
    h('div', { key: 'resume' + reloadTick, className: 'mg-holder', style: view === 'resume' ? null : { display: 'none' } },
      view === 'resume' ? h(ResumePanel) : null,
    ),
    // 外部页签（2026-11-09）：所有挂进来的共用一个 holder，只渲染当前那一个。
    h('div', { key: 'ext' + reloadTick, className: 'mg-holder', style: String(view).indexOf('ext:') === 0 ? null : { display: 'none' } },
      extTabs.map((t) => (view === 'ext:' + t.id && typeof t.render === 'function' ? h(t.render, { key: t.id }) : null)),
    ),

    h('div', {
      ref: holder, className: 'mg-holder',
      style: view === 'neuron' && status === 'ready' ? null : { display: 'none' },
    }),
    // 星图：DOM 版银河（src/star-view.js），mount 到这个 ref；切走就 destroy，别让 1271 个 div 一直挂着。
    // 2026-11-07 18:1x：这个 div 里**只能有我挂的东西**。上一版把「加载中/读不到」两行字也渲染在里面，
    // star-view 挂载时 host.innerHTML='' 把它们清掉了，React 回头要删这两行 —— 它已经不在 DOM 里，
    // 于是 NotFoundError: removeChild。提示挪到外面，容器本身永远空着。
    h('div', { className: 'mg-holder', style: view === 'star' ? null : { display: 'none' } },
      starState === 'loading' ? h('div', { className: 'mg-msg' }, '正在拼统一节点模型…') : null,
      starState === 'error' ? h('div', { className: 'mg-msg err' }, '星图读不到：' + starErr) : null,
      h('div', { ref: starHost, style: { flex: 1, minHeight: '420px', display: 'flex', flexDirection: 'column' } }),
    ),

    view === 'neuron' && status === 'loading' ? h('div', { className: 'mg-msg' }, '正在读两侧记忆库…（第一次要扫一遍文件，大约两秒）') : null,
    view === 'neuron' && status === 'error' ? h('div', { className: 'mg-msg err' }, '读不到：' + err) : null,

    // 2026-11-08：两个 top 浮层。锚在 .mg-mount 上（它 position:relative），遮罩负责点外面关掉。
    pop === 'skill' ? h(MgPop, {
      key: 'pop-skill',
      title: 'skill 开关',
      sub: skills && skills.source === 'disk' ? '磁盘兜底（宿主的 skills 服务没接上）' : '',
      onClose: () => setPop(''),
    }, h(SkillsBody, {
      data: skills,
      q: skillQ,
      busy: skillBusy,
      onQ: setSkillQ,
      onReload: () => loadSkills(true),
      onToggle: toggleSkill,
    })) : null,

  )
}


// ---------------------------------------------------------------------------
// 设置页 · 身份与称呼（2026-11-10）
//
// 为什么放在这儿：原先挂在 dsh-ming-memory 的 client 上，靠它 apply 时 add，
// 真机上那条路断了（inject 抛错 → 后面不执行）。改成「她的一生」自己的一页：
// 组件就在本 bundle 里、apply 时同步 add，不赌别的插件加载顺序。
// 保留兼容路径 /_dsh/dsh-ming-memory/identity；实际 GET / POST 由本 bundle 的 index.js 注册。
const IDENTITY_ROUTE = '/_dsh/dsh-ming-memory/identity'

const ID_FIELDS = [
  { key: 'selfName', label: '我自己叫什么', hint: '平时被叫的那个（昵称）', ph: '大肥鱼' },
  { key: 'selfFullName', label: '全名', hint: '正式场合、生气的时候用', ph: '大肥鱼' },
  { key: 'userName', label: '我该怎么叫你', hint: '它说话时会用这个称呼', ph: '主人' },
  { key: 'qqName', label: 'QQ 那边的名字', hint: '留空就跟第一个一样', ph: '（留空）' },
]

function IdentityPanel() {
  const [form, setForm] = useState(null)
  const [onboarded, setOnboarded] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setError('')
    fetch(IDENTITY_ROUTE, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!d || !d.ok) throw new Error((d && d.error) || '读不到')
        setForm({
          selfName: d.identity.selfName || '',
          selfFullName: d.identity.selfFullName || '',
          selfDesc: d.identity.selfDesc || '',
          userName: d.identity.userName || '',
          qqName: d.identity.qqName || '',
          identity: d.identity.identity !== false,
        })
        setOnboarded(!!d.onboarded)
      })
      .catch((e) => setError('读不到设置：' + (e && e.message ? e.message : e)))
  }, [])

  useEffect(() => { load() }, [load])

  const save = useCallback((patch) => {
    const next = Object.assign({}, form, patch || {})
    setForm(next)
    setBusy(true); setNote(''); setError('')
    fetch(IDENTITY_ROUTE, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d || !d.ok) throw new Error((d && d.error) || '没存上')
        setOnboarded(true)
        setNote('存好了。重启 DSH 之后生效。')
      })
      .catch((e) => setError('没存上：' + (e && e.message ? e.message : e)))
      .then(() => setBusy(false), () => setBusy(false))
  }, [form])

  const inputStyle = {
    width: '100%', maxWidth: '360px', padding: '8px 11px', borderRadius: '9px', fontSize: '13.5px',
    border: '1px solid var(--dsw-alias-border-primary, rgba(150,150,170,.32))',
    background: 'var(--dsw-alias-bg-base, transparent)', color: 'var(--dsw-alias-text-primary)',
  }

  if (!form) {
    return h('div', { className: 'mg-msg' }, error || '正在读设置…')
  }

  return h('div', { style: { padding: '18px 20px 24px', maxWidth: '860px' } },
    !onboarded ? h('div', {
      style: {
        margin: '0 0 18px', padding: '16px 18px', borderRadius: '14px',
        border: '1px solid var(--dsw-alias-brand-primary, #6f9dff)',
        background: 'rgba(111,157,255,.10)',
      },
    },
      h('div', { style: { fontSize: '16px', fontWeight: 600, margin: '0 0 6px' } }, '先给它起个名字'),
      h('div', { style: { fontSize: '13px', lineHeight: 1.8 } },
        '这套插件会把「你是谁」写进每个会话的开场。默认是通用名（大肥鱼 / 主人），不是某个人的名字——',
        '改成你想要的，点「就这样开始」。以后随时在这一页改。')) : null,

    h('div', { style: { fontSize: '15px', fontWeight: 600, margin: '0 0 14px' } },
      onboarded ? '身份与称呼' : '三步填完'),

    ID_FIELDS.map((f) => h('label', { key: f.key, style: { display: 'block', margin: '0 0 14px' } },
      h('div', { style: { fontSize: '13px', margin: '0 0 4px' } }, f.label),
      h('input', {
        value: form[f.key], placeholder: f.ph, style: inputStyle,
        onChange: (e) => setForm(Object.assign({}, form, { [f.key]: e.target.value })),
      }),
      h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary)', marginTop: '4px' } }, f.hint))),

    h('label', { style: { display: 'block', margin: '0 0 14px' } },
      h('div', { style: { fontSize: '13px', margin: '0 0 4px' } }, '自称那一句'),
      h('input', {
        value: form.selfDesc, placeholder: '一个 AI，不是人',
        style: Object.assign({}, inputStyle, { maxWidth: '520px' }),
        onChange: (e) => setForm(Object.assign({}, form, { selfDesc: e.target.value })),
      }),
      h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-text-secondary)', marginTop: '4px' } },
        '拼成「你是<名字>（全名<全名>），<这一句>。」')),

    h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 18px', fontSize: '13px' } },
      h('input', {
        type: 'checkbox', checked: form.identity !== false,
        onChange: (e) => setForm(Object.assign({}, form, { identity: e.target.checked })),
      }),
      '把身份写进开场（关掉就只搬记忆、不带人格）'),

    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('button', { disabled: busy, onClick: () => save(), className: 'on' },
        busy ? '存…' : (onboarded ? '保存' : '就这样开始')),
      h('button', { disabled: busy, onClick: load }, '重新读')),

    h('div', { className: 'mg-msg', style: { minHeight: '18px' } }, note),
    h('div', { className: 'mg-msg err', style: { minHeight: '18px' } }, error))
}

return {
  inject: ['slots'],
  apply(ctx) {
    // 宿主随插件一起来，不等面板被打开（2026-11-10）
    mingExtInstall()

    // 设置页（2026-11-10）：自己挂进自己的页签列表，order 95 排在「光标」(60) 之后。
    // 同步 add —— install 收 pending 的那一刻就把它收进去，不等任何网络请求。
    try {
      if (typeof window !== 'undefined') {
        const desc = {
          id: 'ming-settings',
          label: '设置',
          order: 95,
          title: '身份与称呼：我叫什么、它怎么叫你、要不要带身份',
          render: IdentityPanel,
        }
        if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') {
          window.__MING_TAB_HOST.add(desc)
        } else {
          ;(window.__MING_TABS_PENDING || (window.__MING_TABS_PENDING = [])).push(desc)
        }
      }
    } catch (e) { /* 页签挂了也别影响面板本身 */ }
    // B 站账号页：由 B 站插件提供本机凭证 API，壳只负责显示设置界面。
    try {
      if (typeof window !== 'undefined') {
        const biliDesc = {
          id: 'ming-bilibili',
          label: 'B站',
          order: 85,
          title: 'B 站账号、字幕与社交功能共用的本机登录状态',
          render: MingBilibiliPanel,
        }
        if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') {
          window.__MING_TAB_HOST.add(biliDesc)
        } else {
          ;(window.__MING_TABS_PENDING || (window.__MING_TABS_PENDING = [])).push(biliDesc)
        }
      }
    } catch (e) { /* B 站页签挂了也不影响主面板 */ }

    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: 'ming-graph',
    }, () => h(PanelBoundary, null, h(NeuronPanel))))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'ming-graph',
      order: 22,
      label: () => PANEL_LABEL,
    }, GraphIcon))
  },
}

  },
})
