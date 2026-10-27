#!/usr/bin/env node
/* 管理后台词库查看：真实浏览器端到端 */
'use strict';

const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9240 + Math.floor(Math.random() * 40);
const DATA = path.join(os.tmpdir(), 'arcade-admin-words-' + PORT);
const { Browser, EDGE, sleep } = require('./lib/browser');
const { startServer } = require('./lib/fixture');

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

async function wordInfo(B) {
  return JSON.parse(await B.ev('JSON.stringify({' +
    'hint:document.getElementById("word-hint").textContent,' +
    'rows:document.querySelectorAll("#word-table .word-row:not(.head)").length,' +
    'firstHints:document.querySelectorAll("#word-table .word-row:not(.head) .word-hints span").length,' +
    'counts:Array.prototype.map.call(document.querySelectorAll("#word-levels .seg-btn .seg-num"),function(x){return x.textContent;})' +
    '})'));
}

async function main() {
  if (!EDGE) { console.log('找不到 Edge/Chrome，跳过'); process.exit(0); }
  const server = await startServer({ root: ROOT, port: PORT, data: DATA, waitMs: 1400 });

  const B = new Browser('admin', 9985);
  await B.launch();
  await B.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/admin.html' });
  await sleep(1200);

  console.log('[1] 登录');
  await B.ev('document.getElementById("admin-user").value = "admin"');
  await B.ev('document.getElementById("admin-pass").value = "admin888"');
  await B.ev('document.getElementById("login-btn").click()');
  await sleep(1100);
  check('登录后进入管理后台', await B.ev('document.getElementById("admin-panel").classList.contains("active")'));

  console.log('\n[2] 打开词库');
  await B.ev('document.querySelector(\'#admin-tabs [data-view="words"]\').click()');
  await sleep(900);
  let info = await wordInfo(B);
  check('三个难度各 500', info.counts.join(',') === '500,500,500', info.counts.join(','));
  check('词库提示显示 500', info.hint.indexOf('500') >= 0, info.hint);
  check('简单档渲染 500 行', info.rows === 500, 'rows=' + info.rows);
  check('每条展示 4 条提示', info.firstHints === 2000, 'hint spans=' + info.firstHints);
  await B.shot('82-admin-words');

  console.log('\n[3] 搜索与切换');
  await B.ev('var i=document.getElementById("word-search"); i.value="苹果"; i.dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(300);
  info = await wordInfo(B);
  check('简单档搜索有结果', info.rows >= 1 && info.hint.indexOf('匹配') >= 0, info.hint);
  const easyText = await B.ev('document.getElementById("word-table").textContent');
  check('搜索结果包含苹果', easyText.indexOf('苹果') >= 0, easyText.slice(0, 40));

  await B.ev('var i=document.getElementById("word-search"); i.value=""; i.dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(180);
  await B.ev('document.querySelector(\'#word-levels [data-level="hard"]\').click()');
  await sleep(900);
  info = await wordInfo(B);
  check('切到困难档', info.hint.indexOf('困难') >= 0 && info.hint.indexOf('500') >= 0, info.hint);
  check('困难档渲染 500 行', info.rows === 500, 'rows=' + info.rows);

  await B.ev('var i=document.getElementById("word-search"); i.value="画蛇添足"; i.dispatchEvent(new Event("input",{bubbles:true}))');
  await sleep(300);
  info = await wordInfo(B);
  check('困难档搜索命中一个词', info.rows === 1 && info.hint.indexOf('匹配 1 / 500') >= 0, info.hint);
  const hardText = await B.ev('document.getElementById("word-table").textContent');
  check('搜索结果是画蛇添足', hardText.indexOf('画蛇添足') >= 0, hardText.slice(0, 40));

  console.log('\n[4] 管理弹窗焦点');
  await B.ev('fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({username:"dlguser",password:"123456",nickname:"弹窗测试"})}).then(function(r){return r.json()})');
  await sleep(400);
  await B.ev('document.querySelector(\'#admin-tabs [data-view="users"]\').click()');
  await sleep(500);
  await B.ev('document.getElementById("btn-refresh").click()');
  await sleep(700);
  const opened = JSON.parse(await B.ev(`(function(){
    var rows = document.querySelectorAll('#user-table .admin-row:not(.head)');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf('弹窗测试') < 0) continue;
      var btn = rows[i].querySelector('button[data-act="ban"]');
      if (!btn) continue;
      btn.click();
      return JSON.stringify({ ok: true });
    }
    return JSON.stringify({ ok: false });
  })()`));
  await sleep(300);
  const dlg = JSON.parse(await B.ev(`JSON.stringify({
    hidden: document.getElementById('dialog').classList.contains('hidden'),
    aria: document.getElementById('dialog').getAttribute('aria-hidden'),
    inside: document.getElementById('dialog').contains(document.activeElement)
  })`));
  check('管理弹窗能打开', opened.ok === true && dlg.hidden === false, JSON.stringify(dlg));
  check('管理弹窗 aria-hidden=false', dlg.aria === 'false', dlg.aria);
  check('管理弹窗焦点在内部', dlg.inside === true);
  await B.ev('document.getElementById("dialog").dispatchEvent(new KeyboardEvent("keydown",{code:"Escape",bubbles:true,cancelable:true}))');
  await sleep(150);
  check('Esc 关闭管理弹窗',
    await B.ev('document.getElementById("dialog").classList.contains("hidden")'));

  console.log('\n[5] 控制台');
  console.log('  错误:', B.errors.length ? B.errors.slice(0, 3) : '无');
  check('无控制台错误', B.errors.length === 0);

  B.kill();
  await server.stop();
  console.log('');
  console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.stack || e);
  process.exit(1);
});
