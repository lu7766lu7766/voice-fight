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

function grid(text, opts = {}) {
  const n = Math.sqrt([...text].length);
  const board = new Board({ cols: n, rows: n, ...opts });
  board.setMovesets([[], []]);
  [...text].forEach((ch, i) => { board.cells[i] = { id: i + 1, ch }; });
  return board;
}

test('上下左右相連即可，路徑可以轉彎（L 形、之字形）', () => {
  // 甲乙丙
  // 丁戊己
  // 庚辛壬
  const board = grid('甲乙丙丁戊己庚辛壬');
  assert.ok(board.pathSpells([0, 1, 2], '甲乙丙'), '橫向直線');
  assert.ok(board.pathSpells([0, 3, 6], '甲丁庚'), '直向直線');
  assert.ok(board.pathSpells([0, 1, 4], '甲乙戊'), 'L 形：右 → 下');
  assert.ok(board.pathSpells([2, 5, 4, 3], '丙己戊丁'), '下 → 左 → 左');
  assert.ok(board.pathSpells([0, 1, 4, 5, 8], '甲乙戊己壬'), '之字形');
  assert.ok(board.pathSpells([6, 3, 4, 1], '庚丁戊乙'), '上 → 右 → 上');
  assert.ok(board.hasWord('甲乙戊己壬'));
});

test('預設斜角不算相連；同一格不能重複使用；不相鄰不行', () => {
  const board = grid('甲乙丙丁戊己庚辛壬');
  assert.ok(!board.pathSpells([0, 4], '甲戊'), '斜角');
  assert.ok(!board.hasWord('甲戊壬'));
  assert.ok(!board.pathSpells([0, 2], '甲丙'), '隔一格');
  assert.ok(!board.pathSpells([0, 1, 0], '甲乙甲'), '重複使用');
});

test('開啟 diagonal 時斜角也算相連', () => {
  const board = grid('甲乙丙丁戊己庚辛壬', { diagonal: true });
  assert.ok(board.pathSpells([0, 4, 8], '甲戊壬'));
  assert.ok(board.hasWord('甲戊壬'));
});
