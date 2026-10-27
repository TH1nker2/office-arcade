'use strict';
/* 进程内实时状态：在线连接、房间、邀请和大厅聊天 */
const presence = new Map();   /* userId -> { conn, roomCode, gameId, since } */
const conns = new Set();
const rooms = new Map();
const invites = new Map();
const lobbyChat = [];

module.exports = { presence, conns, rooms, invites, lobbyChat };
