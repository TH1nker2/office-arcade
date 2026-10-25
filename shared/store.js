/* ============================================================
 * 数据层入口：优先 SQLite（node:sqlite），不可用时回退 JSON
 * ============================================================ */
'use strict';

const path = require('path');

function open(baseFile) {
  let sqliteErr = null;

  if (process.env.ARCADE_STORE === 'json') {
    console.log('[store] 环境变量指定 JSON 存储');
    return require('./store-json').open(baseFile + '.json');
  }

  try {
    const sqlite = require('./store-sqlite');
    const store = sqlite.open(baseFile + '.sqlite');
    console.log('[store] 使用 SQLite：' + path.basename(baseFile) + '.sqlite');
    return store;
  } catch (e) {
    sqliteErr = e;
  }

  try {
    require('node:sqlite');
  } catch (e) {
    sqliteErr = e;
  }

  console.warn('[store] SQLite 不可用（' + (sqliteErr && sqliteErr.message) + '），回退到 JSON 存储');
  const json = require('./store-json');
  return json.open(baseFile + '.json');
}

module.exports = { open };
