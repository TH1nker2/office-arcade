#!/usr/bin/env node
/* v9：谁是卧底端到端（四浏览器）
 * 房间轮数 / 身份私密 / 轮流描述 / 关闭自由聊天 / 投票公布 / 个人名次
 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9740 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-undercover-' + PORT);
const { Browser, sleep } = require('./lib/browser');
const { startServer } = require('./lib/fixture');

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

async function register(B, user, nick) {
  await B.ev('document.querySelector(\'.tab[data-auth="register"]\').click()');
  await sleep(160);
  await B.ev('document.getElementById("auth-user").value = ' + JSON.stringify(user));
  await B.ev('document.getElementById("auth-nick").value = ' + JSON.stringify(nick));
  await B.ev('document.getElementById("auth-pass").value = "123456"');
  await B.ev('document.getElementById("auth-submit").click()');
  await sleep(1350);
}

async function stateOf(page) {
  return JSON.parse(await page.ev('JSON.stringify({screen:AR.App.screen, snap:AR.App.snap, room:AR.App.room})'));
}

async function waitPhase(page, phase, ms) {
  const end = Date.now() + (ms || 4000);
  while (Date.now() < end) {
    const s = await stateOf(page);
    if (s.snap && s.snap.ph === phase) return s;
    await sleep(140);
  }
  return null;
}

async function sendDescribe(page, text) {
  await page.ev('Net.send({t:"input",i:{act:"describe",text:' + JSON.stringify(text) + '}})');
  await sleep(280);
}

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1500 });
  const pages = [
    new Browser('A', 9980), new Browser('B', 9981),
    new Browser('C', 9982), new Browser('D', 9983)
  ];
  for (const p of pages) await p.launch();
  const url = 'http://127.0.0.1:' + PORT + '/';
  for (const p of pages) await p.send('Page.navigate', { url });
  await sleep(1500);
  await register(pages[0], 'uc_a', '甲');
  await register(pages[1], 'uc_b', '乙');
  await register(pages[2], 'uc_c', '丙');
  await register(pages[3], 'uc_d', '丁');
  check('四个账号进入大厅', (await Promise.all(pages.map((p) => p.ev('AR.App.screen')))).every((x) => x === 'lobby'));

  const A = pages[0];
  await A.ev('document.querySelector(\'[data-game="undercover"]\').click()');
  await sleep(400);
  await A.ev('document.getElementById("btn-create-room").click()');
  await sleep(800);
  for (let i = 1; i < pages.length; i++) {
    await pages[i].ev('fetch("/api/rooms?game=undercover").then(function(r){return r.json()}).then(function(d){Net.send({t:"joinRoom",code:d.rooms[0].code})})');
    await sleep(450);
  }
  const room = await stateOf(A);
  check('四人进入谁是卧底房间', room.room && room.room.players.length === 4,
    room.room ? room.room.players.length + ' 人' : 'no room');
  check('游戏最低人数为 4、最高 12', (await A.ev('AR.getInfo("undercover").min')) === 4 &&
    (await A.ev('AR.getInfo("undercover").max')) === 12);
  check('房间不再提供轮数选择', (await A.ev('document.getElementById("rounds-box")')) === null);
  check('房间隐藏人机按钮', (await A.ev('document.getElementById("bot-box").classList.contains("hidden")')) === true);
  await A.shot('89-undercover-room');

  await A.ev('document.getElementById("btn-start").click()');
  await sleep(900);
  const screens = await Promise.all(pages.map((p) => p.ev('AR.App.screen')));
  check('四人进入对局', screens.every((x) => x === 'play'), screens.join(','));
  check('对局面板显示', (await A.ev('!document.getElementById("undercover-panel").classList.contains("hidden")')) === true);
  check('HUD 玩家榜隐藏', (await A.ev('document.getElementById("hud-board").classList.contains("hidden")')) === true);
  check('普通聊天面板隐藏', (await A.ev('document.getElementById("chat-panel").classList.contains("hidden")')) === true);

  /* 等待私有身份消息 */
  let info = [];
  for (let i = 0; i < 20; i++) {
    info = await Promise.all(pages.map((p) => p.ev('JSON.stringify({id:AR.App.me.id,role:AR.App.uc&&AR.App.uc.role,word:AR.App.uc&&AR.App.uc.word})')));
    info = info.map((x) => JSON.parse(x));
    if (info.every((x) => x.role && x.word)) break;
    await sleep(160);
  }
  const uc = info.filter((x) => x.role === 'undercover');
  const civ = info.filter((x) => x.role === 'civilian');
  check('身份按 1 卧底 / 3 平民发放', uc.length === 1 && civ.length === 3,
    info.map((x) => x.id + ':' + x.role).join(' '));
  check('同阵营拿到同一个词', civ.every((x) => x.word === civ[0].word) && uc[0].word !== civ[0].word,
    civ[0].word + ' / ' + uc[0].word);
  check('公开快照不泄露身份', (await A.ev('AR.App.snap.roles === null')) === true);
  check('4 人局固定 2 轮', (await A.ev('document.getElementById("uc-max-rounds").textContent')) === '2');
  check('身份卡显示自己的词', (await pages[0].ev('document.getElementById("uc-word").textContent')).indexOf(info[0].word) >= 0);
  const panelBox = JSON.parse(await A.ev('JSON.stringify(document.getElementById("undercover-panel").getBoundingClientRect())'));
  check('面板不超出视口', panelBox.left >= 0 && panelBox.right <= 1440 && panelBox.bottom <= 900,
    Math.round(panelBox.left) + ',' + Math.round(panelBox.top) + ' ' + Math.round(panelBox.width) + 'x' + Math.round(panelBox.height));
  await A.shot('90-undercover-role');

  /* 轮流描述：先验证真实输入框，再由当前回合的浏览器提交 */
  const pageById = {};
  info.forEach((x, i) => { pageById[x.id] = pages[i]; });
  await waitPhase(A, 'describe', 7000);
  await sleep(380);
  let firstState = await stateOf(A);
  const firstPage = pageById[firstState.snap && firstState.snap.cur];
  const firstInfo = info[pages.indexOf(firstPage)];
  check('轮到自己时显示描述输入框',
    (await firstPage.ev('!document.getElementById("uc-input-box").classList.contains("hidden")')) === true);
  check('发言时限为 30 秒', (await firstPage.ev('document.getElementById("uc-hint").textContent')).indexOf('30 秒') >= 0);
  const ime = JSON.parse(await firstPage.ev(`(function(){
    var el = document.getElementById('uc-text');
    el.value = 'pinyin';
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'pinyin' }));
    var ev = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true
    });
    var notCanceled = el.dispatchEvent(ev);
    return JSON.stringify({ value: el.value, desc: AR.App.snap.desc.length, notCanceled: notCanceled });
  })()`));
  check('IME 组合中的回车不发送', ime.desc === 0 && ime.value === 'pinyin' && ime.notCanceled === true,
    JSON.stringify(ime));
  await firstPage.ev('document.getElementById("uc-text").dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "拼音" })); document.getElementById("uc-text").value = ""');

  await firstPage.ev('document.getElementById("uc-text").value = ' + JSON.stringify(firstInfo.word) +
    ';document.getElementById("uc-send").click()');
  await sleep(280);
  check('输入自己的词会被拦下', (await firstPage.ev('document.getElementById("toast").textContent')).indexOf('不能直接出现') >= 0);
  await firstPage.ev('document.getElementById("uc-text").value = "界面发送的描述第1条";' +
    'document.getElementById("uc-send").click()');
  await sleep(320);
  const afterFirst = await stateOf(A);
  check('输入框发送描述成功', afterFirst.snap && afterFirst.snap.desc.length === 1,
    afterFirst.snap ? 'desc=' + afterFirst.snap.desc.length : 'no snap');

  let descriptions = 1;
  for (let i = 0; i < 2; i++) {
    const st = await stateOf(A);
    if (!st.snap || st.snap.ph !== 'describe') break;
    const page = pageById[st.snap.cur];
    if (!page) break;
    await sendDescribe(page, '我的描述内容第' + (i + 2) + '条');
    descriptions++;
  }
  check('三次描述写入面板', descriptions === 3, 'sent=' + descriptions);
  check('描述流展示在左侧', (await A.ev('document.getElementById("uc-desc").textContent')).indexOf('界面发送的描述第1条') >= 0);
  await sleep(2500);
  await A.shot('91-undercover-describe');

  let guard = 0;
  while (guard++ < 5) {
    const st = await stateOf(A);
    if (!st.snap || st.snap.ph !== 'describe') break;
    const page = pageById[st.snap.cur];
    if (!page) break;
    await sendDescribe(page, '我的描述内容收尾');
  }
  const voteState = await waitPhase(A, 'vote', 3000);
  await sleep(380);
  check('全员描述完立即投票', !!voteState, voteState ? 'phase=' + voteState.snap.ph : 'timeout');
  check('公开快照不包含票型', (await A.ev('!Object.prototype.hasOwnProperty.call(AR.App.snap,"votes")')) === true);
  check('存活玩家可投票（不含自己）',
    (await A.ev('document.querySelectorAll("#uc-players .uc-player.votable").length')) === 3);
  await A.shot('92-undercover-vote');

  /* 对局中禁止自由聊天：只有自己收到系统提示，其他人收不到原话 */
  await A.ev('Net.send({t:"chat",text:"大家把词说出来"})');
  await sleep(450);
  const chatA = await A.ev('document.getElementById("chat-log").textContent');
  const chatB = await pages[1].ev('document.getElementById("chat-log").textContent');
  check('卧底对局中自由聊天被关闭', chatA.indexOf('关闭了自由聊天') >= 0, chatA.slice(-30));
  check('自由聊天内容不会广播',
    chatA.indexOf('大家把词说出来') < 0 && chatB.indexOf('大家把词说出来') < 0);

  /* 三名平民投卧底，卧底投一名平民 -> 卧底出局；其中一票走真实点击 */
  const ucInfo = info.find((x) => x.role === 'undercover');
  const ucPage = pages[info.indexOf(ucInfo)];
  const civTarget = civ[0].id;
  const firstCivPage = pageById[civ[0].id];
  await firstCivPage.ev('document.querySelector(\'#uc-players .uc-player[data-uc-id="' + ucInfo.id + '"]\').click()');
  await sleep(260);
  check('点击玩家卡片可以投票',
    (await firstCivPage.ev('(function(){var me=AR.App.me.id;return (AR.App.snap.voted||[]).some(function(id){return String(id)===String(me);});})()')) === true);
  for (let ci = 1; ci < civ.length; ci++) {
    await pageById[civ[ci].id].ev('Net.send({t:"input",i:{act:"vote",target:' + JSON.stringify(ucInfo.id) + '}})');
    await sleep(130);
  }
  await ucPage.ev('Net.send({t:"input",i:{act:"vote",target:' + JSON.stringify(civTarget) + '}})');
  await sleep(500);
  const reveal = await stateOf(A);
  check('投票完成进入公布', reveal.snap && reveal.snap.ph === 'reveal', reveal.snap && reveal.snap.ph);
  check('最高票玩家是卧底', reveal.snap && reveal.snap.lastOut &&
    String(reveal.snap.lastOut.id) === String(ucInfo.id) &&
    reveal.snap.lastOut.role === 'undercover', JSON.stringify(reveal.snap && reveal.snap.lastOut));
  check('公布区显示身份', (await A.ev('document.getElementById("uc-last-out").textContent')).indexOf('卧底') >= 0);
  check('被投出玩家在列表中置灰',
    (await A.ev('document.querySelectorAll("#uc-players .uc-player.dead").length')) === 1);
  await A.shot('93-undercover-reveal');

  await sleep(5800);
  const overVisible = await Promise.all(pages.map((p) => p.ev('!document.getElementById("over-overlay").classList.contains("hidden")')));
  check('卧底出局后本局结束', overVisible.every(Boolean), overVisible.join(','));
  const over = JSON.parse(await A.ev(`JSON.stringify({
    title: document.getElementById('over-title').textContent,
    sub: document.getElementById('over-sub').textContent,
    table: document.getElementById('over-table').textContent,
    rows: document.querySelectorAll('#over-table .res-row').length
  })`));
  check('结算说明平民获胜', over.sub.indexOf('平民获胜') >= 0, over.sub);
  check('结算标题按个人胜负显示',
    info[0].role === 'undercover' ? over.title === '平民获胜' : over.title === '你赢了！', over.title);
  check('结算包含四名玩家与身份', over.rows === 5 && over.table.indexOf('卧底') >= 0 &&
    over.table.indexOf('平民') >= 0 && over.table.indexOf('胜') >= 0, over.table.slice(0, 80));
  check('个人名次：平民排在卧底之前', over.table.lastIndexOf('平民') < over.table.lastIndexOf('卧底'),
    over.table.replace(/\s+/g, ' ').slice(0, 120));
  await A.shot('94-undercover-over');

  console.log('\n[控制台]');
  pages.forEach((p) => console.log('  ' + p.tag + ':', p.errors.length ? p.errors.slice(0, 3) : '无'));
  check('无控制台错误', pages.every((p) => p.errors.length === 0));

  pages.forEach((p) => p.kill());
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
