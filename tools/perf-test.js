#!/usr/bin/env node
/* 浏览器性能基线：首屏资源传输量 + 三款高帧率游戏的 RAF 帧时间
 *
 * 用法：node tools/perf-test.js
 * 说明：headless 的数字不能代表真实显卡，但同一台机器前后对比足够定位回归。
 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9500 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-perf-' + PORT);
const { Browser, EDGE, sleep } = require('./lib/browser');
const { startServer } = require('./lib/fixture');

async function measure(B, seconds) {
  const raw = await B.ev(`new Promise(function (resolve) {
    var frames = [];
    var longTask = 0;
    var last = performance.now();
    var start = last;
    var obs = null;
    try {
      obs = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (e) { if (e.duration >= 50) longTask += e.duration; });
      });
      obs.observe({ entryTypes: ['longtask'] });
    } catch (e) { /* 某些 headless 不支持 */ }
    function step(now) {
      frames.push(now - last);
      last = now;
      if (now - start < ${Math.round(seconds * 1000)}) {
        requestAnimationFrame(step);
      } else {
        if (obs) obs.disconnect();
        frames.sort(function (a, b) { return a - b; });
        resolve(JSON.stringify({
          n: frames.length,
          p50: frames[Math.floor(frames.length * 0.5)] || 0,
          p95: frames[Math.floor(frames.length * 0.95)] || 0,
          max: frames[frames.length - 1] || 0,
          longTask: longTask
        }));
      }
    }
    requestAnimationFrame(step);
  })`);
  return JSON.parse(raw);
}

async function leaveToLobby(B) {
  await B.ev('document.getElementById("hud-back").click()');
  await sleep(250);
  await B.ev('document.getElementById("confirm-ok").click()');
  await sleep(800);
  const hasRoom = await B.ev('!!AR.App.room');
  if (hasRoom) {
    await B.ev('document.getElementById("btn-leave-room").click()');
    await sleep(700);
  }
}

async function playGame(B, gameId, seconds) {
  await B.ev('document.querySelector(\'[data-game="' + gameId + '"]\').click()');
  await sleep(450);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(650);
  for (let i = 0; i < 3; i++) {
    await B.ev('document.getElementById("btn-add-bot").click()');
    await sleep(260);
  }
  await B.ev('document.getElementById("btn-start").click()');
  await sleep(1600);
  const state = JSON.parse(await B.ev('JSON.stringify({screen:AR.App.screen,game:AR.App.game&&AR.App.game.id,snap:!!AR.App.snap})'));
  if (state.screen !== 'play' || !state.snap) throw new Error(gameId + ' 未进入对局：' + JSON.stringify(state));
  const r = await measure(B, seconds);
  console.log('  ' + gameId.padEnd(8) +
    ' frames=' + String(r.n).padStart(4) +
    ' p50=' + r.p50.toFixed(1) + 'ms' +
    ' p95=' + r.p95.toFixed(1) + 'ms' +
    ' max=' + r.max.toFixed(1) + 'ms' +
    ' long=' + Math.round(r.longTask) + 'ms');
  await leaveToLobby(B);
  return r;
}

async function main() {
  if (!EDGE) { console.log('找不到 Edge/Chrome，跳过'); process.exit(0); }

  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });
  const B = new Browser('perf', 9990);
  await B.launch();
  await B.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await sleep(1500);

  await B.ev('document.querySelector(\'.tab[data-auth="register"]\').click()');
  await sleep(200);
  await B.ev('document.getElementById("auth-user").value = "perfuser"');
  await B.ev('document.getElementById("auth-nick").value = "性能测试"');
  await B.ev('document.getElementById("auth-pass").value = "123456"');
  await B.ev('document.getElementById("auth-submit").click()');
  await sleep(1600);

  const res = JSON.parse(await B.ev(`(function(){
    var list = performance.getEntriesByType('resource') || [];
    var total = 0, n = 0;
    list.forEach(function (e) { total += e.transferSize || 0; n++; });
    return JSON.stringify({ total: total, n: n });
  })()`));
  console.log('\n首屏资源：' + res.n + ' 个，transferSize 合计 ' + (res.total / 1024).toFixed(1) + ' KB');
  console.log('（浏览器已解压；transferSize 反映 gzip 后实际传输量）\n');

  console.log('RAF 帧时间（3 人机 + 自己，headless Edge）：');
  const results = {};
  for (const id of ['snake', 'tank', 'shmup']) {
    results[id] = await playGame(B, id, 6);
  }

  const p95s = Object.keys(results).map((k) => results[k].p95);
  console.log('\n汇总：p95 最大 ' + Math.max.apply(null, p95s).toFixed(1) + 'ms');
  console.log('提示：真实浏览器通常比 headless 更快；这里用于同机前后对比。');
  if (B.errors.length) {
    console.error('控制台错误：');
    B.errors.slice(0, 5).forEach((e) => console.error('  ' + e));
    B.kill();
    await server.stop();
    process.exit(1);
  }

  B.kill();
  await server.stop();
  await sleep(300);
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
