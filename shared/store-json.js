/* ============================================================
 * 数据层 · JSON 回退实现（SQLite 不可用时的兜底）
 * 与 store-sqlite.js 暴露完全相同的接口
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let data = { seq: 1, users: [], sessions: {}, matches: [] };
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && Array.isArray(raw.users)) data = raw;
    }
  } catch (e) {
    console.error('[store-json] 读取失败，使用空库：', e.message);
  }
  if (!data.sessions) data.sessions = {};
  if (!Array.isArray(data.matches)) data.matches = [];

  let saveTimer = null;
  function saveNow() {
    const tmp = file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('[store-json] 写入失败：', e.message);
    }
  }
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, 250);
  }

  function publicUser(u) {
    if (!u) return null;
    return Object.assign({}, u);
  }

  const api = {
    kind: 'json',

    close() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      saveNow();
    },

    createUser(u) {
      const username = String(u.username || '');
      if (data.users.some((x) => x.username.toLowerCase() === username.toLowerCase())) return null;
      const now = Date.now();
      const user = {
        id: data.seq++,
        username: username,
        passHash: u.passHash,
        salt: u.salt,
        nickname: u.nickname || username,
        color: u.color || '#22d3ee',
        avatar: u.avatar || '',
        bio: u.bio || '',
        points: 0,
        wins: 0,
        rounds: 0,
        streak: 0,
        bestStreak: 0,
        banned: 0,
        createdAt: now,
        lastLogin: now
      };
      data.users.push(user);
      save();
      return publicUser(user);
    },

    userByNickname(nick) {
      const key = String(nick || '').trim().toLowerCase();
      if (!key) return null;
      return publicUser(data.users.find((x) => String(x.nickname || '').toLowerCase() === key));
    },

    userByName(username) {
      const key = String(username || '').toLowerCase();
      return publicUser(data.users.find((x) => x.username.toLowerCase() === key));
    },

    userById(id) {
      return publicUser(data.users.find((x) => x.id === Number(id)));
    },

    updateUser(id, patch) {
      const u = data.users.find((x) => x.id === Number(id));
      if (!u) return null;
      ['nickname', 'color', 'avatar', 'bio', 'passHash', 'salt', 'lastLogin', 'banned'].forEach((k) => {
        if (patch[k] !== undefined) u[k] = patch[k];
      });
      save();
      return publicUser(u);
    },

    listUsers() {
      return data.users.slice().sort((a, b) => b.lastLogin - a.lastLogin).map(publicUser);
    },

    topUsers(limit) {
      return data.users.slice()
        .sort((a, b) => b.points - a.points || b.wins - a.wins)
        .slice(0, limit || 20)
        .map(publicUser);
    },

    sessionCreate(token, userId, expiresAt) {
      data.sessions[token] = { userId: Number(userId), createdAt: Date.now(), expiresAt: expiresAt };
      save();
    },

    sessionGet(token) {
      const s = data.sessions[token];
      if (!s) return null;
      return { userId: s.userId, expiresAt: s.expiresAt };
    },

    sessionDelete(token) {
      delete data.sessions[token];
      save();
    },

    sessionDeleteByUser(userId, exceptToken) {
      const uid = Number(userId);
      Object.keys(data.sessions).forEach((k) => {
        if (data.sessions[k].userId === uid && k !== exceptToken) delete data.sessions[k];
      });
      save();
    },

    sessionCleanup(now) {
      const t = now || Date.now();
      Object.keys(data.sessions).forEach((k) => {
        if (data.sessions[k].expiresAt < t) delete data.sessions[k];
      });
      save();
    },

    matchAdd(m) {
      const id = data.seq++;
      const players = (m.players || []).map((p) => ({
        userId: Number(p.userId),
        place: p.place,
        score: p.score,
        delta: p.delta,
        detail: p.detail || 0
      }));
      data.matches.push({
        id: id,
        game: m.game,
        roomCode: m.roomCode || '',
        startedAt: m.startedAt || Date.now(),
        endedAt: m.endedAt || Date.now(),
        players: players
      });

      players.forEach((p) => {
        const u = data.users.find((x) => x.id === p.userId);
        if (!u) return;
        u.points += p.delta;
        u.rounds += 1;
        if (p.place === 1) {
          u.wins += 1;
          u.streak += 1;
          if (u.streak > u.bestStreak) u.bestStreak = u.streak;
        } else {
          u.streak = 0;
        }
      });

      if (data.matches.length > 5000) data.matches.splice(0, data.matches.length - 5000);
      save();
      return id;
    },

    matchesByUser(userId, limit) {
      const out = [];
      for (let i = data.matches.length - 1; i >= 0 && out.length < (limit || 20); i--) {
        const m = data.matches[i];
        const p = m.players.find((x) => x.userId === Number(userId));
        if (!p) continue;
        out.push({
          id: m.id,
          game: m.game,
          startedAt: m.startedAt,
          endedAt: m.endedAt,
          place: p.place,
          score: p.score,
          delta: p.delta,
          detail: p.detail
        });
      }
      return out;
    },

    deleteUser(id) {
      const uid = Number(id);
      data.users = data.users.filter((u) => u.id !== uid);
      data.matches.forEach((m) => {
        if (m.players) m.players = m.players.filter((p) => p.userId !== uid);
      });
      Object.keys(data.sessions).forEach((k) => {
        if (data.sessions[k].userId === uid) delete data.sessions[k];
      });
      save();
    },

    stats() {
      return { users: data.users.length, matches: data.matches.length };
    }
  };

  return api;
}

module.exports = { open };
