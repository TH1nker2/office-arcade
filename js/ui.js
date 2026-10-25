/* ============================================================
 * 界面与流程：注册登录 / 大厅 / 游戏分区 / 房间 / 资料 / 游戏 HUD
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var Net = root.Net;
  var Sfx = AR.Sfx;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var EMOJIS = ['🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🦁', '🐯', '🐨', '🐷',
    '🐔', '🐙', '🦄', '🐳', '🐝', '🦉', '🐺', '🐮', '🐹', '🦖'];

  var APP = AR.App = {
    screen: 'auth',
    me: null,
    lobby: [],
    gameId: null,
    room: null,
    game: null,
    snap: null,
    round: 0,
    word: null,
    over: null,
    rooms: [],
    authMode: 'login',
    invite: null,
    drawing: false,
    lastDraw: null,
    profileDraft: null,
    connected: false,
    version: null
  };

  var UI = AR.UI = {};

  /* ---------------- 网络请求 ---------------- */
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || ('请求失败 ' + r.status));
        return data;
      });
    });
  }

  /* ---------------- 通用 UI ---------------- */
  var toastTimer = 0;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    toastTimer = (ms || 2400) / 1000;
  }

  function showScreen(name) {
    APP.screen = name;
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
      Net.send({ t: 'botAdd', level: $('bot-level').value });
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
      $('over-overlay').classList.add('hidden');
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

    root.addEventListener('keydown', function (e) {
      if (e.code !== 'Escape') return;
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (!$('confirm-overlay').classList.contains('hidden')) {
        $('confirm-overlay').classList.add('hidden');
        return;
      }
      if (typing) return;
      if (chatOpen() && APP.screen === 'play') { closeChat(); return; }
      if (!$('over-overlay').classList.contains('hidden')) {
        $('over-overlay').classList.add('hidden');
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
      $('over-overlay').classList.add('hidden');
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

  function enterGameHall(fresh) {
    if (fresh) Net.close();          /* 换账号后必须换一条连接，否则服务端还认为是旧用户 */
    APP.lobby = [];
    showScreen('lobby');
    renderLobby();
    Net.connect().then(function () {
      APP.connected = true;
      Net.send({ t: 'lobbySync' });
    }).catch(function (err) {
      toast(err.message || '无法连接服务器');
    });
  }

  /* ============================================================
   * 登录 / 注册
   * ============================================================ */
  function setAuthMode(mode) {
    APP.authMode = mode;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-auth') === mode);
    }
    $('nick-field').classList.toggle('hidden', mode !== 'register');
    $('auth-submit').textContent = mode === 'register' ? '注 册 并 进 入' : '登 录';
  }

  function submitAuth() {
    var username = ($('auth-user').value || '').trim();
    var password = $('auth-pass').value || '';
    var nickname = ($('auth-nick').value || '').trim();
    if (!username || !password) { toast('请填写用户名和密码'); return; }

    var btn = $('auth-submit');
    btn.disabled = true;
    Sfx.click();

    var req = APP.authMode === 'register'
      ? api('POST', '/api/register', { username: username, password: password, nickname: nickname })
      : api('POST', '/api/login', { username: username, password: password });

    req.then(function (data) {
      APP.me = data.user;
      $('auth-pass').value = '';
      enterGameHall(true);
      Sfx.ok();
    }).catch(function (err) {
      toast(err.message || '登录失败');
      Sfx.bad();
    }).then(function () {
      btn.disabled = false;
    });
  }

  function logout() {
    api('POST', '/api/logout').catch(function () { /* ignore */ }).then(function () {
      Net.close();
      APP.me = null;
      APP.room = null;
      APP.lobby = [];
      showScreen('auth');
      toast('已退出登录');
    });
  }

  /* ============================================================
   * 大厅
   * ============================================================ */
  function buildLobbyGames() {
    var grid = $('lobby-games');
    grid.innerHTML = '';
    AR.GAME_INFO.forEach(function (g) {
      var card = document.createElement('button');
      card.className = 'game-card';
      card.setAttribute('data-game', g.id);
      card.innerHTML =
        '<span class="badge">' + g.min + '-' + g.max + '人</span>' +
        '<div class="gc-icon">' + (g.icon || '🎮') + '</div>' +
        '<b>' + g.name + '</b><em>' + g.sub + '</em><p>' + g.desc + '</p>' +
        '<div class="gc-meta"><span>在玩 <span class="live" data-live="' + g.id + '">0</span></span>' +
        '<span>' + g.tag + '</span></div>';
      card.addEventListener('click', function () {
        Sfx.click();
        openGame(g.id);
      });
      grid.appendChild(card);
    });
  }

  function renderLobby() {
    var me = APP.me;
    if (!me) return;

    $('pc-avatar').textContent = me.avatar || String(me.nickname || '?').slice(0, 1);
    $('pc-avatar').style.background = me.color || '#22d3ee';
    $('pc-name').textContent = me.nickname;
    $('pc-points').textContent = me.points + ' 分';

    var users = APP.lobby || [];
    var online = users.filter(function (u) { return u.status !== 'offline'; }).length;
    $('lobby-stat').textContent = '在线 ' + online + ' / ' + users.length + ' 人';
    $('user-count').textContent = online + ' 在线';

    var list = $('user-list');
    list.innerHTML = '';
    users.forEach(function (u) {
      var row = document.createElement('div');
      var cls = 'offline';
      var statusText = '离线';
      var joinable = false;

      if (u.status === 'online') {
        cls = 'online';
        statusText = '大厅中';
      } else if (u.status === 'waiting') {
        cls = 'waiting';
        statusText = (u.gameName || '游戏') + '（等待中，' + u.roomCount + '/' + u.roomMax + '人）';
        joinable = !APP.room && u.id !== me.id && u.roomCount < u.roomMax;
      } else if (u.status === 'playing') {
        cls = 'playing';
        statusText = (u.gameName || '游戏') + '（游戏中）';
      }

      row.className = 'user-row ' + cls + (u.id === me.id ? ' me' : '');
      row.innerHTML = avatarHtml(u, 'u-avatar') +
        '<span class="u-main"><span class="u-name">' + esc(u.nickname) + (u.id === me.id ? '（我）' : '') +
        '</span><span class="u-status">' + esc(statusText) + '</span></span>' +
        '<span class="u-points">' + u.points + '</span>';

      if (joinable) {
        var btn = document.createElement('button');
        btn.className = 'u-join';
        btn.textContent = '加入';
        btn.title = '直接进入 TA 的房间';
        btn.addEventListener('click', function () {
          Net.send({ t: 'joinRoom', code: u.roomCode });
        });
        row.appendChild(btn);
      }
      list.appendChild(row);
    });
    if (!users.length) {
      list.innerHTML = '<div class="empty-hint">还没有人，去注册几个同事吧</div>';
    }

    var counts = {};
    users.forEach(function (u) {
      if ((u.status === 'playing' || u.status === 'waiting') && u.gameId) {
        counts[u.gameId] = (counts[u.gameId] || 0) + 1;
      }
    });
    AR.GAME_INFO.forEach(function (g) {
      var el = document.querySelector('[data-live="' + g.id + '"]');
      if (el) el.textContent = counts[g.id] || 0;
    });
  }

  /* ============================================================
   * 游戏分区
   * ============================================================ */
  function openGame(gameId) {
    APP.gameId = gameId;
    var info = AR.getInfo(gameId);
    $('hub-name').textContent = info.name;
    $('hub-sub').textContent = info.sub;
    $('hub-desc').innerHTML = info.desc + '<br>' + info.keys.join('　·　');
    $('join-code').value = '';
    showScreen('game');
    loadRooms();
  }

  function loadRooms() {
    api('GET', '/api/rooms?game=' + encodeURIComponent(APP.gameId)).then(function (data) {
      APP.rooms = data.rooms || [];
      renderRooms();
    }).catch(function () { /* ignore */ });
  }

  function renderRooms() {
    var list = $('room-list');
    var rooms = APP.rooms || [];
    $('rooms-hint').textContent = rooms.length ? (rooms.length + ' 个可加入') : '暂无';
    if (!rooms.length) {
      list.innerHTML = '<div class="empty-hint">还没有人开房，点上面的「创建房间」当第一个房主</div>';
      return;
    }
    list.innerHTML = '';
    rooms.forEach(function (r) {
      var el = document.createElement('button');
      el.className = 'room-item';
      el.innerHTML = '<span class="ri-code">' + esc(r.code) + '</span>' +
        '<span class="ri-host">房主 ' + esc(r.host) + '</span>' +
        '<span class="ri-count">' + r.count + ' / ' + r.max + ' 人</span>';
      el.addEventListener('click', function () {
        Net.send({ t: 'joinRoom', code: r.code });
      });
      list.appendChild(el);
    });
  }

  function renderHub() {
    if (!APP.gameId) return;
    loadRooms();
  }

  /* ============================================================
   * 房间
   * ============================================================ */
  function onRoom(msg) {
    APP.room = msg;

    /* 本局结束、房间回到等待中：自动从游戏画面退回房间 */
    if (APP.screen === 'play' && msg.phase === 'lobby') {
      $('over-overlay').classList.add('hidden');
      APP.over = null;
      closeChat();
      showScreen('room');
      renderRoom();
      return;
    }

    if (msg.phase === 'playing' || APP.screen === 'play') {
      renderRoom();
      return;
    }
    if (APP.screen === 'game' || APP.screen === 'room' || APP.screen === 'lobby') {
      showScreen('room');
    }
    renderRoom();
  }

  var BOT_CN = { easy: '简单', normal: '普通', hard: '困难', insane: '变态' };

  function renderRoom() {
    var room = APP.room;
    if (!room || !APP.me) return;
    var info = AR.getInfo(room.gameId);
    var isHost = room.hostId === APP.me.id;
    var supportsBot = room.gameId !== 'draw';

    $('room-code').textContent = room.code;
    $('room-game').textContent = info.name + ' · ' + info.sub;
    $('room-count').textContent = room.players.length + ' / ' + room.max + ' 人';
    $('room-desc').innerHTML = info.desc;

    var start = $('btn-start');
    var enough = room.players.length >= room.min;
    start.disabled = !(isHost && room.phase === 'lobby' && enough);
    start.textContent = isHost
      ? (enough ? '开始游戏' : ('至少 ' + room.min + ' 人' + (supportsBot ? '（可加人机）' : '')))
      : '等待房主开始';
    $('room-status').textContent = room.phase === 'playing'
      ? '本局进行中…'
      : (room.phase === 'over' ? '本局结束，稍后回到房间' : (isHost ? '你是房主，可以开始了' : '等待房主开始…'));
    $('btn-invite').disabled = room.players.length >= room.max;

    /* 你画我猜：难度选择（房里只有房主能点） */
    var levelBox = $('level-box');
    var showLevel = room.gameId === 'draw';
    levelBox.classList.toggle('hidden', !showLevel);
    if (showLevel) {
      var cur = room.level || 'normal';
      var btns = $('level-seg').querySelectorAll('.seg-btn');
      for (var li = 0; li < btns.length; li++) {
        var b = btns[li];
        b.classList.toggle('on', b.getAttribute('data-level') === cur);
        b.disabled = !(isHost && room.phase === 'lobby');
      }
    }

    /* 飞行棋：每人飞机数 */
    var planesBox = $('planes-box');
    var showPlanes = room.gameId === 'ludo';
    planesBox.classList.toggle('hidden', !showPlanes);
    if (showPlanes) {
      var pc = room.planes || 1;
      var pbtns = $('planes-seg').querySelectorAll('.seg-btn');
      for (var pi = 0; pi < pbtns.length; pi++) {
        var pb = pbtns[pi];
        pb.classList.toggle('on', Number(pb.getAttribute('data-planes')) === pc);
        pb.disabled = !(isHost && room.phase === 'lobby');
      }
    }

    var botBox = $('bot-box');
    botBox.classList.toggle('hidden', !(isHost && supportsBot && room.phase === 'lobby'));
    $('btn-add-bot').disabled = room.players.length >= room.max;

    var wrap = $('room-players');
    wrap.innerHTML = '';
    room.players.forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'room-player' + (p.id === APP.me.id ? ' me' : '') + (p.bot ? ' is-bot' : '');
      var tags = '';
      if (p.host) tags += '<span class="rp-tag">房主</span>';
      if (p.bot) tags += '<span class="rp-tag bot">人机</span>';

      el.innerHTML = avatarHtml(p, 'rp-avatar') +
        '<div class="rp-main"><div class="rp-name">' + esc(p.name) + (p.id === APP.me.id ? '（我）' : '') + '</div>' +
        '<div class="rp-sub">' + (p.bot ? (BOT_CN[p.bot] || '普通') + ' · ' : '') + (p.score || 0) + ' 分' + (p.streak > 1 ? ' · 连胜 ' + p.streak : '') + '</div></div>' +
        tags;

      if (p.bot && isHost && room.phase === 'lobby') {
        var x = document.createElement('button');
        x.className = 'rp-x';
        x.textContent = '✕';
        x.title = '移除这个人机';
        x.addEventListener('click', function () {
          Net.send({ t: 'botRemove', id: p.id });
        });
        el.appendChild(x);
      }
      wrap.appendChild(el);
    });

    var slots = Math.min(2, Math.max(0, room.max - room.players.length));
    for (var i = 0; i < slots; i++) {
      var ph = document.createElement('div');
      ph.className = 'room-player empty';
      ph.innerHTML = '<span class="rp-avatar" style="background:#1b2636"></span>' +
        '<div class="rp-main"><div class="rp-name">等待玩家…</div>' +
        '<div class="rp-sub">' + (supportsBot ? '也可以加个人机陪你' : '把房间码或邀请发出去') + '</div></div>';
      wrap.appendChild(ph);
    }
  }

  function openInvitePicker() {
    var room = APP.room;
    if (!room) return;
    var candidates = (APP.lobby || []).filter(function (u) {
      return u.id !== APP.me.id && u.status === 'online';
    });
    var list = $('pick-list');
    if (!candidates.length) {
      list.innerHTML = '<div class="empty-hint">现在没有空闲的在线玩家，把房间码发给他们也行</div>';
    } else {
      list.innerHTML = '';
      candidates.forEach(function (u) {
        var btn = document.createElement('button');
        btn.className = 'pick-item';
        btn.innerHTML = avatarHtml(u, 'pi-avatar') +
          '<span>' + esc(u.nickname) + '</span>' +
          '<span class="pi-sub">' + u.points + ' 分</span>';
        btn.addEventListener('click', function () {
          Net.send({ t: 'invite', toId: u.id });
          Sfx.click();
        });
        list.appendChild(btn);
      });
    }
    $('pick-overlay').classList.remove('hidden');
  }

  /* ============================================================
   * 游戏开始 / 结束
   * ============================================================ */
  function onGame(msg) {
    APP.game = msg;
    APP.round = msg.round || 1;
    APP.snap = null;
    APP.word = null;
    APP.over = null;
    APP.drawTurn = -1;
    $('choose-overlay').classList.add('hidden');
    $('draw-wait').classList.add('hidden');
    $('hud-clear').classList.add('hidden');
    AR.View.init(msg.id);
    AR.Input.mode = msg.id;
    AR.Input.reset();

    var info = AR.getInfo(msg.id);
    $('hud-name').textContent = info.name;
    $('hud-sub').textContent = info.sub;
    $('hud-round').textContent = '第 ' + APP.round + ' 局';
    $('hud-hint').textContent = info.keys.join('　·　');
    $('hud-center').textContent = '';
    $('over-overlay').classList.add('hidden');
    $('invite-overlay').classList.add('hidden');
    $('chat-panel').classList.toggle('chat-bottom', msg.id !== 'draw');
    $('chat-panel').classList.toggle('hidden', msg.id !== 'draw');

    if (msg.id === 'draw') {
      AR.Render.clearBoard();
      chatLine('room', { kind: 'system', text: '第 ' + APP.round + ' 轮开始，准备画画' }, true);
    }

    showScreen('play');
    Sfx.start();
  }

  function onOver(msg) {
    APP.over = msg;
    var list = msg.results || [];
    var title = '本局结束';
    if (list.length) {
      title = list[0].name + ' 获胜';
      if (list[0].id === APP.me.id) title = '你赢了！';
    }
    $('over-title').textContent = title;
    $('over-sub').textContent = AR.getInfo(msg.gameId).name + ' · 第 ' + APP.round + ' 局';

    var html = '<div class="res-row head"><span>名次</span><span>玩家</span><span class="v">本局</span><span class="d">积分</span><span class="s">总分</span></div>';
    list.forEach(function (r) {
      html += '<div class="res-row' + (r.id === APP.me.id ? ' me' : '') + '">' +
        '<span class="p">' + r.place + '</span>' +
        '<span>' + esc(r.name) + (r.detail && r.detailLabel ? ' <em class="det">' + r.detailLabel + ' ' + r.detail + '</em>' : '') + '</span>' +
        '<span class="v">' + r.score + '</span>' +
        '<span class="d">' + (r.delta ? '+' + r.delta : '—') + '</span>' +
        '<span class="s">' + r.total + '</span>' +
        '</div>';
    });
    $('over-table').innerHTML = html;
    $('over-overlay').classList.remove('hidden');
    if (list.length && list[0].id === APP.me.id) Sfx.ok();
    else Sfx.beep(300, 0.2, 'sine', 0.07);

    /* 刷新自己的总分 */
    if (APP.me) {
      var mine = list.filter(function (r) { return r.id === APP.me.id; })[0];
      if (mine) {
        APP.me.points = mine.total;
        APP.me.streak = mine.streak;
      }
    }
  }

  function backToRoom() {
    if (!APP.room) { showScreen('lobby'); renderLobby(); return; }
    showScreen('room');
    renderRoom();
  }

  /* ============================================================
   * 个人资料
   * ============================================================ */
  function buildProfileStatic() {
    var grid = $('profile-emojis');
    grid.innerHTML = '';
    EMOJIS.forEach(function (e) {
      var b = document.createElement('button');
      b.className = 'emoji-btn';
      b.textContent = e;
      b.setAttribute('data-emoji', e);
      b.addEventListener('click', function () {
        APP.profileDraft.avatar = e;
        renderProfileDraft();
      });
      grid.appendChild(b);
    });

    var colors = $('profile-colors');
    colors.innerHTML = '';
    AR.PLAYER_COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c;
      b.setAttribute('data-color', c);
      b.addEventListener('click', function () {
        APP.profileDraft.color = c;
        renderProfileDraft();
      });
      colors.appendChild(b);
    });
  }

  function openProfile() {
    var me = APP.me;
    if (!me) return;
    APP.profileDraft = {
      nickname: me.nickname,
      bio: me.bio || '',
      avatar: me.avatar || '',
      color: me.color || '#22d3ee'
    };
    $('profile-nick').value = me.nickname;
    $('profile-bio').value = me.bio || '';
    $('old-pass').value = '';
    $('new-pass').value = '';
    renderProfileDraft();
    renderProfileStats();
    loadHistory();
    showScreen('profile');
  }

  function closeProfile() {
    showScreen('lobby');
    renderLobby();
  }

  function renderProfileDraft() {
    var d = APP.profileDraft;
    var prev = $('profile-avatar-preview');
    prev.textContent = d.avatar || String(d.nickname || '?').slice(0, 1);
    prev.style.background = d.color;

    var emojis = document.querySelectorAll('.emoji-btn');
    for (var i = 0; i < emojis.length; i++) {
      emojis[i].classList.toggle('active', emojis[i].getAttribute('data-emoji') === d.avatar);
    }
    var colors = document.querySelectorAll('#profile-colors .swatch');
    for (var j = 0; j < colors.length; j++) {
      colors[j].classList.toggle('active', colors[j].getAttribute('data-color') === d.color);
    }
  }

  function renderProfileStats() {
    var me = APP.me;
    $('profile-stats').innerHTML =
      '<div class="stat-card"><b>' + me.points + '</b><span>积分</span></div>' +
      '<div class="stat-card"><b>' + me.wins + '</b><span>胜场</span></div>' +
      '<div class="stat-card"><b>' + me.rounds + '</b><span>总局数</span></div>' +
      '<div class="stat-card"><b>' + me.bestStreak + '</b><span>最高连胜</span></div>';
  }

  function loadHistory() {
    api('GET', '/api/history?limit=20').then(function (data) {
      var list = data.list || [];
      var el = $('profile-history');
      if (!list.length) {
        el.innerHTML = '<div class="empty-hint">还没有战绩，去玩一局</div>';
        return;
      }
      el.innerHTML = '';
      list.forEach(function (m) {
        var d = new Date(m.endedAt);
        var time = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
          String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        var row = document.createElement('div');
        row.className = 'history-row';
        row.innerHTML = '<b>' + esc(m.gameName) + '</b>' +
          '<span class="h-place">第 ' + m.place + ' 名</span>' +
          '<span>' + m.score + '</span>' +
          '<span class="h-delta">+' + m.delta + ' · ' + time + '</span>';
        el.appendChild(row);
      });
    }).catch(function () { /* ignore */ });
  }

  function saveProfile() {
    var d = APP.profileDraft;
    var nickname = ($('profile-nick').value || '').trim();
    if (!nickname) { toast('昵称不能为空'); return; }
    d.nickname = nickname;
    d.bio = $('profile-bio').value || '';

    api('POST', '/api/profile', d).then(function (data) {
      APP.me = Object.assign(APP.me, data.user);
      toast('资料已保存');
      Sfx.ok();
      renderLobby();
      if (APP.room) {
        renderRoom();
      }
    }).catch(function (err) {
      toast(err.message || '保存失败');
      Sfx.bad();
    });
  }

  function changePassword() {
    var oldP = $('old-pass').value;
    var newP = $('new-pass').value;
    if (!oldP || !newP) { toast('请填写原密码和新密码'); return; }
    api('POST', '/api/password', { oldPassword: oldP, newPassword: newP }).then(function () {
      toast('密码已修改');
      $('old-pass').value = '';
      $('new-pass').value = '';
      Sfx.ok();
    }).catch(function (err) {
      toast(err.message || '修改失败');
      Sfx.bad();
    });
  }

  /* ============================================================
   * 排行榜
   * ============================================================ */
  function loadVersion() {
    return api('GET', '/api/version').then(function (v) {
      APP.version = v;
      var tag = 'v' + (v.version || '?');
      $('auth-version').textContent = tag;
      $('lobby-version').textContent = tag;
      $('lobby-version').title = '当前版本 ' + tag + '，点击查看更新说明';
      document.title = '摸鱼游戏厅 ' + tag + ' · OFFICE ARCADE';
    }).catch(function () { /* 版本信息拿不到不影响使用 */ });
  }

  function openVersion() {
    var v = APP.version;
    if (!v) {
      $('version-sub').textContent = '版本信息还没加载到，稍后再试';
      $('version-body').innerHTML = '';
      $('version-overlay').classList.remove('hidden');
      return;
    }
    $('version-sub').textContent = '当前版本 v' + v.version + (v.released ? ' · ' + v.released : '');
    var html = '<div class="v-sec">本次更新</div><ul class="v-notes">' +
      (v.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    if ((v.history || []).length) {
      html += '<div class="v-sec">历史版本</div>';
      v.history.forEach(function (h) {
        html += '<div class="v-hist"><b>v' + esc(h.version) + '</b><span>' + esc(h.released || '') + '</span>' +
          '<ul class="v-notes">' +
          (h.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
          '</ul></div>';
      });
    }
    $('version-body').innerHTML = html;
    $('version-overlay').classList.remove('hidden');
  }

  function openBoard() {
    api('GET', '/api/board').then(function (data) {
      var list = data.list || [];
      var el = $('board-table');
      if (!list.length) {
        el.innerHTML = '<div class="empty-hint">还没有人玩过</div>';
      } else {
        var html = '<div class="res-row head"><span>名次</span><span>玩家</span><span class="v">积分</span><span class="d">胜场</span><span class="s">连胜</span></div>';
        list.forEach(function (r, i) {
          html += '<div class="res-row">' +
            '<span class="p">' + (i + 1) + '</span>' +
            '<span>' + esc(r.nickname) + '</span>' +
            '<span class="v">' + r.points + '</span>' +
            '<span class="d">' + r.wins + '</span>' +
            '<span class="s">' + r.bestStreak + '</span>' +
            '</div>';
        });
        el.innerHTML = html;
      }
      $('board-overlay').classList.remove('hidden');
    }).catch(function () {
      toast('排行榜暂时不可用');
    });
  }

  /* ============================================================
   * 聊天（大厅 + 对局，两个通道互相隔离）
   * ============================================================ */
  var CHAT_EMOJIS = [
    '😀', '😄', '😁', '😆', '😅', '😂', '🙂', '😉',
    '😊', '😍', '😘', '😜', '🤪', '🤔', '😐', '😴',
    '😮', '😱', '🥳', '😎', '🤖', '👻', '💀', '👍',
    '👎', '👏', '🙏', '💪', '🎉', '🔥', '💯', '⚡',
    '⭐', '✨', '❤️', '💔', '🎮', '🏆', '🍺', '🍜',
    '☕', '🐶', '🐱', '🦊', '🐼', '🐸', '🐵', '🦁'
  ];

  function emojiPop(popId, inputId) {
    var pop = $(popId);
    if (!pop.dataset.built) {
      pop.dataset.built = '1';
      CHAT_EMOJIS.forEach(function (e) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = e;
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var inp = $(inputId);
          inp.value = (inp.value || '') + e;
          inp.focus();
        });
        pop.appendChild(b);
      });
    }
    var willShow = pop.classList.contains('hidden');
    $('lobby-emoji-pop').classList.add('hidden');
    $('chat-emoji-pop').classList.add('hidden');
    if (willShow) pop.classList.remove('hidden');
  }

  function chatLine(ch, msg, silent) {
    var log = $(ch === 'lobby' ? 'lobby-chat-log' : 'chat-log');
    if (!log) return;
    var el = document.createElement('div');
    el.className = 'chat-line' +
      (msg.kind === 'correct' ? ' correct' : (msg.kind === 'system' ? ' system' : ''));
    if (msg.from) {
      var body = msg.kind === 'correct'
        ? '<span class="masked">' + esc(msg.text) + '</span><span class="ok-badge">✓ 回答正确</span>'
        : esc(msg.text);
      el.innerHTML = '<b style="color:' + (msg.from.color || '#8ea3c0') + '">' +
        esc(msg.from.name) + '</b>：' + body;
    } else {
      el.textContent = msg.text || '';
    }
    var emptyHint = log.querySelector('.chat-empty');
    if (emptyHint) emptyHint.remove();
    log.appendChild(el);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;

    if (ch === 'room' && !silent && !chatOpen()) showPeek(msg);
  }

  function showPeek(msg) {
    var el = $('chat-peek');
    if (el.classList.contains('hidden')) {
      $('chat-peek').innerHTML = '<b style="color:' + (msg.from.color || '#8ea3c0') + '">' +
        esc(msg.from.name) + '</b>：' + esc(msg.text);
      el.classList.remove('hidden');
    } else {
      el.innerHTML = '新消息：<b style="color:' + (msg.from.color || '#8ea3c0') + '">' +
        esc(msg.from.name) + '</b>：' + esc(msg.text);
    }
    if (showPeek.timer) clearTimeout(showPeek.timer);
    showPeek.timer = setTimeout(function () {
      $('chat-peek').classList.add('hidden');
    }, 4500);
  }

  function sendChat(ch) {
    var inp = $(ch === 'lobby' ? 'lobby-chat-text' : 'chat-text');
    var text = (inp.value || '').trim();
    if (!text) return false;
    Net.send({ t: 'chat', text: text });
    inp.value = '';
    Sfx.click();
    return true;
  }

  function chatOpen() {
    return !$('chat-panel').classList.contains('hidden');
  }

  function openChat() {
    $('chat-panel').classList.remove('hidden');
    $('chat-peek').classList.add('hidden');
    $('chat-text').focus();
  }

  function closeChat() {
    $('chat-text').blur();
    /* 你画我猜的聊天框常驻，其余游戏收起 */
    if (!(APP.game && APP.game.id === 'draw')) $('chat-panel').classList.add('hidden');
  }

  function showChoices(list) {
    var box = $('choose-list');
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
      '<span class="kf-x">' + (e.verb || '击毁') + '</span>' +
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

  function bindDraw() {
    var canvas = $('stage');

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { mx: e.clientX - r.left, my: e.clientY - r.top };
    }
    function send(point, prev, kind) {
      var stroke = {
        x: Math.round(point.x), y: Math.round(point.y),
        p: prev ? [Math.round(prev.x), Math.round(prev.y)] : null,
        e: kind, c: '#111827', w: 4
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

    /* 飞行棋：点棋盘掷骰 / 点飞机选择 */
    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (!APP.game || APP.game.id !== 'ludo' || !APP.snap) return;
      if (APP.snap.c !== APP.me.id) return;
      if (APP.snap.ph === 'roll') {
        Net.send({ t: 'input', i: { roll: 1 } });
        Sfx.click();
        return;
      }
      if (APP.snap.ph === 'move') {
        var r = canvas.getBoundingClientRect();
        var idx = AR.Render.ludoHitTest(e.clientX - r.left, e.clientY - r.top, APP.snap);
        if (idx >= 0) {
          Net.send({ t: 'input', i: { plane: idx } });
          Sfx.click();
        }
      }
    });
  }

  /* 你画我猜：抽屉才看得到的「清空画布」按钮 */
  function updateDrawToolbar(s) {
    var btn = $('hud-clear');
    var show = !!(s && APP.screen === 'play' && APP.game && APP.game.id === 'draw' &&
      s.ph === 'draw' && s.dr === APP.me.id);
    btn.classList.toggle('hidden', !show);
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

  /* ============================================================
   * 每帧 HUD
   * ============================================================ */
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
    var left = (APP.game && APP.game.id === 'draw') ? s.tl : ((s.d || 0) - (s.t || 0));
    $('hud-timer').textContent = AR.fmtTime(left);

    var board = $('hud-board');
    var list = [];
    for (var i = 0; i < APP.game.players.length; i++) {
      var p = APP.game.players[i];
      var sc = 0;
      var rank = 0;
      if (APP.game.id === 'draw' && s.sc) sc = s.sc[p.id] || 0;
      else if (APP.game.id === 'shmup') sc = s.sc || 0;
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
          for (var lz = 1; lz <= 2; lz++) if (s.pl[lr][lz] === 44) home++;
          sc = home + '/2';
        }
      } else if (APP.game.id === 'gomoku') {
        sc = s.mv + ' 手';
      } else if (APP.game.id === 'tank') {
        for (var n = 0; n < s.p.length; n++) if (s.p[n].i === p.id) sc = s.p[n].s;
      }
      list.push({ p: p, sc: sc, rank: rank });
    }
    if (APP.game.id === 'racing') {
      list.sort(function (a, b) { return a.rank - b.rank; });
    } else {
      list.sort(function (a, b) { return b.sc - a.sc; });
    }
    var html = '';
    list.forEach(function (it) {
      html += '<div class="hud-row' + (it.p.id === (APP.me && APP.me.id) ? ' me' : '') + '">' +
        '<span class="dotc" style="background:' + it.p.color + '"></span>' +
        '<span class="nm">' + esc(it.p.name) + '</span>' +
        '<span class="sc">' + it.sc + '</span></div>';
    });
    board.innerHTML = html;
  };

  /* 供 main.js 读取当前用户 id */
  UI.meId = function () { return APP.me ? APP.me.id : null; };

})(typeof window !== 'undefined' ? window : globalThis);
