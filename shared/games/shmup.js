/* ============================================================
 * 合作弹幕 v2 · CO-OP SHMUP V2（服务端权威）
 * 1000 x 1000 战场，全队共享分数，全部战机被击毁即结束
 *
 * v2 变更：
 *   - 战机被击毁后不再复活；全员被击毁立即结束
 *   - 击毁敌机概率掉落增益光球（修护/护盾/连发/散射/净化）
 *   - 关底从三种 BOSS 中随机一种，每种有独立外形与弹幕
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var W = 1000, H = 1000;
  var DURATION = 120;
  var BOSS_AT = 70;

  var SHMUP_META = AR.GameConstants.SHMUP;
  var BUFF_DEFS = SHMUP_META.BUFFS;
  var BOSS_META = SHMUP_META.BOSSES;

  var BUFF_LIFE = 12;
  var BUFF_MAX = 6;
  var BUFF_VY = 120;
  var BUFF_RADIUS = 30;
  var BUFF_CHANCE = { grunt: 0.12, zig: 0.18, tank: 0.35 };

  /* 人机水平：影响躲弹半径与瞄准抖动 */
  var BOT_SKILL = { easy: 0.3, normal: 0.6, hard: 0.82, insane: 0.97 };

  var ENEMY_DEF = {
    grunt: { hp: 2, r: 18, speed: 95, score: 10, fire: 2.1, color: '#ff5d7d' },
    zig: { hp: 3, r: 17, speed: 120, score: 15, fire: 1.7, color: '#c084fc' },
    tank: { hp: 9, r: 28, speed: 55, score: 30, fire: 2.4, color: '#fb923c' }
  };

  function makePlayer(p, i) {
    return {
      id: p.id, name: p.name, color: p.color,
      x: 150 + (i % 4) * 180 + 40,
      y: 880,
      hp: 3, maxHp: 3,
      alive: true, inv: 1.5, cool: 0,
      shield: 0, rapidT: 0, spreadT: 0,
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

  function pickTarget(state) {
    var list = alivePlayers(state);
    return list.length ? list[Math.floor(state.rnd() * list.length)] : null;
  }

  function pushBullet(state, x, y, vx, vy) {
    state.ebullets.push({ x: x, y: y, vx: vx, vy: vy });
  }

  function aimedFan(state, boss, target, count, spread, speed) {
    if (!target) return;
    var base = Math.atan2(target.y - boss.y, target.x - boss.x);
    for (var i = 0; i < count; i++) {
      var a = base + (i - (count - 1) / 2) * spread;
      pushBullet(state, boss.x, boss.y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
  }

  /* ---------- 三种 BOSS：独立移动与弹幕 ---------- */
  var BOSS_DEFS = {
    fortress: {
      hp: 320, r: 70, score: 300, entryY: 190, entrySpeed: 70, baseInterval: 0.95,
      move: function (state, boss, dt, ease) {
        var tx = W / 2 + Math.sin(boss.t * 0.45) * (W / 2 - 170);
        /* 入场结束后的目标点可能离画面中央很远，平滑靠近，避免瞬移闪烁 */
        boss.x += (tx - boss.x) * Math.min(1, dt * 2.4) * ease;
      },
      fire: function (state, boss, mode) {
        var target = pickTarget(state);
        if (mode === 0) {
          aimedFan(state, boss, target, 3, 0.18, 260);
        } else if (mode === 1) {
          var spin = boss.t * 0.5;
          for (var k = 0; k < 12; k++) {
            var a = (k / 12) * AR.TAU + spin;
            pushBullet(state, boss.x, boss.y, Math.cos(a) * 200, Math.sin(a) * 200);
          }
        } else {
          for (var q = 0; q < 5; q++) {
            pushBullet(state, boss.x - 60 + q * 30, boss.y + 40, (q - 2) * 45, 260);
          }
        }
        if (mode !== 2) {
          /* 两侧炮塔补一轮下压弹 */
          pushBullet(state, boss.x - 78, boss.y + 18, -60, 230);
          pushBullet(state, boss.x + 78, boss.y + 18, 60, 230);
        }
      }
    },
    hive: {
      hp: 280, r: 66, score: 350, entryY: 175, entrySpeed: 60, baseInterval: 1.0,
      move: function (state, boss, dt, ease) {
        var tx = W / 2 + Math.sin(boss.t * 0.35) * (W / 2 - 190);
        var ty = 175 + Math.sin(boss.t * 0.8) * 16;
        var k = Math.min(1, dt * 2.2) * ease;
        boss.x += (tx - boss.x) * k;
        boss.y += (ty - boss.y) * k;
      },
      fire: function (state, boss, mode) {
        var target = pickTarget(state);
        if (mode === 0) {
          var spin = boss.t * 0.7;
          for (var k = 0; k < 16; k++) {
            var a = (k / 16) * AR.TAU + spin;
            pushBullet(state, boss.x, boss.y, Math.cos(a) * 190, Math.sin(a) * 190);
          }
        } else if (mode === 1) {
          if (state.enemies.length < 22) {
            enemy(state, 'grunt', boss.x - 70, boss.y + 20);
            enemy(state, 'grunt', boss.x + 70, boss.y + 20);
          }
          aimedFan(state, boss, target, 3, 0.2, 250);
        } else {
          aimedFan(state, boss, target, 5, 0.14, 285);
        }
      }
    },
    prism: {
      hp: 240, r: 58, score: 400, entryY: 165, entrySpeed: 85, baseInterval: 0.55,
      move: function (state, boss, dt, ease) {
        var tx = W / 2 + Math.sin(boss.t * 0.85) * (W / 2 - 160);
        var ty = 165 + Math.sin(boss.t * 1.3) * 24;
        var k = Math.min(1, dt * 3.0) * ease;
        boss.x += (tx - boss.x) * k;
        boss.y += (ty - boss.y) * k;
      },
      fire: function (state, boss, mode) {
        var target = pickTarget(state);
        if (mode === 0) {
          var base = boss.t * 2.6;
          for (var k = 0; k < 3; k++) {
            var a = base + k * AR.TAU / 3;
            pushBullet(state, boss.x, boss.y, Math.cos(a) * 210, Math.sin(a) * 210);
          }
        } else if (mode === 1) {
          aimedFan(state, boss, target, 5, 0.12, 330);
        } else {
          var off = boss.t * 0.3;
          for (var q = 0; q < 8; q++) {
            var a2 = off + q * AR.TAU / 8;
            pushBullet(state, boss.x, boss.y, Math.cos(a2) * 240, Math.sin(a2) * 240);
          }
        }
      }
    }
  };

  function bossDef(boss) {
    return BOSS_DEFS[boss.type] || BOSS_DEFS.fortress;
  }

  function spawnBoss(state) {
    var meta = BOSS_META[Math.floor(state.rnd() * BOSS_META.length) % BOSS_META.length];
    var def = BOSS_DEFS[meta.id] || BOSS_DEFS.fortress;
    state.boss = {
      type: meta.id,
      name: meta.name,
      color: meta.color,
      accent: meta.accent,
      x: W / 2, y: -120,
      hp: def.hp, maxHp: def.hp,
      r: def.r,
      t: 0,
      fireTimer: 1.2,
      phase: 0,
      moveT: 0,
      inv: true,
      flash: 0,
      score: def.score
    };
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

  function maybeDrop(state, e) {
    if (state.powerups.length >= BUFF_MAX) return;
    var chance = BUFF_CHANCE[e.type] || 0.12;
    if (state.rnd() > chance) return;
    var def = BUFF_DEFS[Math.floor(state.rnd() * BUFF_DEFS.length) % BUFF_DEFS.length];
    state.powerups.push({
      x: e.x, y: e.y,
      type: def.id,
      life: BUFF_LIFE,
      vy: BUFF_VY
    });
  }

  function applyBuff(state, p, buff) {
    if (buff.type === 'heal') p.hp = Math.min(p.maxHp, p.hp + 1);
    else if (buff.type === 'shield') p.shield = Math.min(2, p.shield + 1);
    else if (buff.type === 'rapid') p.rapidT = Math.max(p.rapidT, 8);
    else if (buff.type === 'spread') p.spreadT = Math.max(p.spreadT, 8);
    else if (buff.type === 'purge') {
      state.ebullets.length = 0;
      p.inv = Math.max(p.inv, 1.2);
    }
    state.events.push({
      t: 'buffget', kind: buff.type,
      x: Math.round(p.x), y: Math.round(p.y), c: p.color
    });
  }

  function updatePowerups(state, dt) {
    for (var i = state.powerups.length - 1; i >= 0; i--) {
      var u = state.powerups[i];
      u.life -= dt;
      u.y += u.vy * dt;
      if (u.life <= 0 || u.y > H + 40) {
        state.powerups.splice(i, 1);
        continue;
      }
      for (var id in state.players) {
        var p = state.players[id];
        if (!p.alive) continue;
        if (AR.dist2(p.x, p.y, u.x, u.y) < BUFF_RADIUS * BUFF_RADIUS) {
          applyBuff(state, p, u);
          state.powerups.splice(i, 1);
          break;
        }
      }
    }
  }

  function firePlayer(state, p, id) {
    var shots = p.spreadT > 0
      ? [[-14, -170], [0, 0], [14, 170]]
      : [[-9, 0], [9, 0]];
    for (var i = 0; i < shots.length; i++) {
      state.pbullets.push({
        x: p.x + shots[i][0],
        y: p.y - 22,
        vx: shots[i][1],
        vy: -980,
        owner: id,
        color: p.color
      });
    }
  }

  AR.games.shmup = {
    id: 'shmup',

    /* 建立对局状态。players 里带 bot 字段的是人机。返回的 state 之后会一直被 tick 修改。 */
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
        powerups: [],
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

    /* 玩家中途退出，把他从对局里摘掉，避免一直等他操作。 */
    removePlayer: function (state, id) {
      delete state.players[id];
    },

    /* 处理一次玩家操作。inp 的结构由 js/input.js 里对应分支决定。 */
    input: function (state, id, inp) {
      var p = state.players[id];
      if (p) p.input = inp || {};
    },

    /* 推进一帧，dt 固定为 1/60 秒。这里只能改 state，不要读时间/文件/网络。 */
    tick: function (state, dt) {
      state.time += dt;
      var id, i, p;

      if (!state.bossSpawned && state.time >= BOSS_AT) {
        state.bossSpawned = true;
        spawnBoss(state);
        state.events.push({ t: 'boss', kind: state.boss.type, name: state.boss.name });
      }

      /* 玩家 */
      for (id in state.players) {
        p = state.players[id];
        if (!p.alive) continue;
        var inp = p.input || {};
        var dx = Number(inp.dx) || 0;
        var dy = Number(inp.dy) || 0;
        var len = Math.hypot(dx, dy);
        if (len > 0.01) {
          dx /= len; dy /= len;
          p.x = AR.clamp(p.x + dx * 330 * dt, 40, W - 40);
          /* 允许飞到上半区，别在画面中段设空气墙 */
          p.y = AR.clamp(p.y + dy * 330 * dt, 80, H - 50);
        }
        p.inv = Math.max(0, p.inv - dt);
        p.rapidT = Math.max(0, p.rapidT - dt);
        p.spreadT = Math.max(0, p.spreadT - dt);
        p.cool -= dt;
        if (p.cool <= 0) {
          p.cool = 0.115 * (p.rapidT > 0 ? 0.55 : 1);
          firePlayer(state, p, id);
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

      /* BOSS */
      var boss = state.boss;
      if (boss) {
        boss.t += dt;
        boss.phase = Math.min(3, Math.floor(boss.t / 12));
        if (boss.flash > 0) boss.flash = Math.max(0, boss.flash - dt);
        var def = bossDef(boss);
        if (boss.y < def.entryY) {
          boss.y = Math.min(def.entryY, boss.y + def.entrySpeed * dt);
        } else {
          boss.moveT += dt;
          def.move(state, boss, dt, Math.min(1, boss.moveT / 1.2));
        }
        boss.fireTimer -= dt;
        if (boss.fireTimer <= 0 && boss.y >= def.entryY - 20) {
          boss.inv = false;
          def.fire(state, boss, Math.floor(boss.t / 6) % 3);
          boss.fireTimer = Math.max(0.4, def.baseInterval - boss.phase * 0.1);
        }
      }

      /* 玩家子弹 */
      for (i = state.pbullets.length - 1; i >= 0; i--) {
        var pb = state.pbullets[i];
        pb.x += pb.vx * dt;
        pb.y += pb.vy * dt;
        if (pb.y < -20 || pb.x < -20 || pb.x > W + 20) {
          state.pbullets.splice(i, 1);
          continue;
        }
        var hit = false;

        if (boss && boss.y > 0 && !boss.inv &&
          AR.dist2(pb.x, pb.y, boss.x, boss.y) < boss.r * boss.r) {
          boss.hp -= 1;
          boss.flash = 0.08;
          if (state.players[pb.owner]) state.players[pb.owner].score += 1;
          else state.score += 1;
          hit = true;
          if (boss.hp <= 0) {
            if (state.players[pb.owner]) state.players[pb.owner].score += boss.score;
            else state.score += boss.score;
            state.events.push({ t: 'bossdie', x: boss.x, y: boss.y, kind: boss.type });
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
                var shooter = state.players[pb.owner];
                if (shooter) {
                  shooter.score += en.score;
                  shooter.kills++;
                  state.events.push({
                    t: 'kill', by: shooter.id, name: shooter.name, color: shooter.color,
                    kind: en.type, x: en.x, y: en.y
                  });
                }
                maybeDrop(state, en);
                state.events.push({ t: 'explode', x: en.x, y: en.y, r: en.r });
                state.enemies.splice(j, 1);
              }
              hit = true;
              break;
            }
          }
        }
        if (hit) state.pbullets.splice(i, 1);
      }

      /* 增益光球：缓慢下落，碰到战机即拾取 */
      updatePowerups(state, dt);

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
            state.ebullets.splice(i, 1);
            state.events.push({ t: 'hurt', x: p.x, y: p.y });
            if (p.shield > 0) {
              p.shield--;
              p.inv = 0.5;
              state.events.push({ t: 'shield', x: p.x, y: p.y, c: p.color });
            } else {
              p.hp--;
              p.inv = 0.9;
              if (p.hp <= 0) {
                p.hp = 0;
                p.alive = false;
                p.shield = 0;
                p.rapidT = 0;
                p.spreadT = 0;
                state.events.push({ t: 'playerdead', x: p.x, y: p.y, c: p.color });
              }
            }
            break;
          }
        }
      }

      /* 清理越界对象 */
      if (state.ebullets.length > 260) state.ebullets.splice(0, state.ebullets.length - 260);
      if (state.pbullets.length > 80) state.pbullets.splice(0, state.pbullets.length - 80);
      if (state.enemies.length > 40) state.enemies.splice(0, state.enemies.length - 40);

      /* 全员被击毁：不再复活，立即结束 */
      var anyAlive = false;
      for (id in state.players) {
        if (state.players[id].alive) { anyAlive = true; break; }
      }
      if (!anyAlive) state.ended = true;
    },

    /* 服务端每帧问一次。返回 true 时这一局结束，会调 results() 结算。 */
    isOver: function (state) {
      return state.ended || state.time >= state.duration;
    },

    /* 结算：返回 [{id, name, score, ...}]，服务端按顺序写进战绩。 */
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
    /* 人机决策，返回一个 input 对象（或 null 表示这一帧什么都不做）。 */
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

      /* BOSS 出现后优先对 BOSS 站位，否则人机会一直清小怪不打关底 */
      var boss = state.boss;
      if (boss && boss.y > 0) {
        var bossX = boss.x + wobble * 0.25;
        var bossY = Math.min(H - 90, Math.max(620, boss.y + 300));
        ax += (bossX > p.x ? 1 : -1) * 0.9;
        ay += (bossY > p.y ? 1 : -1) * 0.35;
      } else if (best) {
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

    /* 发给所有客户端的状态，必须是纯 JSON（不能有函数/循环引用/NaN）。 */
    snapshot: function (state) {
      var ps = [];
      for (var id in state.players) {
        var p = state.players[id];
        ps.push({
          i: p.id, x: Math.round(p.x), y: Math.round(p.y),
          hp: p.hp, mh: p.maxHp, sh: p.shield,
          rt: p.rapidT > 0 ? 1 : 0, st: p.spreadT > 0 ? 1 : 0,
          al: p.alive ? 1 : 0,
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
      var pu = [];
      state.powerups.forEach(function (u) { pu.push([u.x | 0, u.y | 0, u.type]); });
      var ev = state.events;
      state.events = [];
      return {
        w: W, h: H,
        t: Math.round(state.time * 10) / 10,
        d: state.duration,
        sc: state.score,
        p: ps, e: en, pb: pb, eb: eb, u: pu,
        b: state.boss ? {
          x: state.boss.x | 0, y: state.boss.y | 0,
          hp: state.boss.hp, mx: state.boss.maxHp,
          r: state.boss.r,
          iv: state.boss.inv ? 1 : 0,
          f: state.boss.flash > 0 ? 1 : 0,
          k: state.boss.type,
          nm: state.boss.name,
          c: state.boss.color,
          ac: state.boss.accent
        } : null,
        ev: ev
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
