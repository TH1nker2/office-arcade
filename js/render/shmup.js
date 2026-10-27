/* ============================================================
 * 渲染层 · shmup
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
   * 合作弹幕
   * ============================================================ */
  R.shmup = function (ctx, w, h, s, dt, G) {
    bg(ctx, w, h, '#04060c');
    var tf = fit(w, h, s.w, s.h);
    V.tf = tf;
    var d = V.data;
    if (!d.stars || d.sw !== w || d.sh !== h) {
      d.sw = w;
      d.sh = h;
      d.stars = [];
      for (var i = 0; i < 150; i++) {
        d.stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          z: 0.3 + Math.random() * 0.7
        });
      }
    }
    var parts = particles('p');
    handleEvents(parts, s.ev, 'shmup');
    stepParticles(parts, dt);

    /* 屏幕空间星空：铺满整个画布（含左右留白） */
    for (var si = 0; si < d.stars.length; si++) {
      var st = d.stars[si];
      st.y += (34 + st.z * 170) * dt;
      if (st.y > h) {
        st.y = -4;
        st.x = Math.random() * w;
      }
      ctx.fillStyle = 'rgba(150,205,255,' + (0.10 + st.z * 0.38) + ')';
      ctx.fillRect(st.x, st.y, 1.4 + st.z * 1.4, 3 + st.z * 5);
    }

    ctx.save();
    ctx.translate(tf.ox, tf.oy);
    ctx.scale(tf.s, tf.s);

    ctx.strokeStyle = 'rgba(34,211,238,0.22)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s.w, s.h);

    /* 敌人 */
    for (var e = 0; e < s.e.length; e++) {
      var en = s.e[e];
      var ex = en[0], ey = en[1], type = en[2];
      var col = type === 'tank' ? '#fb923c' : (type === 'zig' ? '#c084fc' : '#ff5d7d');
      var r = type === 'tank' ? 26 : 16;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(Math.PI);
      glowCircle(ctx, 0, 0, r * 1.8, col, 0.25);
      ctx.fillStyle = col;
      ctx.beginPath();
      if (type === 'tank') {
        roundRect(ctx, -r, -r, r * 2, r * 2, 8);
      } else if (type === 'zig') {
        ctx.moveTo(0, -r); ctx.lineTo(r, r * 0.7); ctx.lineTo(-r, r * 0.7);
      } else {
        ctx.moveTo(0, r); ctx.lineTo(r, -r * 0.6); ctx.lineTo(0, -r * 0.2); ctx.lineTo(-r, -r * 0.6);
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(10,14,20,0.75)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.34, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (en[4] > 1 && en[3] < en[4]) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(ex - r, ey + r + 5, r * 2, 3);
        ctx.fillStyle = '#a3e635';
        ctx.fillRect(ex - r, ey + r + 5, r * 2 * (en[3] / en[4]), 3);
      }
    }

    /* Boss */
    if (s.b) {
      var bx = s.b.x, by = s.b.y;
      glowCircle(ctx, bx, by, 150, '#ff2e63', 0.22);
      ctx.fillStyle = s.b.f ? '#fff' : '#8b1e3f';
      roundRect(ctx, bx - 100, by - 60, 200, 120, 26);
      ctx.fill();
      ctx.fillStyle = '#ff2e63';
      roundRect(ctx, bx - 84, by - 46, 168, 92, 20);
      ctx.fill();
      ctx.fillStyle = 'rgba(10,14,20,0.6)';
      roundRect(ctx, bx - 52, by - 24, 104, 48, 14);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(bx - 26, by, 9, 0, TAU);
      ctx.arc(bx + 26, by, 9, 0, TAU);
      ctx.fill();

      var pw = Math.min(w - 80, 520);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(w / 2 - pw / 2, 64, pw, 12);
      ctx.fillStyle = '#ff2e63';
      ctx.fillRect(w / 2 - pw / 2, 64, pw * Math.max(0, s.b.hp / s.b.mx), 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(w / 2 - pw / 2, 64, pw, 12);
    }

    /* 玩家子弹 */
    for (var pb = 0; pb < s.pb.length; pb++) {
      var b1 = s.pb[pb];
      ctx.fillStyle = '#bff6ff';
      ctx.fillRect(b1[0] - 2, b1[1] - 12, 4, 16);
      glowCircle(ctx, b1[0], b1[1], 10, '#22d3ee', 0.35);
    }

    /* 敌弹 */
    for (var eb = 0; eb < s.eb.length; eb++) {
      var b2 = s.eb[eb];
      glowCircle(ctx, b2[0], b2[1], 14, '#ff2e63', 0.45);
      ctx.fillStyle = '#ffd7e0';
      ctx.beginPath();
      ctx.arc(b2[0], b2[1], 4.5, 0, TAU);
      ctx.fill();
    }

    /* 玩家 */
    var byId = {};
    for (var k = 0; k < G.players.length; k++) byId[G.players[k].id] = G.players[k];
    for (var p = 0; p < s.p.length; p++) {
      var pl = s.p[p];
      if (!pl.al) continue;
      var info = byId[pl.i] || { color: '#22d3ee', name: '' };
      ctx.save();
      ctx.translate(pl.x, pl.y);
      if (pl.iv) ctx.globalAlpha = 0.55 + Math.sin(V.t * 20) * 0.3;
      glowCircle(ctx, 0, 0, 34, info.color, 0.35);
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(16, 14);
      ctx.lineTo(0, 6);
      ctx.lineTo(-16, 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#eafaff';
      ctx.beginPath();
      ctx.arc(0, -4, 4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,180,80,0.8)';
      ctx.beginPath();
      ctx.moveTo(-5, 8); ctx.lineTo(5, 8); ctx.lineTo(0, 20 + Math.random() * 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      label(ctx, info.name, pl.x, pl.y - 34, nameColor(info, G), 12);

      for (var hp = 0; hp < pl.lv; hp++) {
        ctx.fillStyle = hp < pl.hp ? '#a3e635' : 'rgba(255,255,255,0.15)';
        ctx.fillRect(pl.x - 18 + hp * 13, pl.y + 26, 11, 4);
      }
    }

    drawParticles(ctx, parts);
    ctx.restore();
  };


})(typeof window !== 'undefined' ? window : globalThis);
