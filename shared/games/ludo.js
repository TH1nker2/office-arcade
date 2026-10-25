/* ============================================================
 * 飞行棋 · AERO CHESS（服务端权威）
 * 快节奏版：40 格环 + 4 格归航道，每人 2 架飞机
 *   - 开局第 1 架已在起点，第 2 架要掷到 6 才能起飞
 *   - 掷到 6 可以再掷一次
 *   - 6 个安全格，踩上去不会被吃
 *   - 落到对手所在格 → 对手回起点
 *   - 两架都到家即胜
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;

  var N = 40;              /* 环上格数 */
  var HOME = 4;            /* 归航道格数 */
  var MAXP = N + HOME;     /* 44 = 到家 */
  var DURATION = 0;             /* 不限时：打到只剩一个人没到家 */
  var ROLL_WAIT = 8;       /* 不掷就自动掷 */
  var MOVE_WAIT = 12;      /* 不选就自动选 */
  var GAP_TIME = 0.5;      /* 换人停顿 */
  var SHOW_TIME = 0.75;    /* 骰子展示时间 */
  var LAUNCH = 5;      /* 掷到 5 或 6 都能让第二架起飞 */
  var SAFE = [0, 7, 14, 21, 28, 35];

  var BOT_SKILL = { easy: 0.3, normal: 0.6, hard: 0.85, insane: 1.0 };

  function startOf(state, idx) {
    return Math.floor(idx * N / state.n);
  }

  function absCell(state, idx, pos) {
    return (startOf(state, idx) + pos) % N;
  }

  function currentId(state) {
    return state.order[state.turn % state.order.length];
  }

  /* 这个人的飞机是不是全部到家了（到家后就不用再掷骰子） */
  function allHome(state, id) {
    var p = state.players[id];
    if (!p) return false;
    for (var i = 0; i < p.planes.length; i++) {
      if (p.planes[i] !== MAXP) return false;
    }
    return true;
  }

  function nextTurn(state) {
    var n = state.order.length;
    for (var step = 1; step <= n; step++) {
      var idx = (state.turn + step) % n;
      /* 已经全部到家的人跳过，不再轮到他 */
      if (allHome(state, state.order[idx])) continue;
      state.turn = idx;
      break;
    }
    state.phase = 'gap';
    state.wait = GAP_TIME;
    state.dice = 0;
    state.moves = [];
  }

  function movablePlanes(state, me) {
    var out = [];
    for (var i = 0; i < me.planes.length; i++) {
      var pos = me.planes[i];
      if (pos === MAXP) continue;
      if (pos === -1) {
        if (state.dice >= LAUNCH) out.push(i);
      } else {
        out.push(i);
      }
    }
    return out;
  }

  function doRoll(state) {
    var me = state.players[currentId(state)];
    state.dice = 1 + Math.floor(state.rnd() * 6);
    state.events.push({ t: 'roll', id: me.id, name: me.name, color: me.color, dice: state.dice });
    state.moves = movablePlanes(state, me);
    state.phase = 'show';
    state.wait = SHOW_TIME;
    state.rolled = true;
  }

  function applyMove(state, idx) {
    var me = state.players[currentId(state)];
    if (state.phase !== 'move' || state.moves.indexOf(idx) < 0) return;

    var from = me.planes[idx];
    var target = from === -1 ? 0 : Math.min(MAXP, from + state.dice);
    me.planes[idx] = target;

    /* 环上踩人 */
    if (target >= 0 && target < N) {
      var cell = absCell(state, me.index, target);
      if (SAFE.indexOf(cell) < 0) {
        state.order.forEach(function (oid) {
          if (oid === me.id) return;
          var other = state.players[oid];
          for (var j = 0; j < other.planes.length; j++) {
            var op = other.planes[j];
            if (op < 0 || op >= N) continue;
            if (absCell(state, other.index, op) === cell) {
              other.planes[j] = -1;
              state.events.push({
                t: 'capture', by: me.id, who: oid, cell: cell,
                byName: me.name, whoName: other.name, byColor: me.color, whoColor: other.color
              });
            }
          }
        });
      }
    }

    state.events.push({
      t: 'move', id: me.id, name: me.name, color: me.color,
      plane: idx, to: target, from: from
    });

    /* 全部到家 → 结束 */
    var allHome = me.planes.every(function (p) { return p === MAXP; });
    if (allHome) {
      if (!state.finishTime[me.id]) {
        state.finishTime[me.id] = Math.round(state.time * 10) / 10;
        state.finishOrder.push(me.id);
        state.events.push({ t: 'finish', id: me.id, name: me.name, color: me.color, time: state.finishTime[me.id] });
      }
      /* 只剩最后一个人还没到家 -> 结束 */
      if (state.finishOrder.length >= state.order.length - 1) {
        state.winnerId = state.finishOrder[0] || null;
        state.ended = true;
        state.phase = 'over';
        state.wait = 0;
        return;
      }
      /* 已到家的玩家跳过回合 */
      nextTurn(state);
      while (!state.finishTime[currentId(state)] && state.finishOrder.length < state.order.length) {
        if (!state.finishTime[currentId(state)]) break;
        state.turn = (state.turn + 1) % state.order.length;
      }
      return;
    }

    if (state.dice >= LAUNCH) {
      state.phase = 'gap';
      state.wait = GAP_TIME;
      state.dice = 0;
      state.moves = [];
      state.rolled = false;
    } else {
      nextTurn(state);
    }
  }

  AR.games.ludo = {
    id: 'ludo',
    rate: 20,

    create: function (players, opt) {
      var n = players.length;
      var planeCount = Math.max(1, Math.min(4, (opt && opt.planes) || 1));
      var state = {
        time: 0,
        duration: 0,
        planes: planeCount,
        finishOrder: [],
        finishTime: {},
        n: n,
        order: [],
        players: {},
        turn: 0,
        phase: 'roll',
        dice: 0,
        wait: ROLL_WAIT,
        moves: [],
        winnerId: null,
        ended: false,
        events: [],
        rolled: false
      };
      players.forEach(function (p, i) {
        state.order.push(p.id);
        var planes = [];
        for (var q = 0; q < planeCount; q++) planes.push(-1);
        state.players[p.id] = {
          id: p.id,
          name: p.name,
          color: p.color,
          index: i,
          planes: planes
        };
      });
      state.rnd = AR.rng(((opt && opt.seed) || Date.now()) >>> 0);
      return state;
    },

    removePlayer: function (state, id) {
      var i = state.order.indexOf(id);
      if (i < 0) return;
      state.order.splice(i, 1);
      delete state.players[id];
      if (!state.order.length) {
        state.ended = true;
        return;
      }
      if (state.turn >= state.order.length) state.turn = 0;
      /* 索引要跟着重排，否则起跑格会错位 */
      state.order.forEach(function (oid, k) {
        state.players[oid].index = k;
      });
      state.n = state.order.length;
      state.phase = 'roll';
      state.wait = ROLL_WAIT;
      state.dice = 0;
      state.moves = [];
    },

    input: function (state, id, inp) {
      if (state.ended || !inp) return;
      if (currentId(state) !== id) return;
      if (state.phase === 'roll' && (inp.roll || inp.r)) {
        doRoll(state);
      } else if (state.phase === 'move' && typeof inp.plane === 'number') {
        applyMove(state, inp.plane | 0);
      }
    },

    tick: function (state, dt) {
      state.time += dt;
      if (state.ended) return;

      /* 当前玩家如果已经全部到家（还有别人没打完），直接跳到下一位 */
      if (allHome(state, currentId(state))) {
        for (var ai = 0; ai < state.order.length; ai++) {
          if (!allHome(state, state.order[ai])) { nextTurn(state); break; }
        }
      }

      state.wait -= dt;
      if (state.wait > 0) return;

      if (state.phase === 'gap') {
        state.phase = 'roll';
        state.wait = ROLL_WAIT;
        state.dice = 0;
        state.rolled = false;
      } else if (state.phase === 'roll') {
        doRoll(state);
      } else if (state.phase === 'show') {
        if (!state.moves.length) {
          state.phase = 'skip';
          state.wait = 1.0;
        } else if (state.moves.length === 1) {
          /* 只有一架能动，展示完骰子直接走 */
          state.phase = 'move';
          applyMove(state, state.moves[0]);
        } else {
          state.phase = 'move';
          state.wait = MOVE_WAIT;
        }
      } else if (state.phase === 'skip') {
        nextTurn(state);
      } else if (state.phase === 'move') {
        if (state.moves.length) applyMove(state, state.moves[0]);
        else nextTurn(state);
      }
    },

    /* 人机 */
    bot: function (state, id, dt, level) {
      if (state.ended) return null;
      if (currentId(state) !== id) return null;
      if (state.phase === 'roll') return { roll: 1 };
      if (state.phase !== 'move' || !state.moves.length) return null;

      var me = state.players[id];
      var skill = BOT_SKILL[level] || 0.6;
      var best = state.moves[0];
      var bestScore = -Infinity;

      for (var k = 0; k < state.moves.length; k++) {
        var idx = state.moves[k];
        var from = me.planes[idx];
        var to = from === -1 ? 0 : Math.min(MAXP, from + state.dice);
        var score = to;

        if (to === MAXP) score += 260;                       /* 到家 */
        if (to >= 0 && to < N) {
          var cell = absCell(state, me.index, to);
          /* 能踩人就踩 */
          state.order.forEach(function (oid) {
            if (oid === id) return;
            var other = state.players[oid];
            for (var j = 0; j < other.planes.length; j++) {
              var op = other.planes[j];
              if (op < 0 || op >= N) continue;
              if (absCell(state, other.index, op) === cell && SAFE.indexOf(cell) < 0) {
                score += 180;
              }
            }
          });
          /* 安全格更稳 */
          if (SAFE.indexOf(cell) >= 0) score += 40;
          /* 别停在被别人追得上的地方 */
          if (SAFE.indexOf(cell) < 0 && skill > 0.7) score -= 12;
        }

        score += (Math.abs(Math.sin(state.time * 3 + id.length + idx)) * (1 - skill) * 60);

        if (score > bestScore) { bestScore = score; best = idx; }
      }

      /* 低难度：有小概率手滑 */
      if (skill < 0.5 && state.moves.length > 1) {
        var slip = Math.abs(Math.sin(state.time * 1.7 + id.length));
        if (slip > 0.75) best = state.moves[Math.floor(slip * 100) % state.moves.length];
      }
      return { plane: best };
    },

    isOver: function (state) {
      return !!state.ended;
    },

    results: function (state) {
      var list = [];
      state.order.forEach(function (id) {
        var p = state.players[id];
        var done = 0;
        var prog = 0;
        p.planes.forEach(function (pos) {
          if (pos === MAXP) done++;
          prog += (pos === -1 ? 0 : pos + 1);
        });
        var fin = state.finishTime[id];
        /* 到家越快分越高；没到家的按进度给一点分 */
        var sc = fin ? Math.max(100, 3000 - Math.round(fin * 10)) : Math.min(99, Math.round(prog));
        list.push({
          id: id,
          name: p.name,
          score: sc,
          kills: done,
          done: done,
          fin: fin || null
        });
      });
      list.sort(function (a, b) {
        if (a.fin && b.fin) return a.fin - b.fin;
        if (a.fin) return -1;
        if (b.fin) return 1;
        return b.score - a.score;
      });
      return list;
    },

    snapshot: function (state) {
      var pl = state.order.map(function (id) {
        var p = state.players[id];
        return [id].concat(p.planes);
      });
      var ev = state.events;
      state.events = [];
      return {
        t: Math.round(state.time * 10) / 10,
        d: state.duration,
        ph: state.phase,
        c: currentId(state),
        w: Math.max(0, Math.ceil(state.wait)),
        dice: state.dice,
        mv: state.moves,
        n: state.order.length,
        planes: state.planes || 2,
        ft: state.finishTime || {},
        pl: pl,
        win: state.winnerId,
        e: ev.slice(0, 12)
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
