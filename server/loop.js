'use strict';
/* 游戏主循环：固定步长推进、快照广播、过期邀请清理 */
const { rooms, invites, presence } = require('./state');
const { broadcast } = require('./presence');
const { finishRound } = require('./rooms');
const AR = globalThis.AR;

let lastTick = Date.now();

function start() {
setInterval(() => {
  const now = Date.now();
  let dt = (now - lastTick) / 1000;
  lastTick = now;
  if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
  if (dt > 0.25) dt = 0.25;

  /* 每个房间独立推进。dt 是"上次醒来到现在"的真实时间，
     但模拟永远按 1/60 秒一步来走——这样不同机器、不同帧率下
     物理结果完全一致（固定步长），网络抖动也不会让游戏变快或变慢。 */
  rooms.forEach((room) => {
    if (room.phase !== 'playing' || !room.game) return;
    const g = AR.games[room.gameId];
    if (!g) return;

    room.acc += dt;
    /* steps < 8 是"追帧上限"：如果进程被卡了 2 秒，理论上要补 120 步，
       但那样会让这一帧耗时暴涨、越卡越卡。宁可让游戏时间落后一点，
       也不要雪崩。正常的 8ms / 16ms 定时器下永远用不到这个上限。 */
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

    /* 快照节奏。用累减而不是清零：8ms 定时器 + 60Hz 快照时，
       清零会把每次的余数丢掉，实际频率会明显低于标称值（曾经 30Hz 只跑出 24.6Hz）。 */
    room.netAcc += dt;
    const rate = g.rate || 60;
    if (room.netAcc >= 1 / rate) {
      /* 用累减而不是清零：40Hz 以上的频率靠 8ms 定时器触发，
         清零会把每次的余数丢掉，实际频率会低于设定值 */
      room.netAcc -= 1 / rate;
      if (room.netAcc > 1) room.netAcc = 0;
      broadcast(room, { t: 'state', s: g.snapshot(room.game) });
      if (g.privateFor) {
        room.players.forEach((p) => {
          const m = g.privateFor(room.game, p.id);
          if (m) {
            const pr = presence.get(p.id);
            if (pr && pr.conn && pr.conn.canSendState()) pr.conn.send(m);
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
}, 8);
}

module.exports = { start };
