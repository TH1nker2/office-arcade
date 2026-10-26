#!/usr/bin/env node
/* 人机 + 赛车 + 五子棋：浏览器端到端 */
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
const PORT = 8700 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-bots-' + PORT);
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
      '--user-data-dir=' + path.join(os.tmpdir(), 'arcade-bots-' + this.port + '-' + Date.now()),
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
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
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

  const B = new Browser('A', 9960);
  await B.launch();
  await B.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await sleep(1400);

  /* 注册 */
  await B.ev('document.querySelector(\'.tab[data-auth="register"]\').click()');
  await sleep(200);
  await B.ev('document.getElementById("auth-user").value = "solo"');
  await B.ev('document.getElementById("auth-nick").value = "独狼"');
  await B.ev('document.getElementById("auth-pass").value = "123456"');
  await B.ev('document.getElementById("auth-submit").click()');
  await sleep(1600);
  check('注册后进入大厅', (await B.ev('AR.App.screen')) === 'lobby');

  const cards = await B.ev('document.querySelectorAll("#lobby-games .game-card").length');
  check('大厅有 9 个游戏', cards === 9, 'cards=' + cards);
  await B.shot('41-lobby-8games');

  console.log('\n[1] 蛇球 + 3 个人机');
  await B.ev('document.querySelector(\'[data-game="snake"]\').click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(900);

  for (let i = 0; i < 3; i++) {
    await B.ev('document.getElementById("btn-add-bot").click()');
    await sleep(350);
  }
  const room = JSON.parse(await B.ev('JSON.stringify({n: AR.App.room.players.length, bots: AR.App.room.players.filter(function(p){return !!p.bot;}).length})'));
  check('房间里有 1 人 + 3 人机', room.n === 4 && room.bots === 3, 'players=' + room.n + ' bots=' + room.bots);
  await B.shot('42-room-bots');

  await B.ev('document.getElementById("btn-start").click()');
  await sleep(3500);
  const playing = JSON.parse(await B.ev('JSON.stringify({screen: AR.App.screen, snakes: AR.App.snap && AR.App.snap.s ? AR.App.snap.s.length : 0})'));
  check('人机局正常开局', playing.screen === 'play' && playing.snakes === 4, 'snakes=' + playing.snakes);
  await B.shot('43-snake-bots');

  await sleep(2000);
  const moved = await B.ev('AR.App.snap.s.filter(function(x){return x.s > 0;}).length');
  check('人机在动（吃到光点）', moved >= 0, '有分的人机=' + moved);

  /* 回房间 */
  await B.ev('AR.App.screen === "play" && document.getElementById("hud-back").click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-leave-room").click()');
  await sleep(800);
  check('退出后直接回到大厅', (await B.ev('AR.App.screen')) === 'lobby');

  console.log('\n[2] 赛车 + 3 个人机');
  await B.ev('document.getElementById("hub-back").click()');
  await sleep(500);
  await B.ev('document.querySelector(\'[data-game="racing"]\').click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(800);
  for (let i = 0; i < 3; i++) {
    await B.ev('document.getElementById("btn-add-bot").click()');
    await sleep(300);
  }
  await B.ev('document.getElementById("btn-start").click()');
  await sleep(4000);
  const race = JSON.parse(await B.ev('JSON.stringify({screen: AR.App.screen, game: AR.App.game && AR.App.game.id, cars: AR.App.snap && AR.App.snap.c ? AR.App.snap.c.length : 0, meta: !!(AR.App.game && AR.App.game.meta && AR.App.game.meta.points)})'));
  check('赛车开局', race.screen === 'play' && race.game === 'racing', 'game=' + race.game);
  check('4 辆车都在', race.cars === 4, 'cars=' + race.cars);
  check('赛道数据下发', race.meta === true);
  await B.shot('44-racing');

  await sleep(6000);
  const speed = await B.ev('AR.App.snap.c.map(function(c){return c[4];}).join(",")');
  console.log('    车速:', speed);
  check('车在跑', speed.split(',').some((v) => Number(v) > 40), 'speeds=' + speed);
  const hud = await B.ev('document.getElementById("hud-board").textContent');
  check('HUD 显示圈数', hud.indexOf('圈') >= 0, hud.slice(0, 40));
  await B.shot('45-racing-running');

  await B.ev('document.getElementById("hud-back").click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-leave-room").click()');
  await sleep(800);
  check('退出赛车后回到大厅', (await B.ev('AR.App.screen')) === 'lobby');

  console.log('\n[3] 五子棋执棋颜色');
  await B.ev('document.querySelector(\'[data-game="gomoku"]\').click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(900);
  await B.ev('document.getElementById("btn-add-bot").click()');
  await sleep(400);
  await B.ev('document.getElementById("btn-start").click()');
  await sleep(1800);

  const gomoku = JSON.parse(await B.ev(
    'JSON.stringify({' +
    'screen: AR.App.screen, game: AR.App.game && AR.App.game.id, sd: AR.App.snap && AR.App.snap.sd,' +
    'rows: document.querySelectorAll("#hud-board .hud-row").length,' +
    'black: document.querySelectorAll("#hud-board .sc.side-black").length,' +
    'white: document.querySelectorAll("#hud-board .sc.side-white").length,' +
    'text: document.getElementById("hud-board").textContent' +
    '})'
  ));
  check('五子棋人机局开局', gomoku.screen === 'play' && gomoku.game === 'gomoku', gomoku.game);
  check('快照带黑白方信息', !!gomoku.sd && Object.keys(gomoku.sd).length === 2, JSON.stringify(gomoku.sd));
  check('右侧显示双方执棋颜色', gomoku.rows === 2 && gomoku.black === 1 && gomoku.white === 1,
    'rows=' + gomoku.rows + ' black=' + gomoku.black + ' white=' + gomoku.white);
  check('执黑/执白文案正确', gomoku.text.indexOf('执黑') >= 0 && gomoku.text.indexOf('执白') >= 0, gomoku.text);
  check('右侧不再显示手数', gomoku.text.indexOf('手') < 0, gomoku.text);
  await B.shot('46-gomoku-sides');

  await B.ev('document.getElementById("hud-back").click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-leave-room").click()');
  await sleep(600);

  console.log('\n[4] 控制台');
  console.log('  错误:', B.errors.length ? B.errors.slice(0, 3) : '无');
  check('无控制台错误', B.errors.length === 0);

  B.kill();
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
