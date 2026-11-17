import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const patterns = {notes:/^[^.].*\.md$/i, diaries:/^\d{4}-\d{2}-\d{2}\.md$/, card:/\.md$/i, people:/\.json$/i, observations:/\.jsonl$/i, recall:/^recall-log\.jsonl$/, source:/\.m?js$/i}
// 2026-11-08 修（面板「神经/星图/记忆」HTTP 500）：
//   这道闸本来防的是「把 .env / 私钥 / 凭据读进指纹」，但它对 .md 也查 token|key，
//   于是 notes 里两条**谈** token、key 的笔记（20261024-…-cost-mjs-dsh-token-…、
//   20261103-…-web-search-401-key-page-text-mjs）把整条指纹算失败，三个接口一起 500。
//   判据分开：像凭据文件的名字任何 kind 都拒；普通 .md 只看「名字"，不看正文里写了什么。
const CREDENTIAL_FILE = /^(\.env(?:\.|$)|credentials?(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$)|secrets?(?:\.|$))|\.(?:pem|key|pfx|p12|kdbx)$/i
const CREDENTIAL_WORD = /(^\.env(?:\.|$)|credential|secret|token|(?:^|[-_.])key(?:[-_.]|$))/i
// 名字**本身**就是凭据词（去掉扩展名之后整名对上）：secret.md / credentials.md / token.md。
// 这是为了区分「整份文件就叫这个名字」和「文件名里提到这个词」——
// 后者是最常见的笔记命名（日期 + 主题），前者才像凭据。
const BARE_CREDENTIAL = /^(?:\.?env|credentials?|secrets?|tokens?|api[-_]?key|access[-_]?token|id_(?:rsa|ed25519)|passwords?|passwd)$/i
const PLAIN_TEXT = /\.md$/i
export function allowed(file, kind) {
  const name=path.basename(file)
  if (!patterns[kind]?.test(name)) throw Error('Disallowed fingerprint dependency')
  const stem = name.replace(/\.[^.]*$/, '')
  if (CREDENTIAL_FILE.test(name) || BARE_CREDENTIAL.test(stem)) throw Error('Disallowed fingerprint dependency')
  if (!PLAIN_TEXT.test(name) && CREDENTIAL_WORD.test(name)) throw Error('Disallowed fingerprint dependency')
}
async function digestFile(file, kind) {
  allowed(file,kind)
  try {
    const stat=await fs.lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Fingerprint requires a regular file')
    return createHash('sha256').update(await fs.readFile(file)).digest('hex')
  } catch(e) { if(e.code==='ENOENT') return 'missing'; throw e }
}
// Deliberately no mtime/size shortcut: equal-stat edits must invalidate.
export async function fingerprint(dependencies) {
  const parts=[]
  for (const dep of dependencies) {
    if(dep.dir) {
      if(!['notes','diaries'].includes(dep.kind)) throw Error('Disallowed directory kind')
      let entries
      try { entries=await fs.readdir(dep.dir,{withFileTypes:true}) } catch(e) {if(e.code!=='ENOENT') throw e; parts.push([dep.dir,'missing']); continue}
      parts.push([dep.dir,'directory'])
      for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
        if(!entry.isFile() || !patterns[dep.kind].test(entry.name)) continue
        const file=path.join(dep.dir,entry.name)
        parts.push([file,await digestFile(file,dep.kind)])
      }
    } else if(dep.file) parts.push([dep.file,await digestFile(dep.file,dep.kind)])
  }
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}
export function singleFlight(fn) {
  let pending
  return (...args) => {
    if(!pending) pending=Promise.resolve().then(()=>fn(...args)).finally(()=>{pending=undefined})
    return pending
  }
}
export function sourceLoader(file, importer=url=>import(url)) {
  let version, cached
  return singleFlight(async()=>{
    const digest=await fingerprint([{file,kind:'source'}])
    if(cached && version===digest) return cached
    const url=pathToFileURL(file); url.searchParams.set('v',digest)
    const loaded=await importer(url.href)
    cached=loaded; version=digest
    return loaded
  })
}
export function graphDependencies(cfg) {
  const deps = [{ dir: path.join(cfg.dshMemoryDir, 'notes'), kind: 'notes' }]
  if (cfg.discordMemoryFile) deps.push({ file: cfg.discordMemoryFile, kind: 'observations' })
  return deps
}
export function neuronDependencies(cfg, source) {
  return [...graphDependencies(cfg),{file:path.join(cfg.dshMemoryDir,'recall-log.jsonl'),kind:'recall'},{file:source,kind:'source'}]
}
export function unifiedDependencies(cfg) {
  return [{file:cfg.memoryCard,kind:'card'},{dir:cfg.diaryDir,kind:'diaries'}]
}
