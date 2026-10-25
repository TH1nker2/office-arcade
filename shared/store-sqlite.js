/* ============================================================
 * 数据层 · SQLite 实现（node:sqlite，零第三方依赖）
 * 所有接口同步返回，供 server.js 直接调用
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

/* node:sqlite 的类名在演进：老版本只有 DatabaseSync，新版本推荐 Database */
const sqlite = require('node:sqlite');
const Database = sqlite.Database || sqlite.DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  nickname TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#22d3ee',
  avatar TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  rounds INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  room_code TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS match_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  place INTEGER NOT NULL,
  score INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  detail INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mp_user ON match_players(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_mp_match ON match_players(match_id);
`;

const SCHEMA_VERSION = 2;

/* 每一步只加不改：v1 是初始结构（SCHEMA 里的 CREATE IF NOT EXISTS 已覆盖） */
const MIGRATIONS = [
  {
    v: 1,
    note: '初始结构',
    up: () => { /* 由 SCHEMA 的 CREATE TABLE IF NOT EXISTS 建立 */ }
  },
  {
    v: 2,
    note: 'users 表补充 banned（封禁）字段',
    up: (db) => {
      const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
      if (cols.indexOf('banned') < 0) {
        db.exec('ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0');
      }
    }
  }
];

let _db = null;
function probeWritable() { _db.exec('BEGIN IMMEDIATE'); _db.exec('ROLLBACK'); }
function close() { try { _db.close(); } catch (e) { /* ignore */ } }

function openOnce(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  /* 打开前清掉残留的 -wal / -shm：
   * 进程被强杀后这两个文件会留下来，里面有旧锁，新的写连接会一直报 readonly。
   * -wal 为 0 字节时确定没有未落盘数据，直接删；否则先尝试合并。
   */
  try {
    const wal = file + '-wal';
    const shm = file + '-shm';
    if (fs.existsSync(wal) && fs.statSync(wal).size === 0) {
      fs.rmSync(wal, { force: true });
      fs.rmSync(shm, { force: true });
    }
  } catch (e) { /* 删不掉就算了，后面正常打开 */ }

  /* 被占用时等一会儿再试，别因为一瞬间的锁就判定失败 */
  let db = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      db = new Database(file);
      break;
    } catch (e) {
      if (!/locked|busy/i.test(String(e.message))) throw e;
      if (attempt === 5) throw e;
      const until = Date.now() + 200;
      while (Date.now() < until) { /* 忙等，避免引入异步 */ }
    }
  }
  /* 用 DELETE 日志模式：不产生 -wal/-shm，避免只读连接把索引文件弄坏后
   * 整个库变成 "attempt to write a readonly database"。本项目的写入量很小，
   * 用回滚日志完全够用。 */
  try {
    const cur = String(db.prepare('PRAGMA journal_mode').get().journal_mode || '').toLowerCase();
    if (cur === 'wal') {
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ }
    }
    if (cur !== 'delete') db.exec('PRAGMA journal_mode = DELETE');
  } catch (e) {
    console.warn('[store] 切换 journal_mode 失败（' + e.message + '），继续用当前模式');
  }
  db.exec('PRAGMA synchronous = NORMAL');
  _db = db;
  db.exec(SCHEMA);

  /* ---------- 结构版本与迁移 ----------
   * PRAGMA user_version 记录结构版本；升级版本时只加迁移、不改已有的迁移。
   * 打开比本程序更新的库会直接报错，避免把数据写坏。
   */
  const fromVersion = Number(db.prepare('PRAGMA user_version').get().user_version) || 0;
  if (fromVersion > SCHEMA_VERSION) {
    const err = new Error('数据库结构版本 ' + fromVersion + ' 比程序支持的 ' + SCHEMA_VERSION +
      ' 更新，请升级程序后再打开（数据未改动）');
    err.fatal = true;   /* 不能回退到 JSON，否则会另起一份空库 */
    throw err;
  }
  if (fromVersion < SCHEMA_VERSION) {
    for (const m of MIGRATIONS) {
      if (m.v <= fromVersion) continue;
      try {
        m.up(db);
        console.log('[store] 迁移到结构 v' + m.v + '：' + m.note);
      } catch (e) {
        console.warn('[store] 迁移 v' + m.v + ' 失败（' + e.message + '），跳过');
      }
    }
    db.exec('PRAGMA user_version = ' + SCHEMA_VERSION);
  }
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nick ON users(nickname COLLATE NOCASE)');
  } catch (e) {
    console.warn('[store] 昵称唯一索引没建成（库里已有重名）：' + e.message);
  }
  console.log('[store] 数据库结构 v' + SCHEMA_VERSION + '（' + file + '）');

  function mapUser(r) {
    if (!r) return null;
    return {
      id: Number(r.id),
      username: r.username,
      passHash: r.pass_hash,
      salt: r.salt,
      nickname: r.nickname,
      color: r.color,
      avatar: r.avatar,
      bio: r.bio,
      points: Number(r.points),
      wins: Number(r.wins),
      rounds: Number(r.rounds),
      streak: Number(r.streak),
      bestStreak: Number(r.best_streak),
      banned: Number(r.banned) || 0,
      createdAt: Number(r.created_at),
      lastLogin: Number(r.last_login)
    };
  }

  const api = {
    kind: 'sqlite',

    close() {
      try { db.close(); } catch (e) { /* ignore */ }
    },

    createUser(u) {
      const now = Date.now();
      try {
        const r = db.prepare(
          'INSERT INTO users (username, pass_hash, salt, nickname, color, avatar, bio, created_at, last_login) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          u.username, u.passHash, u.salt,
          u.nickname || u.username,
          u.color || '#22d3ee',
          u.avatar || '',
          u.bio || '',
          now, now
        );
        return api.userById(Number(r.lastInsertRowid));
      } catch (e) {
        if (String(e.message).indexOf('UNIQUE') >= 0) return null;
        throw e;
      }
    },

    userByNickname(nick) {
      const name = String(nick || '').trim();
      if (!name) return null;
      return mapUser(db.prepare('SELECT * FROM users WHERE nickname = ? COLLATE NOCASE LIMIT 1').get(name));
    },

    userByName(username) {
      return mapUser(db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '')));
    },

    userById(id) {
      return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id)));
    },

    updateUser(id, patch) {
      const allowed = {
        nickname: 'nickname',
        color: 'color',
        avatar: 'avatar',
        bio: 'bio',
        passHash: 'pass_hash',
        salt: 'salt',
        lastLogin: 'last_login',
        banned: 'banned'
      };
      const sets = [];
      const vals = [];
      Object.keys(patch).forEach((k) => {
        if (allowed[k]) {
          sets.push(allowed[k] + ' = ?');
          vals.push(patch[k]);
        }
      });
      if (sets.length) {
        vals.push(Number(id));
        const stmt = db.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?');
        stmt.run.apply(stmt, vals);
      }
      return api.userById(id);
    },

    listUsers() {
      return db.prepare('SELECT * FROM users ORDER BY last_login DESC').all().map(mapUser);
    },

    topUsers(limit) {
      return db.prepare('SELECT * FROM users ORDER BY points DESC, wins DESC LIMIT ?')
        .all(limit || 20).map(mapUser);
    },

    sessionCreate(token, userId, expiresAt) {
      db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(token, Number(userId), Date.now(), expiresAt);
    },

    sessionGet(token) {
      const r = db.prepare('SELECT * FROM sessions WHERE token = ?').get(String(token || ''));
      if (!r) return null;
      return { userId: Number(r.user_id), expiresAt: Number(r.expires_at) };
    },

    sessionDelete(token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token || ''));
    },

    sessionCleanup(now) {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now || Date.now());
    },

    matchAdd(m) {
      const players = m.players || [];
      db.exec('BEGIN');
      try {
        const r = db.prepare(
          'INSERT INTO matches (game, room_code, started_at, ended_at) VALUES (?, ?, ?, ?)'
        ).run(m.game, m.roomCode || '', m.startedAt || Date.now(), m.endedAt || Date.now());
        const matchId = Number(r.lastInsertRowid);

        const insP = db.prepare(
          'INSERT INTO match_players (match_id, user_id, place, score, delta, detail) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const updU = db.prepare(
          'UPDATE users SET points = points + ?, wins = wins + ?, rounds = rounds + 1, ' +
          'streak = CASE WHEN ? = 1 THEN streak + 1 ELSE 0 END, ' +
          'best_streak = CASE WHEN ? = 1 AND streak + 1 > best_streak THEN streak + 1 ELSE best_streak END ' +
          'WHERE id = ?'
        );

        players.forEach((p) => {
          insP.run(matchId, Number(p.userId), p.place, p.score, p.delta, p.detail || 0);
          updU.run(p.delta, p.place === 1 ? 1 : 0, p.place === 1 ? 1 : 0, p.place === 1 ? 1 : 0, Number(p.userId));
        });

        db.exec('COMMIT');
        return matchId;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    matchesByUser(userId, limit) {
      return db.prepare(
        'SELECT m.id, m.game, m.started_at, m.ended_at, mp.place, mp.score, mp.delta, mp.detail ' +
        'FROM match_players mp JOIN matches m ON m.id = mp.match_id ' +
        'WHERE mp.user_id = ? ORDER BY m.id DESC LIMIT ?'
      ).all(Number(userId), limit || 20).map((r) => ({
        id: Number(r.id),
        game: r.game,
        startedAt: Number(r.started_at),
        endedAt: Number(r.ended_at),
        place: Number(r.place),
        score: Number(r.score),
        delta: Number(r.delta),
        detail: Number(r.detail)
      }));
    },

    deleteUser(id) {
      const uid = Number(id);
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM match_players WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
        db.prepare('DELETE FROM users WHERE id = ?').run(uid);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    stats() {
      const u = db.prepare('SELECT COUNT(*) AS c FROM users').get();
      const m = db.prepare('SELECT COUNT(*) AS c FROM matches').get();
      return { users: Number(u.c), matches: Number(m.c) };
    }
  };

  return api;
}

/* 有些情况下（比如另一个进程用只读方式开过同一个库）会留下 -shm 索引，
 * 之后写连接会一直报 "attempt to write a readonly database"。
 * 这里检测到只读错误就删掉 -shm 再重开一次；-wal 不动，避免丢未落盘的数据。 */
function open(file) {
  try {
    const store = openOnce(file);
    /* 启动时做一次写探针：有些坏连接是"能打开、写不了"，
     * 等到玩家登录才炸就太晚了。这里当场发现、清理后重开。 */
    try {
      probeWritable();
      return store;
    } catch (e) {
      if (!/readonly|read-only/i.test(String(e.message || ''))) throw e;
      console.warn('[store] 写探针发现数据库只读（' + e.message + '），清理 -wal/-shm 后重开');
      try { close(); } catch (err) { /* ignore */ }
      try { fs.rmSync(file + '-wal', { force: true }); } catch (err) { /* ignore */ }
      try { fs.rmSync(file + '-shm', { force: true }); } catch (err) { /* ignore */ }
      const again = openOnce(file);
      probeWritable();
      return again;
    }
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (!/readonly|read-only/i.test(msg)) throw e;
    console.warn('[store] 数据库处于只读状态（' + msg + '），清理 -shm 后重试');
    try { fs.rmSync(file + '-shm', { force: true }); } catch (err) { /* ignore */ }
    return openOnce(file);
  }
}

module.exports = { open, SCHEMA_VERSION };
