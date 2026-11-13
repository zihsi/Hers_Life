> **这个仓已并入 [Hers_Life](https://github.com/zihsi/Hers_Life)，后续更新只在那边。**
> 这里保留历史版本，不再单独发版；装完整版请用 Hers_Life。

# dsh-ming-graph

一个 DSH 插件：**把记忆库画成一张能读的图**——每条真记忆一个点，每条边都答得出「它凭什么连」。

入口在「插件」页的 tab 栏，和插件市场并排，点开是「关系图」。

```
~/.dsh/memory/notes/*.md        ┐
QQ-Agent 的 observations.jsonl  ├──► 纯读盘建图（不过模型）──► 快照 JSON ──► 前端画图
people/_index.json（号码→昵称） ┘
```

## 为什么不是一张「好看的图」

把记忆做成星云、粒子、力导向球体的东西很多，问题是**它们不回答任何问题**：两个点为什么连着？因为距离近？因为颜色像？那些边是布局算出来的，不是事实。

这里的规矩只有一条：**边必须有理由，理由必须能读。**

所以边只有四种，每种都带一个 `why` 字符串，点开节点能逐条读：

| 边 | 凭什么连 | why 里写什么 |
|---|---|---|
| 引用 | A 的正文里出现了 B 的关键词 | 那个关键词 |
| 共词 | 两条记忆的关键词交集 ≥2 | 是哪几个词 |
| 归属 | 项目节点 ↔ 该项目下每一条记忆 | 项目名 |
| 补边 | 同项目、按时间排下来紧挨着的两条 | 时间差 |

不编数据、不画演示点。读不到就报错，不拿假货顶上。

## 配套

配 **[dsh-ming-memory](https://github.com/zihsi/Hers_Life/tree/sync/local-latest-20261113/dsh-ming-memory)** 一起用：那边读取 persona / diary 原始文件并注入系统提示词，同时维护部分 `live/` 衍生共享资料；这边把可用记忆数据整理成图。

一个管「下一轮用得上」，一个管「回头看都有什么」。装不装对方都能跑，装在一起，图上的点才和提示词里的字是同一批。

## 三个视图

- **人**：星图。中心是记录者，边宽 = 关于那个人的记忆条数，只画 count ≥ 3 的。
- **主题**：词共现。只算同一条记忆里一起出现 ≥2 次的词；父子词不连边。
- **时间线**：按天，两侧分开。

**不给人和人连边。** 按共享词连过一次，连出来全是「机器人 ↔ 直接」这种噪音。人和人之间的关系，只能靠一条条能核的计数，不能靠词。

## 数据源（只读）

- **DSH 侧**（默认开）：`<DSH_HOME>/memory/notes/*.md` 的 frontmatter。**扫目录，不读 index.json**——索引会有滞后，目录才是全的。老笔记没有 `created` 就从文件名 `20261020-123127-…` 里解析。
- **QQ 侧**（可选）：任何一行的 JSONL 观察库，路径配 `qqObservations`。**不读 evidence/原文档**——那文件几十 MB，图上用不着。
- **人名**（可选）：`peopleIndex` 指的 `{ byId: { "<号码>": [{ name }] } }`。昵称会改，认人只认号。

三个都不写死在仓库里：路径、号码、群名一律从 `~/.dsh/ming-graph.json` 读（见下面「配置」）。
## 路由与刷新

- `GET /_dsh/dsh-ming-graph/snapshot` —— 当前快照；`/refresh` 强制重算。
- 用 `connection.requestRejection` 做认证边界。**curl 不带 cookie 会拿到 401——那个 401 就是路由活着的证据。**
- Host 端每 `syncSeconds`（默认 120）stat 一次三个源，mtime 变了才重算（读 20ms + 算 100ms）。
- Client 端每 60 秒拉一次，`generatedAt` 没变就不重绘。

## top 栏：skill 开关 / 费用（2026-11-08）

她要在 top 栏直接开关 skill、直接看花掉多少钱。两个入口都是浮层，不占一格 tab——它们不是「看什么」，是「模型现在能看见什么」和「钱花在哪」。

| 路由 | 说明 |
| --- | --- |
| `GET /skills` · `/skills/refresh` | 清单：名字、描述、开关状态、来源（service / disk）、写的是哪个 `skills-off.json` |
| `POST /skills/toggle?name=<kebab-case>&on=1\|0` | 写状态文件并回读；`GET` 打这个会被挡（写动作只认 POST） |

- **清单以宿主 `ctx.skills.list()` 为准**：那是模型看到的同一份合并结果，插件包里自带的 skill 也在里面。自己扫 `~/.dsh/skills` 只能看见一半，所以扫描只当兜底（服务没接上时整份退回磁盘，面板上会明写「可能比模型真正看到的多」）。
- **开关只写 `<workspace>/skills-off.json`**（跟 `dsh-ming-skill-isolate` 同一个文件）。不跨插件调用：那个插件每次 `list()` 都重读这个文件，谁写都算数。
- **开关状态只认文件，不认服务返回的 `invocation`**：遮罩条目 rank 是 1，会赢过真 skill，描述被换成「（本工作区已隔离…）」；拿它当状态来源，关了哪几个反而看不出来。
- 费用**自己算**（`cost-lib.mjs`）：那个插件的账本有 token 没价（价目表里没有 `deepseek-v4.1-flash` 这种写法），`getUsageSummary` 出不来数。这里直接读它的 sqlite，按三层价目折算——内置 < 自动索引 < 人工，见下一节。
- 改完立刻算数，但当前这一轮的 skill 目录已经组装完，**下一次请求**才刷新。

### 索引费用（2026-11-10）

无定价的模型点一下按钮，去网上找价；找不到就借最相似的，并在面板上标明用的是谁的公式——`gpt-6o（公式：gpt-6-astra）`。

| 路由 | 说明 |
| --- | --- |
| `POST /cost/index` | 给账本里所有 `priced:false` 的模型跑一遍索引，写 `<workspace>/live/cost-prices.auto.json`，顺带把新账回给前端（不用再拉一次 `/cost`，那条要扫七万行） |

四层，按顺序试，每层都把「这条价从哪儿来」写下来：

1. **人工** `live/cost-prices.json` —— 永远压过其它层，按钮搜错了手改一句就盖住
2. **内置参考目录** `price-index.mjs` 的 `REFERENCE` —— 我核对过来源的价
3. **联网** —— Bing 搜「模型 + 价格」，先看摘要里有没有现成的数，再抓前三个像定价页的结果。抽出来的数要同时满足：写明「每百万 tokens」、带货币符号、不是订阅价、**这段文字里真的提了这个模型**（否则宁可没有）
4. **相似** —— 都没有就借最相似的（同族系 + 名字编辑距离），`from` 记成被借的那个

美元价按 `rates.usdCny`（默认 7.2）折成人民币进表，原始价留在 `price` 里。**抽不出来就不写**——宁可留「未定价」，也不塞一个看起来有数的假价。11-10 实测踩过：openrouter 的 DeepSeek 页面同时挂着 V4 Pro / V4.1 Flash 几档，随手取第一组就把别人的价当成了自己的，而摘要里那句「16」根本不是价。

```bash
node price-index.mjs                        # 手动跑一遍（会写 auto 文件）
node price-index.mjs --dry                  # 只看不写
node price-index.mjs --model=gpt-6o --dry   # 只查一个（调相似匹配时用）
node price-index.mjs --offline              # 不联网，只用内置目录 + 相似
node price-index.test.mjs                   # 抽价 / 相似度 / 落盘形状
```

```bash
node skills-lib.test.mjs        # 清单与开关逻辑：真磁盘 + 假服务 + 孤儿名字
node route-test.mjs             # 路由层：假 ctx 跑 apply()，抓 handler 真请求一遍（不用重启 DSH）
node panel-skillcost-test.mjs   # 两个浮层的渲染逻辑：真源码 + 假 h
```

## 人这一层：一个人一颗点

早期版本里，同一个人会在私聊房间、群成员、观察记录里各成一个点，看起来像好几个人。现在按**号码**合并：一个人一颗点，跨房间的记忆都挂在他身上；房间只作场所。

私聊房间不单独成点——一对一没有信息量。群保留场所节点。

`neuron-check.mjs` 会顺手报这件事：同号多点不为 0 就算坏。

## 平面展开：点开一个点，把它的全部相关摊平

球面那个视图只回答「谁和谁连着」；点开一个点，右边只能看到一串边，仍然读不出「这条记忆到底和哪些东西有关」。

所以加了第二层视图：**平面上以这个点为中心，把所有直接相关的条目按关系类型分扇区铺开。**

- **入口**：侧栏那个「在平面上展开这张网（N 条相关）」按钮，或者**双击**球面上的任一点。
- **左半边是图**：中心一颗点，外圈按 `project / subject / ref / cokey / adjacent` 分扇区（同类挨在一起，颜色就是类型色），线宽是权重，点大小按项目/人放大。铺不下就自动多排一环；再铺出画布就整体缩回来。
- **右半边是清单**：同一份数据按类型分组全部列出，每条带标题、权重和**为什么连**（`why` 原文），不截断。上面有过滤框，筛标题 / 正文 / 理由。
- **换中心**：点外圈任一点，或点右边任一条，就切到那个点；顶部面包屑留返回，`Esc` 或右上角关闭。
- **不编**：列表和图上都是 `buildNeuron()` 给的边，没有一条是这里补的。
- **动效**：面板淡入+轻微缩放；圈里的点从中心往外长（460ms，easeInOutQuad），标签后段才淡出；右侧条目逐条错开 16ms 淡入；关闭 180ms 淡出；换中心重播一次展开。系统设了「减少动效」就直接给最终状态。调试时把 `window.__MING_PLANE_ANIM_MS` 设长可以截中间帧。

调试入口：`make-standalone.mjs` 生成的那份 HTML 支持 `#plane=<id 或标题片段>`，打开就直接展开到那个点（写这块时截图自验用的）。

## 自己验

```bash
node neuron-check.mjs            # 报节点/边/孤立点/同号多点，并落一份 JSON 给前端调试
node neuron-check.mjs out.json   # 指定落盘路径
```

输出的是数据源的条数、图的规模、孤立点比例，以及人这一层的健康度。**它是自验，不是演示**：数字不对就是不对。

## 配置

跟某台机器绑在一起的值不进仓库，放 `<DSH_HOME>/ming-graph.json`（或用 `MING_GRAPH_CONFIG` 指一个文件）；`DSH_HOME` 未设定时默认 `%USERPROFILE%\.dsh`：

```json
{
  "qqObservations": "/path/to/QQ-Agent/data/memory/observations.jsonl",
  "peopleIndex": "/path/to/workspace/people/_index.json",
  "ownerId": "123456789",
  "ownerName": "我",
  "roomLabels": {
    "group:123456": "群 · 某个群",
    "private:123456789": "私聊 · 我"
  }
}
```

**没有这个文件也能跑**：只读 DSH 侧记忆，人名显示号码，房间按号码命名，星图中心不特指谁。
配置项全写在 `index.js` 的 `DEFAULTS` 里，文件里的同名键就地覆盖。

## 装

```yaml
# profile 的 cordis.patch.yml
- id: ming-graph
  config:
    syncSeconds: 120
```

**装完要看两处**：Host 起来了不等于界面在——client 半边要等一次 HMR 重载（touch `client.js` 等几秒）才会注册进 `plugins.tab`；`Slots.listSubTree` 的 occupants 里能看到 `ming-graph` 才算成。

## 目录

```
index.js          Host 端：路由、快照、定时重算
client.js         前端入口
src/neuron-view.js  画图
neuron-check.mjs  自验
people-merge.mjs  按号码合并人
build.mjs         打包
```

**读盘和建图不在这儿**（2026-11-08 搬的）：`readDsh/readQQ/readPeople/readDiaries/build`
在 `../dsh-ming-memory/lib/model.mjs`，`buildNeuron/buildUnified` 在 `../dsh-ming-memory/lib/neuron.mjs`。
理由：神经元、星图、「她的一生」三个视图吃的是同一批数据，那批数据的实现不该住在「展示」这个插件里。
代价是**`dsh-ming-graph` 与 `dsh-ming-memory` 必须保留在同一个仓库的并列目录**（本仓默认布局即如此），
借的是相对路径而不是包名——profile 的 node_modules 是按真实路径加载的，包名在这里解析不到。
不要只复制 `dsh-ming-graph` 单一目录到另一个位置；若改变目录结构，必须同步调整共享 model / neuron 模块的相对路径。

## 开发约定：推送前检查

目前这个仓库没有提交 `.githooks/pre-push`，因此不要照旧版说明执行 `git config core.hooksPath .githooks`，也不要假设推送时会自动拦截私人资料或大文件。

每次推送前至少手动检查：

```powershell
git status --short
git diff --check
git diff --stat
git diff --cached --stat
git diff --cached --name-only
```

确认暂存区只有本次准备提交的文件；不要使用不加路径限制的 `git add .`。Token、个人 ID、私人工作区数据、日志、测试输出、`node_modules` 与本机备份都不应提交。

## 外部页签：别的插件可以往「她的一生」里挂一页（2026-11-09）

宿主给的 slot 里没有「往别人的面板里塞一个页签」这种位置，只有 `settings.section`（一整个设置页）和
`settings.general.item`（一行偏好）。所以这里自己开了一个口，**两边都不硬依赖对方**：

```js
// 挂：面板挂载时会建它；没装这个插件时它就是 undefined
window.__MING_TAB_HOST.add({
  id: 'cursor',               // 唯一；重复 add 同一个 id 就地更新
  label: '光标',               // 顶栏上的字
  order: 50,                  // 可选，接在内置 tab 后面按这个排
  render: () => 你的组件,       // 不带参数的组件
})
window.__MING_TAB_HOST.remove('cursor')
window.__MING_TAB_HOST.list() // 当前挂着哪些

// 早到的：面板还没挂上就先写队列，面板挂上时一起收走（收完队列清空）
;(window.__MING_TABS_PENDING || (window.__MING_TABS_PENDING = [])).push(desc)
```

调用方该怎么写：**先看 `window.__MING_TAB_HOST` 在不在**——在就挂进来、并且不再注册自己的设置页；
不在就退回 `settings.section`。谁先启动都行，缺一个都能自己活。

烟测：`node test-ext-tabs.mjs`（假 window + 假 React，加载真的 client.js，验「建宿主 / 挂 / 点 / 收 / 拆 / 早到」六步）。

## License

MIT
