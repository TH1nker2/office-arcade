#!/usr/bin/env node
/* 测试用服务器夹具：临时数据目录、启动等待、日志收集、清理 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(opts) {
  const root = opts.root;
  const port = opts.port;
  const data = opts.data || path.join(os.tmpdir(), (opts.prefix || 'arcade') + '-' + port);
  try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  fs.mkdirSync(data, { recursive: true });

  const child = spawn(process.execPath, [path.join(root, 'server.js'), String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { ARCADE_DATA: data })
  });

  let log = '';
  child.stdout.on('data', (d) => log += d.toString());
  child.stderr.on('data', (d) => log += d.toString());
  await sleep(opts.waitMs || 1400);

  if (opts.expectBanner !== false && log.indexOf('localhost:' + port) < 0) {
    try { child.kill(); } catch (e) { /* ignore */ }
    throw new Error('服务器未启动\n' + log);
  }

  return {
    child,
    data,
    log: () => log,
    async stop() {
      try { child.kill(); } catch (e) { /* ignore */ }
      await sleep(opts.stopMs || 400);
      try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  };
}

module.exports = { startServer, sleep };
