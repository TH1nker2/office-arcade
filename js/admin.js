/* ============================================================
 * 管理后台：登录、用户列表、封禁、踢下线、踢出房间、重置密码、删号
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;
  var api = AR.Http.request;

  var App = {
    admin: null,
    users: [],
    total: 0,
    q: '',
    onlyOnline: false,
    timer: 0,
    view: 'users',
    wordLevel: 'easy',
    wordQ: '',
    wordCache: {}
  };

  var toastTimer = 0;
  function toast(msg, bad) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.borderColor = bad ? 'rgba(255,93,125,.6)' : '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }

  var AdminDialog = AR.AdminDialog;
  var dialog = AdminDialog.open;
  var closeDialog = AdminDialog.close;

  /* ---------- 登录 ---------- */
  function showLogin(tip) {
    $('admin-panel').classList.remove('active');
    $('admin-login').classList.add('active');
    if (tip) $('login-tip').textContent = tip;
  }

  function showPanel() {
    $('admin-login').classList.remove('active');
    $('admin-panel').classList.add('active');
    $('admin-name').textContent = App.admin.name + '（' + App.admin.username + '）';
    AdminWords.init({ App: App, showLogin: showLogin });
    setView('users');
    loadUsers();
    if (App.timer) clearInterval(App.timer);
    App.timer = setInterval(function () {
      if (document.hidden) return;
      if (!$('admin-panel').classList.contains('active')) return;
      if (App.view === 'users') loadUsers();
    }, 8000);
  }

  /* ---------- 数据 ---------- */
  function loadUsers() {
    var url = '/api/admin/users?q=' + encodeURIComponent(App.q);
    return api('GET', url).then(function (data) {
      App.users = data.users || [];
      App.total = data.total || 0;
      if (App.onlyOnline) App.users = App.users.filter(function (u) { return u.online; });
      renderTable();
      var online = 0;
      App.users.forEach(function (u) { if (u.online) online++; });
      $('admin-stat').textContent = '在线 ' + online + ' / 共 ' + App.total + ' 个账号';
      $('hint').textContent = App.users.filter(function (u) { return u.banned; }).length + ' 个已封禁';
    }).catch(function (err) {
      if (String(err.message).indexOf('登录') >= 0) showLogin('登录已过期，请重新登录');
      else toast(err.message, true);
    });
  }

  var AdminWords = AR.AdminWords;
  var setView = AdminWords.setView;
  var updateWordCounts = AdminWords.updateWordCounts;
  var loadWordLevel = AdminWords.loadWordLevel;
  var renderWords = AdminWords.renderWords;

  function statusOf(u) {
    if (u.banned) return { cls: 'banned', text: '已封禁' };
    if (!u.online) return { cls: 'offline', text: '离线' };
    if (u.roomCode) {
      return {
        cls: 'playing',
        text: (u.gameName || '游戏中') + '（' + (u.roomPhase === 'lobby' ? '等待中' : '游戏中') + '）'
      };
    }
    return { cls: 'online', text: '大厅中' };
  }

  function renderTable() {
    var box = $('user-table');
    if (!App.users.length) {
      box.innerHTML = '<div class="empty-hint">没有匹配的账号</div>';
      return;
    }
    var html = '<div class="admin-row head">' +
      '<span>玩家</span><span>状态</span><span>积分</span><span>胜场</span><span>操作</span></div>';
    App.users.forEach(function (u) {
      var st = statusOf(u);
      var ch = u.avatar || String(u.nickname || '?').slice(0, 1);
      var acts = [];
      acts.push('<button class="mini" data-act="ban" data-id="' + u.id + '">' + (u.banned ? '解封' : '封禁') + '</button>');
      if (u.online) acts.push('<button class="mini" data-act="kick" data-id="' + u.id + '">踢下线</button>');
      if (u.roomCode) acts.push('<button class="mini" data-act="kickroom" data-id="' + u.id + '">踢出房间</button>');
      acts.push('<button class="mini" data-act="pass" data-id="' + u.id + '">改密码</button>');
      acts.push('<button class="mini danger" data-act="del" data-id="' + u.id + '">删除</button>');

      html += '<div class="admin-row' + (u.banned ? ' banned' : '') + '">' +
        '<span class="ar-user">' +
        '<span class="ar-avatar" style="background:' + (u.color || '#22d3ee') + '">' + esc(ch) + '</span>' +
        '<span class="ar-name">' + esc(u.nickname) +
        '<em>@' + esc(u.username) + '</em></span></span>' +
        '<span class="ar-status ' + st.cls + '">' + esc(st.text) + '</span>' +
        '<span class="ar-num">' + u.points + '</span>' +
        '<span class="ar-num">' + u.wins + '</span>' +
        '<span class="ar-acts">' + acts.join('') + '</span>' +
        '</div>';
    });
    box.innerHTML = html;
  }

  /* ---------- 操作 ---------- */
  function findUser(id) {
    for (var i = 0; i < App.users.length; i++) if (App.users[i].id === Number(id)) return App.users[i];
    return null;
  }

  function doAction(act, id) {
    var u = findUser(id);
    if (!u) return;

    if (act === 'ban') {
      var banning = !u.banned;
      dialog({
        title: banning ? '封禁账号？' : '解封账号？',
        text: banning
          ? '封禁后 ' + u.nickname + ' 将无法登录，在线的话会被立刻踢下线。'
          : '解封后 ' + u.nickname + ' 可以重新登录。',
        ok: banning ? '确认封禁' : '确认解封',
        danger: banning
      }).then(function (ok) {
        if (!ok) return;
        api('POST', '/api/admin/ban', { id: u.id, banned: banning })
          .then(function () { toast(banning ? '已封禁 ' + u.nickname : '已解封 ' + u.nickname); loadUsers(); })
          .catch(function (e) { toast(e.message, true); });
      });
      return;
    }

    if (act === 'kick') {
      dialog({ title: '强制下线？', text: u.nickname + ' 会被立刻断开连接。', ok: '确认下线' }).then(function (ok) {
        if (!ok) return;
        api('POST', '/api/admin/kick', { id: u.id })
          .then(function () { toast('已把 ' + u.nickname + ' 请下线'); loadUsers(); })
          .catch(function (e) { toast(e.message, true); });
      });
      return;
    }

    if (act === 'kickroom') {
      dialog({ title: '踢出房间？', text: u.nickname + ' 会离开当前房间并回到大厅。', ok: '确认踢出' }).then(function (ok) {
        if (!ok) return;
        api('POST', '/api/admin/kickRoom', { id: u.id })
          .then(function () { toast('已踢出房间'); loadUsers(); })
          .catch(function (e) { toast(e.message, true); });
      });
      return;
    }

    if (act === 'pass') {
      var rnd = Math.random().toString(36).slice(2, 8);
      dialog({
        title: '重置密码',
        text: '给 ' + u.nickname + ' 设置一个新密码（至少 6 位）。',
        input: true, label: '新密码', value: rnd, ok: '重置'
      }).then(function (pw) {
        if (!pw) return;
        api('POST', '/api/admin/password', { id: u.id, password: pw })
          .then(function (r) { toast('新密码：' + (r.password || pw) + '（请转告本人）', false); })
          .catch(function (e) { toast(e.message, true); });
      });
      return;
    }

    if (act === 'del') {
      dialog({
        title: '删除账号',
        text: '这会永久删除 ' + u.nickname + ' 的账号与战绩，无法恢复。请输入昵称「' + u.nickname + '」确认。',
        input: true, label: '输入昵称确认', placeholder: u.nickname, ok: '永久删除', danger: true
      }).then(function (val) {
        if (!val) return;
        api('POST', '/api/admin/delete', { id: u.id, confirm: val })
          .then(function () { toast('已删除 ' + u.nickname); loadUsers(); })
          .catch(function (e) { toast(e.message, true); });
      });
    }
  }

  /* ---------- 初始化 ---------- */
  function boot() {
    $('login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var user = $('admin-user').value.trim();
      var pass = $('admin-pass').value;
      if (!user || !pass) { $('login-tip').textContent = '请填写账号和密码'; return; }
      api('POST', '/api/admin/login', { username: user, password: pass }).then(function (data) {
        App.admin = data.admin;
        $('admin-pass').value = '';
        showPanel();
      }).catch(function (err) {
        $('login-tip').textContent = err.message;
      });
    });

    $('btn-logout').addEventListener('click', function () {
      api('POST', '/api/admin/logout').catch(function () { /* ignore */ }).then(function () {
        App.admin = null;
        App.wordCache = {};
        if (App.timer) clearInterval(App.timer);
        showLogin('已退出登录');
      });
    });

    $('btn-refresh').addEventListener('click', function () {
      if (App.view === 'words') {
        App.wordCache = {};
        loadWordLevel(App.wordLevel);
      } else {
        loadUsers();
      }
    });

    $('admin-tabs').addEventListener('click', function (e) {
      var tab = e.target.closest('button[data-view]');
      if (!tab) return;
      setView(tab.getAttribute('data-view'));
    });

    $('word-levels').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-level]');
      if (!btn) return;
      loadWordLevel(btn.getAttribute('data-level'));
    });

    $('word-search').addEventListener('input', function (e) {
      App.wordQ = e.target.value;
      clearTimeout(App._wordTimer);
      App._wordTimer = setTimeout(renderWords, 120);
    });

    $('search').addEventListener('input', function (e) {
      App.q = e.target.value;
      clearTimeout(App._searchTimer);
      App._searchTimer = setTimeout(loadUsers, 250);
    });

    $('only-online').addEventListener('change', function (e) {
      App.onlyOnline = e.target.checked;
      loadUsers();
    });

    $('user-table').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      doAction(btn.getAttribute('data-act'), btn.getAttribute('data-id'));
    });

    $('dlg-ok').addEventListener('click', function () {
      closeDialog($('dlg-field').classList.contains('hidden') ? true : $('dlg-input').value);
    });
    $('dlg-cancel').addEventListener('click', function () { closeDialog(null); });
    $('dlg-input').addEventListener('keydown', function (e) {
      if (e.code === 'Enter') { e.preventDefault(); $('dlg-ok').click(); }
    });

    api('GET', '/api/admin/me').then(function (data) {
      App.admin = data.admin;
      showPanel();
    }).catch(function () {
      showLogin('请用管理员账号登录');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
