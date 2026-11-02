#!/usr/bin/env node
/* v11：五子棋落子位置预标记（双浏览器） */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9760 + Math.floor(Math.random() * 30);
const DATA = path.join(os.tmpdir(), 'arcade-gomoku-hover-' + PORT);
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
  await sleep(1400);
}

async function snapshot(B) {
  return JSON.parse(await B.ev('JSON.stringify({screen:AR.App.screen, snap:AR.App.snap, me:AR.App.me.id})'));
}

async function waitFor(B, fn, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) {
    const s = await snapshot(B);
    if (fn(s)) return s;
    await sleep(100);
  }
  return await snapshot(B);
}

async function hover(B, x, y) {
  const raw = await B.ev(`(function () {
    var c = document.getElementById('stage');
    var r = c.getBoundingClientRect();
    var p = AR.Render.gomokuCellXY(${x}, ${y}, AR.View.tf);
    c.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, button: 0,
      clientX: r.left + p.x, clientY: r.top + p.y, view: window
    }));
    return JSON.stringify(AR.Render.gomokuHover);
  })()`);
  return JSON.parse(raw);
}

async function leave(B) {
  const raw = await B.ev(`(function () {
    document.getElementById('stage').dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    return JSON.stringify(AR.Render.gomokuHover);
  })()`);
  return JSON.parse(raw);
}

function isCell(h, x, y) {
  return !!h && h.x === x && h.y === y;
}

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });
  const A = new Browser('A', 9994);
  const B = new Browser('B', 9995);
  await A.launch();
  await B.launch();
  const url = 'http://127.0.0.1:' + PORT + '/';
  await A.send('Page.navigate', { url });
  await B.send('Page.navigate', { url });
  await sleep(1400);
  await register(A, 'hovera', '预标记甲');
  await register(B, 'hoverb', '预标记乙');

  await A.ev('document.querySelector(\'[data-game="gomoku"]\').click()');
  await sleep(400);
  await A.ev('document.getElementById("btn-create-room").click()');
  await sleep(700);
  await B.ev('fetch("/api/rooms?game=gomoku").then(function(r){return r.json()}).then(function(d){Net.send({t:"joinRoom",code:d.rooms[0].code})})');
  await sleep(700);
  await A.ev('document.getElementById("btn-start").click()');
  const start = await waitFor(A, (s) => s.screen === 'play' && s.snap);
  check('双人对局开始', start.screen === 'play' && !!start.snap, start.screen);

  const aId = await A.ev('AR.App.me.id');
  const bId = await B.ev('AR.App.me.id');

  console.log('\n[1] 轮到自己时显示预标记');
  let h = await hover(A, 7, 7);
  check('空交叉点显示预标记', isCell(h, 7, 7), JSON.stringify(h));
  h = await hover(B, 7, 7);
  check('对方回合不显示预标记', h === null, JSON.stringify(h));

  console.log('\n[2] 落子后预标记跟随回合');
  await A.ev('Net.send({t:"input",i:{x:7,y:7}})');
  await waitFor(A, (s) => s.snap && s.snap.mv === 1);
  h = await hover(A, 8, 7);
  check('自己回合结束后预标记消失', h === null, JSON.stringify(h));
  h = await hover(B, 8, 7);
  check('轮到对方时对方能看到预标记', isCell(h, 8, 7), JSON.stringify(h));

  await B.ev('Net.send({t:"input",i:{x:8,y:8}})');
  const both = await waitFor(A, (s) => s.snap && s.snap.mv === 2 && s.snap.cur === aId);
  check('双方各落一子后回到自己回合', both.snap.mv === 2 && both.snap.cur === aId,
    'moves=' + (both.snap && both.snap.mv) + ' cur=' + (both.snap && both.snap.cur));

  h = await hover(A, 7, 7);
  check('已有棋子的交叉点不显示预标记', h === null, JSON.stringify(h));
  h = await hover(A, 8, 7);
  check('空格重新显示预标记', isCell(h, 8, 7), JSON.stringify(h));
  await A.shot('95-gomoku-hover-preview');

  console.log('\n[3] 等待回复时隐藏预标记');
  await A.ev('document.getElementById("gomoku-undo").click()');
  await sleep(350);
  const pending = await snapshot(A);
  check('悔棋请求已挂起', !!pending.snap.pending, JSON.stringify(pending.snap.pending));
  h = await hover(A, 6, 6);
  check('等待对方回复时不显示预标记', h === null, JSON.stringify(h));
  await B.ev('document.getElementById("request-decline").click()');
  await sleep(400);
  h = await hover(A, 6, 6);
  check('拒绝后恢复预标记', isCell(h, 6, 6), JSON.stringify(h));

  console.log('\n[4] 鼠标离开棋盘');
  h = await leave(A);
  check('鼠标离开画布清除预标记', h === null, JSON.stringify(h));

  console.log('\n[5] 控制台');
  [A, B].forEach((x) => console.log('  ' + x.tag + ':', x.errors.length ? x.errors.slice(0, 3) : '无'));
  check('无控制台错误', A.errors.length === 0 && B.errors.length === 0);
  check('预标记不改变回合', (await snapshot(A)).snap.cur === aId && bId !== aId);

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
