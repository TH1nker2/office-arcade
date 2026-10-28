#!/usr/bin/env node
/* 管理后台接口测试：登录 / 列表 / 封禁 / 踢下线 / 改密 / 删号 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { makeRequest, cookieOf } = require('./lib/http');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8980 + Math.floor(Math.random() * 15);
const DATA = path.join(os.tmpdir(), 'arcade-admin-' + PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

const request = makeRequest(PORT);

async function main() {
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(DATA, { recursive: true });

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { ARCADE_DATA: DATA })
  });
  let log = '';
  server.stdout.on('data', (d) => log += d.toString());
  server.stderr.on('data', (d) => log += d.toString());
  await sleep(1300);
  if (log.indexOf('localhost:' + PORT) < 0) {
    console.error('服务器未启动\n' + log);
    process.exit(1);
  }
  ok('启动时报告管理员数量', /管理员： \d+ 个/.test(log), (log.match(/管理员：[^\n]*/) || [''])[0]);

  console.log('\n=== 管理员登录 ===');
  const bad = await request('POST', '/api/admin/login', { username: 'admin', password: 'wrong' });
  ok('错误密码被拒绝', bad.status === 401, bad.body.error);
  const login = await request('POST', '/api/admin/login', { username: 'admin', password: 'admin888' });
  ok('登录成功', login.status === 200 && login.body.admin.username === 'admin', JSON.stringify(login.body.admin));
  const adminCookie = cookieOf(login);
  ok('返回管理员会话 cookie', adminCookie.indexOf('asid=') === 0, adminCookie.slice(0, 10));

  const noAuth = await request('GET', '/api/admin/users');
  ok('未登录访问被拒绝', noAuth.status === 401);
  ok('普通用户 cookie 不能进管理接口',
    (await request('GET', '/api/admin/users', null, 'sid=whatever')).status === 401);

  console.log('\n=== 用户列表 ===');
  const reg = await request('POST', '/api/register', { username: 'victim', password: '123456', nickname: '倒霉蛋' });
  ok('先注册一个普通用户', reg.status === 200);
  const userCookie = cookieOf(reg);
  const users = await request('GET', '/api/admin/users', null, adminCookie);
  const row = (users.body.users || []).find((u) => u.username === 'victim');
  ok('列表里能找到该用户', !!row, '共 ' + users.body.users.length + ' 个');
  ok('列表带状态字段', row && typeof row.online === 'boolean' && typeof row.banned === 'boolean',
    row ? 'online=' + row.online + ' banned=' + row.banned : '');

  const search = await request('GET', '/api/admin/users?q=' + encodeURIComponent('倒霉'), null, adminCookie);
  ok('按昵称搜索', (search.body.users || []).length === 1, (search.body.users || []).length + ' 条');

  console.log('\n=== 词库查看 ===');
  const wordsNoAuth = await request('GET', '/api/admin/words');
  ok('未登录不能看词库', wordsNoAuth.status === 401);
  const easyWords = await request('GET', '/api/admin/words?level=easy', null, adminCookie);
  ok('简单档词库可读', easyWords.status === 200 && easyWords.body.level === 'easy');
  ok('三档词数各 500', ['easy', 'normal', 'hard'].every((lv) =>
    easyWords.body.levels && easyWords.body.levels[lv] && easyWords.body.levels[lv].count === 500),
    JSON.stringify((easyWords.body.levels || {})));
  ok('简单档返回 500 个词', (easyWords.body.words || []).length === 500);
  ok('词条带 4 条提示', (easyWords.body.words || []).every((e) =>
    e.w && Array.isArray(e.h) && e.h.length === 4));
  const hardWords = await request('GET', '/api/admin/words?level=hard', null, adminCookie);
  ok('困难档词条可读', hardWords.status === 200 && (hardWords.body.words || []).length === 500);
  const badLevel = await request('GET', '/api/admin/words?level=nightmare', null, adminCookie);
  ok('非法难度返回 400', badLevel.status === 400);

  const ucNoAuth = await request('GET', '/api/admin/undercover-words');
  ok('未登录不能看卧底词库', ucNoAuth.status === 401);
  const ucWords = await request('GET', '/api/admin/undercover-words', null, adminCookie);
  ok('卧底词库可读', ucWords.status === 200 && ucWords.body.total === 120,
    'status=' + ucWords.status + ' total=' + (ucWords.body && ucWords.body.total));
  ok('卧底词对返回 120 条', (ucWords.body.pairs || []).length === 120);
  ok('卧底词条字段完整', (ucWords.body.pairs || []).every((p) =>
    p.a && p.b && p.category && p.a !== p.b));
  ok('卧底分类汇总正确', (ucWords.body.categories || []).length === 10 &&
    (ucWords.body.categories || []).reduce((n, c) => n + c.count, 0) === 120,
    JSON.stringify(ucWords.body.categories));
  ok('卧底词库来源正确', ucWords.body.source === 'shared/undercover-words.json', ucWords.body.source);

  console.log('\n=== 封禁 ===');
  const ws1 = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?token=' + userCookie.split('=')[1]);
  let kickedMsg = null;
  ws1.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'kicked') kickedMsg = m.msg;
  };
  await new Promise((res, rej) => { ws1.onopen = res; ws1.onerror = rej; });
  await sleep(200);

  const ban = await request('POST', '/api/admin/ban', { id: row.id, banned: 1 }, adminCookie);
  ok('封禁成功', ban.status === 200);
  await sleep(600);
  ok('在线用户被立刻踢下线', kickedMsg !== null, kickedMsg || '没收到 kicked');
  ok('封禁后旧会话的 HTTP 请求失效',
    (await request('GET', '/api/me', null, userCookie)).status === 401);

  const loginBanned = await request('POST', '/api/login', { username: 'victim', password: '123456' });
  ok('被封禁后无法登录', loginBanned.status === 403, loginBanned.body.error);

  const wsBanned = new WebSocket('ws://127.0.0.1:' + PORT + '/ws?token=' + userCookie.split('=')[1]);
  const wsErr = await new Promise((res) => {
    wsBanned.onopen = () => res(false);
    wsBanned.onerror = () => res(true);
  });
  ok('被封禁的会话连不上 WebSocket', wsErr === true);

  const unban = await request('POST', '/api/admin/ban', { id: row.id, banned: 0 }, adminCookie);
  ok('解封成功', unban.status === 200);
  const relogin = await request('POST', '/api/login', { username: 'victim', password: '123456' });
  ok('解封后可以登录', relogin.status === 200);
  const reloginCookie = cookieOf(relogin);

  console.log('\n=== 重置密码 ===');
  const pw = await request('POST', '/api/admin/password', { id: row.id, password: 'newpass123' }, adminCookie);
  ok('改密成功', pw.status === 200, pw.body.password);
  ok('重置密码后旧会话失效',
    (await request('GET', '/api/me', null, reloginCookie)).status === 401);
  ok('旧密码失效',
    (await request('POST', '/api/login', { username: 'victim', password: '123456' })).status === 401);
  ok('新密码可登录',
    (await request('POST', '/api/login', { username: 'victim', password: 'newpass123' })).status === 200);
  ok('密码太短被拒绝',
    (await request('POST', '/api/admin/password', { id: row.id, password: '123' }, adminCookie)).status === 400);

  console.log('\n=== 删除账号 ===');
  const wrong = await request('POST', '/api/admin/delete', { id: row.id, confirm: '乱写' }, adminCookie);
  ok('确认串不对时拒绝删除', wrong.status === 400, wrong.body.error);
  const del = await request('POST', '/api/admin/delete', { id: row.id, confirm: '倒霉蛋' }, adminCookie);
  ok('确认后删除成功', del.status === 200);
  const after = await request('GET', '/api/admin/users', null, adminCookie);
  ok('列表里已经没有这个人', !(after.body.users || []).some((u) => u.username === 'victim'));
  ok('被删的人无法登录',
    (await request('POST', '/api/login', { username: 'victim', password: 'newpass123' })).status === 401);

  console.log('\n=== 登出 ===');
  const out = await request('POST', '/api/admin/logout', null, adminCookie);
  ok('登出成功', out.status === 200);
  ok('登出后接口失效', (await request('GET', '/api/admin/users', null, adminCookie)).status === 401);

  try { ws1.close(); } catch (e) { /* ignore */ }
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
