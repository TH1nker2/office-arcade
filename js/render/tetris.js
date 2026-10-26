/* ============================================================
 * 渲染层 · tetris
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


})(typeof window !== 'undefined' ? window : globalThis);
