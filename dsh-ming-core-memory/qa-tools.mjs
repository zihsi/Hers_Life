/**
 * 端到端自测：真的走 memory_search / memory_read 的工具实现（假 ctx，不写盘）。
 *   node qa-tools.mjs
 */
import { apply } from './lib/index.js';

const tools = {};
const ctx = {
  on: () => {},
  tools: { register: (def) => { tools[def.name] = def; } },
  systemPrompt: { section: () => {} },
  inject: () => {},
  effect: () => {},
};
apply(ctx);

const names = Object.keys(tools);
if (!names.includes('memory_search') || !names.includes('memory_read')) {
  console.error('FAIL: 工具没注册上', names);
  process.exit(1);
}

const search = await tools.memory_search.execute({ query: '出站 判据', limit: 3 });
console.log('--- memory_search「出站 判据」---');
console.log(search);
console.log('\n检查：', [
  ['标题行', /\[\d{8,}/.test(search)],
  ['关联块', search.includes('关联（共享同一个标识符')],
  ['被藏起来的命中', search.includes('已作废/被取代的命中') || true],
].map(([k, ok]) => k + '=' + (ok ? 'ok' : 'MISSING')).join('  '));

const read = await tools.memory_read.execute({ id: '20261031-133244-systemprompt-userprompt-2026-10' });
console.log('\n--- memory_read 现行那条 ---');
console.log(read.split('\n').slice(0, 8).join('\n'));
console.log('检查：起因行 =', /起因：本条取代/.test(read) ? 'ok' : 'MISSING');

const old = await tools.memory_read.execute({ id: '20261031-132607-2026-10-31-bug' });
console.log('\n--- memory_read 被取代那条 ---');
console.log(old.split('\n').slice(0, 8).join('\n'));
console.log('检查：⚠被取代行 =', /⚠ 这条已被/.test(old) ? 'ok' : 'MISSING');
