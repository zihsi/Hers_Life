# CHANGELOG

## 2026-11-12 — Windows DSH Desktop 安装与 Discord link 依赖修复

- 新增 Windows 11 / DSH Desktop 十二插件安装指南、配置参考、Discord Bot 设置、架构说明、故障排除与安装验证记录。
- 修正根 README 的旧版 `C:/dsh/ming` 安装示例，改为链接到当前 Windows Profile 安装流程。
- 记录 DSH Desktop 0.2.2-rc.2 环境中 `discord.js` 的 link package 解析问题：Profile 可以解析，但插件真实源码目录无法解析。
- 记录本机 Junction 修复步骤、双路径 Node 验证方式与不可提交的本机依赖目录边界。
- 记录 Graph 空 `qqObservations` 路径、缺失 identity API、Interest 清单缺失等已确认问题与修复。
- 明确区分已安装、已由使用者确认、待端到端验证与尚未实现的功能；未提交 Token、个人 ID、私人工作区资料、备份或 node_modules。

## Unreleased — Discord integration

- 新增 `dsh-ming-discord`：Discord 伺服器頻道與私訊各自使用持久 DSH Session；支援 @ Bot 門控、圖片附件、回覆路由與舊 OneBot inbox 相容紀錄。
- `dsh-ming-interest` 可透過相容 inbox 觀察 Discord 未 @ Bot 的群訊息，命中興趣後在對應 Discord Session 喚醒。
- `dsh-ming-browse` 支援 Discord 私訊主人身份辨識與活動結果回傳；`dsh-ming-resume` 支援 Discord steer 插話後接續原任務。
- `dsh-ming-voice` 的 `voice_say` 在 Discord Session 中執行時，bridge 會將工作區 `live/voice` 內的 MP3 安全上傳至原頻道。
- Discord Bot Token 使用 `DISCORD_BOT_TOKEN` 環境變數，不提交密鑰。

## 1.1.0 — 2026-11-11

十二个包齐全之后的第一个正式版本号。

这一版的正事是**换壳之后的接口对齐**：QQ 侧从 QQ-Agent 迁到 AstrBot 4.29。

- 新增 `astrbot_plugins/astrbot_plugin_inbox_record`：把 AstrBot 收到的每条消息按旧格式追加进 `~/.dsh/media/onebot/qq-inbox.jsonl`。
- README 加入消息源说明；插件读取文件与工具，不绑定某个 QQ bot 后端。
- 其余十一包代码未变。

## 1.0.4 — 2026-11-11

- 桌宠增加常态识别与配置持久化。
- 光标并入完整版桌宠。
- 关系图面板拆成独立渲染。

## 1.0.3 — 2026-11-11

- 记忆与关系图增加完整版检测。
- 光标移出本仓。

## 1.0.2 — 2026-11-10

- 光标独立成包；外部页签协议；隐私中性化。

## 1.0.1 — 2026-11-09

- 桌宠卡片跟随、框选期收起、右键二级菜单。
- DSH 会话桥与网页取文。

## 1.0.0 — 2026-11-08

- 面板增加「打开我的浏览器」。
- qa-audit 补 inject mock；导出脚本 `--check` 真演练替换。
