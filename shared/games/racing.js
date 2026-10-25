/* ============================================================
 * 极速环线 · NEON RACING（服务端权威）
 * 俯视 2D 赛车：加速/刹车/转向/漂移，2 圈定胜负
 * 赛道用极坐标闭合曲线生成，保证不自交
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;

  var W = 2400, H = 1700;
  var CX = W / 2, CY = H / 2;
  var POINTS = 240;          /* 中心线采样点数 */
  var TOTAL_LAPS = 2;
  var DURATION = 150;

  var MAX_SPEED = 152;
  var REVERSE = 46;
  var ACCEL = 118;
  var BRAKE = 210;
  var DRAG = 0.004;
  var TURN = 2.35;
  var GRIP = 7.5;
  var CAR_R = 20;

  /* 人机水平 */
  var BOT_SKILL = { easy: 0.45, normal: 0.72, hard: 0.9, insane: 1.0 };

  /* ---------- 赛道 ---------- */
  var TRACKS = [
    {
      id: 'orbit', name: '环城高速',
      width: 156, fog: '#22d3ee', road: '#0c1622', edge: '#22d3ee',
      r: function (t) { return 650 + 95 * Math.sin(3 * t) + 30 * Math.cos(5 * t); }
    },
    {
      id: 'dunes', name: '沙丘回环',
      width: 148, fog: '#fbbf24', road: '#141018', edge: '#fbbf24',
      r: function (t) { return 610 + 150 * Math.sin(2 * t + 0.6) + 40 * Math.cos(3 * t); }
    },
    {
      id: 'vortex', name: '漩涡弯道',
      width: 142, fog: '#a855f7', road: '#0d1020', edge: '#a855f7',
      r: function (t) { return 580 + 120 * Math.sin(4 * t) + 55 * Math.sin(2 * t + 1.1); }
    },
    {
      id: 'harbor', name: '海港夜跑',
      width: 162, fog: '#3b82f6', road: '#08111c', edge: '#60a5fa',
      r: function (t) { return 660 + 80 * Math.cos(3 * t) + 45 * Math.sin(6 * t + 0.4); }
    }
  ];

  function buildTrack(def) {
    var xs = [];
    var ys = [];
    for (var i = 0; i < POINTS; i++) {
      var t = i / POINTS * Math.PI * 2;
      var rad = def.r(t);
      xs.push(CX + Math.cos(t) * rad);
      ys.push(CY + Math.sin(t) * rad * 0.86);
    }
    /* 轻微平滑，去掉极坐标采样的折角 */
    var sx = xs.slice();
    var sy = ys.slice();
    for (var pass = 0; pass < 2; pass++) {
      for (var k = 0; k < POINTS; k++) {
        var a = (k - 1 + POINTS) % POINTS;
        var b = (k + 1) % POINTS;
        sx[k] = (xs[a] + xs[k] * 2 + xs[b]) / 4;
        sy[k] = (ys[a] + ys[k] * 2 + ys[b]) / 4;
      }
      xs = sx.slice();
      ys = sy.slice();
    }
    return { xs: xs, ys: ys, width: def.width, def: def };
  }

  function nearestIndex(track, x, y, hint) {
    var best = 0;
    var bd = Infinity;
    /* 有 hint 时只搜附近一圈，快很多 */
    if (typeof hint === 'number' && hint >= 0) {
      for (var k = -14; k <= 14; k++) {
        var i = (hint + k + POINTS) % POINTS;
        var dx = track.xs[i] - x;
        var dy = track.ys[i] - y;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (bd < 260 * 260) return { i: best, d: Math.sqrt(bd) };
    }
    for (var j = 0; j < POINTS; j++) {
      var dx2 = track.xs[j] - x;
      var dy2 = track.ys[j] - y;
      var d2 = dx2 * dx2 + dy2 * dy2;
      if (d2 < bd) { bd = d2; best = j; }
    }
    return { i: best, d: Math.sqrt(bd) };
  }

  function trackAngle(track, i) {
    var j = (i + 2) % POINTS;
    return Math.atan2(track.ys[j] - track.ys[i], track.xs[j] - track.xs[i]);
  }

  /* 沿赛道往前走 dist 距离后的点下标（纯追踪用） */
  function pointAhead(track, idx, dist) {
    var acc = 0;
    var i = idx;
    for (var guard = 0; guard < POINTS; guard++) {
      var j = (i + 1) % POINTS;
      var dx = track.xs[j] - track.xs[i];
      var dy = track.ys[j] - track.ys[i];
      acc += Math.sqrt(dx * dx + dy * dy);
      i = j;
      if (acc >= dist) break;
    }
    return i;
  }

  function carName(p) { return p.name; }

  AR.games.racing = {
    id: 'racing',
    rate: 30,

    create: function (players, opt) {
      var seed = (opt && opt.seed) || Date.now();
      var rnd = AR.rng(seed);
      var def = TRACKS[Math.floor(rnd() * TRACKS.length)];
      var track = buildTrack(def);

      var state = {
        time: 0,
        duration: DURATION,
        totalLaps: TOTAL_LAPS,
        trackId: def.id,
        track: track,
        def: def,
        cars: {},
        order: []
      };

      players.forEach(function (p, i) {
        state.cars[p.id] = makeCar(track, p, i);
        state.order.push(p.id);
      });
      return state;
    },

    addPlayer: function (state, p) {
      if (state.cars[p.id]) return;
      state.cars[p.id] = makeCar(state.track, p, state.order.length);
      state.order.push(p.id);
    },

    removePlayer: function (state, id) {
      delete state.cars[id];
      var i = state.order.indexOf(id);
      if (i >= 0) state.order.splice(i, 1);
    },

    input: function (state, id, inp) {
      var c = state.cars[id];
      if (!c || c.finished) return;
      c.input = {
        t: AR.clamp(Number(inp.t) || 0, -1, 1),
        s: AR.clamp(Number(inp.s) || 0, -1, 1)
      };
    },

    tick: function (state, dt) {
      state.time += dt;
      var track = state.track;

      for (var id in state.cars) {
        var c = state.cars[id];
        if (c.finished) {
          /* 冲线后滑行减速 */
          c.vx *= 0.985;
          c.vy *= 0.985;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          continue;
        }
        stepCar(state, c, dt);
      }

      /* 车与车碰撞：简单圆形分离 */
      var ids = Object.keys(state.cars);
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          var a = state.cars[ids[i]];
          var b = state.cars[ids[j]];
          var dx = b.x - a.x;
          var dy = b.y - a.y;
          var d2 = dx * dx + dy * dy;
          var min = CAR_R * 2;
          if (d2 > min * min || d2 < 0.01) continue;
          var d = Math.sqrt(d2);
          var push = (min - d) / d * 0.5;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
          var rel = (b.vx - a.vx) * (dx / d) + (b.vy - a.vy) * (dy / d);
          if (rel < 0) {
            a.vx += (dx / d) * rel * 0.35;
            a.vy += (dy / d) * rel * 0.35;
            b.vx -= (dx / d) * rel * 0.35;
            b.vy -= (dy / d) * rel * 0.35;
          }
        }
      }

      /* 进度与圈数（基于中心线最近点） */
      for (id in state.cars) {
        var car = state.cars[id];
        if (car.finished) continue;
        var near = nearestIndex(track, car.x, car.y, car.lastIdx);
        var delta = near.i - car.lastIdx;
        if (delta < -POINTS / 2) car.laps++;
        else if (delta > POINTS / 2) car.laps--;
        car.lastIdx = near.i;
        car.offTrack = near.d > track.width / 2;
        car.progress = car.laps * POINTS + near.i;
        car.place = car.place || 1;

        if (car.laps >= state.totalLaps) {
          car.finished = true;
          car.finishAt = state.time;
        }
      }

      /* 排名 */
      var ranked = [];
      for (id in state.cars) ranked.push(state.cars[id]);
      ranked.sort(function (a, b) {
        if (a.finished && b.finished) return a.finishAt - b.finishAt;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.progress - a.progress;
      });
      for (i = 0; i < ranked.length; i++) ranked[i].place = i + 1;
    },

    isOver: function (state) {
      if (state.time >= state.duration) return true;
      for (var id in state.cars) {
        if (!state.cars[id].finished) return false;
      }
      return true;
    },

    results: function (state) {
      var list = [];
      for (var id in state.cars) {
        var c = state.cars[id];
        list.push({
          id: c.id,
          name: c.name,
          score: c.finished ? Math.max(1, Math.round(1000 - c.finishAt * 2)) : Math.max(0, c.laps * 100 + c.lastIdx),
          kills: c.laps,
          finished: c.finished ? 1 : 0,
          time: c.finished ? c.finishAt : 0
        });
      }
      list.sort(function (a, b) {
        if (a.finished !== b.finished) return b.finished - a.finished;
        if (a.finished) return a.time - b.time;
        return b.kills - a.kills;
      });
      return list;
    },

    meta: function (state) {
      var points = [];
      for (var i = 0; i < POINTS; i += 2) {
        points.push([Math.round(state.track.xs[i]), Math.round(state.track.ys[i])]);
      }
      return {
        w: W, h: H,
        width: state.track.width,
        laps: state.totalLaps,
        track: state.def.id,
        road: state.def.road,
        edge: state.def.edge,
        fog: state.def.fog,
        points: points,
        start: [Math.round(state.track.xs[0]), Math.round(state.track.ys[0])],
        startA: Math.round(trackAngle(state.track, 0) * 1000) / 1000
      };
    },

    snapshot: function (state) {
      var cars = [];
      for (var id in state.cars) {
        var c = state.cars[id];
        cars.push([
          c.id,
          Math.round(c.x),
          Math.round(c.y),
          Math.round(c.a * 100) / 100,
          Math.round(Math.hypot(c.vx, c.vy)),
          c.laps,
          c.place,
          c.finished ? 1 : 0,
          c.offTrack ? 1 : 0
        ]);
      }
      return {
        t: Math.round(state.time * 10) / 10,
        d: state.duration,
        w: W, h: H,
        laps: state.totalLaps,
        c: cars
      };
    },

    /* 人机：追前视点，弯前收油 */
    bot: function (state, id, dt, level) {
      var c = state.cars[id];
      if (!c || c.finished) return null;

      var skill = BOT_SKILL[level] || 0.7;
      var track = state.track;
      var speed = Math.hypot(c.vx, c.vy);

      /* 纯追踪 + 横向纠偏：先把车拉回中心线，再朝前方打方向 */
      var speedK = AR.clamp(speed / MAX_SPEED, 0, 1);
      var lookDist = 60 + speed * (0.42 + 0.22 * skill);
      if (c.offTrack) lookDist = 80;
      var ti = pointAhead(track, c.lastIdx, lookDist);

      /* 车到中心线的横向偏差，反向补偿一半，避免切内线切出赛道 */
      var nx = track.xs[c.lastIdx];
      var ny = track.ys[c.lastIdx];
      var offx = c.x - nx;
      var offy = c.y - ny;
      var offMag = Math.hypot(offx, offy);
      var bias = AR.clamp(offMag * 0.7, 0, 34) * (0.5 + 0.35 * skill);

      var tx = track.xs[ti] - (offx / (offMag || 1)) * bias;
      var ty = track.ys[ti] - (offy / (offMag || 1)) * bias;

      var want = Math.atan2(ty - c.y, tx - c.x);
      var diff = AR.wrap(want - c.a);

      /* 转向做速率限制：太快会左右来回摆，反而拖慢 */
      var steerRaw = AR.clamp(diff * (2.1 + skill * 1.5), -1, 1);
      c.aiSteer = (c.aiSteer === undefined)
        ? steerRaw
        : c.aiSteer + AR.clamp(steerRaw - c.aiSteer, -7 * dt, 7 * dt);
      var steer = AR.clamp(c.aiSteer, -1, 1);

      /* 前方弯道有多急：近处 + 远处各看一次，取更急的 */
      var fi = pointAhead(track, ti, lookDist * 2.4);
      var farA = Math.atan2(track.ys[fi] - track.ys[ti], track.xs[fi] - track.xs[ti]);
      var curve = Math.abs(AR.wrap(farA - want));

      /* 刹车：按「弯有多急 + 现在多快 + 转向误差」综合判断 */
      var need = curve * (0.7 + speedK * 0.9) + Math.abs(diff) * 0.8;
      var throttle;
      if (need > 1.45) throttle = 0.25;
      else if (need > 1.15) throttle = 0.5;
      else if (need > 0.88) throttle = 0.72;
      else if (need > 0.62) throttle = 0.88;
      else throttle = 1;

      /* 已经明显偏离中心线就先减速救回来 */
      if (offMag > 70) throttle = Math.min(throttle, 0.45);
      if (c.offTrack) throttle = Math.min(throttle, 0.5);

      /* 难度：菜鸟会手抖、会提前松油、极速也更低 */
      if (level === 'easy') {
        steer += Math.sin(state.time * 3 + id.length) * 0.22;
        throttle *= 0.8;
      } else if (level === 'normal') {
        steer += Math.sin(state.time * 2.4 + id.length) * 0.1;
        throttle *= 0.92;
      } else if (level === 'hard') {
        steer += Math.sin(state.time * 1.9) * 0.03;
      }
      throttle *= 0.8 + skill * 0.2;

      var capMul = level === 'easy' ? 0.74 : level === 'normal' ? 0.86 : level === 'hard' ? 0.95 : 1;
      if (speed > MAX_SPEED * capMul) throttle = Math.min(throttle, 0.25);

      return { t: throttle, s: AR.clamp(steer, -1, 1) };
    }
  };

  /* ---------- 单车物理 ---------- */
  function makeCar(track, p, index) {
    var col = index % 2;
    var row = Math.floor(index / 2);
    var back = 6 + row * 5 + col * 2;
    var i = (POINTS - back) % POINTS;
    var x = track.xs[i];
    var y = track.ys[i];
    var a = trackAngle(track, i);
    var nx = Math.cos(a + Math.PI / 2) * (col ? 1 : -1) * (track.width * 0.26);
    var ny = Math.sin(a + Math.PI / 2) * (col ? 1 : -1) * (track.width * 0.26);

    return {
      id: p.id,
      name: p.name,
      color: p.color,
      x: x + nx,
      y: y + ny,
      a: a,
      vx: 0,
      vy: 0,
      input: { t: 0, s: 0 },
      lastIdx: (POINTS - 1) % POINTS,
      laps: -1,
      progress: 0,
      place: index + 1,
      finished: false,
      finishAt: 0,
      offTrack: false
    };
  }

  function stepCar(state, c, dt) {
    var track = state.track;
    var inp = c.input;
    var throttle = inp.t;
    var steer = inp.s;

    var fx = Math.cos(c.a);
    var fy = Math.sin(c.a);
    var vFwd = c.vx * fx + c.vy * fy;
    var vLat = -c.vx * fy + c.vy * fx;

    var maxSpeed = MAX_SPEED;
    if (c.offTrack) maxSpeed = MAX_SPEED * 0.52;

    if (throttle > 0) vFwd += ACCEL * throttle * dt;
    else if (throttle < 0) vFwd += BRAKE * throttle * dt;

    /* 阻力（按时间积分，否则会被拖到龟速） */
    vFwd -= vFwd * Math.abs(vFwd) * DRAG * dt;
    if (c.offTrack) vFwd -= vFwd * 1.4 * dt;

    if (vFwd > maxSpeed) vFwd += (maxSpeed - vFwd) * Math.min(1, dt * 4);
    if (vFwd < -REVERSE) vFwd = -REVERSE;

    /* 转向灵敏度随速度上升，低速转不动 */
    var sf = Math.min(1, Math.abs(vFwd) / 16);
    c.a += steer * TURN * sf * dt * (vFwd < 0 ? -1 : 1);

    /* 侧向抓地 */
    vLat *= Math.exp(-GRIP * dt);

    var nx = Math.cos(c.a);
    var ny = Math.sin(c.a);
    c.vx = nx * vFwd - ny * vLat;
    c.vy = ny * vFwd + nx * vLat;

    c.x += c.vx * dt;
    c.y += c.vy * dt;

    /* 世界边界 */
    c.x = AR.clamp(c.x, 30, W - 30);
    c.y = AR.clamp(c.y, 30, H - 30);
  }

})(typeof window !== 'undefined' ? window : globalThis);
