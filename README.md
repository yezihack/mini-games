# mini-games

一个**社区共建的纯前端小游戏合集**：所有游戏都是单文件 HTML，零依赖、打开即玩。

👉 **在线试玩**：<https://yezihack.github.io/mini-games/>

<!-- 部署完成后上面这个链接就能用了。想加徽章就把下面两行的注释去掉 -->

<!--
[![Validate](https://github.com/yezihack/mini-games/actions/workflows/validate.yml/badge.svg)](https://github.com/yezihack/mini-games/actions/workflows/validate.yml)
[![Deploy](https://github.com/yezihack/mini-games/actions/workflows/deploy.yml/badge.svg)](https://github.com/yezihack/mini-games/actions/workflows/deploy.yml)
-->

---

## 这里有什么

打开上面的链接就是导航页 —— 所有游戏自动按分类排成方块卡片，
支持搜索、分类筛选、随机挑一个玩、深色/浅色主题。

已有的例子：

| 游戏 | 说明 |
|---|---|
| 🧱 [方块·随机模式](games/block-game.html) | 经典俄罗斯方块，7-bag 随机、幽灵落点、Hold 暂存、踢墙旋转，六套霓虹配色随机换肤 |
| ⌨️ [打字指法练习](games/typing-game.html) | 练手指记忆的打字游戏，食指起步逐键解锁，连击加成计分 |

---

## 如何贡献你的小游戏

**只要三步，不用碰导航页。**

### 1. Fork 并准备你的页面

把 [`games/_template.html`](games/_template.html) 复制一份、改成你想要的文件名
（比如 `games/my-game.html`），然后照着写。

硬性要求只有三条：

- **单文件、零依赖** —— 样式和脚本都内联在这一个 html 里。
  不要引用同目录的外部 `.js` / `.css`（提交时会自动校验并报错）；
  图片和音频请用 CDN 绝对地址或内联 `data:` URI。
- **`<head>` 里要有** `<meta charset="UTF-8">` 和 `<meta name="viewport" ...>`。
- **单个文件不超过 2MB**，并且 `<title>` 写个有意义的名字。

> 想按主题分门别类？在 `games/` 下再建子目录即可，比如 `games/休闲/`、`games/puzzle/`，
> **目录名会自动变成导航页上的分类名**，不需要改任何配置。

### 2. 在 `<head>` 里填约定标签（可选，但推荐）

导航页靠这些标签决定卡片长什么样。不写也能被收录，只是分类和卡片会比较朴素。

```html
<meta name="description" content="一句话介绍，30 字内最佳">
<meta name="wb-category" content="游戏">          <!-- 分类，随意取名；不写就按目录名/关键词自动判断 -->
<meta name="wb-icon"     content="🎮">            <!-- 卡片上的 emoji -->
<meta name="wb-tags"     content="休闲,键盘,触屏">  <!-- 搜索关键词 -->
<meta name="wb-author"   content="你的GitHub用户名"> <!-- 卡片上署名 -->
<meta name="wb-order"    content="100">           <!-- 同分类内排序，越小越靠前 -->
```

### 3. 提 Pull Request

推到 `main` 的那个 PR 会自动触发校验：

- ✅ **通过** —— 等维护者合并。
- ❌ **没通过** —— 机器人会在 PR 里逐条告诉你哪里不对，改完 push 到同一个分支即可，不用重开 PR。

**维护者合并后，你的游戏就自动上线了** —— 不需要手动更新清单，也不需要改导航页。
部署通常在 1 分钟内完成。

### 一些加分项

- 键盘和触屏都能玩（很多人在手机上点开）
- 适配窄屏，别写死像素宽度
- 有点小音效/小动效会更好玩（可以用 Web Audio API 实时合成，不用带音频文件）
- 在 PR 描述里贴一张截图，会更容易被点开

---

## 目录结构

```
.
├─ .github/workflows/
│  ├─ validate.yml        # PR 校验 + 自动留言
│  └─ deploy.yml          # 合并后：扫描清单 → 提交回仓库 → 部署 Pages
├─ index.html             # 👈 导航页（站点首页，自动生成卡片，不用手改）
├─ scan.js                # 清单生成器（零依赖）
├─ files-data.js          # 自动生成的清单，请勿手改
├─ games/                 # 👈 游戏都放这里
│  ├─ _template.html      # 新游戏模板
│  ├─ block-game.html     # 示例游戏
│  └─ typing-game.html    # 示例游戏
├─ .nojekyll              # 让 Pages 跳过 Jekyll 处理
└─ LICENSE                # MIT
```

站点是**从仓库根目录发布**的，所以 `index.html` 就是首页：

| 页面 | 地址 |
|---|---|
| 导航页（首页） | `https://yezihack.github.io/mini-games/` |
| 某个游戏 | `https://yezihack.github.io/mini-games/games/block-game.html` |

---

## 它是怎么自动收录新游戏的

GitHub Pages 上跑不了 Node，所以扫描放在 **GitHub Actions** 里：

```
有人提 PR
   └─ validate.yml：跑 scan.js --check，把结果留言到 PR ──→ 维护者合并
                                                             │
合并进 main ─────────────────────────────────────────────────┘
   └─ deploy.yml：node scan.js  →  提交 files-data.js  →  部署 Pages
```

导航页读的是 `files-data.js`，而它在每次合并后都会被重新生成，所以**目录一变，页面就跟着变**。
页面本身还会每 15 秒重读一次清单，已打开的标签页也能自动出现新游戏（新增的会打 `NEW` 角标）。

### 本地预览 / 本地开发

```bash
# 生成清单（改了页面后要重跑，否则清单里的时间是旧的）
node scan.js

# 或开启监听：目录一变自动重跑清单，Ctrl+C 停止
node scan.js --watch

# 只校验不写文件（和 Actions 用的是同一套规则）
node scan.js --check
```

然后直接双击 `index.html` 就能看效果。

> ⚠️ 浏览器出于安全限制，`file://` 下无法列目录、也不能 `fetch` 本地文件，
> 所以清单必须是 `files-data.js`（用 `<script src>` 加载）而不是 `files.json`。
> 这也是本地和线上能共用同一套代码的原因。

---

## 维护者备忘

**第一次部署前要做两件事：**

1. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
   （不要选 "Deploy from a branch"）。
2. 仓库 **Settings → Actions → General → Workflow permissions** 选 **Read and write permissions**
   （`deploy.yml` 需要写权限才能把清单提交回仓库）。

**换域名 / 换子路径？** 不用改代码 —— 页面里所有资源都是相对路径，放到任何路径下都能跑。

**想加一个新分类？** 直接在 `games/` 下建目录（比如 `games/工具/`），把页面丢进去即可 ——
目录名会自动变成分类名，无需改任何配置。

---

## License

[MIT](LICENSE)
