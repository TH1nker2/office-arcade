#!/usr/bin/env node
/* v5：你画我猜端到端（选词 → 作画 → 同步笔迹 → 猜中计分） */
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
const PORT = 8960 + Math.floor(Math.random() * 30);
const DATA = path.join(os.tmpdir(), 'arcade-v5-' + PORT);
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
      '--user-data-dir=' + path.join(os.tmpdir(), 'arcade-v5-' + this.port + '-' + Date.now()),
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
  await sleep(1300);
}

async function darkPixels(page) {
  return page.ev(`(function(){
    var d = AR.View.data;
    if (!d || !d.ctx || !d.canvas) return -1;
    var img = d.ctx.getImageData(0, 0, d.canvas.width, d.canvas.height).data;
    var n = 0;
    for (var i = 0; i < img.length; i += 4) {
      if (img[i] < 200 || img[i + 1] < 200 || img[i + 2] < 200) n++;
    }
    return n;
  })()`);
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
  const wordsLine = (slog.match(/画猜词库：[^\n]*/) || [''])[0];
  check('服务器加载了词库', /画猜词库： 简单 \d+ \/ 中等 \d+ \/ 困难 \d+/.test(wordsLine), wordsLine || '无输出');

  const A = new Browser('A', 9970);
  const B = new Browser('B', 9971);
  await A.launch();
  await B.launch();
  const url = 'http://127.0.0.1:' + PORT + '/';
  await A.send('Page.navigate', { url });
  await B.send('Page.navigate', { url });
  await sleep(1300);

  await register(A, 'drawa', '画手');
  await register(B, 'drawb', '猜手');
  check('两人进入大厅', (await A.ev('AR.App.screen')) === 'lobby' && (await B.ev('AR.App.screen')) === 'lobby');

  console.log('\n[1] 建房开局（2 人）');
  await A.ev('document.querySelector(\'[data-game="draw"]\').click()');
  await sleep(500);
  await A.ev('document.getElementById("btn-create-room").click()');
  await sleep(900);
  const code = await A.ev('AR.App.room && AR.App.room.code');
  check('创建画猜房间', !!code, 'code=' + code);
  await B.ev('fetch("/api/rooms?game=draw").then(r=>r.json()).then(d=>Net.send({t:"joinRoom",code:d.rooms[0].code}))');
  await sleep(900);
  check('第二人进房', (await A.ev('AR.App.room.players.length')) === 2);

  await A.ev('document.getElementById("btn-start").click()');
  await sleep(1500);
  check('A 进入游戏画面', (await A.ev('AR.App.screen')) === 'play');
  check('B 进入游戏画面', (await B.ev('AR.App.screen')) === 'play');

  console.log('\n[2] 选词');
  const drawerIsA = (await A.ev('AR.App.snap && AR.App.snap.dr === AR.App.me.id')) === true;
  const drawer = drawerIsA ? A : B;
  const guesser = drawerIsA ? B : A;
  const drawerName = drawerIsA ? 'A' : 'B';
  await sleep(600);
  const choiceCount = await drawer.ev('document.querySelectorAll("#choose-list button").length');
  check('画手收到 3 个候选词', choiceCount === 3, 'buttons=' + choiceCount);
  const choices = await drawer.ev('Array.from(document.querySelectorAll("#choose-list button")).map(function(b){return b.textContent;})');
  await drawer.shot('60-draw-choose');

  /* 选词期间：画手看到倒计时，其他人看到等待蒙版 */
  const tip = await drawer.ev('document.getElementById("choose-tip").textContent');
  check('画手看到选词倒计时', /\d+ 秒后自动随机选择/.test(tip), tip);
  const waitShown = await guesser.ev('!document.getElementById("draw-wait").classList.contains("hidden")');
  check('其他人看到等待蒙版', waitShown === true);
  const waitTitle = await guesser.ev('document.getElementById("wait-title").textContent');
  check('蒙版提示了作者名字', waitTitle.indexOf('正在选词') >= 0, waitTitle);
  await guesser.shot('63-draw-wait');
  await drawer.ev('document.querySelector("#choose-list button").click()');
  await sleep(800);
  const word = await drawer.ev('AR.App.word');
  check('点选后拿到词语', !!word && word === choices[0], 'word=' + word + ' / 候选 ' + choices.join(','));
  check('猜手看不到词', (await guesser.ev('AR.App.word')) === null || (await guesser.ev('AR.App.word')) === undefined);

  console.log('\n[3] 作画与笔迹同步');
  const box = await drawer.ev('JSON.stringify({bx: AR.View.data.bx, by: AR.View.data.by, bw: AR.View.data.bw, bh: AR.View.data.bh})');
  const b = JSON.parse(box);
  const before = await darkPixels(guesser);
  const x0 = b.bx + b.bw * 0.3;
  const y0 = b.by + b.bh * 0.4;
  await drawer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    await drawer.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x0 + i * 12, y: y0 + Math.sin(i / 2) * 40, button: 'left'
    });
    await sleep(30);
  }
  await drawer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 144, y: y0, button: 'left', clickCount: 1 });
  await sleep(800);
  const after = await darkPixels(guesser);
  check('画手的笔迹传到了猜手屏幕', after > before + 200, before + ' -> ' + after + ' 个深色像素');
  await guesser.shot('61-draw-board');

  console.log('\n[4] 猜中计分');
  await guesser.ev('document.getElementById("chat-text").value = ' + JSON.stringify(word));
  await guesser.ev('document.getElementById("chat-text").dispatchEvent(new KeyboardEvent("keydown",{code:"Enter",bubbles:true}))');
  await sleep(900);
  const meId = await guesser.ev('AR.App.me.id');
  const score = await guesser.ev('AR.App.snap.sc[' + JSON.stringify(meId) + ']');
  check('猜中得分', typeof score === 'number' && score > 0, 'score=' + score);
  const chatText = await guesser.ev('document.getElementById("chat-log").textContent');
  check('聊天区显示 *** 和回答正确', chatText.indexOf('***') >= 0 && chatText.indexOf('回答正确') >= 0,
    chatText.slice(-40));
  check('聊天区没有泄露答案', chatText.indexOf(word) < 0, 'word=' + word);
  await guesser.shot('64-draw-masked');

  await sleep(3500);
  const phase = await guesser.ev('AR.App.snap.ph');
  check('进入公布答案阶段', phase === 'reveal' || phase === 'choose', 'phase=' + phase);
  await guesser.shot('62-draw-reveal');

  console.log('\n错误检查');
  [A, B].forEach((x) => console.log('  ' + x.tag + ':', x.errors.length ? x.errors.slice(0, 3) : '无'));
  check('无控制台错误', A.errors.length === 0 && B.errors.length === 0);
  console.log('  画手是 ' + drawerName + '，词语：' + word);

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
