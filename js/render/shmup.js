/* ============================================================
 * 渲染层 · shmup v2
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

  var META = AR.GameConstants.SHMUP;
  var BUFFS = META.BUFFS;
  var BUFF_BY_ID = {};
  BUFFS.forEach(function (b) { BUFF_BY_ID[b.id] = b; });

  /* ============================================================
   * 增益光球
   * ============================================================ */
  function drawBuff(ctx, u) {
    var def = BUFF_BY_ID[u[2]];
    if (!def) return;
    var x = u[0], y = u[1];
    glowCircle(ctx, x, y, 28, def.color, 0.35);
    ctx.fillStyle = 'rgba(8,13,22,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.font = '17px "Segoe UI Emoji", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = def.color;
    ctx.fillText(def.icon, x, y + 1);
  }

  /* ============================================================
   * BOSS 外形
   * ============================================================ */
  function bossPalette(b) {
    return {
      body: b.f ? '#ffffff' : (b.c || '#ff5d7d'),
      dark: b.f ? '#ffffff' : (b.ac || '#8b1e3f')
    };
  }

  function drawFortress(ctx, b) {
    var r = b.r || 70;
    var pal = bossPalette(b);
    glowCircle(ctx, 0, 0, r * 2.1, pal.body, 0.2);

    ctx.fillStyle = pal.dark;
    roundRect(ctx, -r * 1.5, -r * 0.8, r * 3, r * 1.6, 26);
    ctx.fill();
    ctx.fillStyle = pal.body;
    roundRect(ctx, -r * 1.35, -r * 0.65, r * 2.7, r * 1.3, 22);
    ctx.fill();

    /* 两侧炮塔 */
    [-1, 1].forEach(function (s) {
      ctx.fillStyle = pal.dark;
      roundRect(ctx, s * r * 1.05 - 18, -r * 0.35, 36, r * 0.7, 10);
      ctx.fill();
      ctx.fillStyle = pal.body;
      ctx.beginPath();
      ctx.arc(s * r * 1.05, 0, 10, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0b0f16';
      ctx.beginPath();
      ctx.arc(s * r * 1.05, 0, 5, 0, TAU);
      ctx.fill();
    });

    /* 中央核心 */
    ctx.fillStyle = 'rgba(10,14,20,0.68)';
    roundRect(ctx, -r * 0.5, -r * 0.3, r, r * 0.6, 18);
    ctx.fill();
    ctx.fillStyle = pal.body;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0b0f16';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.1, 0, TAU);
    ctx.fill();
  }

  function drawHive(ctx, b) {
    var r = b.r || 66;
    var pal = bossPalette(b);
    glowCircle(ctx, 0, 0, r * 2.1, pal.body, 0.2);

    /* 六边形舰体 */
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * TAU - Math.PI / 2;
      var px = Math.cos(a) * r;
      var py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = pal.dark;
    ctx.fill();
    ctx.beginPath();
    for (var j = 0; j < 6; j++) {
      var a2 = j / 6 * TAU - Math.PI / 2;
      var qx = Math.cos(a2) * r * 0.8;
      var qy = Math.sin(a2) * r * 0.8;
      if (j === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
    }
    ctx.closePath();
    ctx.fillStyle = pal.body;
    ctx.fill();

    /* 三个侧舱 */
    for (var k = 0; k < 3; k++) {
      var ang = k / 3 * TAU + Math.PI / 6;
      var hx = Math.cos(ang) * r * 0.62;
      var hy = Math.sin(ang) * r * 0.62;
      glowCircle(ctx, hx, hy, 18, pal.body, 0.25);
      ctx.fillStyle = pal.dark;
      ctx.beginPath();
      ctx.arc(hx, hy, 9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = pal.body;
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, TAU);
      ctx.fill();
    }

    /* 中央核心 */
    ctx.fillStyle = 'rgba(10,14,20,0.7)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.32, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = pal.body;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, TAU);
    ctx.stroke();
  }

  function drawPrism(ctx, b) {
    var r = b.r || 58;
    var pal = bossPalette(b);
    glowCircle(ctx, 0, 0, r * 2.2, pal.body, 0.22);

    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.82, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.82, 0);
    ctx.closePath();
    ctx.fillStyle = pal.dark;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -r * 0.78);
    ctx.lineTo(r * 0.62, 0);
    ctx.lineTo(0, r * 0.78);
    ctx.lineTo(-r * 0.62, 0);
    ctx.closePath();
    ctx.fillStyle = pal.body;
    ctx.fill();

    /* 旋转内棱镜 */
    ctx.save();
    ctx.rotate((V.t || 0) * 1.4);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var i = 0; i < 3; i++) {
      var a = i / 3 * TAU;
      var x = Math.cos(a) * r * 0.4;
      var y = Math.sin(a) * r * 0.4;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#eafaff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.13, 0, TAU);
    ctx.fill();
  }

  function drawBoss(ctx, b, s) {
    ctx.save();
    ctx.translate(b.x, b.y);
    if (b.k === 'hive') drawHive(ctx, b);
    else if (b.k === 'prism') drawPrism(ctx, b);
    else drawFortress(ctx, b);
    ctx.restore();

    var name = b.nm || 'BOSS';
    var color = b.c || '#ff5d7d';
    label(ctx, name, b.x, b.y - (b.r || 70) - 20, color, 14);

    /* 顶部血条：逻辑坐标，跟随画布缩放 */
    var pw = Math.min(s.w - 80, 520);
    var bx = s.w / 2 - pw / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, 64, pw, 12);
    ctx.fillStyle = color;
    ctx.fillRect(bx, 64, pw * Math.max(0, b.hp / b.mx), 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, 64, pw, 12);
  }

  /* ============================================================
   * 主渲染
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

    /* 增益光球 */
    if (s.u) {
      for (var u = 0; u < s.u.length; u++) drawBuff(ctx, s.u[u]);
    }

    /* BOSS */
    if (s.b) drawBoss(ctx, s.b, s);

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

      /* 护盾环 */
      if (pl.sh > 0) {
        ctx.strokeStyle = 'rgba(56,189,248,' + (0.55 + 0.3 * Math.sin(V.t * 6)) + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, TAU);
        ctx.stroke();
        if (pl.sh > 1) {
          ctx.beginPath();
          ctx.arc(0, 0, 32, 0, TAU);
          ctx.stroke();
        }
      }

      /* 耐久格 */
      var mh = pl.mh || 3;
      for (var hp = 0; hp < mh; hp++) {
        ctx.fillStyle = hp < pl.hp ? '#a3e635' : 'rgba(255,255,255,0.15)';
        ctx.fillRect(-18 + hp * 13, 26, 11, 4);
      }
      if (pl.rt) label(ctx, '⚡', -25, 40, '#fbbf24', 12);
      if (pl.st) label(ctx, '🔱', 25, 40, '#c084fc', 12);
      ctx.restore();

      label(ctx, info.name, pl.x, pl.y - 34, nameColor(info, G), 12);
    }

    drawParticles(ctx, parts);
    ctx.restore();
  };

})(typeof window !== 'undefined' ? window : globalThis);
