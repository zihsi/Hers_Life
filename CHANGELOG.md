# CHANGELOG

## Unreleased — Discord integration

- 新增 `dsh-ming-discord`：Discord 伺服器頻道與私訊各自使用持久 DSH Session；支援 @ Bot 門控、圖片附件、回覆路由與舊 OneBot inbox 相容紀錄。
- `dsh-ming-interest` 可透過相容 inbox 觀察 Discord 未 @ Bot 的群訊息，命中興趣後在對應 Discord Session 喚醒。
- `dsh-ming-browse` 支援 Discord 私訊主人身份辨識與活動結果回傳；`dsh-ming-resume` 支援 Discord steer 插話後接續原任務。
- Discord Bot Token 使用 `DISCORD_BOT_TOKEN` 環境變數，不提交密鑰。

## 1.1.0 — 2026-11-11

十二个包齐全之后的第一个正式版本号。

这一版的正事是**换壳之后的接口对齐**：QQ 侧从 QQ-Agent 迁到 AstrBot 4.29。

- 新增 `astrbot_plugins/astrbot_plugin_inbox_record`：把 AstrBot 收到的每条消息按旧格式
  追加进 `~/.dsh/media/onebot/qq-inbox.jsonl`。原因是那个文件原本由 QQ-Agent 的 onebot
  插件写，换壳后 13:06 就停了，`dsh-ming-interest`（兴趣唤醒）因此读不到任何新消息。
  补上之后**兴趣唤醒侧零改动**就能继续工作——它只认那一个文件的格式。
- README 加「消息源：AstrBot（QQ-Agent 已停用）」一节，写清这套插件不绑某个 bot 后端，
  唯一硬依赖是兴趣唤醒读的那个 jsonl。
- 其余十一个包**代码未变**。

打这个版的原因：README 里第一次把十二个包（记忆、图、桌宠、浏览、兴趣唤醒、
定时唤醒、插话回位、skill 隔离、B 站、语音、面板）写成一份完整清单，
1.0.x 还是「光标拆出去」「桌宠合并」那种边拆边发的号。清单齐了，号就归位。

## 1.0.4 — 2026-11-11

- 桌宠：加常态识别（画面动了才留帧）与配置持久化
- 光标并入完整版桌宠，`dsh-ming-cursor` 不再单列
- 关系图：面板拆成独立渲染

## 1.0.3 — 2026-11-11

- 记忆与关系图加完整版检测
- 光标移出本仓

## 1.0.2 — 2026-11-10

- 光标独立成包；外部页签协议；隐私中性化（人名换成「她」）

## 1.0.1 — 2026-11-09

- 桌宠卡片跟随、框选期收起、右键二级菜单
- DSH 会话桥与网页取文

## 1.0.0 — 2026-11-08

- 面板加「打开我的浏览器」
- qa-audit 补 inject mock；导出脚本 `--check` 真演练替换
