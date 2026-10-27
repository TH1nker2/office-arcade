'use strict';
/* 你画我猜词库加载与答案归一化 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORDS_FILE = path.join(ROOT, 'shared', 'words.json');

function wordMeta(raw) {
  const fallback = {
    easy: { name: '简单', desc: '水果、动物、日用品这类看得见摸得着的东西' },
    normal: { name: '中等', desc: '职业、场所、动作、场景，需要一点联想' },
    hard: { name: '困难', desc: '画面感强的成语，以及可画的科技、运动、场所与网络热词' }
  };
  const out = {};
  ['easy', 'normal', 'hard'].forEach(function (lv) {
    const sec = raw && raw.levels && raw.levels[lv];
    out[lv] = {
      name: (sec && sec.name) || fallback[lv].name,
      desc: (sec && sec.desc) || fallback[lv].desc
    };
  });
  return out;
}

function loadWords() {
  const empty = { easy: [], normal: [], hard: [], meta: wordMeta(null) };
  try {
    const raw = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf8'));

    if (raw && raw.levels) {
      const out = { easy: [], normal: [], hard: [] };
      ['easy', 'normal', 'hard'].forEach(function (lv) {
        const sec = raw.levels[lv];
        if (!sec || !Array.isArray(sec.words)) return;
        sec.words.forEach(function (it) {
          if (typeof it === 'string' && it.trim()) {
            out[lv].push({ w: it.trim(), h: [] });
          } else if (it && it.w) {
            out[lv].push({
              w: String(it.w).trim(),
              h: Array.isArray(it.h) ? it.h.slice(0, 4).map(String) : []
            });
          }
        });
        console.log('[words] ' + lv + ': ' + out[lv].length + ' 个');
      });
      if (!out.easy.length && !out.normal.length && !out.hard.length) return empty;
      out.meta = wordMeta(raw);
      return out;
    }

    const list = Array.isArray(raw) ? raw : (raw && raw.words) || [];
    const out = [];
    const seen = new Set();
    list.forEach((w) => {
      const t = String(w == null ? '' : w).trim();
      if (!t || t.length > 16 || seen.has(t)) return;
      seen.add(t);
      out.push(t);
    });
    return { easy: out.slice(), normal: out.slice(), hard: out.slice(), meta: wordMeta(null) };
  } catch (e) {
    console.warn('[words] 读取 shared/words.json 失败（' + e.message + '），改用内置词库');
    return empty;
  }
}

function normAnswer(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?~～·\-_]/g, '')
    .trim();
}

const WORDS = loadWords();

module.exports = { WORDS, wordMeta, loadWords, normAnswer };
