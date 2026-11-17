# Hers Life · Discord 適配器

這是 Hers Life 唯一的訊息平台適配器：Discord + DeepSeek Harness。

## 能力

- Discord Gateway v10、REST v10、訊息串流、斜線指令、按鈕／互動、圖片與附件、Thread、語音。
- 每個 DM / Guild Channel / Thread 以 Discord channel id 建立獨立持久 DSH session。
- live/discord-memory.jsonl 是跨會話事件記憶帳本；每筆包含伺服器、頻道、Thread、作者、訊息 id、session 與時間。
- 跨會話召回只選相關事件，不把所有頻道歷史塞進 prompt。
- 私訊預設只在同一位 owner 的私訊會話之間共享；伺服器不會收到私訊原文。若要放寬，必須在設定頁明確開啟。
- 舊工作區缺少目錄或模板時會自動建立，不覆蓋既有檔案。

## 安裝

把 dsh-ming-discord 加進 DSH profile 的 dependencies 與 dsh.profile.bundles。在 Hers Life 的「設定」頁輸入 Discord Bot Token、Owner Discord ID、工作區路徑，按「初始化工作區」即可建立資料結構。

## 注意

- Discord Bot Token 只存在本機 ~/.dsh/hers-life-secrets.json，UI 不會讀回明碼。
- 需要 Node 22+（建議 DSH 自帶的 Node 24）。
- 私訊記憶預設不會進伺服器內容；允許「私訊內容可在群組中使用」前，請理解這代表可能暴露私人資訊。
