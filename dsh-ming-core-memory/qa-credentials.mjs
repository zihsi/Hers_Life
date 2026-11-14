/**
 * 凭证写入防护回归测试。
 *   node qa-credentials.mjs
 * 使用独立临时 DSH_HOME，不触碰真实记忆库。
 */
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = await mkdtemp(join(tmpdir(), 'ming-credentials-qa-'));
process.env.DSH_HOME = home;

const fail = [];
const check = (label, ok, extra = '') => {
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

try {
  const { apply } = await import('./lib/index.js');
  const tools = {};
  const ctx = {
    tools: { register: (def) => { tools[def.name] = def; } },
    systemPrompt: { section: () => {} },
    inject: () => {},
    effect: () => {},
  };
  apply(ctx);

  check('写入工具已注册', !!tools.memory_write && !!tools.memory_core && !!tools.memory_merge);
  const token = 'ghp_' + 'A'.repeat(36);

  const rejected = await tools.memory_write.execute({
    title: '凭证不应进入记忆',
    content: '测试资料：' + token,
    tags: ['安全测试'],
  });
  check('memory_write 拦截 GitHub Token', rejected.includes('写入已拒绝') && !rejected.includes(token));

  const notesDir = join(home, 'memory', 'notes');
  const filesAfterReject = (await readdir(notesDir)).filter((name) => name.endsWith('.md'));
  check('拒绝写入后没有新增归档文件', filesAfterReject.length === 0, String(filesAfterReject.length));

  const corePath = join(home, 'memory', 'MEMORY.md');
  const beforeCore = await readFile(corePath, 'utf8');
  const coreReject = await tools.memory_core.execute({
    action: 'append',
    section: '安全测试',
    text: 'password=SuperSecretValue123456',
  });
  const afterCore = await readFile(corePath, 'utf8');
  check('memory_core 拦截密码字段', coreReject.includes('写入已拒绝'));
  check('核心记忆拒绝后保持原样', beforeCore === afterCore);

  const a = await tools.memory_write.execute({
    title: '测试事件甲',
    content: '第一条安全测试事实。',
    tags: ['安全测试'],
  });
  const b = await tools.memory_write.execute({
    title: '测试事件乙',
    content: '第二条安全测试事实。',
    tags: ['安全测试'],
  });
  const idA = /\[([^\]]+)\]/.exec(a)?.[1];
  const idB = /\[([^\]]+)\]/.exec(b)?.[1];
  check('正常内容仍可保存', !!idA && !!idB);

  const mergeReject = await tools.memory_merge.execute({
    title: '不应合并凭证',
    ids: [idA, idB],
    note: 'Authorization: Bearer ' + 'B'.repeat(32),
  });
  check('memory_merge 拦截 Bearer Token', mergeReject.includes('写入已拒绝'));

  // 二次防线：即使旧条目已有敏感字串，合并生成的新条目也必须拒绝。
  const notePath = join(notesDir, idA + '.md');
  const oldNote = await readFile(notePath, 'utf8');
  await writeFile(notePath, oldNote + '\n' + token + '\n', 'utf8');
  const derivedReject = await tools.memory_merge.execute({
    title: '合并旧资料',
    ids: [idA, idB],
  });
  check('合并产物再次扫描旧正文', derivedReject.includes('写入已拒绝'));

  const audit = await readFile(join(home, 'memory', 'audit.jsonl'), 'utf8');
  check('审计记录没有写入测试凭证', !audit.includes(token) && !audit.includes('SuperSecretValue123456'));
} finally {
  await rm(home, { recursive: true, force: true });
}

console.log('\n' + (fail.length ? '失败 ' + fail.length + ' 项：' + fail.join(' / ') : '全过（临时目录已删）'));
process.exit(fail.length ? 1 : 0);
