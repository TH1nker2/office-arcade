#!/usr/bin/env node
/* 打版本号：把当前版本归档进 history，写上新版本与说明
 *
 * 用法：
 *   node tools/bump-version.js 2.5.0 "修复了 X" "新增了 Y"
 *   node tools/bump-version.js 2.5.0 -f notes.txt     # 从文件读说明（每行一条）
 *   node tools/bump-version.js --show                 # 只看当前版本
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'version.json');
const PKG_FILE = path.join(ROOT, 'package.json');

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  } catch (e) {
    return { version: '0.0.0', released: today(), notes: [], history: [] };
  }
}

const args = process.argv.slice(2);

if (!args.length || args[0] === '--show' || args[0] === '-s') {
  const v = load();
  console.log('当前版本： v' + v.version + '   (' + (v.released || '未标注日期') + ')');
  (v.notes || []).forEach((n) => console.log('  - ' + n));
  if ((v.history || []).length) {
    console.log('\n历史版本：');
    v.history.forEach((h) => console.log('  v' + h.version + '  ' + (h.released || '') + '  ' + (h.notes || []).length + ' 条'));
  }
  process.exit(0);
}

const next = String(args.shift() || '').replace(/^v/, '').trim();
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('版本号格式应为 x.y.z，例如 2.5.0');
  process.exit(1);
}

let notes = args;
if (notes[0] === '-f' || notes[0] === '--file') {
  const f = notes[1];
  if (!f || !fs.existsSync(f)) { console.error('找不到说明文件：' + f); process.exit(1); }
  notes = fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
if (!notes.length) {
  console.error('至少给一条更新说明：node tools/bump-version.js 2.5.0 "改了什么"');
  process.exit(1);
}

const cur = load();
const history = cur.history || [];
if (cur.version && cur.version !== '0.0.0') {
  history.unshift({
    version: cur.version,
    released: cur.released || today(),
    notes: cur.notes || []
  });
}

const out = {
  version: next,
  released: today(),
  notes: notes,
  history: history.slice(0, 30)
};

fs.writeFileSync(VERSION_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');

try {
  const pkg = JSON.parse(fs.readFileSync(PKG_FILE, 'utf8'));
  pkg.version = next;
  fs.writeFileSync(PKG_FILE, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
} catch (e) { /* package.json 可选 */ }

console.log('已发布 v' + next + '（' + out.released + '）');
notes.forEach((n) => console.log('  - ' + n));
console.log('\n重启服务器后，页面右上角就会显示新版本。');
