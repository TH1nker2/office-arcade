#!/usr/bin/env node
/* 账号 / 大厅 / 房间 / 邀请 / 开局 的端到端测试（纯 Node，无浏览器） */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { makeRequest, cookieOf } = require('./lib/http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8900 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-auth-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

const request = makeRequest(PORT);

class WsClient {
  constructor(token, label) {
    this.token = token;
    this.label = label;
    this.queue = [];
    this.waiters = [];
  }
  open() {
    this.ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?token=' + this.token);
    this.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      this.queue.push(m);
      this.flush();
    };
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error(this.label + ' WS 连接失败'));
    });
  }
  flush() {
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      const idx = this.queue.findIndex((m) => m.t === w.type && (!w.pred || w.pred(m)));
      if (idx >= 0) {
        const msg = this.queue.splice(idx, 1)[0];
        this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
        i--;
      }
    }
  }
  next(type, timeout, pred) {
    const idx = this.queue.findIndex((m) => m.t === type && (!pred || pred(m)));
    if (idx >= 0) return Promise.resolve(this.queue.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { type, resolve, pred };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(this.label + ' 等待超时：' + type));
      }, timeout || 8000);
      this.waiters.push(w);
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  drain() { this.queue.length = 0; }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function main() {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(DATA, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { ARCADE_DATA: DATA })
  });
  let log = '';
  server.stdout.on('data', (d) => log += d.toString());
  server.stderr.on('data', (d) => log += d.toString());
  await sleep(1200);
  if (log.indexOf('localhost:' + PORT) < 0) {
    console.error('服务器未启动\n' + log);
    process.exit(1);
  }

  console.log('=== 账号 ===');
  const regA = await request('POST', '/api/register', { username: 'alice', password: '123456', nickname: '爱丽丝' });
  ok('注册成功', regA.status === 200 && regA.body.user && regA.body.user.nickname === '爱丽丝',
    'status=' + regA.status);
  ok('返回会话 Cookie', cookieOf(regA).startsWith('sid='), cookieOf(regA).slice(0, 12));

  const dup = await request('POST', '/api/register', { username: 'alice', password: '123456', nickname: '别人' });
  ok('重名被拒绝', dup.status === 409, dup.body.error);

  const badName = await request('POST', '/api/register', { username: 'a', password: '123456' });
  ok('用户名规则校验', badName.status === 400, badName.body.error);

  const badPass = await request('POST', '/api/login', { username: 'alice', password: 'wrong' });
  ok('错误密码被拒绝', badPass.status === 401, badPass.body.error);

  const login = await request('POST', '/api/login', { username: 'alice', password: '123456' });
  ok('登录成功', login.status === 200 && login.body.user.username === 'alice');
  const cookieA = cookieOf(login);

  ok('未登录访问 /api/me 返回 401', (await request('GET', '/api/me')).status === 401);
  const meA = await request('GET', '/api/me', null, cookieA);
  ok('带 Cookie 访问 /api/me', meA.status === 200 && meA.body.user.nickname === '爱丽丝');

  const prof = await request('POST', '/api/profile', { nickname: '老王', color: '#ff2e63', avatar: '🦊', bio: '摸鱼中' }, cookieA);
  ok('修改资料', prof.status === 200 && prof.body.user.nickname === '老王' && prof.body.user.avatar === '🦊');

  /* 另外两个账号 */
  const regB = await request('POST', '/api/register', { username: 'bob', password: '123456', nickname: '小李' });
  const cookieB = cookieOf(regB);
  const regC = await request('POST', '/api/register', { username: 'carol', password: '123456', nickname: '小张' });
  const cookieC = cookieOf(regC);
  ok('三个账号就绪', regB.status === 200 && regC.status === 200);

  console.log('\n=== 在线状态 ===');
  const wsA = new WsClient(cookieA.split('=')[1], 'A');
  await wsA.open();
  const meMsg = await wsA.next('me');
  ok('WS 首包返回本人信息', meMsg.user.username === 'alice' && meMsg.user.nickname === '老王');

  const wsB = new WsClient(cookieB.split('=')[1], 'B');
  await wsB.open();
  const lobby2 = await wsA.next('lobby', 4000, (m) => m.users.filter((u) => u.status !== 'offline').length >= 2);
  ok('大厅广播在线人数', lobby2.users.filter((u) => u.status === 'online').length === 2,
    'online=' + lobby2.users.filter((u) => u.status === 'online').length);

  const wsC = new WsClient(cookieC.split('=')[1], 'C');

  console.log('\n=== 聊天 ===');
  wsA.drain(); wsB.drain();
  wsA.send({ t: 'chat', text: '大厅消息测试' });
  const lobbyMsg = await wsB.next('chat', 4000, (m) => m.ch === 'lobby');
  ok('大厅聊天广播给所有人', lobbyMsg.text === '大厅消息测试' && lobbyMsg.from.name === '老王',
    lobbyMsg.from.name + ': ' + lobbyMsg.text);

  /* C 这时才上线，应该能拿到历史 */
  await wsC.open();
  await wsC.next('me');
  const histMsg = await wsC.next('chatHistory', 4000, (m) => m.ch === 'lobby');
  ok('新连接能收到大厅聊天历史', histMsg.list.some((x) => x.text === '大厅消息测试'),
    'history=' + histMsg.list.length);

  /* 连接建立后再改名，聊天必须立刻使用新昵称 */
  await sleep(450);
  const prof2 = await request('POST', '/api/profile', { nickname: '老王二代' }, cookieA);
  ok('WS 连接后修改昵称', prof2.status === 200 && prof2.body.user.nickname === '老王二代');
  wsA.drain(); wsB.drain();
  wsA.send({ t: 'chat', text: '改名后的消息' });
  const lobbyMsg2 = await wsB.next('chat', 4000, (m) => m.ch === 'lobby' && m.text === '改名后的消息');
  ok('改名后大厅聊天使用新昵称', lobbyMsg2.from.name === '老王二代', lobbyMsg2.from.name);

  console.log('\n=== 房间 ===');
  wsA.drain(); wsB.drain(); wsC.drain();
  wsA.send({ t: 'createRoom', gameId: 'tank' });
  const roomA = await wsA.next('room');
  const code = roomA.code;
  ok('创建房间', !!code && roomA.gameId === 'tank' && roomA.players.length === 1, 'code=' + code);

  const roomList = await request('GET', '/api/rooms?game=tank', null, cookieB);
  ok('房间列表可查', roomList.body.rooms.length === 1 && roomList.body.rooms[0].code === code);

  wsB.send({ t: 'joinRoom', code: code });
  const roomB = await wsB.next('room');
  ok('按房间码加入', roomB.players.length === 2, 'players=' + roomB.players.length);

  const lobbyGame = await wsC.next('lobby', 4000, (m) =>
    m.users.some((u) => u.username === 'alice' && u.status === 'waiting'));
  const aliceRow = lobbyGame.users.filter((u) => u.username === 'alice')[0];
  ok('大厅显示“等待中”状态',
    aliceRow.status === 'waiting' && aliceRow.gameName === '坦克竞技场' &&
    aliceRow.roomCount === 2 && aliceRow.roomMax === 8,
    aliceRow.status + ' ' + aliceRow.roomCount + '/' + aliceRow.roomMax);

  console.log('\n=== 房间聊天 ===');
  await sleep(450);                    /* 避开 350ms 的发言限流 */
  wsA.drain(); wsB.drain(); wsC.drain();
  wsA.send({ t: 'chat', text: '房间消息测试' });
  const roomMsg = await wsB.next('chat', 4000, (m) => m.ch === 'room');
  ok('房间聊天房内可见', roomMsg.text === '房间消息测试', roomMsg.from.name + ': ' + roomMsg.text);
  await sleep(400);
  const leaked = wsC.queue.filter((m) => m.t === 'chat' && m.ch === 'room').length;
  ok('房间聊天不会串到房间外', leaked === 0, 'leak=' + leaked);


  console.log('\n=== 邀请 ===');
  wsA.drain(); wsC.drain();
  wsA.send({ t: 'invite', toId: regC.body.user.id });
  const sent = await wsA.next('inviteSent');
  ok('发出邀请', sent.ok === true, sent.msg);

  const inv = await wsC.next('invite', 4000);
  ok('被邀请方收到邀请', inv.roomCode === code && inv.gameName === '坦克竞技场', inv.from.nickname);

  wsC.send({ t: 'inviteReply', inviteId: inv.inviteId, accept: true });
  const roomC = await wsC.next('room', 4000);
  ok('接受邀请后进房', roomC.players.length === 3, 'players=' + roomC.players.length);
  const resMsg = await wsA.next('inviteResult', 4000);
  ok('邀请人收到结果', resMsg.ok === true && resMsg.name === '小张');

  console.log('\n=== 开局与同步 ===');
  wsA.drain(); wsB.drain(); wsC.drain();
  wsA.send({ t: 'start' });
  const g = await wsB.next('game', 4000);
  ok('开局广播', g.id === 'tank' && g.players.length === 3, 'players=' + g.players.length);

  const st1 = await wsC.next('state', 4000);
  ok('收到快照', !!(st1.s && st1.s.p), 'tanks=' + (st1.s.p || []).length);

  wsB.send({ t: 'input', i: { dx: 0, dy: 0, ax: 800, ay: 600 } });
  await sleep(300);
  const st2 = await wsC.next('state', 4000);
  ok('输入后继续收到快照', !!(st2.s && st2.s.t !== undefined));

  console.log('\n=== 房主移交与空房销毁 ===');
  wsB.drain();
  wsA.send({ t: 'leaveRoom' });
  const afterLeave = await wsB.next('room', 4000, (m) => m.hostId === regB.body.user.id);
  ok('房主退出后移交给另一位真人', afterLeave.hostId === regB.body.user.id &&
    afterLeave.players.length === 2, 'players=' + afterLeave.players.length);

  wsC.drain();
  wsB.send({ t: 'leaveRoom' });
  await wsC.next('room', 4000, (m) => m.players.length === 1);
  wsC.send({ t: 'leaveRoom' });
  await sleep(400);
  const roomsLeft = await request('GET', '/api/rooms?game=tank', null, cookieA);
  ok('最后一个真人离开后房间销毁', roomsLeft.body.rooms.length === 0,
    'rooms=' + roomsLeft.body.rooms.length);

  console.log('\n=== 修改密码与旧会话 ===');
  const login2 = await request('POST', '/api/login', { username: 'alice', password: '123456' });
  const cookieA2 = cookieOf(login2);
  ok('第二个会话建立', login2.status === 200 && cookieA2.indexOf('sid=') === 0);
  const pwChange = await request('POST', '/api/password',
    { oldPassword: '123456', newPassword: '654321' }, cookieA);
  ok('修改密码成功', pwChange.status === 200, pwChange.body.error);
  ok('其他旧会话失效', (await request('GET', '/api/me', null, cookieA2)).status === 401);
  ok('当前会话保留', (await request('GET', '/api/me', null, cookieA)).status === 200);
  ok('旧密码不能登录',
    (await request('POST', '/api/login', { username: 'alice', password: '123456' })).status === 401);
  ok('新密码可以登录',
    (await request('POST', '/api/login', { username: 'alice', password: '654321' })).status === 200);

  console.log('\n=== 资料与历史 ===');
  const hist = await request('GET', '/api/history?limit=5', null, cookieA);
  ok('历史接口可用', hist.status === 200 && Array.isArray(hist.body.list));

  const board = await request('GET', '/api/board');
  ok('排行榜公开可读', board.status === 200 && board.body.list.length === 3);

  const noAuthBoard = await request('GET', '/api/board');
  ok('排行榜不含密码字段', JSON.stringify(noAuthBoard.body).indexOf('passHash') < 0);

  console.log('\n=== 版本信息 ===');
  const ver = await request('GET', '/api/version');
  ok('版本接口可用', ver.status === 200 && /^\d+\.\d+\.\d+$/.test(ver.body.version || ''),
    'v' + (ver.body.version || '?'));
  ok('版本带更新说明', Array.isArray(ver.body.notes) && ver.body.notes.length > 0,
    (ver.body.notes || []).length + ' 条');
  ok('版本带历史记录', Array.isArray(ver.body.history), (ver.body.history || []).length + ' 个历史版本');

  console.log('\n=== 静态资源白名单 ===');
  const pub = await request('GET', '/js/ui.js');
  ok('前端脚本可访问', pub.status === 200, 'status=' + pub.status);
  const shared = await request('GET', '/shared/core.js');
  ok('共享模块可访问', shared.status === 200, 'status=' + shared.status);
  const src = await request('GET', '/server.js');
  ok('服务端源码不可下载', src.status === 404, 'status=' + src.status);
  const cfg = await request('GET', '/tools/runtime-manifest.json');
  ok('配置文件不可下载', cfg.status === 404, 'status=' + cfg.status);
  const readme = await request('GET', '/README.md');
  ok('README 不可下载', readme.status === 404, 'status=' + readme.status);
  const db = await request('GET', '/data/arcade.sqlite');
  ok('数据库不可下载', db.status === 404, 'status=' + db.status);

  wsA.close(); wsB.close(); wsC.close();
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
