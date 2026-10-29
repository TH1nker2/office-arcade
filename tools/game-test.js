#!/usr/bin/env node
/* 无浏览器逻辑测试：动作/回合游戏模拟，验证稳定性、快照大小、结果与关键机制 */
'use strict';

const path = require('path');
for (const f of ['core', 'registry', 'games/constants']) require(path.join(__dirname, '..', 'shared', f + '.js'));
for (const g of ['tank', 'tetris', 'shmup', 'draw', 'gomoku', 'undercover']) {
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

console.log('=== 动作/对战游戏逻辑模拟 ===');

const cases = [
  ['tank', 4, 150, 150],
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

  const badX = dg.drawData(ds4, dr4, { s: { x: Infinity, y: 10, e: 'm' } });
  const badY = dg.drawData(ds4, dr4, { s: { x: 10, y: 9999, e: 'm' } });
  const badPrev = dg.drawData(ds4, dr4, { s: { x: 10, y: 10, p: [9999, 10], e: 'm' } });
  ok('画猜拒绝非法笔迹', badX === null && badY === null && badPrev === null && ds4.strokes.length === 0,
    'badX=' + badX + ' badY=' + badY + ' badPrev=' + badPrev);
  ds4.strokes = new Array(4000).fill([0, 0, 'm', '#111827']);
  dg.drawData(ds4, dr4, { s: { x: 10, y: 10, e: 'm' } });
  ok('画猜笔迹上限 4000', ds4.strokes.length === 4000, 'strokes=' + ds4.strokes.length);

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

  const tq = tg.create(players(2), { seed: 2 });
  for (let i = 0; i < 200; i++) tg.input(tq, 'p0', { ev: 'L' });
  ok('tetris 输入队列有上限', tq.players.p0.queue.length <= 32, 'queue=' + tq.players.p0.queue.length);

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

/* ============================================================
 * 五子棋：悔棋 / 和棋 / 认输
 * ============================================================ */
(function gomokuActionsTest() {
  console.log('=== 五子棋操作 ===');
  const g = AR.games.gomoku;
  const st = g.create(players(2), { seed: 33 });
  g.input(st, 'p0', { x: 7, y: 7 });
  g.input(st, 'p1', { x: 8, y: 8 });
  ok('gomoku 落子写入历史', st.history.length === 2 && st.moves === 2,
    'history=' + st.history.length);

  g.input(st, 'p0', { act: 'undo' });
  ok('gomoku 悔棋请求挂起', !!st.pending && st.pending.type === 'undo' && st.req.undo === 1,
    JSON.stringify(st.pending));
  g.input(st, 'p1', { x: 9, y: 9 });
  ok('gomoku 等待同意时不能落子', st.board[9 * 15 + 9] === 0 && st.moves === 2,
    'moves=' + st.moves);
  g.input(st, 'p1', { act: 'reply', accept: true });
  ok('gomoku 同意悔棋撤销最近一手',
    st.history.length === 1 && st.moves === 1 && st.board[8 * 15 + 8] === 0,
    'history=' + st.history.length + ' moves=' + st.moves);
  ok('gomoku 悔棋后轮到被撤销方', st.order[st.turn % st.order.length] === 'p1',
    'current=' + st.order[st.turn % st.order.length]);

  g.input(st, 'p1', { act: 'draw' });
  ok('gomoku 和棋请求挂起', !!st.pending && st.pending.type === 'draw' && st.req.draw === 1,
    JSON.stringify(st.pending));
  g.input(st, 'p0', { act: 'reply', accept: true });
  const drawRes = g.results(st);
  ok('gomoku 同意和棋结束本局', st.ended === true && st.draw === true);
  ok('gomoku 和棋结果双方都是平局',
    drawRes.length === 2 && drawRes.every((r) => r.draw && r.score === 50),
    drawRes.map((r) => r.name + ':' + r.score + '/' + r.draw).join(' '));

  const st2 = g.create(players(2), { seed: 34 });
  for (let i = 0; i < 3; i++) {
    g.input(st2, 'p0', { act: 'draw' });
    g.input(st2, 'p1', { act: 'reply', accept: false });
  }
  g.input(st2, 'p0', { act: 'draw' });
  ok('gomoku 每局最多发起 3 次和棋', st2.req.draw === 3 && !st2.pending,
    'draw=' + st2.req.draw);

  const st3 = g.create(players(2), { seed: 35 });
  g.input(st3, 'p0', { x: 7, y: 7 });
  g.input(st3, 'p1', { act: 'resign' });
  const resignRes = g.results(st3);
  ok('gomoku 认输立即结束', st3.ended === true && st3.winnerId === 'p0');
  ok('gomoku 认输后胜者是对方', resignRes[0] && resignRes[0].id === 'p0');

  console.log('');
})();

/* ============================================================
 * 谁是卧底：身份、描述、投票、平票、胜负与个人名次
 * ============================================================ */
(function undercoverTest() {
  console.log('=== 谁是卧底 ===');
  const g = AR.games.undercover;
  const pairs = [{ a: '可乐', b: '雪碧' }];

  function advance(st, seconds) {
    for (let i = 0; i < Math.round(seconds * 60) + 2; i++) g.tick(st, 1 / 60);
  }
  function passDescriptions(st) {
    let guard = 0;
    while (st.phase === 'describe' && guard++ < 30) {
      const id = st.turnOrder[st.turn];
      g.input(st, id, { act: 'describe', text: '第 ' + guard + ' 条描述' });
    }
    return guard;
  }
  function voteAll(st, targetFn) {
    const alive = st.order.filter((id) => st.alive[id]);
    alive.forEach((id) => {
      const target = targetFn(id, alive);
      if (target && target !== id && st.alive[target]) {
        g.input(st, id, { act: 'vote', target: target });
      }
    });
  }
  function firstUndercover(st) {
    return st.order.find((id) => st.roles[id] === 'undercover');
  }
  function startVoting(st) {
    advance(st, 5.2);
    passDescriptions(st);
  }

  const ps6 = players(6);
  const st = g.create(ps6, { seed: 100, pairs: pairs });
  const ucIds = st.order.filter((id) => st.roles[id] === 'undercover');
  const civIds = st.order.filter((id) => st.roles[id] === 'civilian');
  ok('6 人局 1 卧底 5 平民', ucIds.length === 1 && civIds.length === 5,
    'uc=' + ucIds.length + ' civ=' + civIds.length);
  [[4, 2, 1], [5, 3, 1], [6, 3, 1], [7, 3, 1], [8, 4, 2],
    [9, 4, 2], [10, 4, 2], [11, 4, 3], [12, 5, 3]].forEach(([n, rounds, want]) => {
    const bs = g.create(players(n), { seed: 900 + n, pairs: pairs });
    const got = bs.order.filter((id) => bs.roles[id] === 'undercover').length;
    ok(n + ' 人局固定配置', bs.maxRounds === rounds && got === want,
      'rounds=' + bs.maxRounds + ' uc=' + got);
  });
  ok('平民拿到同一个词', civIds.every((id) => st.words[id] === st.words[civIds[0]]), st.words[civIds[0]]);
  ok('卧底拿到同一个词', ucIds.every((id) => st.words[id] === st.words[ucIds[0]]), st.words[ucIds[0]]);
  ok('平民和卧底的词不同', st.words[civIds[0]] !== st.words[ucIds[0]]);
  ok('6 人局固定 3 轮', st.maxRounds === 3, 'maxRounds=' + st.maxRounds);
  ok('开局先进入准备阶段', st.phase === 'brief', st.phase);

  const snap0 = g.snapshot(st);
  ok('公开快照不泄露身份', snap0.roles === null && !('words' in snap0) &&
    JSON.stringify(snap0).indexOf(st.words[civIds[0]]) < 0);
  const pm = g.privateFor(st, ucIds[0]);
  ok('私有消息只含自己的身份和词',
    pm && pm.role === 'undercover' && pm.word === st.words[ucIds[0]] &&
    !('team' in pm) && !('teammates' in pm) && !('roles' in pm) && !('words' in pm),
    JSON.stringify(pm));
  const duo = g.create(players(8), { seed: 901, pairs: pairs });
  const duoUc = duo.order.filter((id) => duo.roles[id] === 'undercover');
  ok('卧底之间互不知道队友', duoUc.length === 2 && g.privateFor(duo, duoUc[1]).role === 'undercover' &&
    !('team' in g.privateFor(duo, duoUc[1])));

  advance(st, 5.2);
  ok('准备结束进入描述', st.phase === 'describe', st.phase);
  const first = st.turnOrder[st.turn];
  const other = st.order.find((id) => id !== first);
  g.input(st, other, { act: 'describe', text: '抢答' });
  ok('不是自己的发言顺序不能描述', st.desc.length === 0, 'desc=' + st.desc.length);
  g.input(st, first, { act: 'describe', text: '我喜欢' + st.words[first] });
  ok('描述不能包含自己的词', st.desc.length === 0 &&
    st.events.some((e) => e.t === 'invalid' && e.to === first), 'desc=' + st.desc.length);
  const longText = '这'.repeat(50);
  g.input(st, first, { act: 'describe', text: longText });
  ok('描述最多 40 字', st.desc.length === 1 && st.desc[0].t.length === 40,
    'len=' + (st.desc[0] && st.desc[0].t.length));
  const beforeVoteDesc = st.desc.length;
  passDescriptions(st);
  ok('所有存活玩家发言后立刻投票', st.phase === 'vote', st.phase);
  ok('描述记录只保留本轮', beforeVoteDesc >= 1 && st.desc.length === 6, 'desc=' + st.desc.length);

  const voteSnap = g.snapshot(st);
  ok('投票期间公开快照不泄露票型', !('votes' in voteSnap));
  const alive6 = st.order.filter((id) => st.alive[id]);
  g.input(st, alive6[0], { act: 'vote', target: alive6[0] });
  ok('不能投自己', !st.voted[alive6[0]]);

  /* 两两对投 -> 全员各 1 票，平票无人出局 */
  alive6.forEach((id, i) => {
    const partner = alive6[i % 2 === 0 ? i + 1 : i - 1];
    g.input(st, id, { act: 'vote', target: partner });
  });
  ok('未投票时直播不公布票数', voteSnap.voted.length === 0);
  ok('平票无人出局', st.lastOut && st.lastOut.tie === true &&
    alive6.every((id) => st.alive[id]), JSON.stringify(st.lastOut));
  ok('平票进入公布阶段', st.phase === 'reveal', st.phase);
  advance(st, 5.2);
  ok('公布后进入下一轮', st.round === 2 && st.phase === 'describe' && st.desc.length === 0,
    'round=' + st.round + ' phase=' + st.phase);

  /* 描述超时自动记为未描述，并轮到下一位 */
  const tps = players(4);
  const tos = g.create(tps, { seed: 105, pairs: pairs });
  advance(tos, 5.2);
  const timeoutFirst = tos.turnOrder[tos.turn];
  advance(tos, 30.2);
  ok('描述超时自动跳过', tos.desc.length === 1 && tos.desc[0].t.indexOf('时间到') >= 0 &&
    tos.desc[0].i === timeoutFirst, JSON.stringify(tos.desc[0]));

  /* 平民全票投卧底 -> 平民胜 */
  const cps = players(4);
  const cs = g.create(cps, { seed: 101, pairs: pairs });
  startVoting(cs);
  const uc1 = firstUndercover(cs);
  voteAll(cs, (id) => (id === uc1 ? cs.order.find((x) => x !== id && cs.roles[x] === 'civilian') : uc1));
  ok('投出卧底后进入公布', cs.lastOut && cs.lastOut.id === uc1 && cs.lastOut.role === 'undercover',
    JSON.stringify(cs.lastOut));
  advance(cs, 5.2);
  ok('卧底全部出局平民获胜', cs.ended && cs.winner === 'civilian', 'winner=' + cs.winner);
  const cres = g.results(cs);
  ok('个人名次按个人得分排序',
    cres.length === 4 && cres[0].role === 'civilian' && cres[0].score === 120 &&
    cres.every((r, i) => i === 0 || cres[i - 1].score >= r.score),
    cres.map((r) => r.name + ':' + r.role + '/' + r.score + '/k' + r.kills).join(' '));
  ok('正确票计入个人战绩', cres.filter((r) => r.role === 'civilian').every((r) => r.kills === 1) &&
    cres.find((r) => r.id === uc1).kills === 0);
  ok('胜负标记写入结果', cres.every((r) => r.win === (r.role === 'civilian')), JSON.stringify(cres.map((r) => r.win)));

  /* 一直平票 -> 到轮数上限卧底胜 */
  const mps = players(4);
  const ms = g.create(mps, { seed: 102, pairs: pairs });
  for (let round = 0; round < 2; round++) {
    if (ms.phase === 'brief') advance(ms, 5.2);
    passDescriptions(ms);
    advance(ms, 25.2);       /* 全员超时 -> 0 票平票 */
    advance(ms, 5.2);
  }
  ok('到达最大轮数卧底获胜', ms.ended && ms.winner === 'undercover',
    'round=' + ms.round + ' winner=' + ms.winner);

  /* 卧底中途退出：立即按剩余人数重算胜负 */
  const lps = players(4);
  const ls = g.create(lps, { seed: 104, pairs: pairs });
  const leavingUc = firstUndercover(ls);
  g.removePlayer(ls, leavingUc);
  ok('卧底退出后平民直接获胜', ls.ended && ls.winner === 'civilian',
    'winner=' + ls.winner);
  ok('退出玩家不再出现在结果里', g.results(ls).every((r) => r.id !== leavingUc));

  console.log('');
})();

console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
