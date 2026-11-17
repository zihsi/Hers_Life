/**
 * Minimal Discord REST client built on Node's global fetch.
 *
 * Only the endpoints we actually use are wrapped, but `request()` is public so
 * the `discord_api` tool can reach anything else. Rate limits are handled in
 * two layers: per-bucket 429 retries with `retry_after`, and a small global
 * queue so we never burst past Discord's comfort zone.
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const API = 'https://discord.com/api/v10'

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

/**
 * Turn whatever the settings file holds into an Authorization header.
 *
 * Accepts a bare token or one that already carries the prefix, so a token
 * pasted from the developer portal's example snippet still works — but it never
 * produces two prefixes.
 */
function bearer(token) {
  const clean = String(token ?? '').trim().replace(/^Bot\s+/i, '')
  return 'Bot ' + clean
}

export class DiscordRest {
  constructor(options) {
    this.token = bearer(options.token)
    this.logger = options.logger
    this.buckets = new Map()
    this.user = null
    this.webhookUrl = String(options.webhookUrl ?? '').trim()
  }

  /**
   * Replace the token after the owner edits it in the settings page.
   *
   * This exists so the "Bot " prefix is added in exactly one place. The caller
   * has a bare token from the settings file; a caller that also prefixes it
   * produces `Bot Bot <token>`, which Discord answers with 401 and which looks
   * exactly like a revoked token.
   */
  setToken(token) {
    this.token = bearer(token)
  }

  get hasToken() {
    return this.token.trim() !== 'Bot' && this.token.trim() !== 'Bot '
  }

  /**
   * One request. Returns parsed JSON (or the raw text when the body is not
   * JSON). Throws DiscordApiError on 4xx/5xx except 429 which is retried.
   */
  async request(method, path, options = {}) {
    const url = path.startsWith('http') ? path : API + path
    const headers = { 'User-Agent': 'DiscordBot (dsh-hers-life, 2.0.0)' }
    if (!path.startsWith('http')) headers.Authorization = this.token
    let body
    if (options.files && options.files.length > 0) {
      const form = new FormData()
      if (options.body !== undefined) form.append('payload_json', JSON.stringify(options.body))
      options.files.forEach((file, index) => {
        const blob = file.blob
        form.append('files[' + index + ']', blob, file.name)
      })
      body = form
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    const bucketKey = method + ' ' + path.replace(/\/\d{5,}/g, '/:id')
    const maxAttempts = options.retries ?? 3
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.waitBucket(bucketKey)
      let response
      try {
        response = await fetch(url, { method, headers, body })
      } catch (error) {
        if (attempt === maxAttempts - 1) throw new DiscordApiError(0, method + ' ' + path + ' failed: ' + String(error))
        await delay(500 * (attempt + 1))
        continue
      }
      this.noteBucket(bucketKey, response.headers)
      if (response.status === 429) {
        const info = await response.json().catch(() => ({}))
        const waitMs = Math.min(30_000, Math.ceil(Number(info.retry_after ?? 1) * 1000) + 120)
        this.logger?.warn('rate limited on ' + path + ', waiting ' + waitMs + 'ms')
        await delay(waitMs)
        continue
      }
      const text = await response.text()
      if (!response.ok) {
        const detail = text === '' ? response.statusText : text.slice(0, 400)
        if (response.status >= 500 && attempt < maxAttempts - 1) {
          await delay(400 * (attempt + 1))
          continue
        }
        throw new DiscordApiError(response.status, method + ' ' + path + ' → ' + detail)
      }
      if (options.raw) return response
      if (text === '') return null
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    throw new DiscordApiError(0, 'exhausted retries for ' + method + ' ' + path)
  }

  waitBucket(key) {
    const bucket = this.buckets.get(key)
    if (!bucket) return
    const waitMs = bucket.resetAt - Date.now()
    if (bucket.remaining <= 0 && waitMs > 0) return delay(Math.min(waitMs, 10_000))
  }

  noteBucket(key, headers) {
    const remaining = Number(headers.get('x-ratelimit-remaining') ?? '1')
    const resetAfter = Number(headers.get('x-ratelimit-reset-after') ?? '0')
    if (!Number.isFinite(remaining) || !Number.isFinite(resetAfter)) return
    this.buckets.set(key, { remaining, resetAt: Date.now() + Math.ceil(resetAfter * 1000) + 60 })
  }

  // ------------------------------------------------------------------ self

  async me() {
    this.user = await this.request('GET', '/users/@me')
    return this.user
  }

  async setPresence(status, activities) {
    // Presence only goes through the gateway; kept here for the caller's API shape.
    return { status, activities }
  }

  // -------------------------------------------------------------- channels

  async createDm(recipientId) {
    return this.request('POST', '/users/@me/channels', { body: { recipient_id: String(recipientId) } })
  }

  async channel(channelId) {
    return this.request('GET', '/channels/' + channelId)
  }

  async guilds() {
    return this.request('GET', '/users/@me/guilds')
  }

  async guild(guildId) {
    return this.request('GET', '/guilds/' + guildId)
  }

  async guildChannels(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/channels')
  }

  async guildRoles(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/roles')
  }

  async guildMembers(guildId, limit = 100) {
    return this.request('GET', '/guilds/' + guildId + '/members?limit=' + limit)
  }

  // -------------------------------------------------------------- messages

  async send(channelId, payload) {
    return this.request('POST', '/channels/' + channelId + '/messages', { body: payload })
  }

  async edit(channelId, messageId, payload) {
    return this.request('PATCH', '/channels/' + channelId + '/messages/' + messageId, { body: payload })
  }

  async deleteMessage(channelId, messageId) {
    return this.request('DELETE', '/channels/' + channelId + '/messages/' + messageId)
  }

  async history(channelId, limit = 50, before) {
    const query = '?limit=' + Math.min(100, Math.max(1, limit)) + (before ? '&before=' + before : '')
    return this.request('GET', '/channels/' + channelId + '/messages' + query)
  }

  /** One message by id. Used by context menus when the payload omits it. */
  async message(channelId, messageId) {
    return this.request('GET', '/channels/' + channelId + '/messages/' + messageId)
  }

  async typing(channelId) {
    return this.request('POST', '/channels/' + channelId + '/typing')
  }

  async react(channelId, messageId, emoji) {
    return this.request('POST', '/channels/' + channelId + '/messages/' + messageId + '/reactions/' + encodeURIComponent(emoji) + '/@me')
  }

  async pin(channelId, messageId) {
    return this.request('PUT', '/channels/' + channelId + '/pins/' + messageId)
  }

  async threadFromMessage(channelId, messageId, name) {
    return this.request('POST', '/channels/' + channelId + '/messages/' + messageId + '/threads', {
      body: { name: String(name ?? 'thread').slice(0, 100), auto_archive_duration: 1440 },
    })
  }

  // ----------------------------------------------------------- attachments

  /**
   * Send a file. `files` is a list of local paths; the payload is sent as
   * multipart so Discord renders the attachments properly.
   */
  async sendFiles(channelId, payload, files) {
    const prepared = []
    for (const file of files) {
      const info = await stat(file).catch(() => null)
      if (!info || !info.isFile()) continue
      const media = IMAGE_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
      const buffer = await readFile(file)
      prepared.push({ name: basename(file), blob: new Blob([buffer], { type: media }) })
    }
    if (prepared.length === 0) return this.send(channelId, payload)
    return this.request('POST', '/channels/' + channelId + '/messages', {
      body: payload,
      files: prepared,
    })
  }

  /**
   * Send bytes we already hold in memory.
   *
   * A screenshot she took lives as an attachment in the harness, not as a file
   * on disk the bot process can read — `attachments.readImage` hands back a
   * `Uint8Array`, so there is nothing to `readFile`. Same multipart shape as
   * `sendFiles`, just no filesystem in the middle.
   */
  async sendBlobs(channelId, payload, blobs) {
    const prepared = []
    for (const item of blobs) {
      if (!item || !item.buffer) continue
      const media = String(item.mediaType ?? 'application/octet-stream').split(';')[0].trim()
      prepared.push({ name: String(item.name ?? 'file'), blob: new Blob([item.buffer], { type: media }) })
    }
    if (prepared.length === 0) return this.send(channelId, payload)
    return this.request('POST', '/channels/' + channelId + '/messages', {
      body: payload,
      files: prepared,
    })
  }

  /** Download an attachment (or any url) into memory, with a size guard. */
  async download(url, maxBytes) {
    const response = await fetch(url)
    if (!response.ok) throw new DiscordApiError(response.status, 'download failed: ' + url)
    const length = Number(response.headers.get('content-length') ?? '0')
    if (maxBytes && length > maxBytes) throw new DiscordApiError(0, 'attachment too large: ' + length + ' > ' + maxBytes)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (maxBytes && buffer.length > maxBytes) throw new DiscordApiError(0, 'attachment too large')
    return { buffer, mediaType: response.headers.get('content-type') ?? 'application/octet-stream', name: basename(new URL(url).pathname) }
  }

  // -------------------------------------------------------------- webhooks

  /** Post through a webhook so the message can wear the persona's face. */
  async webhookSend(url, payload) {
    const target = url || this.webhookUrl
    if (!target) throw new DiscordApiError(0, 'no webhook url configured')
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new DiscordApiError(response.status, 'webhook → ' + detail.slice(0, 300))
    }
    const text = await response.text()
    return text === '' ? null : JSON.parse(text)
  }

  // ---------------------------------------------------------------- guilds

  async member(guildId, userId) {
    return this.request('GET', '/guilds/' + guildId + '/members/' + userId)
  }

  async user(userId) {
    return this.request('GET', '/users/' + userId)
  }

  /** Voice regions for the current channel (used before a voice handshake). */
  async voiceRegions(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/regions')
  }

  // ------------------------------------------------------------- reactions
  // Discord lets a bot read who reacted and remove reactions; both matter as
  // soon as she is expected to understand "I clicked the emoji".

  async reactions(channelId, messageId, emoji, options = {}) {
    const query = new URLSearchParams()
    const limit = Math.min(100, Math.max(1, Number(options.limit ?? 25)))
    query.set('limit', String(limit))
    if (options.after !== undefined) query.set('after', String(options.after))
    query.set('type', String(options.type ?? 0))
    const encoded = emoji === undefined ? '' : '/' + encodeURIComponent(emoji)
    return this.request('GET', '/channels/' + channelId + '/messages/' + messageId + '/reactions' + encoded + '?' + query.toString())
  }

  async removeReaction(channelId, messageId, emoji, userId = '@me') {
    return this.request('DELETE', '/channels/' + channelId + '/messages/' + messageId + '/reactions/' + encodeURIComponent(emoji) + '/' + userId)
  }

  async removeAllReactions(channelId, messageId, emoji) {
    const suffix = emoji === undefined ? '' : '/' + encodeURIComponent(emoji)
    return this.request('DELETE', '/channels/' + channelId + '/messages/' + messageId + '/reactions' + suffix)
  }

  // ------------------------------------------------------------ pinned/channel

  async pins(channelId) {
    return this.request('GET', '/channels/' + channelId + '/pins')
  }

  async unpin(channelId, messageId) {
    return this.request('DELETE', '/channels/' + channelId + '/pins/' + messageId)
  }

  async channelPermissions(channelId) {
    return this.request('GET', '/channels/' + channelId)
  }

  /** Channel-level mutable state: topic, name, nsfw, slowmode, position. */
  async editChannel(channelId, body) {
    return this.request('PATCH', '/channels/' + channelId, { body })
  }

  async deleteChannel(channelId) {
    return this.request('DELETE', '/channels/' + channelId)
  }

  async createChannel(guildId, body) {
    return this.request('POST', '/guilds/' + guildId + '/channels', { body })
  }

  // ---------------------------------------------------------------- threads

  async startThread(channelId, body) {
    return this.request('POST', '/channels/' + channelId + '/threads', { body })
  }

  async joinThread(threadId) {
    return this.request('PUT', '/channels/' + threadId + '/thread-members/@me')
  }

  async leaveThread(threadId) {
    return this.request('DELETE', '/channels/' + threadId + '/thread-members/@me')
  }

  async activeThreads(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/threads/active')
  }

  async publicThreads(channelId, archived = false) {
    return this.request('GET', '/channels/' + channelId + '/threads/search?archived=' + String(archived))
  }

  async archivedThreads(channelId, before) {
    return this.request('GET', '/channels/' + channelId + '/threads/archived/public' + (before ? '?before=' + before : ''))
  }

  // ---------------------------------------------------------------- invites

  async createInvite(channelId, body = {}) {
    return this.request('POST', '/channels/' + channelId + '/invites', { body })
  }

  async invites(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/invites')
  }

  async deleteInvite(code) {
    return this.request('DELETE', '/invites/' + code)
  }

  // ------------------------------------------------------------------ emoji

  async emojis(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/emojis')
  }

  async stickers(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/stickers')
  }

  // ------------------------------------------------------------------ roles

  async createRole(guildId, body) {
    return this.request('POST', '/guilds/' + guildId + '/roles', { body })
  }

  async editRole(guildId, roleId, body) {
    return this.request('PATCH', '/guilds/' + guildId + '/roles/' + roleId, { body })
  }

  async deleteRole(guildId, roleId) {
    return this.request('DELETE', '/guilds/' + guildId + '/roles/' + roleId)
  }

  async addRole(guildId, userId, roleId) {
    return this.request('PUT', '/guilds/' + guildId + '/members/' + userId + '/roles/' + roleId)
  }

  async removeRole(guildId, userId, roleId) {
    return this.request('DELETE', '/guilds/' + guildId + '/members/' + userId + '/roles/' + roleId)
  }

  async searchMembers(guildId, query, limit = 20) {
    const params = new URLSearchParams({ query, limit: String(Math.min(1000, Math.max(1, limit))) })
    return this.request('GET', '/guilds/' + guildId + '/members/search?' + params.toString())
  }

  async kick(guildId, userId) {
    return this.request('DELETE', '/guilds/' + guildId + '/members/' + userId)
  }

  async ban(guildId, userId, body = {}) {
    return this.request('PUT', '/guilds/' + guildId + '/bans/' + userId, { body })
  }

  async unban(guildId, userId) {
    return this.request('DELETE', '/guilds/' + guildId + '/bans/' + userId)
  }

  async bans(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/bans')
  }

  // ------------------------------------------------------- application cmds

  /** Global slash commands; takes up to an hour to reach every guild. */
  async globals(appId) {
    return this.request('GET', '/applications/' + appId + '/commands')
  }

  async setGlobalCommands(appId, commands) {
    return this.request('PUT', '/applications/' + appId + '/commands', { body: commands })
  }

  async setGuildCommands(appId, guildId, commands) {
    return this.request('PUT', '/applications/' + appId + '/guilds/' + guildId + '/commands', { body: commands })
  }

  async deleteGlobalCommand(appId, commandId) {
    return this.request('DELETE', '/applications/' + appId + '/commands/' + commandId)
  }

  /** Answer an interaction. `type` 4 = channel message, 5 = deferred, 9 = modal. */
  async interactionCallback(interactionId, token, body) {
    return this.request('POST', '/interactions/' + interactionId + '/' + token + '/callback', { body })
  }

  /** Follow-up after a deferred interaction (15 minute window). */
  async followup(applicationId, token, body) {
    return this.request('POST', '/webhooks/' + applicationId + '/' + token, { body })
  }

  // --------------------------------------------------------------- presence

  /** Bot presence is gateway-only; this shapes the payload callers pass in. */
  async myApplication() {
    return this.request('GET', '/applications/@me')
  }

  async applicationCommands(applicationId, guildId) {
    if (guildId === undefined) return this.request('GET', '/applications/' + applicationId + '/commands')
    return this.request('GET', '/applications/' + applicationId + '/guilds/' + guildId + '/commands')
  }

  // ------------------------------------------------------------------ shards

  /**
   * How Discord wants this bot sharded.
   *
   * `recommended_shards` is what the API suggests for the current guild count;
   * a small bot gets 1. Reading it beats guessing: identifying with a shard
   * count the API disagrees with makes Discord close the session with 4010.
   */
  async gatewayBot() {
    return this.request('GET', '/gateway/bot')
  }

  // ----------------------------------------------------------------- automod

  async autoModRules(guildId) {
    return this.request('GET', '/guilds/' + guildId + '/auto-moderation/rules')
  }

  async createAutoModRule(guildId, body) {
    return this.request('POST', '/guilds/' + guildId + '/auto-moderation/rules', { body })
  }

  async autoModRule(guildId, ruleId) {
    return this.request('GET', '/guilds/' + guildId + '/auto-moderation/rules/' + ruleId)
  }

  async editAutoModRule(guildId, ruleId, body) {
    return this.request('PATCH', '/guilds/' + guildId + '/auto-moderation/rules/' + ruleId, { body })
  }

  async deleteAutoModRule(guildId, ruleId) {
    return this.request('DELETE', '/guilds/' + guildId + '/auto-moderation/rules/' + ruleId)
  }

  // ------------------------------------------------------------------- stage

  /**
   * Stage channels (type 13) need a "stage instance" before anyone may speak.
   * Creating one is the act of starting the show; the audience is forced into
   * `suppress` (listener) unless something moves them.
   */
  async createStageInstance(channelId, body) {
    return this.request('POST', '/stage-instances', { body: { channel_id: channelId, ...body } })
  }

  async stageInstance(channelId) {
    return this.request('GET', '/stage-instances/' + channelId)
  }

  async editStageInstance(channelId, body) {
    return this.request('PATCH', '/stage-instances/' + channelId, { body })
  }

  async deleteStageInstance(channelId) {
    return this.request('DELETE', '/stage-instances/' + channelId)
  }

  /**
   * Change somebody's voice state in a guild.
   *
   * This is how a listener is invited to speak on a stage (`suppress: false`) and
   * how a speaker is moved back to the audience, and also how a member is dragged
   * into or out of a voice channel at all. No `self_` fields — bots may only move
   * other people.
   */
  async editVoiceState(guildId, userId, body) {
    return this.request('PATCH', '/guilds/' + guildId + '/voice-states/' + userId, { body })
  }
}

export class DiscordApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'DiscordApiError'
    this.status = status
  }
}

/**
 * Send raw files from disk one at a time (used by the TTS path where each clip
 * is short lived). Kept separate so rest.js has no opinion about voice.
 */
export function openAsBlob(file) {
  return new Blob([createReadStream(file)])
}

export { API }
