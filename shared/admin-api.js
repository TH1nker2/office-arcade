/* ============================================================
 * 管理接口：登录 / 用户列表 / 封禁 / 踢下线 / 踢出房间 / 改密 / 删号
 * 账号来自 admins.json（明文，改完重启生效）
 * ============================================================ */
'use strict';

const path = require('path');

module.exports = function install(ctx) {
  const {
    json, readJson, store, presence, rooms, AR,
    ADMINS, adminSessions, ADMIN_TTL, adminFrom,
    hashPassword, newToken, setPresence, scheduleLobby,
    leaveRoom, kickUser
  } = ctx;

  const COOKIE = 'asid';

  function adminCookie(token, maxAge) {
    return COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
  }

  function userRows(q) {
    const kw = String(q || '').trim().toLowerCase();
    const list = [];
    store.listUsers().forEach((u) => {
      if (kw && String(u.username).toLowerCase().indexOf(kw) < 0 &&
        String(u.nickname).toLowerCase().indexOf(kw) < 0) return;
      const p = presence.get(u.id);
      const room = p && p.roomCode ? rooms.get(p.roomCode) : null;
      list.push({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        avatar: u.avatar,
        color: u.color,
        points: u.points,
        wins: u.wins,
        rounds: u.rounds,
        streak: u.streak,
        bestStreak: u.bestStreak,
        banned: !!u.banned,
        online: !!p,
        roomCode: room ? room.code : null,
        gameName: room ? AR.getInfo(room.gameId).name : null,
        roomPhase: room ? room.phase : null,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin
      });
    });
    list.sort((a, b) => {
      if (a.banned !== b.banned) return a.banned ? 1 : -1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return b.points - a.points;
    });
    return list;
  }

  return async function handleAdmin(req, res, urlPath) {
    const method = req.method.toUpperCase();

    /* ---------- 登录 ---------- */
    if (urlPath === '/api/admin/login' && method === 'POST') {
      const body = await readJson(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const hit = ADMINS.find((a) => a.username === username && a.password === password);
      if (!hit) return json(res, 401, { error: '管理员账号或密码不对' });

      const token = newToken();
      adminSessions.set(token, { username: hit.username, name: hit.name, expires: Date.now() + ADMIN_TTL });
      console.log('[admin] ' + hit.username + ' 登录管理后台');
      return json(res, 200, { admin: { username: hit.username, name: hit.name } },
        { 'Set-Cookie': adminCookie(token, ADMIN_TTL / 1000) });
    }

    /* ---------- 会话 ---------- */
    const admin = adminFrom(req);
    if (!admin) return json(res, 401, { error: '请先登录管理后台' });

    if (urlPath === '/api/admin/me' && method === 'GET') {
      return json(res, 200, { admin: { username: admin.username, name: admin.name } });
    }

    if (urlPath === '/api/admin/logout' && method === 'POST') {
      const token = (req.headers.cookie || '').split('asid=')[1];
      if (token) adminSessions.delete(token.split(';')[0]);
      return json(res, 200, { ok: true }, { 'Set-Cookie': COOKIE + '=; Path=/; HttpOnly; Max-Age=0' });
    }

    /* ---------- 用户列表 ---------- */
    if (urlPath === '/api/admin/users' && method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams.get('q');
      return json(res, 200, { users: userRows(q), total: store.listUsers().length });
    }

    /* ---------- 以下都是 POST，需要目标用户 ---------- */
    const body = method === 'POST' ? await readJson(req) : {};
    const target = body.id ? store.userById(Number(body.id)) : null;
    if (method === 'POST' && !target) return json(res, 404, { error: '找不到这个账号' });

    if (urlPath === '/api/admin/ban' && method === 'POST') {
      const banned = body.banned ? 1 : 0;
      store.updateUser(target.id, { banned: banned });
      if (banned) {
        kickUser(target.id, '你已被管理员封禁');
        console.log('[admin] 封禁 ' + target.username + ' by ' + admin.username);
      } else {
        console.log('[admin] 解封 ' + target.username + ' by ' + admin.username);
      }
      scheduleLobby();
      return json(res, 200, { ok: true });
    }

    if (urlPath === '/api/admin/kick' && method === 'POST') {
      if (!presence.get(target.id)) return json(res, 400, { error: 'TA 当前不在线' });
      kickUser(target.id, '你已被管理员请离游戏厅');
      console.log('[admin] 踢下线 ' + target.username);
      return json(res, 200, { ok: true });
    }

    if (urlPath === '/api/admin/kickRoom' && method === 'POST') {
      const p = presence.get(target.id);
      if (!p || !p.conn || !p.conn.room) return json(res, 400, { error: 'TA 不在任何房间里' });
      leaveRoom(p.conn);
      p.conn.send({ t: 'leftRoom' });
      p.conn.send({ t: 'error', msg: '你已被管理员请出房间' });
      console.log('[admin] 踢出房间 ' + target.username);
      return json(res, 200, { ok: true });
    }

    if (urlPath === '/api/admin/password' && method === 'POST') {
      const pw = String(body.password || '');
      if (pw.length < 6) return json(res, 400, { error: '新密码至少 6 位' });
      const h = hashPassword(pw);
      store.updateUser(target.id, { passHash: h.hash, salt: h.salt });
      console.log('[admin] 重置密码 ' + target.username);
      return json(res, 200, { ok: true, password: pw });
    }

    if (urlPath === '/api/admin/delete' && method === 'POST') {
      const confirm = String(body.confirm || '').trim();
      if (confirm !== target.nickname && confirm !== target.username) {
        return json(res, 400, { error: '确认失败：请输入对方的昵称或用户名' });
      }
      kickUser(target.id, '你的账号已被管理员删除');
      store.deleteUser(target.id);
      scheduleLobby();
      console.log('[admin] 删除账号 ' + target.username + ' by ' + admin.username);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: '接口不存在' });
  };
};
