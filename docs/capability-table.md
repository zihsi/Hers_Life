# 現行能力與邊界（Discord-only）

> 本表只描述 `discord-dsh-only` 分支目前的程式碼，不承接舊 QQ／OneBot／AstrBot 架構的能力宣稱。
> 更新：2026-11-18。對應程式位置列在最後一欄；自動測試與實機未驗範圍另見 [compatibility.md](compatibility.md)。

## 平台與對話

| 功能 | 目前實作 | 邊界／注意事項 | 程式位置 |
|---|---|---|---|
| 平台 | Discord Bot + DeepSeek Harness；沒有 QQ、OneBot、QQ-Agent 或 AstrBot 相容層 | Discord 是唯一聊天入口 | `dsh-ming-discord/` |
| 會話 | DM、Guild 文字頻道、Thread 依 Discord channel ID 建立獨立 DSH session | 不把不同頻道的完整 session 歷史合併 | `dsh-ming-discord/pool.js` |
| 回覆觸發 | 預設只回 @Bot 或回覆 Bot 的訊息；可設定全頻道回覆或不回覆 Guild 訊息 | 私訊另受 DM 開關與 Owner／白名單政策限制 | `discord/bridge.js`, `settings.js` |
| Slash／訊息選單 | `/ask`、`/say`、`/memory`、`/status`、`/voice`，以及 `peek`、`remember` 選單 | 套用 DM 政策與 Guild／Channel 白名單；`/memory`、`/status`、`/say`、`/voice`、`remember` 限 Owner，敏感查詢回覆採 ephemeral | `discord/commands.js`, `discord/bridge.js` |
| 附件與貼圖 | 最多讀取前 10 個一般附件；支援圖片轉模型影像區塊。貼圖 PNG／APNG／GIF 最多抓取前 5 張並轉為影像區塊 | Lottie 貼圖仍只提供名稱／ID 文字說明；非影像附件下載至工作區但不會自動 OCR／轉文字；大小受設定上限控制 | `discord/bridge.js`, `images.js` |
| 回覆輸出 | 回覆可串接原訊息、長文字分段、將模型產生的附件上傳 Discord | Discord 單則訊息與附件數限制仍適用 | `discord/bridge.js`, `util.js` |

## 記憶與興趣

| 功能 | 目前實作 | 邊界／注意事項 | 程式位置 |
|---|---|---|---|
| 跨會話事件記憶 | Discord 事件寫入 `live/discord-memory.jsonl`，保留 message、author、guild、channel、thread、session 等來源欄位 | 這是可追溯事件索引，不是把每個頻道所有訊息無限制塞入每次提示 | `dsh-ming-discord/memory.js`, `dsh-ming-discord/discord/events.js` |
| 跨頻道／伺服器召回 | 可設定同伺服器跨頻道、跨伺服器召回 | 關閉相應設定後，不應把該範圍的事件提供給其他會話 | `dsh-ming-discord/memory.js`, 設定頁 |
| 私訊背景 | Owner 私訊可在同一個 Discord User ID 的其他私訊會話共享；也可選擇在該 Owner 本人於公開頻道發言時作為隱去來源的背景 | 多 Owner 設定時仍按精確 User ID 隔離；其他成員與其他 Owner 都不會取得該私訊。關閉「允許 Owner 私訊作為公開頻道背景」可再收緊 | `dsh-ming-discord/memory.js` |
| 人格／日記開場 | `dsh-ming-memory` 從工作區人格檔與最近日記組成開場注入 | 該插件本身是讀取／注入，不應描述成它會自行改寫人格檔 | `dsh-ming-memory/` |
| 興趣學習／喚醒 | 從公開頻道訊息被動累積詞頻；達到門檻後可成為主題；再經靜默時段、冷卻、每小時上限與模型判斷後才可能接話 | 學到詞不代表必然發言；Owner 可在設定頁管理主題、忽略詞及暫停開關 | `dsh-ming-discord/interests.js`, `discord/bridge.js` |

## 語音、瀏覽與桌面

| 功能 | 目前實作 | 邊界／注意事項 | 程式位置 |
|---|---|---|---|
| Discord 語音連線 | `/voice` 可要求加入／離開語音頻道；底層實作 Opus、UDP、語音 Gateway 與 DAVE | 非 Stage 語音連線必須可載入 DAVE 原生模組；缺失時會在連線前報錯，不嘗試無 E2EE 降級。Stage 例外尚未實作專用降級路徑 | `dsh-ming-discord/discord/voice.js`, `discord/dave.js` |
| 文字轉語音 | `dsh-ming-voice` 的 `voice_say` 產生 MP3；可再用 `discord_send_file` 將檔案送到目前會話頻道；預設音色、語速與 FFmpeg 可在 Discord 設定頁調整 | 這和即時語音連線是兩條不同路徑；需可用的 Edge TTS 或 Windows SAPI。非 Owner 只能傳送自己在該會話產生、具 session/user 標籤的音訊 | `dsh-ming-voice/index.js`, `dsh-ming-discord/index.js` |
| 自主瀏覽 | `dsh-ming-browse` 可在設定條件下執行背景瀏覽／活動；Owner 控制入口走 Discord 私訊 | **不是全域唯讀沙盒**。部分高風險 Android／關機類工具有硬性攔截；其他寫入能力仍依工具、設定與行為規則，不能把它宣稱為全面防寫入 | `dsh-ming-browse/index.js`, `lib/permissions.mjs` |
| 桌面陪伴 | `dsh-ming-mousepet` 提供螢幕觀察、氣泡、UIA／視窗訊息操作；物理輸入是明確回退模式 | Windows PowerShell 5.1／WinForms；UIA 取決於目標應用是否暴露可操作元素；物理輸入會影響真實桌面，不能視為無副作用 | `dsh-ming-mousepet/` |
| Bilibili 帳號 | 獨立插件提供掃碼登入、帳號狀態與已註冊的 B 站工具 | 登入態會同步寫入 DSH credentials service 與 `~/.dsh/bili-duty/bili_credential.json`；退出會寫 tombstone 防止舊 Cookie 復活。登入／恢復依賴宿主憑證服務與 B 站可用性 | `dsh-ming-bilibili-account/` |
| 其他 DSH 輔助 | 提醒、插話接續、Skill 隔離、共同活動等均為獨立可選插件 | 各自仍須在 DSH profile 中安裝並啟用；共同活動插件是手動記錄，不會自動代替使用者推進 | `dsh-ming-wake/`, `dsh-ming-resume/`, `dsh-ming-skill-isolate/`, `dsh-ming-activities/` |

## 安全與安裝前提

1. **Discord 特權 Intent：** 必須在 Developer Portal 開啟 Message Content Intent 與 Server Members Intent；程式兩項都會要求。缺少設定可能以 Gateway close code `4014` 斷線。
2. **語音：** 需要可用的 FFmpeg 與可載入的 `dsh-ming-discord/discord/dave/davey.node`。原生模組不相容時，文字聊天仍可運作，但非 Stage 語音不可用。
3. **工作區與私訊隔離：** 人格、日記、Discord 事件記憶及瀏覽資料會依共用工作區路徑讀寫。舊版本寫進共用日記的 `私聊 ...` 條目會在啟動／記憶開場前搬至 `~/.dsh/privacy-quarantine/`，原文保留但不再進共享日記。更換工作區後，應重新啟動所有配套插件／DSH。
4. **權限界線：** Owner ID 是授權身分，不等於所有工具操作都有全域確認閘。尤其 `dsh-ming-browse` 不是全面唯讀；執行前仍要理解對應工具與設定。
5. **未實測範圍：** 自動化測試不等於真 Discord Gateway、真伺服器訊息、語音 DAVE 握手或 Windows 桌面端到端驗收。實測狀態見 [compatibility.md](compatibility.md)。

