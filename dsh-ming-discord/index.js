import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises'
import { Client, GatewayIntentBits, Partials } from 'discord.js'

export const name = 'ming-discord'
export const inject = ['agents', 'attachments']

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
    workspacePath: path.resolve(input.workspacePath || path.join(os.homedir(), 'dsh', 'workspace')),
    agentPreset: input.agentPreset || '',
    mentionRequired: input.mentionRequired !== false,
    directMessages: input.directMessages !== false,
    allowedGuildIds: list(input.allowedGuildIds),
    allowedChannelIds: list(input.allowedChannelIds),
    ownerUserIds: [...new Set([...list(input.ownerUserIds), process.env.MING_OWNER_DISCORD_ID || ''].filter(Boolean))],
    newMessagePolicy: input.newMessagePolicy === 'followup' ? 'followup' : 'steer',
    maxAttachmentBytes: Number.isFinite(Number(input.maxAttachmentBytes)) && Number(input.maxAttachmentBytes) > 0
      ? Math.floor(Number(input.maxAttachmentBytes)) : 10 * 1024 * 1024,
    inboxPath: input.inboxPath || path.join(os.homedir(), '.dsh', 'media', 'onebot', 'qq-inbox.jsonl'),
    chatSessionsPath: input.chatSessionsPath || path.join(os.homedir(), '.dsh', 'media', 'onebot', 'chat-sessions.json'),
  }
  const log = (level, message) => {
    try { ctx.logger?.[level]?.('[ming-discord] ' + message) } catch {}
  }
  if (!cfg.enabled) return
  if (!cfg.token) {
    log('warn', 'DISCORD_BOT_TOKEN 未設定，bridge 不會啟動')
    return
  }

  ctx.effect(() => {
    let disposed = false
    let inboxQueue = Promise.resolve()
    let mapQueue = Promise.resolve()
    const handles = new Map()
    const creating = new Map()
    const sessionChannels = new Map()
    const pendingReplies = new Map()
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Channel],
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
        const line = {
          ts: Date.now(), kind: 'message',
          decision: { ok: responded, stage: 'discord-mention-gate', reason: responded ? 'accepted by Discord bridge' : 'unmentioned message for interest matching' },
          source: 'discord',
          frame: {
            message_type: 'group', group_id: groupId,
            user_id: String(message.author.id), self_id: String(client.user?.id || ''),
            sender: { card: message.member?.displayName || message.author.globalName || message.author.username, nickname: message.author.username },
            message: [{ type: 'text', data: { text: message.content || '' } }],
          },
        }
        await mkdir(path.dirname(cfg.inboxPath), { recursive: true })
        await appendFile(cfg.inboxPath, JSON.stringify(line) + '\n', 'utf8')
        sessionChannels.set(sessionIdFor(message), message.channelId)
        await saveMap('group:' + groupId, sessionIdFor(message))
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
            if (parts.length >= 4) sessionChannels.set(sessionId, parts.slice(3).join(':'))
          } else if (key.startsWith('discord:dm:')) {
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
    void restoreRoutes()

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
        }
      } catch (error) { log('warn', 'output event failed: ' + String(error)) }
    })

    client.on('messageCreate', async message => {
      try {
        if (disposed || message.author?.bot) return
        const isDm = !message.guildId
        if (isDm && !cfg.directMessages) return
        if (message.guildId && cfg.allowedGuildIds.length && !cfg.allowedGuildIds.includes(message.guildId)) return
        if (cfg.allowedChannelIds.length && !cfg.allowedChannelIds.includes(message.channelId)) return
        const mentioned = Boolean(client.user && message.mentions.has(client.user))
        const shouldRespond = isDm || !cfg.mentionRequired || mentioned
        await recordInbox(message).catch(error => log('warn', 'inbox write failed: ' + String(error)))
        if (!shouldRespond) return

        const id = sessionIdFor(message)
        sessionChannels.set(id, message.channelId)
        if (isDm) await saveMap('discord:dm:' + message.author.id, id)
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
          const response = await fetch(attachment.url)
          if (!response.ok) throw new Error('下載 Discord 圖片失敗：HTTP ' + response.status)
          const data = new Uint8Array(await response.arrayBuffer())
          if (data.byteLength > cfg.maxAttachmentBytes) throw new Error('圖片超過大小上限')
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

    client.once('ready', () => log('info', '已連線 Discord：' + (client.user?.tag || client.user?.id)))
    client.login(cfg.token).catch(error => log('error', 'login failed: ' + String(error)))

    return () => {
      disposed = true
      client.destroy()
      for (const handle of handles.values()) {
        void handle.dispose().catch(error => log('warn', 'agent dispose failed: ' + String(error)))
      }
      handles.clear()
      sessionChannels.clear()
      pendingReplies.clear()
    }
  })
}
