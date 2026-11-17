import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { newId } from './util.js'

const STOP = new Set(['that','this','with','from','have','just','what','when','where','which','would','could','there','their','about','then','than','your','youre','the','and','for','are','was','were','not','but','all','one','two','has','had','can','cant','will','into','http','https','discord','message'])
function tokens(value) {
  const text = String(value ?? '').toLowerCase()
  const out = text.match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
  for (const match of text.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const run = match[0]
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2))
  }
  return [...new Set(out)].filter((word) => !STOP.has(word) && !/^\d+$/.test(word) && word.length < 32)
}

export class DiscordInterestStore {
  constructor(options) {
    this.file = path.join(options.workspace, 'live', 'interests.json')
    this.settings = options.settings
    this.logger = options.logger
    this.items = new Map()
    this.queue = Promise.resolve()
  }

  async load() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'))
      const rows = Array.isArray(value) ? value : Array.isArray(value?.topics) ? value.topics : []
      for (const item of rows) {
        const name = String(item?.name ?? item?.word ?? '').trim()
        if (!name) continue
        this.items.set(name, {
          id: item.id || newId(), name,
          count: Math.max(0, Number(item.count) || 0),
          firstAt: item.firstAt || new Date().toISOString(),
          lastAt: item.lastAt || new Date().toISOString(),
          promotedAt: item.promotedAt || '',
        })
      }
    } catch {}
    return this
  }

  async learn(text) {
    if (!this.settings.get('interest.enabled', true)) return []
    const minChars = Math.max(2, Number(this.settings.get('interest.minChars', 6)) || 6)
    const sample = String(text ?? '').trim()
    if (sample.length < minChars) return []
    const now = new Date().toISOString()
    const promoted = []
    for (const word of tokens(sample)) {
      const current = this.items.get(word) || {
        id: newId(), name: word, count: 0, firstAt: now, lastAt: now, promotedAt: '',
      }
      current.count += 1
      current.lastAt = now
      if (current.count >= 3 && !current.promotedAt) {
        current.promotedAt = now
        promoted.push({ ...current })
      }
      this.items.set(word, current)
    }
    if (this.items.size > 1200) {
      const sorted = [...this.items.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
      this.items = new Map(sorted.slice(0, 900).map((item) => [item.name, item]))
    }
    this.queue = this.queue.then(() => this.persist()).catch((error) => {
      this.logger?.warn?.('interest persistence failed: ' + String(error?.message ?? error))
    })
    return promoted
  }

  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp-' + process.pid
    await writeFile(tmp, JSON.stringify({ version: 1, topics: [...this.items.values()] }, null, 2) + '\n', 'utf8')
    await rename(tmp, this.file)
  }

  list(limit = 100) {
    return [...this.items.values()]
      .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
      .slice(0, Math.max(1, Number(limit) || 100))
  }
}
