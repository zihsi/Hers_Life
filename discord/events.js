/**
 * A small activity log for everything Discord tells us about.
 *
 * Two reasons this exists:
 *
 * 1. The settings page needs to answer "is she actually seeing my server?" —
 *    a live list of the last few events is the honest answer, and it also makes
 *    permission problems visible (nothing arrives because the intent or the
 *    channel permission is missing).
 * 2. She can be woken by events that are not messages: someone reacts to her
 *    message, a new member joins, a thread is created. Those are queued here so
 *    a later turn can look them up with a tool instead of the bridge deciding
 *    on its own what deserves a reply.
 *
 * Deliberately in memory only: this is a window, not an archive. The persistent
 * record of a conversation is the session log, and nothing here duplicates it.
 */
import { appendLine } from '../store.js'

const MAX = 400

/** Event types worth telling her about, in the order a UI wants to show them. */
export const EVENT_KINDS = {
  MESSAGE_CREATE: '消息',
  MESSAGE_UPDATE: '消息被编辑',
  MESSAGE_DELETE: '消息被删除',
  MESSAGE_REACTION_ADD: '有人加了表情',
  MESSAGE_REACTION_REMOVE: '有人收回表情',
  GUILD_MEMBER_ADD: '有人加入服务器',
  GUILD_MEMBER_REMOVE: '有人离开服务器',
  GUILD_MEMBER_UPDATE: '成员资料变了',
  CHANNEL_CREATE: '新频道',
  CHANNEL_UPDATE: '频道设置变了',
  CHANNEL_DELETE: '频道被删',
  THREAD_CREATE: '新帖子',
  THREAD_UPDATE: '帖子有变化',
  THREAD_DELETE: '帖子被删',
  PRESENCE_UPDATE: '有人上线/改状态',
  TYPING_START: '有人正在输入',
  VOICE_STATE_UPDATE: '语音状态变了',
  INTERACTION_CREATE: '有人点了按钮/用了指令',
  GUILD_CREATE: '加入了新服务器',
  GUILD_UPDATE: '服务器设置变了',
}

export class DiscordEvents {
  /**
   * @param {object} options
   * @param {string} options.dataRoot where the rolling jsonl log lives
   * @param {object} options.logger
   * @param {number} [options.keep] how many events stay in memory
   */
  constructor(options) {
    this.dataRoot = options.dataRoot
    this.logger = options.logger
    this.keep = Number(options.keep ?? MAX)
    this.items = []
    this.waiters = new Set()
    this.counters = new Map()
  }

  /**
   * Record one gateway dispatch.
   *
   * `summary` is what a human would say about it in one line — building it here
   * keeps every caller (bridge, voice, tools) producing the same shape.
   */
  push(type, summary, extra = {}) {
    const item = {
      id: String(extra.id ?? '') || String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
      at: Date.now(),
      type,
      kind: EVENT_KINDS[type] ?? type,
      summary: String(summary ?? ''),
      ...extra,
    }
    this.items.push(item)
    if (this.items.length > this.keep) this.items.splice(0, this.items.length - this.keep)
    this.counters.set(type, (this.counters.get(type) ?? 0) + 1)
    for (const waiter of this.waiters) {
      try {
        waiter(item)
      } catch (error) {
        this.logger?.warn('event waiter failed: ' + String(error?.message ?? error))
      }
    }
    // The rolling file is for a human reading the log after the fact; failures
    // there must never break message handling.
    void appendLine(this.dataRoot, 'discord-events.jsonl', { at: item.at, type, summary: item.summary }, 2000)
      .catch(() => {})
    return item
  }

  /** Most recent first. */
  list(limit = 50, options = {}) {
    const type = options.type === undefined ? '' : String(options.type)
    const filtered = type === '' ? this.items : this.items.filter((item) => item.type === type)
    return filtered.slice(-Math.max(1, limit)).reverse()
  }

  /** Per-type counters since the plugin started — cheap "is it alive" signal. */
  stats() {
    const out = {}
    for (const [type, count] of this.counters) out[type] = count
    return out
  }

  clear() {
    this.items.length = 0
    this.counters.clear()
  }

  /**
   * Wait for the next event (or resolve on timeout with null). Used by the
   * bridge when it wants "tell me as soon as someone answers" without polling.
   */
  next(timeoutMs = 30_000) {
    return new Promise((resolve) => {
      const done = (item) => {
        clearTimeout(timer)
        this.waiters.delete(done)
        resolve(item)
      }
      const timer = setTimeout(() => {
        this.waiters.delete(done)
        resolve(null)
      }, Math.max(100, timeoutMs))
      this.waiters.add(done)
    })
  }
}

/**
 * One-line description of a message event, used for both the log and the tool
 * output. Shared so "what happened" reads the same everywhere.
 */
export function describeMessage(message, options = {}) {
  const author = message.author ?? {}
  const name = author.global_name ?? author.username ?? author.id ?? '?'
  const content = String(message.content ?? '').replace(/\s+/g, ' ').trim()
  const attachments = message.attachments?.length ?? 0
  const parts = []
  if (content !== '') parts.push(content.length > 80 ? content.slice(0, 80) + '…' : content)
  if (attachments > 0) parts.push('[' + attachments + ' 个附件]')
  if (parts.length === 0) parts.push('（无正文）')
  const where = options.channelLabel === undefined ? '' : ' @' + options.channelLabel
  return name + where + '：' + parts.join(' ')
}
