/* ============================================================
 * 浏览器端同源 JSON 请求
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR = root.AR || {};
  var Http = AR.Http = {};

  Http.request = function (method, url, body) {
    return fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || ('请求失败 ' + r.status));
        return data;
      });
    });
  };

})(typeof window !== 'undefined' ? window : globalThis);
