/* ============================================================
 * 蛇球大作战 · SNAKE ARENA（服务端权威模拟）
 *
 * 坐标单位 = 像素；竞技场 1600 x 1200
 * 身体由「尾迹点」构成：每移动 5px 记录一个点，len 即点数
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var TAU = Math.PI * 2;

  var W = 1600, H = 1200;
  var SPEED = 168;
  var TURN = 8.0;          /* 转向角速度：越大越跟手 */
  var BOOST_MULT = 1.65;   /* 按住左键加速的速度倍率 */
  var BOOST_STEP = 0.2;    /* 加速时每 0.2 秒扣 1 分，步长恒为 1，不出现小数 */
  var BOOST_POINT = 1;
  var STEP = 5;
  var ORB_N = 110;
  var ORB_R = 24;
  var EAT_R = 22;
  var START_POINTS = 24;
  var GROW_PER_SCORE = 2;   /* 每 1 分对应 2 节长度 */
  var MAX_POINTS = 420;
  var RESPAWN = 2.4;

  /* 人机水平：0-1，越低越"菜" */
  var BOT_SKILL = { easy: 0.35, normal: 0.62, hard: 0.85, insane: 1.0 };

  function spawnPoint(state, rnd, othersFar) {
    for (var t = 0; t < 40; t++) {
      var x = 90 + rnd() * (W - 180);
      var y = 90 + rnd() * (H - 180);
      var ok = true;
      for (var id in state.snakes) {
        var s = state.snakes[id];
        if (!s.alive) continue;
        if (AR.dist2(x, y, s.x, s.y) < (othersFar || 260) * (othersFar || 260)) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    return { x: 90 + rnd() * (W - 180), y: 90 + rnd() * (H - 180) };
  }

  function newSnake(state, p, rnd) {
    var pos = spawnPoint(state, rnd, 300);
    var a = rnd() * TAU;
    var trail = [];
    for (var i = 0; i < START_POINTS; i++) {
      trail.push({ x: pos.x - Math.cos(a) * i * STEP, y: pos.y - Math.sin(a) * i * STEP });
    }
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      x: pos.x,
      y: pos.y,
      a: a,
      len: START_POINTS,
      alive: true,
      respawn: 0,
      score: 0,
      kills: 0,
      boost: false,
      boostAcc: 0,
      aiHead: a,
      trail: trail,
      input: { a: a }
    };
  }

  /* 长度跟分数正相关：分数涨 -> 变长，加速掉分 -> 变短。
     这样一来"长度"不是一个独立的状态，永远是 score 的纯函数，
     省掉了到处手动维护 len 的 bug（之前被撞碎后长度没跟着清零）。 */
  function syncLen(s) {
    var want = START_POINTS + Math.round(Math.max(0, s.score) * GROW_PER_SCORE);
    s.len = Math.max(START_POINTS, Math.min(MAX_POINTS, want));
  }

  function respawnSnake(state, s) {
    var pos = spawnPoint(state, state.rnd, 300);
    s.x = pos.x;
    s.y = pos.y;
    s.a = state.rnd() * TAU;
    syncLen(s);
    s.alive = true;
    s.respawn = 0;
    s.trail = [];
    for (var i = 0; i < START_POINTS; i++) {
      s.trail.push({ x: s.x - Math.cos(s.a) * i * STEP, y: s.y - Math.sin(s.a) * i * STEP });
    }
  }

  function scatterOrbs(state, s) {
    var n = Math.min(14, Math.max(4, Math.floor(s.len / 3)));
    for (var i = 0; i < n; i++) {
      var ang = state.rnd() * TAU;
      var d = 10 + state.rnd() * 60;
      state.orbs.push({
        x: AR.clamp(s.x + Math.cos(ang) * d, 24, W - 24),
        y: AR.clamp(s.y + Math.sin(ang) * d, 24, H - 24)
      });
    }
  }

  function killSnake(state, s, killer) {
    if (!s.alive) return;
    s.alive = false;
    s.respawn = RESPAWN;
    /* 先按死亡时的长度散落光点，再把分数清零、长度回到初始 */
    scatterOrbs(state, s);
    s.score = 0;
    syncLen(s);
    state.events.push({ t: 'die', x: Math.round(s.x), y: Math.round(s.y), c: s.color });
    if (killer && killer !== s) {
      state.events.push({
        t: 'kill', by: killer.id, name: killer.name, color: killer.color,
        victim: s.id, vname: s.name, vcolor: s.color
      });
      killer.kills++;
      killer.score += 5;
      syncLen(killer);
    }
  }

  /* 点到线段的距离平方：只抽查 trail 点会在长蛇身上漏判，
     线段判定能覆盖"头从两个采样点之间穿过"的情况。 */
  function segDist2(px, py, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var l2 = dx * dx + dy * dy;
    var t = 0;
    if (l2 > 0) {
      t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    var qx = a.x + dx * t;
    var qy = a.y + dy * t;
    return AR.dist2(px, py, qx, qy);
  }

  /* 空间网格：长蛇的 trail 点很多，逐对逐点扫描会随长度增长而卡顿。
     先把所有蛇身线段放进 40px 网格，蛇头只检查周围格子。 */
  function buildTrailGrid(state) {
    var cell = 40;
    var grid = new Map();
    for (var id in state.snakes) {
      var o = state.snakes[id];
      if (!o.alive) continue;
      var lim = Math.min(o.trail.length, o.len);
      for (var i = 2; i < lim; i++) {
        var a = o.trail[i - 1];
        var b = o.trail[i];
        var minX = Math.min(a.x, b.x) - 14;
        var maxX = Math.max(a.x, b.x) + 14;
        var minY = Math.min(a.y, b.y) - 14;
        var maxY = Math.max(a.y, b.y) + 14;
        var cx0 = Math.floor(minX / cell);
        var cx1 = Math.floor(maxX / cell);
        var cy0 = Math.floor(minY / cell);
        var cy1 = Math.floor(maxY / cell);
        for (var cx = cx0; cx <= cx1; cx++) {
          for (var cy = cy0; cy <= cy1; cy++) {
            var key = cx + ',' + cy;
            var list = grid.get(key);
            if (!list) {
              list = [];
              grid.set(key, list);
            }
            list.push({ id: id, a: a, b: b });
          }
        }
      }
    }
    return { cell: cell, grid: grid };
  }

  AR.games.snake = {
    id: 'snake',

    /* 建立对局状态。players 里带 bot 字段的是人机。返回的 state 之后会一直被 tick 修改。 */
    create: function (players, opt) {
      var seed = (opt && opt.seed) || Math.floor(Math.random() * 1e9);
      var rnd = AR.rng(seed);
      var state = {
        w: W, h: H,
        time: 0,
        duration: (opt && opt.duration) || 90,
        rnd: rnd,
        snakes: {},
        orbs: [],
        events: []
      };
      for (var i = 0; i < players.length; i++) {
        state.snakes[players[i].id] = newSnake(state, players[i], rnd);
      }
      for (var k = 0; k < ORB_N; k++) {
        state.orbs.push({ x: 30 + rnd() * (W - 60), y: 30 + rnd() * (H - 60) });
      }
      return state;
    },

    addPlayer: function (state, p) {
      state.snakes[p.id] = newSnake(state, p, state.rnd);
    },

    /* 玩家中途退出，把他从对局里摘掉，避免一直等他操作。 */
    removePlayer: function (state, id) {
      delete state.snakes[id];
    },

    /* 处理一次玩家操作。inp 的结构由 js/input.js 里对应分支决定。 */
    input: function (state, id, inp) {
      var s = state.snakes[id];
      if (!s || !s.alive) return;
      /* 按住左键加速：分数为 0 时加速不生效 */
      if (typeof inp.boost === 'boolean') s.boost = inp.boost;
      else if (typeof inp.boost === 'number') s.boost = inp.boost > 0;
      /* 客户端发的是鼠标的世界坐标（ax/ay），换算成朝向角 */
      if (typeof inp.ax === 'number' && typeof inp.ay === 'number' &&
        isFinite(inp.ax) && isFinite(inp.ay)) {
        var dx = inp.ax - s.x;
        var dy = inp.ay - s.y;
        if (dx * dx + dy * dy > 12 * 12) s.input.a = Math.atan2(dy, dx);
      } else if (typeof inp.a === 'number' && isFinite(inp.a)) {
        s.input.a = inp.a;
      }
    },

    /* 推进一帧，dt 固定为 1/60 秒。这里只能改 state，不要读时间/文件/网络。 */
    tick: function (state, dt) {
      state.time += dt;
      var rnd = state.rnd;
      var i, id, s;

      for (id in state.snakes) {
        s = state.snakes[id];
        if (!s.alive) {
          s.respawn -= dt;
          if (s.respawn <= 0) respawnSnake(state, s);
          continue;
        }
        /* 加速：速度翻倍但持续掉分，掉到 0 自动断 */
        var boosting = s.boost && s.score > 0;
        if (s.boost && s.score <= 0) s.boost = false;
        if (boosting) {
          /* 每满 0.2 秒扣 1 分，分数保持整数 */
          s.boostAcc = (s.boostAcc || 0) + dt;
          while (s.boostAcc >= BOOST_STEP && s.score > 0) {
            s.boostAcc -= BOOST_STEP;
            s.score = Math.max(0, Math.round(s.score) - BOOST_POINT);
          }
          syncLen(s);
          if (s.score <= 0) {
            s.score = 0;
            s.boost = false;
            boosting = false;
            s.boostAcc = 0;
            syncLen(s);
          }
        } else {
          s.boostAcc = 0;
        }
        s.boosting = boosting;
        var sp = SPEED * (boosting ? BOOST_MULT : 1);

        s.a = AR.turnToward(s.a, s.input.a, TURN * dt);
        s.x += Math.cos(s.a) * sp * dt;
        s.y += Math.sin(s.a) * sp * dt;

        /* 边界：贴着墙滑行，不致死 */
        var m = 14;
        if (s.x < m) { s.x = m; if (Math.cos(s.a) < 0) s.a = Math.PI - s.a; }
        if (s.x > W - m) { s.x = W - m; if (Math.cos(s.a) > 0) s.a = Math.PI - s.a; }
        if (s.y < m) { s.y = m; if (Math.sin(s.a) < 0) s.a = -s.a; }
        if (s.y > H - m) { s.y = H - m; if (Math.sin(s.a) > 0) s.a = -s.a; }

        var head = s.trail[0];
        if (!head || AR.dist2(head.x, head.y, s.x, s.y) >= STEP * STEP) {
          s.trail.unshift({ x: s.x, y: s.y });
          while (s.trail.length > s.len + 4) s.trail.pop();
        }
        while (s.trail.length > s.len + 4) s.trail.pop();
      }

      /* 撞身体检测：线段 + 空间网格，长蛇也不会出现抽样漏判或卡顿 */
      var trailGrid = buildTrailGrid(state);
      for (id in state.snakes) {
        s = state.snakes[id];
        if (!s.alive) continue;
        var cell = trailGrid.cell;
        var gx0 = Math.floor((s.x - 12) / cell);
        var gx1 = Math.floor((s.x + 12) / cell);
        var gy0 = Math.floor((s.y - 12) / cell);
        var gy1 = Math.floor((s.y + 12) / cell);
        for (var gx = gx0; gx <= gx1 && s.alive; gx++) {
          for (var gy = gy0; gy <= gy1 && s.alive; gy++) {
            var segs = trailGrid.grid.get(gx + ',' + gy);
            if (!segs) continue;
            for (var k = 0; k < segs.length; k++) {
              var seg = segs[k];
              if (seg.id === id) continue;
              var owner = state.snakes[seg.id];
              if (!owner || !owner.alive) continue;
              if (segDist2(s.x, s.y, seg.a, seg.b) < 12 * 12) {
                killSnake(state, s, owner);
                break;
              }
            }
          }
        }
        /* 撞自己不再死亡：允许盘成麻花 */
      }

      /* 吃光点 */
      for (id in state.snakes) {
        s = state.snakes[id];
        if (!s.alive) continue;
        for (i = state.orbs.length - 1; i >= 0; i--) {
          var orb = state.orbs[i];
          if (AR.dist2(s.x, s.y, orb.x, orb.y) < EAT_R * EAT_R) {
            state.orbs.splice(i, 1);
            s.score += 1;
            syncLen(s);
            if (state.orbs.length < ORB_N && rnd() < 0.5) {
              state.orbs.push({ x: 30 + rnd() * (W - 60), y: 30 + rnd() * (H - 60) });
            }
          }
        }
      }

      while (state.orbs.length < ORB_N) {
        state.orbs.push({ x: 30 + rnd() * (W - 60), y: 30 + rnd() * (H - 60) });
      }
    },

    /* 服务端每帧问一次。返回 true 时这一局结束，会调 results() 结算。 */
    isOver: function (state) {
      return state.time >= state.duration;
    },

    /* 结算：返回 [{id, name, score, ...}]，服务端按顺序写进战绩。 */
    results: function (state) {
      var list = [];
      for (var id in state.snakes) {
        var s = state.snakes[id];
        list.push({ id: s.id, name: s.name, score: s.score, kills: s.kills });
      }
      list.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return b.kills - a.kills;
      });
      return list;
    },

    /* 人机：前方锥形优先选光点 + 朝向平滑，避免原地打转 */
    /* 人机决策，返回一个 input 对象（或 null 表示这一帧什么都不做）。 */
    bot: function (state, id, dt, level) {
      var s = state.snakes[id];
      if (!s) return null;
      if (!s.alive) return { ax: s.x, ay: s.y };

      var skill = BOT_SKILL[level] || 0.7;
      var fx = Math.cos(s.a);
      var fy = Math.sin(s.a);

      /* 选目标：越靠前的光点得分越高，避免为了身后的光点急掉头 */
      var best = null;
      var bestScore = -Infinity;
      for (var i = 0; i < state.orbs.length; i++) {
        var o = state.orbs[i];
        var ox = o.x - s.x;
        var oy = o.y - s.y;
        var od = Math.sqrt(ox * ox + oy * oy) || 1;
        var dot = (ox * fx + oy * fy) / od;          /* 1 = 正前方，-1 = 正后方 */
        var sc = dot * 2.2 - od / 700;
        if (sc > bestScore) { bestScore = sc; best = o; }
      }

      var dx = 0;
      var dy = 0;
      if (best) {
        dx = best.x - s.x;
        dy = best.y - s.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= len;
        dy /= len;
      } else {
        dx = fx;
        dy = fy;
      }

      /* 蛇身斥力：越近越强（自己不再算，因为撞自己不死） */
      var look = 70 + skill * 90;
      var look2 = look * look;
      for (var oid in state.snakes) {
        if (oid === id) continue;
        var other = state.snakes[oid];
        if (!other.alive) continue;
        var lim = Math.min(other.trail.length, other.len);
        for (var k = 4; k < lim; k += 3) {
          var pt = other.trail[k];
          var rx = s.x - pt.x;
          var ry = s.y - pt.y;
          var dd = rx * rx + ry * ry;
          if (dd > look2 || dd < 1) continue;
          var w = (1 - Math.sqrt(dd) / look) * 1.3;
          dx += (rx / Math.sqrt(dd)) * w;
          dy += (ry / Math.sqrt(dd)) * w;
        }
      }

      /* 贴墙回拉：只在一个身位内生效，避免被墙推得原地转圈 */
      var m = 110;
      if (s.x < m) dx += (1 - s.x / m) * 2.2;
      if (s.x > W - m) dx -= (1 - (W - s.x) / m) * 2.2;
      if (s.y < m) dy += (1 - s.y / m) * 2.2;
      if (s.y > H - m) dy -= (1 - (H - s.y) / m) * 2.2;

      /* 斥力限幅：别让避让完全盖掉目标方向 */
      var rl = Math.sqrt(dx * dx + dy * dy);
      if (rl > 1.5) {
        dx = dx / rl * 1.5;
        dy = dy / rl * 1.5;
      }

      /* 低难度：加一点方向噪声（每个蛇相位不同） */
      var noise = (1 - skill) * 0.7 * Math.sin(state.time * 1.6 + s.aiHead * 3.1 + s.x * 0.01);
      var ca = Math.cos(noise);
      var sa = Math.sin(noise);
      var ax = dx * ca - dy * sa;
      var ay = dx * sa + dy * ca;

      /* 关键：期望朝向自己也做速率限制，避免每帧 180 度来回翻 */
      var want = Math.atan2(ay, ax);
      var turnRate = 2.6 + skill * 3.0;
      s.aiHead = AR.turnToward(s.aiHead === undefined ? s.a : s.aiHead, want, turnRate * dt);

      return { ax: s.x + Math.cos(s.aiHead) * 220, ay: s.y + Math.sin(s.aiHead) * 220 };
    },

    /* 发给所有客户端的状态，必须是纯 JSON（不能有函数/循环引用/NaN）。 */
    snapshot: function (state) {
      var arr = [];
      for (var id in state.snakes) {
        var s = state.snakes[id];
        arr.push({
          i: s.id,
          x: Math.round(s.x * 10) / 10,
          y: Math.round(s.y * 10) / 10,
          a: Math.round(s.a * 100) / 100,
          l: s.len,
          al: s.alive ? 1 : 0,
          b: s.boosting ? 1 : 0,
          s: Math.round(s.score)
        });
      }
      var orbs = [];
      for (var k = 0; k < state.orbs.length; k++) {
        orbs.push(Math.round(state.orbs[k].x), Math.round(state.orbs[k].y));
      }
      var ev = state.events;
      state.events = [];
      return {
        w: W, h: H,
        t: Math.round(state.time * 10) / 10,
        d: state.duration,
        s: arr,
        o: orbs,
        e: ev
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
