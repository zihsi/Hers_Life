# Hers Life 統一設定

這是 Hers Life 的獨立設定介面套件。它在 DSH Settings 中提供一個統一頁面，透過 Host 的 Config Forms 與 Credentials Remote API 寫入設定。

- 一般設定寫入 DSH Profile 的插件設定表單，不要求手動編輯 JSON/YAML。
- Discord Bot Token 透過 `ctx.remote.credentials` 寫入 DSH Credentials；讀取端只有 configured/source 狀態，不會取回完整 Token。
- 環境偵測只回報 Node、Python、FFmpeg、FFplay、ADB、DSH 與 PowerShell 的可執行檔位置，不會執行這些工具。
- 這個套件不啟動 12 個功能插件；根整合插件的 Memory Privacy Gate 仍是唯一啟動閘門。
