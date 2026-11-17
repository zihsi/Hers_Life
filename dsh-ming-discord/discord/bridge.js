/**
 * The Discord bridge: turns Discord events into agent turns and agent output
 * back into Discord messages.
 *
 * Behaviour deliberately mirrors what people expect from a bot in 2024+:
 * typing indicator while thinking, live-edited message while streaming,
 * chunked output when the reply is long, attachment download into the session,
 * and reply-linking so threads stay readable.
 */
import { basename, extname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chunkText, tidyReply, truncate, sleep, newId, safe } from '../util.js'
import { lastAssistantText, turnOutput } from '../session.js'
import { message as buildMessage } from './components.js'
import { Interactions, registerCommands, COMMANDS } from './commands.js'
import { DiscordEvents, describeMessage } from './events.js'
import { storeImage, toImageRef } from '../images.js'

const TYPING_REFRESH_MS = 8000
const STREAM_EDIT_MS = 900
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export class DiscordBridge {
  constructor(options) {
    this.ctx = options.ctx
    this.settings = options.settings
    this.logger = options.logger
    this.rest = options.rest
    this.gateway = options.gateway
    this.brain = options.brain
    this.pool = options.pool
    this.voice = options.voice ?? null
    /** Optional: the interest store, fed with every line people say to her. */
    this.interests = options.interests ?? null
    /** Rolling window of gateway events, shown in the settings page. */
    this.events = options.events ?? new DiscordEvents({ dataRoot: options.dataRoot ?? process.cwd(), logger: options.logger })
    /** Slash commands / buttons / modals. Created lazily so `rest` is available. */
    this.interactions = new Interactions({
      rest: options.rest,
      logger: options.logger,
      applicationId: options.applicationId ?? '',
      events: this.events,
    })
    this.selfId = null
    this.recent = new Map()
    this.streams = new Map()
    /** guildId -> { id, name, icon } — filled from GUILD_CREATE so labels stay readable. */
    this.guilds = new Map()
    /** channelId -> { id, name, type, guildId, parentId } */
    this.channels = new Map()
    /** userId -> { id, name, guildId, bot, avatar } */
    this.members = new Map()
    /** userId -> { id, status, activity, at } */
    this.presences = new Map()
    /** Guilds whose slash commands are already registered this connection. */
    this.syncedGuilds = new Set()
    /**
     * sessionId → 'send' | 'keep', set by her own tool call during a turn.
     *
     * The owner's wording was "let her decide whether a picture goes to Discord
     * or only stays in the harness conversation". The setting is the default;
     * this map is her override for one conversation, and it is cleared as soon
     * as that conversation's turn has been rendered.
     */
    this.imageChoice = new Map()
    /** `${guildId}:${userId}` → channelId, so /voice join can find you. */
    this.voiceStates = new Map()
    /**
     * channelId → the last few messages, so a bare "I want that too" can be
     * read after the lines it replies to. Bounded per channel and in the number
     * of channels: a ring buffer that grows all night is a memory leak with a
     * friendly name.
     */
    this.recentChat = new Map()
    this.limiter = new (class {
      constructor(limit) { this.limit = limit; this.active = 0; this.queue = [] }
      run(task) {
        return new Promise((resolve, reject) => {
          const start = () => {
            this.active += 1
            Promise.resolve()
              .then(task)
              .then(resolve, reject)
              .finally(() => {
                this.active -= 1
                const next = this.queue.shift()
                if (next !== undefined) next()
              })
          }
          if (this.active < this.limit) start()
          else this.queue.push(start)
        })
      }
    })(3)
  }

  attach() {
    const gateway = this.gateway
    if (gateway === null) return () => {}
    this.selfId = gateway.selfId
    const onReady = (data) => {
      this.selfId = data.user?.id ?? gateway.selfId
      // The application id is what slash-command registration and interaction
      // follow-ups need; READY carries it inside `application`.
      const applicationId = data.application?.id ?? data.user?.id ?? null
      if (applicationId !== null) this.interactions.setApplicationId(applicationId)
      this.logger?.info('bridge ready as ' + this.selfId)
      void this.syncCommands().catch((error) => {
        this.logger?.warn('slash command sync failed: ' + String(error?.message ?? error))
      })
    }
    const onDispatch = (type, data) => {
      this.recordEvent(type, data)
      if (type === 'MESSAGE_CREATE' || type === 'MESSAGE_UPDATE') this.onMessage(type, data)
      else if (type === 'INTERACTION_CREATE') this.onInteraction(data)
      else if (type === 'VOICE_STATE_UPDATE') {
        // Remember who sits where so `/voice join` can drop her next to the
        // person who asked — the command has no channel of its own.
        //
        // The suppress flag rides along because a stage channel is the one
        // place where "in the channel" and "allowed to talk" differ: Discord
        // forces every non-speaker into listen mode, so listing members without
        // it would claim the whole audience is on stage.
        const stateKey = String(data.guild_id ?? '') + ':' + String(data.user_id ?? '')
        if (data.channel_id === null || data.channel_id === undefined) this.voiceStates.delete(stateKey)
        else {
          this.voiceStates.set(stateKey, {
            channelId: String(data.channel_id),
            suppress: data.suppress === true,
            selfMute: data.self_mute === true,
          })
        }
        this.voice?.onVoiceState?.(data)
      }
      else if (type === 'VOICE_SERVER_UPDATE') this.voice?.onVoiceServer?.(data)
      else if (type === 'GUILD_CREATE') {
        this.rememberGuild(data)
        for (const channel of data.channels ?? []) this.rememberChannel(channel)
        for (const member of data.members ?? []) this.rememberMember(data.id, member)
        // READY arrives before any GUILD_CREATE, so the first command sync ran
        // with an empty guild list and registered globally. Now that a real
        // guild is known, redo it so the commands appear under the guild (instant).
        void this.syncCommands().catch(() => {})
      } else if (type === 'GUILD_UPDATE') this.rememberGuild(data)
      else if (type === 'CHANNEL_CREATE' || type === 'CHANNEL_UPDATE') this.rememberChannel(data)
      else if (type === 'GUILD_MEMBER_ADD' || type === 'GUILD_MEMBER_UPDATE') this.rememberMember(data.guild_id, data)
      else if (type === 'PRESENCE_UPDATE') this.rememberPresence(data)
      else if (type === 'THREAD_CREATE' || type === 'THREAD_UPDATE') this.rememberChannel(data)
    }
    gateway.on('ready', onReady)
    gateway.on('dispatch', onDispatch)
    // READY already carries the guild list; seed from the gateway when present.
    for (const guild of gateway.guilds ?? []) this.rememberGuild(guild)
    this.installCommands()
    return () => {
      gateway.off('ready', onReady)
      gateway.off('dispatch', onDispatch)
    }
  }

  /**
   * Turn one dispatch into a readable log line.
   *
   * Cheap on purpose: no REST calls, no attachment downloads — this is the
   * window the settings page shows, not the session transcript.
   */
  recordEvent(type, data) {
    try {
      if (data === null || data === undefined) return
      const labels = {
        MESSAGE_CREATE: '新消息', MESSAGE_UPDATE: '消息被编辑', MESSAGE_DELETE: '消息被删除',
        MESSAGE_REACTION_ADD: '有人加了表情', MESSAGE_REACTION_REMOVE: '有人收回表情',
        GUILD_MEMBER_ADD: '有人加入服务器', GUILD_MEMBER_REMOVE: '有人离开服务器',
        CHANNEL_CREATE: '新频道', CHANNEL_DELETE: '频道被删', THREAD_CREATE: '新帖子',
        PRESENCE_UPDATE: '状态变化', TYPING_START: '正在输入',
      }
      if (type === 'MESSAGE_CREATE') {
        const channel = this.channels.get(String(data.channel_id)) ?? null
        this.events.push(type, describeMessage(data, { channelLabel: channel?.name }), {
          id: String(data.id ?? ''), channelId: String(data.channel_id ?? ''), userId: String(data.author?.id ?? ''),
        })
        return
      }
      if (type === 'MESSAGE_REACTION_ADD' || type === 'MESSAGE_REACTION_REMOVE') {
        const emoji = data.emoji?.name ?? data.emoji?.id ?? '?'
        this.events.push(type, (data.member?.user?.global_name ?? data.member?.user?.username ?? data.user_id ?? '?') + ' ' + emoji, {
          id: String(data.message_id ?? ''), channelId: String(data.channel_id ?? ''),
        })
        return
      }
      if (type === 'GUILD_MEMBER_ADD' || type === 'GUILD_MEMBER_REMOVE') {
        const who = data.user?.global_name ?? data.user?.username ?? data.user?.id ?? '?'
        this.events.push(type, who + ' @ ' + (this.guilds.get(String(data.guild_id))?.name ?? data.guild_id), { id: String(data.user?.id ?? '') })
        return
      }
      if (type === 'CHANNEL_CREATE' || type === 'CHANNEL_DELETE' || type === 'THREAD_CREATE' || type === 'THREAD_UPDATE') {
        this.events.push(type, '#' + String(data.name ?? data.id), { id: String(data.id ?? ''), channelId: String(data.id ?? '') })
        return
      }
      if (type === 'PRESENCE_UPDATE') {
        const who = data.user?.global_name ?? data.user?.username ?? data.user?.id ?? '?'
        this.events.push(type, who + ' → ' + String(data.status ?? '?'), { id: String(data.user?.id ?? '') })
        return
      }
      if (type === 'TYPING_START') {
        this.events.push(type, '有人在 ' + String(data.channel_id ?? '?') + ' 输入', { id: String(data.user_id ?? ''), channelId: String(data.channel_id ?? '') })
        return
      }
      const label = labels[type]
      if (label !== undefined) this.events.push(type, label, { id: String(data.id ?? '') })
    } catch (error) {
      this.logger?.debug('recordEvent failed: ' + String(error?.message ?? error))
    }
  }

  /** Remember channel names so logs and labels read like `#general`. */
  rememberChannel(data) {
    const id = String(data?.id ?? '')
    if (id === '') return
    this.channels.set(id, {
      id,
      name: data.name ?? id,
      type: Number(data.type ?? 0),
      guildId: String(data.guild_id ?? ''),
      parentId: data.parent_id === undefined ? null : String(data.parent_id),
    })
  }

  /** Names and avatars for the members we have seen. */
  rememberMember(guildId, member) {
    const user = member?.user ?? member
    const id = String(user?.id ?? '')
    if (id === '') return
    const name = user.global_name ?? user.username ?? user.nick ?? id
    this.members.set(id, { id, name, guildId: String(guildId ?? ''), bot: user.bot === true, avatar: user.avatar ?? null })
  }

  /** Latest presence per user, so "who is online" can be answered without REST. */
  rememberPresence(data) {
    const id = String(data?.user?.id ?? '')
    if (id === '') return
    const status = String(data.status ?? 'offline')
    const activity = (data.activities ?? [])[0] ?? null
    this.presences.set(id, {
      id,
      status,
      activity: activity === null ? null : { name: activity.name ?? '', type: Number(activity.type ?? 0) },
      at: Date.now(),
    })
  }

  /** `/name` lookup helpers used by tools. */
  channelLabel(channelId) {
    const channel = this.channels.get(String(channelId))
    if (channel === undefined) return String(channelId)
    return '#' + channel.name
  }

  memberName(userId) {
    return this.members.get(String(userId))?.name ?? String(userId)
  }

  /**
   * Wire the slash commands into the interaction handler.
   *
   * Handlers stay thin: they either answer with text or push a line into the
   * conversation, exactly like a message would.
   */
  installCommands() {
    this.interactions.handle('ask', async ({ interaction, option, user, defer, reply }) => {
      const text = String(option('text') ?? '').trim()
      if (text === '') return '要问她什么呢？'
      // Answering takes far longer than the three-second interaction deadline,
      // so acknowledge first and let the real reply land as a normal message.
      await defer(false)
      const synthetic = {
        id: 'interaction-' + String(interaction.id ?? newId()),
        channel_id: String(interaction.channel_id ?? ''),
        guild_id: interaction.guild_id ?? null,
        content: text,
        author: {
          id: String(user.id ?? ''),
          username: user.username ?? null,
          global_name: user.global_name ?? null,
        },
        member: interaction.member ?? null,
        attachments: [],
        type: 0,
      }
      const isDm = interaction.guild_id === null || interaction.guild_id === undefined
      void this.handle(synthetic, isDm).catch((error) => {
        this.logger?.warn('/ask failed: ' + String(error?.message ?? error))
      })
      return null
    })
    this.interactions.handle('say', async ({ interaction, option }) => {
      const text = String(option('text') ?? '')
      // The channel option is optional in the command payload; without it the
      // sentence goes wherever the command was used.
      const channelId = String(option('channel') ?? interaction.channel_id ?? '')
      if (text === '') return '要说什么？'
      if (channelId === '') return '要给个频道。'
      const sent = await this.say(channelId, text)
      return '说了（消息 id ' + sent.filter(Boolean).join(', ') + '）'
    })
    this.interactions.handle('memory', async ({ option }) => {
      if (this.brain === null) return '记忆模块没开。'
      const query = String(option('query') ?? '').trim()
      const notes = query === '' ? this.brain.listNotes({}).slice(-8) : this.brain.search(query, 8)
      if (notes.length === 0) return query === '' ? '现在还记得的事是空的。' : '没搜到和「' + query + '」有关的记忆。'
      return {
        embeds: [{
          title: query === '' ? '她记得的事' : '关于「' + query + '」',
          description: notes.map((note) => '• ' + note.title + (note.tags?.length ? '（' + note.tags.join('、') + '）' : '')).join('\n'),
          color: 0x4a7dff,
        }],
      }
    })
    this.interactions.handle('status', async () => {
      const modules = []
      modules.push('Discord：' + (this.gateway?.ready ? '在线' : '离线'))
      modules.push('记忆：' + (this.brain === null ? '关' : this.brain.notes.length + ' 条'))
      modules.push('语音：' + (this.voice === null ? '关' : this.voice.list().length + ' 个频道'))
      return { embeds: [{ title: '她的状态', description: modules.join('\n'), color: 0x30a46c }] }
    })
    this.interactions.handle('voice', async ({ interaction, option, user }) => {
      if (this.voice === null) return '语音模块没开。'
      const action = String(option('action') ?? '')
      const guildId = String(interaction.guild_id ?? '')
      if (action === 'leave') {
        if (guildId === '') return '这个只能在服务器里用。'
        await this.voice.leave(guildId)
        return '离开了。'
      }
      if (action !== 'join') return '不认识这个动作。'
      if (guildId === '') return '这个只能在服务器里用。'
      // Preference order: the channel option, then wherever the asker sits,
      // then wherever she already is — never guess a random channel.
      let channelId = String(option('channel') ?? '')
      if (channelId === '') channelId = this.voiceStates.get(guildId + ':' + String(user.id ?? ''))?.channelId ?? ''
      if (channelId === '') {
        return '你在哪个语音频道？先自己进去，或者用 `/voice join` 里选一个频道。'
      }
      const connection = await this.voice.join(guildId, channelId)
      const label = this.channels.get(channelId)?.name ?? channelId
      return '进了 #' + label + '（' + (connection?.mode ?? '加密模式未定') + '）'
    })
    // Buttons and modals the model sent can be handled by registering
    // `component:<custom_id>` / `modal:<custom_id>` on `this.interactions`.

    // ------------------------------------------------------- context menus
    /**
     * Right-click → "让她看这段".
     *
     * A context menu arrives as an application command whose `data.target_id` is
     * the message id, plus `data.resolved.messages` when the payload is small
     * enough. That is enough to turn the picked message into a normal turn, so
     * she answers it in the same channel with the same brain — the point of the
     * feature is that you should not have to copy text to ask about it.
     */
    this.interactions.handle('peek', async ({ interaction, user, defer }) => {
      const data = interaction.data ?? {}
      const targetId = String(data.target_id ?? '')
      const channelId = String(interaction.channel_id ?? '')
      const resolved = data.resolved?.messages?.[targetId] ?? null
      if (channelId === '' || targetId === '') return '这条消息读不到。'
      const picked = resolved ?? await this.rest.message(channelId, targetId).catch(() => null)
      if (picked === null) return '这条消息太旧了，Discord 已经不给我读。'
      if (String(picked.author?.id ?? '') === this.selfId) {
        return '这是我自己说的。'
      }
      // Body: quoted context first, then whatever the picker wants to ask. The
      // command itself has no options, so the follow-up text comes from the
      // message the interaction carries — otherwise she can only repeat it back.
      const body = String(picked.content ?? '').trim()
      const who = picked.author?.global_name ?? picked.author?.username ?? '某人'
      const quoted = body === '' ? '（没有正文' + ((picked.attachments ?? []).length > 0 ? '，有 ' + picked.attachments.length + ' 个附件' : '') + '）' : body
      await defer(false)
      const synthetic = {
        id: 'menu-' + String(interaction.id ?? newId()),
        channel_id: channelId,
        guild_id: interaction.guild_id ?? null,
        content: '【' + who + ' 说的话】\n' + quoted.slice(0, 1800) + '\n\n（你刚才用右键把这段递给我了，接着说。）',
        author: {
          id: String(user.id ?? ''),
          username: user.username ?? null,
          global_name: user.global_name ?? null,
        },
        member: interaction.member ?? null,
        attachments: [],
        type: 0,
      }
      const isDm = interaction.guild_id === null || interaction.guild_id === undefined
      void this.handle(synthetic, isDm).catch((error) => {
        this.logger?.warn('peek menu failed: ' + String(error?.message ?? error))
      })
      return null
    })

    /**
     * Right-click → "记下来".
     *
     * Writes the picked message straight into the brain as a note the owner
     * stated, with the author as the tag. It does not start a turn: the whole
     * point of a one-tap menu is that it finishes in one tap.
     */
    this.interactions.handle('remember', async ({ interaction }) => {
      if (!this.brain) return '记忆模块没开。'
      const data = interaction.data ?? {}
      const targetId = String(data.target_id ?? '')
      const channelId = String(interaction.channel_id ?? '')
      const resolved = data.resolved?.messages?.[targetId] ?? null
      const picked = resolved ?? await this.rest.message(channelId, targetId).catch(() => null)
      if (picked === null) return '这条消息读不到。'
      const body = String(picked.content ?? '').trim()
      if (body === '') return '这条没有正文，图片和附件我还不会这样记。'
      const who = picked.author?.global_name ?? picked.author?.username ?? '某人'
      const title = body.replace(/\s+/g, ' ').slice(0, 40)
      const note = await this.brain.writeNote({
        title,
        body,
        tags: [who, 'discord'],
        status: 'active',
        source: 'user_statement',
      })
      this.logger?.info('remembered from a context menu: ' + note.id)
      return { content: '记住了：' + note.title, flags: 64 }
    })
  }

  /** Register commands on every guild we are in (instant, unlike global). */
  async syncCommands() {
    const appId = this.interactions.applicationId
    if (appId === '' || !this.rest.hasToken) return
    const guilds = [...this.guilds.keys()]
    for (const guildId of guilds) {
      // READY fires before GUILD_CREATE, so the first sync sees an empty guild
      // list and registers globally instead. Sync again on every new guild,
      // but once per guild per connection — PUT is idempotent yet not free.
      if (this.syncedGuilds.has(guildId)) continue
      await registerCommands(this.rest, appId, guildId, COMMANDS)
        .then(() => { this.syncedGuilds.add(guildId) })
        .catch((error) => {
          this.logger?.warn('commands for ' + guildId + ' failed: ' + String(error?.message ?? error))
        })
    }
    if (guilds.length === 0) {
      // Not in any guild yet — register globally so direct messages work too.
      await registerCommands(this.rest, appId, null, COMMANDS).catch(() => {})
    }
    this.logger?.info('slash commands registered on ' + Math.max(1, guilds.length) + ' scope(s)')
  }

  /**
   * Who is sitting in a voice channel right now.
   *
   * Discord has no REST endpoint that lists voice members, so this comes from
   * the VOICE_STATE_UPDATE stream. `suppress` tells a stage channel's audience
   * apart from its speakers — everywhere else it is meaningless.
   */
  voiceMembers(guildId, channelId) {
    const prefix = String(guildId) + ':'
    const out = []
    for (const [key, state] of this.voiceStates) {
      if (!key.startsWith(prefix)) continue
      if (state.channelId !== String(channelId)) continue
      out.push({ userId: key.slice(prefix.length), ...state })
    }
    return out
  }

  /** Keep a small name cache so channel labels read like `#general @ 家园`. */
  rememberGuild(data) {    if (data === null || data === undefined) return
    const id = data.id === undefined ? null : String(data.id)
    if (id === null) return
    this.guilds.set(id, { id, name: data.name ?? data.id, icon: data.icon ?? null })
    this.logger?.debug('joined guild ' + (data.name ?? id))
  }

  /** Look up a guild name, falling back to the REST API once. */
  async guildName(guildId) {
    const id = String(guildId)
    const cached = this.guilds.get(id)
    if (cached !== undefined) return cached.name
    const guild = await this.rest.guild?.(id).catch(() => null)
    if (guild === null || guild === undefined) return null
    this.rememberGuild(guild)
    return guild.name ?? null
  }

  // ------------------------------------------------------------- admission

  onMessage(kind, message) {
    if (message === null || message === undefined) return
    if (message.author === undefined) return
    if (kind === 'MESSAGE_UPDATE') {
      // Only track our own edits for the "already handled" guard.
      return
    }
    if (message.author.bot === true) return
    if (message.author.id === this.selfId) return
    if (message.webhook_id !== undefined) return

    const settings = this.settings
    if (!settings.get('discord.enabled', false)) return
    const isDm = message.guild_id === undefined || message.guild_id === null

    const allowedGuilds = settings.get('discord.guildIds', [])
    if (!isDm && allowedGuilds.length > 0 && !allowedGuilds.includes(String(message.guild_id))) return
    const allowedChannels = settings.get('discord.channelIds', [])
    if (!isDm && allowedChannels.length > 0 && !allowedChannels.includes(String(message.channel_id))) return

    // Public channel messages enter shared memory even when they do not mention her.
    // Private DMs are recorded only when they are actually delivered to an owner session.
    if (!isDm) {
      this.noteChatter(message)
      this.rememberAmbient(message)
    }

    const mode = settings.get('discord.mode', 'mention')
    if (isDm) {
      if (!settings.get('discord.allowDm', true)) return
      if (!this.dmAllowed(message.author.id)) return
    } else {
      if (mode === 'own') return
      if (mode === 'mention' && !this.addressed(message)) return
    }

    // Ignore our own echoes and duplicates.
    const dedupeKey = message.id
    if (this.recent.has(dedupeKey)) return
    this.recent.set(dedupeKey, Date.now())
    if (this.recent.size > 500) {
      const cutoff = Date.now() - 10 * 60_000
      for (const [key, at] of this.recent) if (at < cutoff) this.recent.delete(key)
    }

    this.limiter.run(() => this.handle(message, isDm)).catch((error) => {
      this.logger?.warn('message handling failed: ' + String(error))
    })
  }

  /**
   * Passive interest mining from ambient channel chatter.
   *
   * The store already decides what is worth keeping (a word has to come up
   * three times before it becomes a topic, and muted words never count), so
   * this only has to feed it and stay out of the way. Nothing here costs a
   * model call — it is a tokenizer and a couple of counters.
   */
  noteChatter(message) {
    const interests = this.interests
    if (interests === null || interests === undefined) return
    if (!this.settings.get('interest.enabled', true)) return
    if (!this.settings.get('discord.learnInterests', true)) return
    // An allowlist for where she is allowed to overhear: a server with one loud
    // channel and nine quiet ones should not teach her about the loud one only.
    const allowedChannels = this.settings.get('interest.groups', [])
    if (Array.isArray(allowedChannels) && allowedChannels.length > 0) {
      const id = String(message.channel_id ?? '')
      if (!allowedChannels.map((one) => String(one)).includes(id)) return
    }
    const text = String(message.content ?? '').trim()
    // Upstream used six as the floor, and it is wired to a field because the
    // right value depends on the room: a fast chat room produces ten "ok" for
    // one sentence worth reading. "ok", "+1" and a bare emoji tell you nothing
    // about what anybody is interested in.
    const minChars = Math.max(1, Number(this.settings.get('interest.minChars', 6)) || 6)
    if (text.length < minChars) return
    // A reply like "這個我也想要" is meaningless on its own and obvious after the
    // four lines before it. The ring buffer is per channel so two channels do
    // not bleed into each other's context.
    const wanted = Math.max(0, Number(this.settings.get('interest.contextLines', 4)) || 0)
    let sample = text
    if (wanted > 0) {
      const channelId = String(message.channel_id ?? '')
      const ring = this.recentChat.get(channelId) ?? []
      if (ring.length > 0) sample = ring.slice(-wanted).join(' / ') + ' / ' + text
      ring.push(text)
      // One extra so `slice(-wanted)` after the push still reaches back far
      // enough, and a bound so an all-night channel cannot grow a leak.
      const cap = wanted + 1
      if (ring.length > cap) ring.splice(0, ring.length - cap)
      this.recentChat.set(channelId, ring)
      if (this.recentChat.size > 200) {
        const oldest = this.recentChat.keys().next()
        if (!oldest.done) this.recentChat.delete(oldest.value)
      }
    }
    void Promise.resolve(interests.learn(sample))
      .then((promoted) => {
        for (const topic of promoted ?? []) {
          this.logger?.info('interest picked up from chat: ' + String(topic?.name ?? ''))
        }
      })
      .catch(() => {})
  }

  rememberAmbient(message) {
    if (!this.brain || !this.pool) return
    const channelId = String(message.channel_id ?? '')
    const guildId = String(message.guild_id ?? '')
    if (!channelId || !guildId) return
    const channel = this.channels.get(channelId) ?? {}
    const guild = this.guilds.get(guildId) ?? {}
    const thread = Number(channel.type) === 11 || Number(channel.type) === 12
    const target = {
      kind: 'channel', channelId, guildId,
      channelName: String(channel.name ?? channelId),
      guildName: String(guild.name ?? guildId), thread,
    }
    const sessionId = this.pool.sessionIdFor(target)
    const author = message.author ?? {}
    const text = String(message.content ?? '').trim() ||
      ((message.attachments?.length ?? 0) > 0 ? '（附件：' + message.attachments.length + ' 個）' : '')
    this.brain.feedAdd(sessionId, {
      label: '#' + target.channelName + ' @ ' + target.guildName,
      who: 'me', text, kind: thread ? 'thread' : 'channel',
    }, {
      botId: this.selfId, messageId: String(message.id ?? ''),
      guildId, guildName: target.guildName, channelId, channelName: target.channelName,
      threadId: thread ? channelId : '', conversationType: thread ? 'thread' : 'channel',
      authorId: String(author.id ?? ''),
      authorName: author.global_name ?? author.username ?? String(author.id ?? 'unknown'),
    })
  }

  onInteraction(interaction) {
    // Route everything through the interaction layer: slash commands, buttons,
    // selects and modals all arrive here and each gets acknowledged in time.
    void this.interactions.dispatch(interaction).catch((error) => {
      this.logger?.warn('interaction dispatch failed: ' + String(error?.message ?? error))
    })
  }

  dmAllowed(userId) {
    const policy = this.settings.get('discord.dmPolicy', 'owner')
    if (policy === 'anyone') return true
    if (this.settings.isOwner(userId)) return true
    if (policy === 'whitelist') {
      const list = this.settings.get('discord.whitelist', [])
      return list.includes(String(userId))
    }
    return false
  }

  addressed(message) {
    const content = String(message.content ?? '')
    if (this.selfId !== null && content.includes('<@' + this.selfId + '>')) return true
    if (this.selfId !== null && content.includes('<@!' + this.selfId + '>')) return true
    const referenced = message.referenced_message
    if (referenced !== undefined && referenced !== null && referenced.author?.id === this.selfId) return true
    return false
  }

  // ---------------------------------------------------------------- the turn

  async handle(message, isDm) {
    const target = await this.describeTarget(message, isDm)
    const text = this.cleanContent(message, target)
    if (text.trim() === '' && (message.attachments?.length ?? 0) === 0) return

    const stopTyping = this.settings.get('discord.typing', true) ? this.startTyping(message.channel_id) : () => {}
    let replyMessageId = null

    try {
      const entry = await this.pool.acquire(target)
      await this.pool.touch(entry.key)

      const content = await this.buildContent(message, text)
      if (content.length === 0) return

      const origin = {
        botId: this.selfId,
        messageId: String(message.sourceMessageId ?? message.id ?? ''),
        guildId: String(target.guildId ?? ''),
        guildName: String(target.guildName ?? ''),
        channelId: String(target.channelId ?? message.channel_id ?? ''),
        channelName: String(target.channelName ?? target.label ?? ''),
        threadId: target.thread ? String(target.channelId ?? '') : '',
        conversationType: target.kind === 'dm' ? 'dm' : target.thread ? 'thread' : 'channel',
        authorId: String(message.author?.id ?? target.userId ?? ''),
        authorName: String(message.author?.global_name ?? message.author?.username ?? target.userName ?? ''),
      }
      const sessionId = String(entry.sessionId ?? entry.agent?.session?.id ?? entry.key)
      this.brain?.feedAdd(sessionId, { label: target.label, who: 'me', text: text || '（附件）', kind: target.kind }, origin)
      const recalled = await this.brain?.recallContext(text, target, sessionId)
      if (recalled) content.unshift({ type: 'text', text: recalled })
      this.learnFrom(text).catch(() => {})

      const beforeSeq = entry.agent.session.seq
      const reply = await this.stream(entry, content, message, target)
      replyMessageId = reply?.id ?? null

      const answer = tidyReply(reply?.text ?? lastAssistantText(entry.agent.session, beforeSeq))
      if (answer !== '') {
        this.brain?.feedAdd(sessionId, { label: target.label, who: 'her', text: answer, kind: target.kind }, origin)
        if (this.settings.get('brain.journal', true)) {
          void this.brain?.writeJournal(target.label + ' — ' + truncate(answer, 160))
        }
      }

      if (this.settings.get('discord.reactions', true) && /^\d+$/.test(String(message.id ?? ''))) {
        // Synthetic messages (a slash command standing in for a chat message)
        // carry a non-numeric id and have nothing to react to.
        void this.rest.react(message.channel_id, message.id, '👀').catch(() => {})
      }
    } catch (error) {
      this.logger?.warn('turn failed: ' + String(error))
      const detail = truncate(String(error?.message ?? error), 300)
      await this.rest.send(message.channel_id, {
        content: '（她这边出了点问题：' + detail + '）',
        ...(this.settings.get('discord.replyToMessage', true) ? { message_reference: { message_id: message.id } } : {}),
      }).catch(() => {})
    } finally {
      stopTyping()
    }
    return replyMessageId
  }

  /**
   * Feed one line of conversation into the interest store.
   *
   * Only the passive half lives here: counting mentions until a word is worth
   * calling a topic. Whether she then goes looking for it is the explorer's
   * decision, gated by budget, quiet hours and idle time.
   */
  async learnFrom(text) {
    const store = this.interests
    if (store === null || String(text ?? '').trim() === '') return
    const promoted = await store.learn(String(text).slice(0, 2000))
    for (const topic of promoted) {
      this.logger?.info('new interest: ' + topic.name)
    }
    return promoted
  }

  async describeTarget(message, isDm) {
    const resolve = this.settings.resolve()
    if (isDm) {
      return {
        kind: 'dm',
        channelId: String(message.channel_id),
        userId: String(message.author.id),
        userName: message.author.global_name ?? message.author.username ?? '对方',
        label: '私聊 ' + (message.author.global_name ?? message.author.username ?? message.channel_id),
        workspace: resolve.workspace,
      }
    }
    const channel = await this.rest.channel(message.channel_id).catch(() => null)
    const guildId = String(message.guild_id)
    const guild = this.guilds.get(guildId) ?? null
    const channelName = channel?.name ?? String(message.channel_id)
    const guildName = guild?.name ?? null
    return {
      kind: 'channel',
      channelId: String(message.channel_id),
      guildId,
      channelName,
      guildName,
      userId: String(message.author.id),
      userName: message.author.global_name ?? message.author.username ?? 'someone',
      label: '#' + channelName + (guildName ? ' @ ' + guildName : ''),
      workspace: resolve.workspace,
      thread: channel?.type === 11 || channel?.type === 12,
    }
  }

  cleanContent(message, target) {
    let text = String(message.content ?? '')
    if (this.selfId !== null) {
      text = text.split('<@' + this.selfId + '>').join('').split('<@!' + this.selfId + '>').join('')
    }
    // Keep custom emoji readable rather than raw <:name:id>.
    text = text.replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ':$1:')
    text = text.replace(/<#(\d+)>/g, '#channel')
    text = text.replace(/<@&(\d+)>/g, '@role')
    const who = target.kind === 'dm' ? '' : '【' + (target.userName ?? 'someone') + '】'
    return (who + text.trim()).trim()
  }

  /**
   * Turn a message into prompt content.
   *
   * Images become real image blocks so the model sees them; everything else is
   * described in text. Large or non-image attachments are *saved to disk* rather
   * than merely mentioned, because "附件：a.zip（12 MB，未下载）" is useless when
   * the next step is unpacking it — she can read the file if it is on disk.
   */
  async buildContent(message, text) {
    const blocks = []
    const attachments = message.attachments ?? []
    const saved = []
    if (attachments.length > 0) {
      const maxBytes = Number(this.settings.get('discord.maxAttachmentMb', 24)) * 1024 * 1024
      const downloadDir = join(this.settings.resolve().dataRoot, 'downloads', String(message.id ?? newId()))
      for (const attachment of attachments.slice(0, 10)) {
        const name = String(attachment.filename ?? 'file')
        const ext = extname(name).toLowerCase()
        const size = Number(attachment.size ?? 0)
        const isImage = IMAGE_EXT.has(ext)
        if (size > maxBytes) {
          saved.push((isImage ? '图片' : '附件') + '：' + name + '（' + Math.round(size / 1024) + ' KB，超过上限 ' +
            Math.round(maxBytes / 1024 / 1024) + ' MB，跳过）')
          continue
        }
        try {
          const file = await this.rest.download(attachment.url, maxBytes)
          if (isImage) {
            const store = this.ctx.get('attachments')
            const mediaType = pickMediaType(file.mediaType, ext)
            if (store === undefined) {
              saved.push('图片：' + name + '（当前环境不支持图片输入）')
            } else if (mediaType === null) {
              saved.push('图片：' + name + '（不支持的格式 ' + file.mediaType + '）')
            } else {
              // Build the reference from what the store says it stored: an
              // image whose recorded size disagrees with the object poisons
              // every later turn with ATTACHMENT_CORRUPT.
              const stored = await storeImage(store, { data: file.buffer, mediaType, name })
              blocks.push({ type: 'image', attachment: toImageRef(stored, name) })
            }
            continue
          }
          // Non-image: keep the bytes so she can actually open it.
          await mkdir(downloadDir, { recursive: true })
          const target = join(downloadDir, name.replace(/[\\/:*?"<>|]/g, '_'))
          await writeFile(target, file.buffer)
          saved.push('附件：' + name + '（' + Math.round(file.buffer.length / 1024) + ' KB，已存到 ' + target + '）')
        } catch (error) {
          this.logger?.warn('attachment failed: ' + String(error))
          saved.push((isImage ? '图片' : '附件') + '：' + name + '（读取失败）')
        }
      }
    }
    // Embeds, stickers and forwarded/replied content are part of what was said;
    // a model that cannot see them answers the wrong question.
    const notes = describeRich(message)
    if (notes.length > 0) saved.push(...notes)
    if (saved.length > 0) {
      blocks.push({ type: 'text', text: (text.trim() === '' ? '' : text + '\n\n') + saved.join('\n') })
    } else if (text.trim() !== '') {
      blocks.unshift({ type: 'text', text })
    }
    return blocks.filter((block) => block.type !== 'text' || block.text.trim() !== '')
  }

  // -------------------------------------------------------------- streaming

  /**
   * Run one turn and render it into Discord: a placeholder message that grows
   * as text arrives, replaced by chunked messages when it overflows.
   */
  async stream(entry, content, message, target) {
    const settings = this.settings
    const channelId = message.channel_id
    const limit = Number(settings.get('discord.chunkLimit', 1900))
    const liveEdits = settings.get('discord.streamEdits', true)
    const showTools = settings.get('discord.showTools', false)
    // In a server channel the tool trails would be noise for everyone else, so
    // they go to the owner's DM instead. In a DM there is nobody to protect.
    const progressDm = settings.get('discord.progressInDm', true) && target.kind === 'channel'
    // Her own choice for this conversation beats the global default; the default
    // itself is `discord.shareImages`, because most of the time a picture she
    // took for the owner is meant to be seen. Read *after* the turn, not before:
    // she can only call `discord_share_images` while the turn is running, and a
    // choice captured up front would ignore her own decision.
    const sessionKey = String(entry.agent?.session?.id ?? '')

    const replyPayload = (text) => ({
      content: text === '' ? '…' : text,
      // A slash command has no message to reply to; only real messages do.
      ...(settings.get('discord.replyToMessage', true) && /^\d+$/.test(String(message.id ?? ''))
        ? { message_reference: { message_id: message.id, fail_if_not_exists: false } }
        : {}),
      allowed_mentions: { replied_user: true, parse: [] },
    })

    let placeholder = null
    if (liveEdits) {
      placeholder = await this.rest.send(channelId, replyPayload('…')).catch(() => null)
    }

    const tools = []
    let dmChannel = null
    const toolLine = () => '-# 🔧 ' + tools.slice(-3).join(' · ')

    const publishTools = () => {
      if (tools.length === 0) return
      if (showTools) {
        if (placeholder !== null) {
          void this.rest.edit(channelId, placeholder.id, replyPayload(toolLine())).catch(() => {})
        }
        return
      }
      // Only once a turn looks long enough to be worth reporting, so a single
      // quick lookup does not spam the owner.
      if (!progressDm || tools.length !== 3) return
      const owner = [...this.settings.ownerIds()][0]
      if (owner === undefined) return
      const send = (id) => { void this.rest.send(id, { content: toolLine() }).catch(() => {}) }
      if (dmChannel !== null) {
        send(dmChannel)
        return
      }
      void this.rest.createDm(owner)
        .then((channel) => { dmChannel = channel.id; send(dmChannel) })
        .catch(() => {})
    }

    let buffer = ''
    let lastEdit = 0
    let sentExtra = 0
    const onDelta = (delta) => {
      buffer += delta
      if (placeholder === null) return
      const now = Date.now()
      if (now - lastEdit < STREAM_EDIT_MS) return
      lastEdit = now
      const visible = buffer.length > limit ? buffer.slice(-limit + 40) : buffer
      void this.rest.edit(channelId, placeholder.id, replyPayload(visible)).catch(() => {})
    }

    const userMessage = {
      id: newId(),
      role: 'user',
      content,
      source: { kind: 'plugin:hers-life-discord' },
    }

    const stopTyping = settings.get('discord.typing', true) ? this.startTyping(channelId) : () => {}
    const beforeSeq = entry.agent.session.seq
    try {
      const deltaWatcher = this.ctx.on('agent/assistant-stream', safe(this.logger, 'bridge stream delta', (payload) => {
        if (payload.agent !== entry.agent) return
        const frame = payload.frame
        if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') onDelta(frame.chunk.text)
      }))
      const toolWatcher = showTools || progressDm
        ? this.ctx.on('session/event', safe(this.logger, 'bridge tool progress', (session, event) => {
          if (session !== entry.agent.session) return
          if (event.type !== 'tool/call') return
          tools.push(String(event.data?.name ?? 'tool'))
          publishTools()
        }))
        : () => {}
      try {
        if (typeof entry.agent.followup === 'function') entry.agent.followup(userMessage)
        else entry.agent.send(userMessage, 'next-turn', true)
        await this.waitTurn(entry.agent)
      } finally {
        deltaWatcher()
        toolWatcher()
      }
    } finally {
      stopTyping()
    }

    const output = turnOutput(entry.agent.session, beforeSeq)
    const baseText = tidyReply(buffer !== '' ? buffer : output.text)
    // Read the decision here, after the turn: she can only make it while she is
    // working, so the earlier value is always the default, never her answer.
    const choice = this.imageChoice.get(sessionKey)
    const attachImages = choice === undefined
      ? settings.get('discord.shareImages', true)
      : choice === 'send'
    // Pictures she took during the turn travel with the words. Without this the
    // screenshot, the frame, the phone capture all stayed inside the harness and
    // she could only tell you a path — which is not "everything works in Discord".
    const uploads = attachImages ? await this.collectUploads(output) : []
    // Her view-only choice covers exactly one turn: next time the setting decides
    // again, otherwise "keep this one to yourself" would silently become policy.
    if (choice !== undefined) this.imageChoice.delete(sessionKey)
    const kept = attachImages ? 0 : (output.images?.length ?? 0) + (output.files?.length ?? 0)
    const keptLine = kept > 0 ? '\n\n（' + kept + ' 张图只留在会话里，没发到 Discord——她选了不发。）' : ''
    const finalText = baseText + keptLine
    const chunks = chunkText(finalText, limit)

    if (chunks.length === 0 && uploads.length === 0) {
      if (placeholder !== null) {
        await this.rest.edit(channelId, placeholder.id, replyPayload('（她没有说话）')).catch(() => {})
      }
      return { id: placeholder?.id ?? null, text: '' }
    }

    if (chunks.length === 0) {
      // Only files, no words. Editing the placeholder to an empty string is not
      // allowed and leaving "…" behind looks like she started a sentence and
      // gave up, so the placeholder goes away and the picture speaks for itself.
      if (placeholder !== null) {
        await this.rest.deleteMessage(channelId, placeholder.id).catch(() => {})
      }
    } else if (placeholder !== null) {
      await this.rest.edit(channelId, placeholder.id, replyPayload(chunks[0])).catch(() => {})
      for (const part of chunks.slice(1)) {
        sentExtra += 1
        await this.rest.send(channelId, {
          content: part,
          allowed_mentions: { parse: [] },
        }).catch((error) => this.logger?.warn('chunk send failed: ' + String(error)))
      }
    } else {
      await this.rest.send(channelId, replyPayload(chunks[0]))
      for (const part of chunks.slice(1)) {
        await this.rest.send(channelId, { content: part, allowed_mentions: { parse: [] } })
      }
    }

    if (uploads.length > 0) {
      // Discord allows ten attachments per message; the rest ride along in
      // follow-up messages so a burst of frames does not disappear.
      for (let start = 0; start < uploads.length; start += 10) {
        const slice = uploads.slice(start, start + 10)
        await this.rest.sendBlobs(channelId, { allowed_mentions: { parse: [] } }, slice)
          .catch((error) => this.logger?.warn('attachment send failed: ' + String(error)))
      }
    }

    return { id: placeholder?.id ?? null, text: finalText, uploads: uploads.length }
  }

  async waitTurn(agent) {
    // Talking to her should not hang forever, but a long tool run must not be cut
    // off either — so the ceiling is a setting, not a constant.
    const minutes = Number(this.settings?.get('advanced.turnTimeoutMinutes', 15))
    const budget = (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60_000
    const deadline = Date.now() + budget
    let stable = 0
    while (Date.now() < deadline) {
      await agent.whenIdle()
      const seq = agent.session.seq
      await sleep(150)
      if (agent.status === 'idle' && agent.session.seq === seq) {
        stable += 1
        if (stable >= 2) return
      } else {
        stable = 0
      }
    }
    throw new Error('Discord turn timed out')
  }

  startTyping(channelId) {
    let stopped = false
    const ping = safe(this.logger, 'bridge typing', () => {
      if (stopped) return
      void this.rest.typing(channelId).catch(() => {})
    })
    ping()
    const timer = setInterval(ping, TYPING_REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  // ------------------------------------------------------------ outbound API

  /** Send a message from outside a turn (interest reports, reminders, voice). */
  async say(channelId, text, options = {}) {
    const limit = Number(this.settings.get('discord.chunkLimit', 1900))
    const parts = chunkText(String(text ?? ''), limit)
    const ids = []
    for (const part of parts) {
      const sent = await this.rest.send(channelId, {
        content: part,
        allowed_mentions: { parse: [] },
        ...(options.replyTo ? { message_reference: { message_id: options.replyTo, fail_if_not_exists: false } } : {}),
      })
      ids.push(sent?.id ?? null)
    }
    return ids
  }

  /**
   * Send a full message body: embeds, buttons, selects, files.
   *
   * Chunking only applies to plain text — an embed is one message by definition,
   * and splitting it would lose the structure that made it worth sending.
   */
  async sayRich(channelId, input, options = {}) {
    const body = buildMessage({
      ...input,
      ...(options.replyTo === undefined ? {} : { reply_to: options.replyTo }),
    })
    body.allowed_mentions = { parse: [], replied_user: true }
    const files = Array.isArray(options.files) ? options.files : []
    if (files.length > 0) return this.rest.sendFiles(channelId, body, files.slice(0, 10))
    return this.rest.send(channelId, body)
  }

  /** Edit a message the bot sent (used by live progress and button replies). */
  async editMessage(channelId, messageId, input) {
    const body = buildMessage(input)
    return this.rest.edit(channelId, messageId, body)
  }

  /** Send files (voice clips, screenshots) with an optional caption. */
  async sayFiles(channelId, files, text = '') {
    return this.rest.sendFiles(channelId, { content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }, files)
  }

  /**
   * Turn the pictures and documents of one finished turn into Discord uploads.
   *
   * Images live in the attachment store, not on disk: `readImage(ref)` is the
   * only way back to the bytes. Files may expose `fileHostPath`, otherwise they
   * are skipped with a log line rather than silently dropped — a truncated
   * answer that says nothing is worse than one that says why.
   */
  async collectUploads(output) {
    const blobs = []
    const attachments = this.ctx?.get?.('attachments') ?? null
    if (attachments === null) {
      if ((output.images?.length ?? 0) + (output.files?.length ?? 0) > 0) {
        this.logger?.warn?.('she produced pictures but this host has no attachment store to read them back from')
      }
      return blobs
    }
    for (const ref of output.images ?? []) {
      try {
        const stored = await attachments.readImage(ref)
        const name = String(ref.name ?? 'image-' + Date.now()).replace(/[^\w.\-]/g, '_')
        blobs.push({ buffer: Buffer.from(stored.data), mediaType: ref.mediaType, name })
      } catch (error) {
        this.logger?.warn?.('could not read an image back: ' + String(error?.message ?? error))
      }
    }
    for (const ref of output.files ?? []) {
      try {
        const host = typeof attachments.fileHostPath === 'function' ? attachments.fileHostPath(ref) : undefined
        if (host === undefined) continue
        const buffer = await readFile(host)
        blobs.push({ buffer, mediaType: 'application/octet-stream', name: String(ref.name ?? basename(host)) })
      } catch (error) {
        this.logger?.warn?.('could not read a file back: ' + String(error?.message ?? error))
      }
    }
    return blobs
  }

  /** Everything the tools need about a channel. */
  async channelInfo(channelId) {
    const channel = await this.rest.channel(channelId)
    if (channel?.guild_id === undefined) return channel
    const guild = this.guilds.get(String(channel.guild_id)) ?? null
    return { ...channel, guild_name: guild?.name ?? null }
  }
}

function pickMediaType(declared, ext) {
  const clean = String(declared ?? '').split(';')[0].trim().toLowerCase()
  if (clean === 'image/png' || clean === 'image/jpeg' || clean === 'image/webp' || clean === 'image/gif') return clean
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return null
}

/**
 * Everything about a message that is not its text.
 *
 * A message can carry embeds (link previews, bot cards), stickers, a poll, a
 * forwarded snapshot, a reply to someone else, or a voice note. None of that
 * reaches the model through `content`, so it is flattened into readable lines
 * here — otherwise she answers "what?" to a message that was a screenshot card.
 */
export function describeRich(message) {
  const out = []
  const embeds = Array.isArray(message.embeds) ? message.embeds : []
  for (const item of embeds.slice(0, 5)) {
    const title = String(item.title ?? '').trim()
    const description = String(item.description ?? '').trim()
    const author = String(item.author?.name ?? '').trim()
    const footer = String(item.footer?.text ?? '').trim()
    const fields = (item.fields ?? []).map((field) => field.name + '：' + field.value).join('；')
    const link = typeof item.url === 'string' ? item.url : ''
    const kind = String(item.type ?? 'rich')
    const body = [title, description, fields, footer].filter((part) => part !== '').join(' / ')
    const head = '嵌入卡片' + (author === '' ? '' : '（' + author + '）') + (kind === 'rich' ? '' : '[' + kind + ']')
    out.push(head + '：' + (body === '' ? '（空）' : body.slice(0, 500)) + (link === '' ? '' : ' → ' + link))
  }
  const stickers = Array.isArray(message.sticker_items) ? message.sticker_items : []
  if (stickers.length > 0) out.push('贴纸：' + stickers.map((sticker) => sticker.name ?? sticker.id ?? '?').join('、'))
  if (message.poll !== undefined && message.poll !== null) {
    const question = String(message.poll.question?.text ?? '投票')
    const answers = (message.poll.answers ?? []).map((answer) => String(answer.poll_media?.text ?? '?')).join(' / ')
    out.push('投票：' + question + '（' + answers + '）')
  }
  if (message.message_snapshots !== undefined) out.push('（这是一条转发消息）')
  const reference = message.referenced_message
  if (reference !== undefined && reference !== null) {
    const who = reference.author?.global_name ?? reference.author?.username ?? '?'
    const body = String(reference.content ?? '').replace(/\s+/g, ' ').trim()
    out.push('（回应 ' + who + ' 的消息：' + (body === '' ? '（无正文）' : body.slice(0, 200)) + '）')
  }
  // A voice note is just an .ogg attachment — say what it is so "listen to this"
  // does not read as a random file.
  const voiceNote = (message.attachments ?? []).find((item) => item.waveform !== undefined && item.waveform !== null)
  if (voiceNote !== undefined) out.push('（语音消息，' + Math.round(Number(voiceNote.duration_secs ?? 0)) + ' 秒）')
  return out
}

export { STREAM_EDIT_MS, TYPING_REFRESH_MS }
