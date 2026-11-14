// dsh-core-memory — 跨会话持久记忆（OpenClaw 风格：核心记忆常驻注入 + 归档记忆按需检索）
// 由动态插件 dshmem-3 原型固化而来；静态 host 插件，Node 原生 fs 直读直写。
//
// 布局（<dshHome>/memory/，默认 ~/.dsh/memory）：
//   MEMORY.md   核心记忆：每个会话系统提示常驻注入（order 60 节，同步读、永远新鲜）
//   notes/      归档记忆：一条一文件，front-matter（id/title/tags/created/updated
//               /status/source/supersedes/last_confirmed）
//               2026-10-30 加后四个字段：状态（候选/生效/被取代/作废）、来源（她说的/我推断的/
//               观察到的）、被哪条取代、最近一次被证据确认的日期。检索默认不返回作废/被取代的。
//   index.json  元数据索引（list/search 的真相源；损坏时从 notes/ 重建）
import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildGraph, expand, describeChain, mergedIds, conflictCandidates, REPLACES } from './graph.js';
import {
  readRows as readRecallRows,
  record as recordRecall,
  fold as foldRecall,
  gate as recallGate,
} from './recall.js';
import {
  buildPersonaText,
  listPresets,
  readPersona,
  renderPersonaFile,
  normalizePersonaInput,
  personaPath,
  MAX_CUSTOM_TEXT,
  PRESETS,
} from './persona.js';

export const name = 'dsh-core-memory';
export const inject = ['tools', 'systemPrompt'];

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}
const corePath = () => join(dshHome(), 'memory', 'MEMORY.md');
const notesDir = () => join(dshHome(), 'memory', 'notes');
const indexPath = () => join(dshHome(), 'memory', 'index.json');

const TEMPLATE = [
  '# DSH 核心记忆',
  '',
  '> 由 dsh-ming-core-memory（AI的 fork）维护，并注入每个会话的系统提示。保持精炼（建议 6KB 内）。',
  '> 可用 memory_core 工具增删改，也可手工编辑（插件每次组装时同步读取，立即可见）。',
  '> 只装事实，不装人。',
  '',
  '## 环境',
  '- （机器、部署、常用路径等长期事实）',
  '',
  '## 项目',
  '- （进行中的项目、关键决策与约定）',
  '',
].join('\n');

// ---------- 纯函数 ----------
function noteSort(a, b) { return (b.created || '').localeCompare(a.created || '') }

// 记忆状态（2026-10-30）：缺字段的老条目一律当「生效 / 来源未知」——不能一夜之间全变候选。
const STATUSES = ['candidate', 'active', 'superseded', 'invalidated'];
const SOURCES = ['user_statement', 'direct_observation', 'agent_inference', 'external_source', 'unknown'];
const RETIRED = ['superseded', 'invalidated'];
function normStatus(v, fallback = 'active') {
  const s = String(v || '').trim().toLowerCase();
  return STATUSES.indexOf(s) >= 0 ? s : fallback;
}
function normSource(v, fallback = 'unknown') {
  const s = String(v || '').trim().toLowerCase();
  return SOURCES.indexOf(s) >= 0 ? s : fallback;
}
function isRetired(n) { return RETIRED.indexOf(normStatus(n && n.status)) >= 0 }
function statusLabel(s) {
  return { candidate: '候选', active: '生效', superseded: '已被取代', invalidated: '已作废' }[normStatus(s)] || normStatus(s);
}
function sourceLabel(s) {
  return { user_statement: '她说的', direct_observation: '观察到的', agent_inference: '我推断的', external_source: '外部来源', unknown: '来源未知' }[normSource(s)] || normSource(s);
}

function parseNoteFile(text) {
  const out = { meta: {}, body: text };
  if (typeof text === 'string' && text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end >= 0) {
      const fm = text.slice(3, end);
      out.body = text.slice(end + 4).replace(/^\n+/, '');
      for (const line of fm.split('\n')) {
        const at = line.indexOf(':');
        if (at > 0) out.meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
      }
    }
  }
  return out;
}

function parseCoreSections(text) {
  const lines = String(text).split('\n');
  const header = [];
  const sections = [];
  let current = null;
  let body = [];
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current !== null) sections.push({ title: current, body: body.join('\n') });
      current = m[1];
      body = [];
    } else if (current !== null) {
      body.push(line);
    } else {
      header.push(line);
    }
  }
  if (current !== null) sections.push({ title: current, body: body.join('\n') });
  return { header: header.join('\n'), sections };
}

function renderCore(parsed) {
  let text = parsed.header;
  for (const s of parsed.sections) {
    const body = s.body.replace(/^\n+/, '').replace(/\n+\s*$/, '');
    text += '\n## ' + s.title + '\n' + (body ? body + '\n' : '');
  }
  return text;
}

function makeId(title, existing) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  const slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '');
  const base = stamp + (slug ? '-' + slug : '');
  const taken = new Set(existing.map((n) => n.id));
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) { candidate = base + '-' + n; n++; }
  return candidate;
}

function noteFileText(meta, content) {
  const lines = [
    '---',
    'id: ' + meta.id,
    'title: ' + meta.title,
    'tags: ' + ((meta.tags || []).join(', ')),
    'created: ' + meta.created,
    'updated: ' + meta.updated,
    'status: ' + normStatus(meta.status),
    'source: ' + normSource(meta.source),
    'supersedes: ' + (meta.supersedes || ''),
    'superseded_by: ' + (meta.superseded_by || ''),
    ...(meta.merged_from && meta.merged_from.length ? ['merged_from: ' + (Array.isArray(meta.merged_from) ? meta.merged_from.join(', ') : meta.merged_from)] : []),
    'last_confirmed: ' + (meta.last_confirmed || ''),
    '---',
    '',
    content,
  ];
  return lines.join('\n') + '\n';
}

// ---------- 词袋与打分（2026-11-03 重写） ----------
// 病：原来按空格切词。「怎么确认一条消息真的发出去了，不是只看接口没报错」整句是一个 token，
// 库里没有任何一条含这句话，于是零命中——**用一句人话问，一条都搜不到**，只有敲关键词才灵。
// 这件事是拿朴素 BM25 当基线量出来的（bench/run.mjs：12 题里 BM25 命中 11，我 7）。
// 改法：ASCII 词 + 中文 bigram（跟 BM25 同一个切法），按文档频率给权重，
// 但保留原来自带的那些东西——标题 ×3、标签 ×2、正文按出现次数、状态过滤、取代链。
// 不是把检索换成 BM25：BM25 只有词频，这边还知道哪条已经作废。
const BAG_CACHE = { sig: '', bag: null };

function bagTokens(text) {
  const s = String(text || '').toLowerCase();
  const counts = new Map();
  const bump = (t) => counts.set(t, (counts.get(t) || 0) + 1);
  for (const m of s.match(/[a-z0-9][a-z0-9_.\-]*/g) || []) bump(m);
  for (const run of s.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length === 1) { bump(run); continue; }
    for (let i = 0; i + 1 < run.length; i++) bump(run.slice(i, i + 2));
  }
  return counts;
}

function bagSig(notes) {
  let h = 0;
  for (const n of notes) {
    const s = n.id + ':' + (n.size || 0) + ':' + (n.updated || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h + ':' + notes.length;
}

/** 一次建好 75 条的词袋与文档频率，之后每个查询只在内存里数（索引变了 sig 才重读）。 */
async function loadBag(notes, bodies) {
  const sig = bagSig(notes);
  if (BAG_CACHE.bag && BAG_CACHE.sig === sig) return BAG_CACHE.bag;
  const docs = new Map();
  const df = new Map();
  for (const n of notes) {
    const title = bagTokens(n.title);
    const tags = bagTokens((n.tags || []).join(' '));
    const body = bagTokens(bodies.get(n.id) || '');
    docs.set(n.id, { title, tags, body });
    const seen = new Set([...title.keys(), ...tags.keys(), ...body.keys()]);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const bag = { N: notes.length, df, docs };
  BAG_CACHE.sig = sig;
  BAG_CACHE.bag = bag;
  return bag;
}

/** 查询也切成同一种词：ASCII 词 + 中文 bigram，去重。 */
function queryTokens(query) {
  return [...new Set(bagTokens(query).keys())];
}

/** 文档频率越低越值钱；标题/标签命中另加权。除以 √词数，长问句不该因为词多就赢。 */
function scoreNote(doc, qtokens, bag) {
  if (!doc) return 0;
  let score = 0;
  let hitIdf = 0;
  let allIdf = 0;
  for (const t of qtokens) {
    const df = bag.df.get(t) || 0;
    if (!df) continue;
    const idf = Math.log(1 + (bag.N - df + 0.5) / (df + 0.5));
    allIdf += idf;
    let local = 0;
    if (doc.title.has(t)) local += 3;
    if (doc.tags.has(t)) local += 2;
    const bf = doc.body.get(t) || 0;
    if (bf) local += 1 + Math.log(bf);
    if (local > 0) {
      score += idf * local;
      hitIdf += idf;
    }
  }
  if (score <= 0 || allIdf <= 0) return 0;
  const coverage = hitIdf / allIdf;
  return (score / Math.sqrt(qtokens.length || 1)) * (0.3 + 0.7 * coverage);
}

function makeSnippet(bodyText, qtokens) {
  const flat = String(bodyText).replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const t of qtokens) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, 120) + (flat.length > 120 ? '…' : '');
  const start = Math.max(0, at - 40);
  const end = Math.min(flat.length, at + 120);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

// prompt 组装对 {{variable}} 严格插值——注入前把字面 {{ 拆开，避免撞变量语法
function sanitize(text) { return String(text).split('{{').join('{ {') }

// 记忆写入的硬性凭证门：提示词政策之外，再拦常见可直接使用的秘密值。
// 只返回通用错误，不把命中的值写进日志或错误讯息。
const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b/,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,}/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|aws[_-]?secret[_-]?access[_-]?key|password|passwd|pwd|secret|authorization|cookie|sessdata)\s*[:=]\s*["']?(?!<redacted>|redacted\b|xxxxx+\b|your[_-]?(?:api[_-]?key|token|password)\b|\.{3})[A-Za-z0-9_./+=:-]{8,}/i,
];
function containsCredential(value) {
  const text = String(value ?? '');
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}
function credentialWriteError() {
  return '写入已拒绝：内容疑似包含密码、Token、Cookie、API Key 或私钥。请先移除凭证或替换成 [已遮蔽]；没有写入记忆。';
}

// ---------- fs 辅助 ----------
function readFileSyncOrNull(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

async function rebuildIndex() {
  const out = [];
  let entries = [];
  try { entries = await readdir(notesDir()); } catch { return out; }
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    try {
      const text = await readFile(join(notesDir(), name), 'utf8');
      const parsed = parseNoteFile(text);
      if (parsed.meta.deleted === 'true') continue; // 墓碑文件不复活
      const id = name.slice(0, -3);
      out.push({
        id,
        title: parsed.meta.title || id,
        tags: (parsed.meta.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
        created: parsed.meta.created || '',
        updated: parsed.meta.updated || parsed.meta.created || '',
        status: normStatus(parsed.meta.status),
        source: normSource(parsed.meta.source),
        supersedes: parsed.meta.supersedes || '',
        superseded_by: parsed.meta.superseded_by || '',
        last_confirmed: parsed.meta.last_confirmed || '',
        size: text.length,
      });
    } catch { /* 跳过无法解析的文件 */ }
  }
  return out.sort(noteSort);
}

async function loadIndex() {
  try {
    const raw = await readFile(indexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.notes)) {
      return parsed.notes.filter((n) => n && typeof n.id === 'string').sort(noteSort);
    }
  } catch { /* 缺失或损坏 → 从 notes/ 重建 */ }
  return rebuildIndex();
}

// 写串行化：同进程多 agent 并发写也按序落盘
let tail = Promise.resolve();function enqueue(job) {
  const run = tail.then(job, job);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * 读全库（含正文）建一张关系图：标识符连边 + 取代链。
 * 只在 search / read / write 里用，73 条记忆量级一次几十毫秒；不落盘、不进提示词。
 */
async function loadGraph() {
  const notes = await loadIndex();
  const full = [];
  for (const note of notes) {
    let body = '';
    try { body = parseNoteFile(await readFile(join(notesDir(), note.id + '.md'), 'utf8')).body; } catch { body = ''; }
    full.push({ ...note, body });
  }
  return buildGraph(full);
}

function errText(e) { return '操作失败：' + (e && e.message ? e.message : String(e)); }

/** 写入审计：每次落盘记一行，用户可随时 `type memory\audit.jsonl` 看AI到底存了什么。 */
const auditPath = () => join(dshHome(), 'memory', 'audit.jsonl');
async function audit(line) {
  try {
    await mkdir(dirname(auditPath()), { recursive: true });
    await writeFile(auditPath(), JSON.stringify({ t: new Date().toISOString(), ...line }) + '\n', { flag: 'a', encoding: 'utf8' });
  } catch { /* 审计失败不影响正常写入 */ }
}

/** 读取并限制请求体大小（防误用），返回 UTF-8 文本。 */
function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('请求体过大')); try { req.destroy(); } catch { /* 忽略 */ } return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- 召回节（同步读，每次模型组装永远新鲜） ----------
function buildSectionText() {
  try {
    let core = '';
    const coreRaw = readFileSyncOrNull(corePath());
    if (coreRaw !== null) core = coreRaw.trim();
    let coreNote = '';
    if (core.length > 3000) {
      core = core.slice(0, 3000);
      coreNote = '\n（核心记忆过长已截断——请尽快用 memory_core 精简）';
    }
    let notes = [];
    const indexRaw = readFileSyncOrNull(indexPath());
    if (indexRaw) {
      try {
        const p = JSON.parse(indexRaw);
        if (p && Array.isArray(p.notes)) notes = p.notes.filter((n) => n && typeof n.id === 'string').sort(noteSort);
      } catch { /* 索引损坏时本节不列归档，工具侧会重建 */ }
    }
    const recent = notes.slice(0, 12).map((n) =>
      '- [' + n.id + '] ' + n.title + ((n.tags && n.tags.length) ? '  #' + n.tags.join(' #') : '') +
      (isRetired(n) ? '  〔' + statusLabel(n.status) + '〕' : '')
    ).join('\n');
    const persona = buildPersonaText();
    return [
      '# 跨会话记忆',
      '',
      '你在本机的所有会话共享以下持久记忆。核心记忆常驻注入；归档记忆仅列索引，用 memory_search / memory_read 按需取用。',
      '',
      '## 核心记忆（MEMORY.md）',
      sanitize(core) || '（空）',
      coreNote,
      ...(persona ? ['', '## 回复风格（用户设置）', sanitize(persona)] : []),
      '',
      '## 最近归档记忆（新→旧，最多 12 条）',
      recent || '（暂无归档记忆）',
      '',
      '## 使用政策',
      '- 这个库只装「机器、环境、项目、工具、做法」这类事实。它是工具箱，不是人像。',
      '- 不写关于「人」的判断：身份、偏好画像、情绪、健康、关系、私人生活，以及未经明确同意的对话转述。这类内容属于用户自己的日记，不属于这里。',
      '- 用户说「记住这个」时，先判断属于哪一类：属于人的那一类，就回一句「这条我不存，你要是想留，写进你自己的日记文件里」，不要落盘。',
      '- 不要为了「以后可能有用」而主动囤积。没有明确事实、没有明确要求，就不写。',
      '- 保存的内容必须自包含：未来会话看不到当前对话，要写清楚背景。',
      '- 不要保存：一次性细节、敏感信息（密码/凭据/token）、能从代码或文件轻易恢复的信息。',
      '- 需要回忆细节时主动 memory_search；需要浏览时 memory_list。',
      '- **每条记忆都带四个字段**：status（candidate 候选 / active 生效 / superseded 已被取代 / invalidated 已作废）、source（user_statement 她说的 / direct_observation 观察到的 / agent_inference 我推断的 / external_source 外部来源）、supersedes（这条取代了哪条）、last_confirmed（最近一次被证据确认的日期）。',
      '- **推断不是事实**：我自己的推断写进记忆时 source 要写 agent_inference，别写成她说的。memory_search 默认不返回作废/被取代的条目，要看得传 include_retired。',
      '- 推翻一条旧记忆的正确做法：新写一条并把 supersedes 填上旧 id（旧条目会自动标 superseded），不要偷偷改旧条目正文。',
      '- 回复风格用 persona 工具，不写进 MEMORY.md。',
      '- 每次写入都会记一行到 memory/audit.jsonl，用户随时可查。',
    ].join('\n');
  } catch {
    return '（跨会话记忆：暂不可用）';
  }
}

// ---------- 六个记忆工具 ----------
const outputText = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };

/**
 * 事件合并（2026-11-03，从 SurfCore 的「多选消息 → 合并成一个事件」搬来）。
 * 它那边合的是 QQ 消息，这边合的是我自己的归档记忆：同一起事故/同一个决定
 * 散成四五条，索引被同一件事挤满。合并只是把它们收进一个事件条目下，
 * 结论一个字不改，原条目正文一个字不删（superseded，include_retired 还能搜到）。
 */
function isoShort(iso) {
  const t = new Date(iso)
  if (!t || isNaN(t.getTime())) return String(iso || '')
  const p = (v) => String(v).padStart(2, '0')
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes())
}

/** 从正文里摘一句：跳过标题和小节标题，取第一段正文，截到 max 字。 */
function briefOf(body, max = 160) {
  const lines = String(body || '').replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean)
  let line = ''
  for (const s of lines) {
    if (/^#{1,6}\s/.test(s)) continue
    if (/^[-*|>]\s*$/.test(s)) continue
    line = s.replace(/^[-*]\s*/, '')
    break
  }
  if (!line) line = lines.join(' ')
  return line.length > max ? line.slice(0, max) + '…' : line
}

const toolDefs = [
  {
    name: 'memory_write',
    description: '保存一条归档记忆（episodic note），跨所有会话持久。适用：环境事实、项目决策与约定、工具与路径、可复现的做法。内容要自包含（未来会话看不到当前对话）。**不适用于关于用户的判断、偏好画像、私人内容**——那类东西属于用户自己的日记。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '简短标题（用于生成文件名与检索）' },
        content: { type: 'string', description: '记忆正文，自包含，可多行 Markdown' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签数组，便于检索' },
        status: { type: 'string', enum: STATUSES, description: '可选：candidate 候选 / active 生效（默认）。拿不准就写 candidate，等有第二条证据再转正' },
        source: { type: 'string', enum: SOURCES, description: '可选：这条是我亲眼量的（direct_observation）/ 她明说的（user_statement）/ 我推的（agent_inference）/ 外部资料（external_source）' },
        supersedes: { type: 'string', description: '可选：这条取代哪条记忆的 id（旧条目会被标成 superseded，并记下 superseded_by）' },
      },
      required: ['title', 'content'],
    },
    output: outputText,
    async execute(args) {
      const title = typeof args.title === 'string' ? args.title.replace(/\s+/g, ' ').trim() : '';
      const content = typeof args.content === 'string' ? args.content : '';
      if (!title || !content.trim()) return '保存失败：title 和 content 均不能为空。';
      if (containsCredential([title, content, ...(Array.isArray(args.tags) ? args.tags : [])].join('\n'))) return credentialWriteError();
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
        : [];
      const status = normStatus(args.status, 'active');
      const source = normSource(args.source, 'unknown');
      const supersedesRef = typeof args.supersedes === 'string' ? args.supersedes.trim().replace(/\.md$/, '') : '';
      try {
        return await enqueue(async () => {
          const existing = await loadIndex();
          // 写入前的冲突扫描（从 dsh-soul 2.0 搬的第 1 条）：这段话像在改口，
          // 而库里还躺着讲同一个标识符的活条目 —— 把候选摆出来，由写的人决定填不填 supersedes。
          // 不自动作废：误判一次就把一条还活着的约束藏起来，比留一条过期的更糟。
          let conflictWarn = '';
          if (!supersedesRef) {
            const claimHead = title + '\n' + content.slice(0, 300);
            if (REPLACES.test(claimHead)) {
              try {
                const cands = conflictCandidates(title + '\n' + content, await loadGraph());
                if (cands.length) {
                  conflictWarn = '\n\n⚠ 这条像是在改口径，但 supersedes 空着。库里还有讲同一个东西的活条目：\n' +
                    cands.map((c) => '  - [' + c.id + '] ' + c.title + '（共用 ' + c.shared.join(' / ') + '）').join('\n') +
                    '\n如果它确实被这条替换了，重写一次并带上 supersedes=<id>；如果两条并存，忽略这句。';
                }
              } catch { /* 扫描失败不挡写入 */ }
            }
          }
          let superseded = null;
          let target = null;
          if (supersedesRef) {
            const exact = existing.filter((n) => n.id === supersedesRef);
            const candidates = exact.length > 0 ? exact : existing.filter((n) => n.id.indexOf(supersedesRef) === 0);
            if (candidates.length === 0) return '保存失败：supersedes 指定的记忆「' + supersedesRef + '」不存在。';
            if (candidates.length > 1) return '保存失败：supersedes 有歧义，候选：\n' + candidates.map((n) => '- [' + n.id + '] ' + n.title).join('\n');
            target = candidates[0];
          }
          const id = makeId(title, existing);
          const now = new Date().toISOString();
          const meta = {
            id, title, tags, created: now, updated: now, size: 0,
            status, source, supersedes: target ? target.id : '',
            last_confirmed: status === 'active' ? now : '',
          };
          const fileText = noteFileText(meta, content);
          if (containsCredential(fileText)) return credentialWriteError();
          meta.size = fileText.length;
          await atomicWrite(join(notesDir(), id + '.md'), fileText);
          let notes = [meta, ...existing.filter((n) => n.id !== id)].sort(noteSort);
          // 被取代的那条：改状态、记下 superseded_by，正文一个字不动
          if (target) {
            try {
              const oldText = await readFile(join(notesDir(), target.id + '.md'), 'utf8');
              const oldParsed = parseNoteFile(oldText);
              const oldMeta = {
                ...target,
                status: 'superseded',
                superseded_by: id,
                updated: now,
                tags: target.tags || [],
              };
              await atomicWrite(join(notesDir(), target.id + '.md'), noteFileText(oldMeta, oldParsed.body.replace(/\n+$/, '')));
              notes = notes.map((n) => (n.id === target.id ? { ...n, status: 'superseded', superseded_by: id, updated: now } : n)).sort(noteSort);
              superseded = target.id;
            } catch { /* 旧条目改写失败不影响新条目 */ }
          }
          await atomicWrite(indexPath(), JSON.stringify({ version: 1, notes }, null, 2));
          await audit({ tool: 'memory_write', id, title, tags, chars: fileText.length, status, source, supersedes: superseded || '' });
          return '已保存归档记忆 [' + id + '] ' + title + (tags.length ? ' #' + tags.join(' #') : '') +
            '（' + statusLabel(status) + ' · ' + sourceLabel(source) + '）' +
            (superseded ? '，并把 [' + superseded + '] 标成已被取代' : '') + '。已进入索引，所有会话可见。' + conflictWarn;
        });
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_merge',
    description: '把几条讲同一件事的归档记忆合并成一个「事件」条目：新条目按时间把每一片写成一行、保留原 id 和一句正文，原条目改成「已被取代」但正文一个字不删（memory_read 原 id 仍读得到，检索加 include_retired 仍搜得到）。用在同一起事故 / 同一个决定散成好几条、把索引挤满的时候。**这不是改口**：它不改任何一条的结论，改口径仍要用 memory_write + supersedes。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '事件名（新条目的标题），带对象和日期，如「QQ-Agent 双实例串号（2026-11-02）」' },
        ids: { type: 'array', items: { type: 'string' }, description: '要合并的记忆 id，至少两条；支持唯一前缀' },
        note: { type: 'string', description: '可选：合并后的结论 / 现行口径。不填就只留「经过」' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签数组' },
        source: { type: 'string', enum: SOURCES, description: '可选：来源，不填时取被合并条目里一致的来源，不一致就记未知' },
      },
      required: ['title', 'ids'],
    },
    output: outputText,
    async execute(args) {
      const title = typeof args.title === 'string' ? args.title.replace(/\s+/g, ' ').trim() : '';
      const rawIds = Array.isArray(args.ids)
        ? args.ids.filter((x) => typeof x === 'string' && x.trim()).map((s) => s.trim().replace(/\.md$/, ''))
        : [];
      const note = typeof args.note === 'string' ? args.note.trim() : '';
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
        : [];
      if (!title) return '合并失败：title 不能为空。';
      if (containsCredential([title, note, ...tags].join('\n'))) return credentialWriteError();
      if (rawIds.length < 2) return '合并失败：至少给两条 id——一条不叫合并，直接 memory_write 更清楚。';
      try {
        return await enqueue(async () => {
          const existing = await loadIndex();
          const picked = [];
          const miss = [];
          for (const ref of rawIds) {
            const exact = existing.filter((n) => n.id === ref);
            const cands = exact.length > 0 ? exact : existing.filter((n) => n.id.indexOf(ref) === 0);
            if (cands.length === 0) { miss.push(ref); continue; }
            if (cands.length > 1) return '合并失败：id「' + ref + '」有歧义，候选：\n' + cands.map((n) => '- [' + n.id + '] ' + n.title).join('\n');
            const pick = cands[0];
            if (isRetired(pick)) return '合并失败：[' + pick.id + '] 已经是「' + statusLabel(pick.status) + '」，不再进合并（它已经在某个事件里了）。';
            if (!picked.some((p) => p.id === pick.id)) picked.push(pick);
          }
          if (miss.length) return '合并失败：找不到这些 id：' + miss.join('、');
          if (picked.length < 2) return '合并失败：合并的是至少两条不同的记忆，现在只有一条。';
          picked.sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')));

          const rows = [];
          for (const n of picked) {
            let body = '';
            try { body = parseNoteFile(await readFile(join(notesDir(), n.id + '.md'), 'utf8')).body; } catch { body = ''; }
            rows.push({ n, brief: briefOf(body) });
          }
          const span = isoShort(rows[0].n.created) + ' → ' + isoShort(rows[rows.length - 1].n.created);
          const content = [
            '合并自 ' + rows.length + ' 条，' + span + '。',
            '',
            '## 经过',
            ...rows.map((r) => '- ' + isoShort(r.n.created) + ' [' + r.n.id + '] ' + r.n.title + (r.brief ? ' — ' + r.brief : '')),
            ...(note ? ['', '## 结论 / 现行口径', note] : []),
            '',
            '（原条目正文没删，只是标成已被取代：memory_read 原 id 仍读得到。）',
          ].join('\n');

          const srcSet = new Set(picked.map((p) => normSource(p.source)));
          const source = args.source ? normSource(args.source) : (srcSet.size === 1 ? [...srcSet][0] : 'unknown');
          const mergedFrom = picked.map((p) => p.id);
          const id = makeId(title, existing);
          const now = new Date().toISOString();
          const meta = {
            id, title, tags, created: now, updated: now, size: 0,
            status: 'active', source, supersedes: '', merged_from: mergedFrom,
            last_confirmed: now,
          };
          const fileText = noteFileText(meta, content);
          if (containsCredential(fileText)) return credentialWriteError();
          meta.size = fileText.length;
          await atomicWrite(join(notesDir(), id + '.md'), fileText);
          let notes = [meta, ...existing.filter((n) => n.id !== id)].sort(noteSort);

          const failed = [];
          for (const p of picked) {
            try {
              const oldText = await readFile(join(notesDir(), p.id + '.md'), 'utf8');
              const parsed = parseNoteFile(oldText);
              const oldMeta = { ...p, status: 'superseded', superseded_by: id, updated: now, tags: p.tags || [] };
              await atomicWrite(join(notesDir(), p.id + '.md'), noteFileText(oldMeta, parsed.body.replace(/\n+$/, '') + '\n'));
              notes = notes.map((n) => (n.id === p.id ? { ...n, status: 'superseded', superseded_by: id, updated: now } : n)).sort(noteSort);
            } catch { failed.push(p.id); }
          }
          await atomicWrite(indexPath(), JSON.stringify({ version: 1, notes }, null, 2));
          await audit({ tool: 'memory_merge', id, title, tags, chars: fileText.length, merged_from: mergedFrom.join(',') });

          return '已合并成 [' + id + '] ' + title + '：' + picked.length + ' 条 → 1 条事件（' + span + '）。' +
            (note ? '结论已写在「结论 / 现行口径」一节。' : '没写结论，只有经过。') +
            (failed.length ? '\n⚠ 这几条没能改成已被取代（正文还在，索引里仍算活条目）：' + failed.join('、') : '');
        });
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_core',
    description: '编辑核心记忆 MEMORY.md——它在每个会话的系统提示里常驻注入，务必保持精炼。action=append 在指定分节末尾追加要点；action=replace 用 text 整体替换指定分节；action=remove 删除指定分节。适合：环境事实、项目约定这类「每次都记得」的长期事实。**不要写用户画像。**',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['append', 'replace', 'remove'], description: 'append=追加到分节末尾；replace=整体替换分节；remove=删除分节' },
        section: { type: 'string', description: '分节名（MEMORY.md 里的 ## 标题），如：环境 / 项目' },
        text: { type: 'string', description: '要写入的内容（append/replace 时必填）' },
      },
      required: ['action', 'section'],
    },
    output: outputText,
    async execute(args) {
      const action = args.action;
      if (action !== 'append' && action !== 'replace' && action !== 'remove') {
        return '编辑失败：action 必须是 append / replace / remove。';
      }
      const section = typeof args.section === 'string' ? args.section.trim() : '';
      const text = typeof args.text === 'string' ? args.text : '';
      if (!section) return '编辑失败：section 不能为空。';
      if ((action === 'append' || action === 'replace') && !text.trim()) return '编辑失败：append/replace 需要提供 text。';
      if (containsCredential([section, text].join('\n'))) return credentialWriteError();
      try {
        return await enqueue(async () => {
          let raw = null;
          try { raw = await readFile(corePath(), 'utf8'); } catch { /* 不存在 → 用模板 */ }
          const parsed = parseCoreSections(raw !== null ? raw : TEMPLATE);
          const target = parsed.sections.find((s) => s.title.toLowerCase() === section.toLowerCase());
          const titles = parsed.sections.map((s) => s.title).join('、') || '（无）';
          if (action === 'remove') {
            if (!target) return '删除失败：找不到分节「' + section + '」。现有分节：' + titles;
            parsed.sections = parsed.sections.filter((s) => s !== target);
          } else if (action === 'append') {
            if (target) target.body = (target.body.replace(/\s+$/, '') ? target.body.replace(/\s+$/, '') + '\n' : '') + text;
            else parsed.sections.push({ title: section, body: text });
          } else {
            if (!target) return '替换失败：找不到分节「' + section + '」。现有分节：' + titles;
            target.body = text;
          }
          const next = renderCore(parsed);
          // 2026-10-31（AI，照架构评审 4.3）：**写超了要拒绝，不要先落盘再截断。**
          //   注入那段是 `core.slice(0, 3000)`（UTF-16 code unit），所以这里用同一个口径量：
          //   next.length。超了就返回结构化错误、保留旧文件，绝不写一个「尾巴会被切掉一半」的版本。
          //   2026-10-30 踩过：体检脚本按"去空白的可见字"量出 2929，真身 3018，末条被切半句。
          const LIMIT = 3000;
          const measured = next.length;
          if (measured > LIMIT) {
            return JSON.stringify({
              ok: false,
              code: 'CORE_BUDGET_EXCEEDED',
              measured,
              limit: LIMIT,
              unit: 'utf16_units',
              old_version_preserved: true,
              next_action: '先把要挪走的事实写成归档记忆（memory_write），再压缩这一节后重试；也可以 replace 整节而不是 append。',
            });
          }
          await atomicWrite(corePath(), next);
          await audit({ tool: 'memory_core', action, section, chars: text.length, coreBytes: next.length });
          const verb = action === 'append' ? '追加' : (action === 'replace' ? '替换' : '删除');
          // 90% 预警（建议阈值，可调）：还没超，但下一笔就会碰到墙。
          const warn = measured > LIMIT * 0.9
            ? '（预警：核心记忆 ' + measured + ' / ' + LIMIT + ' 字，已过 90%，下一笔很可能被拒——先归档再压。）'
            : (next.length > 6000 ? '（警告：核心记忆已超 6KB…）' : '');
          return '已' + verb + '核心记忆分节「' + section + '」。当前核心记忆 ' + measured + ' 字（上限 ' + LIMIT + '）。' + warn;
        });
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_search',
    description: '按关键词检索归档记忆（标题/标签/正文），返回相关度排序的摘要。需要回忆过往会话保存的细节时主动使用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '检索关键词，可多个（空格分隔）' },
        limit: { type: 'integer', description: '最多返回条数，默认 8' },
        include_retired: { type: 'boolean', description: '默认 false：不返回已被取代/已作废的记忆。true 时连它们一起搜（挂着〔〕标记）' },
      },
      required: ['query'],
    },
    output: outputText,
    async execute(args) {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) return '搜索失败：query 不能为空。';
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 30) : 8;
      const withRetired = args.include_retired === true;
      try {
        const all = await loadIndex();
        const notes = withRetired ? all : all.filter((n) => !isRetired(n));
        const hidden = all.length - notes.length;
        const bodies = new Map();
        for (const note of all) {
          let bodyText = '';
          try {
            const t = await readFile(join(notesDir(), note.id + '.md'), 'utf8');
            bodyText = parseNoteFile(t).body;
          } catch { bodyText = ''; }
          bodies.set(note.id, bodyText);
        }
        const qtokens = queryTokens(query);
        const bag = await loadBag(all, bodies);
        const scored = [];
        for (const note of all) {
          if (!withRetired && isRetired(note)) continue;
          const score = scoreNote(bag.docs.get(note.id), qtokens, bag);
          if (score > 0) scored.push({ note, score, bodyText: bodies.get(note.id) || '' });
        }
        // —— 闸门：在排序之前决定热度能不能加分。默认关，条件不全中一分不加。——
        let gateLine = '';
        let memoryDir = null;
        let before = null;
        try {
          memoryDir = join(dshHome(), 'memory');
          before = foldRecall(await readRecallRows(memoryDir));
          const g = recallGate({ hitIds: scored.map((h) => h.note.id), state: before });
          if (g.open) {
            for (const h of scored) {
              const b = g.bonus.get(h.note.id);
              if (b) h.score += b;
            }
          }
          gateLine = '闸门：' + (g.open ? '开（' + g.why + '）' : '关（' + g.why + '）');
        } catch { gateLine = '闸门：账本读不到，按关闭处理'; }

        scored.sort((a, b) => b.score - a.score);
        if (scored.length === 0) {
          return '没有匹配「' + query + '」的记忆。可尝试其他关键词，或用 memory_list 浏览全部。' +
            (hidden > 0 && !withRetired ? '\n（另有 ' + hidden + ' 条已作废/被取代的没搜；要看加 include_retired）' : '');
        }
        const top = scored.slice(0, limit);
        // 召唤痕迹：这一轮唤起了谁、跟谁一起被唤起。第一版只记账，不改排序。
        // 一次检索 = 一格钟；不在场就没有检索，钟不走，所以衰减按格算而不是按墙上时间。
        let heatLine = '';
        try {
          heatLine = '\n\n召唤：' + top.slice(0, 3).map((h) => {
            const st = before.stats.get(h.note.id);
            return '第' + ((st ? st.n : 0) + 1) + '次 ' + String(h.note.title || '').slice(0, 16);
          }).join(' · ') + '\n' + gateLine;
          recordRecall(memoryDir, {
            query,
            ids: top.map((h) => h.note.id),
            total: scored.length,
            shown: top.length,
            src: 'note',
          }).catch(() => {});
        } catch { heatLine = ''; }
        let graph = null;
        try { graph = buildGraph(all.map((n) => ({ ...n, body: bodies.get(n.id) || '' }))); } catch { graph = null; }
        const lines = top.map((hit) => {
          let block = '[' + hit.note.id + '] ' + hit.note.title + '（' + (hit.note.created || '').slice(0, 10) + '，' + statusLabel(hit.note.status) + ' · ' + sourceLabel(hit.note.source) + '）\n  ' + makeSnippet(hit.bodyText, qtokens);
          if (graph) {
            const chain = describeChain(hit.note.id, graph, { withHead: true });
            if (chain.length) block += '\n' + chain.join('\n');
          }
          return block;
        });
        let out = '找到 ' + scored.length + ' 条匹配（显示前 ' + Math.min(limit, scored.length) + ' 条，按相关度排序）：\n\n' + lines.join('\n\n');

        // 沿关系回捞：命中只是种子，顺着共用的标识符（路径/文件名/工具名）把相邻那条捞出来。
        // 每条都标出「共用什么」，链接弱的一眼能看出来，不必信。
        if (graph) {
          const ex = expand(top.map((h) => ({ id: h.note.id, score: h.score })), graph);
          if (ex.length) {
            out += '\n\n关联（共享同一个标识符，未命中但不一定无关）：\n' + ex.map((x) => {
              const n = graph.byId.get(x.id);
              return '- [' + x.id + '] ' + (n ? n.title : '') + (n && isRetired(n) ? '〔' + statusLabel(n.status) + '〕' : '') + '（共用 ' + x.via.join(' / ') + '）';
            }).join('\n');
          }
        }

        // 被藏起来的那几条如果正是这个词命中的，得说出来，不然「旧口径同时躺在场里」还是看不见。
        if (!withRetired && hidden > 0) {
          const dead = all.filter(isRetired).map((note) => ({ note, score: scoreNote(bag.docs.get(note.id), qtokens, bag) }))
            .filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
          if (dead.length) {
            out += '\n\n另有 ' + dead.length + ' 条已作废/被取代的命中（默认不显示，加 include_retired 看全文）：\n' + dead.map((h) => {
              const chain = graph ? describeChain(h.note.id, graph, { withHead: false }) : [];
              return '- [' + h.note.id + '] ' + h.note.title + '〔' + statusLabel(h.note.status) + '〕' + (chain.length ? '\n' + chain.join('\n') : '');
            }).join('\n');
          }
        }
        return out + heatLine;
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_read',
    description: '按 id 读取一条归档记忆的完整内容。id 来自 memory_list / memory_search 的结果（或注入索引里的 [id]）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '记忆 id（可带 .md 后缀；支持唯一前缀匹配）' },
      },
      required: ['id'],
    },
    output: outputText,
    async execute(args) {
      const ref = typeof args.id === 'string' ? args.id.trim() : '';
      if (!ref) return '读取失败：id 不能为空。可用 memory_list 获取 id。';
      try {
        const notes = await loadIndex();
        const clean = ref.replace(/\.md$/, '');
        let matches = notes.filter((n) => n.id === clean);
        if (matches.length === 0) matches = notes.filter((n) => n.id.indexOf(clean) === 0);
        if (matches.length === 0) return '未找到记忆「' + ref + '」。可用 memory_list 浏览全部 ' + notes.length + ' 条归档记忆。';
        if (matches.length > 1) return 'id 有歧义，候选：\n' + matches.map((n) => '- [' + n.id + '] ' + n.title).join('\n');
        const note = matches[0];
        let text = '';
        try {
          text = await readFile(join(notesDir(), note.id + '.md'), 'utf8');
        } catch (e) {
          return '记忆 [' + note.id + '] 在索引中存在但文件读取失败：' + errText(e);
        }
        const parsed = parseNoteFile(text);
        // 取代链能说清就用链（哪条取代了哪条、现行口径是什么）；说不清才退回一句干巴巴的警告。
        let chain = [];
        let graphNow = null;
        try { graphNow = await loadGraph(); chain = describeChain(note.id, graphNow); } catch { chain = []; }
        // 并入事件 ≠ 被改口：状态同样是 superseded，话得说成「已并入」。
        const mergedParent = note.superseded_by && graphNow && graphNow.byId.get(note.superseded_by) &&
          mergedIds(graphNow.byId.get(note.superseded_by)).indexOf(note.id) >= 0 ? note.superseded_by : '';
        const metaLine = '状态：' + statusLabel(note.status) +
          (note.superseded_by ? (mergedParent ? '（已并入 [' + note.superseded_by + ']）' : '（被 [' + note.superseded_by + '] 取代）') : '') +
          ' · 来源：' + sourceLabel(note.source) +
          (note.last_confirmed ? ' · 最近确认：' + String(note.last_confirmed).slice(0, 10) : ' · 未记录确认时间');
        const warn = isRetired(note) && !chain.length ? '\n⚠ 这条已' + statusLabel(note.status) + '，不能当现行事实用。' : '';
        // 合并条目自己：把「这一条是什么」写在前面，免得被当成新的现行口径。
        const mergeHead = (note.merged_from && note.merged_from.length)
          ? '\n合并自 ' + note.merged_from.length + ' 条：' + note.merged_from.join('、')
          : '';
        let out = '[' + note.id + '] ' + note.title + '\n' + metaLine + mergeHead + '\n创建：' + note.created +
          ((note.tags && note.tags.length) ? '\n标签：' + note.tags.join(', ') : '') +
          (note.supersedes ? '\n取代了：[' + note.supersedes + ']' : '') + warn +
          (chain.length ? '\n' + chain.join('\n') : '') +
          '\n\n' + parsed.body;
        if (out.length > 8000) out = out.slice(0, 8000) + '\n…（内容过长已截断）';
        return out;
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_list',
    description: '列出归档记忆（新→旧），可按标签过滤。用于浏览记忆库全貌。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', description: '最多返回条数，默认 15' },
        tag: { type: 'string', description: '可选：只列带此标签的记忆' },
        include_retired: { type: 'boolean', description: '默认 true：浏览时把作废/被取代的也列出来（挂〔〕标记）。false 只看现行的' },
      },
      required: [],
    },
    output: outputText,
    async execute(args) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 100) : 15;
      const tag = typeof args.tag === 'string' ? args.tag.trim().toLowerCase() : '';
      const hideRetired = args.include_retired === false;
      try {
        let notes = await loadIndex();
        if (hideRetired) notes = notes.filter((n) => !isRetired(n));
        if (tag) notes = notes.filter((n) => (n.tags || []).some((t) => String(t).toLowerCase() === tag));
        if (notes.length === 0) return tag ? '没有带标签 #' + tag + ' 的记忆。' : '暂无归档记忆。';
        const lines = notes.slice(0, limit).map((n) =>
          '- [' + n.id + '] ' + n.title + ((n.tags && n.tags.length) ? '  #' + n.tags.join(' #') : '') + '（' + (n.created || '').slice(0, 10) + '，' +
          statusLabel(n.status) + ' · ' + sourceLabel(n.source) + '）'
        );
        return '归档记忆共 ' + notes.length + ' 条（显示前 ' + Math.min(limit, notes.length) + ' 条，新→旧）：\n' + lines.join('\n');
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'memory_delete',
    description: '删除一条归档记忆：从索引移除并把文件改写为墓碑占位。用于清理过时或错误的记忆。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '要删除的记忆 id' },
      },
      required: ['id'],
    },
    output: outputText,
    async execute(args) {
      const ref = typeof args.id === 'string' ? args.id.trim() : '';
      if (!ref) return '删除失败：id 不能为空。';
      try {
        return await enqueue(async () => {
          const notes = await loadIndex();
          const clean = ref.replace(/\.md$/, '');
          // 精确全等优先（2026-10-25 AI修）：id 全等时它唯一，不该因为「它同时也是别人的前缀」被判歧义
          const exact = notes.filter((n) => n.id === clean);
          const matches = exact.length > 0 ? exact : notes.filter((n) => n.id.indexOf(clean) === 0);
          if (matches.length === 0) return '删除失败：未找到「' + ref + '」。可用 memory_list 浏览全部。';
          if (matches.length > 1) return 'id 有歧义，请精确指定：\n' + matches.map((n) => '- [' + n.id + '] ' + n.title).join('\n');
          const note = matches[0];
          const next = notes.filter((n) => n.id !== note.id);
          await atomicWrite(indexPath(), JSON.stringify({ version: 1, notes: next }, null, 2));
          try {
            await atomicWrite(join(notesDir(), note.id + '.md'), '---\ndeleted: true\nid: ' + note.id + '\n---\n\n（此记忆已删除）\n');
          } catch { /* 索引已移除，墓碑写失败不影响结果 */ }
          return '已删除记忆 [' + note.id + '] ' + note.title + '。';
        });
      } catch (e) { return errText(e); }
    },
  },
  {
    name: 'persona',
    description: '读取或设置 AI 的回复风格（与 MEMORY.md 并列的持久偏好，注入每个会话的系统提示）。action=get 查看当前风格与全部预设；action=set 切换到某个预设；action=custom 写入自定义风格文本；action=disable 停用风格注入。仅在用户明确要求改变回复风格、或表达长期语气偏好时调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'custom', 'disable'], description: 'get=查看；set=切预设；custom=写自定义；disable=停用' },
        preset: { type: 'string', description: 'action=set 时的预设 id，如 warm / concise / rigorous / humorous / gentle / default' },
        text: { type: 'string', description: 'action=custom 时的风格正文（建议 200 字内，上限 ' + MAX_CUSTOM_TEXT + ' 字符）' },
      },
      required: ['action'],
    },
    output: outputText,
    async execute(args) {
      const action = args.action;
      try {
        if (action === 'get') {
          const state = readPersona();
          const current = state.enabled
            ? (state.preset === 'custom' ? '自定义' : ((PRESETS.find((p) => p.id === state.preset) || {}).name || state.preset))
            : '（已停用）';
          return '当前回复风格：' + current +
            (state.enabled && state.preset === 'custom' && state.custom ? '（正文 ' + state.custom.length + ' 字符）' : '') +
            '\n生效文本：' + (buildPersonaText() || '（默认：不注入风格指令）') +
            '\n\n可选预设：\n' + PRESETS.map((p) => '- ' + p.id + '（' + p.name + '）：' + p.summary).join('\n') +
            '\n\n提示：改动将在下一次模型组装时生效。';
        }

        if (action === 'disable') {
          return await enqueue(async () => {
            const cur = readPersona();
            await atomicWrite(personaPath(), renderPersonaFile({ enabled: false, preset: cur.preset, custom: cur.custom }));
            return '已停用回复风格注入（预设选择「' + cur.preset + '」已保留，重新启用即可恢复）。';
          });
        }

        if (action !== 'set' && action !== 'custom') {
          return '设置失败：action 必须是 get / set / custom / disable。';
        }

        const patch = { enabled: true, preset: action === 'custom' ? 'custom' : (typeof args.preset === 'string' ? args.preset.trim() : '') };
        if (action === 'set' && !patch.preset) {
          return '设置失败：action=set 需要提供 preset。可用：' + PRESETS.map((p) => p.id).join(' / ');
        }
        if (action === 'custom') patch.custom = typeof args.text === 'string' ? args.text : '';

        return await enqueue(async () => {
          const cur = readPersona();
          const incoming = { enabled: true, preset: patch.preset, custom: patch.custom !== undefined ? patch.custom : cur.custom };
          const check = normalizePersonaInput(incoming, cur);
          if (!check.ok) return '设置失败：' + check.error;
          await atomicWrite(personaPath(), renderPersonaFile(check.value));
          const preset = PRESETS.find((p) => p.id === check.value.preset);
          return '已切换回复风格为「' + (preset ? preset.name : check.value.preset) + '」。已在后续模型组装中生效。';
        });
      } catch (e) { return errText(e); }
    },
  },
];

export function apply(ctx) {
  // 引导创建（不阻塞激活；失败仅告警）
  enqueue(async () => {
    await mkdir(notesDir(), { recursive: true });
    if (readFileSyncOrNull(corePath()) === null) await atomicWrite(corePath(), TEMPLATE);
    if (readFileSyncOrNull(indexPath()) === null) await atomicWrite(indexPath(), JSON.stringify({ version: 1, notes: [] }, null, 2));
  }).catch((e) => console.error('dsh-core-memory: bootstrap failed', e));

  for (const def of toolDefs) {
    ctx.tools.register(def);
  }

  // 自动召回：常驻注入每个会话的每次模型组装（同步读取，永远最新）
  ctx.systemPrompt.section({
    name: 'ming-core-memory:recall',
    order: 60,
    text: () => buildSectionText(),
  });

  // 设置页读写接口：风格页（client.js）经同源 fetch 调用。
  // webServer 是可选依赖——缺席时插件照常工作，只是设置页不可用。
  ctx.inject(['webServer'], (c) => {
    c.effect(() => c.webServer.register({
      kind: 'exact',
      path: '/dsh-core-memory/persona',
      async handler(req, res) {
        const sendJson = (code, payload) => {
          try {
            const body = JSON.stringify(payload);
            res.statusCode = code;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(body);
          } catch { /* 响应已发出时忽略 */ }
        };
        try {
          if (req.method === 'POST') {
            const body = await readBody(req);
            const patch = JSON.parse(body || '{}');
            if (!patch || typeof patch !== 'object') throw new Error('请求体必须是对象');
            const result = await enqueue(async () => {
              const cur = readPersona();
              const check = normalizePersonaInput(patch, cur);
              if (!check.ok) return { ok: false, error: check.error };
              await atomicWrite(personaPath(), renderPersonaFile(check.value));
              return { ok: true, persona: readPersona() };
            });
            if (!result.ok) { sendJson(400, { error: result.error }); return; }
            sendJson(200, { persona: result.persona, presets: listPresets() });
            return;
          }
          sendJson(200, { persona: readPersona(), presets: listPresets(), maxCustom: MAX_CUSTOM_TEXT });
        } catch (error) {
          sendJson(400, { error: (error && error.message) ? error.message : String(error) });
        }
      },
    }), 'dsh-core-memory: persona settings route');
  });

  console.log('dsh-core-memory: 已激活，记忆库 ' + join(dshHome(), 'memory'));
}

// 只给手动/脚本调试用（bench、自测）：插件运行时不会碰它。
export const __debug = { bagTokens, queryTokens, scoreNote, loadBag, bagSig };
