/* ============================================================
 * 渲染层入口：按 gameId 分发
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var V = AR.View;
  var R = AR.Render;
  var U = R.util;
  var drawItemLegend = U.drawItemLegend;
  var drawCrosshair = U.drawCrosshair;

  R.render = function (ctx, w, h, gameId, snap, dt, G) {
    V.t += dt;
    var fn = R[gameId];
    if (fn) fn(ctx, w, h, snap, Math.min(dt, 0.05), G || {});
    if (gameId === 'tank' || gameId === 'bomber' || gameId === 'shmup') {
      drawItemLegend(ctx, w, h, gameId);
    }
    if (gameId === 'tank' && R.cursor.on) {
      var me = null;
      for (var ci = 0; ci < (G.players || []).length; ci++) {
        if (G.players[ci].id === G.me) me = G.players[ci];
      }
      drawCrosshair(ctx, R.cursor.x, R.cursor.y, (me && me.color) || '#22d3ee');
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
