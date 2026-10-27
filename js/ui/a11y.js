/* ============================================================
 * 覆盖层焦点管理：打开时聚焦首个可操作元素，Tab 在层内循环，
 * 关闭时把焦点还给打开前的元素。
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR = root.AR || {};
  var stack = [];

  function focusables(el) {
    var list = el.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(list, function (n) {
      return n.getClientRects().length > 0 || n === document.activeElement;
    });
  }

  function top() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  function focusFirst(el) {
    var list = focusables(el);
    if (list.length) {
      list[0].focus();
      return;
    }
    el.setAttribute('tabindex', '-1');
    el.focus();
  }

  function onOpen(el) {
    if (stack.indexOf(el) < 0) stack.push(el);
    el.__a11yPrevFocus = document.activeElement;
    el.setAttribute('aria-hidden', 'false');
    setTimeout(function () {
      if (top() === el) focusFirst(el);
    }, 30);
  }

  function onClose(el) {
    var i = stack.indexOf(el);
    if (i >= 0) stack.splice(i, 1);
    el.setAttribute('aria-hidden', 'true');
    var next = top();
    if (next) {
      focusFirst(next);
      return;
    }
    var prev = el.__a11yPrevFocus;
    if (prev && document.contains(prev) && typeof prev.focus === 'function') prev.focus();
  }

  function sync(el) {
    var hidden = el.classList.contains('hidden');
    if (el.__a11yHidden === undefined) {
      el.__a11yHidden = hidden;
      el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
      return;
    }
    if (el.__a11yHidden === hidden) return;
    el.__a11yHidden = hidden;
    if (hidden) onClose(el);
    else onOpen(el);
  }

  function trap(e) {
    if (e.code !== 'Tab') return;
    var el = top();
    if (!el) return;
    var list = focusables(el);
    if (!list.length) {
      e.preventDefault();
      focusFirst(el);
      return;
    }
    var first = list[0];
    var last = list[list.length - 1];
    var inside = el.contains(document.activeElement);
    if (e.shiftKey) {
      if (!inside || document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  AR.A11y = {
    init: function () {
      var overlays = document.querySelectorAll('.overlay');
      for (var i = 0; i < overlays.length; i++) {
        (function (el) {
          sync(el);
          var obs = new MutationObserver(function () { sync(el); });
          obs.observe(el, { attributes: true, attributeFilter: ['class'] });
          el.__a11yObserver = obs;
        })(overlays[i]);
      }
      document.addEventListener('keydown', trap, true);
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
