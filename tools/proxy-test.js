#!/usr/bin/env node
/* 验证「反向代理 + WebSocket 升级」部署形态：
 * 启动应用 -> 启动一个最小反代 -> 全部请求都经过代理，检查 Cookie / API / WS 是否正常
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const APP_PORT = 8123;
const PROXY_PORT = 8124;
const DATA = path.join(os.tmpdir(), 'arcade-proxy-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

function proxyRequest(method, p, body, cookie) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const up = http.request({
      host: '127.0.0.1', port: APP_PORT, path: p, method, headers
    }, (ur) => {
      let b = '';
      ur.on('data', (d) => b += d);
      ur.on('end', () => {
        let json = {};
        try { json = JSON.parse(b); } catch (e) { /* ignore */ }
        resolve({ status: ur.statusCode, headers: ur.headers, body: json });
      });
    });
    up.on('error', reject);
    if (payload) up.write(payload);
    up.end();
  });
}

function startProxy() {
  const server = http.createServer((req, res) => {
    const up = http.request({
      host: '127.0.0.1', port: APP_PORT, path: req.url, method: req.method, headers: req.headers
    }, (ur) => {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    });
    up.on('error', () => { try { res.writeHead(502); res.end('bad gateway'); } catch (e) { /* ignore */ } });
    req.pipe(up);
  });

  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(APP_PORT, '127.0.0.1', () => {
      let raw = req.method + ' ' + req.url + ' HTTP/1.1\r\n';
      Object.keys(req.headers).forEach((k) => { raw += k + ': ' + req.headers[k] + '\r\n'; });
      raw += '\r\n';
      up.write(raw);
      if (head && head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => { try { socket.destroy(); } catch (e) { /* ignore */ } });
    socket.on('error', () => { try { up.destroy(); } catch (e) { /* ignore */ } });
  });

  return new Promise((resolve) => server.listen(PROXY_PORT, '127.0.0.1', () => resolve(server)));
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const app = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(APP_PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { ARCADE_DATA: DATA })
  });
  let log = '';
  app.stdout.on('data', (d) => log += d.toString());
  app.stderr.on('data', (d) => log += d.toString());
  await sleep(1200);
  if (log.indexOf('localhost:' + APP_PORT) < 0) {
    console.error('应用未启动\n' + log);
    process.exit(1);
  }

  const proxy = await startProxy();

  console.log('=== 经反向代理访问 ===');
  const reg = await proxyRequest('POST', '/api/register', {
    username: 'proxyuser', password: '123456', nickname: '代理测试'
  });
  ok('注册经代理成功', reg.status === 200 && reg.body.user.nickname === '代理测试');
  const cookie = (reg.headers['set-cookie'] || [''])[0].split(';')[0];
  ok('Cookie 透传', cookie.startsWith('sid='), cookie.slice(0, 10));

  const me = await proxyRequest('GET', '/api/me', null, cookie);
  ok('带 Cookie 的接口经代理', me.status === 200 && me.body.user.username === 'proxyuser');

  /* WebSocket 经代理（带 Cookie 升级） */
  const ws = new WebSocket('ws://127.0.0.1:' + PROXY_PORT + '/ws?token=' + cookie.split('=')[1]);
  const welcome = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS 经代理超时')), 6000);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'me') { clearTimeout(timer); resolve(m); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WS 经代理失败')); };
  });
  ok('WebSocket 升级经代理', welcome.user.username === 'proxyuser');

  const roomPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('房间消息超时')), 6000);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'room') { clearTimeout(timer); resolve(m); }
    };
  });
  ws.send(JSON.stringify({ t: 'createRoom', gameId: 'tank' }));
  const room = await roomPromise;
  ok('经代理建房', !!room.code && room.gameId === 'tank', 'code=' + room.code);

  /* 静态资源也经代理 */
  const page = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + PROXY_PORT + '/', (r) => {
      let b = '';
      r.on('data', (d) => b += d);
      r.on('end', () => resolve({ status: r.statusCode, body: b }));
    }).on('error', reject);
  });
  ok('首页经代理可访问', page.status === 200 && page.body.indexOf('摸鱼游戏厅') >= 0);

  ws.close();
  proxy.close();
  app.kill();
  await sleep(300);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.message || e);
  process.exit(1);
});
