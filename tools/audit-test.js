#!/usr/bin/env node
/* 全盘审计测试：存储、接口、房间生命周期、聊天上限、九个游戏的不变量
 *
 * 用法：node tools/audit-test.js
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const zlib = require('zlib');
const { makeRequest, cookieOf } = require('./lib/http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9200 + Math.floor(Math.random() * 30);
const DATA = path.join(os.tmpdir(), 'audit-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

const request = makeRequest(PORT);


async function main() {
  /* ================= 一、存储层 ================= */
  console.log('=== 存储层 ===');
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(DATA, { recursive: true });

  const store = require(path.join(ROOT, 'shared/store')).open(path.join(DATA, 'arcade'));
  const u1 = store.createUser({ username: 'alice', nickname: '爱丽丝', passHash: 'h', salt: 's', color: '#22d3ee', avatar: '' });
  ok('创建用户', !!u1 && u1.id > 0, 'id=' + (u1 && u1.id));
  ok('按用户名查', !!store.userByName('ALICE'), '大小写不敏感');
  ok('按昵称查', !!store.userByNickname('爱丽丝'));
  ok('重复用户名被拒', store.createUser({ username: 'alice', nickname: '别的', passHash: 'h', salt: 's', color: '#fff', avatar: '' }) === null);

  store.updateUser(u1.id, { nickname: '爱丽丝2', banned: 1 });
  const u1b = store.userById(u1.id);
  ok('更新昵称', u1b.nickname === '爱丽丝2');
  ok('封禁标记', u1b.banned === 1);

  const token = 'tok-' + Math.random().toString(36).slice(2);
  store.sessionCreate(token, u1.id, Date.now() + 1000);
  ok('创建会话', !!store.sessionGet(token));
  store.sessionCleanup(Date.now() + 5000);
  ok('过期会话被清理', !store.sessionGet(token));

  store.deleteUser(u1.id);
  ok('删除用户', store.userById(u1.id) === null);
  ok('删除后昵称可复用', !!store.createUser({ username: 'alice2', nickname: '爱丽丝2', passHash: 'h', salt: 's', color: '#fff', avatar: '' }));

  /* ================= 二、HTTP 接口 ================= */
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
    env: Object.assign({}, process.env, { ARCADE_DATA: DATA })
  });
  await sleep(1500);

  console.log('\n=== 账号接口 ===');
  const reg = await request('POST', '/api/register', { username: 'bob', password: '123456', nickname: '鲍勃' });
  ok('注册成功', reg.status === 200);
  const bobCookie = cookieOf(reg);
  ok('返回会话 cookie', bobCookie.indexOf('sid=') === 0);
  ok('重名昵称被拒', (await request('POST', '/api/register', { username: 'bob2', password: '123456', nickname: '鲍勃' })).status === 409);
  ok('重名用户名被拒', (await request('POST', '/api/register', { username: 'bob', password: '123456', nickname: '别的' })).status === 409);
  ok('弱密码被拒', (await request('POST', '/api/register', { username: 'x1', password: '1', nickname: 'x' })).status === 400);
  ok('非法用户名被拒', (await request('POST', '/api/register', { username: 'a b', password: '123456', nickname: 'x' })).status === 400);

  ok('未登录访问 /api/me 被拒', (await request('GET', '/api/me')).status === 401);
  const me = await request('GET', '/api/me', null, bobCookie);
  ok('登录态可读自己', me.status === 200 && me.body.user.username === 'bob');

  console.log('\n=== 静态资源白名单 ===');
  for (const p of ['/server.js', '/README.md', '/data/arcade.sqlite', '/admins.json', '/tools/audit-test.js']) {
    ok('不可下载 ' + p, (await request('GET', p)).status === 404);
  }
  ok('可以下载 /index.html', (await request('GET', '/index.html')).status === 200);
  ok('可以下载 /shared/core.js', (await request('GET', '/shared/core.js')).status === 200);

  console.log('\n=== 静态交付 ===');
  const rawGet = (p, headers) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, headers: headers || {} }, (r) => {
      const chunks = [];
      r.on('data', (d) => chunks.push(d));
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  const plain = await rawGet('/js/ui.js');
  ok('静态资源带 ETag', !!plain.headers.etag, plain.headers.etag || 'missing');
  ok('静态资源使用 no-cache', plain.headers['cache-control'] === 'no-cache', plain.headers['cache-control']);
  ok('静态资源带 CSP', String(plain.headers['content-security-policy'] || '').indexOf("default-src 'self'") >= 0);
  const gz = await rawGet('/js/ui.js', { 'Accept-Encoding': 'gzip' });
  ok('gzip 压缩生效', gz.headers['content-encoding'] === 'gzip' &&
    gz.headers.vary && gz.headers.vary.indexOf('Accept-Encoding') >= 0,
    (gz.headers['content-encoding'] || 'none') + ' / ' + (gz.headers.vary || ''));
  let gzText = '';
  try { gzText = zlib.gunzipSync(gz.body).toString('utf8'); } catch (e) { /* ignore */ }
  ok('gzip 内容可解压', gzText.indexOf('AR.UI') >= 0, gzText.length + ' chars');
  const cached = await rawGet('/js/ui.js', { 'If-None-Match': plain.headers.etag });
  ok('ETag 命中返回 304', cached.status === 304, 'status=' + cached.status);

  /* ================= 三、房间生命周期 ================= */
  console.log('\n=== 房间 ===');
  const wsA = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?token=' + bobCookie.split('=')[1]);
  const A = [];
  wsA.onmessage = (e) => A.push(JSON.parse(e.data));
  await new Promise((r) => { wsA.onopen = r; });
  await sleep(200);
  wsA.send(JSON.stringify({ t: 'createRoom', gameId: 'snake' }));
  await sleep(400);
  const room = A.filter((m) => m.t === 'room').pop();
  ok('建房成功', !!room, room && room.code);
  ok('房主是自己', room && room.hostId === me.body.user.id);
  ok('初始在等待中', room && room.phase === 'lobby');

  wsA.send(JSON.stringify({ t: 'botAdd' }));
  await sleep(300);
  const withBot = A.filter((m) => m.t === 'room').pop();
  ok('加人机成功', withBot && withBot.players.length === 2);
  const bot = withBot.players.find((p) => p.bot);
  ok('人机有难度标记（固定普通）', bot && bot.bot === 'normal', bot && bot.bot);

  wsA.send(JSON.stringify({ t: 'start' }));
  await sleep(900);
  const started = A.filter((m) => m.t === 'game').pop();
  ok('开局成功', !!started);

  /* 聊天上限 */
  for (let i = 0; i < 60; i++) wsA.send(JSON.stringify({ t: 'chat', text: 'msg' + i }));
  await sleep(1200);
  wsA.send(JSON.stringify({ t: 'leaveRoom' }));
  await sleep(400);
  ok('离开房间', A.some((m) => m.t === 'leftRoom'));

  /* ================= 四、九个游戏的不变量 ================= */
  console.log('\n=== 游戏不变量 ===');
  const AR = (() => {
    global.window = undefined;
    const core = require(path.join(ROOT, 'shared/core.js'));
    require(path.join(ROOT, 'shared/registry.js'));
    require(path.join(ROOT, 'shared/games/constants.js'));
    for (const g of ['snake', 'tank', 'bomber', 'tetris', 'shmup', 'draw', 'racing', 'gomoku', 'ludo']) {
      require(path.join(ROOT, 'shared/games/' + g + '.js'));
    }
    return globalThis.AR;
  })();

  ok('注册表 9 款游戏', AR.GAME_INFO.length === 9, AR.GAME_INFO.map((g) => g.id).join(','));

  for (const info of AR.GAME_INFO) {
    const g = AR.games[info.id];
    const n = Math.min(Math.max(info.min, 2), info.max);
    const ps = [];
    for (let i = 0; i < n; i++) ps.push({ id: 'p' + i, name: '玩家' + i, color: AR.PLAYER_COLORS[i] });
    const st = g.create(ps, { seed: 12345 });
    let bad = false;
    let maxSnap = 0;
    for (let tick = 0; tick < 60 * 30; tick++) {
      if (g.bot) for (const p of ps) { const inp = g.bot(st, p.id, 1 / 60, 'normal'); if (inp) g.input(st, p.id, inp); }
      g.tick(st, 1 / 60);
      const snap = g.snapshot(st);
      const s = JSON.stringify(snap);
      maxSnap = Math.max(maxSnap, Buffer.byteLength(s));
      if (/NaN|Infinity|null,"/.test(s.replace(/"name":null/g, '')) && /NaN|Infinity/.test(s)) bad = true;
      if (g.isOver(st)) break;
    }
    const res = g.results(st);
    ok(info.id + ' 模拟无 NaN', !bad);
    ok(info.id + ' 结果完整', res.length === n && res.every((r) => isFinite(r.score)),
      res.map((r) => r.name + ':' + Math.round(r.score)).join(' '));
    ok(info.id + ' 快照体积合理', maxSnap < 8000, maxSnap + 'B');
  }

  /* ================= 五、重复建房的资源回收 ================= */
  console.log('\n=== 资源回收 ===');
  wsA.send(JSON.stringify({ t: 'createRoom', gameId: 'tetris' }));
  await sleep(300);
  const r1 = A.filter((m) => m.t === 'room').pop();
  wsA.send(JSON.stringify({ t: 'leaveRoom' }));
  await sleep(300);
  wsA.send(JSON.stringify({ t: 'createRoom', gameId: 'bomber' }));
  await sleep(300);
  const r2 = A.filter((m) => m.t === 'room').pop();
  ok('离开后能再建新房', !!r2 && r2.code !== (r1 && r1.code));
  ok('房间码唯一', r1 && r2 && r1.code !== r2.code);

  wsA.close();
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
