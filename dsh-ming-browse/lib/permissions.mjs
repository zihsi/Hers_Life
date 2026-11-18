// dsh-ming-browse/lib/permissions.mjs —— 执行前的权限闸
//
// **2026-11-17 17:45：只浏览模式整个删掉了。**
//   她的原话：「自由活动一直被只浏览模式拦截，删除只浏览模式吧」，
//   紧接着又说「花钱类也放吧」，然后「不要乱花钱哦」。
//   所以这里现在只剩一件事：**不拦**。花钱、写、执行、发布，全部放行。
//   「不乱花」是行为规矩，写在 persona/约定.md 里，不在这儿用代码拦。
//
// 保留 classify 和 KIND 是因为 qa-audit 还按类别做词表检查（tap 危险词之类），
// 那个检查跟权限无关，是另一层。
//
// 想重新收紧的时候：别在这个文件里加分支，先问她要拦到什么程度——
// 上一轮就是「默认值改一改、分支没清干净」，结果配置写 editable 也不生效。

export const MODE = {
  LEGACY: 'legacy',
  EDITABLE: 'editable',
}

export const KIND = {
  READ: 'read',
  ANDROID_ACTION: 'android_action',
  SHELL: 'shell',
  BROWSER: 'browser',
  DESKTOP: 'desktop',
  SEND: 'send',
  PUBLISH: 'publish',
  PAY: 'pay',
  UNKNOWN: 'unknown',
}

// 工具名 → 类别。只收这台机器上真装了的；写进来的每一条都要能被一次真调用对上，
// 对不上就是猜的，猜出来的分类不许拿来当判据。
const RULES = [
  [/^bilibili_(search|video|comments|subtitles|frames|history|followings|favorites|dynamics|dm_sessions)/, KIND.READ],
  [/^(read_image|read_animation|see_now|pet|coach_|cv_recall|cv_learn)/, KIND.READ],
  [/^(memory_|rag_recall|session_|web_search|web_fetch|ops_glob|ops_grep|ops_inspect_local_file)/, KIND.READ],
  [/^android_(tap|swipe|input|launch|screenshot)/, KIND.ANDROID_ACTION],
  [/^android_(shutdown|reboot)/, KIND.DESKTOP],
  [/^(ops_bash|ops_load_sdk|ops_discover_tools)/, KIND.SHELL],
  [/^(browse|web_)/, KIND.BROWSER],
  [/^(pet_input|app_launch)/, KIND.DESKTOP],
  [/^(discord_send_file|live_speak|voice_say)/, KIND.SEND],
  [/^bilibili_comment_post/, KIND.PUBLISH],
  [/^(pay_|purchase_|checkout)/i, KIND.PAY],
]

export function classify(tool) {
  const name = String(tool || '')
  for (const [re, kind] of RULES) if (re.test(name)) return kind
  return KIND.UNKNOWN
}

/**
 * 配置归一化。字段留着只是为了旧配置不报错——它们现在不改变任何行为。
 *   mode     —— 认 legacy / editable，其余一律 editable
 *   allow    —— 保留
 *   subjects —— 保留
 */
export function normalizePolicy(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const mode = p.mode === MODE.LEGACY ? MODE.LEGACY : MODE.EDITABLE
  const allow = Array.isArray(p.allow)
    ? p.allow.filter((x) => typeof x === 'string' && Object.values(KIND).includes(x))
    : []
  const subjects = {}
  const put = (id, value) => {
    const key = typeof id === 'string' ? id.trim() : ''
    if (key && value === MODE.EDITABLE) subjects[key] = MODE.EDITABLE
  }
  if (Array.isArray(p.subjects)) for (const id of p.subjects) put(id, MODE.EDITABLE)
  else if (p.subjects && typeof p.subjects === 'object') {
    for (const [id, value] of Object.entries(p.subjects)) put(id, value)
  }
  return { mode, allow, subjects }
}

/**
 * 判定。**恒放行。**
 * @returns {{ok: true, reason: '', skipped: string}}
 */
export function check(_policy, ctx) {
  const tool = String((ctx && ctx.tool) || '')
  return { ok: true, reason: '', skipped: 'no-gate:' + (classify(tool) || KIND.UNKNOWN) }
}
