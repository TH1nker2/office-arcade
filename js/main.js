/* ============================================================
 * 启动与主循环
 * ============================================================ */
(function (root) {
  'use strict';
/* ============================================================
 * main.js —— 浏览器端的启动入口
 *
 * 启动顺序：加载版本 -> 建 WebSocket -> 注册各模块的事件 -> 开渲染循环。
 * 这里只做三件事：
 *   1. 起 requestAnimationFrame 主循环，每帧推进 UI 和渲染；
 *   2. 每 33ms 把当前操作打包成一条 {t:'input'} 发给服务端；
 *   3. 捕获未处理异常，显示致命错误面板（而不是白屏）。
 *
 * 注意：真正的游戏状态永远来自服务端的 state 消息，
 * 客户端不做任何权威计算，只负责把快照画出来。
 * ============================================================ */

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
    /* 后台标签页不要继续发送输入：切走后键盘/鼠标状态可能已经过时，
       继续发会让角色一直移动或开火。 */
    if (document.hidden) return;
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

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) AR.Input.reset();
    });

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
