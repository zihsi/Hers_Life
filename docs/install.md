# 最小安装（F-3）

> 这是**本机跑通过**的一份记录，不是「所有机器都行」的承诺。
> 每条都标了验证层级：`已验证` = 在这台机器上真跑过；`未验` = 没条件，别当已经支持。

## 1. 支持条件

| 项 | 本机实测值 | 说明 |
|---|---|---|
| Windows | 10.0.26100.8457 | 只有这一个版本验过 |
| Node | v24.21.0（Discord 适配器要求 Node 22+） | 使用 ESM、原生 WebSocket 与现代 Node API |
| DSH | 0.2.2-rc.1 | 插件靠 Cordis 的 `inject` / `tools` / `agents`；低版本不一定有 |
| Discord Bot | Bot Token + Message Content Intent | 由 `dsh-ming-discord` 统一连接；无需额外消息桥 |

## 2. 安装方式

当前**没有发 npm**。本机是 DSH profile 的 `link:` 依赖 + `dsh.profile.bundles`：

```jsonc
// ~/.dsh/profiles/web/package.json 里
{
  "dependencies": {
    "dsh-ming-discord": "link:C:/dsh/Hers_Life/dsh-ming-discord",
    "dsh-ming-memory": "link:C:/dsh/Hers_Life/dsh-ming-memory",
    "dsh-ming-core-memory": "link:C:/dsh/Hers_Life/dsh-ming-core-memory",
    "dsh-ming-browse": "link:C:/dsh/Hers_Life/dsh-ming-browse"
  }
}
```

Windows 路径用正斜杠。`link:` 指向的目录必须是**运行目录**（DSH 实际加载的那份），不是源码仓库
——这两者是两套文件，改仓库不会自动生效，这是今天踩过的坑。

## 3. 三个位置要分清

| 名字 | 是什么 | 本机值 |
|---|---|---|
| 源码仓库（`MING_ROOT`） | 放代码、跑的测试、生成物 | `C:\dsh\Hers_Life` |
| 数据工作区（`MING_WORKSPACE`） | 人设、日记、`live/`、索引 | `C:\dsh\hers_workplace` |
| 宿主配置目录 | profile 的 `cordis.patch.yml`、插件 config | `C:\Users\<你>\.dsh\profiles\web` |

`MING_ROOT` 与数据工作区**不是一回事**：前者是代码目录，后者由 Hers Life 插件自己的设置页统一指定（不是 DSH 全域设置）。`MING_WORKSPACE` 只保留为高级环境变量覆盖。变更工作区时只复制缺少的文件、不覆盖目的地已有数据；变更后请重启 DSH，让所有配套插件一起切换。

## 4. 递进组合（别一次全装）

1. **最小可用**：`dsh-ming-discord` + `dsh-ming-core-memory` + `dsh-ming-memory`。Discord 连接、Owner、工作区与人设路径都在统一设置页完成。
2. **加 UI**：`dsh-ming-graph`（关系图）→ 需要先构建生成物：`node dsh-ming-graph/build.mjs`。
3. **加自己玩**：`dsh-ming-browse`（要 `workspacePath` 指向数据工作区）。
4. **加声音/桌宠**：`dsh-ming-voice`（要 ffplay）、`dsh-ming-mousepet`（要 Windows 桌面）。
5. **连接 Discord**：在 Hers Life 设置页贴入 Bot Token、填写 Owner Discord ID，并启用 Bot。

## 5. 素材

| 文件 | 用途 | 是否必需 |
|---|---|---|
| `dsh-ming-ui/src/theme.js` | 所有面板共用的主题 | 构建 UI 必需 |
| `dsh-ming-graph/icon.svg` | 侧栏图标 | 可选（缺了没图标） |
| 立绘 / 语音模型 | 桌宠、语音 | 可选（缺了对应用不了，其它照常） |

没有捆绑任何私人素材；缺了只有对应功能不可用。

## 6. 外部组件（缺了怎么降级）

| 组件 | 用途 | 缺了会怎样 |
|---|---|---|
| 嵌入服务（`EMB_ENDPOINT`，默认 `127.0.0.1:18091`） | 语义检索 | `rag` 两层（doc / web）报 `service: unavailable`，关键词层照常 |
| `ffplay` | 语音试听 | 只有试听不可用，合成不受影响；用 `MING_FFPLAY` 指定路径 |
| B 站凭证（`~/.dsh/bili-duty/bili_credential.json`） | B 站工具 | 只读接口仍可用，需要登录的返回明确错误 |
| Discord Bot Token | Discord 聊天入口 | 未配置时适配器保持 `needs-token`，本地记忆与其它 DSH 插件仍可单独使用 |

## 7. 启动后怎么算成功

- DSH 里能看到 `【溟 · 开场记忆】` 那段字 → memory 插件挂上了。
- 面板上有记忆关系图图标、点开有内容 → graph 挂上了。设置页显示 Discord `connected` → Bot Gateway 已连接。
- 右侧栏看到「自己玩」状态 → browse 挂上了。
- 启动日志里没有 `Traceback` / `cannot get property ... without inject`。

关闭可选组件：在 `cordis.patch.yml` 里给它那条加 `disabled: true`，别删依赖。

## 8. 没验的部分

- **干净用户 / 第二台机器从零装**：未验（F-T9）。
- **中文空格路径**：构建脚本已用参数数组，理论安全；`qa-portability.mjs` 在临时目录验过，
  但临时目录路径是英文的，**中文没实跑**。
- **npm 发布**：没有。将来要发，另跑 `npm pack --dry-run` 检查 client / license 是否齐。

## 相关检查

```bash
node scripts/check.mjs --suite offline
node test-support/qa-portability.mjs   # F-T1/T2/T4/T5
```
