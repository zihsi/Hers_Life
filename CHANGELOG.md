# CHANGELOG

## Discord-only 重构（2026-11-17，分支 `discord-dsh-only`）

本分支将整套 Hers Life 插件集改为 **Discord + DSH** 唯一组合；QQ、OneBot、QQ-Agent、AstrBot 与旧平台桥接目录均已移除，不再保留兼容入口。

- **独立会话**：Discord DM、服务器频道与 Thread 各有稳定且独立的 DSH session ID。
- **共同记忆**：公开事件写入 `live/discord-memory.jsonl`，保留 Discord message ID、作者、服务器、频道、Thread、时间与所属 session；其他 session 依相关性召回，不把所有聊天记录无差别灌入上下文。
- **隐私边界**：Owner 私讯只在 Owner 私讯会话之间共享；公开频道中的私人背景只会在 Owner 本人发言时召回，来源标签与私人原文不会提供给其他成员。
- **Hers Life 专属设置中心**：Discord Token、Owner ID、工作区、人设文件清单、日记路径、记忆范围、兴趣、语音等在插件自己的页面管理；不依赖 DSH 全域设置表单。页面可直接编辑允许的人设 Markdown、`AGENTS.md` 与日期格式日记。
- **工作区初始化与迁移**：自动补齐目录和模板；切换工作区时只复制缺少的文件、不覆盖目的地已有内容。切换后需重启 DSH，让所有配套插件一起切换路径。
- **配套插件迁移**：自由活动改用私有 `ming-browse` 工作会话，Owner 控制仅接受 Discord Owner DM；语音通过 Discord 文件发送工具；提醒、接续、技能隔离、桌宠、活动卡、星图与语义检索改用同一中央工作区。
- **插件市场**：受影响插件版本已更新，市场索引 pin 到本分支的整合提交。

验证范围：修改过的核心 JavaScript 文件通过语法解析；市场 JSON 与各 package 版本／commit pin 已核对；仓库树确认旧平台目录与旧平台命名路径已清除。**本轮未在真实 DSH 进程中连接 Discord，也未执行完整 `node --test` 套件**；干净环境安装、真实 Gateway、语音链路与跨会话运行仍待本机验收。

## v1.2.1（2026-11-17 紧急补丁）

**v1.2.0 的 `dsh-ming-browse` 会把自己拦死。** `permissionPolicy` 默认 `browse_only`，`run_code` 不在分类表 → UNKNOWN → 拒；而 `run_code` 是唯一能直接调用的工具，于是自由活动那一轮连读文件都做不到。用 v1.2.0 的原文件实测：

```
check({ tool: 'run_code', roundAgentId: 'a1', autonomousAgentId: 'a1' })
→ { ok: false, reason: '只浏览模式：run_code 没有分类，不放行' }
```

改法：`check()` 加容器通道（`run_code` / `ops_load_sdk` 放行，判据落内层工具名；花钱类仍拒）。自测 54 → 59 全过。
代价：若宿主的内层调用不过 `pre-execute`，容器放行等于放开整轮，此时兜底靠 `index.js` 的 `checkTap` / `tapTextDeny`。

## v1.2.2（2026-11-17）

### 自由活动不再被权限闸拦（她定）

只浏览模式整个删掉：MODE.BROWSE_ONLY 去掉，check() 恒放行，配置里写 browse_only 也不再改变行为。
代价：花钱不再由代码拦，「不乱花」落回行为规矩（不打赏、不订阅、不买付费墙后的内容）。

### 核查回执 R01–R09（2026-11-17 第二轮）

外部核查在 `bd97e1c` 上发现九处「零件好、接线不对」，本轮逐条修：

- **R01 B 站账号**：真实入口接上 `lib/account.mjs`（内存/凭证服务/文件一个来源）；恢复失败不再留「显示已登录但 provider 没换」；退出与迟到扫码结果按代次判定；social 不再自己读文件。新增 `qa-entry.mjs`（真入口 + 假宿主/假网络，8 项）。
- **R02 工具分类**：`bilibili_comment_post` 这类写操作不再被宽泛前缀认成只读（随只浏览模式整体删除一并生效）。
- **R03 扩展设置页**：`options.html` 补进仓库（`.gitignore` 加精确例外），新增 `qa-extension-files.mjs` 验 manifest 引用的文件都在。
- **R04 inbox 身份**：claimed/handled 回执带上与入站一致的 `platform/botAccountId/conversation/eventId`；消费者只在唯一可关联时回接，其余记 orphan。
- **R05 正式答案**：思考过程不再当回复外发（reasoning-only → 不外发，记为 `reasoning-only`）。
- **R06 转发去重**：tick 不重入（busy 直接返回）；记账改成「游标 + id 集合」，801 条已处理不再重放；箱子用稳定 jobId。
- **R07 旧取文入口**：sidecar 不再默认启动 47322；`onWebPick` 默认关闭（`legacyWebPick` 显式开）。
- **R08 取文生命周期**：待处理状态落 `pending.json` 可恢复；自动路径「明确答了才结账」，失败留原因并可 retry；consume 按 id 校验，不匹配 409。
- **R09 索引一致性**：读端认 `rag-index/current.json`，从不可变代目录一次读齐；代不完整/过期退回 live。生成链仍未公开。
- **K 小修**：未知用量显示「无数据」而不是 0；账本与组装写明「未关联」。

口径：以上都是**离线/合成**验证（真入口 + 假宿主、假网络）；真人扫码、Chrome 实装、干净 DSH 安装、真实资料评测仍属未验。

- **插件市场索引**（2026-11-17）：`market/index.json`（format 1，12 个包，git 源钉 commit）+ 生成器 `scripts/make-market-index.mjs`。
  以前这些包只有 `link:` 一条装法；现在可以把索引 URL 加进插件市场直接装。**每次发版要重跑生成器**，否则市场停在旧 commit。

按项变更记录保存在 [changelog 目录](changelog/)，每份说明包含行为变化、使用方法、验证和限制。各项可独立审查；正式发布版本号暂不变。

- **去重状态落盘**（同日补）：候选收集前读 `live/inbox-state.json`，已结算（handled/claimed/not_handled/failed）的事件不再投递；
  投递成功后写回，按 7 天 / 5000 条裁剪。表里只有 key、状态、时间，不复制正文。
  没有 `MING_WORKSPACE` 时退化成纯内存（不落盘，也不影响这一轮）。

- **决定（她说「A吧」）**：就停在 `claimed`，不再追 `handled`。
  理由：交接书的硬要求是「普通链路在发完之前取得归属」，`claimed` 已满足；
  为一个只用于事后核对的字段，把纯旁观的记录插件塞进每条消息的决策链，风险不对等。
  `after_message_sent` 保留但日志降到 debug（换部署时能自证）。

- **2026-11-17 修正**：第一版调 `llm.stream` 时没传 `provider`/`model`，实测拿到的是**空流**
  （`interest-forward-debug.jsonl` 里 `why:"empty"`、`raw:""`）——不是「模型判断不接」。
  现在先用 `llm.listProviders()` / `llm.listModels()` 解析出一条路由再调；
  解析不出来就整轮不调（`why:"no-route"`）、**不记账**，等 provider 恢复再试。
  自测 17 → 21 项（含「自动解析 provider/model」「没有 provider 时整轮不调」）。

- **2026-11-17 修好并跑通**：两处补齐——① 流里的文字不一定叫 `text-delta`，照桌宠 talker 补了 `pickText` 兜底；
  ② 显式指定通道 `wb-proxy / hy4-preview`（配置项 `llmProvider` / `llmModel`），不再赌 `listProviders()[0]`。
  实测：`live/qq-outbox` → `[outbox-ok] 1794894717421-a3ecea.json -> ming:GroupMessage:<group-b> 27字 487ms`，
  **13:52:00 真的在群里说了一句 27 字**。整条链（AstrBot 命中 → 转发 → DSH 生成 → outbox → 群）通了。

- **17:43 她补：「花钱类也放吧」**：editable 模式和名单主体都不再拦花钱类。
  这撤掉了最后一道兜底——自主轮次里能点付费按钮、能充钱。browse_only 模式下花钱类仍然拒（收紧时该有的）。自测 60 项。

- **17:47 补齐**：她指出「browse_only 不是整个删掉了嘛」——之前只改了默认值，模式和判定分支都还在。
  现在真删：`MODE.BROWSE_ONLY` 去掉，`check()` 恒放行（`skipped: no-gate:<类别>`），
  只留 `classify`/`KIND` 给 qa-audit 挑危险词用（那是另一层，跟权限无关）。
  `normalizePolicy` 仍收旧字段（写 `browse_only` 会被归一成 `editable`），旧配置不会报错。
  自测从 60 项重写成 28 项：验分类 + 「任何 policy × 任何工具都放行」 + 返回值形状。
  旧的「默认只浏览/名单外只读/花钱仍拒」那套断言随模式一起删了，要看得翻 v1.2.1 之前的 git 历史。

- **已知 flaky**：`qa-interest-forward` 的「源文件被换掉后还能读新行」偶发失败（3 次里 1 次）。
  是测试里换文件与读取的竞态，不是被测代码的问题。没修。

### 2026-11-17 · 删掉「只浏览」默认（她的要求：自由活动一直被拦）

- 她原话：「自由活动一直被只浏览模式拦截，删除只浏览模式吧」。
- `normalizePolicy` 的缺省从 `browse_only` 改成 `editable`；配置里显式写 `browse_only` 仍然生效（想收紧随时改回来）。
- **顺带修了一个真 bug**：加这条之前，`mode: editable` 会掉进「按类别判定」那条路——写类照样被拒，
  等于配置里写什么都没用。现在 `editable` 明确放行，只有花钱类仍然拒。
- 自测 59 项。其中 18 条原本写的是「缺省 = 只浏览」的契约，改成「显式 browse_only 时仍然这样」——
  **是契约变了跟着改，不是为了让测试过而改断言**。browse_only 的规格一条没删。

### 2026-11-17 · E-2 转发链路：AstrBot 命中 → DSH 决定 → outbox 发回群

- 她纠正了方向：「让 astrbot 如果检测到兴趣就记录下来转发给 dsh」。我先前做的是「DSH 自己扫 inbox 找兴趣」——那是另一条路，方向错了。
- **AstrBot 侧**（`astrbot_plugin_ming_interest`）：命中兴趣后不调模型、不说，写一条转发请求到
  `live/interest-forward.jsonl`（`{at, groupId, chatKey, nick, text, topics, words, context[], source}`）。
  开关是文件 `live/interest-forward.on`：**它在才转发**，不在就还是老样子。默认不建这个文件，行为不变。
- **DSH 侧**（`dsh-ming-interest/lib/forward.mjs`，20 秒一轮）：
  读转发 → 由 DSH 生成一句（`ctx.llm.stream`，一行/口语/不想接就 NONE）
  → 写 `live/qq-outbox/<ts>-<rand>.json`（`{chatKey, text}`）→ `astrbot_plugin_ming_outbox` 发到群。
  `done` 记账防重复；NONE 也记账（否则会一直重试）；模型抛错/超时不崩，只是这一条不回。
- **为什么不投递到 DSH 会话**：群在 DSH 里不一定有会话（<group-a> 就没有），outbox 不看那个，能发就能发。
- 自测 `test-support/qa-interest-forward.mjs` 17 项（正常回、不重复、NONE 不写箱、模型炸不崩、无 llm）。offline 24 → 25 项全过。
- **两边都要重启才生效**，而且开关默认是关的——切换由她 `touch live/interest-forward.on` 决定。

### 2026-11-17 · E-3 第四批：回执降到 claimed（after_message_sent 在这套部署里不触发）

- 实测：给 `after_message_sent` 加了触发日志、重启两次，**90 秒内 0 次**；
  同期 AstrBot 在群里确实回了 5 条（`on_decorating_result` 抓到 5 次，13:14:14–13:15:23）。
- 结论：这套部署的发消息不走 `respond` stage 那条分支（pacer / burst / ming_persona 自己发），
  所以 AstrBot 文档里的「发送后钩子」在这里拿不到。**这是宿主条件，不是代码写错。**
- 于是把回执降一档：`on_decorating_result` → 写 `claimed`（要发了）。
  这仍然满足 E.4 的硬要求——「普通链路在**发完之前**取得归属，兴趣不得抢跑」；
  `handled`（真的发出去了）在这套部署里认不下来，**如实留 claimed，不伪造**。
- 实测：claimed 5 条，握手成功；兴趣候选只看 `not_handled`，所以这 5 条一条都不会被抢跑。
- `after_message_sent` 仍保留（换个部署可能就触发），日志降为调试级别。

### 2026-11-17 · E-3 第三批：补上「群 → DSH 会话」映射的生成方

- 缺口：`dsh-ming-interest` 的 `sessionForChat` 要读一张 `{ "group:<id>": "<session>" }` 的表，
  但**公开仓库里没有任何东西生成它**（`chatSessionsPath` 默认空串）。所以兴趣唤醒在 DSH 侧
  永远走不到投递那一步，只会记一条「这个群还没有会话」。
- 新增 `scripts/chat-sessions.mjs`：从 DSH 自己的会话文件名推映射。
  `~/.dsh/storages/*/sessions/onebot-group-<群号>-<后缀>.json` → 会话 id 就是文件名去掉 `.json`。
- **一个 chatId 留多个候选**（同一群/人有一堆历史会话）：带后缀的优先、体积大的优先。
  消费端按顺序 `agents.get` 试，第一个拿得到的就用——比赌一个准。
- `dsh-ming-interest` 的 `sessionForChat`：支持数组、兼容旧的单字符串、
  配置路径为空时回落到 `$MING_WORKSPACE/live/chat-sessions.json`。
- 本机实测：目前只推出 2 条（私聊 + 群 <group-b>）。**深水区 <group-a> 还没有 DSH 会话**——
  要在那个群里 @ 一次让 DSH 建会话，映射才会有它。这不是脚本的问题。
- 自测 `test-support/qa-chat-sessions.mjs` 14 项（多候选排序、非 onebot 不进、--dry 不写）。offline 23 → 24 项全过。

### 2026-11-17 · I 第四批：收到就让桌宠冒一句

- 她说的：「让桌宠来说嘛，这本来就是桌宠部分的内容」。
- `lib/webpick.mjs` 加两个回调：`onPick`（收到一段）/ `onTake`（被取走），都是可选、失败不影响收下。
- 她说「和之前那个桌宠插件一样就好了」——翻回老代码，0.3.0 收到网页取文走的是
  `onWebPick → speakWeb`：**桌宠读完那一段，自己说一句**（会给模型）。现在照同一条路：
  `onPick` 收到完整记录 → `lastPickNote` 记上 → `stopTalker.speakWeb(rec)`；
  speakWeb 不可用（没开自动开口 / 宿主没给模型）才降级成冒个字数。
- 自测 31 → 36 项（回调次数、带字数、带 requestId、取走也回调）。
- 运行目录已同步，**要重启 DSH 才生效**。

### 2026-11-17 · I 第三批：取文并进桌宠自带的那个扩展（不另做一个）

- 桌宠插件本来就有浏览器扩展 `dsh-ming-mousepet/extension/`（「溟的网页取文」0.3.0，右键「溟：指一段」），
  我先前另做了 `browser-ext/webpick/`——**重复了**，已删除。功能并回原扩展。
- 扩展升到 **0.4.0**：
  - 目标从 sidecar 的 `47322/webpick`（收到就覆盖、没配对、没请求身份）
    换成桌宠插件自己的口 `51557/dsh-ming-mousepet/api/webpick/pick`。
  - 带 `token`（选项页填）、带 `requestId`、忙时 409 **不覆盖不重试**、超长 413。
  - 新增选项页（`options.html/js`）：填地址与 token，带「测一下连接」。
  - manifest 加 `storage` / `notifications` 权限与 `options_page`。
- 47322 那条老路没拆（sidecar 一个字没动），要回退在选项页改地址即可。
- 两个入口都保留：右键「溟：指一段」指认整块；选中文字 → 右键「交给溟：看这段」/ `Ctrl+Alt+S`。
- 运行目录已同步（`dsh-ming-mousepet/extension/`），扩展要在浏览器里刷新一次才生效。

### 2026-11-17 · G.5 第二轮：登录后不用重启，工具立刻用新 cookie

- 病根：`BilibiliOfficialProvider` 构造时把 cookie 抄成自己的字段，之后改 options 它不看。
  于是「扫码成功了，但搜索/字幕还是匿名」——以前只能靠重启 DSH。
- 新增 `lib/provider-holder.mjs`：工具闭包里拿到的是一个 **Proxy**，真身放在里面；
  `swap(cookie)` 只换真身，代理不变，工具不用重新注册。
- 接入 `index.js` 三处：登录成功 → `swap(新 cookie)`；退出 → `swap('')`；启动恢复成功 → `swap(恢复的 cookie)`。
- 社交面本来每次请求前现读凭证文件，不受这个病影响（已确认）。
- 自测 `qa-provider-holder.mjs` 16 项（转发、swap 后同一代理看到新实例、退出回匿名、历史不记 cookie 值、方法 this 绑定）。offline 22 → 23 项全过。
- 运行目录已同步，待重启生效。

### 2026-11-17 · J-3 第二批：dry-run 计划（不调模型、不动 current）

- `scripts/rag-index.mjs` 加 `plan`：读现有 `doc-emb-manifest.json`，扫源目录，报「将新增/修改/删除多少文件、约多少块」。
- **口径必须和 doc-emb 一致**，否则会报一堆假「新增」：只收 `.md`，跳过 `verbatim` / `backup` / `qqagent-chat` / `group-digest` / `qq-sources` 五个目录。
  （第一版两种都错了：先漏了只收 md，报出 12009 个假新增；再补齐跳过规则才对得上。）
- manifest 里存的是绝对路径时先相对化，否则顶层目录会被认成盘符 `C:`。
- 本机实测：1215 个文件 → 新增 18 / 修改 21 / 删除 9 / 未变 1176；约新增 132 块、重算 1172 块。
- 明确不估 web/qq（源是聊天记录，要读数据库）。
- 自测加 8 项（全未变、改一个、加一个、删一个、.txt 不计、不动 current）。26 项全过。

### 2026-11-17 · K-2：把「本插件组装了多少」和「上一轮真的送了多少」摆在一起

- 新工具 `scripts/inject-report.mjs`：读 K-1 的快照（`live/inject-account.json`）+ 用量账本
  （`~/.dsh/dsh-bottom-info-bar/usage-ledger.sqlite` 的 `records` 表），三档分开显示：
  - ① 组装值：分块表（原文/包装/省略）+ 总长 + 对账结果；
  - ② 实际请求：最近 N 轮的 `input` / `cacheRead` / `cacheWrite` / `output` / `sessionId`；
  - ③ 费用估算：不在这里重算，指到 `graph/cost-lib.mjs`。
- **不拿字符推 token**：脚本自己写明「输入 token 是整轮请求（历史+工具+附件+系统提示+本插件），不是本插件那一段」。
- 本机实测：组装 33236 字（人设 27793 + 日记 4997），同期实际请求 input 7702 tok、缓存命中 468096 tok——
  这正是 K.2 要分开展示的三层，混成一个「总花费」就看不出来了。
- 账本缺失时如实报「读不到账本」，不编数字；没有快照时说「没有快照」，不崩。
- 自测 `test-support/qa-inject-report.mjs` 21 项（合成快照 + 合成 sqlite）。offline 21 → 22 项全过。

### 2026-11-17 · I 第二批：并进桌宠插件（不再单独起进程）

- 接收端从 `scripts/webpick-recv.mjs`（独立 47323 服务）搬进 `dsh-ming-mousepet/lib/webpick.mjs`，
  挂到桌宠自己的 `webServer` 上：`/dsh-ming-mousepet/api/webpick/{pick,consume,status}`。
  少一个常驻进程，端口跟着 DSH 实例走。
- `index.js` 加三处：创建实例（落盘目录取 `webpickDir` → `MING_WORKSPACE/live/webpick` → `~/.dsh/ming-mousepet/webpick`）、
  API 路由、新工具 `webpick`（`status` 只看字数 / `take` 取走正文并标记已取走）。
- **CORS/OPTIONS 交给 lib 处理**：原来的 OPTIONS 分支回 204 但不带 CORS 头，扩展的预检会失败。
- 扩展默认端点改成 `http://127.0.0.1:51557/dsh-ming-mousepet/api/webpick`（选项页可改）。
- 不再动桌宠 sidecar（47322 那条老路原样留着，两套互不影响）。
- 自测改成两层：先测纯 lib（不依赖网络），再用 `http.Server` 包一层测真实 HTTP（含预检、401、409、converse、怪 id）。31 项全过。
- 运行目录按同样四处打补丁（**没有整份覆盖**——那份和仓库分叉了，覆盖会丢东西），`node --check` 通过，待重启生效。

### 2026-11-17 · I 第一批：浏览器取文的接收端 + 扩展（配对 / requestId / 忙状态）

**为什么另起一个口**：桌宠 sidecar（47322）现在是「POST 就覆盖 webpick.json」——没配对、没请求身份，
连交两段会互相覆盖。改它要动 C# 嵌入代码 + PS 5.1 的 BOM/CRLF，风险落在她正在用的桌宠上。
所以新起 47323，老路原样留着。

- `scripts/webpick-recv.mjs`（Node，本地 HTTP）：
  - **配对**：`X-Ming-Token` 不对一律 401，**不落盘**；token 首次启动自动生成在 `~/.dsh/ming-mousepet/webpick-token.json`。
  - **请求身份**：按 `requestId` 落盘到 `live/webpick/<id>.json`，另有 `current.json` 指针；id 只留字母数字下划线连字符，不穿越目录。
  - **忙状态**：上一段没 `/consume` 之前，第二段回 409 + pendingId，**不覆盖**。
  - **上限**：正文 2 万字、请求体 256KB，超了 413 不落盘。
  - 不打印正文，不把 token 写进日志。
- `browser-ext/webpick/`（MV3 扩展）：右键「交给鱼看这段」/ 点图标；只发当前选中文字；
  401 → 提示配对失败并打开选项页；409 → 说「上一段还没取走」，**不重试**；413 → 说太长。
- 自测 `test-support/qa-webpick.mjs` 27 项（起真的接收端子进程：无 token、错 token、缺字段、超长、
  正常落盘、忙不覆盖、consume 后放行、超大 body、怪 id）。offline 20 → 21 项全过。
- **没做的**：消费端闭环（现在是收下来落盘，还没有「鱼读到并回答 → consume」那一步）；
  扩展没打包、没上架；sidecar 那一路一个字没动。

### 2026-11-17 · J-3 第一批：索引代际快照、校验与回退

- 新增 `scripts/rag-index.mjs`（**不生成向量**，只管发布与回退）：
  - `verify`：逐层核文件在不在、条数与字节数推得出来的维度、manifest 的 rowCount/维度对不对。
  - `snapshot`：拍一代到 `live/rag-index/generations/<gen>/`，再原子写 `current.json`（临时文件 + rename）。
    **维度/条数对不上就拒绝发布**——「不能只写一半」；只有「没 manifest」这种可容忍项才放行并提示。
  - `rollback <gen>`：先把当前存成 `pre-rollback-<ts>` 代，再把旧代拷回 `live/`，current 记着回退到哪。
  - `list` / `keep=N`：只留最近 N 代，**当前正在用的那代永远不删**。
- 修了一个自己造出来的坑：代名精确到秒，同一秒连发两次会撞名覆盖上一代。改成撞名就 `-2 / -3`。
- 实测：给真实三层索引（doc 12951 / web 7866 / qq 15158，全 768 维）拍了第一代快照 `20261117-041844`。
- 自测 `test-support/qa-rag-index.mjs` 18 项（合成小索引：坏索引拒发、两代并存、回退、keep 与当前代保护）。offline 19 → 20 项全过。
- **读取端没改**：`rag.js` 仍读 `live/` 那一份。代际目录是回退用的备份，不是切换目标——切读端要动正在用的检索，留到下一轮。

### 2026-11-17 · E-3 第二步：接上 not_handled 生产者，兴趣候选正式切 v2

- **生产者**（`astrbot_plugin_reply_policy`，本机插件）：判「不接」时往 `qq-inbox.jsonl` 追加一条
  `kind: "outcome" / normalHandling: "not_handled"`，带 `reason`（quota / lottery / preflight-no / preflight-unsure）。
  加在四处：额度用完、抽签未中、第一轮判「不接」、第一轮「拿不准」。
  旁路写入，失败不抛——不能因为记状态影响回不回。
- 实测：重启后 45 秒内出现 6 条 `not_handled`，reason 全是 `lottery`，事件流是
  `message(pending) → outcome(not_handled)`。
- **消费者**（`dsh-ming-interest/index.js`）：候选判定切到 v2 —— **只有 `not_handled` 才进兴趣候选**。
  `pending`（收到但还没定）/ `claimed` / `handled` 一律不抢跑。
  旧格式（没有 v2 字段）保持原判据，且只认显式 `stage`。
- 新增 `seenFrames` 缓存：`outcome` 是几秒后才到的另一行，那时本批里只有它，靠这个把 `frame` 找回来（只留 500 条，重启即丢，可接受）。
- 没加生产者的路径（AI 说话、@别人、宵禁静默）**不会**进兴趣候选——那些场合本来就不该插话，这是有意的。
- offline 19 项全过；`qa-inbox` 25 项在仓库和运行目录各跑一遍都过。

### 2026-11-17 · J-4 检索评测：合成语料 30 题，离线可跑

- 新增 `test-support/rag-eval.mjs`：**合成语料**（doc 8 / web 6 / qq 6 条）+ 确定性假嵌入（3-gram 哈希到 768 维），
  不联网、不读真实索引、不碰私人语料（J.9 的要求）。
- 30 道题分六类：direct 8 / synonym 6 / disambiguation 5 / date 4 / same-text-diff-source 3 / no-answer 4。
- 指标：Hit@1/3/5、MRR、按分类命中、耗时 p50/p90；逐题明细写 `test-support/rag-eval-report.json`，便于改前改后对比。
- **硬性只卡确定性**：同文不同来源必须跨层命中且 `src` 与 `layer` 一致（3/3 通过）。
- 记录到的基线（合成语料 + 假嵌入，不代表真实召回）：Hit@1 约 0.35、Hit@5 约 0.6；
  synonym 和 disambiguation 两类明显偏低——**这是假嵌入的能力上限，不是 rag.js 的 bug**，别拿这个数说真实检索差。
- `no-answer` 题「有误报」不是缺陷：检索层不做相关性阈值，只排前 k。要让「没答案就说没答案」，得在消费端加阈值，是另一件事。
- 真实验收还得她本人拿 5–10 个自己知道答案的问题核命中原文、来源和日期——这个我替不了。
- offline 18 → 19 项全过。

### 2026-11-17 · G 第一批：一个账号一个权威

- 新增 `dsh-ming-bilibili-account/lib/account.mjs`（纯逻辑，不联网）：
  - **写和清都两边一起**：DSH 凭证服务 + `credentialFile` 文件。哪边失败都写在返回值里，不假装成功。
  - **退出写 tombstone**（`{loggedOutAt}`），不把文件删成空白——下次启动读到它就知道「是退出过」，不是「第一次装」。
  - **tombstone 优先**：即使凭证服务里还残留着旧 cookie，也按「已退出」处理，顺手把服务那份清掉。
  - **generation 防迟到**：每次登录/退出 `gen + 1`，异步恢复回来发现 gen 变了就丢弃，不覆盖新状态。
  - 坏文件标 `broken`、不崩、不装作已登录；没有 `SESSDATA` 的 cookie 拒绝保存。
- 接入 `index.js` 三处：启动读文件时 tombstone 视为未登录（修掉「退出后从文件复活」）；`logout` 清服务+写文件；登录成功时服务与文件同步写，返回里分别标 ✓/✗。
- 自测 `qa-account.mjs` 25 项（假文件/假服务，不登录、不碰真实凭证）。offline 17 → 18 项全过。
- **未做**：provider 构造时仍冻结启动那一刻的 cookie（G.5 的第二轮）。改它要动 provider 内部，这轮不冒险。

### 2026-11-17 · E-3 第一批：消息身份、处理状态、发送回执

**AstrBot 侧**（`astrbot_plugins/astrbot_plugin_inbox_record/main.py`，v0.1.0 → v0.2.0）

- 入站记录升到 **v2**，新增：`eventId`（取平台 `message_obj.message_id`）、`idSource`（platform / generated）、
  `platform`、`botAccountId`、`conversation{kind,id}`、`senderId`、`sourceKind`、`receivedAt`、
  `normalHandling`（入站时 `pending`）、`sessionId`（未知时为 null）。
- **绝不用正文哈希做身份**：同一个人发两次「在吗」是两条消息。
- 新增 `@filter.after_message_sent` 回执：写一条 `kind: "outcome"` 的事件，引用同一 `eventId`，
  `normalHandling: "handled"`。**不改已经追加的旧行**，状态靠另写事件归并。
  回执只说明「AstrBot 自己发出去了」，平台侧确认不在这个钩子里，所以不写平台成功。
- 旧字段（`ts` / `kind="message"` / `decision` / `frame`）全部保留，旧消费者行为不变。
- 本机实测：`[inbox-record] v2` 加载成功、6199 在听、适配器已连接、无 Traceback；
  inbox 新行已带 `idSource: "platform"` 的真实消息 ID。

**DSH 侧**（`dsh-ming-interest/lib/inbox.mjs`，纯函数，尚未接管现有消费逻辑）

- `keyOf`：`platform|bot|会话类型|会话ID|eventId` —— 跨 bot、跨会话都不会误合并。
- `mergeEvents`：把 message 与 outcome 行归并成每条消息的最终状态；迟到的 `pending` 不会把 `handled` 打回去。
- `isInterestCandidate`：**只有 `not_handled` 才进兴趣候选**；pending / claimed / handled / failed / unknown 一律不进。
- `isLegacyCandidate`：旧格式要看显式 `stage`，不把 `decision.ok=false` 自动当成「没人回复」。
- `pruneState`：状态表只存 `status` + 时间，保留 7 天、上限 5000 条，不复制聊天正文。
- 自测 `qa-inbox.mjs` 25 项（E-T4 / E-T5 前提 / E-T6 / E-T7 / E-T11 / E.7），offline 16 → 17 项全过。

**故意没做的一件事**：没把兴趣候选切到 v2 判定。现在 AstrBot 侧只写 `pending`，
没有生产者写 `not_handled`——切过去会让兴趣唤醒直接停摆。
下一步要么由 `reply_policy` 在「决定不回」时写 `not_handled`，要么保持双轨到有生产者为止。

### 2026-11-17 · L-4/L-6 + F-3：runner 自测、兼容表、最小安装文档

- **runner 自测** `test-support/qa-runner.mjs`：验的是「check.mjs 会不会骗人」——故意失败必须非零（L-T2）、缺条件显示 SKIP 且不计通过（L-T3）、拼错套件明确报错（L-T4）、`--only` 只跑一项。12 条断言，全过。
  - 配套 `test-support/qa-fixture-fail.mjs`：只给 `--suite=fixture` 用的故意失败项，永远不进 offline。
- **兼容表** `docs/compatibility.md`：只写实测值（Windows 10.0.26100.8457 / Node v24.21.0 / PowerShell 5.1 / DSH 0.2.2-rc.1 / AstrBot 4.29.4 / Chrome 157），未验项逐条列出来（I 扩展没联调、G 没扫码、中文空格路径没实跑、干净安装没做、向量质量没评测）。
- **最小安装** `docs/install.md`：分清源码仓库 / 数据工作区 / 宿主配置三处；给递进组合（先记忆 → UI → 自己玩 → 声音桌宠 → QQ）；外部组件缺了怎么降级。
- **构建可移植验收** `test-support/qa-portability.mjs`：把全仓 src + build.mjs 复制到临时目录，从**无关 cwd** 跑 graph/memory 构建。13 条断言覆盖 F-T1/T2/T4/T5：产物落包目录、不写到 cwd、`MING_ROOT` 指错必须非零退出、改源→check 报过期→重建→通过。
- offline 套件 14 → 16 项全过。

### 2026-11-17 · K-1 旁路统计：把「本插件拼了多少」和「模型收到多少」分开

- `dsh-ming-memory/index.js`：`compose` 拼完文本后顺手算一份分块快照（**不改拼接顺序、不改预算、不往提示词加字**）。
- 分块：heading / persona / diaryHeading / diary / notes / ledger / discipline。
  - `includedChars` 只算原文；`wrapperChars` 算标题、分隔、截断提示。
  - **分块相加必须精确等于 `text.length`**，快照里带 `checksumOk`；对不上就是漏算/双算。
  - 日记被预算省掉时只报**篇数**（`omittedUnit: 'files'`），不伪造字符数；被截断的单列 `truncatedFiles`。
- `uncovered` 明写这一层看不见的：`host_history` / `tool_schema` / `attachments` / `ming_live_block` / `core_memory_injected`。
  `tokenEstimate` 与 `providerUsage` 都是 `null`——没测就不填 0。
- 落盘：`live/inject-account.json`（最近一次）+ `live/inject-account-YYYY-MM-DD.jsonl`（一天一行摘要）。**只存数字和 key，不存正文副本。**
- 导出 `lastAccountSnapshot()` 给面板/状态接口读；写盘失败不影响开场。
- 自测 `qa-inject-account.mjs` 20 项（全装档、压预算档、落盘无正文、对账精确）。offline 13 → 14 项全过。

### 2026-11-17 · J-2 索引清单（manifest）：读端会核对，不再盲信 768

- 新文件 `dsh-ming-core-memory/lib/rag.js`：每层可有一份 `<layer>-emb.manifest.json`（doc / chat / qq）。
- **没有清单 = 旧格式，照读**，只在 `issues` 里记一条 `manifest-missing`（`severity: info`），不把状态打成 partial。
- **有清单就核**：schemaVersion=1、layer 与目录一致、`embedding.dimensions` 等于查询端 DIM、条数等于实际向量行数。
  - 维度不符：该层不加载（不拿 768 去读 512 维的字节）。
  - **模型名不同也拒**——维度相同不代表模型相同，不同向量空间的点积不能混排。
  - `files` 里出现 `..` 或路径分隔符：拒（只接受同目录裸文件名）。
- 状态口径：只有 `severity: error` 的 issue 才让 `status` 变 `partial`；info 不影响。
- 新工具 `scripts/rag-manifest.mjs`：读现有索引产物写清单，**不重建、不连嵌入服务**。维度从 `字节 / 4 / 条数` 推，除不尽就报错不写。
  **model 注明未核实**：`verified: false`、`revision: unknown`、`modelSource` 写明来源——不凭配置字符串给旧索引盖章。
- 自测：新增 `qa-rag-manifest.mjs` 11 项；`qa-rag-availability` 一条断言随 info 项更新。offline 12 → 13 项全过。

### 2026-11-17 · H-3 主体名单按会话段匹配（自己人放行）

- 她 11:5x 补边界：**browse_only 只管没有 DSH 远端调用权的主体**；她、溟、阑珊都放行。
- `lib/permissions.mjs`：`subjects` 名单从「整串相等」扩展到「按 `- _ : .` 切段后整段相等」。
  会话 id 形如 `onebot-private-<owner-qq>-mvgpinr5`，所以名单里写 QQ 号就能命中，不用背整串。
  **不做子串猜**：`3737` 不会命中 `<owner-qq>`。
- 花钱类（`pay`）在任何名单里都不放行。
- 自测 47 → 54 条（新增 7 条：号命中、另一个自己人、会话名、名单外号、不子串、花钱仍拒、号在中间）。
- 本机配置（不进仓库）：`permissionPolicy.subjects = ['<owner-qq>', '<friend-qq>', 'ming-browse']`。

### 2026-11-17 · E-2 决策：DSH 决定回复，输出自然语言摘要

- 决策记录：[docs/E-2-决策-20261117.md](docs/E-2-决策-20261117.md)。
- **DSH 是唯一决策方**：一条消息要不要回、回什么，在 DSH 侧定；AstrBot 侧保留调度（什么时候叫醒），不并联判断。
- **回复形态是自然语言摘要**：直接说出口的整段话，不是结构化 JSON、不是「意图 + 参数」。摘要不等于截断，多段结论要合成一段说得清的。
- 投递结果要回写同一条事件记录，「已发送」不能代替「真的发出去了」。
- 解锁：E-3（事件身份、去重、端到端收发）可以开工；H-2 仍差实际部署的目标清单。

### 2026-11-17 · E–L 第一批（离线可做的那部分）

交接书见 [docs/Hers_Life_E-L_详细实施与验收交接书.md](docs/)。

- **E-1**：`astrbot_plugin_inbox_record` 的入站文件路径可配（`MING_INBOX`，和兴趣唤醒同一个变量名），写前自动建父目录。**不涉及**「谁来决定回复」，那是 E-2/E-3。
- **F-1**：`dsh-ming-graph/build.mjs`、`dsh-ming-memory/build.mjs` 不再依赖作者机器上的 `C:/dsh`；根目录取 `MING_ROOT`，没设就取脚本上一级。生成物按新规则重建，指纹未变。
- **F-2**：`dsh-ming-voice/say.mjs` 的 ffplay 路径改用 `MING_FFPLAY`（缺省走 PATH），试听输出落到 `MING_WORKSPACE/live/voice`；`dsh-ming-browse` 的 `ownerQQ` 支持环境变量 `MING_OWNER_QQ`（优先级仍是插件配置最高）。
- **H-1**：README 里「自己玩＝只读、点按被硬拦」的说法改成实际行为——只有部分 Android 点按与关机/重启被拦，其余放行。
- **J-1**：全局 RAG 命中结果的来源标签按层写（`web`/`qq`），不再把 web 命中标成 QQ 原话。排序、范围、三态语义不变。
- **L-1**：新增 `scripts/check.mjs`：显式清单 + `offline/build/host/windows-live` 四档，PASS/FAIL/SKIP 分开，SKIP 不计通过；顺手修了 `dsh-ming-browse/qa-audit.mjs` 缺 `ownerQQ` 的 fixture（那两条开关用例此前一直空转）。

**未做（见 docs 里的 E–L 交接书）**：E-2/E-3、F-3、G 全部、H-2/H-3、I 全部、J-2~J-4、K 全部。都需要朋友的实际环境或一次明确的取舍。

## 1.1.1 — 2026-11-16

只有文档，代码一行没动。

- 新增 **[RECORDS.md](RECORDS.md)**：告诉别的 agent（以及别人装这套时的自己）记录该写成什么格式。
  内容分三层——哪个目录被哪个插件读、文件名和 frontmatter 的硬要求、哪些写法错一个字就**静默读不到**。
  几个容易踩的点写进去了：日记有两个读者两套正则（`2026-11-16-2.md` 进提示词但不进星图）、
  见闻在面板里是一条一行且跳过 `#`/`>` 开头的行、群友页少一个 `id:`/`group:` 就等于这个人不存在、
  核心记忆只注入前 3000 字符。逐条对着源码核过，末尾附了核对位置（文件 + 行号）。
- README 开头加一行指针；「只在一台实例上装」那句去掉项目自称。

## 1.1.0 Remake — 2026-11-15

这一版把 11-11 之后四天改过的东西收回仓库，并重新声明后端：**1.1.0 Remake 起不再支持 QQ-Agent，改为支持 AstrBot 4.29。**

### 关系图（dsh-ming-graph 1.1.0）
- **新增「展示」页，并设为默认落地页**：开面板不再一上来就建神经元（那条要扫一遍记忆库，约两秒，之后每帧刷一遍点）。
  展示页只数数：四块数字、近 14 天新增记忆柱状、标签占比环、近 10 周热力、最近在办与最近写的两张表。
  数据走新增的 `/_dsh/dsh-ming-graph/overview`——只读目录与几份文件头，实测二三十毫秒，30 秒缓存。
- 神经元改成**真切到那一页才读盘**；读过的数据留在内存，切回来只重挂，不再读盘。
- 神经元与星图加**「点数」上限**（200 / 400 / 600 / 1000 / 1500 / 全部）：人、项目、日记不裁，只裁记忆，先留连得多的再按时间。
- 费用页的 `/cost` 从「面板一挂载就轮询」改成只在费用页打开时拉（那条要扫七万行 sqlite）。

### 记忆与 RAG（dsh-ming-core-memory 1.0.2 / dsh-ming-memory 0.2.0）
- 全局 RAG 五层：doc（写下来的字）/ web（网页会话）/ qq（群与私聊，含旧壳语料），一次问完。
- 建索引时先排除群聊素材，避免「索引满了之后先记得最吵的那个」。
- 工作区路径不再写死，一律从 `MING_WORKSPACE` 取。

### 其它
- 十二个包按各自改动正常提版本：桌宠 1.0.1，B站 / 浏览 / 兴趣 / 唤醒 / 插话回位 / skill 隔离 / 语音 各 0.1.1。
- 隐私：仓库里的本机路径、QQ 号、群号、用户名换成 `MING_WORKSPACE` 或占位符；两个 >1MB 的测试采样移出仓库。

## 1.1.0 — 2026-11-11

十二个包齐全之后的第一个正式版本号。

这一版的正事是**换壳之后的接口对齐**：QQ 侧从 QQ-Agent 迁到 AstrBot 4.29。

- 新增 `astrbot_plugins/astrbot_plugin_inbox_record`：把 AstrBot 收到的每条消息按旧格式
  追加进 `~/.dsh/media/onebot/qq-inbox.jsonl`。原因是那个文件原本由 QQ-Agent 的 onebot
  插件写，换壳后 13:06 就停了，`dsh-ming-interest`（兴趣唤醒）因此读不到任何新消息。
  补上之后**兴趣唤醒侧零改动**就能继续工作——它只认那一个文件的格式。
- README 加「消息源：AstrBot（QQ-Agent 已停用）」一节，写清这套插件不绑某个 bot 后端，
  唯一硬依赖是兴趣唤醒读的那个 jsonl。
- 其余十一个包**代码未变**。

打这个版的原因：README 里第一次把十二个包（记忆、图、桌宠、浏览、兴趣唤醒、
定时唤醒、插话回位、skill 隔离、B 站、语音、面板）写成一份完整清单，
1.0.x 还是「光标拆出去」「桌宠合并」那种边拆边发的号。清单齐了，号就归位。

## 1.0.4 — 2026-11-11

- 桌宠：加常态识别（画面动了才留帧）与配置持久化
- 光标并入完整版桌宠，`dsh-ming-cursor` 不再单列
- 关系图：面板拆成独立渲染

## 1.0.3 — 2026-11-11

- 记忆与关系图加完整版检测
- 光标移出本仓

## 1.0.2 — 2026-11-10

- 光标独立成包；外部页签协议；隐私中性化（人名换成「她」）

## 1.0.1 — 2026-11-09

- 桌宠卡片跟随、框选期收起、右键二级菜单
- DSH 会话桥与网页取文

## 1.0.0 — 2026-11-08

- 面板加「打开我的浏览器」
- qa-audit 补 inject mock；导出脚本 `--check` 真演练替换
