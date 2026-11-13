# 插件架构与资料流

## 总览

本仓由十二个 DSH bundles、一份共享 UI source，以及一个独立 AstrBot inbox recorder 组成。

- DSH bundles 直接运行在 DeepSeek Harness profile。
- `dsh-ming-ui` 是共享前端 source / build helper，不是 DSH bundle。
- `astrbot_plugins/astrbot_plugin_inbox_record` 是 AstrBot 插件，不是 DSH bundle。
- Discord gateway 直接连接 DSH，不经过 AstrBot。
- QQ 侧由 AstrBot 接收消息，再写入 OneBot 兼容 inbox。

## 十二个 DSH bundles 的职责

| Bundle | 职责 | 主要连接 |
|---|---|---|
| core-memory | 跨会话核心 / 归档记忆 | DSH system prompt 与 memory tools |
| memory | 人设、日记、开场记忆 | 工作区 persona / diary |
| graph | 神经元、星图、记忆面板 | memory 数据、QQ observations、skills 文件 |
| mousepet | 桌宠、屏幕、光标、输入 | Windows sidecar / UIA / WinForms |
| voice | TTS | Windows SAPI / 可选 Python / FFmpeg |
| bilibili-account | B 站内容与帐号工具 | B 站登录态与服务 |
| browse | 自主浏览与受限操作 | 浏览器、Android ADB、工作区 |
| interest | 兴趣命中后唤醒会话 | OneBot inbox、chat-session map、兴趣 JSON |
| wake | 定时唤醒 | `ming_wake_arm` 与 Agent resume |
| resume | 插话后恢复任务 | QQ / Discord steer 事件与任务状态 |
| discord | Discord Gateway | discord.js、DSH agents、attachments、inbox |
| skill-isolate | 按工作区隔离 skill | `skills-off.json` |

## Discord 消息流

### Guild 频道

1. Discord Gateway 收到消息。
2. Bridge 把群消息文字写入兼容 OneBot 格式的 `qq-inbox.jsonl`，并更新 `chat-sessions.json` 映射。
3. 若消息符合 mention gate（默认必须 @ Bot），才进入 DSH Agent 会话。
4. Bridge 根据 Guild / Channel 计算稳定 Session ID。
5. Agent 回复事件由 bridge 路由回原频道。
6. 未 @ 的消息不会直接启动普通 Agent 回合，但可以被 `dsh-ming-interest` 扫描；兴趣命中后由 interest 通过 chat-session map 找到对应 Discord Session 并唤醒。

### Direct Message

1. Discord DM 以 Discord 使用者 ID 计算 Session ID。
2. 若 `directMessages` 开启，消息可进入 DSH Agent。
3. 回覆通过持久化的 DM route 回传原使用者。

### Session ID

- Guild：`discord-guild-<guildId>-channel-<channelId>`
- DM：`discord-dm-<userId>`

每个 Guild channel / DM 独立会话；不会跨频道共享历史。Thread 也会有独立 channel Session。

## QQ 消息流（AstrBot）

1. AstrBot 接收 QQ 消息。
2. `astrbot_plugin_inbox_record` 将消息按兼容格式追加到 `<DSH_HOME>/media/onebot/qq-inbox.jsonl`。
3. `dsh-ming-interest` 读取 inbox，依据群组配置和兴趣主题匹配。
4. 命中后根据 chat-session map 找到目标 DSH Session 并触发唤醒。

兴趣唤醒的文件格式兼容旧 OneBot 记录，因此不必直接依赖 QQ bot 框架。

## 兴趣唤醒与自主学习的边界

当前 interest 设计包含：
- 观察 inbox 中的文字消息。
- 根据 `interests.json` 的主题 / 关键词判断是否命中。
- 用 `minGapMinutes`、`maxPerHour` 与 quiet hours 控制唤醒频率。
- 命中时可直接唤醒，不必等待 wake 的预定时间。

当前限制：
- Discord 未 @ 消息的 inbox 记录只有文字，不会把图片送入视觉模型。
- 尚未把浏览结果、自主研究结果、桌面截图统一接入兴趣发现与更新流程。
- 自动发现新兴趣并持久化更新的完整闭环仍需后续设计与验证；不能把现有关键词命中误称为已经具备全来源自主学习。

## Wake 与 Interest 的区别

- `dsh-ming-wake`：Agent 自己决定何时再醒，透过 `ming_wake_arm` 工具安排 dueAt；没有排程不等于故障。
- `dsh-ming-interest`：外部新消息命中兴趣时可直接触发，不必等待 wake 排程。
- Interest 有独立限流，避免连续触发过多次。

## 共享数据目录

| 数据 | 典型位置 | 说明 |
|---|---|---|
| 工作区人设 | `<WORKSPACE>/persona/` | 人格与约定 |
| 日记 | `<WORKSPACE>/diary/` | Memory 开场上下文 |
| 兴趣主题 | `<WORKSPACE>/live/interests.json` | Interest 关键词 |
| 兴趣日志 / 状态 | `<WORKSPACE>/live/interest-log.jsonl`、`interest-state.json` | 运行状态 |
| Wake 状态 | `<WORKSPACE>/live/` | 由 Agent 与 wake plugin 管理 |
| Skills 隔离 | `<WORKSPACE>/skills-off.json` | Graph / Skill Isolate 共用 |
| Discord / QQ inbox | `<DSH_HOME>/media/onebot/qq-inbox.jsonl` | 兼容消息流 |
| 聊天 Session 映射 | `<DSH_HOME>/media/onebot/chat-sessions.json` | chat key → DSH Session ID |
| Graph QQ observations | 由 Graph config 指定 | 无数据时可指向空 JSONL |

## 构建

Graph 与 Memory 有共享 UI 构建步骤。共享 UI source 在 `dsh-ming-ui`，修改对应 `src/` 后执行各包的 build script。不要手动编辑生成的 client.js 共享区块；先改 source，再构建并验证。

## 权限与安全边界

- Discord Bot 不需要 Administrator。
- Message Content Intent 必须在 Developer Portal 启用。
- Guild / Channel / User allowlists 建议正式使用时明确配置。
- Bot 可使用的 DSH tools 仍由 profile / Agent 工具权限决定。
- Mousepet 的 `auto` 输入优先使用 UIA / 窗口消息；但部分 `type` / `key` 路径在 UIA 聚焦或窗口消息失败后仍可能使用物理键盘。`mode:"physical"` 会明确要求物理输入，不能把 `auto` 视为绝对无物理输入。
- Browse 的社交平台写入与支付相关动作应保留 deny rules，不应为了自动化而放宽。
