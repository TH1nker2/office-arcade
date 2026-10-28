/* ============================================================
 * 玩家右键菜单与公开资料卡
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var APP = AR.App;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;
  var api = AR.Http.request;
  var toastFn = function (msg) { console.warn(msg); };

  var playerReqId = 0;
  var menuTrigger = null;
  var menuKeyBound = false;

  /* 后续新增选项：追加一条配置，必要时用 divider: true 做分组，
     用 when(user) 控制是否显示，并在 handlePlayerMenuAction 里处理 action。 */
  var PLAYER_MENU_ITEMS = [
    { action: 'profile', label: '查看资料', icon: '👤' }
  ];

  function onPlayerContextMenu(e) {
    var row = e.target && e.target.closest ? e.target.closest('.user-row') : null;
    var userId = row ? Number(row.getAttribute('data-user-id')) : 0;
    if (!userId) { hidePlayerMenu(); return; }
    var user = null;
    for (var i = 0; i < APP.lobby.length; i++) {
      if (APP.lobby[i].id === userId) { user = APP.lobby[i]; break; }
    }
    if (!user) { hidePlayerMenu(); return; }
    e.preventDefault();
    showPlayerMenu(user, e.clientX, e.clientY, row);
  }

  function showPlayerMenu(user, x, y, trigger) {
    menuTrigger = trigger || null;
    var menu = $('player-menu');
    $('player-menu-title').textContent = user.nickname || user.username || '玩家';
    buildPlayerMenu(user);
    menu.classList.remove('hidden');
    menu.style.left = '0px';
    menu.style.top = '0px';
    var rect = menu.getBoundingClientRect();
    var left = Math.max(8, Math.min(x, root.innerWidth - rect.width - 8));
    var top = Math.max(8, Math.min(y, root.innerHeight - rect.height - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    var first = menu.querySelector('.ctx-item');
    if (first) first.focus();
  }

  function buildPlayerMenu(user) {
    var list = $('player-menu-list');
    list.innerHTML = '';
    PLAYER_MENU_ITEMS.forEach(function (item) {
      if (item.divider) {
        var d = document.createElement('div');
        d.className = 'ctx-divider';
        d.setAttribute('role', 'separator');
        list.appendChild(d);
        return;
      }
      if (item.when && !item.when(user)) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctx-item';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('data-action', item.action || '');
      var icon = document.createElement('span');
      icon.className = 'ctx-icon';
      icon.textContent = item.icon || '';
      var label = document.createElement('span');
      label.className = 'ctx-label';
      label.textContent = item.label || '';
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', function () {
        hidePlayerMenu();
        handlePlayerMenuAction(item.action, user);
      });
      list.appendChild(btn);
    });
  }

  function handlePlayerMenuAction(action, user) {
    if (action === 'profile') openPlayerProfile(user.id);
  }

  function hidePlayerMenu() {
    var menu = $('player-menu');
    var hadFocus = menu.contains(document.activeElement);
    menu.classList.add('hidden');
    if (hadFocus && menuTrigger && document.contains(menuTrigger) &&
      menuTrigger.getClientRects().length) {
      menuTrigger.focus();
    }
    menuTrigger = null;
  }

  function onMenuKeydown(e) {
    var items = Array.prototype.slice.call($('player-menu-list').querySelectorAll('.ctx-item'));
    if (!items.length) return;
    var idx = items.indexOf(document.activeElement);
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length].focus();
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (e.code === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.code === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if ((e.code === 'Enter' || e.code === 'Space') && idx >= 0) {
      e.preventDefault();
      items[idx].click();
    }
  }

  function openPlayerProfile(userId) {
    if (!userId) return;
    hidePlayerMenu();
    var seq = ++playerReqId;
    var av = $('player-avatar');
    av.textContent = '?';
    av.style.background = '#1b2636';
    $('player-nick').textContent = '加载中…';
    $('player-username').textContent = '';
    $('player-bio').textContent = '';
    var st = $('player-status');
    st.textContent = '正在读取资料…';
    st.className = 'player-status';
    $('player-stats').innerHTML = '';
    $('player-history').innerHTML = '<div class="empty-hint">加载中…</div>';
    $('player-edit').classList.add('hidden');
    $('player-overlay').classList.remove('hidden');

    api('GET', '/api/players/' + userId).then(function (data) {
      if (seq !== playerReqId) return;
      renderPlayerProfile(data);
    }).catch(function (err) {
      if (seq !== playerReqId) return;
      closePlayerProfile();
      toastFn(err.message || '加载玩家资料失败');
    });
  }

  function renderPlayerProfile(data) {
    var u = data.user || {};
    var av = $('player-avatar');
    av.textContent = u.avatar || String(u.nickname || '?').slice(0, 1);
    av.style.background = u.color || '#22d3ee';
    $('player-nick').textContent = u.nickname || u.username || '玩家';
    $('player-username').textContent = '@' + (u.username || '') + (data.isSelf ? ' · 这是你' : '');
    $('player-bio').textContent = u.bio || '这个人很懒，还没有写签名。';

    var st = $('player-status');
    var text = '离线';
    var cls = 'offline';
    if (data.status === 'online') {
      text = '大厅中';
      cls = 'online';
    } else if (data.status === 'waiting') {
      text = (data.gameName || '游戏') + '（等待中，' + data.roomCount + '/' + data.roomMax + '人）';
      cls = 'waiting';
    } else if (data.status === 'playing') {
      text = (data.gameName || '游戏') + '（游戏中）';
      cls = 'playing';
    }
    st.textContent = text;
    st.className = 'player-status ' + cls;

    $('player-stats').innerHTML =
      '<div class="stat-card"><b>' + (u.points || 0) + '</b><span>积分</span></div>' +
      '<div class="stat-card"><b>' + (u.wins || 0) + '</b><span>胜场</span></div>' +
      '<div class="stat-card"><b>' + (u.rounds || 0) + '</b><span>总局数</span></div>' +
      '<div class="stat-card"><b>' + (u.bestStreak || 0) + '</b><span>最高连胜</span></div>';

    $('player-edit').classList.toggle('hidden', !data.isSelf);
    renderPlayerHistory(data.history || []);
  }

  function renderPlayerHistory(list) {
    var el = $('player-history');
    if (!list.length) {
      el.innerHTML = '<div class="empty-hint">还没有战绩</div>';
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
        '<span class="h-place">' + (m.place === 0 ? '平局' : ('第 ' + m.place + ' 名')) + '</span>' +
        '<span>' + m.score + '</span>' +
        '<span class="h-delta">+' + m.delta + ' · ' + time + '</span>';
      el.appendChild(row);
    });
  }

  function closePlayerProfile() {
    playerReqId++;
    $('player-overlay').classList.add('hidden');
    $('player-edit').classList.add('hidden');
  }



  AR.PlayerPanel = {
    init: function (deps) {
      if (deps && deps.toast) toastFn = deps.toast;
      if (!menuKeyBound) {
        menuKeyBound = true;
        $('player-menu').addEventListener('keydown', onMenuKeydown);
      }
    },
    onPlayerContextMenu: onPlayerContextMenu,
    showPlayerMenu: showPlayerMenu,
    buildPlayerMenu: buildPlayerMenu,
    handlePlayerMenuAction: handlePlayerMenuAction,
    hidePlayerMenu: hidePlayerMenu,
    openPlayerProfile: openPlayerProfile,
    renderPlayerProfile: renderPlayerProfile,
    renderPlayerHistory: renderPlayerHistory,
    closePlayerProfile: closePlayerProfile
  };

})(typeof window !== 'undefined' ? window : globalThis);
