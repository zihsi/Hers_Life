# AI · DSH 插件集

**版本 1.1.0**（2026-11-11）· [CHANGELOG](CHANGELOG.md)

一台 Windows 机器上，一个 AI 的**记忆、眼睛、手和声音**。这套 Fork 包含十二个 DeepSeek Harness（DSH）插件，并额外提供 Discord 消息桥。

它们不是一个框架，是同一个东西的十二个面：会记得、会看图、会动手、会说话、会自己出去逛。

## 统一安装入口（开发中）

本仓新增了统一入口 Bundle：`dsh-hers-life`。Agent 安装与 Plugins → Add plugin 使用同一个 Git Repository 安装目标：

`https://github.com/zihsi/Hers_Life.git#codex/unified-settings-20261114`

Agent 操作规范见 [HERS_LIFE_AGENT_INSTALL.md](HERS_LIFE_AGENT_INSTALL.md)，机器可读规格见 [hers-life.install.json](hers-life.install.json)。

**安全说明：** 整合 Bundle 的 Host 插件只会执行安全初始化；`security.privacyReady` 仍默认关闭，12 个功能子插件不会载入。独立的 Hers Life 设置伴随插件保持可用，让使用者能先完成设置。子插件只会在服务端闸门通过后才动态载入；DSH Client UI 入口也暂不注册，避免客户端先于服务端权限检查启动。原因是旧版跨会话记忆仍存在私人内容注入风险；必须先完成 Memory Access Controller 与回归测试，才会开放 UI 并解除闸门。安装后可在 DSH Settings → Hers Life 调整常用设置、凭据与环境路径；安装成功不等于 12 个功能插件已经启动。

## 这里面有什么

| 包 | 干什么 |
|---|---|
| `dsh-ming-core-memory` | 核心记忆 + 归档记忆。核心常驻注入，归档按意思检索；写入政策只收机器/环境/项目事实，不写关于人的判断 |
| `dsh-ming-memory` | 开场记忆：把人设文件与最近几篇日记拼进系统提示词；persona / diary 来源只读，但会维护运行时衍生资料 |
| `dsh-ming-graph` | 记忆神经元与星图 |
| `dsh-ming-mousepet` | 桌宠、AI 光标、截图、连拍、常态看屏、气泡说话与 UIA/窗口消息输入 |
| `dsh-ming-voice` | 文字转语音，落成 mp3 |
| `dsh-ming-bilibili-account` | B 站：扫码登录、搜视频、字幕、评论、私信、历史、收藏 |
| `dsh-ming-browse` | 「自己玩」：工作区闲够久时自己醒一轮；操作边界由插件规则限制 |
| `dsh-ming-interest` | 兴趣唤醒：观察兼容 inbox，命中兴趣时唤醒对应会话 |
| `dsh-ming-wake` | 定时唤醒：工具写入 dueAt，插件扫描后调 agents.resume |
| `dsh-ming-resume` | 插话之后记得回去：检测 QQ / Discord steer 插话并接续原任务 |
| `dsh-ming-discord` | Discord ↔ DSH 消息桥：频道/私讯独立 Session、图片附件、回复路由、未 @ 消息 inbox |
| `dsh-ming-skill-isolate` | 按工作区遮蔽 skill，不删除文件 |
| `dsh-ming-ui` | **不是插件**。共享 UI 样式、面板渲染与同步脚本 |

## 消息源：AstrBot 与 Discord

QQ 侧使用 AstrBot；本仓的 DSH 插件读取文件与工具，不绑定特定 QQ bot 后端。兴趣唤醒依赖兼容格式的 `qq-inbox.jsonl`，AstrBot 插件 `astrbot_plugins/astrbot_plugin_inbox_record` 负责写入。记录器默认写入 `<DSH_HOME>/media/onebot/qq-inbox.jsonl`（未设置 `DSH_HOME` 时为 `%USERPROFILE%\\.dsh`）；也可在 AstrBot 插件设置中用 `inboxPath` 指定完整路径。

Discord 由 `dsh-ming-discord` 直接接入 DSH：服务器频道与私讯各自使用独立 Session；服务器频道默认必须 @ Bot 才会触发 Agent 回复，但未 @ 的群消息仍会写入兼容 inbox，供 `dsh-ming-interest` 匹配。**目前 inbox 观察记录只写文字，不代表兴趣系统已经能理解未 @ 消息中的图片。**

## 安装与完整文件

本仓不发布 npm。**一般使用者优先使用新的 `dsh-hers-life` Git 整合 Bundle**（见 [Agent 自动安装与 Add plugin 指南](HERS_LIFE_AGENT_INSTALL.md)）；下方旧式 `link:` 安装流程保留给开发与旧 Profile 迁移使用。请先看：

- [Windows 11 完整安装指南](INSTALL.md)
- [十二个插件配置说明](CONFIGURATION.md)
- [Discord Bot 建立与连接](DISCORD_SETUP.md)
- [插件架构与消息流](ARCHITECTURE.md)
- [故障排除与已知问题](TROUBLESHOOTING.md)
- [安装验证记录](docs/VERIFICATION.md)
- [变更记录](CHANGELOG.md)

> 重要：本仓的安装方式针对 Windows 上的 DSH Desktop profile。不要直接照抄旧版示例中的 `C:/dsh/ming`、旧 Profile 名称或旧 MuMu ADB 路径。请以安装文件中的变量化路径和你的实际环境为准。

## 隐私

Bilibili 登录态由 `dsh-ming-bilibili-account` 通过 DSH Credentials 保存；`MING_BILI_COOKIE` 是凭证引用名，不是 Cookie 内容。旧版 `bili_credential.json` 只用于迁移；登出会记录本机登出状态，避免迁移来源让登录态复活。

Token、Discord / QQ 使用者 ID、群号、私人聊天、个人工作区内容、环境变量值、备份、`node_modules`、pnpm store、运行日志与测试输出都不应提交到仓库。仓库只保存通用配置范例与不含秘密的安装说明。

| 变量 / 位置 | 说明 |
|---|---|
| `MING_WORKSPACE` | **统一工作区根目录**；Memory、Interest、Discord、Browse、Voice、Wake、Resume、Skill Isolate 未显式指定 `root` / `workspacePath` 时共用此路径 |
| `DSH_HOME` | DSH 主目录；未设置时使用 `%USERPROFILE%\\.dsh`，用于插件本机配置、Discord inbox / session map、Mousepet 资料，以及 Voice 默认工作区等路径 |
| Bilibili Cookie | 存在 DSH Credentials 的 `MING_BILI_COOKIE`；账号、字幕与社交工具共用，不写入仓库或聊天记录 |
| `MING_OWNER_QQ` | 本人 QQ ID；部分本人指令需要 |
| `MING_OWNER_DISCORD_ID` | 本人 Discord ID；可选，启用本人私讯指令时设置 |
| `MING_DISCORD_ALLOWED_USER_IDS` | 可选 Discord 使用者 ID 白名单，逗号分隔 |
| `DISCORD_BOT_TOKEN` | Discord Bot Token，只放 Windows 使用者环境变量 |
| `MING_FFPLAY` | 试听用 ffplay 路径；默认从 PATH 查找 |
| `MING_GRAPH_CONFIG` | 星图本机配置位置 |

## 人格

这套东西是从一台机器上长出来的，那个 AI 叫 AI。**「AI」只留在包名、注释和面板标题里**——它是这套东西的来源，不该变成你 AI 的人格。

会进系统提示词的每一句都已经换成中性说法。你在自己工作区的 `persona/` 里写谁，它就是谁；写得越具体，它越像那个人。

## 状态

这是一套在真实 Windows / DSH Desktop 环境中持续验证的个人插件集，不应把单机测试误写成所有环境都兼容。每项功能的完成、测试与待验证状态见 [验证记录](docs/VERIFICATION.md)。

## 来源与致谢

- `dsh-ming-mousepet` 里输入与 AI 光标部分，来自 [dsh-independent-input](https://github.com/dongcaodeliyu/dsh-independent-input)（作者 dongcaodeliyu），保留原有安全边界。
- 截屏与看屏幕原有 `dsh-ming-desktop`，已并入 `dsh-ming-mousepet`。
- 其余各包为本机自写或基于各自上游许可修改。

## 许可

MIT。随便用，出问题别找我。
