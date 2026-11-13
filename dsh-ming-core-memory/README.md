# dsh-ming-core-memory（AI的 fork）

> 基于 [`dsh-core-memory`](https://www.npmjs.com/package/dsh-core-memory) v1.0.1 的本地 fork。
> 原版 MIT，版权归原作者；这里只改三处：
>
> 1. **使用政策**——原版要求模型「当用户表达长期偏好、纠正做法、给出环境事实时：立即保存，不要等用户要求」（写的是「关于用户」）。
>    这里改成：只允许保存机器 / 环境 / 项目 / 工具 / 做法，明确禁止保存关于人的判断、偏好画像、情绪、私人内容，以及未经同意的对话转述。
> 2. **模板**——去掉「## 用户」分节，只留「环境 / 项目」。
> 3. **审计**——每次 `memory_write` / `memory_core` 成功后往 `memory/audit.jsonl` 追加一行（时间、工具、id、标题、字数）。
>    用户可以随时 `type %DSH_HOME%\memory\audit.jsonl` 查AI到底存了什么。
>
> 机制（常驻注入、归档检索、原子写、索引重建）一律沿用原版，未改一行逻辑。原文如下。

---

# dsh-core-memory

> DeepSeek Harness 跨会话持久记忆插件：核心记忆常驻注入 + 归档记忆按需检索 + 可配置的 AI 回复风格。

**English TL;DR** — A [Cordis](https://github.com/deepseek-ai/deepseek-harness) plugin for DeepSeek Harness that gives every session a persistent memory: a hand-editable core-memory markdown file that is **always injected into the system prompt**, an archival note store searchable by seven model-facing tools, and a persona (reply-style) settings page. Pure ESM JavaScript, zero build step, no database and no embedding service — the store is plain markdown on disk.

## 特性

- **核心记忆常驻注入**：`MEMORY.md` 是一份手工可编辑的 markdown，通过 `ctx.systemPrompt.section()` 注入**每一个**会话的系统提示，因此「用户是谁、机器什么环境、项目有哪些约定」这类事实不需要模型碰运气去检索。注入文本每次组装时**同步直读磁盘**，改完立即生效，不需要重启 Harness。
- **归档记忆按需检索**：长尾事实一条一个 markdown 文件（`notes/<id>.md`，带 YAML front-matter），索引只把**最近 12 条**的标题与标签注入提示词，正文留给 `memory_search` / `memory_read` 按需拉取——核心记忆保持精炼，历史却不丢。
- **纯本地检索，无依赖**：打分完全在本地算（标题命中 +3 / 标签命中 +3 / 正文每次出现 +1 / 多词整串命中 +2），命中处自动截取上下文片段返回。**没有向量库、没有 embedding 服务、没有 sidecar 进程**，离线可用。
- **七个模型工具**：`memory_write`（写归档）、`memory_core`（按 `##` 分节增删改核心记忆）、`memory_search`、`memory_read`、`memory_list`（可按标签过滤）、`memory_delete`（删除并留墓碑占位）、`persona`（读写回复风格）。
- **受限使用政策自动注入**：提示词只允许记录机器、环境、项目、工具与做法等非个人事实；禁止保存关于人的判断、偏好画像、情绪、私人内容或未经同意的对话转述。此政策是模型提示词约束，不是对任意内容的程序级隐私审查。
- **AI 回复风格设置页**：在 DSH 设置页注册「AI 回复风格」区块——总开关 + 11 个内置风格预设（`default` / `warm` / `concise` / `rigorous` / `humorous` / `gentle` / `socratic` / `tsundere` / `storyteller` / `roast` / `minimalist`）点选即生效，另有「自定义」卡片可写入最多 4000 字符的自定义风格。风格文本与核心记忆并列注入系统提示。
- **零构建、零运行时依赖**：纯 ESM JavaScript，Node 原生 `fs` 直读直写，`dsh plugin add` 即用，无需编译。
- **写入原子化**：所有落盘走「临时文件 + rename」，索引与笔记不会因中断而写坏；`index.json` 损坏时会自动从 `notes/` 重建。

## 安装

本目录是 Hers_Life 仓库内的本地 Fork，不是要求从 npm 安装的原版 `dsh-core-memory`。请依仓库根目录 [Windows 11 / DSH Desktop 安装指南](../INSTALL.md) 将 `dsh-ming-core-memory` 以 `link:` 加入目标 Profile，并加入 `dsh.profile.bundles`。不要执行上面的旧版 `dsh plugin add dsh-core-memory` 命令来代替本仓安装。

## 存储布局

默认位于 `$DSH_HOME/memory/`（`DSH_HOME` 未设置时为 `~/.dsh/memory/`）：

```
memory/
├── MEMORY.md     核心记忆：每个会话常驻注入，可直接手工编辑
├── notes/        归档记忆：一条一个 markdown 文件（YAML front-matter）
├── index.json    元数据索引（list / search 的真相源，损坏时从 notes/ 重建）
└── PERSONA.md    回复风格（由 persona 工具与设置页维护）
```

首次激活时插件会自动创建 `MEMORY.md` 模板与空索引，开箱即用。

> ⚠️ **核心记忆有 3000 字符的注入上限**。超出部分会被截断，并在注入文本末尾附一句「请尽快用 `memory_core` 精简」的提示。这是刻意的设计：常驻注入的内容必须有预算上限，长尾事实应该落到归档记忆里。

## 使用

模型侧全部通过工具完成，无需手工操作。典型的协作方式是：

- 你表达一个长期偏好 → 模型调 `memory_write` 存成归档记忆，或调 `memory_core` 追加进核心记忆；
- 你要求改变说话风格 → 模型调 `persona` 切换预设；
- 需要回忆往事 → 模型主动调 `memory_search` 检索，再 `memory_read` 读全文。

你也可以直接编辑 `~/.dsh/memory/MEMORY.md`——注入是每次组装时同步读取的，保存即可生效。

## 配置

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `DSH_HOME` | Harness 主目录，记忆库位于其下的 `memory/` | `~/.dsh` |

## 兼容性

- **Node.js** ≥ 22
- **DeepSeek Harness**：本仓 Windows 目标环境曾在 DSH Desktop `0.2.2-rc.2` 验证；不要将上游原始版本号视为本 Fork 对所有 DSH 版本的兼容承诺。插件依赖 `tools` 与 `systemPrompt` 服务；设置页依赖 `webServer`，后者缺席时插件照常工作，只是设置页不可用。
- 宿主半与浏览器半都是**可选**依赖：`@deepseek-ai/cordis` 由 Harness 提供；`react` 仅在设置页（浏览器半）使用，Harness 环境已内置。

## 已知限制

- 检索是**关键词打分**，不是语义检索。同义改写（比如用「崩溃」去搜记录里写的「宕机」）可能搜不到——写记忆时多打几个标签是最有效的补救。
- 注入的归档索引固定为**最近 12 条**，更早的记忆需要模型主动 `memory_search` 才会被想起。
- 核心记忆超 3000 字符即截断，无自动摘要或压缩。

## License

MIT
