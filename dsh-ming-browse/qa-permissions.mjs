#!/usr/bin/env node
// dsh-ming-browse/qa-permissions.mjs
//
// 2026-11-17 17:45 之后，这道闸**不拦任何东西**（她删掉了只浏览模式，也说花钱类放开）。
// 所以这里验的只有两件事：
//   ① 分类表还对（qa-audit 靠它挑危险词）
//   ② 任何 policy × 任何工具，判定都是放行 —— 包括花钱、写、执行、发消息、未分类
//
// 以前那一整套「默认只浏览、名单外只读、花钱仍拒」的断言随模式一起删了，
// 需要它们的话在 git 历史里（v1.2.1 及之前）。
import { check, classify, normalizePolicy, MODE, KIND } from './lib/permissions.mjs'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
}
const AUTO = { roundAgentId: 'a1', autonomousAgentId: 'a1' }

// --- 分类 ---
ok('bilibili_search → read', classify('bilibili_search') === KIND.READ)
ok('android_tap → android_action', classify('android_tap') === KIND.ANDROID_ACTION)
ok('android_shutdown → desktop', classify('android_shutdown') === KIND.DESKTOP)
ok('ops_bash → shell', classify('ops_bash') === KIND.SHELL)
ok('discord_send_file → send', classify('discord_send_file') === KIND.SEND)
ok('bilibili_comment_post → publish', classify('bilibili_comment_post') === KIND.PUBLISH)
ok('pay_checkout → pay', classify('pay_checkout') === KIND.PAY)
ok('认不出的工具 → unknown', classify('some_plugin_tool') === KIND.UNKNOWN)
ok('空工具名 → unknown', classify('') === KIND.UNKNOWN)

// --- 归一化：mode 只剩 legacy / editable，其余一律 editable ---
ok('未配置 → editable', normalizePolicy(undefined).mode === MODE.EDITABLE)
ok('空对象 → editable', normalizePolicy({}).mode === MODE.EDITABLE)
ok('写 legacy 保留 legacy', normalizePolicy({ mode: 'legacy' }).mode === MODE.LEGACY)
ok('写 readonly → editable（没有只浏览了）', normalizePolicy({ mode: 'readonly' }).mode === MODE.EDITABLE)
ok('旧配置写 browse_only → editable（字段还在，但不起作用）',
  normalizePolicy({ mode: 'browse_only' }).mode === MODE.EDITABLE)
ok('allow 只留认识的类别', JSON.stringify(normalizePolicy({ allow: ['shell', 'nonsense', 3] }).allow) === JSON.stringify(['shell']))
ok('subjects 数组照收', Object.keys(normalizePolicy({ subjects: ['a', ' b '] }).subjects).sort().join(',') === 'a,b')

// --- 核心：一律放行 ---
const TOOLS = [
  'bilibili_search', 'read_image', 'memory_search',      // read
  'android_tap', 'android_screenshot',                    // android_action
  'ops_bash', 'ops_load_sdk',                             // shell
  'discord_send_file', 'live_speak', 'voice_say',         // send
  'bilibili_comment_post',                                // publish
  'pay_checkout', 'purchase_vip',                         // pay ← 也说放开了
  'some_plugin_tool', '',                                 // unknown
  'run_code',                                             // 容器
]
const POLICIES = [
  undefined,
  {},
  { mode: 'legacy' },
  { mode: 'editable' },
  { mode: 'browse_only' },                 // 旧配置，现在也不拦
  { mode: 'browse_only', subjects: [] },
  { allow: [] },
]
for (const pol of POLICIES) {
  const label = JSON.stringify(pol) || String(pol)
  const blocked = TOOLS.filter((t) => check(pol, { tool: t, ...AUTO }).ok !== true)
  ok('全部放行 ' + label, blocked.length === 0, '被拦：' + blocked.join(','))
}

// --- 返回值形状没坏（index.js 的 pre-execute 要读 ok / reason / skipped） ---
{
  const r = check(undefined, { tool: 'ops_bash', ...AUTO })
  ok('返回 ok=true', r.ok === true)
  ok('reason 是空串', r.reason === '')
  ok('skipped 说明是按哪一类放行的', /no-gate:/.test(String(r.skipped)))
}
{
  const r = check(undefined, { tool: 'pay_checkout', ...AUTO })
  ok('花钱类也不再拦', r.ok === true)
  ok('花钱类的 skipped 标出类别', String(r.skipped).includes('pay'))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
