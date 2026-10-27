'use strict';
/* 房间、回合、邀请与人机 */
const crypto = require('crypto');
const { ROUND_OVER_MS, store } = require('./config');
const { WORDS } = require('./words');
const { presence, rooms, invites, lobbyChat } = require('./state');
const { broadcast, setPresence, scheduleLobby } = require('./presence');
const AR = globalThis.AR;

function pushChat(arr, line) {
  arr.push(line);
  if (arr.length > 50) arr.splice(0, arr.length - 50);
}

/* 人机 */
const BOT_NAMES = ['阿强', '小美', '老李', '大熊', '阿杰', '小柔', '铁柱', '阿珍'];
const BOT_LEVELS = { normal: '普通' };   /* 人机不再分难度，统一普通 */

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  } while (rooms.has(code) || invites.has(code));
  return code;
}

/* 结算里 detail 这一列在各游戏里的叫法 */
const DETAIL_LABEL = {
  snake: '击杀',
  tank: '击杀',
  bomber: '击杀',
  shmup: '击杀',
  ludo: '到家'
};

function roomJson(room) {
  const players = [];
  room.players.forEach((p) => {
    players.push({
      id: p.id,
      name: p.name,
      color: p.color,
      avatar: p.avatar,
      score: p.score,
      streak: p.streak,
      wins: p.wins,
      bot: p.bot || null,
      host: p.id === room.hostId
    });
  });
  return {
    t: 'room',
    code: room.code,
    gameId: room.gameId,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    max: AR.getInfo(room.gameId).max,
    min: AR.getInfo(room.gameId).min,
    bots: room.botCount || 0,
    level: room.level || 'normal',
    planes: room.planes || 1,
    players: players
  };
}

/* ---------- 人机 ---------- */
function addBot(room, level) {
  if (!room) return { ok: false, msg: '你不在房间里' };
  if (room.phase !== 'lobby') return { ok: false, msg: '开局后不能加人机' };
  if (room.gameId === 'draw') return { ok: false, msg: '你画我猜不支持人机' };

  const info = AR.getInfo(room.gameId);
  if (room.players.size >= info.max) return { ok: false, msg: '房间已经满了' };

  room.botSeq = (room.botSeq || 0) + 1;

  const lv = 'normal';   /* 固定普通难度，忽略客户端传值 */
  const idx = room.botSeq - 1;
  const id = 'bot' + room.botSeq;

  room.players.set(id, {
    id: id,
    name: '电脑·' + BOT_NAMES[idx % BOT_NAMES.length],
    color: freeColor(room),
    avatar: '🤖',
    score: 0,
    streak: 0,
    wins: 0,
    bot: lv,
    inp: {},
    lastInput: 0
  });
  room.botCount = (room.botCount || 0) + 1;

  broadcastRoom(room);
  return { ok: true, msg: '已加入 ' + BOT_LEVELS[lv] + ' 人机' };
}

function removeBot(room, id) {
  if (!room) return { ok: false, msg: '你不在房间里' };
  if (room.phase !== 'lobby') return { ok: false, msg: '开局后不能移除人机' };
  const p = room.players.get(String(id));
  if (!p || !p.bot) return { ok: false, msg: '没有这个人机' };

  room.players.delete(String(id));
  room.botCount = Math.max(0, (room.botCount || 0) - 1);
  if (room.game && AR.games[room.gameId] && AR.games[room.gameId].removePlayer) {
    AR.games[room.gameId].removePlayer(room.game, String(id));
  }
  broadcastRoom(room);
  return { ok: true, msg: '人机已移除' };
}

function broadcastRoom(room) {
  broadcast(room, roomJson(room));
}

function userInRoom(userId) {
  for (const room of rooms.values()) {
    if (room.players.has(userId)) return room;
  }
  return null;
}

function createRoom(conn, gameId) {
  if (userInRoom(conn.user.id)) return null;
  const info = AR.getInfo(gameId);
  if (!AR.games[gameId]) return null;

  const room = {
    code: makeCode(),
    gameId: gameId,
    hostId: conn.user.id,
    players: new Map(),
    phase: 'lobby',
    round: 0,
    game: null,
    level: 'normal',
    planes: 1,
    chat: [],
    startedAt: 0,
    acc: 0,
    netAcc: 0,
    overTimer: null
  };
  rooms.set(room.code, room);
  joinRoom(conn, room);
  return room;
}

/* 给房间里的新玩家挑一个还没被占用的颜色 */
function freeColor(room) {
  const used = new Set();
  room.players.forEach((p) => used.add(String(p.color || '').toLowerCase()));
  for (let i = 0; i < AR.PLAYER_COLORS.length; i++) {
    if (!used.has(AR.PLAYER_COLORS[i].toLowerCase())) return AR.PLAYER_COLORS[i];
  }
  return AR.PLAYER_COLORS[room.players.size % AR.PLAYER_COLORS.length];
}

function joinRoom(conn, room) {
  if (room.players.has(conn.user.id)) return;
  const u = conn.user;
  const dbUser = store.userById(u.id);
  room.players.set(u.id, {
    id: u.id,
    name: u.nickname,
    color: freeColor(room),
    avatar: u.avatar,
    score: dbUser ? dbUser.points : 0,
    streak: dbUser ? dbUser.streak : 0,
    wins: dbUser ? dbUser.wins : 0,
    inp: {},
    lastInput: 0
  });
  conn.room = room;
  setPresence(u.id, { roomCode: room.code, gameId: room.gameId, conn: conn });
  broadcastRoom(room);
  conn.send({ t: 'chatHistory', ch: 'room', list: room.chat || [] });
}

function leaveRoom(conn) {
  const room = conn.room;
  if (!room) return;
  conn.room = null;

  const userId = conn.user.id;
  room.players.delete(userId);

  if (room.phase === 'playing' && room.game) {
    const g = AR.games[room.gameId];
    if (g && g.removePlayer) g.removePlayer(room.game, userId);
  }

  if (presence.get(userId)) {
    setPresence(userId, { roomCode: null, gameId: null });
  }

  /* 一个真人都没有了：不管在等待还是游戏中，房间直接销毁。
     注意判断的是"真人"——房间里可能还留着几个电脑，那些不算数。 */
  if (realPlayers(room) === 0) {
    if (room.overTimer) clearTimeout(room.overTimer);
    rooms.delete(room.code);
    return;
  }

  /* 房主退出：移交给下一位真人（不会交给电脑） */
  if (room.hostId === userId) {
    let nextId = null;
    room.players.forEach((p) => {
      if (!nextId && !p.bot) nextId = p.id;
    });
    if (nextId) room.hostId = nextId;
  }

  broadcastRoom(room);
  if (room.phase === 'playing' && room.game) {
    const g = AR.games[room.gameId];
    if (g && g.isOver(room.game)) finishRound(room);
  }
}

function realPlayers(room) {
  let n = 0;
  room.players.forEach((p) => { if (!p.bot) n++; });
  return n;
}

/* ============================================================
 * 回合
 * ============================================================ */
function startRound(room) {
  if (!room || room.phase !== 'lobby') return;
  const info = AR.getInfo(room.gameId);
  const g = AR.games[room.gameId];
  if (!g) return;
  if (room.players.size < info.min) {
    broadcast(room, { t: 'error', msg: '人数不足：' + info.name + ' 至少需要 ' + info.min + ' 人' });
    return;
  }

  const players = [];
  room.players.forEach((p) => {
    players.push({ id: p.id, name: p.name, color: p.color });
  });

  room.round++;
  room.phase = 'playing';
  room.acc = 0;
  room.netAcc = 0;
  room.startedAt = Date.now();
  const level = room.level || 'normal';
  const pool = (WORDS[level] && WORDS[level].length) ? WORDS[level] : WORDS.normal;
  room.game = g.create(players, {
    seed: (Date.now() ^ (room.round * 2654435761)) >>> 0,
    level: level,
    planes: room.planes || 1,
    words: pool
  });

  const meta = (g.meta && g.meta(room.game)) || null;
  broadcast(room, {
    t: 'game',
    id: room.gameId,
    round: room.round,
    players: players,
    meta: meta,
    duration: info.time
  });
  broadcast(room, { t: 'state', s: g.snapshot(room.game) });
  broadcastRoom(room);
  scheduleLobby();
  console.log('[game] ' + room.code + ' ' + room.gameId + ' 第 ' + room.round + ' 局，' + players.length + ' 人');
}

function finishRound(room) {
  const g = AR.games[room.gameId];
  if (!g || !room.game) return;

  const raw = g.results(room.game);
  const list = [];
  const matchPlayers = [];

  raw.forEach((r, i) => {
    const place = i + 1;
    const p = room.players.get(r.id);
    const isBot = !!(p && p.bot);
    const delta = place === 1 ? 5 : (place === 2 ? 3 : (place === 3 ? 1 : 0));
    if (p) {
      p.score += delta;
      p.wins += place === 1 ? 1 : 0;
      p.streak = place === 1 ? p.streak + 1 : 0;
    }
    /* 人机不写战绩库 */
    if (!isBot) {
      matchPlayers.push({ userId: r.id, place: place, score: r.score, delta: delta, detail: r.kills || 0 });
    }
    list.push({
      id: r.id,
      name: r.name,
      score: r.score,
      detail: r.kills || 0,
      detailLabel: DETAIL_LABEL[room.gameId] || '',
      place: place,
      delta: delta,
      total: 0,
      streak: 0,
      bot: isBot
    });
  });

  try {
    store.matchAdd({
      game: room.gameId,
      roomCode: room.code,
      startedAt: room.startedAt,
      endedAt: Date.now(),
      players: matchPlayers
    });
  } catch (e) {
    console.error('[match] 写入失败：', e.message);
  }

  /* 用数据库里的最新总分回填（人机用本局分） */
  list.forEach((r) => {
    if (r.bot) {
      const rec = room.players.get(r.id);
      r.total = rec ? rec.score : 0;
      r.streak = rec ? rec.streak : 0;
      return;
    }
    const u = store.userById(r.id);
    if (u) {
      r.total = u.points;
      r.streak = u.streak;
    }
  });

  room.phase = 'over';
  room.game = null;
  if (room.overTimer) clearTimeout(room.overTimer);
  room.overTimer = setTimeout(() => {
    room.overTimer = null;
    if (room.phase === 'over') {
      room.phase = 'lobby';
      broadcastRoom(room);
    }
  }, ROUND_OVER_MS);

  broadcast(room, {
    t: 'over',
    gameId: room.gameId,
    results: list,
    players: roomJson(room).players
  });
  broadcastRoom(room);
  scheduleLobby();
  console.log('[over] ' + room.code + ' ' + room.gameId + ' 冠军 ' + (list[0] && list[0].name));
}

/* 强制下线（管理员用） */
function kickUser(userId, reason) {
  const p = presence.get(userId);
  if (!p || !p.conn) return false;
  try {
    p.conn.send({ t: 'kicked', msg: reason || '你已被管理员请离游戏厅' });
  } catch (e) { /* ignore */ }
  p.conn.close();
  return true;
}

/* ============================================================
 * 邀请
 * ============================================================ */
function inviteUser(conn, toId) {
  const room = conn.room;
  if (!room) return { ok: false, msg: '你不在房间里' };
  const target = store.userById(Number(toId));
  if (!target) return { ok: false, msg: '找不到这个玩家' };
  if (room.players.has(target.id)) return { ok: false, msg: 'TA 已经在房间里了' };

  const pr = presence.get(target.id);
  if (!pr || !pr.conn) return { ok: false, msg: 'TA 不在线' };
  if (userInRoom(target.id)) return { ok: false, msg: 'TA 正在别的房间里' };
  if (room.players.size >= AR.getInfo(room.gameId).max) return { ok: false, msg: '房间已满' };

  const id = crypto.randomBytes(6).toString('hex');
  invites.set(id, { id: id, fromId: conn.user.id, toId: target.id, roomCode: room.code, at: Date.now() });

  pr.conn.send({
    t: 'invite',
    inviteId: id,
    from: { id: conn.user.id, nickname: conn.user.nickname, color: conn.user.color, avatar: conn.user.avatar },
    gameId: room.gameId,
    gameName: AR.getInfo(room.gameId).name,
    roomCode: room.code
  });

  setTimeout(() => { invites.delete(id); }, 60000);
  return { ok: true, msg: '已邀请 ' + target.nickname };
}

function replyInvite(conn, inviteId, accept) {
  const inv = invites.get(String(inviteId || ''));
  if (!inv || inv.toId !== conn.user.id) return;
  invites.delete(inviteId);

  if (!accept) {
    const fromConn = presence.get(inv.fromId);
    if (fromConn && fromConn.conn) {
      fromConn.conn.send({ t: 'inviteResult', ok: false, name: conn.user.nickname });
    }
    return;
  }

  const room = rooms.get(inv.roomCode);
  if (!room) { conn.send({ t: 'error', msg: '房间已经不存在了' }); return; }
  if (room.players.size >= AR.getInfo(room.gameId).max) { conn.send({ t: 'error', msg: '房间已满' }); return; }
  if (userInRoom(conn.user.id)) { conn.send({ t: 'error', msg: '你先离开当前房间' }); return; }
  if (room.phase !== 'lobby') { conn.send({ t: 'error', msg: '这局已经开始了' }); return; }

  joinRoom(conn, room);
  const fromConn = presence.get(inv.fromId);
  if (fromConn && fromConn.conn) {
    fromConn.conn.send({ t: 'inviteResult', ok: true, name: conn.user.nickname });
  }
}

module.exports = {
  rooms, invites, lobbyChat, pushChat, makeCode, roomJson, addBot, removeBot,
  broadcastRoom, userInRoom, createRoom, joinRoom, leaveRoom, realPlayers,
  startRound, finishRound, kickUser, inviteUser, replyInvite
};
