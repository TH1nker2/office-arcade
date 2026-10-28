#!/usr/bin/env node
/* 量化各游戏人机在不同难度下的表现（给文档用） */
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

const LEVELS = ['easy', 'normal', 'hard', 'insane'];

function play(gameId, n, level, seconds) {
  const g = AR.games[gameId];
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push({ id: 'b' + i, name: '电脑' + i, color: AR.PLAYER_COLORS[i % AR.PLAYER_COLORS.length] });
  }
  const st = g.create(players, { seed: 424242 });
  let t = 0;
  while (t < seconds && !g.isOver(st)) {
    for (let i = 0; i < players.length; i++) {
      const inp = g.bot(st, players[i].id, 1 / 60, level);
      if (inp) g.input(st, players[i].id, inp);
    }
    g.tick(st, 1 / 60);
    t += 1 / 60;
  }
  return { st, t, res: g.results(st) };
}

function row(label, values) {
  console.log('  ' + label.padEnd(16) + values.map((v) => String(v).padStart(10)).join(''));
}

console.log('\n难度对比（同一随机种子，纯人机对局）\n');
console.log('  ' + '指标'.padEnd(14) + LEVELS.map((l) => l.padStart(10)).join(''));

/* 坦克：150 秒总击杀 */
{
  const out = LEVELS.map((lv) => {
    const r = play('tank', 4, lv, 150);
    return r.res.reduce((a, b) => a + b.kills, 0);
  });
  row('坦克 150s 击杀', out);
}

/* 方块：90 秒消行 */
{
  const out = LEVELS.map((lv) => {
    const r = play('tetris', 2, lv, 90);
    return r.res.reduce((a, b) => a + b.kills, 0);
  });
  row('方块 90s 消行', out);
}

/* 弹幕：60 秒团队分 */
{
  const out = LEVELS.map((lv) => {
    const r = play('shmup', 3, lv, 60);
    return r.st.score || 0;
  });
  row('弹幕 60s 得分', out);
}

console.log('');
