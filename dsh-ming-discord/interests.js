import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { newId } from './util.js'

function words(value) {
  const text = String(value ?? '').toLowerCase()
  const out = text.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
  for (const match of text.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const run = match[0]
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2))
  }
  return [...new Set(out)].filter((word) => !/^\d+$/.test(word) && word.length < 32)
}
function inQuietHours(range, date) {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(range || '').trim())
  if (!match) return false
  const start = Number(match[1]) * 60 + Number(match[2])
  const end = Number(match[3]) * 60 + Number(match[4])
  const now = date.getHours() * 60 + date.getMinutes()
  if (start === end) return false
  return start < end ? now >= start && now < end : now >= start || now < end
}

export class DiscordInterestStore {
  constructor(options) {
    const live = path.join(options.workspace, 'live')
    this.file = path.join(live, 'interests.json')
    this.statsFile = path.join(live, 'interest-observations.json')
    this.offFile = path.join(live, 'interest-off')
    this.settings = options.settings
    this.logger = options.logger
    this.config = { topics: [], mute: [] }
    this.stats = {}
    this.queue = Promise.resolve()
    this.lastWake = 0
    this.wakeTimes = []
    this.channelWake = new Map()
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'))
      this.config = this.normalize(value)
    } catch {
      this.config = { topics: [], mute: [] }
      await this.saveConfig(this.config)
    }
    try {
      const value = JSON.parse(await readFile(this.statsFile, 'utf8'))
      this.stats = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch { this.stats = {} }
    return this
  }

  normalize(value) {
    const source = value && typeof value === 'object' ? value : {}
    const topics = (Array.isArray(source.topics) ? source.topics : [])
      .map((topic) => {
        const keywords = [...new Set((Array.isArray(topic?.keywords) ? topic.keywords : [])
          .map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean))].slice(0, 40)
        const name = String(topic?.name ?? keywords[0] ?? '').trim()
        return { name, keywords }
      })
      .filter((topic) => topic.name && topic.keywords.length)
      .slice(0, 200)
    const mute = [...new Set((Array.isArray(source.mute) ? source.mute : [])
      .map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean))].slice(0, 300)
    return { topics, mute }
  }

  async saveConfig(value) {
    const next = this.normalize(value)
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = this.file + '.tmp-' + process.pid
    await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
    await rename(temp, this.file)
    this.config = next
    return this.snapshot()
  }

  async persistStats() {
    await mkdir(path.dirname(this.statsFile), { recursive: true })
    const temp = this.statsFile + '.tmp-' + process.pid
    await writeFile(temp, JSON.stringify(this.stats, null, 2) + '\n', 'utf8')
    await rename(temp, this.statsFile)
  }

  async learn(text) {
    if (!this.settings.get('interest.enabled', true)) return []
    const sample = String(text ?? '').trim()
    if (sample.length < Math.max(1, Number(this.settings.get('interest.minChars', 6)) || 6)) return []
    const now = new Date().toISOString()
    const promoted = []
    for (const word of words(sample)) {
      const current = this.stats[word] || { count: 0, firstAt: now, lastAt: now, promotedAt: '' }
      current.count += 1
      current.lastAt = now
      if (current.count >= 3 && !current.promotedAt) {
        current.promotedAt = now
        promoted.push({ name: word, keywords: [word], count: current.count })
      }
      this.stats[word] = current
    }
    const keys = Object.keys(this.stats)
    if (keys.length > 2000) {
      keys.sort((a, b) => String(this.stats[b]?.lastAt).localeCompare(String(this.stats[a]?.lastAt)))
      this.stats = Object.fromEntries(keys.slice(0, 1500).map((key) => [key, this.stats[key]]))
    }
    this.queue = this.queue.then(() => this.persistStats()).catch((error) => {
      this.logger?.warn?.('interest stats persistence failed: ' + String(error?.message ?? error))
    })
    return promoted
  }

  match(text) {
    const lower = String(text ?? '').toLowerCase()
    for (const word of this.config.mute) {
      if (word && lower.includes(word)) return { muted: word, hits: [] }
    }
    const hits = []
    for (const topic of this.config.topics) {
      const matches = topic.keywords.filter((word) => lower.includes(word))
      if (matches.length) hits.push({ topic: topic.name, words: matches })
    }
    // Auto-discovered interests become eligible after repeated appearances.
    for (const [word, stat] of Object.entries(this.stats)) {
      if (stat?.promotedAt && lower.includes(word) && !this.config.mute.includes(word)
        && !hits.some((hit) => hit.words.includes(word))) {
        hits.push({ topic: word, words: [word], learned: true })
      }
    }
    return { muted: '', hits: hits.slice(0, 8) }
  }

  isOff() {
    try { return existsSync(this.offFile) } catch { return false }
  }

  async setOff(off) {
    await mkdir(path.dirname(this.offFile), { recursive: true })
    if (off) await writeFile(this.offFile, 'paused ' + new Date().toISOString() + '\n', 'utf8')
    else await rm(this.offFile, { force: true })
    return !off
  }

  canWake(channelId, date = new Date()) {
    if (!this.settings.get('interest.enabled', true) || this.isOff()) return { ok: false, reason: '已暫停' }
    if (inQuietHours(this.settings.get('interest.quietHours', '01:00-08:00'), date)) return { ok: false, reason: '靜默時段' }
    const minGap = Math.max(1, Number(this.settings.get('interest.minGapMinutes', 20)) || 20) * 60000
    if (date.getTime() - this.lastWake < minGap) return { ok: false, reason: '全域冷卻中' }
    const maxPerHour = Math.max(0, Number(this.settings.get('interest.maxPerHour', 3)) || 3)
    this.wakeTimes = this.wakeTimes.filter((at) => date.getTime() - at < 3600000)
    if (this.wakeTimes.length >= maxPerHour) return { ok: false, reason: '已達每小時上限' }
    const channelGap = Math.max(1, Number(this.settings.get('interest.channelGapMinutes', 45)) || 45) * 60000
    if (date.getTime() - (this.channelWake.get(String(channelId)) || 0) < channelGap) return { ok: false, reason: '此頻道冷卻中' }
    return { ok: true, reason: '' }
  }

  markWake(channelId, date = new Date()) {
    this.lastWake = date.getTime()
    this.wakeTimes.push(this.lastWake)
    this.channelWake.set(String(channelId), this.lastWake)
  }

  snapshot() {
    const now = Date.now()
    const off = this.isOff()
    const quiet = inQuietHours(this.settings.get('interest.quietHours', '01:00-08:00'), new Date(now))
    const wakesLastHour = this.wakeTimes.filter((at) => now - at < 3600000).length
    const maxPerHour = Number(this.settings.get('interest.maxPerHour', 3)) || 3
    const sinceWakeMs = this.lastWake ? now - this.lastWake : null
    const minGapMs = Math.max(1, Number(this.settings.get('interest.minGapMinutes', 20)) || 20) * 60000
    const skip = []
    if (off) skip.push('已手動暫停')
    if (quiet) skip.push('目前處於靜默時段')
    if (wakesLastHour >= maxPerHour) skip.push('已達每小時上限')
    if (sinceWakeMs !== null && sinceWakeMs < minGapMs) {
      skip.push('全域冷卻中')
    }
    return {
      config: this.config,
      state: {
        at: new Date(now).toISOString(),
        quiet,
        off,
        skip: skip.join('；'),
        wakesLastHour,
        maxPerHour,
        sinceWakeMs,
      },
      learned: Object.entries(this.stats)
        .sort((a, b) => Number(b[1]?.count || 0) - Number(a[1]?.count || 0))
        .slice(0, 40)
        .map(([name, stat]) => ({ name, count: stat.count, promoted: !!stat.promotedAt, lastAt: stat.lastAt })),
    }
  }

  list(limit = 100) { return this.snapshot().learned.slice(0, Math.max(1, Number(limit) || 100)) }
}
