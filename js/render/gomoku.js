/* ============================================================
 * 渲染层 · gomoku
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
   * 五子棋
   * ============================================================ */
  R.GOMOKU = AR.GameConstants.GOMOKU;

  R.gomokuCellXY = function (x, y, tf) {
    var g = R.GOMOKU;
    return { x: tf.ox + (g.PAD + x * g.CELL) * tf.s, y: tf.oy + (g.PAD + y * g.CELL) * tf.s };
  };

  /* 屏幕坐标 -> 棋盘格 */
  R.gomokuHit = function (mx, my, s) {
    var tf = V.tf;
    var wx = (mx - tf.ox) / tf.s;
    var wy = (my - tf.oy) / tf.s;
    var g = R.GOMOKU;
    var x = Math.round((wx - g.PAD) / g.CELL);
    var y = Math.round((wy - g.PAD) / g.CELL);
    if (x < 0 || y < 0 || x >= s.n || y >= s.n) return null;
    var dx = Math.abs(wx - (g.PAD + x * g.CELL));
    var dy = Math.abs(wy - (g.PAD + y * g.CELL));
    if (dx > g.CELL * 0.55 || dy > g.CELL * 0.55) return null;
    return { x: x, y: y };
  };

  R.gomoku = function (ctx, w, h, s, dt, G) {
    V.time = (V.time || 0) + (dt || 0);
    bg(ctx, w, h, '#0a0f18');
    var g = R.GOMOKU;
    var boardPx = g.PAD * 2 + (s.n - 1) * g.CELL;
    var tf = fit(w, h, boardPx, boardPx);
    V.tf = tf;

    ctx.save();
    ctx.translate(tf.ox, tf.oy);
    ctx.scale(tf.s, tf.s);

    /* 棋盘底色 */
    ctx.fillStyle = '#e8d3a8';
    roundRect(ctx, 0, 0, boardPx, boardPx, 10);
    ctx.fill();

    /* 网格 */
    ctx.strokeStyle = 'rgba(60,40,20,0.55)';
    ctx.lineWidth = 1.4;
    for (var i = 0; i < s.n; i++) {
      var p = g.PAD + i * g.CELL;
      ctx.beginPath(); ctx.moveTo(g.PAD, p); ctx.lineTo(boardPx - g.PAD, p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p, g.PAD); ctx.lineTo(p, boardPx - g.PAD); ctx.stroke();
    }
    /* 星位 */
    var stars = [[3,3],[11,3],[3,11],[11,11],[7,7]];
    ctx.fillStyle = 'rgba(60,40,20,0.75)';
    stars.forEach(function (st) {
      ctx.beginPath();
      ctx.arc(g.PAD + st[0] * g.CELL, g.PAD + st[1] * g.CELL, 4, 0, TAU);
      ctx.fill();
    });

    /* 棋子 */
    for (var y = 0; y < s.n; y++) {
      for (var x = 0; x < s.n; x++) {
        var v = s.b.charCodeAt(y * s.n + x) - 48;
        if (v !== 1 && v !== 2) continue;
        var cx = g.PAD + x * g.CELL;
        var cy = g.PAD + y * g.CELL;
        var rad = g.CELL * 0.42;
        ctx.beginPath();
        ctx.arc(cx + 1.5, cy + 2, rad, 0, TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, TAU);
        ctx.fillStyle = v === 1 ? '#1b1f27' : '#f6f8fc';
        ctx.fill();
        ctx.strokeStyle = v === 1 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    /* 最后一手：红圈 */
    if (s.last && s.win === null) {
      ctx.beginPath();
      ctx.arc(g.PAD + s.last[0] * g.CELL, g.PAD + s.last[1] * g.CELL, g.CELL * 0.5, 0, TAU);
      ctx.strokeStyle = '#ff2e63';
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }

    /* 连成五子的高亮：亮起并闪烁 */
    if (s.wl) {
      var blink = 0.45 + 0.55 * Math.abs(Math.sin((V.time || 0) * 6));
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.shadowColor = '#ff2e63';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = '#ff2e63';
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (var k = 0; k < s.wl.length; k++) {
        var wx = g.PAD + s.wl[k][0] * g.CELL;
        var wy = g.PAD + s.wl[k][1] * g.CELL;
        if (k === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
      /* 五颗棋子本身也套一圈光 */
      for (var k2 = 0; k2 < s.wl.length; k2++) {
        ctx.beginPath();
        ctx.arc(g.PAD + s.wl[k2][0] * g.CELL, g.PAD + s.wl[k2][1] * g.CELL, g.CELL * 0.46, 0, TAU);
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 最后落子的脉冲高亮 */
    if (s.last) {
      var pulse = 0.5 + 0.5 * Math.sin((V.time || 0) * 4);
      ctx.globalAlpha = 0.35 * pulse;
      ctx.beginPath();
      ctx.arc(g.PAD + s.last[0] * g.CELL, g.PAD + s.last[1] * g.CELL, g.CELL * 0.55, 0, TAU);
      ctx.fillStyle = '#ff2e63';
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /* 悬停预标记：轮到自己时，在空交叉点画半透明预落子和青色准星 */
    var hov = R.gomokuHover;
    if (hov && s.cur === G.me && !s.win && !s.draw && !s.pending &&
      s.b.charAt(hov.y * s.n + hov.x) === '0') {
      var hx = g.PAD + hov.x * g.CELL;
      var hy = g.PAD + hov.y * g.CELL;
      var mySide = s.sd && s.sd[G.me];
      var ghost = mySide === 2 ? '#f6f8fc' : '#1b1f27';
      ctx.save();
      ctx.strokeStyle = 'rgba(34,211,238,0.72)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx - g.CELL * 0.28, hy);
      ctx.lineTo(hx + g.CELL * 0.28, hy);
      ctx.moveTo(hx, hy - g.CELL * 0.28);
      ctx.lineTo(hx, hy + g.CELL * 0.28);
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(34,211,238,0.9)';
      ctx.beginPath();
      ctx.arc(hx, hy, g.CELL * 0.5, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = mySide === 2 ? 0.55 : 0.4;
      ctx.beginPath();
      ctx.arc(hx, hy, g.CELL * 0.42, 0, TAU);
      ctx.fillStyle = ghost;
      ctx.fill();
      ctx.globalAlpha = mySide === 2 ? 0.75 : 0.55;
      ctx.strokeStyle = mySide === 2 ? 'rgba(60,40,20,0.5)' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    /* 轮到谁 */
    var cur = null;
    for (var i2 = 0; i2 < G.players.length; i2++) if (G.players[i2].id === s.cur) cur = G.players[i2];
    if (!s.win) {
      label(ctx, (cur && cur.id === G.me ? '轮到你落子' : ('轮到 ' + (cur ? cur.name : ''))),
        w / 2, 30, (cur && cur.id === G.me) ? '#7fe7ff' : 'rgba(200,220,240,0.8)', 15);
    } else {
      label(ctx, '对局结束', w / 2, 30, '#fbbf24', 15);
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
