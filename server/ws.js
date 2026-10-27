'use strict';
/* WebSocket 连接、协议帧、升级与消息分发 */
const crypto = require('crypto');
const { MAX_MESSAGE, WS_GUID, COOKIE, VERSION_TAG, store } = require('./config');
const { parseCookies } = require('./http-utils');
const { publicUser, adminSessions } = require('./auth');
const { presence, conns, rooms, lobbyChat } = require('./state');
const {
  setPresence, clearPresence, lobbyUsers, broadcastAll, broadcastLobby, broadcast
} = require('./presence');
const {
  createRoom, joinRoom, leaveRoom, addBot, removeBot, broadcastRoom,
  startRound, inviteUser, replyInvite, userInRoom, pushChat
} = require('./rooms');
const { normAnswer } = require('./words');
const AR = globalThis.AR;

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
      if (room.phase !== 'lobby') {
        conn.send({ t: 'error', msg: '本局刚结束，稍等一下再开' });
        return;
      }
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
function attach(server) {
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
}

function startHeartbeat() {
  setInterval(() => {
    const now = Date.now();
    conns.forEach((c) => {
      if (now - c.lastSeen > 120000) { c.terminate(); return; }
      c.sendFrame(0x9, Buffer.from('hb'));
      c.send({ t: 'hb', at: now });
    });
    adminSessions.forEach((v, k) => { if (v.expires < now) adminSessions.delete(k); });

    try {
      store.sessionCleanup(now);
    } catch (e) {
      console.error('[cleanup] 清理过期会话失败：' + e.message);
    }
  }, 30000);
}

module.exports = { Conn, attach, startHeartbeat, handle };
