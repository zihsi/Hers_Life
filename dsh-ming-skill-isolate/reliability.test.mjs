import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
const source=(await readFile(new URL('./index.js',import.meta.url),'utf8')).replace(/^import .*$/mg,'').replace(/export /g,'')
test('all live registries invalidated, disposed registry excluded',async()=>{
 let create,tool;const calls=[0,0,0];const aborts=[0,1,2].map(()=>new AbortController());
 let persisted='{"off":[]}';let tempId=0;const pending=new Map();
 const reg=i=>({registerProvider:f=>f({signal:aborts[i].signal,invalidate:()=>calls[i]++})})
 const ctx={on:(_n,f)=>create=f,skills:reg(0),tools:{register:t=>tool=t}}
 vm.runInNewContext(source+'\napply(ctx,{root:"C:/fake"})',{
  ctx,path,console,process:{env:{MING_WORKSPACE:'C:/fake'}},
  readFile:async()=>persisted,
  writeFile:async(file,body)=>pending.set(file,body),
  mkdir:async()=>{},
  rename:async(file)=>{persisted=pending.get(file);pending.delete(file)},
  unlink:async(file)=>pending.delete(file),
  randomUUID:()=>String(++tempId),
 })
 for(let i=1;i<=2;i++)create({agent:{session:{header:{cwd:'C:/fake'}},ctx:{inject:(_d,f)=>f({skills:reg(i)})}}})
 await tool.execute({action:'off',name:'example'});assert.deepEqual(calls,[1,1,1]);aborts[1].abort();await tool.execute({action:'on',name:'example'});assert.deepEqual(calls,[2,1,2])
 await Promise.all([
  tool.execute({action:'off',name:'first'}),
  tool.execute({action:'off',name:'second'}),
 ])
 assert.deepEqual(JSON.parse(persisted).off,['first','second'],'serialized updates must preserve both concurrent mutations')
 persisted='{broken'
 const result=await tool.execute({action:'off',name:'must-not-overwrite'})
 assert.match(result,/損壞的原檔會保留/)
 assert.equal(persisted,'{broken','a malformed state file must not be replaced with an empty/new state')
})
