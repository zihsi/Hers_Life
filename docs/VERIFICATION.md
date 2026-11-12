# 安装与修复验证记录

记录截至 2026-11-12 的实际进度。此记录区分「使用者已在目标机器确认」与「仅代码 / 配置准备完成」，不把单机成功外推为所有环境都兼容。

## 目标环境

| 项目 | 值 |
|---|---|
| OS | Windows 11 |
| DSH Desktop | 0.2.2-rc.2 |
| Node.js | 24.21.0（DSH 内置 runtime） |
| pnpm | 11.28.5（DSH 内置 runtime） |
| Cordis | 4.1.0 |
| discord.js | 14.28.1 |
| Profile | desktop |
| 仓库分支 | feature/discord-integration |

## 安装结果

| 项目 | 状态 | 说明 |
|---|---|---|
| 十二个 DSH bundles | 已安装 | Profile dependencies 与 bundles 已加入，原有条目保留 |
| pnpm install | 已完成 | 安装命令 exit 0 |
| dsh-ming-memory build | 已完成 | client.js build 成功 |
| dsh-ming-graph build | 已完成 | client.js build 成功，构建记录 77bfbfa65acbc318 |
| Cordis peer | 已完成 | 安装 4.1.0，peer 检查无问题 |
| discord.js | 已安装 | Profile 依赖解析到 14.28.1 |
| Discord link package 解析 | 已验证 | 建立 Junction 后 Profile 与插件源码目录均可解析 |
| Discord Bot 上线 | 使用者已确认 | 使用者回报「有了」 |
| Discord 消息收发端到端 | 待补充完整验证 | 已确认 Bot 上线；仍需按 Discord_SETUP 步骤验证 Guild、DM、interest 等各路径 |
| QQ Interest inbox | 依赖外部 AstrBot | 需要 AstrBot recorder 与群组配置 |
| 未 @ Discord 图片兴趣识别 | 未实现 | 当前 inbox 只记录文字 |

## 已修复问题

### 1. Graph 空 qqObservations 路径

- Graph config 的 `qqObservations` 指向空字串时触发 ENOENT。
- 创建本机空 JSONL 并将 Profile Graph config 指向该文件。
- 使用者重启后确认神经元、星图、记忆三处 ENOENT 消失。

### 2. Graph identity API

- Graph 面板调用 identity GET / POST route，但原先没有对应 route。
- 在 Graph 注册受限的 GET / POST endpoint，资料保存于工作区 `live/identity.json`。
- 使用者重启后确认设置页正常。GitHub 上的 route 实作已同步；由于这次仓库补入的是远端源码副本，需在本机拉取后再做一次语法检查与设置页回归，不能把该次远端同步本身标为已重新实测。

### 3. Interest 清单缺失

- 建立本机 `live/interests.json`，包含 AI、科技、游戏、电脑硬件、动漫、小说六类主题。
- 使用者确认文件建立成功。
- 主题清单属于本机偏好资料，不随本文件提交。

### 4. Discord dependency resolution

- Profile 解析成功，但 link 插件源码目录解析失败。
- 确认是 pnpm link 依赖安装位置与 Node ESM realpath resolution 的差异。
- 在本机插件目录建立指向 Profile `node_modules` 的 Junction。
- 使用者执行修复后确认 Bot 上线。
- Junction 是本机安装步骤，不属于仓库追踪内容。

### 5. 共享 UI build 路径

- Graph / Memory build 中原本存在硬编码 `C:/dsh` 路径。
- 改为相对于各自源码位置解析共享 UI 文件。
- 已纳入分支前一笔提交。

## 备份

安装与配置修改前曾在用户机器建立本机备份。备份路径、用户目录与实际配置内容不公开、不提交至仓库。恢复时应使用使用者本机的备份副本，不要从 GitHub 下载覆盖个人 profile。

## 尚待验证

- Discord Guild 与 DM 的完整收发、重启后 Session 恢复。
- Discord 未 @ 消息进入 interest inbox 并按群组配置触发。
- Discord steer 后 resume 的端到端行为。
- Voice MP3 上传回 Discord 的实际运行。
- Browse / ADB 在当前 MuMu 实例上的端到端行为。
- 十二个 bundles 各自所有功能的完整回归测试。
- 兴趣自动发现 / 更新，以及图片、浏览结果、自主研究内容接入兴趣系统的设计与验证。
