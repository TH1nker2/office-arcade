#!/usr/bin/env node
/* v7：可访问性回归——覆盖层 ARIA、焦点陷阱、键盘打开玩家菜单、Esc 归还焦点 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9550 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-a11y-' + PORT);
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

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });
  const A = new Browser('A', 9991);
  const B = new Browser('B', 9992);
  await A.launch();
  await B.launch();
  const url = 'http://127.0.0.1:' + PORT + '/';
  await A.send('Page.navigate', { url });
  await B.send('Page.navigate', { url });
  await sleep(1400);
  await register(A, 'a11ya', '无障碍甲');
  await register(B, 'a11yb', '无障碍乙');
  check('两人进入大厅', (await A.ev('AR.App.screen')) === 'lobby' && (await B.ev('AR.App.screen')) === 'lobby');
  await sleep(600);

  console.log('\n[1] 覆盖层静态 ARIA');
  const aria = JSON.parse(await A.ev(`JSON.stringify({
    dialogs: document.querySelectorAll('.overlay[role="dialog"][aria-modal="true"]').length,
    hidden: document.querySelectorAll('.overlay[aria-hidden="true"]').length,
    toastLive: document.getElementById('toast').getAttribute('aria-live'),
    chatLive: document.getElementById('chat-log').getAttribute('aria-live')
  })`));
  check('所有覆盖层都声明 dialog/aria-modal', aria.dialogs >= 10, 'dialogs=' + aria.dialogs);
  check('默认隐藏的覆盖层 aria-hidden=true', aria.hidden >= 10, 'hidden=' + aria.hidden);
  check('toast 是 polite live region', aria.toastLive === 'polite', aria.toastLive);
  check('对局聊天是 live region', aria.chatLive === 'polite', aria.chatLive);

  console.log('\n[2] 键盘打开玩家菜单');
  const rowId = await B.ev('AR.App.me.id');
  const opened = await A.ev(`(function(){
    var row = document.querySelector('#user-list .user-row[data-user-id="${rowId}"]');
    if (!row) return JSON.stringify({ ok: false, why: 'no-row' });
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }));
    var item = document.querySelector('#player-menu-list .ctx-item');
    return JSON.stringify({
      ok: !document.getElementById('player-menu').classList.contains('hidden'),
      focused: document.activeElement === item,
      role: document.getElementById('player-menu').getAttribute('role')
    });
  })()`);
  const openInfo = JSON.parse(opened);
  check('回车能打开玩家操作菜单', openInfo.ok === true, JSON.stringify(openInfo));
  check('打开后焦点在菜单项上', openInfo.focused === true);
  check('菜单 role=menu', openInfo.role === 'menu', openInfo.role);

  const arrow = await A.ev(`(function(){
    var item = document.querySelector('#player-menu-list .ctx-item');
    item.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true, cancelable: true }));
    return document.activeElement === item;
  })()`);
  check('方向键在菜单内移动焦点', arrow === true);

  await A.ev('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true, cancelable: true }))');
  await sleep(120);
  const closed = JSON.parse(await A.ev(`JSON.stringify({
    hidden: document.getElementById('player-menu').classList.contains('hidden'),
    backToRow: document.activeElement === document.querySelector('#user-list .user-row[data-user-id="${rowId}"]')
  })`));
  check('Esc 关闭菜单', closed.hidden === true);
  check('Esc 后焦点回到玩家行', closed.backToRow === true);

  console.log('\n[3] 资料覆盖层焦点陷阱');
  await A.ev(`(function(){
    var row = document.querySelector('#user-list .user-row[data-user-id="${rowId}"]');
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }));
    document.querySelector('#player-menu-list .ctx-item').click();
  })()`);
  await sleep(700);
  const overlay = JSON.parse(await A.ev(`(function(){
    var ov = document.getElementById('player-overlay');
    var buttons = ov.querySelectorAll('button:not([disabled])');
    var first = buttons[0];
    var last = buttons[buttons.length - 1];
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true, cancelable: true }));
    return JSON.stringify({
      open: !ov.classList.contains('hidden'),
      ariaHidden: ov.getAttribute('aria-hidden'),
      inside: ov.contains(document.activeElement),
      trappedFirst: document.activeElement === first,
      buttons: buttons.length
    });
  })()`));
  check('资料卡已打开', overlay.open === true);
  check('打开后 aria-hidden=false', overlay.ariaHidden === 'false', overlay.ariaHidden);
  check('焦点在资料卡内', overlay.inside === true);
  check('Tab 从最后一个元素循环到第一个', overlay.trappedFirst === true, 'buttons=' + overlay.buttons);

  await A.ev('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true, cancelable: true }))');
  await sleep(160);
  const restored = JSON.parse(await A.ev(`JSON.stringify({
    hidden: document.getElementById('player-overlay').classList.contains('hidden'),
    ariaHidden: document.getElementById('player-overlay').getAttribute('aria-hidden'),
    backToRow: document.activeElement === document.querySelector('#user-list .user-row[data-user-id="${rowId}"]')
  })`));
  check('Esc 关闭资料卡', restored.hidden === true);
  check('关闭后 aria-hidden=true', restored.ariaHidden === 'true', restored.ariaHidden);
  check('关闭后焦点回到玩家行', restored.backToRow === true);

  console.log('\n[4] 控制台');
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
