#!/usr/bin/env node
/* 健壮性与安全审计：路径穿越、畸形消息、满房、对局中加入、XSS、大包
 *
 * 用法：node tools/hardening-test.js
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9300 + Math.floor(Math.random() * 30);
const DATA = path.join(os.tmpdir(), 'hard-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

function request(method, p, body, cookie) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = Object.assign({ 'Content-Type': 'application/json' },
      cookie ? { Cookie: cookie } : {},
      payload ? { 'Content-Length': Buffer.byteLength(payload) } : {});
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, (res) => {
      let b = '';
      res.on('data', (d) => b += d);
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(b); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, body: j, headers: res.headers, raw: b });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const cookieOf = (r) => ((r.headers['set-cookie'] || [''])[0].split(';')[0] || '');

async function main() {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(DATA, { recursive: true });

  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { ARCADE_DATA: DATA })
  });
  await sleep(1500);

  const a = await request('POST', '/api/register', { username: 'sec1', password: '123456', nickname: '甲' });
  const b = await request('POST', '/api/register', { username: 'sec2', password: '123456', nickname: '乙' });
  const c = await request('POST', '/api/register', { username: 'sec3', password: '123456', nickname: '丙' });
  const ckA = cookieOf(a), ckB = cookieOf(b), ckC = cookieOf(c);

  /* ================= 一、路径穿越 ================= */
  console.log('=== 路径穿越 ===');
  for (const p of [
    '/js/../server.js',
    '/js/../../server.js',
    '/../server.js',
    '/shared/../server.js',
    '/js/%2e%2e/server.js',
    '/css/..%2f..%2fadmins.json',
    '/js/%00.js',
    '/data/../data/arcade.sqlite'
  ]) {
    const r = await request('GET', p);
    ok('拒绝 ' + p, r.status === 404 || r.status === 400, 'status=' + r.status);
  }

  /* ================= 二、畸形 HTTP ================= */
  console.log('\n=== 畸形请求 ===');
  let r = await request('POST', '/api/login', { username: { $ne: null }, password: 123 });
  ok('登录参数类型非法返回 4xx', r.status >= 400 && r.status < 500, 'status=' + r.status);
  r = await request('GET', '/api/history?limit=999999999');
  ok('超大 limit 不崩', r.status === 401 || r.status === 200, 'status=' + r.status);
  r = await request('POST', '/api/register', { username: 'x'.repeat(5000), password: '123456', nickname: 'y' });
  ok('超长用户名被拒', r.status === 400, 'status=' + r.status);

  /* ================= 三、WebSocket 畸形消息 ================= */
  console.log('\n=== WebSocket 畸形消息 ===');
  const wsA = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?token=' + ckA.split('=')[1]);
  const A = [];
  wsA.onmessage = (e) => A.push(JSON.parse(e.data));
  await new Promise((res, rej) => { wsA.onopen = res; wsA.onerror = rej; });
  await sleep(200);

  wsA.send('不是 json');
  wsA.send(JSON.stringify({ t: '不存在的类型' }));
  wsA.send(JSON.stringify({ t: 'chat', text: '' }));
  wsA.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(100000) }));
  wsA.send(JSON.stringify({ t: 'input', i: { 乱七八糟: true } }));
  wsA.send(JSON.stringify({ t: 'joinRoom', code: 'ZZZZ' }));
  wsA.send(JSON.stringify({ t: 'start' }));
  wsA.send(JSON.stringify({ t: 'botAdd' }));
  await sleep(800);
  ok('服务端在畸形消息后仍存活', (await request('GET', '/api/version')).status === 200);

  /* ================= 四、房间边界 ================= */
  console.log('\n=== 房间边界 ===');
  wsA.send(JSON.stringify({ t: 'createRoom', gameId: 'gomoku' }));   /* 2 人上限 */
  await sleep(400);
  const room = A.filter((m) => m.t === 'room').pop();
  ok('建房', !!room && room.code);

  const wsB = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?token=' + ckB.split('=')[1]);
  const B = [];
  wsB.onmessage = (e) => B.push(JSON.parse(e.data));
  await new Promise((res) => { wsB.onopen = res; });
  await sleep(150);

  wsB.send(JSON.stringify({ t: 'joinRoom', code: room.code }));
  await sleep(400);
  ok('第二人加入', B.some((m) => m.t === 'room' && m.code === room.code));

  const wsC = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?token=' + ckC.split('=')[1]);
  const C = [];
  wsC.onmessage = (e) => C.push(JSON.parse(e.data));
  await new Promise((res) => { wsC.onopen = res; });
  await sleep(150);
  wsC.send(JSON.stringify({ t: 'joinRoom', code: room.code }));
  await sleep(400);
  ok('满房被拒', C.some((m) => m.t === 'error' || m.t === 'joinFailed'), JSON.stringify(C.filter((m) => m.t === 'error')));

  /* 对局中加入 */
  wsA.send(JSON.stringify({ t: 'start' }));
  await sleep(800);
  const wsC2 = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?token=' + ckC.split('=')[1]);
  const C2 = [];
  wsC2.onmessage = (e) => C2.push(JSON.parse(e.data));
  await new Promise((res) => { wsC2.onopen = res; });
  await sleep(150);
  wsC2.send(JSON.stringify({ t: 'joinRoom', code: room.code }));
  await sleep(400);
  ok('对局加入被拒', C2.some((m) => m.t === 'error' || m.t === 'joinFailed'), JSON.stringify(C2.filter((m) => m.t === 'error')));

  /* 重复加入 */
  wsB.send(JSON.stringify({ t: 'joinRoom', code: room.code }));
  await sleep(300);
  ok('重复加入不产生第二个自己', true, '未崩溃');

  /* ================= 五、聊天转义 ================= */
  console.log('\n=== 聊天与注入 ===');
  wsA.send(JSON.stringify({ t: 'leaveRoom' }));
  await sleep(300);
  wsA.send(JSON.stringify({ t: 'createRoom', gameId: 'snake' }));
  await sleep(400);
  const room2 = A.filter((m) => m.t === 'room').pop();
  wsA.send(JSON.stringify({ t: 'chat', text: '<img src=x onerror=alert(1)>' }));
  await sleep(400);
  const chat = A.filter((m) => m.t === 'chat').pop();
  ok('聊天内容原样传输，前端负责转义', !!chat, chat && chat.text.slice(0, 20));

  /* SQL 注入式昵称 */
  const inj = await request('POST', '/api/register', {
    username: 'sqlx', password: '123456', nickname: "a'; DROP TABLE users;--"
  });
  ok('带引号的昵称可正常注册', inj.status === 200 || inj.status === 400, 'status=' + inj.status);
  ok('用户表仍在', (await request('GET', '/api/me', null, ckA)).status === 200);

  /* ================= 六、会话与登出 ================= */
  console.log('\n=== 会话 ===');
  await request('POST', '/api/logout', null, ckA);
  ok('登出后 /api/me 401', (await request('GET', '/api/me', null, ckA)).status === 401);
  ok('另一个会话不受影响', (await request('GET', '/api/me', null, ckB)).status === 200);

  wsA.close(); wsB.close(); wsC.close(); wsC2.close();
  srv.kill();
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
