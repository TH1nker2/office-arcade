/* ============================================================
 * 对局内 UI：画猜、击杀播报、结算提示与棋盘交互
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var APP = AR.App;
  var Net = root.Net;
  var Sfx = AR.Sfx;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;

  /* 选词列表每次快照都会重发（10Hz），内容没变就别重建，
     否则按钮每秒被重新创建 10 次，鼠标悬浮的高亮会不停闪 */
  var lastChoicesKey = '';
  function showChoices(list) {
    var box = $('choose-list');
    var key = (list || []).join('|');
    var visible = !$('choose-overlay').classList.contains('hidden');
    if (key === lastChoicesKey && visible && box.children.length) return;
    lastChoicesKey = key;
    box.innerHTML = '';
    (list || []).forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = (w && typeof w === 'object') ? (w.w || '') : w;
      b.addEventListener('click', function () {
        Net.send({ t: 'draw', n: i });
        $('choose-overlay').classList.add('hidden');
        Sfx.click();
      });
      box.appendChild(b);
    });
    if (box.children.length) $('choose-overlay').classList.remove('hidden');
  }

  /* 击杀播报的浮层 */
  var feedTimer = 0;
  function pushFeed(e) {
    var box = $('kill-feed');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'kf-line';
    el.innerHTML = '<b style="color:' + (e.color || '#8ea3c0') + '">' + esc(e.name) + '</b>' +
      '<span class="kf-x">' + (e.verb === undefined ? '击毁' : e.verb) + '</span>' +
      '<b style="color:' + (e.vcolor || '#8ea3c0') + '">' + esc(e.vname) + '</b>';
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    }, 3200);
  }

  function askExit() {
    $('confirm-title').textContent = '退出本局？';
    $('confirm-text').textContent = '退出后本局照常结算，房间会留给其他玩家继续。';
    $('confirm-overlay').classList.remove('hidden');
  }

  var DRAW_COLORS = [
    { c: '#111827', n: '黑色' },
    { c: '#ef4444', n: '红色' },
    { c: '#f97316', n: '橙色' },
    { c: '#eab308', n: '黄色' },
    { c: '#22c55e', n: '绿色' },
    { c: '#3b82f6', n: '蓝色' },
    { c: '#a855f7', n: '紫色' },
    { c: '#92400e', n: '棕色' }
  ];
  var drawToolsBuilt = false;

  function setDrawColor(color) {
    APP.drawColor = color;
    var buttons = document.querySelectorAll('#draw-colors .draw-color');
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute('data-color') === color;
      buttons[i].classList.toggle('active', on);
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function buildDrawTools() {
    if (drawToolsBuilt) return;
    var box = $('draw-colors');
    if (!box) return;
    DRAW_COLORS.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'draw-color';
      btn.style.background = item.c;
      btn.title = item.n;
      btn.setAttribute('data-color', item.c);
      btn.setAttribute('aria-label', item.n);
      btn.addEventListener('click', function () {
        setDrawColor(item.c);
        Sfx.click();
      });
      box.appendChild(btn);
    });
    drawToolsBuilt = true;
    setDrawColor(APP.drawColor || DRAW_COLORS[0].c);
  }

  function positionDrawTools() {
    var d = AR.View.data;
    var box = $('draw-tools');
    if (!d || !d.bx || !box) return;
    /* 放在画布右侧留白区，不覆盖画布 */
    var left = d.bx + d.bw + 12;
    var maxLeft = (root.innerWidth || document.documentElement.clientWidth) - 14 - box.offsetWidth;
    if (left > maxLeft) left = maxLeft;
    box.style.left = Math.max(8, Math.round(left)) + 'px';
    box.style.top = Math.max(8, Math.round(d.by)) + 'px';
  }

  function bindDraw() {
    var canvas = $('stage');
    buildDrawTools();

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { mx: e.clientX - r.left, my: e.clientY - r.top };
    }
    function send(point, prev, kind) {
      var stroke = {
        x: Math.round(point.x), y: Math.round(point.y),
        p: prev ? [Math.round(prev.x), Math.round(prev.y)] : null,
        e: kind, c: APP.drawColor || DRAW_COLORS[0].c, w: 4
      };
      AR.Render.paint({ s: stroke });        /* 自己的笔迹先画在本地 */
      Net.send({ t: 'draw', s: stroke });
    }

    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (!APP.game || APP.game.id !== 'draw' || !APP.snap) return;
      if (APP.snap.dr !== APP.me.id || APP.snap.ph !== 'draw') return;
      var p = pos(e);
      var b = AR.Render.toBoard(p.mx, p.my);
      if (!b) return;
      APP.drawing = true;
      APP.lastDraw = b;
      send(b, null, 'b');
    });
    canvas.addEventListener('mousemove', function (e) {
      if (!APP.drawing) return;
      var p = pos(e);
      var b = AR.Render.toBoard(p.mx, p.my);
      if (!b) return;
      send(b, APP.lastDraw, 'm');
      APP.lastDraw = b;
    });
    root.addEventListener('mouseup', function () { APP.drawing = false; });

    /* 五子棋：点棋盘落子 */
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (!APP.game || APP.game.id !== 'gomoku' || !APP.snap) return;
      if (APP.snap.win || APP.snap.cur !== APP.me.id) return;
      var r = canvas.getBoundingClientRect();
      var cell = AR.Render.gomokuHit(e.clientX - r.left, e.clientY - r.top, APP.snap);
      if (!cell) return;
      Net.send({ t: 'input', i: cell });
      Sfx.click();
    });

    /* 坦克：记录鼠标位置，供自绘准心用；离开画布就恢复系统箭头 */
    canvas.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect();
      AR.Render.cursor.x = e.clientX - rect.left;
      AR.Render.cursor.y = e.clientY - rect.top;
      AR.Render.cursor.on = !!(APP.game && APP.game.id === 'tank');
    });
    canvas.addEventListener('mouseleave', function () {
      AR.Render.cursor.on = false;
    });
  }

  /* ============================================================
   * 五子棋：悔棋 / 和棋 / 认输
   * ============================================================ */
  function gomokuPlayerName(id) {
    var list = APP.game && APP.game.players || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i].name;
    }
    return '';
  }

  function hideGomokuActions() {
    $('gomoku-actions').classList.add('hidden');
    $('request-overlay').classList.add('hidden');
    $('resign-overlay').classList.add('hidden');
  }

  function updateGomokuActions(s) {
    var box = $('gomoku-actions');
    if (!s || APP.screen !== 'play' || !APP.game || APP.game.id !== 'gomoku' ||
      APP.over || s.win || s.draw) {
      hideGomokuActions();
      return;
    }
    box.classList.remove('hidden');

    var rq = s.rq || { undo: 0, draw: 0 };
    var pending = !!s.pending;
    $('gomoku-undo-count').textContent = Math.max(0, 3 - (rq.undo || 0));
    $('gomoku-draw-count').textContent = Math.max(0, 3 - (rq.draw || 0));
    $('gomoku-undo').disabled = pending || (rq.undo || 0) >= 3 || s.mv <= 0 ||
      s.cur !== APP.me.id;
    $('gomoku-draw').disabled = pending || (rq.draw || 0) >= 3;
    $('gomoku-resign').disabled = pending;

    if (pending && s.pending.from !== APP.me.id) {
      var type = s.pending.type;
      var from = gomokuPlayerName(s.pending.from) || '对方';
      $('request-title').textContent = from + (type === 'undo' ? ' 请求悔棋' : ' 请求和棋');
      $('request-text').textContent = type === 'undo'
        ? '同意后将撤销最近一手，由落子方重新下。'
        : '同意后本局以平局结束，双方各 +2 分。';
      $('request-overlay').classList.remove('hidden');
    } else {
      $('request-overlay').classList.add('hidden');
    }
  }

  /* 你画我猜：只有画手看得到的画布右上角工具栏 */
  function updateDrawToolbar(s) {
    var box = $('draw-tools');
    var show = !!(s && APP.screen === 'play' && APP.game && APP.game.id === 'draw' &&
      s.ph === 'draw' && s.dr === APP.me.id);
    if (!show || !AR.View.data || !AR.View.data.bx) {
      box.classList.add('hidden');
      return;
    }
    if (box.classList.contains('hidden')) box.classList.remove('hidden');
    positionDrawTools();
  }

  /* 你画我猜：游戏内提示条 */
  var lastHintKey = '';
  function updateHintBar(s) {
    var box = $('draw-hints');
    if (!s || APP.screen !== 'play' || !APP.game || APP.game.id !== 'draw' || s.ph !== 'draw') {
      box.classList.add('hidden');
      return;
    }
    var hs = s.hs || [];
    var key = hs.join('|') + '#' + (s.ht || 0);
    if (key === lastHintKey) { box.classList.remove('hidden'); return; }
    lastHintKey = key;

    var list = '';
    for (var i = 0; i < hs.length; i++) {
      list += '<span class="dh-item"><i>' + (i + 1) + '</i>' + esc(hs[i]) + '</span>';
    }
    if (!hs.length) list = '<span class="dh-empty">暂无提示</span>';
    $('dh-list').innerHTML = list;

    var next = '';
    if (hs.length < (s.hn || 3)) next = (s.ht || 0) + ' 秒后提示 ' + (hs.length + 1);
    $('dh-next').textContent = next;
    box.classList.remove('hidden');
  }

  /* 你画我猜的面板：选词倒计时（作者）/ 等待蒙版（其他人） */
  var lastMask = '';
  function updateDrawMasks() {
    var chooseOv = $('choose-overlay');
    var waitOv = $('draw-wait');
    var s = APP.snap;
    if (!s || APP.screen !== 'play' || !APP.game || APP.game.id !== 'draw') {
      chooseOv.classList.add('hidden');
      waitOv.classList.add('hidden');
      return;
    }
    var isDrawer = s.dr === APP.me.id;
    var choosing = s.ph === 'choose';
    var left = Math.max(0, Math.ceil(s.tl));

    if (choosing && isDrawer) {
      var tip = left + ' 秒后自动随机选择';
      if ($('choose-tip').textContent !== tip) $('choose-tip').textContent = tip;
    } else {
      chooseOv.classList.add('hidden');
    }

    if (choosing && !isDrawer) {
      var drawerName = '';
      for (var i = 0; i < APP.game.players.length; i++) {
        if (APP.game.players[i].id === s.dr) drawerName = APP.game.players[i].name;
      }
      var key = drawerName + '|' + left;
      if (key !== lastMask) {
        lastMask = key;
        $('wait-title').textContent = (drawerName || '作者') + ' 正在选词…';
        $('wait-num').textContent = left;
      }
      waitOv.classList.remove('hidden');
    } else {
      waitOv.classList.add('hidden');
    }
  }



  AR.GameUI = {
    showChoices: showChoices,
    pushFeed: pushFeed,
    askExit: askExit,
    bindDraw: bindDraw,
    updateGomokuActions: updateGomokuActions,
    hideGomokuActions: hideGomokuActions,
    updateDrawToolbar: updateDrawToolbar,
    updateHintBar: updateHintBar,
    updateDrawMasks: updateDrawMasks
  };

})(typeof window !== 'undefined' ? window : globalThis);
