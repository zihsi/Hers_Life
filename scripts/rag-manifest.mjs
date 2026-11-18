#!/usr/bin/env node
// scripts/rag-manifest.mjs —— 给已有的两层索引补清单（交接书 J-2 / J-3 的最小生成器）
//
// 为什么单独一个脚本：生成链在本机脚本里（doc-emb / chat-embed / qq-embed），不在公开仓库。
// 这个脚本只做「读现有产物 → 写清它是什么」，不重建索引、不碰源语料、不连嵌入服务。
//
// 用法：
//   node scripts/rag-manifest.mjs                 # 默认 Hers Life 工作区的 live 目录
//   node scripts/rag-manifest.mjs --dir=C:\dsh\hers_workplace\live
//   node scripts/rag-manifest.mjs --dry           # 只打印，不写文件
//   node scripts/rag-manifest.mjs --no-sha        # 跳过 sha256（大库省时间）
//
// 口径（写进清单，别撒谎）：
//   · model 来自 --model 或 Hers Life 设置页；**没有独立核实过**，所以 revision=unknown、
//     verified=false、modelSource 写明来源。
//   · dimensions 从文件推：byteLength / 4 / ids.length。除不尽就报错，不猜。
//   · 条数、映射关系对不上就退出码 1，不写半份清单。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const argv = process.argv.slice(2)
const flag = (k, d = '') => {
  const a = argv.find((x) => x.startsWith('--' + k + '='))
  if (a) return a.slice(k.length + 3)
  const i = argv.indexOf('--' + k)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
  return d
}
const has = (k) => argv.includes('--' + k)

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
let centralSettings = {}
try { centralSettings = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'hers-life.json'), 'utf8')) } catch {}
const workspace = String(centralSettings.workspace || process.env.MING_WORKSPACE || '')
const DIR = path.resolve(flag('dir') || path.join(workspace, 'live'))
const MODEL = flag('model') || (centralSettings.coreMemory && centralSettings.coreMemory.embeddingModel) || process.env.EMB_MODEL || 'bge-base-zh-v1.5-q8_0'
const DRY = has('dry')
const NO_SHA = has('no-sha')

const LAYERS = [
  { name: 'doc', emb: 'doc-emb.f32', ids: 'doc-emb-ids.json', corpus: null, manifest: 'doc-emb.manifest.json' },
  { name: 'web', emb: 'chat-emb.f32', ids: 'chat-emb-ids.json', corpus: 'chat-corpus.jsonl', manifest: 'chat-emb.manifest.json' },
]

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  })
}

async function fileEntry(file) {
  const st = fs.statSync(file)
  const e = { name: path.basename(file), size: st.size }
  if (!NO_SHA) e.sha256 = await sha256(file)
  return e
}

let bad = 0
const out = []

for (const layer of LAYERS) {
  const emb = path.join(DIR, layer.emb)
  const ids = path.join(DIR, layer.ids)
  const corpus = layer.corpus ? path.join(DIR, layer.corpus) : null
  const missing = [emb, ids, ...(corpus ? [corpus] : [])].filter((f) => !fs.existsSync(f))
  if (missing.length === [emb, ids, ...(corpus ? [corpus] : [])].length) {
    out.push({ layer: layer.name, status: 'skip', reason: '三个文件都不在（这一层没建）' })
    continue
  }
  if (missing.length) {
    out.push({ layer: layer.name, status: 'error', reason: '缺文件：' + missing.map((f) => path.basename(f)).join(', ') })
    bad++
    continue
  }

  const bytes = fs.statSync(emb).size
  let idsArr
  try { idsArr = JSON.parse(fs.readFileSync(ids, 'utf8')) } catch (e) {
    out.push({ layer: layer.name, status: 'error', reason: 'ids 不是合法 JSON：' + e.message }); bad++; continue
  }
  if (!Array.isArray(idsArr) || !idsArr.length) {
    out.push({ layer: layer.name, status: 'error', reason: 'ids 必须是非空数组' }); bad++; continue
  }
  const n = idsArr.length
  const dim = bytes / 4 / n
  if (!Number.isInteger(dim) || dim <= 0) {
    out.push({ layer: layer.name, status: 'error', reason: `维度推不出来：${bytes} 字节 / 4 / ${n} 条 = ${dim}` })
    bad++
    continue
  }

  const files = { vectors: await fileEntry(emb), ids: await fileEntry(ids) }
  if (corpus) files.corpus = await fileEntry(corpus)

  const manifest = {
    schemaVersion: 1,
    layer: layer.name,
    generation: 'local-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
    createdAt: new Date().toISOString(),
    embedding: {
      model: MODEL,
      revision: 'unknown',
      verified: false,
      modelSource: flag('model') ? 'command-line --model（未核实）' : 'Hers Life 设置页、环境变量 EMB_MODEL 或脚本默认值（未核实）',
      dimensions: dim,
      dtype: 'float32',
      byteOrder: 'little-endian',
      documentPrefix: '',
      queryPrefix: '（由查询端决定；本清单不背书）',
      normalization: 'l2（查询端做归一化）',
    },
    rowCount: n,
    files,
  }

  if (DRY) {
    out.push({ layer: layer.name, status: 'dry', path: path.join(DIR, layer.manifest), manifest })
  } else {
    const p = path.join(DIR, layer.manifest)
    fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    out.push({ layer: layer.name, status: 'written', path: p, rowCount: n, dimensions: dim })
  }
}

for (const r of out) {
  if (r.status === 'skip' || r.status === 'error') {
    console.log(r.status.toUpperCase().padEnd(8) + r.layer + '  — ' + r.reason)
  } else if (r.status === 'dry') {
    console.log('DRY     ' + r.layer + '  → ' + r.path + '  （' + r.manifest.rowCount + ' 条 / ' + r.manifest.embedding.dimensions + ' 维）')
  } else {
    console.log('WRITTEN ' + r.layer + '  ' + r.path + '  （' + r.rowCount + ' 条 / ' + r.dimensions + ' 维）')
  }
}
if (bad) {
  console.error('\n有 ' + bad + ' 层没写清单：上面的 error 修了再来。')
  process.exit(1)
}
console.log('\n清单口径：model 来自配置，**未独立核实**（verified=false）。要盖章得先验真模型。')
