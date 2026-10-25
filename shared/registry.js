/* ============================================================
 * 游戏元信息（服务端与客户端共用）
 * ============================================================ */
(function (root) {
  'use strict';
  var AR = root.AR = root.AR || {};

  AR.GAME_INFO = [
    {
      id: 'snake', name: '蛇球大作战', sub: 'SNAKE ARENA', tag: '动作', icon: '🐍',
      time: 90, min: 2, max: 8,
      desc: '吃光点变长，撞到别人身体就爆开，2.5 秒后复活。',
      keys: ['鼠标：控制方向', '按住左键：加速（每 0.2 秒扣 1 分）']
    },
    {
      id: 'tank', name: '坦克竞技场', sub: 'TANK ARENA', tag: '射击', icon: '🎯',
      time: 150, min: 2, max: 8,
      desc: '砖墙可打穿的俯视坦克战，击杀数最高者获胜。',
      keys: ['WASD：移动', '鼠标：瞄准', '左键：开火']
    },
    {
      id: 'bomber', name: '炸弹人', sub: 'BOMBER', tag: '派对', icon: '💣',
      time: 120, min: 2, max: 4,
      desc: '放炸弹拆砖块、抢道具，最后一个活着的赢。',
      keys: ['WASD / 方向键：移动', '空格：放炸弹']
    },
    {
      id: 'tetris', name: '俄罗斯方块对战', sub: 'TETRIS VS', tag: '益智', icon: '🧱',
      time: 180, min: 2, max: 4,
      desc: '消行给对手塞垃圾行，先撑不住的出局。',
      keys: ['← →：移动', '↑：旋转', '↓：软降', '空格：直落']
    },
    {
      id: 'shmup', name: '合作弹幕', sub: 'CO-OP SHMUP', tag: '合作', icon: '🚀',
      time: 120, min: 1, max: 4,
      desc: '全房一起打飞机，分数共享，全员阵亡即结束。',
      keys: ['WASD：移动', '自动开火，不用按键']
    },
    {
      id: 'draw', name: '你画我猜', sub: 'DRAW & GUESS', tag: '社交', icon: '🎨',
      time: 0, min: 2, max: 10,
      desc: '轮流作画，其他人在聊天框抢答，猜得越快分越高。',
      keys: ['鼠标：画画', '回车：发送答案', '右上角「清空画布」：擦掉重画']
    },
    {
      id: 'racing', name: '极速环线', sub: 'NEON RACING', tag: '竞速', icon: '🏎️',
      time: 150, min: 2, max: 8,
      desc: '俯视漂移赛车，4 条赛道 2 圈，先冲线者赢。',
      keys: ['↑ / W：油门', '↓ / S：刹车倒车', '← → / A D：转向']
    },
    {
      id: 'gomoku', name: '五子棋', sub: 'GOMOKU', tag: '棋类', icon: '⚫',
      time: 0, min: 2, max: 2,
      desc: '标准 15x15 五子棋，无时间限制，先连成五子者胜。',
      keys: ['点击棋盘：落子']
    },
    {
      id: 'ludo', name: '飞行棋', sub: 'AERO CHESS', tag: '派对', icon: '✈️',
      time: 300, min: 2, max: 4,
      desc: '掷骰子起飞，踩到对手送他回起点，两架先到家者获胜。',
      keys: ['点击棋盘 / 空格：掷骰子', '点击自己的飞机：选择走哪一架']
    }
  ];

  AR.GAME_ORDER = ['snake', 'tank', 'bomber', 'tetris', 'shmup', 'draw'];

  AR.getInfo = function (id) {
    for (var i = 0; i < AR.GAME_INFO.length; i++) {
      if (AR.GAME_INFO[i].id === id) return AR.GAME_INFO[i];
    }
    return AR.GAME_INFO[0];
  };

  /* 服务器端游戏实现表，由 shared/games/*.js 注册 */
  AR.games = AR.games || {};

})(typeof window !== 'undefined' ? window : globalThis);
