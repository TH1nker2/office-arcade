/* ============================================================
 * 客户端全局状态
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR = root.AR || {};

  AR.App = {
    screen: 'auth',
    me: null,
    lobby: [],
    gameId: null,
    room: null,
    game: null,
    snap: null,
    round: 0,
    word: null,
    over: null,
    rooms: [],
    authMode: 'login',
    invite: null,
    drawing: false,
    lastDraw: null,
    drawColor: '#111827',
    uc: null,
    profileDraft: null,
    connected: false,
    version: null
  };

})(typeof window !== 'undefined' ? window : globalThis);
