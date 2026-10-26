/* ============================================================
 * 渲染层 · racing
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
   * 极速环线
   * ============================================================ */
  R.racing = function (ctx, w, h, s, dt, G) {
    bg(ctx, w, h, '#04070e');
    var meta = G.meta || {};
    var tw = meta.w || s.w || 2400;
    var th = meta.h || s.h || 1700;
    var tf = fit(w, h, tw, th);
    V.tf = tf;
    var pts = meta.points || [];

    ctx.save();
    ctx.translate(tf.ox, tf.oy);
    ctx.scale(tf.s, tf.s);

    /* 地面网格 */
    ctx.fillStyle = '#050a12';
    ctx.fillRect(0, 0, tw, th);
    ctx.strokeStyle = 'rgba(80,140,220,0.07)';
    ctx.lineWidth = 2;
    for (var gx = 0; gx <= tw; gx += 120) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, th); ctx.stroke();
    }
    for (var gy = 0; gy <= th; gy += 120) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(tw, gy); ctx.stroke();
    }

    if (pts.length > 2) {
      var roadW = meta.width || 150;
      var tracePath = function () {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
      };

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      /* 霓虹外辉（收窄一点，别把路面染成一片） */
      for (var g = 3; g >= 1; g--) {
        ctx.strokeStyle = AR.rgba(meta.edge || '#22d3ee', 0.04 * g);
        ctx.lineWidth = roadW + 10 + g * 12;
        tracePath();
        ctx.stroke();
      }

      /* 路肩 */
      ctx.strokeStyle = AR.rgba(meta.edge || '#22d3ee', 0.9);
      ctx.lineWidth = roadW + 9;
      tracePath();
      ctx.stroke();

      /* 路面 */
      ctx.strokeStyle = meta.road || '#0c1622';
      ctx.lineWidth = roadW;
      tracePath();
      ctx.stroke();

      /* 路面质感 */
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = roadW - 30;
      tracePath();
      ctx.stroke();

      /* 中心虚线 */
      ctx.setLineDash([30, 34]);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 3;
      tracePath();
      ctx.stroke();
      ctx.setLineDash([]);

      /* 起跑线 */
      if (meta.start) {
        ctx.save();
        ctx.translate(meta.start[0], meta.start[1]);
        ctx.rotate(meta.startA || 0);
        /* 黑白格子 */
        var cell = roadW / 8;
        for (var ci = 0; ci < 8; ci++) {
          ctx.fillStyle = ci % 2 === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(10,16,24,0.9)';
          ctx.fillRect(-8, -roadW / 2 + ci * cell, 16, cell);
        }
        ctx.restore();
      }
    }

    /* 车 */
    var cars = s.c || [];
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i];
      var id = c[0];
      var cx = c[1];
      var cy = c[2];
      var ca = c[3];
      var csp = c[4];
      var cfin = c[7];
      var coff = c[8];

      var info = null;
      for (var k = 0; k < G.players.length; k++) {
        if (G.players[k].id === id) info = G.players[k];
      }
      var color = (info && info.color) || '#22d3ee';
      var isMe = id === G.me;

      /* 速度尾焰 */
      if (csp > 60) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.45, csp / 300);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx - Math.cos(ca) * 30, cy - Math.sin(ca) * 30, 11, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ca);

      /* 车身 */
      ctx.fillStyle = coff ? AR.shade(color, -0.4) : color;
      roundRect(ctx, -23, -13, 46, 26, 7);
      ctx.fill();

      /* 座舱 */
      ctx.fillStyle = 'rgba(5,12,20,0.8)';
      roundRect(ctx, -7, -8, 17, 16, 4);
      ctx.fill();

      /* 车灯 */
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(19, -9, 4, 5);
      ctx.fillRect(19, 4, 4, 5);

      ctx.restore();

      if (isMe) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 34, 0, TAU);
        ctx.stroke();

        /* 头顶小箭头，一眼找到自己 */
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 30);
        ctx.lineTo(cx - 11, cy - 48);
        ctx.lineTo(cx + 11, cy - 48);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();

    /* 名字不画在车上（缩放后容易糊），统一看右侧记分板，车用颜色区分 */
  };


})(typeof window !== 'undefined' ? window : globalThis);
