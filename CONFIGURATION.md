# 插件配置参考

本文列出十二个 DSH bundles 的用途、主要配置和依赖关系。具体默认值以各包的 `cordis.patch.yml` 与 `index.js` 为准；本文件中的路径均为示例，不包含任何个人 Token、ID 或私有工作区内容。

## 通用原则

- 所有插件应安装在同一个 DSH profile，并加入 `dsh.profile.bundles`。
- 本机工作区建议统一用绝对路径，避免不同启动目录导致相对路径漂移。
- Profile 的 `cordis.patch.yml` 是部署配置；不要把含个人 ID、Token 或私人路径的实际文件提交到仓库。
- `<DSH_HOME>` 代表 DSH 主目录，`<WORKSPACE>` 代表你的工作区，`<REPO>` 代表本仓 clone 目录。
- 具体字段请对照对应包的 `cordis.patch.yml`；不要把本文概览当成完整 schema。

## 十二个 bundles

| Bundle | 主要职责 | 关键配置 / 依赖 |
|---|---|---|
| `dsh-ming-core-memory` | 跨会话核心与归档记忆 | 默认使用 DSH memory 目录；注意本 Fork 的写入政策只保存机器、环境、项目与工具事实 |
| `dsh-ming-memory` | 人设、日记与开场记忆 | `root` 指向工作区；`personaFiles`、`diaryDir`、`diaryCount`、`maxChars` |
| `dsh-ming-graph` | 神经元、星图、记忆面板与 skill 关系 | `syncSeconds`、`qqObservations`、`skillsCwd`、`skillsOffFile` |
| `dsh-ming-mousepet` | 桌宠、屏幕观察、光标与输入 | Sidecar 使用 Windows PowerShell / WinForms；编辑 `sidecar.ps1` 后按包 README 的 BOM/CRLF 修复流程检查 |
| `dsh-ming-voice` | TTS 与 MP3 输出 | 可配置 Python / FFmpeg；缺少 edge-tts 环境时可能回退 Windows SAPI |
| `dsh-ming-bilibili-account` | B 站帐号与内容工具 | 按包的 Cordis patch 与登录流程设置；登录态和 Cookie 不要提交 |
| `dsh-ming-browse` | 浏览器自主浏览与受限操作 | `enabled`、`workspacePath`、ADB 路径 / serial、社交平台安全名单 |
| `dsh-ming-interest` | 兴趣 inbox 监测与自主唤醒 | `enabled`、`workspacePath`、`interestsFile`、日志 / 状态文件、限流、quiet hours、groups |
| `dsh-ming-wake` | Agent 自行安排下一次唤醒 | 工作区 root；由 Agent 调用 `ming_wake_arm` 并提供明确 sessionId |
| `dsh-ming-resume` | 插话后恢复先前任务 | root、ADB 路径 / serial、`pauseMediaOnInterrupt` |
| `dsh-ming-discord` | Discord ↔ DSH bridge | `enabled`、`workspacePath`、`mentionRequired`、`directMessages`、allowlists、`newMessagePolicy`、附件上限与 inbox 路径 |
| `dsh-ming-skill-isolate` | 工作区 skill 隔离 | root 与 Graph 共用的 `skills-off.json` |

## 已验证的工作区配置形状

以下只展示通用相对路径与字段，不是可直接覆盖现有配置的完整文件：

```yaml
- insert:
    - id: ming-memory
      name: dsh-ming-memory
      config:
        root: '<WORKSPACE>'
        personaFiles:
          - 'persona/人设.md'
          - 'persona/名字.md'
          - 'persona/约定.md'
        diaryDir: 'diary'
        diaryCount: 3
        maxChars: 12000

- insert:
    - id: ming-graph
      name: dsh-ming-graph
      config:
        syncSeconds: 120
        qqObservations: '<WORKSPACE>/empty.jsonl'
        skillsCwd: '<WORKSPACE>'
        skillsOffFile: '<WORKSPACE>/skills-off.json'

- insert:
    - id: ming-interest
      name: dsh-ming-interest
      config:
        enabled: true
        workspacePath: '<WORKSPACE>'
        interestsFile: 'live/interests.json'
        logFile: 'live/interest-log.jsonl'
        stateFile: 'live/interest-state.json'
        offFlag: 'live/interest-off'
        pollMs: 20000
        minGapMinutes: 20
        maxPerHour: 3
        quietHours: '01:00-08:00'
        groups: []
```

如果插件版本的 schema 与示例不一致，以该版本源码中的 DEFAULTS / config 读取逻辑为准。特别是 `quietHours` 的具体结构，应与所安装版本的 `dsh-ming-interest/cordis.patch.yml` 保持一致。

## Interest 清单格式

插件需要在 `<WORKSPACE>/live/interests.json` 有效读取到主题清单。示意：

```json
{
  "topics": [
    { "name": "AI", "keywords": ["AI", "人工智慧", "LLM", "DeepSeek"] },
    { "name": "科技", "keywords": ["科技", "開源", "GitHub"] }
  ],
  "mute": []
}
```

这是结构示例。可以自行添加主题和关键词；不要把私人聊天内容直接放入公开仓库。

## Browse / Resume 的 ADB

若使用 MuMu Android 自动化，必须指向当前 MuMu 安装目录里的 adb.exe，并使用对应实例的 serial。不要复制旧版 MuMu 12 / 旧磁盘路径。先用：

```powershell
& "<你的 MuMu 安装目录>\shell\adb.exe" devices
```

确认设备处于 `device` 状态，再填入插件配置。不同 MuMu 版本的安装路径可能不同。

## Discord 配置

Discord bridge 的完整字段表、权限与安全建议见 [DISCORD_SETUP.md](DISCORD_SETUP.md)。

## 环境变量

| 变量 | 用途 | 是否必需 |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Discord Bot 登录 Token | 启用 Discord bridge 时必需 |
| `MING_OWNER_DISCORD_ID` | 标记主人身份并允许本人私讯指令 | 可选 |
| `MING_DISCORD_ALLOWED_USER_IDS` | 额外 Discord 用户白名单，逗号分隔 | 可选 |
| `MING_OWNER_QQ` | QQ 本人身份识别 | 依 QQ 功能而定 |
| `MING_WORKSPACE` | 部分插件读取的工作区覆盖值 | 依插件而定 |
| `MING_FFPLAY` | ffplay 可执行文件位置 | 可选 |

Windows 使用者环境变量设定方式：

```powershell
[Environment]::SetEnvironmentVariable("VARIABLE_NAME", "VALUE", "User")
```

不要在命令历史、截图或 GitHub 文件中暴露真实 Token。

## 共享文件

- Graph 与 Skill Isolate 可共用 `<WORKSPACE>/skills-off.json`。
- Memory / Graph 的身份、神经元与日记数据属于本机工作区数据。
- Interest 使用 `live/interests.json`、`live/interest-log.jsonl`、`live/interest-state.json`。
- QQ / Discord 的 inbox 与 chat-session map 属于 DSH_HOME 的媒体数据目录，不是仓库源码。
