// qa-status.mjs —— 记忆状态字段的回归测试（2026-10-30 溟写）
//
// 起因：浔批了 dsh-mnemosyne 评估里的那条结论——归档记忆要能说清四件事：
//   status（候选/生效/被取代/作废）、source（她说的/我推断的/观察到的）、
//   supersedes（被哪条取代）、last_confirmed（最近一次被证据确认）。
// 这个测试专盯五件事：
//   1. 写入时四个字段真的落进 front-matter
//   2. 传 supersedes → 旧条目变 superseded，并记下 superseded_by，正文一个字不动
//   3. memory_search 默认搜不到被取代的；include_retired=true 能搜到
//   4. 没有新字段的老条目一律当「生效 / 来源未知」，照旧搜得到
//   5. memory_read 会显示状态行，作废的挂 ⚠
//
// 跑法：node qa-status.mjs（在插件目录下；假 DSH_HOME，不碰真记忆）
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'ming-mem-status-'))
process.env.DSH_HOME = home
const notesDir = join(home, 'memory', 'notes')
mkdirSync(notesDir, { recursive: true })

// 一条「旧格式」记忆：只有 id/title/tags/created/updated
writeFileSync(join(notesDir, '20260101-000000-legacy.md'),
  '---\nid: 20260101-000000-legacy\ntitle: 老条目洋葱\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\n老条目的正文，讲洋葱。\n')

const { apply } = await import('./lib/index.js')
const tools = []
const ctx = {
  on: () => {},
  tools: { register: (d) => tools.push(d) },
  systemPrompt: { section: () => {} },
  inject: () => {},
  effect: () => {},
}
apply(ctx)
await new Promise((r) => setTimeout(r, 200))

// 启动恢复应直接发现原有笔记；不再删索引绕过初始化缺陷。

const T = (n) => tools.find((t) => t.name === n)
let fails = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('PASS ' + label)
  else { fails++; console.log('FAIL ' + label + (extra ? ' → ' + extra : '')) }
}

// 1) 写一条新的，带 status/source
const w1 = await T('memory_write').execute({
  title: '洋葱要竖着切',
  content: '实测：竖切洋葱辣眼睛更轻。',
  tags: ['厨艺'],
  status: 'active',
  source: 'direct_observation',
})
ok(/生效/.test(w1) && /观察到的/.test(w1), '写入回执带状态与来源', w1)
const id1 = /\[([^\]]+)\]/.exec(w1)[1]
const raw1 = readFileSync(join(notesDir, id1 + '.md'), 'utf8')
ok(/^status: active$/m.test(raw1) && /^source: direct_observation$/m.test(raw1), 'front-matter 落了 status/source')
ok(/^last_confirmed: \d{4}-/m.test(raw1), '生效条目自动记 last_confirmed')

// 2) 再写一条取代它
const w2 = await T('memory_write').execute({
  title: '洋葱切法（更正）',
  content: '更正：竖切主要少释放丙硫醛，冷藏后再切效果更明显。',
  tags: ['厨艺'],
  source: 'direct_observation',
  supersedes: id1,
})
ok(/已被取代/.test(w2), '回执说明旧条目被标成已被取代', w2)
const oldRaw = readFileSync(join(notesDir, id1 + '.md'), 'utf8')
ok(/^status: superseded$/m.test(oldRaw), '旧条目文件里 status 改为 superseded')
ok(new RegExp('^superseded_by: ' + /\[([^\]]+)\]/.exec(w2)[1] + '$', 'm').test(oldRaw), '旧条目记下 superseded_by')
ok(/竖切洋葱辣眼睛更轻/.test(oldRaw), '旧条目正文没被改写')

// 3) 检索默认不返回被取代的
//    2026-11-03 改口径：它不该作为**独立命中**出现；但作为「新的那条取代了谁」的来由，
//    可以出现在链里（旧口径是什么，正是回捞前因后果要回答的事）。
const s1 = await T('memory_search').execute({ query: '洋葱' })
ok(new RegExp('^\\[' + id1 + '\\]', 'm').test(s1) === false, '默认检索不把被取代的旧条目当命中', s1.slice(0, 300))
ok(/起因：本条取代/.test(s1), '命中的新条目带出「它取代了谁」')
ok(/丙硫醛/.test(s1), '默认检索仍能返回新的那条')
const s2 = await T('memory_search').execute({ query: '洋葱', include_retired: true })
ok(/竖切洋葱辣眼睛更轻/.test(s2), 'include_retired=true 能搜到旧条目')

// 4) 老条目当生效、来源未知，照旧搜得到
const s3 = await T('memory_search').execute({ query: '洋葱' })
ok(/20260101-000000-legacy/.test(s3), '无字段的老条目照旧被搜到（当生效）')
ok(/来源未知/.test(s3), '老条目显示来源未知')
const r3 = await T('memory_read').execute({ id: '20260101-000000-legacy' })
ok(/状态：生效/.test(r3) && !/⚠/.test(r3), '老条目 read 显示「生效」且不报警')

// 5) 作废条目的 read 会挂 ⚠
const r1 = await T('memory_read').execute({ id: id1 })
ok(/已被取代/.test(r1) && /⚠/.test(r1), '被取代的条目 read 会挂 ⚠')
ok(/被 \[/.test(r1), 'read 显示被哪条取代')

// 6) 非法枚举回落
const w3 = await T('memory_write').execute({ title: '瞎写的状态', content: 'x', status: 'bogus', source: 'bogus' })
ok(/生效 · 来源未知/.test(w3), '非法 status/source 回落到默认值', w3)

// 7) supersedes 指错要拒绝，不留半条
const before = readFileSync(join(home, 'memory', 'index.json'), 'utf8')
const w4 = await T('memory_write').execute({ title: '指错', content: 'x', supersedes: 'no-such-id' })
ok(/不存在/.test(w4), 'supersedes 指错会拒绝', w4)
ok(before === readFileSync(join(home, 'memory', 'index.json'), 'utf8'), '被拒绝时不写索引')

console.log(fails === 0 ? '\n全部通过' : '\n有 ' + fails + ' 项未通过')
process.exit(fails === 0 ? 0 : 1)
