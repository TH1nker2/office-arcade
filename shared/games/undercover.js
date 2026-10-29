/* ============================================================
 * 谁是卧底 · WHO IS SPY（服务端权威）
 * 平民与卧底拿到相近但不同的词，轮流描述后投票找出卧底。
 *
 * 规则：
 *   - 4-7 人 1 个卧底，8-10 人 2 个，11-12 人 3 个
 *   - 轮数按人数固定：4 人 2 轮；5-7 人 3 轮；8-11 人 4 轮；12 人 5 轮
 *   - 每轮所有存活玩家各描述一次，描述完立刻投票
 *   - 最高票出局；平票无人出局
 *   - 卧底全出局平民胜；卧底人数 >= 平民人数卧底胜
 *   - 到固定轮数上限卧底仍存活则卧底胜
 *   - 卧底不知道队友；身份/词只发给本人
 * ============================================================ */
(function (root) {
  'use strict';

  var AR = root.AR;
  var BRIEF_TIME = 5;
  var DESCRIBE_TIME = 30;
  var VOTE_TIME = 25;
  var REVEAL_TIME = 5;
  var TEXT_MAX = 40;

  var FALLBACK_PAIRS = [
    { a: '可乐', b: '雪碧' }, { a: '苹果', b: '梨' }, { a: '猫', b: '狗' },
    { a: '医生', b: '护士' }, { a: '电影院', b: '剧院' }, { a: '手机', b: '平板' },
    { a: '公交', b: '地铁' }, { a: '篮球', b: '排球' }, { a: '直播', b: '短视频' },
    { a: '咖啡', b: '奶茶' }, { a: '老虎', b: '狮子' }, { a: '铅笔', b: '钢笔' }
  ];

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s，。！？、,.!?~～·\-_]/g, '')
      .trim();
  }

  function undercoverCount(n) {
    if (n <= 7) return 1;
    if (n <= 10) return 2;
    return 3;
  }

  function maxRoundsFor(n) {
    if (n <= 4) return 2;
    if (n <= 7) return 3;
    if (n <= 11) return 4;
    return 5;
  }

  function playerName(state, id) {
    var p = state.players[id];
    return p ? p.name : '';
  }

  function aliveIds(state) {
    return state.order.filter(function (id) { return state.alive[id]; });
  }

  function currentId(state) {
    if (state.phase !== 'describe') return null;
    return state.turnOrder[state.turn] || null;
  }

  function startDescribe(state) {
    state.phase = 'describe';
    state.timeLeft = DESCRIBE_TIME;
    state.desc = [];
    state.votes = {};
    state.voted = {};
    state.lastOut = null;
    state.turnOrder = aliveIds(state);
    AR.shuffle(state.turnOrder, state.rnd);
    state.turn = 0;
    if (!state.turnOrder.length) {
      state.ended = true;
      state.winner = null;
      state.phase = 'over';
    }
  }

  function beginVote(state) {
    state.phase = 'vote';
    state.timeLeft = VOTE_TIME;
    state.votes = {};
    state.voted = {};
  }

  function recordDesc(state, id, text) {
    state.desc.push({ i: id, n: playerName(state, id), t: text });
  }

  function advanceDescribe(state) {
    state.turn++;
    if (state.turn >= state.turnOrder.length) {
      beginVote(state);
    } else {
      state.timeLeft = DESCRIBE_TIME;
    }
  }

  function checkWin(state) {
    var uc = 0;
    var civ = 0;
    state.order.forEach(function (id) {
      if (!state.alive[id]) return;
      if (state.roles[id] === 'undercover') uc++;
      else civ++;
    });
    if (uc === 0) state.winner = 'civilian';
    else if (uc >= civ) state.winner = 'undercover';
    else if (state.round >= state.maxRounds) state.winner = 'undercover';
    if (state.winner) {
      state.ended = true;
      state.phase = 'over';
      state.timeLeft = 0;
      state.events.push({ t: 'end', winner: state.winner });
      return true;
    }
    return false;
  }

  function resolveVote(state) {
    var tally = {};
    state.order.forEach(function (id) {
      if (!state.alive[id]) return;
      var target = state.votes[id];
      if (target && state.alive[target]) tally[target] = (tally[target] || 0) + 1;
    });
    var best = -1;
    var top = [];
    Object.keys(tally).forEach(function (id) {
      if (tally[id] > best) {
        best = tally[id];
        top = [id];
      } else if (tally[id] === best) {
        top.push(id);
      }
    });

    state.lastOut = {
      tie: top.length !== 1 || best <= 0,
      count: best > 0 ? best : 0,
      tally: Object.keys(tally).map(function (id) {
        return { id: id, name: playerName(state, id), count: tally[id] };
      })
    };

    if (state.lastOut.tie) {
      state.lastOut.id = null;
      state.lastOut.name = '';
      state.lastOut.role = '';
      state.events.push({ t: 'vote', tie: true, count: state.lastOut.count });
    } else {
      var id = top[0];
      var role = state.roles[id];
      state.alive[id] = false;
      state.lastOut.id = id;
      state.lastOut.name = playerName(state, id);
      state.lastOut.role = role;
      state.order.forEach(function (voter) {
        if (state.votes[voter] === id && state.roles[voter] === 'civilian') {
          state.correctVotes[voter] = (state.correctVotes[voter] || 0) + 1;
        }
      });
      state.out.push({ id: id, name: playerName(state, id), role: role });
      state.events.push({
        t: 'vote', id: id, name: state.lastOut.name, role: role,
        count: state.lastOut.count, tie: false
      });
    }

    state.phase = 'reveal';
    state.timeLeft = REVEAL_TIME;
  }

  function afterReveal(state) {
    if (checkWin(state)) return;
    state.round++;
    startDescribe(state);
  }

  AR.games.undercover = {
    id: 'undercover',
    rate: 10,

    /* 建立对局状态。players = [{id,name,color}] */
    create: function (players, opt) {
      var seed = (opt && opt.seed) || Date.now();
      var rnd = AR.rng(seed >>> 0);
      var pairs = (opt && opt.pairs && opt.pairs.length) ? opt.pairs : FALLBACK_PAIRS;
      var pair = pairs[Math.floor(rnd() * pairs.length) % pairs.length];
      var civilianFirst = rnd() < 0.5;
      var civWord = civilianFirst ? pair.a : pair.b;
      var ucWord = civilianFirst ? pair.b : pair.a;
      var maxRounds = maxRoundsFor(players.length);
      var order = players.map(function (p) { return p.id; });
      var seats = order.slice();
      AR.shuffle(seats, rnd);
      var ucCount = undercoverCount(order.length);
      var state = {
        time: 0,
        duration: 0,
        rnd: rnd,
        round: 1,
        maxRounds: maxRounds,
        order: order,
        players: {},
        alive: {},
        roles: {},
        words: {},
        correctVotes: {},
        desc: [],
        votes: {},
        voted: {},
        turnOrder: [],
        turn: 0,
        out: [],
        lastOut: null,
        phase: 'brief',
        timeLeft: BRIEF_TIME,
        winner: null,
        ended: false,
        events: [],
        pairCategory: pair.category || ''
      };
      players.forEach(function (p) { state.players[p.id] = { id: p.id, name: p.name, color: p.color }; });
      order.forEach(function (id) {
        state.alive[id] = true;
        state.correctVotes[id] = 0;
      });
      seats.forEach(function (id, idx) {
        var role = idx < ucCount ? 'undercover' : 'civilian';
        state.roles[id] = role;
        state.words[id] = role === 'undercover' ? ucWord : civWord;
      });
      return state;
    },

    /* 玩家中途退出：从存活和行动队列移除，并重新判定胜负 */
    removePlayer: function (state, id) {
      var i = state.order.indexOf(id);
      if (i < 0) return;
      state.order.splice(i, 1);
      delete state.players[id];
      delete state.alive[id];
      delete state.roles[id];
      delete state.words[id];
      delete state.correctVotes[id];
      delete state.votes[id];
      delete state.voted[id];

      var ti = state.turnOrder.indexOf(id);
      if (ti >= 0) {
        state.turnOrder.splice(ti, 1);
        if (ti < state.turn) state.turn--;
      }
      if (!state.order.length) {
        state.ended = true;
        state.phase = 'over';
        state.winner = null;
        return;
      }
      if (state.phase === 'describe') {
        if (state.turn >= state.turnOrder.length) beginVote(state);
        else state.timeLeft = DESCRIBE_TIME;
      } else if (state.phase === 'vote') {
        var votedCount = state.order.filter(function (oid) { return state.alive[oid] && state.voted[oid]; }).length;
        var aliveCount = aliveIds(state).length;
        if (aliveCount > 0 && votedCount >= aliveCount) resolveVote(state);
      }
      if (!state.ended) checkWin(state);
    },

    /* 玩家操作：描述 / 投票 */
    input: function (state, id, inp) {
      if (state.ended || !inp || !state.players[id] || !state.alive[id]) return;

      if (inp.act === 'describe') {
        if (state.phase !== 'describe' || currentId(state) !== id) return;
        var text = String(inp.text || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
        if (!text) return;
        var mine = state.words[id];
        if (mine && norm(text).indexOf(norm(mine)) >= 0) {
          state.events.push({ t: 'invalid', to: id, kind: 'word' });
          return;
        }
        recordDesc(state, id, text);
        advanceDescribe(state);
        return;
      }

      if (inp.act === 'vote') {
        if (state.phase !== 'vote' || state.voted[id]) return;
        var target = String(inp.target || '');
        if (!state.alive[target] || target === id) return;
        state.votes[id] = target;
        state.voted[id] = true;
        var alive = aliveIds(state).length;
        var done = state.order.filter(function (oid) {
          return state.alive[oid] && state.voted[oid];
        }).length;
        if (done >= alive) resolveVote(state);
      }
    },

    /* 推进一帧，dt 固定为 1/60 秒 */
    tick: function (state, dt) {
      state.time += dt;
      if (state.ended) return;
      state.timeLeft -= dt;
      if (state.timeLeft > 0) return;

      if (state.phase === 'brief') {
        startDescribe(state);
      } else if (state.phase === 'describe') {
        var id = currentId(state);
        if (id) recordDesc(state, id, '（时间到，未描述）');
        advanceDescribe(state);
      } else if (state.phase === 'vote') {
        resolveVote(state);
      } else if (state.phase === 'reveal') {
        afterReveal(state);
      }
    },

    isOver: function (state) { return state.ended; },

    /* 个人名次：获胜阵营 100 基础分，附加存活/正确票；服务器按分数排名 */
    results: function (state) {
      var list = state.order.map(function (id) {
        var p = state.players[id];
        var win = state.roles[id] === state.winner;
        var correct = state.correctVotes[id] || 0;
        var score = (win ? 100 : 0) + (state.alive[id] ? 10 : 0) + correct * 10;
        return {
          id: id,
          name: p ? p.name : '',
          score: score,
          kills: correct,
          role: state.roles[id],
          win: win,
          survived: state.alive[id] ? 1 : 0
        };
      });
      list.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return b.survived - a.survived;
      });
      return list;
    },

    /* 只发给本人的身份和词 */
    privateFor: function (state, id) {
      if (!state.players[id]) return null;
      return {
        t: 'undercover',
        role: state.roles[id],
        word: state.words[id],
        round: state.round,
        maxRounds: state.maxRounds
      };
    },

    /* 公开快照：不包含其他人的身份/词 */
    snapshot: function (state) {
      var ev = state.events;
      state.events = [];
      return {
        rd: state.round,
        mx: state.maxRounds,
        ph: state.phase,
        tl: Math.max(0, Math.ceil(state.timeLeft * 10) / 10),
        cur: currentId(state),
        alive: state.order.filter(function (id) { return state.alive[id]; }),
        voted: state.order.filter(function (id) { return state.voted[id]; }),
        desc: state.desc,
        out: state.out,
        lastOut: state.lastOut,
        win: state.winner,
        ended: !!state.ended,
        roles: state.ended ? state.roles : null,
        pl: state.order.map(function (id) {
          var p = state.players[id];
          return { i: id, n: p ? p.name : '', c: p ? p.color : '#22d3ee', al: state.alive[id] ? 1 : 0 };
        }),
        e: ev
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
