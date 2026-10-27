/* ============================================================
 * 渲染层公共状态与工具
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

  /* 角色头顶的名字：自己绿色，别人浅色 */
  function nameColor(info, G) {
    return (info && info.id === G.me) ? '#7dffb0' : 'rgba(230,245,255,0.8)';
  }
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

  /* 自绘鼠标十字准心（坦克用），坐标是屏幕坐标 */
  R.cursor = { x: -999, y: -999, on: false };

  function drawCrosshair(ctx, x, y, color) {
    var gap = 7;      /* 中心留空 */
    var len = 11;     /* 每根线长度 */
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;

    /* 四根短线 */
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
    ctx.stroke();

    /* 中心点 */
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, TAU);
    ctx.fill();

    /* 外侧一圈淡淡的准心环 */
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  var U = R.util = {
    roundRect: roundRect,
    fit: fit,
    bg: bg,
    label: label,
    glowCircle: glowCircle,
    particles: particles,
    addBurst: addBurst,
    stepParticles: stepParticles,
    drawParticles: drawParticles,
    handleEvents: handleEvents,
    nameColor: nameColor,
    drawItemLegend: drawItemLegend,
    drawCrosshair: drawCrosshair
  };

})(typeof window !== 'undefined' ? window : globalThis);
