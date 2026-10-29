#!/usr/bin/env node
/* v4：一键加入 / 退出确认 / 大厅聊天 / 对局聊天 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8720 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-v4-' + PORT);
const { Browser, sleep } = require('./lib/browser');
const { startServer } = require('./lib/fixture');

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

async function register(page, user, nick) {
  await page.ev('document.querySelector(\'.tab[data-auth="register"]\').click()');
  await sleep(150);
  await page.ev('document.getElementById("auth-user").value = ' + JSON.stringify(user));
  await page.ev('document.getElementById("auth-nick").value = ' + JSON.stringify(nick));
  await page.ev('document.getElementById("auth-pass").value = "123456"');
  await page.ev('document.getElementById("auth-submit").click()');
  await sleep(1400);
}

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });

  const url = 'http://127.0.0.1:' + PORT + '/';

  const A = new Browser('A', 9980);
  const B = new Browser('B', 9981);
  await A.launch();
  await B.launch();
  await A.send('Page.navigate', { url });
  await B.send('Page.navigate', { url });
  await sleep(1300);

  console.log('[1] 注册');
  await register(A, 'laowang', '老王');
  await register(B, 'xiaoli', '小李');
  check('两人都在大厅', (await A.ev('AR.App.screen')) === 'lobby' && (await B.ev('AR.App.screen')) === 'lobby');
  await A.shot('50-lobby-chat');

  console.log('\n[2] 大厅聊天 + 表情');
  await A.ev('document.activeElement && document.activeElement.blur()');
  await A.ev('window.dispatchEvent(new KeyboardEvent("keydown",{code:"Enter",bubbles:true,cancelable:true}))');
  await sleep(120);
  check('大厅按回车唤起聊天输入框', (await A.ev('document.activeElement.id')) === 'lobby-chat-text');
  await A.ev('document.getElementById("lobby-chat-text").value = "开会摸鱼中，来一局？"');
  await A.ev('document.getElementById("lobby-chat-send").click()');
  await sleep(600);
  const bLog = await B.ev('document.getElementById("lobby-chat-log").textContent');
  check('大厅消息另一人能收到', bLog.indexOf('开会摸鱼中') >= 0, bLog.slice(0, 40));

  await A.ev('document.getElementById("lobby-emoji-btn").click()');
  await sleep(200);
  const popVisible = await A.ev('!document.getElementById("lobby-emoji-pop").classList.contains("hidden")');
  check('表情面板能打开', popVisible === true);
  await A.ev('document.querySelector("#lobby-emoji-pop button").click()');
  const withEmoji = await A.ev('document.getElementById("lobby-chat-text").value');
  check('点表情能插入输入框', withEmoji.length > 0, 'value=' + withEmoji);
  await A.shot('51-lobby-emoji');

  console.log('\n[3] 建房 → 加人机 → 开局，验证一键加入与对局');
  await B.ev('document.querySelector(\'[data-game="tank"]\').click()');
  await sleep(500);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(800);
  await B.ev('document.getElementById("btn-add-bot").click()');
  await sleep(400);

  /* A 从大厅状态里一键加入 */
  await sleep(600);
  const joinBtn = await A.ev('document.querySelectorAll("#user-list .u-join").length');
  check('大厅出现「加入」按钮', joinBtn >= 1, 'buttons=' + joinBtn);
  const waitText = await A.ev('document.getElementById("user-list").textContent');
  check('状态显示「等待中，x/x人」', waitText.indexOf('等待中，') >= 0, waitText.slice(0, 40));
  await A.ev('document.querySelector("#user-list .u-join").click()');
  await sleep(900);
  check('一键加入成功', (await A.ev('AR.App.screen')) === 'room' && (await A.ev('AR.App.room.players.length')) === 3,
    'players=' + (await A.ev('AR.App.room.players.length')));
  await A.shot('52-room-join-from-lobby');

  await B.ev('document.getElementById("btn-start").click()');
  await sleep(2500);
  check('A 进入游戏画面', (await A.ev('AR.App.screen')) === 'play');

  console.log('\n[4] 对局聊天（回车开 → 回车发）');
  await A.ev('document.body.dispatchEvent(new KeyboardEvent("keydown",{code:"Enter",bubbles:true}))');
  await sleep(300);
  const chatShown = await A.ev('!document.getElementById("chat-panel").classList.contains("hidden")');
  check('回车能打开对局聊天', chatShown === true);
  const imeChat = JSON.parse(await A.ev(`(function(){
    var el = document.getElementById('chat-text');
    el.value = 'pinyin';
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'pinyin' }));
    var ev = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true
    });
    var notCanceled = el.dispatchEvent(ev);
    return JSON.stringify({
      value: el.value,
      open: !document.getElementById('chat-panel').classList.contains('hidden'),
      canceled: !notCanceled
    });
  })()`));
  check('聊天框 IME 组合中的回车不发送', imeChat.value === 'pinyin' && imeChat.open === true && imeChat.canceled === false,
    JSON.stringify(imeChat));
  await A.ev('document.getElementById("chat-text").dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "拼音" })); document.getElementById("chat-text").value = ""');

  await A.ev('document.getElementById("chat-text").value = "这局我赢了"');
  await A.ev('document.getElementById("chat-text").dispatchEvent(new KeyboardEvent("keydown",{code:"Enter",bubbles:true}))');
  await sleep(500);
  const hiddenAfter = await A.ev('document.getElementById("chat-panel").classList.contains("hidden")');
  check('回车发送后收起', hiddenAfter === true);
  const bChat = await B.ev('document.getElementById("chat-log").textContent');
  check('同房间的 B 收到对局消息', bChat.indexOf('这局我赢了') >= 0, bChat.slice(-40));
  await B.shot('54-room-chat');

  console.log('\n[5] 退出游戏（二次确认 → 回大厅）');
  await A.ev('document.getElementById("hud-back").click()');
  await sleep(300);
  check('弹出退出确认', (await A.ev('!document.getElementById("confirm-overlay").classList.contains("hidden")')) === true);
  await A.shot('55-exit-confirm');
  await A.ev('document.getElementById("confirm-cancel").click()');
  await sleep(200);
  check('取消后仍在对局', (await A.ev('AR.App.screen')) === 'play');

  await A.ev('document.getElementById("hud-back").click()');
  await sleep(200);
  await A.ev('document.getElementById("confirm-ok").click()');
  await sleep(900);
  check('确认后回到大厅', (await A.ev('AR.App.screen')) === 'lobby');
  check('已不在房间里', (await A.ev('AR.App.room')) === null);
  await A.shot('56-back-to-lobby');

  const playText = await A.ev('document.getElementById("user-list").textContent');
  check('状态显示「游戏中」', playText.indexOf('（游戏中）') >= 0, playText.slice(0, 40));

  const bRoom = await B.ev('AR.App.room ? AR.App.room.code : null');
  const bScreen = await B.ev('AR.App.screen');
  check('房间还留给 B 继续', !!bRoom && bScreen === 'play', 'B room=' + bRoom + ' screen=' + bScreen);

  console.log('\n错误检查');
  [A, B].forEach((x) => console.log('  ' + x.tag + ':', x.errors.length ? x.errors.slice(0, 3) : '无'));
  check('无控制台错误', A.errors.length === 0 && B.errors.length === 0);

  A.kill(); B.kill();
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
