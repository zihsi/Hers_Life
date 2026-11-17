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
