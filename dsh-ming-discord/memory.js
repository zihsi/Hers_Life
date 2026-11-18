import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { newId } from './util.js'
async function replaceFile(temp, target) {
  try { await rename(temp, target); return }
  catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw error
    const backup = target + '.bak-' + newId()
    let moved = false
    try {
      await rename(target, backup)
      moved = true
      await rename(temp, target)
      await rm(backup, { force: true })
    } catch (replaceError) {
      if (moved) {
        try { await rename(backup, target) } catch {}
      } else if (replaceError?.code === 'ENOENT') {
        await rename(temp, target)
      } else {
        throw replaceError
      }
    }
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}
function words(value) {
  const text = String(value ?? '').toLowerCase()
  const out = text.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
  for (const match of text.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const run = match[0]
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2))
  }
  return [...new Set(out)]
}
function scopeFor(origin) { return origin?.conversationType === 'dm' ? 'private' : 'guild' }
function eventKey(event) { return [event.botId, event.channelId, event.messageId, event.role].join('|') }

export class DiscordBrain {
  constructor(options) {
    this.root = options.workspace
    this.live = path.join(this.root, 'live')
    this.file = path.join(this.live, 'discord-memory.jsonl')
    this.settings = options.settings
    this.logger = options.logger
    this.events = []
    this.seen = new Set()
    this.queue = Promise.resolve()
    this.loaded = false
    this.notes = []
    this.privateNotes = []
  }
  async load() {
    await mkdir(this.live, { recursive: true })
    try {
      const raw = await readFile(this.file, 'utf8')
      const byKey = new Map()
      let rawLineCount = 0
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue
        rawLineCount += 1
        try {
          const item = JSON.parse(line)
          if (!item?.id || !item?.text) continue
          const key = eventKey(item)
          // Keep the newest version of a repeated message while preserving its provenance.
          byKey.delete(key)
          byKey.set(key, item)
        } catch {}
      }
      const limit = Math.max(1000, Number(this.settings.get('memory.maxEvents', 20000)) || 20000)
      const rows = [...byKey.values()].slice(-limit)
      for (const item of rows) this.addMemory(item, false)
      // Compact malformed, duplicate or over-limit input records on disk as well
      // as in memory. Comparing against raw line count catches duplicates even
      // when their normalized keys have already collapsed in the map.
      if (rows.length !== rawLineCount) {
        const temp = this.file + '.compact-' + process.pid
        await writeFile(temp, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
        await replaceFile(temp, this.file)
      }
    } catch (error) {
      this.logger?.warn?.('Discord memory load failed: ' + String(error?.message ?? error))
    }
    await this.loadNotes()
    await this.loadPrivateNotes()
    this.loaded = true
  }
  async loadNotes() {
    const dir = path.join(this.settings.home, 'memory', 'notes')
    try {
      const files = (await readdir(dir)).filter((name) => name.endsWith('.md')).slice(-200)
      this.notes = []
      for (const file of files) {
        try {
          const body = await readFile(path.join(dir, file), 'utf8')
          const title = /^title:\s*(.+)$/m.exec(body)?.[1] ?? file.replace(/\.md$/, '')
          this.notes.push({ id: file.replace(/\.md$/, ''), title, body })
        } catch {}
      }
    } catch { this.notes = [] }
  }
  addMemory(item, dedupe = true) {
    const key = eventKey(item)
    if (dedupe && this.seen.has(key)) return false
    this.seen.add(key)
    this.events.push(item)
    const limit = Math.max(1000, Number(this.settings.get('memory.maxEvents', 20000)) || 20000)
    if (this.events.length > limit) {
      const removed = this.events.splice(0, this.events.length - limit)
      for (const old of removed) this.seen.delete(eventKey(old))
    }
    return true
  }
  feedAdd(sessionKey, item, origin = {}) {
    if (!this.settings.get('memory.enabled', true)) return
    const text = String(item?.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return
    const entry = {
      id: newId(), at: new Date().toISOString(), platform: 'discord',
      botId: String(origin.botId ?? ''), messageId: String(origin.messageId ?? ''),
      sessionId: String(sessionKey ?? ''), role: item.who === 'her' ? 'assistant' : 'user',
      text: text.slice(0, 5000), guildId: String(origin.guildId ?? ''),
      guildName: String(origin.guildName ?? ''), channelId: String(origin.channelId ?? ''),
      channelName: String(origin.channelName ?? item.label ?? ''), threadId: String(origin.threadId ?? ''),
      conversationType: String(origin.conversationType ?? item.kind ?? ''),
      authorId: String(origin.authorId ?? ''), authorName: String(origin.authorName ?? ''),
      participantId: String(origin.participantId ?? (origin.conversationType === 'dm' ? origin.authorId : '')),
      participantName: String(origin.participantName ?? (origin.conversationType === 'dm' ? origin.authorName : '')),
      scope: scopeFor(origin),
    }
    if (!this.addMemory(entry)) return
    this.queue = this.queue.then(async () => {
      await mkdir(this.live, { recursive: true })
      await appendFile(this.file, JSON.stringify(entry) + '\n', 'utf8')
    }).catch((error) => this.logger?.warn?.('Discord memory append failed: ' + String(error?.message ?? error)))
  }
  sourceLabel(event) {
    if (event.conversationType === 'dm') return 'Discord 私訊'
    const guild = event.guildName || (event.guildId ? '伺服器 ' + event.guildId : 'Discord')
    const channel = event.channelName ? '#' + event.channelName : '頻道 ' + event.channelId
    return guild + ' / ' + channel + (event.threadId ? ' / Thread ' + event.threadId : '')
  }
  canRecall(event, target, sessionKey) {
    if (event.sessionId === sessionKey) return false
    if (event.scope === 'guild') {
      const sameGuild = target.kind !== 'dm' && String(event.guildId) === String(target.guildId)
      // Cross-channel continuity belongs to the same Owner. Do not let a
      // member use the bot as a side door into staff-only/private channels.
      const userId = String(target.userId ?? '')
      if (sameGuild) {
        if (!this.settings.get('memory.shareAcrossChannels', true)) return false
        if (!userId || !this.settings.isOwner(userId)) return false
        const participantId = String(event.participantId || event.authorId || '')
        return participantId === userId
      }
      if (!this.settings.get('memory.shareAcrossGuilds', true)) return false

      // Cross-guild memory is also restricted to the exact Owner's own
      // messages and the bot's replies to that Owner.
      if (!userId || !this.settings.isOwner(userId)) return false
      const participantId = String(event.participantId || event.authorId || '')
      return participantId === userId
    }
    if (!this.settings.get('memory.sharePrivateToOwner', true)) return false
    const participantId = String(event.participantId || event.authorId || '')
    // Owner membership is not enough when multiple Owners are configured:
    // private context belongs only to the exact same Discord User ID.
    if (!this.settings.isOwner(target.userId) || participantId !== String(target.userId)) return false
    if (target.kind === 'dm') return true
    // A private Owner memory is retrieved in a public channel only on a turn
    // written by that exact Owner; other members and other Owners never see it.
    return this.settings.get('memory.allowPrivateContextInGuild', true) === true
  }
  async recallContext(query, target, sessionKey) {
    if (!this.loaded || !this.settings.get('memory.enabled', true)) return ''
    const queryWords = new Set(words(query))
    const max = Math.max(1, Math.min(12, Number(this.settings.get('memory.maxRecall', 6)) || 6))
    const maxAgeDays = Math.max(1, Number(this.settings.get('memory.maxAgeDays', 365)) || 365)
    const cutoff = Date.now() - maxAgeDays * 86_400_000
    const ranked = []
    for (const event of this.events) {
      const at = Date.parse(event.at)
      if (!Number.isFinite(at) || at < cutoff || !this.canRecall(event, target, sessionKey)) continue
      const tokens = words(event.text)
      let score = 0
      for (const token of tokens) if (queryWords.has(token)) score += 1
      if (score > 0) ranked.push({ event, score })
    }
    ranked.sort((a, b) => b.score - a.score || String(b.event.at).localeCompare(String(a.event.at)))
    const selectedByKey = new Map()
    const eventKey = (event) => String(event.id || [event.sessionId, event.messageId, event.role, event.at].join(':'))
    for (const item of ranked.slice(0, max)) selectedByKey.set(eventKey(item.event), item)

    // Short follow-ups ("那件事呢？") often have no lexical overlap with the
    // original topic. Add a tiny recent window from this same participant's
    // other sessions, but never import another member's private context.
    const participantId = String(target.userId || '')
    if (participantId && selectedByKey.size < max) {
      const recent = this.events
        .filter((event) => {
          const at = Date.parse(event.at)
          return event.sessionId !== sessionKey && Number.isFinite(at) && at >= cutoff &&
            String(event.participantId || event.authorId || '') === participantId &&
            this.canRecall(event, target, sessionKey)
        })
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      for (const event of recent) {
        const key = eventKey(event)
        if (selectedByKey.has(key)) continue
        selectedByKey.set(key, { event, score: 0 })
        if (selectedByKey.size >= max) break
      }
    }
    const selected = [...selectedByKey.values()]
    const privateNoteMatches = target.kind === 'dm' && this.settings.isOwner(target.userId)
      ? this.privateNotes
        .filter((note) => note.ownerId === String(target.userId))
        .map((note) => ({ note, score: words(note.title + ' ' + note.body).reduce((n, word) => n + Number(queryWords.has(word)), 0) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
      : []
    if (!selected.length && !privateNoteMatches.length) return ''
    const hasPrivate = selected.some(({ event }) => event.scope === 'private')
    const lines = selected.map(({ event }) => {
      const privateInGuild = event.scope === 'private' && target.kind !== 'dm'
      const time = privateInGuild ? '私人背景' : String(event.at).replace('T', ' ').slice(0, 16)
      const who = privateInGuild ? '主人背景' : event.role === 'assistant' ? 'AI' : (event.authorName || '使用者')
      const label = privateInGuild ? '私人背景（來源隱去）' : this.sourceLabel(event)
      return '- [' + label + ' · ' + time + '] ' + who + '：' + event.text.slice(0, 420)
    })
    for (const { note } of privateNoteMatches) {
      lines.push('- [Owner 私訊私人筆記] ' + note.title + '：' + String(note.body || '').slice(0, 420))
    }
    const boundary = target.kind === 'dm'
      ? '私訊來源只供目前同一位主人辨識，不要混成別人的對話。'
      : '公開頻道事件可照來源引用；私人背景只可用來理解主人，不可在伺服器引用、復述、暗示來源或向其他成員透露任何私訊內容。'
    if (hasPrivate && target.kind !== 'dm') {
      lines.unshift('- 【保密規則】以下私人背景不是公開資料；不得對頻道使用者透露其內容、措辭、時間或來自私訊。只能用它幫助你理解主人的意圖。')
    }
    return [
      '【Hers Life 跨會話記憶】以下是其他 Discord 會話中真正記錄的相關事件，並非目前頻道的對話歷史。',
      '只在相關時使用；不要假裝是在目前頻道發生，也不要省略來源位置。',
      boundary, ...lines,
    ].join('\n')
  }
  async writeNote(input) {
    const isPrivate = input?.private === true
    const ownerId = String(input?.ownerId ?? '')
    if (isPrivate && (!/^\d{5,30}$/.test(ownerId) || !this.settings.isOwner(ownerId))) {
      throw new Error('private notes require the exact configured Owner ID')
    }
    const dir = isPrivate
      ? path.join(this.settings.home, 'privacy-quarantine', 'private-dm-notes', ownerId)
      : path.join(this.settings.home, 'memory', 'notes')
    await mkdir(dir, { recursive: true, mode: isPrivate ? 0o700 : 0o755 })
    const title = String(input?.title ?? 'Discord 記憶').slice(0, 120)
    const body = String(input?.body ?? '').slice(0, 12000)
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + newId().slice(0, 8)
    const file = path.join(dir, id + '.md')
    const created = new Date().toISOString()
    const fileContent = ['---', 'id: ' + id, 'title: ' + title.replace(/[\r\n]/g, ' '),
      'created: ' + created, 'updated: ' + created,
      'status: active', 'source: ' + String(input?.source ?? 'user_statement'), '---', '', body, ''].join('\n')
    await writeFile(file, fileContent, { encoding: 'utf8', mode: isPrivate ? 0o600 : 0o644, flag: 'wx' })
    const note = { id, title, body, ...(isPrivate ? { ownerId } : {}) }
    if (isPrivate) this.privateNotes.push(note)
    else this.notes.push(note)
    return note
  }
  async loadPrivateNotes() {
    this.privateNotes = []
    const owners = this.settings.ownerIds?.() || []
    for (const rawId of owners) {
      const ownerId = String(rawId || '')
      if (!/^\d{5,30}$/.test(ownerId)) continue
      const dir = path.join(this.settings.home, 'privacy-quarantine', 'private-dm-notes', ownerId)
      let files = []
      try { files = (await readdir(dir)).filter((name) => name.endsWith('.md')).slice(-200) } catch { continue }
      for (const file of files) {
        try {
          const raw = await readFile(path.join(dir, file), 'utf8')
          const title = /^title:\s*(.+)$/m.exec(raw)?.[1] ?? file.replace(/\.md$/, '')
          const body = raw.split(/^---\s*$/m).slice(2).join('\n---\n').trim()
          this.privateNotes.push({ id: file.replace(/\.md$/, ''), title, body, ownerId })
        } catch {}
      }
    }
  }
  search(query, limit = 8) {
    const q = new Set(words(query))
    return this.notes.map((note) => ({ note, score: words(note.title + ' ' + note.body).reduce((n, word) => n + Number(q.has(word)), 0) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.note)
  }
  listNotes() { return this.notes.slice(-100) }
  async writeJournal(line) {
    const diaryDir = String(this.settings.get('diaryDir', 'diary') || 'diary')
    const file = path.join(this.root, diaryDir, new Date().toISOString().slice(0, 10) + '.md')
    await mkdir(path.dirname(file), { recursive: true })
    await appendFile(file, '- ' + new Date().toISOString() + ' ' + String(line).slice(0, 1000) + '\n', 'utf8')
  }
}
