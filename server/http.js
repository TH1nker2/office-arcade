'use strict';
/* HTTP 静态资源与 REST API */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  ROOT, MIME, VERSION, COOKIE, SESSION_DAYS, store
} = require('./config');
const { json, readJson, parseCookies, SECURITY_HEADERS } = require('./http-utils');
const {
  currentUser, publicUser, hashPassword, verifyPassword, newToken, sessionCookie,
  loginBlocked, loginFailed, loginSuccess
} = require('./auth');
const { presence, rooms } = require('./state');
const { scheduleLobby } = require('./presence');
const { userInRoom, broadcastRoom } = require('./rooms');
const AR = globalThis.AR;

/* 内网也值得做：gzip 把首屏 JS/CSS 压到约 1/3；ETag 让重复打开只回 304。
   静态资源的缓存策略用 no-cache（每次重验证），避免发版后浏览器拿旧文件。 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');
const STATIC_HEADERS = Object.assign({}, SECURITY_HEADERS, {
  'Content-Security-Policy': CSP
});
const COMPRESSIBLE = /\.(html|js|css|json|svg|txt)$/i;
const GZIP_MAX = 2 * 1024 * 1024;
const gzipCache = new Map();

function staticHeaders(filePath, st, ext) {
  const mtime = Math.floor(st.mtimeMs || (st.mtime && st.mtime.getTime()) || 0);
  return Object.assign({}, STATIC_HEADERS, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'ETag': 'W/"' + st.size.toString(16) + '-' + mtime.toString(16) + '"',
    'Last-Modified': st.mtime.toUTCString(),
    'Vary': 'Accept-Encoding'
  });
}

function serveStatic(req, res, filePath, st) {
  const ext = path.extname(filePath).toLowerCase();
  const headers = staticHeaders(filePath, st, ext);
  const etag = headers['ETag'];

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }

  const accept = String(req.headers['accept-encoding'] || '');
  const compress = COMPRESSIBLE.test(filePath) && st.size <= GZIP_MAX && /\bgzip\b/i.test(accept);
  if (!compress) {
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { try { res.destroy(); } catch (e) { /* ignore */ } });
    stream.pipe(res);
    return;
  }

  const mtime = Math.floor(st.mtimeMs || (st.mtime && st.mtime.getTime()) || 0);
  const cached = gzipCache.get(filePath);
  if (cached && cached.size === st.size && cached.mtimeMs === mtime) {
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = cached.buf.length;
    res.writeHead(200, headers);
    return res.end(cached.buf);
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      if (!res.headersSent) json(res, 500, { error: '服务器错误' });
      return;
    }
    zlib.gzip(buf, (err2, gz) => {
      if (err2) {
        if (!res.headersSent) json(res, 500, { error: '服务器错误' });
        return;
      }
      gzipCache.set(filePath, { size: st.size, mtimeMs: mtime, buf: gz });
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = gz.length;
      res.writeHead(200, headers);
      res.end(gz);
    });
  });
}

let handleAdmin = null;

function createHandler(admin) {
  handleAdmin = admin;

  return async function (req, res) {
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

    /* 含空字节 / 控制字符的路径直接拒绝 */
    if (/[\0-\x1f]/.test(decoded)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('bad request');
    }

    /* 先把 .. 归一化，再按归一化后的路径做白名单判断。
       顺序反过来就是漏洞：/js/../server.js 会先通过 "/js/" 前缀检查，
       再被 path.resolve 还原成根目录的 server.js 直接下载走。
       归一化之后还要拒掉残留的 ".." 和空字节。 */
    const norm = path.posix.normalize(decoded);
    const PUBLIC_PREFIX = ['/css/', '/js/', '/shared/'];
    const isPublic = norm === '/index.html' || norm === '/admin.html' || norm === '/icon.svg' ||
      PUBLIC_PREFIX.some((pre) => norm.indexOf(pre) === 0);
    if (!isPublic || norm.indexOf('..') >= 0) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 not found');
    }

    const filePath = path.resolve(ROOT, norm.replace(/^\/+/, ''));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end('forbidden');
    }

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, Object.assign({}, SECURITY_HEADERS, {
          'Content-Type': 'text/plain; charset=utf-8'
        }));
        return res.end('404 not found');
      }
      serveStatic(req, res, filePath, st);
    });
  } catch (e) {
    console.error('[http]', e && e.stack || e);
    if (!res.headersSent) json(res, 500, { error: '服务器错误' });
  }
  };
}

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

    const p = await hashPassword(password);
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
    if (loginBlocked(req, username)) {
      return json(res, 429, { error: '尝试次数过多，请稍后再试' });
    }
    const u = store.userByName(username);
    if (!u || !(await verifyPassword(password, u.salt, u.passHash))) {
      loginFailed(req, username);
      return json(res, 401, { error: '用户名或密码不对' });
    }
    if (u.banned) {
      return json(res, 403, { error: '该账号已被管理员封禁，请联系管理员' });
    }
    loginSuccess(req, username);
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

  /* 查看任意玩家的公开资料：只返回 publicUser + 在线状态 + 最近 10 局 */
  const playerMatch = urlPath.match(/^\/api\/players\/(\d+)$/);
  if (playerMatch && method === 'GET') {
    const target = store.userById(Number(playerMatch[1]));
    if (!target) return json(res, 404, { error: '找不到这个玩家' });

    const p = presence.get(target.id);
    const room = p && p.roomCode ? rooms.get(p.roomCode) : null;
    let status = 'offline';
    if (p) status = room ? (room.phase === 'lobby' ? 'waiting' : 'playing') : 'online';
    const info = p && p.gameId ? AR.getInfo(p.gameId) : null;

    const history = store.matchesByUser(target.id, 10).map((m) => ({
      id: m.id,
      game: m.game,
      gameName: AR.getInfo(m.game).name,
      endedAt: m.endedAt,
      place: m.place,
      score: m.score,
      delta: m.delta
    }));

    return json(res, 200, {
      user: publicUser(target),
      status: status,
      gameId: p ? p.gameId : null,
      gameName: info ? info.name : null,
      roomCode: room ? room.code : null,
      roomCount: room ? room.players.size : 0,
      roomMax: room ? AR.getInfo(room.gameId).max : 0,
      isSelf: target.id === me.id,
      history: history
    });
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
    /* WebSocket 连接里缓存了用户快照；不同步的话聊天/邀请会继续用旧昵称和头像 */
    if (updated) {
      const pr = presence.get(me.id);
      if (pr && pr.conn) pr.conn.user = updated;
    }
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
    if (!(await verifyPassword(String(body.oldPassword || ''), me.salt, me.passHash))) {
      return json(res, 400, { error: '原密码不对' });
    }
    if (String(body.newPassword || '').length < 6) return json(res, 400, { error: '新密码至少 6 位' });
    const p = await hashPassword(String(body.newPassword));
    store.updateUser(me.id, { passHash: p.hash, salt: p.salt });
    /* 保留当前会话，其余旧会话全部失效；否则改密后旧设备仍能继续用 */
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (store.sessionDeleteByUser) store.sessionDeleteByUser(me.id, token);
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
module.exports = { createHandler, handleApi };
