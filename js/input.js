/* ============================================================
 * 输入：键盘 + 鼠标，按游戏生成输入包
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;

  var I = AR.Input = {
    keys: {},
    mx: 0,
    my: 0,
    down: false,
    queue: [],
    enabled: true,
    repeat: {},
    mode: null
  };

  I.init = function (canvas) {
    function typing(e) {
      var t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    }

    root.addEventListener('keydown', function (e) {
      if (typing(e)) return;
      var c = e.code;
      if (I.isGameKey(c)) e.preventDefault();
      I.keys[c] = true;
      if (e.repeat) return;

      if (c === 'Space') I.queue.push('USE');

      if (I.mode === 'tetris') {
        if (c === 'ArrowLeft' || c === 'KeyA') { I.queue.push('L'); I.repeat[c] = 0; }
        if (c === 'ArrowRight' || c === 'KeyD') { I.queue.push('R'); I.repeat[c] = 0; }
        if (c === 'ArrowUp' || c === 'KeyW') I.queue.push('ROT');
        if (c === 'ArrowDown' || c === 'KeyS') { I.queue.push('DOWN'); I.repeat[c] = 0; }
      }
    }, { passive: false });

    root.addEventListener('keyup', function (e) {
      I.keys[e.code] = false;
      I.repeat[e.code] = 0;
    });

    root.addEventListener('blur', function () {
      I.keys = {};
      I.down = false;
    });

    if (!canvas) return;

    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      I.mx = e.clientX - r.left;
      I.my = e.clientY - r.top;
    });

    canvas.addEventListener('mousedown', function (e) {
      if (e.button === 0) I.down = true;
      if (e.button === 2) I.queue.push('USE');
    });

    canvas.addEventListener('mouseup', function (e) {
      if (e.button === 0) I.down = false;
    });

    canvas.addEventListener('mouseleave', function () {
      I.down = false;
    });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  };

  I.isGameKey = function (c) {
    return c === 'Space' || c === 'ArrowUp' || c === 'ArrowDown' ||
      c === 'ArrowLeft' || c === 'ArrowRight';
  };

  I.vec = function () {
    var k = I.keys;
    var x = 0, y = 0;
    if (k.KeyA || k.ArrowLeft) x -= 1;
    if (k.KeyD || k.ArrowRight) x += 1;
    if (k.KeyW || k.ArrowUp) y -= 1;
    if (k.KeyS || k.ArrowDown) y += 1;
    return { x: x, y: y };
  };

  I.world = function () {
    var tf = (AR.View && AR.View.tf) ? AR.View.tf : { s: 1, ox: 0, oy: 0 };
    return { x: (I.mx - tf.ox) / tf.s, y: (I.my - tf.oy) / tf.s };
  };

  I.take = function (name) {
    var i = I.queue.indexOf(name);
    if (i < 0) return false;
    I.queue.splice(i, 1);
    return true;
  };

  /* 收集本帧要发送的输入；返回 null 表示无需发送 */
  I.collect = function (gameId) {
    var v = I.vec();
    var w;

    if (gameId === 'snake') {
      w = I.world();
      return { ax: Math.round(w.x), ay: Math.round(w.y) };
    }

    if (gameId === 'ludo') {
      return I.take('USE') ? { roll: 1 } : null;
    }

    if (gameId === 'racing') {
      return { t: v.y === 0 ? 0 : -v.y, s: v.x };
    }

    if (gameId === 'tank') {
      w = I.world();
      return {
        dx: v.x, dy: v.y,
        ax: Math.round(w.x), ay: Math.round(w.y),
        f: I.down || !!I.keys.Space
      };
    }

    if (gameId === 'bomber') {
      return { dx: v.x, dy: v.y, bomb: I.take('USE') };
    }

    if (gameId === 'shmup') {
      return { dx: v.x, dy: v.y, f: I.down || !!I.keys.Space };
    }

    if (gameId === 'tetris') {
      var evs = [];
      while (I.queue.length && evs.length < 4) {
        var a = I.queue.shift();
        if (a === 'L' || a === 'R' || a === 'ROT' || a === 'DOWN') evs.push(a);
        else if (a === 'USE') evs.push('DROP');
      }
      var now = AR.now();
      var held = [
        ['ArrowLeft', 'L', 165], ['KeyA', 'L', 165],
        ['ArrowRight', 'R', 165], ['KeyD', 'R', 165],
        ['ArrowDown', 'DOWN', 55], ['KeyS', 'DOWN', 55]
      ];
      for (var j = 0; j < held.length; j++) {
        var hk = held[j];
        if (!I.keys[hk[0]]) continue;
        if (!I.repeat[hk[0]]) I.repeat[hk[0]] = now + hk[2];
        if (now >= I.repeat[hk[0]]) {
          I.repeat[hk[0]] = now + hk[2];
          if (evs.length < 4) evs.push(hk[1]);
        }
      }
      /* 清掉不属于本局的动作，避免串味 */
      I.queue = I.queue.filter(function (x) {
        return x === 'L' || x === 'R' || x === 'ROT' || x === 'DOWN' || x === 'USE';
      });
      return evs.length ? { ev: evs } : null;
    }

    return null;
  };

  I.reset = function () {
    I.keys = {};
    I.queue.length = 0;
    I.down = false;
    I.repeat = {};
  };

})(typeof window !== 'undefined' ? window : globalThis);
