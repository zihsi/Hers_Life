/**
 * dsh-ming-voice —— 声音面板（Client 半端源码）
 *
 * 2026-11-07 18:3x：原来只能看见文件名，听不了。现在每行一个「听」，点开就地播
 * （音频走 Host 的 /_dsh/dsh-ming-voice/file?name=…，只放 live/voice 下的 mp3）。
 * 合成仍然走 voice_say 工具，这里不合成。
 *
 * 2026-11-08 15:5x：整页重排——页头 + 两块（拿什么合成 / 最近合出来的），
 * 原来是一排 pill 加一列没有标题的行，看不出哪是哪。
 */
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
          h('span', { className: 'ming-sec-n' }, '預設音色與語速在 Hers Life Discord 設定頁調整'),
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
