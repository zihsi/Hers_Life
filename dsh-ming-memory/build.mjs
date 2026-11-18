/**
 * build.mjs —— 把主题 + src/panel.js 拼成 client.js
 *
 * client.js 是生成物，别手改。拼法照 dsh-ming-graph：一个 __ModuleLoader__ 工厂，
 * 把共用皮（theme）和面板塞进去，最后导出 Cordis 的 { inject, apply }。
 *
 * 2026-11-08：主题改成**直接读唯一源** `C:/dsh/dsh-ming-ui/src/theme.js`，
 * 不再从 src/theme.js 那份拷贝读。拷贝没了，dsh-ming-ui/sync.mjs 也就没活儿干了。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = async (p) => (await fs.readFile(path.join(here, p), 'utf8')).replace(/\r\n/g, '\n')

// 2026-11-17（F-1）：不再写死作者机器上的 C:/dsh。MING_ROOT 指源码仓库根；
// 没设就取本脚本的上一级目录（build.mjs 在 <root>/dsh-ming-memory/ 里）。
const MING_ROOT = process.env.MING_ROOT
  ? path.resolve(process.env.MING_ROOT)
  : path.resolve(here, '..')
const THEME_SRC = path.join(MING_ROOT, 'dsh-ming-ui', 'src', 'theme.js')
const theme = (await fs.readFile(THEME_SRC, 'utf8')).replace(/\r\n/g, '\n')
const panel = await read('src/panel.js')

const out = `/**
 * dsh-ming-memory —— 记忆库面板（Client 半端）
 *
 * ⚠ 生成物：改 src/panel.js 或 ../dsh-ming-ui/src/theme.js，然后 node build.mjs
 *
 * 入口：左侧图标栏一个图标（sidebar.panellist → 记忆），点开占满主区域（main key = ming-memory）。
 * 数据来自 Host 半端 /_dsh/dsh-ming-memory/{list,read}，只读，不经过模型。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ming-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

${theme}

${panel}

    return {
      inject: ['slots'],
      apply(ctx) {
        // ★ 顺序有讲究（2026-11-10 第二次踩）：**先挂页签，再去 inject**。
        //   注入到一个已经撤掉的 slot（比如 sidebar 那个 main）会抛，一抛这个 apply 就断了——
        //   顶栏什么都没有，控制台却只有一行错。所以页签先加，inject 包 try。
        const desc = {
          id: 'ming-settings',
          label: '设置',
          order: 90,
          title: '身份与称呼：我叫什么、它怎么叫你、要不要带身份',
          render: IdentityPanel,
        }
        if (typeof window !== 'undefined') {
          const section = () => {
            try {
              ctx.slots.inject('settings.section', () => ctx.slots.register({
                name: 'settings.section', id: 'ming-identity', label: () => '身份与称呼', order: 44,
              }, IdentityPanel))
            } catch (e) { /* 没有设置位就算了 */ }
          }
          if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') {
            window.__MING_TAB_HOST.add(desc)
          } else {
            ;(window.__MING_TABS_PENDING || (window.__MING_TABS_PENDING = [])).push(desc)
            setTimeout(() => {
              if (window.__MING_TAB_HOST && typeof window.__MING_TAB_HOST.add === 'function') return
              const q = window.__MING_TABS_PENDING
              if (Array.isArray(q)) { const i = q.indexOf(desc); if (i >= 0) q.splice(i, 1) }
              section()
            }, 1500)
          }
        }

        try {
          ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: 'ming-memory',
          }, MemoryPanel))
        } catch (e) { /* 11-07 侧栏图标撤了之后这里可能没有 main 位——别让它把页签一起带下去 */ }
      },
    }
  },
})
`

const normalizedOut = out.replace(/\r\n/g, '\n')
const OUT = path.join(here, 'client.js')
if (process.argv.includes('--check')) {
  let current = ''
  try { current = (await fs.readFile(OUT, 'utf8')).replace(/\r\n/g, '\n') } catch { /* 缺少生成物也视为过期 */ }
  if (current !== normalizedOut) {
    console.error('✗ client.js 与 src／共用主题不一致；请执行 node build.mjs')
    process.exit(1)
  }
  console.log('✓ client.js 是最新的（' + out.length + ' bytes）')
} else {
  await fs.writeFile(OUT, normalizedOut, 'utf8')
  console.log('client.js', normalizedOut.length, 'bytes')
}
