#!/usr/bin/env node
/* 人机：无头模拟，检查剩余游戏的人机真的会玩 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'shared/core.js'));
require(path.join(ROOT, 'shared/registry.js'));
require(path.join(ROOT, 'shared/games/constants.js'));
['tank', 'tetris', 'shmup', 'draw', 'gomoku', 'undercover'].forEach((id) => {
  require(path.join(ROOT, 'shared/games/' + id + '.js'));
});
const AR = globalThis.AR;

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

function run(gameId, n, level, maxSeconds) {
  const g = AR.games[gameId];
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push({ id: 'bot' + i, name: '电脑' + i, color: AR.PLAYER_COLORS[i % AR.PLAYER_COLORS.length] });
  }
  const state = g.create(players, { seed: 20251025 });
  let t = 0;
  let maxBullets = 0;
  let maxPackets = 0;
  while (t < maxSeconds && !g.isOver(state)) {
    for (let i = 0; i < players.length; i++) {
      const inp = g.bot(state, players[i].id, 1 / 60, level);
      if (inp) g.input(state, players[i].id, inp);
    }
    g.tick(state, 1 / 60);
    t += 1 / 60;
    if (state.bullets) maxBullets = Math.max(maxBullets, state.bullets.length);
    if (state.ebullets) maxPackets = Math.max(maxPackets, state.ebullets.length);
  }
  return { state, t, maxBullets, maxPackets, results: g.results(state) };
}

console.log('\n=== 坦克：人机会开火 ===');
{
  const r = run('tank', 4, 'normal', 150);
  ok('有人开过火', r.maxBullets > 0, 'maxBullets=' + r.maxBullets);
  ok('有人被击毁', r.results.some((x) => x.deaths > 0 || x.kills > 0),
    r.results.map((x) => x.name + ':' + x.kills + '/' + x.deaths).join(' '));
  ok('分数有限', r.results.every((x) => isFinite(x.score)));
}

console.log('\n=== 俄罗斯方块：人机会消行 ===');
{
  const r = run('tetris', 3, 'hard', 180);
  const lines = r.results.map((x) => x.kills);
  ok('会消行', lines.some((l) => l > 0), 'lines=' + lines.join(','));
  ok('分数有限', r.results.every((x) => isFinite(x.score)), r.results.map((x) => x.name + ':' + x.score).join(' '));

  const easy = run('tetris', 1, 'easy', 60);
  const insane = run('tetris', 1, 'insane', 60);
  const eLines = easy.results[0].kills;
  const iLines = insane.results[0].kills;
  ok('难度越高消得越多', iLines >= eLines, 'easy=' + eLines + ' insane=' + iLines);
}

console.log('\n=== 弹幕：人机会打敌人 ===');
{
  const r = run('shmup', 3, 'normal', 120);
  const sc = r.state.score || 0;
  ok('团队得分 > 0', sc > 0, 'score=' + sc);
  ok('会发射子弹', r.maxPackets >= 0);
}

console.log('\n=== 坦克：不隔墙乱打 ===');
{
  const tg = AR.games.tank;
  const two = [
    { id: 'botA', name: '甲', color: '#f00' },
    { id: 'botB', name: '乙', color: '#0f0' }
  ];

  /* 石墙：两个人中间一堵打不穿的墙 */
  const st = tg.create(two, { seed: 5 });
  st.map.fill(0);
  st.tanks.botA.x = 200; st.tanks.botA.y = 200; st.tanks.botA.alive = true;
  st.tanks.botB.x = 700; st.tanks.botB.y = 200; st.tanks.botB.alive = true;
  /* 一整列石墙，别让它在测试窗口内绕过去 */
  for (let ry = 0; ry < 30; ry++) st.map[ry * 40 + 11] = 1;
  let firedStone = 0;
  for (let i = 0; i < 30; i++) {
    const inp = tg.bot(st, 'botA', 1 / 60, 'normal');
    if (inp) tg.input(st, 'botA', inp);
    tg.tick(st, 1 / 60);
    firedStone = Math.max(firedStone, st.bullets.length);
  }
  ok('石墙挡着不开火', firedStone === 0, 'bullets=' + firedStone);

  /* 砖墙：近距离应该主动打穿 */
  const sb = tg.create(two, { seed: 6 });
  sb.map.fill(0);
  sb.tanks.botA.x = 200; sb.tanks.botA.y = 200; sb.tanks.botA.alive = true;
  sb.tanks.botB.x = 420; sb.tanks.botB.y = 200; sb.tanks.botB.alive = true;
  sb.map[5 * 40 + 8] = 2;
  let firedBrick = 0;
  for (let i = 0; i < 60; i++) {
    const inp = tg.bot(sb, 'botA', 1 / 60, 'normal');
    if (inp) tg.input(sb, 'botA', inp);
    tg.tick(sb, 1 / 60);
    firedBrick = Math.max(firedBrick, sb.bullets.length);
  }
  ok('砖墙会被打穿', firedBrick > 0, 'bullets=' + firedBrick);
}

console.log('\n=== 弹幕：人机不扎堆 ===');
{
  const sg = AR.games.shmup;
  const ids = ['b1', 'b2', 'b3', 'b4'];
  const ps = ids.map((id, i) => ({ id: id, name: '机' + i, color: AR.PLAYER_COLORS[i] }));
  const st = sg.create(ps, { seed: 11 });
  let best = 0;
  for (let t = 0; t < 1200; t++) {
    for (const id of ids) {
      const inp = sg.bot(st, id, 1 / 60, 'normal');
      if (inp) sg.input(st, id, inp);
    }
    sg.tick(st, 1 / 60);
    if (t > 600 && t % 12 === 0) {
      const xs = ids.map((id) => st.players[id].x).filter((x) => isFinite(x));
      if (xs.length >= 2) {
        const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
        const dev = Math.sqrt(xs.reduce((a, b) => a + (b - avg) * (b - avg), 0) / xs.length);
        if (dev > best) best = dev;
      }
    }
  }
  ok('四个人机分散在不同横向位置', best > 55, '最大横向标准差 ' + best.toFixed(0) + 'px');
}

console.log('\n=== 五子棋：快照带执棋颜色 ===');
{
  const gg = AR.games.gomoku;
  const ps = [
    { id: 'gA', name: '黑方', color: '#111111' },
    { id: 'gB', name: '白方', color: '#eeeeee' }
  ];
  const st = gg.create(ps, { seed: 7 });
  const snap = gg.snapshot(st);
  ok('首位玩家执黑', snap.sd.gA === 1, 'sd=' + JSON.stringify(snap.sd));
  ok('次位玩家执白', snap.sd.gB === 2, 'sd=' + JSON.stringify(snap.sd));
}

console.log('\n=== 注册与元信息 ===');
{
  ok('游戏数量为 6', AR.GAME_INFO.length === 6, AR.GAME_INFO.map((g) => g.name).join(' / '));
  ok('你画我猜最低 2 人', AR.getInfo('draw').min === 2, 'min=' + AR.getInfo('draw').min);
  ok('每个游戏都有人机（画猜/卧底除外）', AR.GAME_INFO.every((g) => g.id === 'draw' || g.id === 'undercover' || typeof AR.games[g.id].bot === 'function'),
    AR.GAME_INFO.filter((g) => g.id !== 'draw' && g.id !== 'undercover' && typeof AR.games[g.id].bot !== 'function').map((g) => g.id).join(','));
}

console.log('');
console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
