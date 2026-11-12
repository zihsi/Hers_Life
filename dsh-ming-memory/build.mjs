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
const read = (p) => fs.readFile(path.join(here, p), 'utf8')

const THEME_SRC = path.resolve(here, '../dsh-ming-ui/src/theme.js')
const theme = await fs.readFile(THEME_SRC, 'utf8')
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
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'ming-memory',
        }, MemoryPanel))
        // 2026-11-07 18:5x：侧栏图标撤了——四个面板统一进「她的一生」（dsh-ming-graph）的 tab 里。
      },
    }
  },
})
`

await fs.writeFile(path.join(here, 'client.js'), out, 'utf8')
console.log('client.js', out.length, 'bytes')
