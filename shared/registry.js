/* ============================================================
 * 游戏元信息（服务端与客户端共用）
 * ============================================================ */
(function (root) {
  'use strict';
  var AR = root.AR = root.AR || {};

  AR.GAME_INFO = [
    {
      id: 'tank', name: '坦克竞技场', sub: 'TANK ARENA', tag: '射击', icon: '🎯',
      time: 150, min: 2, max: 8,
      desc: '俯视角坦克对战，砖墙能被轰开，击败对手次数最多者获胜。',
      keys: ['WASD：移动', '鼠标：瞄准', '左键：开火']
    },
    {
      id: 'tetris', name: '俄罗斯方块对战', sub: 'TETRIS VS', tag: '益智', icon: '🧱',
      time: 180, min: 2, max: 4,
      desc: '消除方块行会给对手送去干扰行，率先被堆满者出局。',
      keys: ['← →：移动', '↑：旋转', '↓：软降', '空格：直落']
    },
    {
      id: 'shmup', name: '合作弹幕', sub: 'CO-OP SHMUP V2', tag: '合作', icon: '🚀',
      time: 120, min: 1, max: 4,
      desc: '全队迎战敌机与随机 BOSS；击毁敌机掉落增益，全员被击毁时结束。',
      keys: ['WASD：移动', '自动开火，不用按键', '拾取光球：获得随机增益']
    },
    {
      id: 'draw', name: '你画我猜', sub: 'DRAW & GUESS', tag: '社交', icon: '🎨',
      time: 0, min: 2, max: 10,
      desc: '轮流当画手，其余人在聊天框抢答，猜得越快得分越高。',
      keys: ['鼠标：画画', '回车：发送答案', '右侧工具栏：颜色 / 清空（C）']
    },
    {
      id: 'gomoku', name: '五子棋', sub: 'GOMOKU', tag: '棋类', icon: '⚫',
      time: 0, min: 2, max: 2,
      desc: '15×15 经典棋盘，不限时轮流落子，率先连成五子者获胜。',
      keys: ['点击棋盘：落子', '悔棋 / 和棋：需对方同意', '认输：立即结束']
    },
    {
      id: 'undercover', name: '谁是卧底', sub: 'WHO IS SPY', tag: '推理', icon: '🕵️',
      time: 0, min: 4, max: 12,
      desc: '平民和卧底拿到相近的词，轮流描述后投票，找出所有卧底。',
      keys: ['轮流输入描述', '点击玩家投票', '身份和词只有自己可见']
    }
  ];

  AR.getInfo = function (id) {
    for (var i = 0; i < AR.GAME_INFO.length; i++) {
      if (AR.GAME_INFO[i].id === id) return AR.GAME_INFO[i];
    }
    return AR.GAME_INFO[0];
  };

  /* 服务器端游戏实现表，由 shared/games/*.js 注册 */
  AR.games = AR.games || {};

})(typeof window !== 'undefined' ? window : globalThis);
