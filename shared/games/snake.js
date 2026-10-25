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
  var STEP = 5;
  var ORB_N = 110;
  var ORB_R = 24;
  var EAT_R = 22;
  var START_POINTS = 24;
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
      trail: trail,
      input: { a: a }
    };
  }

  function respawnSnake(state, s) {
    var pos = spawnPoint(state, state.rnd, 300);
    s.x = pos.x;
    s.y = pos.y;
    s.a = state.rnd() * TAU;
    s.len = START_POINTS;
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
    scatterOrbs(state, s);
    state.events.push({ t: 'die', x: Math.round(s.x), y: Math.round(s.y), c: s.color });
    if (killer && killer !== s) {
      killer.kills++;
      killer.score += 5;
    }
  }

  AR.games.snake = {
    id: 'snake',

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

    removePlayer: function (state, id) {
      delete state.snakes[id];
    },

    input: function (state, id, inp) {
      var s = state.snakes[id];
      if (!s || !s.alive) return;
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
        s.a = AR.turnToward(s.a, s.input.a, TURN * dt);
        s.x += Math.cos(s.a) * SPEED * dt;
        s.y += Math.sin(s.a) * SPEED * dt;

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

      /* 撞身体检测 */
      for (id in state.snakes) {
        s = state.snakes[id];
        if (!s.alive) continue;
        for (var oid in state.snakes) {
          if (oid === id) continue;
          var o = state.snakes[oid];
          if (!o.alive) continue;
          var lim = Math.min(o.trail.length, o.len);
          for (i = 6; i < lim; i += 2) {
            var p = o.trail[i];
            if (AR.dist2(s.x, s.y, p.x, p.y) < 9 * 9) {
              killSnake(state, s, o);
              break;
            }
          }
          if (!s.alive) break;
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
            s.len = Math.min(MAX_POINTS, s.len + 2);
            s.score += 1;
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

    isOver: function (state) {
      return state.time >= state.duration;
    },

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

    /* 人机：朝最近光点走，同时对蛇身和墙做避让 */
    bot: function (state, id, dt, level) {
      var s = state.snakes[id];
      if (!s) return null;
      if (!s.alive) return { ax: s.x, ay: s.y };

      var skill = BOT_SKILL[level] || 0.7;
      var tx = s.x + Math.cos(s.a) * 160;
      var ty = s.y + Math.sin(s.a) * 160;

      var bd = Infinity;
      for (var i = 0; i < state.orbs.length; i++) {
        var o = state.orbs[i];
        var od = AR.dist2(s.x, s.y, o.x, o.y);
        if (od < bd) { bd = od; tx = o.x; ty = o.y; }
      }

      var dx = tx - s.x;
      var dy = ty - s.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len;
      dy /= len;

      /* 蛇身斥力：越近越强 */
      var look = 55 + skill * 95;
      var look2 = look * look;
      for (var oid in state.snakes) {
        var other = state.snakes[oid];
        if (!other.alive) continue;
        var lim = Math.min(other.trail.length, other.len);
        var startAt = (oid === id) ? 10 : 4;
        var stride = (oid === id) ? 5 : 3;
        for (var k = startAt; k < lim; k += stride) {
          var pt = other.trail[k];
          var rx = s.x - pt.x;
          var ry = s.y - pt.y;
          var dd = rx * rx + ry * ry;
          if (dd > look2 || dd < 1) continue;
          if (oid === id) continue;
          var w = (1 - Math.sqrt(dd) / look) * 1.2;
          dx += (rx / Math.sqrt(dd)) * w;
          dy += (ry / Math.sqrt(dd)) * w;
        }
      }

      /* 斥力限幅：否则身体一长就把自己困在原地 */
      var rl = Math.sqrt(dx * dx + dy * dy);
      if (rl > 1.4) {
        dx = dx / rl * 1.4;
        dy = dy / rl * 1.4;
      }

      /* 贴墙回拉 */
      var m = 170;
      if (s.x < m) dx += (1 - s.x / m) * 2.4;
      if (s.x > W - m) dx -= (1 - (W - s.x) / m) * 2.4;
      if (s.y < m) dy += (1 - s.y / m) * 2.4;
      if (s.y > H - m) dy -= (1 - (H - s.y) / m) * 2.4;

      /* 低难度：方向抖动 */
      var noise = (1 - skill) * 0.95 * Math.sin(state.time * 2.1 + id.length * 3.7);
      var ca = Math.cos(noise);
      var sa = Math.sin(noise);
      var ax = dx * ca - dy * sa;
      var ay = dx * sa + dy * ca;

      return { ax: s.x + ax * 240, ay: s.y + ay * 240 };
    },

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
          s: s.score
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
