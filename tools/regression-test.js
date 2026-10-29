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
['tank'].forEach((g) => {
  require(path.join(ROOT, 'shared', 'games', g + '.js'));
});

const { parseCookies } = require(path.join(ROOT, 'server', 'http-utils'));
const { startRound, freeColor, rooms: roomMap } = require(path.join(ROOT, 'server', 'rooms'));
const { Conn, handle } = require(path.join(ROOT, 'server', 'ws'));

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

function room(phase) {
  return {
    code: 'TEST',
    gameId: 'tank',
    hostId: 'u1',
    players: new Map([
      ['u1', { id: 'u1', name: '甲', color: '#22d3ee', bot: null }],
      ['u2', { id: 'u2', name: '乙', color: '#ff2e63', bot: null }]
    ]),
    phase: phase,
    round: 1,
    game: null,
    level: 'normal',
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

const overRoom = {
  code: 'OVR',
  gameId: 'tank',
  phase: 'over',
  players: new Map([['u1', { id: 'u1', name: '甲', color: '#22d3ee' }]])
};
roomMap.set(overRoom.code, overRoom);
const joined = [];
const joiner = { user: { id: 'u2', nickname: '乙' }, send: (m) => joined.push(m) };
handle(joiner, { t: 'joinRoom', code: 'OVR' });
ok('over 阶段拒绝加入房间',
  joined.some((m) => m.t === 'error' && /开始/.test(m.msg || '')),
  JSON.stringify(joined));
roomMap.delete(overRoom.code);

console.log('\n=== 房间配色 ===');
const colorRoom = { players: new Map() };
const colors = [];
for (let i = 0; i < 12; i++) {
  const c = freeColor(colorRoom);
  colors.push(c);
  colorRoom.players.set('p' + i, { color: c });
}
ok('玩家调色板为 12 色且不重复',
  AR.PLAYER_COLORS.length === 12 &&
  new Set(AR.PLAYER_COLORS.map((c) => c.toLowerCase())).size === 12,
  'colors=' + AR.PLAYER_COLORS.length);
ok('12 人房间颜色不重复', new Set(colors.map((c) => c.toLowerCase())).size === 12,
  colors.join(','));

console.log('\n=== WebSocket 背压 ===');
const fakeSocket = {
  writableLength: 0,
  setNoDelay() {},
  on() {},
  write() { return true; },
  destroy() {},
  end() {}
};
const fakeConn = new Conn(fakeSocket, { id: 1, nickname: '测试' });
ok('空缓冲允许发送状态', fakeConn.canSendState() === true);
fakeSocket.writableLength = 1024 * 1024;
ok('缓冲拥塞时跳过快照', fakeConn.canSendState() === false);

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
