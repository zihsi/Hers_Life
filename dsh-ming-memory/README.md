# dsh-ming-memory：人格、日記與跨會話資料層

本插件是 Hers Life 的工作區記憶層，和 `dsh-ming-discord` 一起使用。設定、人格檔案與日記路徑由 Discord 適配器的 Hers Life 設定中心統一管理；不需要手動建立 `ming-memory.json`。

## 職責分工

| 元件 | 負責內容 |
|---|---|
| `dsh-ming-discord` | Discord DM／伺服器頻道／Thread 的獨立 DSH session；將 Discord 訊息事件寫入共享帳本，依隱私範圍召回相關記憶 |
| `dsh-ming-memory` Host | 對工作區內的一般 DSH 工作會話注入人格、約定與近期日記；維持非 Discord 工作會話的跨會話線索 |
| `dsh-ming-memory/lib/model.mjs` | 讀取 DSH 歸檔筆記、Discord 事件帳本與日記，組成星圖／人生視圖資料 |
| `dsh-ming-memory/lib/neuron.mjs` | 將 DSH 筆記與 Discord 事件轉成可追溯的記憶節點與關係 |
| `dsh-ming-graph` | 顯示星圖、神經元、時間線與記憶面板；不自行生成聊天記憶 |

Discord session 會跳過本插件的一般對話捕獲路徑，避免和 DiscordBrain 重複寫入；Discord 訊息的唯一入口是 `dsh-ming-discord`。

## 工作區結構

按 Hers Life 設定頁的「初始化／補齊工作區」會自動建立必要目錄與預設模板。預設結構如下：

```text
<workspace>/
  AGENTS.md
  persona/
    人设.md
    名字.md
    约定.md
  diary/
    YYYY-MM-DD.md
  memories/
    notes/
  sightings/
  knowledge/
  config/
  live/
    discord-memory.jsonl
    discord-events.jsonl
    discord-sessions.json
    interests.json
    status.json
```

`personaFiles` 與 `diaryDir` 可在設定頁調整。編輯器只允許寫入已設定的人設 Markdown、`AGENTS.md` 與日期格式日記；不開放任意檔案路徑。

## 共享記憶與來源

`live/discord-memory.jsonl` 由 Discord 適配器維護。每筆事件帶有 Discord message ID、作者 ID／名稱、伺服器、頻道、Thread、時間、所屬 DSH session 與事件角色。星圖以 Discord User ID 合併同一個人，並保留事件出處，方便回查。

所有 Discord session 共用同一份人格核心；Owner DM 另可注入私人日記與工作狀態，公開頻道只注入人格檔、不注入私人日記或接續資料。跨會話不會把所有歷史整包注入。DiscordBrain 會依目前訊息的關鍵詞、目前發言者身分與設定範圍挑選相關事件，並在提示中附上來源標籤。DM、一般頻道與 Thread 的原始 session 歷史仍然彼此獨立。

隱私預設：

- 同一 Guild 的公開事件可按設定跨頻道召回；跨 Guild 只允許同一 Owner 的訊息及她對該 Owner 的回覆跨伺服器召回，其他成員不跨 Guild。
- Owner 私訊只會在已設定 Owner 的私訊會話之間共享。
- 公開頻道只有 Owner 本人發言的回合，才可依開關使用 Owner 私訊作為私人背景；其他成員不會取得 Owner 私訊內容。即使召回，也隱去私訊來源標籤。
- 關閉相應記憶開關後，資料不會被刪除，只是不再召回。

## 安裝與路徑

把 `dsh-ming-memory` 和 `dsh-ming-graph` 放在同一個 Hers Life 倉庫中，並在 DSH profile 同時安裝／啟用。Graph 透過相對路徑載入 memory 的資料層，因此兩個目錄必須保持目前的並列結構。

工作區路徑以 Hers Life 設定中心為準。設定中心會同步本插件所需的設定檔；一般安裝不必設定任何 `MING_*` 環境變數。

## 離線檢查

在倉庫根目錄執行：

```bash
node dsh-ming-memory/qa-all.mjs
node dsh-ming-memory/qa-smoke.mjs
node dsh-ming-memory/qa-diary-budget.mjs
node dsh-ming-graph/wiring-check.mjs
node dsh-ming-graph/neuron-check.mjs
```

測試使用假 ctx 或本機檔案，不會連 Discord Gateway。完整的 DSH 啟動、模型回覆與跨伺服器行為仍需在實際 DSH 環境驗收。

## 邊界

- 不支援 QQ、OneBot、QQ-Agent 或 AstrBot。
- 不把 DM 原文無條件傳送到公開伺服器。
- 不因讀取失敗而編造記憶或來源。
- 刪除檔案或清空事件帳本前，請先自行備份工作區。
