/* ============================================================
 * 对局开始、结算与返回房间
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var APP = AR.App;
  var Sfx = AR.Sfx;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;
  var chatLine = AR.Chat.chatLine;
  var showScreenFn = function () {};
  var hideOverFn = function () {};
  var showOverFn = function () {};
  var renderLobbyFn = function () {};
  var renderRoomFn = function () {};
  var resetHudFn = function () {};

  function onGame(msg) {
    APP.game = msg;
    APP.round = msg.round || 1;
    APP.snap = null;
    APP.word = null;
    resetHudFn();
    APP.over = null;
    APP.drawTurn = -1;
    $('choose-overlay').classList.add('hidden');
    $('draw-wait').classList.add('hidden');
    $('draw-tools').classList.add('hidden');
    if (AR.GameUI && AR.GameUI.hideGomokuActions) AR.GameUI.hideGomokuActions();
    if (AR.UndercoverUI) AR.UndercoverUI.onGame(msg.id);
    AR.View.init(msg.id);
    AR.Input.mode = msg.id;
    AR.Input.reset();

    var info = AR.getInfo(msg.id);
    $('hud-name').textContent = info.name;
    $('hud-sub').textContent = info.sub;
    $('hud-round').textContent = '第 ' + APP.round + ' 局';
    $('hud-hint').textContent = info.keys.join('　·　');
    $('hud-center').textContent = '';
    $('hud-board').classList.toggle('hidden', msg.id === 'undercover');
    hideOverFn();
    $('invite-overlay').classList.add('hidden');
    $('stage').classList.toggle('aiming', msg.id === 'tank');
    $('chat-panel').classList.toggle('chat-bottom', msg.id !== 'draw');
    $('chat-panel').classList.toggle('hidden', msg.id !== 'draw');

    if (msg.id === 'draw') {
      AR.Render.clearBoard();
      chatLine('room', { kind: 'system', text: '第 ' + APP.round + ' 轮开始，准备画画' }, true);
    }

    showScreenFn('play');
    Sfx.start();
  }

  function onOver(msg) {
    APP.over = msg;
    if (AR.GameUI && AR.GameUI.hideGomokuActions) AR.GameUI.hideGomokuActions();
    if (AR.UndercoverUI) AR.UndercoverUI.hide();
    var list = msg.results || [];
    var mine = APP.me ? list.filter(function (r) { return r.id === APP.me.id; })[0] : null;
    var isDraw = list.length > 1 && list.every(function (r) { return r.draw; });
    var ucWin = msg.gameId === 'undercover'
      ? (msg.winner === 'undercover' ? '卧底获胜' : (msg.winner === 'civilian' ? '平民获胜' : ''))
      : '';
    var title = '本局结束';
    if (isDraw) {
      title = '平局';
    } else if (ucWin) {
      title = (mine && mine.win) ? '你赢了！' : ucWin;
    } else if (list.length) {
      title = list[0].name + ' 获胜';
      if (list[0].id === APP.me.id) title = '你赢了！';
    }
    $('over-title').textContent = title;
    var sub = AR.getInfo(msg.gameId).name + ' · 第 ' + APP.round + ' 局';
    if (ucWin) sub += ' · ' + ucWin;
    $('over-sub').textContent = sub;

    var html = '<div class="res-row head"><span>名次</span><span>玩家</span><span class="v">本局</span><span class="d">积分</span><span class="s">总分</span></div>';
    list.forEach(function (r) {
      var roleTag = '';
      if (msg.gameId === 'undercover' && r.role) {
        var roleCn = r.role === 'undercover' ? '卧底' : '平民';
        roleTag = ' <em class="det uc-role-badge ' + r.role + '">' + roleCn +
          (r.win ? ' · 胜' : ' · 负') + '</em>';
      }
      html += '<div class="res-row' + (r.id === APP.me.id ? ' me' : '') + '">' +
        '<span class="p">' + (r.draw ? '平' : r.place) + '</span>' +
        '<span>' + esc(r.name) + roleTag + (r.detail && r.detailLabel ? ' <em class="det">' + r.detailLabel + ' ' + r.detail + '</em>' : '') + '</span>' +
        '<span class="v">' + r.score + '</span>' +
        '<span class="d">' + (r.delta ? '+' + r.delta : '—') + '</span>' +
        '<span class="s">' + r.total + '</span>' +
        '</div>';
    });
    $('over-table').innerHTML = html;
    showOverFn();
    if (isDraw) Sfx.beep(440, 0.2, 'sine', 0.07);
    else if (mine && mine.win) Sfx.ok();
    else if (list.length && list[0].id === APP.me.id) Sfx.ok();
    else Sfx.beep(300, 0.2, 'sine', 0.07);

    /* 刷新自己的总分 */
    if (APP.me) {
      if (mine) {
        APP.me.points = mine.total;
        APP.me.streak = mine.streak;
      }
    }
  }

  function backToRoom() {
    if (!APP.room) { showScreenFn('lobby'); renderLobbyFn(); return; }
    showScreenFn('room');
    renderRoomFn();
  }



  AR.GameSession = {
    init: function (deps) {
      if (deps && deps.showScreen) showScreenFn = deps.showScreen;
      if (deps && deps.hideOver) hideOverFn = deps.hideOver;
      if (deps && deps.showOver) showOverFn = deps.showOver;
      if (deps && deps.renderLobby) renderLobbyFn = deps.renderLobby;
      if (deps && deps.renderRoom) renderRoomFn = deps.renderRoom;
      if (deps && deps.resetHud) resetHudFn = deps.resetHud;
    },
    onGame: onGame,
    onOver: onOver,
    backToRoom: backToRoom
  };

})(typeof window !== 'undefined' ? window : globalThis);
