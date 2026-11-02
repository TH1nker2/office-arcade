#!/usr/bin/env node
/* 一键测试入口
 *
 *   node tools/test-all.js             非浏览器测试（含静态自检）
 *   node tools/test-all.js --with-ui   额外跑离线审计 + 所有浏览器端到端（会写 shots/）
 *   node tools/test-all.js --perf      额外跑性能基线
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const withUi = argv.indexOf('--with-ui') >= 0;
const withPerf = argv.indexOf('--perf') >= 0;

const base = [
  'check.js',
  'words-test.js',
  'game-test.js',
  'bot-test.js',
  'regression-test.js',
  'store-json-test.js',
  'store-migration-test.js',
  'auth-test.js',
  'admin-test.js',
  'player-profile-test.js',
  'proxy-test.js',
  'audit-test.js',
  'hardening-test.js'
];
const ui = [
  'admin-words-ui-test.js',
  'offline-test.js',
  'ui-v2-test.js',
  'ui-v3-test.js',
  'ui-v4-test.js',
  'ui-v5-test.js',
  'ui-v6-test.js',
  'ui-v7-test.js',
  'ui-v8-test.js',
  'ui-v9-test.js',
  'ui-v10-test.js',
  'ui-v11-test.js'
];

const list = base.slice();
if (withUi) list.push(...ui);
if (withPerf) list.push('perf-test.js');

const start = Date.now();
let failed = null;
for (let i = 0; i < list.length; i++) {
  const name = list[i];
  console.log('\n========== [' + (i + 1) + '/' + list.length + '] ' + name + ' ==========');
  const r = spawnSync(process.execPath, [path.join(__dirname, name)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
  if (r.status !== 0) { failed = name; break; }
}

const sec = ((Date.now() - start) / 1000).toFixed(1);
console.log('\n==================================================');
if (failed) {
  console.log('失败：' + failed + '（已用时 ' + sec + 's）');
  process.exit(1);
}
console.log('全部通过：' + list.length + ' 个脚本（' + sec + 's）');
if (!withUi) console.log('提示：浏览器测试用 --with-ui，性能基线用 --perf');
