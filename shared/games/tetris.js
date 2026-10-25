/* ============================================================
 * 俄罗斯方块对战 · TETRIS VS（服务端权威）
 * 棋盘 10 x 20；消行给对手塞垃圾行
 * 格子值：0 空 1-7 方块色 8 垃圾行
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var BW = 10, BH = 20;
  var DURATION = 180;

  /* 人机水平：决定手速与选点质量 */
  var BOT_SKILL = { easy: 0.3, normal: 0.62, hard: 0.86, insane: 1.0 };

  var BASE = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
  };
  var TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];
  var ROT = {};

  function rotCW(m) {
    var n = m.length;
    var out = [];
    for (var y = 0; y < n; y++) {
      out.push([]);
      for (var x = 0; x < n; x++) out[y].push(m[n - 1 - x][y]);
    }
    return out;
  }

  TYPES.forEach(function (t) {
    var list = [BASE[t]];
    for (var i = 1; i < 4; i++) list.push(rotCW(list[i - 1]));
    ROT[t] = list;
  });

  function emptyBoard() {
    return new Array(BW * BH).fill(0);
  }

  function newPiece(rnd, type) {
    var t = type || TYPES[Math.floor(rnd() * TYPES.length)];
    return { t: t, r: 0, x: 3, y: 0 };
  }

  function cellsOf(p) {
    var m = ROT[p.t][p.r];
    var out = [];
    for (var y = 0; y < m.length; y++) {
      for (var x = 0; x < m.length; x++) {
        if (m[y][x]) out.push([p.x + x, p.y + y]);
      }
    }
    return out;
  }

  function collides(board, p) {
    var cells = cellsOf(p);
    for (var i = 0; i < cells.length; i++) {
      var x = cells[i][0], y = cells[i][1];
      if (x < 0 || x >= BW || y >= BH) return true;
      if (y >= 0 && board[y * BW + x]) return true;
    }
    return false;
  }

  function lockPiece(p) {
    var colorIndex = TYPES.indexOf(p.piece.t) + 1;
    var cells = cellsOf(p.piece);
    cells.forEach(function (c) {
      if (c[1] >= 0 && c[1] < BH && c[0] >= 0 && c[0] < BW) {
        p.board[c[1] * BW + c[0]] = colorIndex;
      }
    });
  }

  function clearLines(board) {
    var cleared = 0;
    for (var y = BH - 1; y >= 0; y--) {
      var full = true;
      for (var x = 0; x < BW; x++) if (!board[y * BW + x]) { full = false; break; }
      if (full) {
        board.copyWithin(BW, 0, y * BW);
        for (x = 0; x < BW; x++) board[x] = 0;
        cleared++;
        y++;
      }
    }
    return cleared;
  }

  function spawn(p, rnd) {
    p.piece = p.next || newPiece(rnd);
    p.next = newPiece(rnd);
    p.lockTimer = 0;
    p.botPlan = null;
    if (collides(p.board, p.piece)) {
      p.alive = false;
    }
  }

  /* ---------- 人机：评估每个落点，选一个分数最高的 ---------- */

  function dropYFor(board, t, r, x) {
    if (collides(board, { t: t, r: r, x: x, y: 0 })) return null;
    var y = 0;
    while (!collides(board, { t: t, r: r, x: x, y: y + 1 })) y++;
    return y;
  }

  function evaluateBoard(board, lines) {
    var heights = [];
    var agg = 0;
    var holes = 0;
    var x, y;
    for (x = 0; x < BW; x++) {
      var h = 0;
      var seen = false;
      for (y = 0; y < BH; y++) {
        if (board[y * BW + x]) {
          if (!h) h = BH - y;
          seen = true;
        } else if (seen) {
          holes++;
        }
      }
      heights.push(h);
      agg += h;
    }
    var bump = 0;
    for (x = 0; x < BW - 1; x++) bump += Math.abs(heights[x] - heights[x + 1]);
    return -0.51 * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump;
  }

  function bestPlacement(board, piece, level) {
    var cands = [];
    for (var r = 0; r < 4; r++) {
      for (var x = -2; x < BW; x++) {
        var y = dropYFor(board, piece.t, r, x);
        if (y === null) continue;
        var b2 = board.slice();
        var cells = cellsOf({ t: piece.t, r: r, x: x, y: y });
        var ok = true;
        for (var i = 0; i < cells.length; i++) {
          var cx = cells[i][0];
          var cy = cells[i][1];
          if (cx < 0 || cx >= BW || cy < 0 || cy >= BH) { ok = false; break; }
          b2[cy * BW + cx] = 1;
        }
        if (!ok) continue;
        var lines = clearLines(b2);
        cands.push({ r: r, x: x, score: evaluateBoard(b2, lines) });
      }
    }
    if (!cands.length) return null;
    cands.sort(function (a, b) { return b.score - a.score; });
    var idx = 0;
    if (level === 'easy') idx = Math.floor(Math.random() * Math.min(4, cands.length));
    else if (level === 'normal') idx = Math.floor(Math.random() * Math.min(2, cands.length));
    return cands[idx];
  }

  function applyGarbage(p, rnd) {
    if (!p.pending) return;
    var n = p.pending;
    p.pending = 0;
    for (var i = 0; i < n; i++) {
      p.board.copyWithin(0, BW, BW * BH);
      var row = BH * BW - BW;
      var hole = Math.floor(rnd() * BW);
      var hole2 = rnd() < 0.35 ? Math.floor(rnd() * BW) : -1;
      for (var x = 0; x < BW; x++) {
        p.board[row + x] = (x === hole || x === hole2) ? 0 : 8;
      }
    }
  }

  function sendGarbage(state, fromId, lines) {
    for (var id in state.players) {
      if (id === fromId) continue;
      state.players[id].pending += lines;
    }
  }

  function tryMove(p, dx, dy) {
    var test = { t: p.piece.t, r: p.piece.r, x: p.piece.x + dx, y: p.piece.y + dy };
    if (!collides(p.board, test)) {
      p.piece = test;
      return true;
    }
    return false;
  }

  function tryRotate(p, dir) {
    var nr = (p.piece.r + (dir || 1) + 4) % 4;
    var kicks = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];
    for (var i = 0; i < kicks.length; i++) {
      var test = { t: p.piece.t, r: nr, x: p.piece.x + kicks[i][0], y: p.piece.y + kicks[i][1] };
      if (!collides(p.board, test)) {
        p.piece = test;
        return true;
      }
    }
    return false;
  }

  function applyEvent(state, p, ev) {
    if (!p.alive || !p.piece) return;
    if (ev === 'L') tryMove(p, -1, 0);
    else if (ev === 'R') tryMove(p, 1, 0);
    else if (ev === 'ROT') tryRotate(p, 1);
    else if (ev === 'DOWN') {
      if (tryMove(p, 0, 1)) p.score += 1;
      else p.lockTimer = 0.02;
    } else if (ev === 'DROP') {
      var guard = 0;
      while (tryMove(p, 0, 1) && guard++ < 30) p.score += 2;
      p.lockTimer = 0.02;
    }
  }

  AR.games.tetris = {
    id: 'tetris',
    rate: 15,

    create: function (players, opt) {
      var rnd = AR.rng((opt && opt.seed) || Date.now());
      var state = {
        time: 0,
        duration: (opt && opt.duration) || DURATION,
        rnd: rnd,
        players: {},
        bw: BW, bh: BH
      };
      for (var i = 0; i < players.length; i++) {
        var pl = players[i];
        var p = {
          id: pl.id, name: pl.name, color: pl.color,
          board: emptyBoard(),
          piece: null, next: null,
          dropTimer: 0, lockTimer: 0,
          score: 0, lines: 0, alive: true, pending: 0,
          queue: []
        };
        spawn(p, rnd);
        state.players[pl.id] = p;
      }
      return state;
    },

    removePlayer: function (state, id) {
      delete state.players[id];
    },

    input: function (state, id, inp) {
      var p = state.players[id];
      if (!p || !p.alive) return;
      var ev = inp && inp.ev;
      if (!ev) return;
      if (typeof ev === 'string') p.queue.push(ev);
      else if (Object.prototype.toString.call(ev) === '[object Array]') {
        for (var i = 0; i < ev.length && i < 4; i++) p.queue.push(String(ev[i]));
      }
    },

    tick: function (state, dt) {
      state.time += dt;
      var rnd = state.rnd;

      for (var id in state.players) {
        var p = state.players[id];
        if (!p.alive) continue;

        var guard = 0;
        while (p.queue.length && guard++ < 8) applyEvent(state, p, p.queue.shift());

        if (!p.alive || !p.piece) continue;

        if (p.lockTimer > 0) {
          p.lockTimer -= dt;
          if (p.lockTimer <= 0) {
            lockPiece(p);
            var n = clearLines(p.board);
            if (n > 0) {
              p.score += [0, 100, 300, 500, 800][n] || 800;
              p.lines += n;
              if (n >= 2) sendGarbage(state, id, n - 1);
            }
            applyGarbage(p, rnd);
            spawn(p, rnd);
          }
          continue;
        }

        p.dropTimer += dt;
        var interval = Math.max(0.16, 0.85 - p.lines * 0.016);
        if (p.dropTimer >= interval) {
          p.dropTimer = 0;
          if (!tryMove(p, 0, 1)) p.lockTimer = 0.45;
        }
      }

      var alive = 0, aliveId = null;
      for (id in state.players) {
        if (state.players[id].alive) { alive++; aliveId = id; }
      }
      if (alive <= 1) {
        if (!state.winnerId) {
          state.winnerId = aliveId;
          state.overAt = state.time;
          if (aliveId) state.players[aliveId].score += 50;
        }
        if (state.time - state.overAt > 1.2) state.ended = true;
      }
    },

    isOver: function (state) {
      return state.ended || state.time >= state.duration;
    },

    results: function (state) {
      var list = [];
      for (var id in state.players) {
        var p = state.players[id];
        list.push({
          id: p.id, name: p.name,
          score: p.score + (p.alive ? 20 : 0),
          kills: p.lines,
          alive: p.alive ? 1 : 0
        });
      }
      list.sort(function (a, b) {
        if (b.alive !== a.alive) return b.alive - a.alive;
        return b.score - a.score;
      });
      return list;
    },

    /* 人机：每个方块算一次最佳落点，然后旋转/平移/直落 */
    bot: function (state, id, dt, level) {
      var p = state.players[id];
      if (!p || !p.alive || !p.piece) return null;

      var skill = BOT_SKILL[level] || 0.7;
      p.botCool = (p.botCool || 0) - dt;
      if (p.botCool > 0) return null;
      p.botCool = 0.04 + (1 - skill) * 0.26;

      if (!p.botPlan) {
        p.botPlan = bestPlacement(p.board, p.piece, level);
        if (!p.botPlan) return null;
      }

      var plan = p.botPlan;
      if (p.piece.r !== plan.r) return { ev: ['ROT'] };
      if (p.piece.x < plan.x) return { ev: ['R'] };
      if (p.piece.x > plan.x) return { ev: ['L'] };
      return { ev: ['DROP'] };
    },

    snapshot: function (state) {
      var ps = [];
      for (var id in state.players) {
        var p = state.players[id];
        ps.push({
          i: p.id,
          b: p.board.join(''),
          pc: p.piece ? [p.piece.t, p.piece.r, p.piece.x, p.piece.y] : null,
          nx: p.next ? p.next.t : null,
          s: p.score,
          l: p.lines,
          al: p.alive ? 1 : 0,
          g: p.pending
        });
      }
      return {
        t: Math.round(state.time * 10) / 10,
        d: state.duration,
        p: ps
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
