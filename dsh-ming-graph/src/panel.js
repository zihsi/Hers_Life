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
          ['browse', '自己玩'], ['interest', '兴趣'], ['voice', '声音'],
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
