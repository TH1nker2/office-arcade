#!/usr/bin/env node
/* 内网离线审计：打开全部页面，检查有没有任何外网请求
 *
 * 用法：node tools/offline-test.js
 * 说明：程序最终部署在没有互联网的内网，任何 CDN / 外链字体 / 远程接口都会导致加载失败，
 *       所以每次改动后跑一遍这个脚本。
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EDGE = [
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find((p) => fs.existsSync(p));

const PORT = 9090 + Math.floor(Math.random() * 20);
const DATA = path.join(os.tmpdir(), 'offline-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
});

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

(async () => {
  if (!EDGE) { console.log('找不到 Edge/Chrome，跳过'); process.exit(0); }
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(DATA, { recursive: true });

  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { ARCADE_DATA: DATA })
  });
  await sleep(1500);

  const DP = 10400 + Math.floor(Math.random() * 80);
  const br = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=' + DP,
    '--user-data-dir=' + path.join(os.tmpdir(), 'offline-prof' + Date.now()),
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 60; i++) {
    try { list = await getJson('http://127.0.0.1:' + DP + '/json/list'); if (list && list.length) break; } catch (e) { /* wait */ }
    await sleep(250);
  }
  const page = list.find((x) => x.type === 'page') || list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const cbs = new Map();
  const requests = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && cbs.has(m.id)) {
      const c = cbs.get(m.id); cbs.delete(m.id);
      m.error ? c.rej(new Error(m.error.message)) : c.res(m.result);
      return;
    }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  };
  const send = (method, params) => new Promise((res, rej) => {
    const i = id++; cbs.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });

  for (const p of ['/', '/admin.html']) {
    await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + p });
    await sleep(1800);
  }

  /* 注册进入大厅，再开一局，覆盖到游戏内的资源加载 */
  await evalJs(`(function(){
    var t = document.querySelector('.tab[data-auth="register"]');
    if (!t) return;
    t.click();
    document.getElementById('auth-user').value = 'offlinechk';
    document.getElementById('auth-nick').value = '离线检查';
    document.getElementById('auth-pass').value = '123456';
    document.getElementById('auth-submit').click();
  })()`);
  await sleep(2000);
  await evalJs(`(function(){
    var g = document.querySelector('[data-game="snake"]');
    if (g) g.click();
  })()`);
  await sleep(600);
  await evalJs(`(function(){
    var b = document.getElementById('btn-create-room');
    if (b) b.click();
  })()`);
  await sleep(600);
  await evalJs(`(function(){
    var b = document.getElementById('btn-add-bot');
    if (b) b.click();
    var s = document.getElementById('btn-start');
    if (s) setTimeout(function(){ s.click(); }, 250);
  })()`);
  await sleep(2500);

  const external = [...new Set(requests)].filter((u) =>
    !/^(http:\/\/127\.0\.0\.1:|ws:\/\/127\.0\.0\.1:|data:|blob:|about:)/.test(u));

  ok('页面加载完成', requests.length > 5, requests.length + ' 个请求');
  ok('没有任何外网请求', external.length === 0, external.length ? external.join(', ') : '全部本机');
  ok('请求的都是本机资源', [...new Set(requests)].every((u) => /^(http:\/\/127\.0\.0\.1:|ws:\/\/127\.0\.0\.1:|data:|blob:|about:)/.test(u)));

  ws.close(); br.kill(); srv.kill();
  await sleep(300);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
