/* ============================================================
 * 大厅、游戏分区与房间界面
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var APP = AR.App;
  var Net = root.Net;
  var Sfx = AR.Sfx;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;
  var api = AR.Http.request;
  var showScreenFn = function () {};
  var hideOverFn = function () {};
  var closeChatFn = function () {};
  var avatarHtmlFn = function () { return ''; };
  var lastLobbyKey = null;

  function buildLobbyGames() {
    var grid = $('lobby-games');
    grid.innerHTML = '';
    AR.GAME_INFO.forEach(function (g) {
      var card = document.createElement('button');
      card.className = 'game-card';
      card.setAttribute('data-game', g.id);
      card.innerHTML =
        '<span class="badge">' + (g.min === g.max ? g.max + '人' : g.min + '-' + g.max + '人') + '</span>' +
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

    var users = APP.lobby || [];
    /* 大厅每 10 秒还有一次主动同步；内容没变就别整块重建 DOM。
       room 状态会影响“加入”按钮，必须一起进 key。 */
    var key = JSON.stringify([
      me.id, me.nickname, me.points, me.avatar, me.color,
      APP.room ? APP.room.code : '', users
    ]);
    if (key === lastLobbyKey) return;
    lastLobbyKey = key;

    $('pc-avatar').textContent = me.avatar || String(me.nickname || '?').slice(0, 1);
    $('pc-avatar').style.background = me.color || '#22d3ee';
    $('pc-name').textContent = me.nickname;
    $('pc-points').textContent = me.points + ' 分';

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
      row.setAttribute('data-user-id', String(u.id));
      row.tabIndex = 0;
      row.setAttribute('aria-haspopup', 'menu');
      row.title = '右键或回车查看 ' + u.nickname + ' 的操作';
      row.innerHTML = avatarHtmlFn(u, 'u-avatar') +
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
    showScreenFn('game');
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
      hideOverFn();
      APP.over = null;
      closeChatFn();
      showScreenFn('room');
      renderRoom();
      return;
    }

    if (msg.phase === 'playing' || APP.screen === 'play') {
      renderRoom();
      return;
    }
    if (APP.screen === 'game' || APP.screen === 'room' || APP.screen === 'lobby') {
      showScreenFn('room');
    }
    renderRoom();
  }

  var BOT_CN = { normal: '人机' };

  function renderRoom() {
    var room = APP.room;
    if (!room || !APP.me) return;
    var info = AR.getInfo(room.gameId);
    var isHost = room.hostId === APP.me.id;
    var supportsBot = room.gameId !== 'draw' && room.gameId !== 'undercover';

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

    /* 谁是卧底：最大轮数 */
    var roundsBox = $('rounds-box');
    var showRounds = room.gameId === 'undercover';
    roundsBox.classList.toggle('hidden', !showRounds);
    if (showRounds) {
      var sel = $('rounds-select');
      sel.value = String(room.rounds || 6);
      sel.disabled = !(isHost && room.phase === 'lobby');
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

      el.innerHTML = avatarHtmlFn(p, 'rp-avatar') +
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
        btn.innerHTML = avatarHtmlFn(u, 'pi-avatar') +
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



  AR.LobbyRoom = {
    init: function (deps) {
      if (deps && deps.showScreen) showScreenFn = deps.showScreen;
      if (deps && deps.hideOver) hideOverFn = deps.hideOver;
      if (deps && deps.closeChat) closeChatFn = deps.closeChat;
      if (deps && deps.avatarHtml) avatarHtmlFn = deps.avatarHtml;
    },
    buildLobbyGames: buildLobbyGames,
    renderLobby: renderLobby,
    openGame: openGame,
    loadRooms: loadRooms,
    renderRooms: renderRooms,
    renderHub: renderHub,
    onRoom: onRoom,
    renderRoom: renderRoom,
    openInvitePicker: openInvitePicker
  };

})(typeof window !== 'undefined' ? window : globalThis);
