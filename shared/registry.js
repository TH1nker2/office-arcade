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
      desc: '吞下光点不断变长，撞上其他蛇身会暂时退场，随后复活。',
      keys: ['鼠标：控制方向', '按住左键：加速（每 0.2 秒扣 1 分）']
    },
    {
      id: 'tank', name: '坦克竞技场', sub: 'TANK ARENA', tag: '射击', icon: '🎯',
      time: 150, min: 2, max: 8,
      desc: '俯视角坦克对战，砖墙能被轰开，击败对手次数最多者获胜。',
      keys: ['WASD：移动', '鼠标：瞄准', '左键：开火']
    },
    {
      id: 'bomber', name: '炸弹人', sub: 'BOMBER', tag: '派对', icon: '💣',
      time: 120, min: 2, max: 4,
      desc: '放置炸弹炸开砖块、收集道具，坚持到最后的人获胜。',
      keys: ['WASD / 方向键：移动', '空格：放炸弹']
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
      id: 'racing', name: '极速环线', sub: 'NEON RACING', tag: '竞速', icon: '🏎️',
      time: 150, min: 2, max: 8,
      desc: '俯视角漂移竞速，四条赛道各跑两圈，率先冲线者获胜。',
      keys: ['↑ / W：油门', '↓ / S：刹车倒车', '← → / A D：转向']
    },
    {
      id: 'gomoku', name: '五子棋', sub: 'GOMOKU', tag: '棋类', icon: '⚫',
      time: 0, min: 2, max: 2,
      desc: '15×15 经典棋盘，不限时轮流落子，率先连成五子者获胜。',
      keys: ['点击棋盘：落子', '悔棋 / 和棋：需对方同意', '认输：立即结束']
    },
    {
      id: 'ludo', name: '飞行棋', sub: 'AERO CHESS', tag: '派对', icon: '✈️',
      time: 0, min: 2, max: 4,
      desc: '掷骰子起飞，落到对手格就把对方送回起点；率先让全部飞机到家者获胜。',
      keys: ['点击棋盘 / 空格：掷骰子', '点击自己的飞机：选择走哪一架']
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
