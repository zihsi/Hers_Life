/**
 * dsh-ming-interest —— 兴趣面板（Client 半端源码）
 * 拼进 client.js 的 factory，能用外层的 h / React hooks。
 *
 * 2026-11-07 18:3x：从「只能看」变成「能按」——开关就是 live/interest-off 那个文件，
 * 面板只给它一个按钮；关键词还是改 live/interests.json。
 *
 * 2026-11-08 15:5x：整页重排。她说的「至少要分清哪一块是哪一块」——
 * 原来只有一行小标题，下面三块没名字的卡贴在一起。现在：页头说清这页是什么，
 * 下面三块各有名字（频率 / 为什么不叫 / 盯着的话题）。
 */
const INTEREST_API = '/_dsh/dsh-ming-discord/interest'

function fmtAgo(ms) {
  if (!ms || ms < 0) return '—'
  const m = Math.floor(ms / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

function InterestPanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [switching, setSwitching] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(INTEREST_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d.error) setErr(String(d.error)); else setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const st = (data && data.state) || {}
  const off = !!st.off

  const toggle = useCallback(() => {
    const nextOff = !off
    setSwitching(true)
    fetch(INTEREST_API + '/toggle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ off: nextOff }) })
      .then((r) => r.json())
      .then(() => load())
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setSwitching(false))
  }, [load, off])

  const topics = (data && data.config && data.config.topics) || []
  const learned = (data && data.learned) || []
  const mute = (data && data.config && data.config.mute) || []
  const quiet = st.quiet || st.skip
  const tone = off ? 'danger' : quiet ? 'warn' : 'ok'
  const label = off ? '唤醒关着' : quiet ? '现在不叫' : '在线'
  // 「跳过原因」拆成几条：她要知道是哪一条卡着，不是一句日志
  const why = String(st.skip || '').split(/[；;]\s*|\s{2,}/).map((x) => x.trim()).filter(Boolean)

  const kpi = (n, l) => h('div', { className: 'ming-kpi-c' },
    h('span', { className: 'ming-kpi-n' }, n),
    h('span', { className: 'ming-kpi-l' }, l))

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' }, h(InterestIcon)),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '兴趣'),
        h('div', { className: 'ming-ph-d' }, '什么时候会因为这些词把我叫起来，什么时候不会'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill', 'data-tone': tone }, label),
        h('button', {
          className: 'ming-btn',
          disabled: switching,
          title: off ? '删掉 live/interest-off，恢复关键词叫醒' : '写 live/interest-off，先不叫醒',
          onClick: toggle,
        }, switching ? '切换中…' : (off ? '打开' : '关掉')),
        h('button', { className: 'ming-btn', onClick: load }, busy ? '读取中…' : '刷新'),
      ),
    ),

    h('div', { className: 'ming-wrap ming-scroll' },
      err ? h('div', { className: 'ming-empty' }, '△ ' + err) : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '现在的频率'),
          h('span', { className: 'ming-sec-n' }, '每小时最多 ' + (st.maxPerHour || '?') + ' 次'),
        ),
        h('div', { className: 'ming-kpis' },
          kpi((st.wakesLastHour || 0) + ' 次', '这一小时叫醒'),
          kpi(fmtAgo(st.sinceWakeMs), '距上次'),
          kpi(st.at ? st.at.slice(5, 16).replace('T', ' ') : '—', '状态更新（UTC）'),
        ),
      ),

      why.length
        ? h('div', { className: 'ming-sec' },
          h('div', { className: 'ming-sec-h' },
            h('span', { className: 'ming-sec-t' }, '现在为什么不叫'),
            h('span', { className: 'ming-sec-n' }, why.length + ' 条原因'),
          ),
          h('div', { className: 'ming-sec-b' },
            why.map((w, i) => h('div', { key: i, className: 'ming-note' }, '· ' + w)),
            off ? h('div', { className: 'ming-note' }, '开关在 live/interest-off，点右上「打开」就删掉它。') : null,
          ),
        )
        : null,

      h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '盯着的话题'),
          h('span', { className: 'ming-sec-n' }, topics.length + ' 個 · 在 Discord 設定頁編輯'),
        ),
        h('div', { className: 'ming-sec-b flush' },
          h('div', { className: 'ming-list' },
            topics.map((t, i) => h('div', { key: i, className: 'ming-li', style: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 } },
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', width: '100%' } },
                h('span', { className: 'ming-li-t' }, t.name || '(无名)'),
                h('span', { className: 'ming-note', style: { marginLeft: 'auto' } }, (t.keywords || []).length + ' 词'),
              ),
              h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                (t.keywords || []).map((k, j) => h('span', { key: j, className: 'ming-pill' }, k)),
                mute.map((k, j) => h('span', { key: 'm' + j, className: 'ming-pill', 'data-tone': 'danger', title: '出現就忽略這則訊息' }, '✕ ' + k)),
              ),
            )),
          ),
        ),
      ),
      learned.length ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '自動學到的詞'),
          h('span', { className: 'ming-sec-n' }, learned.length + ' 個'),
        ),
        h('div', { className: 'ming-sec-b' },
          learned.slice(0, 30).map((item, i) => h('span', { key: i, className: 'ming-pill', style: { margin: 3 } },
            item.name + ' · ' + item.count + ' 次' + (item.promoted ? ' · 已啟用' : ''))),
        ),
      ) : null,
    ),
  )
}

function InterestIcon() {
  return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
    h('circle', { cx: 12, cy: 12, r: 3 }),
    h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' }),
  )
}
