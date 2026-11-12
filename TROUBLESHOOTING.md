# 故障排除与已知问题

本文记录本次 Windows 11 + DSH Desktop 安装中实际遇到的问题，以及可复现的根因 / 处理方式。请先备份单个配置文件，不要用删除整个 Profile 或清空 node_modules 的方式排错。

## 1. Discord 插件页面显示「未运行」，Bot 不在线

### 已确认的根因与修复

本次安装时：
- Profile 能解析 `discord.js`。
- 插件原始码目录不能解析同一依赖，报 `Cannot find module 'discord.js'`。
- 插件是通过 pnpm `link:` 加入 Profile；Node ESM 从插件真实源码目录解析模块。
- Profile 的 `node_modules` 有 `discord.js`，但 link 包旁没有自己的依赖目录。

修复：
- Profile 安装 `discord.js@^14.19.3`（本次解析到 14.28.1）。
- 在 `dsh-ming-discord/node_modules` 建立指向 Profile `node_modules` 的 NTFS Junction。
- 再从 Profile 与 Plugin 两个目录分别用 `createRequire().resolve('discord.js')` 验证。
- 两边都解析成功后，完全重启 DSH Desktop；使用者确认 Bot 已成功上线。

完整命令见 [INSTALL.md 第 7–8 节](INSTALL.md)。

### 若仍未运行

1. 检查 Windows 使用者环境变量 `DISCORD_BOT_TOKEN` 是否存在（不要输出或分享值）。
2. 完全退出 DSH Desktop 后重新启动。
3. 确认 Discord 插件 `enabled: true`，且 bundle 名称在 `dsh.profile.bundles`。
4. 确认 `discord.js` 在 Profile / Plugin 两处都能解析。
5. 确认 Developer Portal 已启用 Message Content Intent。
6. 查看 DSH 日志中的 `[ming-discord]` 警告 / ready / login error。

`MING_OWNER_DISCORD_ID` 是可选项；未设置不会阻止 Bot 普通启动。

## 2. PowerShell Node 测试出现 SyntaxError

将含 Windows 反斜线路径的字符串直接嵌入 `node -e "..."`，可能被 PowerShell 与 JavaScript 双重解释；单引号也可能在传递时被剥除，导致 `require(node:module)` 语法错误或路径转义错误。

建议把 JavaScript 写入临时 `.cjs` 文件，再由 DSH 内置 Node 执行。参考 [INSTALL.md 第 8 节](INSTALL.md)。

## 3. Graph 神经元 / 星图 / 记忆同时出现 ENOENT，路径是空字串

根因：
- Graph 的 `qqObservations` 默认值可能是空字串。
- Memory 的 `readQqObservations(file)` 会直接读取传入路径。
- 空路径会触发 `ENOENT`，而 unified snapshot 同时依赖 neuron snapshot，所以多个 UI 页一起报错。

处理：
1. 建立一个真实存在的空 JSONL 文件（例如 `<WORKSPACE>/empty.jsonl`）。
2. 在 Profile 的 `cordis.patch.yml` 中将 Graph `qqObservations` 指向该文件。
3. 重启 DSH，确认神经元、星图、记忆页面不再出现空路径 ENOENT。

不要把空文件放在 GitHub 仓库当成用户数据；这是每台机器自己的配置依赖。

## 4. Graph 设置页显示「读不到设置：not found」

根因：Graph 设置面板调用 `/_dsh/dsh-ming-memory/identity`，原先 Memory 插件没有提供该 route。

本 Fork 的修复是在 Graph 注册独立 GET / POST route，使用工作区 `live/identity.json` 保存身份配置，并对输入大小、字段白名单与字符串长度做限制。该修复已在目标 DSH 环境重启后由使用者确认设置页正常。

若旧版本仍报错，确认已更新到包含该 route 的分支版本，并重新启动 DSH。

## 5. Interest 面板显示读不到兴趣清单

根因：配置指向的 `live/interests.json` 不存在，或不是有效 JSON。

处理：
1. 在工作区建立 `live` 目录。
2. 建立合法 JSON 文件，至少包含 `topics` 数组与 `mute` 数组。
3. 检查配置里的 `interestsFile` 路径相对于插件使用的 workspace root 是否正确。
4. 查看 interest log / state 文件是否生成。

示例结构见 [CONFIGURATION.md](CONFIGURATION.md)。

## 6. Interest 没有唤醒

检查：
- inbox 文件是否有新行。
- Discord / AstrBot 是否写入同一个 inbox 路径。
- `groups` 是否包含目标 QQ / Discord 群组标识（空数组时没有指定群组）。
- `interests.json` 主题关键词是否匹配消息。
- quiet hours、`minGapMinutes`、`maxPerHour` 是否挡住本次触发。
- `chat-sessions.json` 是否有对应 chat → session 映射。

Discord 未 @ 消息目前只写文字；不要期待图片本身命中兴趣。

## 7. Wake 面板显示「还没排」

这不必然是故障。Wake 的设计是由 Agent 在一轮任务中决定下一次醒来的时间，并调用 `ming_wake_arm` 工具，提供明确的 sessionId 与 dueAt。若 Agent 尚未安排下一轮，显示「还没排」符合设计。

Interest 则是另一条即时触发路径：命中感兴趣的新消息可以直接唤醒，不需要等待 Wake 的 dueAt。

## 8. pnpm 报 store link 不一致

若更改过 `DSH_HOME`、Profile 所在磁盘或 pnpm storeDir，旧 `node_modules` 可能仍链接到原 store，而 pnpm 当前解析出不同 store。不要先删除 node_modules 或 store。

先检查：
- 当前 DSH 内置 pnpm 版本。
- Profile 的 `pnpm-workspace.yaml` 中 `storeDir`。
- 现有 node_modules 的链接来源。
- 当前 DSH_HOME 是否与安装时相同。

让 pnpm 使用与现有 Profile 一致的 storeDir 后，再执行安装。迁移 Profile 时应按 pnpm 官方流程规划，不要混用系统 pnpm 与 DSH 内置 pnpm。

## 9. Graph / Memory client.js 没更新

这两个包使用共享 UI source。修改 `src/` 后要在各包目录执行 `node build.mjs`。确认 build 成功后再重启 DSH。不要只改生成的 client.js 共享区块。

## 10. 安全与数据保护

- 不要把 Token、Cookie、私人 ID、私人聊天、用户工作区或备份上传。
- 不要把 `node_modules`、pnpm store、运行缓存、日志中的私人内容提交。
- 不要为了让插件启动而关闭 Discord allowlist 或扩大桌面操作权限。
- 不要用 Administrator Discord permission 替代最小权限设置。
