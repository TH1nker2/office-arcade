'use strict';
/* 服务端配置：路径、端口、版本、数据目录与存储实例 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || process.argv[2] || '8090', 10);
const HOST = process.env.HOST || '0.0.0.0';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 256 * 1024;
const MAX_STATE_BUFFER = 512 * 1024;
const MAX_SEND_BUFFER = 4 * 1024 * 1024;
const ROUND_OVER_MS = 8000;
const SESSION_DAYS = 7;
const COOKIE = 'sid';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function loadVersion() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    return {
      version: String(raw.version || '0.0.0'),
      released: String(raw.released || ''),
      notes: Array.isArray(raw.notes) ? raw.notes.map(String) : [],
      history: Array.isArray(raw.history) ? raw.history : []
    };
  } catch (e) {
    console.warn('[version] 读取 version.json 失败（' + e.message + '）');
    return { version: '0.0.0', released: '', notes: [], history: [] };
  }
}

const VERSION = loadVersion();
const VERSION_TAG = 'v' + VERSION.version;

function resolveDataDir() {
  /* 数据目录默认在程序目录下；测试和临时演示可用 ARCADE_DATA 覆盖。 */
  if (process.env.ARCADE_DATA) return process.env.ARCADE_DATA;
  return path.join(ROOT, 'data');
}

const DATA_DIR = resolveDataDir();
const store = require('../shared/store').open(path.join(DATA_DIR, 'arcade'));

module.exports = {
  ROOT,
  PORT,
  HOST,
  WS_GUID,
  MAX_MESSAGE,
  MAX_STATE_BUFFER,
  MAX_SEND_BUFFER,
  ROUND_OVER_MS,
  SESSION_DAYS,
  COOKIE,
  MIME,
  VERSION,
  VERSION_TAG,
  DATA_DIR,
  store
};
