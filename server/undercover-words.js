'use strict';
/* 谁是卧底词对加载：主词库在 shared/undercover-words.json，缺失时用内置兜底 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'shared', 'undercover-words.json');

const FALLBACK = [
  { a: '可乐', b: '雪碧', category: '饮食' },
  { a: '苹果', b: '梨', category: '饮食' },
  { a: '猫', b: '狗', category: '动物' },
  { a: '医生', b: '护士', category: '职业' },
  { a: '电影院', b: '剧院', category: '场所' },
  { a: '手机', b: '平板', category: '科技' },
  { a: '公交', b: '地铁', category: '交通' },
  { a: '篮球', b: '排球', category: '运动' },
  { a: '直播', b: '短视频', category: '网络' },
  { a: '咖啡', b: '奶茶', category: '饮食' },
  { a: '老虎', b: '狮子', category: '动物' },
  { a: '铅笔', b: '钢笔', category: '日常' }
];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const out = [];
    const seen = new Set();
    (raw.pairs || []).forEach((p) => {
      const a = String(p && p.a || '').trim();
      const b = String(p && p.b || '').trim();
      if (!a || !b || a === b) return;
      if (seen.has(a) || seen.has(b)) return;
      seen.add(a);
      seen.add(b);
      out.push({ a: a, b: b, category: String(p.category || '') });
    });
    if (out.length >= 10) return out;
    console.warn('[undercover] shared/undercover-words.json 词对不足，使用内置词对');
  } catch (e) {
    console.warn('[undercover] 读取词对失败（' + e.message + '），使用内置词对');
  }
  return FALLBACK.slice();
}

const UNDERCOVER_PAIRS = load();

module.exports = { UNDERCOVER_PAIRS };
