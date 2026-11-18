# AI · DSH 插件集

**Discord-only 重构分支**（2026-11-17）· [CHANGELOG](CHANGELOG.md)

> 待发布的按项变更、使用方法和验证结果见 [CHANGELOG](CHANGELOG.md) 中的变更记录目录。

> 要让别的 agent 跟着记账：格式、目录名、哪份文件被谁读，见 **[RECORDS.md](RECORDS.md)**。

一台 Windows 机器上，一个 AI 的**记忆、眼睛、手和声音**。Discord 原生入口与配套插件，跑在 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）上。

它们不是一个框架，是同一个东西的十二个面：会记得、会看图、会动手、会说话、会自己出去逛。

## 平台支持：Discord + DeepSeek Harness（仅此组合）

此分支只支持 **Discord Bot + DSH**。QQ、OneBot、QQ-Agent、AstrBot 以及旧平台桥接均已退役，不保留兼容层。

Discord 原生适配器负责 Gateway、频道／私讯／Thread 会话、附件、语音、兴趣唤醒与统一设置页。Bot Token 存在 `$DSH_HOME/hers-life-secrets.json`；设置页只显示是否已配置，不回传密钥。

首次設定 Bot 時，請在 Developer Portal → Bot → Privileged Gateway Intents 開啟 **Message Content Intent** 與 **Server Members Intent**；本程式兩項都會送入 Gateway Identify，未啟用時可能收到 `4014 Disallowed Intents`。語音另需 FFmpeg 與可載入的 DAVE 原生模組，詳見 [Discord 適配器說明](dsh-ming-discord/README.md)。

## 这里面有什么

| 包 | 干什么 |
|---|---|
| `dsh-ming-discord` | **唯一聊天入口**：Discord 私訊／伺服器／頻道／Thread 各自獨立 session；所有會話共享可追溯事件記憶；整合興趣喚醒、附件、語音與設定中心 |
| `dsh-ming-core-memory` | [只读记忆查看](dsh-ming-core-memory/INSPECTOR.md)；核心记忆 + 归档记忆。核心常驻注入，归档按意思检索；写入政策只收机器/环境/项目事实，不写关于人的判断 |
| `dsh-ming-memory` | 开场记忆：把人设文件与最近几篇日记拼进系统提示词，只读不回写 |
| `dsh-ming-graph` | 记忆神经元与星图。每条真记忆一个点，每条边都带「凭什么连」的理由 |
| `dsh-ming-mousepet` | 桌宠：**AI 光标**、截图、连拍、常驻看屏（常态识别，画面动了才留帧）、气泡说话（不抢焦点）、UIA/窗口消息动手。原来的轻量版 `dsh-ming-cursor` 2026-11-10 起并进这里，不再单列 |
| `dsh-ming-voice` | 文字转语音，落成 mp3 |
| `dsh-ming-bilibili-account` | B 站：扫码登录、搜视频、字幕、评论、私信、历史、收藏 |
| `dsh-ming-browse` | 「自己玩」：工作区闲够久时自己醒一轮。**不是全局只读**：只有部分 Android 点按和关机/重启走硬拦（`index.js` 的 `tools/pre-execute`），其余工具放行；B 站互动等写操作由配置和个人约定分别授权。面板上有个「打开我的浏览器」，开的是带登录态的真窗口（投稿、投稿件最后要选文件，只能在那个窗口里点）。控制指令只接受 Discord Owner 私訊；完成摘要由 Discord DM 回報 |

| `dsh-ming-wake` | 定时提醒：到点取得/恢复会话并实际投递事项；结果不确定时不盲目重发 |
| `dsh-ming-resume` | 普通插话可接续；明确停止、暂停或换任务时遵守最新要求 |
| `dsh-ming-skill-isolate` | 按工作区遮 skill：这个目录用不上的从模型视野里关掉，不删文件 |
| `dsh-ming-ui` | **不是插件**。两份「唯一源」（样式、面板渲染）和把它们推给各包的同步脚本 |


可选扩展：[共同活动卡](dsh-ming-activities/README.md)——手动保存进度和下一步，需要单独安装，不自动触发 AI。

## Discord 会话与共享记忆

每个 DM、伺服器频道与 Thread 都有自己的 DSH session 和独立历史。跨会话记忆不是把所有历史拼在一起，而是把重要事件写入 `live/discord-memory.jsonl`，附上 Discord message ID、作者、服务器、频道、Thread 与时间；其他会话按相关性召回，并保留来源标签。

同一 Guild 的公開事件可按設定跨頻道共享；跨 Guild 只共享目前 Owner 自己的訊息及她對該 Owner 的回覆，其他成員的訊息不跨 Guild。Owner 私訊只在同一個 Discord User ID 的 Owner 私訊會話之間共享；設定多位 Owner 時彼此仍隔離。

## 装法

這些包可透過 DSH 插件市場安裝；不需要手動找 profile JSON。請在 DSH 的「插件市場 → 索引源」加入上方索引 URL，再從 UI 安裝需要的套件。若是開發者本機 link 安裝，才需要編輯 profile dependencies。假定你 clone 到 `<workspace>\\ming`：

```jsonc
// 開發者手動 link 安裝時：<DSH_HOME>/profiles/desktop/package.json 或 profiles/web/package.json
"dsh-ming-graph": "link:<workspace>\ming/dsh-ming-graph",
"dsh-ming-mousepet": "link:<workspace>\ming/dsh-ming-mousepet",
// 其他必需配套插件照此添加；dsh-ming-activities 是可选扩展
```

再把它們加進同一個文件的 `dsh.profile.bundles` 數組，重啟 DSH。一般使用者建議走插件市場 UI。

`client.js` 是构建物。改 `src/` 之后要重建：

```bash
cd dsh-ming-graph && node build.mjs        # 从 Discord／语音／浏览器／桌宠面板源重新生成 client.js
cd dsh-ming-memory && node build.mjs
```

## 插件市场索引

不想手动 clone + `link:` 的话，把这一个 URL 加进 DSH 的 **插件市场 → 索引源**（在设置里，只有用户本人能加）：

```
https://raw.githubusercontent.com/zihsi/Hers_Life/discord-dsh-only/market/index.json
```

索引是 format 1。12 个包全部走 git 源（`type: git` + 仓库 URL + **钉住的 commit** + `path:`），所以装到的永远是某个确定的提交，不是 main 的浮动头。

**每次发版要重跑一次**，否则市场里还停在旧 commit：

```bash
node scripts/make-market-index.mjs --ref=discord-dsh-only --validator="<DSH_HOME>/data/versions/<版本>/node_modules"
```

`--validator` 会调宿主自带的 `@deepseek-ai/dsh-plugin-market-index` 按 format 1 校验；不给就跳过，并明说「没验过」。

## 隐私

这个仓是从本机导出的，导出脚本会先剔一遍再自检（本機使用者路徑、Discord Token、B 站 uid、真人暱稱、超過 1MB 的檔案），命中任何一条就不许提交。

所以下面这些**不是配置，是占位**，你得自己填：

| 变量 / 位置 | 说明 |
|---|---|
| `DSH_HOME` | DSH 宿主提供的資料根目錄；插件自動讀取，不需要手動設定 |
| 工作區路徑 | 在 Hers Life 設定頁選擇，其他插件從統一服務取得 |
| FFmpeg／ffplay | 應由設定 UI 指定完整路徑；目前仍有部分子插件保留 PATH／舊環境變數相容，尚待整合 |
| Discord Owner ID | 在 Discord 设置中心填写；用于私讯白名单、后台任务回报与 Owner 权限判断 |

## 人格

这套东西是从一台机器上长出来的，那个 AI 叫AI。**「AI」只留在包名、注释和面板标题里**——它是这套东西的来源，不该变成你 AI 的人格。

会进系统提示词的每一句都已经换成中性说法（`【开场记忆】`、`你是这个工作区的助手`）。你在自己工作区的 `persona/` 里写谁，它就是谁；写得越具体，它越像那个人。

（2026-11-09 修的：之前的导出把这些句子连着名字一起发了出去，装上之后模型会把自己认成AI，用户自己写的人格被压在上面一层。现在导出脚本有一道闸——注入字符串里出现项目的自称，就直接不许提交。）

## 状态

在一台机器上天天用，不是发布版。改动的理由和踩过的坑都写在代码注释里——那些注释是这个仓最有用的部分。

## 来源与致谢

- `dsh-ming-mousepet` 里**输入与 AI 光标**那一半，来自 [**dsh-independent-input**](https://github.com/dongcaodeliyu/dsh-independent-input)（作者 **dongcaodeliyu**）。
  它把「操作鼠标键盘」从悬浮球里单独拆出来，默认走 UIA / 窗口消息、不动主人真实光标。这份代码的安全边界原样保留（见那个包的 README）。
  原仓照旧可用，只想要输入、不想要陪桌的，直接用原仓就行。
- 截屏与「看屏幕」那一半原有 `dsh-ming-desktop`，2026-11-08 起退役，已并进 `dsh-ming-mousepet`。
- 其余各包为本机自写。

## 许可

MIT。随便用，出问题别找我。
