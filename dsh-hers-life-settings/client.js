/* Hers Life unified settings page. The credential value is write-only from this surface. */
window.__ModuleLoader__.load({
  id: 'dsh-hers-life-settings',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React
    const ROUTE = '/dsh-hers-life-settings/environment'
    const REF = 'DISCORD_BOT_TOKEN'
    const PATHS = [
      ['workspacePath'],
      ['environment', 'pythonPath'], ['environment', 'ffmpegPath'], ['environment', 'ffplayPath'], ['environment', 'powershellPath'],
      ['environment', 'adbPath'], ['environment', 'dshToolsPath'],
      ['discord', 'enabled'], ['discord', 'ownerUserId'], ['discord', 'allowedGuildIds'],
      ['discord', 'allowedChannelIds'], ['discord', 'allowedUserIds'],
      ['discord', 'directMessages'], ['discord', 'mentionRequired'], ['discord', 'observeUnmentioned'],
      ['qq', 'ownerQQ'], ['qq', 'inboxPath'], ['qq', 'chatSessionsPath'],
      ['memory', 'root'], ['memory', 'diaryCount'], ['memory', 'maxChars'], ['memory', 'qq', 'dir'], ['memory', 'qq', 'hours'], ['memory', 'qq', 'maxLines'],
      ['interest', 'enabled'], ['interest', 'observeEnabled'], ['interest', 'observePrivate'],
      ['interest', 'groups'], ['interest', 'observeGroups'], ['interest', 'quietHours'],
      ['interest', 'pollMs'], ['interest', 'minGapMinutes'], ['interest', 'maxPerHour'],
      ['voice', 'root'], ['voice', 'voice'], ['voice', 'rate'],
      ['browse', 'enabled'], ['browse', 'adbPath'], ['browse', 'serial'],
      ['browse', 'idleMinutes'], ['browse', 'minGapMinutes'], ['browse', 'dailyMax'],
      ['browse', 'sessionRounds'], ['browse', 'quietHours'],
      ['resume', 'adbPath'], ['resume', 'serial'], ['resume', 'pauseMediaOnInterrupt'],
      ['graph', 'syncSeconds'], ['graph', 'qqObservations'], ['graph', 'skillsCwd'],
    ]
    const LABELS = {
      workspacePath: '共用工作區',
      pythonPath: 'Python 執行檔', ffmpegPath: 'FFmpeg 執行檔', ffplayPath: 'FFplay 執行檔', powershellPath: 'PowerShell 執行檔', adbPath: 'ADB 執行檔', dshToolsPath: 'DSH Tools 模組路徑',
      enabled: '啟用功能', ownerUserId: '主人 Discord User ID', allowedGuildIds: '允許的伺服器 ID',
      allowedChannelIds: '允許的頻道 ID', allowedUserIds: '允許的使用者 ID',
      directMessages: '接收私訊', mentionRequired: '群聊必須 @ Bot', observeUnmentioned: '觀察未 @ Bot 的訊息',
      ownerQQ: '主人 QQ 號', inboxPath: 'QQ 入站訊息檔案', chatSessionsPath: 'QQ / Discord Session 對照檔',
      root: '工作區路徑', diaryCount: '開場讀取日記篇數', maxChars: '記憶注入字數上限', dir: 'QQ-Agent 記憶目錄', hours: '讀取最近幾小時', maxLines: '最多讀取幾行',
      observeEnabled: '允許被動觀察', observePrivate: '允許觀察私訊（預設關閉）',
      groups: '允許參與的群組 ID', observeGroups: '允許被動觀察的群組 ID',
      quietHours: '安靜時段', pollMs: '檢查間隔（毫秒）', minGapMinutes: '最短喚醒間隔（分鐘）',
      maxPerHour: '每小時最多喚醒次數', voice: '語音', rate: '語速',
      serial: 'Android 裝置 Serial', idleMinutes: '閒置多久後啟動（分鐘）',
      dailyMax: '每日瀏覽上限', sessionRounds: '每個瀏覽 Session 輪數',
      pauseMediaOnInterrupt: '被插話時暫停媒體', syncSeconds: '圖譜同步間隔（秒）',
      qqObservations: 'QQ 觀察紀錄檔', skillsCwd: 'Skill 工作區',
    }
    const STYLE = {
      page: { padding: '18px 20px 28px', maxWidth: '920px', color: 'var(--dsw-alias-label-primary)', fontSize: '13px' },
      head: { fontSize: '18px', fontWeight: 700, margin: '0 0 6px' },
      sub: { color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7, marginBottom: '16px' },
      card: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px', background: 'var(--dsw-alias-bg-layer-1)' },
      title: { fontWeight: 700, marginBottom: '10px', fontSize: '14px' },
      label: { display: 'block', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginBottom: '5px' },
      input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', font: 'inherit' },
      field: { marginBottom: '12px', minWidth: 0 },
      row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '12px' },
      btn: { padding: '8px 13px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', font: 'inherit' },
      primary: { padding: '8px 15px', borderRadius: '8px', border: 0, background: 'var(--dsw-alias-brand-primary)', color: '#fff', cursor: 'pointer', font: 'inherit', fontWeight: 650 },
      hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', lineHeight: 1.6, marginTop: '5px' },
      ok: { color: 'var(--dsw-alias-state-success-primary)' },
      warn: { color: 'var(--dsw-alias-state-warn-primary)' },
      err: { color: 'var(--dsw-alias-state-error-primary)' },
    }
    const getAt = (value, path) => path.reduce((node, key) => node && node[key], value)
    const setAt = (value, path, next) => {
      const copy = structuredClone(value || {})
      let node = copy
      for (const key of path.slice(0, -1)) {
        if (!node[key] || typeof node[key] !== 'object') node[key] = {}
        node = node[key]
      }
      node[path[path.length - 1]] = next
      return copy
    }
    const textValue = (value) => Array.isArray(value) ? value.join('\n') : (value == null ? '' : String(value))
    const parseList = (value) => String(value).split(/[\r\n,，;；]+/).map(x => x.trim()).filter(Boolean)
    const label = (path) => LABELS[path[path.length - 1]] || path[path.length - 1]

    function createPage(ctx, form) {
      return function HersLifeSettingsPage() {
        const [snapshot, setSnapshot] = useState(form.getSnapshot())
        const [draft, setDraft] = useState(snapshot.value ? structuredClone(snapshot.value) : {})
        const [tab, setTab] = useState('general')
        const [busy, setBusy] = useState(false)
        const [message, setMessage] = useState('')
        const [error, setError] = useState('')
        const [env, setEnv] = useState(null)
        const [credential, setCredential] = useState({ configured: false, writable: false, source: '' })
        const [token, setToken] = useState('')
        useEffect(() => form.subscribe(() => {
          const next = form.getSnapshot()
          setSnapshot(next)
          if (next.value) setDraft(structuredClone(next.value))
        }), [])
        useEffect(() => {
          let alive = true
          fetch(ROUTE, { cache: 'no-store' }).then(r => r.json()).then(d => { if (alive && d?.ok) setEnv(d) }).catch(() => {})
          const readCredential = async () => {
            try {
              const result = await ctx.remote.credentials.describe([REF])
              if (result.ok && alive) setCredential(result.value[REF] || { configured: false, writable: false })
            } catch { if (alive) setCredential({ configured: false, writable: false, source: '' }) }
          }
          void readCredential()
          const off = ctx.remote.$on('credentials/reference-updated', ref => { if (ref === REF) void readCredential() })
          return () => { alive = false; off() }
        }, [])
        const update = (path, value) => setDraft(prev => setAt(prev, path, value))
        const field = (path, options = {}) => {
          const current = getAt(draft, path)
          const isBoolean = options.type === 'boolean'
          const isList = options.type === 'list'
          return h('div', { style: STYLE.field, key: path.join('.') },
            h('label', { style: STYLE.label }, label(path)),
            isBoolean
              ? h('input', { type: 'checkbox', checked: Boolean(current), onChange: e => update(path, e.target.checked) })
              : h(isList ? 'textarea' : 'input', {
                  type: options.type === 'number' ? 'number' : 'text',
                  rows: isList ? 3 : undefined,
                  value: isList ? textValue(current) : textValue(current),
                  placeholder: options.placeholder || '',
                  style: STYLE.input,
                  onChange: e => update(path, options.type === 'number' ? Number(e.target.value) : isList ? parseList(e.target.value) : e.target.value),
                }),
            options.hint ? h('div', { style: STYLE.hint }, options.hint) : null,
          )
        }
        const save = async () => {
          const source = snapshot.value || {}
          const ops = PATHS.flatMap(path => {
            const before = getAt(source, path)
            const after = getAt(draft, path)
            if (JSON.stringify(before) === JSON.stringify(after)) return []
            return [{ op: 'set', path, value: after }]
          })
          if (!ops.length) { setMessage('目前沒有需要儲存的變更。'); return }
          setBusy(true); setMessage(''); setError('')
          try {
            const accepted = await form.mutate(ops, snapshot.revision)
            if (!accepted) throw new Error('設定版本已變更，已重新讀取最新值；請確認後再儲存。')
            setMessage('設定已儲存。多數執行路徑變更需要重新啟動 DSH 才會套用。')
          } catch (e) { setError(String(e?.message || e)) }
          finally { setBusy(false) }
        }
        const storeToken = async () => {
          if (!token.trim()) { setError('請先輸入 Discord Bot Token。'); return }
          setBusy(true); setError(''); setMessage('')
          try {
            const result = await ctx.remote.credentials.set(REF, token.trim())
            if (!result.ok) throw new Error(result.error.message)
            setToken('')
            const status = await ctx.remote.credentials.describe([REF])
            if (status.ok) setCredential(status.value[REF] || { configured: false, writable: false })
            setMessage('Discord Token 已安全儲存；不會寫入一般設定。重新啟動 DSH 後連線。')
          } catch (e) { setError(String(e?.message || e)) }
          finally { setBusy(false) }
        }
        const removeToken = async () => {
          setBusy(true); setError(''); setMessage('')
          try {
            const result = await ctx.remote.credentials.unset(REF)
            if (!result.ok) throw new Error(result.error.message)
            setCredential({ configured: false, writable: true })
            setMessage('Discord Token 已移除。')
          } catch (e) { setError(String(e?.message || e)) }
          finally { setBusy(false) }
        }
        const section = (title, children) => h('section', { style: STYLE.card }, h('div', { style: STYLE.title }, title), children)
        const grid = (...children) => h('div', { style: STYLE.row }, ...children)
        const tabs = [['general','一般與環境'],['discord','Discord'],['qq','QQ / 記憶'],['interest','興趣'],['runtime','語音與 Android']]
        const tabBar = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px', marginBottom: '14px' } },
          ...tabs.map(([id, title]) => h('button', { key: id, style: { ...STYLE.btn, borderColor: tab === id ? 'var(--dsw-alias-brand-primary)' : undefined }, onClick: () => setTab(id) }, title)))
        const content = tab === 'general'
          ? h(React.Fragment, null,
              section('工作區與環境', h(React.Fragment, null,
                field(['workspacePath'], { hint: '留空時自動沿用既有工作區；不需要設定 Windows 環境變數。' }),
                env ? h('div', { style: STYLE.hint }, 'DSH_HOME：' + env.dshHome + ' · Node：' + env.node + ' · ' + env.platform + '/' + env.arch) : null,
                env ? h('div', { style: STYLE.field },
                  h('div', { style: STYLE.label }, '可用工具（自動偵測）'),
                  ...Object.entries(env.commands || {}).map(([name, value]) => h('div', { key: name, style: STYLE.hint }, name + '：' + (value || '未找到')))) : null,
                env?.workspaceCandidates?.length ? h('div', { style: STYLE.field },
                  h('div', { style: STYLE.label }, '偵測到的工作區'),
                  ...env.workspaceCandidates.map((item, i) => h('button', { key: i, style: STYLE.btn, onClick: () => update(['workspacePath'], item.path) }, (item.exists ? '使用 ' : '建立 ') + item.source + '：' + item.path))) : null,
                grid(field(['environment','pythonPath']), field(['environment','ffmpegPath'])),
                grid(field(['environment','ffplayPath']), field(['environment','powershellPath'])),
                field(['environment','adbPath']),
                field(['environment','dshToolsPath'], { hint: '通常不需要填；只有 DSH Tools 無法自動解析時才需要指定模組檔案。' }),
                env ? h('div', { style: STYLE.row }, ...[['python','pythonPath'],['ffmpeg','ffmpegPath'],['ffplay','ffplayPath'],['powershell','powershellPath'],['adb','adbPath']].map(([key,target]) => env.commands?.[key] ? h('button', { key, style: STYLE.btn, onClick: () => update(['environment',target], env.commands[key]) }, '使用偵測到的 ' + key) : null)) : null,
                h('div', { style: STYLE.hint }, '執行檔路徑留空時使用系統 PATH 自動偵測；偵測結果可直接套用。'))))
          : tab === 'discord'
            ? h(React.Fragment, null,
                section('Discord 連線', h(React.Fragment, null,
                  field(['discord','enabled'], { type: 'boolean' }),
                  h('div', { style: STYLE.field },
                    h('label', { style: STYLE.label }, 'Discord Bot Token（安全憑據）'),
                    h('input', { type: 'password', autoComplete: 'new-password', value: token, placeholder: credential.configured ? '已設定；輸入新 Token 可替換' : '貼上 Bot Token', style: STYLE.input, onChange: e => setToken(e.target.value) }),
                    h('div', { style: STYLE.hint }, credential.configured ? '已設定（來源：' + (credential.source || 'DSH Credentials') + '）；不會顯示已儲存的值。' : '尚未設定 Token。'),
                    h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
                      h('button', { style: STYLE.primary, disabled: busy || credential.writable === false, onClick: storeToken }, '安全儲存 Token'),
                      h('button', { style: STYLE.btn, disabled: busy || !credential.configured, onClick: removeToken }, '移除 Token'))),
                  grid(field(['discord','ownerUserId']), field(['discord','directMessages'], { type: 'boolean' })),
                  field(['discord','mentionRequired'], { type: 'boolean' }),
                  field(['discord','observeUnmentioned'], { type: 'boolean' }),
                  field(['discord','allowedGuildIds'], { type: 'list', hint: '每行一個 ID；留空會拒絕所有伺服器訊息。請只加入信任的伺服器。' }),
                  field(['discord','allowedChannelIds'], { type: 'list', hint: '留空代表不額外限制頻道；仍須通過伺服器與使用者白名單。' }),
                  field(['discord','allowedUserIds'], { type: 'list', hint: '每行一個 ID；留空時只允許主人。私訊一律只接受主人。' }))))
            : tab === 'qq'
              ? h(React.Fragment, null,
                  section('QQ 與記憶路徑', h(React.Fragment, null,
                    field(['qq','ownerQQ']),
                    field(['qq','inboxPath']),
                    field(['qq','chatSessionsPath']),
                    field(['memory','root']), field(['memory','qq','dir']),
                    grid(field(['memory','qq','hours'], { type: 'number' }), field(['memory','qq','maxLines'], { type: 'number' })),
                    grid(field(['memory','diaryCount'], { type: 'number' }), field(['memory','maxChars'], { type: 'number' })),
                    field(['graph','qqObservations'], { hint: '留空時自動建立工作區內的空白觀察檔；接上 QQ-Agent 後可改為實際 observations.jsonl。' }),
                    field(['graph','syncSeconds'], { type: 'number' }))))
              : tab === 'interest'
                ? h(React.Fragment, null,
                    section('興趣與參與', h(React.Fragment, null,
                      field(['interest','enabled'], { type: 'boolean' }),
                      field(['interest','observeEnabled'], { type: 'boolean' }),
                      field(['interest','observePrivate'], { type: 'boolean', hint: '私訊觀察預設關閉；開啟前請確認記憶權限設計。' }),
                      field(['interest','groups'], { type: 'list' }),
                      field(['interest','observeGroups'], { type: 'list' }),
                      grid(field(['interest','quietHours']), field(['interest','pollMs'], { type: 'number' })),
                      grid(field(['interest','minGapMinutes'], { type: 'number' }), field(['interest','maxPerHour'], { type: 'number' })))))
                : h(React.Fragment, null,
                    section('語音', h(React.Fragment, null,
                      field(['voice','root']), field(['voice','voice']), field(['voice','rate']))),
                    section('Android / 自動化', h(React.Fragment, null,
                      field(['browse','enabled'], { type: 'boolean' }),
                      field(['browse','adbPath']), field(['browse','serial']),
                      grid(field(['browse','idleMinutes'], { type: 'number' }), field(['browse','minGapMinutes'], { type: 'number' })),
                      grid(field(['browse','dailyMax'], { type: 'number' }), field(['browse','sessionRounds'], { type: 'number' })),
                      field(['browse','quietHours']),
                      field(['resume','pauseMediaOnInterrupt'], { type: 'boolean' }))))
        return h('div', { style: STYLE.page },
          h('div', { style: STYLE.head }, 'Hers Life 統一設定'),
          h('div', { style: STYLE.sub }, '在這裡設定工作區、環境工具、Discord、QQ、記憶、興趣、語音與 Android。一般設定不需要手動編輯 JSON/YAML；Token 會進入 DSH Credentials。'),
          tabBar,
          content,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', flexWrap: 'wrap' } },
            h('button', { style: STYLE.primary, disabled: busy || snapshot.status !== 'ready' || !snapshot.writable, onClick: save }, busy ? '儲存中…' : '儲存所有設定'),
            message ? h('span', { style: STYLE.ok }, message) : null,
            error ? h('span', { style: STYLE.err }, error) : null,
            snapshot.status === 'loading' ? h('span', { style: STYLE.hint }, '正在讀取設定…') : null,
            snapshot.status === 'unavailable' ? h('span', { style: STYLE.err }, 'Hers Life Host 設定尚未載入；請確認根插件已啟用。') : null,
          ))
      }
    }

    return {
      name: 'hers-life-settings-client',
      inject: ['slots', 'configForms', 'remote', 'remote.credentials'],
      apply(ctx) {
        const form = ctx.configForms.get('hers-life')
        const Page = createPage(ctx, form)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'hers-life',
          order: 25,
          label: () => 'Hers Life',
        }, Page))
      },
    }
  },
})
