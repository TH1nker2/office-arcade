/* ============================================================
 * 渲染层 · tank
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
   * 坦克竞技场
   * ============================================================ */
  var TANK_COLORS = { 1: '#2b3448', 2: '#8a4b32', 3: '#5f3a2a' };

  R.tank = function (ctx, w, h, s, dt, G) {
    V.time = (V.time || 0) + (dt || 0);
    bg(ctx, w, h, '#060a12');
    var tf = fit(w, h, s.w, s.h);
    V.tf = tf;
    var d = V.data;
    if (!d.map && G.meta && G.meta.map) d.map = G.meta.map;
    if (s.m) d.map = s.m;
    var parts = particles('p');
    handleEvents(parts, s.e, 'tank');
    stepParticles(parts, dt);

    ctx.save();
    ctx.translate(tf.ox, tf.oy);
    ctx.scale(tf.s, tf.s);

    var TILE = 40, TW = 40, TH = 30;
    if (G.meta) { TILE = G.meta.tile; TW = G.meta.tw; TH = G.meta.th; }

    ctx.fillStyle = '#0a1018';
    ctx.fillRect(0, 0, s.w, s.h);

    if (d.map) {
      for (var y = 0; y < TH; y++) {
        for (var x = 0; x < TW; x++) {
          var v = d.map.charCodeAt(y * TW + x) - 48;
          if (!v) continue;
          var px = x * TILE, py = y * TILE;
          if (v === 1) {
            ctx.fillStyle = TANK_COLORS[1];
            ctx.fillRect(px, py, TILE, TILE);
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(px + 2, py + 2, TILE - 4, 4);
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
          } else {
            ctx.fillStyle = TANK_COLORS[v];
            ctx.fillRect(px, py, TILE, TILE);
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
            ctx.strokeStyle = 'rgba(255,200,150,0.16)';
            ctx.beginPath();
            ctx.moveTo(px + 4, py + TILE / 2);
            ctx.lineTo(px + TILE - 4, py + TILE / 2);
            ctx.moveTo(px + TILE / 2, py + 4);
            ctx.lineTo(px + TILE / 2, py + TILE - 4);
            ctx.stroke();
          }
        }
      }
    }

    /* 地图补给 */
    var BUFF_ICON = { speed: '⚡', rapid: '🔥', shield: '🛡', heal: '✚' };
    var BUFF_COLOR = { speed: '#fbbf24', rapid: '#f97316', shield: '#38bdf8', heal: '#4ade80' };
    if (s.f) {
      for (var q = 0; q < s.f.length; q++) {
        var bf = s.f[q];
        var bc = BUFF_COLOR[bf[2]] || '#fbbf24';
        var pulse = 0.6 + 0.4 * Math.sin((V.time || 0) * 4 + q);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(8,13,22,0.9)';
        ctx.strokeStyle = bc;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(bf[0], bf[1], 16, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 0.55 + 0.45 * pulse;
        ctx.fillStyle = bc;
        ctx.font = '16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(BUFF_ICON[bf[2]] || '?', bf[0], bf[1] + 1);
        ctx.restore();
      }
    }

    /* 坦克 */
    var byId = {};
    for (var k = 0; k < G.players.length; k++) byId[G.players[k].id] = G.players[k];

    for (var i = 0; i < s.p.length; i++) {
      var t = s.p[i];
      if (!t.al) continue;
      var info = byId[t.i] || { color: '#22d3ee', name: '' };
      ctx.save();
      ctx.translate(t.x, t.y);
      /* 无敌（复活保护）：整体闪烁 */
      if (t.iv) {
        var blink = Math.sin((V.time || 0) * 22) > 0;
        ctx.globalAlpha = blink ? 0.35 : 1;
      }

      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(2, 3, 21, 19, 0, 0, TAU);
      ctx.fill();

      ctx.rotate(t.b);
      ctx.fillStyle = AR.shade(info.color, -0.3);
      roundRect(ctx, -18, -16, 36, 32, 7);
      ctx.fill();
      ctx.fillStyle = info.color;
      roundRect(ctx, -15, -13, 30, 26, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, TAU);
      ctx.fill();
      ctx.rotate(-t.b);

      /* 炮管：连发（火力）时变红 */
      ctx.save();
      ctx.rotate(t.a);
      if (t.rp) {
        ctx.shadowColor = '#ff2e63';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#ff2e63';
      } else {
        ctx.fillStyle = AR.shade(info.color, 0.35);
      }
      ctx.fillRect(6, -4, 30, 8);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0b0f16';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, TAU);
      ctx.fill();
      ctx.restore();

      /* 加速：车身后面拖一条蓝色尾迹 */
      if (t.sp) {
        ctx.save();
        ctx.rotate(t.b);
        var grd = ctx.createLinearGradient(-18, 0, -70, 0);
        grd.addColorStop(0, 'rgba(56,189,248,0.55)');
        grd.addColorStop(1, 'rgba(56,189,248,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(-16, -13);
        ctx.lineTo(-70, -3);
        ctx.lineTo(-70, 3);
        ctx.lineTo(-16, 13);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      /* 护盾：一圈蓝色光环保在外层 */
      if (t.sh > 0) {
        var pulse = 0.55 + 0.45 * Math.sin((V.time || 0) * 6);
        ctx.save();
        ctx.strokeStyle = 'rgba(56,189,248,' + (0.55 + 0.35 * pulse) + ')';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, TAU);
        ctx.stroke();
        if (t.sh > 1) {
          /* 叠了两层护盾时再套一圈 */
          ctx.beginPath();
          ctx.arc(0, 0, 32, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 血条 */
      var hpw = 38;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-hpw / 2, -30, hpw, 4);
      ctx.fillStyle = t.h >= 2 ? '#a3e635' : '#ff2e63';
      ctx.fillRect(-hpw / 2, -30, hpw * (t.h / 3), 4);

      label(ctx, info.name, 0, -41, nameColor(info, G), 13);
      ctx.restore();
    }

    /* 子弹 */
    for (var b = 0; b < s.b.length; b++) {
      var bu = s.b[b];
      glowCircle(ctx, bu[0], bu[1], 14, bu[2], 0.5);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(bu[0], bu[1], 4, 0, TAU);
      ctx.fill();
    }

    drawParticles(ctx, parts);
    ctx.restore();
  };


})(typeof window !== 'undefined' ? window : globalThis);
