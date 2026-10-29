#!/usr/bin/env node
/* SQLite 结构迁移：v1 旧库升级到 v2，补 banned 字段且保留旧数据 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(os.tmpdir(), 'arcade-migration-test-' + process.pid + '.sqlite');

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) fails++;
}

function cleanup() {
  for (const f of [FILE, FILE + '-wal', FILE + '-shm']) {
    try { fs.rmSync(f, { force: true }); } catch (e) { /* ignore */ }
  }
}
cleanup();

const old = new DatabaseSync(FILE);
old.exec(`
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  nickname TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#22d3ee',
  avatar TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  rounds INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL DEFAULT 0
);
PRAGMA user_version = 1;
`);
old.prepare('INSERT INTO users (username, pass_hash, salt, nickname, created_at) VALUES (?, ?, ?, ?, ?)')
  .run('old_user', 'hash', 'salt', '旧玩家', Date.now());
old.close();

const { open } = require(path.join(ROOT, 'shared', 'store-sqlite'));
const store = open(FILE);
const user = store.userById(1);
ok('旧用户保留', !!user && user.username === 'old_user' && user.nickname === '旧玩家',
  user ? user.username : 'missing');
ok('迁移后默认未封禁', user && user.banned === 0, user && String(user.banned));
store.updateUser(1, { banned: 1 });
ok('迁移后可写 banned', store.userById(1).banned === 1);
store.close();

const check = new DatabaseSync(FILE);
const version = Number(check.prepare('PRAGMA user_version').get().user_version);
const cols = check.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const count = Number(check.prepare('SELECT COUNT(*) AS c FROM users').get().c);
check.close();
ok('结构版本升到 v2', version === 2, 'version=' + version);
ok('users 表包含 banned', cols.indexOf('banned') >= 0, cols.join(','));
ok('旧数据未丢失', count === 1, 'count=' + count);

cleanup();
console.log(fails === 0 ? '全部通过' : fails + ' 项失败');
process.exit(fails === 0 ? 0 : 1);
