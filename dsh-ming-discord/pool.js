import path from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { newId } from './util.js'

function sessionIdentity(target) {
  const id = String(target.channelId ?? '')
  const guild = String(target.guildId ?? '')
  if (target.kind === 'dm') return 'discord-dm-' + id
  if (target.thread === true) return 'discord-thread-' + guild + '-' + id
  return 'discord-channel-' + guild + '-' + id
}
export class DiscordSessionPool {
  constructor(options) {
    this.ctx = options.ctx
    this.settings = options.settings
    this.logger = options.logger
    this.file = path.join(this.settings.resolve().dataRoot, 'discord-sessions.json')
    this.entries = new Map()
    this.creating = new Map()
    this.index = {}
  }
  async load() {
    try {
      this.index = JSON.parse(await readFile(this.file, 'utf8'))
      if (!this.index || typeof this.index !== 'object' || Array.isArray(this.index)) this.index = {}
    } catch { this.index = {} }
  }
  sessionIdFor(target) { return sessionIdentity(target) }
  keyFor(target) {
    if (!target || !target.channelId) throw new Error('Discord conversation has no channel id')
    return String(target.channelId)
  }
  async ensureAgent(target) {
    const sessionId = sessionIdentity(target)
    const existing = this.ctx.agents.get(sessionId)
    if (existing) return existing.agent ?? existing
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.()
    const agentOptions = selection ? { provider: selection.provider, model: selection.model } : {}
    const preset = String(this.settings.get('agentPreset', '') || '').trim()
    const setup = async (agentCtx) => {
      if (!preset) return
      try { await this.ctx.get('agentPresets')?.mount?.(agentCtx, preset) } catch (error) {
        this.logger?.warn?.('Discord preset mount failed: ' + String(error?.message ?? error))
      }
    }
    const meta = {
      cwd: this.settings.resolve().workspace,
      hersLife: {
        platform: 'discord',
        conversationId: String(target.channelId),
        conversationType: target.kind === 'dm' ? 'dm' : target.thread ? 'thread' : 'channel',
        guildId: String(target.guildId ?? ''),
        guildName: String(target.guildName ?? ''),
        channelId: String(target.channelId),
        channelName: String(target.channelName ?? ''),
        userId: String(target.userId ?? ''),
        userName: String(target.userName ?? ''),
        threadId: target.thread ? String(target.channelId) : '',
      },
    }
    try {
      const created = await this.ctx.agents.create({ sessionId, meta, agentOptions, setup })
      return created.agent ?? created
    } catch (createError) {
      try {
        const resumed = await this.ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
        return resumed.agent ?? resumed
      } catch (resumeError) {
        throw new Error('Cannot create/resume Discord session ' + sessionId + ': ' +
          String(createError?.message ?? createError) + ' / ' + String(resumeError?.message ?? resumeError))
      }
    }
  }
  async acquire(target) {
    const key = this.keyFor(target)
    const current = this.entries.get(key)
    if (current && current.agent?.status !== 'disposed') return current
    if (this.creating.has(key)) return this.creating.get(key)
    const pending = (async () => {
      const agent = await this.ensureAgent(target)
      const entry = { key, target, agent, sessionId: String(agent?.session?.id ?? sessionIdentity(target)) }
      this.entries.set(key, entry)
      await this.touch(key)
      return entry
    })().finally(() => this.creating.delete(key))
    this.creating.set(key, pending)
    return pending
  }
  async touch(key) {
    const entry = this.entries.get(String(key))
    const target = entry?.target ?? {}
    const sessionId = entry?.sessionId ?? sessionIdentity(target)
    this.index[String(key)] = {
      sessionId, channelId: String(target.channelId ?? key),
      channelName: String(target.channelName ?? ''), guildId: String(target.guildId ?? ''),
      guildName: String(target.guildName ?? ''),
      conversationType: target.kind === 'dm' ? 'dm' : target.thread ? 'thread' : 'channel',
      threadId: target.thread ? String(target.channelId) : '',
      lastActiveAt: new Date().toISOString(),
    }
    await this.persist()
  }
  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temp = this.file + '.tmp-' + newId()
    await writeFile(temp, JSON.stringify(this.index, null, 2) + '\n', 'utf8')
    await rename(temp, this.file)
  }
  list() { return Object.entries(this.index).map(([channelId, data]) => ({ channelId, ...data })) }
}
