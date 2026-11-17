# Hers Life · Discord 適配器

這是 Hers Life 唯一的訊息平台適配器：Discord + DeepSeek Harness。

## 能力

- Discord Gateway v10、REST v10、訊息串流、斜線指令、按鈕／互動、圖片與附件、Thread、語音。
- 每個 DM / Guild Channel / Thread 以 Discord channel id 建立獨立持久 DSH session。
- live/discord-memory.jsonl 是跨會話事件記憶帳本；每筆包含伺服器、頻道、Thread、作者、訊息 id、session 與時間。
- 跨會話召回只選相關事件，不把所有頻道歷史塞進 prompt。
- DM 記憶預設只在已設定 Owner 的私訊會話之間共享。公開頻道只有 Owner 本人發言時，才可按「允許 Owner 私訊作為背景」開關召回私人背景；其他成員不會取得該背景，且提示中隱去私訊來源標籤。
- 私訊政策可選「僅 Owner／白名單／任何人」；白名單模式的 Discord User ID 可直接在同一設定頁維護。
- 舊工作區缺少目錄或模板時會自動建立，不覆蓋既有檔案。

## 安裝

把 dsh-ming-discord 加進 DSH profile 的 dependencies 與 dsh.profile.bundles。在 Hers Life 的「設定」頁輸入 Discord Bot Token、Owner Discord ID、工作區路徑，按「初始化／補齊工作區」即可建立資料結構。人設 Markdown、AGENTS.md 與日期格式日記也能直接在設定頁編輯，不必自行找檔案。

## 注意

- Discord Bot Token 只存在本機 ~/.dsh/hers-life-secrets.json，UI 不會讀回明碼。
- 需要 Node 22+（建議 DSH 自帶的 Node 24）。
- Token 不會出現在設定 API 回傳內容；一般設定檔中若有舊版明碼 Token，啟動遷移時會搬到獨立密鑰檔。
- 請先理解 Owner 私訊背景只會在 Owner 自己發言的公開回合中召回；需要最嚴格的隔離時，關閉「允許 Owner 本人發言時使用私訊作為背景」。
- 切換工作區會保全式複製缺少的檔案；請重啟 DSH，讓所有配套插件一起切換到新工作區。
