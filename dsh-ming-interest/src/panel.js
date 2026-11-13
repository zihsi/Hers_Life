/**
 * dsh-ming-interest —— 兴趣与观察设置面板
 * 由 dsh-ming-graph/build.mjs 直接拼入 client.js；本文件是唯一 UI 源。
 */
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
