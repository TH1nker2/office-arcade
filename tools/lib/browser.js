#!/usr/bin/env node
/* 浏览器端到端测试公共工具：Edge/Chrome CDP 封装 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'shots');
const EDGE = [
  process.env.EDGE_PATH,
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean).find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (u) => new Promise((res, rej) => {
  http.get(u, (r) => {
    let b = '';
    r.on('data', (d) => b += d);
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

class Browser {
  constructor(tag, port) {
    if (!EDGE) throw new Error('找不到 Edge/Chrome，可用 EDGE_PATH 指定');
    this.tag = tag;
    this.port = port;
    this.errors = [];
  }

  async launch() {
    this.child = spawn(EDGE, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      '--remote-debugging-port=' + this.port,
      '--user-data-dir=' + path.join(os.tmpdir(), 'arcade-' + this.tag + '-' + this.port + '-' + Date.now()),
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
    if (r.exceptionDetails) {
      throw new Error(this.tag + ' eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    }
    return r.result.value;
  }

  async shot(name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const s = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(s.data, 'base64'));
    console.log('    shot: ' + name + '.png');
  }

  kill() {
    try { this.child.kill(); } catch (e) { /* ignore */ }
  }
}

module.exports = { Browser, EDGE, SHOTS, sleep, getJson };
