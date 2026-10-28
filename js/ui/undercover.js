/* ============================================================
 * 谁是卧底：身份卡、轮流描述、投票与结算展示
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var APP = AR.App;
  var Net = root.Net;
  var Sfx = AR.Sfx;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;

  var PHASE_CN = { brief: '准备', describe: '描述', vote: '投票', reveal: '公布', over: '结束' };
  var ROLE_CN = { undercover: '卧底', civilian: '平民' };

  var active = false;
  var lastKey = '';
  var lastPrivateKey = '';
  var lastTimer = '';
  var lastFocusKey = '';
  var pendingVote = '';

  function myId() {
    return APP.me ? APP.me.id : null;
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s，。！？、,.!?~～·\-_]/g, '')
      .trim();
  }

  function roleName(role) {
    return ROLE_CN[role] || '';
  }

  function ucStore() {
    if (!APP.uc) APP.uc = { role: '', word: '', round: 1, maxRounds: 6 };
    return APP.uc;
  }

  function same(a, b) {
    return String(a) === String(b);
  }

  function nameOf(s, id) {
    var list = (s && s.pl) || [];
    for (var i = 0; i < list.length; i++) {
      if (same(list[i].i, id)) return list[i].n;
    }
    var players = (APP.game && APP.game.players) || [];
    for (var j = 0; j < players.length; j++) {
      if (same(players[j].id, id)) return players[j].name;
    }
    return '玩家';
  }

  function updateIdentity() {
    var uc = ucStore();
    var roleEl = $('uc-role');
    var wordEl = $('uc-word');
    roleEl.textContent = roleName(uc.role) || '身份加载中…';
    roleEl.classList.toggle('is-undercover', uc.role === 'undercover');
    roleEl.classList.toggle('is-civilian', uc.role === 'civilian');
    wordEl.textContent = uc.word ? ('你的词 · ' + uc.word) : '词条加载中…';
  }

  /* ---------------- 生命周期 ---------------- */
  function onGame(gameId) {
    active = gameId === 'undercover';
    lastKey = '';
    lastPrivateKey = '';
    lastTimer = '';
    lastFocusKey = '';
    pendingVote = '';
    $('uc-text').value = '';
    if (!active) {
      $('undercover-panel').classList.add('hidden');
      return;
    }
    APP.uc = { role: '', word: '', round: 1, maxRounds: 6 };
    updateIdentity();
    $('uc-round').textContent = '1';
    $('uc-max-rounds').textContent = '6';
    $('uc-phase').textContent = PHASE_CN.brief;
    $('uc-timer').textContent = '--';
    $('uc-turn').textContent = '身份发放中…';
    $('uc-desc').innerHTML = '';
    $('uc-hint').textContent = '';
    $('uc-input-box').classList.add('hidden');
    $('uc-last-out').classList.add('hidden');
    $('undercover-panel').classList.remove('hidden');
  }

  function hide() {
    active = false;
    $('undercover-panel').classList.add('hidden');
  }

  function onPrivate(msg) {
    if (!APP.game || APP.game.id !== 'undercover') return;
    var uc = ucStore();
    uc.role = msg.role || '';
    uc.word = msg.word || '';
    uc.round = msg.round || 1;
    uc.maxRounds = msg.maxRounds || 6;
    var key = uc.role + '|' + uc.word + '|' + uc.maxRounds;
    if (key === lastPrivateKey) return;
    lastPrivateKey = key;
    updateIdentity();
  }

  function onState(msg) {
    if (!APP.game || APP.game.id !== 'undercover' || !msg.s) return;
    var s = msg.s;
    var events = s.e || [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e) continue;
      if (e.t === 'invalid' && e.to === myId()) {
        AR.UI.toast('描述里不能直接出现你自己的词');
        Sfx.bad();
      } else if (e.t === 'vote') {
        if (e.tie) {
          AR.UI.toast('平票，本轮无人出局');
          Sfx.beep(440, 0.16, 'sine', 0.06);
        } else {
          AR.UI.toast(e.name + ' 被投出 · ' + roleName(e.role));
          if (e.role === 'undercover') Sfx.ok();
          else Sfx.beep(300, 0.18, 'sine', 0.06);
        }
      }
    }

    if (s.ph !== 'vote' || (s.voted || []).some(function (id) { return same(id, myId()); })) pendingVote = '';
  }

  /* ---------------- 渲染 ---------------- */
  function canVote(s, targetId) {
    var me = myId();
    if (!me || s.ph !== 'vote' || s.ended) return false;
    if (!(s.alive || []).some(function (id) { return same(id, me); })) return false;
    if (same(targetId, me)) return false;
    if (!(s.alive || []).some(function (id) { return same(id, targetId); })) return false;
    if ((s.voted || []).some(function (id) { return same(id, me); })) return false;
    return true;
  }

  function renderPlayers(s) {
    var me = myId();
    var descIds = {};
    (s.desc || []).forEach(function (d) { descIds[d.i] = true; });
    var outRoles = {};
    (s.out || []).forEach(function (o) { outRoles[o.id] = o.role; });
    var roleMap = (s.ended && s.roles) ? s.roles : outRoles;
    var votedMe = (s.voted || []).some(function (id) { return same(id, me); });
    var html = '';

    (s.pl || []).forEach(function (p) {
      var alive = !!p.al;
      var isMe = same(p.i, me);
      var isCurrent = alive && s.ph === 'describe' && same(s.cur, p.i);
      var votable = canVote(s, p.i) && !pendingVote;
      var voted = (s.voted || []).some(function (id) { return same(id, p.i); });
      var role = roleMap[p.i] || '';
      var status = '';
      if (!alive) status = '已出局' + (role ? ' · ' + roleName(role) : '');
      else if (isCurrent) status = '正在描述';
      else if (voted && s.ph === 'vote') status = '已投票';
      else if (descIds[p.i]) status = '已描述';
      else status = '等待发言';

      var cls = 'uc-player' + (isMe ? ' me' : '') + (alive ? '' : ' dead') +
        (isCurrent ? ' current' : '') + (votable ? ' votable' : '') +
        (String(pendingVote) === String(p.i) ? ' pending' : '') + (voted ? ' voted' : '');
      html += '<button type="button" class="' + cls + '" data-uc-id="' + esc(p.i) + '"' +
        (votable ? '' : ' disabled') + ' aria-label="' + esc(p.n + '，' + status) + '">' +
        '<span class="uc-avatar" style="background:' + esc(p.c || '#22d3ee') + '">' +
        esc(String(p.n || '?').slice(0, 1)) + '</span>' +
        '<span class="uc-player-main"><b>' + esc(p.n) + (isMe ? '（我）' : '') + '</b>' +
        '<em>' + esc(status) + (votable ? ' · 点击投票' : '') + '</em></span>' +
        (voted && s.ph === 'vote' ? '<span class="uc-check">✓</span>' : '') +
        (role && s.ended ? '<span class="uc-role-mini ' + role + '">' + roleName(role) + '</span>' : '') +
        '</button>';
    });
    $('uc-players').innerHTML = html;

    var aliveCount = (s.alive || []).length;
    $('uc-alive-count').textContent = aliveCount + ' / ' + (s.pl || []).length + ' 存活';

    if (s.ph === 'vote') {
      $('uc-vote-status').textContent = votedMe
        ? '你已投票，等待其他玩家…'
        : '已投 ' + (s.voted || []).length + ' / ' + aliveCount + ' 人';
    } else if (s.ph === 'reveal') {
      $('uc-vote-status').textContent = '投票结果已公布';
    } else {
      $('uc-vote-status').textContent = '身份与词只有自己可见';
    }
  }

  function renderDesc(s) {
    var box = $('uc-desc');
    var oldCount = box.children.length;
    var list = s.desc || [];
    if (!list.length) {
      box.innerHTML = '<div class="uc-desc-empty">' +
        (s.ph === 'brief' ? '准备阶段，稍后开始轮流描述' : '本轮还没有人描述') + '</div>';
      return;
    }
    var me = myId();
    var html = '';
    list.forEach(function (d, idx) {
      var timeout = d.t === '（时间到，未描述）';
      html += '<div class="uc-line' + (same(d.i, me) ? ' me' : '') + (timeout ? ' timeout' : '') + '">' +
        '<span class="uc-line-no">' + (idx + 1) + '</span>' +
        '<b class="uc-line-name">' + esc(d.n) + '</b>' +
        '<span class="uc-line-text">' + esc(d.t) + '</span></div>';
    });
    box.innerHTML = html;
    if (list.length !== oldCount) {
      box.scrollTop = box.scrollHeight;
    }
  }

  function renderTurn(s) {
    var me = myId();
    var turn = $('uc-turn');
    var hint = $('uc-hint');
    var text = '';
    var sub = '';

    if (s.ended) {
      text = s.win === 'undercover' ? '卧底获胜' : (s.win === 'civilian' ? '平民获胜' : '本局结束');
      sub = '身份已公开，等待结算';
    } else if (s.ph === 'brief') {
      text = '第 ' + s.rd + ' 轮即将开始';
      sub = '看清自己的词，准备描述';
    } else if (s.ph === 'describe') {
      if (same(s.cur, me)) {
        text = '轮到你描述';
        sub = '不能直接说出自己的词 · 15 秒内提交';
      } else {
        text = '等待 ' + nameOf(s, s.cur) + ' 描述…';
        sub = '所有存活玩家发言完毕后立刻投票';
      }
    } else if (s.ph === 'vote') {
      if (!(s.alive || []).some(function (id) { return same(id, me); })) {
        text = '你已出局，观战中';
        sub = '等待其他玩家投票';
      } else if ((s.voted || []).some(function (id) { return same(id, me); }) || pendingVote) {
        text = '已投票，等待其他玩家…';
        sub = '投票结束后公布结果';
      } else {
        text = '请投票：谁是卧底？';
        sub = '点击右侧玩家头像投票 · 不能投自己 · 平票无人出局';
      }
    } else if (s.ph === 'reveal') {
      text = '投票结果公布';
      sub = '5 秒后进入下一轮；卧底全部出局则本局结束';
    }

    turn.textContent = text;
    hint.textContent = sub;
  }

  function tallyHtml(lastOut) {
    var rows = (lastOut && lastOut.tally) || [];
    if (!rows.length) return '';
    rows.sort(function (a, b) { return b.count - a.count; });
    var html = '<div class="uc-tally">';
    rows.forEach(function (r) {
      html += '<span class="uc-tally-item" data-id="' + esc(r.id) + '">' +
        esc(r.name) + ' <b>' + r.count + '</b></span>';
    });
    return html + '</div>';
  }

  function renderLastOut(s) {
    var box = $('uc-last-out');
    var lo = s.lastOut;

    if (s.ended) {
      var faction = s.win === 'undercover' ? '卧底获胜' : (s.win === 'civilian' ? '平民获胜' : '本局结束');
      box.innerHTML = '<b class="uc-lo-title">' + faction + '</b>' +
        '<span class="uc-lo-sub">本局结束，查看个人名次</span>';
      box.classList.remove('hidden');
      return;
    }
    if (s.ph !== 'reveal' || !lo) {
      box.classList.add('hidden');
      return;
    }
    if (lo.tie) {
      box.innerHTML = '<b class="uc-lo-title">平票，无人出局</b>' +
        '<span class="uc-lo-sub">' + (lo.count > 0 ? ('最高 ' + lo.count + ' 票，下一轮继续') : '本轮没有有效票，下一轮继续') + '</span>' +
        tallyHtml(lo);
    } else {
      box.innerHTML = '<b class="uc-lo-title">' + esc(lo.name) + ' 被投出</b>' +
        '<span class="uc-lo-sub">身份：<i class="uc-role-tag ' + lo.role + '">' + roleName(lo.role) + '</i>' +
        ' · ' + lo.count + ' 票</span>' + tallyHtml(lo);
    }
    box.classList.remove('hidden');
  }

  function updateTimer(s) {
    var phaseEl = $('uc-phase');
    var phase = PHASE_CN[s.ph] || '准备';
    if (phaseEl.textContent !== phase) phaseEl.textContent = phase;
    var text = s.ended ? '—' : (Math.max(0, Math.ceil(s.tl || 0)) + 's');
    if (text !== lastTimer) {
      lastTimer = text;
      $('uc-timer').textContent = text;
    }
  }

  function updateInput(s) {
    var box = $('uc-input-box');
    var mine = !s.ended && s.ph === 'describe' && same(s.cur, myId()) &&
      (s.alive || []).some(function (id) { return same(id, myId()); });
    box.classList.toggle('hidden', !mine);
    if (!mine) {
      lastFocusKey = '';
      return;
    }
    var key = s.rd + '|' + s.cur;
    if (key !== lastFocusKey) {
      lastFocusKey = key;
      $('uc-text').value = '';
      setTimeout(function () {
        if (!box.classList.contains('hidden')) $('uc-text').focus();
      }, 30);
    }
  }

  function update(s) {
    if (!s || APP.screen !== 'play' || !APP.game || APP.game.id !== 'undercover' || APP.over) {
      hide();
      return;
    }
    active = true;
    $('undercover-panel').classList.remove('hidden');
    $('uc-round').textContent = String(s.rd || 1);
    $('uc-max-rounds').textContent = String(s.mx || ucStore().maxRounds || 6);
    updateTimer(s);
    updateInput(s);

    var descKey = (s.desc || []).map(function (d) { return d.i + ':' + d.t; }).join('|');
    var key = [
      s.ph, s.rd, s.cur, s.ended ? 1 : 0, s.win || '',
      (s.alive || []).join(','), (s.voted || []).join(','),
      descKey, JSON.stringify(s.lastOut || null), pendingVote,
      (s.pl || []).map(function (p) { return p.i + ':' + p.al; }).join(',')
    ].join('#');
    if (key === lastKey) return;
    lastKey = key;

    renderPlayers(s);
    renderDesc(s);
    renderTurn(s);
    renderLastOut(s);
  }

  /* ---------------- 操作 ---------------- */
  function sendDescribe() {
    if (!active || !APP.snap || APP.snap.ended) return;
    if (APP.snap.ph !== 'describe' || !same(APP.snap.cur, myId())) return;
    var input = $('uc-text');
    var text = String(input.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!text) {
      AR.UI.toast('先写一句描述');
      input.focus();
      return;
    }
    var mine = ucStore().word;
    if (mine && norm(text).indexOf(norm(mine)) >= 0) {
      AR.UI.toast('描述里不能直接出现你自己的词');
      Sfx.bad();
      return;
    }
    if (Net.send({ t: 'input', i: { act: 'describe', text: text } })) {
      input.value = '';
      Sfx.click();
    }
  }

  function vote(target) {
    if (!active || !APP.snap || !canVote(APP.snap, target) || pendingVote) return;
    pendingVote = target;
    lastKey = '';
    Net.send({ t: 'input', i: { act: 'vote', target: target } });
    Sfx.click();
    update(APP.snap);
  }

  function init() {
    $('uc-send').addEventListener('click', sendDescribe);
    $('uc-text').addEventListener('keydown', function (e) {
      if (e.code !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      sendDescribe();
    });
    $('uc-players').addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.uc-player') : null;
      if (!card || card.disabled) return;
      vote(card.getAttribute('data-uc-id'));
    });
    Net.on('undercover', onPrivate);
    Net.on('state', onState);
  }

  AR.UndercoverUI = {
    init: init,
    onGame: onGame,
    onPrivate: onPrivate,
    onState: onState,
    update: update,
    hide: hide,
    reset: function () { onGame('undercover'); }
  };

})(typeof window !== 'undefined' ? window : globalThis);
