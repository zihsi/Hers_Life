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
2. 確認目前 DSH Host 版本、目前 Profile、Node runtime 與 Plugin Manager 實際使用的 pnpm。優先使用 Host 提供的資訊；CI 已用 pnpm 11.28.5 驗證，但不可假設使用者機器上有全域 pnpm，也不可自行更換 Host 的套件管理器。
3. 使用 `plugin_manager` 的唯讀列舉操作取得目前已安裝 Bundles。若 12 個舊 Bundle 已存在，不得移除或重複啟用它們。
4. 直接從 GitHub 讀取指定分支的 `package.json`、`cordis.patch.yml` 與 `hers-life.install.json`，核對套件名稱、版本、Bundle manifest、12 個原始功能子套件與 1 個設定支援套件與 peer 版本。不可把 Git URL 本身當成已驗證的套件內容。
5. 透過 Host 暴露的 Profile 路徑建立安裝前備份。若無法取得明確 Profile 路徑或備份未成功，停止安裝。
6. 確認 `plugin_manager` 可用。每個管理動作都必須依 Host 權限規則取得 Full Access 或本次操作核准；不得繞過核准。
7. 若工具不存在、Profile 無法識別、Host 版本不相容或權限不足，停止並清楚回報，不改用手動覆寫 Profile 的方式繞過。

## 安裝動作

在確認使用者已授權安裝後，呼叫 DSH 的 `plugin_manager`：

- `action`: `install_bundle`
- `target`: `https://github.com/zihsi/Hers_Life.git#codex/unified-settings-20261114`
目前上游 `plugin_manager` 工具的 `install_bundle` 參數只有 `target`、`enabled`、`approvedBuilds`、`registry` 等欄位，**沒有 `expected` 參數，也沒有 `inspect` action**。不要傳入工具 schema 不支援的欄位。Plugin Manager 會檢查 DSH peer／`engines.dsh` 相容性與 Bundle 宣告；安裝後必須再呼叫 `list_bundles` 和 `list_plugins`，核對實際安裝的名稱、版本及插件 row 狀態。預期值記錄在 `hers-life.install.json` 的 `postInstallAssertion`。相容性檢查失敗時不得授予版本豁免來強行安裝。

安裝器會安裝根目錄的 `dsh-hers-life` 整合 Bundle。該 Bundle 以 pnpm Git 子目錄依賴取得 12 個既有插件；不得再逐一手動安裝 12 次。

不要自行執行 PowerShell、修改 Profile JSON、建立 Junction、安裝全域 Node/pnpm，或寫入使用者工作區。由 DSH Plugin Manager 管理 Profile 套件與 Lockfile。

若安裝回報 `pendingBuilds`，先列出需要執行的相依套件建置腳本及用途，取得使用者對該批腳本的明確核准後才可傳入 `approvedBuilds`；不得預先全數放行。

## 本機安裝器工具（僅在取得明確 Profile 路徑後使用）

這些 Node 腳本只處理 Profile 的套件管理 metadata，不會搜尋或修改工作區／記憶資料。它們不會猜測 Profile 路徑：

```powershell
node scripts/compatibility-check.mjs --profile-dir "絕對 Profile 路徑" --host-version "Host 回報版本" --plugin-manager-available
node scripts/backup.mjs --profile-dir "絕對 Profile 路徑" --backup-dir "Profile 外的絕對備份路徑"
node scripts/health-check.mjs --profile-dir "絕對 Profile 路徑"
```

`compatibility-check` 的 `readyForPluginManagerAttempt` 只代表本機靜態檢查通過且 Host 已確認 Plugin Manager 可用；`hostCompatibilityConfirmed` 仍為 false，真正的 DSH peer 相容性由 Plugin Manager 在安裝時判斷。它不是安裝成功保證。

首次安裝的回復命令必須在核對備份與差異、取得使用者明確同意後才執行：

```powershell
node scripts/rollback.mjs --profile-dir "絕對 Profile 路徑" --profile-name "實際 Profile 名稱" --backup-dir "原備份絕對路徑" --confirm
```

Rollback 只允許使用「備份當時尚未安裝 dsh-hers-life」的備份，並透過 `dsh plugin --profile <name> remove dsh-hers-life` 執行。這個階段不支援把已存在的 Hers Life 安裝降版或回復舊版本；遇到升級情境必須停止並另做差異式升級回復設計。

## 重要：本階段的安全啟動閘門

目前舊版 `dsh-ming-memory` 仍有已知問題：跨會話共享會把私人 QQ/DM 內容注入其他會話上下文。

因此目前整合 Bundle：

- 根 `hers-life` Host row 會啟動安全初始化，但 `security.privacyReady` 預設為 `false`，因此 12 個功能子插件不會載入。
- 獨立 `hers-life-settings` row 會啟動設定頁與環境偵測；它不會啟動任何功能子插件。
- `privacyReady` 是非即時欄位，不會出現在一般設定表單，也不可由設定頁解除。
- Discord、Interest 與 Mousepet 的首次啟用亦採保守預設。

**不要把「套件已安裝」回報成「整套功能已啟動」。** 目前也刻意不在 Bundle manifest 註冊 DSH Client UI 入口；瀏覽器 UI 原始碼只保留為建置產物，避免 Client 在伺服器端隱私閘門之前先啟動。待 Memory Access Controller、身份授權及相關回歸測試完成後，才會註冊 UI 入口並解除閘門。

## 安裝後檢查

1. 使用 `list_bundles` 確認 `dsh-hers-life` 已安裝，版本符合 `postInstallAssertion`。
2. 使用 `list_plugins` 確認 `hers-life` 與 `hers-life-settings` 兩個 row 存在；設定 companion 應可用，根插件的 `privacyReady` 必須仍為 `false`。
3. 核對 Profile lockfile 記錄的 Git commit、12 個原始子套件，以及 `dsh-hers-life-settings` 支援套件均已解析；任何套件缺失或版本不符都要停止並回報，不要手動補裝或刪除不明套件。
4. 確認根插件只執行安全初始化，12 個功能子插件仍未載入。
5. 不要求使用者提供 Token、Cookie 或私人對話作為安裝測試。
6. 不宣稱已完成 Windows 實機驗收；只有在目標 Host 上實際完成測試才能標記通過。

## 失敗與回復

- 優先使用 Plugin Manager 自己的安裝交易回復。Git 套件相容性驗證在下載後才會完成；失敗時 Plugin Manager 會嘗試還原 Profile manifest／lockfile，仍須檢查最終狀態。
- 安裝失敗後確認 Profile 的 `package.json` 與 `pnpm-lock.yaml` 已恢復；`pnpm-workspace.yaml` 可能保留建置腳本核准紀錄，必須另行檢查，不得直接覆蓋。
- 若安裝成功但使用者要求回復，先列出安裝前後 Bundle 差異，確認備份完整，再經核准透過 DSH Plugin Manager 移除 `dsh-hers-life`。不可直接把整份舊 package.json／lockfile 覆蓋回去，避免抹掉安裝後其他正常變更。
- 本倉 `scripts/backup.mjs`、`scripts/health-check.mjs`、`scripts/rollback.mjs` 提供明確路徑的本機操作工具；都不會猜測 Profile 路徑。Rollback 預設拒絕執行，必須提供 `--confirm` 及同一 Profile 的完整備份。
- 不刪除既有 12 個 Bundle、工作區資料、記憶、日記、QQ Inbox、Discord Session、Edge Profile、Mousepet 皮膚或 AI Cursor PNG。
