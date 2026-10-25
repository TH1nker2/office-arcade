#!/usr/bin/env node
/* ============================================================
 * 摸鱼游戏厅 · OFFICE ARCADE — 局域网服务器 v2
 *   账号 / 会话 / 个人资料 / 大厅在线状态 / 房间与邀请 / 六款游戏
 *   HTTP REST + 原生 WebSocket + SQLite(node:sqlite)
 * 运行： node server.js [端口]
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const cp = require('child_process');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || process.argv[2] || '8090', 10);
const HOST = process.env.HOST || '0.0.0.0';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 256 * 1024;
const MAX_ROOM = 10;
const ROUND_OVER_MS = 8000;
const SESSION_DAYS = 7;
const COOKIE = 'sid';

/* ---------- 游戏逻辑（与浏览器共用） ---------- */
require('./shared/core.js');
require('./shared/registry.js');
require('./shared/games/snake.js');
require('./shared/games/tank.js');
require('./shared/games/bomber.js');
require('./shared/games/tetris.js');
require('./shared/games/shmup.js');
require('./shared/games/draw.js');
require('./shared/games/racing.js');
require('./shared/games/ludo.js');
require('./shared/games/gomoku.js');
const AR = globalThis.AR;

/* ---------- 管理员账号（admins.json，明文，改完重启生效） ---------- */
const ADMINS_FILE = path.join(ROOT, 'admins.json');

function loadAdmins() {
  try {
    const raw = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw && raw.admins) || [];
    return list
      .filter((a) => a && a.username && a.password)
      .map((a) => ({
        username: String(a.username),
        password: String(a.password),
        name: String(a.name || a.username)
      }));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[admin] 读取 admins.json 失败（' + e.message + '）');
    return [];
  }
}

const ADMINS = loadAdmins();
let handleAdmin = null;              /* 延迟装配（依赖 rooms / leaveRoom 等，见文件下方） */
const adminSessions = new Map();     /* token -> { username, name, expires } */
const ADMIN_TTL = 8 * 3600 * 1000;

function adminFrom(req) {
  const token = parseCookies(req.headers.cookie)['asid'];
  if (!token) return null;
  const s = adminSessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { adminSessions.delete(token); return null; }
  return s;
}

/* ---------- 版本信息（version.json，用 tools/bump-version.js 打版本） ---------- */
const VERSION_FILE = path.join(ROOT, 'version.json');

function loadVersion() {
  try {
    const raw = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    return {
      version: String(raw.version || '0.0.0'),
      released: String(raw.released || ''),
      notes: Array.isArray(raw.notes) ? raw.notes.map(String) : [],
      history: Array.isArray(raw.history) ? raw.history : []
    };
  } catch (e) {
    console.warn('[version] 读取 version.json 失败（' + e.message + '）');
    return { version: '0.0.0', released: '', notes: [], history: [] };
  }
}

const VERSION = loadVersion();
const VERSION_TAG = 'v' + VERSION.version;

/* ---------- 你画我猜词库（可直接编辑 shared/words.json） ---------- */
const WORDS_FILE = path.join(ROOT, 'shared', 'words.json');

function loadWords() {
  const empty = { easy: [], normal: [], hard: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf8'));

    /* 新格式：{ levels: { easy: { words: [{w,h}] }, ... } } */
    if (raw && raw.levels) {
      const out = { easy: [], normal: [], hard: [] };
      ['easy', 'normal', 'hard'].forEach(function (lv) {
        const sec = raw.levels[lv];
        if (!sec || !Array.isArray(sec.words)) return;
        sec.words.forEach(function (it) {
          if (typeof it === 'string' && it.trim()) {
            out[lv].push({ w: it.trim(), h: [] });
          } else if (it && it.w) {
            out[lv].push({
              w: String(it.w).trim(),
              h: Array.isArray(it.h) ? it.h.slice(0, 3).map(String) : []
            });
          }
        });
        console.log('[words] ' + lv + ': ' + out[lv].length + ' 个');
      });
      if (!out.easy.length && !out.normal.length && !out.hard.length) return empty;
      return out;
    }

    /* 老格式：{ words: [...] } 或纯数组 -> 全部算中等 */
    const list = Array.isArray(raw) ? raw : (raw && raw.words) || [];
    const out = [];
    const seen = new Set();
    list.forEach((w) => {
      const t = String(w == null ? '' : w).trim();
      if (!t || t.length > 16 || seen.has(t)) return;
      seen.add(t);
      out.push(t);
    });
    return out;
    return { easy: out.slice(), normal: out.slice(), hard: out.slice() };
  } catch (e) {
    console.warn('[words] 读取 shared/words.json 失败（' + e.message + '），改用内置词库');
    return empty;
  }
}

const WORDS = loadWords();

/* 判定答案时的归一化：忽略大小写、空格和标点（与 shared/games/draw.js 的 norm 一致） */
function normAnswer(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?~～·\-_]/g, '')
    .trim();
}

/* ---------- 数据层 ---------- */
/* 数据目录：始终放在程序目录的 data\ 下（便携版）。
 * 需要临时换位置时用 ARCADE_DATA 环境变量（测试用）。 */
function resolveDataDir() {
  if (process.env.ARCADE_DATA) return process.env.ARCADE_DATA;
  return path.join(ROOT, 'data');
}

const DATA_DIR = resolveDataDir();

const store = require('./shared/store').open(path.join(DATA_DIR, 'arcade'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

/* ============================================================
 * 小工具
 * ============================================================ */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  }, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(body);
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 64 * 1024)) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

/* ============================================================
 * 密码与会话
 * ============================================================ */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash: hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.scryptSync(String(password), salt, 64);
    const target = Buffer.from(hash, 'hex');
    return h.length === target.length && crypto.timingSafeEqual(h, target);
  } catch (e) {
    return false;
  }
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function sessionCookie(token, maxAge) {
  return COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (maxAge || SESSION_DAYS * 86400);
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const s = store.sessionGet(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    store.sessionDelete(token);
    return null;
  }
  return store.userById(s.userId);
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    color: u.color,
    avatar: u.avatar,
    bio: u.bio,
    points: u.points,
    wins: u.wins,
    rounds: u.rounds,
    streak: u.streak,
    bestStreak: u.bestStreak,
    banned: u.banned ? 1 : 0,
    createdAt: u.createdAt
  };
}

/* ============================================================
 * 在线状态
 * ============================================================ */
const presence = new Map();   /* userId -> { conn, roomCode, gameId, since } */
const conns = new Set();

function setPresence(userId, patch) {
  const cur = presence.get(userId) || { conn: null, roomCode: null, gameId: null, since: Date.now() };
  Object.assign(cur, patch);
  presence.set(userId, cur);
  scheduleLobby();
}

function clearPresence(userId) {
  presence.delete(userId);
  scheduleLobby();
}

let lobbyTimer = null;
function scheduleLobby() {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    broadcastLobby();
  }, 80);
}

function lobbyUsers() {
  const list = store.listUsers().map((u) => {
    const p = presence.get(u.id);
    const room = p && p.roomCode ? rooms.get(p.roomCode) : null;
    let status = 'offline';
    if (p) {
      if (!room) status = 'online';
      else status = room.phase === 'lobby' ? 'waiting' : 'playing';
    }
    const info = p && p.gameId ? AR.getInfo(p.gameId) : null;
    return Object.assign(publicUser(u), {
      status: status,
      gameId: p ? p.gameId : null,
      gameName: info ? info.name : null,
      roomCode: room ? room.code : null,
      roomCount: room ? room.players.size : 0,
      roomMax: room ? AR.getInfo(room.gameId).max : 0
    });
  });

  const rank = { online: 0, waiting: 1, playing: 2, offline: 3 };
  list.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return b.points - a.points;
  });
  return list;
}

function broadcastLobby() {
  const payload = JSON.stringify({ t: 'lobby', users: lobbyUsers() });
  conns.forEach((c) => c.sendRaw(payload));
}

/* ============================================================
 * WebSocket
 * ============================================================ */
let idSeq = 0;

class Conn {
  constructor(socket, user) {
    this.socket = socket;
    this.id = 'c' + (++idSeq).toString(36);
    this.user = user;
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.frag = [];
    this.room = null;
    this.lastSeen = Date.now();

    socket.setNoDelay(true);
    socket.on('data', (chunk) => {
      if (this.closed) return;
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      if (this.buf.length > MAX_MESSAGE * 2) { this.terminate(); return; }
      this.parse();
    });
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }

  parse() {
    while (true) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) { this.terminate(); return; }
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (len > MAX_MESSAGE) { this.terminate(); return; }
      let mask = null;
      if (masked) {
        if (b.length < off + 4) return;
        mask = b.subarray(off, off + 4);
        off += 4;
      }
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (masked) {
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      } else {
        payload = Buffer.from(payload);
      }
      this.buf = b.subarray(off + len);
      this.frame(fin, op, payload);
    }
  }

  frame(fin, op, payload) {
    this.lastSeen = Date.now();
    if (op === 0x8) { this.close(); return; }
    if (op === 0x9) { this.sendFrame(0xA, payload); return; }
    if (op === 0xA) return;
    if (op === 0x1 || op === 0x2) {
      if (fin) this.message(payload);
      else this.frag = [payload];
      return;
    }
    if (op === 0x0) {
      if (!this.frag.length) return;
      this.frag.push(payload);
      let total = 0;
      for (const f of this.frag) total += f.length;
      if (total > MAX_MESSAGE) { this.terminate(); return; }
      if (fin) {
        const all = Buffer.concat(this.frag);
        this.frag = [];
        this.message(all);
      }
    }
  }

  message(payload) {
    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      handle(this, msg);
    } catch (e) {
      console.error('[msg]', msg.t, e && e.stack || e);
    }
  }

  sendFrame(op, data) {
    if (this.closed) return;
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[0] = 0x80 | op;
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    try {
      this.socket.write(Buffer.concat([header, data]));
    } catch (e) {
      this.onClose();
    }
  }

  sendRaw(text) {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  send(obj) {
    let text;
    try { text = JSON.stringify(obj); } catch (e) { return; }
    this.sendRaw(text);
  }

  close() {
    if (this.closed) return;
    this.sendFrame(0x8, Buffer.from([0x03, 0xe8]));
    try { this.socket.end(); } catch (e) { /* ignore */ }
    this.onClose();
  }

  terminate() {
    try { this.socket.destroy(); } catch (e) { /* ignore */ }
    this.onClose();
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    conns.delete(this);
    leaveRoom(this);
    if (presence.get(this.user.id) && presence.get(this.user.id).conn === this) {
      clearPresence(this.user.id);
    }
  }
}

/* ============================================================
 * 房间
 * ============================================================ */
const rooms = new Map();
const invites = new Map();

/* 大厅聊天：只保留最近 50 条，不做持久化 */
const lobbyChat = [];

function pushChat(arr, line) {
  arr.push(line);
  if (arr.length > 50) arr.splice(0, arr.length - 50);
}

function broadcastAll(obj) {
  const text = JSON.stringify(obj);
  conns.forEach((c) => c.sendRaw(text));
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

function broadcast(room, obj, except) {
  const text = JSON.stringify(obj);
  room.players.forEach((p) => {
    const pr = presence.get(p.id);
    if (!pr || !pr.conn || pr.conn === except) return;
    pr.conn.sendRaw(text);
  });
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

  /* 一个真人都没有了：不管在等待还是游戏中，房间直接销毁 */
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

/* ============================================================
 * WS 消息
 * ============================================================ */
function handle(conn, msg) {
  const u = conn.user;

  switch (msg.t) {
    case 'ping':
      conn.send({ t: 'pong' });
      break;

    case 'createRoom': {
      if (userInRoom(u.id)) { conn.send({ t: 'error', msg: '你已经在房间里了' }); return; }
      const room = createRoom(conn, String(msg.gameId || ''));
      if (!room) { conn.send({ t: 'error', msg: '无法创建房间' }); return; }
      break;
    }

    case 'joinRoom': {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { conn.send({ t: 'error', msg: '房间不存在，请核对房间码' }); return; }
      if (userInRoom(u.id)) { conn.send({ t: 'error', msg: '请先离开当前房间' }); return; }
      if (room.players.size >= AR.getInfo(room.gameId).max) { conn.send({ t: 'error', msg: '房间已满' }); return; }
      if (room.phase !== 'lobby') { conn.send({ t: 'error', msg: '这局已经开始了，等下一局吧' }); return; }
      joinRoom(conn, room);
      break;
    }

    case 'leaveRoom': {
      leaveRoom(conn);
      conn.send({ t: 'leftRoom' });
      break;
    }

    case 'start': {
      const room = conn.room;
      if (!room) return;
      if (room.hostId !== u.id) { conn.send({ t: 'error', msg: '只有房主能开始' }); return; }
      if (room.phase === 'playing') return;
      startRound(room);
      break;
    }

    case 'setting': {
      /* 房主在房间里改游戏设置（目前只有你画我猜的难度） */
      const room = conn.room;
      if (!room) return;
      if (room.phase !== 'lobby') { conn.send({ t: 'error', msg: '开局后不能改设置' }); return; }
      if (room.hostId !== conn.user.id) { conn.send({ t: 'error', msg: '只有房主能改设置' }); return; }
      if (msg.key === 'planes' && room.gameId === 'ludo') {
        var pn = parseInt(msg.value, 10);
        if (!(pn >= 1 && pn <= 4)) return;
        room.planes = pn;
        broadcastRoom(room);
        break;
      }
      if (msg.key === 'level' && room.gameId === 'draw') {
        const lv = String(msg.value || '');
        if (['easy', 'normal', 'hard'].indexOf(lv) < 0) return;
        room.level = lv;
        broadcastRoom(room);
      }
      break;
    }

    case 'botAdd': {
      const room = conn.room;
      if (!room) return;
      if (room.hostId !== u.id) { conn.send({ t: 'error', msg: '只有房主能加人机' }); return; }
      const r = addBot(room, String(msg.level || 'normal'));
      if (!r.ok) conn.send({ t: 'error', msg: r.msg });
      break;
    }

    case 'botRemove': {
      const room = conn.room;
      if (!room) return;
      if (room.hostId !== u.id) { conn.send({ t: 'error', msg: '只有房主能移除人机' }); return; }
      const r = removeBot(room, msg.id);
      if (!r.ok) conn.send({ t: 'error', msg: r.msg });
      break;
    }

    case 'invite': {
      const r = inviteUser(conn, msg.toId);
      conn.send({ t: 'inviteSent', ok: r.ok, msg: r.msg });
      break;
    }

    case 'inviteReply': {
      replyInvite(conn, msg.inviteId, !!msg.accept);
      break;
    }

    case 'input': {
      const room = conn.room;
      if (!room || room.phase !== 'playing' || !room.game) return;
      const g = AR.games[room.gameId];
      if (!g) return;
      const p = room.players.get(u.id);
      if (!p) return;
      p.inp = msg.i || {};
      p.lastInput = Date.now();
      if (g.input) g.input(room.game, u.id, p.inp);
      break;
    }

    case 'draw': {
      const room = conn.room;
      if (!room || room.phase !== 'playing' || room.gameId !== 'draw') return;
      const g = AR.games.draw;
      if (g && g.drawData) {
        const out = g.drawData(room.game, u.id, msg);
        if (out) broadcast(room, out, conn);
      }
      break;
    }

    case 'lobbySync': {
      conn.send({ t: 'lobby', users: lobbyUsers() });
      break;
    }

    case 'chat': {
      const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      const now = Date.now();
      if (now - (conn.lastChat || 0) < 350) return;
      conn.lastChat = now;

      const from = { id: u.id, name: u.nickname, color: u.color, avatar: u.avatar };
      const room = conn.room;

      /* 不在房间里就是大厅聊天 */
      if (!room) {
        pushChat(lobbyChat, { kind: 'say', from: from, text: text, at: now });
        broadcastAll({ t: 'chat', ch: 'lobby', kind: 'say', from: from, text: text, at: now });
        return;
      }

      /* 你画我猜：画家不能直接把答案打出来（否则游戏没法玩） */
      if (room.gameId === 'draw' && room.phase === 'playing' && room.game &&
        room.game.drawerId === u.id) {
        const ans = normAnswer(room.game.word);
        if (ans && normAnswer(text) === ans) {
          conn.send({
            t: 'chat', ch: 'room', kind: 'system',
            text: '你是画手，不能直接把答案说出来'
          });
          return;
        }
      }

      /* 你画我猜：先当答案判一次，猜对了不把原话广播出去 */
      if (room.gameId === 'draw' && room.phase === 'playing' && room.game) {
        const g = AR.games.draw;
        const out = g.guess && g.guess(room.game, u.id, text);
        if (out && out.kind === 'correct') {
          /* 别人的屏幕上只看到 ***，不知道他答了什么 */
          pushChat(room.chat, { kind: 'correct', from: from, text: '***', at: now });
          broadcast(room, { t: 'chat', ch: 'room', kind: 'correct', from: from, text: '***', at: now });
          return;
        }
      }

      pushChat(room.chat, { kind: 'say', from: from, text: text, at: now });
      broadcast(room, { t: 'chat', ch: 'room', kind: 'say', from: from, text: text, at: now });
      break;
    }

    default:
      break;
  }
}

/* ============================================================
 * 游戏循环（60Hz）
 * ============================================================ */
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - lastTick) / 1000;
  lastTick = now;
  if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
  if (dt > 0.25) dt = 0.25;

  rooms.forEach((room) => {
    if (room.phase !== 'playing' || !room.game) return;
    const g = AR.games[room.gameId];
    if (!g) return;

    room.acc += dt;
    let steps = 0;
    while (room.acc >= 1 / 60 && steps < 8) {
      /* 人机：每个物理步都重新决策一次 */
      if (g.bot) {
        room.players.forEach((p) => {
          if (!p.bot) return;
          const inp = g.bot(room.game, p.id, 1 / 60, p.bot);
          if (inp) g.input(room.game, p.id, inp);
        });
      }
      g.tick(room.game, 1 / 60);
      room.acc -= 1 / 60;
      steps++;
    }

    room.netAcc += dt;
    const rate = g.rate || 30;
    if (room.netAcc >= 1 / rate) {
      room.netAcc = 0;
      broadcast(room, { t: 'state', s: g.snapshot(room.game) });
      if (g.privateFor) {
        room.players.forEach((p) => {
          const m = g.privateFor(room.game, p.id);
          if (m) {
            const pr = presence.get(p.id);
            if (pr && pr.conn) pr.conn.send(m);
          }
        });
      }
    }

    if (g.isOver(room.game)) finishRound(room);
  });

  /* 清理过期邀请 */
  const t = Date.now();
  invites.forEach((inv, id) => {
    if (t - inv.at > 60000) invites.delete(id);
  });
}, 16);

/* ============================================================
 * 管理接口装配
 * ============================================================ */
handleAdmin = require('./shared/admin-api')({
  json: json,
  readJson: readJson,
  store: store,
  presence: presence,
  rooms: rooms,
  AR: AR,
  ADMINS: ADMINS,
  adminSessions: adminSessions,
  ADMIN_TTL: ADMIN_TTL,
  adminFrom: adminFrom,
  hashPassword: hashPassword,
  newToken: newToken,
  setPresence: setPresence,
  scheduleLobby: scheduleLobby,
  leaveRoom: leaveRoom,
  kickUser: kickUser
});

/* ============================================================
 * HTTP：静态资源 + REST API
 * ============================================================ */
const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const query = new URLSearchParams((req.url || '').split('?')[1] || '');

  try {
    /* ---------- API ---------- */
    if (urlPath.startsWith('/api/')) {
      return await handleApi(req, res, urlPath, query);
    }

    /* ---------- 静态文件 ---------- */
    let decoded;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch (e) {
      res.writeHead(400);
      return res.end('bad request');
    }
    if (decoded === '/' || decoded === '') decoded = '/index.html';

    /* 只放行前端资源，避免 /data/arcade.sqlite、/server.js 被直接下载 */
    const PUBLIC_PREFIX = ['/css/', '/js/', '/shared/'];
    const isPublic = decoded === '/index.html' || decoded === '/admin.html' || decoded === '/icon.svg' ||
      PUBLIC_PREFIX.some((pre) => decoded.indexOf(pre) === 0);
    if (!isPublic) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 not found');
    }

    const filePath = path.resolve(ROOT, decoded.replace(/^\/+/, ''));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end('forbidden');
    }

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 not found');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store'
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => { try { res.destroy(); } catch (e) { /* ignore */ } });
      stream.pipe(res);
    });
  } catch (e) {
    console.error('[http]', e && e.stack || e);
    if (!res.headersSent) json(res, 500, { error: '服务器错误' });
  }
});

async function handleApi(req, res, urlPath, query) {
  const method = req.method.toUpperCase();

  /* 公开接口 */
  if (urlPath === '/api/register' && method === 'POST') {
    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const nickname = String(body.nickname || '').trim() || username;

    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
      return json(res, 400, { error: '用户名需 3-16 位字母、数字或下划线' });
    }
    if (password.length < 6) return json(res, 400, { error: '密码至少 6 位' });
    if (nickname.length > 10) return json(res, 400, { error: '昵称最多 10 个字' });
    if (store.userByName(username)) return json(res, 409, { error: '这个用户名已经被注册了' });
    if (store.userByNickname && store.userByNickname(nickname)) {
      return json(res, 409, { error: '这个昵称已经有人用了，换一个吧' });
    }

    const p = hashPassword(password);
    const user = store.createUser({
      username: username,
      passHash: p.hash,
      salt: p.salt,
      nickname: nickname,
      color: AR.PLAYER_COLORS[Math.floor(Math.random() * AR.PLAYER_COLORS.length)],
      avatar: ''
    });
    if (!user) return json(res, 409, { error: '这个用户名已经被注册了' });

    const token = newToken();
    store.sessionCreate(token, user.id, Date.now() + SESSION_DAYS * 86400000);
    return json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (urlPath === '/api/login' && method === 'POST') {
    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const u = store.userByName(username);
    if (!u || !verifyPassword(password, u.salt, u.passHash)) {
      return json(res, 401, { error: '用户名或密码不对' });
    }
    if (u.banned) {
      return json(res, 403, { error: '该账号已被管理员封禁，请联系管理员' });
    }
    store.updateUser(u.id, { lastLogin: Date.now() });
    const token = newToken();
    store.sessionCreate(token, u.id, Date.now() + SESSION_DAYS * 86400000);
    return json(res, 200, { user: publicUser(store.userById(u.id)) }, { 'Set-Cookie': sessionCookie(token) });
  }

  if (urlPath === '/api/version' && method === 'GET') {
    return json(res, 200, VERSION);
  }

  if (urlPath === '/api/board' && method === 'GET') {
    return json(res, 200, { list: store.topUsers(20).map(publicUser) });
  }

  /* 管理员接口（自己的会话体系） */
  if (urlPath.indexOf('/api/admin/') === 0) {
    return await handleAdmin(req, res, urlPath);
  }

  /* 以下需要登录 */
  const me = currentUser(req);
  if (!me) return json(res, 401, { error: '请先登录' });

  if (urlPath === '/api/me' && method === 'GET') {
    return json(res, 200, { user: publicUser(me) });
  }

  if (urlPath === '/api/logout' && method === 'POST') {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) store.sessionDelete(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': COOKIE + '=; Path=/; HttpOnly; Max-Age=0' });
  }

  if (urlPath === '/api/profile' && method === 'POST') {
    const body = await readJson(req);
    const patch = {};
    if (body.nickname !== undefined) {
      const n = String(body.nickname).trim();
      if (!n || n.length > 10) return json(res, 400, { error: '昵称需 1-10 个字' });
      const taken = store.userByNickname && store.userByNickname(n);
      if (taken && taken.id !== me.id) {
        return json(res, 409, { error: '这个昵称已经有人用了，换一个吧' });
      }
      patch.nickname = n;
    }
    if (body.color !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(String(body.color))) return json(res, 400, { error: '颜色格式不对' });
      patch.color = String(body.color);
    }
    if (body.avatar !== undefined) patch.avatar = String(body.avatar).slice(0, 8);
    if (body.bio !== undefined) patch.bio = String(body.bio).slice(0, 60);

    const updated = store.updateUser(me.id, patch);
    if (patch.nickname || patch.color || patch.avatar) {
      /* 同步到所在房间 */
      const room = userInRoom(me.id);
      if (room && room.players.has(me.id)) {
        const p = room.players.get(me.id);
        p.name = updated.nickname;
        p.color = updated.color;
        p.avatar = updated.avatar;
        broadcastRoom(room);
      }
    }
    scheduleLobby();
    return json(res, 200, { user: publicUser(updated) });
  }

  if (urlPath === '/api/password' && method === 'POST') {
    const body = await readJson(req);
    if (!verifyPassword(String(body.oldPassword || ''), me.salt, me.passHash)) {
      return json(res, 400, { error: '原密码不对' });
    }
    if (String(body.newPassword || '').length < 6) return json(res, 400, { error: '新密码至少 6 位' });
    const p = hashPassword(String(body.newPassword));
    store.updateUser(me.id, { passHash: p.hash, salt: p.salt });
    return json(res, 200, { ok: true });
  }

  if (urlPath === '/api/history' && method === 'GET') {
    const limit = Math.min(50, Math.max(1, parseInt(query.get('limit'), 10) || 20));
    const list = store.matchesByUser(me.id, limit).map((m) => ({
      id: m.id,
      game: m.game,
      gameName: AR.getInfo(m.game).name,
      endedAt: m.endedAt,
      place: m.place,
      score: m.score,
      delta: m.delta
    }));
    return json(res, 200, { list: list });
  }

  if (urlPath === '/api/rooms' && method === 'GET') {
    const gameId = query.get('game');
    const list = [];
    rooms.forEach((room) => {
      if (room.phase !== 'lobby') return;
      if (gameId && room.gameId !== gameId) return;
      const host = room.players.get(room.hostId);
      list.push({
        code: room.code,
        gameId: room.gameId,
        host: host ? host.name : '—',
        count: room.players.size,
        max: AR.getInfo(room.gameId).max
      });
    });
    return json(res, 200, { rooms: list });
  }

  return json(res, 404, { error: '接口不存在' });
}

/* ============================================================
 * WebSocket 升级（用 cookie 会话鉴权）
 * ============================================================ */
server.on('upgrade', (req, socket) => {
  let token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) {
    try { token = new URL(req.url, 'http://localhost').searchParams.get('token'); } catch (e) { /* ignore */ }
  }
  const sess = token ? store.sessionGet(token) : null;
  const user = sess && sess.expiresAt > Date.now() ? store.userById(sess.userId) : null;

  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (user.banned) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  /* 同一账号只保留最新连接 */
  const old = presence.get(user.id);
  if (old && old.conn && !old.conn.closed) {
    old.conn.send({ t: 'kicked', msg: '你在别处打开了游戏厅' });
    old.conn.close();
  }

  const conn = new Conn(socket, user);
  conns.add(conn);
  setPresence(user.id, { conn: conn });
  conn.send({
    t: 'me',
    user: publicUser(user),
    lobby: lobbyUsers(),
    games: AR.GAME_INFO,
    version: VERSION_TAG
  });
  conn.send({ t: 'chatHistory', ch: 'lobby', list: lobbyChat });
  /* 立刻向所有人广播一次，别让新面孔等到下一次状态变化才出现 */
  broadcastLobby();
});

/* 心跳 */
setInterval(() => {
  const now = Date.now();
  conns.forEach((c) => {
    if (now - c.lastSeen > 120000) { c.terminate(); return; }
    c.sendFrame(0x9, Buffer.from('hb'));
    c.send({ t: 'hb', at: now });
  });
  try {
    store.sessionCleanup(now);
  } catch (e) {
    /* 数据库偶发只读/锁定不该让定时器崩掉，记一次就好 */
    console.error('[cleanup] 清理过期会话失败：' + e.message);
  }
}, 30000);

/* ============================================================
 * 启动
 * ============================================================ */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach((name) => {
    (ifaces[name] || []).forEach((info) => {
      const fam = info.family;
      if ((fam === 'IPv4' || fam === 4) && !info.internal) out.push(info.address);
    });
  });
  return out;
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('\n  端口 ' + PORT + ' 已被占用，换一个： node server.js 8091\n');
  } else {
    console.error('\n  服务器错误：', err && err.message || err, '\n');
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const ips = lanAddresses();
  const line = '='.repeat(60);
  const stat = store.stats();
  console.log('\n' + line);
  console.log('  摸鱼游戏厅 · OFFICE ARCADE — 服务器已启动');
  console.log(line);
  console.log('  监听地址： ' + HOST + ':' + PORT);
  console.log('  版本： ' + VERSION_TAG + (VERSION.released ? '（' + VERSION.released + '）' : '') +
    ' · ' + VERSION.notes.length + ' 条更新说明');
  console.log('  数据位置： ' + DATA_DIR);
  console.log('  运行环境： Node ' + process.version + ' · 存储 ' +
    (store.kind === 'sqlite' ? 'SQLite' : 'JSON') +
    '（' + stat.users + ' 位玩家，' + stat.matches + ' 局记录）');
  if (ADMINS.length) {
    console.log('  管理员： ' + ADMINS.length + ' 个（admins.json）· /admin.html');
  } else {
    console.log('  管理员： 未配置 —— 把 admins.example.json 复制成 admins.json 再重启');
  }
  const wordTotal = (WORDS.easy || []).length + (WORDS.normal || []).length + (WORDS.hard || []).length;
  if (wordTotal) {
    console.log('  画猜词库： 简单 ' + WORDS.easy.length + ' / 中等 ' + WORDS.normal.length +
      ' / 困难 ' + WORDS.hard.length + '（shared/words.json）');
  } else {
    console.log('  画猜词库： 内置默认（shared/words.json 未读到）');
  }
  console.log('  本机浏览器： http://localhost:' + PORT);
  if (HOST === '0.0.0.0') {
    ips.forEach((ip) => console.log('  局域网访问： http://' + ip + ':' + PORT));
  } else {
    console.log('  仅监听 ' + HOST + '（只允许本机访问）');
  }
  console.log('\n  把「局域网访问」地址发给同事，注册后即可开玩。');
  console.log('  按 Ctrl+C 停止服务器');
  console.log(line + '\n');

  if (process.argv.indexOf('--open') >= 0) {
    setTimeout(() => openBrowser('http://localhost:' + PORT), 500);
  }
});

function openBrowser(url) {
  let cmd;
  if (process.platform === 'win32') cmd = 'start "" "' + url + '"';
  else if (process.platform === 'darwin') cmd = 'open "' + url + '"';
  else cmd = 'xdg-open "' + url + '"';
  try {
    cp.exec(cmd, { windowsHide: true }, () => { /* ignore */ });
  } catch (e) { /* ignore */ }
}

function shutdown() {
  console.log('\n正在关闭…');
  conns.forEach((c) => c.terminate());
  try { store.close(); } catch (e) { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 600);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err && err.stack || err);
});
