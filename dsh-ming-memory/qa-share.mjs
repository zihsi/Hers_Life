// qa-share.mjs —— 同一颗大脑：所有聊天入口共享会话上下文。
//
// 2026-10-24 重写。旧版两处假失败：
//   ① 它断言 feed 里的 tail（旧字段，现在恒空）；
//   ② 它在 agent/created 之后才发消息，然后直接读开场段——可「别的会话在说什么」
//      是 agent/pre-step 每步重算的，不跑 pre-step 当然什么都看不到。
// 现在按真实时序驱动：先建两个会话，再发消息，再走一步 pre-step。
import { existsSync } from 'node:fs'
import { tempRoot, emptyDir, mount, sessionFor, agentFor, check, summary, sleep, readFeed } from './qa-lib.mjs'

const ROOT = tempRoot('ming-share-')
const cfg = {
  root: ROOT,
  personaFiles: ['persona/人设.md'],
  diaryDir: 'diary',
  diaryCount: 3,
  maxChars: 12000,
  qq: { dir: emptyDir() }, // 本机真 QQ 消息目录不参与测试
}
const m = mount(cfg)

const qqS = sessionFor('onebot-private-10001', ROOT)
const webS = sessionFor('web-abc', ROOT)
const grpS = sessionFor('onebot-group-123456789', ROOT)
const grpS2 = sessionFor('onebot-group-456789123', ROOT)
const discordS = sessionFor('discord-guild-987654321-channel-555', ROOT)
const discordS2 = sessionFor('discord-guild-987654321-channel-556', ROOT)
const discordDmS = sessionFor('discord-dm-442612564208386048', ROOT)
const otherS = sessionFor('trpg', tempRoot('ming-share-other-'))

const qqA = agentFor('onebot-private-10001', ROOT)
const webA = agentFor('web-abc', ROOT)
const grpA = agentFor('onebot-group-123456789', ROOT)
const grpA2 = agentFor('onebot-group-456789123', ROOT)
const discordA = agentFor('discord-guild-987654321-channel-555', ROOT)
const discordA2 = agentFor('discord-guild-987654321-channel-556', ROOT)
const discordDmA = agentFor('discord-dm-442612564208386048', ROOT)
const otherA = agentFor('trpg', otherS.header.cwd)
for (const a of [qqA, webA, grpA, grpA2, discordA, discordA2, discordDmA, otherA]) {
  await m.created(a.agent)
}

m.user(qqS, '她在 QQ 私訊说的第一句话。')
m.assistant(qqS, 'AI在 QQ 私訊回的第一句。')
m.user(grpS, 'QQ 群 123 里说的话，Discord 也应该知道。')
m.user(grpS2, 'QQ 群 456 里说的话，其他群也应该知道。')
m.user(discordS, 'Discord 频道 555 里说的话，其他频道也应该知道。', 'plugin:ming-discord')
m.user(discordS2, 'Discord 频道 556 里说的话，其他频道也应该知道。', 'plugin:ming-discord')
m.user(discordDmS, 'Discord 私訊里说的话，网页和群聊也应该知道。', 'plugin:ming-discord')
m.user(grpS, '【兴趣唤醒 · 系统生成】这不是主人说的话。', 'plugin:ming-interest')
m.user(grpS, '【插话·先答再回去】这也不是主人说的话。', 'plugin:ming-resume')
m.user(otherS, '这句来自 trpg_web，绝对不该被记录')

const observedDiscord = {
  workspacePath: ROOT,
  sessionId: 'discord-guild-987654321-channel-556',
  sourceId: 'discord-message-unmentioned-556',
  source: 'discord',
  role: '群友A',
  text: '未 @ Bot 的 Discord 群聊消息也要进入共同记忆。',
  at: Date.now(),
}
m.emit('ming-memory/observe', observedDiscord)
m.emit('ming-memory/observe', observedDiscord) // 同一 message_id 重送不能重复保存

await m.preStep(webA.agent)
const t1 = webA.text()
check('Web 看得见 QQ 私訊', t1.includes('别的会话里的对话') && t1.includes('她在 QQ 私訊说的第一句话'))
check('也看得见 AI 在 QQ 私訊回的那句', t1.includes('AI在 QQ 私訊回的第一句'))
check('Web 看得见两个不同 QQ 群', t1.includes('QQ 群 123 里说的话') && t1.includes('QQ 群 456 里说的话'))
check('Web 看得见同一伺服器的两个 Discord 频道', t1.includes('Discord 频道 555') && t1.includes('Discord 频道 556'))
check('未 @ Bot 的 Discord 群消息也进入共享记忆', t1.includes('未 @ Bot 的 Discord 群聊消息'))
check('Web 看得见 Discord 私訊', t1.includes('Discord 私訊里说的话'))
check('不同频道来源标签保留', /群 987654321:555/.test(t1) && /群 987654321:556/.test(t1))
check('其他工程目录不会被记录进共享 feed', !t1.includes('trpg_web'))

await m.preStep(webA.agent)
const t2 = webA.text()
check('同一批共享内容不会重复注入第二步', !t2.includes('她在 QQ 私訊说的第一句话'))

await m.preStep(grpA.agent)
const g1 = grpA.text()
check('QQ 群能看到 QQ 私訊内容（共同大脑）', g1.includes('她在 QQ 私訊说的第一句话'))
check('QQ 群能看到另一个 QQ 群的内容', g1.includes('QQ 群 456 里说的话'))
check('QQ 群能看到 Discord 频道内容', g1.includes('Discord 频道 555'))

await m.preStep(discordA.agent)
const d1 = discordA.text()
check('Discord 频道 555 能看到 QQ 私訊', d1.includes('她在 QQ 私訊说的第一句话'))
check('Discord 频道 555 能看到 QQ 群', d1.includes('QQ 群 123 里说的话'))
check('Discord 频道 555 能看到另一个 Discord 频道', d1.includes('Discord 频道 556'))

await m.preStep(discordA2.agent)
const d2 = discordA2.text()
check('Discord 频道 556 能反向看到频道 555', d2.includes('Discord 频道 555 里说的话'))

await m.preStep(discordDmA.agent)
const ddm = discordDmA.text()
check('Discord 私訊也能看到群聊与其他私訊', ddm.includes('Discord 频道 555') && ddm.includes('她在 QQ 私訊说的第一句话'))

await m.preStep(qqA.agent)
check('QQ 私訊会话也能读取其他入口的共享内容', qqA.live().includes('Discord 频道 556'))
check('QQ 那边不会把自己的历史重复当成别的会话注入', !qqA.live().includes('QQ 私訊说的第一句话'))

await m.preStep(otherA.agent)
const outside = otherA.live()
check('工作区外的工程会话不读取共享聊天', !outside.includes('别的会话里的对话'))
check('工作区外的工程会话不读取 QQ 私訊', !outside.includes('她在 QQ 私訊说的第一句话'))
check('工作区外的工程会话不读取 Discord 群聊', !outside.includes('Discord 频道 555'))

// 同一毫秒内连续写入：第二条不能因为 at 时间戳相同而被 seen 游标吞掉。
const rapidS = sessionFor('discord-guild-987654321-channel-557', ROOT)
const fixedNow = Date.now() + 10
const realNow = Date.now
try {
  Date.now = () => fixedNow
  m.user(rapidS, '同毫秒第一条消息。', 'plugin:ming-discord')
  await m.preStep(webA.agent)
  webA.live() // 触发 context 交付与 seen 游标提交
  m.user(rapidS, '同毫秒第二条消息。', 'plugin:ming-discord')
  await m.preStep(webA.agent)
  const rapid = webA.live()
  check('同毫秒的第二条消息仍能跨会话同步', rapid.includes('同毫秒第二条消息'))
} finally {
  Date.now = realNow
}

// 过了注入期限的内容不应进入上下文，但仍在 7 天本机保留期限内。
const expiredS = sessionFor('web-expired', ROOT)
try {
  Date.now = () => realNow() - 3 * 60 * 60 * 1000
  m.user(expiredS, '这条消息已经超过两小时。')
} finally {
  Date.now = realNow
}
await m.preStep(webA.agent)
check('超过两小时的旧内容不再注入', !webA.live().includes('这条消息已经超过两小时'))

// 超过本机保留期限的 feed 条目应在下一次落盘时清理。
const ancientS = sessionFor('web-ancient', ROOT)
try {
  Date.now = () => realNow() - 8 * 24 * 60 * 60 * 1000
  m.user(ancientS, '这条超过七天，应该清理。')
} finally {
  Date.now = realNow
}
await sleep(1300)
const feed = readFeed(ROOT)
const qqEntry = feed['onebot-private-10001'] || {}
const qqItems = Array.isArray(qqEntry.items) ? qqEntry.items : []
check('feed.json 落盘', !!feed['onebot-private-10001'])
check('feed 里两边原话都在', qqItems.some((i) => i.r === '她') && qqItems.some((i) => i.r === 'AI'))
check('不同 QQ 群都保存独立来源标签', feed['onebot-group-123456789']?.scope === 'group:123456789' && feed['onebot-group-456789123']?.scope === 'group:456789123')
check('两个 Discord 频道都保存独立会话记录', !!feed['discord-guild-987654321-channel-555'] && !!feed['discord-guild-987654321-channel-556'])
check('inbox 同一 message_id 重送不会重复写入', (feed['discord-guild-987654321-channel-556']?.items || []).filter((i) => i.id === 'discord-message-unmentioned-556').length === 1)
check('插件生成的兴趣／接续提示不会伪装成用户发言', !JSON.stringify(feed).includes('系统生成') && !JSON.stringify(feed).includes('这也不是主人说的话'))
check('不同工程目录没进 feed', !feed['trpg'])
check('超过七天的 feed 记录会清理', !feed['web-ancient'])
check('默认关闭的诊断不会生成调试日志', !existsSync(ROOT + '/live/shared-diagnostic.log') && !existsSync(ROOT + '/live/persona-debug.log'))

// 2026-11-08：注入段被当成她的话记下来——我在另一个窗口里编的「调试预算」按钮，
// 就是这样绕回本会话、再变成「她说过」的。她的话后面追加的注入块必须剥掉。
const injS = sessionFor('web-inject-1', ROOT)
m.user(injS, '这是她真打的一句。\n\n【别的会话里的对话 · 新增】\n- [web 22:10] 她：我在另一个会话里编的调试预算按钮\n（只给新的一句；更早的已经在前几步给过。）')
await sleep(1300)
const injEntry = readFeed(ROOT)['web-inject-1'] || {}
const injText = (Array.isArray(injEntry.items) ? injEntry.items : []).map((i) => i.t).join(' | ')
check('她的话后面追加的注入段不会被记成她说的', injText.includes('这是她真打的一句') && !injText.includes('调试预算'), injText)

summary('qa-share')
