/* ============================================================
 * 聊天：大厅与房间共用
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var Net = root.Net;
  var Sfx = AR.Sfx;
  var APP = AR.App;
  var $ = AR.Dom.$;
  var esc = AR.Dom.esc;

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



  AR.Chat = {
    emojiPop: emojiPop,
    chatLine: chatLine,
    showPeek: showPeek,
    sendChat: sendChat,
    chatOpen: chatOpen,
    openChat: openChat,
    closeChat: closeChat
  };

})(typeof window !== 'undefined' ? window : globalThis);
