/* ============================================================
 * 渲染层：6 个游戏的画面
 * 画布已按 DPR 设置好 transform，这里使用 CSS 像素坐标
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var TAU = Math.PI * 2;

  var V = AR.View = {
    game: null,
    tf: { s: 1, ox: 0, oy: 0 },
    data: {},
    t: 0
  };

  V.init = function (gameId) {
    V.game = gameId;
    V.data = {};
    V.tf = { s: 1, ox: 0, oy: 0 };
  };

  var R = AR.Render = {};

  /* ---------------- 工具 ---------------- */
  function roundRect(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fit(w, h, ww, wh) {
    var s = Math.min(w / ww, h / wh);
    return { s: s, ox: (w - ww * s) / 2, oy: (h - wh * s) / 2 };
  }

  function bg(ctx, w, h, color) {
    ctx.fillStyle = color || '#05070d';
    ctx.fillRect(0, 0, w, h);
  }

  function label(ctx, text, x, y, color, size, align) {
    ctx.font = '700 ' + (size || 12) + 'px "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color || '#e9f2ff';
    ctx.fillText(text, x, y);
  }

  function glowCircle(ctx, x, y, r, color, alpha) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, AR.rgba(color, alpha));
    g.addColorStop(1, AR.rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function particles(key) {
    var d = V.data;
    if (!d[key]) d[key] = [];
    return d[key];
  }

  function addBurst(list, x, y, color, n, speed) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var sp = speed * (0.3 + Math.random() * 0.9);
      list.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.5,
        max: 0.9,
        c: color,
        r: 2 + Math.random() * 3
      });
    }
    if (list.length > 220) list.splice(0, list.length - 220);
  }

  function stepParticles(list, dt) {
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      if (p.life <= 0) list.splice(i, 1);
    }
  }

  function drawParticles(ctx, list) {
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.8), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  var lastSfx = 0;
  function sfx(kind) {
    var now = AR.now();
    if (now - lastSfx < 110) return;
    lastSfx = now;
    if (!AR.Sfx) return;
    if (kind === 'boom') AR.Sfx.boom();
    else if (kind === 'die') AR.Sfx.bad();
    else AR.Sfx.pop();
  }

  function handleEvents(list, evs, kind) {
    if (!evs) return;
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (kind === 'tank') {
        if (e.t === 'boom') { addBurst(list, e.x, e.y, e.c || '#fbbf24', 18, 190); sfx('boom'); }
        else if (e.t === 'brk') { addBurst(list, e.x, e.y, '#c08457', 8, 120); sfx('pop'); }
        else if (e.t === 'hit') addBurst(list, e.x, e.y, '#ffe08a', 5, 90);
      } else if (kind === 'snake') {
        if (e.t === 'die') { addBurst(list, e.x, e.y, e.c || '#ff2e63', 24, 180); sfx('die'); }
      } else if (kind === 'bomber') {
        if (e.t === 'boom') { addBurst(list, (e.cx + 0.5) * 48, (e.cy + 0.5) * 48, '#ffb020', 16, 190); sfx('boom'); }
        else if (e.t === 'pick') sfx('pop');
      } else if (kind === 'shmup') {
        if (e.t === 'explode') { addBurst(list, e.x, e.y, '#ffb020', 14, 170); sfx('boom'); }
        else if (e.t === 'playerdead') { addBurst(list, e.x, e.y, e.c || '#ff2e63', 26, 220); sfx('die'); }
        else if (e.t === 'boss') sfx('die');
      }
    }
  }

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

      /* 炮管 */
      ctx.save();
      ctx.rotate(t.a);
      ctx.fillStyle = AR.shade(info.color, 0.35);
      ctx.fillRect(6, -4, 30, 8);
      ctx.fillStyle = '#0b0f16';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, TAU);
      ctx.fill();
      ctx.restore();

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

  /* ============================================================
   * 俄罗斯方块
   * ============================================================ */
  var TET_COLORS = ['#000000', '#22d3ee', '#3b82f6', '#fb923c', '#fbbf24', '#a3e635', '#a855f7', '#ff2e63', '#5b6478'];
  var TET_BASE = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
  };
  var TET_ORDER = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

  function tetRot(m) {
    var n = m.length, out = [];
    for (var y = 0; y < n; y++) {
      out.push([]);
      for (var x = 0; x < n; x++) out[y].push(m[n - 1 - x][y]);
    }
    return out;
  }

  function tetMatrix(type, rot) {
    var m = TET_BASE[type];
    for (var i = 0; i < rot; i++) m = tetRot(m);
    return m;
  }

  function drawCell(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    roundRect(ctx, x + 1, y + 1, size - 2, size - 2, Math.max(2, size * 0.16));
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, x + 1, y + 1, size - 2, Math.max(2, size * 0.22), 2);
    ctx.fill();
  }

  function drawBoard(ctx, x, y, size, board, piece, ghost, bw, bh) {
    ctx.fillStyle = 'rgba(8,13,22,0.9)';
    ctx.fillRect(x, y, bw * size, bh * size);
    ctx.strokeStyle = 'rgba(120,170,230,0.14)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= bw; gx++) {
      ctx.beginPath(); ctx.moveTo(x + gx * size, y); ctx.lineTo(x + gx * size, y + bh * size); ctx.stroke();
    }
    for (var gy = 0; gy <= bh; gy++) {
      ctx.beginPath(); ctx.moveTo(x, y + gy * size); ctx.lineTo(x + bw * size, y + gy * size); ctx.stroke();
    }

    for (var i = 0; i < board.length; i++) {
      var v = board.charCodeAt(i) - 48;
      if (!v) continue;
      var cx = i % bw, cy = Math.floor(i / bw);
      drawCell(ctx, x + cx * size, y + cy * size, size, TET_COLORS[v] || '#888');
    }

    if (piece) {
      var mat = tetMatrix(piece[0], piece[1]);
      for (var py = 0; py < mat.length; py++) {
        for (var px = 0; px < mat.length; px++) {
          if (!mat[py][px]) continue;
          var bx = piece[2] + px, by = piece[3] + py;
          if (by < 0) continue;
          drawCell(ctx, x + bx * size, y + by * size, size, TET_COLORS[TET_ORDER.indexOf(piece[0]) + 1]);
        }
      }
      if (ghost) {
        for (var gy2 = 0; gy2 < mat.length; gy2++) {
          for (var gx2 = 0; gx2 < mat.length; gx2++) {
            if (!mat[gy2][gx2]) continue;
            var gbx = piece[2] + gx2, gby = ghost + gy2;
            if (gby < 0) continue;
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + gbx * size + 2, y + gby * size + 2, size - 4, size - 4);
          }
        }
      }
    }

    ctx.strokeStyle = 'rgba(34,211,238,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, y - 1, bw * size + 2, bh * size + 2);
  }

  function ghostY(board, piece, bw, bh) {
    var mat = tetMatrix(piece[0], piece[1]);
    var best = piece[3];
    for (var dy = 0; dy < bh; dy++) {
      var test = piece[3] + dy;
      var ok = true;
      for (var py = 0; py < mat.length && ok; py++) {
        for (var px = 0; px < mat.length; px++) {
          if (!mat[py][px]) continue;
          var bx = piece[2] + px, by = test + py;
          if (bx < 0 || bx >= bw || by >= bh) { ok = false; break; }
          if (by >= 0 && board.charCodeAt(by * bw + bx) !== 48) { ok = false; break; }
        }
      }
      if (!ok) break;
      best = test;
    }
    return best;
  }

  R.tetris = function (ctx, w, h, s, dt, G) {
    bg(ctx, w, h, '#05080f');
    V.tf = { s: 1, ox: 0, oy: 0 };
    var me = null;
    var others = [];
    for (var i = 0; i < s.p.length; i++) {
      if (s.p[i].i === G.me) me = s.p[i];
      else others.push(s.p[i]);
    }
    if (!me) me = s.p[0];

    var bw = 10, bh = 20;
    var size = Math.min((h - 190) / bh, (w * 0.38) / bw);
    var mainW = bw * size;
    var mainH = bh * size;
    var cols = others.length ? Math.max(1, Math.min(2, others.length)) : 0;
    var miniSize = others.length === 1 ? size * 0.58 : size * 0.42;
    if (miniSize > 18) miniSize = 18;
    var miniW = bw * miniSize;
    var gap = 42;
    var totalW = mainW + (others.length ? gap + cols * (miniW + 20) : 0);
    var x0 = (w - totalW) / 2;
    var y0 = (h - mainH) / 2 + 8;

    /* 主棋盘 */
    drawBoard(ctx, x0, y0, size, me.b, me.pc, me.pc ? ghostY(me.b, me.pc, bw, bh) : null, bw, bh);

    label(ctx, '你', x0 + mainW / 2, y0 - 28, '#22d3ee', 15);
    label(ctx, '得分 ' + me.s + ' · 消行 ' + me.l, x0 + mainW / 2, y0 + mainH + 26, '#8ea3c0', 13);

    var colX = x0 + mainW + gap;

    /* NEXT */
    if (me.nx) {
      label(ctx, 'NEXT', colX + 2, y0 - 22, '#8ea3c0', 10, 'left');
      var mat2 = TET_BASE[me.nx];
      var cs = 15;
      for (var py2 = 0; py2 < mat2.length; py2++) {
        for (var px2 = 0; px2 < mat2.length; px2++) {
          if (!mat2[py2][px2]) continue;
          drawCell(ctx, colX + px2 * cs, y0 - 8 + py2 * cs, cs, TET_COLORS[TET_ORDER.indexOf(me.nx) + 1]);
        }
      }
    }

    /* 对手 */
    for (var k = 0; k < others.length; k++) {
      var o = others[k];
      var px3 = colX + (k % cols) * (miniW + 20);
      var py3 = y0 + 76 + Math.floor(k / cols) * (20 * miniSize + 46);
      var info = null;
      for (var q = 0; q < G.players.length; q++) if (G.players[q].id === o.i) info = G.players[q];
      if (py3 + 20 * miniSize > h - 16) continue;
      drawBoard(ctx, px3, py3 + 18, miniSize, o.b, o.pc, null, bw, bh);
      label(ctx, (info ? info.name : '') + (o.al ? '' : ' · 阵亡'), px3 + 5 * miniSize, py3 + 8,
        o.al ? (info ? info.color : '#8ea3c0') : '#ff5d7d', 11);
      if (!o.al) {
        ctx.fillStyle = 'rgba(5,8,15,0.6)';
        ctx.fillRect(px3, py3 + 18, 10 * miniSize, 20 * miniSize);
      }
    }
  };

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

  /* ============================================================
   * 你画我猜
   * ============================================================ */
  var DRAW_W = 900, DRAW_H = 560;

  function ensureBoard(w, h) {
    var d = V.data;
    var availW = w - 370;
    var bw = Math.min(availW, 900);
    var bh = bw * (DRAW_H / DRAW_W);
    if (bh > h - 220) { bh = h - 220; bw = bh * (DRAW_W / DRAW_H); }
    if (!d.canvas) {
      d.canvas = document.createElement('canvas');
      d.w = DRAW_W;
      d.h = DRAW_H;
      d.canvas.width = DRAW_W;
      d.canvas.height = DRAW_H;
      d.ctx = d.canvas.getContext('2d');
      d.ctx.fillStyle = '#f7f8fb';
      d.ctx.fillRect(0, 0, DRAW_W, DRAW_H);
    }
    d.bx = 16 + (availW - bw) / 2;
    d.by = 112;
    d.bw = bw;
    d.bh = bh;
    d.scale = bw / DRAW_W;
    return d;
  }

  R.paint = function (msg) {
    var d = V.data;
    if (!d.canvas || !d.ctx) return;
    var s = msg.s;
    var c = d.ctx;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = s.c || '#111';
    c.lineWidth = s.w || 4;
    if (s.e === 'b' || !s.p) {
      c.beginPath();
      c.arc(s.x, s.y, (s.w || 4) / 2, 0, TAU);
      c.fillStyle = s.c || '#111';
      c.fill();
    } else {
      c.beginPath();
      c.moveTo(s.p[0], s.p[1]);
      c.lineTo(s.x, s.y);
      c.stroke();
    }
  };

  R.clearBoard = function () {
    var d = V.data;
    if (!d.ctx) return;
    d.ctx.fillStyle = '#f7f8fb';
    d.ctx.fillRect(0, 0, DRAW_W, DRAW_H);
  };

  R.toBoard = function (mx, my) {
    var d = V.data;
    if (!d.scale) return null;
    var x = (mx - d.bx) / d.scale;
    var y = (my - d.by) / d.scale;
    if (x < 0 || y < 0 || x > DRAW_W || y > DRAW_H) return null;
    return { x: x, y: y };
  };

  R.draw = function (ctx, w, h, s, dt, G) {
    bg(ctx, w, h, '#070b13');
    var d = ensureBoard(w, h);
    V.tf = { s: d.scale, ox: d.bx, oy: d.by };

    ctx.save();
    ctx.shadowColor = 'rgba(34,211,238,0.35)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#f7f8fb';
    roundRect(ctx, d.bx - 8, d.by - 8, d.bw + 16, d.bh + 16, 14);
    ctx.fill();
    ctx.restore();

    ctx.drawImage(d.canvas, d.bx, d.by, d.bw, d.bh);

    /* 顶部状态 */
    var phaseText = {
      choose: '作者正在选词…',
      draw: '作画中',
      reveal: '公布答案',
      over: '游戏结束'
    }[s.ph] || '';

    var drawerName = '';
    for (var i = 0; i < G.players.length; i++) if (G.players[i].id === s.dr) drawerName = G.players[i].name;

    label(ctx, phaseText, 96, 66, '#8ea3c0', 13, 'left');
    label(ctx, '作画：' + (drawerName || '—') + '   ·   第 ' + (s.tn + 1) + '/' + s.n + ' 轮',
      d.bx + 8, d.by - 22, 'rgba(230,245,255,0.75)', 12, 'left');

    /* 倒计时 */
    label(ctx, Math.ceil(s.tl), d.bx + d.bw - 8, d.by - 24, s.tl <= 10 ? '#ff5d7d' : '#22d3ee', 30, 'right');

    /* 词语 / 提示 */
    if (s.ph === 'reveal' || s.ph === 'over') {
      label(ctx, '答案：' + (s.wd || ''), w / 2, d.by + d.bh + 46, '#a3e635', 26);
    } else if (s.ph === 'draw') {
      var isDrawer = s.dr === G.me;
      label(ctx, isDrawer ? ('你画：' + (G.word || '…')) : '猜猜看，在右下角输入答案',
        w / 2, d.by + d.bh + 42, isDrawer ? '#fbbf24' : '#8ea3c0', isDrawer ? 24 : 14);
    } else if (s.ph === 'choose') {
      if (s.dr === G.me) {
        label(ctx, '选一个词开始画', w / 2, d.by + d.bh + 42, '#fbbf24', 18);
      }
    }

    /* 猜对的人 */
    var k = 0;
    for (var id in s.gd) {
      var nm = '';
      for (var j = 0; j < G.players.length; j++) {
        if (String(G.players[j].id) === String(id)) nm = G.players[j].name;
      }
      if (!nm) continue;
      label(ctx, '✓ ' + nm, 100 + k * 110, d.by + d.bh + 84, '#a3e635', 13, 'left');
      k++;
    }
  };

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

  /* 角色头顶的名字：自己绿色，别人浅色 */
  function nameColor(info, G) {
    return (info && info.id === G.me) ? '#7dffb0' : 'rgba(230,245,255,0.8)';
  }

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
    var side = slot === 0 ? -1 : 1;
    return {
      x: c.x + Math.cos(c.a + Math.PI / 2) * 30 * side,
      y: c.y + Math.sin(c.a + Math.PI / 2) * 30 * side,
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
      for (var k = 0; k < 2; k++) {
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
      for (var q = 0; q < 2; q++) {
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

    /* 顶部信息：各家进度 */
    for (var ti = 0; ti < n; ti++) {
      var trow = s.pl[ti];
      var tpl = G.players[ti] || {};
      var home = 0;
      for (var z = 1; z <= 2; z++) if (trow[z] === LUDO.N + LUDO.HOME) home++;
      var yy = 58 + ti * 26;
      ctx.fillStyle = tpl.color || '#22d3ee';
      ctx.beginPath();
      ctx.arc(36, yy - 4, 6, 0, TAU);
      ctx.fill();
      label(ctx, tpl.name + '  到家 ' + home + '/2', 52, yy, trow[0] === G.me ? '#ffffff' : 'rgba(200,220,240,0.75)', 13, 'left');
      if (trow[0] === s.c) {
        ctx.strokeStyle = 'rgba(34,211,238,0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(26, yy - 20, 210, 26);
      }
    }
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

  /* ============================================================ */

  /* ============================================================
   * 五子棋
   * ============================================================ */
  R.GOMOKU = { N: 15, PAD: 60, CELL: 44 };

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

  /* ============================================================
   * 道具图例（坦克 / 炸弹人）画在左侧
   * ============================================================ */
  var LEGENDS = {
    tank: [
      ['⚡', '#fbbf24', '加速', '移速 x1.35，8 秒'],
      ['🔥', '#f97316', '连发', '射击间隔 x0.55，8 秒'],
      ['🛡', '#38bdf8', '护盾', '挡 1 次伤害'],
      ['✚', '#4ade80', '修护', '回 2 点耐久']
    ],
    bomber: [
      ['B', '#ff2e63', '炸弹数', '能同时放更多炸弹'],
      ['R', '#fbbf24', '爆炸范围', '火焰喷得更远'],
      ['S', '#22d3ee', '移动速度', '跑得更快']
    ]
  };

  function drawItemLegend(ctx, w, h, kind) {
    var rows = LEGENDS[kind];
    if (!rows) return;
    var x = 16;
    var y = 90;
    var rowH = 30;
    var boxH = rows.length * rowH + 34;

    ctx.save();
    ctx.fillStyle = 'rgba(8,13,22,0.72)';
    ctx.strokeStyle = 'rgba(120,170,230,0.22)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, 196, boxH, 10);
    ctx.fill();
    ctx.stroke();

    label(ctx, '道具图例', x + 14, y + 20, 'rgba(160,200,240,0.9)', 12, 'left');

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var ry = y + 34 + i * rowH + 10;
      if (kind === 'bomber') {
        /* 和场上道具一样：深色圆底 + 彩色描边 + 字母 */
        var ix = x + 24;
        ctx.fillStyle = '#0b111c';
        ctx.beginPath();
        ctx.arc(ix, ry, 11, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = row[1];
        ctx.lineWidth = 2.2;
        ctx.stroke();
        label(ctx, row[0], ix, ry + 1, row[1], 12);
        label(ctx, row[2], x + 44, ry, row[1], 12.5, 'left');
        label(ctx, row[3], x + 96, ry, 'rgba(190,210,235,0.72)', 11, 'left');
      } else {
        ctx.font = '15px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = row[1];
        ctx.fillText(row[0], x + 16, ry);
        label(ctx, row[2], x + 42, ry, row[1], 12.5, 'left');
        label(ctx, row[3], x + 90, ry, 'rgba(190,210,235,0.72)', 11, 'left');
      }
    }
    ctx.restore();
  }

  R.render = function (ctx, w, h, gameId, snap, dt, G) {
    V.t += dt;
    var fn = R[gameId];
    if (fn) fn(ctx, w, h, snap, Math.min(dt, 0.05), G || {});
    if (gameId === 'tank' || gameId === 'bomber') drawItemLegend(ctx, w, h, gameId);
  };

})(typeof window !== 'undefined' ? window : globalThis);
