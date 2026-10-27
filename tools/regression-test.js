#!/usr/bin/env node
/* 小型回归：startRound 阶段守卫、畸形 Cookie 解析
 * 不启动 HTTP/WS 服务，直接验证服务端模块的边界。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(os.tmpdir(), 'arcade-regression-' + process.pid);
process.env.ARCADE_DATA = DATA;

['core', 'registry', 'games/constants'].forEach((f) => {
  require(path.join(ROOT, 'shared', f + '.js'));
});
['snake'].forEach((g) => {
  require(path.join(ROOT, 'shared', 'games', g + '.js'));
});

const { parseCookies } = require(path.join(ROOT, 'server', 'http-utils'));
const { startRound } = require(path.join(ROOT, 'server', 'rooms'));

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

function room(phase) {
  return {
    code: 'TEST',
    gameId: 'snake',
    hostId: 'u1',
    players: new Map([
      ['u1', { id: 'u1', name: '甲', color: '#22d3ee', bot: null }],
      ['u2', { id: 'u2', name: '乙', color: '#ff2e63', bot: null }]
    ]),
    phase: phase,
    round: 1,
    game: null,
    level: 'normal',
    planes: 1,
    chat: [],
    startedAt: 0,
    acc: 0,
    netAcc: 0,
    overTimer: null
  };
}

console.log('=== 开局阶段守卫 ===');
['over', 'playing'].forEach((phase) => {
  const r = room(phase);
  startRound(r);
  ok('startRound 在 ' + phase + ' 阶段不启动新局',
    r.phase === phase && r.round === 1 && r.game === null,
    'phase=' + r.phase + ' round=' + r.round);
});

console.log('\n=== 畸形 Cookie ===');
const parsed = parseCookies('a=%E0%A4%A; b=ok');
ok('畸形百分号编码原样保留', parsed.a === '%E0%A4%A', parsed.a);
ok('正常 Cookie 不受影响', parsed.b === 'ok', parsed.b);

try {
  require(path.join(ROOT, 'server', 'config')).store.close();
} catch (e) { /* ignore */ }
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* ignore */ }

console.log('');
console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
