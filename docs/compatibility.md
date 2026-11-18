# 相容性與驗收狀態（Discord-only）

> 本文件只記錄 `discord-dsh-only` 分支。**CI 通過、模擬 Host 通過，不代表已在真實 Windows DSH + Discord Gateway + 語音頻道完成端到端驗收。**
> 更新：2026-11-18。

## 支援目標與最低條件

| 項目 | 目前要求／狀態 | 驗證範圍 |
|---|---|---|
| 聊天平台 | Discord Bot + DeepSeek Harness；QQ、OneBot、AstrBot 已不支援 | 程式與文件的現行目標 |
| Node.js | `>=22` | 各插件 manifest；GitHub CI 使用 Node 22 |
| DSH Profile | 支援 DSH Desktop（由 Desktop Plugin Manager 管理）或長駐 `dsh web`；**不支援 headless 作為常駐 Bot Host** | headless 是單次任務、完成即退出，沒有 HTTP Server、Web Runtime 或 Browser Client；無法承載常駐 Discord Gateway 與設定 UI。 |
| DSH 版本 | 插件 manifest 以 `>=0.2.0` 為最低聲明 | 需要 DSH 的 Cordis inject、tools、agents 等 Host 能力；真實 DSH 仍須以實機啟動確認 |
| Discord Gateway Intent | 必須在 Developer Portal 啟用 Message Content + Server Members | 程式要求兩項；未啟用可能以 close code `4014` 拒絕 Identify |
| Windows 桌寵 | Windows + PowerShell 5.1 + WinForms | 不屬於 Ubuntu CI；每台目標機需人工驗證 |
| Discord 語音 | FFmpeg + 可載入且協定版本相容的 `dsh-ming-discord/discord/dave/davey.node` | `/voice join` 等到 MLS ready 才成功（20 秒逾時）；缺少／不相容、未完成 MLS 或加解密失敗時 fail-closed，不發送明文 Opus。真實 DAVE 握手／音訊尚未由 CI 驗證 |
| Bilibili | 使用者需自行登入帳號 | 自動化測試使用假宿主／假網路；真人掃碼與重啟驗證仍須人工完成 |

## 自動化 CI

GitHub Actions：[`Hers Life Discord CI`](https://github.com/zihsi/Hers_Life/actions/workflows/discord-dsh-ci.yml)。

| 項目 | 執行環境 | 可以證明 | 不能證明 |
|---|---|---|---|
| Node 單元／可靠性測試 | Ubuntu + Node 22 | 純邏輯、合成資料、部分 DSH Host 契約與回歸 | 真 Discord Gateway、權限 Portal、真群組互動 |
| Bilibili 套件載入 | Ubuntu + Node 22 | ESM 載入與套件檔案清單 | 真實 Cookie、真人登入與平台社交操作 |
| Browse 權限／輪替檢查 | Ubuntu + Node 22 | 模擬工具呼叫及確定性規則 | 真正瀏覽器、真帳號及外部網站行為 |
| 離線驗收矩陣 | Ubuntu + Node 22 | `scripts/check.mjs --suite offline` 內列出的離線項目 | Windows、真宿主或真實資料 |
| UI 生成物檢查 | Ubuntu + Node 22 | Graph 生成戳與來源一致；Memory client 可重建且不產生差異 | DSH 前端實際載入與顯示效果 |
| 語法檢查 | Ubuntu + Node 22 | CI 列出的整合模組可被 Node 解析 | 執行時依賴是否能在目標機載入 |

## 仍需實機驗收

以下項目不能用目前的 Ubuntu CI 代替：

1. **Windows DSH 啟動：** 在 DSH Desktop 或長駐 `dsh web` profile 啟用 Discord、Memory、Graph 等插件，確認全部載入且設定頁可開啟。不要用 headless 驗收常駐 Bot；它是 one-shot task runner。
2. **Discord Gateway：** 用真 Bot 測試 DM、@提及、回覆 Bot、Thread、權限限制、斜線指令與附件。確認 Developer Portal 的兩項特權 Intent 都已開啟。
3. **語音：** 確認目前 Node/Electron 能載入隨包附上的 `davey.node`，而且它支援 Discord 協商的 DAVE 協定版本；再測 MLS 完成、播放、收音、離開及重新連線。MLS 未 ready 時會丟棄音訊而非送明文。**僅看到 Bot 加入語音頻道，不代表 DAVE 音訊加解密正常。**目前程式會等到 MLS ready 才回報 join 成功，但仍需在真實 Discord 語音頻道驗證音訊收發。
4. **桌寵／Windows 操作：** 實測截圖、氣泡、UIA、暫停鍵及物理輸入回退；不要只在無管理員權限的簡單視窗測一次就視為所有程式都支援。
5. **Bilibili：** 真人掃碼、查帳號、使用需要登入的功能、登出、重啟後確認登入狀態。
6. **乾淨安裝：** 在另一個 Windows 使用者或乾淨目錄，按 README 從零安裝；中文與空格路徑仍要特別確認。
7. **記憶隔離：** 用兩個不同 Discord 測試帳號／Owner 與非 Owner，驗證私訊背景不會被其他成員召回或看到。

## 本機紀錄（歷史基線，不等於此分支完整驗收）

舊紀錄曾記載 Windows 10.0.26100.8457、Node v24.21.0、DSH 0.2.2-rc.1 與 PowerShell 5.1 的本機環境。該紀錄混有 AstrBot／QQ 舊架構，不能推論目前 Discord-only 分支已在同一台機器完成所有測試；請以本文件上方的 CI 與未驗清單為準。

## 本地檢查命令

```bash
node scripts/check.mjs --list
node scripts/check.mjs --suite offline
node dsh-ming-graph/build.mjs --check
node dsh-ming-memory/build.mjs
```

`fixture` 套件刻意包含失敗項目，只用來驗證檢查器能否正確回報失敗；不要把它當成產品測試，也不要納入 `--suite all` 的成功門檻。
