#!/usr/bin/env node
/* JSON 存储实现测试：CRUD、会话、战绩与显式 ARCADE_STORE=json 选择 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(os.tmpdir(), 'arcade-json-test-' + process.pid + '.json');

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

try { fs.rmSync(FILE, { force: true }); } catch (e) { /* ignore */ }

const { open } = require(path.join(ROOT, 'shared', 'store-json'));
const store = open(FILE);

const u1 = store.createUser({
  username: 'json_a', passHash: 'h1', salt: 's1', nickname: 'JSON甲', color: '#22d3ee', avatar: '🐱'
});
const u2 = store.createUser({
  username: 'json_b', passHash: 'h2', salt: 's2', nickname: 'JSON乙', color: '#ff2e63', avatar: '🐼'
});
ok('创建两个用户', !!u1 && !!u2 && u1.id !== u2.id, 'ids=' + (u1 && u1.id) + ',' + (u2 && u2.id));
ok('用户名大小写不敏感查找', store.userByName('JSON_A').id === u1.id);
ok('昵称查找', store.userByNickname('json乙').id === u2.id);

store.sessionCreate('json-token', u1.id, Date.now() + 3600000);
ok('会话可读', store.sessionGet('json-token').userId === u1.id);
store.sessionDelete('json-token');
ok('会话可删', store.sessionGet('json-token') === null);

store.matchAdd({
  game: 'tank', roomCode: 'JSON', startedAt: Date.now() - 1000, endedAt: Date.now(),
  players: [{ userId: u1.id, place: 1, score: 10, delta: 5, detail: 2 }]
});
const after = store.userById(u1.id);
ok('战绩更新积分/胜场/连胜', after.points === 5 && after.wins === 1 && after.rounds === 1 &&
  after.streak === 1 && after.bestStreak === 1,
  JSON.stringify({ points: after.points, wins: after.wins, rounds: after.rounds, streak: after.streak }));
const history = store.matchesByUser(u1.id, 10);
ok('战绩明细可查', history.length === 1 && history[0].game === 'tank' && history[0].delta === 5,
  JSON.stringify(history[0] || null));
ok('排行榜按积分排序', store.topUsers(10)[0].id === u1.id);
ok('用户列表可读', store.listUsers().length === 2);

store.updateUser(u1.id, { nickname: 'JSON甲2', banned: 1 });
ok('更新用户字段', store.userById(u1.id).nickname === 'JSON甲2' && store.userById(u1.id).banned === 1);

store.deleteUser(u2.id);
ok('删除用户', store.userById(u2.id) === null && store.stats().users === 1);
store.close();

const reopened = open(FILE);
ok('重新打开后数据仍在', reopened.userById(u1.id).nickname === 'JSON甲2');
reopened.close();
try { fs.rmSync(FILE, { force: true }); } catch (e) { /* ignore */ }

process.env.ARCADE_STORE = 'json';
const { open: openSelected } = require(path.join(ROOT, 'shared', 'store'));
const selectedFile = path.join(os.tmpdir(), 'arcade-json-selected-' + process.pid);
const selected = openSelected(selectedFile);
ok('ARCADE_STORE=json 选择 JSON', selected.kind === 'json', selected.kind);
selected.close();
try { fs.rmSync(selectedFile + '.json', { force: true }); } catch (e) { /* ignore */ }

console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
