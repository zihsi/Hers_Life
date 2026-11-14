/**
 * Hers Life composition bundle.
 *
 * The child packages remain independently versioned DSH plugins in this repository.
 * This entry composes them under one installable bundle so Add plugin needs one target.
 *
 * Privacy gate: the current legacy memory pipeline is known to inject private QQ/DM
 * material into cross-session context. Do not activate any child plugin until the
 * explicit privacy gate is enabled by the later Memory Access Controller phase.
 */
import * as coreMemory from 'dsh-ming-core-memory'
import * as memory from 'dsh-ming-memory'
import * as graph from 'dsh-ming-graph'
import * as discord from 'dsh-ming-discord'
import * as interest from 'dsh-ming-interest'
import * as bilibiliAccount from 'dsh-ming-bilibili-account'
import * as browse from 'dsh-ming-browse'
import * as voice from 'dsh-ming-voice'
import * as wake from 'dsh-ming-wake'
import * as resume from 'dsh-ming-resume'
import * as skillIsolate from 'dsh-ming-skill-isolate'
import * as mousepet from 'dsh-ming-mousepet'

export const name = 'hers-life'

const CHILDREN = [
  ['coreMemory', coreMemory],
  ['memory', memory],
  ['graph', graph],
  ['discord', discord],
  ['interest', interest],
  ['bilibiliAccount', bilibiliAccount],
  ['browse', browse],
  ['voice', voice],
  ['wake', wake],
  ['resume', resume],
  ['skillIsolate', skillIsolate],
  ['mousepet', mousepet],
]

function asCordisPlugin(module, fallbackName) {
  if (!module || typeof module.apply !== 'function') {
    throw new TypeError(`[dsh-hers-life] invalid child plugin: ${fallbackName}`)
  }
  const plugin = (ctx, config) => module.apply(ctx, config)
  Object.defineProperties(plugin, {
    name: { value: typeof module.name === 'string' ? module.name : fallbackName, configurable: true },
    inject: { value: Array.isArray(module.inject) ? module.inject : [], configurable: true },
  })
  return plugin
}

export async function apply(ctx, config = {}) {
  if (config?.security?.privacyReady !== true) {
    try {
      console.warn(
        '[dsh-hers-life] 已安裝，但尚未啟動：跨會話記憶隱私閘門尚未完成。' +
        '完成 Memory Access Controller 後才可設定 security.privacyReady=true。',
      )
    } catch { /* logging must not affect plugin activation */ }
    return
  }

  for (const [key, module] of CHILDREN) {
    const plugin = asCordisPlugin(module, key)
    await ctx.plugin(plugin, config[key] && typeof config[key] === 'object' ? config[key] : {})
  }
}
