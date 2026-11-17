/**
 * Sharding.
 *
 * Discord splits a large bot across several gateway connections ("shards"),
 * each carrying a slice of the guilds. The API tells you how many it wants via
 * `GET /gateway/bot`. A small bot gets one, and pretending otherwise is worse
 * than useless: identifying with a shard count the API disagrees with gets the
 * session closed with 4010 and nothing works at all.
 *
 * So this wraps N ordinary `DiscordGateway` instances behind one object that
 * looks like a single gateway to the bridge. Everything the bridge listens to
 * (`ready`, `dispatch`, `resumed`) is merged, which means the message path never
 * learns that sharding exists — and on the overwhelmingly common single-shard
 * case this class is a pass-through that costs one extra object.
 */
import { EventEmitter } from 'node:events'
import { DiscordGateway } from './gateway.js'
import { safe } from '../util.js'

/** Discord's own ceiling for one bot without special approval. */
export const MAX_SHARDS = 16

export class ShardManager extends EventEmitter {
  /**
   * @param {{token: string, logger?: object, presence?: object, shards?: number,
   *          shardIds?: number[], presences?: boolean}} options
   */
  constructor(options) {
    super()
    this.token = String(options.token ?? '').trim()
    this.logger = options.logger
    this.presence = options.presence ?? { status: 'online', activities: [] }
    this.presences = options.presences === true
    const wanted = Number(options.shards)
    const count = Number.isFinite(wanted) && wanted >= 1 ? Math.min(MAX_SHARDS, Math.floor(wanted)) : 1
    /**
     * `shardIds` exists for the rare case where a bot on a sharded host wants to
     * run only some of the shards in this process; the count still has to be the
     * global one, or the sessions get rejected.
     */
    const ids = Array.isArray(options.shardIds) && options.shardIds.length > 0
      ? options.shardIds.map((id) => Math.max(0, Math.floor(Number(id) || 0))).filter((id) => id < count)
      : Array.from({ length: count }, (_, index) => index)
    this.shardCount = count
    this.shardIds = ids.length === 0 ? [0] : ids
    this.gateways = new Map()
    this.ready = false
    this.selfId = null
    this.closed = false
  }

  get single() {
    return this.shardCount === 1 && this.shardIds.length === 1
  }

  /** The one gateway, when there is exactly one; handy for tests and diagnostics. */
  get gateway() {
    return this.shardIds.length === 1 ? this.gateways.get(this.shardIds[0]) ?? null : null
  }

  /** READY carries the guild list; the bridge seeds its channel map from it. */
  get guilds() {
    const seen = new Map()
    for (const gateway of this.gateways.values()) {
      for (const guild of gateway.guilds ?? []) seen.set(String(guild?.id ?? ''), guild)
    }
    return [...seen.values()]
  }

  /**
   * Emit without letting one bad listener take the process down. Every listener
   * here runs outside any await chain, so a throw would be an uncaught exception
   * and DSH exits on those.
   */
  emitSafe(name, ...args) {
    for (const listener of this.listeners(name)) {
      try {
        const result = listener(...args)
        if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
          Promise.resolve(result).catch((error) => {
            this.logger?.warn('shard listener for ' + name + ' failed: ' + String(error?.stack ?? error?.message ?? error))
          })
        }
      } catch (error) {
        this.logger?.warn('shard listener for ' + name + ' failed: ' + String(error?.stack ?? error?.message ?? error))
      }
    }
    return true
  }

  /**
   * Every gateway reports ready on its own schedule; a shard manager is ready
   * when all of them are. `whenReady` therefore waits for the merged event.
   */
  connect() {
    this.closed = false
    for (const id of this.shardIds) {
      if (this.gateways.has(id)) continue
      const gateway = new DiscordGateway({
        token: this.token,
        logger: this.logger?.child ? this.logger.child('shard' + id) : this.logger,
        presence: this.presence,
        presences: this.presences,
        shard: [id, this.shardCount],
      })
      this.gateways.set(id, gateway)
      // One shard failing must not take the others down; each reconnect is its
      // own loop already, so this only decides whether the merged event fires.
      gateway.on('ready', safe(this.logger, 'shard ready ' + id, (data) => {
        this.selfId = this.selfId ?? data.user?.id ?? null
        this.emitSafe('shard/ready', { id, total: this.shardCount, data })
        const pending = this.shardIds.filter((shard) => this.gateways.get(shard)?.ready !== true)
        if (pending.length === 0) {
          this.ready = true
          this.logger?.info('all ' + this.shardCount + ' shard(s) ready as ' + (this.selfId ?? '?'))
          this.emitSafe('ready', { ...data, shards: this.shardIds.length, shard_count: this.shardCount })
        }
      }))
      gateway.on('resumed', safe(this.logger, 'shard resumed ' + id, () => {
        this.emitSafe('shard/resumed', { id, total: this.shardCount })
      }))
      gateway.on('dispatch', safe(this.logger, 'shard dispatch ' + id, (type, data) => {
        // The bridge wants one stream of events; which shard delivered it is a
        // routing detail (except for voice, where the guild decides which shard
        // owns the connection — see `gatewayFor`).
        this.emitSafe('dispatch', type, data)
      }))
    }
    for (const gateway of this.gateways.values()) gateway.connect()
    return this
  }

  /** Resolve true once every shard is ready, false on timeout. */
  whenReady(timeoutMs = 25_000) {
    if (this.ready) return Promise.resolve(true)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off('ready', onReady)
        resolve(false)
      }, timeoutMs)
      const onReady = () => {
        clearTimeout(timer)
        resolve(true)
      }
      this.once('ready', onReady)
    })
  }

  updatePresence(presence) {
    this.presence = presence
    for (const gateway of this.gateways.values()) {
      try {
        gateway.updatePresence(presence)
      } catch (error) {
        this.logger?.warn('shard presence: ' + String(error?.message ?? error))
      }
    }
  }

  /**
   * Voice lives on exactly one shard: the one that owns the guild. Guessing is
   * wrong in a sharded bot, so the guild id is hashed the same way Discord does
   * (`(guild_id >> 22) % shard_count`).
   */
  shardOf(guildId) {
    if (this.shardCount <= 1) return this.shardIds[0] ?? 0
    try {
      const id = BigInt(String(guildId))
      return Number((id >> 22n) % BigInt(this.shardCount))
    } catch {
      return this.shardIds[0] ?? 0
    }
  }

  gatewayFor(guildId) {
    const id = this.shardOf(guildId)
    return this.gateways.get(id) ?? this.gateways.get(this.shardIds[0]) ?? null
  }

  joinVoice(guildId, channelId, selfMute = false, selfDeaf = false) {
    const gateway = this.gatewayFor(guildId)
    if (gateway === null) throw new Error('没有可用的分片连上 Discord')
    return gateway.joinVoice(guildId, channelId, selfMute, selfDeaf)
  }

  leaveVoice(guildId) {
    for (const gateway of this.gateways.values()) {
      try {
        gateway.leaveVoice(guildId)
      } catch {
        /* a shard that does not own this guild simply ignores it */
      }
    }
  }

  requestMembers(guildId, query = '', limit = 0) {
    return this.gatewayFor(guildId)?.requestMembers(guildId, query, limit)
  }

  destroy() {
    this.closed = true
    for (const gateway of this.gateways.values()) {
      try {
        gateway.destroy()
      } catch {
        /* already gone */
      }
    }
    this.gateways.clear()
    this.ready = false
  }

  /** What the settings page shows: one line per shard. */
  describe() {
    return [...this.gateways.entries()].map(([id, gateway]) => ({
      id,
      total: this.shardCount,
      ready: gateway.ready === true,
      session: gateway.sessionId === null ? '' : String(gateway.sessionId),
      attempt: gateway.attempt ?? 0,
    }))
  }
}

/**
 * How many shards to use.
 *
 * `0` (or an empty/invalid setting) means "ask Discord", which is the only
 * answer that stays correct as the bot joins more servers. The value is clamped
 * to what the API allows so a typo in the settings page cannot lock her out.
 */
export function resolveShardCount(configured, recommended) {
  const wanted = Number(configured)
  if (Number.isFinite(wanted) && wanted >= 1) return Math.min(MAX_SHARDS, Math.floor(wanted))
  const api = Number(recommended)
  if (Number.isFinite(api) && api >= 1) return Math.min(MAX_SHARDS, Math.floor(api))
  return 1
}
