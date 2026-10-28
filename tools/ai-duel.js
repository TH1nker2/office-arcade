#!/usr/bin/env node
/* 1v1 正面对比：同一个人机、两种难度，谁更强（给文档用） */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'shared/core.js'));
require(path.join(ROOT, 'shared/registry.js'));
require(path.join(ROOT, 'shared/games/constants.js'));
['tank', 'tetris', 'shmup'].forEach((id) => {
  require(path.join(ROOT, 'shared/games/' + id + '.js'));
});
const AR = globalThis.AR;

const A = 'easy';
const B = 'insane';

function duel(gameId, seconds, seed, levelFor) {
  const g = AR.games[gameId];
  const players = [
    { id: 'A', name: '易', color: '#ff5d7d' },
    { id: 'B', name: '难', color: '#a3e635' }
  ];
  const st = g.create(players, { seed: seed });
  let t = 0;
  while (t < seconds && !g.isOver(st)) {
    for (const p of players) {
      const lv = levelFor ? levelFor(p.id) : (p.id === 'A' ? A : B);
      const inp = g.bot(st, p.id, 1 / 60, lv);
      if (inp) g.input(st, p.id, inp);
    }
    g.tick(st, 1 / 60);
    t += 1 / 60;
  }
  const res = g.results(st);
  const a = res.find((r) => r.id === 'A') || { score: 0, kills: 0 };
  const b = res.find((r) => r.id === 'B') || { score: 0, kills: 0 };
  return { a, b, t, st };
}

console.log('\n1v1 对比：easy（易） vs insane（难），同一随机种子\n');

/* 坦克：击杀差 */
{
  let diff = 0;
  for (let s = 1; s <= 3; s++) {
    const r = duel('tank', 120, s);
    diff += r.b.kills - r.a.kills;
  }
  console.log('  坦克 120s  难-易 击杀差 平均 ' + (diff / 3).toFixed(1));
}

/* 方块：分数差 */
{
  let diff = 0;
  for (let s = 1; s <= 3; s++) {
    const r = duel('tetris', 90, s);
    diff += r.b.score - r.a.score;
  }
  console.log('  方块 90s   难-易 分数差 平均 ' + (diff / 3).toFixed(1));
}

console.log('');
