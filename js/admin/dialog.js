/* ============================================================
 * 管理后台通用确认弹窗
 * ============================================================ */
(function (root) {
  'use strict';
  var AR = root.AR;
  var $ = AR.Dom.$;

  /* ---------- 通用弹窗 ---------- */
  var dlgResolve = null;

  function dialog(opt) {
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
    if (hasInput) setTimeout(function () { $('dlg-input').focus(); }, 30);
    return new Promise(function (resolve) { dlgResolve = resolve; });
  }

  function closeDialog(val) {
    $('dialog').classList.add('hidden');
    if (dlgResolve) { var r = dlgResolve; dlgResolve = null; r(val); }
  }



  AR.AdminDialog = { open: dialog, close: closeDialog };
})(typeof window !== 'undefined' ? window : globalThis);
