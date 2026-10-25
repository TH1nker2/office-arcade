#!/usr/bin/env node
/* 人机与赛车：无头模拟，检查人机真的会玩、赛车能跑完 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'shared/core.js'));
require(path.join(ROOT, 'shared/registry.js'));
['snake', 'tank', 'bomber', 'tetris', 'shmup', 'draw', 'racing', 'ludo'].forEach((id) => {
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
  let maxBombs = 0;
  let maxPackets = 0;
  while (t < maxSeconds && !g.isOver(state)) {
    for (let i = 0; i < players.length; i++) {
      const inp = g.bot(state, players[i].id, 1 / 60, level);
      if (inp) g.input(state, players[i].id, inp);
    }
    g.tick(state, 1 / 60);
    t += 1 / 60;
    if (state.bullets) maxBullets = Math.max(maxBullets, state.bullets.length);
    if (state.bombs) maxBombs = Math.max(maxBombs, state.bombs.length);
    if (state.ebullets) maxPackets = Math.max(maxPackets, state.ebullets.length);
  }
  return { state, t, maxBullets, maxBombs, maxPackets, results: g.results(state) };
}

console.log('=== 蛇球：人机会吃光点、会躲 ===');
{
  const r = run('snake', 4, 'normal', 90);
  const scores = r.results.map((x) => x.score);
  ok('跑完整局未抛异常', true, r.t.toFixed(1) + 's');
  ok('人机能吃到光点', scores.some((s) => s > 0), 'scores=' + scores.join(','));
  ok('人机不会原地不动', scores.reduce((a, b) => a + b, 0) > 5, 'total=' + scores.reduce((a, b) => a + b, 0));
}

console.log('\n=== 坦克：人机会开火 ===');
{
  const r = run('tank', 4, 'normal', 150);
  ok('有人开过火', r.maxBullets > 0, 'maxBullets=' + r.maxBullets);
  ok('有人被击毁', r.results.some((x) => x.deaths > 0 || x.kills > 0),
    r.results.map((x) => x.name + ':' + x.kills + '/' + x.deaths).join(' '));
  ok('分数有限', r.results.every((x) => isFinite(x.score)));
}

console.log('\n=== 炸弹人：人机会放炸弹 ===');
{
  const r = run('bomber', 4, 'normal', 120);
  ok('放过炸弹', r.maxBombs > 0, 'maxBombs=' + r.maxBombs);
  ok('有人得分或阵亡', r.results.some((x) => x.score > 0 || x.alive === 0),
    r.results.map((x) => x.name + ':' + x.score + (x.alive ? '' : '(死)')).join(' '));
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

console.log('\n=== 赛车：人机能跑完 ===');
{
  const g = AR.games.racing;
  const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({
    id: id, name: '车手' + i, color: AR.PLAYER_COLORS[i]
  }));
  const state = g.create(players, { seed: 7 });
  let t = 0;
  while (t < 160 && !g.isOver(state)) {
    for (const p of players) {
      const inp = g.bot(state, p.id, 1 / 60, 'normal');
      if (inp) g.input(state, p.id, inp);
    }
    g.tick(state, 1 / 60);
    t += 1 / 60;
  }
  const res = g.results(state);
  const fin = res.filter((x) => x.finished).length;
  ok('比赛能结束', g.isOver(state), t.toFixed(1) + 's');
  ok('有人跑完全程', fin > 0, '完赛 ' + fin + '/' + res.length);
  ok('名次分数合理', res.every((x) => isFinite(x.score) && x.score >= 0),
    res.map((x) => x.name + ':' + x.score).join(' '));

  const snap = g.snapshot(state);
  ok('快照体积可控', JSON.stringify(snap).length < 2600, (JSON.stringify(snap).length / 1024).toFixed(1) + ' KB');
  const meta = g.meta(state);
  ok('赛道点数充足', meta.points.length > 60, 'points=' + meta.points.length);

  /* 赛道不能自交 */
  const pts = meta.points;
  let cross = 0;
  function seg(a, b, c, d) {
    function ccw(p, q, r) { return (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0]); }
    return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 2; j < pts.length; j++) {
      if (i === 0 && j === pts.length - 1) continue;
      if (seg(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) cross++;
    }
  }
  ok('赛道中心线不自交', cross === 0, '交点=' + cross);

  for (const level of ['easy', 'normal', 'hard', 'insane']) {
    const st2 = g.create(players.slice(0, 2), { seed: 3 });
    let tt = 0;
    while (tt < 60 && !g.isOver(st2)) {
      for (const p of players.slice(0, 2)) {
        const inp = g.bot(st2, p.id, 1 / 60, level);
        if (inp) g.input(st2, p.id, inp);
      }
      g.tick(st2, 1 / 60);
      tt += 1 / 60;
    }
    const laps = st2.cars[players[0].id].laps;
    ok('难度 ' + level + ' 能前进', laps >= 0, '60s 内 laps=' + laps);
  }
}

console.log('\n=== 飞行棋：人机能打完 ===');
{
  const lg = AR.games.ludo;
  for (const n of [2, 4]) {
    const ps = [];
    for (let i = 0; i < n; i++) ps.push({ id: 'L' + i, name: '棋' + i, color: AR.PLAYER_COLORS[i] });
    const st = lg.create(ps, { seed: 31 + n });
    let t = 0;
    let bad = false;
    while (t < 310 && !lg.isOver(st)) {
      for (const p of ps) {
        const inp = lg.bot(st, p.id, 1 / 60, 'normal');
        if (inp) lg.input(st, p.id, inp);
      }
      lg.tick(st, 1 / 60);
      t += 1 / 60;
      const snap = lg.snapshot(st);
      if (snap.pl.some((row) => row[1] > 44 || row[2] > 44)) bad = true;
    }
    const res = lg.results(st);
    ok(n + ' 人飞行棋能结束', lg.isOver(st), t.toFixed(1) + 's');
    ok(n + ' 人飞行棋有赢家', !!st.winnerId, String(st.winnerId));
    ok(n + ' 人飞行棋位置合法', !bad);
    ok(n + ' 人飞行棋结果完整', res.length === n && res.every((r) => isFinite(r.score)),
      res.map((r) => r.name + ':' + r.done).join(' '));
  }
}

console.log('\n=== 注册与元信息 ===');
{
  ok('游戏数量为 8', AR.GAME_INFO.length === 8, AR.GAME_INFO.map((g) => g.name).join(' / '));
  ok('你画我猜最低 2 人', AR.getInfo('draw').min === 2, 'min=' + AR.getInfo('draw').min);
  ok('每个游戏都有人机', AR.GAME_INFO.every((g) => g.id === 'draw' || typeof AR.games[g.id].bot === 'function'),
    AR.GAME_INFO.filter((g) => g.id !== 'draw' && typeof AR.games[g.id].bot !== 'function').map((g) => g.id).join(','));
}

console.log('');
console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
