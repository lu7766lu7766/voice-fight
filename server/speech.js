'use strict';
// 語音辨識結果比對：以拼音（不分聲調）比對，容忍同音字、繁簡差異與常見台灣口音
// （zh/z、ch/c、sh/s、n/l、in/ing、en/eng 不分）。

const { pinyin } = require('pinyin-pro');

const cache = new Map();

function normSyllable(s) {
  return s.toLowerCase()
    .replace(/ü|v/g, 'u')
    .replace(/^zh/, 'z').replace(/^ch/, 'c').replace(/^sh/, 's')
    .replace(/^l/, 'n')
    .replace(/ing$/, 'in').replace(/eng$/, 'en');
}

// 單一字的所有可能讀音（正規化後）
function readings(ch) {
  if (cache.has(ch)) return cache.get(ch);
  let set;
  if (/[㐀-鿿]/.test(ch)) {
    const list = pinyin(ch, { multiple: true, type: 'array', toneType: 'none' });
    set = new Set(list.map(normSyllable));
  } else {
    set = new Set();
  }
  cache.set(ch, set);
  return set;
}

function charsMatch(a, b) {
  if (a === b) return true;
  const ra = readings(a), rb = readings(b);
  for (const r of ra) if (rb.has(r)) return true;
  return false;
}

function cleanTranscript(text) {
  return [...String(text || '')].filter(ch => /[㐀-鿿]/.test(ch));
}

// 傳回 transcript 中念到的詞（依在句中出現順序）。
function matchWords(transcript, words) {
  const chars = cleanTranscript(transcript);
  const hits = [];
  for (const word of words) {
    const w = [...word];
    const allowMiss = w.length >= 4 ? 1 : 0;
    for (let s = 0; s + w.length <= chars.length; s++) {
      let miss = 0;
      for (let k = 0; k < w.length && miss <= allowMiss; k++) {
        if (!charsMatch(chars[s + k], w[k])) miss++;
      }
      if (miss <= allowMiss) { hits.push({ word, pos: s, miss }); break; }
    }
  }
  hits.sort((a, b) => a.miss - b.miss || a.pos - b.pos || b.word.length - a.word.length);
  return hits.map(h => h.word);
}

module.exports = { matchWords, normSyllable, cleanTranscript };
