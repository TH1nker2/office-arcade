#!/usr/bin/env node
/* 无浏览器逻辑测试：动作/回合游戏模拟，验证稳定性、快照大小、结果与关键机制 */
'use strict';

const path = require('path');
for (const f of ['core', 'registry', 'games/constants']) require(path.join(__dirname, '..', 'shared', f + '.js'));
for (const g of ['snake', 'tank', 'bomber', 'tetris', 'shmup', 'draw', 'ludo']) {
  require(path.join(__dirname, '..', 'shared', 'games', g + '.js'));
}
const AR = globalThis.AR;

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

function players(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: 'p' + i, name: '玩家' + i, color: AR.PLAYER_COLORS[i % AR.PLAYER_COLORS.length] });
  }
  return out;
}

function badNumbers(obj, path, out) {
  if (typeof obj === 'number') {
    if (!isFinite(obj)) out.push(path + '=' + obj);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => badNumbers(v, path + '[' + i + ']', out));
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const k in obj) badNumbers(obj[k], path + '.' + k, out);
  }
}

function sim(id, n, seconds, inputFn, capSeconds) {
  const g = AR.games[id];
  const ps = players(n);
  const t0 = Date.now();
  const st = g.create(ps, { seed: 20260601, duration: seconds });
  const dt = 1 / 60;
  let ticks = 0;
  let maxSnap = 0;
  let bad = [];
  const maxTicks = Math.round((capSeconds || seconds) * 60) + 180;

  while (!g.isOver(st) && ticks < maxTicks) {
    for (const p of ps) {
      if (g.input) g.input(st, p.id, inputFn(ticks, p, st, id) || {});
    }
    g.tick(st, dt);
    ticks++;
    if (ticks % 30 === 0) {
      const snap = g.snapshot(st);
      const json = JSON.stringify(snap);
      if (json.length > maxSnap) maxSnap = json.length;
      if (bad.length === 0) {
        const out = [];
        badNumbers(snap, id, out);
        if (out.length) bad = out.slice(0, 3);
      }
    }
  }

  const res = g.results(st);
  const ms = Date.now() - t0;
  return { ticks, maxSnap, bad, res, ms, over: g.isOver(st), state: st };
}

function inputFor(id) {
  return (t, p, st) => {
    const sec = t / 60;
    if (id === 'snake') {
      const a = sec * 1.7 + (p.id.charCodeAt(1) - 48) * 1.9;
      return { ax: 800 + Math.cos(a) * 700, ay: 600 + Math.sin(a * 1.3) * 520 };
    }
    if (id === 'tank') {
      const a = sec * 0.9 + (p.id.charCodeAt(1) - 48);
      return {
        dx: Math.cos(a) > 0 ? 1 : -1,
        dy: Math.sin(a * 0.7) > 0 ? 1 : -1,
        ax: 800 + Math.cos(a * 2) * 700,
        ay: 600 + Math.sin(a * 2) * 500,
        f: true
      };
    }
    if (id === 'bomber') {
      return {
        dx: Math.sin(sec * 1.1 + p.id.charCodeAt(1)) > 0 ? 1 : -1,
        dy: Math.cos(sec * 0.8 + p.id.charCodeAt(1)) > 0 ? 1 : -1,
        bomb: t % 150 === 0
      };
    }
    if (id === 'shmup') {
      return {
        dx: Math.sin(sec * 1.4 + p.id.charCodeAt(1)) > 0 ? 1 : -1,
        dy: 0,
        f: true
      };
    }
    if (id === 'tetris') {
      const rnd = Math.random();
      const ev = rnd < 0.45 ? 'L' : (rnd < 0.9 ? 'R' : 'ROT');
      return t % 4 === 0 ? { ev: [ev] } : {};
    }
    return {};
  };
}

console.log('=== 六个游戏逻辑模拟 ===');

const cases = [
  ['snake', 4, 90, 90],
  ['tank', 4, 150, 150],
  ['bomber', 4, 120, 120],
  ['tetris', 4, 180, 180],
  ['shmup', 4, 120, 120]
];

for (const [id, n, secs, cap] of cases) {
  const r = sim(id, n, secs, inputFor(id), cap);
  ok(id + ' 模拟未抛异常', true, r.ticks + ' tick / ' + r.ms + 'ms');
  ok(id + ' 快照数值有限', r.bad.length === 0, r.bad.join(', '));
  ok(id + ' 快照体积', r.maxSnap < 6000, (r.maxSnap / 1024).toFixed(1) + ' KB');
  ok(id + ' 结果数量', r.res.length === n, r.res.length + ' 条');
  ok(id + ' 结果分数有限', r.res.every((x) => isFinite(x.score)),
    r.res.map((x) => x.name + ':' + x.score).join(' '));
  ok(id + ' 能正常结束', r.over, '用时 ' + (r.ticks / 60).toFixed(1) + 's');
  console.log('');
}

/* 你画我猜：状态机推进 */
(function drawTest() {
  const g = AR.games.draw;
  const ps = players(5);
  const st = g.create(ps, { seed: 7 });
  const dt = 1 / 60;
  let ticks = 0;
  let picked = 0;
  let guesses = 0;
  const phases = new Set();

  while (ticks < 60 * 90) {
    phases.add(st.phase);
    if (st.phase === 'choose' && st.drawerId) {
      g.drawData(st, st.drawerId, { n: 0 });
      picked++;
      phases.add(st.phase);        /* 选完就立刻全员开猜，这一瞬间也要记上 */
    }
    if (st.phase === 'draw' && st.word) {
      for (const p of ps) {
        if (p.id !== st.drawerId) {
          g.guess(st, p.id, st.word);
          guesses++;
        }
      }
    }
    g.tick(st, dt);
    ticks++;
    if (st.phase === 'over') break;
  }

  const res = g.results(st);
  ok('draw 选词流程', picked >= 1, '选词 ' + picked + ' 次');
  ok('draw 猜测计分', guesses > 0 && res[0].score > 0, '最高分 ' + (res[0] && res[0].score));
  ok('draw 阶段流转', phases.has('draw') && phases.has('reveal'), [...phases].join('/'));
  ok('draw 结果完整', res.length === 5, res.map((x) => x.name + ':' + x.score).join(' '));
  console.log('  轮次进度: ' + (st.turn + 1) + '/' + st.order.length + '，阶段 ' + st.phase);
  /* 蛇：撞自己不再死亡 */
  const sg3 = AR.games.snake;
  const ss3 = sg3.create(players(1), { seed: 21 });
  const sn3 = ss3.snakes.p0;
  sn3.alive = true;
  sn3.len = 30;
  sn3.trail = [];
  for (let k = 0; k < 30; k++) {
    sn3.trail.push({ x: sn3.x + Math.cos(k * 0.4) * 60, y: sn3.y + Math.sin(k * 0.4) * 60 });
  }
  sn3.x = sn3.trail[20].x;
  sn3.y = sn3.trail[20].y;
  const aliveBefore = sn3.alive;
  for (let i = 0; i < 20; i++) sg3.tick(ss3, 1 / 60);
  ok('蛇撞自己不再死亡', aliveBefore && sn3.alive === true, 'alive=' + sn3.alive);

  /* 蛇：转向要跟手（8 rad/s -> 90 度大约 0.2 秒） */
  const ss4 = sg3.create(players(1), { seed: 22 });
  const sn4 = ss4.snakes.p0;
  sn4.a = 0;
  sn4.x = ss4.w / 2;
  sn4.y = ss4.h / 2;
  for (let i = 0; i < 12; i++) {           /* 12 帧 = 0.2s */
    sg3.input(ss4, 'p0', { ax: sn4.x, ay: sn4.y + 400 });
    sg3.tick(ss4, 1 / 60);
  }
  const turned = Math.abs(AR.wrap(sn4.a - Math.PI / 2));
  ok('蛇转向足够快（0.2 秒转过 90 度）', turned < 0.5, '偏差 ' + turned.toFixed(2) + ' rad');

  /* 你画我猜：10 秒不选词就随机选 */
  const dg = AR.games.draw;
  const ds = dg.create(players(2), { seed: 33 });
  ok('画猜选词倒计时是 10 秒', Math.round(ds.timeLeft) === 10, 'tl=' + ds.timeLeft);
  const choicesSnapshot = ds.choices.map(function (c) { return (c && c.w) || c; });
  for (let i = 0; i < 620; i++) dg.tick(ds, 1 / 60);     /* 10.3 秒 */
  ok('超时自动开始作画', ds.phase === 'draw', 'phase=' + ds.phase);
  ok('自动选的是候选词之一', choicesSnapshot.indexOf(ds.word) >= 0, ds.word);

  /* 你画我猜：全员猜中立刻进入下一轮 */
  const ds2 = dg.create(players(2), { seed: 34 });
  const drawer = ds2.drawerId;
  const guesser = ds2.order.find((id) => id !== drawer);
  dg.drawData(ds2, drawer, { n: 0 });
  ok('选词后进入作画', ds2.phase === 'draw', 'phase=' + ds2.phase);
  const out = dg.guess(ds2, guesser, ds2.word);
  ok('猜对返回 correct', out && out.kind === 'correct', out && out.kind);
  ok('猜对后对外只给 ***', out && out.text === '***', out && out.text);
  for (let i = 0; i < 6; i++) dg.tick(ds2, 1 / 60);
  ok('全员猜中立刻进入揭晓', ds2.phase === 'reveal', 'phase=' + ds2.phase);
  ok('揭晓只留 3 秒', Math.round(ds2.timeLeft) <= 3, 'tl=' + ds2.timeLeft.toFixed(1));

  /* 选词消息必须是词面字符串，不能把 {w,h} 对象丢给前端（曾导致按钮显示 [object Object]） */
  const ds3 = dg.create(players(2), { seed: 41 });
  const cm = dg.privateFor(ds3, ds3.drawerId);
  ok('选词消息只发字符串', !!(cm && cm.list && cm.list.every(function (x) { return typeof x === 'string'; })),
    cm && cm.list ? JSON.stringify(cm.list) : 'null');

  /* 清空画布：只有画手能清，清完 strokes 归零 */
  const ds4 = dg.create(players(2), { seed: 42 });
  const dr4 = ds4.drawerId;
  const other4 = ds4.order.find(function (id) { return id !== dr4; });
  dg.drawData(ds4, dr4, { n: 0 });
  dg.drawData(ds4, dr4, { s: { x: 10, y: 10, e: 'b' } });
  dg.drawData(ds4, dr4, { s: { x: 30, y: 30, e: 'm' } });
  const before = ds4.strokes.length;
  const denied = dg.drawData(ds4, other4, { clear: 1 });
  const afterDenied = ds4.strokes.length;
  const allowed = dg.drawData(ds4, dr4, { clear: 1 });
  ok('画了两笔', before === 2, 'strokes=' + before);
  ok('非画手不能清空', denied === null && afterDenied === 2, 'strokes=' + afterDenied);
  ok('画手可以清空', allowed && allowed.t === 'paintClear' && ds4.strokes.length === 0);

  console.log('');
})();

/* 核心机制单点验证 */
(function mechanicTest() {
  console.log('=== 关键机制 ===');

  const tg = AR.games.tetris;
  const ts = tg.create(players(2), { seed: 1 });
  const tp = ts.players.p0;
  for (let y = 16; y < 20; y++) for (let x = 0; x < 10; x++) tp.board[y * 10 + x] = 1;
  for (let y = 16; y < 20; y++) tp.board[y * 10] = 0;
  tp.piece = { t: 'I', r: 1, x: -2, y: 0 };
  tp.queue.push('DROP');
  for (let i = 0; i < 20; i++) tg.tick(ts, 1 / 60);
  ok('tetris 四行消除', tp.lines >= 4, 'lines=' + tp.lines + ' score=' + tp.score);
  ok('tetris 给对手塞垃圾', ts.players.p1.pending > 0, 'pending=' + ts.players.p1.pending);

  const bg = AR.games.bomber;
  const bs = bg.create(players(2), { seed: 2 });
  const b0 = bs.players.p0, b1 = bs.players.p1;
  b0.cx = 1; b0.cy = 1; b0.fromX = 1; b0.fromY = 1; b0.moveT = 1;
  b1.cx = 2; b1.cy = 1; b1.fromX = 2; b1.fromY = 1; b1.moveT = 1;
  bg.input(bs, 'p0', { bomb: true });
  ok('bomber 放弹', bs.bombs.length === 1, 'bombs=' + bs.bombs.length);
  for (let i = 0; i < 170; i++) bg.tick(bs, 1 / 60);
  ok('bomber 爆炸击杀', b1.alive === false, 'p1.alive=' + b1.alive);

  /* 同帧连锁爆炸：explode 会一次删掉多颗炸弹，倒序循环不能读越界 */
  const bc = bg.create(players(2), { seed: 55 });
  bc.map.fill(0);
  bc.flames = [];
  bc.powerups = [];
  bc.players.p0.cx = 1; bc.players.p0.cy = 1;
  bc.players.p1.cx = 10; bc.players.p1.cy = 10;
  bc.bombs = [
    { cx: 1, cy: 1, timer: 0.001, range: 2, owner: 'p0', color: '#ff2e63' },
    { cx: 2, cy: 1, timer: 0.001, range: 2, owner: 'p0', color: '#ff2e63' }
  ];
  let chainErr = null;
  try { bg.tick(bc, 1 / 60); } catch (e) { chainErr = e; }
  ok('bomber 同帧连锁爆炸不崩溃', !chainErr && bc.bombs.length === 0 && bc.flames.length > 0,
    chainErr ? chainErr.message : ('bombs=' + bc.bombs.length + ' flames=' + bc.flames.length));

  /* 飞行棋：玩家中途退出后，剩余玩家的绝对格不能跟着重排 */
  const lg = AR.games.ludo;
  const lplayers = players(4);
  const ls = lg.create(lplayers, { seed: 77, planes: 2 });
  lplayers.forEach((p, i) => { ls.players[p.id].planes[0] = 5 + i * 2; });
  ls.turn = 2;                       /* p2 当前回合，退出的是 p1（下标更小） */
  const absPos = (snap, id) => {
    for (let i = 0; i < snap.pl.length; i++) {
      if (snap.pl[i][0] !== id) continue;
      return snap.pl[i][1] < 0 ? null : (snap.st[i] + snap.pl[i][1]) % 40;
    }
    return null;
  };
  const lsBefore = lg.snapshot(ls);
  const ludoBefore = {};
  lplayers.forEach((p) => { ludoBefore[p.id] = absPos(lsBefore, p.id); });
  lg.removePlayer(ls, 'p1');
  const lsAfter = lg.snapshot(ls);
  ['p0', 'p2', 'p3'].forEach((id) => {
    ok('飞行棋退场后 ' + id + ' 位置不漂移',
      absPos(lsAfter, id) === ludoBefore[id], ludoBefore[id] + ' -> ' + absPos(lsAfter, id));
  });
  ok('飞行棋退场后仍轮到原当前玩家', lsAfter.c === 'p2', 'current=' + lsAfter.c);
  ok('飞行棋快照带冻结起跑格', Array.isArray(lsAfter.st) && lsAfter.st.length === 3,
    JSON.stringify(lsAfter.st));

  const kg = AR.games.tank;
  const ks = kg.create(players(2), { seed: 4 });
  const k0 = ks.tanks.p0;
  const row = 5;
  ks.map[row * 40 + 3] = 0;
  ks.map[row * 40 + 4] = 0;
  ks.map[row * 40 + 5] = 2;
  k0.x = 3 * 40 + 20;
  k0.y = row * 40 + 20;
  k0.alive = true;
  ks.tanks.p1.alive = false;
  kg.input(ks, 'p0', { f: true, ax: k0.x + 200, ay: k0.y });
  const before = ks.map[row * 40 + 5];
  for (let i = 0; i < 30; i++) kg.tick(ks, 1 / 60);
  ok('tank 射击破砖', before === 2 && ks.map[row * 40 + 5] !== 2,
    'before=' + before + ' after=' + ks.map[row * 40 + 5]);

  const sg = AR.games.snake;
  const ss = sg.create(players(1), { seed: 9 });
  const snake = ss.snakes.p0;
  const len0 = snake.len;
  ss.orbs = [{ x: snake.x + 10, y: snake.y }];
  sg.input(ss, 'p0', { ax: snake.x + 100, ay: snake.y });
  for (let i = 0; i < 6; i++) sg.tick(ss, 1 / 60);
  ok('snake 吃光点增长', snake.len > len0, len0 + ' -> ' + snake.len);

  /* 鼠标转向：把光标放在蛇头正右方，蛇头应转到 0 弧度 */
  const sg2 = AR.games.snake;
  const ss2 = sg2.create(players(1), { seed: 11 });
  const sn2 = ss2.snakes.p0;
  sn2.a = Math.PI;
  sn2.x = ss2.w / 2;
  sn2.y = ss2.h / 2;
  for (let i = 0; i < 70; i++) {
    sg2.input(ss2, 'p0', { ax: sn2.x + 300, ay: sn2.y });
    sg2.tick(ss2, 1 / 60);
  }
  const da = Math.abs(AR.wrap(sn2.a));
  ok('snake 会朝鼠标方向转', da < 0.4, '偏差 ' + da.toFixed(2) + ' 弧度');

  /* 反方向也要灵 */
  for (let i = 0; i < 70; i++) {
    sg2.input(ss2, 'p0', { ax: sn2.x - 300, ay: sn2.y });
    sg2.tick(ss2, 1 / 60);
  }
  const da2 = Math.abs(Math.abs(AR.wrap(sn2.a)) - Math.PI);
  ok('snake 反向也能转', da2 < 0.4, '偏差 ' + da2.toFixed(2) + ' 弧度');

  console.log('');
})();

/* ============================================================
 * 合作弹幕 v2：不复活、增益、随机 BOSS
 * ============================================================ */
(function shmupV2Test() {
  console.log('=== 合作弹幕 v2 ===');
  const sg = AR.games.shmup;
  const meta = AR.GameConstants.SHMUP;

  const st = sg.create(players(2), { seed: 901 });
  const p0 = st.players.p0, p1 = st.players.p1;
  p0.inv = 0; p0.hp = 1;
  st.ebullets.push({ x: p0.x, y: p0.y, vx: 0, vy: 0 });
  sg.tick(st, 1 / 60);
  ok('shmup 被击毁后不复活', !p0.alive && p0.hp === 0, 'alive=' + p0.alive);
  for (let i = 0; i < 180; i++) sg.tick(st, 1 / 60);
  ok('shmup 3 秒后仍未复活', !p0.alive, 'alive=' + p0.alive);
  p1.inv = 0; p1.hp = 1;
  st.ebullets.push({ x: p1.x, y: p1.y, vx: 0, vy: 0 });
  sg.tick(st, 1 / 60);
  ok('shmup 全员被击毁后结束', !p1.alive && st.ended === true,
    'p1=' + p1.alive + ' ended=' + st.ended);

  const bs = sg.create(players(1), { seed: 902 });
  bs.rnd = function () { return 0; };
  const bp = bs.players.p0;
  bp.cool = 9999;
  bs.enemies.push({
    id: 'e1', type: 'grunt', x: bp.x, y: bp.y - 200,
    hp: 1, maxHp: 2, r: 18, vx: 0, vy: 0,
    fireTimer: 99, phase: 0, t: 0, score: 10
  });
  bs.pbullets.push({ x: bp.x, y: bp.y - 200, vx: 0, vy: -980, owner: 'p0', color: '#fff' });
  sg.tick(bs, 1 / 60);
  ok('shmup 击毁敌机掉落增益', bs.powerups.length === 1, 'drops=' + bs.powerups.length);
  const drop = bs.powerups[0];
  ok('shmup 掉落类型合法', !!drop && meta.BUFFS.some((b) => b.id === drop.type),
    drop && drop.type);
  const dropY = drop ? drop.y : 0;
  for (let i = 0; i < 30; i++) sg.tick(bs, 1 / 60);
  ok('shmup 增益向下快速漂移', !!drop && drop.y > dropY + 40,
    drop ? (dropY + ' -> ' + drop.y.toFixed(0)) : 'no drop');

  const us = sg.create(players(1), { seed: 903 });
  const up = us.players.p0;
  up.inv = 99;
  sg.input(us, 'p0', { dx: 0, dy: -1 });
  for (let i = 0; i < 120; i++) sg.tick(us, 1 / 60);
  ok('shmup 战机可以飞到上半区', up.y < 420, 'y=' + up.y.toFixed(0));

  bp.hp = 2;
  bs.powerups = [{ x: bp.x, y: bp.y, type: 'heal', life: 12, vy: 0 }];
  sg.tick(bs, 1 / 60);
  ok('shmup 修护恢复 1 点耐久', bp.hp === 3 && bs.powerups.length === 0, 'hp=' + bp.hp);

  bp.shield = 0;
  bs.powerups = [{ x: bp.x, y: bp.y, type: 'shield', life: 12, vy: 0 }];
  sg.tick(bs, 1 / 60);
  ok('shmup 护盾可叠加', bp.shield === 1, 'shield=' + bp.shield);

  bp.rapidT = 0;
  bs.powerups = [{ x: bp.x, y: bp.y, type: 'rapid', life: 12, vy: 0 }];
  sg.tick(bs, 1 / 60);
  ok('shmup 连发增益生效', bp.rapidT > 0, 'rapid=' + bp.rapidT.toFixed(1));

  bp.spreadT = 0;
  bs.powerups = [{ x: bp.x, y: bp.y, type: 'spread', life: 12, vy: 0 }];
  sg.tick(bs, 1 / 60);
  ok('shmup 散射增益生效', bp.spreadT > 0, 'spread=' + bp.spreadT.toFixed(1));

  bp.inv = 0;
  bs.ebullets = [{ x: 0, y: 0, vx: 0, vy: 0 }];
  bs.powerups = [{ x: bp.x, y: bp.y, type: 'purge', life: 12, vy: 0 }];
  sg.tick(bs, 1 / 60);
  ok('shmup 净化清弹并短暂无敌', bs.ebullets.length === 0 && bp.inv > 0,
    'bullets=' + bs.ebullets.length + ' inv=' + bp.inv.toFixed(2));

  ok('shmup 至少三种 BOSS', meta.BOSSES.length >= 3, 'bosses=' + meta.BOSSES.length);
  meta.BOSSES.forEach(function (bossMeta, idx) {
    const gs = sg.create(players(2), { seed: 700 + idx });
    gs.rnd = function () { return (idx + 0.1) / meta.BOSSES.length; };
    for (const id in gs.players) {
      gs.players[id].cool = 9999;
      gs.players[id].hp = 999;
      gs.players[id].maxHp = 999;
    }
    gs.time = 70;
    sg.tick(gs, 1 / 60);
    ok('shmup BOSS 类型可选中：' + bossMeta.id,
      !!gs.boss && gs.boss.type === bossMeta.id, gs.boss && gs.boss.type);
    let maxJump = 0;
    let lastX = gs.boss ? gs.boss.x : 0;
    let lastY = gs.boss ? gs.boss.y : 0;
    for (let i = 0; i < 480 && gs.boss; i++) {
      sg.tick(gs, 1 / 60);
      if (!gs.boss) break;
      const jump = Math.hypot(gs.boss.x - lastX, gs.boss.y - lastY);
      if (jump > maxJump) maxJump = jump;
      lastX = gs.boss.x;
      lastY = gs.boss.y;
    }
    ok('shmup BOSS ' + bossMeta.id + ' 入场无位置跳变', maxJump < 20,
      'max jump=' + maxJump.toFixed(1));
    ok('shmup BOSS ' + bossMeta.id + ' 会开火', gs.ebullets.length > 0,
      'bullets=' + gs.ebullets.length);
    const snap = sg.snapshot(gs);
    ok('shmup BOSS 快照带类型/名称',
      !!snap.b && snap.b.k === bossMeta.id && snap.b.nm === bossMeta.name,
      snap.b ? snap.b.k + '/' + snap.b.nm : 'null');
  });

  console.log('');
})();

console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
