#!/usr/bin/env node
/* 玩家资料接口：公开字段、状态、历史、鉴权与 404 边界 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { makeRequest } = require('./lib/http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9010 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-player-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

const baseRequest = makeRequest(PORT);
const request = (method, p, cookie) => baseRequest(method, p, null, cookie);

async function main() {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(DATA, { recursive: true });

  /* 先建好账号、会话和一条战绩，再启动服务器，避免测试进程二次连库 */
  const store = require(path.join(ROOT, 'shared', 'store')).open(path.join(DATA, 'arcade'));
  const alice = store.createUser({
    username: 'alice', passHash: 'test-hash-a', salt: 'test-salt-a',
    nickname: '爱丽丝', color: '#22d3ee', avatar: '🐱'
  });
  const bob = store.createUser({
    username: 'bob', passHash: 'test-hash-b', salt: 'test-salt-b',
    nickname: '鲍勃', color: '#ff2e63', avatar: '🐼', bio: '喜欢摸鱼'
  });
  const tokenA = 'token-alice-profile-test';
  const tokenB = 'token-bob-profile-test';
  store.sessionCreate(tokenA, alice.id, Date.now() + 86400000);
  store.sessionCreate(tokenB, bob.id, Date.now() + 86400000);
  store.matchAdd({
    game: 'tank',
    roomCode: 'TEST',
    startedAt: Date.now() - 30000,
    endedAt: Date.now(),
    players: [{ userId: bob.id, place: 1, score: 12, delta: 5, detail: 3 }]
  });
  store.close();

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

  console.log('=== 鉴权 ===');
  let r = await request('GET', '/api/players/' + bob.id);
  ok('未登录访问返回 401', r.status === 401, 'status=' + r.status);

  console.log('\n=== 公开资料 ===');
  r = await request('GET', '/api/players/' + bob.id, 'sid=' + tokenA);
  ok('接口返回 200', r.status === 200, 'status=' + r.status);
  const u = r.body.user || {};
  ok('用户名正确', u.username === 'bob', u.username);
  ok('昵称正确', u.nickname === '鲍勃', u.nickname);
  ok('签名正确', u.bio === '喜欢摸鱼', u.bio);
  ok('头像/颜色正确', u.avatar === '🐼' && u.color === '#ff2e63', u.avatar + ' / ' + u.color);
  ok('不含密码哈希和盐', u.passHash === undefined && u.salt === undefined);
  ok('积分/胜场/局数/连胜已更新', u.points === 5 && u.wins === 1 && u.rounds === 1 && u.bestStreak === 1,
    [u.points, u.wins, u.rounds, u.bestStreak].join('/'));
  ok('查看别人时 isSelf=false', r.body.isSelf === false);
  ok('无连接时状态为离线', r.body.status === 'offline', r.body.status);

  console.log('\n=== 最近战绩 ===');
  const history = r.body.history || [];
  ok('返回最近 1 局', history.length === 1, 'len=' + history.length);
  if (history[0]) {
    ok('战绩字段完整', history[0].game === 'tank' && history[0].gameName === '坦克竞技场' &&
      history[0].place === 1 && history[0].score === 12 && history[0].delta === 5,
      JSON.stringify(history[0]));
  }

  console.log('\n=== 自己 / 边界 ===');
  r = await request('GET', '/api/players/' + alice.id, 'sid=' + tokenA);
  ok('查看自己 isSelf=true', r.status === 200 && r.body.isSelf === true);
  ok('自己暂无战绩', Array.isArray(r.body.history) && r.body.history.length === 0);
  r = await request('GET', '/api/players/' + bob.id, 'sid=' + tokenB);
  ok('本人查看自己也是 isSelf=true', r.status === 200 && r.body.isSelf === true);

  r = await request('GET', '/api/players/999999', 'sid=' + tokenA);
  ok('不存在的玩家返回 404', r.status === 404, 'status=' + r.status);
  r = await request('GET', '/api/players/abc', 'sid=' + tokenA);
  ok('非法 ID 返回 404', r.status === 404, 'status=' + r.status);

  server.kill();
  await sleep(300);
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
