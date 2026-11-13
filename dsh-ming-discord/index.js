import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, appendFile, stat } from 'node:fs/promises'
import { Client, GatewayIntentBits, Partials } from 'discord.js'

export const name = 'ming-discord'
export const inject = ['agents', 'attachments']

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

function list(value) {
  return Array.isArray(value) ? value.map(x => String(x).trim()).filter(Boolean) : []
}
function sessionIdFor(message) {
  return message.guildId
    ? 'discord-guild-' + message.guildId + '-channel-' + message.channelId
    : 'discord-dm-' + message.author.id
}
function splitMessage(text, limit = 1900) {
  let rest = String(text || '').trim()
  const chunks = []
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit)
    if (cut < limit / 2) cut = limit
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}
function messageText(message) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}
function imageType(a) {
  const type = String(a.contentType || '').split(';')[0].toLowerCase()
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) return type
  const ext = path.extname(a.name || '').toLowerCase()
  return ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'})[ext] || ''
}

export function apply(ctx, input = {}) {
  const cfg = {
    enabled: input.enabled !== false,
    token: input.token || process.env.DISCORD_BOT_TOKEN || '',
    provider: input.provider || '',
    model: input.model || '',
    workspacePath: path.resolve(input.workspacePath || process.env.MING_WORKSPACE || path.join(DSH_HOME, 'workspace')),
    agentPreset: input.agentPreset || '',
    mentionRequired: input.mentionRequired !== false,
    directMessages: input.directMessages !== false,
    observeUnmentioned: input.observeUnmentioned !== false,
    allowedGuildIds: list(input.allowedGuildIds),
    allowedChannelIds: list(input.allowedChannelIds),
    configuredAllowedUserIds: list(input.allowedUserIds),
    envAllowedUserIds: [...new Set([...(process.env.MING_DISCORD_ALLOWED_USER_IDS || '').split(',').map(x => x.trim()), process.env.MING_OWNER_DISCORD_ID || ''].filter(Boolean))],
    allowedUserIds: [...new Set([...list(input.allowedUserIds), ...(process.env.MING_DISCORD_ALLOWED_USER_IDS || '').split(',').map(x => x.trim()), process.env.MING_OWNER_DISCORD_ID || ''].filter(Boolean))],
    ownerUserIds: [...new Set([...list(input.ownerUserIds), process.env.MING_OWNER_DISCORD_ID || ''].filter(Boolean))],
    newMessagePolicy: input.newMessagePolicy === 'followup' ? 'followup' : 'steer',
    maxAttachmentBytes: Number.isFinite(Number(input.maxAttachmentBytes)) && Number(input.maxAttachmentBytes) > 0
      ? Math.floor(Number(input.maxAttachmentBytes)) : 10 * 1024 * 1024,
    inboxPath: input.inboxPath || path.join(DSH_HOME, 'media', 'onebot', 'qq-inbox.jsonl'),
    chatSessionsPath: input.chatSessionsPath || path.join(DSH_HOME, 'media', 'onebot', 'chat-sessions.json'),
  }
  const settingsDir = path.join(DSH_HOME, 'ming-discord')
  const settingsFile = path.join(settingsDir, 'settings.json')
  let gatewayStatus = cfg.enabled ? (cfg.token ? 'starting' : 'missing-token') : 'disabled'
  const cleanIds = value => {
    const values = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/)
    return [...new Set(values.map(x => String(x).trim()).filter(x => /^\d{5,25}$/.test(x)))].slice(0, 200)
  }
  const normalizeUiSettings = raw => ({
    mentionRequired: raw.mentionRequired !== false,
    directMessages: raw.directMessages !== false,
    observeUnmentioned: raw.observeUnmentioned !== false,
    allowedGuildIds: cleanIds(raw.allowedGuildIds),
    allowedChannelIds: cleanIds(raw.allowedChannelIds),
    configuredAllowedUserIds: cleanIds(raw.allowedUserIds ?? raw.configuredAllowedUserIds),
    newMessagePolicy: raw.newMessagePolicy === 'followup' ? 'followup' : 'steer',
    maxAttachmentBytes: Math.max(1024 * 1024, Math.min(50 * 1024 * 1024, Math.floor(Number(raw.maxAttachmentBytes) || cfg.maxAttachmentBytes))),
  })
  const applyUiSettings = raw => {
    const next = normalizeUiSettings(raw)
    Object.assign(cfg, next)
    cfg.allowedUserIds = [...new Set([...cfg.configuredAllowedUserIds, ...cfg.envAllowedUserIds])]
    return next
  }
  const settingsReady = readFile(settingsFile, 'utf8').then(raw => {
    try { applyUiSettings(JSON.parse(raw)) } catch (error) { log('warn', 'saved settings parse failed: ' + String(error)) }
  }).catch(error => { if (error?.code !== 'ENOENT') log('warn', 'saved settings read failed: ' + String(error)) })

  const logPath = path.join(DSH_HOME, 'ming-discord', 'discord.log')
  let logQueue = Promise.resolve()
  const log = (level, message) => {
    const timestamp = new Intl.DateTimeFormat('sv-SE', {
	  timeZone: 'Asia/Taipei',
	  year: 'numeric',
	  month: '2-digit',
	  day: '2-digit',
	  hour: '2-digit',
	  minute: '2-digit',
	  second: '2-digit',
	  hourCycle: 'h23',
	}).format(new Date()).replace(' ', 'T')

	const line = `[${timestamp}+08:00] [${level}] [ming-discord] ${String(message)}`
    try { ctx.logger?.[level]?.('[ming-discord] ' + message) } catch {}
    // 獨立寫入本機診斷日誌；只記錄 Token 是否存在，絕不記錄 Token 本身。
    logQueue = logQueue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(logPath), { recursive: true })
      await appendFile(logPath, line + '\n', 'utf8')
    }).catch(() => {})
  }

  // 面板 API 即使 Bot 未連線也可用；只允許調整非憑證設定，Token 永不回傳或寫入設定檔。
  ctx.inject(['connection', 'webServer'], webCtx => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/_dsh/dsh-ming-discord',
      handler: async (req, res) => {
        const send = (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        try {
          if (webCtx.connection && typeof webCtx.connection.requestRejection === 'function') {
            const rejection = webCtx.connection.requestRejection(req)
            if (rejection) { send(rejection, { ok: false, error: 'rejected' }); return }
          }
          await settingsReady
          const url = new URL(req.url || '/', 'http://localhost')
          const action = url.pathname.replace('/_dsh/dsh-ming-discord', '').replace(/^\//, '')
          if (action === 'state' && req.method === 'GET') {
            send(200, {
              ok: true,
              status: gatewayStatus,
              tokenPresent: Boolean(cfg.token),
              settings: {
                mentionRequired: cfg.mentionRequired,
                directMessages: cfg.directMessages,
                observeUnmentioned: cfg.observeUnmentioned,
                allowedGuildIds: cfg.allowedGuildIds,
                allowedChannelIds: cfg.allowedChannelIds,
                allowedUserIds: cfg.configuredAllowedUserIds,
                environmentUserAllowCount: cfg.envAllowedUserIds.length,
                newMessagePolicy: cfg.newMessagePolicy,
                maxAttachmentBytes: cfg.maxAttachmentBytes,
              },
            })
            return
          }
          if (action === 'settings' && req.method === 'POST') {
            const chunks = []
            let size = 0
            for await (const chunk of req) {
              size += chunk.length
              if (size > 32768) { send(413, { ok: false, error: 'request body too large' }); return }
              chunks.push(Buffer.from(chunk))
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
            const next = normalizeUiSettings(body)
            await mkdir(settingsDir, { recursive: true })
            const temp = settingsFile + '.' + randomUUID() + '.tmp'
            await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
            await rename(temp, settingsFile)
            applyUiSettings(next)
            send(200, { ok: true, settings: next })
            return
          }
          send(404, { ok: false, error: 'not found' })
        } catch (error) {
          log('warn', 'settings API failed: ' + String(error))
          send(400, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }), 'ming-discord: settings api')
  })

  log('info', 'apply() 已進入')
  log('info', `設定摘要：enabled=${cfg.enabled}, tokenPresent=${Boolean(cfg.token)}, workspacePath=${cfg.workspacePath}`)
  if (!cfg.enabled) {
    log('warn', 'enabled=false，bridge 不會啟動')
    return
  }
  if (!cfg.token) {
    log('error', 'DISCORD_BOT_TOKEN 未設定，bridge 不會啟動')
    return
  }

  log('info', '準備註冊 ctx.effect()')
  ctx.effect(() => {
    let disposed = false
    gatewayStatus = 'connecting'
    log('info', 'ctx.effect() 已執行，開始建立 Discord Client')
    let inboxQueue = Promise.resolve()
    let mapQueue = Promise.resolve()
    const handles = new Map()
    const creating = new Map()
    const sessionChannels = new Map()
    const sessionIds = new Map()
    const pendingReplies = new Map()
    const pendingVoiceCalls = new Set()
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Channel],
    })
    log('info', 'Discord Client 建立完成')
    client.on('error', error => log('error', 'Discord Client error: ' + String(error)))
    
	client.on('error', error => {
	  log('error', 'Discord Client error: ' + (error?.stack || String(error)))
	})

	client.on('shardError', (error, shardId) => {
	  log('error', `Discord shard error: shard=${shardId}, error=${error?.stack || String(error)}`)
	})

	client.on('shardDisconnect', (event, shardId) => {
	  log(
		'warn',
		`Gateway disconnected: shard=${shardId}, code=${event?.code ?? 'unknown'}, clean=${event?.wasClean ?? 'unknown'}, reason=${event?.reason ? String(event.reason) : '(no reason)'}`
	  )
	})

	client.on('shardReconnecting', shardId => {
	  log('warn', `Gateway reconnecting: shard=${shardId}`)
	})

	client.on('shardResume', (shardId, replayedEvents) => {
	  log('info', `Gateway resumed: shard=${shardId}, replayed=${replayedEvents}`)
	})

	client.on('shardReady', (shardId, unavailableGuilds) => {
	  log(
		'info',
		`Gateway shard ready: shard=${shardId}, unavailableGuilds=${unavailableGuilds?.size ?? 0}`
	  )
	})


    const saveMap = (chatId, sessionId) => {
      mapQueue = mapQueue.catch(() => {}).then(async () => {
        await mkdir(path.dirname(cfg.chatSessionsPath), { recursive: true })
        let map = {}
        try { map = JSON.parse(await readFile(cfg.chatSessionsPath, 'utf8')) } catch {}
        map[chatId] = sessionId
        const temp = cfg.chatSessionsPath + '.' + randomUUID() + '.tmp'
        await writeFile(temp, JSON.stringify(map, null, 2) + '\n', 'utf8')
        await rename(temp, cfg.chatSessionsPath)
      })
      return mapQueue
    }

    const recordInbox = message => {
      if (!message.guildId) return Promise.resolve()
      inboxQueue = inboxQueue.catch(() => {}).then(async () => {
        const groupId = 'discord:' + message.guildId + ':' + message.channelId
        const responded = !cfg.mentionRequired || Boolean(client.user && message.mentions.has(client.user))
        const attachmentText = [...(message.attachments?.values?.() || [])].map((a) => {
          const name = String(a.name || a.filename || 'attachment')
          const kind = String(a.contentType || '')
          return '[附件 ' + name + (kind ? ' · ' + kind : '') + '] ' + String(a.url || '')
        })
        const embedText = (message.embeds || []).map((e) =>
          [e.title, e.description, e.url].filter(Boolean).join(' ')
        ).filter(Boolean)
        const observedText = [message.content || '', ...embedText, ...attachmentText].filter(Boolean).join('\n')
        const line = {
          ts: Date.now(), kind: 'message', message_id: String(message.id || ''),
          decision: { ok: responded, stage: 'discord-mention-gate', reason: responded ? 'accepted by Discord bridge' : 'unmentioned message for interest matching' },
          source: 'discord',
          frame: {
            message_id: String(message.id || ''),
            message_type: 'group', group_id: groupId,
            user_id: String(message.author.id), self_id: String(client.user?.id || ''),
            sender: { card: message.member?.displayName || message.author.globalName || message.author.username, nickname: message.author.username },
            message: [{ type: 'text', data: { text: observedText } }],
          },
        }
        await mkdir(path.dirname(cfg.inboxPath), { recursive: true })
        await appendFile(cfg.inboxPath, JSON.stringify(line) + '\n', 'utf8')
        const chatKey = 'group:' + groupId
        const sessionId = sessionIds.get(chatKey) || sessionIdFor(message)
        sessionIds.set(chatKey, sessionId)
        sessionChannels.set(sessionId, message.channelId)
        await saveMap(chatKey, sessionId)
      })
      return inboxQueue
    }

    const restoreRoutes = async () => {
      try {
        const saved = JSON.parse(await readFile(cfg.chatSessionsPath, 'utf8'))
        for (const [key, sessionId] of Object.entries(saved || {})) {
          if (typeof sessionId !== 'string' || !sessionId) continue
          if (key.startsWith('group:discord:')) {
            const parts = key.split(':')
            if (parts.length >= 4) {
              sessionIds.set(key, sessionId)
              sessionChannels.set(sessionId, parts.slice(3).join(':'))
            }
          } else if (key.startsWith('discord:dm:')) {
            sessionIds.set(key, sessionId)
            const userId = key.slice('discord:dm:'.length)
            try {
              const user = await client.users.fetch(userId)
              const dm = await user.createDM()
              sessionChannels.set(sessionId, dm.id)
            } catch (error) {
              log('warn', 'restore DM route failed: ' + String(error))
            }
          }
        }
      } catch {}
    }
    let routeRestore = Promise.resolve()

    const resolveSession = message => {
      const isDm = !message.guildId
      const chatKey = isDm
        ? 'discord:dm:' + message.author.id
        : 'group:discord:' + message.guildId + ':' + message.channelId
      let id = sessionIds.get(chatKey) || sessionIdFor(message)
      let archived = new Set()
      try {
        const ids = ctx.get('workspaceRegistry')?.archivedSessionIds
        if (Array.isArray(ids)) archived = new Set(ids.map(String))
      } catch {}
      if (archived.has(id)) {
        const base = sessionIdFor(message)
        let suffix = 2
        while (archived.has(base + '-' + suffix) || ctx.agents.get(base + '-' + suffix)) suffix += 1
        id = base + '-' + suffix
        sessionIds.set(chatKey, id)
        void saveMap(chatKey, id).catch(error => log('warn', 'save rotated session mapping failed: ' + String(error)))
      }
      sessionIds.set(chatKey, id)
      return { id, chatKey }
    }

    const getRoute = () => {
      if (cfg.provider && cfg.model) return { provider: cfg.provider, model: cfg.model }
      try {
        const route = ctx.get('agentDefaultModel')?.currentSelection?.()
        if (route && typeof route.provider === 'string' && typeof route.model === 'string') {
          return { provider: route.provider, model: route.model }
        }
      } catch {}
      // 與 ming-browse 相同：未指定時交給 DSH 的 Agent 預設模型選擇。
      return {}
    }

    const ensureAgent = async id => {
      const live = ctx.agents.get(id)
      if (live) return live
      if (creating.has(id)) return creating.get(id)
      const pending = (async () => {
        const agentOptions = getRoute()
        const meta = { cwd: cfg.workspacePath }
        if (cfg.agentPreset) meta.agentPreset = cfg.agentPreset
        const setup = async agentCtx => {
          if (!cfg.agentPreset) return
          try { await ctx.get('agentPresets')?.mount?.(agentCtx, cfg.agentPreset) }
          catch (error) { log('warn', 'preset mount failed: ' + String(error)) }
        }
        try {
          const handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions, setup })
          handles.set(id, handle)
          return handle.agent
        } catch {
          const handle = await ctx.agents.create({ sessionId: id, meta, agentOptions, setup })
          handles.set(id, handle)
          return handle.agent
        }
      })().finally(() => creating.delete(id))
      creating.set(id, pending)
      return pending
    }

    const sendText = async (channelId, text) => {
      const channel = await client.channels.fetch(channelId).catch(() => null)
      if (!channel || typeof channel.send !== 'function') return
      for (const part of splitMessage(text)) {
        await channel.send({ content: part, allowedMentions: { parse: [] } })
          .catch(error => log('warn', 'send failed: ' + String(error)))
      }
    }

    ctx.on('session/event', (session, event) => {
      try {
        const sessionId = String(session?.id || '')
        if (event?.type === 'assistant/message') {
          const channelId = sessionChannels.get(sessionId)
          if (!channelId) return
          const text = messageText(event.data?.message)
          if (text.trim()) pendingReplies.set(sessionId, { channelId, text })
          return
        }
        if (event?.type === 'turn/end') {
          const reply = pendingReplies.get(sessionId)
          if (!reply) return
          pendingReplies.delete(sessionId)
          void sendText(reply.channelId, reply.text)
          return
        }
        if (event?.type === 'tool/call' && event.data?.name === 'voice_say') {
          pendingVoiceCalls.add(sessionId + ':' + String(event.data.callId || ''))
          return
        }
        if (event?.type === 'tool/result') {
          const callId = String(event.data?.message?.toolCallId || '')
          const key = sessionId + ':' + callId
          if (!pendingVoiceCalls.has(key)) return
          pendingVoiceCalls.delete(key)
          const channelId = sessionChannels.get(sessionId)
          const parts = Array.isArray(event.data?.message?.content) ? event.data.message.content : []
          const resultText = parts.filter(part => part?.type === 'text').map(part => part.text || '').join('\n')
          const match = /\bOK\s+\S+\s+(.+\.mp3)\s*$/i.exec(resultText.trim())
          if (!channelId || !match) return
          void (async () => {
            try {
              const voiceRoot = path.resolve(cfg.workspacePath, 'live', 'voice')
              const file = path.resolve(match[1].trim())
              if (!file.startsWith(voiceRoot + path.sep) || path.extname(file).toLowerCase() !== '.mp3') {
                log('warn', 'voice_say returned a path outside live/voice; not uploaded')
                return
              }
              const info = await stat(file)
              if (!info.isFile() || info.size > 8 * 1024 * 1024) {
                log('warn', 'voice file missing or exceeds 8 MiB; not uploaded')
                return
              }
              const data = await readFile(file)
              const channel = await client.channels.fetch(channelId).catch(() => null)
              if (!channel || typeof channel.send !== 'function') return
              await channel.send({
                files: [{ attachment: data, name: path.basename(file) }],
                allowedMentions: { parse: [] },
              })
            } catch (error) { log('warn', 'Discord voice upload failed: ' + String(error)) }
          })()
        }
      } catch (error) { log('warn', 'output event failed: ' + String(error)) }
    })

    client.on('messageCreate', async message => {
      try {
        if (disposed || message.author?.bot) return
        await settingsReady
        const isDm = !message.guildId
        if (isDm && !cfg.directMessages) return
        if (cfg.allowedUserIds.length && !cfg.allowedUserIds.includes(message.author.id)) return
        if (message.guildId && cfg.allowedGuildIds.length && !cfg.allowedGuildIds.includes(message.guildId)) return
        if (cfg.allowedChannelIds.length && !cfg.allowedChannelIds.includes(message.channelId)) return
        const mentioned = Boolean(client.user && message.mentions.has(client.user))
        const shouldRespond = isDm || !cfg.mentionRequired || mentioned
        await routeRestore
        // 即使沒有 @，也先建立頻道到 Session 的回程映射；Interest 喚醒同一 Session 時才能回到原頻道。
        const { id, chatKey } = resolveSession(message)
        sessionChannels.set(id, message.channelId)
        await saveMap(chatKey, id)
        if (cfg.observeUnmentioned || shouldRespond) {
          await recordInbox(message).catch(error => log('warn', 'inbox write failed: ' + String(error)))
        }
        if (!shouldRespond) return
        const agent = await ensureAgent(id)
        const body = client.user
          ? message.content.replace(new RegExp('<@!?'+client.user.id+'>', 'g'), '').trim()
          : message.content.trim()
        const content = [{
          type: 'text',
          text: '<discord_user id="' + message.author.id + '" guild_id="' + (message.guildId || '') +
            '" channel_id="' + message.channelId + '" is_dm="' + isDm +
            '" is_owner="' + cfg.ownerUserIds.includes(message.author.id) + '">\n' +
            (body || '(使用者只傳送了附件)') + '\n</discord_user>',
        }]

        for (const attachment of message.attachments.values()) {
          const mediaType = imageType(attachment)
          if (!mediaType) {
            content.push({ type: 'text', text: '[附件：' + (attachment.name || 'file') + '] ' + attachment.url })
            continue
          }
          if (attachment.size > cfg.maxAttachmentBytes) {
            content.push({ type: 'text', text: '[圖片過大，未下載：' + (attachment.name || 'image') + ']' })
            continue
          }
          const attachmentUrl = new URL(attachment.url)
          if (attachmentUrl.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(attachmentUrl.hostname)) {
            throw new Error('拒絕非 Discord CDN 的附件網址')
          }
          const response = await fetch(attachmentUrl, { redirect: 'error' })
          if (!response.ok) throw new Error('下載 Discord 圖片失敗：HTTP ' + response.status)
          if (!response.body) throw new Error('Discord 圖片回應沒有資料串流')
          const reader = response.body.getReader()
          const chunks = []
          let total = 0
          while (true) {
            const part = await reader.read()
            if (part.done) break
            total += part.value.byteLength
            if (total > cfg.maxAttachmentBytes) {
              await reader.cancel().catch(() => {})
              throw new Error('圖片超過大小上限')
            }
            chunks.push(part.value)
          }
          const data = new Uint8Array(total)
          let offset = 0
          for (const chunk of chunks) {
            data.set(chunk, offset)
            offset += chunk.byteLength
          }
          const ref = await ctx.attachments.saveImage({ data, mediaType, name: attachment.name || 'discord-image' })
          content.push({ type: 'image', attachment: ref })
        }

        const payload = { id: randomUUID(), role: 'user', content, source: { kind: 'plugin:ming-discord' } }
        if (cfg.newMessagePolicy === 'steer' && agent.status === 'running') agent.steer(payload)
        else agent.followup(payload)
      } catch (error) {
        log('error', '處理訊息失敗：' + String(error))
        try { await message.reply({ content: '訊息處理失敗：' + String(error).slice(0, 250), allowedMentions: { repliedUser: false } }) } catch {}
      }
    })

    client.once('ready', () => {
      gatewayStatus = 'connected'
      routeRestore = restoreRoutes()
      void routeRestore.catch(error => log('warn', 'restore routes failed: ' + String(error)))
      log('info', '已連線 Discord：' + (client.user?.tag || client.user?.id))
    })
    log('info', '即將呼叫 client.login()')
    client.login(cfg.token)
      .then(() => log('info', 'client.login() Promise 已成功；等待 ready 事件'))
      .catch(error => { gatewayStatus = 'error'; log('error', 'login failed: ' + String(error)) })

    return () => {
      disposed = true
      log('warn', 'ctx.effect cleanup：正在關閉 Discord Client')
      client.destroy()
      for (const handle of handles.values()) {
        void handle.dispose().catch(error => log('warn', 'agent dispose failed: ' + String(error)))
      }
      handles.clear()
      sessionChannels.clear()
      sessionIds.clear()
      pendingReplies.clear()
      pendingVoiceCalls.clear()
    }
  })
}
