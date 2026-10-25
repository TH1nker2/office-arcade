/* ============================================================
 * 五子棋 · GOMOKU（服务端权威）
 * 15x15，两人对弈，无时间限制，先连成 5 子者胜
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;

  var N = 15;                    /* 棋盘 15x15 */
  var BOT_LEVEL = { easy: 0, normal: 1, hard: 2, insane: 3 };

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

  AR.games.gomoku = {
    id: 'gomoku',
    rate: 8,

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
        winnerId: null,
        winLine: null,
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

    removePlayer: function (state, id) {
      var i = state.order.indexOf(id);
      if (i < 0) return;
      state.order.splice(i, 1);
      delete state.players[id];
      if (!state.order.length || !state.ended) {
        state.ended = true;
        state.winnerId = state.order[0] || null;
      }
    },

    input: function (state, id, inp) {
      if (state.ended || !inp) return;
      if (state.order[state.turn % state.order.length] !== id) return;
      var x = inp.x | 0;
      var y = inp.y | 0;
      if (!inBoard(x, y)) return;
      if (state.board[idx(x, y)] !== 0) return;

      var v = state.side[id];
      state.board[idx(x, y)] = v;
      state.moves++;
      state.last = { x: x, y: y, v: v };
      state.events.push({ t: 'place', id: id, name: state.players[id].name, color: state.players[id].color, x: x, y: y, v: v });

      var win = lineAt(state.board, x, y, v);
      if (win) {
        state.ended = true;
        state.winnerId = id;
        state.winLine = win;
        state.events.push({ t: 'win', id: id, name: state.players[id].name, color: state.players[id].color });
        return;
      }
      if (state.moves >= N * N) {
        state.ended = true;          /* 和棋 */
        return;
      }
      state.turn = (state.turn + 1) % state.order.length;
    },

    tick: function (state, dt) {
      state.time += dt;
    },

    bot: function (state, id, dt, level) {
      if (state.ended) return null;
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

    isOver: function (state) { return state.ended; },

    results: function (state) {
      var list = [];
      state.order.forEach(function (id) {
        var p = state.players[id];
        list.push({
          id: id,
          name: p.name,
          score: state.winnerId === id ? 100 : 0,
          kills: state.winnerId === id ? 1 : 0
        });
      });
      list.sort(function (a, b) { return b.score - a.score; });
      return list;
    },

    snapshot: function (state) {
      var ev = state.events;
      state.events = [];
      return {
        n: N,
        b: state.board.join(''),
        t: Math.round(state.time * 10) / 10,
        cur: state.order[state.turn % state.order.length],
        mv: state.moves,
        last: state.last ? [state.last.x, state.last.y, state.last.v] : null,
        win: state.winnerId,
        wl: state.winLine || null,
        e: ev
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
