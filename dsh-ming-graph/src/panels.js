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

// ---- 委托（2026-11-15 14:3x 加） ----
// 她问「转给 DSH 的活跑在哪、静默的吗」——答：只有三本 jsonl，一个界面都没有。
// 这块就是那三本的视图，数据来自 graph 的 /acp 路由（只读）。
const ACP_API = '/_dsh/dsh-ming-graph/acp'

function acpKpi(label, n) {
  return h('div', { key: 'k-' + label, className: 'ming-kpi-c' },
    h('div', { className: 'ming-kpi-n' }, String(n)),
    h('div', { className: 'ming-kpi-l' }, label),
  )
}

function acpDot(status) {
  const color = status === 'running'
    ? 'var(--dsw-alias-brand-primary, #6c8cff)'
    : status === 'done'
      ? 'var(--dsw-alias-success, #3ec98a)'
      : 'var(--dsw-alias-border-secondary, rgba(150,150,170,.5))'
  return h('span', {
    style: { display: 'inline-block', width: 7, height: 7, borderRadius: '50%', marginRight: 6, background: color },
  })
}

function AcpPanel() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setErr('')
    return fetch(ACP_API, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => { if (d && d.error) setErr(String(d.error)); setData(d) })
      .catch((e) => setErr(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 10000); return () => clearInterval(t) }, [load])

  const rawJobs = (data && data.jobs) || []
  const calls = (data && data.calls) || []
  const ageH = (at) => {
    const t = Date.parse(String(at || '').replace(' ', 'T'))
    return Number.isFinite(t) ? (Date.now() - t) / 3600000 : null
  }
  // 账本是**追加式**的：同一件活会留下好几行——先 running，办完再补一行 done，
  // 有时还有一行只记送达、不带状态。按 id 收到一行，状态取最新那行，发起时间取最早那行。
  // 另外：有结论文件就算办完（结果落盘就是干完了，比账本那行更可信）。
  const jobs = (() => {
    const seen = new Map()
    const out = []
    for (const j of rawJobs) {
      const cur = seen.get(j.id)
      if (!cur) { const o = Object.assign({}, j); seen.set(j.id, o); out.push(o); continue }
      cur.at = j.at
      if (!cur.task && j.task) cur.task = j.task
      if (cur.state === 'unknown' && j.state !== 'unknown') { cur.state = j.state; cur.raw = j.raw }
    }
    for (const j of out) {
      if (j.state === 'active' && j.result) { j.state = 'done'; j.raw = (j.raw || '空') + ' / 有结论文件' }
      const h = ageH(j.at)
      j.ageHours = h === null ? null : Math.round(h * 10) / 10
      j.stale = j.state === 'active' && h !== null && h > 6
    }
    return out
  })()
  const counts = { active: 0, stale: 0, done: 0, failed: 0 }
  for (const j of jobs) {
    if (j.state === 'active') counts[j.stale ? 'stale' : 'active'] += 1
    else if (j.state === 'done') counts.done += 1
    else if (j.state === 'failed') counts.failed += 1
  }
  const withResult = jobs.filter((j) => j.result).length

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
          h('path', { d: 'M4 6h16M4 12h8M4 18h5' }),
          h('path', { d: 'M16 14l4 4-4 4' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, '委托'),
        h('div', { className: 'ming-ph-d' }, 'Discord 對話轉交的工作，跑在 DSH 这边，全程没有界面')),
      h('button', { className: 'mg-btn', onClick: load, disabled: busy }, busy ? '读…' : '刷新'),
    ),

    err ? h('div', { className: 'ming-note', style: { color: 'var(--dsw-alias-danger, #e5534b)', padding: '0 16px 8px' } }, '读账本失败：' + err) : null,

    h('div', { className: 'ming-kpis' },
      acpKpi('在跑', counts.active),
      acpKpi('没回填', counts.stale),
      acpKpi('办完', counts.done),
      acpKpi('失败', counts.failed),
      acpKpi('有结论', withResult),
    ),

    h('div', { className: 'ming-sec' },
      h('div', { className: 'ming-sec-h' },
        h('span', { className: 'ming-sec-t' }, '转过来的活'),
        h('span', { className: 'ming-sec-n' }, jobs.length + ' 条 · 新→旧')),
      jobs.length === 0
        ? h('div', { className: 'ming-sec-b' }, h('div', { className: 'ming-empty' }, '账本还是空的'))
        : h('div', { className: 'ming-sec-b flush' },
          h('div', { className: 'ming-list' },
            jobs.map((j) => h('div', { key: j.id, className: 'ming-li' },
              h('span', { className: 'ming-note', style: { width: 132, flex: '0 0 auto' } }, j.at || ''),
              h('span', { style: { width: 82, flex: '0 0 auto' }, title: '账本原文：' + (j.raw || '空') },
                acpDot(j.stale ? 'stale' : j.state),
                j.stale ? '没回填' : j.state,
                j.stale && j.ageHours ? h('span', { className: 'ming-note' }, ' ' + j.ageHours + 'h') : null),
              h('span', { className: 'ming-li-main', title: j.task }, j.task || '（没写任务）'),
              h('span', { className: 'ming-note', style: { flex: '0 0 auto', marginLeft: 12 } },
                j.result ? (Math.round(j.result.bytes / 102.4) / 10) + ' KB' : '无结论'),
            )),
          ),
        ),
    ),

    calls.length
      ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '实跑记录'),
          h('span', { className: 'ming-sec-n' }, '最近 ' + calls.length + ' 次 · 同步 ACP 那条路')),
        h('div', { className: 'ming-sec-b flush' },
          h('div', { className: 'ming-list' },
            calls.map((e, i) => h('div', { key: 'c' + i, className: 'ming-li' },
              h('span', { className: 'ming-note', style: { width: 132, flex: '0 0 auto' } }, e.at || ''),
              h('span', { style: { width: 74, flex: '0 0 auto' } }, acpDot(e.ok ? 'done' : 'fail'), e.ok ? '成 ' + e.seconds + 's' : '断'),
              h('span', { className: 'ming-li-main', title: e.err || e.task }, e.ok ? e.task : (e.err || e.task)),
            )),
          ),
        ),
      )
      : null,

    h('div', { className: 'ming-note', style: { padding: '4px 16px 16px' } },
      '结论正文在 live/dsh-acp-results/<job>.txt；这里只读账本，不改状态。'),
  )
}

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

