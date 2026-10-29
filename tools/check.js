#!/usr/bin/env node
/* 静态自检：JS 语法、JSON 可解析、词库基本结构、页面/CSS 引用的本地资源存在
 *
 * 用法：node tools/check.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', 'runtime', 'vendor', 'dist', 'data', 'shots']);

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  entries.forEach((ent) => {
    if (SKIP.has(ent.name)) return;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile()) out.push(full);
  });
}

const files = [];
walk(ROOT, files);

console.log('=== JS 语法 ===');
const jsFiles = files.filter((f) => f.endsWith('.js'));
let syntaxBad = 0;
jsFiles.forEach((f) => {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    syntaxBad++;
    console.log('  FAIL ' + path.relative(ROOT, f));
    console.log(String(e.stderr || e.message).trim().split('\n').slice(0, 4).join('\n'));
  }
});
ok(jsFiles.length + ' 个 JS 文件语法通过', syntaxBad === 0, syntaxBad + ' 个失败');

console.log('\n=== JSON ===');
['package.json', 'version.json', 'shared/words.json', 'shared/undercover-words.json', 'tools/runtime-manifest.json', 'admins.example.json'].forEach((rel) => {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    ok(rel + ' 可解析', true);
  } catch (e) {
    ok(rel + ' 可解析', false, e.message);
  }
});

console.log('\n=== 词库结构 ===');
try {
  const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'words.json'), 'utf8'));
  ['easy', 'normal', 'hard'].forEach((lv) => {
    const list = words.levels && words.levels[lv] && words.levels[lv].words;
    ok(lv + ' 500 个词', Array.isArray(list) && list.length === 500, 'count=' + (list ? list.length : 0));
    ok(lv + ' 每条 4 条提示', Array.isArray(list) && list.every((x) => x && Array.isArray(x.h) && x.h.length === 4));
  });
} catch (e) {
  ok('词库可读取', false, e.message);
}

console.log('\n=== 卧底词对 ===');
try {
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared', 'undercover-words.json'), 'utf8'));
  const pairs = bank.pairs || [];
  const words = [];
  pairs.forEach((p) => { words.push(p.a, p.b); });
  ok('卧底词对不少于 100 对', pairs.length >= 100, 'count=' + pairs.length);
  ok('每对词非空且不相同', pairs.every((p) => p && p.a && p.b && p.a !== p.b));
  ok('词面全局唯一', new Set(words).size === words.length,
    'unique=' + new Set(words).size + '/' + words.length);
} catch (e) {
  ok('卧底词库可读取', false, e.message);
}

console.log('\n=== 本地资源引用 ===');
function checkRefs(htmlFile) {
  const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  const refs = [];
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  const missing = refs.filter((u) => {
    if (!u || u.charAt(0) === '#' || /^(https?:|data:|mailto:|javascript:)/i.test(u)) return false;
    const rel = u.replace(/^\/+/, '');
    return !fs.existsSync(path.join(ROOT, rel));
  });
  ok(htmlFile + ' 引用的本地资源都存在', missing.length === 0, missing.join(', '));
}
['index.html', 'admin.html'].forEach(checkRefs);

const cssFiles = files.filter((f) => f.endsWith('.css'));
let cssMissing = [];
cssFiles.forEach((f) => {
  const text = fs.readFileSync(f, 'utf8');
  const re = /@import\s+url\(["']?([^"')]+)["']?\)/g;
  let m;
  while ((m = re.exec(text))) {
    const target = path.resolve(path.dirname(f), m[1]);
    if (!fs.existsSync(target)) cssMissing.push(path.relative(ROOT, f) + ' -> ' + m[1]);
  }
});
ok('CSS @import 都能找到', cssMissing.length === 0, cssMissing.join(', '));

console.log('\n=== 发布工具约束 ===');
try {
  const pub = fs.readFileSync(path.join(ROOT, 'tools', 'publish-release.ps1'), 'utf8');
  ok('发布脚本默认不整页删除发行版',
    !/DeleteAsync\(\s*"\$api\/releases\/\$\(\$old\.id\)/.test(pub) && !/Select-Object -Skip 2/.test(pub));
  ok('发布脚本包含配额预检与显式清理开关',
    /QuotaLimitMB/.test(pub) && /PruneOldReleases/.test(pub) && /attach_files/.test(pub));
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'mirror-release-assets.yml'), 'utf8');
  ok('GitHub 资产镜像工作流存在且由 tag 触发',
    /tags:/.test(wf) && /gh release upload/.test(wf) && /contents: write/.test(wf));
} catch (e) {
  ok('发布工具约束', false, e.message);
}

console.log('');
console.log(fails === 0 ? '静态自检全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
