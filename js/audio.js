/* ============================================================
 * 轻量音效（WebAudio 合成，无素材）
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var S = AR.Sfx = {
    ctx: null,
    master: null,
    enabled: true,
    ready: false
  };

  S.init = function () {
    if (S.ctx) {
      try { if (S.ctx.state === 'suspended') S.ctx.resume(); } catch (e) { /* ignore */ }
      return;
    }
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      S.ctx = new AC();
      S.master = S.ctx.createGain();
      S.master.gain.value = 0.55;
      S.master.connect(S.ctx.destination);
      S.ready = true;
    } catch (e) {
      S.ready = false;
    }
  };

  S.setEnabled = function (on) {
    S.enabled = !!on;
    if (S.master) S.master.gain.value = S.enabled ? 0.55 : 0;
  };

  S.beep = function (freq, dur, type, vol) {
    if (!S.ready || !S.enabled) return;
    try {
      var c = S.ctx;
      var t = c.currentTime;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(S.master);
      o.start(t);
      o.stop(t + dur + 0.03);
    } catch (e) { /* ignore */ }
  };

  S.noise = function (dur, vol, freq) {
    if (!S.ready || !S.enabled) return;
    try {
      var c = S.ctx;
      var t = c.currentTime;
      var len = Math.floor(c.sampleRate * (dur || 0.2));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      var src = c.createBufferSource();
      src.buffer = buf;
      var f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq || 1200, t);
      f.frequency.exponentialRampToValueAtTime(180, t + (dur || 0.2));
      var g = c.createGain();
      g.gain.setValueAtTime(vol || 0.1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.2));
      src.connect(f); f.connect(g); g.connect(S.master);
      src.start(t);
    } catch (e) { /* ignore */ }
  };

  S.click = function () { S.beep(640, 0.05, 'square', 0.05); };
  S.ok = function () { S.beep(880, 0.1, 'sine', 0.09); setTimeout(function () { S.beep(1320, 0.12, 'sine', 0.07); }, 70); };
  S.bad = function () { S.beep(180, 0.16, 'sawtooth', 0.07); };
  S.pop = function () { S.beep(520 + Math.random() * 200, 0.06, 'triangle', 0.05); };
  S.boom = function () { S.noise(0.35, 0.16, 1400); };
  S.shot = function () { S.beep(1100, 0.05, 'square', 0.03); };
  S.start = function () {
    S.beep(520, 0.1, 'square', 0.08);
    setTimeout(function () { S.beep(780, 0.1, 'square', 0.08); }, 110);
    setTimeout(function () { S.beep(1040, 0.18, 'square', 0.09); }, 220);
  };

})(typeof window !== 'undefined' ? window : globalThis);
