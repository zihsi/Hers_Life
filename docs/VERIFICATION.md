# 安装与修复验证记录

记录截至 2026-11-13 的实际进度。此记录区分「使用者已在目标机器确认」与「仅代码 / 配置准备完成」，不把单机成功外推为所有环境都兼容。

## 2026-11-13 — Memory 跨入口共享

- `dsh-ming-memory/index.js` 已將跨會話可見性改為同一工作區內所有聊天入口互通；QQ、Discord、網頁、私訊與群聊不再按 scope 隔離。
- feed 仍保留來源標籤（例如 QQ 群號），供模型辨認上下文來自哪個入口。
- `dsh-ming-memory/qa-share.mjs` 已新增 QQ 私訊 ↔ QQ 群聊 ↔ Discord 群聊的共享測試。
- 目前僅完成程式與測試案例更新；尚未在使用者 Windows / DSH 環境執行 `node qa-share.mjs` 或 `node qa-all.mjs`，因此不宣稱測試通過。
- 此模式刻意允許私訊內容出現在群聊的模型上下文中。它不會自動把私訊原文發送到群組，但模型可能在群聊回答時引用私訊資訊；這是使用者明確要求的共享行為。

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
| dsh-ming-graph build | 已完成 | 12 個單元；build `aff205130ade3e15`；`build.mjs --check` 通過 |
| Cordis peer | 已完成 | 安装 4.1.0，peer 检查无问题 |
| discord.js | 已安装 | Profile 依赖解析到 14.28.1 |
| Discord 插件載入 | 使用者已確認正常 | 2026-11-12 修改後確認插件可正常載入；最新提交 `68b6c03` |
| Discord Gateway 連線 | 使用者已確認正常 | 使用者確認 Bot 正常連線；日誌可見 `apply()` 進入與 Token 存在 |
| Discord Guild / DM 完整回歸 | 部分待驗證 | 目前連線正常；不同頻道、DM、重啟後 Session 恢復仍應分項測試 |
| Discord Interest / Resume / Voice | 待端到端驗證 | 程式路徑存在，但不可由 Bot 上線推論所有整合路徑均通過 |
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

### 4. Discord 插件載入與連線

- 使用者於 2026-11-12 確認 Discord 插件修改後正常運作；日誌顯示 `apply() 已進入`、`tokenPresent=true`，並確認 Bot 連線正常。
- 因此舊版「Plugin 目錄仍無法解析 discord.js、Bot 尚未上線」狀態已過期，不再列為目前故障。
- 若其他新環境出現 `Cannot find module 'discord.js'`，仍應分別檢查 Profile 與插件真實目錄的模組解析；必要時依 INSTALL.md 第 8 節採用本機 Junction 方案，不要覆蓋既有 node_modules。
- 目前的載入與 Gateway 連線確認，不等於 Guild、DM、附件、Interest、Resume、Voice 所有路徑都已完成端到端回歸。
- 不提交 Token、node_modules 或本機 Junction。
### 5. 共享 UI build 路径

- Graph / Memory build 中原本存在硬编码 `C:/dsh` 路径。
- 改为相对于各自源码位置解析共享 UI 文件。
- 已纳入分支前一笔提交。

### 6. Graph / Memory 建置產物

- Graph `build.mjs` 輸出 `build.json` 時，來源路徑改為相對於倉庫根目錄的路徑，避免記錄開發者本機絕對路徑。
- Graph 重新建置成功：12 個單元，build hash `aff205130ade3e15`，產物 209001 bytes。
- Graph `build.mjs --check` 通過。
- Graph 與 Memory 的 `client.js` 均由目前倉庫 source 重新產生。
- Graph `build.json` 已確認不含 Windows 磁碟絕對路徑。
- 本次 Git 差異檢查通過；以上是本機建置驗證，不代表所有插件功能均已完成端到端測試。
### 7. Bilibili linked bundle 宿主依赖

- `dsh-ming-bilibili-account/package.json` 已声明 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-llm` 为 peerDependencies。
- 使用者确认补上 peerDependencies 后，Bilibili 插件已可正常载入。
- 这项修复依赖 DSH Profile 提供兼容的宿主 API；不要把宿主包的独立副本塞进插件运行时。

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
