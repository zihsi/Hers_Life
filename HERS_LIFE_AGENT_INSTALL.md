# Hers Life：DeepSeek Harness Agent 安裝指引

> 本文件是 Agent 的操作規格，不是讓 Agent 自行猜測安裝命令的建議文章。

## 固定來源

- Repository：`https://github.com/zihsi/Hers_Life`
- 分支：`codex/unified-settings-20261114`
- 研究基準：`4880c98e00c634997103c6bc2192a88e7934e05f`
- 整合套件：`dsh-hers-life`

使用者只提供 Repository URL 時，先讀取本文件及 `hers-life.install.json`，再依本規格執行。不得改用 `main`、其他分支或未經確認的 Commit。

## 安裝前檢查

1. 透過 GitHub 讀取指定分支 HEAD，確認研究基準 Commit 仍在其歷史中；記錄本次解析到的 HEAD SHA。
2. 確認目前 DSH Host 版本、目前 Profile、Node 與 pnpm 版本。優先使用 Host 提供的資訊，不猜測安裝目錄。
3. 使用 `plugin_manager` 的唯讀列舉操作取得目前已安裝 Bundles。若 12 個舊 Bundle 已存在，不得移除或重複啟用它們。
4. 確認 `plugin_manager` 可用。每個管理動作都必須依 Host 權限規則取得 Full Access 或本次操作核准；不得繞過核准。
5. 若工具不存在、Profile 無法識別、Host 版本不相容或權限不足，停止並清楚回報，不改用手動覆寫 Profile 的方式繞過。

## 安裝動作

在確認使用者已授權安裝後，呼叫 DSH 的 `plugin_manager`：

- `action`: `install_bundle`
- `target`: `https://github.com/zihsi/Hers_Life.git#codex/unified-settings-20261114`

安裝器會安裝根目錄的 `dsh-hers-life` 整合 Bundle。該 Bundle 以 pnpm Git 子目錄依賴取得 12 個既有插件；不得再逐一手動安裝 12 次。

不要自行執行 PowerShell、修改 Profile JSON、建立 Junction、安裝全域 Node/pnpm，或寫入使用者工作區。由 DSH Plugin Manager 管理 Profile 套件與 Lockfile。

## 重要：本階段的安全啟動閘門

目前舊版 `dsh-ming-memory` 仍有已知問題：跨會話共享會把私人 QQ/DM 內容注入其他會話上下文。

因此目前整合 Bundle：

- 安裝時預設為 Disabled。
- `security.privacyReady` 預設為 `false`。
- 即使有人手動啟用 Bundle，Host 端組合插件也會在隱私閘門未完成時拒絕啟動子插件。
- Discord、Interest 與 Mousepet 的首次啟用亦採保守預設。

**不要把「套件已安裝」回報成「整套功能已啟動」。** 待 Memory Access Controller、身份授權及相關回歸測試完成後，才會在後續階段解除閘門。

## 安裝後檢查

1. 確認 Plugin Manager 顯示 `dsh-hers-life` 已安裝。
2. 確認安裝記錄中的來源分支與解析後 Commit SHA。
3. 確認 12 個子套件均已由套件管理器解析；若有任何子套件缺失，回報安裝失敗，不要手動補裝。
4. 確認整合 Bundle 保持 Disabled，且未啟動任何舊的私人記憶共享路徑。
5. 不要求使用者提供 Token、Cookie 或私人對話作為安裝測試。
6. 不宣稱已完成 Windows 實機驗收；只有在目標 Host 上實際完成測試才能標記通過。

## 失敗與回復

- 優先使用 Plugin Manager 自己的安裝交易回復。
- 安裝失敗後確認 Profile 的 `package.json` 與 `pnpm-lock.yaml` 已恢復。
- 若安裝成功但使用者要求回復，先列出安裝前後 Bundle 差異，再經核准只移除 `dsh-hers-life`。
- 不刪除既有 12 個 Bundle、工作區資料、記憶、日記、QQ Inbox、Discord Session、Edge Profile、Mousepet 皮膚或 AI Cursor PNG。
