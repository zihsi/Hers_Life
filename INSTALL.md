# Windows 11 安装指南（DSH Desktop）

本文记录本仓十二个独立 DSH bundles 的旧式本地 `link:` 安装方式，主要供开发与旧 Profile 迁移使用。**一般使用者请优先使用 [HERS_LIFE_AGENT_INSTALL.md](HERS_LIFE_AGENT_INSTALL.md) 的统一 Git Bundle 安装方式**，或在 Plugins → Add plugin 输入 `https://github.com/zihsi/Hers_Life.git#codex/unified-settings-20261114`。本文件中的历史安装分支与版本仅供追溯，不得覆盖本项目固定研究基准。

## 1. 已验证环境与边界

本次实际安装验证环境：

- Windows 11
- DeepSeek Harness Desktop `0.2.2-rc.2`
- Node.js `24.21.0`（DSH Desktop 内置 runtime）
- pnpm `11.28.5`（DSH Desktop 内置 runtime）
- Cordis `4.1.0`
- Discord.js `14.28.1`
- 安装基线分支：`sync/local-latest-20261113`（本分支为 2026-11-13 的用户同步基线；后续开发分支不应直接当作安装基线）

以上是一次实际安装环境，不代表其他版本都已验证。不同 DSH 版本的 profile 结构、插件 API 和依赖版本可能不同。

## 2. 十二个 DSH bundles

以下十二个目录都要加入同一个 profile 的 dependencies 和 `dsh.profile.bundles`：

1. `dsh-ming-core-memory`
2. `dsh-ming-memory`
3. `dsh-ming-graph`
4. `dsh-ming-mousepet`
5. `dsh-ming-voice`
6. `dsh-ming-bilibili-account`
7. `dsh-ming-browse`
8. `dsh-ming-interest`
9. `dsh-ming-wake`
10. `dsh-ming-resume`
11. `dsh-ming-discord`
12. `dsh-ming-skill-isolate`

`dsh-ming-ui` 是共享 UI source，不是 bundle。`astrbot_plugins/astrbot_plugin_inbox_record` 是 AstrBot 插件，也不是 DSH bundle。

## 3. 确认 DSH 路径

不要假定 DSH 安装位置或用户名。下面以变量方式表示：

- `DSH_HOME`：DSH 主目录，常见默认值为 `$env:USERPROFILE\.dsh`
- `PROFILE`：目标 profile 目录，例如 `$DSH_HOME\profiles\desktop`
- `REPO`：本仓 clone 目录
- `WORKSPACE`：你自己的工作区

本次单机验证使用的目录结构是 DSH Desktop 安装目录、`%USERPROFILE%\.dsh\profiles\desktop` 与独立的仓库 clone；个人绝对路径不写入仓库。

## 4. Clone 仓库

在 PowerShell 中选择你自己的代码目录：

```powershell
$Repo = "D:\Hers_Life" # 按你的实际 clone 位置修改
git clone --branch sync/local-latest-20261113 https://github.com/zihsi/Hers_Life.git $Repo
git -C $Repo switch sync/local-latest-20261113
git -C $Repo pull --ff-only
```

如果已经 clone，不要重复 clone；进入现有目录并更新分支即可。

## 5. 将十二个包加入 Profile

先备份目标 profile 的 `package.json`、`pnpm-lock.yaml` 与 `cordis.patch.yml`。不要删除整个 profile，也不要清空或重建 `node_modules` / pnpm store。

**链接插件的宿主 API 依赖要声明为 peerDependencies。** 本仓 `dsh-ming-bilibili-account/package.json` 已声明 `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-llm`，让 DSH loader 能将插件 API 依赖解析到宿主提供的版本。不要为了消除加载错误随意把宿主 API 复制安装成插件自己的独立运行时版本。

在 profile 的 `package.json` 中：
- 把十二个目录加入 `dependencies`，值为指向各自本机目录的 `link:` 路径。
- 把十二个 bundle 名称加入 `dsh.profile.bundles`。
- 保留 profile 原有 dependencies、bundles、scripts 和其他配置，不要整份覆盖。

示意（路径必须替换成你的真实仓库位置）：

```json
{
  "dependencies": {
    "dsh-ming-core-memory": "link:D:/Hers_Life/dsh-ming-core-memory",
    "dsh-ming-memory": "link:D:/Hers_Life/dsh-ming-memory",
    "dsh-ming-graph": "link:D:/Hers_Life/dsh-ming-graph",
    "dsh-ming-mousepet": "link:D:/Hers_Life/dsh-ming-mousepet",
    "dsh-ming-voice": "link:D:/Hers_Life/dsh-ming-voice",
    "dsh-ming-bilibili-account": "link:D:/Hers_Life/dsh-ming-bilibili-account",
    "dsh-ming-browse": "link:D:/Hers_Life/dsh-ming-browse",
    "dsh-ming-interest": "link:D:/Hers_Life/dsh-ming-interest",
    "dsh-ming-wake": "link:D:/Hers_Life/dsh-ming-wake",
    "dsh-ming-resume": "link:D:/Hers_Life/dsh-ming-resume",
    "dsh-ming-discord": "link:D:/Hers_Life/dsh-ming-discord",
    "dsh-ming-skill-isolate": "link:D:/Hers_Life/dsh-ming-skill-isolate"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-ming-core-memory",
        "dsh-ming-memory",
        "dsh-ming-graph",
        "dsh-ming-mousepet",
        "dsh-ming-voice",
        "dsh-ming-bilibili-account",
        "dsh-ming-browse",
        "dsh-ming-interest",
        "dsh-ming-wake",
        "dsh-ming-resume",
        "dsh-ming-discord",
        "dsh-ming-skill-isolate"
      ]
    }
  }
}
```

上面是结构示例，不是要求覆盖现有 package.json。使用 JSON 工具或手动合并时，确保原有项目没有被删掉。

## 6. 使用 DSH 内置 Node / pnpm

优先使用 DSH Desktop 自带 runtime 的 node 与 pnpm，避免系统中其他 Node / pnpm 版本造成 lockfile 或 store 不一致。

示意路径（请按实际安装目录确认）：

```powershell
$DshInstall = "D:\DeepSeek Harness"
$Node = Join-Path $DshInstall "resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
$Pnpm = Join-Path $DshInstall "resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
$Profile = Join-Path $env:USERPROFILE ".dsh\profiles\desktop"

& $Node --version
& $Node $Pnpm --version
```

先确认两个版本输出，再进入 profile 目录执行依赖安装。安装时不要切换 DSH_HOME 或 profile 所在磁盘；如果此前迁移过 DSH_HOME，先检查 pnpm storeDir 与现有 node_modules 的链接一致性。

## 7. 安装 Profile 层依赖

Discord bridge 的 package.json 声明 `discord.js ^14.19.3`。由于 pnpm 的 `link:` 本地包依赖不会自动把依赖安装到链接目标目录，单独在 Profile 安装 `discord.js` 还不足以保证插件源目录可以解析它。安装 Cordis peer 依赖时也要遵守当前 DSH 版本要求。

```powershell
Push-Location $Profile
& $Node $Pnpm add "discord.js@^14.19.3"
& $Node $Pnpm add "@deepseek-ai/cordis@4.1.0"
& $Node $Pnpm install
Pop-Location
```

如果当前 DSH 版本已经提供兼容 Cordis，先核对宿主版本和 peer dependency，不要盲目降级或覆盖。上面 Cordis 4.1.0 是本次 DSH Desktop 0.2.2-rc.2 环境的验证值。

## 8. Discord 本地依赖解析（仅在实际报错时处理）

当前分支的 Discord 插件已由使用者确认可以正常载入并连接 Bot。不要为了预防性排错而重复建立或覆盖现有 `node_modules` / Junction。

### 何时需要检查

只有在日志明确出现 `Cannot find module 'discord.js'`，且 Profile 目录可以解析、插件真实源码目录却不能解析时，才检查本机 link 依赖布局。Node 会从插件真实源码目录解析 ESM import；pnpm `link:` 的模块解析位置可能与 Profile 不同。

### 建立 Junction（条件式方案）

先确认插件目录不存在自己的 `node_modules`。若它已经存在，先检查内容和链接目标，不要覆盖：

```powershell
$Repo = "D:\Hers_Life" # 修改为真实仓库路径
$Profile = Join-Path $env:USERPROFILE ".dsh\profiles\desktop"
$PluginModules = Join-Path $Repo "dsh-ming-discord\node_modules"
$ProfileModules = Join-Path $Profile "node_modules"

if (-not (Test-Path $PluginModules)) {
    New-Item -ItemType Junction -Path $PluginModules -Target $ProfileModules
} else {
    Get-Item $PluginModules | Format-List FullName,LinkType,Target
    Write-Warning "node_modules 已存在；先人工确认，不要覆盖。"
}
```

这是本机安装布局的修复，不是插件源码。**不要把 Junction、node_modules 或依赖缓存提交到 Git。** 如果 Profile 或仓库位置变动，需要重新检查 Junction 目标。若目前插件已正常载入，就不要重复建立。

### 验证依赖解析

用 Node 脚本文件而不是把 Windows 路径嵌入单引号 JavaScript 命令，避免 PowerShell 吞引号或反斜线转义：

```powershell
$Node = "D:\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
$Repo = "D:\Hers_Life" # 修改为真实仓库路径
$env:DSH_PROFILE = "$env:USERPROFILE\.dsh\profiles\desktop"
$env:DSH_PLUGIN = Join-Path $Repo "dsh-ming-discord"

$TestCode = @'
const { createRequire } = require("node:module");
for (const [name, dir] of [
  ["Profile", process.env.DSH_PROFILE],
  ["Plugin", process.env.DSH_PLUGIN]
]) {
  const r = createRequire(dir + "/package.json");
  try { console.log(name + ":", r.resolve("discord.js")); }
  catch (e) { console.log(name + " ERROR:", e.message); process.exitCode = 1; }
}
'@
$TestFile = Join-Path $env:TEMP "dsh-discord-resolve-test.cjs"
[System.IO.File]::WriteAllText($TestFile, $TestCode, [System.Text.UTF8Encoding]::new($false))
& $Node $TestFile
Remove-Item $TestFile -Force
Remove-Item Env:\DSH_PROFILE
Remove-Item Env:\DSH_PLUGIN
```

两个位置都应解析到实际的 `discord.js\src\index.js`。若 Profile 成功但 Plugin 失败，先检查 Junction 是否存在、目标是否正确，以及插件是否通过 link 指向预期目录。

## 9. 插件配置与工作区

把需要的插件配置合并进 Profile 的 `cordis.patch.yml`，不要用示例覆盖现有配置。详细字段与本机配置原则见 [CONFIGURATION.md](CONFIGURATION.md)。

建议：
- 把工作区路径统一指向自己的工作区。
- Graph 的 `qqObservations` 必须是一个实际存在的 JSONL 文件；没有 QQ 观察数据时可以创建空文件。
- Interest 的 `interestsFile` 必须先建立有效 JSON。
- Discord Token 只从环境变量读取。
- MuMu ADB 使用你实际安装版本的 adb.exe 路径与正确 serial；不要照抄旧 MuMu 12 路径。

## 10. 构建与重启

只有带共享 UI build 脚本的包需要构建。例如：

```powershell
Push-Location (Join-Path $Repo "dsh-ming-graph")
& $Node .\build.mjs
Pop-Location

Push-Location (Join-Path $Repo "dsh-ming-memory")
& $Node .\build.mjs
Pop-Location
```

完成后完全退出 DSH Desktop，再重新启动。只关闭窗口不一定等于退出后台进程。

## 11. 安装完成检查

- Profile 的 dependencies 中有十二个 link 包。
- `dsh.profile.bundles` 中有十二个对应名称。
- `pnpm install` 正常结束，peer dependency 检查没有错误。
- Graph / Memory 的 client build 成功。
- Discord 的 Profile 与 Plugin 两个解析测试都成功。
- DSH 插件页显示各 bundle 已运行。
- Discord Bot 在 Developer Portal 已启用 Message Content Intent，Token 已设置，邀请权限足够。
- Discord 连接日志出现 ready 状态；在频道 @ Bot 能收到回复。
- 未 @ 的文字消息可进入 interest inbox；兴趣唤醒还需配置群组与兴趣主题。

## 12. 不要做的事

- 不要删除整个 Profile、`node_modules` 或 pnpm store 来「重装」。
- 不要搬移、替换或清空已有工作区。
- 不要把 Token、私人 ID、群号、私人对话、个人备份或本机缓存上传到 GitHub。
- 不要把本机 Junction 当成仓库源码提交。
- 不要把「bundle 已载入」误认为所有外部服务已经连接或所有功能都已端到端验证。
