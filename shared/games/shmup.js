/* ============================================================
 * 合作弹幕 · CO-OP SHMUP（服务端权威）
 * 900 x 1200 竖屏战场，全队共享分数，全部阵亡即结束
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var W = 1000, H = 1000;
  var DURATION = 120;
  var BOSS_AT = 70;

  /* 人机水平：影响躲弹半径与瞄准抖动 */
  var BOT_SKILL = { easy: 0.3, normal: 0.6, hard: 0.82, insane: 0.97 };

  var ENEMY_DEF = {
    grunt: { hp: 2, r: 18, speed: 95, score: 10, fire: 2.1, color: '#ff5d7d' },
    zig: { hp: 3, r: 17, speed: 120, score: 15, fire: 1.7, color: '#c084fc' },
    tank: { hp: 9, r: 28, speed: 55, score: 30, fire: 2.4, color: '#fb923c' }
  };

  function makePlayer(p, i) {
    var n = 4;
    return {
      id: p.id, name: p.name, color: p.color,
      x: 150 + (i % 4) * 180 + 40,
      y: 880,
      hp: 3, maxHp: 3, lives: 3,
      alive: true, respawn: 0, cool: 0, inv: 1.5,
      kills: 0, score: 0,
      input: {}
    };
  }

  function enemy(state, type, x, y, extra) {
    var d = ENEMY_DEF[type];
    var e = {
      id: 'e' + (state.eid++),
      type: type,
      x: x, y: y,
      hp: d.hp, maxHp: d.hp,
      r: d.r,
      vx: 0, vy: d.speed,
      fireTimer: 0.8 + state.rnd() * 1.2,
      phase: state.rnd() * 6.28,
      t: 0,
      score: d.score
    };
    if (extra) for (var k in extra) e[k] = extra[k];
    state.enemies.push(e);
    return e;
  }

  function alivePlayers(state) {
    var list = [];
    for (var id in state.players) if (state.players[id].alive) list.push(state.players[id]);
    return list;
  }

  function enemyShoot(state, e, target) {
    if (!target) return;
    var a = Math.atan2(target.y - e.y, target.x - e.x);
    var speed = 245;
    if (e.type === 'tank') {
      for (var i = -1; i <= 1; i++) {
        state.ebullets.push({
          x: e.x, y: e.y,
          vx: Math.cos(a + i * 0.24) * speed,
          vy: Math.sin(a + i * 0.24) * speed
        });
      }
    } else {
      state.ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
    }
  }

  function spawnWave(state) {
    var rnd = state.rnd;
    var t = state.time;
    var kinds = ['grunt'];
    if (t > 18) kinds.push('zig');
    if (t > 40) kinds.push('tank');
    var type = kinds[Math.floor(rnd() * kinds.length)];
    var count = type === 'tank' ? 1 : (t > 30 ? 3 : 2);
    var baseX = 120 + rnd() * (W - 240);
    for (var i = 0; i < count; i++) {
      enemy(state, type, AR.clamp(baseX + (i - (count - 1) / 2) * 90, 60, W - 60), -40 - i * 50);
    }
    state.waveTimer = Math.max(0.75, 1.6 - t * 0.006);
  }

  function spawnBoss(state) {
    state.boss = {
      x: W / 2, y: -120,
      hp: 260, maxHp: 260,
      r: 70,
      t: 0,
      fireTimer: 1.2,
      phase: 0,
      score: 300
    };
  }

  AR.games.shmup = {
    id: 'shmup',

    create: function (players, opt) {
      var state = {
        w: W, h: H,
        time: 0,
        duration: (opt && opt.duration) || DURATION,
        rnd: AR.rng((opt && opt.seed) || Date.now()),
        players: {},
        enemies: [],
        pbullets: [],
        ebullets: [],
        boss: null,
        bossSpawned: false,
        waveTimer: 1.2,
        eid: 1,
        score: 0,
        events: [],
        ended: false
      };
      players.forEach(function (p, i) { state.players[p.id] = makePlayer(p, i); });
      return state;
    },

    removePlayer: function (state, id) {
      delete state.players[id];
    },

    input: function (state, id, inp) {
      var p = state.players[id];
      if (p) p.input = inp || {};
    },

    tick: function (state, dt) {
      state.time += dt;
      state.rnd = state.rnd || Math.random;
      var id, i, p;

      if (!state.bossSpawned && state.time >= BOSS_AT) {
        state.bossSpawned = true;
        spawnBoss(state);
        state.events.push({ t: 'boss' });
      }

      /* 玩家 */
      for (id in state.players) {
        p = state.players[id];
        if (!p.alive) {
          if (p.lives > 0) {
            p.respawn -= dt;
            if (p.respawn <= 0) {
              p.alive = true;
              p.hp = p.maxHp;
              p.inv = 1.8;
              p.x = AR.clamp(p.x, 60, W - 60);
              p.y = 880;
            }
          }
          continue;
        }
        var inp = p.input || {};
        var dx = Number(inp.dx) || 0;
        var dy = Number(inp.dy) || 0;
        var len = Math.hypot(dx, dy);
        if (len > 0.01) {
          dx /= len; dy /= len;
          p.x = AR.clamp(p.x + dx * 330 * dt, 40, W - 40);
          p.y = AR.clamp(p.y + dy * 330 * dt, 420, H - 50);
        }
        p.inv = Math.max(0, p.inv - dt);
        p.cool -= dt;
        if (inp.f && p.cool <= 0) {
          p.cool = 0.115;
          state.pbullets.push({ x: p.x - 9, y: p.y - 22, vx: 0, vy: -980, owner: id, color: p.color });
          state.pbullets.push({ x: p.x + 9, y: p.y - 22, vx: 0, vy: -980, owner: id, color: p.color });
        }
      }

      /* 敌人生成 */
      state.waveTimer -= dt;
      if (state.waveTimer <= 0 && state.time < BOSS_AT - 4) spawnWave(state);

      /* 敌人行为 */
      for (i = state.enemies.length - 1; i >= 0; i--) {
        var e = state.enemies[i];
        e.t += dt;
        if (e.type === 'zig') {
          e.x += Math.cos(e.t * 2.2 + e.phase) * 120 * dt;
          e.y += e.vy * dt;
        } else if (e.type === 'tank') {
          e.y += e.vy * dt;
          e.x += Math.sin(e.t * 0.8 + e.phase) * 40 * dt;
        } else {
          e.y += e.vy * dt;
        }
        e.x = AR.clamp(e.x, 30, W - 30);

        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && e.y > 0 && e.y < H - 260) {
          var list = alivePlayers(state);
          if (list.length) {
            enemyShoot(state, e, list[Math.floor(state.rnd() * list.length)]);
          }
          e.fireTimer = ENEMY_DEF[e.type].fire + state.rnd() * 0.6;
        }
        if (e.y > H + 60) state.enemies.splice(i, 1);
      }

      /* Boss */
      var boss = state.boss;
      if (boss) {
        boss.t += dt;
        boss.phase = Math.min(3, Math.floor(boss.t / 12));
        if (boss.y < 190) boss.y += 70 * dt;
        else boss.x = W / 2 + Math.sin(boss.t * 0.55) * (W / 2 - 120);
        boss.fireTimer -= dt;
        if (boss.fireTimer <= 0 && boss.y >= 180) {
          boss.fireTimer = Math.max(0.45, 1.1 - boss.phase * 0.2);
          var mode = Math.floor(boss.t / 6) % 3;
          if (mode === 0) {
            for (var k = 0; k < 12; k++) {
              var ang = (k / 12) * AR.TAU + boss.t;
              state.ebullets.push({ x: boss.x, y: boss.y, vx: Math.cos(ang) * 190, vy: Math.sin(ang) * 190 });
            }
          } else if (mode === 1) {
            var tgt = alivePlayers(state)[0];
            if (tgt) {
              for (var m = -2; m <= 2; m++) {
                var a2 = Math.atan2(tgt.y - boss.y, tgt.x - boss.x) + m * 0.16;
                state.ebullets.push({ x: boss.x, y: boss.y, vx: Math.cos(a2) * 300, vy: Math.sin(a2) * 300 });
              }
            }
          } else {
            for (var q = 0; q < 5; q++) {
              state.ebullets.push({
                x: boss.x - 50 + q * 25, y: boss.y + 40,
                vx: (q - 2) * 40, vy: 280
              });
            }
          }
        }
      }

      /* 玩家子弹 */
      for (i = state.pbullets.length - 1; i >= 0; i--) {
        var pb = state.pbullets[i];
        pb.x += pb.vx * dt;
        pb.y += pb.vy * dt;
        if (pb.y < -20) { state.pbullets.splice(i, 1); continue; }
        var hit = false;

        if (boss && boss.y > 0 && AR.dist2(pb.x, pb.y, boss.x, boss.y) < boss.r * boss.r) {
          boss.hp -= 1;
          boss.flash = 0.08;
          state.score += 1;
          hit = true;
          if (boss.hp <= 0) {
            state.score += boss.score;
            state.events.push({ t: 'bossdie', x: boss.x, y: boss.y });
            state.boss = null;
            state.ended = true;
            state.win = true;
          }
        }

        if (!hit) {
          for (var j = state.enemies.length - 1; j >= 0; j--) {
            var en = state.enemies[j];
            if (AR.dist2(pb.x, pb.y, en.x, en.y) < (en.r + 6) * (en.r + 6)) {
              en.hp -= 1;
              if (en.hp <= 0) {
                state.score += en.score;
                state.events.push({ t: 'explode', x: en.x, y: en.y, r: en.r });
                if (state.players[pb.owner]) state.players[pb.owner].kills++;
                state.enemies.splice(j, 1);
              }
              hit = true;
              break;
            }
          }
        }
        if (hit) state.pbullets.splice(i, 1);
      }

      /* 敌弹 */
      for (i = state.ebullets.length - 1; i >= 0; i--) {
        var eb = state.ebullets[i];
        eb.x += eb.vx * dt;
        eb.y += eb.vy * dt;
        if (eb.y > H + 40 || eb.y < -40 || eb.x < -40 || eb.x > W + 40) {
          state.ebullets.splice(i, 1);
          continue;
        }
        for (id in state.players) {
          p = state.players[id];
          if (!p.alive || p.inv > 0) continue;
          if (AR.dist2(eb.x, eb.y, p.x, p.y) < 17 * 17) {
            p.hp--;
            p.inv = 0.9;
            state.ebullets.splice(i, 1);
            state.events.push({ t: 'hurt', x: p.x, y: p.y });
            if (p.hp <= 0) {
              p.lives--;
              p.alive = false;
              p.respawn = 1.8;
              state.events.push({ t: 'playerdead', x: p.x, y: p.y, c: p.color });
            }
            break;
          }
        }
      }

      /* 清理越界子弹 */
      if (state.ebullets.length > 260) state.ebullets.splice(0, state.ebullets.length - 260);
      if (state.pbullets.length > 80) state.pbullets.splice(0, state.pbullets.length - 80);
      if (state.enemies.length > 40) state.enemies.splice(0, state.enemies.length - 40);

      /* 全员阵亡 */
      var anyLeft = false;
      for (id in state.players) {
        if (state.players[id].lives > 0 || state.players[id].alive) { anyLeft = true; break; }
      }
      if (!anyLeft) state.ended = true;
    },

    isOver: function (state) {
      return state.ended || state.time >= state.duration;
    },

    results: function (state) {
      var list = [];
      for (var id in state.players) {
        var p = state.players[id];
        list.push({ id: p.id, name: p.name, score: p.score + p.kills * 5, kills: p.kills });
      }
      list.sort(function (a, b) { return b.score - a.score; });
      return list;
    },

    /* 人机：每人守一条道，目标分散，别挤在一起 */
    bot: function (state, id, dt, level) {
      var p = state.players[id];
      if (!p || !p.alive) return { dx: 0, dy: 0, f: false };

      var skill = BOT_SKILL[level] || 0.6;

      /* 稳定顺序给每个 bot 编号，各占一条横向通道 */
      var ids = Object.keys(state.players).sort();
      var idx = ids.indexOf(id);
      if (idx < 0) idx = 0;
      var lane = W * (idx + 1) / (ids.length + 1);

      var hh = 0;
      for (var kk = 0; kk < id.length; kk++) hh = (hh * 31 + id.charCodeAt(kk)) | 0;
      var ai = p.ai || (p.ai = { wobble: (Math.abs(hh) % 628) / 100 });
      ai.wobble += dt * 1.6;
      var wobble = Math.sin(ai.wobble) * (1 - skill) * 70;

      var ax = 0;
      var ay = 0;
      var i;

      /* 躲子弹：按 0.2 秒后的位置算斥力 */
      var dodgeR = 90 + skill * 110;
      for (i = 0; i < state.ebullets.length; i++) {
        var b = state.ebullets[i];
        var bx = b.x + b.vx * 0.2;
        var by = b.y + b.vy * 0.2;
        var dx = p.x - bx;
        var dy = p.y - by;
        var d2 = dx * dx + dy * dy;
        if (d2 > dodgeR * dodgeR || d2 < 1) continue;
        var d = Math.sqrt(d2);
        var w = (1 - d / dodgeR) * 2.8;
        ax += (dx / d) * w;
        ay += (dy / d) * w * 0.6;
      }

      /* 选目标：偏向自己那条道，四个人不会追同一架 */
      var best = null;
      var bd = Infinity;
      for (i = 0; i < state.enemies.length; i++) {
        var e = state.enemies[i];
        if (e.y < 0 || e.hp <= 0) continue;
        var score = Math.abs(e.x - lane) * 1.4 + Math.abs(e.y - p.y) * 0.45 +
          (e.y < 140 ? 180 : 0);
        if (score < bd) { bd = score; best = e; }
      }

      if (best) {
        var wantX = best.x * 0.7 + (lane + wobble) * 0.3;
        var wantY = Math.min(H - 90, Math.max(560, best.y + 260));
        ax += (wantX > p.x ? 1 : -1) * 0.85;
        ay += (wantY > p.y ? 1 : -1) * 0.4;
      } else {
        ax += (lane + wobble > p.x ? 1 : -1) * 0.5;
        ay += (H - 120 > p.y ? 1 : -1) * 0.3;
      }

      /* 与队友互斥，避免叠在一列 */
      for (i = 0; i < ids.length; i++) {
        if (ids[i] === id) continue;
        var mate = state.players[ids[i]];
        if (!mate || !mate.alive) continue;
        var mdx = p.x - mate.x;
        var mdy = p.y - mate.y;
        var md2 = mdx * mdx + mdy * mdy;
        if (md2 > 0 && md2 < 140 * 140) {
          var md = Math.sqrt(md2);
          var mw = (1 - md / 140) * 2.2;
          ax += (mdx / md) * mw;
          ay += (mdy / md) * mw * 0.5;
        }
      }

      /* 别贴边 */
      if (p.x < 130) ax += 1.3;
      if (p.x > W - 130) ax -= 1.3;

      return {
        dx: Math.abs(ax) > 0.2 ? (ax > 0 ? 1 : -1) : 0,
        dy: Math.abs(ay) > 0.2 ? (ay > 0 ? 1 : -1) : 0,
        f: true
      };
    },

    snapshot: function (state) {
      var ps = [];
      for (var id in state.players) {
        var p = state.players[id];
        ps.push({
          i: p.id, x: Math.round(p.x), y: Math.round(p.y),
          hp: p.hp, lv: p.lives, al: p.alive ? 1 : 0,
          iv: p.inv > 0 ? 1 : 0, s: p.score + p.kills * 5
        });
      }
      var en = [];
      state.enemies.forEach(function (e) {
        en.push([e.x | 0, e.y | 0, e.type, Math.max(0, e.hp), e.maxHp]);
      });
      var pb = [];
      state.pbullets.forEach(function (b) { pb.push([b.x | 0, b.y | 0]); });
      var eb = [];
      state.ebullets.forEach(function (b) { eb.push([b.x | 0, b.y | 0]); });
      var ev = state.events;
      state.events = [];
      return {
        w: W, h: H,
        t: Math.round(state.time * 10) / 10,
        d: state.duration,
        sc: state.score,
        p: ps, e: en, pb: pb, eb: eb,
        b: state.boss ? {
          x: state.boss.x | 0, y: state.boss.y | 0,
          hp: state.boss.hp, mx: state.boss.maxHp,
          f: state.boss.flash > 0 ? 1 : 0
        } : null,
        ev: ev
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
