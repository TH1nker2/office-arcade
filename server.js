#!/usr/bin/env node
/* ============================================================
 * 摸鱼游戏厅 · OFFICE ARCADE — 局域网服务器
 *
 * 整个后端只有这一个入口：一个 HTTP 服务 + 一个手写的 WebSocket 服务。
 * 没有第三方依赖，只用 Node 内置模块；Node 22.13+ 可直接使用 node:sqlite，更早版本回退 JSON。
 *
 * 运行： node server.js [端口]           默认 8090
 *      ARCADE_DATA=<目录> 可以临时换数据目录（测试用）
 *
 * ---- 文件内分节顺序（搜这些标题可以快速跳转）----
 *   小工具          json 响应 / Cookie 解析 / 读请求体
 *   密码与会话      scrypt 哈希、sid Cookie、管理员会话
 *   在线状态        presence：谁在线、在哪个房间
 *   WebSocket       帧解析与组包、连接对象、广播
 *   房间            createRoom / joinRoom / leaveRoom / 人机
 *   回合            startRound / finishRound（结算写库）
 *   邀请            60 秒有效的房间邀请
 *   WS 消息         客户端所有动作的 switch 分发
 *   游戏循环        60Hz 固定步长驱动模拟与快照
 *   管理接口        挂载 shared/admin-api.js
 *   HTTP 静态与 REST 白名单 + /api/*
 *   WebSocket 升级   握手 + 用 Cookie 会话鉴权
 *   启动            打印局域网地址、打开浏览器、优雅退出
 *
 * ---- WebSocket 协议：客户端 → 服务器 ----
 *   ping                                心跳探测（回 pong）
 *   createRoom  { gameId }              建房
 *   joinRoom    { code }                按 4 位码加入
 *   leaveRoom                           离开房间
 *   invite      { toId }                邀请某人（对方在线且不在房间）
 *   inviteReply { inviteId, accept }    接受 / 拒绝邀请
 *   setting     { key, value }          房主改设置（draw 的 level、undercover 的 rounds）
 *   botAdd / botRemove { id }           加 / 删人机（固定普通难度）
 *   start                               房主开局（仅 lobby 阶段）
 *   input       { i }                   对局输入，i 的内容由各游戏自己约定
 *   draw        { ... }                 你画我猜的选词 / 笔迹 / 清空画布
 *   chat        { text }                房间或大厅聊天
 *   lobbySync                           主动拉一次大厅在线列表
 *
 * ---- WebSocket 协议：服务器 → 客户端 ----
 *   me（首包：user/lobby/games/version）  pong  hb
 *   lobby  room  leftRoom  game  state  over
 *   chat  chatHistory  invite  inviteSent  inviteResult  error
 *   choices  word  paint  paintClear      你画我猜的私有/广播消息
 *   undercover                            谁是卧底只发给本人的身份和词
 *   kicked                                被顶号、封禁或管理员请离
 *
 * ---- 必须守住的不变式 ----
 *   1. 所有游戏逻辑跑在服务端，客户端只发输入、画快照（防作弊 + 一致）
 *   2. 每帧最多补 8 步模拟，防止卡顿后一次性补太多把进程拖死
 *   3. 一个房间只要没有真人就立刻销毁（人机不算真人）
 *   4. 静态资源必须先归一化路径、再查白名单（防 ../ 穿越）
 *   5. 数据库只允许本机访问，不做任何对外暴露
 * ============================================================ */
'use strict';

/* ---------- 共享游戏逻辑 ---------- */
require('./shared/core.js');
require('./shared/registry.js');
require('./shared/games/constants.js');
require('./shared/games/tank.js');
require('./shared/games/tetris.js');
require('./shared/games/shmup.js');
require('./shared/games/draw.js');
require('./shared/games/gomoku.js');
require('./shared/games/undercover.js');

/* ---------- 服务端模块 ---------- */
const http = require('http');
const os = require('os');
const cp = require('child_process');
const { PORT, HOST, ROOT, VERSION, VERSION_TAG, DATA_DIR, store } = require('./server/config');
const { json, readJson } = require('./server/http-utils');
const auth = require('./server/auth');
const { WORDS } = require('./server/words');
const { UNDERCOVER_PAIRS } = require('./server/undercover-words');
const { presence: presenceMap, conns } = require('./server/state');
const presence = require('./server/presence');
const rooms = require('./server/rooms');
const ws = require('./server/ws');
const { createHandler } = require('./server/http');
const loop = require('./server/loop');

const AR = globalThis.AR;

/* ---------- 管理接口 ---------- */
const handleAdmin = require('./shared/admin-api')({
  json: json,
  readJson: readJson,
  store: store,
  presence: presenceMap,
  rooms: rooms.rooms,
  AR: AR,
  ADMINS: auth.ADMINS,
  adminSessions: auth.adminSessions,
  ADMIN_TTL: auth.ADMIN_TTL,
  adminFrom: auth.adminFrom,
  hashPassword: auth.hashPassword,
  newToken: auth.newToken,
  loginBlocked: auth.loginBlocked,
  loginFailed: auth.loginFailed,
  loginSuccess: auth.loginSuccess,
  safeEqual: auth.safeEqual,
  setPresence: presence.setPresence,
  scheduleLobby: presence.scheduleLobby,
  leaveRoom: rooms.leaveRoom,
  kickUser: rooms.kickUser,
  WORDS: WORDS,
  UNDERCOVER_PAIRS: UNDERCOVER_PAIRS
});

/* ---------- HTTP / WebSocket ---------- */
const server = http.createServer(createHandler(handleAdmin));
ws.attach(server);
loop.start();
ws.startHeartbeat();

/* ---------- 启动 ---------- */
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
  if (auth.ADMINS.length) {
    console.log('  管理员： ' + auth.ADMINS.length + ' 个（admins.json）· /admin.html');
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
  console.log('  卧底词对： ' + UNDERCOVER_PAIRS.length + ' 对（shared/undercover-words.json）');
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
