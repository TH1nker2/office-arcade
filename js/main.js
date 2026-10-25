/* ============================================================
 * 启动与主循环
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var Net = root.Net;

  var canvas, ctx, W = 0, H = 0, dpr = 1;
  var last = 0;

  function resize() {
    dpr = Math.min(root.devicePixelRatio || 1, 2);
    W = root.innerWidth;
    H = root.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }

  function loop(now) {
    root.requestAnimationFrame(loop);
    var dt = (now - last) / 1000;
    last = now;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.05);

    try {
      AR.UI.tick(dt);
      if (AR.App.screen === 'play' && AR.App.snap && AR.App.game) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        AR.Render.render(ctx, W, H, AR.App.game.id, AR.App.snap, dt, {
          me: AR.App.me ? AR.App.me.id : null,
          players: AR.App.game.players,
          meta: AR.App.game.meta,
          word: AR.App.word
        });
      }
    } catch (e) {
      console.error('[render]', e);
    }
  }

  function sendInputs() {
    if (AR.App.screen !== 'play' || !AR.App.game) return;
    var id = AR.App.game.id;
    if (id === 'draw') return;
    var inp = AR.Input.collect(id);
    if (inp) Net.send({ t: 'input', i: inp });
  }

  function fatal(msg) {
    var box = document.getElementById('fatal');
    var txt = document.getElementById('fatal-text');
    if (txt) txt.textContent = String(msg || '未知错误');
    if (box) box.classList.remove('hidden');
  }

  root.addEventListener('error', function (e) {
    if (!e) return;
    fatal((e.message || '脚本错误') + (e.filename ? '\n' + e.filename + ':' + (e.lineno || 0) : ''));
  });

  root.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    if (r && r.message) fatal(r.message);
  });

  function boot() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d');
    resize();
    root.addEventListener('resize', resize);

    AR.Input.init(canvas);
    AR.UI.init();

    /* 首次交互解锁音频 */
    var unlock = function () {
      AR.Sfx.init();
      root.removeEventListener('pointerdown', unlock);
      root.removeEventListener('keydown', unlock);
    };
    root.addEventListener('pointerdown', unlock);
    root.addEventListener('keydown', unlock);

    last = performance.now();
    root.requestAnimationFrame(loop);
    setInterval(sendInputs, 33);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
