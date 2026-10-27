#!/usr/bin/env node
/* 测试用 HTTP 请求工具 */
'use strict';

const http = require('http');

function makeRequest(port) {
  return function request(method, pathname, body, cookie) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const headers = { 'Content-Type': 'application/json' };
      if (cookie) headers.Cookie = cookie;
      if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
      const req = http.request({ host: '127.0.0.1', port: port, path: pathname, method, headers }, (res) => {
        let b = '';
        res.on('data', (d) => b += d);
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(b); } catch (e) { /* ignore */ }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  };
}

function cookieOf(res) {
  const sc = res.headers['set-cookie'];
  return sc && sc.length ? sc[0].split(';')[0] : '';
}

module.exports = { makeRequest, cookieOf };
