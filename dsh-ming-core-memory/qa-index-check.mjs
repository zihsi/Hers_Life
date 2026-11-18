// qa-index-check.mjs —— memory_index_check 的回归测试（2026-11-17，P1-C 补的预览入口）
//
// 盯四件事：
//   1. 默认只查不写：索引文件一个字节都不动，notes/ 也不动
//   2. 解析不了的文件被列出来，不静默当它不存在
//   3. 索引指向不存在的笔记（幽灵 id）和「笔记没进索引」都要报出来
//   4. rebuild:true 先备份、再按笔记重建；墓碑不复活；笔记文件一个都不删
//
// 跑法：node qa-index-check.mjs（在插件目录下；假 DSH_HOME，不碰真记忆）
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'ming-mem-idxcheck-'))
process.env.DSH_HOME = home
const notesDir = join(home, 'memory', 'notes')
mkdirSync(notesDir, { recursive: true })
const idxPath = join(home, 'memory', 'index.json')

const note = (id, title, body = '正文') =>
  '---\nid: ' + id + '\ntitle: ' + title + '\ncreated: 2026-11-01T00:00:00.000Z\nupdated: 2026-11-01T00:00:00.000Z\nstatus: active\nsource: agent_inference\n---\n\n' + body + '\n'

writeFileSync(join(notesDir, '20261101-000000-aaa.md'), note('20261101-000000-aaa', '条目甲'))
writeFileSync(join(notesDir, '20261101-000001-bbb.md'), note('20261101-000001-bbb', '条目乙'))
// 墓碑：删过的不该复活
writeFileSync(join(notesDir, '20261101-000002-gone.md'), '---\ndeleted: true\nid: 20261101-000002-gone\n---\n')
// 解析不了的：空文件
writeFileSync(join(notesDir, '20261101-000003-empty.md'), '')
// 索引坏了：只有幽灵 id，没有甲乙
writeFileSync(idxPath, JSON.stringify({ version: 1, notes: [{ id: '20200101-000000-ghost', title: '幽灵' }] }, null, 2))
const idxBefore = readFileSync(idxPath, 'utf8')
const filesBefore = readdirSync(notesDir).sort().join(',')

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
await new Promise((r) => setTimeout(r, 250))

const T = (n) => tools.find((t) => t.name === n)
let fails = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('PASS ' + label)
  else { fails++; console.log('FAIL ' + label + (extra ? ' → ' + extra : '')) }
}

const tool = T('memory_index_check')
ok(!!tool, '工具注册上了')

// 1. 只查：报告里三样都有，且没动文件
const dry = await tool.execute({})
ok(/解析不了 1/.test(dry), '空文件算「解析不了」', dry.split('\n')[1])
ok(/20261101-000003-empty\.md/.test(dry), '解析不了的文件被点名', dry)
ok(/索引指向不存在的笔记 1/.test(dry), '幽灵 id 被报出来', dry)
ok(/笔记没进索引 2/.test(dry), '没进索引的笔记被报出来', dry)
ok(readFileSync(idxPath, 'utf8') === idxBefore, '默认不写索引')
ok(readdirSync(notesDir).sort().join(',') === filesBefore, '默认不动 notes/')

// 2. rebuild：先备份、再重建，墓碑不复活，笔记不删
const rb = await tool.execute({ rebuild: true })
ok(/已重建：2 条/.test(rb), '重建后 2 条（墓碑不算）', rb)
const idxNow = JSON.parse(readFileSync(idxPath, 'utf8'))
ok(idxNow.notes.length === 2, '索引里 2 条', String(idxNow.notes.length))
ok(!idxNow.notes.some((n) => n.id.includes('ghost')), '幽灵被清掉')
ok(!idxNow.notes.some((n) => n.id.includes('gone')), '墓碑没复活')
const baks = readdirSync(join(home, 'memory')).filter((f) => f.startsWith('index.json.check-') && f.endsWith('.bak'))
ok(baks.length === 1, '留了一份检查备份', baks.join(','))
ok(readFileSync(join(home, 'memory', baks[0]), 'utf8') === idxBefore, '备份内容是原索引')
ok(readdirSync(notesDir).sort().join(',') === filesBefore, '笔记文件一个没删')

// 3. 修好之后再查一次：应该干净
const again = await tool.execute({})
ok(/索引指向不存在的笔记 0 条/.test(again) && /笔记没进索引 0 条/.test(again), '再查一次是干净的', again)

console.log(fails ? '✗ 失败 ' + fails + ' 项' : '★ 全过（qa-index-check）')
process.exit(fails ? 1 : 0)
