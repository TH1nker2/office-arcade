/* ============================================================
 * 浏览器端 DOM 基础工具
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR = root.AR || {};
  var Dom = AR.Dom = {};

  Dom.$ = function (id) {
    return document.getElementById(id);
  };

  Dom.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* 输入法组合期间的回车用于上屏，不能当成提交。
     stopPropagation 只挡应用快捷键，不挡浏览器默认的 IME 行为。 */
  Dom.bindEnter = function (input, handler) {
    var composing = false;
    input.addEventListener('compositionstart', function () { composing = true; });
    input.addEventListener('compositionend', function () { composing = false; });
    input.addEventListener('blur', function () { composing = false; });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.code !== 'Enter') return;
      if (composing || e.isComposing || e.keyCode === 229) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    });
  };

})(typeof window !== 'undefined' ? window : globalThis);
