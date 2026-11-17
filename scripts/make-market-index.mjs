#!/usr/bin/env node
/**
 * make-market-index.mjs —— 生成插件市场索引（format 1），每个插件钉到同一个 commit。
 *
 * 为什么走 git 源而不是 npm（2026-11-17 她定的「走 2」）：
 *   我们的包都是 "private": true，发 npm 要多一条发布链；市场索引本身支持 git 源
 *   （type:git + url + commit + path），换版本只需要把 commit 推一格。
 *   所以每次发版跑一遍这个脚本、把 market/index.json 提交上去就行。
 *
 * 用法：
 *   node scripts/make-market-index.mjs                     # 钉 HEAD
 *   node scripts/make-market-index.mjs --ref=v1.2.1        # 钉某个 tag 对应的 commit
 *   node scripts/make-market-index.mjs --validator="C:/.../node_modules"   # 顺手用官方校验器验一遍
 *
 * 校验器来自宿主的 @deepseek-ai/dsh-plugin-market-index（format 1 的规则集）。
 * 拿不到就跳过校验并明说——不假装验过。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const opt = (key, fallback = '') => {
  const hit = argv.find((x) => x.startsWith('--' + key + '='))
  return hit ? hit.slice(key.length + 3) : fallback
}
const ref = opt('ref', 'HEAD')
const outFile = path.resolve(ROOT, opt('out', 'market/index.json'))
const validatorDir = opt('validator', '')
const REPO_URL = 'https://github.com/zihsi/Hers_Life'
const REPO_DIR = 'https://github.com/zihsi/Hers_Life'

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
// 2026-11-17（核查 4.5-4）：`rev-parse v1.2.2` 对**附注标签**返回的是 tag 对象，不是提交。
// tag 对象不能直接拿去 checkout / 浅克隆，市场装到那个 SHA 上会失败。
// 统一解到提交：`<ref>^{commit}`。轻量标签行为不变。
const commit = git('rev-parse', ref + '^{commit}')
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('不是一个完整 commit：' + ref + ' -> ' + commit)
const stamp = Number(git('log', '-1', '--format=%ct', commit))

/** 只有声明了 dsh.bundle 的包才装得上，别的（纯库）不进市场。 */
const plugins = []
for (const dir of readdirSync(ROOT).filter((d) => d.startsWith('dsh-ming-')).sort()) {
  const pkgFile = path.join(ROOT, dir, 'package.json')
  if (!existsSync(pkgFile)) continue
  let pkg
  try { pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) } catch { continue }
  if (!pkg.name || !pkg.version || !(pkg.dsh && pkg.dsh.bundle)) continue
  const entry = {
    name: pkg.name,
    title: pkg.name,
    description: pkg.description || pkg.name,
    author: 'zihsi',
    homepage: REPO_DIR,
    repository: { url: REPO_URL, directory: dir },
    versions: [{
      version: pkg.version,
      publishTimestamp: stamp,
      source: { type: 'git', url: REPO_URL, commit, path: dir },
      engines: { dsh: '>=0.2.0' },
    }],
  }
  plugins.push(entry)
}
if (plugins.length === 0) throw new Error('一个可上架的包都没找到（缺 dsh.bundle？）')

const index = {
  format: 1,
  title: 'Hers Life 插件',
  description: '溟自己写、自己用的 DSH 插件集：记忆、闲逛、桌面陪伴、语音、兴趣唤醒等。',
  plugins,
}

// ---- 校验（拿不到校验器就跳过，并明说）----
let validated = ''
if (validatorDir) {
  try {
    const mod = await import(pathToFileURL(path.join(validatorDir, '@deepseek-ai/dsh-plugin-market-index/lib/index.js')).href)
    const parsed = mod.parseMarketIndex(index, 'https://example.invalid/market/index.json')
    validated = '通过（format 1，' + parsed.plugins.length + ' 个插件，各自 ' + parsed.plugins[0].versions.length + ' 个版本）'
  } catch (error) {
    console.error('校验没过：' + String(error && error.message || error))
    process.exit(1)
  }
} else {
  validated = '跳过（没给 --validator）'
}

mkdirSync(path.dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(index, null, 2) + '\n', 'utf8')
console.log('写了 ' + path.relative(ROOT, outFile) + ' @ ' + commit.slice(0, 7) + '（' + plugins.length + ' 个插件）')
console.log('校验：' + validated)
for (const p of plugins) console.log('  - ' + p.name + ' ' + p.versions[0].version + '  path:/' + p.repository.directory)
