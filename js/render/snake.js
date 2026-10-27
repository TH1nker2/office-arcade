/* ============================================================
 * 渲染层 · snake
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
   * 蛇球大作战
   * ============================================================ */
  R.snake = function (ctx, w, h, s, dt, G) {
    bg(ctx, w, h, '#060a12');
    var tf = fit(w, h, s.w, s.h);
    V.tf = tf;
    var d = V.data;
    if (!d.trails) d.trails = {};
    if (!d.pos) d.pos = {};
    var parts = particles('p');
    handleEvents(parts, s.e, 'snake');
    stepParticles(parts, dt);

    ctx.save();
    ctx.translate(tf.ox, tf.oy);
    ctx.scale(tf.s, tf.s);

    /* 场地 */
    ctx.fillStyle = '#080d17';
    ctx.fillRect(0, 0, s.w, s.h);
    ctx.strokeStyle = 'rgba(90,140,200,0.10)';
    ctx.lineWidth = 2;
    for (var gx = 0; gx <= s.w; gx += 80) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, s.h); ctx.stroke();
    }
    for (var gy = 0; gy <= s.h; gy += 80) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(s.w, gy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(34,211,238,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, s.w, s.h);

    /* 光点 */
    for (var i = 0; i < s.o.length; i += 2) {
      var ox = s.o[i], oy = s.o[i + 1];
      var pulse = 0.6 + Math.sin(V.t * 3 + ox * 0.01) * 0.25;
      glowCircle(ctx, ox, oy, 22, '#7fe7ff', 0.22 * pulse);
      ctx.fillStyle = '#bff6ff';
      ctx.beginPath();
      ctx.arc(ox, oy, 5.5, 0, TAU);
      ctx.fill();
    }

    /* 蛇 */
    var byId = {};
    for (var k = 0; k < G.players.length; k++) byId[G.players[k].id] = G.players[k];

    for (var n = 0; n < s.s.length; n++) {
      var sn = s.s[n];
      var info = byId[sn.i] || { name: '', color: '#22d3ee' };
      if (!sn.al) {
        if (d.trails[sn.i] && d.trails[sn.i].length) d.trails[sn.i].length = 0;
        continue;
      }
      var cur = d.pos[sn.i];
      if (!cur) cur = d.pos[sn.i] = { x: sn.x, y: sn.y };
      var nd = Math.hypot(sn.x - cur.x, sn.y - cur.y);
      if (nd > 220) {
        cur.x = sn.x; cur.y = sn.y;
        d.trails[sn.i] = [];
      } else {
        cur.x += (sn.x - cur.x) * Math.min(1, dt * 22);
        cur.y += (sn.y - cur.y) * Math.min(1, dt * 22);
      }

      var tr = d.trails[sn.i] || (d.trails[sn.i] = []);
      var head = tr[0];
      if (!head || AR.dist2(head.x, head.y, cur.x, cur.y) > 9) {
        tr.unshift({ x: cur.x, y: cur.y });
      }
      var maxPts = Math.max(24, Math.floor(sn.l * 1.75));
      while (tr.length > maxPts) tr.pop();

      if (tr.length < 2) continue;

      /* 身体：两层描边 */
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = AR.rgba(info.color, 0.55);
      ctx.shadowBlur = 14;
      ctx.strokeStyle = AR.shade(info.color, -0.35);
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(tr[0].x, tr[0].y);
      for (var p1 = 1; p1 < tr.length; p1++) ctx.lineTo(tr[p1].x, tr[p1].y);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = info.color;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(tr[0].x, tr[0].y);
      for (var p2 = 1; p2 < tr.length; p2++) ctx.lineTo(tr[p2].x, tr[p2].y);
      ctx.stroke();

      /* 头 */
      ctx.fillStyle = AR.shade(info.color, 0.25);
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 11, 0, TAU);
      ctx.fill();
      var ea = Math.atan2(sn.y - (tr[3] ? tr[3].y : sn.y), sn.x - (tr[3] ? tr[3].x : sn.x));
      ctx.fillStyle = '#08101c';
      for (var e = -1; e <= 1; e += 2) {
        ctx.beginPath();
        ctx.arc(cur.x + Math.cos(ea) * 3 + Math.cos(ea + Math.PI / 2) * 5 * e,
          cur.y + Math.sin(ea) * 3 + Math.sin(ea + Math.PI / 2) * 5 * e, 2.6, 0, TAU);
        ctx.fill();
      }

      label(ctx, info.name + ' ' + sn.s, cur.x, cur.y - 26, nameColor(info, G), 15);
    }

    drawParticles(ctx, parts);
    ctx.restore();
  };


})(typeof window !== 'undefined' ? window : globalThis);
