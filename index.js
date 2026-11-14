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

export const name = 'hers-life'

const CHILDREN = [
  ['coreMemory', 'dsh-ming-core-memory'],
  ['memory', 'dsh-ming-memory'],
  ['graph', 'dsh-ming-graph'],
  ['discord', 'dsh-ming-discord'],
  ['interest', 'dsh-ming-interest'],
  ['bilibiliAccount', 'dsh-ming-bilibili-account'],
  ['browse', 'dsh-ming-browse'],
  ['voice', 'dsh-ming-voice'],
  ['wake', 'dsh-ming-wake'],
  ['resume', 'dsh-ming-resume'],
  ['skillIsolate', 'dsh-ming-skill-isolate'],
  ['mousepet', 'dsh-ming-mousepet'],
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

  for (const [key, packageName] of CHILDREN) {
    // Import child code only after the privacy gate passes; module evaluation can have side effects.
    const module = await import(packageName)
    const plugin = asCordisPlugin(module, key)
    await ctx.plugin(plugin, config[key] && typeof config[key] === 'object' ? config[key] : {})
  }
}
