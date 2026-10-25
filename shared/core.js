/* ============================================================
 * 摸鱼游戏厅 · SHENANIGANS ARCADE — 共享核心
 * 服务端与浏览器共用（Node 下挂到 globalThis）
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR = root.AR || {};

  AR.TAU = Math.PI * 2;

  AR.clamp = function (v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  };

  AR.lerp = function (a, b, t) {
    return a + (b - a) * t;
  };

  AR.wrap = function (a) {
    a = (a + Math.PI) % AR.TAU;
    if (a < 0) a += AR.TAU;
    return a - Math.PI;
  };

  AR.angleTo = function (ax, ay, bx, by) {
    return Math.atan2(by - ay, bx - ax);
  };

  AR.turnToward = function (cur, target, maxStep) {
    var d = AR.wrap(target - cur);
    if (d > maxStep) d = maxStep;
    else if (d < -maxStep) d = -maxStep;
    return AR.wrap(cur + d);
  };

  AR.dist = function (ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  };

  AR.dist2 = function (ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  };

  /* xorshift32，确定性随机 */
  AR.rng = function (seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };

  AR.now = function () {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
  };

  AR.uid = function () {
    return Math.random().toString(36).slice(2, 9);
  };

  AR.pick = function (rnd, arr) {
    return arr[Math.floor(rnd() * arr.length) % arr.length];
  };

  AR.shuffle = function (arr, rnd) {
    rnd = rnd || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  };

  AR.PLAYER_COLORS = [
    '#22d3ee', '#ff2e63', '#a3e635', '#fbbf24',
    '#a855f7', '#38bdf8', '#fb923c', '#f472b6'
  ];

  /* 十六进制颜色处理 */
  function hex2rgb(hex) {
    hex = String(hex || '#888888').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    if (!isFinite(n)) return { r: 128, g: 128, b: 128 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  AR.rgba = function (hex, alpha) {
    var c = hex2rgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
  };

  AR.shade = function (hex, amount) {
    var c = hex2rgb(hex);
    if (amount >= 0) {
      c.r += (255 - c.r) * amount;
      c.g += (255 - c.g) * amount;
      c.b += (255 - c.b) * amount;
    } else {
      c.r *= 1 + amount;
      c.g *= 1 + amount;
      c.b *= 1 + amount;
    }
    return 'rgb(' + (c.r | 0) + ',' + (c.g | 0) + ',' + (c.b | 0) + ')';
  };

  AR.fmtTime = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.ceil(sec);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

})(typeof window !== 'undefined' ? window : globalThis);
