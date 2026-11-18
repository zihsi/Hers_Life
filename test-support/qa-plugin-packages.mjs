import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const entries = await readdir(root, { withFileTypes: true })
const packages = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('dsh-ming-'))
const failures = []
const exists = async (file) => { try { await access(file); return true } catch { return false } }

function covered(relative, files) {
  return files.some((raw) => {
    const item = String(raw).replace(/^\.\//, '').replace(/\/$/, '')
    if (item === relative || relative.startsWith(item + '/')) return true
    if (!item.includes('*')) return false
    const escaped = item.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    return new RegExp('^' + escaped + '$').test(relative)
  })
}

async function resolveImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = path.extname(base)
    ? [base]
    : [base, base + '.js', base + '.mjs', base + '.cjs', base + '.json', path.join(base, 'index.js'), path.join(base, 'index.mjs')]
  for (const candidate of candidates) if (await exists(candidate)) return candidate
  return null
}

for (const entry of packages) {
  const packageRoot = path.join(root, entry.name)
  const manifestPath = path.join(packageRoot, 'package.json')
  if (!(await exists(manifestPath))) continue
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const files = Array.isArray(manifest.files) ? manifest.files : null
  const requireIncluded = (relative, reason) => {
    if (files && !covered(relative, files)) failures.push(entry.name + ': files 白名單漏掉 ' + relative + '（' + reason + '）')
  }

  const patch = String(manifest.dsh?.bundle?.patch || '').replace(/^\.\//, '')
  if (patch) {
    if (!(await exists(path.join(packageRoot, patch)))) failures.push(entry.name + ': DSH patch 不存在：' + patch)
    requireIncluded(patch, 'dsh.bundle.patch')
  }
  if (manifest.dsh?.client) {
    if (!(await exists(path.join(packageRoot, 'client.js')))) failures.push(entry.name + ': 宣告 DSH client 但缺少 client.js')
    requireIncluded('client.js', 'dsh.client')
  }

  const main = String(manifest.main || 'index.js').replace(/^\.\//, '')
  const mainFile = path.resolve(packageRoot, main)
  if (!(await exists(mainFile))) {
    failures.push(entry.name + ': main 入口不存在：' + main)
    continue
  }
  requireIncluded(main, 'main')
  const seen = new Set()
  const queue = [mainFile]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const relative = path.relative(packageRoot, file).split(path.sep).join('/')
    if (relative.startsWith('../') || path.isAbsolute(relative)) {
      failures.push(entry.name + ': 相依檔案逃出套件目錄：' + relative)
      continue
    }
    requireIncluded(relative, '本地 import')
    const source = await readFile(file, 'utf8')
    const specs = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]((?:\.{1,2})\/[^'"]+)['"]/g)].map((match) => match[1])
    for (const specifier of specs) {
      const target = await resolveImport(file, specifier)
      if (!target) {
        failures.push(entry.name + ': 找不到本地 import ' + specifier + '（來源 ' + relative + '）')
        continue
      }
      queue.push(target)
    }
  }
  console.log('PASS package ' + entry.name + ' (' + seen.size + ' 個入口相依檔)')
}

const mirrors = [
  ['dsh-ming-memory/lib/model.mjs', 'dsh-ming-graph/lib/memory-model.mjs'],
  ['dsh-ming-memory/lib/neuron.mjs', 'dsh-ming-graph/lib/memory-neuron.mjs'],
]
for (const [canonical, bundled] of mirrors) {
  const [a, b] = await Promise.all([
    readFile(path.join(root, canonical), 'utf8'),
    readFile(path.join(root, bundled), 'utf8'),
  ])
  if (a !== b) failures.push('Graph 內嵌副本與來源不同步：' + bundled + ' <- ' + canonical)
}
if (failures.length) {
  for (const failure of failures) console.error('FAIL package ' + failure)
  process.exitCode = 1
} else {
  console.log('PASS package manifests, DSH patches, local imports and Graph source mirrors')
}
