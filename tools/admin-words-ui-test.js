#!/usr/bin/env node
/* 管理后台词库查看：真实浏览器端到端 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'shots');
const EDGE = [
  process.env.EDGE_PATH,
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean).find((p) => fs.existsSync(p));
const PORT = 9240 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-admin-words-' + PORT);
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
      '--user-data-dir=' + path.join(os.tmpdir(), 'arcade-admin-words-' + this.port + '-' + Date.now()),
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
    if (!targets || !targets.length) throw new Error(this.tag + ' 浏览器启动失败');
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
    console.log('    shot: ' + name + '.png');
  }
  kill() { try { this.child.kill(); } catch (e) { /* ignore */ } }
}

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

async function wordInfo(B) {
  return JSON.parse(await B.ev('JSON.stringify({' +
    'hint:document.getElementById("word-hint").textContent,' +
    'rows:document.querySelectorAll("#word-table .word-row:not(.head)").length,' +
    'firstHints:document.querySelectorAll("#word-table .word-row:not(.head) .word-hints span").length,' +
    'counts:Array.prototype.map.call(document.querySelectorAll("#word-levels .seg-btn .seg-num"),function(x){return x.textContent;})' +
    '})'));
}

async function main() {
  if (!EDGE) { console.log('找不到 Edge/Chrome，跳过'); process.exit(0); }
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(DATA, { recursive: true });

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { ARCADE_DATA: DATA })
  });
  let log = '';
  server.stdout.on('data', (d) => log += d.toString());
  server.stderr.on('data', (d) => log += d.toString());
  await sleep(1400);
  if (log.indexOf('localhost:' + PORT) < 0) {
    console.error('服务器未启动\n' + log);
    process.exit(1);
  }

  const B = new Browser('admin', 9985);
  await B.launch();
  await B.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/admin.html' });
  await sleep(1200);

  console.log('[1] 登录');
  await B.ev('document.getElementById("admin-user").value = "admin"');
  await B.ev('document.getElementById("admin-pass").value = "admin888"');
  await B.ev('document.getElementById("login-btn").click()');
  await sleep(1100);
  check('登录后进入管理后台', await B.ev('document.getElementById("admin-panel").classList.contains("active")'));

  console.log('\n[2] 打开词库');
  await B.ev('document.querySelector(\'#admin-tabs [data-view="words"]\').click()');
  await sleep(900);
  let info = await wordInfo(B);
  check('三个难度各 500', info.counts.join(',') === '500,500,500', info.counts.join(','));
  check('词库提示显示 500', info.hint.indexOf('500') >= 0, info.hint);
  check('简单档渲染 500 行', info.rows === 500, 'rows=' + info.rows);
  check('每条展示 4 条提示', info.firstHints === 2000, 'hint spans=' + info.firstHints);
  await B.shot('82-admin-words');

  console.log('\n[3] 搜索与切换');
  await B.ev('var i=document.getElementById("word-search"); i.value="苹果"; i.dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(300);
  info = await wordInfo(B);
  check('简单档搜索有结果', info.rows >= 1 && info.hint.indexOf('匹配') >= 0, info.hint);
  const easyText = await B.ev('document.getElementById("word-table").textContent');
  check('搜索结果包含苹果', easyText.indexOf('苹果') >= 0, easyText.slice(0, 40));

  await B.ev('var i=document.getElementById("word-search"); i.value=""; i.dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(180);
  await B.ev('document.querySelector(\'#word-levels [data-level="hard"]\').click()');
  await sleep(900);
  info = await wordInfo(B);
  check('切到困难档', info.hint.indexOf('困难') >= 0 && info.hint.indexOf('500') >= 0, info.hint);
  check('困难档渲染 500 行', info.rows === 500, 'rows=' + info.rows);

  await B.ev('var i=document.getElementById("word-search"); i.value="画蛇添足"; i.dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(300);
  info = await wordInfo(B);
  check('困难档搜索命中一个词', info.rows === 1 && info.hint.indexOf('匹配 1 / 500') >= 0, info.hint);
  const hardText = await B.ev('document.getElementById("word-table").textContent');
  check('搜索结果是画蛇添足', hardText.indexOf('画蛇添足') >= 0, hardText.slice(0, 40));

  console.log('\n[4] 控制台');
  console.log('  错误:', B.errors.length ? B.errors.slice(0, 3) : '无');
  check('无控制台错误', B.errors.length === 0);

  B.kill();
  server.kill();
  await sleep(500);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
