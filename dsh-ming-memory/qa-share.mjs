// qa-share.mjs —— 同一颗大脑：所有聊天入口共享会话上下文。
//
// 2026-10-24 重写。旧版两处假失败：
//   ① 它断言 feed 里的 tail（旧字段，现在恒空）；
//   ② 它在 agent/created 之后才发消息，然后直接读开场段——可「别的会话在说什么」
//      是 agent/pre-step 每步重算的，不跑 pre-step 当然什么都看不到。
// 现在按真实时序驱动：先建两个会话，再发消息，再走一步 pre-step。
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
const discordS = sessionFor('discord-guild-987654321-channel-555', ROOT)
const otherS = sessionFor('trpg', tempRoot('ming-share-other-'))

const qqA = agentFor('onebot-private-10001', ROOT)
const webA = agentFor('web-abc', ROOT)
const grpA = agentFor('onebot-group-123456789', ROOT)
const discordA = agentFor('discord-guild-987654321-channel-555', ROOT)
await m.created(qqA.agent)
await m.created(webA.agent)
await m.created(grpA.agent)
await m.created(discordA.agent)

m.user(qqS, '她在 QQ 说的第一句话。')
m.assistant(qqS, 'AI在 QQ 回的第一句。')
m.user(grpS, 'QQ 群里说的话，Discord 也应该知道。')
m.user(discordS, 'Discord 群里说的话，QQ 私訊也应该知道。')
m.user(otherS, '这句来自 trpg_web，绝对不该被记录')

await m.preStep(webA.agent)
const t1 = webA.text()
check('Web 看得见 QQ 那边说了什么', t1.includes('别的会话里的对话') && t1.includes('她在 QQ 说的第一句话'))
check('也看得见我在那边回的那句', t1.includes('AI在 QQ 回的第一句'))
check('群聊内容会进入私訊/網頁的共同記憶', t1.includes('QQ 群里说的话'))
check('群里的话带群号标签', /群 123456789/.test(t1))
check('别的工程目录一条不读', !t1.includes('trpg_web'))

await m.preStep(webA.agent)
const t2 = webA.text()
check('同一段不重复塞第二步（读完就划掉）', !t2.includes('她在 QQ 说的第一句话'))

await m.preStep(grpA.agent)
const g1 = grpA.text()
check('群聊也能看到 QQ 私訊內容（共同大腦）', g1.includes('她在 QQ 说的第一句话'))

await m.preStep(discordA.agent)
const d1 = discordA.text()
check('Discord 群聊能看到 QQ 私訊內容', d1.includes('她在 QQ 说的第一句话'))
check('Discord 群聊能看到 QQ 群聊內容', d1.includes('QQ 群里说的话'))
check('Discord 群聊能看到其他 Discord/跨入口內容', d1.includes('Discord 群里说的话'))

check('QQ 那边看不到自己的话（只给别人的）', !qqA.text().includes('别的会话里的对话'))

await sleep(1300)
const feed = readFeed(ROOT)
const qqEntry = feed['onebot-private-10001'] || {}
const qqItems = Array.isArray(qqEntry.items) ? qqEntry.items : []
check('feed.json 落盘', !!feed['onebot-private-10001'])
check('feed 里两边原话都在', qqItems.some((i) => i.r === '她') && qqItems.some((i) => i.r === 'AI'))
check('别的工程目录没进 feed', !feed['trpg'])
check('群來源標籤仍保留（但不限制共享）', feed['onebot-group-123456789'] && feed['onebot-group-123456789'].scope === 'group:123456789',
  JSON.stringify(feed['onebot-group-123456789'] && feed['onebot-group-123456789'].scope))
check('私聊归 dm 那间房', (qqEntry.scope || '') === 'dm', JSON.stringify(qqEntry.scope))

// 2026-11-08：注入段被当成她的话记下来——我在另一个窗口里编的「调试预算」按钮，
// 就是这样绕回本会话、再变成「她说过」的。她的话后面追加的注入块必须剥掉。
const injS = sessionFor('web-inject-1', ROOT)
m.user(injS, '这是她真打的一句。\n\n【别的会话里的对话 · 新增】\n- [web 22:10] 她：我在另一个会话里编的调试预算按钮\n（只给新的一句；更早的已经在前几步给过。）')
await sleep(1300)
const injEntry = readFeed(ROOT)['web-inject-1'] || {}
const injText = (Array.isArray(injEntry.items) ? injEntry.items : []).map((i) => i.t).join(' | ')
check('她的话后面追加的注入段不会被记成她说的', injText.includes('这是她真打的一句') && !injText.includes('调试预算'), injText)

summary('qa-share')
