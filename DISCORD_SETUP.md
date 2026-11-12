# Discord Bot 建立与连接

## 功能与消息规则

`dsh-ming-discord` 是 Discord Gateway，直接把 Discord 频道和私讯连接到 DSH Agent。

- 每个 Discord 服务器频道各自使用持久 DSH Session。
- 每个 Discord 用户的 DM 使用独立 Session。
- 服务器频道默认必须 @ Bot 才会触发 Agent 回复。
- DM 默认可用（`directMessages: true`）。
- 未 @ Bot 的服务器文字消息仍会记录到 OneBot 兼容 inbox，供 `dsh-ming-interest` 关键词匹配。
- Agent 回复会路由回原频道 / 私讯。
- 图片附件在 Agent 处理的消息中通过 DSH attachment service 保存。
- `voice_say` 在 Discord Session 执行时，可把工作区 `live/voice` 中符合限制的 MP3 回传原频道。

**重要限制：** 目前未 @ 的消息写入 interest inbox 时只写文字内容；图片不会作为视觉内容进入兴趣匹配流程。因此「未 @ 图片理解」尚未实现。图片附件的 DSH 处理与 interest inbox 观察是两条不同路径。

## 1. 建立 Discord Application

1. 打开 [Discord Developer Portal](https://discord.com/developers/applications)。
2. 建立 Application。
3. 在 Bot 页面新增 Bot user。
4. 在 Privileged Gateway Intents 启用 **Message Content Intent**。
5. 保存设置。

不要把 Bot Token 发给任何人，也不要贴进聊天、截图或仓库。

## 2. 邀请 Bot

OAuth2 URL Generator 中选择：

- Scopes：`bot`
- Bot Permissions：
  - View Channels
  - Send Messages
  - Read Message History

不需要 Administrator。只授予 Bot 实际要使用的服务器与频道权限。

## 3. 设置 Windows Token

在 PowerShell 本机执行（把占位字串替换为真实 Token；不要把真实值贴给 ChatGPT 或提交 GitHub）：

```powershell
[Environment]::SetEnvironmentVariable("DISCORD_BOT_TOKEN", "YOUR_BOT_TOKEN", "User")
```

可选：设置主人 Discord User ID：

```powershell
[Environment]::SetEnvironmentVariable("MING_OWNER_DISCORD_ID", "YOUR_DISCORD_USER_ID", "User")
```

可选：额外用户白名单，多个 ID 以逗号分隔：

```powershell
[Environment]::SetEnvironmentVariable("MING_DISCORD_ALLOWED_USER_IDS", "ID_1,ID_2", "User")
```

设定或更新环境变量后，**完全退出并重新启动 DSH Desktop**，让进程重新读取 Windows 使用者环境变量。

## 4. 插件配置

在目标 DSH profile 的 `cordis.patch.yml` 合并以下配置。路径替换成自己的工作区与 DSH_HOME：

```yaml
- insert:
    - id: ming-discord
      name: dsh-ming-discord
      config:
        enabled: true
        workspacePath: '<WORKSPACE>'
        mentionRequired: true
        directMessages: true
        allowedGuildIds: []
        allowedChannelIds: []
        allowedUserIds: []
        ownerUserIds: []
        newMessagePolicy: steer
        provider: ''
        model: ''
        agentPreset: ''
        maxAttachmentBytes: 10485760
        inboxPath: '<DSH_HOME>/media/onebot/qq-inbox.jsonl'
        chatSessionsPath: '<DSH_HOME>/media/onebot/chat-sessions.json'
```

字段说明：

| 字段 | 说明 |
|---|---|
| `enabled` | 是否启用 bridge |
| `workspacePath` | 新建 Discord Session 的工作目录 |
| `mentionRequired` | Guild 频道是否必须 @ Bot |
| `directMessages` | 是否接收 DM |
| `allowedGuildIds` | 可选 Guild 白名单；空数组表示不额外限制 |
| `allowedChannelIds` | 可选频道白名单 |
| `allowedUserIds` | 可选使用者白名单 |
| `ownerUserIds` | 明确标记为 owner 的 Discord ID |
| `newMessagePolicy` | `steer` 插话；`followup` 排队 |
| `provider` / `model` | 可选显式模型路由，留空时交给 DSH 默认路由 |
| `agentPreset` | 可选 Agent preset |
| `maxAttachmentBytes` | 附件下载上限，默认 10 MiB |
| `inboxPath` | interest 读取的兼容 inbox |
| `chatSessionsPath` | 聊天 ID 到 DSH Session ID 的映射文件 |

当 allowlists 为空时，bridge 不会额外限制 Guild / Channel / User；若 Agent profile 有本机操作工具，建议填入可信 Guild / Channel / User ID，避免把拥有高权限工具的 Bot 邀入公开服务器。

## 5. 安装依赖与修复 link 包解析

Profile 安装 `discord.js`：

```powershell
# 在 Profile 目录执行，使用 DSH Desktop 内置 pnpm
pnpm add "discord.js@^14.19.3"
```

注意：pnpm 的 `link:` 本地插件不会自动把依赖安装到链接目标目录。Node ESM 从插件真实源码目录解析依赖，因此可能出现 Profile 能解析、插件自身却报 `Cannot find module 'discord.js'`。

本次在 Windows DSH Desktop profile 的实际修复是：在插件目录建立指向 Profile `node_modules` 的 NTFS Junction。完整命令、验证脚本与保护条件见 [INSTALL.md 第 8 节](INSTALL.md#8-discord-本地依赖解析-junction-重要)。

这项 Junction 是本机安装产物，不应提交到 GitHub；如果移动 Profile 或仓库目录，必须重新检查链接目标。

## 6. 验证连接

1. 确认 Profile 与 Plugin 两处都能解析 `discord.js`。
2. 完全退出并重启 DSH Desktop。
3. 在 DSH 插件页面确认 `dsh-ming-discord` 状态为运行中。
4. 查看 DSH 日志，成功连接时会出现类似「已连接 Discord：BotTag」的 ready 记录。
5. 在允许的服务器频道 @ Bot，确认 DSH Agent 回复回同一频道。
6. 对 Bot 发送 DM，确认 DM Session 能正常回复。
7. 在服务器频道发送一条不 @ Bot 的普通文字，确认 inbox 有记录；再配置 interest groups 与兴趣主题，验证自主唤醒。

## 7. Session ID 规则

- Guild channel：`discord-guild-<guildId>-channel-<channelId>`
- DM：`discord-dm-<userId>`

不同频道、私讯不会共用会话历史。Discord Thread 作为独立 channel 处理。

## 8. 安全与限制

- Token 只放 Windows 使用者环境变量，不写进 `cordis.patch.yml` 或仓库。
- 不需要 Administrator permission。
- 必须启用 Message Content Intent 才能读取一般消息文字。
- DSH Session 能使用哪些工具由 Profile / Agent 工具权限决定；Discord bridge 不会自动授予任意主机命令权限。
- 不要把拥有桌面、文件、浏览器等高权限工具的 Bot 邀入不可信服务器。
- 图片在被路由给 Agent 的消息中使用 DSH attachment service；未 @ 消息目前只记录文字供兴趣匹配。
- 语音只识别 `voice_say` 工具结果，并限制上传至工作区 `live/voice` 内的 MP3（最大 8 MiB）。
