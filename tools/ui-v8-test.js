#!/usr/bin/env node
/* v8：五子棋悔棋/和棋/认输交互（双浏览器） */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9720 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-gomoku-actions-' + PORT);
const { Browser, sleep } = require('./lib/browser');
const { startServer } = require('./lib/fixture');

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

async function register(B, user, nick) {
  await B.ev('document.querySelector(\'.tab[data-auth="register"]\').click()');
  await sleep(150);
  await B.ev('document.getElementById("auth-user").value = ' + JSON.stringify(user));
  await B.ev('document.getElementById("auth-nick").value = ' + JSON.stringify(nick));
  await B.ev('document.getElementById("auth-pass").value = "123456"');
  await B.ev('document.getElementById("auth-submit").click()');
  await sleep(1500);
}

async function snapshot(B) {
  return JSON.parse(await B.ev('JSON.stringify({screen:AR.App.screen, game:AR.App.game&&AR.App.game.id, snap:AR.App.snap})'));
}

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });
  const A = new Browser('A', 9996);
  const B = new Browser('B', 9997);
  await A.launch();
  await B.launch();
  const url = 'http://127.0.0.1:' + PORT + '/';
  await A.send('Page.navigate', { url });
  await B.send('Page.navigate', { url });
  await sleep(1400);
  await register(A, 'goma', '棋手甲');
  await register(B, 'gomb', '棋手乙');
  check('两名棋手进入大厅', (await A.ev('AR.App.screen')) === 'lobby' && (await B.ev('AR.App.screen')) === 'lobby');

  await A.ev('document.querySelector(\'[data-game="gomoku"]\').click()');
  await sleep(450);
  await A.ev('document.getElementById("btn-create-room").click()');
  await sleep(800);
  const code = await A.ev('AR.App.room && AR.App.room.code');
  await B.ev('fetch("/api/rooms?game=gomoku").then(function(r){return r.json()}).then(function(d){Net.send({t:"joinRoom",code:d.rooms[0].code})})');
  await sleep(800);
  check('第二人进入五子棋房间', (await A.ev('AR.App.room.players.length')) === 2);
  await A.ev('document.getElementById("btn-start").click()');
  await sleep(1200);
  check('五子棋开局', (await A.ev('AR.App.screen')) === 'play' && (await B.ev('AR.App.screen')) === 'play');

  /* 甲黑先下，乙白应一手 */
  await A.ev('Net.send({t:"input",i:{x:7,y:7}})');
  await sleep(350);
  await B.ev('Net.send({t:"input",i:{x:8,y:8}})');
  await sleep(350);
  let sa = await snapshot(A);
  check('双方各落一子', sa.snap.mv === 2, 'moves=' + (sa.snap && sa.snap.mv));
  await A.shot('84-gomoku-actions');

  console.log('\n[1] 悔棋需要对方同意');
  await A.ev('document.getElementById("gomoku-undo").click()');
  await sleep(400);
  const requestVisible = await B.ev('!document.getElementById("request-overlay").classList.contains("hidden")');
  const requestTitle = await B.ev('document.getElementById("request-title").textContent');
  check('对方收到悔棋请求弹窗', requestVisible === true, requestTitle);
  check('请求弹窗标题正确', requestTitle.indexOf('悔棋') >= 0, requestTitle);
  await B.shot('85-gomoku-undo-request');
  await B.ev('document.getElementById("request-accept").click()');
  await sleep(500);
  sa = await snapshot(A);
  check('同意后撤销最近一手', sa.snap.mv === 1, 'moves=' + sa.snap.mv);
  check('悔棋计数为 1', sa.snap.rq && sa.snap.rq.undo === 1, JSON.stringify(sa.snap.rq));

  console.log('\n[2] 和棋需要对方同意 + 拒绝');
  await B.ev('document.getElementById("gomoku-draw").click()');
  await sleep(400);
  const drawVisible = await A.ev('!document.getElementById("request-overlay").classList.contains("hidden")');
  const drawTitle = await A.ev('document.getElementById("request-title").textContent');
  check('对方收到和棋请求弹窗', drawVisible === true, drawTitle);
  check('和棋弹窗标题正确', drawTitle.indexOf('和棋') >= 0, drawTitle);
  await A.ev('document.getElementById("request-decline").click()');
  await sleep(500);
  sa = await snapshot(A);
  check('拒绝和棋后游戏继续', sa.snap.draw !== true && sa.snap.pending === null);
  check('和棋请求计数为 1', sa.snap.rq && sa.snap.rq.draw === 1, JSON.stringify(sa.snap.rq));

  console.log('\n[3] 再次和棋并同意');
  await B.ev('document.getElementById("gomoku-draw").click()');
  await sleep(400);
  await A.ev('document.getElementById("request-accept").click()');
  await sleep(900);
  const over = JSON.parse(await A.ev(`JSON.stringify({
    visible: !document.getElementById('over-overlay').classList.contains('hidden'),
    title: document.getElementById('over-title').textContent,
    table: document.getElementById('over-table').textContent
  })`));
  check('和棋结算弹窗出现', over.visible === true, over.title);
  check('结算显示平局', over.title === '平局', over.title);
  check('结算表有平局标记', over.table.indexOf('平') >= 0, over.table.slice(0, 40));
  await sleep(2200);
  await A.shot('86-gomoku-draw');
  sa = await snapshot(A);
  check('和棋计数为 2', sa.snap.rq && sa.snap.rq.draw === 2, JSON.stringify(sa.snap.rq));

  console.log('\n[4] 认输（新开一局）');
  await A.ev('document.getElementById("over-back").click()');
  await B.ev('document.getElementById("over-back").click()');
  await sleep(500);
  await A.ev('document.getElementById("btn-leave-room").click()');
  await B.ev('document.getElementById("btn-leave-room").click()');
  await sleep(700);
  await A.ev('document.querySelector(\'[data-game="gomoku"]\').click()');
  await sleep(400);
  await A.ev('document.getElementById("btn-create-room").click()');
  await sleep(700);
  await B.ev('fetch("/api/rooms?game=gomoku").then(function(r){return r.json()}).then(function(d){Net.send({t:"joinRoom",code:d.rooms[0].code})})');
  await sleep(700);
  await A.ev('Net.send({t:"start"})');
  await sleep(900);
  await B.ev('document.getElementById("gomoku-resign").click()');
  await sleep(300);
  check('认输前有确认弹窗', (await B.ev('!document.getElementById("resign-overlay").classList.contains("hidden")')) === true);
  await B.shot('87-gomoku-resign');
  await B.ev('document.getElementById("resign-ok").click()');
  await sleep(900);
  const resignA = JSON.parse(await A.ev(`JSON.stringify({
    visible: !document.getElementById('over-overlay').classList.contains('hidden'),
    title: document.getElementById('over-title').textContent
  })`));
  const resignB = JSON.parse(await B.ev(`JSON.stringify({
    visible: !document.getElementById('over-overlay').classList.contains('hidden'),
    title: document.getElementById('over-title').textContent
  })`));
  check('认输后对手看到胜利', resignA.visible === true &&
    (resignA.title.indexOf('获胜') >= 0 || resignA.title.indexOf('你赢了') >= 0), resignA.title);
  check('认输方看到对手获胜', resignB.visible === true && resignB.title.indexOf('获胜') >= 0,
    resignB.title);

  console.log('\n[5] 控制台');
  [A, B].forEach((x) => console.log('  ' + x.tag + ':', x.errors.length ? x.errors.slice(0, 3) : '无'));
  check('无控制台错误', A.errors.length === 0 && B.errors.length === 0);

  A.kill(); B.kill();
  await server.stop();
  await sleep(300);

  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
