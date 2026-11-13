/**
 * build.mjs —— 把壳和四块面板组装成 client.js
 *
 * ## 单源（2026-11-08 重整）
 *
 * | 内容 | 唯一的源 |
 * |---|---|
 * | 主题 | `C:/dsh/dsh-ming-ui/src/theme.js` |
 * | 兴趣 | `C:/dsh/dsh-ming-interest/src/panel.js` |
 * | 声音 | `C:/dsh/dsh-ming-voice/src/panel.js` |
 * | 自己玩 | `C:/dsh/dsh-ming-browse/src/panel.js` |
 * | 壳自己的 extras（接续等） | `src/panels.js` |
 * | 神经元 / 星图 / 主面板 | `src/neuron-view.js`、`src/star-view.js`、`src/panel.js` |
 *
 * 以前这些面板在 `src/panels.js` 里还留着一份**拷贝**，靠 `dsh-ming-ui/sync-panels.mjs` 手工往回推。
 * 那天改了七八次界面都不动，就是因为改的是源、跑的是拷贝。现在 build 直接从各插件的源里切——
 * **拷贝没有了，就没有会漂的地方**。
 *
 * ## 三道门（都为同一个毛病：改完了，跑的不是这份）
 *
 * 1. **切得到**：每个单元的起止标记必须在源文件里找得到，找不到就中止（不再静默少一块）。
 * 2. **拼得起来**：拼完的工厂里不许出现 `import` / `export` / `require(`；
 *    `const/let/class` 顶层重名就中止（两个面板各写一个同名常量，语法合法，行为是后者吃掉前者）。
 * 3. **是最新的**：`--check` 拿源算一遍 sha256，和 client.js 里记的那个比。
 *    改了源不 build = 页面永远跑旧代码，而这个从外面完全看不出来。
 *
 * 用法：
 *   node build.mjs           # 写 client.js + build.json
 *   node build.mjs --check   # 只核对是否最新（过期退出码 1），不写盘
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const OUT = path.join(here, 'client.js')
const META = path.join(here, 'build.json')
const checkOnly = process.argv.includes('--check')

const errors = []
const notes = []

function read(abs, why) {
  if (!fs.existsSync(abs)) {
    errors.push('找不到' + why + '：' + abs)
    return ''
  }
  return fs.readFileSync(abs, 'utf8')
}

/** 从 text 里切 [from, to) —— from 那行起，到 to 那行前止；to 为 null 表示切到文件末尾。 */
function cut(text, from, to, label) {
  const i = text.indexOf(from)
  if (i < 0) {
    errors.push(label + '：源里找不到起点 `' + from + '`')
    return ''
  }
  if (!to) return text.slice(i)
  const j = text.indexOf(to, i + from.length)
  if (j < 0) {
    errors.push(label + '：源里找不到终点 `' + to + '`')
    return ''
  }
  return text.slice(i, j)
}

// 边界用「函数声明」而不是行号：源里插一行注释不会把切点弄错。
// 三个面板的源都写到文件末尾（最后一个是各自的 Icon），所以 to 给 null。
const PANELS = [
  { name: '兴趣', file: path.join(ROOT, 'dsh-ming-interest/src/panel.js'), from: 'const INTEREST_API' },
  { name: 'Discord', file: path.join(ROOT, 'dsh-ming-discord/src/panel.js'), from: 'const DISCORD_API' },
  { name: '声音', file: path.join(ROOT, 'dsh-ming-voice/src/panel.js'), from: 'const VOICE_API' },
  { name: '自己玩', file: path.join(ROOT, 'dsh-ming-browse/src/panel.js'), from: 'const BROWSE_API' },
]

const parts = []
const push = (label, abs, text) => parts.push({ label, path: abs, text })

// 主题：读唯一源，不再往插件里抄
const THEME = path.join(ROOT, 'dsh-ming-ui/src/theme.js')
push('主题', THEME, read(THEME, '主题源'))

// 壳自己的两块渲染层（顺序照旧：渲染层在前，面板在后）
for (const [label, rel] of [['神经元', 'src/neuron-view.js'], ['星图', 'src/star-view.js']]) {
  push(label, path.join(here, rel), read(path.join(here, rel), label + '（' + rel + '）'))
}

// 三块面板：各自插件的 src/panel.js 就是源
for (const p of PANELS) {
  const text = read(p.file, p.name + '面板源')
  if (!text) continue
  const body = cut(text, p.from, p.to, p.name)
  if (body) push(p.name, p.file, body)
}

// 壳自己的 extras（接续面板等，没有独立插件的写这里）
const EXTRA = path.join(here, 'src/panels.js')
push('壳 extras', EXTRA, read(EXTRA, '壳 extras（src/panels.js）'))

// 主面板最后（它引用上面所有 Panel）
// 2026-11-09：主面板按页拆了（原来 1459 行 / 79 KB 一个文件，改一处要滚半天）。
// 顺序不能乱 —— common 里的 const 先定义，后面几片才用得上；拼起来跟拆之前逐字相同。
for (const [label, rel] of [
  ['主面板·公共', 'src/panels/common.js'],
  ['主面板·记忆', 'src/panels/memory.js'],
  ['主面板·费用技能', 'src/panels/cost.js'],
  ['主面板·桌宠', 'src/panels/pet.js'],
]) {
  push(label, path.join(here, rel), read(path.join(here, rel), label + '（' + rel + '）'))
}
push('主面板', path.join(here, 'src/panel.js'), read(path.join(here, 'src/panel.js'), '主面板（src/panel.js）'))

if (errors.length) {
  for (const e of errors) console.error('✗ ' + e)
  console.error('\nbuild 中止：缺文件或切点失效。')
  process.exit(1)
}

// —— 门 2：拼得起来吗 ————————————————————————————————
const merged = parts.map((p) => p.text).join('\n\n')

// 扫描前把注释剥掉：注释里提到 require( 是说明文字，不是代码。
// （只用于扫描，不影响产物；`//` 前面不是冒号，免得把 https:// 也吃掉。）
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

for (const p of parts) {
  const code = stripComments(p.text)
  const bad = []
  if (/^\s*import\s/m.test(code)) bad.push('import')
  if (/^\s*export\s/m.test(code)) bad.push('export')
  if (/\brequire\s*\(/.test(code)) bad.push('require(')
  if (bad.length) errors.push(p.label + ' 里出现了 ' + bad.join(' / ') + '（' + p.path + '）——工厂里只能是纯代码')
}

// 顶层同名声明：const/let/class 重名是硬错，function 重名是软警告（后者吃掉前者）
const owners = new Map()
for (const p of parts) {
  const re = /^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = re.exec(p.text))) {
    if (owners.has(m[1])) errors.push('顶层重名：`' + m[1] + '` 在「' + owners.get(m[1]) + '」和「' + p.label + '」里各声明了一次')
    else owners.set(m[1], p.label)
  }
}

const seenFn = new Map()
for (const p of parts) {
  const reFn = /^function\s+([A-Za-z_$][\w$]*)/gm
  let m
  while ((m = reFn.exec(p.text))) {
    if (seenFn.has(m[1])) notes.push('function `' + m[1] + '` 定义了两次（' + seenFn.get(m[1]) + ' / ' + p.label + '，后者生效）')
    else seenFn.set(m[1], p.label)
  }
}

if (errors.length) {
  for (const e of errors) console.error('✗ ' + e)
  console.error('\nbuild 中止：拼起来之后会坏。')
  process.exit(1)
}

// —— 门 3：这一版对应哪一版源 ————————————————————————
const hash = crypto.createHash('sha256')
for (const p of parts) hash.update(p.label + '\0' + p.text + '\0')
const digest = hash.digest('hex').slice(0, 16)

const banner = `/**
 * dsh-ming-graph —— 记忆关系图 / 记忆神经元（Client 半端）
 *
 * ⚠ 生成物，别手改：改 src/*.js 或各插件的 src/panel.js，然后 \`node build.mjs\`。
 *   现在是不是最新的：\`node build.mjs --check\`
 *   build ${digest}
 *
 * 入口：左侧图标栏一个图标（sidebar.panellist），点开占满主区域（main 面板 key = ming-graph）。
 * 数据来自 Host 半端 /_dsh/dsh-ming-graph/neurons，自己拉、自己画，不经过模型。
 *
 * 一条规矩：每个点都是记忆库里一条真记忆，每条边都带 why（引用 / 共词 / 归属 / 补边四种之一）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-ming-graph',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

`

const out = banner + merged + '\n  },\n})\n'

// —— --check：只比 hash，不写盘 ————————————————————————
if (checkOnly) {
  if (!fs.existsSync(OUT)) {
    console.error('✗ client.js 不存在，先 node build.mjs')
    process.exit(1)
  }
  const current = fs.readFileSync(OUT, 'utf8')
  const stamped = (current.match(/build ([0-9a-f]{16})/) || [])[1]
  if (stamped !== digest) {
    console.error('✗ client.js 是旧的：源现在算出来 ' + digest + '，client.js 里记的是 ' + (stamped || '（没有戳）'))
    console.error('  改了源没 build = 页面一直跑旧代码。跑 node build.mjs')
    process.exit(1)
  }
  console.log('✓ client.js 是最新的（build ' + digest + '，' + parts.length + ' 个单元）')
  for (const n of notes) console.log('  ⚠ ' + n)
  process.exit(0)
}

fs.writeFileSync(OUT, out, 'utf8')

// 语法门：拼出来的东西得能被 node 解析
const syntax = spawnSync(process.execPath, ['--check', OUT], { encoding: 'utf8' })
if (syntax.status !== 0) {
  console.error('✗ client.js 语法检查不过：')
  console.error((syntax.stderr || '').split('\n').slice(0, 12).join('\n'))
  process.exit(1)
}

fs.writeFileSync(META, JSON.stringify({
  hash: digest,
  at: new Date().toISOString(),
  bytes: out.length,
  units: parts.map((p) => ({ label: p.label, path: path.relative(ROOT, p.path).replace(/\\/g, '/'), chars: p.text.length })),
}, null, 2) + '\n', 'utf8')

console.log('✓ client.js 写好：' + out.length + ' 字节，' + parts.length + ' 个单元，build ' + digest)
for (const p of parts) console.log('  · ' + p.label.padEnd(6, '　') + String(p.text.length).padStart(7) + ' 字  ' + p.path.replace(/\\/g, '/'))
for (const n of notes) console.log('  ⚠ ' + n)
