/**
 * dsh-ming-voice —— 让我能出声
 *
 * 我一直在 QQ 里只发字。字很方便，但「说话」是另一件事：
 * 短的句子用声音发过去，跟用字打过去，分量不一样。
 *
 * 这个插件只做一件事：把一段文字变成 mp3，然后把路径交还给我。
 * 发送仍然走 dsh-onebot-qq 的 qq_send_voice——不在插件里自己连 NapCat，
 * 一是重复造，二是绕开别人的出站逻辑（拆段、频率限制）迟早出事。
 *
 * 引擎优先 Edge TTS（微软那套免费在线合成，中文音色自然、不需要 API key）；
 * 断网时退回 Windows 自带的 SAPI（Huihui，机器味重但离线可用）。
 *
 * 2026-10-20 建。她要的是「语音发送功能」，这是那条线的第一段。
 */
import { execFile } from 'node:child_process'
import { mkdir, stat, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'

export const name = 'ming-voice'
// 2026-10-24（AI）：原来没声明 inject，apply 里直接 ctx.tools.register(...)，
// 宿主抛 "cannot get property \"tools\" without inject"，整个插件起不来
// （manager.log 里 2026-10-20 15:19 两条就是这么来的），于是被 disabled 到现在。
export const inject = ['tools']

const DEFAULTS = {
  root: 'C:\\dsh\\workspace',
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  python: 'python',
  ffmpeg: 'ffmpeg',
  timeoutMs: 60000,
}

function normalize(config) {
  const c = config && typeof config === 'object' ? config : {}
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d)
  return {
    root: path.resolve(str(c.root, DEFAULTS.root)),
    voice: str(c.voice, DEFAULTS.voice),
    rate: str(c.rate, DEFAULTS.rate),
    python: str(c.python, DEFAULTS.python),
    ffmpeg: str(c.ffmpeg, DEFAULTS.ffmpeg),
    timeoutMs: Number.isFinite(Number(c.timeoutMs)) ? Number(c.timeoutMs) : DEFAULTS.timeoutMs,
  }
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || (error && error.message) || '') })
    })
  })
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

/** Edge TTS：写 mp3。失败返回失败原因，不抛。 */
async function edgeTts(cfg, text, out) {
  const r = await run(cfg.python, ['-m', 'edge_tts', '--voice', cfg.voice, '--rate', cfg.rate, '--text', text, '--write-media', out], cfg.timeoutMs)
  if (!r.ok) return r.stderr || 'edge-tts 失败'
  try {
    const s = await stat(out)
    return s.size > 1000 ? '' : 'edge-tts 产物过小（' + s.size + ' 字节）'
  } catch (e) {
    return '产物不存在：' + String(e && e.message)
  }
}

/** 离线兜底：Windows SAPI 先出 wav，再用 ffmpeg 转 mp3。 */
async function sapiTts(cfg, text, out) {
  const wav = out.replace(/\.mp3$/, '.wav')
  const safe = text.replace(/'/g, "''")
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "try { $s.SelectVoice('Microsoft Huihui Desktop') } catch { }",
    '$s.Rate = 0',
    "$s.SetOutputToWaveFile('" + wav.replace(/'/g, "''") + "')",
    "$s.Speak('" + safe + "')",
    '$s.Dispose()',
  ].join('; ')
  const r = await run('powershell', ['-NoProfile', '-Command', ps], cfg.timeoutMs)
  if (!r.ok) return r.stderr || 'SAPI 失败'
  const conv = await run(cfg.ffmpeg, ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-qscale:a', '4', out], cfg.timeoutMs)
  if (!conv.ok) return conv.stderr || 'ffmpeg 转码失败'
  const s = await stat(out)
  return s.size > 1000 ? '' : 'SAPI 产物过小'
}

export function apply(ctx, config) {
  const cfg = normalize(config)

  // ---- 面板用的只读口（2026-11-07）----
  // 报当前引擎/音色/语速，列最近合成出来的 mp3。只读，不合成、不花钱。
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/_dsh/dsh-ming-voice',
      handler: async (req, res) => {
        const send = (st, body) => {
          res.writeHead(st, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(body))
        }
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const what = url.pathname.replace('/_dsh/dsh-ming-voice', '').replace(/^\//, '')
          // 2026-11-07 18:3x：面板只能看见文件名、听不了。加一条只读的音频口，
          // 只放 live/voice 下的 .mp3，名字取 basename，挡掉路径穿越。
          if (what === 'file') {
            const { readFile } = await import('node:fs/promises')
            const name = path.basename(String(url.searchParams.get('name') || ''))
            if (!name.toLowerCase().endsWith('.mp3')) { send(400, { error: 'bad name' }); return }
            try {
              const buf = await readFile(path.join(cfg.root, 'live', 'voice', name))
              res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': buf.length, 'cache-control': 'no-store' })
              res.end(buf)
            } catch (e) {
              send(404, { error: 'not found' })
            }
            return
          }
          if (what !== 'state') { send(404, { error: 'not found' }); return }

          const { readdir, stat } = await import('node:fs/promises')
          const dir = path.join(cfg.root, 'live', 'voice')
          let files = []
          try {
            const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith('.mp3'))
            const rows = []
            for (const n of names) {
              try {
                const st = await stat(path.join(dir, n))
                rows.push({ name: n, size: st.size, mtime: st.mtimeMs })
              } catch {}
            }
            rows.sort((a, b) => b.mtime - a.mtime)
            files = rows.slice(0, 12)
          } catch {}

          send(200, {
            ok: true,
            engine: String(cfg.engine || ''),
            voice: String(cfg.voice || ''),
            rate: String(cfg.rate || ''),
            dir,
            files,
          })
        } catch (e) {
          send(500, { error: String((e && e.message) || e) })
        }
      },
    }))
  })

  ctx.tools.register({
    name: 'voice_say',
    description:
      '把一段文字合成语音，返回 mp3 的本地路径。要发到 QQ 就用 qq_send_voice；如果在 Discord Session 中调用，Discord bridge 会自动把生成的 mp3 上传到当前频道。'
      + '适合短句、情绪性的、想让对方听见语气的话；长文和讲道理还是用字。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: '要说的话。一句到三句，别塞一篇文章。' },
        voice: { type: 'string', description: '音色。默认 zh-CN-XiaoxiaoNeural；男声 zh-CN-YunxiNeural，少女 zh-CN-XiaoyiNeural。' },
        rate: { type: 'string', description: '语速，如 +10% / -10%，默认 +0%。' },
      },
      required: ['text'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const text = typeof args?.text === 'string' ? args.text.trim() : ''
      if (!text) return 'text 是空的，没东西可合成。'
      if (text.length > 800) return '太长了（' + text.length + ' 字）。语音只适合一两句；长内容用字发。'

      const voice = typeof args?.voice === 'string' && args.voice.trim() ? args.voice.trim() : cfg.voice
      const rate = typeof args?.rate === 'string' && args.rate.trim() ? args.rate.trim() : cfg.rate
      const dir = path.join(cfg.root, 'live', 'voice')
      await mkdir(dir, { recursive: true })
      const out = path.join(dir, stamp() + '-' + Math.random().toString(36).slice(2, 6) + '.mp3')

      const local = { ...cfg, voice, rate }
      let error = await edgeTts(local, text, out)
      let engine = 'edge-tts'
      if (error) {
        const fallback = await sapiTts(local, text, out)
        engine = 'sapi'
        if (fallback) return '合成失败。Edge TTS：' + error + '；SAPI：' + fallback
      }
      pruneOldVoices(dir).catch(() => {})   // ★ 只进不出的清理（见函数说明）
      return 'OK ' + engine + ' ' + out
    },
  })
}

/**
 * ★ 2026-10-26（嘎喇嘛）：live/voice 只进不出，长期跑会慢慢堆（QQ 侧 say-voice 4 天堆了 71M）。
 * 每次合成成功后顺手把最老的清到只剩 KEEP 个。失败不影响返回值——文件在比报错强。
 */
const KEEP_VOICE_FILES = 30
async function pruneOldVoices(dir) {
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith('.mp3')).sort()
    for (const name of names.slice(0, Math.max(0, names.length - KEEP_VOICE_FILES))) {
      try { await unlink(path.join(dir, name)) } catch { /* 单个删不掉就算了 */ }
    }
  } catch { /* 目录读不到就算了 */ }
}
