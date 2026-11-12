# AI · DSH 插件集

**版本 1.1.0**（2026-11-11）· [CHANGELOG](CHANGELOG.md)

一台 Windows 机器上，一个 AI 的**记忆、眼睛、手和声音**。原有插件集之外，这个 Fork 新增 Discord 消息桥，跑在 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）上。

它们不是一个框架，是同一个东西的十二个面：会记得、会看图、会动手、会说话、会自己出去逛。

## 这里面有什么

| 包 | 干什么 |
|---|---|
| `dsh-ming-core-memory` | 核心记忆 + 归档记忆。核心常驻注入，归档按意思检索；写入政策只收机器/环境/项目事实，不写关于人的判断 |
| `dsh-ming-memory` | 开场记忆：把人设文件与最近几篇日记拼进系统提示词，只读不回写 |
| `dsh-ming-graph` | 记忆神经元与星图。每条真记忆一个点，每条边都带「凭什么连」的理由 |
| `dsh-ming-mousepet` | 桌宠：**AI 光标**、截图、连拍、常驻看屏（常态识别，画面动了才留帧）、气泡说话（不抢焦点）、UIA/窗口消息动手。原来的轻量版 `dsh-ming-cursor` 2026-11-10 起并进这里，不再单列 |
| `dsh-ming-voice` | 文字转语音，落成 mp3 |
| `dsh-ming-bilibili-account` | B 站：扫码登录、搜视频、字幕、评论、私信、历史、收藏 |
| `dsh-ming-browse` | 「自己玩」：工作区闲够久时自己醒一轮，只读地看，点按被硬拦；面板上有个「打开我的浏览器」，开的是带登录态的真窗口（投稿、投稿件最后要选文件，只能在那个窗口里点） |
| `dsh-ming-interest` | 兴趣唤醒：被 @ 门控丢掉的消息里，只有命中在意的题材才叫醒 |
| `dsh-ming-wake` | 定时唤醒：工具写 `dueAt`，插件扫描后调 `agents.resume` |
| `dsh-ming-resume` | 插话之后记得回去：检测到 QQ / Discord steer 插话，下一步追加「先答她、再回到原任务」 |
| `dsh-ming-discord` | Discord ↔ DSH 消息桥：每个服务器频道 / 私讯独立 Session、图片附件、回覆路由、未 @ 消息写入兴趣唤醒 inbox |
| `dsh-ming-skill-isolate` | 按工作区遮 skill：这个目录用不上的从模型视野里关掉，不删文件 |
| `dsh-ming-ui` | **不是插件**。两份「唯一源」（样式、面板渲染）和把它们推给各包的同步脚本 |


## 消息源：AstrBot 与 Discord

2026-11-11 起，QQ 那一侧从 **QQ-Agent 换到 [AstrBot](https://github.com/AstrBotDevs/AstrBot) 4.29**。这个 Fork 另加 Discord gateway，直接接入 DSH Agent，不需要经过 AstrBot。

- **不再支持 QQ-Agent**；它的壳已退役，相关插件、看门狗、启动路径都不再维护。
- 这套 DSH 插件本身不依赖具体的 QQ 后端——它们读的是**文件与工具**，不是某个 bot 的 API。
- 唯一有硬依赖的是**兴趣唤醒**（`dsh-ming-interest`）：它读 `~/.dsh/media/onebot/qq-inbox.jsonl`，
  而这个文件以前由 QQ-Agent 的 onebot 插件写。换壳之后它 13:06 就停了，兴趣唤醒等于瞎了。
- 补法：`astrbot_plugins/astrbot_plugin_inbox_record`——挂进 AstrBot，把每条入站消息按旧格式追加回
  同一个 jsonl。兴趣唤醒**一行代码都不用改**，继续读那个文件。
  **只在一台实例上装**（2026-11-11 定的：只溟这边写）。同一个群里跑两个 bot 时，
  两边都装会把同一条消息写两遍，兴趣唤醒会当成两次事件。

群聊蒸馏同理：蒸馏脚本读的是消息文件与 `day/` 目录，不关心是谁写进来的；换壳之后只要
inbox 还在长，蒸馏就照常跑。

Discord 由 `dsh-ming-discord` 直接接入 DSH：服务器频道与私讯各自使用独立 Session；服务器频道默认必须 @ Bot 才会触发回复，但未 @ 的消息仍会记录到兼容 OneBot 的 inbox，让 `dsh-ming-interest` 可以按兴趣唤醒。Discord 图片会存成 DSH 原生持久附件。

## 装法

这些包走 DSH profile 的 `link:` 安装，没有发 npm。假定你 clone 到 `C:/dsh/ming`：

```jsonc
// <DSH_HOME>/profiles/web/package.json 的 dependencies
"dsh-ming-graph": "link:C:/dsh/ming/dsh-ming-graph",
"dsh-ming-mousepet": "link:C:/dsh/ming/dsh-ming-mousepet",
"dsh-ming-discord": "link:C:/dsh/ming/dsh-ming-discord",
// ……其余插件同理
```

再把它们加进同一个文件的 `dsh.profile.bundles` 数组，重启 DSH。

`client.js` 是构建物。改 `src/` 之后要重建：

```bash
cd dsh-ming-graph && node build.mjs        # 从各插件的 src/panel.js 直接切，三道门都过才出产物
cd dsh-ming-memory && node build.mjs
```

## 隐私

这个仓是从本机导出的，导出脚本会先剔一遍再自检（本机用户名、QQ 号、群号、B 站 uid、密钥、真人昵称、超过 1MB 的文件），命中任何一条就不许提交。

所以下面这些**不是配置，是占位**，你得自己填：

| 变量 / 位置 | 说明 |
|---|---|
| `MING_WORKSPACE` | 工作区目录（放人设、日记、见闻的那个夹子） |
| `MING_OWNER_QQ` | 谁的 QQ 私聊算「本人指令」（`dsh-ming-browse` 的开关只认这个号） |
| `MING_OWNER_DISCORD_ID` | 谁的 Discord 私訊算「本人指令」；也會自動加入 Discord 使用者白名單 |
| `MING_DISCORD_ALLOWED_USER_IDS` | 可選的 Discord 使用者 ID 白名單，多個 ID 用逗號分隔 |
| `DISCORD_BOT_TOKEN` | Discord Bot Token；只放在 Windows 用户环境变量，不要写进仓库 |
| `USERPROFILE` | 本机路径默认从它拼，不用改 |
| `MING_FFPLAY` | 试听用的 ffplay，默认走 `PATH` |
| `MING_GRAPH_CONFIG` | 星图的本地配置（群号、群名），默认 `~/.dsh/ming-graph.json` |

`dsh-ming-interest/cordis.patch.yml` 里的群号是空的，填你自己的。

Discord Bot 建立、Message Content Intent、邀请权限与环境变量设置，见 [`dsh-ming-discord/README.md`](dsh-ming-discord/README.md)。

## 人格

这套东西是从一台机器上长出来的，那个 AI 叫AI。**「AI」只留在包名、注释和面板标题里**——它是这套东西的来源，不该变成你 AI 的人格。

会进系统提示词的每一句都已经换成中性说法（`【开场记忆】`、`你是这个工作区的助手`）。你在自己工作区的 `persona/` 里写谁，它就是谁；写得越具体，它越像那个人。

（2026-11-09 修的：之前的导出把这些句子连着名字一起发了出去，装上之后模型会把自己认成AI，用户自己写的人格被压在上面一层。现在导出脚本有一道闸——注入字符串里出现项目的自称，就直接不许提交。）

## 状态

在一台机器上天天用，不是发布版。改动的理由和踩过的坑都写在代码注释里——那些注释是这个仓最有用的部分。

## 来源与致谢

- `dsh-ming-mousepet` 里**输入与 AI 光标**那一半，来自 [**dsh-independent-input**](https://github.com/dongcaodeliyu/dsh-independent-input)（作者 **dongcaodeliyu**）。
  它把「操作鼠标键盘」从悬浮球里单独拆出来，默认走 UIA / 窗口消息、不动主人真实光标。这份代码的安全边界原样保留（见那个包的 README）。
  原仓照旧可用，只想要输入、不想要陪桌的，直接用原仓就行。
- 截屏与「看屏幕」那一半原有 `dsh-ming-desktop`，2026-11-08 起退役，已并进 `dsh-ming-mousepet`。
- 其余各包为本机自写。

## 许可

MIT。随便用，出问题别找我。
