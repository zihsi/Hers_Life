import path from 'node:path'
import os from 'node:os'
import { cp, mkdir, readFile, rename, stat, writeFile, readdir } from 'node:fs/promises'
import { SettingsStore } from './settings.js'
import { DiscordSessionPool } from './pool.js'
import { DiscordBrain } from './memory.js'
import { DiscordInterestStore } from './interests.js'
import { DiscordRest } from './discord/rest.js'
import { DiscordGateway } from './discord/gateway.js'
import { DiscordBridge } from './discord/bridge.js'
import { DiscordEvents } from './discord/events.js'
import { VoiceManager } from './discord/voice.js'

export const name = 'ming-discord'
export const inject = ['agents', 'tools']
const API = '/_dsh/dsh-ming-discord'

const TEMPLATES = {
  'persona/人设.md': '# 人設\n\n在這裡描述角色的外觀、身分與基本設定。人格與個性可在日常互動中逐步形成，不必一次寫死。\n',
  'persona/名字.md': '# 名字與稱呼\n\n- 自己的名字：\n- 全名：\n- 稱呼主人：\n',
  'persona/约定.md': '# 相處約定\n\n- 尊重使用者的最新指示。\n- 不確定的事要承認不確定。\n- 不把私訊內容原句洩漏到公開頻道。\n',
  'AGENTS.md': '# Hers Life 工作區規則\n\n- 這個工作區屬於同一個 AI 身分；各 Discord 會話有獨立歷史。\n- 跨會話記憶必須標示來源，不得把其他頻道的對話冒充成目前對話。\n- 私訊內容預設不對伺服器成員公開。\n',
  'live/interests.json': '[]\n',
  'live/status.json': '{}\n',
  'live/discord-sessions.json': '{}\n',
  'live/discord-memory.jsonl': '',
  'live/discord-events.jsonl': '',
  'memories/README.md': '# 長期記憶\n\n可放人工整理的長期記憶；Discord 對話事件另存於 live/discord-memory.jsonl。\n',
  'sightings/README.md': '# 見聞\n',
  'knowledge/README.md': '# 知識庫\n',
  'config/README.md': '# 工作區設定\n',
  'diary/README.md': '# 日記\n\n日記會按日期建立 Markdown 檔。\n',
}

async function ensureWorkspace(workspace) {
  const root = path.resolve(workspace)
  const dirs = ['persona', 'diary', 'live', 'memories/notes', 'sightings', 'knowledge', 'config', 'sessions', 'downloads']
  for (const dir of dirs) await mkdir(path.join(root, dir), { recursive: true })
  const created = []
  for (const [relative, content] of Object.entries(TEMPLATES)) {
    const file = path.join(root, relative)
    try { await stat(file) } catch {
      await mkdir(path.dirname(file), { recursive: true })
      try { await writeFile(file, content, { encoding: 'utf8', flag: 'wx' }); created.push(relative) }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
  }
  return { root, created, directories: dirs }
}

async function syncMemorySettings(settings) {
  const file = path.join(settings.home, 'ming-memory.json')
  let current = {}
  try { current = JSON.parse(await readFile(file, 'utf8')) } catch {}
  const next = {
    ...current,
    root: settings.resolve().workspace,
    personaFiles: settings.get('personaFiles', ['persona/人设.md', 'persona/名字.md', 'persona/约定.md']),
    diaryDir: settings.get('diaryDir', 'diary'),
    diaryCount: settings.get('diaryCount', 3),
    diaryChars: settings.get('diaryChars', 8000),
    maxChars: settings.get('maxChars', 12000),
  }
  await mkdir(settings.home, { recursive: true })
  const temp = file + '.tmp-' + process.pid
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}

async function copyMissing(source, destination) {
  const src = path.resolve(source)
  const dst = path.resolve(destination)
  if (src === dst || dst.startsWith(src + path.sep)) throw new Error('目的工作區不能位於來源工作區內')
  await mkdir(dst, { recursive: true })
  let copied = 0
  let kept = 0
  async function walk(from, to) {
    await mkdir(to, { recursive: true })
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const a = path.join(from, entry.name)
      const b = path.join(to, entry.name)
      if (entry.isDirectory()) await walk(a, b)
      else if (entry.isFile()) {
        try { await stat(b); kept += 1 } catch {
          await mkdir(path.dirname(b), { recursive: true })
          try { await cp(a, b, { errorOnExist: true, force: false }); copied += 1 }
          catch (error) { if (error.code === 'EEXIST') kept += 1; else throw error }
        }
      }
    }
  }
  try { await stat(src) } catch { return { copied, kept, sourceMissing: true } }
  await walk(src, dst)
  return { copied, kept, sourceMissing: false }
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(body))
}

export function apply(ctx, pluginConfig = {}) {
  const logger = ctx.logger?.child ? ctx.logger.child('hers-life-discord') : ctx.logger
  const settings = new SettingsStore(pluginConfig)
  let rest = null
  let gateway = null
  let bridge = null
  let voice = null
  let brain = null
  let interests = null
  let events = null
  let pool = null
  let detach = null
  let status = { state: 'starting', error: '', connectedAt: null }

  const stopAdapter = async () => {
    try { detach?.() } catch {}
    detach = null
    try { await voice?.destroy?.() } catch {}
    try { gateway?.destroy?.() } catch {}
    rest = gateway = bridge = voice = brain = interests = events = pool = null
  }

  const startAdapter = async () => {
    await stopAdapter()
    const ready = settings.get('enabled', false) && settings.get('discord.enabled', false) && settings.hasToken()
    if (!ready) {
      status = { state: settings.hasToken() ? 'disabled' : 'needs-token', error: '', connectedAt: null }
      return
    }
    try {
      await ensureWorkspace(settings.resolve().workspace)
      rest = new DiscordRest({ token: settings.token, logger })
      events = new DiscordEvents({ dataRoot: settings.resolve().dataRoot, logger })
      brain = new DiscordBrain({ workspace: settings.resolve().workspace, settings, logger })
      await brain.load()
      interests = new DiscordInterestStore({ workspace: settings.resolve().workspace, settings, logger })
      await interests.load()
      pool = new DiscordSessionPool({ ctx, settings, logger })
      await pool.load()
      gateway = new DiscordGateway({ token: settings.token, logger })
      voice = settings.get('voice.enabled', true) ? new VoiceManager({ gateway, rest, settings, logger }) : null
      bridge = new DiscordBridge({ ctx, settings, logger, rest, gateway, brain, pool, voice, interests, events, dataRoot: settings.resolve().dataRoot })
      detach = bridge.attach()
      gateway.on('ready', (data) => {
        voice?.setSelfId?.(data.user?.id ?? gateway.selfId)
        status = { state: 'connected', error: '', connectedAt: new Date().toISOString(), user: data.user?.username ?? '' }
      })
      gateway.on('resumed', () => { status = { ...status, state: 'connected' } })
      gateway.on('error', (error) => { status = { state: 'error', error: String(error?.message ?? error), connectedAt: status.connectedAt } })
      gateway.connect()
      status = { state: 'connecting', error: '', connectedAt: null }
    } catch (error) {
      status = { state: 'error', error: String(error?.stack ?? error?.message ?? error), connectedAt: null }
      logger?.error?.('Discord adapter startup failed: ' + status.error)
    }
  }

  const loadAndStart = async () => {
    await settings.load()
    await syncMemorySettings(settings)
    await ensureWorkspace(settings.resolve().workspace)
    await startAdapter()
  }
  void loadAndStart().catch((error) => {
    status = { state: 'error', error: String(error?.message ?? error), connectedAt: null }
    logger?.error?.('Hers Life Discord init failed: ' + status.error)
  })

  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: API,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const route = url.pathname.slice(API.length).replace(/^\//, '')
          if (req.method === 'GET' && (route === 'settings' || route === 'state')) {
            send(res, 200, { ok: true, settings: settings.publicConfig(), status, hasToken: settings.hasToken(),
              events: events?.list?.(30) ?? [], sessions: pool?.list?.() ?? [], interests: interests?.list?.(100) ?? [] })
            return
          }
          if (req.method === 'POST' && route === 'settings') {
            const body = await readBody(req)
            const previousWorkspace = settings.resolve().workspace
            await settings.patch(body.settings ?? {}, body.token)
            if (body.clearToken === true) await settings.saveToken('')
            await syncMemorySettings(settings)
            const nextWorkspace = settings.resolve().workspace
            let migration = null
            if (nextWorkspace !== previousWorkspace) migration = await copyMissing(previousWorkspace, nextWorkspace)
            await ensureWorkspace(nextWorkspace)
            await startAdapter()
            send(res, 200, { ok: true, settings: settings.publicConfig(), status, migration })
            return
          }
          if (req.method === 'POST' && route === 'initialize') {
            const result = await ensureWorkspace(settings.resolve().workspace)
            send(res, 200, { ok: true, ...result })
            return
          }
          if (req.method === 'POST' && route === 'migrate') {
            const body = await readBody(req)
            const destination = path.resolve(String(body.destination ?? ''))
            if (!destination || destination === path.parse(destination).root) throw new Error('請指定有效的工作區資料夾')
            const old = settings.resolve().workspace
            const result = await copyMissing(old, destination)
            await settings.patch({ workspace: destination })
            await syncMemorySettings(settings)
            await ensureWorkspace(destination)
            await startAdapter()
            send(res, 200, { ok: true, from: old, to: destination, ...result })
            return
          }
          if (req.method === 'GET' && route === 'events') {
            send(res, 200, { ok: true, events: events?.list?.(100) ?? [] })
            return
          }
          if (req.method === 'GET' && route === 'health') {
            send(res, 200, { ok: true, status, hasToken: settings.hasToken(),
              sessions: pool?.list?.().length ?? 0, voice: voice?.list?.() ?? [] })
            return
          }
          send(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          logger?.warn?.('settings API failed: ' + String(error?.message ?? error))
          send(res, 400, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))
  })

  ctx.on('dispose', () => { void stopAdapter() })
  ctx.hersLifeDiscord = {
    say: (channelId, text, options) => bridge?.say(channelId, text, options) ?? Promise.reject(new Error('Discord 尚未連線')),
    sayFiles: (channelId, files, text) => bridge?.sayFiles(channelId, files, text) ?? Promise.reject(new Error('Discord 尚未連線')),
    get status() { return status },
    get bridge() { return bridge },
  }
}
