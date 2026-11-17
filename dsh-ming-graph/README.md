# dsh-ming-graph：Discord／DSH 記憶星圖

`dsh-ming-graph` 是 Hers Life 的唯讀視覺化插件。它把 DSH 歸檔筆記、Discord 共享事件與日記轉成可檢查的星圖、神經元關係、時間線及記憶面板。

## 資料來源

```text
DSH 歸檔筆記 ─────────────┐
live/discord-memory.jsonl ├─► dsh-ming-memory/lib ─► graph snapshot ─► UI
工作區 diary/ ────────────┘
```

Discord 事件由 `dsh-ming-discord` 寫入共享帳本。每筆事件會保留訊息 ID、作者 ID／名稱、Guild、Channel、Thread、時間及來源 session。

- **人物**：以 Discord User ID 合併同一個人，跨 DM、伺服器、頻道與 Thread 都是同一個人物節點。
- **房間**：以伺服器／頻道／Thread 作為來源位置，顯示來源標籤，不把不同房間混成同一段對話。
- **記憶**：每個節點對應真實筆記或事件；關係線必須帶有可讀的理由，不以視覺距離臆造關係。
- **時間線**：以事件時間排序，保留原始事件的出處。

## 隱私與邊界

星圖只讀取工作區中的 DSH 筆記、日記與 Discord 事件帳本，不會連線 Discord，也不會主動抓取私訊。哪些事件能跨會話召回，由 `dsh-ming-discord` 的記憶設定決定；星圖顯示帳本中已存在的記憶來源，不改寫原始事件。

本分支不再讀取 QQ-Agent observations、OneBot 群組索引或舊平台檔案，也不保留對應設定欄位。

## 工作區與安裝

工作區由 `dsh-ming-discord` 的 Hers Life 設定中心指定。Graph 透過 Cordis 注入的 `hersLifeDiscord` 服務取得同一個工作區，不需再維護一份獨立絕對路徑設定。

`dsh-ming-graph` 會從相鄰的 `dsh-ming-memory/lib/` 載入資料層，因此請保留倉庫內兩個插件的並列位置。安裝時需同時啟用 `dsh-ming-memory` 與 `dsh-ming-graph`。

若修改 `src/` 的前端來源，請在倉庫根目錄執行：

```bash
node dsh-ming-graph/build.mjs
```

它會重建 `client.js`。不要只改來源檔而忘了同步打包輸出。

## 自我檢查

```bash
node dsh-ming-graph/wiring-check.mjs
node dsh-ming-graph/neuron-check.mjs
node dsh-ming-graph/fingerprint-cache.test.mjs
node dsh-ming-graph/price-index.test.mjs
```

這些測試不會連 Discord Gateway。實際 DSH UI、最新事件刷新與使用者權限仍需在目標 DSH profile 驗收。

## 資料保護

- 不把使用者 ID、私人暱稱或工作區絕對路徑寫進共用程式碼。
- 修改、清理或遷移工作區前，請先備份 `live/discord-memory.jsonl`、`diary/` 與 DSH 歸檔筆記。
- 沒有來源資料時顯示空狀態或錯誤，不產生示範節點。
