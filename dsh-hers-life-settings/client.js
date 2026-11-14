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
      ['discord', 'provider'], ['discord', 'model'], ['discord', 'agentPreset'], ['discord', 'maxAttachmentBytes'], ['discord', 'inboxPath'], ['discord', 'chatSessionsPath'],
      ['discord', 'directMessages'], ['discord', 'mentionRequired'], ['discord', 'observeUnmentioned'],
      ['qq', 'ownerQQ'], ['qq', 'inboxPath'], ['qq', 'chatSessionsPath'],
      ['memory', 'root'], ['memory', 'personaFiles'], ['memory', 'diaryDir'], ['memory', 'diaryCount'], ['memory', 'maxChars'], ['memory', 'diaryChars'], ['memory', 'totalChars'], ['memory', 'qq', 'dir'], ['memory', 'qq', 'hours'], ['memory', 'qq', 'maxLines'], ['memory', 'qq', 'offFile'], ['memory', 'qq', 'webForQq'], ['memory', 'qq', 'webForQqEveryMs'], ['memory', 'qq', 'webForQqLines'],
      ['interest', 'enabled'], ['interest', 'observeEnabled'], ['interest', 'observePrivate'],
      ['interest', 'groups'], ['interest', 'observeGroups'], ['interest', 'quietHours'],
      ['interest', 'pollMs'], ['interest', 'minGapMinutes'], ['interest', 'maxPerHour'], ['interest', 'minChars'], ['interest', 'contextLines'], ['interest', 'pendingMax'], ['interest', 'pendingTtlMinutes'], ['interest', 'interestsFile'], ['interest', 'logFile'], ['interest', 'stateFile'], ['interest', 'offFlag'],
      ['voice', 'root'], ['voice', 'voice'], ['voice', 'rate'], ['voice', 'python'], ['voice', 'ffmpeg'], ['voice', 'powershell'], ['voice', 'timeoutMs'],
      ['mousepet', 'cursorMode'], ['mousepet', 'cursorHoldMs'], ['mousepet', 'cursorSize'], ['mousepet', 'toolsPath'], ['mousepet', 'companion', 'enabled'], ['mousepet', 'companion', 'tickMs'],
      ['browse', 'enabled'], ['browse', 'adbPath'], ['browse', 'serial'],
      ['browse', 'idleMinutes'], ['browse', 'minGapMinutes'], ['browse', 'dailyMax'],
      ['browse', 'sessionRounds'], ['browse', 'quietHours'], ['browse', 'holidaysFile'], ['browse', 'agentPreset'], ['browse', 'maxItems'], ['browse', 'maxShots'], ['browse', 'targetMode'], ['browse', 'qqSessionPrefix'], ['browse', 'ownerQQ'], ['browse', 'ownerDiscordId'], ['browse', 'discordSessionPrefix'],
      ['resume', 'adbPath'], ['resume', 'serial'], ['resume', 'pauseMediaOnInterrupt'],
      ['graph', 'syncSeconds'], ['graph', 'qqObservations'], ['graph', 'skillsCwd'], ['graph', 'skillsOffFile'], ['graph', 'peopleIndex'], ['graph', 'ownerId'], ['graph', 'ownerName'], ['graph', 'maxPeople'], ['graph', 'maxTopics'], ['graph', 'maxEdges'], ['graph', 'timelineDays'], ['graph', 'memoryCard'], ['graph', 'diaryDir'], ['graph', 'diaryDays'], ['graph', 'dshMemoryDir'], ['graph', 'costPricesFile'], ['graph', 'costAutoFile'], ['resume', 'root'], ['resume', 'adbPath'], ['resume', 'serial'], ['skillIsolate', 'root'], ['skillIsolate', 'stateFile'], ['wake', 'root'],
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
      maxPerHour: '每小時最多喚醒次數', voice: '語音', rate: '語速', provider: 'Discord LLM Provider', model: 'Discord 使用模型', agentPreset: 'Agent Preset', maxAttachmentBytes: '最大附件大小（bytes）', inboxPath: 'Discord Inbox 路徑', chatSessionsPath: 'Session 對照檔路徑', personaFiles: 'Persona 檔案（每行一個相對路徑）', diaryDir: '日記資料夾', diaryChars: '日記注入字數上限', totalChars: '總記憶注入字數上限', offFile: '停用標記檔', webForQq: 'QQ 網頁摘要檔', webForQqEveryMs: 'QQ 網頁摘要更新間隔（毫秒）', webForQqLines: 'QQ 網頁摘要最多行數', interestsFile: '興趣清單檔案', logFile: '興趣觸發紀錄檔', stateFile: '興趣狀態檔', minChars: '訊息最少字數', contextLines: '上下文行數', pendingMax: '待處理訊息上限', pendingTtlMinutes: '待處理訊息保留時間（分鐘）', offFlag: '暫停標記檔', skillsOffFile: '圖譜 Skill 停用狀態檔', stateFile: 'Skill 隔離狀態檔', peopleIndex: '人物索引路徑', ownerId: '圖譜主人 ID', ownerName: '圖譜主人名稱', maxPeople: '人物數上限', maxTopics: '主題數上限', maxEdges: '關係數上限', timelineDays: '時間線天數', memoryCard: '記憶卡片路徑', diaryDays: '圖譜日記回看天數', dshMemoryDir: 'DSH 記憶資料夾', costPricesFile: '成本價格設定檔', costAutoFile: '自動成本設定檔', holidaysFile: '假日設定檔', maxItems: '每輪最多項目數', maxShots: '每輪最多截圖數', targetMode: '操作目標模式', qqSessionPrefix: 'QQ Session 前綴', ownerQQ: '主人 QQ 號', ownerDiscordId: '主人 Discord ID（Browse）', discordSessionPrefix: 'Discord Session 前綴', root: '根資料夾',
      serial: 'Android 裝置 Serial', idleMinutes: '閒置多久後啟動（分鐘）',
      dailyMax: '每日瀏覽上限', sessionRounds: '每個瀏覽 Session 輪數',
      pauseMediaOnInterrupt: '被插話時暫停媒體', syncSeconds: '圖譜同步間隔（秒）',
      qqObservations: 'QQ 觀察紀錄檔', skillsCwd: 'Skill 工作區',
      cursorMode: '游標模式', cursorHoldMs: '游標停留時間（毫秒）', cursorSize: '游標尺寸（像素）', toolsPath: 'Mousepet 工具路徑', tickMs: '陪伴模式更新間隔（毫秒）',
      python: '語音 Python 執行檔', ffmpeg: '語音 FFmpeg 執行檔', powershell: '語音 PowerShell 執行檔', timeoutMs: '語音合成逾時（毫秒）',
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
        const tabs = [['general','一般與環境'],['discord','Discord'],['qq','QQ / 記憶'],['interest','興趣'],['runtime','語音與 Android'],['advanced','進階設定']]
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
                env ? h('div', { style: STYLE.row }, ...[['python','pythonPath'],['ffmpeg','ffmpegPath'],['ffplay','ffplayPath'],['powershell','powershellPath'],['adb','adbPath'],['dshToolsModule','dshToolsPath']].map(([key,target]) => env.commands?.[key] ? h('button', { key, style: STYLE.btn, onClick: () => update(['environment',target], env.commands[key]) }, '使用偵測到的 ' + key) : null)) : null,
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
                : tab === 'runtime' ? h(React.Fragment, null,
                    section('語音', h(React.Fragment, null,
                      field(['voice','root']), field(['voice','voice']), field(['voice','rate']),
                      field(['voice','python']), field(['voice','ffmpeg']), field(['voice','powershell']),
                      field(['voice','timeoutMs'], { type: 'number' }))),
                    section('Android / 自動化', h(React.Fragment, null,
                      field(['browse','enabled'], { type: 'boolean' }),
                      field(['browse','adbPath']), field(['browse','serial']),
                      grid(field(['browse','idleMinutes'], { type: 'number' }), field(['browse','minGapMinutes'], { type: 'number' })),
                      grid(field(['browse','dailyMax'], { type: 'number' }), field(['browse','sessionRounds'], { type: 'number' })),
                      field(['browse','quietHours']),
                      field(['resume','pauseMediaOnInterrupt'], { type: 'boolean' }))))
                  : h(React.Fragment, null,
                    section('Discord 進階', h(React.Fragment, null,
                      grid(field(['discord','provider']), field(['discord','model'])),
                      field(['discord','agentPreset']),
                      field(['discord','maxAttachmentBytes'], { type: 'number' }),
                      field(['discord','inboxPath']), field(['discord','chatSessionsPath']))),
                    section('記憶與 Persona', h(React.Fragment, null,
                      field(['memory','personaFiles'], { type: 'list' }),
                      field(['memory','diaryDir']),
                      grid(field(['memory','diaryChars'], { type: 'number' }), field(['memory','totalChars'], { type: 'number' })),
                      field(['memory','qq','offFile']), field(['memory','qq','webForQq']),
                      grid(field(['memory','qq','webForQqEveryMs'], { type: 'number' }), field(['memory','qq','webForQqLines'], { type: 'number' })))),
                    section('Mousepet 桌面互動', h(React.Fragment, null,
                      field(['mousepet','cursorMode']),
                      grid(field(['mousepet','cursorHoldMs'], { type: 'number' }), field(['mousepet','cursorSize'], { type: 'number' })),
                      field(['mousepet','toolsPath']),
                      field(['mousepet','companion','enabled'], { type: 'boolean' }),
                      field(['mousepet','companion','tickMs'], { type: 'number' }))),
                    section('記憶圖譜與成本', h(React.Fragment, null,
                      grid(field(['graph','ownerId']), field(['graph','ownerName'])),
                      field(['graph','peopleIndex']), field(['graph','memoryCard']),
                      grid(field(['graph','maxPeople'], { type: 'number' }), field(['graph','maxTopics'], { type: 'number' })),
                      grid(field(['graph','maxEdges'], { type: 'number' }), field(['graph','timelineDays'], { type: 'number' })),
                      field(['graph','diaryDir']), field(['graph','dshMemoryDir']),
                      grid(field(['graph','diaryDays'], { type: 'number' }), field(['graph','skillsOffFile'])),
                      field(['graph','costPricesFile']), field(['graph','costAutoFile']))),
                    section('興趣進階', h(React.Fragment, null,
                      grid(field(['interest','minChars'], { type: 'number' }), field(['interest','contextLines'], { type: 'number' })),
                      grid(field(['interest','pendingMax'], { type: 'number' }), field(['interest','pendingTtlMinutes'], { type: 'number' })),
                      field(['interest','interestsFile']), field(['interest','logFile']),
                      grid(field(['interest','stateFile']), field(['interest','offFlag'])))),
                    section('Browse 與恢復', h(React.Fragment, null,
                      field(['browse','agentPreset']), field(['browse','holidaysFile']),
                      grid(field(['browse','maxItems'], { type: 'number' }), field(['browse','maxShots'], { type: 'number' })),
                      grid(field(['browse','targetMode']), field(['browse','qqSessionPrefix'])),
                      grid(field(['browse','ownerQQ']), field(['browse','ownerDiscordId'])),
                      field(['browse','discordSessionPrefix']),
                      field(['resume','root']), field(['resume','adbPath']), field(['resume','serial']),
                      field(['skillIsolate','root']), field(['skillIsolate','stateFile']), field(['wake','root']))),
                    section('其他服務憑據', h('div', { style: STYLE.hint },
                      'LLM Provider API Key 請在 DSH 原生 Settings → Models 管理；Bilibili 登入態使用 DSH Credentials 與原有 QR Login 流程。Hers Life 不會把這些秘密複製到一般設定。')))
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
