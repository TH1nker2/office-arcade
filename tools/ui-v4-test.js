#!/usr/bin/env node
/* v4：方向盘修复回归 / 退出确认 / 大厅聊天 / 对局聊天 / 一键加入 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots');
const EDGE = process.env.EDGE_PATH ||
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const PORT = 8720 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-v4-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (u) => new Promise((res, rej) => {
  http.get(u, (r) => {
    let b = '';
    r.on('data', (d) => b += d);
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

class Browser {
  constructor(tag, port) { this.tag = tag; this.port = port; this.errors = []; }
  async launch() {
    this.child = spawn(EDGE, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--remote-debugging-port=' + this.port,
      '--user-data-dir=' + path.join(os.tmpdir(), 'arcade-v4-' + this.port + '-' + Date.now()),
      '--window-size=1440,900', 'about:blank'
    ], { stdio: 'ignore' });
    let targets = null;
    for (let i = 0; i < 60; i++) {
      try {
        targets = await getJson('http://127.0.0.1:' + this.port + '/json/list');
        if (targets && targets.length) break;
      } catch (e) { /* retry */ }
      await sleep(250);
    }
    if (!targets || !targets.length) throw new Error('浏览器启动失败');
    const page = targets.find((t) => t.type === 'page') || targets[0];
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    this.id = 1;
    this.cbs = new Map();
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.cbs.has(m.id)) {
        const c = this.cbs.get(m.id);
        this.cbs.delete(m.id);
        m.error ? c.rej(new Error(m.error.message)) : c.res(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push((d.exception && d.exception.description) || d.text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
      }
    };
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  send(method, params) {
    return new Promise((res, rej) => {
      const i = this.id++;
      this.cbs.set(i, { res, rej });
      this.ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
  async shot(name) {
    const s = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(s.data, 'base64'));
    console.log('    shot:', name + '.png');
  }
  kill() { try { this.child.kill(); } catch (e) { /* ignore */ } }
}

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
  fs.mkdirSync(SHOTS, { recursive: true });
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(DATA, { recursive: true });

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { ARCADE_DATA: DATA })
  });
  let slog = '';
  server.stdout.on('data', (d) => slog += d.toString());
  server.stderr.on('data', (d) => slog += d.toString());
  await sleep(1300);
  if (slog.indexOf('localhost:' + PORT) < 0) {
    console.error('服务器未启动\n' + slog);
    process.exit(1);
  }
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

  console.log('\n[3] 建房 → 加人机 → 开局，验证鼠标能控蛇');
  await B.ev('document.querySelector(\'[data-game="snake"]\').click()');
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

  /* 把鼠标放到蛇头右前方，看蛇是否转向 */
  const head = await A.ev(`(function(){
    var me = AR.App.me.id;
    var s = null;
    for (var i = 0; i < AR.App.snap.s.length; i++) if (AR.App.snap.s[i].i === me) s = AR.App.snap.s[i];
    var tf = AR.View.tf;
    return { sx: tf.ox + s.x * tf.s, sy: tf.oy + s.y * tf.s, a: s.a, wx: s.x, wy: s.y };
  })()`);
  await A.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: head.sx + 260, y: head.sy, button: 'none' });
  await sleep(900);
  const after = await A.ev(`(function(){
    var me = AR.App.me.id;
    for (var i = 0; i < AR.App.snap.s.length; i++) if (AR.App.snap.s[i].i === me) return AR.App.snap.s[i].a;
    return 99;
  })()`);
  const target = await A.ev(`(function(){
    var me = AR.App.me.id, s = null;
    for (var i = 0; i < AR.App.snap.s.length; i++) if (AR.App.snap.s[i].i === me) s = AR.App.snap.s[i];
    var tf = AR.View.tf;
    var wx = (${head.sx + 260} - tf.ox) / tf.s, wy = (${head.sy} - tf.oy) / tf.s;
    return Math.atan2(wy - s.y, wx - s.x);
  })()`);
  const diff = Math.abs(Math.atan2(Math.sin(after - target), Math.cos(after - target)));
  check('鼠标能把蛇转向目标方向', diff < 0.45,
    '偏差 ' + diff.toFixed(2) + ' rad（' + head.a.toFixed(2) + ' → ' + after.toFixed(2) + '）');
  await A.shot('53-snake-mouse');

  console.log('\n[4] 对局聊天（回车开 → 回车发）');
  await A.ev('document.body.dispatchEvent(new KeyboardEvent("keydown",{code:"Enter",bubbles:true}))');
  await sleep(300);
  const chatShown = await A.ev('!document.getElementById("chat-panel").classList.contains("hidden")');
  check('回车能打开对局聊天', chatShown === true);
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
  server.kill();
  await sleep(400);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
