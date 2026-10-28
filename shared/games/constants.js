/* ============================================================
 * 九款游戏共享的几何/形状常量
 * 服务端模拟与浏览器渲染共用，避免双份定义漂移
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR = root.AR || {};

  AR.GameConstants = {
    TETROMINOES: {
      I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
      J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
      L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
      O: [[1, 1], [1, 1]],
      S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
      T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
      Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
    },
    GOMOKU: { N: 15, PAD: 60, CELL: 44 },
    LUDO: { W: 1200, H: 1200, C: 600, R: 430, N: 40, HOME: 4 },
    /* 合作弹幕 v2：服务端与渲染端共用的增益/BOSS 元信息 */
    SHMUP: {
      BUFFS: [
        { id: 'heal', name: '修护', icon: '✚', color: '#4ade80', desc: '回 1 点耐久' },
        { id: 'shield', name: '护盾', icon: '🛡', color: '#38bdf8', desc: '挡 1 次，最多 2 层' },
        { id: 'rapid', name: '连发', icon: '⚡', color: '#fbbf24', desc: '射速 +8 秒' },
        { id: 'spread', name: '散射', icon: '🔱', color: '#c084fc', desc: '三向射击 8 秒' },
        { id: 'purge', name: '净化', icon: '💥', color: '#ff2e63', desc: '清弹 + 短暂无敌' }
      ],
      BOSSES: [
        { id: 'fortress', name: '铁幕堡垒', color: '#ff5d7d', accent: '#8b1e3f' },
        { id: 'hive', name: '蜂巢母舰', color: '#a3e635', accent: '#365314' },
        { id: 'prism', name: '棱镜核心', color: '#c084fc', accent: '#4c1d95' }
      ]
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
