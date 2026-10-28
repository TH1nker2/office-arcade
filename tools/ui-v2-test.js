#!/usr/bin/env node
/* v2 浏览器端到端：注册 / 大厅 / 选游戏 / 建房 / 邀请 / 开局 / 资料页 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8650 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-ui-' + PORT);
const { Browser, sleep } = require('./lib/browser');
const { startServer } = require('./lib/fixture');

const GAME_DESC = {
  snake: '吞下光点不断变长，撞上其他蛇身会暂时退场，随后复活。',
  tank: '俯视角坦克对战，砖墙能被轰开，击败对手次数最多者获胜。',
  bomber: '放置炸弹炸开砖块、收集道具，坚持到最后的人获胜。',
  tetris: '消除方块行会给对手送去干扰行，率先被堆满者出局。',
  shmup: '全队迎战敌机与随机 BOSS；击毁敌机掉落增益，全员被击毁时结束。',
  draw: '轮流当画手，其余人在聊天框抢答，猜得越快得分越高。',
  racing: '俯视角漂移竞速，四条赛道各跑两圈，率先冲线者获胜。',
  gomoku: '15×15 经典棋盘，不限时轮流落子，率先连成五子者获胜。',
  ludo: '掷骰子起飞，落到对手格就把对方送回起点；率先让全部飞机到家者获胜。'
};
const BAD_DESC_WORDS = ['打飞机', '爆开', '活着', '击杀', '垃圾行', '顶死', '阵亡', '撑不住', '送他回起点'];

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

async function register(page, user, nick) {
  await page.ev('document.querySelector(\'.tab[data-auth="register"]\').click()');
  await sleep(200);
  await page.ev('document.getElementById("auth-user").value = ' + JSON.stringify(user));
  await page.ev('document.getElementById("auth-nick").value = ' + JSON.stringify(nick));
  await page.ev('document.getElementById("auth-pass").value = "123456"');
  await page.ev('document.getElementById("auth-submit").click()');
}

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });

  const url = 'http://127.0.0.1:' + PORT + '/';

  const A = new Browser('A', 9930);
  const B = new Browser('B', 9940);
  const C = new Browser('C', 9950);
  await A.launch();
  await B.launch();
  await C.launch();

  await A.send('Page.navigate', { url });
  await sleep(1400);
  await A.shot('30-auth');

  console.log('\n[1] 注册三个账号');
  await register(A, 'laowang', '老王');
  await sleep(1600);
  const screenA = await A.ev('AR.App.screen');
  check('注册后进入大厅', screenA === 'lobby', 'screen=' + screenA);
  await A.shot('31-lobby-empty');

  await B.send('Page.navigate', { url });
  await C.send('Page.navigate', { url });
  await sleep(1200);
  await register(B, 'xiaoli', '小李');
  await sleep(1000);
  await register(C, 'xiaozhang', '小张');
  await sleep(1600);

  const online = await A.ev('AR.App.lobby.filter(function(u){return u.status!=="offline";}).length');
  check('大厅显示三个人在线', online === 3, 'online=' + online);

  /* 老玩家的界面必须立刻出现新注册的人（DOM 层面，不只是内存数据） */
  await sleep(800);
  const domText = await A.ev('document.getElementById("user-list").textContent');
  check('老玩家界面上出现了新人', domText.indexOf('小李') >= 0 && domText.indexOf('小张') >= 0,
    domText.slice(0, 50));
  await A.shot('31b-lobby-3p');

  console.log('\n[1b] 九款游戏简介');
  const descs = await A.ev('AR.GAME_INFO.map(function (g) { return { id: g.id, desc: g.desc }; })');
  check('九款游戏都有简介且不超过 40 字',
    descs.length === 9 && descs.every((g) => g.desc && g.desc.length <= 40),
    descs.map((g) => g.id + ':' + (g.desc || '').length).join(' '));
  check('简介文案与预期一致', descs.every((g) => g.desc === GAME_DESC[g.id]),
    descs.filter((g) => g.desc !== GAME_DESC[g.id]).map((g) => g.id).join(',') || 'all match');
  const allDesc = descs.map((g) => g.desc).join('');
  const badWords = BAD_DESC_WORDS.filter((w) => allDesc.indexOf(w) >= 0);
  check('简介不含生硬用语', badWords.length === 0, badWords.join(',') || 'none');

  const cards = await A.ev(
    'Array.prototype.map.call(document.querySelectorAll("#lobby-games .game-card"),' +
    ' function (c) { return { id: c.getAttribute("data-game"), desc: c.querySelector("p").textContent }; })'
  );
  check('大厅九张卡片展示简介', cards.length === 9 && cards.every((c) => c.desc === GAME_DESC[c.id]),
    cards.map((c) => c.id).join(','));

  const hubBad = [];
  for (const g of descs) {
    await A.ev('document.querySelector(\'[data-game="' + g.id + '"]\').click()');
    await sleep(300);
    const hub = await A.ev('document.getElementById("hub-desc").textContent');
    if (hub.indexOf(g.desc) !== 0) hubBad.push(g.id);
    await A.ev('document.getElementById("hub-back").click()');
    await sleep(200);
  }
  check('九个游戏分区展示简介', hubBad.length === 0, hubBad.join(',') || 'all match');

  console.log('\n[2] 进入游戏分区');
  await A.ev('document.querySelector(\'[data-game="snake"]\').click()');
  await sleep(700);
  check('进入蛇球分区', (await A.ev('AR.App.gameId')) === 'snake');
  await A.shot('32-hub');

  console.log('\n[3] 创建房间');
  await A.ev('document.getElementById("btn-create-room").click()');
  await sleep(1200);
  const roomA = await A.ev('JSON.stringify({screen: AR.App.screen, code: AR.App.room && AR.App.room.code, n: AR.App.room && AR.App.room.players.length})');
  const rA = JSON.parse(roomA);
  check('房主进入房间', rA.screen === 'room' && rA.code, rA.screen + ' ' + rA.code);
  await A.shot('33-room');
  const roomDesc = await A.ev('document.getElementById("room-desc").textContent');
  check('房间页展示蛇球新简介', roomDesc.indexOf(GAME_DESC.snake) >= 0, roomDesc.slice(0, 40));

  console.log('\n[4] 邀请小李');
  await A.ev('document.getElementById("btn-invite").click()');
  await sleep(400);
  await A.shot('33b-invite-picker');
  const pickCount = await A.ev('document.querySelectorAll("#pick-list .pick-item").length');
  check('邀请列表有可邀请玩家', pickCount === 2, 'items=' + pickCount);
  /* 点击小李 */
  await A.ev('(function(){var els=document.querySelectorAll("#pick-list .pick-item");for(var i=0;i<els.length;i++){if(els[i].textContent.indexOf("小李")>=0){els[i].click();return "ok";}}return "none";})()');
  await sleep(800);

  const inviteVisible = await B.ev('!document.getElementById("invite-overlay").classList.contains("hidden")');
  check('小李收到邀请弹窗', inviteVisible === true);
  await B.shot('34-invite');

  await B.ev('document.getElementById("btn-invite-accept").click()');
  await sleep(1000);
  check('小李接受后进入房间', (await B.ev('AR.App.screen')) === 'room');
  const roomN = await A.ev('AR.App.room.players.length');
  check('房间人数变成 2', roomN === 2, 'players=' + roomN);
  await A.shot('35-room-2p');

  console.log('\n[5] 开局');
  await A.ev('document.getElementById("btn-start").click()');
  await sleep(3500);
  const playA = await A.ev('JSON.stringify({screen: AR.App.screen, game: AR.App.game && AR.App.game.id, hasSnap: !!AR.App.snap})');
  console.log('    A:', playA);
  check('房主进入游戏画面', JSON.parse(playA).screen === 'play');
  await A.shot('36-game');
  await B.shot('36b-game-b');

  console.log('\n[6] 大厅里的“游戏中”状态');
  await sleep(1500);
  const cLobby = await C.ev('JSON.stringify(AR.App.lobby.filter(function(u){return u.status==="playing";}).map(function(u){return u.nickname + ":" + u.gameName;}))');
  console.log('    C 看到:', cLobby);
  check('旁观者看到两人在游戏中', JSON.parse(cLobby).length === 2);
  await C.shot('37-lobby-ingame');

  console.log('\n[7] 个人资料');
  await C.ev('document.getElementById("btn-profile").click()');
  await sleep(900);
  check('打开资料页', (await C.ev('AR.App.screen')) === 'profile');
  await C.shot('38-profile');

  await C.ev('document.getElementById("profile-nick").value = "小张同学"');
  await C.ev('document.querySelector(\'#profile-emojis [data-emoji="🦊"]\').click()');
  await C.ev('document.getElementById("btn-save-profile").click()');
  await sleep(800);
  const saved = await C.ev('AR.App.me.nickname');
  check('资料保存成功', saved === '小张同学', saved);
  await C.shot('39-profile-saved');

  console.log('\n[8] 排行榜');
  await C.ev('document.getElementById("btn-profile-close").click()');
  await sleep(400);
  await C.ev('document.getElementById("btn-board").click()');
  await sleep(700);
  check('排行榜弹窗可见', (await C.ev('!document.getElementById("board-overlay").classList.contains("hidden")')));
  await C.shot('40-board');

  console.log('\n错误检查');
  [A, B, C].forEach((x) => console.log('  ' + x.tag + ':', x.errors.length ? x.errors.slice(0, 3) : '无'));
  const fatal = await A.ev('!document.getElementById("fatal").classList.contains("hidden")');
  check('无致命错误层', fatal === false);

  A.kill(); B.kill(); C.kill();
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
