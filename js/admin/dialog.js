/* ============================================================
 * 管理后台通用确认弹窗
 * ============================================================ */
(function (root) {
  'use strict';
  var AR = root.AR;
  var $ = AR.Dom.$;

  /* ---------- 通用弹窗 ---------- */
  var dlgResolve = null;
  var dlgPrevFocus = null;

  function dialog(opt) {
    dlgPrevFocus = document.activeElement;
    $('dlg-title').textContent = opt.title || '确认';
    $('dlg-text').textContent = opt.text || '';
    var hasInput = !!opt.input;
    $('dlg-field').classList.toggle('hidden', !hasInput);
    if (hasInput) {
      $('dlg-label').textContent = opt.label || '输入';
      $('dlg-input').value = opt.value || '';
      $('dlg-input').placeholder = opt.placeholder || '';
    }
    $('dlg-ok').textContent = opt.ok || '确定';
    $('dlg-ok').className = 'btn ' + (opt.danger ? '' : 'primary');
    if (opt.danger) $('dlg-ok').style.background = 'linear-gradient(135deg,#ff2e63,#c026d3)', $('dlg-ok').style.color = '#fff';
    else $('dlg-ok').style.background = '', $('dlg-ok').style.color = '';
    $('dialog').classList.remove('hidden');
    $('dialog').setAttribute('aria-hidden', 'false');
    setTimeout(function () {
      (hasInput ? $('dlg-input') : $('dlg-ok')).focus();
    }, 30);
    return new Promise(function (resolve) { dlgResolve = resolve; });
  }

  function closeDialog(val) {
    $('dialog').classList.add('hidden');
    $('dialog').setAttribute('aria-hidden', 'true');
    var prev = dlgPrevFocus;
    dlgPrevFocus = null;
    if (prev && document.contains(prev) && typeof prev.focus === 'function') prev.focus();
    if (dlgResolve) { var r = dlgResolve; dlgResolve = null; r(val); }
  }

  document.getElementById('dialog').addEventListener('keydown', function (e) {
    if (e.code === 'Escape') {
      e.preventDefault();
      closeDialog(null);
      return;
    }
    if (e.code !== 'Tab') return;
    var list = this.querySelectorAll('button:not([disabled]), input:not([disabled])');
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });



  AR.AdminDialog = { open: dialog, close: closeDialog };
})(typeof window !== 'undefined' ? window : globalThis);
