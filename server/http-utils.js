'use strict';
/* HTTP 基础工具：JSON 响应、Cookie、请求体读取 */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  const headers = Object.assign({}, SECURITY_HEADERS, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(body);
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch (e) {
      /* 畸形百分号编码不能让整个请求/WS 升级崩掉；原样保留，后续鉴权自然失败 */
      out[key] = raw;
    }
  });
  return out;
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (d) => {
      size += d.length;
      if (size > (limit || 256 * 1024)) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(d);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

module.exports = { json, parseCookies, readJson, SECURITY_HEADERS };
