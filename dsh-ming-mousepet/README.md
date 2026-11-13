> **这个仓已并入 [Hers_Life](https://github.com/Chess12333/Hers_Life)，后续更新只在那边。**
> 这里保留历史版本，不再单独发版；装完整版请用 Hers_Life。

# dsh-ming-mousepet

桌面上陪着她。看得见、会说一句话、也能动手——三件事本来分在两个插件里（`dsh-independent-input` 负责输入和 AI 光标、`dsh-ming-desktop` 负责看），这个插件把它们并成一个。

2026-11-08 起。起因是她说「把电脑操作插件和独立光标插件合在一起做一个新插件，像是在桌面陪伴，偶尔还会说两句话」。

## 数据目录

设置环境变量 `DSH_HOME` 后，桌宠设置、用户皮肤、截图、网页选取资料、陪伴日志与环境帧都会写入该目录下的 `ming-mousepet/`。未设置时使用 `%USERPROFILE%\\.dsh`。内置光标与预览素材仍保留在插件自身的 `assets/`，不会搬动或删除。

## 两个工具

### `pet` —— 陪伴层（默认只读）

| action | 干什么 |
| --- | --- |
| `status` | 前台窗口、她多久没动、光标状态、今天说过几次 |
| `look` | 看一眼屏幕（可裁），图直接附上来 |
| `watch` | 连拍几秒，只回变化大的帧；静止画面只回一张 |
| `ambient` | 常态识别：`{on:true}` 一直看（画面动了才留一帧），`{on:false}` 关，`{frames:4}` 取最近几帧 + 时间线（附图） |
| `say` | 在桌面上说一句话：无边框气泡浮在她光标上方，几秒自己消失，不抢焦点 |
| `nudge` | 问「现在值不值得开口」，回 speak 与否 + 为什么 + 现在什么情况 |
| `cursor` | AI 光标 显示 / 隐藏 / 移动 / 大小 / 模式 |

`nudge` **不生成话**。它只回答该不该说、现在什么情况；说什么由模型自己写。
插件一旦开始编话，就会变成定时播报器，那不是陪伴。

判据（`lib/pet.js`）：

- 静音 00:30–10:30
- 她 15 秒内动过电脑 → 不说（正在用）
- 两次开口至少隔 10 分钟
- 一天最多主动说 6 次
- 她安静满 25 分钟才值得开口

### `pet_input` —— 动手层

`status / windows / capture / click / type / key / scroll / drag / move / pause / resume / overlay`。

默认 `auto` 会优先走 UIA / 窗口消息，避免移动真实光标或抢焦点；但**不是所有动作都保证零物理输入**：例如 UIA 聚焦后的文字输入，以及部分按键路径，在目标不接受窗口消息时可能回退到物理键盘。`mode:"physical"` 会明确要求物理输入。使用前要确认目标窗口；按 **Ctrl+Alt+Q** 可紧急暂停，物理输入路径会在检测到主人操作时暂停并尝试还原光标。

## 边界写在代码里

- 气泡用 `WS_EX_NOACTIVATE`，不夺焦点。
- `auto` 优先 UIA / 窗口消息，但部分 `type` / `key` 路径仍可能回退物理输入；若必须保证不触碰真实键鼠，应避免这些回退路径，明确使用可用的 UIA / message 模式并先在无敏感测试窗口验证。
- `watch` 是最便宜的一档：静止画面只回一张，不在那儿空转。
- `ambient`（常态识别，2026-11-10）：右键桌宠开关，开了就一直看。
  **节奏在 Node 侧**（`setInterval` 每 3 秒发一次 tick），sidecar 只负责截一张缩略图比变化；
  画面变化超过阈值（默认 3%）才留一帧 1280 宽 JPEG + 一行时间线，静止时只有一次截屏 + 粗网格抽样。
  帧落在 `<DSH_HOME>/ming-mousepet/ambient/`，超过 120 帧丢最旧的；`timeline.jsonl` 记 at/diff/前台窗口。
  为什么不放在 sidecar 里起线程：实测后台线程里 GDI 截图会卡死（diag 停在 tick:area），
  主线程（请求线程）同一份代码正常——所以「多久看一次」归 JS，「怎么看一次」留在 sidecar。
- 没有 `postinstall`，没有运行时依赖；侧车是 Windows PowerShell 5.1 + WinForms。

## 结构

```
index.js        工具层（pet / pet_input）
client.js       Web 侧设置页（光标大小/模式、显示/隐藏）
lib/engine.js   sidecar 客户端（一行一条 JSON）
lib/pet.js      该不该开口（nudge 判据）
sidecar.ps1     STA 常驻：UIA / 消息输入 / AI 光标 / 截图 / 气泡 / 帧差
assets/cursors  15 只 AI 光标（精灵图）
assets/previews 设置页预览
test/           sidecar 冒烟与输入测试
```

## 跑测试

```bash
node test/pet-test.mjs
```

起 sidecar，依次发 ping / status / say / watch，再确认说完话 sidecar 还活着。
`say` 会在屏幕上真的弹一个气泡——这是唯一能验证「她看得见」的办法。

## 已知

- `sidecar.ps1` **必须带 UTF-8 BOM**。PS 5.1 读无 BOM 的文件按 ANSI 解，中文注释会把字符串截断，整份解析失败。编辑这个文件之后记得补 BOM。
- 跟 `dsh-independent-input`、`dsh-ming-desktop` 目前并存；两套 AI 光标会叠在一起。替掉旧插件之前别同时开。

---

## 来源与致谢

这个插件是把两样东西并起来的，其中一样不是我的：

| 部分 | 出处 |
|---|---|
| UIA / 窗口消息那套输入、AI 光标 | [**dsh-independent-input**](https://github.com/dongcaodeliyu/dsh-independent-input)（作者 dongcaodeliyu），原仓照旧可用 |
| 截屏、看屏幕 | `dsh-ming-desktop`，我自己写的，2026-11-08 起退役 |

「独立」两个字是从前者带过来的：它的意思**不是**再装一套系统鼠标（Windows 只有一个光标和一个键盘焦点），
而是**不占用主人那套光标和焦点**——点击/输入优先走 UIA 或窗口消息，显式 `mode:"physical"` 会要求物理输入；但 `auto` 的部分操作在非物理通道失败时也可能回退，
而且物理输入路径会监测主人操作并尝试暂停、还原光标。

合并时我保留了它的这条安全边界，也保留了「物理输入是显式回退」这个默认值。要是有人只想要输入、不想要陪桌，
直接用上面那个原仓就行。

## 桌面上那只怎么用（2026-11-08）

- **轻点一下**：它说一句（相当于你叫它一声）。这一次不占「每天最多几次」的自动开口配额。
- **按住再拖**：挪位置。按住超过约 0.2 秒再移动才算拖，手抖不会把它拖走。
- **右键**：锁定 / 取消锁定、关闭显示。

## 指一下 / 卡片（2026-11-09）

对照 Pointy 补的两件事，做成我们自己的形状：

- **指一下**：`pet {action:"pick"}`，或由 `pet` 面板触发。光标停在哪就框哪块（UIA 从光标下往上挑「比整窗小一圈、又不是整屏」的那一块）；
  自绘窗口（MuMu、Chromium 壳）问不出子块时退成 720×320 的聚焦框。**回车**确认、`[` `]` 收放、`Esc` 取消，遮罩点穿透、不抢焦点，全屏时不启动。
- **能追问的卡片**：`pet {action:"card", question:"…"}` 开一张，答案流式写进去；空卡片可以直接在窗口里打字回车问。
  追问续同一段对话，关掉即忘。它用自己的 `llm.stream`，不走 DSH 会话桥——**我们的桌宠本来就有嘴**，不需要为了一张卡去开一个会话。
- **快答 / 深入**：气泡用简短回答提示词，卡片用结论优先的详细回答提示词。两档由 `lib/answer.js` 选择；这里直接调用 `llm.stream`，没有工具执行循环，不承诺联网或运行命令。
- **网页指一段**：扩展右键「溟：指一段」→ 光标下的语义块高亮 → 点一下交出去，带站点、作者、时间、BV 号、播放进度。老的「选中 + Ctrl+Alt+S」留着兜底。
- **提权程序不读**：`guard` 现在会看前台进程是不是管理员权限跑的，命中就拒。
- **卡片跟桌宠**：卡片开在桌宠右上方，桌宠一动它跟着挪（250ms）；她手动拖标题栏就停止跟随。`pet {action:"card", op:"follow", on}` 可拨开关（JS 侧要重启 DSH）。气泡=简易回复（quick），卡片=完整回复（full）。
- **会话桥**：`pet {action:"sessions"}` 列会话、`pet {action:"ask", sessionId, text, capture}` 把一句（连同 `<抓取内容>`）丢进真会话去跑，已确认归属的完整回答消息追加到卡片，不逐 token 显示；关联缺失或同轮混入其他请求时拒绝展示。卡片自己有嘴，这条只在她要「真去动手」时才用。关闭卡片只停止跟随，不代表已提交的 DSH 任务停止。这句话是 2026-11-09 当时的验收状态；它不是当前所有版本的实时测试结论。请以仓库根目录 `docs/VERIFICATION.md` 与最新宿主验收记录为准。

改 `sidecar.ps1` 之后**先跑 `node fix-ps.mjs`**：PS 5.1 要 UTF-8 BOM + CRLF，工具链会悄悄把它们弄丢，
症状是「报错指在第 30 行，坏的地方在第一个字节」（11-08、11-09 各踩过一次）。

契约测试：`test/card-contract.mjs`（11）、`test/card-ask-contract.mjs`（9）、`test/card-cancel-contract.mjs`（7）、`test/pick-contract.mjs`（10）、`test/session-bridge-contract.mjs`（20）、`test/session-lifecycle-contract.mjs`（17）、`test/session-correlation-contract.mjs`（7）、`test/answer-call-config-contract.mjs`（5）、`test/pet-action-routing-contract.mjs`（5）、`test/ask-branch-contract.mjs`（3）；另有卡片会话所有权、网页点击目标与无工具能力提示词回归。测试类型和未验范围见 `test/pointy-verification-20261109-1626.md`。

卡片回答要带模型路由：宿主 `GenerateOptions.provider` / `model` 是必填，路由取自 `talkerOptions`（`settings.json` 的 talkProvider/talkModel 优先，留空退回插件 config）。缺了当场报「没指定 provider/model」，不会再去撞适配器、更不会把它显示成「模型给的空话」。


## 光标设置页

当前仓库的光标设置页实现位于 `client.js` 的 `makeCursorPage()`，并以 `// >>> 共享光标页` 标记区包住。当前仓库树中没有旧文档提到的 `dsh-ming-ui/src/cursor-page.js` 或 `sync-cursor-page.mjs`；不要再照抄历史 `C:/dsh/...` 绝对路径或运行不存在的同步脚本。修改前先确认 `client.js` 当前实现与标记区，再直接维护本仓实际存在的源文件。
