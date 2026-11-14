import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'

export const name = 'hers-life-settings'
export const inject = ['connection', 'webServer']

const ROUTE = '/dsh-hers-life-settings/environment'

function respond(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function findOnPath(names) {
  const candidates = Array.isArray(names) ? names : [names]
  for (const name of candidates) {
    const command = process.platform === 'win32' ? 'where.exe' : 'which'
    const result = spawnSync(command, [name], {
      encoding: 'utf8',
      timeout: 1500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (result.status !== 0) continue
    const found = String(result.stdout || '').split(/\r?\n/).map(x => x.trim()).find(Boolean)
    if (found) return found
  }
  return ''
}

async function existingDirectory(value) {
  if (!value || typeof value !== 'string' || !path.isAbsolute(value)) return ''
  try {
    await access(value)
    return value
  } catch {
    return ''
  }
}

async function workspaceCandidates() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const candidates = []
  if (process.env.MING_WORKSPACE) candidates.push({ source: 'MING_WORKSPACE', path: process.env.MING_WORKSPACE })
  try {
    const { readFile } = await import('node:fs/promises')
    const legacy = JSON.parse(await readFile(path.join(dshHome, 'ming-memory.json'), 'utf8'))
    if (typeof legacy.root === 'string' && legacy.root.trim()) {
      candidates.push({ source: '既有記憶設定', path: legacy.root.trim() })
    }
  } catch { /* no legacy settings */ }
  candidates.push({ source: 'DSH 預設工作區', path: path.join(dshHome, 'workspace') })
  const seen = new Set()
  const out = []
  for (const item of candidates) {
    const resolved = path.resolve(item.path)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    const exists = await existingDirectory(resolved)
    out.push({ ...item, path: resolved, exists: Boolean(exists) })
  }
  return { dshHome, candidates: out }
}

async function environmentReport() {
  const workspace = await workspaceCandidates()
  const windows = process.platform === 'win32'
  return {
    ok: true,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    dshHome: workspace.dshHome,
    workspaceCandidates: workspace.candidates,
    commands: {
      node: process.execPath,
      python: findOnPath(windows ? ['python.exe', 'py.exe'] : ['python3', 'python']),
      ffmpeg: findOnPath(windows ? 'ffmpeg.exe' : 'ffmpeg'),
      ffplay: findOnPath(windows ? 'ffplay.exe' : 'ffplay'),
      adb: findOnPath(windows ? 'adb.exe' : 'adb'),
      dsh: findOnPath(windows ? 'dsh.exe' : 'dsh'),
      powershell: findOnPath(windows ? ['pwsh.exe', 'powershell.exe'] : ['pwsh']),
    },
  }
}

export function apply(ctx) {
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: async (req, res) => {
      try {
        if (ctx.connection && typeof ctx.connection.requestRejection === 'function') {
          const rejection = ctx.connection.requestRejection(req)
          if (rejection !== undefined) {
            respond(res, rejection || 403, { ok: false, error: 'rejected' })
            return
          }
        }
        const url = new URL(req.url || '/', 'http://localhost')
        if (url.pathname !== ROUTE) {
          respond(res, 404, { ok: false, error: 'not found' })
          return
        }
        if (req.method !== 'GET') {
          respond(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        respond(res, 200, await environmentReport())
      } catch (error) {
        ctx.logger.warn('[hers-life-settings] environment discovery failed: %s', error?.message || String(error))
        respond(res, 500, { ok: false, error: '環境偵測失敗；請查看 DSH Host 日誌。' })
      }
    },
  })
  ctx.effect(() => dispose, 'hers-life-settings: environment route')
}
