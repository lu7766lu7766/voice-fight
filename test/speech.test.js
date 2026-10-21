'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { matchWords: match } = require('../server/speech');
const matchWords = (t, words) => match(t, words, ['重置']);

const MOVES = ['御劍', '劍氣斬', '醉仙步', '天罡戰氣', '萬劍歸宗', '重置'];

test('直接念出招式', () => {
  assert.deepStrictEqual(matchWords('萬劍歸宗', MOVES), ['萬劍歸宗']);
  assert.deepStrictEqual(matchWords('我要用御劍！', MOVES), ['御劍']);
});

test('同音字、簡體字也能辨識', () => {
  assert.deepStrictEqual(matchWords('玉劍', MOVES), ['御劍']);
  assert.deepStrictEqual(matchWords('万剑归宗', MOVES), ['萬劍歸宗']);
  assert.deepStrictEqual(matchWords('最先步', MOVES), ['醉仙步']);
});

test('台灣口音：捲舌不分、ㄣㄥ不分', () => {
  assert.deepStrictEqual(matchWords('建器暫', MOVES), ['劍氣斬']); // zhan → zan
  assert.deepStrictEqual(matchWords('天剛站氣', MOVES), ['天罡戰氣']);
});

test('四字招式容許聽錯或漏掉一個字', () => {
  assert.deepStrictEqual(matchWords('萬劍規中', MOVES), ['萬劍歸宗']);
  assert.deepStrictEqual(matchWords('萬劍哈宗', MOVES), ['萬劍歸宗']);
  assert.deepStrictEqual(matchWords('萬劍宗', MOVES), ['萬劍歸宗']);
  assert.deepStrictEqual(matchWords('萬箭', MOVES), []);
});

test('讀音相近的字也算（j/q、g/k 等差一個音）', () => {
  assert.deepStrictEqual(matchWords('天剛戰器', MOVES), ['天罡戰氣']);
  assert.deepStrictEqual(matchWords('天光戰氣', MOVES), ['天罡戰氣']);
});

test('數字會轉成國字比對', () => {
  assert.deepStrictEqual(match('5氣朝元', ['五氣朝元', '雷咒']), ['五氣朝元']);
});

test('破音字：重置（chong / zhong）', () => {
  assert.deepStrictEqual(matchWords('重置', MOVES), ['重置']);
  assert.deepStrictEqual(matchWords('蟲制', MOVES), ['重置']);
});

test('重置要念得很準，常見詞不會誤觸', () => {
  assert.deepStrictEqual(matchWords('總之', MOVES), []);
  assert.deepStrictEqual(matchWords('蟲子', MOVES), []);
  assert.deepStrictEqual(matchWords('重製', MOVES), ['重置']);
});

test('不相干的話不會誤判', () => {
  assert.deepStrictEqual(matchWords('今天天氣很好', MOVES), []);
  assert.deepStrictEqual(matchWords('', MOVES), []);
  assert.deepStrictEqual(matchWords('hello', MOVES), []);
});
