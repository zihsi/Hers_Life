/**
 * Discord gateway client: identify, heartbeat, resume, reconnect.
 *
 * Written against Node's built-in `WebSocket` (Node 22+/Electron 44), so the
 * package has no runtime dependency on `ws`. Everything is an EventEmitter
 * event so the bridge can stay free of protocol details.
 */
import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { backoff, safe } from '../util.js'

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'

/** Opcodes we care about. */
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
}

const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MODERATION: 1 << 2,
  GUILD_EMOJIS_AND_STICKERS: 1 << 3,
  GUILD_INTEGRATIONS: 1 << 4,
  GUILD_WEBHOOKS: 1 << 5,
  GUILD_INVITES: 1 << 6,
  GUILD_VOICE_STATES: 1 << 7,
  GUILD_PRESENCES: 1 << 8,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  GUILD_MESSAGE_TYPING: 1 << 11,
  DIRECT_MESSAGES: 1 << 12,
  DIRECT_MESSAGE_REACTIONS: 1 << 13,
  DIRECT_MESSAGE_TYPING: 1 << 14,
  MESSAGE_CONTENT: 1 << 15,
  GUILD_SCHEDULED_EVENTS: 1 << 16,
  AUTO_MODERATION_CONFIGURATION: 1 << 20,
  AUTO_MODERATION_EXECUTION: 1 << 21,
}

/**
 * Intents are deliberately modest: no presence scanning (needs a verified bot),
 * everything else that a normal message-capable bot needs.
 */
export function computeIntents(options = {}) {
  let intents = 0
  intents |= INTENTS.GUILDS
  intents |= INTENTS.GUILD_MEMBERS
  intents |= INTENTS.GUILD_MESSAGES
  intents |= INTENTS.GUILD_MESSAGE_REACTIONS
  intents |= INTENTS.GUILD_MESSAGE_TYPING
  intents |= INTENTS.GUILD_VOICE_STATES
  intents |= INTENTS.DIRECT_MESSAGES
  intents |= INTENTS.DIRECT_MESSAGE_REACTIONS
  intents |= INTENTS.DIRECT_MESSAGE_TYPING
  intents |= INTENTS.MESSAGE_CONTENT
  intents |= INTENTS.GUILD_MODERATION
  intents |= INTENTS.AUTO_MODERATION_CONFIGURATION
  intents |= INTENTS.AUTO_MODERATION_EXECUTION
  if (options.presences) intents |= INTENTS.GUILD_PRESENCES
  return intents
}

export class DiscordGateway extends EventEmitter {
  constructor(options) {
    super()
    this.token = String(options.token ?? '').trim()
    this.logger = options.logger
    this.intents = computeIntents(options)
    this.presence = options.presence ?? { status: 'online', activities: [] }
    this.shard = options.shard ?? [0, 1]

    this.socket = null
    this.sessionId = null
    this.resumeUrl = null
    this.seq = null
    this.heartbeatTimer = null
    this.heartbeatAcked = true
    this.attempt = 0
    this.closed = false
    this.ready = false
    this.selfId = null
  }

  connect() {
    this.closed = false
    this.open()
    return this
  }

  open() {
    const url = this.resumeUrl && this.sessionId ? this.resumeUrl : GATEWAY_URL
    this.logger?.info('gateway connecting' + (this.sessionId ? ' (resume)' : ''))
    // Every socket gets a generation and the old one is closed first. Without
    // this, a reconnect leaves the previous socket alive: two sockets identify
    // the same token, Discord invalidates the older session, its close handler
    // reconnects again, and the pair of sockets kick each other forever.
    this.generation = (this.generation ?? 0) + 1
    const generation = this.generation
    this.dropSocket()
    const socket = new WebSocket(url)
    this.socket = socket
    // Every listener below is a socket callback: it runs outside any await
    // chain, so a throw here is an uncaught exception that kills the DSH host
    // process. `safe` turns any error into one log line instead.
    const guard = (label, fn) => safe(this.logger, 'gateway ' + label, fn)
    const live = () => generation === this.generation && !this.closed
    socket.addEventListener('open', guard('open', () => {
      this.logger?.debug('gateway socket open')
    }))
    socket.addEventListener('message', guard('message', (event) => {
      if (!live()) return
      let payload
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
      } catch {
        return
      }
      this.handle(payload)
    }))
    socket.addEventListener('error', guard('error', (event) => {
      this.logger?.warn('gateway socket error: ' + String(event?.message ?? 'unknown'))
    }))
    socket.addEventListener('close', guard('close', (event) => {
      // A superseded socket must not schedule another reconnect: its successor
      // already owns the connection.
      if (generation !== this.generation) return
      this.stopHeartbeat()
      this.ready = false
      if (this.closed) {
        this.logger?.info('gateway closed')
        return
      }
      this.logger?.warn('gateway closed (' + event.code + '), reconnecting')
      this.reconnect()
    }))
  }

  /** Close the current socket without letting its handlers react. */
  dropSocket() {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    try {
      socket.close()
    } catch {
      /* already gone */
    }
  }

  reconnect() {
    if (this.closed) return
    const wait = backoff(this.attempt, 800, 20_000)
    this.attempt += 1
    setTimeout(safe(this.logger, 'gateway reconnect', () => {
      if (!this.closed) this.open()
    }), wait)
  }

  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  send(payload) {
    const socket = this.socket
    if (!socket || socket.readyState !== 1) return false
    socket.send(JSON.stringify(payload))
    return true
  }

  handle(payload) {
    const op = payload.op
    const type = payload.t
    const data = payload.d
    if (payload.s !== null && payload.s !== undefined) this.seq = payload.s

    if (op === OP.HELLO) {
      this.startHeartbeat(data.heartbeat_interval)
      this.attempt = 0
      if (this.sessionId) this.resume()
      else this.identify()
      return
    }
    if (op === OP.HEARTBEAT) {
      this.send({ op: OP.HEARTBEAT, d: this.seq })
      return
    }
    if (op === OP.HEARTBEAT_ACK) {
      this.heartbeatAcked = true
      return
    }
    if (op === OP.RECONNECT) {
      this.logger?.info('gateway asked to reconnect')
      this.closeSocket()
      setTimeout(safe(this.logger, 'gateway reopen', () => {
        if (!this.closed) this.open()
      }), 400)
      return
    }
    if (op === OP.INVALID_SESSION) {
      this.logger?.warn('gateway invalid session, re-identifying')
      this.sessionId = null
      this.resumeUrl = null
      this.seq = null
      this.closeSocket()
      setTimeout(safe(this.logger, 'gateway re-identify', () => {
        if (!this.closed) this.open()
      }), 1000 + Math.random() * 4000)
      return
    }

    if (op === OP.DISPATCH) {
      if (type === 'READY') {
        this.sessionId = data.session_id
        this.resumeUrl = data.resume_gateway_url ?? this.resumeUrl
        this.selfId = data.user?.id ?? null
        this.ready = true
        this.attempt = 0
        this.logger?.info('gateway ready as ' + (data.user?.username ?? '?') + ' (' + this.selfId + ')')
        this.emitSafe('ready', data)
        return
      }
      if (type === 'RESUMED') {
        this.ready = true
        this.attempt = 0
        this.logger?.info('gateway resumed')
        this.emitSafe('resumed')
        return
      }
      this.emitSafe('dispatch', type, data)
      if (type === 'VOICE_SERVER_UPDATE' || type === 'VOICE_STATE_UPDATE') this.emitSafe(type, data)
      return
    }
  }

  /**
   * Emit without letting one listener's failure abort the rest.
   *
   * A listener that throws inside `emit` propagates out of `handle`, out of the
   * socket callback, and into the host's uncaught-exception handler — which
   * exits the process. Escaping per listener keeps a bad event from being fatal.
   */
  emitSafe(name, ...args) {
    const listeners = this.listeners(name)
    for (const listener of listeners) {
      try {
        const result = listener.call(this, ...args)
        if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
          Promise.resolve(result).catch((error) => {
            this.logger?.warn('listener "' + name + '" rejected: ' + String(error?.stack ?? error?.message ?? error))
          })
        }
      } catch (error) {
        this.logger?.warn('listener "' + name + '" threw: ' + String(error?.stack ?? error?.message ?? error))
      }
    }
  }

  startHeartbeat(intervalMs) {
    this.stopHeartbeat()
    this.heartbeatAcked = true
    const jitter = Math.random() * intervalMs * 0.3
    this.heartbeatTimer = setInterval(safe(this.logger, 'gateway heartbeat', () => {
      if (!this.heartbeatAcked) {
        // A missed ACK means the connection is dead in a way a close event may not report.
        this.logger?.warn('gateway heartbeat missed, forcing reconnect')
        this.closeSocket()
        this.reconnect()
        return
      }
      this.heartbeatAcked = false
      this.send({ op: OP.HEARTBEAT, d: this.seq })
    }), intervalMs)
    setTimeout(safe(this.logger, 'gateway first heartbeat', () => {
      if (this.heartbeatTimer !== null) {
        this.heartbeatAcked = false
        this.send({ op: OP.HEARTBEAT, d: this.seq })
      }
    }), jitter)
  }

  identify() {
    this.logger?.info('gateway identify')
    this.send({
      op: OP.IDENTIFY,
      d: {
        token: this.token,
        intents: this.intents,
        properties: { os: process.platform, browser: 'dsh-hers-life', device: 'dsh-hers-life' },
        presence: this.presence,
        shard: this.shard,
      },
    })
  }

  resume() {
    this.logger?.info('gateway resume from seq ' + this.seq)
    this.send({
      op: OP.RESUME,
      d: { token: this.token, session_id: this.sessionId, seq: this.seq },
    })
  }

  updatePresence(presence) {
    this.presence = presence
    if (!this.ready) return
    this.send({ op: OP.PRESENCE_UPDATE, d: presence })
  }

  /** Join (or move to) a voice channel. The voice object consumes VOICE_STATE_UPDATE. */
  joinVoice(guildId, channelId, selfMute = false, selfDeaf = false) {
    this.send({
      op: OP.VOICE_STATE,
      d: { guild_id: guildId, channel_id: channelId, self_mute: selfMute, self_deaf: selfDeaf },
    })
  }

  leaveVoice(guildId) {
    this.send({ op: OP.VOICE_STATE, d: { guild_id: guildId, channel_id: null, self_mute: false, self_deaf: false } })
  }

  requestMembers(guildId, query = '', limit = 0) {
    this.send({ op: OP.REQUEST_MEMBERS, d: { guild_id: guildId, query, limit } })
  }

  closeSocket() {
    this.stopHeartbeat()
    // Bumping the generation marks the socket as superseded, so its close
    // handler stops short of reconnecting. Clearing `onclose` never worked:
    // the listener is registered with `addEventListener`, not the property.
    this.generation = (this.generation ?? 0) + 1
    const socket = this.socket
    this.socket = null
    if (!socket) return
    try {
      socket.close(4000)
    } catch {
      /* ignore */
    }
  }

  destroy() {
    this.closed = true
    this.ready = false
    this.closeSocket()
  }

  /** Wait until READY arrives (used by module startup). */
  async whenReady(timeoutMs = 25_000) {
    if (this.ready) return true
    return new Promise((resolve) => {
      const onReady = () => {
        clearTimeout(timer)
        this.off('ready', onReady)
        resolve(true)
      }
      const timer = setTimeout(() => {
        this.off('ready', onReady)
        resolve(false)
      }, timeoutMs)
      this.once('ready', onReady)
    })
  }
}

export { OP, INTENTS }
