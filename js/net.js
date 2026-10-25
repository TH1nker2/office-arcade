/* ============================================================
 * 客户端 WebSocket 封装
 * ============================================================ */
(function (root) {
  'use strict';

  var Net = root.Net = {
    ws: null,
    open: false,
    id: null,
    name: '',
    games: [],
    handlers: {},
    queue: [],
    lastError: '',
    lastMsgAt: Date.now()
  };

  Net.on = function (type, fn) {
    if (!Net.handlers[type]) Net.handlers[type] = [];
    Net.handlers[type].push(fn);
  };

  Net.emit = function (type, msg) {
    var arr = Net.handlers[type];
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      try { arr[i](msg); } catch (e) { console.error('[net]', type, e); }
    }
  };

  Net.url = function () {
    var loc = root.location;
    if (!loc || loc.protocol === 'file:') return null;
    return (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host + '/ws';
  };

  Net.available = function () {
    return !!Net.url();
  };

  Net.connect = function () {
    if (Net.ws && (Net.ws.readyState === 0 || Net.ws.readyState === 1)) return Promise.resolve();
    var url = Net.url();
    if (!url) return Promise.reject(new Error('请通过服务器地址打开页面（node server.js）'));
    Net.queue.length = 0;

    return new Promise(function (resolve, reject) {
      var settled = false;
      var ws;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      Net.ws = ws;

      var timer = setTimeout(function () {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch (e) { /* ignore */ }
          reject(new Error('连接超时'));
        }
      }, 7000);

      ws.onopen = function () {
        clearTimeout(timer);
        Net.open = true;
        Net.flush();
        if (!settled) { settled = true; resolve(); }
      };

      ws.onerror = function () {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('无法连接服务器'));
        }
      };

      ws.onclose = function () {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(new Error('服务器关闭了连接')); return; }
        if (ws !== Net.ws) return;
        Net.open = false;
        Net.ws = null;
        Net.queue.length = 0;
        Net.emit('close');
      };

      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg || !msg.t) return;
        if (msg.t === 'welcome') {
          Net.id = msg.id;
          Net.games = msg.games || [];
        }
        if (msg.t === 'hello') {
          Net.id = msg.id;
          Net.name = msg.name;
        }
        if (msg.t === 'error') Net.lastError = msg.msg || '';
        Net.lastMsgAt = Date.now();
        Net.emit(msg.t, msg);
      };
    });
  };

  Net.flush = function () {
    if (!Net.ws || Net.ws.readyState !== 1) return;
    while (Net.queue.length) {
      var m = Net.queue.shift();
      try { Net.ws.send(JSON.stringify(m)); } catch (e) { Net.queue.unshift(m); break; }
    }
  };

  Net.send = function (obj) {
    if (Net.ws && Net.ws.readyState === 1) {
      try { Net.ws.send(JSON.stringify(obj)); return true; } catch (e) { /* ignore */ }
    }
    if (Net.queue.length < 40) Net.queue.push(obj);
    return false;
  };

  Net.close = function () {
    Net.queue.length = 0;
    if (Net.ws) {
      try { Net.ws.close(); } catch (e) { /* ignore */ }
    }
    Net.ws = null;
    Net.open = false;
    Net.id = null;
  };

})(typeof window !== 'undefined' ? window : globalThis);
