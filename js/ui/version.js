/* ============================================================
 * 版本说明与排行榜弹窗
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var APP = AR.App;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;
  var api = AR.Http.request;
  var toastFn = function (msg) { console.warn(msg); };

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
      toastFn('排行榜暂时不可用');
    });
  }



  AR.VersionUI = {
    init: function (deps) {
      if (deps && deps.toast) toastFn = deps.toast;
    },
    loadVersion: loadVersion,
    openVersion: openVersion,
    openBoard: openBoard
  };

})(typeof window !== 'undefined' ? window : globalThis);
