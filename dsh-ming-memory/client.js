/**
 * dsh-ming-memory —— 记忆库面板（Client 半端）
 *
 * ⚠ 生成物：改 src/panel.js 或 ../dsh-ming-ui/src/theme.js，然后 node build.mjs
 *
 * 入口：左侧图标栏一个图标（sidebar.panellist → 记忆），点开占满主区域（main key = ming-memory）。
 * 数据来自 Host 半端 /_dsh/dsh-ming-memory/{list,read}，只读，不经过模型。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ming-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

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
 * dsh-ming-memory —— 记忆库面板（Client 半端源码）
 *
 * 这一段会被 build.mjs 拼进 client.js 的 factory 里，所以能直接用外层的
 * h / React / useState 这些，不需要自己 import。
 *
 * 只读：列归档记忆、按关键词过滤、点开看正文。
 * 数据来自 Host 半端 /_dsh/dsh-ming-memory/{list,read}，不经过模型。
 *
 * 2026-11-08 15:5x：整页重排——页头 + 一条搜索 + 一个「归档」区块。
 * 原来是标题、条数、搜索框、刷新全挤在一行，下面直接是一长条没有边界的行。
 */
const MEMORY_API = '/_dsh/dsh-ming-memory'

function useMemoryStyle() {
  useEffect(() => {
    const id = 'ming-memory-style'
    if (document.getElementById(id)) return
    const el = document.createElement('style')
    el.id = id
    el.textContent = MING_UI.css('ming') + `
.ming-mem-list { display: flex; flex-direction: column; }
.ming-mem-item { cursor: pointer; }
.ming-mem-item[data-active="1"] { background: var(--dsw-alias-interactive-bg-active); }
.ming-mem-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ming-mem-body { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.7; }
.ming-mem-input { flex: 1 1 auto; width: 100%; font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); box-sizing: border-box; }
`
    document.head.appendChild(el)
  }, [])
}

function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function MemoryPanel() {
  useMemoryStyle()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [openFile, setOpenFile] = useState('')
  const [body, setBody] = useState('')

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(MEMORY_API + '/list', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (d && d.error) { setErr(String(d.error)); return }
        setItems(Array.isArray(d.items) ? d.items : [])
        setTotal(d.total || 0)
      })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const readOne = useCallback((file) => {
    setOpenFile(file)
    setBody('')
    fetch(MEMORY_API + '/read?f=' + encodeURIComponent(file), { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d.error) setBody('△ ' + d.error); else setBody(d.body || '') })
      .catch((e) => setBody('△ ' + String((e && e.message) || e)))
  }, [])

  const kw = q.trim().toLowerCase()
  const shown = kw
    ? items.filter((it) => (it.id + ' ' + it.tags + ' ' + it.source).toLowerCase().includes(kw))
    : items

  if (openFile) {
    const it = items.find((x) => x.file === openFile) || {}
    return h('div', { className: 'ming-page' },
      h('div', { className: 'ming-ph' },
        h('button', { className: 'ming-btn', onClick: () => { setOpenFile(''); setBody('') } }, '← 返回'),
        h('div', { className: 'ming-ph-tx' },
          h('div', { className: 'ming-ph-t' }, it.id || openFile),
          h('div', { className: 'ming-ph-d' },
            [it.status ? '状态 ' + it.status : '', it.source ? '来源 ' + it.source : '', fmtTime(it.mtime)]
              .filter(Boolean).join(' · ')),
        ),
      ),
      h('div', { className: 'ming-wrap ming-scroll' },
        h('div', { className: 'ming-sec' },
          h('div', { className: 'ming-sec-h' },
            h('span', { className: 'ming-sec-t' }, '正文'),
            h('span', { className: 'ming-sec-n' }, openFile),
          ),
          h('div', { className: 'ming-sec-b ming-mem-body' }, body || '…'),
        ),
      ),
    )
  }

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(MemoryIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '记忆库'),
        h('div', { className: 'ming-ph-d' }, '跨会话存下来的归档记忆，只读；点一行看正文'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, busy ? '读取中…' : total + ' 条'),
        h('button', { className: 'ming-btn', onClick: load }, '刷新'),
      ),
    ),

    // 搜索单独一行：跟条数、刷新挤在一起的时候，没人看得出这是个输入框
    h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--dsw-alias-separator-secondary)' } },
      h('input', {
        className: 'ming-mem-input',
        placeholder: '按 id / 标签 / 来源过滤',
        value: q,
        onChange: (e) => setQ(e.target.value),
      }),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,
      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '归档'),
          h('span', { className: 'ming-sec-n' }, shown.length + ' 条' + (kw ? '（筛过的）' : '')),
        ),
        (!err && !shown.length)
          ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, busy ? '…' : '没有匹配的记忆'))
          : h('div', { className: 'ming-sec-b flush' },
            h('div', { className: 'ming-mem-list ming-list' },
              shown.map((it) => h('div', {
                key: it.file,
                className: 'ming-li ming-mem-item',
                onClick: () => readOne(it.file),
                title: it.id,
              },
                h('span', { className: 'ming-mem-name', style: it.deleted ? { opacity: 0.5 } : null }, it.id),
                it.status ? h('span', { className: 'ming-pill', 'data-tone': it.status === 'active' ? 'ok' : undefined }, it.status) : null,
                it.deleted ? h('span', { className: 'ming-pill', 'data-tone': 'danger' }, '已删') : null,
                h('span', { className: 'ming-note' }, fmtTime(it.mtime)),
              )),
            ),
          ),
      ),
    ),
  )
}

function MemoryIcon() {
  return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }),
    h('path', { d: 'M8 7h8M8 11h8M8 15h5' }),
  )
}

// ---------------------------------------------------------------------------
// 设置页（2026-11-10 浔要的）：預設稱呼／全名／自稱描述／對方稱呼／是否注入身份。
//
// 挂在她的一生顶栏最右边（光标之后）。第一次装好、还没配过的时候，这一页顶上先摆一页向导：
// 三格填完点「就这样开始」，写进 ~/.dsh/ming-memory.json 的 identityOnboarded=true，下次不再出现。
//
// 数据走 Host 半端 /_dsh/dsh-ming-memory/identity（GET 读、POST 写整份 json，别的键原样保留）。
// 改完要重启 DSH —— 注入文本是启动时算的，文件改了这一轮不会自己变。
const IDENTITY_ROUTE = '/_dsh/dsh-ming-memory/identity'

const ID_FIELDS = [
  { key: 'selfName', label: '我自己叫什么', hint: '平时被叫的那个（昵称）', ph: '大肥鱼' },
  { key: 'selfFullName', label: '全名', hint: '正式场合、生气的时候用', ph: '大肥鱼' },
  { key: 'userName', label: '我该怎么叫你', hint: '它说话时会用这个称呼', ph: '主人' },
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

  if (!form) {
    return h('div', { style: { padding: '26px 28px', color: 'var(--dsw-alias-text-2)' } },
      error ? h('div', { style: { color: 'var(--dsw-alias-danger, #ff8b8b)' } }, error) : '正在读设置…')
  }

  const field = (f) => h('label', { key: f.key, style: { display: 'block', margin: '0 0 14px' } },
    h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-text-1)', margin: '0 0 4px' } }, f.label),
    h('input', {
      value: form[f.key], placeholder: f.ph,
      onChange: (e) => setForm(Object.assign({}, form, { [f.key]: e.target.value })),
      style: {
        width: '100%', maxWidth: '360px', padding: '8px 11px', borderRadius: '9px', fontSize: '13.5px',
        border: '1px solid var(--dsw-alias-border-1, rgba(255,255,255,.16))',
        background: 'var(--dsw-alias-bg-2, rgba(0,0,0,.2))', color: 'var(--dsw-alias-text-1)',
      },
    }),
    f.hint ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-text-2)', marginTop: '4px' } }, f.hint) : null)

  return h('div', { style: { padding: '18px 20px 26px', maxWidth: '880px' } },
    !onboarded ? h('div', {
      style: {
        margin: '0 0 18px', padding: '16px 18px', borderRadius: '14px',
        border: '1px solid var(--dsw-alias-accent-1, #6f9dff)',
        background: 'color-mix(in srgb, var(--dsw-alias-accent-1, #6f9dff) 12%, transparent)',
      },
    },
      h('div', { style: { fontSize: '16px', fontWeight: 600, margin: '0 0 6px', color: 'var(--dsw-alias-text-1)' } }, '先给它起个名字'),
      h('div', { style: { fontSize: '13px', lineHeight: 1.8, color: 'var(--dsw-alias-text-1)' } },
        '这套插件会把「你是谁」写进每个会话的开场。默认是通用名（大肥鱼 / 主人），不是某个人的名字——',
        '把下面几格改成你想要的，然后点「就这样开始」。以后随时能在这一页改。')) : null,

    h('div', { style: { fontSize: '15px', fontWeight: 600, margin: '0 0 12px', color: 'var(--dsw-alias-text-1)' } },
      onboarded ? '身份与称呼' : '三步填完'),

    ID_FIELDS.map(field),

    h('label', { style: { display: 'block', margin: '0 0 14px' } },
      h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-text-1)', margin: '0 0 4px' } }, '自称那一句'),
      h('input', {
        value: form.selfDesc, placeholder: '一个 AI，不是人',
        onChange: (e) => setForm(Object.assign({}, form, { selfDesc: e.target.value })),
        style: {
          width: '100%', maxWidth: '520px', padding: '8px 11px', borderRadius: '9px', fontSize: '13.5px',
          border: '1px solid var(--dsw-alias-border-1, rgba(255,255,255,.16))',
          background: 'var(--dsw-alias-bg-2, rgba(0,0,0,.2))', color: 'var(--dsw-alias-text-1)',
        },
      }),
      h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-text-2)', marginTop: '4px' } },
        '拼成「你是<名字>（全名<全名>），<这一句>。」')),

    h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 18px', fontSize: '13px', color: 'var(--dsw-alias-text-1)' } },
      h('input', {
        type: 'checkbox', checked: form.identity !== false,
        onChange: (e) => setForm(Object.assign({}, form, { identity: e.target.checked })),
      }),
      '把身份写进开场（关掉就只搬记忆、不带人格）'),

    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('button', {
        disabled: busy, onClick: () => save(),
        style: {
          padding: '9px 20px', borderRadius: '10px', border: 0, cursor: 'pointer', fontSize: '13.5px', fontWeight: 600,
          background: 'var(--dsw-alias-accent-1, #6f9dff)', color: '#fff', opacity: busy ? 0.6 : 1,
        },
      }, busy ? '存…' : (onboarded ? '保存' : '就这样开始')),
      h('button', {
        disabled: busy, onClick: load,
        style: {
          padding: '9px 14px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px',
          border: '1px solid var(--dsw-alias-border-1, rgba(255,255,255,.16))',
          background: 'transparent', color: 'var(--dsw-alias-text-1)',
        },
      }, '重新读')),

    h('div', { style: { fontSize: '12.5px', color: 'var(--dsw-alias-text-2)', marginTop: '12px', minHeight: '18px' } }, note),
    h('div', { style: { fontSize: '12.5px', color: 'var(--dsw-alias-danger, #ff8b8b)', marginTop: '4px', minHeight: '18px' } }, error))
}


    return {
      inject: ['slots'],
      apply(ctx) {
        // ★ 顺序有讲究（2026-11-10 第二次踩）：**先挂页签，再去 inject**。
        //   注入到一个已经撤掉的 slot（比如 sidebar 那个 main）会抛，一抛这个 apply 就断了——
        //   顶栏什么都没有，控制台却只有一行错。所以页签先加，inject 包 try。
        const desc = {
          id: 'ming-settings',
          label: '设置',
          order: 90,
          title: '身份与称呼：我叫什么、它怎么叫你、要不要带身份',
          render: IdentityPanel,
        }
        if (typeof window !== 'undefined') {
          const section = () => {
            try {
              ctx.slots.inject('settings.section', () => ctx.slots.register({
                name: 'settings.section', id: 'ming-identity', label: () => '身份与称呼', order: 44,
              }, IdentityPanel))
            } catch (e) { /* 没有设置位就算了 */ }
          }
          if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') {
            window.__MING_TAB_HOST.add(desc)
          } else {
            ;(window.__MING_TABS_PENDING || (window.__MING_TABS_PENDING = [])).push(desc)
            setTimeout(() => {
              if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') return
              const q = window.__MING_TABS_PENDING
              if (Array.isArray(q)) { const i = q.indexOf(desc); if (i >= 0) q.splice(i, 1) }
              section()
            }, 1500)
          }
        }

        try {
          ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: 'ming-memory',
          }, MemoryPanel))
        } catch (e) { /* 11-07 侧栏图标撤了之后这里可能没有 main 位——别让它把页签一起带下去 */ }
      },
    }
  },
})
