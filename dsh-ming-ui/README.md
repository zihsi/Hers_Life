# dsh-ming-ui —— 不是插件

这里没有 `package.json`，也没有界面。**它一个插件都不是。**

它现在只干一件事：放着 ming 系列**唯一一份**主题样式 `src/theme.js`，以及这一层的来龙去脉。

名字叫 ui，是因为里头这份源是样式；它自己不注册任何东西。

## 为什么要有这个目录（以及为什么现在只剩一个文件）

各插件的 `build.mjs` 不是真打包，是「读文本 → 拼进 client.js」。所以没法 `import '@ming/ui'`。

2026-11-08 之前，这里的做法是**唯一源 + 两套同步脚本**：`sync.mjs` 把 theme 抄进 5 个插件的 `src/`，
`sync-panels.mjs` 把各插件的 panel 段落抄进 `dsh-ming-graph/src/panels.js`。
两套 `--check` 拦着，跑一次手工推一次——**而这两套拷贝本身就是要出事的地方**：

- 改了两小时的面板没生效，因为改的是源、跑的是拷贝；
- 图标尺寸 18px / 16px 两份对不上，因为同步范围**只覆盖到 Icon 函数之前**，Icon 从来没人同步过。

2026-11-08 的做法是**把拷贝删掉**，不是再加一道检查：

| 内容 | 现在唯一的源 | 谁读它 |
|---|---|---|
| 主题 | `dsh-ming-ui/src/theme.js` | `dsh-ming-graph/build.mjs`、`dsh-ming-memory/build.mjs` 以仓库内相对位置读取 |
| 兴趣面板 | `dsh-ming-interest/src/panel.js` | `dsh-ming-graph/build.mjs` 切它的 `const INTEREST_API` 到文件末 |
| 声音面板 | `dsh-ming-voice/src/panel.js` | 同上 |
| 自己玩面板 | `dsh-ming-browse/src/panel.js` | 同上 |
| 接续面板 | `dsh-ming-graph/src/panels.js` | 壳内独有，没有独立插件 |
| 神经元 / 星图 / 主面板 | `dsh-ming-graph/src/*.js` | 壳自己的 |

三块面板的插件**不再有 client 半端**（`dsh.client`、`client.js`、`build.mjs`、`src/theme.js` 全撤了）。
它们是纯 Host 插件：只提供路由和数据。界面只有 `dsh-ming-graph` 这一份 client 在注册。

## 现在怎么改、怎么验

```
cd <REPO>\dsh-ming-graph
node build.mjs            # 拼 client.js，跑三道门
node build.mjs --check    # 只问一句：client.js 是最新的吗（过期退出码 1）
```

改面板 = **改那个插件的 `src/panel.js`**，然后在 `dsh-ming-graph` 目录执行 `node build.mjs`。没有第二步同步。`<REPO>` 是你实际 clone 的仓库目录，不要照抄旧版 `C:/dsh` 路径。

三道门拦的都是「改完了、跑的不是这份」：

1. **切得到**：每个单元的起止标记在源文件里必须找得到，找不到就中止（不会再静默少一块）。
2. **拼得起来**：工厂里不许出现 `import` / `export` / `require(`；`const/let/class` 顶层重名就中止
   （两个面板各写一个同名常量，语法合法、行为是后者吃掉前者）。
3. **是最新的**：`--check` 拿源算一遍 sha256，跟 client.js 里那行 `build <hash>` 比。

DSH 那边要刷新页面才看得到（client 半端是构建物，不是热更）。

## 历史

- `sync.mjs` / `sync-panels.mjs`：2026-11-08 删。它们推的拷贝已经全删了，留着等于留一条会骗人的路。
- `_patch-*.mjs`：2026-11-07 给各插件补「面板只读接口」时用的一次性脚本，已挪进 `<DSH>\backup\ui-patches-20261108\`。

---

2026-11-08 03:4x 立（当时这个目录没有说明，容易被人当成「有个界面插件叫 ming-ui」）。
2026-11-08 17:4x 重写：从「唯一源 + 抄五份」改成「唯一源，谁都不抄」。
