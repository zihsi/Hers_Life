import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fingerprint, singleFlight, sourceLoader, graphDependencies, neuronDependencies, unifiedDependencies } from './fingerprint-cache.mjs'

test('content fingerprint detects equal-stat edits, additions and removals', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-cache-'))
  t.after(() => fs.rm(dir, {recursive:true, force:true}))
  const file = path.join(dir, 'a.md'), deps = [{dir, kind:'notes'}]
  await fs.writeFile(file, 'one'); const stat = await fs.stat(file)
  const a = await fingerprint(deps)
  await fs.writeFile(file, 'two'); await fs.utimes(file, stat.atime, stat.mtime)
  const b = await fingerprint(deps); assert.notEqual(a,b); assert.equal(b.length,64)
  await fs.writeFile(path.join(dir,'b.md'),'new'); const c = await fingerprint(deps); assert.notEqual(b,c)
  await fs.unlink(path.join(dir,'b.md')); assert.equal(await fingerprint(deps),b)
  await fs.writeFile(path.join(dir,'.env'),'not read'); assert.equal(await fingerprint(deps),b)
  await assert.rejects(fingerprint([{file:path.join(dir,'.env'), kind:'card'}]))
})
test('declared graph, neuron and unified dependencies invalidate on their own content', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'graph-deps-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const cfg={dshMemoryDir:dir,discordMemoryFile:path.join(dir,'observations.jsonl'),peopleIndex:path.join(dir,'people.json'),memoryCard:path.join(dir,'card.md'),diaryDir:path.join(dir,'diaries')}
  await fs.mkdir(cfg.diaryDir); await fs.mkdir(path.join(dir,'notes'))
  const source=path.join(dir,'neuron.mjs'); await fs.writeFile(source,'export {}')
  for (const [file, deps] of [[cfg.discordMemoryFile,graphDependencies(cfg)],[cfg.discordMemoryFile,neuronDependencies(cfg,source)],[cfg.memoryCard,unifiedDependencies(cfg)],[path.join(cfg.diaryDir,'2026-01-01.md'),unifiedDependencies(cfg)],[path.join(dir,'recall-log.jsonl'),neuronDependencies(cfg,source)]]) {
    const a=await fingerprint(deps); await fs.writeFile(file,'first'); const b=await fingerprint(deps); assert.notEqual(a,b)
    await fs.writeFile(file,'other'); assert.notEqual(await fingerprint(deps),b)
    await fs.unlink(file); assert.equal(await fingerprint(deps),a)
  }
})
test('single flight shares concurrent builds and retries failures', async () => {
  let count=0; const run = singleFlight(async () => { await new Promise(r=>setTimeout(r,10)); if (++count===1) throw Error('fake'); return count })
  const first = await Promise.allSettled([run(),run(),run()]); assert.ok(first.every(x=>x.status==='rejected')); assert.equal(count,1)
  assert.deepEqual(await Promise.all([run(),run()]),[2,2])
})
test('module version depends only on full source digest and retries failed imports', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'graph-source-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const file=path.join(dir,'source.mjs'); await fs.writeFile(file,'export const value=1')
  let calls=0; const load=sourceLoader(file, async url=>{calls++; return {url}})
  const a=await load(); assert.equal(await load(),a); assert.equal(calls,1)
  await fs.writeFile(path.join(dir,'data.md'),'changed'); assert.equal(await load(),a); assert.equal(calls,1)
  await fs.writeFile(file,'export const value=2'); const b=await load(); assert.notEqual(a.url,b.url); assert.equal(new URL(b.url).searchParams.get('v').length,64)
  let tries=0; const retry=sourceLoader(file,async()=>{if(++tries===1)throw Error('fake');return {ok:true}})
  await assert.rejects(retry()); assert.deepEqual(await retry(),{ok:true})
})
// 2026-11-08：面板「神经/星图/记忆」一起 500 的回归。
// 那时 allowed() 对 .md 也查 token|key，notes 里两条**谈**这两个词的笔记把指纹算失败。
test('文件名里提到 token / key 的笔记仍然算得出指纹，真凭据照旧拒', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'graph-cred-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  for (const name of ['20261024-080815-cost-mjs-dsh-token-2026-10-24.md','20261103-050648-web-search-401-key-page-text-mjs.md']) {
    await fs.writeFile(path.join(dir,name),'正文里谈 token 和 key，这不是凭据文件')
  }
  const digest = await fingerprint([{dir, kind:'notes'}])
  assert.equal(digest.length, 64)
  for (const [name, kind] of [['.env','card'],['credentials.json','people'],['secret.md','notes'],['token.md','notes'],['id_rsa','source'],['server.key','source']]) {
    await fs.writeFile(path.join(dir,name),'x')
    await assert.rejects(fingerprint([{file:path.join(dir,name), kind}]), undefined, name)
  }
})
