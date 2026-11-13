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



// B 站账号设置：登录态只通过 DSH 本机 Credentials 服务读写，界面永远不回显 Cookie。
const MING_BILI_API = '/_dsh/dsh-ming-bilibili-account'

function MingBilibiliPanel() {
  const [status, setStatus] = useState(null)
  const [loginUrl, setLoginUrl] = useState('')
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
    try {
      const data = await request('/status')
      setStatus(data)
      setError('')
    } catch (e) {
      setError(String((e && e.message) || e))
    }
  }, [request])

  useEffect(() => { load() }, [load])

  const start = async () => {
    setBusy('start')
    setError('')
    setNote('')
    try {
      const data = await request('/login/start', 'POST')
      setLoginUrl(data.url || '')
      setNote(data.url ? '登入連結已建立。請用手機 B 站開啟連結並確認，完成後回來按「檢查登入」。' : (data.message || '無法建立登入連結。'))
    } catch (e) {
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
        setLoginUrl('')
        await load()
      } else if (data.state === 'expired' || data.state === 'invalid_cookie') {
        setLoginUrl('')
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
      setLoginUrl('')
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
          h('span', { className: 'ming-sec-n' }, '手機掃碼確認'),
        ),
        h('div', { className: 'ming-sec-b' },
          loginUrl
            ? h('div', null,
                h('a', { href: loginUrl, target: '_blank', rel: 'noreferrer', className: 'ming-link' }, '開啟 B 站登入連結'),
                h('div', { className: 'ming-note', style: { marginTop: '8px' } }, '請在手機 B 站完成確認，再回來檢查登入。'),
                h('button', { className: 'ming-btn on', disabled: !!busy, onClick: poll, style: { marginTop: '10px' } }, busy === 'poll' ? '檢查中…' : '檢查登入'),
              )
            : h('button', { className: 'ming-btn on', disabled: !!busy || !!(status && status.loggedIn), onClick: start }, busy === 'start' ? '建立登入連結…' : '開始登入'),
        ),
      ),
      status && status.loggedIn
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
        '安全說明：Cookie 不會顯示在面板、不會寫入聊天輸出，也不會進入日記。舊版 credentialFile 只在首次啟動時嘗試遷移。'),
    ),
  )
}
