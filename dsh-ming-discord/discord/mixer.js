/**
 * Mixing several sounds into one voice stream.
 *
 * Discord gives a bot exactly one audio stream per voice connection — one SSRC,
 * one Opus sequence. Two `play()` calls therefore cannot overlap, no matter how
 * they are scheduled: the second would either wait or cut the first off. The
 * only way to have her talk *and* play music at the same time is to mix them
 * before they reach the wire.
 *
 * This does that, and it does it offline on purpose. A live mixer would need a
 * long-running Opus encoder reading raw PCM from stdin; ffmpeg can do it, but
 * the Ogg page boundaries come out of that pipe whenever ffmpeg feels like it
 * and a 20 ms RTP cadence needs packets on demand. Mixing first and then pacing
 * the resulting packets costs one ffmpeg run and keeps the playback loop in
 * `voice.js` exactly as it was.
 *
 * Inputs are described as `{ file, volume, delayMs, offsetMs }`:
 *  - `volume`  linear gain, 1 = unchanged
 *  - `delayMs` silence prepended, so a clip can start later in the mix
 *  - `offsetMs` skip that much of the source first
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Everything is resampled to this so `amix` accepts the inputs at all. */
export const MIX_RATE = 48_000
export const MIX_CHANNELS = 2

/**
 * ffmpeg refuses an audio filter chain with mismatched rates or layouts, and the
 * error messages are unhelpful ("Input channel layouts are not supported"), so
 * every input is normalised first.
 */
function chainFor(track, index) {
  const parts = [
    'aresample=' + MIX_RATE,
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
  ]
  const volume = Number(track.volume)
  if (Number.isFinite(volume) && volume !== 1) parts.push('volume=' + Math.max(0, volume))
  const offset = Number(track.offsetMs)
  if (Number.isFinite(offset) && offset > 0) parts.push('atrim=start=' + (offset / 1000))
  const delay = Number(track.delayMs)
  // `adelay` takes one value per channel; giving a single value applies it to
  // all of them on recent ffmpeg, but two are unambiguous on older builds.
  if (Number.isFinite(delay) && delay > 0) parts.push('adelay=' + Math.round(delay) + '|' + Math.round(delay))
  // No trailing label: the caller decides where this chain ends, because a
  // single-input graph ends at `[out]` and a mixed one ends at `[aN]`.
  return '[' + index + ':a]' + parts.join(',')
}

/**
 * Build the ffmpeg argument list for a mix.
 *
 * Exported separately so a test can assert the filter graph without spawning
 * anything — the graph is the part that breaks when ffmpeg changes.
 */
export function mixArgs(tracks, out) {
  const args = ['-hide_banner', '-loglevel', 'error']
  for (const track of tracks) args.push('-i', track.file)
  let graph
  if (tracks.length === 1) {
    // One input needs no amix — and amix with a single input would still divide
    // the level by one, which is harmless, but the extra filter buys nothing.
    graph = chainFor(tracks[0], 0) + '[out]'
  } else {
    const chains = tracks.map((track, index) => chainFor(track, index) + '[a' + index + ']')
    const pads = tracks.map((_, index) => '[a' + index + ']').join('')
    // `normalize=0` keeps each input at its own level; the default divides by
    // the input count, so talking plus music would come out half as loud as
    // either alone. `alimiter` then catches the sum without a hard clip.
    graph = chains.join(';') + ';' + pads
      + 'amix=inputs=' + tracks.length + ':duration=longest:dropout_transition=0:normalize=0,'
      + 'alimiter=limit=0.95[out]'
  }
  args.push(
    '-filter_complex', graph,
    '-map', '[out]',
    '-ac', String(MIX_CHANNELS),
    '-ar', String(MIX_RATE),
    '-c:a', 'libopus',
    '-b:a', '96k',
    '-application', 'voip',
    '-frame_duration', '20',
    '-y', out,
  )
  return args
}

/** Run ffmpeg until it exits; reject with whatever it complained about. */
function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(command + ' timed out after ' + timeoutMs + 'ms'))
    }, timeoutMs)
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(command + ' exited with ' + code + (stderr.trim() === '' ? '' : ': ' + stderr.trim().slice(0, 600))))
    })
  })
}

/**
 * Mix the tracks into one Ogg/Opus file and hand back its bytes.
 *
 * The temp directory is always removed, including on failure: a voice mixer that
 * leaks a temp folder per line of speech fills the disk on a long conversation.
 */
export async function mixToOgg(tracks, options = {}) {
  const usable = (Array.isArray(tracks) ? tracks : [])
    .filter((track) => track !== null && typeof track === 'object' && String(track.file ?? '') !== '')
    .slice(0, 8)
  if (usable.length === 0) throw new Error('mix: 没有可播放的音源')
  const ffmpeg = String(options.ffmpeg ?? 'ffmpeg')
  const dir = await mkdtemp(join(tmpdir(), 'hers-mix-'))
  const out = join(dir, 'mix.ogg')
  try {
    await run(ffmpeg, mixArgs(usable, out), Number(options.timeoutMs ?? 180_000))
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
