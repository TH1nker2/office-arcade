/* ============================================================
 * 渲染层 · draw
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


})(typeof window !== 'undefined' ? window : globalThis);
