#!/usr/bin/env node
// scripts/check.mjs —— 统一检查入口（交接书 L-1 / L-3 的最小版）
//
// 为什么用显式清单而不是扫 *.mjs：这个仓库里既有测试脚本，也有会读真实记忆、
// 会操作桌面或连接真实账号的运维脚本。扫一遍全跑等于把工具当测试。
//
// 用法：
//   node scripts/check.mjs --list
//   node scripts/check.mjs --suite offline
//   node scripts/check.mjs --suite build
//   node scripts/check.mjs --suite all --only=rag
//   node scripts/check.mjs --suite offline --json=live/check-report.json
//
// 判定：PASS / FAIL / SKIP（带原因）。有任何 FAIL 退出码 1；SKIP 不算通过。
// 环境：MING_ROOT 默认取本文件上一级；不读 .env、不碰真实账号、不连外网（除宿主包自检）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeWorkspace, workspaceEnv, cleanupWorkspace } from '../test-support/workspace.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.MING_ROOT ? path.resolve(process.env.MING_ROOT) : path.resolve(here, '..')
const argv = process.argv.slice(2)
const flag = (k, d = '') => {
  const a = argv.find((x) => x.startsWith('--' + k + '='))
  if (a) return a.slice(k.length + 3)
  const i = argv.indexOf('--' + k)          // 也认 --suite build 这种空格写法
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return d
}
const has = (k) => argv.includes('--' + k)

// 分类口径（对齐交接书 L.2）：
//   offline      纯逻辑 / 合成数据 / 假网络，默认跑
//   build        生成物 vs 源码，改了源才需要
//   windows-live 需要 Windows PS 5.1 / 桌宠 / 扩展 / 账号，只能人工
const CHECKS = [
  { id: 'test-support/workspace', suite: 'offline', cwd: '.', cmd: ['node', 'test-support/qa-test-support.mjs'], why: 'L-2 合成工作区：形状可预测、删得掉' },
  { id: 'test-support/runner', suite: 'offline', cwd: '.', cmd: ['node', 'test-support/qa-runner.mjs'], why: 'L-T2/T3/T4 runner 自己不撒谎：失败非零、SKIP 有原因、拼错报错' },
  { id: 'test-support/portability', suite: 'offline', cwd: '.', cmd: ['node', 'test-support/qa-portability.mjs'], why: 'F-T1/T2/T4/T5 构建不看当前目录、MING_ROOT 指错就失败' },
  { id: 'bilibili/account', suite: 'offline', cwd: 'dsh-ming-bilibili-account', cmd: ['node', 'qa-account.mjs'], why: 'G 一个账号一个权威：退出三层一起清、tombstone 防复活、迟到响应丢弃' },
  { id: 'bilibili/provider-swap', suite: 'offline', cwd: 'dsh-ming-bilibili-account', cmd: ['node', 'qa-provider-holder.mjs'], why: 'G.5 登录后不重启就生效：proxy 转发 + swap 换真身' },
  { id: 'bilibili/entry-account', suite: 'offline', cwd: 'dsh-ming-bilibili-account', cmd: ['node', 'qa-entry.mjs'], why: 'G 真实入口：恢复要校验、tombstone 优先、退出的迟到结果不许写回（核查 R01）' },
  { id: 'rag/eval', suite: 'offline', cwd: '.', cmd: ['node', 'test-support/rag-eval.mjs'], why: 'J-4 合成语料 30 题评测：Hit@1/3/5、MRR、同文跨层、来源不串' },
  { id: 'rag/index', suite: 'offline', cwd: '.', cmd: ['node', 'test-support/qa-rag-index.mjs'], why: 'J-6 代际快照/校验/回退：坏索引不许发布，当前代永远不删' },
  { id: 'inject/report', suite: 'offline', cwd: '.', cmd: ['node', 'test-support/qa-inject-report.mjs'], why: 'K-2 组装值 vs 实际请求并列：账本缺失如实报，不拿字符推 token' },
  { id: 'webpick/recv', suite: 'offline', cwd: '.', cmd: ['node', 'test-support/qa-webpick.mjs'], why: 'I 浏览器取文：配对 token、requestId 落盘、忙状态不覆盖、怪 id 不穿越' },
  { id: 'extension/files', suite: 'offline', cwd: '.', cmd: ['node', 'test-support/qa-extension-files.mjs'], why: 'I-2 扩展交付：manifest 引用的文件都在仓库里，设置页元素齐（核查 R03）' },
  { id: 'browse/permissions', suite: 'offline', cwd: 'dsh-ming-browse', cmd: ['node', 'qa-permissions.mjs'], why: 'H-3 执行前检查：默认 LEGACY 不变、只浏览按类别拒' },
  { id: 'core-memory/rag-availability', suite: 'offline', cwd: 'dsh-ming-core-memory', cmd: ['node', 'qa-rag-availability.mjs'], why: 'J-1 来源标签与三态（PR#5 语义不许退化）' },
  { id: 'core-memory/rag-manifest', suite: 'offline', cwd: 'dsh-ming-core-memory', cmd: ['node', 'qa-rag-manifest.mjs'], why: 'J-2 索引清单：旧格式照读、清单不符就报、不混向量空间' },
  { id: 'core-memory/rag-generation', suite: 'offline', cwd: 'dsh-ming-core-memory', cmd: ['node', 'qa-rag-generation.mjs'], why: 'J-1 读端认指针：一代四个文件一起读，代不完整就退回 live（核查 R09）' },
  { id: 'core-memory/status', suite: 'offline', cwd: 'dsh-ming-core-memory', cmd: ['node', 'qa-status.mjs'], why: '记忆状态与截断' },
  { id: 'core-memory/tools', suite: 'offline', cwd: 'dsh-ming-core-memory', cmd: ['node', 'qa-tools.mjs'], why: '工具注册与返回形状' },
  { id: 'core-memory/index-check', suite: 'offline', cwd: 'dsh-ming-core-memory', cmd: ['node', 'qa-index-check.mjs'], why: '索引体检/重建预览（a7533f1 新增）' },
  { id: 'core-memory/recovery', suite: 'offline', cwd: 'dsh-ming-core-memory', cmd: ['node', 'qa-recovery.mjs'], why: 'PR#2 从笔记恢复索引' },
  // 这一套要一个人设+日记的**数据工作区**才能跑（qa-diary-budget 会 readdir root/diary）。
  // 不拿真实工作区，现场造一个最小的（L-2 的第一小块）。
  // 这两条是 PR#6 的语义（日记预算、配置预算），纯合成工作区就能判。
  { id: 'memory/diary-budget', suite: 'offline', cwd: 'dsh-ming-memory', cmd: ['node', 'qa-diary-budget.mjs'], why: 'PR#6 日记字数预算真的生效', fixture: 'workspace' },
  { id: 'memory/config-budget', suite: 'offline', cwd: 'dsh-ming-memory', cmd: ['node', 'qa-config-budget.mjs'], why: '配置改动进缓存键', fixture: 'workspace' },
  { id: 'memory/inject-account', suite: 'offline', cwd: 'dsh-ming-memory', cmd: ['node', 'qa-inject-account.mjs'], why: 'K-1 旁路统计：分块相加等于总长、省掉的只报篇数', fixture: 'workspace' },
  // qa-all 里 qa-smoke / qa-cache / qa-compact 断言的是**宿主注入的**「【时间感】」块——
  // 那是 DSH 吐给模型的，不是插件拼的；假 ctx 里永远没有。只能在真实宿主里跑，
  // 所以放 host 档，别拿它冒充离线通过。
  { id: 'memory/all', suite: 'host', cwd: 'dsh-ming-memory', cmd: ['node', 'qa-all.mjs'], why: '整套开场记忆（需真实宿主注入的时间感块）', fixture: 'workspace', manual: true },
  { id: 'bilibili/load', suite: 'offline', cwd: 'dsh-ming-bilibili-account', cmd: ['node', 'qa-load.mjs'], why: 'PR#4 ESM 完整入口加载' },
  { id: 'browse/audit', suite: 'offline', cwd: 'dsh-ming-browse', cmd: ['node', 'qa-audit.mjs'], why: '自己玩：配置/护栏审计' },
  { id: 'activities/qa', suite: 'offline', cwd: 'dsh-ming-activities', cmd: ['node', 'qa-activities.mjs'], why: 'PR#8 共同活动插件' },
  { id: 'build/graph', suite: 'build', cwd: 'dsh-ming-graph', cmd: ['node', 'build.mjs', '--check'], why: 'F-1 构建根与生成物是否最新' },
  { id: 'build/memory', suite: 'build', cwd: 'dsh-ming-memory', cmd: ['node', 'build.mjs', '--check'], why: 'Memory client.js 是否与共用主题及面板源码一致' },
  { id: 'fixture/always-fail', suite: 'fixture', cwd: '.', cmd: ['node', 'test-support/qa-fixture-fail.mjs'], why: 'L-T2 专用：故意失败，验证 runner 返回非零' },
  {
    id: 'windows/sidecar-parse', suite: 'windows-live', cwd: 'dsh-ming-mousepet',
    cmd: ['powershell', '-NoProfile', '-Command', "$null=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'sidecar.ps1'), [ref]$null, [ref]$errs); if ($errs) { $errs | % { $_.Message }; exit 1 } else { 'PARSE_OK' }"],
    why: 'I-1 改 sidecar 后必须用 PS 5.1 解析（BOM+CRLF 不能丢）', manual: true,
  },
]

const suite = flag('suite', 'offline')
const only = flag('only', '')
const jsonOut = flag('json', '')
const list = CHECKS
  // The fixture suite intentionally exits non-zero; run it explicitly when testing the runner.
  // Keep it out of `all` so a full real check can still have a green result.
  .filter((c) => (suite === 'all' ? c.suite !== 'fixture' : c.suite === suite))
  .filter((c) => (only ? c.id.includes(only) : true))

if (has('list') || !list.length) {
  console.log('可用检查（suite / id / 说明）：')
  for (const c of CHECKS) console.log('  ' + c.suite.padEnd(12) + ' ' + c.id.padEnd(28) + ' ' + c.why)
  if (!list.length) { console.error('\n没有匹配的检查：suite=' + suite + (only ? ' only=' + only : '')); process.exit(2) }
  process.exit(0)
}

// 合成工作区在 test-support/workspace.mjs（L-2）；这里不再各存一份。

const results = []
console.log('检查 ' + list.length + ' 项（suite=' + suite + (only ? ', only=' + only : '') + '，根 ' + ROOT + '）\n')
for (const c of list) {
  const cwd = path.join(ROOT, c.cwd)
  const t0 = Date.now()
  if (!fs.existsSync(cwd)) {
    results.push({ id: c.id, status: 'SKIP', ms: 0, reason: '目录不存在：' + cwd })
    console.log('SKIP  ' + c.id + '  — 目录不存在'); continue
  }
  if (c.manual && process.env.MING_RUN_MANUAL !== '1') {
    results.push({ id: c.id, status: 'SKIP', ms: 0, reason: '人工项，设 MING_RUN_MANUAL=1 才跑' })
    console.log('SKIP  ' + c.id + '  — 人工项（MING_RUN_MANUAL=1 才跑）'); continue
  }
  let env = { ...process.env, MING_ROOT: ROOT }
  let fixtureWs = null
  if (c.fixture === 'workspace') {
    fixtureWs = makeWorkspace()
    env = workspaceEnv(env, fixtureWs)
  }
  const r = spawnSync(c.cmd[0], c.cmd.slice(1), { cwd, encoding: 'utf8', timeout: 180000, env })
  cleanupWorkspace(fixtureWs)
  const ms = Date.now() - t0
  const out = ((r.stdout || '') + (r.stderr || '')).trim()
  const ok = r.status === 0
  results.push({ id: c.id, status: ok ? 'PASS' : 'FAIL', ms, exit: r.status, tail: out.split('\n').slice(-6).join('\n') })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + c.id + '  (' + ms + 'ms)')
  if (!ok) console.log(out.split('\n').slice(-12).map((l) => '      ' + l).join('\n'))
}

const pass = results.filter((r) => r.status === 'PASS').length
const fail = results.filter((r) => r.status === 'FAIL').length
const skip = results.filter((r) => r.status === 'SKIP').length
console.log('\n合计 PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + '（SKIP 不计入通过）')
if (jsonOut) {
  const p = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ at: new Date().toISOString(), suite, only, root: ROOT, results }, null, 2))
  console.log('报告：' + p)
}
process.exit(fail ? 1 : 0)