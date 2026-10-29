'use strict';
/* 在线状态、大厅广播与连接广播 */
const { store } = require('./config');
const { publicUser } = require('./auth');
const { presence, conns, rooms } = require('./state');

const AR = globalThis.AR;

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
    if (p) status = room ? (room.phase === 'lobby' ? 'waiting' : 'playing') : 'online';
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

function broadcastAll(obj) {
  const text = JSON.stringify(obj);
  conns.forEach((c) => c.sendRaw(text));
}

function broadcastLobby() {
  broadcastAll({ t: 'lobby', users: lobbyUsers() });
}

function broadcast(room, obj, except) {
  const text = JSON.stringify(obj);
  const isState = obj && obj.t === 'state';
  room.players.forEach((p) => {
    const pr = presence.get(p.id);
    if (!pr || !pr.conn || pr.conn === except) return;
    /* 状态快照可以丢，聊天/邀请/结算不能丢；慢连接只跳过快照。 */
    if (isState && !pr.conn.canSendState()) return;
    pr.conn.sendRaw(text);
  });
}

module.exports = {
  setPresence,
  clearPresence,
  scheduleLobby,
  lobbyUsers,
  broadcastAll,
  broadcastLobby,
  broadcast
};
