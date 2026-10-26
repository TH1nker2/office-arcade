/* ============================================================
 * 界面与流程：注册登录 / 大厅 / 游戏分区 / 房间 / 资料 / 游戏 HUD
 * ============================================================ */
(function (root) {
  'use strict';
/* ============================================================
 * ui.js —— 所有界面与界面状态机
 *
 * 这个文件很长，读的时候按下面的顺序找：
 *   1. APP 全局状态        screen（auth/lobby/play）、当前房间、当前快照
 *   2. 界面切换            showScreen / openGame / 大厅渲染
 *   3. 房间面板            玩家列表、房主按钮、设置、人机
 *   4. 对局内 HUD          计时、排行榜、道具图例、聊天
 *   5. 你画我猜专用        选词弹窗、提示条、画笔工具栏
 *   6. 结算与战绩          结算表、历史记录
 *   7. 事件绑定与工具函数  各按钮、快捷键、toast
 *
 * 约定：
 *   * 界面永远由服务端消息驱动，不在本地"猜"状态
 *   * 每帧的 UI.tick() 只做便宜的事（改文本/类名），不要在里面做布局计算
 * ============================================================ */

  var AR = root.AR;
  var Net = root.Net;
  var Sfx = AR.Sfx;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;
  var api = AR.Http.request;

  var APP = AR.App;

  var UI = AR.UI = {};

  /* ---------------- 通用 UI ---------------- */
  var toastTimer = 0;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    toastTimer = (ms || 2400) / 1000;
  }

  /* 结算层淡入淡出：先切 .is-open 走 CSS 过渡，淡出结束后才加回 .hidden。
     直接 toggle hidden 会绕过动画，所以所有调用点都走这两个函数。 */
  var overFadeTimer = 0;
  var OVER_FADE_MS = 260;
  function overReducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function showOver() {
    var el = $('over-overlay');
    clearTimeout(overFadeTimer);
    overFadeTimer = 0;
    el.classList.remove('hidden');
    el.classList.remove('is-closing');
    el.classList.remove('is-open');
    void el.offsetWidth;              /* 先落一帧透明状态，保证过渡能触发 */
    el.classList.add('is-open');
  }
  function hideOver() {
    var el = $('over-overlay');
    clearTimeout(overFadeTimer);
    overFadeTimer = 0;
    if (el.classList.contains('hidden')) return;
    if (overReducedMotion()) {
      el.classList.remove('is-open');
      el.classList.remove('is-closing');
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('is-open');
    el.classList.add('is-closing');
    overFadeTimer = setTimeout(function () {
      overFadeTimer = 0;
      el.classList.remove('is-closing');
      el.classList.add('hidden');
    }, OVER_FADE_MS);
  }

  function showScreen(name) {
    APP.screen = name;
    if (name !== 'lobby') hidePlayerMenu();
    if (name !== 'lobby' && $('player-overlay') && !$('player-overlay').classList.contains('hidden')) {
      closePlayerProfile();
    }
    if (name === 'lobby' && Net.ws && Net.ws.readyState === 1) Net.send({ t: 'lobbySync' });
    var screens = $('screens');
    var hud = $('hud');
    var chat = $('chat-panel');
    if (name === 'play') {
      screens.classList.add('hidden');
      hud.classList.remove('hidden');
      var isDraw = APP.game && APP.game.id === 'draw';
      chat.classList.toggle('chat-bottom', !isDraw);
      chat.classList.toggle('hidden', !isDraw);
      $('chat-peek').classList.add('hidden');
      return;
    }
    screens.classList.remove('hidden');
    hud.classList.add('hidden');
    chat.classList.add('hidden');
    var list = document.querySelectorAll('.screen');
    for (var i = 0; i < list.length; i++) {
      list[i].classList.toggle('active', list[i].id === 'screen-' + name);
    }
  }

  function avatarHtml(user, cls) {
    var ch = (user && user.avatar) ? user.avatar : String((user && (user.nickname || user.name)) || '?').slice(0, 1);
    var color = (user && user.color) || '#22d3ee';
    return '<span class="' + cls + '" style="background:' + color + '">' + esc(ch) + '</span>';
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  UI.init = function () {
    PlayerPanel.init({ toast: toast });
    ProfileScreen.init({ toast: toast, showScreen: showScreen, renderLobby: renderLobby, renderRoom: renderRoom });
    VersionUI.init({ toast: toast });
    LobbyRoom.init({ showScreen: showScreen, hideOver: hideOver, closeChat: closeChat, avatarHtml: avatarHtml });
    AuthUI.init({ showScreen: showScreen, toast: toast });
    GameSession.init({
      showScreen: showScreen, hideOver: hideOver, showOver: showOver,
      renderLobby: renderLobby, renderRoom: renderRoom, resetHud: resetHud
    });
    /* 登录 / 注册 */
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          setAuthMode(btn.getAttribute('data-auth'));
        });
      })(tabs[i]);
    }

    $('auth-form').addEventListener('submit', function (e) {
      e.preventDefault();
      submitAuth();
    });

    /* 大厅 */
    $('btn-logout').addEventListener('click', logout);
    $('btn-profile').addEventListener('click', openProfile);
    $('btn-board').addEventListener('click', openBoard);
    $('auth-version').addEventListener('click', openVersion);
    $('lobby-version').addEventListener('click', openVersion);
    $('version-close').addEventListener('click', function () {
      $('version-overlay').classList.add('hidden');
    });

    /* 游戏分区 */
    $('hub-back').addEventListener('click', function () {
      if (APP.room) { toast('请先离开房间'); return; }
      showScreen('lobby');
      renderLobby();
    });
    $('btn-create-room').addEventListener('click', function () {
      Net.send({ t: 'createRoom', gameId: APP.gameId });
    });
    $('btn-join-room').addEventListener('click', function () {
      var code = ($('join-code').value || '').toUpperCase().trim();
      if (code.length !== 4) { toast('请输入 4 位房间码'); return; }
      Net.send({ t: 'joinRoom', code: code });
    });
    $('join-code').addEventListener('keydown', function (e) {
      if (e.code === 'Enter') $('btn-join-room').click();
    });
    $('join-code').addEventListener('input', function (e) {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });

    /* 房间 */
    $('btn-leave-room').addEventListener('click', function () {
      Net.send({ t: 'leaveRoom' });
    });
    $('btn-start').addEventListener('click', function () {
      Net.send({ t: 'start' });
    });
    $('btn-invite').addEventListener('click', openInvitePicker);
    $('hud-clear').addEventListener('click', function () {
      if (!APP.snap || APP.snap.ph !== 'draw' || APP.snap.dr !== APP.me.id) return;
      AR.Render.clearBoard();
      Net.send({ t: 'draw', clear: 1 });
      Sfx.click();
    });

    $('planes-seg').addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn || btn.disabled) return;
      Net.send({ t: 'setting', key: 'planes', value: btn.getAttribute('data-planes') });
    });

    $('level-seg').addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn || btn.disabled) return;
      Net.send({ t: 'setting', key: 'level', value: btn.getAttribute('data-level') });
    });

    $('btn-add-bot').addEventListener('click', function () {
      Net.send({ t: 'botAdd' });
    });
    $('btn-pick-close').addEventListener('click', function () {
      $('pick-overlay').classList.add('hidden');
    });

    /* 邀请弹窗 */
    $('btn-invite-accept').addEventListener('click', function () {
      if (!APP.invite) return;
      Net.send({ t: 'inviteReply', inviteId: APP.invite.inviteId, accept: true });
      $('invite-overlay').classList.add('hidden');
      APP.invite = null;
    });
    $('btn-invite-decline').addEventListener('click', function () {
      if (!APP.invite) return;
      Net.send({ t: 'inviteReply', inviteId: APP.invite.inviteId, accept: false });
      $('invite-overlay').classList.add('hidden');
      APP.invite = null;
    });

    /* 资料 */
    $('btn-profile-back').addEventListener('click', closeProfile);
    $('btn-profile-close').addEventListener('click', closeProfile);
    $('btn-save-profile').addEventListener('click', saveProfile);
    $('btn-change-pass').addEventListener('click', changePassword);

    /* 游戏内 */
    $('hud-back').addEventListener('click', askExit);
    $('over-back').addEventListener('click', function () {
      hideOver();
      APP.over = null;
      backToRoom();
    });
    $('btn-exit-game').addEventListener('click', askExit);
    $('confirm-ok').addEventListener('click', function () {
      $('confirm-overlay').classList.add('hidden');
      Net.send({ t: 'leaveRoom' });
    });
    $('confirm-cancel').addEventListener('click', function () {
      $('confirm-overlay').classList.add('hidden');
    });
    $('board-close').addEventListener('click', function () {
      $('board-overlay').classList.add('hidden');
    });
    $('fatal-reload').addEventListener('click', function () { location.reload(); });

    /* 大厅右键查看玩家资料 */
    $('user-list').addEventListener('contextmenu', onPlayerContextMenu);
    $('player-close').addEventListener('click', closePlayerProfile);
    $('player-done').addEventListener('click', closePlayerProfile);
    $('player-edit').addEventListener('click', function () {
      closePlayerProfile();
      openProfile();
    });
    $('player-overlay').addEventListener('click', function (e) {
      if (e.target === this) closePlayerProfile();
    });
    $('player-menu').addEventListener('contextmenu', function (e) { e.preventDefault(); });
    root.addEventListener('click', function (e) {
      if (!$('player-menu').classList.contains('hidden') && !$('player-menu').contains(e.target)) {
        hidePlayerMenu();
      }
    });
    root.addEventListener('scroll', hidePlayerMenu, true);
    root.addEventListener('resize', hidePlayerMenu);

    /* 聊天：大厅 + 对局 */
    $('chat-send').addEventListener('click', function () { sendChat('room'); closeChat(); });
    $('lobby-chat-send').addEventListener('click', function () { sendChat('lobby'); });
    $('lobby-chat-text').addEventListener('keydown', function (e) {
      if (e.code === 'Enter') { e.preventDefault(); sendChat('lobby'); }
    });
    $('chat-text').addEventListener('keydown', function (e) {
      if (e.code === 'Enter') { e.preventDefault(); sendChat('room'); closeChat(); }
    });
    $('lobby-emoji-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      emojiPop('lobby-emoji-pop', 'lobby-chat-text');
    });
    $('chat-emoji-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      emojiPop('chat-emoji-pop', 'chat-text');
    });
    root.addEventListener('click', function () {
      $('lobby-emoji-pop').classList.add('hidden');
      $('chat-emoji-pop').classList.add('hidden');
    });

    /* 回车：对局里打开 / 发送聊天，不影响游戏热键 */
    root.addEventListener('keydown', function (e) {
      if (e.code !== 'Enter') return;
      if (APP.screen !== 'play') return;
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      e.preventDefault();
      if (typing) {
        sendChat('room');
        closeChat();
      } else {
        openChat();
      }
    });

    /* 回车：大厅聚焦聊天输入框；输入框已聚焦时由它自己的 keydown 负责发送 */
    root.addEventListener('keydown', function (e) {
      if (e.code !== 'Enter' || APP.screen !== 'lobby') return;
      var t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName || '')) return;
      if (document.querySelector('.overlay:not(.hidden)')) return;
      if (!$('player-menu').classList.contains('hidden')) return;
      e.preventDefault();
      $('lobby-chat-text').focus();
    });

    root.addEventListener('keydown', function (e) {
      if (e.code !== 'Escape') return;
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (!$('confirm-overlay').classList.contains('hidden')) {
        $('confirm-overlay').classList.add('hidden');
        return;
      }
      if (!$('player-menu').classList.contains('hidden')) {
        hidePlayerMenu();
        return;
      }
      if (!$('player-overlay').classList.contains('hidden')) {
        closePlayerProfile();
        return;
      }
      if (typing) return;
      if (chatOpen() && APP.screen === 'play') { closeChat(); return; }
      if (!$('over-overlay').classList.contains('hidden')) {
        hideOver();
        return;
      }
      if (APP.screen === 'play') askExit();
      else if (APP.screen === 'profile') closeProfile();
    });

    buildLobbyGames();
    buildProfileStatic();
    bindDraw();
    loadVersion();

    /* 大厅定时同步 + 连接假死检测：
       任何一次广播丢了都能在 10 秒内自愈，掉线的连接也会被主动换掉 */
    setInterval(function () {
      if (!APP.me) return;
      if (Net.ws && Net.ws.readyState === 1) {
        if (APP.screen === 'lobby') Net.send({ t: 'lobbySync' });
      }
      if (APP.connected && Net.lastMsgAt && Date.now() - Net.lastMsgAt > 70000) {
        APP.connected = false;
        toast('与服务器失去联系，正在重连…', 3000);
        Net.close();
        Net.connect().then(function () {
          APP.connected = true;
          Net.send({ t: 'lobbySync' });
        }).catch(function () { /* 下一轮再试 */ });
      }
    }, 10000);

    /* 网络事件 */
    Net.on('me', function (msg) {
      APP.me = msg.user;
      if (msg.version) {
        $('lobby-version').textContent = msg.version;
        if (!APP.version) loadVersion();
      }
      APP.lobby = msg.lobby || [];
      APP.connected = true;
      if (APP.screen === 'auth') showScreen('lobby');
      renderLobby();
    });
    Net.on('lobby', function (msg) {
      APP.lobby = msg.users || [];
      if (APP.screen === 'lobby') renderLobby();
    });
    Net.on('room', onRoom);
    Net.on('leftRoom', function () {
      APP.room = null;
      APP.game = null;
      APP.snap = null;
      hideOver();
      $('confirm-overlay').classList.add('hidden');
      closeChat();
      showScreen('lobby');
      renderLobby();
    });
    Net.on('chat', function (msg) {
      chatLine(msg.ch === 'lobby' ? 'lobby' : 'room', msg);
    });
    Net.on('chatHistory', function (msg) {
      var ch = msg.ch === 'lobby' ? 'lobby' : 'room';
      var log = $(ch === 'lobby' ? 'lobby-chat-log' : 'chat-log');
      log.innerHTML = '';
      (msg.list || []).forEach(function (line) { chatLine(ch, line, true); });
    });
    Net.on('game', onGame);
    Net.on('state', function (msg) {
      APP.snap = msg.s;
      /* 你画我猜：换轮/新局时清空画板，并收起选词框 */
      if (APP.game && APP.game.id === 'draw' && msg.s) {
        if (msg.s.tn !== APP.drawTurn) {
          APP.drawTurn = msg.s.tn;
          AR.Render.clearBoard();
          $('choose-overlay').classList.add('hidden');
        }
      }
    });

    /* 你画我猜三条私有/广播消息 */
    Net.on('choices', function (msg) { showChoices(msg.list); });
    Net.on('word', function (msg) {
      APP.word = msg.word || null;
      $('choose-overlay').classList.add('hidden');
    });
    Net.on('paint', function (msg) { AR.Render.paint(msg); });

    /* 击杀播报：从快照事件里取 kill */
    Net.on('state', function (msg) {
      var ev = (msg.s && msg.s.e) || [];
      for (var i = 0; i < ev.length; i++) {
        var e = ev[i];
        if (!e) continue;
        if (e.t === 'kill') pushFeed(e);
        else if (e.t === 'roll') {
          pushFeed({ verb: '掷出', color: e.color, name: e.name, vcolor: '#fbbf24', vname: e.dice + ' 点' });
        } else if (e.t === 'capture') {
          pushFeed({ verb: '撞回', color: e.byColor, name: e.byName, vcolor: e.whoColor, vname: e.whoName });
        } else if (e.t === 'move' && e.from === -1) {
          pushFeed({ verb: '', color: e.color, name: e.name, vcolor: '#a3e635', vname: '起飞' });
        } else if (e.t === 'move' && e.to === 44) {
          pushFeed({ verb: '', color: e.color, name: e.name, vcolor: '#a3e635', vname: '到家' });
        }
      }
    });
    Net.on('paintClear', function () { AR.Render.clearBoard(); });
    Net.on('over', onOver);
    Net.on('invite', function (msg) {
      APP.invite = msg;
      $('invite-text').innerHTML = '<b>' + esc(msg.from.nickname) + '</b> 邀请你加入 <b>' +
        esc(msg.gameName) + '</b>（房间 ' + esc(msg.roomCode) + '）';
      $('invite-overlay').classList.remove('hidden');
      Sfx.ok();
    });
    Net.on('inviteSent', function (msg) {
      toast(msg.msg || (msg.ok ? '邀请已发出' : '邀请失败'));
      if (msg.ok) $('pick-overlay').classList.add('hidden');
    });
    Net.on('inviteResult', function (msg) {
      toast(msg.ok ? (msg.name + ' 接受了邀请') : (msg.name + ' 婉拒了邀请'));
    });
    Net.on('kicked', function (msg) {
      toast(msg.msg || '账号在其他地方登录', 4000);
      setTimeout(function () { location.reload(); }, 1200);
    });
    Net.on('error', function (msg) { toast(msg.msg || msg.error || '出错了'); Sfx.bad(); });
    Net.on('close', function () {
      APP.connected = false;
      if (APP.screen === 'auth') return;
      toast('与服务器断开，正在重连…', 3000);
      setTimeout(function () {
        Net.connect().catch(function () { /* 下次再试 */ });
      }, 1500);
    });

    /* 游戏内的画布输入 */
    Sfx.init();

    /* 自动登录 */
    api('GET', '/api/me').then(function (data) {
      APP.me = data.user;
      enterGameHall();
    }).catch(function () {
      showScreen('auth');
    });
  };

  var AuthUI = AR.AuthUI;
  var enterGameHall = AuthUI.enterGameHall;
  var setAuthMode = AuthUI.setAuthMode;
  var submitAuth = AuthUI.submitAuth;
  var logout = AuthUI.logout;

  /* ============================================================
   * 大厅
   * ============================================================ */
  var LobbyRoom = AR.LobbyRoom;
  var buildLobbyGames = LobbyRoom.buildLobbyGames;
  var renderLobby = LobbyRoom.renderLobby;
  var openGame = LobbyRoom.openGame;
  var loadRooms = LobbyRoom.loadRooms;
  var renderRooms = LobbyRoom.renderRooms;
  var renderHub = LobbyRoom.renderHub;
  var onRoom = LobbyRoom.onRoom;
  var renderRoom = LobbyRoom.renderRoom;
  var openInvitePicker = LobbyRoom.openInvitePicker;

  /* ============================================================
   * 游戏开始 / 结束
   * ============================================================ */
  var GameSession = AR.GameSession;
  var onGame = GameSession.onGame;
  var onOver = GameSession.onOver;
  var backToRoom = GameSession.backToRoom;

  /* ============================================================
   * 个人资料
   * ============================================================ */
  var ProfileScreen = AR.ProfileScreen;
  var buildProfileStatic = ProfileScreen.buildProfileStatic;
  var openProfile = ProfileScreen.openProfile;
  var closeProfile = ProfileScreen.closeProfile;
  var renderProfileDraft = ProfileScreen.renderProfileDraft;
  var renderProfileStats = ProfileScreen.renderProfileStats;
  var loadHistory = ProfileScreen.loadHistory;
  var saveProfile = ProfileScreen.saveProfile;
  var changePassword = ProfileScreen.changePassword;

  /* ---------- 玩家右键菜单 / 查看资料 ---------- */
  var PlayerPanel = AR.PlayerPanel;
  var onPlayerContextMenu = PlayerPanel.onPlayerContextMenu;
  var showPlayerMenu = PlayerPanel.showPlayerMenu;
  var buildPlayerMenu = PlayerPanel.buildPlayerMenu;
  var handlePlayerMenuAction = PlayerPanel.handlePlayerMenuAction;
  var hidePlayerMenu = PlayerPanel.hidePlayerMenu;
  var openPlayerProfile = PlayerPanel.openPlayerProfile;
  var renderPlayerProfile = PlayerPanel.renderPlayerProfile;
  var renderPlayerHistory = PlayerPanel.renderPlayerHistory;
  var closePlayerProfile = PlayerPanel.closePlayerProfile;

  /* ============================================================
   * 排行榜
   * ============================================================ */
  var VersionUI = AR.VersionUI;
  var loadVersion = VersionUI.loadVersion;
  var openVersion = VersionUI.openVersion;
  var openBoard = VersionUI.openBoard;

  /* ============================================================
   * 聊天（大厅 + 对局，两个通道互相隔离）
   * ============================================================ */
  /* 聊天子模块在 js/ui/chat.js */
  var Chat = AR.Chat;
  var emojiPop = Chat.emojiPop;
  var chatLine = Chat.chatLine;
  var showPeek = Chat.showPeek;
  var sendChat = Chat.sendChat;
  var chatOpen = Chat.chatOpen;
  var openChat = Chat.openChat;
  var closeChat = Chat.closeChat;

  var GameUI = AR.GameUI;
  var showChoices = GameUI.showChoices;
  var pushFeed = GameUI.pushFeed;
  var askExit = GameUI.askExit;
  var bindDraw = GameUI.bindDraw;
  var updateDrawToolbar = GameUI.updateDrawToolbar;
  var updateHintBar = GameUI.updateHintBar;
  var updateDrawMasks = GameUI.updateDrawMasks;

  /* ============================================================
   * 每帧 HUD
   * ============================================================ */
  /* HUD 排行榜的内容缓存：html 没变就不碰 innerHTML，
     避免每帧重建 DOM 触发布局。 */
  var lastHudKey = '';
  function resetHud() { lastHudKey = ''; }

  /* 每帧调用。这里只允许做便宜的事：改文本、切类名。
     不要在这里读布局（getBoundingClientRect）、不要重建 DOM——
     每帧重排会让 60Hz 的界面掉到二三十帧。 */
  UI.tick = function (dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) $('toast').classList.add('hidden');
    }
    if (APP.screen !== 'play' || !APP.snap) return;

    updateDrawMasks();
    updateDrawToolbar(APP.snap);
    updateHintBar(APP.snap);

    var s = APP.snap;
    var left;
    if (APP.game && APP.game.id === 'draw') {
      left = s.tl;
    } else if (!s.d) {
      /* 不限时的游戏（飞行棋/五子棋）：显示已经打了多久 */
      left = s.t || 0;
    } else {
      left = Math.max(0, s.d - (s.t || 0));
    }
    $('hud-timer').textContent = AR.fmtTime(left);

    var board = $('hud-board');
    var list = [];
    for (var i = 0; i < APP.game.players.length; i++) {
      var p = APP.game.players[i];
      var sc = 0;
      var scCls = '';
      var rank = 0;
      if (APP.game.id === 'draw' && s.sc) sc = s.sc[p.id] || 0;
      else if (APP.game.id === 'shmup') {
        /* 每人独立分数，取自己那一项 */
        sc = 0;
        for (var sp = 0; sp < (s.p || []).length; sp++) if (s.p[sp].i === p.id) sc = s.p[sp].s;
      }
      else if (APP.game.id === 'racing') {
        for (var r = 0; r < s.c.length; r++) {
          if (s.c[r][0] === p.id) {
            rank = s.c[r][6];
            sc = s.c[r][7] ? '完赛' : ('第' + Math.max(1, s.c[r][5] + 1) + '圈');
          }
        }
      } else if (APP.game.id === 'tetris') {
        for (var k = 0; k < s.p.length; k++) if (s.p[k].i === p.id) sc = s.p[k].s;
      } else if (APP.game.id === 'snake') {
        for (var m = 0; m < s.s.length; m++) if (s.s[m].i === p.id) sc = s.s[m].s;
      } else if (APP.game.id === 'ludo') {
        for (var lr = 0; lr < s.pl.length; lr++) {
          if (s.pl[lr][0] !== p.id) continue;
          var home = 0;
          for (var lz = 1; lz < s.pl[lr].length; lz++) if (s.pl[lr][lz] === 44) home++;
          sc = home + '/' + (s.pl[lr].length - 1);
        }
      } else if (APP.game.id === 'gomoku') {
        var side = s.sd && s.sd[p.id];
        sc = side === 1 ? '执黑' : (side === 2 ? '执白' : '');
        scCls = side === 1 ? ' side-black' : (side === 2 ? ' side-white' : '');
      } else if (APP.game.id === 'tank') {
        for (var n = 0; n < s.p.length; n++) if (s.p[n].i === p.id) sc = s.p[n].s;
      }
      list.push({ p: p, sc: sc, scCls: scCls, rank: rank });
    }
    if (APP.game.id === 'racing') {
      list.sort(function (a, b) { return a.rank - b.rank; });
    } else if (APP.game.id !== 'gomoku') {
      list.sort(function (a, b) { return b.sc - a.sc; });
    }
    var html = '';
    list.forEach(function (it) {
      html += '<div class="hud-row' + (it.p.id === (APP.me && APP.me.id) ? ' me' : '') + '">' +
        '<span class="dotc" style="background:' + it.p.color + '"></span>' +
        '<span class="nm">' + esc(it.p.name) + '</span>' +
        '<span class="sc' + it.scCls + '">' + it.sc + '</span></div>';
    });
    if (html !== lastHudKey) {
      lastHudKey = html;
      board.innerHTML = html;
    }
  };

  /* 供 main.js 读取当前用户 id */
  UI.meId = function () { return APP.me ? APP.me.id : null; };

})(typeof window !== 'undefined' ? window : globalThis);
