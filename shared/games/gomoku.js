/* ============================================================
 * 五子棋 · GOMOKU（服务端权威）
 * 15x15，两人对弈，无时间限制，先连成 5 子者胜
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;

  var N = AR.GameConstants.GOMOKU.N;                    /* 棋盘 15x15 */
  var BOT_LEVEL = { easy: 0, normal: 1, hard: 2, insane: 3 };
  var WIN_DELAY = 1.0;          /* 连五后先在棋盘上亮 1 秒再结算 */

  function idx(x, y) { return y * N + x; }

  function inBoard(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }

  function newBoard() {
    var b = new Array(N * N);
    for (var i = 0; i < b.length; i++) b[i] = 0;
    return b;
  }

  /* 从 (x,y) 往四个方向数，返回最长连子数与连子路径 */
  function lineAt(board, x, y, v) {
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (var d = 0; d < 4; d++) {
      var dx = dirs[d][0];
      var dy = dirs[d][1];
      var cells = [[x, y]];
      var nx = x + dx;
      var ny = y + dy;
      while (inBoard(nx, ny) && board[idx(nx, ny)] === v) {
        cells.push([nx, ny]);
        nx += dx; ny += dy;
      }
      nx = x - dx;
      ny = y - dy;
      while (inBoard(nx, ny) && board[idx(nx, ny)] === v) {
        cells.unshift([nx, ny]);
        nx -= dx; ny -= dy;
      }
      if (cells.length >= 5) return cells;
    }
    return null;
  }

  /* 落子后这一点的局面分：自己连 + 对手威胁 */
  function pointScore(board, x, y, me, foe) {
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    var score = 0;
    for (var d = 0; d < 4; d++) {
      var dx = dirs[d][0];
      var dy = dirs[d][1];
      var count = 1;
      var open = 0;
      for (var s = -1; s <= 1; s += 2) {
        var nx = x + dx * s;
        var ny = y + dy * s;
        var run = 0;
        while (inBoard(nx, ny) && board[idx(nx, ny)] === me) {
          run++;
          nx += dx * s; ny += dy * s;
        }
        count += run;
        if (inBoard(nx, ny) && board[idx(nx, ny)] === 0) open++;
      }
      if (count >= 5) score += 100000;
      else if (count === 4) score += open > 0 ? 12000 : 900;
      else if (count === 3) score += open === 2 ? 1500 : (open === 1 ? 240 : 0);
      else if (count === 2) score += open === 2 ? 120 : (open === 1 ? 24 : 0);
      else if (open === 2) score += 6;
    }
    /* 防守权重：拦住对手同等重要的位置 */
    var foeScore = 0;
    for (var d2 = 0; d2 < 4; d2++) {
      var ex = dirs[d2][0];
      var ey = dirs[d2][1];
      var c2 = 1;
      var o2 = 0;
      for (var t = -1; t <= 1; t += 2) {
        var mx = x + ex * t;
        var my = y + ey * t;
        var r2 = 0;
        while (inBoard(mx, my) && board[idx(mx, my)] === foe) {
          r2++;
          mx += ex * t; my += ey * t;
        }
        c2 += r2;
        if (inBoard(mx, my) && board[idx(mx, my)] === 0) o2++;
      }
      if (c2 >= 5) foeScore += 90000;
      else if (c2 === 4) foeScore += o2 > 0 ? 9000 : 500;
      else if (c2 === 3) foeScore += o2 === 2 ? 900 : (o2 === 1 ? 150 : 0);
    }
    return score + foeScore * 0.9;
  }

  function bestMove(state, me) {
    var board = state.board;
    var foe = me === 1 ? 2 : 1;
    var best = -1;
    var bestScore = -Infinity;
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        if (board[idx(x, y)] !== 0) continue;
        if (!hasNeighbor(board, x, y)) continue;
        var sc = pointScore(board, x, y, me, foe);
        /* 轻微偏好中心，开局不至于贴边 */
        sc += (14 - Math.abs(x - 7) - Math.abs(y - 7)) * 2;
        if (sc > bestScore) { bestScore = sc; best = idx(x, y); }
      }
    }
    return best;
  }

  function hasNeighbor(board, x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx;
        var ny = y + dy;
        if (inBoard(nx, ny) && board[idx(nx, ny)] !== 0) return true;
      }
    }
    return false;
  }

  /* 悔棋：撤回请求者自己的上一手，以及之后对手的应手；回合交还请求者。 */
  function undoLast(state, requesterId) {
    var from = -1;
    for (var i = state.history.length - 1; i >= 0; i--) {
      if (state.history[i].id === requesterId) { from = i; break; }
    }
    if (from < 0) return false;

    var removed = state.history.splice(from);
    removed.forEach(function (mv) {
      state.board[idx(mv.x, mv.y)] = 0;
    });
    state.moves = Math.max(0, state.moves - removed.length);
    var prev = state.history[state.history.length - 1];
    state.last = prev ? { x: prev.x, y: prev.y, v: prev.v } : null;
    state.winnerId = null;
    state.winLine = null;
    state.winPending = 0;
    state.draw = false;

    var turn = state.order.indexOf(requesterId);
    if (turn >= 0) state.turn = turn;
    var lastRemoved = removed[removed.length - 1];
    var p = state.players[requesterId];
    state.events.push({
      t: 'undo', id: requesterId,
      name: p ? p.name : '',
      x: lastRemoved.x, y: lastRemoved.y
    });
    return true;
  }

  AR.games.gomoku = {
    id: 'gomoku',
    rate: 8,

    /* 建立对局状态。players 里带 bot 字段的是人机。返回的 state 之后会一直被 tick 修改。 */
    create: function (players, opt) {
      var order = players.map(function (p) { return p.id; });
      var state = {
        time: 0,
        duration: 0,               /* 不限时 */
        n: order.length,
        order: order,
        players: {},
        board: newBoard(),
        turn: 0,                   /* 0 黑 1 白 */
        side: {},                  /* id -> 1 或 2 */
        moves: 0,
        history: [],
        pending: null,
        draw: false,
        req: { undo: 0, draw: 0 },
        winnerId: null,
        winLine: null,
        winPending: 0,
        ended: false,
        events: [],
        last: null
      };
      order.forEach(function (id, i) {
        state.players[id] = { id: id, name: players[i].name, color: players[i].color, index: i };
        state.side[id] = i === 0 ? 1 : 2;      /* 1 = 黑先手 */
      });
      return state;
    },

    /* 玩家中途退出，把他从对局里摘掉，避免一直等他操作。 */
    removePlayer: function (state, id) {
      var i = state.order.indexOf(id);
      if (i < 0) return;
      state.order.splice(i, 1);
      delete state.players[id];
      state.pending = null;
      if (!state.order.length || !state.ended) {
        state.ended = true;
        state.winnerId = state.order[0] || null;
      }
    },

    /* 处理一次玩家操作。inp 的结构由 js/input.js 里对应分支决定。 */
    input: function (state, id, inp) {
      if (state.ended || state.winPending > 0 || !inp) return;
      if (!state.players[id]) return;

      /* 认输：不需要对方同意，立即结束 */
      if (inp.act === 'resign') {
        var winner = null;
        state.order.forEach(function (oid) { if (oid !== id) winner = oid; });
        state.pending = null;
        state.ended = true;
        state.winnerId = winner;
        state.winLine = null;
        state.winPending = 0;
        state.events.push({
          t: 'resign', by: id, name: state.players[id].name, winner: winner
        });
        return;
      }

      /* 同意 / 拒绝对方的悔棋或和棋请求 */
      if (inp.act === 'reply') {
        var pend = state.pending;
        if (!pend || pend.from === id) return;
        var requester = state.players[pend.from];
        if (inp.accept) {
          if (pend.type === 'undo') {
            undoLast(state, pend.from);
          } else if (pend.type === 'draw') {
            state.draw = true;
            state.ended = true;
            state.winnerId = null;
            state.winLine = null;
            state.winPending = 0;
            state.events.push({
              t: 'draw', by: pend.from,
              name: requester ? requester.name : '', id: id
            });
          }
        } else {
          state.events.push({
            t: 'decline', kind: pend.type, by: id,
            name: state.players[id].name
          });
        }
        state.pending = null;
        return;
      }

      /* 发起悔棋 / 和棋：每局全桌各最多 3 次，必须等对方回复 */
      if (inp.act === 'undo' || inp.act === 'draw') {
        if (state.pending) return;
        var rq = state.req;
        if (!rq || rq[inp.act] >= 3) return;
        if (inp.act === 'undo') {
          /* 只能在自己的回合、且自己确实落过子时悔棋 */
          if (state.order[state.turn % state.order.length] !== id) return;
          var hasMine = false;
          for (var hi = state.history.length - 1; hi >= 0; hi--) {
            if (state.history[hi].id === id) { hasMine = true; break; }
          }
          if (!hasMine) return;
        }
        rq[inp.act]++;
        state.pending = { type: inp.act, from: id };
        state.events.push({
          t: 'request', kind: inp.act, by: id, name: state.players[id].name
        });
        return;
      }

      /* 等待对方回复期间不能落子 */
      if (state.pending) return;
      if (state.order[state.turn % state.order.length] !== id) return;
      var x = inp.x | 0;
      var y = inp.y | 0;
      if (!inBoard(x, y)) return;
      if (state.board[idx(x, y)] !== 0) return;

      var v = state.side[id];
      state.board[idx(x, y)] = v;
      state.moves++;
      state.last = { x: x, y: y, v: v };
      state.history.push({ x: x, y: y, v: v, id: id });
      state.events.push({ t: 'place', id: id, name: state.players[id].name, color: state.players[id].color, x: x, y: y, v: v });

      var win = lineAt(state.board, x, y, v);
      if (win) {
        state.winnerId = id;
        state.winLine = win;
        state.winPending = WIN_DELAY;      /* 先亮 1 秒，tick 里再真正结束 */
        state.events.push({ t: 'win', id: id, name: state.players[id].name, color: state.players[id].color });
        return;
      }
      if (state.moves >= N * N) {
        state.draw = true;
        state.ended = true;          /* 棋盘下满和棋 */
        return;
      }
      state.turn = (state.turn + 1) % state.order.length;
    },

    /* 推进一帧，dt 固定为 1/60 秒。这里只能改 state，不要读时间/文件/网络。 */
    tick: function (state, dt) {
      state.time += dt;
      if (state.winPending > 0 && !state.ended) {
        state.winPending -= dt;
        if (state.winPending <= 0) {
          state.winPending = 0;
          state.ended = true;
        }
      }
    },

    /* 人机决策，返回一个 input 对象（或 null 表示这一帧什么都不做）。 */
    bot: function (state, id, dt, level) {
      if (state.ended) return null;
      if (state.winPending > 0) return null;
      /* 人机默认同意玩家的悔棋/和棋请求 */
      if (state.pending) {
        if (state.pending.from !== id) return { act: 'reply', accept: true };
        return null;
      }
      if (state.order[state.turn % state.order.length] !== id) return null;
      var lv = BOT_LEVEL[level] || 1;
      var me = state.side[id];

      /* 简单人机：偶尔随手下一手 */
      if (lv === 0 && Math.abs(Math.sin(state.time * 3 + id.length)) > 0.88) {
        for (var k = 0; k < 200; k++) {
          var rx = Math.floor(Math.abs(Math.sin(k * 12.9898 + state.time)) * N);
          var ry = Math.floor(Math.abs(Math.sin(k * 78.233 + state.time * 1.7)) * N);
          if (state.board[idx(rx, ry)] === 0) return { x: rx, y: ry };
        }
      }
      var mv = bestMove(state, me);
      if (mv < 0) return null;
      return { x: mv % N, y: Math.floor(mv / N) };
    },

    /* 服务端每帧问一次。返回 true 时这一局结束，会调 results() 结算。 */
    isOver: function (state) { return state.ended; },

    /* 结算：返回 [{id, name, score, ...}]，服务端按顺序写进战绩。 */
    results: function (state) {
      var list = [];
      state.order.forEach(function (id) {
        var p = state.players[id];
        list.push({
          id: id,
          name: p.name,
          score: state.draw ? 50 : (state.winnerId === id ? 100 : 0),
          kills: state.draw ? 0 : (state.winnerId === id ? 1 : 0),
          draw: !!state.draw
        });
      });
      list.sort(function (a, b) { return b.score - a.score; });
      return list;
    },

    /* 发给所有客户端的状态，必须是纯 JSON（不能有函数/循环引用/NaN）。 */
    snapshot: function (state) {
      var ev = state.events;
      state.events = [];
      return {
        n: N,
        b: state.board.join(''),
        t: Math.round(state.time * 10) / 10,
        cur: state.order[state.turn % state.order.length],
        sd: state.side,
        mv: state.moves,
        last: state.last ? [state.last.x, state.last.y, state.last.v] : null,
        win: state.winnerId,
        wl: state.winLine || null,
        wp: Math.max(0, state.winPending || 0),
        draw: !!state.draw,
        pending: state.pending ? { type: state.pending.type, from: state.pending.from } : null,
        rq: state.req,
        e: ev
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
