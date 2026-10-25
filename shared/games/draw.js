/* ============================================================
 * 你画我猜 · DRAW & GUESS（服务端状态机）
 * 轮流作画：选词 15s -> 作画 60s -> 揭晓 6s
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;

  var WORDS = [
    '苹果', '香蕉', '西瓜', '太阳', '月亮', '星星', '汽车', '自行车', '飞机', '轮船',
    '房子', '大楼', '桥', '大树', '花', '猫', '狗', '鱼', '鸟', '大象',
    '长颈鹿', '企鹅', '熊猫', '恐龙', '机器人', '电脑', '手机', '键盘', '鼠标', '咖啡',
    '披萨', '汉堡', '冰淇淋', '蛋糕', '面条', '筷子', '雨伞', '眼镜', '帽子', '鞋子',
    '手表', '钥匙', '剪刀', '锤子', '吉他', '钢琴', '鼓', '足球', '篮球', '乒乓球',
    '摩托车', '火车', '地铁', '热气球', '火箭', '飞碟', '灯塔', '风车', '城堡', '帐篷',
    '沙发', '台灯', '风扇', '冰箱', '洗衣机', '电视', '相机', '耳机', '麦克风', '书本',
    '铅笔', '橡皮', '尺子', '书包', '黑板', '时钟', '沙漏', '地图', '指南针', '望远镜',
    '显微镜', '骷髅', '幽灵', '天使', '海盗', '忍者', '宇航员', '消防员', '医生', '厨师',
    '警察', '超人', '雪人', '圣诞树', '礼物', '烟花', '彩虹', '闪电', '下雨', '雪花',
    '云朵', '高山', '小河', '瀑布', '火山', '沙漠', '海岛', '摩天轮', '过山车', '旋转木马',
    '游泳池', '红绿灯', '斑马线', '消防车', '救护车', '挖掘机', '直升机', '潜水艇', '棒棒糖', '甜甜圈',
    '爆米花', '寿司', '火锅', '月饼', '饺子', '仙人掌', '向日葵', '蜘蛛网', '放大镜', '降落伞'
  ];

  var CHOOSE_TIME = 10;
  var DRAW_TIME = 60;
  var REVEAL_TIME = 6;
  var ALL_GUESSED_TIME = 3;   /* 全员猜中：只留 3 秒揭晓就直接进入下一轮 */
  var HINT_EVERY = 10;        /* 每 10 秒放出一条提示，最多 3 条 */

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s，。！？、,.!?~～·\-_]/g, '')
      .trim();
  }

  /* 词条统一成 { w, h }，兼容老的字符串数组 */
  function normalizePool(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (typeof it === 'string') out.push({ w: it, h: [] });
      else if (it && it.w) out.push({ w: String(it.w), h: Array.isArray(it.h) ? it.h.slice(0, 3) : [] });
    }
    return out;
  }

  function startTurn(state) {
    var order = state.order;
    if (state.turn >= order.length) {
      state.phase = 'over';
      state.ended = true;
      state.timeLeft = 0;
      return;
    }
    state.drawerId = order[state.turn];
    state.phase = 'choose';
    state.timeLeft = CHOOSE_TIME;
    state.word = '';
    state.allGuessed = false;
    state.guessed = {};
    state.strokes = [];
    state.turnStart = state.time;

    var pool = (state.pool && state.pool.length ? state.pool : WORDS).slice();
    AR.shuffle(pool);
    state.choices = pool.slice(0, 3);
    state.hints = [];
    state.hintShown = 0;
    state.hintTimer = HINT_EVERY;
  }

  function beginDrawing(state, entry) {
    var e = entry || { w: '', h: [] };
    state.word = e.w || '';
    state.hints = (e.h || []).slice(0, 3);
    state.hintShown = 0;
    state.hintTimer = HINT_EVERY;
    state.phase = 'draw';
    state.timeLeft = DRAW_TIME;
    state.guessed = {};
    state.strokes = [];
  }

  AR.games.draw = {
    id: 'draw',
    rate: 10,

    create: function (players, opt) {
      var order = players.map(function (p) { return p.id; });
      AR.shuffle(order);
      var pool = normalizePool((opt && opt.words && opt.words.length) ? opt.words : WORDS);
      var level = (opt && opt.level) || 'normal';
      var state = {
        time: 0,
        duration: 0,
        rnd: AR.rng(((opt && opt.seed) || Date.now()) >>> 0),
        phase: 'choose',
        turn: 0,
        order: order,
        drawerId: null,
        choices: [],
        word: '',
        timeLeft: CHOOSE_TIME,
        scores: {},
        players: {},
        guessed: {},
        strokes: [],
        pool: pool,
        level: level,
        hints: [],
        hintShown: 0,
        hintTimer: HINT_EVERY,
        ended: false,
        turnStart: 0
      };
      players.forEach(function (p) {
        state.players[p.id] = { id: p.id, name: p.name, color: p.color };
        state.scores[p.id] = 0;
      });
      startTurn(state);
      return state;
    },

    removePlayer: function (state, id) {
      delete state.players[id];
      var i = state.order.indexOf(id);
      if (i >= 0) {
        state.order.splice(i, 1);
        if (i < state.turn) state.turn--;
      }
      if (state.drawerId === id) {
        state.phase = 'reveal';
        state.timeLeft = REVEAL_TIME;
      }
    },

    /* 房主/抽屉选词：msg.n = 0/1/2 */
    drawData: function (state, id, msg) {
      if (state.phase === 'choose') {
        if (id !== state.drawerId) return null;
        var idx = AR.clamp(parseInt(msg.n, 10) || 0, 0, 2);
        beginDrawing(state, state.choices[idx] || state.choices[0]);
        return null;
      }
      if (state.phase !== 'draw') return null;
      if (id !== state.drawerId) return null;
      var s = msg.s;
      if (!s || typeof s.x !== 'number' || typeof s.y !== 'number') return null;
      if (state.strokes.length < 4000) {
        state.strokes.push([Math.round(s.x), Math.round(s.y), s.e || 'm', s.c || '#111']);
      }
      return {
        t: 'paint',
        s: {
          x: Math.round(s.x),
          y: Math.round(s.y),
          p: s.p ? [Math.round(s.p[0]), Math.round(s.p[1])] : null,
          e: s.e || 'm',
          c: s.c || '#111',
          w: s.w || 4
        }
      };
    },

    guess: function (state, id, text) {
      if (state.phase !== 'draw') return null;
      var p = state.players[id];
      if (!p || id === state.drawerId) return null;
      var clean = String(text || '').slice(0, 40).trim();
      if (!clean) return null;

      if (norm(clean) === norm(state.word)) {
        if (!state.guessed[id]) {
          state.guessed[id] = true;
          var pts = 2 + Math.max(1, Math.round(state.timeLeft / 5));
          state.scores[id] = (state.scores[id] || 0) + pts;
          state.scores[state.drawerId] = (state.scores[state.drawerId] || 0) + 2;

          /* 除画手外全部猜中：马上收尾，不再等倒计时 */
          var need = state.order.length - 1;
          if (need > 0 && Object.keys(state.guessed).length >= need) {
            state.phase = 'reveal';
            state.timeLeft = ALL_GUESSED_TIME;
            state.allGuessed = true;
          }
        }
        return {
          t: 'chat',
          kind: 'correct',
          from: id,
          name: p.name,
          color: p.color,
          text: '***',
          word: state.word
        };
      }
      return {
        t: 'chat',
        kind: 'guess',
        from: id,
        name: p.name,
        color: p.color,
        text: clean
      };
    },

    tick: function (state, dt) {
      state.time += dt;
      if (state.phase === 'over') return;

      state.timeLeft -= dt;

      if (state.phase === 'choose' && state.timeLeft <= 0) {
        /* 没选就随机替他选一个 */
        var pick = Math.floor((state.rnd ? state.rnd() : Math.random()) * state.choices.length);
        beginDrawing(state, state.choices[pick] || state.choices[0]);
        return;
      }

      /* 作画阶段：每 HINT_EVERY 秒放一条提示 */
      if (state.phase === 'draw' && state.hintShown < state.hints.length) {
        state.hintTimer -= dt;
        if (state.hintTimer <= 0) {
          state.hintShown++;
          state.hintTimer = HINT_EVERY;
        }
      }

      if (state.phase === 'draw' && state.timeLeft <= 0) {
        state.phase = 'reveal';
        state.timeLeft = REVEAL_TIME;
        /* 全员都猜对则提前进入揭晓 */
        var total = state.order.length - 1;
        var got = Object.keys(state.guessed || {}).length;
        if (total > 0 && got >= total) state.timeLeft = Math.min(state.timeLeft, 3);
        return;
      }

      if (state.phase === 'reveal' && state.timeLeft <= 0) {
        state.turn++;
        startTurn(state);
      }
    },

    isOver: function (state) {
      return state.ended;
    },

    results: function (state) {
      var list = [];
      for (var id in state.players) {
        var p = state.players[id];
        list.push({ id: id, name: p.name, score: state.scores[id] || 0, kills: 0 });
      }
      list.sort(function (a, b) { return b.score - a.score; });
      return list;
    },

    /* 发给抽屉的私有消息 */
    privateFor: function (state, id) {
      if (state.phase === 'choose' && id === state.drawerId) {
        return { t: 'choices', list: state.choices, drawerId: state.drawerId };
      }
      if (state.phase === 'draw' && id === state.drawerId) {
        return { t: 'word', word: state.word, hints: state.hints.slice(), drawerId: state.drawerId };
      }
      return null;
    },

    snapshot: function (state) {
      var sc = {};
      for (var id in state.players) sc[id] = state.scores[id] || 0;
      var got = {};
      for (var g in (state.guessed || {})) got[g] = 1;
      return {
        ph: state.phase,
        tn: state.turn,
        dr: state.drawerId,
        tl: Math.max(0, Math.round(state.timeLeft * 10) / 10),
        sc: sc,
        gd: got,
        wd: state.phase === 'reveal' || state.phase === 'over' ? state.word : null,
        hs: state.phase === 'draw' || state.phase === 'reveal' || state.phase === 'over'
          ? (state.hints || []).slice(0, state.hintShown || 0) : [],
        ht: state.phase === 'draw' && (state.hintShown || 0) < (state.hints || []).length
          ? Math.max(0, Math.ceil(state.hintTimer)) : 0,
        hn: (state.hints || []).length,
        lv: state.level || 'normal',
        n: state.order.length
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
