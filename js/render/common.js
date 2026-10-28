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

  /* 光晕 sprite 缓存：同颜色同半径只做一次径向渐变。
     弹幕数百发子弹、坦克爆炸粒子都在 60Hz 下调这里，
     每帧 createRadialGradient 是之前最大的 Canvas 分配来源。 */
  var glowCache = {};

  function glowSprite(color, radius) {
    var key = color + '|' + radius;
    var hit = glowCache[key];
    if (hit) return hit;
    var size = Math.max(4, radius * 4);          /* 2x 渲染，DPR=2 时不糊 */
    var cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    var c = cv.getContext('2d');
    if (!c) return null;
    var half = size / 2;
    var g = c.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0, AR.rgba(color, 1));
    g.addColorStop(1, AR.rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    glowCache[key] = cv;
    return cv;
  }

  function glowCircle(ctx, x, y, r, color, alpha) {
    if (!(r > 0) || !(alpha > 0)) return;
    /* 炸弹的呼吸光晕半径是小数，量化后缓存数量才可控 */
    var sprite = glowSprite(color, Math.max(1, Math.round(r)));
    if (!sprite) return;
    var prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.min(1, alpha);
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = prev;
  }

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function particles(key) {
    var d = V.data;
    if (!d[key]) d[key] = [];
    return d[key];
  }

  function addBurst(list, x, y, color, n, speed) {
    if (reducedMotion()) return;
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
    if (reducedMotion()) { list.length = 0; return; }
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
    if (reducedMotion()) { list.length = 0; return; }
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
      } else if (kind === 'shmup') {
        if (e.t === 'explode') { addBurst(list, e.x, e.y, '#ffb020', 14, 170); sfx('boom'); }
        else if (e.t === 'playerdead') { addBurst(list, e.x, e.y, e.c || '#ff2e63', 26, 220); sfx('die'); }
        else if (e.t === 'buffget') { addBurst(list, e.x, e.y, e.c || '#4ade80', 10, 120); sfx('pop'); }
        else if (e.t === 'shield') { addBurst(list, e.x, e.y, '#38bdf8', 10, 100); sfx('pop'); }
        else if (e.t === 'bossdie') { addBurst(list, e.x, e.y, '#ffb020', 40, 260); sfx('boom'); }
        else if (e.t === 'boss') sfx('die');
      }
    }
  }

  /* 角色头顶的名字：自己绿色，别人浅色 */
  function nameColor(info, G) {
    return (info && info.id === G.me) ? '#7dffb0' : 'rgba(230,245,255,0.8)';
  }
  /* ============================================================
   * 道具图例（坦克 / 弹幕）画在左侧
   * ============================================================ */
  var LEGENDS = {
    tank: [
      ['⚡', '#fbbf24', '加速', '移速 x1.35，8 秒'],
      ['🔥', '#f97316', '连发', '射击间隔 x0.55，8 秒'],
      ['🛡', '#38bdf8', '护盾', '挡 1 次伤害'],
      ['✚', '#4ade80', '修护', '回 2 点耐久']
    ],
    shmup: [
      ['✚', '#4ade80', '修护', '回 1 点耐久'],
      ['🛡', '#38bdf8', '护盾', '挡 1 次伤害'],
      ['⚡', '#fbbf24', '连发', '射速 +8 秒'],
      ['🔱', '#c084fc', '散射', '三向射击 8 秒'],
      ['💥', '#ff2e63', '净化', '清弹 + 短暂无敌']
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
      ctx.font = '15px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = row[1];
      ctx.fillText(row[0], x + 16, ry);
      label(ctx, row[2], x + 42, ry, row[1], 12.5, 'left');
      label(ctx, row[3], x + 90, ry, 'rgba(190,210,235,0.72)', 11, 'left');
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
