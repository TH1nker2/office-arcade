/* ============================================================
 * 管理后台词库查看
 * ============================================================ */
(function (root) {
  'use strict';
  var AR = root.AR;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;
  var api = AR.Http.request;
  var App = null;
  var showLoginFn = function () {};

  /* ---------- 页面切换 ---------- */
  function setView(view) {
    App.view = view;
    var tabs = document.querySelectorAll('#admin-tabs .admin-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-view') === view);
    }
    $('view-users').classList.toggle('hidden', view !== 'users');
    $('view-words').classList.toggle('hidden', view !== 'words');
    if (view === 'words') loadWordLevel(App.wordLevel);
  }

  /* ---------- 词库 ---------- */
  function updateWordCounts(levels) {
    var btns = document.querySelectorAll('#word-levels .seg-btn');
    for (var i = 0; i < btns.length; i++) {
      var lv = btns[i].getAttribute('data-level');
      var num = btns[i].querySelector('.seg-num');
      if (num) num.textContent = levels && levels[lv] ? levels[lv].count : '—';
    }
  }

  function loadWordLevel(level) {
    App.wordLevel = level;
    var btns = document.querySelectorAll('#word-levels .seg-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-level') === level);
    }
    if (App.wordCache[level]) {
      renderWords();
      return;
    }
    $('word-hint').textContent = '词库加载中…';
    $('word-table').innerHTML = '<div class="empty-hint">正在读取词库…</div>';
    api('GET', '/api/admin/words?level=' + encodeURIComponent(level)).then(function (data) {
      App.wordCache[level] = data;
      updateWordCounts(data.levels);
      renderWords();
    }).catch(function (err) {
      if (String(err.message).indexOf('登录') >= 0) showLoginFn('登录已过期，请重新登录');
      else {
        $('word-hint').textContent = '词库加载失败';
        $('word-table').innerHTML = '<div class="empty-hint">' + esc(err.message) + '</div>';
      }
    });
  }

  function renderWords() {
    var data = App.wordCache[App.wordLevel];
    if (!data) return;
    var q = App.wordQ.trim().toLowerCase();
    var list = [];
    data.words.forEach(function (e) {
      if (q && e.w.toLowerCase().indexOf(q) < 0 && e.h.join(' ').toLowerCase().indexOf(q) < 0) return;
      list.push(e);
    });
    var meta = data.levels[App.wordLevel] || {};
    $('word-hint').textContent = (meta.name || '词库') + ' · ' +
      (q ? '匹配 ' + list.length + ' / ' + data.words.length : data.words.length + ' 个词') +
      ' · 修改 shared/words.json 后重启生效';
    var box = $('word-table');
    if (!list.length) {
      box.innerHTML = '<div class="empty-hint">没有匹配的词条</div>';
      return;
    }
    var html = '<div class="word-row head"><span>关键词</span><span>提示</span><span>字数</span></div>';
    list.forEach(function (e) {
      var hints = (e.h || []).map(function (h, i) {
        return '<span class="' + (i === 0 ? 'hint-len' : '') + '">' + esc(h) + '</span>';
      }).join('');
      html += '<div class="word-row">' +
        '<span class="word-main">' + esc(e.w) + '</span>' +
        '<span class="word-hints">' + hints + '</span>' +
        '<span class="word-len">' + Array.from(e.w).length + '</span></div>';
    });
    box.innerHTML = html;
  }



  AR.AdminWords = {
    init: function (deps) {
      if (deps && deps.App) App = deps.App;
      if (deps && deps.showLogin) showLoginFn = deps.showLogin;
    },
    setView: setView,
    updateWordCounts: updateWordCounts,
    loadWordLevel: loadWordLevel,
    renderWords: renderWords
  };
})(typeof window !== 'undefined' ? window : globalThis);
