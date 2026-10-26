#!/usr/bin/env node
/* 你画我猜词库校验：数量、提示格式、重复词、明显不适合的词 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'shared', 'words.json');
const BANNED = new Set([
  '打飞机', '注意力碎片', '容器化', '中间件', '通货紧缩', '自我实现', '知行合一',
  '抑郁症', '焦虑症', '强迫症', '拖延症', '氛围感', '松弛感', '低碳', '碳中和',
  '碳达峰', '信息茧房', '云计算', '物联网', '算法', '数字化'
]);

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const levels = data.levels || {};
const all = new Map();
let duplicate = 0;
let bad = [];

['easy', 'normal', 'hard'].forEach((lv) => {
  const list = levels[lv] && levels[lv].words;
  ok(lv + ' 有 500 个词', Array.isArray(list) && list.length === 500, list ? 'count=' + list.length : 'missing');
  if (!Array.isArray(list)) return;
  list.forEach((e) => {
    if (!e || typeof e.w !== 'string' || !e.w.trim()) {
      bad.push(lv + ':空词');
      return;
    }
    const w = e.w.trim();
    const n = Array.from(w).length;
    if (all.has(w)) { duplicate++; bad.push('重复:' + w + '(' + all.get(w) + '/' + lv + ')'); }
    all.set(w, lv);
    if (n < 1 || n > 5) bad.push(lv + ':' + w + ' 长度=' + n);
    if (BANNED.has(w)) bad.push(lv + ':' + w + ' 属于应淘汰词');
    if (!Array.isArray(e.h) || e.h.length !== 4) {
      bad.push(lv + ':' + w + ' 提示数=' + (e.h ? e.h.length : 0));
      return;
    }
    if (e.h[0] !== '共' + n + '个字') bad.push(lv + ':' + w + ' 字数提示=' + e.h[0]);
    for (let i = 1; i < 4; i++) {
      const h = String(e.h[i] || '');
      if (!h) bad.push(lv + ':' + w + ' 空提示' + i);
      else if (h.length > 20) bad.push(lv + ':' + w + ' 提示过长 ' + h);
      for (const ch of w) {
        if (h.includes(ch)) bad.push(lv + ':' + w + ' 提示含关键词字「' + ch + '」：' + h);
      }
    }
  });
});

ok('三档之间没有重复词', duplicate === 0, 'duplicate=' + duplicate);
ok('提示结构全部合法', bad.length === 0, bad.slice(0, 5).join(' | '));
ok('词库说明写明每档 500', /500/.test(String(data._readme || '')), String(data._readme || '').slice(0, 60));

console.log('');
console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
