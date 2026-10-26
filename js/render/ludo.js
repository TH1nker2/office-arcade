/* ============================================================
 * 渲染层 · ludo
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var TAU = Math.PI * 2;
  var V = AR.View;
  var R = AR.Render;
  var U = R.util;
  var roundRect = U.roundRect, fit = U.fit, bg = U.bg, label = U.label;
  var glowCircle = U.glowCircle, particles = U.particles, addBurst = U.addBurst;
  var stepParticles = U.stepParticles, drawParticles = U.drawParticles;
  var handleEvents = U.handleEvents, nameColor = U.nameColor;

  /* ============================================================
   * 飞行棋
   * ============================================================ */
  var LUDO = { W: 1200, H: 1200, C: 600, R: 430, N: 40, HOME: 4 };

  function ludoStart(n, idx) { return Math.floor(idx * LUDO.N / n); }

  function ludoAngle(cell) {
    return cell / LUDO.N * TAU - Math.PI / 2;
  }

  function ludoCellXY(cell) {
    var a = ludoAngle(cell);
    return { x: LUDO.C + Math.cos(a) * LUDO.R, y: LUDO.C + Math.sin(a) * LUDO.R, a: a };
  }

  function ludoHomeXY(n, idx, k) {
    var a = ludoAngle(ludoStart(n, idx));
    var r = 360 - 50 * k;                 /* 360 / 310 / 260 / 210，给中央骰子留出空间 */
    return { x: LUDO.C + Math.cos(a) * r, y: LUDO.C + Math.sin(a) * r, a: a };
  }

  function ludoBaseCenter(n, idx) {
    var a = ludoAngle(ludoStart(n, idx)) + Math.PI / 4;
    return { x: LUDO.C + Math.cos(a) * 250, y: LUDO.C + Math.sin(a) * 250, a: a };
  }

  function ludoBaseXY(n, idx, slot) {
    var c = ludoBaseCenter(n, idx);
    /* 最多 4 架，排成 2x2，避免第 3、4 架画在第 1、2 架上面 */
    var col = slot % 2 ? 1 : -1;
    var row = slot >= 2 ? 1 : -1;
    var ox = Math.cos(c.a + Math.PI / 2) * 26 * col;
    var oy = Math.sin(c.a + Math.PI / 2) * 26 * col;
    /* 第二排沿半径方向往外挪一点 */
    var bx = Math.cos(c.a) * 20 * row;
    var by = Math.sin(c.a) * 20 * row;
    return {
      x: c.x + ox + bx,
      y: c.y + oy + by,
      a: c.a + Math.PI / 2
    };
  }

  /* 某架飞机在棋盘上的坐标；返回 null 表示到家了 */
  R.ludoPlaneXY = function (n, idx, pos, slotIndex) {
    if (pos === LUDO.N + LUDO.HOME) return null;
    if (pos < 0) return ludoBaseXY(n, idx, slotIndex || 0);
    if (pos < LUDO.N) return ludoCellXY((ludoStart(n, idx) + pos) % LUDO.N);
    return ludoHomeXY(n, idx, pos - LUDO.N);
  };

  /* 点击命中：只在「当前回合玩家」的飞机里找，返回 0/1 或 -1 */
  R.ludoHitTest = function (mx, my, s) {
    var tf = V.tf;
    var wx = (mx - tf.ox) / tf.s;
    var wy = (my - tf.oy) / tf.s;
    var best = -1;
    var bestD = 52;
    for (var i = 0; i < (s.pl || []).length; i++) {
      var row = s.pl[i];
      if (row[0] !== s.c) continue;
      for (var k = 0; k < row.length - 1; k++) {
        var pos = row[k + 1];
        if (s.mv && s.mv.indexOf(k) < 0) continue;
        var xy = R.ludoPlaneXY(s.n, i, pos, k);
        if (!xy) continue;
        var d = Math.hypot(xy.x - wx, xy.y - wy);
        if (d < bestD) { bestD = d; best = k; }
      }
    }
    return best;
  };

  R.ludo = function (ctx, w, h, s, dt, G) {
    bg(ctx, w, h, '#070b13');
    var tf = fit(w, h, LUDO.W, LUDO.H);
    V.tf = tf;

    var n = s.n || 4;
    var startCells = [];
    for (var i = 0; i < n; i++) startCells.push(ludoStart(n, i));

    ctx.save();
    ctx.translate(tf.ox, tf.oy);
    ctx.scale(tf.s, tf.s);

    /* 底盘 */
    ctx.fillStyle = '#0a1220';
    ctx.beginPath();
    ctx.arc(LUDO.C, LUDO.C, LUDO.R + 74, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,211,238,0.16)';
    ctx.lineWidth = 3;
    ctx.stroke();

    /* 环上的 40 格 */
    for (var c = 0; c < LUDO.N; c++) {
      var pos = ludoCellXY(c);
      var owner = startCells.indexOf(c);
      var safe = [0, 7, 14, 21, 28, 35].indexOf(c) >= 0;
      var color = owner >= 0 ? ((G.players[owner] || {}).color || '#22d3ee') : null;

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pos.a + Math.PI / 2);
      ctx.fillStyle = color ? AR.rgba(color, 0.34) : (safe ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.05)');
      roundRect(ctx, -19, -19, 38, 38, 9);
      ctx.fill();
      ctx.strokeStyle = color ? AR.rgba(color, 0.9) : (safe ? 'rgba(251,191,36,0.5)' : 'rgba(120,160,210,0.22)');
      ctx.lineWidth = safe || color ? 2.4 : 1.4;
      ctx.stroke();
      ctx.restore();

      if (safe) {
        ctx.fillStyle = 'rgba(251,191,36,0.75)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 3.4, 0, TAU);
        ctx.fill();
      }
    }

    /* 归航道 + 基地 */
    for (var pi = 0; pi < n; pi++) {
      var pl = G.players[pi] || {};
      var col = pl.color || '#22d3ee';
      for (var k = 0; k < LUDO.HOME; k++) {
        var hp = ludoHomeXY(n, pi, k);
        ctx.save();
        ctx.translate(hp.x, hp.y);
        ctx.rotate(hp.a + Math.PI / 2);
        ctx.fillStyle = AR.rgba(col, 0.16 + k * 0.03);
        roundRect(ctx, -16, -16, 32, 32, 8);
        ctx.fill();
        ctx.strokeStyle = AR.rgba(col, 0.5);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
      /* 基地圆 */
      var bc = ludoBaseCenter(n, pi);
      ctx.fillStyle = AR.rgba(col, 0.08);
      ctx.beginPath();
      ctx.arc(bc.x, bc.y, 60, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = AR.rgba(col, 0.28);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    /* 飞机 */
    for (var pj = 0; pj < n; pj++) {
      var row = s.pl[pj];
      if (!row) continue;
      var pcol = (G.players[pj] || {}).color || '#22d3ee';
      var mine = row[0] === G.me;
      var planeN = row.length - 1;
      for (var q = 0; q < planeN; q++) {
        var ppx = row[q + 1];
        var xy = R.ludoPlaneXY(n, pj, ppx, q);
        if (!xy) continue;
        var isTurn = row[0] === s.c;
        drawPlane(ctx, xy.x, xy.y, xy.a, pcol, mine, isTurn && ppx >= 0 && ppx < LUDO.N, ppx + LUDO.N * pj);
      }
    }

    /* 中央骰子 */
    var cx = LUDO.C;
    var cy = LUDO.C;
    var myTurn = s.c === G.me && (s.ph === 'roll' || s.ph === 'move');
    ctx.save();
    ctx.globalAlpha = myTurn ? 1 : 0.75;
    ctx.fillStyle = 'rgba(10,18,30,0.92)';
    roundRect(ctx, cx - 58, cy - 58, 116, 116, 22);
    ctx.fill();
    ctx.strokeStyle = myTurn ? 'rgba(34,211,238,0.9)' : 'rgba(120,160,210,0.25)';
    ctx.lineWidth = myTurn ? 3 : 1.5;
    ctx.stroke();

    if (s.dice > 0) {
      drawDicePips(ctx, cx, cy, s.dice);
    } else {
      label(ctx, '掷骰', cx, cy - 8, 'rgba(160,190,220,0.8)', 22);
      label(ctx, '点击', cx, cy + 22, 'rgba(120,150,180,0.7)', 13);
    }
    ctx.restore();

    /* 轮到谁 */
    var curName = '';
    for (var ci = 0; ci < G.players.length; ci++) {
      if (G.players[ci].id === s.c) curName = G.players[ci].name;
    }
    label(ctx, myTurn ? '轮到你了' : ('轮到 ' + curName),
      cx, cy + 84, myTurn ? '#7fe7ff' : 'rgba(200,220,240,0.85)', myTurn ? 18 : 15);
    if (myTurn && s.ph === 'roll') {
      label(ctx, '点击棋盘掷骰子', cx, cy + 110, '#fbbf24', 13);
    } else if (myTurn && s.ph === 'move') {
      label(ctx, '点击要走的飞机', cx, cy + 110, '#fbbf24', 13);
    }

    ctx.restore();

  };

  function drawPlane(ctx, x, y, a, color, mine, active, seed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    if (active) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = mine ? color : AR.shade(color, -0.15);
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -11);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = mine ? '#ffffff' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = mine ? 2 : 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function drawDicePips(ctx, cx, cy, v) {
    var pos = {
      1: [[0, 0]],
      2: [[-1, -1], [1, 1]],
      3: [[-1, -1], [0, 0], [1, 1]],
      4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
      5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
      6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
    }[v] || [];
    ctx.fillStyle = '#e9f2ff';
    pos.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(cx + p[0] * 26, cy + p[1] * 26, 8, 0, TAU);
      ctx.fill();
    });
  }

})(typeof window !== 'undefined' ? window : globalThis);
