#!/usr/bin/env node
/* 大厅右键查看玩家资料：真实浏览器端到端 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9170 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-player-ui-' + PORT);
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

async function rightClick(B, id) {
  return await B.ev('(function(){' +
    'var row=document.querySelector(\'#user-list .user-row[data-user-id="' + id + '"]\');' +
    'if(!row)return "no-row";' +
    'var ev=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});' +
    'return row.dispatchEvent(ev);' +
    '})()');
}

async function menuInfo(B) {
  return JSON.parse(await B.ev('JSON.stringify({' +
    'hidden:document.getElementById("player-menu").classList.contains("hidden"),' +
    'title:document.getElementById("player-menu-title").textContent,' +
    'titleBorder:getComputedStyle(document.getElementById("player-menu-title")).borderBottomWidth,' +
    'items:Array.prototype.map.call(document.querySelectorAll("#player-menu-list .ctx-item"),function(x){return {' +
    'label:x.querySelector(".ctx-label").textContent,' +
    'icon:x.querySelector(".ctx-icon").textContent,' +
    'action:x.getAttribute("data-action")}}),' +
    'dividers:document.querySelectorAll("#player-menu-list .ctx-divider").length' +
    '})'));
}

async function openProfileViaMenu(B, id) {
  await rightClick(B, id);
  await sleep(150);
  await B.ev('document.querySelector(\'#player-menu-list .ctx-item[data-action="profile"]\').click()');
  await sleep(450);
}

async function profileInfo(B) {
  return JSON.parse(await B.ev('JSON.stringify({' +
    'hidden:document.getElementById("player-overlay").classList.contains("hidden"),' +
    'nick:document.getElementById("player-nick").textContent,' +
    'username:document.getElementById("player-username").textContent,' +
    'bio:document.getElementById("player-bio").textContent,' +
    'status:document.getElementById("player-status").textContent,' +
    'statusClass:document.getElementById("player-status").className,' +
    'stats:Array.prototype.map.call(document.querySelectorAll("#player-stats .stat-card b"),function(x){return x.textContent}).join(","),' +
    'editHidden:document.getElementById("player-edit").classList.contains("hidden")' +
    '})'));
}

async function closePlayer(B) {
  await B.ev('document.getElementById("player-close").click()');
  await sleep(100);
}

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });

  const A = new Browser('A', 9970);
  const B = new Browser('B', 9971);
  await A.launch();
  await B.launch();
  const url = 'http://127.0.0.1:' + PORT + '/';
  await A.send('Page.navigate', { url });
  await B.send('Page.navigate', { url });
  await sleep(1400);

  await register(A, 'alice', '爱丽丝');
  await register(B, 'bob', '鲍勃');
  check('两个账号进入大厅', (await A.ev('AR.App.screen')) === 'lobby' && (await B.ev('AR.App.screen')) === 'lobby');
  await sleep(600);

  const aid = await A.ev('AR.App.me.id');
  const bid = await B.ev('AR.App.me.id');
  await B.ev('fetch("/api/profile",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({bio:"喜欢摸鱼",avatar:"🐼",color:"#ff2e63"})}).then(function(r){return r.json()})');
  await sleep(500);

  console.log('\n[1] 右键操作菜单');
  const prevented = await rightClick(A, bid);
  check('右键阻止了浏览器默认菜单', prevented === false, 'dispatchEvent=' + prevented);
  await sleep(150);
  let menu = await menuInfo(A);
  check('操作菜单已弹出', menu.hidden === false);
  check('菜单标题是玩家昵称', menu.title === '鲍勃', menu.title);
  check('菜单项带图标和文字',
    menu.items.length === 1 && menu.items[0].label === '查看资料' &&
    menu.items[0].action === 'profile' && menu.items[0].icon.trim().length > 0,
    JSON.stringify(menu.items));
  check('标题与选项之间有分割线', menu.titleBorder !== '0px', menu.titleBorder);
  check('打开菜单时资料卡仍未打开', (await profileInfo(A)).hidden === true);

  await A.ev('document.querySelector(\'#player-menu-list .ctx-item[data-action="profile"]\').click()');
  await sleep(450);
  let info = await profileInfo(A);
  check('点击查看资料后资料卡打开', info.hidden === false);
  check('昵称正确', info.nick === '鲍勃', info.nick);
  check('用户名正确', info.username.indexOf('@bob') === 0, info.username);
  check('签名正确', info.bio === '喜欢摸鱼', info.bio);
  check('大厅中状态正确', info.status === '大厅中' && info.statusClass.indexOf('online') >= 0, info.status);
  check('统计卡片有四项', info.stats.split(',').length === 4, info.stats);
  check('看别人不显示编辑按钮', info.editHidden === true);
  check('打开资料后操作菜单已关闭', (await menuInfo(A)).hidden === true);

  console.log('\n[2] 关闭方式');
  await closePlayer(A);
  info = await profileInfo(A);
  check('✕ 能关闭资料卡', info.hidden === true);
  await openProfileViaMenu(A, bid);
  await A.ev('window.dispatchEvent(new KeyboardEvent("keydown",{code:"Escape",bubbles:true}))');
  await sleep(150);
  info = await profileInfo(A);
  check('Esc 能关闭资料卡', info.hidden === true);

  await rightClick(A, bid);
  await sleep(120);
  await A.ev('document.getElementById("lobby-stat").click()');
  await sleep(120);
  check('点击外部关闭操作菜单', (await menuInfo(A)).hidden === true);
  check('点击外部不会打开资料卡', (await profileInfo(A)).hidden === true);

  await rightClick(A, bid);
  await sleep(120);
  await A.ev('window.dispatchEvent(new KeyboardEvent("keydown",{code:"Escape",bubbles:true}))');
  await sleep(120);
  check('Esc 关闭操作菜单且不打开资料卡',
    (await menuInfo(A)).hidden === true && (await profileInfo(A)).hidden === true);

  console.log('\n[3] 等待中 / 游戏中状态');
  await B.ev('document.querySelector(\'[data-game="snake"]\').click()');
  await sleep(500);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(800);
  await openProfileViaMenu(A, bid);
  info = await profileInfo(A);
  check('等待中状态正确', info.status.indexOf('等待中') >= 0 && info.status.indexOf('1/8') >= 0, info.status);
  await closePlayer(A);

  await B.ev('document.getElementById("btn-add-bot").click()');
  await sleep(350);
  await B.ev('document.getElementById("btn-start").click()');
  await sleep(2200);
  await openProfileViaMenu(A, bid);
  info = await profileInfo(A);
  check('游戏中状态正确', info.status.indexOf('游戏中') >= 0, info.status);
  await closePlayer(A);

  console.log('\n[4] 查看自己');
  await openProfileViaMenu(A, aid);
  info = await profileInfo(A);
  check('自己资料卡显示编辑按钮', info.editHidden === false);
  check('自己资料卡有「这是你」', info.username.indexOf('这是你') >= 0, info.username);
  await A.ev('document.getElementById("player-edit").click()');
  await sleep(400);
  check('点击编辑进入个人资料页', (await A.ev('AR.App.screen')) === 'profile');
  await A.ev('document.getElementById("btn-profile-close").click()');
  await sleep(300);

  console.log('\n[5] 控制台');
  console.log('  A 错误:', A.errors.length ? A.errors.slice(0, 3) : '无');
  console.log('  B 错误:', B.errors.length ? B.errors.slice(0, 3) : '无');
  check('无控制台错误', A.errors.length === 0 && B.errors.length === 0);

  A.kill();
  B.kill();
  await server.stop();
  await sleep(400);

  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
