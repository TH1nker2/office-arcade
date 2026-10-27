/* ============================================================
 * 渲染层 · bomber
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
   * 炸弹人
   * ============================================================ */
  R.bomber = function (ctx, w, h, s, dt, G) {
    bg(ctx, w, h, '#060a12');
    var tf = fit(w - 40, h - 90, s.w, s.h);
    tf.oy += 70;
    V.tf = tf;
    var d = V.data;
    if (!d.map && G.meta && G.meta.map) d.map = G.meta.map;
    if (s.m) d.map = s.m;
    var parts = particles('p');
    handleEvents(parts, s.e, 'bomber');
    stepParticles(parts, dt);

    ctx.save();
    ctx.translate(tf.ox, tf.oy);
    ctx.scale(tf.s, tf.s);

    var TILE = 48, TW = 15, TH = 13;
    if (G.meta) { TILE = G.meta.tile; TW = G.meta.tw; TH = G.meta.th; }

    /* 地面 */
    for (var y = 0; y < TH; y++) {
      for (var x = 0; x < TW; x++) {
        var v = d.map ? d.map.charCodeAt(y * TW + x) - 48 : 0;
        var px = x * TILE, py = y * TILE;
        ctx.fillStyle = ((x + y) % 2 === 0) ? '#121a26' : '#0f1621';
        ctx.fillRect(px, py, TILE, TILE);
        if (v === 1) {
          ctx.fillStyle = '#33415c';
          roundRect(ctx, px + 2, py + 2, TILE - 4, TILE - 4, 6);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          roundRect(ctx, px + 6, py + 6, TILE - 12, 8, 4);
          ctx.fill();
        } else if (v === 2) {
          ctx.fillStyle = '#8a4b32';
          roundRect(ctx, px + 2, py + 2, TILE - 4, TILE - 4, 5);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px + 4, py + TILE / 2);
          ctx.lineTo(px + TILE - 4, py + TILE / 2);
          ctx.moveTo(px + TILE / 2, py + 4);
          ctx.lineTo(px + TILE / 2, py + TILE - 4);
          ctx.stroke();
        }
      }
    }

    /* 道具 */
    for (var u = 0; u < s.u.length; u++) {
      var pu = s.u[u];
      var cx = (pu[0] + 0.5) * TILE, cy = (pu[1] + 0.5) * TILE;
      var col = pu[2] === 'bomb' ? '#ff2e63' : (pu[2] === 'range' ? '#fbbf24' : '#22d3ee');
      glowCircle(ctx, cx, cy, 26, col, 0.5);
      ctx.fillStyle = '#0b111c';
      ctx.beginPath();
      ctx.arc(cx, cy, 15, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      label(ctx, pu[2] === 'bomb' ? 'B' : (pu[2] === 'range' ? 'R' : 'S'), cx, cy + 1, col, 13);
    }

    /* 炸弹 */
    for (var b = 0; b < s.b.length; b++) {
      var bo = s.b[b];
      var bx = (bo[0] + 0.5) * TILE, by = (bo[1] + 0.5) * TILE;
      var tLeft = bo[2];
      var pulse = 1 + Math.sin((2.3 - tLeft) * 14) * 0.12;
      glowCircle(ctx, bx, by, 34 * pulse, '#ff2e63', 0.45);
      ctx.fillStyle = '#12131a';
      ctx.beginPath();
      ctx.arc(bx, by, 17 * pulse, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ff2e63';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#ff2e63';
      ctx.beginPath();
      ctx.arc(bx, by - 18, 4, 0, TAU);
      ctx.fill();
    }

    /* 火焰 */
    for (var f = 0; f < s.f.length; f++) {
      var fl = s.f[f];
      var fa = Math.max(0, fl[2] / 0.55);
      var fx = fl[0] * TILE, fy = fl[1] * TILE;
      ctx.globalAlpha = 0.35 + fa * 0.55;
      ctx.fillStyle = '#ffb020';
      roundRect(ctx, fx + 3, fy + 3, TILE - 6, TILE - 6, 8);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(fx + TILE / 2, fy + TILE / 2, 10 * fa, 0, TAU);
      ctx.fill();
    }

    /* 玩家 */
    var byId = {};
    for (var k = 0; k < G.players.length; k++) byId[G.players[k].id] = G.players[k];

    for (var i = 0; i < s.p.length; i++) {
      var p = s.p[i];
      if (!p.al) continue;
      var info = byId[p.i] || { color: '#22d3ee', name: '' };
      var x0 = (p.fx + 0.5) * TILE, y0 = (p.fy + 0.5) * TILE;
      var x1 = (p.cx + 0.5) * TILE, y1 = (p.cy + 0.5) * TILE;
      var m = p.m;
      var px2 = x0 + (x1 - x0) * m;
      var py2 = y0 + (y1 - y0) * m;

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(px2 + 2, py2 + 5, 16, 13, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(px2, py2, 16, 0, TAU);
      ctx.fill();
      ctx.fillStyle = AR.shade(info.color, 0.35);
      ctx.beginPath();
      ctx.arc(px2 - 3, py2 - 4, 10, 0, TAU);
      ctx.fill();

      /* 眼睛 */
      var ex = [0, 0], ey = [0, 0];
      if (p.d === 0) { ex = [-5, 5]; ey = [-4, -4]; }
      else if (p.d === 2) { ex = [-5, 5]; ey = [4, 4]; }
      else if (p.d === 1) { ex = [5, 5]; ey = [-4, 4]; }
      else { ex = [-5, -5]; ey = [-4, 4]; }
      ctx.fillStyle = '#0b111c';
      for (var q = 0; q < 2; q++) {
        ctx.beginPath();
        ctx.arc(px2 + ex[q], py2 + ey[q], 3, 0, TAU);
        ctx.fill();
      }
      label(ctx, info.name, px2, py2 - 28, nameColor(info, G), 12);
    }

    drawParticles(ctx, parts);
    ctx.restore();
  };


})(typeof window !== 'undefined' ? window : globalThis);
