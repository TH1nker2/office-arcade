'use strict';
/* 账号、密码、Cookie 会话与管理员身份 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, COOKIE, SESSION_DAYS, store } = require('./config');
const { parseCookies } = require('./http-utils');

const ADMINS_FILE = path.join(ROOT, 'admins.json');

function loadAdmins() {
  try {
    const raw = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw && raw.admins) || [];
    return list.filter((a) => a && a.username).map((a) => ({
      username: String(a.username),
      password: String(a.password || ''),
      name: String(a.name || a.username)
    }));
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[admin] 读取 admins.json 失败（' + e.message + '）');
    return [];
  }
}

const ADMINS = loadAdmins();
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

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { hash: hash, salt: s };
}

function verifyPassword(password, salt, hash) {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(crypto.scryptSync(String(password), salt, 64).toString('hex'), 'hex')
    );
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
  if (!s || s.expiresAt <= Date.now()) return null;
  return store.userById(s.userId);
}

function publicUser(u) {
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
    createdAt: u.createdAt
  };
}

module.exports = {
  ADMINS,
  adminSessions,
  ADMIN_TTL,
  adminFrom,
  hashPassword,
  verifyPassword,
  newToken,
  sessionCookie,
  currentUser,
  publicUser
};
