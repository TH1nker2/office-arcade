#!/usr/bin/env node
/* v10：五子棋人机悔棋 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9780 + Math.floor(Math.random() * 30);
const DATA = path.join(os.tmpdir(), 'arcade-gomoku-bot-undo-' + PORT);
const { Browser, sleep } = require('./lib/browser');
const { startServer } = require('./lib/fixture');

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

async function snap(page) {
  return JSON.parse(await page.ev('JSON.stringify({screen:AR.App.screen, snap:AR.App.snap, room:AR.App.room})'));
}

async function waitFor(page, fn, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) {
    const s = await snap(page);
    if (fn(s)) return s;
    await sleep(100);
  }
  return await snap(page);
}

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });
  const A = new Browser('A', 9998);
  await A.launch();
  try {
    await A.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
    await sleep(1400);
    await A.ev('document.querySelector(\'.tab[data-auth="register"]\').click()');
    await sleep(150);
    await A.ev('document.getElementById("auth-user").value = "gomobot"');
    await A.ev('document.getElementById("auth-nick").value = "人机悔棋"');
    await A.ev('document.getElementById("auth-pass").value = "123456"');
    await A.ev('document.getElementById("auth-submit").click()');
    await sleep(1400);

    await A.ev('document.querySelector(\'[data-game="gomoku"]\').click()');
    await sleep(400);
    await A.ev('document.getElementById("btn-create-room").click()');
    await sleep(700);
    await A.ev('document.getElementById("btn-add-bot").click()');
    const room = await waitFor(A, (s) => s.room && s.room.players.length === 2);
    check('人机加入房间', room.room && room.room.players.length === 2,
      JSON.stringify(room.room && room.room.players.map((p) => p.name)));

    await A.ev('document.getElementById("btn-start").click()');
    const play = await waitFor(A, (s) => s.screen === 'play' && s.snap);
    check('人机对局开始', play.screen === 'play' && !!play.snap, play.screen);

    await A.ev('Net.send({t:"input",i:{x:7,y:7}})');
    const moved = await waitFor(A, (s) => s.snap && s.snap.mv >= 2);
    check('人机完成应手', moved.snap && moved.snap.mv === 2, 'moves=' + (moved.snap && moved.snap.mv));

    await A.ev('document.getElementById("gomoku-undo").click()');
    const undone = await waitFor(A, (s) => s.snap && s.snap.mv === 0);
    check('人机悔棋后棋盘回退', undone.snap && undone.snap.mv === 0 &&
      undone.snap.b.indexOf('1') < 0 && undone.snap.b.indexOf('2') < 0,
      'moves=' + (undone.snap && undone.snap.mv));

    await sleep(900);
    const stable = await snap(A);
    check('人机没有立刻重下', stable.snap && stable.snap.mv === 0,
      'moves=' + (stable.snap && stable.snap.mv));
    check('无控制台错误', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));
  } finally {
    A.kill();
    await server.stop();
  }

  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
