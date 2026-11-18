# Hers Life 安裝與驗收（Discord-only）

> 本文件對應 `discord-dsh-only` 分支。它不再描述舊 QQ／OneBot／AstrBot 部署。
> GitHub CI 的離線測試通過，不代表已在你的 Windows DSH Profile 完成真實 Gateway、語音或桌寵端到端測試；限制見 [compatibility.md](compatibility.md)。

## 1. 必要條件

| 項目 | 要求 | 用途 |
|---|---|---|
| Windows／Linux | 依實際插件功能選擇；桌寵僅支援 Windows | Discord／記憶插件可在支援 Node 的 Host 運行，桌寵需 Windows |
| Node.js | 22 或更新版本 | ESM、原生 WebSocket、Node-API |
| DeepSeek Harness | 0.2.0 或更新版本 | 插件 manifest 的最低聲明；仍需實際 Host API 相容 |
| Discord Bot | Bot Token、Application ID／Bot 身分 | 唯一聊天平台 |
| Discord Gateway Intents | Message Content + Server Members | 程式 Identify 會要求兩個特權 Intent；未開可能收到 4014 |
| 即時 Discord 語音 | FFmpeg + 可載入的 `dsh-ming-discord/discord/dave/davey.node` | Opus／音訊處理與 DAVE E2EE；非 Stage 語音不支援無加密降級 |
| TTS | Python + `edge-tts`；Windows 離線回退另需 PowerShell SAPI 與 FFmpeg | 將文字合成 MP3 |
| Bilibili 登入工具 | 使用者自行登入／提供 Cookie | 只有需要登入的 B 站功能才需要 |

Discord 已要求非 Stage 語音連線支援 DAVE E2EE；不支援的客戶端會被語音 Gateway 以 4017 拒絕。Stage 是 E2EE 例外，但本適配器目前沒有 Stage 專用的無 DAVE 傳輸路徑。參考 [Discord 語音加密要求](https://support.discord.com/hc/en-us/articles/25968222946071-End-to-End-Encryption-for-Audio-and-Video) 與 [第三方 Bot 語音最低要求](https://support.discord.com/hc/en-us/articles/38025123604631-Minimum-Client-Version-Requirements-for-Voice-Chat)。

## 2. 安裝方式

這個倉庫的插件目前是私有 Git 工作區套件，**沒有發布到 npm**。建議先把倉庫 Clone 到固定路徑，再透過 DSH Profile 的 `link:` 依賴引用實際執行的那份目錄。

在 DSH Profile 的 `package.json` 中，至少加入主要插件依賴（路徑替換成自己的倉庫位置）：

```jsonc
{
  "dependencies": {
    "dsh-ming-discord": "link:<HERS_LIFE_PATH>/dsh-ming-discord",
    "dsh-ming-memory": "link:<HERS_LIFE_PATH>/dsh-ming-memory",
    "dsh-ming-core-memory": "link:<HERS_LIFE_PATH>/dsh-ming-core-memory",
    "dsh-ming-graph": "link:<HERS_LIFE_PATH>/dsh-ming-graph",
    "dsh-ming-voice": "link:<HERS_LIFE_PATH>/dsh-ming-voice"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-ming-discord",
        "dsh-ming-memory",
        "dsh-ming-core-memory",
        "dsh-ming-graph",
        "dsh-ming-voice"
      ]
    }
  }
}
```

`dsh-ming-voice`、`dsh-ming-graph`、`dsh-ming-core-memory` 可按需求選擇；Discord 入口與跨會話開場日記至少需要 `dsh-ming-discord` 與 `dsh-ming-memory`。若使用提醒、桌寵、主動瀏覽、活動卡或 Bilibili，需再把對應插件加入 dependencies 與 bundles。不要只加 dependencies 而漏掉 bundles。

安裝後重啟 DSH。修改倉庫原始碼不會自動更新已安裝的另一份執行目錄；使用 `link:` 時必須確認連結指向 DSH 實際載入的路徑，而不是另一個 Clone。

## 3. Discord Bot 設定

在 Discord Developer Portal → **Bot → Privileged Gateway Intents** 開啟：

- **Message Content Intent**
- **Server Members Intent**

接著在 Hers Life 的 Discord 設定頁填入：

1. Discord Bot Token。
2. Owner Discord User ID（不是 Guild ID）。
3. 工作區根目錄。
4. 需要限制時填入 Guild／Channel 白名單。
5. 啟用 Hers Life 與 Discord 接收總開關。

Token 只存於 `~/.dsh/hers-life-secrets.json`；設定 API 只回報是否已配置，不會回傳明碼。私訊政策可選 Owner、白名單或任何人；敏感管理指令仍限 Owner。

## 4. 工作區與記憶

工作區由 Hers Life 設定頁管理，包含 `persona/`、`diary/`、`live/`、`memories/`、`outbox/` 等資料夾。工作區更換會保全式複製目的地缺少的檔案，不會覆蓋目的地現有內容。

私訊不寫入共用日記、不參與公開興趣學習，也不進共用事件預覽。舊版留下的 `私聊 ...` 日記條目會在記憶讀取前移至 `~/.dsh/privacy-quarantine/private-dm-diary/`，保留原文但不再進入其他會話的開場日記。請保留隔離資料夾，除非你確定不再需要這些原始紀錄。

## 5. 語音設定

- **TTS 附件**：`dsh-ming-voice` 的 `voice_say` 產生 MP3，再由 `discord_send_file` 傳到目前發起回合的頻道。預設音色、語速與 FFmpeg 可在 Hers Life 設定頁調整。
- **即時語音**：Discord Bot 加入語音頻道並使用 DAVE E2EE；必須能載入打包的 `davey.node`，並且 FFmpeg 可執行。DAVE 載入失敗時，文字聊天仍可使用，但非 Stage 語音會明確不可用。
- TTS MP3 與即時語音是兩條不同路徑；TTS 成功不代表即時語音 DAVE 已驗收。

## 6. 本地檢查

在倉庫根目錄執行：

```bash
node scripts/check.mjs --list
node scripts/check.mjs --suite offline
node scripts/check.mjs --suite build
node dsh-ming-graph/build.mjs --check
node dsh-ming-memory/build.mjs --check
```

修改 Graph 面板來源或任何被 Graph 組裝的面板後，執行：

```bash
node dsh-ming-graph/build.mjs
```

修改 Memory 開場記憶的 client 面板來源後，執行：

```bash
node dsh-ming-memory/build.mjs
```

提交前確認生成物的 `--check` 通過；不可只改 `src/` 卻漏掉 `client.js`。

## 7. 尚需實機驗收

自動化 CI 使用 Ubuntu + Node 22 與模擬 Host，不能代替以下實機測試：

- 在實際 Windows DSH Profile 啟動所有需要的插件，確認設定頁／關係圖可載入。
- 以真 Discord Bot 驗證 DM、@提及、回覆、Thread、附件、PNG／APNG／GIF 貼圖與斜線指令。
- 使用兩個不同 Discord 使用者測試 Owner 權限、DM 政策、頻道白名單、跨會話記憶與私訊隔離。
- 在真實語音頻道驗證 DAVE 加入、收音、播放、離開及重連；只見 Bot 加入頻道不代表音訊加解密已正常。
- 驗證 Bilibili 真人掃碼、重啟後登入狀態，以及桌寵截圖／UIA／物理輸入回退。
- 在乾淨 Profile 與含中文、空格的路徑做一次從零安裝。

完整自動測試與未驗範圍請看 [compatibility.md](compatibility.md)。
