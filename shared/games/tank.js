/* ============================================================
 * 坦克竞技场 · TANK ARENA（服务端权威）
 * 地图：40 x 30 格，每格 40px；砖墙可打穿，石墙不可破
 * 地图值：0 空 1 石墙 2 砖墙(满) 3 砖墙(损)
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var TAU = Math.PI * 2;

  var TILE = 40;
  var TW = 40, TH = 30;
  var W = TW * TILE, H = TH * TILE;
  var R = 17;
  var SPEED = 178;
  var BULLET_SPEED = 560;
  var FIRE_CD = 0.40;
  var MAX_BULLETS = 5;
  var RESPAWN = 2.4;
  var DURATION = 150;

  /* 人机水平：0-1 */
  var BOT_SKILL = { easy: 0.3, normal: 0.58, hard: 0.8, insane: 0.96 };

  function tileAt(state, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) return 1;
    return state.map[ty * TW + tx];
  }

  /* 圆形坦克与格子的碰撞（采样包围盒 8 点） */
  function hitsMap(state, x, y, r) {
    if (x - r < 0 || y - r < 0 || x + r > W || y + r > H) return true;
    var pts = [
      [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r],
      [x, y - r], [x, y + r], [x - r, y], [x + r, y]
    ];
    for (var i = 0; i < pts.length; i++) {
      var t = tileAt(state, Math.floor(pts[i][0] / TILE), Math.floor(pts[i][1] / TILE));
      if (t !== 0) return true;
    }
    return false;
  }

  /* 两点之间第一个挡路的格子：返回 { v: 地图值, cx, cy }，畅通返回 null */
  function losFirstBlock(state, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return null;
    var steps = Math.ceil(dist / 14);
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      var x = x1 + dx * t;
      var y = y1 + dy * t;
      var tx = Math.floor(x / TILE);
      var ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) return { v: 1, cx: x, cy: y };
      var v = state.map[ty * TW + tx];
      if (v !== 0) {
        return { v: v, cx: tx * TILE + TILE / 2, cy: ty * TILE + TILE / 2 };
      }
    }
    return null;
  }


  function makeMap(rnd) {
    var w = new Array(TW * TH).fill(0);
    var x, y, k;

    /* 随机石块掩体（2-5 格大小的矩形） */
    for (k = 0; k < 22; k++) {
      var bw = 2 + Math.floor(rnd() * 3.4);
      var bh = 2 + Math.floor(rnd() * 2.4);
      var x0 = 2 + Math.floor(rnd() * (TW - 4 - bw));
      var y0 = 2 + Math.floor(rnd() * (TH - 4 - bh));
      for (y = y0; y < y0 + bh; y++) {
        for (x = x0; x < x0 + bw; x++) w[y * TW + x] = 1;
      }
    }

    /* 石墙边缘长砖墙 */
    for (y = 1; y < TH - 1; y++) {
      for (x = 1; x < TW - 1; x++) {
        var idx = y * TW + x;
        if (w[idx] !== 0) continue;
        var near = w[(y - 1) * TW + x] === 1 || w[(y + 1) * TW + x] === 1 ||
          w[idx - 1] === 1 || w[idx + 1] === 1;
        if (rnd() < (near ? 0.34 : 0.035)) w[idx] = 2;
      }
    }

    for (x = 0; x < TW; x++) { w[x] = 1; w[(TH - 1) * TW + x] = 1; }
    for (y = 0; y < TH; y++) { w[y * TW] = 1; w[y * TW + TW - 1] = 1; }

    /* 出生点周边清空 */
    [[3, 3], [TW - 4, 3], [3, TH - 4], [TW - 4, TH - 4],
     [Math.floor(TW / 2), 3], [Math.floor(TW / 2), TH - 4],
     [3, Math.floor(TH / 2)], [TW - 4, Math.floor(TH / 2)]].forEach(function (s) {
      for (var yy = -2; yy <= 2; yy++) {
        for (var xx = -2; xx <= 2; xx++) {
          var tx = s[0] + xx, ty = s[1] + yy;
          if (tx > 0 && ty > 0 && tx < TW - 1 && ty < TH - 1) w[ty * TW + tx] = 0;
        }
      }
    });
    return w;
  }

  var SPAWNS = [
    { tx: 3, ty: 3 }, { tx: TW - 4, ty: 3 }, { tx: 3, ty: TH - 4 }, { tx: TW - 4, ty: TH - 4 },
    { tx: Math.floor(TW / 2), ty: 3 }, { tx: Math.floor(TW / 2), ty: TH - 4 },
    { tx: 3, ty: Math.floor(TH / 2) }, { tx: TW - 4, ty: Math.floor(TH / 2) }
  ];

  function spawnTank(state, p, index) {
    var s = SPAWNS[index % SPAWNS.length];
    var x = s.tx * TILE + TILE / 2;
    var y = s.ty * TILE + TILE / 2;
    return {
      id: p.id, name: p.name, color: p.color,
      x: x, y: y,
      body: Math.atan2(H / 2 - y, W / 2 - x),
      aim: Math.atan2(H / 2 - y, W / 2 - x),
      hp: 3, alive: true, respawn: 0, cool: 0,
      score: 0, kills: 0, deaths: 0,
      input: {}
    };
  }

  function respawnTank(state, t) {
    /* 选一个离其他坦克最远的出生点 */
    var best = SPAWNS[0], bestD = -1;
    for (var i = 0; i < SPAWNS.length; i++) {
      var x = SPAWNS[i].tx * TILE + TILE / 2;
      var y = SPAWNS[i].ty * TILE + TILE / 2;
      var d = 1e9;
      for (var id in state.tanks) {
        var o = state.tanks[id];
        if (o === t || !o.alive) continue;
        d = Math.min(d, AR.dist2(x, y, o.x, o.y));
      }
      if (d > bestD) { bestD = d; best = SPAWNS[i]; }
    }
    t.x = best.tx * TILE + TILE / 2;
    t.y = best.ty * TILE + TILE / 2;
    t.hp = 3;
    t.alive = true;
    t.respawn = 0;
    t.cool = 0.6;
    t.aim = Math.atan2(H / 2 - t.y, W / 2 - t.x);
  }

  function killTank(state, t, killer) {
    if (!t.alive) return;
    t.alive = false;
    t.hp = 0;
    t.respawn = RESPAWN;
    t.deaths++;
    state.events.push({ t: 'boom', x: Math.round(t.x), y: Math.round(t.y), c: t.color });
    if (killer && killer.id !== t.id) {
      killer.kills++;
      killer.score += 3;
    }
  }

  function fire(state, t) {
    var count = 0;
    for (var i = 0; i < state.bullets.length; i++) {
      if (state.bullets[i].owner === t.id) count++;
    }
    if (count >= MAX_BULLETS) return;
    var bx = t.x + Math.cos(t.aim) * 22;
    var by = t.y + Math.sin(t.aim) * 22;
    state.bullets.push({
      x: bx, y: by,
      vx: Math.cos(t.aim) * BULLET_SPEED,
      vy: Math.sin(t.aim) * BULLET_SPEED,
      owner: t.id,
      color: t.color,
      life: 1.8
    });
    t.cool = FIRE_CD;
    state.events.push({ t: 'shot', x: Math.round(bx), y: Math.round(by), c: t.color });
  }

  AR.games.tank = {
    id: 'tank',

    create: function (players, opt) {
      var rnd = AR.rng((opt && opt.seed) || Date.now());
      var state = {
        w: W, h: H, tw: TW, th: TH, tile: TILE,
        time: 0,
        duration: (opt && opt.duration) || DURATION,
        rnd: rnd,
        map: makeMap(rnd),
        tanks: {},
        bullets: [],
        events: [],
        mapDirty: true,
        order: []
      };
      for (var i = 0; i < players.length; i++) {
        state.tanks[players[i].id] = spawnTank(state, players[i], i);
        state.order.push(players[i].id);
      }
      return state;
    },

    meta: function (state) {
      return {
        w: state.w, h: state.h, tw: state.tw, th: state.th, tile: state.tile,
        map: state.map.join('')
      };
    },

    addPlayer: function (state, p) {
      state.tanks[p.id] = spawnTank(state, p, Object.keys(state.tanks).length);
    },

    removePlayer: function (state, id) {
      delete state.tanks[id];
      state.bullets = state.bullets.filter(function (b) { return b.owner !== id; });
    },

    input: function (state, id, inp) {
      var t = state.tanks[id];
      if (t) t.input = inp || {};
    },

    tick: function (state, dt) {
      state.time += dt;
      var id, t, i;

      for (id in state.tanks) {
        t = state.tanks[id];
        if (!t.alive) {
          t.respawn -= dt;
          if (t.respawn <= 0) respawnTank(state, t);
          continue;
        }
        var inp = t.input || {};
        if (typeof inp.ax === 'number' && isFinite(inp.ax)) {
          t.aim = Math.atan2(inp.ay - t.y, inp.ax - t.x);
        }
        var dx = Number(inp.dx) || 0;
        var dy = Number(inp.dy) || 0;
        var len = Math.hypot(dx, dy);
        if (len > 0.01) {
          dx /= len; dy /= len;
          var nx = t.x + dx * SPEED * dt;
          var ny = t.y + dy * SPEED * dt;
          if (!hitsMap(state, nx, t.y, R)) t.x = nx;
          if (!hitsMap(state, t.x, ny, R)) t.y = ny;
          t.body = AR.turnToward(t.body, Math.atan2(dy, dx), 10 * dt);
        }
        t.cool -= dt;
        if (inp.f && t.cool <= 0) fire(state, t);
      }

      /* 子弹 */
      for (i = state.bullets.length - 1; i >= 0; i--) {
        var b = state.bullets[i];
        b.life -= dt;
        if (b.life <= 0) { state.bullets.splice(i, 1); continue; }

        var steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 6));
        var dead = false;
        for (var s = 0; s < steps && !dead; s++) {
          b.x += (b.vx * dt) / steps;
          b.y += (b.vy * dt) / steps;

          if (b.x < 0 || b.y < 0 || b.x > W || b.y > H) { dead = true; break; }
          var tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
          var tv = tileAt(state, tx, ty);
          if (tv === 1) { dead = true; break; }
          if (tv === 2) {
            state.map[ty * TW + tx] = 3;
            state.mapDirty = true;
            dead = true;
            state.events.push({ t: 'hit', x: Math.round(b.x), y: Math.round(b.y) });
            break;
          }
          if (tv === 3) {
            state.map[ty * TW + tx] = 0;
            state.mapDirty = true;
            dead = true;
            state.events.push({ t: 'brk', x: Math.round(b.x), y: Math.round(b.y) });
            break;
          }

          for (var oid in state.tanks) {
            var o = state.tanks[oid];
            if (!o.alive || o.id === b.owner) continue;
            if (AR.dist2(b.x, b.y, o.x, o.y) < (R + 4) * (R + 4)) {
              o.hp--;
              state.events.push({ t: 'hit', x: Math.round(b.x), y: Math.round(b.y) });
              if (o.hp <= 0) killTank(state, o, state.tanks[b.owner]);
              dead = true;
              break;
            }
          }
        }
        if (dead) state.bullets.splice(i, 1);
      }

    },

    isOver: function (state) {
      return state.time >= state.duration;
    },

    results: function (state) {
      var list = [];
      for (var id in state.tanks) {
        var t = state.tanks[id];
        list.push({ id: t.id, name: t.name, score: t.score, kills: t.kills, deaths: t.deaths });
      }
      list.sort(function (a, b) {
        if (b.kills !== a.kills) return b.kills - a.kills;
        return a.deaths - b.deaths;
      });
      return list;
    },

    /* 人机：有视野才对射，砖墙可以打穿，石墙就绕 */
    bot: function (state, id, dt, level) {
      var t = state.tanks[id];
      if (!t || !t.alive) return { dx: 0, dy: 0, f: false };

      var skill = BOT_SKILL[level] || 0.6;
      var h = 0;
      for (var k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) | 0;
      var ai = t.ai || (t.ai = {
        side: (Math.abs(h) % 2) ? 1 : -1,
        flip: 2 + (Math.abs(h) % 240) / 100
      });
      ai.flip -= dt;
      if (ai.flip <= 0) {
        ai.flip = 2.5 + (ai.flip + state.time) % 3;
        ai.side *= -1;
      }

      /* 优先选“能打到”的最近目标 */
      var target = null;
      var bestScore = Infinity;
      var targetBlock = null;
      for (var oid in state.tanks) {
        if (oid === id) continue;
        var o = state.tanks[oid];
        if (!o.alive) continue;
        var d = AR.dist(t.x, t.y, o.x, o.y);
        var blk = losFirstBlock(state, t.x, t.y, o.x, o.y);
        var score = d + (blk && blk.v === 1 ? 900 : (blk ? 260 : 0));
        if (score < bestScore) { bestScore = score; target = o; targetBlock = blk; }
      }
      if (!target) return { dx: 0, dy: 0, f: false };

      var dist = AR.dist(t.x, t.y, target.x, target.y);
      var aim = Math.atan2(target.y - t.y, target.x - t.x);

      /* 反应速度：低难度瞄准更新慢，打移动目标会偏 */
      var lag = 0.62 - skill * 0.5;
      if (typeof ai.aimAngle !== 'number' || state.time >= (ai.nextAim || 0)) {
        ai.aimAngle = aim;
        ai.nextAim = state.time + lag;
      }
      var err = (1 - skill) * 0.12 * Math.sin(state.time * 2.3 + id.length * 2.1);
      var ax = Math.cos(ai.aimAngle + err);
      var ay = Math.sin(ai.aimAngle + err);

      var mx = 0;
      var my = 0;
      var fire = false;

      if (!targetBlock) {
        /* 通视：拉开距离对射，时不时侧向游走 */
        if (dist > 460) { mx = ax; my = ay; }
        else if (dist < 200) { mx = -ax; my = -ay; }
        else if (skill > 0.55) {
          /* 高难度边打边走位，低难度站桩挨打 */
          mx = -ay * ai.side;
          my = ax * ai.side;
        }
        fire = dist < 780;
      } else if (targetBlock.v === 2 || targetBlock.v === 3) {
        /* 砖墙：离得近就先把墙打穿，远就绕过去 */
        var bd = AR.dist(t.x, t.y, targetBlock.cx, targetBlock.cy);
        if (bd < 300) {
          aim = Math.atan2(targetBlock.cy - t.y, targetBlock.cx - t.x);
          ax = Math.cos(aim);
          ay = Math.sin(aim);
          fire = true;
        } else {
          mx = -ay * ai.side;
          my = ax * ai.side;
        }
      } else {
        /* 石墙：纯绕行，绝不隔着墙开火 */
        mx = -ay * ai.side;
        my = ax * ai.side;
      }

      /* 撞墙就换一边绕 */
      if ((mx || my) && hitsMap(state, t.x + mx * 36, t.y + my * 36, R)) {
        var tx2 = -my * ai.side;
        var ty2 = mx * ai.side;
        if (!hitsMap(state, t.x + tx2 * 36, t.y + ty2 * 36, R)) {
          mx = tx2;
          my = ty2;
        } else {
          mx = ax;
          my = ay;
        }
      }

      var shootX = Math.cos(aim + err);
      var shootY = Math.sin(aim + err);

      return {
        dx: mx,
        dy: my,
        ax: t.x + shootX * 300,
        ay: t.y + shootY * 300,
        f: fire
      };
    },

    snapshot: function (state) {
      var p = [];
      for (var id in state.tanks) {
        var t = state.tanks[id];
        p.push({
          i: t.id,
          x: Math.round(t.x),
          y: Math.round(t.y),
          b: Math.round(t.body * 100) / 100,
          a: Math.round(t.aim * 100) / 100,
          h: t.hp,
          al: t.alive ? 1 : 0,
          s: t.score
        });
      }
      var b = [];
      for (var k = 0; k < state.bullets.length; k++) {
        var bu = state.bullets[k];
        b.push([Math.round(bu.x), Math.round(bu.y), bu.color]);
      }
      var ev = state.events;
      state.events = [];
      var mapStr;
      if (state.mapDirty) {
        mapStr = state.map.join('');
        state.mapDirty = false;
      }
      return {
        w: W, h: H,
        t: Math.round(state.time * 10) / 10,
        d: state.duration,
        p: p,
        b: b,
        e: ev,
        m: mapStr
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
