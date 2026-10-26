/* ============================================================
 * 登录、注册与会话入口
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var APP = AR.App;
  var Net = root.Net;
  var Sfx = AR.Sfx;
  var $ = AR.Dom.$;
  var api = AR.Http.request;
  var showScreenFn = function () {};
  var toastFn = function (msg) { console.warn(msg); };

  function enterGameHall(fresh) {
    if (fresh) Net.close();          /* 换账号后必须换一条连接，否则服务端还认为是旧用户 */
    APP.lobby = [];
    showScreenFn('lobby');
    AR.LobbyRoom.renderLobby();
    Net.connect().then(function () {
      APP.connected = true;
      Net.send({ t: 'lobbySync' });
    }).catch(function (err) {
      toastFn(err.message || '无法连接服务器');
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
    if (!username || !password) { toastFn('请填写用户名和密码'); return; }

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
      toastFn(err.message || '登录失败');
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
      showScreenFn('auth');
      toastFn('已退出登录');
    });
  }



  AR.AuthUI = {
    init: function (deps) {
      if (deps && deps.showScreen) showScreenFn = deps.showScreen;
      if (deps && deps.toast) toastFn = deps.toast;
    },
    enterGameHall: enterGameHall,
    setAuthMode: setAuthMode,
    submitAuth: submitAuth,
    logout: logout
  };

})(typeof window !== 'undefined' ? window : globalThis);
