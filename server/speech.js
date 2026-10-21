'use strict';
// 語音辨識結果比對：把聽到的句子和自己的招式逐字比拼音（不分聲調），算出相似分數。
//  - 同音字、破音字、繁簡差異視為相同
//  - 台灣口音：zh/z、ch/c、sh/s、n/l、in/ing、en/eng、f/h(u) 不分
//  - 讀音相近（如 jian / qian）給部分分數
//  - 容許句子裡多出或漏掉字（「我要用萬劍歸宗」、「萬劍…宗」）
// 招式選單很小（每人 5 招），所以可以比通用辨識寬鬆很多。

const { pinyin } = require('pinyin-pro');

const MATCH_THRESHOLD = 0.62; // 招式
const STRICT_THRESHOLD = 0.9; // 重置等指令，避免誤觸
const MISS_MOVE = 0.5;        // 招式中的字沒唸到
const EXTRA_WORD = 0.35;      // 招式中間多出雜字

const cache = new Map();
const DIGITS = '零一二三四五六七八九';

function normSyllable(s) {
  return s.toLowerCase()
    .replace(/ü|v/g, 'u')
    .replace(/^zh/, 'z').replace(/^ch/, 'c').replace(/^sh/, 's')
    .replace(/^l/, 'n')
    .replace(/^f(?=u)/, 'h')
    .replace(/ing$/, 'in').replace(/eng$/, 'en');
}

// 單一字的所有可能讀音（raw = 原始拼音；預設回傳口音正規化後的拼音）
function readings(ch, raw = false) {
  const key = (raw ? 'r:' : 'n:') + ch;
  if (cache.has(key)) return cache.get(key);
  let list = [];
  if (/[㐀-鿿]/.test(ch)) {
    list = pinyin(ch, { multiple: true, type: 'array', toneType: 'none' });
    list = [...new Set(raw ? list : list.map(normSyllable))];
  }
  cache.set(key, list);
  return list;
}

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

// 兩個字的相似度 0~1；strict 時只認同字或完全同音（不套口音、不給部分分數）
function charSim(a, b, strict) {
  if (a === b) return 1;
  if (strict) {
    const rb = readings(b, true);
    return readings(a, true).some(x => rb.includes(x)) ? 1 : 0;
  }
  const ra = readings(a), rb = readings(b);
  let best = 0;
  for (const x of ra) for (const y of rb) {
    if (x === y) return 1;
    const s = 1 - lev(x, y) / Math.max(x.length, y.length);
    if (s > best) best = s;
  }
  // 讀音差一個音素（例如 jian/qian、gui/kui）給部分分數，差太多視為不同字
  return best >= 0.6 ? best * 0.75 : 0;
}

function cleanTranscript(text) {
  const s = String(text || '').replace(/[0-9]/g, d => DIGITS[d]);
  return [...s].filter(ch => /[㐀-鿿]/.test(ch));
}

// 招式（必須整個比對）vs 句子（頭尾可多字）的對齊分數，回傳 0~1
function wordScore(chars, word, strict = false) {
  const w = [...word];
  const L = w.length, T = chars.length;
  if (!T) return 0;
  // D[i][j]：招式前 i 個字對齊到句子第 j 個字為止的最高分
  let prev = new Array(T + 1).fill(0);
  for (let i = 1; i <= L; i++) {
    const cur = new Array(T + 1).fill(-Infinity);
    cur[0] = prev[0] - MISS_MOVE;
    for (let j = 1; j <= T; j++) {
      cur[j] = Math.max(
        prev[j - 1] + charSim(w[i - 1], chars[j - 1], strict),
        prev[j] - MISS_MOVE,
        i > 1 ? cur[j - 1] - EXTRA_WORD : -Infinity
      );
    }
    prev = cur;
  }
  return Math.max(0, Math.max(...prev) / L);
}

// 依相似度排序回傳 [{ word, score }]（只含超過門檻者）
// strictWords：需要更高分才算數的詞（例如「重置」）
function rankWords(transcript, words, strictWords = []) {
  const chars = cleanTranscript(transcript);
  const out = [];
  for (const word of words) {
    const strict = strictWords.includes(word);
    const score = wordScore(chars, word, strict);
    const need = strict ? STRICT_THRESHOLD : MATCH_THRESHOLD;
    if (score >= need) out.push({ word, score });
  }
  return out.sort((a, b) => b.score - a.score || b.word.length - a.word.length);
}

function matchWords(transcript, words, strictWords) {
  return rankWords(transcript, words, strictWords).map(r => r.word);
}

module.exports = { rankWords, matchWords, wordScore, normSyllable, cleanTranscript, MATCH_THRESHOLD };
