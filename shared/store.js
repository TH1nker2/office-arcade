/* ============================================================
 * 数据层入口：优先 SQLite（node:sqlite），不可用时回退 JSON
 * ============================================================ */
'use strict';

const path = require('path');

function open(baseFile) {
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
    const msg = String((e && e.message) || '');
    /* 数据库被另一个进程占着：绝不能退回 JSON，否则同一套数据会分裂成两份 */
    if (/locked|busy/i.test(msg)) {
      console.error('');
      console.error('  [致命] 数据库正被另一个进程占用（' + msg + '）');
      console.error('  多半是还有一个游戏厅在跑。请先关掉那个窗口/进程，再重新启动。');
      console.error('');
      process.exit(1);
    }
    if (e && e.fatal) {
      console.error('');
      console.error('  [致命] ' + e.message);
      console.error('  程序已退出，没有任何数据被改动。');
      console.error('');
      process.exit(1);
    }

    /* 只有 node:sqlite 模块本身不可用时才允许 JSON 回退。
       数据库已存在但打开失败（权限/损坏/迁移错误）时如果回退 JSON，
       会悄悄生成第二套账号数据，后果比直接退出更严重。 */
    try {
      require('node:sqlite');
    } catch (modErr) {
      console.warn('[store] SQLite 不可用（' + modErr.message + '），回退到 JSON 存储');
      const json = require('./store-json');
      try {
        return json.open(baseFile + '.json');
      } catch (jsonErr) {
        const dir = path.dirname(baseFile);
        console.error('');
        console.error('  [致命] 无法创建数据目录：' + dir);
        console.error('  原因：' + jsonErr.message);
        console.error('');
        console.error('  可以这样解决：');
        console.error('    1) 改用便携版（数据放程序目录下的 data\）');
        console.error('    2) 或者手动指定一个可写目录：设置环境变量 ARCADE_DATA');
        console.error('');
        process.exit(1);
      }
    }

    console.error('');
    console.error('  [致命] SQLite 数据库打开失败：' + msg);
    console.error('  数据库文件：' + baseFile + '.sqlite');
    console.error('  为避免回退 JSON 导致两份数据，程序已退出，没有任何数据被改动。');
    console.error('  请检查文件权限/磁盘空间；如果确认要用 JSON，请显式设置 ARCADE_STORE=json。');
    console.error('');
    process.exit(1);
  }
}

module.exports = { open };
