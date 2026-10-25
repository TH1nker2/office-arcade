/* ============================================================
 * 炸弹人 · BOMBER（服务端权威）
 * 15 x 13 格，每格 48px；放炸弹拆砖块抢道具，最后活着的人赢
 * 地图值：0 空 1 石墙 2 砖块
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var TW = 15, TH = 13, TILE = 48;
  var W = TW * TILE, H = TH * TILE;
  var MOVE_TIME = 0.135;
  var BOMB_FUSE = 2.3;
  var FLAME_TIME = 0.55;
  var DURATION = 120;

  /* 人机水平：0-1 */
  var BOT_SKILL = { easy: 0.3, normal: 0.6, hard: 0.82, insane: 0.97 };
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function spawnCells() {
    return [[1, 1], [TW - 2, 1], [1, TH - 2], [TW - 2, TH - 2]];
  }

  function makeMap(rnd) {
    var map = new Array(TW * TH).fill(0);
    var x, y;
    for (y = 0; y < TH; y++) {
      for (x = 0; x < TW; x++) {
        var wall = (x === 0 || y === 0 || x === TW - 1 || y === TH - 1) ||
          (x % 2 === 0 && y % 2 === 0);
        map[y * TW + x] = wall ? 1 : (rnd() < 0.42 ? 2 : 0);
      }
    }
    spawnCells().forEach(function (s) {
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var tx = s[0] + dx, ty = s[1] + dy;
          if (tx > 0 && ty > 0 && tx < TW - 1 && ty < TH - 1) map[ty * TW + tx] = 0;
        }
      }
    });
    return map;
  }

  function tileCenter(c) { return c * TILE + TILE / 2; }

  function makePlayer(state, p, index) {
    var s = spawnCells()[index % 4];
    return {
      id: p.id, name: p.name, color: p.color,
      cx: s[0], cy: s[1],
      fromX: s[0], fromY: s[1],
      moveT: 1,
      dir: 0,
      alive: true,
      bombMax: 1,
      range: 2,
      speed: 1,
      bombCount: 0,
      kills: 0,
      score: 0,
      input: {},
      deathAt: 0
    };
  }

  function blocked(state, cx, cy, forPlayer) {
    if (cx < 0 || cy < 0 || cx >= TW || cy >= TH) return true;
    if (state.map[cy * TW + cx] !== 0) return true;
    for (var i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      if (b.cx === cx && b.cy === cy) {
        /* 自己刚放下的炸弹可以走出 */
        var own = b.owner === forPlayer.id && b.cx === forPlayer.cx && b.cy === forPlayer.cy;
        if (!own) return true;
      }
    }
    return false;
  }

  function placeBomb(state, p) {
    if (p.bombCount >= p.bombMax) return;
    for (var i = 0; i < state.bombs.length; i++) {
      if (state.bombs[i].cx === p.cx && state.bombs[i].cy === p.cy) return;
    }
    state.bombs.push({
      cx: p.cx, cy: p.cy,
      timer: BOMB_FUSE,
      range: p.range,
      owner: p.id,
      color: p.color
    });
    p.bombCount++;
    state.events.push({ t: 'bomb', cx: p.cx, cy: p.cy });
  }

  function explode(state, bomb) {
    var queue = [bomb];
    var guard = 0;
    while (queue.length && guard++ < 40) {
      var b = queue.shift();
      var idx = state.bombs.indexOf(b);
      if (idx < 0) continue;
      state.bombs.splice(idx, 1);

      var own = state.players[b.owner];
      if (own && own.bombCount > 0) own.bombCount--;

      var cells = [[b.cx, b.cy, 1]];
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < 4; d++) {
        for (var r = 1; r <= b.range; r++) {
          var cx = b.cx + dirs[d][0] * r;
          var cy = b.cy + dirs[d][1] * r;
          if (cx < 0 || cy < 0 || cx >= TW || cy >= TH) break;
          var v = state.map[cy * TW + cx];
          if (v === 1) break;
          if (v === 2) {
            state.map[cy * TW + cx] = 0;
            state.mapDirty = true;
            cells.push([cx, cy, 0]);
            /* 掉落道具 */
            if (state.rnd() < 0.26) {
              var roll = state.rnd();
              var type = roll < 0.45 ? 'bomb' : (roll < 0.82 ? 'range' : 'speed');
              state.powerups.push({ cx: cx, cy: cy, type: type });
            }
            break;
          }
          cells.push([cx, cy, 0]);
          /* 连锁 */
          for (var k = 0; k < state.bombs.length; k++) {
            var nb = state.bombs[k];
            if (nb.cx === cx && nb.cy === cy && queue.indexOf(nb) < 0) queue.push(nb);
          }
        }
      }

      cells.forEach(function (c) {
        if (state.map[c[1] * TW + c[0]] === 2) {
          state.map[c[1] * TW + c[0]] = 0;
          state.mapDirty = true;
        }
        state.flames.push({ cx: c[0], cy: c[1], ttl: FLAME_TIME, owner: b.owner });
        for (var id in state.players) {
          var p = state.players[id];
          if (!p.alive) continue;
          if (p.cx === c[0] && p.cy === c[1]) killPlayer(state, p, state.players[b.owner]);
        }
      });

      state.events.push({ t: 'boom', cx: b.cx, cy: b.cy });
    }
  }

  function killPlayer(state, p, killer) {
    if (!p.alive) return;
    p.alive = false;
    p.deathAt = state.time;
    state.events.push({ t: 'die', cx: p.cx, cy: p.cy, c: p.color });
    if (killer && killer.id !== p.id) {
      state.events.push({
        t: 'kill', by: killer.id, name: killer.name, color: killer.color,
        victim: p.id, vname: p.name, vcolor: p.color
      });
      killer.kills++;
      killer.score += 3;
    }
  }

  /* ---------- 人机用的地形查询 ---------- */

  /* 某格是否处于爆炸范围（现有的炸弹 + 已喷出的火焰） */
  function blastRisk(state, cx, cy) {
    var i;
    for (i = 0; i < state.flames.length; i++) {
      if (state.flames[i].cx === cx && state.flames[i].cy === cy) return true;
    }
    for (i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      if (b.cx === cx && b.cy === cy) return true;
      if (blastSim(state, b.cx, b.cy, b.range, cx, cy)) return true;
    }
    return false;
  }

  /* 从 (bx,by) 放一个 range 的炸弹，是否会烧到 (cx,cy) */
  function blastSim(state, bx, by, range, cx, cy) {
    if (bx === cx && by === cy) return true;
    var i;
    if (bx === cx) {
      var dy = cy > by ? 1 : -1;
      for (var y = by + dy; y !== cy + dy; y += dy) {
        if (Math.abs(y - by) > range) return false;
        if (y === cy) return true;
        if (state.map[y * TW + bx] !== 0) return false;
      }
    }
    if (by === cy) {
      var dx = cx > bx ? 1 : -1;
      for (var x = bx + dx; x !== cx + dx; x += dx) {
        if (Math.abs(x - bx) > range) return false;
        if (x === cx) return true;
        if (state.map[by * TW + x] !== 0) return false;
      }
    }
    return false;
  }

  /* 该格被几个炸弹覆盖（0 表示安全） */
  function blastHits(state, cx, cy) {
    var n = 0;
    var i;
    for (i = 0; i < state.bombs.length; i++) {
      var b = state.bombs[i];
      if (blastSim(state, b.cx, b.cy, b.range, cx, cy)) n++;
    }
    for (i = 0; i < state.flames.length; i++) {
      if (state.flames[i].cx === cx && state.flames[i].cy === cy) n++;
    }
    return n;
  }

  /* 当前格放炸弹后，还来不来得及跑到安全格 */
  function wouldTrap(state, p) {
    var q = [[p.cx, p.cy, 0]];
    var seen = {};
    seen[p.cx + ',' + p.cy] = true;
    var head = 0;
    while (head < q.length && head < 60) {
      var cur = q[head++];
      var cx = cur[0];
      var cy = cur[1];
      var d = cur[2];
      if (d > 0 && !blastSim(state, p.cx, p.cy, p.range, cx, cy)) return false;
      if (d >= 8) continue;
      for (var i = 0; i < DIRS.length; i++) {
        var nx = cx + DIRS[i][0];
        var ny = cy + DIRS[i][1];
        if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue;
        var key = nx + ',' + ny;
        if (seen[key]) continue;
        if (blocked(state, nx, ny, p)) continue;
        seen[key] = true;
        q.push([nx, ny, d + 1]);
      }
    }
    return true;
  }

  /* 旁边是否有值得炸的东西 */
  function hasBombTarget(state, p) {
    for (var i = 0; i < DIRS.length; i++) {
      var nx = p.cx + DIRS[i][0];
      var ny = p.cy + DIRS[i][1];
      if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue;
      var v = state.map[ny * TW + nx];
      if (v === 2 || v === 3) return true;
      for (var id in state.players) {
        var o = state.players[id];
        if (o !== p && o.alive && o.cx === nx && o.cy === ny) return true;
      }
    }
    return false;
  }

  function isTarget(state, cx, cy, p) {
    var i;
    for (i = 0; i < state.powerups.length; i++) {
      if (state.powerups[i].cx === cx && state.powerups[i].cy === cy) return true;
    }
    for (var id in state.players) {
      var o = state.players[id];
      if (o !== p && o.alive && o.cx === cx && o.cy === cy) return true;
    }
    for (i = 0; i < DIRS.length; i++) {
      var nx = cx + DIRS[i][0];
      var ny = cy + DIRS[i][1];
      if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue;
      var v = state.map[ny * TW + nx];
      if (v === 2 || v === 3) return true;
    }
    return false;
  }

  /* 网格 BFS：返回朝最近目标的下一步 */
  function bfsStep(state, p) {
    var start = p.cy * TW + p.cx;
    var visited = new Uint8Array(TW * TH);
    var prev = new Int16Array(TW * TH).fill(-1);
    var q = [start];
    visited[start] = 1;
    var goal = -1;

    for (var h = 0; h < q.length && h < 400; h++) {
      var cur = q[h];
      var cx = cur % TW;
      var cy = (cur / TW) | 0;
      if (cur !== start && isTarget(state, cx, cy, p)) { goal = cur; break; }
      for (var i = 0; i < DIRS.length; i++) {
        var nx = cx + DIRS[i][0];
        var ny = cy + DIRS[i][1];
        if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue;
        var ni = ny * TW + nx;
        if (visited[ni]) continue;
        if (blocked(state, nx, ny, p)) continue;
        visited[ni] = 1;
        prev[ni] = cur;
        q.push(ni);
      }
    }

    if (goal < 0) return null;
    var node = goal;
    while (prev[node] >= 0 && prev[node] !== start) node = prev[node];
    return { dx: (node % TW) - p.cx, dy: ((node / TW) | 0) - p.cy };
  }

  AR.games.bomber = {
    id: 'bomber',

    create: function (players, opt) {
      var rnd = AR.rng((opt && opt.seed) || Date.now());
      var state = {
        w: W, h: H, tw: TW, th: TH, tile: TILE,
        time: 0,
        duration: (opt && opt.duration) || DURATION,
        rnd: rnd,
        map: makeMap(rnd),
        players: {},
        bombs: [],
        flames: [],
        powerups: [],
        events: [],
        mapDirty: true
      };
      for (var i = 0; i < players.length; i++) {
        state.players[players[i].id] = makePlayer(state, players[i], i);
      }
      return state;
    },

    meta: function (state) {
      return {
        w: state.w, h: state.h, tw: state.tw, th: state.th, tile: state.tile,
        map: state.map.join('')
      };
    },

    removePlayer: function (state, id) {
      delete state.players[id];
    },

    input: function (state, id, inp) {
      var p = state.players[id];
      if (!p) return;
      p.input = inp || {};
      if (p.input.bomb) {
        placeBomb(state, p);
        p.input.bomb = false;
      }
    },

    tick: function (state, dt) {
      state.time += dt;
      var id, i, p;

      for (id in state.players) {
        p = state.players[id];
        if (!p.alive) continue;

        if (p.moveT < 1) {
          p.moveT = Math.min(1, p.moveT + dt / (p.moveTime || MOVE_TIME));
          if (p.moveT >= 1) {
            /* 到达格子：捡道具 */
            for (i = state.powerups.length - 1; i >= 0; i--) {
              var pu = state.powerups[i];
              if (pu.cx === p.cx && pu.cy === p.cy) {
                if (pu.type === 'bomb') p.bombMax = Math.min(6, p.bombMax + 1);
                else if (pu.type === 'range') p.range = Math.min(7, p.range + 1);
                else p.speed = Math.min(2.2, p.speed + 0.18);
                state.powerups.splice(i, 1);
                state.events.push({ t: 'pick', cx: p.cx, cy: p.cy, c: p.color });
              }
            }
          }
          continue;
        }

        var inp = p.input || {};
        var dx = 0, dy = 0;
        if (inp.dx > 0.5) dx = 1;
        else if (inp.dx < -0.5) dx = -1;
        if (inp.dy > 0.5) dy = 1;
        else if (inp.dy < -0.5) dy = -1;
        if (dx && dy) { if (Math.abs(inp.dx) > Math.abs(inp.dy)) dy = 0; else dx = 0; }

        if (dx || dy) {
          p.dir = dx ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
          var nx = p.cx + dx, ny = p.cy + dy;
          if (!blocked(state, nx, ny, p)) {
            p.fromX = p.cx;
            p.fromY = p.cy;
            p.cx = nx;
            p.cy = ny;
            p.moveT = 0;
            p.moveTime = MOVE_TIME / Math.max(0.6, p.speed);
          }
        }
      }

      /* 炸弹倒计时 */
      for (i = state.bombs.length - 1; i >= 0; i--) {
        var b = state.bombs[i];
        b.timer -= dt;
        if (b.timer <= 0) explode(state, b);
      }

      /* 火焰衰减 */
      for (i = state.flames.length - 1; i >= 0; i--) {
        state.flames[i].ttl -= dt;
        if (state.flames[i].ttl <= 0) state.flames.splice(i, 1);
      }

      /* 胜负判定 */
      var alive = 0, last = null;
      for (id in state.players) {
        if (state.players[id].alive) { alive++; last = state.players[id]; }
      }
      if (alive <= 1 && !state.winnerId) {
        state.winnerId = last ? last.id : null;
        if (last) last.score += 5;
        state.overAt = state.time;
      }
      if (state.winnerId && state.time - state.overAt > 1.2) state.ended = true;
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
          score: p.score + (p.alive ? 2 : 0),
          kills: p.kills,
          alive: p.alive ? 1 : 0
        });
      }
      list.sort(function (a, b) {
        if (b.alive !== a.alive) return b.alive - a.alive;
        return b.kills - a.kills;
      });
      return list;
    },

    /* 人机：BFS 找最近的砖块/道具/敌人，会躲爆炸、会放完就跑 */
    bot: function (state, id, dt, level) {
      var p = state.players[id];
      if (!p || !p.alive) return null;
      if (p.moveT < 1) return null;

      var skill = BOT_SKILL[level] || 0.6;
      var ai = p.ai || (p.ai = { retreat: 0, wait: 0 });
      ai.retreat -= dt;
      ai.wait -= dt;

      var danger = blastRisk(state, p.cx, p.cy);

      /* 低难度反应慢：这一帧可能没意识到危险 */
      var react = 0.45 + skill * 0.55;
      var notice = Math.abs(Math.sin(state.time * 1.7 + id.length)) <= react;

      /* 1) 处于危险里：跑去风险最低的相邻格 */
      if ((danger && notice) || ai.retreat > 0) {
        var bestDir = null;
        var bestScore = -Infinity;
        for (var i = 0; i < DIRS.length; i++) {
          var nx = p.cx + DIRS[i][0];
          var ny = p.cy + DIRS[i][1];
          if (blocked(state, nx, ny, p)) continue;
          var hits = blastHits(state, nx, ny);
          var sc = -hits * 100;
          if (hits === 0) {
            for (var b = 0; b < state.bombs.length; b++) {
              sc += Math.abs(state.bombs[b].cx - nx) + Math.abs(state.bombs[b].cy - ny);
            }
          }
          sc += Math.random() * 0.3;
          if (sc > bestScore) { bestScore = sc; bestDir = DIRS[i]; }
        }
        if (bestDir) return { dx: bestDir[0], dy: bestDir[1] };
        return null;
      }

      /* 2) 旁边有砖块/敌人，且放完能跑：放炸弹 */
      if (p.bombCount < p.bombMax && !wouldTrap(state, p)) {
        var urge = hasBombTarget(state, p) ||
          (skill < 0.5 && Math.sin(state.time * 2.3 + id.length * 2) > 0.55);
        if (urge) {
          ai.retreat = 1.1;
          return { dx: 0, dy: 0, bomb: true };
        }
      }

      /* 3) 朝最近目标前进 */
      var step = bfsStep(state, p);
      if (step) return step;

      /* 4) 没目标就随便晃 */
      if (ai.wait <= 0) {
        ai.wait = 0.6 + Math.random() * 0.8;
        ai.dir = DIRS[Math.floor(Math.random() * 4)];
      }
      var d = ai.dir || DIRS[0];
      if (blocked(state, p.cx + d[0], p.cy + d[1], p)) {
        ai.dir = DIRS[Math.floor(Math.random() * 4)];
        d = ai.dir;
      }
      return { dx: d[0], dy: d[1] };
    },

    snapshot: function (state) {
      var ps = [];
      for (var id in state.players) {
        var p = state.players[id];
        ps.push({
          i: p.id, cx: p.cx, cy: p.cy,
          fx: p.fromX, fy: p.fromY,
          m: Math.round(p.moveT * 100) / 100,
          d: p.dir, al: p.alive ? 1 : 0,
          bm: p.bombMax, rg: p.range, s: p.score
        });
      }
      var bombs = state.bombs.map(function (b) {
        return [b.cx, b.cy, Math.round(b.timer * 100) / 100, b.range, b.owner];
      });
      var flames = state.flames.map(function (f) {
        return [f.cx, f.cy, Math.round(f.ttl * 100) / 100];
      });
      var pu = state.powerups.map(function (o) { return [o.cx, o.cy, o.type]; });
      var ev = state.events;
      state.events = [];
      var mapStr;
      if (state.mapDirty) { mapStr = state.map.join(''); state.mapDirty = false; }
      return {
        w: W, h: H,
        t: Math.round(state.time * 10) / 10,
        d: state.duration,
        p: ps, b: bombs, f: flames, u: pu, e: ev, m: mapStr
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
