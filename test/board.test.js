'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Board } = require('../server/board');
const { CHARACTERS } = require('../public/shared/characters');

const sets = CHARACTERS.map(c => c.moves.map(m => m.name));

function makeBoard(a, b) {
  const board = new Board();
  board.setMovesets([sets[a], sets[b]]);
  board.generate();
  return board;
}

test('新盤面保證雙方各至少 3 個招式（初始多種一個）', () => {
  for (let k = 0; k < 300; k++) {
    const a = k % sets.length, b = (k * 7 + 1) % sets.length;
    const board = makeBoard(a, b);
    assert.ok(board.available(sets[a]).length >= 3, 'player A');
    assert.ok(board.available(sets[b]).length >= 3, 'player B');
  }
});

test('連續消除 2000 次後，每次都仍保證雙方至少 2 個招式', () => {
  const board = makeBoard(0, 1);
  for (let k = 0; k < 2000; k++) {
    const p = k % 2;
    const avail = board.available(board.movesets[p]);
    assert.ok(avail.length >= 2, `第 ${k} 次：玩家 ${p} 只剩 ${avail.length} 個`);
    const path = board.findPath(avail[Math.floor(Math.random() * avail.length)]);
    board.removeAndCollapse(path);
    assert.ok(board.available(board.movesets[1 - p]).length >= 2);
  }
});

test('消除後方塊往下掉、頂端補新格，id 不重複', () => {
  const board = makeBoard(2, 3);
  const before = board.cells.map(c => c.id);
  const word = board.available(board.movesets[0])[0];
  const path = board.findPath(word);
  const removedIds = new Set(path.map(i => board.cells[i].id));
  board.removeAndCollapse(path);
  const after = board.cells.map(c => c.id);
  assert.strictEqual(new Set(after).size, after.length);
  for (const id of removedIds) assert.ok(!after.includes(id));
  // 未消除的格子必須仍在同一欄，且只會往下移
  before.forEach((id, i) => {
    if (removedIds.has(id)) return;
    const j = after.indexOf(id);
    if (j < 0) return; // 被種招式改寫
    assert.strictEqual(j % board.cols, i % board.cols);
    assert.ok(Math.floor(j / board.cols) >= Math.floor(i / board.cols));
  });
});

test('路徑驗證：必須相鄰（含斜角）且不可重複使用同一格', () => {
  const board = new Board({ cols: 3, rows: 3 });
  board.setMovesets([['甲乙丙'], []]);
  '甲乙丙丁戊己庚辛壬'.split('').forEach((ch, i) => { board.cells[i] = { id: i + 1, ch }; });
  assert.ok(board.pathSpells([0, 1, 2], '甲乙丙'));
  assert.ok(!board.pathSpells([0, 2, 1], '甲丙乙'), '0 與 2 不相鄰');
  board.cells[4].ch = '乙';
  assert.ok(board.pathSpells([0, 4, 2], '甲乙丙'), '斜角相連');
  assert.ok(!board.pathSpells([0, 0, 2], '甲甲丙'));
  assert.deepStrictEqual(board.findPaths('甲乙丙').length, 2);
});
