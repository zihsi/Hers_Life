import path from 'node:path'
import os from 'node:os'
import { cp, mkdir, readFile, rename, stat, writeFile, readdir, realpath } from 'node:fs/promises'
import { SettingsStore, isDiaryFilename, isDiaryPath } from './settings.js'
import { DiscordSessionPool } from './pool.js'
import { DiscordBrain } from './memory.js'
import { DiscordInterestStore } from './interests.js'
import { DiscordRest } from './discord/rest.js'
import { DiscordGateway } from './discord/gateway.js'
import { DiscordBridge } from './discord/bridge.js'
import { DiscordEvents } from './discord/events.js'
import { VoiceManager } from './discord/voice.js'
import { quarantinePrivateDmDiary } from './privacy.js'

export const name = 'ming-discord'
export const inject = ['agents', 'tools']
const API = '/_dsh/dsh-ming-discord'

const TEMPLATES = {
  'persona/人设.md': '# 人設\n\n在這裡描述角色的外觀、身分與基本設定。人格與個性可在日常互動中逐步形成，不必一次寫死。\n',
  'persona/名字.md': '# 名字與稱呼\n\n- 自己的名字：\n- 全名：\n- 稱呼主人：\n',
  'persona/约定.md': '# 相處約定\n\n- 尊重使用者的最新指示。\n- 不確定的事要承認不確定。\n- 不把私訊內容原句洩漏到公開頻道。\n',
  'AGENTS.md': '# Hers Life 工作區規則\n\n- 這個工作區屬於同一個 AI 身分；各 Discord 會話有獨立歷史。\n- 跨會話記憶必須標示來源，不得把其他頻道的對話冒充成目前對話。\n- 私訊內容預設不對伺服器成員公開。\n',
  'live/interests.json': '{\n  "topics": [],\n  "mute": []\n}\n',
  'live/status.json': '{}\n',
  'live/discord-sessions.json': '{}\n',
  'live/discord-memory.jsonl': '',
  'live/discord-events.jsonl': '',
  'memories/README.md': '# 長期記憶\n\n可放人工整理的長期記憶；Discord 對話事件另存於 live/discord-memory.jsonl。\n',
  'sightings/README.md': '# 見聞\n',
  'knowledge/README.md': '# 知識庫\n',
  'config/README.md': '# 工作區設定\n',
  'diary/README.md': '# 日記\n\n日記會按日期建立 Markdown 檔。\n',
  'outbox/README.md': '# Discord 發送暫存區\n\nOwner 可從工作區內傳送檔案到目前發起回合的頻道。其他成員只能傳送本次使用者／Session 的 live/voice/ 語音（需有 sidecar 標籤），或 outbox/<session-id>/<user-id>/ 內的檔案。\n',
}

async function ensureWorkspace(workspace, options = {}) {
  const root = path.resolve(workspace)
  const dirs = ['persona', 'diary', 'live', 'memories/notes', 'sightings', 'knowledge', 'config', 'sessions', 'downloads', 'outbox']
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
  // Create user-configured persona files and diary roots too. A path entered in
  // the settings UI must never require the user to manually create a file.
  const configuredPersonaFiles = Array.isArray(options.personaFiles) ? options.personaFiles : []
  const diaryDir = String(options.diaryDir || 'diary').replace(/\\/g, '/')
  const configuredFiles = configuredPersonaFiles.map((relative) => ({
    relative: String(relative),
    content: '# ' + path.basename(String(relative), path.extname(String(relative))) + '\\n\\n',
  }))
  if (diaryDir !== 'diary') configuredFiles.push({
    relative: diaryDir + '/README.md',
    content: '# 日記\\n\\n此資料夾由 Hers Life 設定中心管理；日記會按日期自動建立 Markdown 檔。\\n',
  })
  for (const entry of configuredFiles) {
    const target = path.resolve(root, entry.relative)
    const relative = path.relative(root, target)
    if (!entry.relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('configured workspace file escapes root')
    try { await stat(target) } catch {
      await mkdir(path.dirname(target), { recursive: true })
      try { await writeFile(target, entry.content, { encoding: 'utf8', flag: 'wx' }); created.push(entry.relative) }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
  }
  await mkdir(path.resolve(root, diaryDir), { recursive: true })
  return { root, created, directories: [...dirs, diaryDir] }
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

async function migrateLegacyBrowseSettings(settings) {
  let saved = {}
  try { saved = JSON.parse(await readFile(settings.file, 'utf8')) } catch {}
  if (Object.prototype.hasOwnProperty.call(saved, 'browse')) return false
  const legacyFile = path.join(settings.resolve().workspace, 'live', 'browse-config.json')
  let legacy = {}
  try { legacy = JSON.parse(await readFile(legacyFile, 'utf8')) } catch { return false }
  const browse = {}
  for (const key of ['dailyMax', 'minGapMinutes', 'gapMode', 'hbMin', 'hbCenter', 'hbMax']) {
    if (legacy[key] !== undefined) browse[key] = legacy[key]
  }
  if (!Object.keys(browse).length) return false
  settings.patch({ browse })
  await settings.save()
  return true
}

async function syncBrowseSettings(settings) {
  const browse = settings.get('browse', {})
  const file = path.join(settings.resolve().workspace, 'live', 'browse-config.json')
  await mkdir(path.dirname(file), { recursive: true })
  const next = {
    dailyMax: browse.dailyMax,
    minGapMinutes: browse.minGapMinutes,
    gapMode: browse.gapMode,
    hbMin: browse.hbMin,
    hbCenter: browse.hbCenter,
    hbMax: browse.hbMax,
    at: new Date().toISOString(),
  }
  const temp = file + '.tmp-' + process.pid
  await writeFile(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}

async function syncGraphSettings(settings) {
  const file = path.join(settings.home, 'ming-graph.json')
  let current = {}
  try { current = JSON.parse(await readFile(file, 'utf8')) } catch {}
  const ownerIds = settings.ownerIds()
  const next = {
    ...current,
    workspace: settings.resolve().workspace,
    diaryDir: path.join(settings.resolve().workspace, String(settings.get('diaryDir', 'diary') || 'diary')),
    dshMemoryDir: path.join(settings.home, 'memory'),
    ownerId: ownerIds[0] || '',
    ownerName: String(settings.get('userName', '主人') || '主人'),
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
  const logger = ctx.logger('hers-life-discord')
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

  const ensurePrivacy = async () => {
    const result = await quarantinePrivateDmDiary(settings.resolve().workspace, settings.home, settings.get('diaryDir', 'diary'))
    if (result.entriesMoved > 0) {
      logger?.warn('privacy: quarantined ' + result.entriesMoved + ' legacy private DM diary entries from ' + result.filesChanged + ' shared diary file(s)')
    }
    return result
  }

  const stopAdapter = async () => {
    try { detach?.() } catch {}
    detach = null
    try { await voice?.destroy?.() } catch {}
    try { gateway?.destroy?.() } catch {}
    // Drain queued conversation-memory writes before adapter restart/unload.
    try { await brain?.queue } catch {}
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
      await ensureWorkspace(settings.resolve().workspace, { personaFiles: settings.get('personaFiles', []), diaryDir: settings.get('diaryDir', 'diary') })
      rest = new DiscordRest({ token: settings.token, logger })
      events = new DiscordEvents({ dataRoot: settings.resolve().dataRoot, logger })
      brain = new DiscordBrain({ workspace: settings.resolve().workspace, settings, logger })
      await brain.load()
      interests = new DiscordInterestStore({ workspace: settings.resolve().workspace, settings, logger })
      await interests.load()
      pool = new DiscordSessionPool({ ctx, settings, logger })
      await pool.load()
      gateway = new DiscordGateway({ token: settings.token, logger })
      voice = settings.get('voice.enabled', true)
        ? new VoiceManager({ gateway, rest, settings, logger: ctx.logger('hers-life-discord:voice') })
        : null
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
    await ensureWorkspace(settings.resolve().workspace, { personaFiles: settings.get('personaFiles', []), diaryDir: settings.get('diaryDir', 'diary') })
    await migrateLegacyBrowseSettings(settings)
    await ensurePrivacy()
    await syncMemorySettings(settings)
    await syncGraphSettings(settings)
    await syncBrowseSettings(settings)
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
          const rejection = webCtx.connection?.requestRejection?.(req)
          if (rejection !== undefined) { send(res, rejection || 403, { ok: false, error: 'rejected' }); return }

          const route = url.pathname.slice(API.length).replace(/^\//, '')
          if (req.method === 'GET' && (route === 'settings' || route === 'state')) {
            const resolved = settings.resolve()
            const paths = {
              dshHome: settings.home,
              workspace: resolved.workspace,
              dataRoot: resolved.dataRoot,
              diary: path.join(resolved.workspace, String(settings.get('diaryDir', 'diary') || 'diary')),
              memoryEvents: path.join(resolved.dataRoot, 'discord-memory.jsonl'),
              sessionIndex: path.join(resolved.dataRoot, 'discord-sessions.json'),
              coreMemory: path.join(settings.home, 'memory', 'MEMORY.md'),
              coreNotes: path.join(settings.home, 'memory', 'notes'),
              browseConfig: path.join(resolved.workspace, 'live', 'browse-config.json'),
              wakeQueue: path.join(resolved.workspace, 'live', 'wake-arm.json'),
              voiceOutput: path.join(resolved.workspace, 'live', 'voice'),
              bilibiliCredentials: path.join(settings.home, 'bili-duty', 'bili_credential.json'),
              skillIsolationState: settings.get('skillIsolate.stateFile') || path.join(resolved.workspace, 'skills-off.json'),
            }
            const plugins = {}
            for (const [name, provider] of statusProviders) {
              try { plugins[name] = await provider() } catch (error) { plugins[name] = { error: String(error?.message || error) } }
            }
            send(res, 200, { ok: true, settings: settings.publicConfig(), status: { ...status, paths, plugins }, paths, hasToken: settings.hasToken(),
              events: events?.list?.(30) ?? [], sessions: pool?.list?.() ?? [], interests: interests?.list?.(100) ?? [] })
            return
          }
          if (req.method === 'POST' && route === 'settings') {
            const body = await readBody(req)
            const previousWorkspace = settings.resolve().workspace
            await settings.patch(body.settings ?? {}, body.token)
            if (body.clearToken === true) await settings.saveToken('')
            await syncMemorySettings(settings)
            await syncGraphSettings(settings)
            await syncBrowseSettings(settings)
            const nextWorkspace = settings.resolve().workspace
            let migration = null
            if (nextWorkspace !== previousWorkspace) migration = await copyMissing(previousWorkspace, nextWorkspace)
            await ensureWorkspace(nextWorkspace, { personaFiles: settings.get('personaFiles', []), diaryDir: settings.get('diaryDir', 'diary') })
            await ensurePrivacy()
            await startAdapter()
            const resolved = settings.resolve()
            const paths = {
              dshHome: settings.home,
              workspace: resolved.workspace,
              dataRoot: resolved.dataRoot,
              diary: path.join(resolved.workspace, String(settings.get('diaryDir', 'diary') || 'diary')),
              memoryEvents: path.join(resolved.dataRoot, 'discord-memory.jsonl'),
              sessionIndex: path.join(resolved.dataRoot, 'discord-sessions.json'),
              coreMemory: path.join(settings.home, 'memory', 'MEMORY.md'),
              coreNotes: path.join(settings.home, 'memory', 'notes'),
              browseConfig: path.join(resolved.workspace, 'live', 'browse-config.json'),
              wakeQueue: path.join(resolved.workspace, 'live', 'wake-arm.json'),
              voiceOutput: path.join(resolved.workspace, 'live', 'voice'),
              bilibiliCredentials: path.join(settings.home, 'bili-duty', 'bili_credential.json'),
              skillIsolationState: settings.get('skillIsolate.stateFile') || path.join(resolved.workspace, 'skills-off.json'),
            }
            send(res, 200, { ok: true, settings: settings.publicConfig(), status: { ...status, paths }, paths, migration, restartRequired: nextWorkspace !== previousWorkspace })
            return
          }
          if (req.method === 'POST' && route === 'initialize') {
            const result = await ensureWorkspace(settings.resolve().workspace)
            const privacy = await ensurePrivacy()
            send(res, 200, { ok: true, ...result, privacy })
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
            await syncGraphSettings(settings)
            await syncBrowseSettings(settings)
            await ensureWorkspace(destination, { personaFiles: settings.get('personaFiles', []), diaryDir: settings.get('diaryDir', 'diary') })
            await ensurePrivacy()
            await startAdapter()
            send(res, 200, { ok: true, from: old, to: destination, ...result })
            return
          }
          if (req.method === 'GET' && route === 'interest/config') {
            send(res, 200, { ok: true, config: interests?.config ?? { topics: [], mute: [] } })
            return
          }
          if (req.method === 'POST' && route === 'interest/config') {
            if (!interests) throw new Error('興趣服務尚未初始化')
            const body = await readBody(req)
            const snapshot = await interests.saveConfig(body.config ?? body)
            send(res, 200, { ok: true, config: snapshot.config })
            return
          }
          if (req.method === 'GET' && route === 'interest/state') {
            send(res, 200, { ok: true, ...(interests?.snapshot?.() ?? {}) })
            return
          }
          if (req.method === 'POST' && route === 'interest/toggle') {
            if (!interests) throw new Error('興趣服務尚未初始化')
            const body = await readBody(req)
            const enabled = await interests.setOff(body.off !== false)
            send(res, 200, { ok: true, off: !enabled })
            return
          }
          if (req.method === 'GET' && route === 'workspace/files') {
            const root = settings.resolve().workspace
            const diaryDir = String(settings.get('diaryDir', 'diary') || 'diary').replace(/\\/g, '/')
            const paths = new Set(['AGENTS.md', ...settings.get('personaFiles', [])])
            const diaryRoot = path.join(root, diaryDir)
            try {
              const names = (await readdir(diaryRoot)).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/i.test(name)).sort().reverse().slice(0, 12)
              for (const name of names) paths.add(diaryDir + '/' + name)
            } catch {}
            const now = new Date()
            const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
            paths.add(diaryDir + '/' + today + '.md')
            const files = []
            for (const relative of paths) {
              const normalized = String(relative).replace(/\\/g, '/')
              const isPersona = settings.get('personaFiles', []).includes(normalized)
              const isAllowedDiary = normalized.startsWith(diaryDir + '/') && isDiaryFilename(normalized)
              if (normalized !== 'AGENTS.md' && !isPersona && !isAllowedDiary) continue
              const target = path.resolve(root, normalized)
              const rel = path.relative(root, target)
              if (rel.startsWith('..') || path.isAbsolute(rel)) continue
              let content = ''
              try { content = await readFile(target, 'utf8') } catch {}
              files.push({ path: normalized, content, kind: isPersona ? 'persona' : isAllowedDiary ? 'diary' : 'rules' })
            }
            send(res, 200, { ok: true, root, files })
            return
          }
          if (req.method === 'POST' && route === 'workspace/file') {
            const body = await readBody(req, 160 * 1024)
            const relative = String(body.path ?? '').replace(/\\/g, '/')
            const content = String(body.content ?? '')
            if (content.length > 120000) throw new Error('單一檔案最多 120,000 字元')
            const diaryDir = String(settings.get('diaryDir', 'diary') || 'diary').replace(/\\/g, '/')
            const isPersona = settings.get('personaFiles', []).includes(relative)
            const isRules = relative === 'AGENTS.md'
            const isDiary = isDiaryPath(relative, diaryDir)
            if (!isPersona && !isRules && !isDiary) throw new Error('只能編輯已設定的人設檔、AGENTS.md 或日期格式日記')
            const root = settings.resolve().workspace
            const target = path.resolve(root, relative)
            const rel = path.relative(root, target)
            if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('檔案路徑超出工作區')
            await mkdir(path.dirname(target), { recursive: true })
            await writeFile(target, content, 'utf8')
            send(res, 200, { ok: true, path: relative, chars: content.length })
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
  const sendToOwner = async (message) => {
    if (!rest || !bridge) throw new Error('Discord 尚未連線')
    const owners = settings.ownerIds()
    if (!owners.length) throw new Error('請先在設定頁填入 Owner Discord ID')
    const results = []
    for (const ownerId of owners) {
      const dm = await rest.createDm(ownerId)
      const ids = await bridge.say(String(dm.id), String(message ?? ''))
      results.push({ userId: ownerId, messageIds: ids })
    }
    return results
  }
  const sendFile = async (channelId, filePath, caption = '', actor = null) => {
    if (!bridge) throw new Error('Discord 尚未連線')
    if (!actor || !actor.userId || !actor.channelId) throw new Error('無法確認呼叫此工具的 Discord 會話與使用者')
    if (String(channelId) !== String(actor.channelId)) throw new Error('只能把檔案傳送到目前發起這輪對話的 Discord 頻道／私訊')
    const root = await realpath(settings.resolve().workspace)
    const target = await realpath(path.resolve(String(filePath ?? '')))
    const relative = path.relative(root, target)
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('只允許傳送工作區內的檔案')
    }
    // A non-Owner group member can ask for voice or an explicitly staged
    // deliverable, but cannot use this tool to exfiltrate persona, diary,
    // credentials, session logs or other private workspace files.
    if (!settings.isOwner(actor.userId)) {
      const rel = relative.split(path.sep).join('/')
      const sessionFolder = String(actor.sessionId).replace(/[^a-zA-Z0-9_-]/g, '_')
      const userFolder = String(actor.userId).replace(/[^a-zA-Z0-9_-]/g, '_')
      const ownOutbox = 'outbox/' + sessionFolder + '/' + userFolder + '/'
      const inVoice = rel.startsWith('live/voice/')
      const inOwnOutbox = rel.startsWith(ownOutbox)
      if (!inVoice && !inOwnOutbox) {
        throw new Error('公開會話只能傳送本次使用者的 live/voice/ 檔案或 ' + ownOutbox + ' 內的檔案')
      }
      if (inVoice) {
        let tag = null
        try { tag = JSON.parse(await readFile(target + '.session', 'utf8')) } catch {}
        if (tag?.sessionId !== String(actor.sessionId) || tag?.userId !== String(actor.userId)) {
          throw new Error('這個語音檔不是由目前 Discord 使用者在此會話產生，已拒絕跨使用者／跨會話傳送')
        }
      }
    }
    const info = await stat(target)
    if (!info.isFile() || info.size > Math.max(1, Number(settings.get('discord.maxAttachmentMb', 24)) || 24) * 1024 * 1024) {
      throw new Error('檔案不存在、不是一般檔案或超過附件大小上限')
    }
    const buffer = await readFile(target)
    const ext = path.extname(target).toLowerCase()
    const mediaType = ext === '.mp3' ? 'audio/mpeg' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'application/octet-stream'
    return bridge.sayFiles(String(channelId), [{ buffer, mediaType, name: path.basename(target) }], caption)
  }
  // Publish a real Cordis service so sibling plugins can inject this API.
  // A property assigned to this plugin's child context is not a reliable
  // cross-plugin interface.
  ctx.provide('hersLifeDiscord', {
    say: (channelId, text, options) => bridge?.say(channelId, text, options) ?? Promise.reject(new Error('Discord 尚未連線')),
    sayFiles: (channelId, files, text) => bridge?.sayFiles(channelId, files, text) ?? Promise.reject(new Error('Discord 尚未連線')),
    sendToOwner,
    sendFile: (channelId, filePath, caption, actor) => sendFile(channelId, filePath, caption, actor),
    isOwner: (userId) => settings.isOwner(userId),
    getSetting: (key, fallback) => settings.get(key, fallback),
    patchSettings: async (patch) => {
      const next = settings.patch(patch)
      await settings.save()
      return next
    },
    registerStatusProvider: (name, provider) => {
      const key = String(name || '').trim()
      if (!key || typeof provider !== 'function') return () => {}
      statusProviders.set(key, provider)
      return () => statusProviders.delete(key)
    },
    ensurePrivacy,
    actorForExecution: (exec) => bridge?.actorForExecution(exec) ?? null,
    sessionIdFor: (target) => pool?.sessionIdFor(target) ?? '',
    ownerIds: () => settings.ownerIds(),
    get home() { return settings.home },
    get dataRoot() { return settings.resolve().dataRoot },
    get paths() {
      const resolved = settings.resolve()
      return { dshHome: settings.home, workspace: resolved.workspace, dataRoot: resolved.dataRoot }
    },
    get workspace() { return settings.resolve().workspace },
    get status() { return status },
    get bridge() { return bridge },
  })
  ctx.tools?.register?.({
    name: 'discord_send_to_owner',
    description: '透過 Discord 私訊向設定頁中的 Owner 發送文字。',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const actor = bridge?.actorForExecution(exec)
      if (!settings.isOwner(actor.userId)) throw new Error('只有 Owner 在自己的 Discord 會話中可以呼叫這項工具。')
      return JSON.stringify(await sendToOwner(String(args?.text ?? '')))
    },
  })
  ctx.tools?.register?.({
    name: 'discord_send_file',
    description: '把工作區內的音訊、圖片或檔案發送到目前發起這輪對話的 Discord 頻道／私訊；不可指定其他頻道。Owner 可傳工作區內檔案，其他成員只能傳本次自己的 voice 或 outbox 檔案。',
    parameters: {
      type: 'object', properties: {
        path: { type: 'string' }, caption: { type: 'string' },
      }, required: ['path'], additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args, exec) {
      const actor = bridge?.actorForExecution(exec)
      return JSON.stringify(await sendFile(actor.channelId, args.path, args.caption ?? '', actor))
    },
  })
}
