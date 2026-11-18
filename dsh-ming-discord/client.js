window.__ModuleLoader__.load({
  id: 'dsh-ming-discord',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/_dsh/dsh-ming-discord'
    const IDENTITY_API = '/_dsh/dsh-ming-memory/identity'

    const base = {
      enabled: false, workspace: '', ownerIds: [],
      personaFiles: ['persona/人设.md', 'persona/名字.md', 'persona/约定.md'],
      diaryDir: 'diary', diaryCount: 3, diaryChars: 8000, maxChars: 12000,
      discord: { enabled: false, mode: 'mention', allowDm: true, dmPolicy: 'owner', guildIds: [], channelIds: [], typing: true, streamEdits: true, replyToMessage: true, reactions: true, shareImages: true, chunkLimit: 1900, maxAttachmentMb: 24, progressInDm: true, showTools: false, learnInterests: true },
      memory: { enabled: true, shareAcrossChannels: true, shareAcrossGuilds: true, sharePrivateToOwner: true, allowPrivateContextInGuild: true, maxRecall: 6, maxAgeDays: 365 },
      voice: { enabled: true, ffmpeg: 'ffmpeg', python: 'python', timeoutMs: 60000, heartbeat: true, ttsVoice: 'zh-CN-XiaoxiaoNeural', ttsRate: '+0%' },
      interest: { enabled: true, minChars: 6, contextLines: 4, minGapMinutes: 20, maxPerHour: 3, quietHours: '01:00-08:00', channelGapMinutes: 45 },
      browse: {
        enabled: true, idleMinutes: 20, minGapMinutes: 30, dailyMax: 8, sessionRounds: 15,
        quietHours: '08:00-18:30', gapMode: 'fixed', hbMin: 5, hbCenter: 30, hbMax: 240, allowSocialWrites: true, freeWindows: [{ start: '18:30', end: '08:00' }, { start: '13:50', end: '18:15', only: 'rest' }],
        holidaysFile: 'live/holidays.json', agentPreset: '', maxItems: 2, maxShots: 2, serial: '127.0.0.1:16448',
        adbPath: 'D:\\MuMuPlayer\\nx_device\\12.0\\shell\\adb.exe',
        socialApps: ['com.xingin.xhs', 'com.tencent.weibo', 'com.sina.weibo', 'com.ss.android.ugc.aweme', 'com.smile.gifmaker', 'com.zhihu.android', 'com.baidu.tieba', 'com.tencent.mm'],
        socialWriteWords: ['点赞', '关注', '评论', '收藏', '转发', '分享', '发布', '发送', '投币', '私信', '赞'],
        targets: ['xiaohongshu', 'bilibili'],
      },
      resume: { enabled: true, adbPath: 'D:\\MuMuPlayer\\nx_device\\12.0\\shell\\adb.exe', serial: '127.0.0.1:7555', pauseMediaOnInterrupt: true },
      wake: { enabled: true },
      mousepet: { enabled: true, cursorMode: 'companion', cursorHoldMs: 2600, cursorSize: 64, cursorState: 'pointer', webpickDir: '', toolsPath: '', shake: { on: true, level: 'medium' }, companion: { enabled: true, tickMs: 0, provider: 'wb-proxy', model: 'hy4-preview', bubbleMs: 4200, workspace: '' } },
      bilibili: { enabled: true, credentialFile: '', searchMaxPageSize: 20, subtitleMaxChars: 16000, timeoutMs: 30000 },
      activities: { enabled: true },
      skillIsolate: { enabled: true, stateFile: '' },
      coreMemory: { enabled: true },
      graph: { enabled: true, syncSeconds: 120, costPricesFile: '', costAutoFile: '' },
    }

    function mergeClientConfig(value = {}) {
      return {
        ...base, ...value,
        discord: { ...base.discord, ...(value.discord || {}) },
        memory: { ...base.memory, ...(value.memory || {}) },
        voice: { ...base.voice, ...(value.voice || {}) },
        interest: { ...base.interest, ...(value.interest || {}) },
        browse: { ...base.browse, ...(value.browse || {}) },
        resume: { ...base.resume, ...(value.resume || {}) },
        wake: { ...base.wake, ...(value.wake || {}) },
        mousepet: { ...base.mousepet, ...(value.mousepet || {}), shake: { ...base.mousepet.shake, ...(value.mousepet?.shake || {}) }, companion: { ...base.mousepet.companion, ...(value.mousepet?.companion || {}) } },
        bilibili: { ...base.bilibili, ...(value.bilibili || {}) },
        activities: { ...base.activities, ...(value.activities || {}) },
        skillIsolate: { ...base.skillIsolate, ...(value.skillIsolate || {}) },
        coreMemory: { ...base.coreMemory, ...(value.coreMemory || {}) },
        graph: { ...base.graph, ...(value.graph || {}) },
      }
    }

    function patchObject(obj, path, value) {
      const parts = path.split('.')
      const out = Object.assign({}, obj)
      let at = out
      let src = obj
      for (let i = 0; i < parts.length - 1; i++) {
        at[parts[i]] = Object.assign({}, src?.[parts[i]] || {})
        at = at[parts[i]]
        src = src?.[parts[i]]
      }
      at[parts[parts.length - 1]] = value
      return out
    }

    function SettingsPanel() {
      const [cfg, setCfg] = React.useState(base)
      const [identity, setIdentity] = React.useState({ selfName: '', selfFullName: '', selfDesc: '', userName: '', identity: true })
      const [token, setToken] = React.useState('')
      const [hasToken, setHasToken] = React.useState(false)
      const [status, setStatus] = React.useState({ state: '讀取中' })
      const [events, setEvents] = React.useState([])
      const [sessions, setSessions] = React.useState([])
      const [interestTopicsText, setInterestTopicsText] = React.useState('')
      const [interestMuteText, setInterestMuteText] = React.useState('')
      const [browseWindowsDraft, setBrowseWindowsDraft] = React.useState(JSON.stringify(base.browse.freeWindows, null, 2))
      const [interestState, setInterestState] = React.useState(null)
      const [workspaceFiles, setWorkspaceFiles] = React.useState([])
      const [workspaceFilePath, setWorkspaceFilePath] = React.useState('persona/人设.md')
      const [workspaceFileContent, setWorkspaceFileContent] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const [migration, setMigration] = React.useState(null)

      const load = React.useCallback(async () => {
        setError('')
        try {
          const r = await fetch(API + '/settings', { cache: 'no-store' })
          const d = await r.json()
          if (!r.ok || !d.ok) throw new Error(d.error || '設定讀取失敗')
          const mergedSettings = mergeClientConfig(d.settings || {})
          setCfg(mergedSettings)
          setBrowseWindowsDraft(JSON.stringify(mergedSettings.browse.freeWindows || [], null, 2))
          setHasToken(!!d.hasToken)
          setStatus((old) => ({ ...old, ...(d.status || {}), plugins: d.status?.plugins || old.plugins, paths: d.status?.paths || old.paths }))
          setEvents(d.events || [])
          setSessions(d.sessions || [])
        } catch (e) { setError(String(e.message || e)) }
        try {
          const [configResponse, stateResponse] = await Promise.all([
            fetch(API + '/interest/config', { cache: 'no-store' }),
            fetch(API + '/interest/state', { cache: 'no-store' }),
          ])
          const configData = await configResponse.json()
          const stateData = await stateResponse.json()
          if (configResponse.ok && configData.ok) {
            const rows = Array.isArray(configData.config?.topics) ? configData.config.topics : []
            setInterestTopicsText(rows.map((topic) => String(topic.name || '') + ': ' + (topic.keywords || []).join(', ')).join('\n'))
            setInterestMuteText((configData.config?.mute || []).join(', '))
          }
          if (stateResponse.ok && stateData.ok) setInterestState(stateData)
        } catch {}
        try {
          const r = await fetch(API + '/workspace/files', { cache: 'no-store' })
          const d = await r.json()
          if (r.ok && d.ok && Array.isArray(d.files)) {
            const files = d.files
            setWorkspaceFiles(files)
            const chosen = files.find((file) => file.path === workspaceFilePath) || files.find((file) => file.path === 'persona/人设.md') || files[0]
            if (chosen) {
              setWorkspaceFilePath(chosen.path)
              setWorkspaceFileContent(chosen.content || '')
            }
          }
        } catch {}

        try {
          const r = await fetch(IDENTITY_API, { cache: 'no-store' })
          const d = await r.json()
          if (d && d.ok && d.identity) setIdentity({ selfName: d.identity.selfName || '', selfFullName: d.identity.selfFullName || '', selfDesc: d.identity.selfDesc || '', userName: d.identity.userName || '', identity: d.identity.identity !== false })
        } catch {}
      }, [])

      React.useEffect(() => { load() }, [load])

      const set = (path, value) => setCfg((old) => patchObject(old, path, value))
      const input = (label, path, hint, type = 'text') => h('label', { className: 'hl-field', key: path },
        h('span', { className: 'hl-label' }, label),
        h('input', {
          className: 'hl-input', type, value: String(path.split('.').reduce((o, k) => o?.[k], cfg) ?? ''),
          onChange: (e) => set(path, type === 'number' ? Number(e.target.value) : e.target.value),
        }),
        hint ? h('small', { className: 'hl-hint' }, hint) : null)
      const check = (label, path, hint, warning = false) => h('label', { className: 'hl-check', key: path },
        h('input', { type: 'checkbox', checked: !!path.split('.').reduce((o, k) => o?.[k], cfg), onChange: (e) => set(path, e.target.checked) }),
        h('span', null, label),
        hint ? h('small', { className: warning ? 'hl-warn' : 'hl-hint' }, hint) : null)
      const select = (label, path, options, hint) => h('label', { className: 'hl-field', key: path },
        h('span', { className: 'hl-label' }, label),
        h('select', { className: 'hl-input', value: String(path.split('.').reduce((o, k) => o?.[k], cfg) ?? ''), onChange: (e) => set(path, e.target.value) },
          options.map((o) => h('option', { key: o[0], value: o[0] }, o[1]))),
        hint ? h('small', { className: 'hl-hint' }, hint) : null)
      const area = (label, path, hint, rows = 3) => h('label', { className: 'hl-field', key: path },
        h('span', { className: 'hl-label' }, label),
        h('textarea', { className: 'hl-input hl-area', rows, value: Array.isArray(path.split('.').reduce((o, k) => o?.[k], cfg))
          ? path.split('.').reduce((o, k) => o?.[k], cfg).join('\n')
          : String(path.split('.').reduce((o, k) => o?.[k], cfg) ?? ''),
          onChange: (e) => {
            const raw = e.target.value
            set(path, path.endsWith('Ids') || path === 'discord.whitelist' || path === 'ownerIds' || path === 'personaFiles' || ['browse.socialApps', 'browse.socialWriteWords', 'browse.targets'].includes(path) ? raw.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) : raw)
          } }),
        hint ? h('small', { className: 'hl-hint' }, hint) : null)
      const card = (title, desc, children) => h('section', { className: 'hl-card', key: title },
        h('h3', null, title), desc ? h('p', { className: 'hl-desc' }, desc) : null, children)
      const button = (label, fn, primary = false, disabled = false) => h('button', {
        className: primary ? 'hl-btn primary' : 'hl-btn', disabled, onClick: fn,
      }, label)
      const save = async () => {
        setBusy(true); setError(''); setNote('')
        try {
          let freeWindows
          try { freeWindows = JSON.parse(browseWindowsDraft || '[]') }
          catch { throw new Error('Browse 自由時段必須是有效 JSON 陣列。') }
          if (!Array.isArray(freeWindows)) throw new Error('Browse 自由時段必須是 JSON 陣列。')
          const settingsToSave = JSON.parse(JSON.stringify(cfg))
          settingsToSave.browse.freeWindows = freeWindows
          const body = { settings: settingsToSave }
          if (token.trim()) body.token = token.trim()
          const r = await fetch(API + '/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const d = await r.json()
          if (!r.ok || !d.ok) throw new Error(d.error || '儲存失敗')
          setHasToken(!!d.settings?.discord?.tokenConfigured)
          const mergedSettings = mergeClientConfig(d.settings || {})
          setCfg(mergedSettings)
          setBrowseWindowsDraft(JSON.stringify(mergedSettings.browse.freeWindows || [], null, 2))
          setToken('')
          setStatus((old) => ({ ...old, ...(d.status || {}), plugins: d.status?.plugins || old.plugins, paths: d.status?.paths || old.paths }))
          setMigration(d.migration || null)
          if (d.restartRequired) {
            setNote('工作區已切換並保全式複製資料。請重啟 DSH，讓所有配套插件一起切換到新路徑。')
            try {
              const filesResponse = await fetch(API + '/workspace/files', { cache: 'no-store' })
              const filesData = await filesResponse.json()
              if (filesResponse.ok && filesData.ok) {
                setWorkspaceFiles(filesData.files || [])
                const chosen = (filesData.files || []).find((file) => file.path === workspaceFilePath) || (filesData.files || [])[0]
                if (chosen) { setWorkspaceFilePath(chosen.path); setWorkspaceFileContent(chosen.content || '') }
              }
            } catch {}
          } else {
            setNote('已儲存。Discord 連線設定即時重新載入；其他插件參數請重新啟動 DSH 後套用。')
          }
        } catch (e) { setError(String(e.message || e)) }
        setBusy(false)
      }
      const refreshWorkspaceFiles = async () => {
        setBusy(true); setError('')
        try {
          const r = await fetch(API + '/workspace/files', { cache: 'no-store' })
          const d = await r.json()
          if (!r.ok || !d.ok) throw new Error(d.error || '工作區檔案讀取失敗')
          setWorkspaceFiles(d.files || [])
          const chosen = (d.files || []).find((file) => file.path === workspaceFilePath) || (d.files || [])[0]
          if (chosen) { setWorkspaceFilePath(chosen.path); setWorkspaceFileContent(chosen.content || '') }
        } catch (e) { setError(String(e.message || e)) }
        setBusy(false)
      }
      const saveWorkspaceFile = async () => {
        setBusy(true); setError(''); setNote('')
        try {
          const r = await fetch(API + '/workspace/file', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: workspaceFilePath, content: workspaceFileContent }),
          })
          const d = await r.json()
          if (!r.ok || !d.ok) throw new Error(d.error || '檔案保存失敗')
          setWorkspaceFiles((old) => old.map((file) => file.path === workspaceFilePath ? { ...file, content: workspaceFileContent } : file))
          setNote('已保存 ' + workspaceFilePath + '（' + d.chars + ' 字元）。')
        } catch (e) { setError(String(e.message || e)) }
        setBusy(false)
      }
      const saveIdentity = async () => {
        setBusy(true); setError(''); setNote('')
        try {
          const r = await fetch(IDENTITY_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selfName: identity.selfName, selfFullName: identity.selfFullName, selfDesc: identity.selfDesc, userName: identity.userName, identity: identity.identity }) })
          const d = await r.json()
          if (!r.ok || !d.ok) throw new Error(d.error || '人格設定儲存失敗')
          setNote('身份與稱呼已儲存；記憶開場設定可能需要重啟 DSH 才會完全刷新。')
        } catch (e) { setError(String(e.message || e)) }
        setBusy(false)
      }
      const saveInterestConfig = async () => {
        setBusy(true); setError(''); setNote('')
        try {
          const topics = interestTopicsText.split(/\r?\n/).map((line) => {
            const split = line.indexOf(':')
            if (split < 0) return null
            const name = line.slice(0, split).trim()
            const keywords = line.slice(split + 1).split(/[,，]/).map((word) => word.trim().toLowerCase()).filter(Boolean)
            return name && keywords.length ? { name, keywords } : null
          }).filter(Boolean)
          const mute = interestMuteText.split(/[,，\r?\n]/).map((word) => word.trim().toLowerCase()).filter(Boolean)
          const response = await fetch(API + '/interest/config', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: { topics, mute } }),
          })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(data.error || '興趣設定儲存失敗')
          setNote('興趣主題已保存；公開頻道的下一則符合條件訊息會使用新設定。')
        } catch (e) { setError(String(e.message || e)) }
        setBusy(false)
      }
      const toggleInterestPause = async () => {
        setBusy(true); setError(''); setNote('')
        try {
          const off = !interestState?.state?.off
          const response = await fetch(API + '/interest/toggle', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ off }),
          })
          const data = await response.json()
          if (!response.ok || !data.ok) throw new Error(data.error || '興趣暫停狀態更新失敗')
          setInterestState((old) => Object.assign({}, old, { state: Object.assign({}, old?.state, { off: data.off }) }))
          setNote(data.off ? '興趣喚醒已暫停。' : '興趣喚醒已恢復。')
        } catch (e) { setError(String(e.message || e)) }
        setBusy(false)
      }
      const initialize = async () => {
        setBusy(true); setError(''); setNote('')
        try {
          const r = await fetch(API + '/initialize', { method: 'POST' })
          const d = await r.json()
          if (!r.ok || !d.ok) throw new Error(d.error || '初始化失敗')
          setNote('工作區初始化完成。新建 ' + (d.created || []).length + ' 個模板；既有檔案沒有覆蓋。')
          await refreshWorkspaceFiles()
        } catch (e) { setError(String(e.message || e)) }
        setBusy(false)
      }
      const clearToken = async () => {
        if (!window.confirm('確定刪除本機保存的 Discord Bot Token？')) return
        setBusy(true)
        try {
          const r = await fetch(API + '/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clearToken: true, settings: cfg }) })
          const d = await r.json()
          if (!r.ok || !d.ok) throw new Error(d.error || '刪除失敗')
          setHasToken(false); setStatus((old) => ({ ...old, ...(d.status || {}), plugins: d.status?.plugins || old.plugins, paths: d.status?.paths || old.paths })); setNote('Token 已從本機密鑰檔移除。')
        } catch (e) { setError(String(e.message || e)) }
        setBusy(false)
      }
      const statusLabel = status.state === 'connected' ? '已連線' : status.state === 'connecting' ? '連線中' : status.state === 'error' ? '連線錯誤' : status.state === 'needs-token' ? '等待 Token' : '已停用'

      return h('div', { className: 'hl-settings' },
        h('style', null, `
          .hl-settings{max-width:980px;padding:20px 22px 36px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.65}
          .hl-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}.hl-head h2{font-size:18px;margin:0;font-weight:650}
          .hl-pill{font-size:11px;border:1px solid var(--dsw-alias-border-secondary);border-radius:99px;padding:3px 9px;color:var(--dsw-alias-label-secondary)}
          .hl-card{border:1px solid var(--dsw-alias-border-secondary);border-radius:12px;padding:15px 17px;margin:0 0 13px;background:var(--dsw-alias-bg-layer-1)}
          .hl-card h3{font-size:14px;margin:0 0 3px;font-weight:650}.hl-desc,.hl-hint{color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.6}
          .hl-desc{margin:0 0 12px}.hl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:11px 16px}
          .hl-field{display:flex;flex-direction:column;gap:5px;min-width:0}.hl-label{font-weight:550}
          .hl-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-secondary);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}
          .hl-area{resize:vertical;min-height:62px}.hl-check{display:flex;align-items:flex-start;gap:8px;margin:8px 0;flex-wrap:wrap}.hl-check input{margin-top:4px}
          .hl-check .hl-hint,.hl-check .hl-warn{flex-basis:100%;margin-left:23px}.hl-warn{color:var(--dsw-alias-state-warn-primary);font-size:11.5px}
          .hl-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}.hl-btn{border:1px solid var(--dsw-alias-border-secondary);border-radius:8px;padding:8px 13px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit}
          .hl-btn.primary{background:var(--dsw-alias-brand-primary);color:white;border-color:transparent;font-weight:650}.hl-btn:disabled{opacity:.5;cursor:wait}
          .hl-note{margin:8px 0;color:var(--dsw-alias-state-success-primary)}.hl-error{margin:8px 0;color:var(--dsw-alias-state-error-primary)}
          .hl-events{max-height:240px;overflow:auto}.hl-event{padding:7px 0;border-bottom:1px solid var(--dsw-alias-separator-secondary);font-size:11.5px}
          .hl-muted{color:var(--dsw-alias-label-secondary);font-size:11px}
        `),
        h('div', { className: 'hl-head' },
          h('h2', null, 'Hers Life · Discord 與共同記憶'),
          h('span', { className: 'hl-pill' }, statusLabel),
          h('span', { className: 'hl-pill' }, sessions.length + ' 個會話')),
        status.error ? h('p', { className: 'hl-error' }, status.error) : null,
        error ? h('p', { className: 'hl-error' }, error) : null,
        note ? h('p', { className: 'hl-note' }, note) : null,
        migration ? h('p', { className: 'hl-muted' }, '工作區遷移：複製 ' + migration.copied + ' 個檔案；保留目的地既有 ' + migration.kept + ' 個檔案。舊資料不會刪除。') : null,

        card('Discord Bot', '輸入 Bot Token 與你的 Discord 使用者 ID。Token 只存在本機密鑰檔，讀取設定時不會回傳明碼。',
          h(React.Fragment, null,
            h('div', { className: 'hl-grid' },
              area('Owner Discord User ID（可多個）', 'ownerIds', '填使用者 ID，不是伺服器 ID；可用逗號或換行分隔。', 2),
              select('伺服器回覆模式', 'discord.mode', [['mention','只在 @ 或回覆時回答'],['all','所有頻道訊息都回答'],['own','不回覆伺服器訊息']]),
              select('私訊允許範圍', 'discord.dmPolicy', [['owner','僅 Owner'],['whitelist','白名單'],['anyone','任何人']]),
              area('私訊白名單使用者 ID', 'discord.whitelist', '當上方選擇「白名單」時，只有 Owner 與這裡列出的 Discord User ID 可以私訊。', 2),
              area('允許的 Guild ID（空白 = 全部）', 'discord.guildIds', '限制 Bot 會處理哪些伺服器。', 2),
              area('允許的 Channel ID（空白 = 全部）', 'discord.channelIds', '限制 Bot 會處理哪些文字頻道與 Thread。', 2)),
            check('啟用 Hers Life Discord 適配器', 'enabled', '總開關；關閉不會刪除任何資料。'),
            check('啟用 Discord 訊息接收', 'discord.enabled', '必須同時開啟上方總開關與此項。'),
            check('接收私訊', 'discord.allowDm', '私訊仍受上面的私訊政策控制。'),
            check('串流編輯回覆', 'discord.streamEdits', '先送出占位訊息，再隨生成更新。'),
            check('輸入中指示', 'discord.typing', '顯示 Bot 正在輸入。'),
            check('回覆原訊息', 'discord.replyToMessage', '讓訊息串接清楚。'),
            check('上傳 AI 生成圖片', 'discord.shareImages', 'AI 在 DSH 產生的圖片可選擇發回 Discord。'),
            input('附件大小上限（MB）', 'discord.maxAttachmentMb', '超過上限的附件會跳過。', 'number'),
            input('Discord 訊息分段上限', 'discord.chunkLimit', '建議不超過 2000 字元。', 'number'),
            h('div', { className: 'hl-field' },
              h('span', { className: 'hl-label' }, hasToken ? 'Token 狀態：已保存（隱藏）' : 'Token 狀態：尚未設定'),
              h('input', { className: 'hl-input', type: 'password', value: token, placeholder: hasToken ? '留空不更換' : '貼上 Discord Bot Token', onChange: (e) => setToken(e.target.value) }),
              hasToken ? button('移除已保存的 Token', clearToken, false, busy) : null),
            h('div', { className: 'hl-muted' }, '目前狀態：' + statusLabel + (status.user ? ' · ' + status.user : ''))
          )),
        card('人格與稱呼', '這裡沿用原本設定頁的身份設定；人設正文保存在工作區 persona 資料夾。',
          h(React.Fragment, null,
            h('div', { className: 'hl-grid' },
              h('label', { className: 'hl-field' }, h('span', { className: 'hl-label' }, 'AI 的名字'), h('input', { className: 'hl-input', value: identity.selfName || '', onChange: (e) => setIdentity((v) => Object.assign({}, v, { selfName: e.target.value })) })),
              h('label', { className: 'hl-field' }, h('span', { className: 'hl-label' }, '全名'), h('input', { className: 'hl-input', value: identity.selfFullName || '', onChange: (e) => setIdentity((v) => Object.assign({}, v, { selfFullName: e.target.value })) })),
              h('label', { className: 'hl-field' }, h('span', { className: 'hl-label' }, '如何稱呼你'), h('input', { className: 'hl-input', value: identity.userName || '', onChange: (e) => setIdentity((v) => Object.assign({}, v, { userName: e.target.value })) }),
              ),
              h('label', { className: 'hl-field' }, h('span', { className: 'hl-label' }, '自稱描述'), h('input', { className: 'hl-input', value: identity.selfDesc || '', onChange: (e) => setIdentity((v) => Object.assign({}, v, { selfDesc: e.target.value })) }))),
            h('label', { className: 'hl-check' }, h('input', { type: 'checkbox', checked: identity.identity !== false, onChange: (e) => setIdentity((v) => Object.assign({}, v, { identity: e.target.checked })) }), '把身份資訊加入開場提示'),
            h('div', { className: 'hl-actions' }, button('保存身份與稱呼', saveIdentity, false, busy)))),
        card('人格檔案、日記與工作區', '路徑相對於工作區根目錄；變更工作區時會採取「只補缺少檔案」的保全式複製，不刪除舊資料。',
          h(React.Fragment, null,
            h('div', { className: 'hl-grid' },
              input('工作區路徑', 'workspace', '存放人格、日記、見聞、共享記憶與 Discord 會話索引。'),
              input('日記資料夾', 'diaryDir', '相對於工作區。'),
              input('開場注入日記篇數', 'diaryCount', '', 'number'),
              input('日記注入字元預算', 'diaryChars', '', 'number'),
              input('人設注入字元上限', 'maxChars', '', 'number')),
            h('div', { className: 'hl-muted' },
              'DSH_HOME：' + (status.paths?.dshHome || '尚未取得') + '\n'
              + '工作區：' + (status.paths?.workspace || cfg.workspace || '尚未設定') + '\n'
              + '資料索引：' + (status.paths?.dataRoot || '尚未取得') + '\n'
              + '日記：' + (status.paths?.diary || '尚未取得') + '\n'
              + '核心記憶：' + (status.paths?.coreMemory || '尚未取得') + '\n'
              + '核心記憶索引：' + (status.paths?.coreNotes || '尚未取得') + '\n'
              + 'Browse 設定：' + (status.paths?.browseConfig || '尚未取得') + '\n'
              + 'Wake 佇列：' + (status.paths?.wakeQueue || '尚未取得') + '\n'
              + '語音輸出：' + (status.paths?.voiceOutput || '尚未取得') + '\n'
              + 'Bilibili 憑證：' + (status.paths?.bilibiliCredentials || '尚未取得') + '\n'
              + 'Skill 隔離狀態：' + (status.paths?.skillIsolationState || '尚未取得')),
            area('人設檔案清單（每行一個相對路徑）', 'personaFiles', '首次初始化會建立預設檔案；自訂路徑若不存在不會覆蓋其他檔案。', 3),
            h('div', { className: 'hl-actions' }, button('初始化／補齊工作區', initialize, true, busy)))),
        card('人設、規則與日記編輯', '直接在 Hers Life 設定頁編輯工作區內的 Markdown，不必自行尋找檔案。人設檔、AGENTS.md 與日期格式日記才允許寫入。',
          h(React.Fragment, null,
            h('div', { className: 'hl-grid' },
              h('label', { className: 'hl-field' },
                h('span', { className: 'hl-label' }, '要編輯的檔案'),
                h('select', {
                  className: 'hl-input',
                  value: workspaceFilePath,
                  onChange: (e) => {
                    const selected = workspaceFiles.find((file) => file.path === e.target.value)
                    setWorkspaceFilePath(e.target.value)
                    setWorkspaceFileContent(selected?.content || '')
                  },
                }, workspaceFiles.map((file) => h('option', { key: file.path, value: file.path }, file.path))),
              ),
              h('div', { className: 'hl-muted' }, '可編輯 ' + workspaceFiles.length + ' 個檔案；日記列表保留最近 12 篇，並包含今天的日記檔。')),
            h('label', { className: 'hl-field' },
              h('span', { className: 'hl-label' }, 'Markdown 內容'),
              h('textarea', {
                className: 'hl-input hl-area',
                rows: 14,
                value: workspaceFileContent,
                onChange: (e) => setWorkspaceFileContent(e.target.value),
                placeholder: '選擇一份人設檔、規則檔或日記開始編輯。',
              })),
            h('div', { className: 'hl-actions' },
              button('保存檔案', saveWorkspaceFile, true, busy),
              button('重新讀取檔案', refreshWorkspaceFiles, false, busy)))),
        card('跨頻道與跨伺服器記憶', 'DM、一般頻道與 Thread 各有獨立 session；這裡控制的是相關事件能否被其他 session 召回，不是把整份聊天歷史混在一起。',
          h(React.Fragment, null,
            check('啟用跨會話記憶召回', 'memory.enabled', '關閉後只保留各 session 自己的歷史。'),
            check('同一伺服器不同頻道互相記得', 'memory.shareAcrossChannels', '例如 #頻道一談過的主題可在 #頻道二被想起。'),
            check('同一 Owner 的跨伺服器記憶', 'memory.shareAcrossGuilds', '只有目前發言者是同一位 Owner 時，才會召回他在其他伺服器的訊息與她對他的回覆；其他成員不跨伺服器共享。'),
            check('Owner 私訊可在 Owner 的其他私訊會話中共享', 'memory.sharePrivateToOwner', '不會讀取其他使用者的私訊。'),
            check('允許 Owner 本人發言時使用私訊作為背景', 'memory.allowPrivateContextInGuild', '只在 Owner 自己於公開頻道發言時召回；不向其他成員透露私訊原文、措辭、時間或來源。', true),
            h('div', { className: 'hl-grid' },
              input('每輪最多召回幾條事件', 'memory.maxRecall', '', 'number'),
              input('記憶最長保留天數', 'memory.maxAgeDays', '', 'number')))),
        card('興趣與語音', '公開頻道訊息先被動記錄；只有命中興趣主題並通過冷卻／靜默限制，才可能主動接話。AI 可以選擇不加入。',
          h(React.Fragment, null,
            check('啟用興趣學習與主動喚醒', 'interest.enabled', '關閉後不再學習或主動插話；正常 @ 回覆不受影響。'),
            check('啟用 Discord 語音', 'voice.enabled', '語音需要 FFmpeg 與目前可用的 DAVE 原生模組。'),
            h('div', { className: 'hl-grid' },
              input('FFmpeg 執行檔路徑', 'voice.ffmpeg', '可填 ffmpeg 或絕對路徑。'),
              input('TTS 預設音色', 'voice.ttsVoice', '例如 zh-CN-XiaoxiaoNeural、zh-CN-YunxiNeural 或 zh-CN-XiaoyiNeural。'),
              input('TTS 預設語速', 'voice.ttsRate', '例如 +0%、+10% 或 -10%。'),
              input('最低訊息字數', 'interest.minChars', '', 'number'),
              input('上下文行數', 'interest.contextLines', '', 'number'),
              input('全域冷卻（分鐘）', 'interest.minGapMinutes', '', 'number'),
              input('每小時最多喚醒次數', 'interest.maxPerHour', '', 'number'),
              input('頻道冷卻（分鐘）', 'interest.channelGapMinutes', '', 'number'),
              input('靜默時段（本機時間）', 'interest.quietHours', '例如 01:00-08:00；留空表示不限制。')),
            h('label', { className: 'hl-field' },
              h('span', { className: 'hl-label' }, '關注主題（每行：主題名稱: 關鍵詞1, 關鍵詞2）'),
              h('textarea', { className: 'hl-input hl-area', rows: 5, value: interestTopicsText, onChange: (e) => setInterestTopicsText(e.target.value), placeholder: 'AI 模型: DeepSeek, Gemini, GPT\n遊戲: 終末地, 鳴潮' }),
              h('small', { className: 'hl-hint' }, '重複出現三次以上的詞會自動進入已學習清單；你也可以在這裡手動整理主題。')),
            h('label', { className: 'hl-field' },
              h('span', { className: 'hl-label' }, '忽略詞（逗號或換行分隔）'),
              h('textarea', { className: 'hl-input hl-area', rows: 2, value: interestMuteText, onChange: (e) => setInterestMuteText(e.target.value) })),
            h('div', { className: 'hl-actions' },
              button('保存興趣主題', saveInterestConfig, false, busy),
              button(interestState?.state?.off ? '恢復興趣喚醒' : '暫停興趣喚醒', toggleInterestPause, false, busy),
              h('span', { className: 'hl-muted' }, '最近一小時喚醒：' + (interestState?.state?.wakesLastHour ?? 0) + ' / ' + (interestState?.state?.maxPerHour ?? cfg.interest.maxPerHour ?? 3))))),

        card('Browse 自主瀏覽與手機操作', '所有排程、ADB、目標 App 與限制都集中在這裡。花費／購買不再有隱藏硬攔截；關機、重啟、刷機仍保留安全限制。修改後請重啟 DSH。',
          h(React.Fragment, null,
            check('啟用自主瀏覽', 'browse.enabled', '關閉後不再排程或執行自主瀏覽。'),
            h('div', { className: 'hl-grid' },
              input('空閒多久後開始（分鐘）', 'browse.idleMinutes', '', 'number'),
              input('兩輪最小間隔（分鐘）', 'browse.minGapMinutes', '', 'number'),
              input('每日最多輪數', 'browse.dailyMax', '', 'number'),
              input('每輪最多 Session 數', 'browse.sessionRounds', '', 'number'),
              input('每輪最多開啟項目', 'browse.maxItems', '', 'number'),
              input('每輪最多截圖數', 'browse.maxShots', '', 'number'),
              input('Browse Agent 預設（留空用 DSH 預設）', 'browse.agentPreset', ''),
              input('靜默時段', 'browse.quietHours', '例如 08:00-18:30'),
              input('間隔模式（fixed／random／heartbeat）', 'browse.gapMode', 'fixed'),
              input('心跳最短（分鐘）', 'browse.hbMin', '', 'number'),
              input('心跳中位（分鐘）', 'browse.hbCenter', '', 'number'),
              input('心跳最長（分鐘）', 'browse.hbMax', '', 'number'),
              input('假日設定檔（相對工作區）', 'browse.holidaysFile', '例如 live/holidays.json'),
              input('ADB 執行檔完整路徑', 'browse.adbPath', '例如 D:\\MuMuPlayer\\nx_device\\12.0\\shell\\adb.exe'),
              input('ADB 裝置序號', 'browse.serial', '例如 127.0.0.1:16448')),
            area('允許瀏覽的平台（每行一個）', 'browse.targets', '例如 bilibili、xiaohongshu。', 2),
            area('社交 App 套件名稱（每行一個）', 'browse.socialApps', '用於判斷目前前景 App。', 3),
            area('仍需限制的社交互動詞（每行一個）', 'browse.socialWriteWords', '保留你先前指定的社交平台互動限制。', 3),
            h('label', { className: 'hl-field' },
              h('span', { className: 'hl-label' }, '自由時段（JSON 陣列）'),
              h('textarea', { className: 'hl-input hl-area', rows: 5, value: browseWindowsDraft, onChange: (e) => setBrowseWindowsDraft(e.target.value) }),
              h('small', { className: 'hl-hint' }, '格式：[{"start":"18:30","end":"08:00"},{"start":"13:50","end":"18:15","only":"rest"}]。時間使用 24 小時制。')))),

        card('Resume 中斷接續', '管理手機中斷後的媒體恢復與 ADB 連線；不需要手動修改插件設定檔。',
          h(React.Fragment, null,
            check('啟用中斷接續', 'resume.enabled', '關閉後不會自動恢復中斷前的播放狀態。'),
            check('中斷時暫停媒體', 'resume.pauseMediaOnInterrupt', '重新連線後依保存狀態恢復。'),
            h('div', { className: 'hl-grid' },
              input('ADB 執行檔完整路徑', 'resume.adbPath', '留空使用系統預設。'),
              input('ADB 裝置序號', 'resume.serial', '例如 127.0.0.1:7555')))),

        card('Wake 主動提醒', '管理 Wake 插件是否啟用。排程仍使用目前 Discord Session，不會把不同頻道合併。',
          check('啟用 Wake 排程', 'wake.enabled', '關閉後不再建立或觸發 Wake 任務。')),

        card('Voice 與 TTS 執行環境', '除了 Discord 語音選項，也可指定本機執行檔，避免依賴 Windows PATH。修改後請重啟 DSH。',
          h(React.Fragment, null,
            h('div', { className: 'hl-grid' },
              input('FFmpeg 完整路徑', 'voice.ffmpeg', 'ffmpeg 或絕對路徑。'),
              input('Python 完整路徑', 'voice.python', 'python 或 python.exe 完整路徑。'),
              input('語音請求逾時（毫秒）', 'voice.timeoutMs', '', 'number')))),

        card('Mousepet 桌寵與網頁拾取', '桌寵游標、泡泡及網頁拾取資料夾。留空的工作區會沿用 Hers Life 共用工作區。',
          h(React.Fragment, null,
            check('啟用 Mousepet', 'mousepet.enabled', '關閉後不啟動桌寵工具。'),
            h('div', { className: 'hl-grid' },
              input('游標模式（companion／clean）', 'mousepet.cursorMode', 'companion 或 clean'),
              input('游標停留時間（毫秒）', 'mousepet.cursorHoldMs', '', 'number'),
              input('游標尺寸', 'mousepet.cursorSize', '', 'number'),
              input('游標皮膚 ID', 'mousepet.cursorState', 'pointer 或 custom:skin-name'),
              input('晃動靈敏度（low／medium／high）', 'mousepet.shake.level', 'medium'),
              input('網頁拾取資料夾', 'mousepet.webpickDir', '留空使用工作區預設位置'),
              input('DSH Tools 模組路徑（通常留空）', 'mousepet.toolsPath', '僅在 DSH 無法自動載入 dsh-tools 時指定。'),
              input('桌寵工作區覆寫', 'mousepet.companion.workspace', '留空沿用共用工作區'),
              input('桌寵更新間隔（毫秒）', 'mousepet.companion.tickMs', '0 表示使用預設節奏。', 'number'),
              input('桌寵模型供應商', 'mousepet.companion.provider', ''),
              input('桌寵模型名稱', 'mousepet.companion.model', ''),
              input('對話泡泡顯示時間（毫秒）', 'mousepet.companion.bubbleMs', '', 'number')),
            check('啟用桌寵主動陪伴', 'mousepet.companion.enabled', '關閉後保留桌寵本體，但停止主動陪伴。')),

        card('Bilibili 帳號與資料', 'Cookie 由帳號管理器及 DSH 憑證服務管理；這裡只設定憑證檔位置與讀取上限，不會把 Cookie 顯示在 UI。',
          h(React.Fragment, null,
            check('啟用 Bilibili 功能', 'bilibili.enabled', '關閉後不註冊 Bilibili 工具。'),
            h('div', { className: 'hl-grid' },
              input('憑證檔路徑', 'bilibili.credentialFile', '留空使用 DSH_HOME/bili-duty/bili_credential.json。'),
              input('搜尋最大頁數', 'bilibili.searchMaxPageSize', '', 'number'),
              input('字幕最大字元數', 'bilibili.subtitleMaxChars', '', 'number'),
              input('請求逾時（毫秒）', 'bilibili.timeoutMs', '', 'number')),
            h('div', { className: 'hl-muted' },
              '登入狀態：' + (status.plugins?.bilibili?.loggedIn ? '已登入' : status.plugins?.bilibili ? '未登入' : '插件尚未回報狀態') + '\n'
              + '帳號：' + (status.plugins?.bilibili?.userName || '—') + '\n'
              + 'UID：' + (status.plugins?.bilibili?.userId || '—')))),

        card('Activities、Skill Isolate 與 Graph', '集中管理其他配套插件的啟用狀態、資料檔路徑與同步頻率。修改後請重啟 DSH。',
          h(React.Fragment, null,
            check('啟用 Activities', 'activities.enabled', '活動排程與活動工具。'),
            check('啟用 Skill Isolate', 'skillIsolate.enabled', '技能隔離與狀態保存。'),
            check('啟用 Core Memory', 'coreMemory.enabled', '核心記憶、歸檔記憶與來源追溯工具。'),
            input('Skill Isolate 狀態檔路徑', 'skillIsolate.stateFile', '留空使用 DSH_HOME 預設位置。'),
            check('啟用 Graph', 'graph.enabled', '關閉後停止 Graph 同步與相關面板。'),
            h('div', { className: 'hl-grid' },
              input('Graph 同步間隔（秒）', 'graph.syncSeconds', '', 'number'),
              input('價格資料檔路徑', 'graph.costPricesFile', '留空使用工作區預設位置。'),
              input('自動價格資料檔路徑', 'graph.costAutoFile', '留空使用 DSH_HOME 預設位置。')))),


        card('即時診斷與近期事件', '事件列表可協助確認 Bot 是否收到伺服器、頻道、Thread 的 Gateway 事件。',
          h(React.Fragment, null,
            h('div', { className: 'hl-actions' }, button('重新讀取', load, false, busy), h('span', { className: 'hl-muted' }, '已建立會話索引：' + sessions.length)),
            h('div', { className: 'hl-events' }, events.length
              ? events.slice(0, 30).map((event, i) => h('div', { key: event.id || i, className: 'hl-event' },
                h('b', null, event.kind || event.type || '事件'), ' · ', new Date(event.at || Date.now()).toLocaleString(),
                h('div', { className: 'hl-muted' }, event.summary || '')))
              : h('div', { className: 'hl-muted' }, '目前沒有 Gateway 事件；先保存 Bot Token 並啟用 Discord。')))),

        h('div', { className: 'hl-actions' }, button(busy ? '處理中…' : '保存所有設定', save, true, busy), button('重新讀取', load, false, busy))
      )
    }

    return {
      apply() {
        window.__HERS_LIFE_SETTINGS_PANEL = SettingsPanel
        try { window.dispatchEvent(new Event('hers-life-settings-ready')) } catch {}
        const page = { id: 'ming-settings', label: '設定', order: 95, title: 'Hers Life Discord、人格、記憶與工作區設定', render: SettingsPanel }
        if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') window.__MING_TAB_HOST.add(page)
        else (window.__MING_TABS_PENDING || (window.__MING_TABS_PENDING = [])).push(page)
      },
    }
  },
})
