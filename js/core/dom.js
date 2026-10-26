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

})(typeof window !== 'undefined' ? window : globalThis);
