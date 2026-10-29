/* ============================================================
 * 渲染层 · undercover
 * 暗色审讯室氛围：探照光、尘埃与一层很淡的档案印章
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var V = AR.View;
  var R = AR.Render;
  var U = R.util;
  var label = U.label;

  function reduced() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  R.undercover = function (ctx, w, h, s, dt) {
    V.time = (V.time || 0) + (dt || 0);
    var t = reduced() ? 0 : V.time;

    var d = V.data;
    if (!d.ucBg || d.ucBgW !== w || d.ucBgH !== h) {
      var bgCanvas = document.createElement('canvas');
      bgCanvas.width = w;
      bgCanvas.height = h;
      var bc = bgCanvas.getContext('2d');
      var g = bc.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#080b13');
      g.addColorStop(0.55, '#0b1020');
      g.addColorStop(1, '#05070c');
      bc.fillStyle = g;
      bc.fillRect(0, 0, w, h);

      var glow = bc.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, Math.max(w, h) * 0.62);
      glow.addColorStop(0, 'rgba(34, 211, 238, 0.10)');
      glow.addColorStop(0.52, 'rgba(34, 211, 238, 0.03)');
      glow.addColorStop(1, 'rgba(3, 6, 12, 0)');
      bc.fillStyle = glow;
      bc.fillRect(0, 0, w, h);
      d.ucBg = bgCanvas;
      d.ucBgW = w;
      d.ucBgH = h;
    }
    ctx.drawImage(d.ucBg, 0, 0, w, h);

    /* 两道缓慢扫动的探照光 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 2; i++) {
      var baseX = i === 0 ? w * 0.16 : w * 0.84;
      var phase = t * 0.22 + i * 2.1;
      var fx = baseX + Math.sin(phase) * w * 0.1;
      var tx = baseX + Math.sin(phase + 1.1) * w * 0.28;
      var beam = ctx.createLinearGradient(fx, -40, tx, h);
      var alpha = 0.055 + 0.02 * Math.sin(phase * 1.7);
      beam.addColorStop(0, 'rgba(120, 220, 255, ' + alpha.toFixed(3) + ')');
      beam.addColorStop(1, 'rgba(120, 220, 255, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(fx - 18, -40);
      ctx.lineTo(fx + 18, -40);
      ctx.lineTo(tx + w * 0.12, h);
      ctx.lineTo(tx - w * 0.12, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* 中央的目标环：像一张被压在桌上的档案 */
    var cx = w * 0.5;
    var cy = h * 0.52;
    var radius = Math.min(w, h) * 0.34;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.08);
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.09)';
    ctx.lineWidth = 1.2;
    [0.56, 0.78, 1].forEach(function (k) {
      ctx.beginPath();
      ctx.arc(0, 0, radius * k, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([3, 14]);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.08)';
    ctx.stroke();
    ctx.restore();

    /* 漂浮尘埃 */
    ctx.save();
    ctx.fillStyle = 'rgba(180, 225, 255, 0.35)';
    for (var d = 0; d < 34; d++) {
      var px = ((d * 137.5 + t * (5 + d % 4)) % (w + 60)) - 30;
      var py = ((d * 83.3 + Math.sin(t * 0.25 + d) * 26) % (h + 30));
      var r = 0.6 + (d % 3) * 0.5;
      ctx.globalAlpha = 0.14 + (d % 5) * 0.035;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* 水印：放在下方，避开对局面板 */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 26px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(150, 195, 235, 0.06)';
    ctx.fillText('W H O   I S   S P Y', w / 2, h - 52);
    ctx.font = '600 10px "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(150, 195, 235, 0.05)';
    ctx.fillText('O F F I C E   A R C A D E', w / 2, h - 30);
    ctx.restore();

    if (s && s.ended) {
      label(ctx, s.win === 'undercover' ? 'UNDERCOVER WINS' : 'CIVILIANS WIN',
        w / 2, h - 84, 'rgba(251, 191, 36, 0.16)', 13);
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
