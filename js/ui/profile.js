/* ============================================================
 * 个人资料页
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var APP = AR.App;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;
  var api = AR.Http.request;
  var Sfx = AR.Sfx;
  var toastFn = function (msg) { console.warn(msg); };
  var showScreenFn = function () {};
  var renderLobbyFn = function () {};
  var renderRoomFn = function () {};

  var EMOJIS = ['🐱', '🐶', '🦊', '🐼', '🐸', '🐵', '🦁', '🐯', '🐨', '🐷',
    '🐔', '🐙', '🦄', '🐳', '🐝', '🦉', '🐺', '🐮', '🐹', '🦖'];

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
    showScreenFn('profile');
  }

  function closeProfile() {
    showScreenFn('lobby');
    renderLobbyFn();
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
    if (!nickname) { toastFn('昵称不能为空'); return; }
    d.nickname = nickname;
    d.bio = $('profile-bio').value || '';

    api('POST', '/api/profile', d).then(function (data) {
      APP.me = Object.assign(APP.me, data.user);
      toastFn('资料已保存');
      Sfx.ok();
      renderLobbyFn();
      if (APP.room) {
        renderRoomFn();
      }
    }).catch(function (err) {
      toastFn(err.message || '保存失败');
      Sfx.bad();
    });
  }

  function changePassword() {
    var oldP = $('old-pass').value;
    var newP = $('new-pass').value;
    if (!oldP || !newP) { toastFn('请填写原密码和新密码'); return; }
    api('POST', '/api/password', { oldPassword: oldP, newPassword: newP }).then(function () {
      toastFn('密码已修改');
      $('old-pass').value = '';
      $('new-pass').value = '';
      Sfx.ok();
    }).catch(function (err) {
      toastFn(err.message || '修改失败');
      Sfx.bad();
    });
  }



  AR.ProfileScreen = {
    init: function (deps) {
      if (deps && deps.toast) toastFn = deps.toast;
      if (deps && deps.showScreen) showScreenFn = deps.showScreen;
      if (deps && deps.renderLobby) renderLobbyFn = deps.renderLobby;
      if (deps && deps.renderRoom) renderRoomFn = deps.renderRoom;
    },
    buildProfileStatic: buildProfileStatic,
    openProfile: openProfile,
    closeProfile: closeProfile,
    renderProfileDraft: renderProfileDraft,
    renderProfileStats: renderProfileStats,
    loadHistory: loadHistory,
    saveProfile: saveProfile,
    changePassword: changePassword
  };

})(typeof window !== 'undefined' ? window : globalThis);
