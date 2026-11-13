/**
 * dsh-ming-discord —— Discord 橋接設定面板
 * 由 dsh-ming-graph/build.mjs 直接拼入 client.js；本文件是唯一 UI 源。
 */
const DISCORD_API = '/_dsh/dsh-ming-discord'

function DiscordPanel() {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setError('')
    return fetch(DISCORD_API + '/state', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((d) => {
        if (!d || d.ok === false) throw new Error((d && d.error) || '讀取 Discord 設定失敗')
        setData(d)
        const s = d.settings || {}
        setDraft({
          mentionRequired: s.mentionRequired !== false,
          directMessages: s.directMessages !== false,
          observeUnmentioned: s.observeUnmentioned !== false,
          allowedGuildIdsText: (s.allowedGuildIds || []).join('\\n'),
          allowedChannelIdsText: (s.allowedChannelIds || []).join('\\n'),
          allowedUserIdsText: (s.allowedUserIds || []).join('\\n'),
          newMessagePolicy: s.newMessagePolicy || 'steer',
          maxAttachmentMB: Math.round((Number(s.maxAttachmentBytes) || 10485760) / 1048576),
        })
      })
      .catch((e) => setError(String((e && e.message) || e)))
      .finally(() => setBusy(false))
  }, [])

  useEffect(() => { load() }, [load])

  const set = (key, value) => setDraft((old) => old ? Object.assign({}, old, { [key]: value }) : old)
  const save = useCallback(() => {
    if (!draft || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    const ids = (value) => String(value || '').split(/\r?\n|[,;]/).map((x) => x.trim()).filter(Boolean)
    const body = {
      mentionRequired: draft.mentionRequired,
      directMessages: draft.directMessages,
      observeUnmentioned: draft.observeUnmentioned,
      allowedGuildIds: ids(draft.allowedGuildIdsText),
      allowedChannelIds: ids(draft.allowedChannelIdsText),
      allowedUserIds: ids(draft.allowedUserIdsText),
      newMessagePolicy: draft.newMessagePolicy,
      maxAttachmentBytes: Math.max(1, Math.min(50, Number(draft.maxAttachmentMB) || 10)) * 1048576,
    }
    return fetch(DISCORD_API + '/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((d) => { if (!r.ok || !d.ok) throw new Error((d && d.error) || '儲存失敗'); return d }))
      .then(() => { setNotice('設定已儲存，新的 Discord 訊息會立即套用。'); return load() })
      .catch((e) => setError(String((e && e.message) || e)))
      .finally(() => setSaving(false))
  }, [draft, saving, load])

  const toggle = (key, title, detail) => h('label', {
    className: 'ming-row',
    style: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', cursor: 'pointer' },
  },
    h('input', {
      type: 'checkbox',
      checked: Boolean(draft && draft[key]),
      onChange: (e) => set(key, e.target.checked),
      style: { marginTop: 4 },
    }),
    h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      h('strong', null, title),
      h('span', { className: 'ming-note' }, detail),
    ),
  )

  const area = (key, title, hint) => h('label', { style: { display: 'block', marginTop: 12 } },
    h('div', { style: { fontWeight: 600, marginBottom: 5 } }, title),
    h('div', { className: 'ming-note', style: { marginBottom: 6 } }, hint),
    h('textarea', {
      value: draft ? draft[key] : '',
      onChange: (e) => set(key, e.target.value),
      rows: 3,
      spellCheck: false,
      placeholder: '每行一個 Discord ID；留空代表不限制',
      style: { width: '100%', minHeight: 76, resize: 'vertical', boxSizing: 'border-box' },
    }),
  )

  const status = data ? ({
    connected: '已連線',
    connecting: '連線中',
    starting: '準備啟動',
    disabled: '插件已停用',
    'missing-token': '缺少 Bot Token',
    error: '連線失敗',
  }[data.status] || data.status || '未知') : '讀取中…'

  return h('div', { className: 'ming-page' },
    h('div', { className: 'ming-ph' },
      h('div', { className: 'ming-ph-ic' },
        h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
          h('path', { d: 'M4 5h16v11H8l-4 4V5z' }),
          h('path', { d: 'M8 9h8M8 12h5' }))),
      h('div', { className: 'ming-ph-tx' },
        h('div', { className: 'ming-ph-t' }, 'Discord'),
        h('div', { className: 'ming-ph-d' }, '頻道接收、回覆條件與安全範圍'),
      ),
      h('div', { className: 'ming-ph-a' },
        h('span', { className: 'ming-pill' }, status),
        h('button', { className: 'ming-btn', onClick: load, disabled: busy }, busy ? '讀取中…' : '重新讀取'),
      ),
    ),
    h('div', { className: 'ming-wrap ming-scroll' },
      error ? h('div', { className: 'ming-empty' }, '△ ' + error) : null,
      notice ? h('div', { className: 'ming-note', style: { padding: 9, marginBottom: 10 } }, notice) : null,
      data && data.tokenPresent === false ? h('div', { className: 'ming-empty' }, '尚未讀取到 DISCORD_BOT_TOKEN。Token 不會顯示在這個面板，請在 Windows 環境變數設定。') : null,
      draft ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '訊息接收與回覆'),
          h('span', { className: 'ming-sec-n' }, '即時生效'),
        ),
        h('div', { className: 'ming-sec-b' },
          toggle('mentionRequired', '群組訊息必須 @ Bot 才直接回覆', '開啟時，未 @ 的訊息仍可被觀察並交給興趣插件判斷；關閉時，符合白名單的群組訊息都會直接送進 Agent。'),
          toggle('directMessages', '允許 Discord 私訊', '關閉後不接收私訊；開啟時私訊不需要 @ Bot。'),
          toggle('observeUnmentioned', '記錄未 @ 的群組訊息供共享記憶觀察', '關閉後只記錄符合直接回覆條件的群組訊息。這不會把訊息轉發到其他群組。'),
        ),
      ) : null,
      draft ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, '伺服器與頻道範圍'),
          h('span', { className: 'ming-sec-n' }, '留空 = 全部'),
        ),
        h('div', { className: 'ming-sec-b' },
          area('allowedGuildIdsText', '伺服器 ID 白名單', '只接收這些伺服器。留空代表所有伺服器。'),
          area('allowedChannelIdsText', '頻道 ID 白名單', '只接收這些頻道。留空代表所有頻道；若伺服器白名單也有設定，兩者都必須符合。'),
          area('allowedUserIdsText', '使用者 ID 白名單', '只接收這些使用者。留空代表所有使用者。環境變數 MING_DISCORD_ALLOWED_USER_IDS 與主人 ID 仍會額外加入，不會被面板移除。'),
          data && data.settings && data.settings.environmentUserAllowCount
            ? h('div', { className: 'ming-note' }, '目前另有 ' + data.settings.environmentUserAllowCount + ' 個由環境變數／主人設定加入的使用者限制。')
            : null,
        ),
      ) : null,
      draft ? h('div', { className: 'ming-sec' },
        h('div', { className: 'ming-sec-h' },
          h('span', { className: 'ming-sec-t' }, 'Agent 行為'),
          h('span', { className: 'ming-sec-n' }, '即時生效'),
        ),
        h('div', { className: 'ming-sec-b' },
          h('label', { style: { display: 'block', marginBottom: 12 } },
            h('div', { style: { fontWeight: 600, marginBottom: 5 } }, '新訊息抵達時的處理方式'),
            h('select', {
              value: draft.newMessagePolicy,
              onChange: (e) => set('newMessagePolicy', e.target.value),
              style: { minWidth: 220, padding: 7 },
            },
              h('option', { value: 'steer' }, 'Steer：正在回覆時引導目前 Agent'),
              h('option', { value: 'followup' }, 'Followup：排到目前回覆之後'),
            ),
          ),
          h('label', { style: { display: 'block' } },
            h('div', { style: { fontWeight: 600, marginBottom: 5 } }, '圖片附件大小上限（MB）'),
            h('input', {
              type: 'number', min: 1, max: 50, step: 1,
              value: draft.maxAttachmentMB,
              onChange: (e) => set('maxAttachmentMB', e.target.value),
              style: { width: 100, padding: 7 },
            }),
            h('div', { className: 'ming-note' }, '只影響 Discord 圖片下載與送入模型的大小上限，範圍 1–50 MB。'),
          ),
        ),
      ) : null,
      draft ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 0 24px' } },
        h('button', { className: 'ming-btn', onClick: load, disabled: saving }, '還原目前設定'),
        h('button', { className: 'ming-btn primary', onClick: save, disabled: saving }, saving ? '儲存中…' : '儲存 Discord 設定'),
      ) : null,
      h('div', { className: 'ming-note', style: { paddingBottom: 18 } },
        '安全提醒：空白白名單代表不限制。Bot 可能使用該 Discord Session 可用的 DSH 工具，請只邀請到可信任的伺服器與頻道。',
      ),
    ),
  )
}
