#!/usr/bin/env node
/* ============================================================================
 *  scan.js — 「boy」目录 HTML 导航站 · 清单生成器（零依赖，只需 Node）
 * ----------------------------------------------------------------------------
 *  递归扫描当前目录与 games/ 下的所有 .html，抽取标题 / 简介 / 分类，
 *  生成 files-data.js 供 index.html 读取。
 *
 *  用法：
 *    node scan.js              扫描一次，生成 files-data.js
 *    node scan.js --watch      常驻监听，目录一有新文件立刻重新生成
 *    node scan.js --help       查看帮助
 *
 *  自动分类优先级（高 → 低）：
 *    1. 页面里的 <meta name="wb-category" content="游戏">
 *    2. 所在目录名（games→游戏、tools→工具、study→学习训练…）；
 *       目录名不在词典里时，直接拿目录名当分类名
 *    3. 文件名 + 标题 + 标签里的关键词
 *    4. 其他
 *
 *  页面可选约定标签（全部可省略，省略就自动推断）：
 *    <meta name="description" content="一句话简介">
 *    <meta name="wb-category" content="游戏">
 *    <meta name="wb-icon"     content="🧱">
 *    <meta name="wb-tags"     content="标签1,标签2">
 *    <meta name="wb-order"    content="10">    同分类内排序，越小越靠前
 *
 *  新增页面时，把上面这一段 meta 抄进 <head>，再跑一次扫描即可被收录。
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

/* --------------------------------- 配置 ---------------------------------- */

const ROOT = __dirname;
const OUT_FILE = path.join(ROOT, 'files-data.js');

/** 要扫描的目录（相对 ROOT），全部递归；重复的会自动去重 */
const SCAN_DIRS = ['.', 'games'];
/** 这些文件名不进清单（仅根目录） */
const EXCLUDE_FILES = new Set(['index.html']);
/** 这些目录连同子目录一起跳过 */
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'build', '__pycache__', 'vendor']);
/** 最大递归深度 */
const MAX_DEPTH = 6;

/** 已知分类的展示顺序，未列出的分类排在后面 */
const CATEGORY_ORDER = ['游戏', '学习训练', '工具', '展示', '其他'];

/** 目录名 → 分类 */
const DIR_MAP = {
  games: '游戏', game: '游戏', play: '游戏',
  tools: '工具', tool: '工具', utils: '工具',
  study: '学习训练', learn: '学习训练', practice: '学习训练', train: '学习训练',
  demos: '展示', demo: '展示', show: '展示', lab: '展示', pages: '展示',
  misc: '其他', other: '其他', tmp: '其他', temp: '其他',
};

/** 关键词 → 分类（自上而下，先命中先算） */
const KEYWORDS = [
  { cat: '游戏', re: /(game|tetris|block|puzzle|snake|maze|2048|mine|chess|card|arcade|runner|游戏|方块|俄罗斯|贪吃|迷宫|拼图|猜|棋|牌|射击|闯关|弹幕)/i },
  { cat: '学习训练', re: /(typing|keyboard|practice|drill|learn|train|study|quiz|flashcard|math|spell|指法|打字|练习|训练|学习|背诵|记忆|单词|拼写|口算|速算|识字|拼音)/i },
  { cat: '工具', re: /(tool|util|convert|format|calc|editor|generator|maker|counter|timer|clock|note|todo|工具|转换|生成|计算|编辑|计时|倒计时|计数器|笔记|待办|排版)/i },
  { cat: '展示', re: /(show|gallery|demo|preview|portfolio|landing|展示|演示|预览|作品|介绍)/i },
];

const ICON_BY_CATEGORY = { '游戏': '🎮', '学习训练': '📚', '工具': '🛠️', '展示': '✨', '其他': '📄' };

/* -------------------------------- 工具函数 -------------------------------- */

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ');
}

function squash(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** 把所有 <meta> 抽成 { name: content }，不依赖属性顺序 */
function parseMetaTags(html) {
  const out = {};
  const tagRe = /<meta\b[^>]*>/gi;
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let tag;
  while ((tag = tagRe.exec(html))) {
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(tag[0]))) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : a[4]);
    }
    const key = squash((attrs.name || attrs.property || '')).toLowerCase();
    if (key && attrs.content !== undefined) out[key] = decodeEntities(attrs.content);
  }
  return out;
}

function extractTitle(html, fallback) {
  const pick = (re) => {
    const m = html.match(re);
    if (!m) return '';
    return squash(decodeEntities(stripTags(m[1])));
  };
  return pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || fallback;
}

/* -------------------------------- 扫描实现 -------------------------------- */

function collectFiles() {
  const found = new Set();

  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth >= MAX_DEPTH) continue;
        if (/^[._]/.test(ent.name)) continue;
        if (EXCLUDE_DIRS.has(ent.name.toLowerCase())) continue;
        walk(full, depth + 1);
      } else if (ent.isFile()) {
        if (!/\.html?$/i.test(ent.name)) continue;
        if (/^_template(\.|$)/i.test(ent.name)) continue; // 贡献者模板不进清单
        if (path.dirname(full) === ROOT && EXCLUDE_FILES.has(ent.name.toLowerCase())) continue;
        found.add(path.resolve(full));
      }
    }
  };

  for (const d of SCAN_DIRS) {
    const abs = path.resolve(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    walk(abs, 0);
  }
  return Array.from(found);
}

function resolveCategory(metas, segs, haystack) {
  const explicit = squash(metas['wb-category']);
  if (explicit) return explicit;

  for (const seg of segs) {
    const mapped = DIR_MAP[seg.toLowerCase()];
    if (mapped) return mapped;
    if (!EXCLUDE_DIRS.has(seg.toLowerCase())) return seg; // 自定义目录名直接当分类
  }

  for (const k of KEYWORDS) if (k.re.test(haystack)) return k.cat;
  return '其他';
}

function buildItem(full) {
  const rel = path.relative(ROOT, full).split(path.sep).join('/');
  const base = path.basename(full);
  const dirRel = path.dirname(rel) === '.' ? '' : path.dirname(rel).split(path.sep).join('/');

  let html = '';
  try { html = fs.readFileSync(full, 'utf8'); } catch (e) { /* 读不了就只靠文件名 */ }
  const head = html.slice(0, 300000);
  const metas = parseMetaTags(head);

  const title = extractTitle(head, base.replace(/\.html?$/i, ''));
  const tags = squash(metas['wb-tags']).split(/[,，、|]/).map((s) => s.trim()).filter(Boolean);
  const desc = squash(metas['description'] || metas['og:description'] || '');
  const segs = dirRel ? dirRel.split('/') : [];
  const category = resolveCategory(metas, segs, [base, title, desc, tags.join(' ')].join(' '));

  const stat = fs.statSync(full);

  return {
    file: base,
    rel,
    url: segs.concat(base).map(encodeURIComponent).join('/'),
    title,
    desc,
    category,
    icon: squash(metas['wb-icon']) || ICON_BY_CATEGORY[category] || '📄',
    tags,
    group: segs.length ? segs[0] : '根目录',
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    order: Number(squash(metas['wb-order'])) || 0,
  };
}

function categoryRank(c) {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

function sortItems(items) {
  return items.sort((a, b) => {
    const d = categoryRank(a.category) - categoryRank(b.category);
    if (d) return d;
    if (a.category !== b.category) return a.category.localeCompare(b.category, 'zh');
    if (a.order !== b.order) return a.order - b.order;
    return new Date(b.mtime) - new Date(a.mtime);
  });
}

function signature() {
  return collectFiles()
    .sort()
    .map((p) => {
      try { const s = fs.statSync(p); return path.relative(ROOT, p) + ':' + s.mtimeMs + ':' + s.size; }
      catch (e) { return path.relative(ROOT, p) + ':?'; }
    })
    .join('|');
}

function scanOnce() {
  const items = sortItems(collectFiles().map(buildItem));

  const categories = [];
  for (const it of items) if (!categories.includes(it.category)) categories.push(it.category);

  const payload = {
    generatedAt: new Date().toISOString(),
    rootName: path.basename(ROOT),
    scanDirs: SCAN_DIRS,
    count: items.length,
    categories,
    items,
  };

  const text =
    '// ⚠ 本文件由 scan.js 自动生成，请勿手动编辑（改了也会被下次扫描覆盖）。\n' +
    '// 生成时间：' + payload.generatedAt + '\n' +
    '// 想让某个人页面自定义分类/图标/简介，请改那个 html 的 <head> 里的 wb-* 标签。\n' +
    'window.__GAMES_INDEX__ = ' + JSON.stringify(payload, null, 2) + ';\n';

  fs.writeFileSync(OUT_FILE, text, 'utf8');
  return payload;
}

/* -------------------------------- 输出日志 -------------------------------- */

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function report(payload) {
  console.log('');
  console.log('✔ 已生成 files-data.js');
  console.log('  扫描范围：' + SCAN_DIRS.map((d) => (d === '.' ? '当前目录' : d + '/')).join('  +  ') + '（递归）');
  console.log('  收录页面：' + payload.count + ' 个');
  if (!payload.count) {
    console.log('  （暂时没找到 .html 页面，放一个进来再跑一次就有了）');
  }
  let lastCat = null;
  payload.items.forEach((it) => {
    if (it.category !== lastCat) {
      lastCat = it.category;
      console.log('  【' + it.category + '】');
    }
    console.log('    ' + it.icon + '  ' + it.rel + '   —   ' + fmtSize(it.size) + '   ' + fmtTime(it.mtime));
  });
  console.log('');
  console.log('  双击 index.html 即可看到效果。');
  console.log('');
}

/* --------------------------------- 入口 ---------------------------------- */

function runOnce() {
  const payload = scanOnce();
  report(payload);
}

function runWatch() {
  let lastSig = signature();
  let timer = null;
  let busy = false;

  const kick = (why) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (busy) return;
      busy = true;
      try {
        const sig = signature();
        if (sig !== lastSig) {
          lastSig = sig;
          const payload = scanOnce();
          console.log('↻ ' + fmtTime(new Date().toISOString()) + '  检测到变化（' + why + '）→ 已更新，当前 ' + payload.count + ' 个页面');
        }
      } catch (e) {
        console.error('✖ 扫描出错：' + e.message);
      } finally {
        busy = false;
      }
    }, 350);
  };

  runOnce();

  try {
    fs.watch(ROOT, { recursive: true }, () => kick('目录事件'));
    console.log('👀 监听中… 增删改任何 .html 都会立刻重写清单。');
  } catch (e) {
    console.log('👀 监听中…（当前环境不支持递归监听，改用每 2 秒轮询）');
  }
  setInterval(() => kick('定时轮询'), 2000);
  console.log('   保持这个窗口开着就行，按 Ctrl+C 或直接关窗口即停止。');
  console.log('');
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('* =========')[0].replace(/^\/\*+/, '').replace(/^\s*\*/gm, '').trim());
} else if (argv.includes('--watch') || argv.includes('-w')) {
  runWatch();
} else {
  runOnce();
}
