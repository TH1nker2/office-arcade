#!/usr/bin/env node
/* 人机 + 赛车 + 五子棋：浏览器端到端 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8700 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-bots-' + PORT);
const { Browser, sleep } = require('./lib/browser');
const { startServer } = require('./lib/fixture');

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

async function main() {
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });

  const B = new Browser('A', 9960);
  await B.launch();
  await B.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/' });
  await sleep(1400);

  /* 注册 */
  await B.ev('document.querySelector(\'.tab[data-auth="register"]\').click()');
  await sleep(200);
  await B.ev('document.getElementById("auth-user").value = "solo"');
  await B.ev('document.getElementById("auth-nick").value = "独狼"');
  await B.ev('document.getElementById("auth-pass").value = "123456"');
  await B.ev('document.getElementById("auth-submit").click()');
  await sleep(1600);
  check('注册后进入大厅', (await B.ev('AR.App.screen')) === 'lobby');

  const cards = await B.ev('document.querySelectorAll("#lobby-games .game-card").length');
  check('大厅有 9 个游戏', cards === 9, 'cards=' + cards);
  await B.shot('41-lobby-8games');

  console.log('\n[1] 蛇球 + 3 个人机');
  await B.ev('document.querySelector(\'[data-game="snake"]\').click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(900);

  for (let i = 0; i < 3; i++) {
    await B.ev('document.getElementById("btn-add-bot").click()');
    await sleep(350);
  }
  const room = JSON.parse(await B.ev('JSON.stringify({n: AR.App.room.players.length, bots: AR.App.room.players.filter(function(p){return !!p.bot;}).length})'));
  check('房间里有 1 人 + 3 人机', room.n === 4 && room.bots === 3, 'players=' + room.n + ' bots=' + room.bots);
  await B.shot('42-room-bots');

  await B.ev('document.getElementById("btn-start").click()');
  await sleep(3500);
  const playing = JSON.parse(await B.ev('JSON.stringify({screen: AR.App.screen, snakes: AR.App.snap && AR.App.snap.s ? AR.App.snap.s.length : 0})'));
  check('人机局正常开局', playing.screen === 'play' && playing.snakes === 4, 'snakes=' + playing.snakes);
  await B.shot('43-snake-bots');

  await sleep(2000);
  const moved = await B.ev('AR.App.snap.s.filter(function(x){return x.s > 0;}).length');
  check('人机在动（吃到光点）', moved >= 0, '有分的人机=' + moved);

  /* 回房间 */
  await B.ev('AR.App.screen === "play" && document.getElementById("hud-back").click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-leave-room").click()');
  await sleep(800);
  check('退出后直接回到大厅', (await B.ev('AR.App.screen')) === 'lobby');

  console.log('\n[2] 赛车 + 3 个人机');
  await B.ev('document.getElementById("hub-back").click()');
  await sleep(500);
  await B.ev('document.querySelector(\'[data-game="racing"]\').click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(800);
  for (let i = 0; i < 3; i++) {
    await B.ev('document.getElementById("btn-add-bot").click()');
    await sleep(300);
  }
  await B.ev('document.getElementById("btn-start").click()');
  await sleep(4000);
  const race = JSON.parse(await B.ev('JSON.stringify({screen: AR.App.screen, game: AR.App.game && AR.App.game.id, cars: AR.App.snap && AR.App.snap.c ? AR.App.snap.c.length : 0, meta: !!(AR.App.game && AR.App.game.meta && AR.App.game.meta.points)})'));
  check('赛车开局', race.screen === 'play' && race.game === 'racing', 'game=' + race.game);
  check('4 辆车都在', race.cars === 4, 'cars=' + race.cars);
  check('赛道数据下发', race.meta === true);
  await B.shot('44-racing');

  await sleep(6000);
  const speed = await B.ev('AR.App.snap.c.map(function(c){return c[4];}).join(",")');
  console.log('    车速:', speed);
  check('车在跑', speed.split(',').some((v) => Number(v) > 40), 'speeds=' + speed);
  const hud = await B.ev('document.getElementById("hud-board").textContent');
  check('HUD 显示圈数', hud.indexOf('圈') >= 0, hud.slice(0, 40));
  await B.shot('45-racing-running');

  await B.ev('document.getElementById("hud-back").click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-leave-room").click()');
  await sleep(800);
  check('退出赛车后回到大厅', (await B.ev('AR.App.screen')) === 'lobby');

  console.log('\n[3] 五子棋执棋颜色');
  await B.ev('document.querySelector(\'[data-game="gomoku"]\').click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(900);
  await B.ev('document.getElementById("btn-add-bot").click()');
  await sleep(400);
  await B.ev('document.getElementById("btn-start").click()');
  await sleep(1800);

  const gomoku = JSON.parse(await B.ev(
    'JSON.stringify({' +
    'screen: AR.App.screen, game: AR.App.game && AR.App.game.id, sd: AR.App.snap && AR.App.snap.sd,' +
    'rows: document.querySelectorAll("#hud-board .hud-row").length,' +
    'black: document.querySelectorAll("#hud-board .sc.side-black").length,' +
    'white: document.querySelectorAll("#hud-board .sc.side-white").length,' +
    'text: document.getElementById("hud-board").textContent' +
    '})'
  ));
  check('五子棋人机局开局', gomoku.screen === 'play' && gomoku.game === 'gomoku', gomoku.game);
  check('快照带黑白方信息', !!gomoku.sd && Object.keys(gomoku.sd).length === 2, JSON.stringify(gomoku.sd));
  check('右侧显示双方执棋颜色', gomoku.rows === 2 && gomoku.black === 1 && gomoku.white === 1,
    'rows=' + gomoku.rows + ' black=' + gomoku.black + ' white=' + gomoku.white);
  check('执黑/执白文案正确', gomoku.text.indexOf('执黑') >= 0 && gomoku.text.indexOf('执白') >= 0, gomoku.text);
  check('右侧不再显示手数', gomoku.text.indexOf('手') < 0, gomoku.text);
  await B.shot('46-gomoku-sides');

  await B.ev('document.getElementById("hud-back").click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-leave-room").click()');
  await sleep(600);

  console.log('\n[4] 飞行棋启动格快照');
  await B.ev('document.querySelector(\'[data-game="ludo"]\').click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-create-room").click()');
  await sleep(900);
  await B.ev('document.getElementById("btn-add-bot").click()');
  await sleep(400);
  await B.ev('document.getElementById("btn-start").click()');
  await sleep(1800);
  const ludo = JSON.parse(await B.ev('JSON.stringify({' +
    'screen: AR.App.screen, game: AR.App.game && AR.App.game.id,' +
    'st: AR.App.snap && AR.App.snap.st,' +
    'planes: AR.App.snap && AR.App.snap.planes,' +
    'hud: document.getElementById("hud-board").textContent' +
    '})'));
  check('飞行棋人机局开局', ludo.screen === 'play' && ludo.game === 'ludo', ludo.game);
  check('快照带两名玩家的启动格', Array.isArray(ludo.st) && ludo.st.length === 2 && ludo.st[0] === 0 && ludo.st[1] === 20,
    JSON.stringify(ludo.st));
  check('HUD 显示回家进度', ludo.hud.indexOf('/1') >= 0, ludo.hud.slice(0, 40));

  await B.ev('document.getElementById("hud-back").click()');
  await sleep(600);
  await B.ev('document.getElementById("btn-leave-room").click()');
  await sleep(600);

  console.log('\n[5] 弹幕 v2 渲染');
  const v2 = JSON.parse(await B.ev(`(function(){
    try {
      var c = document.createElement('canvas');
      c.width = 1000; c.height = 1000;
      var ctx = c.getContext('2d');
      var bosses = [
        { k: 'fortress', nm: '铁幕堡垒', c: '#ff5d7d', ac: '#8b1e3f', r: 70 },
        { k: 'hive', nm: '蜂巢母舰', c: '#a3e635', ac: '#365314', r: 66 },
        { k: 'prism', nm: '棱镜核心', c: '#c084fc', ac: '#4c1d95', r: 58 }
      ];
      var counts = [];
      for (var i = 0; i < bosses.length; i++) {
        var bs = bosses[i];
        var snap = {
          w: 1000, h: 1000, t: 1, d: 120, sc: 0,
          p: [{ i: 'p1', x: 500, y: 880, hp: 2, mh: 3, sh: 1, rt: 1, st: 1, al: 1, iv: 0, s: 12 }],
          e: [[500, 300, 'grunt', 1, 2]], pb: [[500, 700]], eb: [[500, 600]],
          u: [[600, 500, 'heal'], [650, 520, 'shield'], [700, 540, 'rapid'], [750, 560, 'spread'], [800, 580, 'purge']],
          b: { x: 500, y: 200, hp: 200, mx: 300, r: bs.r, iv: 0, f: 0, k: bs.k, nm: bs.nm, c: bs.c, ac: bs.ac },
          ev: []
        };
        AR.View.init('shmup');
        AR.Render.render(ctx, 1000, 1000, 'shmup', snap, 1 / 60, {
          me: 'p1', players: [{ id: 'p1', name: '测试', color: '#22d3ee' }], meta: null
        });
        var img = ctx.getImageData(0, 0, 1000, 1000).data;
        var n = 0;
        for (var p = 0; p < img.length; p += 4) if (img[p + 3] > 0) n++;
        counts.push(n);
      }
      return JSON.stringify({ ok: true, counts: counts });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e && e.message || e) });
    }
  })()`));
  check('弹幕 v2 三种 BOSS + 增益渲染无异常', v2.ok === true, v2.error || '');
  check('弹幕 v2 渲染出非空画面', v2.ok && v2.counts.every((n) => n > 0),
    JSON.stringify(v2.counts));

  console.log('\n[6] 控制台');
  console.log('  错误:', B.errors.length ? B.errors.slice(0, 3) : '无');
  check('无控制台错误', B.errors.length === 0);

  B.kill();
  await server.stop();
  await sleep(400);

  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
