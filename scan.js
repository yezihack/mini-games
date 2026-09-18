#!/usr/bin/env node
/* ============================================================================
 *  scan.js — mini-games 站点的清单生成器（零 npm 依赖，只需 Node 18+）
 * ----------------------------------------------------------------------------
 *  从仓库根目录递归扫描所有 .html，抽取标题 / 简介 / 分类，生成根目录下的
 *  files-data.js。在本地和 GitHub Actions 里跑的是同一份脚本 —— 结果完全一致。
 *
 *  目录约定：
 *    index.html          → 导航页（站点首页），不收录
 *    games/              → 游戏放这里；再往下建目录会自动变成分类名
 *    scan.js             → 本脚本
 *    files-data.js       → 生成物
 *
 *  用法：
 *    node scan.js              扫描一次，生成清单
 *    node scan.js --watch      常驻监听，目录一变立刻重新生成（本地开发用）
 *    node scan.js --check      只校验不改文件，有不合规的页面就退出码 1（Actions 里用）
 *    node scan.js --help
 *
 *  自动分类优先级（高 → 低）：
 *    1. 页面的 <meta name="wb-category" content="游戏">
 *    2. 所在目录名（games→游戏、tools→工具、学习→学习训练…）；
 *       目录名不在词典里时，直接拿目录名当分类名（你自己建的中文目录会自动成类）
 *    3. 文件名 + 标题 + 标签里的关键词
 *    4. 其他
 *
 *  页面可选约定标签（全部可省略，省略就自动推断）：
 *    <meta name="description" content="一句话简介">
 *    <meta name="wb-category" content="游戏">
 *    <meta name="wb-icon"     content="🧱">
 *    <meta name="wb-tags"     content="标签1,标签2">
 *    <meta name="wb-author"   content="你的 GitHub 用户名">   ← 会在卡片上署名
 *    <meta name="wb-order"    content="10">                    ← 同分类内排序，越小越前
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

/* --------------------------------- 配置 ---------------------------------- */

const ROOT = __dirname;                                   // 仓库根 = 站点根
const OUT_FILE = path.join(ROOT, 'files-data.js');
const SITE_NAME = 'Mini Games';

/** 入口文件：不进清单 */
const ENTRY_FILES = new Set(['index.html']);
/** 生成物与脚本：不进清单 */
const GENERATED_FILES = new Set(['files-data.js', 'scan.js']);
/** 页面模板：不进清单（任意目录下以 _ 开头的文件也会被自动跳过） */
const TEMPLATE_FILES = new Set(['_template.html', 'template.html']);

/**
 * 收录范围（关键开关）：
 *   只递归扫描根目录下的这些子目录 + 根目录顶层的 .html。
 *
 * 为什么要白名单而不是「全仓库递归」：扫描根就是仓库根，一旦全递归，
 * 像 docs/readme.html、第三方示例页这类说明性 html 都会被当成游戏收录。
 * 想改结构（比如不要 games/ 这层，全摊在根目录）只需把这里设成 []。
 */
const SCAN_DIRS = ['games'];

/**
 * 根目录下这些文件不进清单。
 * 因为扫描根就是仓库根，README / 配置 / CI 之类必须显式排除。
 */
const ROOT_EXCLUDES = new Set([
  'readme.md', 'license', 'license.md', 'license.txt', 'changelog.md',
  'contributing.md', 'code_of_conduct.md', 'package.json', 'package-lock.json',
  'robots.txt', 'cname',
]);
/** 这些目录连同子目录一起跳过 */
const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.github', '.vscode', '.idea',
  '__pycache__', 'vendor', 'assets', 'img', 'images', 'fonts', 'audio',
]);
/** 最大递归深度 */
const MAX_DEPTH = 6;

/** 已知分类的展示顺序，未列出的分类排在后面 */
const CATEGORY_ORDER = ['游戏', '学习训练', '工具', '展示', '其他'];

/** 目录名 → 分类 */
const DIR_MAP = {
  games: '游戏', game: '游戏', play: '游戏', arcade: '游戏',
  '小游戏': '游戏', '游戏区': '游戏', '游戏合集': '游戏',
  tools: '工具', tool: '工具', utils: '工具', '工具': '工具', '小工具': '工具',
  study: '学习训练', learn: '学习训练', practice: '学习训练', train: '学习训练',
  '学习': '学习训练', '学习训练': '学习训练', '练习': '学习训练',
  demos: '展示', demo: '展示', show: '展示', lab: '展示', pages: '展示',
  '展示': '展示', '演示': '展示',
  misc: '其他', other: '其他', tmp: '其他', temp: '其他',
};

/** 关键词 → 分类（自上而下，先命中先算） */
const KEYWORDS = [
  { cat: '游戏', re: /(game|tetris|block|puzzle|snake|maze|2048|mine|chess|card|arcade|runner|shoot|jump|flappy|pong|invader|游戏|方块|俄罗斯|贪吃|迷宫|拼图|猜|棋|牌|射击|闯关|弹幕|跳|赛车)/i },
  { cat: '学习训练', re: /(typing|keyboard|practice|drill|learn|train|study|quiz|flashcard|math|spell|hanzi|指法|打字|练习|训练|学习|背诵|记忆|单词|拼写|口算|速算|识字|拼音|成语)/i },
  { cat: '工具', re: /(tool|util|convert|format|calc|editor|generator|maker|counter|timer|clock|note|todo|picker|encoder|工具|转换|生成|计算|编辑|计时|倒计时|计数器|笔记|待办|排版|取色)/i },
  { cat: '展示', re: /(show|gallery|demo|preview|portfolio|landing|展示|演示|预览|作品|介绍)/i },
];

const ICON_BY_CATEGORY = { '游戏': '🎮', '学习训练': '📚', '工具': '🛠️', '展示': '✨', '其他': '📄' };

/* -------------------------------- 工具函数 -------------------------------- */

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function stripTags(s) { return String(s).replace(/<[^>]*>/g, ' '); }
function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

/** 把所有 <meta> 抽成 { name: content }，不依赖属性顺序 */
function parseMetaTags(html) {
  const out = {};
  const tagRe = /<meta\b[^>]*>/gi;
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let tag;
  while ((tag = tagRe.exec(html))) {
    const attrs = {};
    let a; attrRe.lastIndex = 0;
    while ((a = attrRe.exec(tag[0]))) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : a[4]);
    }
    const key = squash(attrs.name || attrs.property || '').toLowerCase();
    if (key && attrs.content !== undefined) out[key] = decodeEntities(attrs.content);
  }
  return out;
}

function extractTitle(html, fallback) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? squash(decodeEntities(stripTags(m[1]))) : '';
  };
  return pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || fallback;
}

/** 文件名是否是一个「可收录的页面」 */
function isPageFile(name, isRoot) {
  if (!/\.html?$/i.test(name)) return false;
  const low = name.toLowerCase();
  if (ENTRY_FILES.has(low) || GENERATED_FILES.has(low)) return false;
  if (TEMPLATE_FILES.has(low)) return false;
  if (/^_/.test(name)) return false;               // 下划线开头的都是内部文件
  if (isRoot && ROOT_EXCLUDES.has(low)) return false;
  return true;
}

function walkFiles(dir, depth, out, opts) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  const isRoot = path.resolve(dir) === ROOT;
  const takeHtml = !isRoot || opts.takeRootHtml;   // 非根目录一律收；根目录看开关

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (depth >= MAX_DEPTH) continue;
      if (/^[._]/.test(ent.name)) continue;
      if (EXCLUDE_DIRS.has(ent.name.toLowerCase())) continue;
      if (isRoot && opts.only.length && opts.only.indexOf(ent.name) === -1) continue;  // 白名单
      walkFiles(full, depth + 1, out, opts);
    } else if (ent.isFile() && takeHtml && isPageFile(ent.name, isRoot)) {
      out.push(path.resolve(full));
    }
  }
}

function collectFiles() {
  const out = [];
  const opts = { only: SCAN_DIRS, takeRootHtml: true };
  walkFiles(ROOT, 0, out, opts);
  return Array.from(new Set(out)).sort();
}

function resolveCategory(metas, segs, haystack) {
  const explicit = squash(metas['wb-category']);
  if (explicit) return explicit;

  for (const seg of segs) {
    const mapped = DIR_MAP[seg.toLowerCase()];
    if (mapped) return mapped;
    if (!EXCLUDE_DIRS.has(seg.toLowerCase())) return seg;   // 自定义目录名直接当分类
  }

  for (const k of KEYWORDS) if (k.re.test(haystack)) return k.cat;
  return '其他';
}

function buildItem(full) {
  const rel = path.relative(ROOT, full).split(path.sep).join('/');
  const base = path.basename(full);
  const dirRel = path.dirname(rel) === '.' ? '' : path.dirname(rel).split(path.sep).join('/');

  let html = '';
  try { html = fs.readFileSync(full, 'utf8'); } catch (e) { /* 读不了就退回文件名 */ }
  const head = html.slice(0, 400000);
  const metas = parseMetaTags(head);

  const title = extractTitle(head, base.replace(/\.html?$/i, ''));
  const tags = squash(metas['wb-tags']).split(/[,，、|]/).map((s) => s.trim()).filter(Boolean);
  const desc = squash(metas['description'] || metas['og:description'] || '');
  const segs = dirRel ? dirRel.split('/') : [];
  const category = resolveCategory(metas, segs, [base, title, desc, tags.join(' ')].join(' '));
  const stat = fs.statSync(full);

  return {
    file: base,
    rel,                                   // 相对仓库根的路径
    url: rel.split('/').map(encodeURIComponent).join('/'),   // 站点基路径下的相对 URL
    title,
    desc,
    category,
    icon: squash(metas['wb-icon']) || ICON_BY_CATEGORY[category] || '📄',
    tags,
    author: squash(metas['wb-author']) || '',
    group: segs.length ? segs[0] : '',
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

/* --------------------------------- 校验 ---------------------------------- */

const MAX_PAGE_SIZE = 2 * 1024 * 1024;   // 单页 2MB 上限

/** 返回问题列表；空数组代表合规 */
function validateItem(it, full) {
  const problems = [];
  const base = it.file;

  if (!it.title) problems.push('缺少标题：`<title>` 和 `<h1>` 都没找到');
  else if (it.title === base.replace(/\.html?$/i, '')) {
    problems.push('标题等于文件名：建议加一个有意义的 `<title>`');
  }

  if (it.size > MAX_PAGE_SIZE) {
    problems.push('文件超过 2MB（' + (it.size / 1024 / 1024).toFixed(1) + 'MB）：请精简，别把大图/视频塞进 html');
  }

  let html = '';
  try { html = fs.readFileSync(full, 'utf8'); } catch (e) { /* ignore */ }
  if (html) {
    if (!/<meta\b[^>]*charset/i.test(html.slice(0, 4000))) {
      problems.push('`<head>` 里缺少 `<meta charset="UTF-8">`：中文可能乱码');
    }
    if (!/<meta\b[^>]*name=["']viewport["']/i.test(html.slice(0, 6000))) {
      problems.push('缺少 viewport meta：手机上会缩成一团');
    }
    // 引用了同目录的本地文件却不存在
    const refRe = /(?:src|href)\s*=\s*["'](?!https?:|\/\/|data:|blob:|#|mailto:)([^"']+\.(?:js|css|png|jpe?g|gif|webp|svg|mp3|wav|ogg|json))["']/gi;
    let m; const seen = new Set();
    while ((m = refRe.exec(html))) {
      const ref = m[1];
      if (seen.has(ref)) continue;
      seen.add(ref);
      const target = path.resolve(path.dirname(full), ref.split('?')[0].split('#')[0]);
      if (!fs.existsSync(target)) problems.push('引用的文件不存在：`' + ref + '`（请把资源一起提交，或改成 CDN 绝对地址）');
    }
  }
  return problems;
}

/* -------------------------------- 生成/输出 ------------------------------- */

function scanOnce() {
  const all = collectFiles();
  const items = sortItems(all.map(buildItem));

  const categories = [];
  for (const it of items) if (!categories.includes(it.category)) categories.push(it.category);

  const payload = {
    generatedAt: new Date().toISOString(),
    siteName: SITE_NAME,
    repo: process.env.GITHUB_REPOSITORY || '',
    count: items.length,
    categories,
    items,
  };

  const text =
    '// ⚠ 本文件由 scan.js 自动生成，请勿手动编辑（改了会被下次扫描覆盖）。\n' +
    '// 生成时间：' + payload.generatedAt + '\n' +
    '// 想让自己的页面自定义分类/图标/简介，请改那个 html 的 <head> 里的 wb-* 标签。\n' +
    'window.__GAMES_INDEX__ = ' + JSON.stringify(payload, null, 2) + ';\n';

  fs.writeFileSync(OUT_FILE, text, 'utf8');
  return payload;
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
function fmtTime(iso) {
  const d = new Date(iso); const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function report(payload) {
  console.log('');
  console.log('✔ 已生成 ' + path.relative(path.dirname(ROOT), OUT_FILE).split(path.sep).join('/'));
  console.log('  收录页面：' + payload.count + ' 个');
  if (!payload.count) console.log('  （暂时没找到页面，往 games/ 里放一个 .html 再跑一次就有了）');
  let lastCat = null;
  payload.items.forEach((it) => {
    if (it.category !== lastCat) { lastCat = it.category; console.log('  【' + it.category + '】'); }
    console.log('    ' + it.icon + '  ' + it.rel.padEnd(28) + ' — ' + fmtSize(it.size).padStart(9) + '  ' + fmtTime(it.mtime) + (it.author ? '  @' + it.author : ''));
  });
  console.log('');
}

/* --------------------------------- 入口 ---------------------------------- */

function runCheck() {
  const files = collectFiles();
  const problems = [];
  files.forEach((full) => {
    const it = buildItem(full);
    validateItem(it, full).forEach((msg) => problems.push({ rel: it.rel, msg }));
  });

  if (!/problems/.test('') && problems.length === 0) {
    console.log('✔ 校验通过：' + files.length + ' 个页面全部合规。');
    return 0;
  }
  if (problems.length === 0) {
    console.log('✔ 校验通过：' + files.length + ' 个页面全部合规。');
    return 0;
  }
  console.log('✖ 发现 ' + problems.length + ' 个问题：\n');
  const byFile = {};
  problems.forEach((p) => { (byFile[p.rel] = byFile[p.rel] || []).push(p.msg); });
  Object.keys(byFile).forEach((rel) => {
    console.log('  ' + rel);
    byFile[rel].forEach((m) => console.log('    - ' + m));
  });
  console.log('');
  return 1;
}

function signature() {
  return collectFiles().map((p) => {
    try { const s = fs.statSync(p); return path.relative(ROOT, p) + ':' + s.mtimeMs + ':' + s.size; }
    catch (e) { return path.relative(ROOT, p) + ':?'; }
  }).join('|');
}

function runWatch() {
  let lastSig = signature();
  let timer = null;

  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const sig = signature();
        if (sig !== lastSig) {
          lastSig = sig;
          const payload = scanOnce();
          console.log('↻ ' + fmtTime(new Date().toISOString()) + '  目录有变化 → 已更新，当前 ' + payload.count + ' 个页面');
        }
      } catch (e) { console.error('✖ 扫描出错：' + e.message); }
    }, 350);
  };

  runOnce();
  try {
    fs.watch(ROOT, { recursive: true }, kick);
    console.log('👀 监听中… 增删改任何 .html 都会立刻重写清单。');
  } catch (e) {
    console.log('👀 监听中…（当前环境不支持递归监听，改用每 2 秒轮询）');
  }
  setInterval(kick, 2000);
  console.log('   保持这个窗口开着就行，按 Ctrl+C 停止。\n');
}

function runOnce() {
  const payload = scanOnce();
  report(payload);
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('* =========')[0].replace(/^\/\*+/, '').replace(/^\s*\*/gm, '').trim());
} else if (argv.includes('--check')) {
  process.exit(runCheck());
} else if (argv.includes('--watch') || argv.includes('-w')) {
  runWatch();
} else {
  runOnce();
}
