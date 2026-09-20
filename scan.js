#!/usr/bin/env node
/* ============================================================================
 *  scan.js — 「boy」目录 HTML 导航站 · 清单生成器（零依赖，只需 Node）
 * ----------------------------------------------------------------------------
 *  递归扫描当前目录与 games/ 下的所有 .html，抽取标题 / 简介 / 分类，
 *  生成 files-data.js 供 index.html 读取。
 *
 *  用法：
 *    node scan.js              扫描一次，生成 files-data.js
 *    node scan.js --check      只校验不写文件（CI / 提 PR 前自查），有问题则退出码 1
 *    node scan.js --check --strict   警告也算失败（给严格模式 / 发布前用）
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

/* ============================== 页面校验 ================================= */
/* 与 PR 校验（.github/workflows/validate.yml）共用同一套规则：
 *   node scan.js --check  →  只读校验，不写 files-data.js，有问题退出码 1
 *   node scan.js --check --strict  →  警告也算失败
 *
 * 规则来源：README「如何贡献你的小游戏」+ games/_template.html + 站点实现。
 */

const MAX_BYTES = 2 * 1024 * 1024;

/** 不需要校验的页面（维护者自己的模板） */
const SKIP_VALIDATE = /^_/;

/**
 * 「单文件零依赖」的例外白名单（根目录 index.html 是导航页本身，不是游戏）：
 *  · files-data.js —— 站点清单，必须用 <script src> 加载（file:// 下不能 fetch，见 README）
 * 仅对根目录页面放行，games/ 下的页面仍然严格禁止任何外部引用。
 */
const SITE_ALLOWED_REFS = new Set(['files-data.js']);

/** 简易标签配平（跳过注释、script/style 内容、void 元素） */
function checkTagBalance(html) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(cleaned))) {
    if (m[4] === '/') continue;                       // 自闭合
    const name = m[2].toLowerCase();
    if (VOID.has(name)) continue;
    if (m[1] === '/') {
      if (!stack.length) return { ok: false, msg: `多余的 </${name}>` };
      const top = stack.pop();
      if (top !== name) return { ok: false, msg: `</${name}> 与未闭合的 <${top}> 不匹配` };
    } else {
      stack.push(name);
    }
  }
  if (stack.length) {
    return { ok: false, msg: `未闭合：${stack.slice(-4).map((t) => '<' + t + '>').join(', ')}` };
  }
  return { ok: true };
}

/** 校验单个页面，返回 { rel, errors: [], warns: [] } */
function validatePage(full) {
  const rel = path.relative(ROOT, full).split(path.sep).join('/');
  const errors = [];
  const warns = [];

  let html;
  try {
    html = fs.readFileSync(full, 'utf8');
  } catch (e) {
    errors.push('无法读取文件：' + e.message);
    return { rel, errors, warns };
  }

  const base = path.basename(full);
  const stem = base.replace(/\.html?$/i, '');
  const bytes = Buffer.byteLength(html, 'utf8');

  /* 1) 体积 */
  if (bytes > MAX_BYTES) {
    errors.push(`文件 ${(bytes / 1024 / 1024).toFixed(2)}MB，超过 2MB 上限`);
  }

  /* 2) 文件名 kebab-case */
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stem)) {
    errors.push(`文件名「${stem}」不符合小写 kebab-case（只允许小写字母/数字/连字符，例：my-game）`);
  }

  /* 3) 必备 meta */
  if (!/<meta[^>]+charset\s*=\s*["']?utf-?8/i.test(html)) {
    errors.push('缺少 <meta charset="UTF-8">');
  }
  const vp = html.match(/<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i);
  if (!vp) {
    errors.push('缺少 <meta name="viewport" ...>（手机上会缩放异常）');
  } else if (!/width\s*=\s*device-width/i.test(vp[0])) {
    warns.push('viewport 里没有 width=device-width，窄屏适配可能不佳');
  }

  /* 4) title */
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!tm || !tm[1].trim()) {
    errors.push('缺少或空的 <title>');
  } else {
    const title = squash(decodeEntities(stripTags(tm[1])));
    if (title.toLowerCase() === stem.toLowerCase()) {
      errors.push(`<title> 等于文件名（"${title}"），请写个有意义的名字`);
    } else if (title.length < 2) {
      errors.push(`<title> "${title}" 太短`);
    }
  }

  /* 5) 单文件零依赖：不得引用同目录相对的外部 js/css */
  const isRootPage = path.dirname(full) === ROOT;
  const refRe = /<(script|link)\b[^>]*?(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  const badRefs = [];
  while ((m = refRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const url = m[2].trim();
    if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url) || url.startsWith('#')) continue;
    // 根目录导航页允许加载站点清单（文件名可能带 ?t= 缓存串，取 basename 比较）
    if (isRootPage && SITE_ALLOWED_REFS.has(url.split('?')[0].split('/').pop())) continue;
    // <link rel="icon" ...> 若用了相对路径也算外部依赖（本仓库约定一律 data URI）
    if (tag === 'link' || /\.(js|mjs|css)(\?|#|$)/i.test(url)) badRefs.push(url);
  }
  if (badRefs.length) {
    errors.push('引用了同目录外部资源（违反单文件零依赖）：' + badRefs.join(', ') +
      '；请把样式/脚本内联，媒体用 CDN 绝对地址或 data: URI');
  }

  /* 6) 标签配平 */
  const bal = checkTagBalance(html);
  if (!bal.ok) errors.push('标签未配平：' + bal.msg + '（残缺会让整段脚本不执行 → 页面全白）');

  /* 7) 内联脚本语法（截断的头号症状） */
  const scripts = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [])
    .map((s) => s.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, ''))
    .filter((s) => s.trim());
  if (scripts.length) {
    for (const code of scripts) {
      try {
        new (require('vm').Script)(code);
      } catch (e) {
        errors.push('内联脚本语法错误：' + String(e.message).split('\n')[0]);
        break;
      }
    }
  }

  /* 8) 文件截断 */
  if (!/<\/body>/i.test(html) || !/<\/html>/i.test(html)) {
    errors.push('文件疑似被截断：缺少 </body> 或 </html>');
  }

  /* 以下 9~13 是「游戏页」的展示/体验建议，只对 games/ 下的页面生效
     （根目录 index.html 是导航页本身，不适用这些规则） */
  const isGamePage = !isRootPage;

  /* 9) 约定标签（可选，缺了卡片会比较朴素） */
  if (isGamePage) {
    const wbWant = [
      ['description', /<meta[^>]+name\s*=\s*["']description["'][^>]*>/i],
      ['wb-category', /<meta[^>]+name\s*=\s*["']wb-category["']/i],
      ['wb-icon', /<meta[^>]+name\s*=\s*["']wb-icon["']/i],
      ['wb-tags', /<meta[^>]+name\s*=\s*["']wb-tags["']/i],
      ['wb-order', /<meta[^>]+name\s*=\s*["']wb-order["']/i],
    ];
    const wbMissing = wbWant.filter(([, re]) => !re.test(html)).map(([k]) => k);
    if (wbMissing.length) {
      warns.push('缺少约定标签（不影响收录，但卡片会比较朴素）：' + wbMissing.join(', '));
    }
  }

  /* 10) favicon */
  if (!/<link[^>]+rel\s*=\s*["'](?:shortcut )?icon["']/i.test(html)) {
    warns.push('没有 <link rel="icon">，浏览器标签页没有 LOGO');
  }

  if (isGamePage) {
    /* 11) 手机可玩 */
    const hasTouch = /touchstart|touchmove|touchend|pointerdown|pointermove/i.test(html);
    const hasKeyboard = /keydown|keyup|keypress/i.test(html);
    if (!hasTouch && !hasKeyboard) {
      warns.push('既没绑定触屏也没绑定键盘事件（可能玩不了）');
    } else if (!hasTouch) {
      warns.push('只绑定了键盘，手机玩家用不了（建议补触屏）');
    }

    /* 12) 响应式宽度 */
    if (!/(?:min|max|clamp)\(\s*[\d.]+vw|width\s*:\s*\d+%|max-width\s*:/.test(html)) {
      warns.push('未见响应式宽度写法（建议 min(Nvw, ...) 之类）');
    }

    /* 13) 结束条件 */
    if (!/游戏结束|失败|胜利|通关|game\s*over|你赢了|重新开始|再来一次|结算|得分|score/i.test(html)) {
      warns.push('未识别到明确的胜负/结算逻辑（游戏应有结束条件）');
    }
  }

  /* 14) lang */
  const langM = html.match(/<html[^>]*\blang\s*=\s*["']([^"']+)["']/i);
  if (!langM) warns.push('<html> 未设置 lang 属性（建议 lang="zh-CN"）');
  else if (!/^zh/i.test(langM[1])) warns.push(`lang="${langM[1]}"，本仓库其他页面均为 zh-CN`);

  /* 15) 相对路径媒体 */
  const mediaRe = /<(?:img|audio|video|source)\b[^>]*?src\s*=\s*["']([^"']+)["']/gi;
  const badMedia = [];
  let mm;
  while ((mm = mediaRe.exec(html))) {
    const u = mm[1].trim();
    if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) continue;
    badMedia.push(u);
  }
  if (badMedia.length) {
    errors.push('引用了相对路径媒体文件（零依赖要求用 CDN 绝对地址或 data: URI）：' + badMedia.join(', '));
  }

  return { rel, errors, warns };
}

/** 跑校验并打印报告；返回 true 表示通过 */
function runCheck(strict) {
  const files = collectFiles()
    .filter((f) => !SKIP_VALIDATE.test(path.basename(f)))
    .sort();

  console.log('');
  console.log('🔍 校验 ' + files.length + ' 个页面' + (strict ? '（strict：警告也算失败）' : '') + '…');
  console.log('');

  let failed = 0;
  const allWarns = [];

  for (const f of files) {
    const r = validatePage(f);
    const bad = r.errors.length > 0 || (strict && r.warns.length > 0);
    if (bad) failed++;
    if (!r.errors.length && !r.warns.length) {
      console.log('  ✔ ' + r.rel);
    } else {
      console.log('  ' + (r.errors.length ? '✖' : '⚠') + ' ' + r.rel);
      for (const e of r.errors) console.log('      ERROR  ' + e);
      for (const w of r.warns) console.log('      WARN   ' + w);
      if (r.warns.length) allWarns.push(r.rel);
    }
  }

  console.log('');
  console.log('─'.repeat(60));
  if (failed) {
    console.log('✖ 校验失败：' + failed + ' / ' + files.length + ' 个页面有问题');
    console.log('');
    console.log('  怎么改：');
    console.log('   · ERROR 必须修 —— 大多是零依赖 / 必备 meta / 文件名 / 标签配平');
    console.log('   · WARN 建议修 —— 多为卡片展示与手机体验');
    console.log('   · 约定标签写法见 games/_template.html，或 README「如何贡献你的小游戏」');
    console.log('');
  } else {
    console.log('✔ 校验通过：' + files.length + ' 个页面全部合规');
    if (allWarns.length) {
      console.log('  （有 ' + allWarns.length + ' 个页面带 WARN，不影响合并；--strict 会把它们算作失败）');
    }
    console.log('');
  }
  return failed === 0;
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

/* 被 require 时（测试 / CI 复用校验函数）不要跑 CLI，也不要有任何副作用 */
const isMain = !module.parent;

if (isMain) {
  if (argv.includes('--help') || argv.includes('-h')) {
    // 取出文件开头的块注释（去掉 /* 与结尾的 ===== 分隔线），逐行剥掉行首的 " * "
    const src = fs.readFileSync(__filename, 'utf8');
    const block = (src.match(/^[\s\S]*?\/\*([\s\S]*?)\*\//) || [, ''])[1];
    const body = block
      .replace(/^\s*=+\s*$/gm, '')
      .replace(/^\s*\*/gm, '')
      .trim();
    console.log(body);
  } else if (argv.includes('--check')) {
    // 只校验、不写文件：供 CI 与「提 PR 前自查」使用
    const ok = runCheck(argv.includes('--strict'));
    process.exit(ok ? 0 : 1);
  } else if (argv.includes('--watch') || argv.includes('-w')) {
    runWatch();
  } else {
    runOnce();
  }
}

/* 供测试/CI 复用 */
module.exports = { validatePage, runCheck, checkTagBalance };
