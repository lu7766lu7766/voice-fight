'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, C } = require('../server/game');

function setup(a = 'lingfeng', b = 'lingyue') {
  const events = [];
  const game = new Game({ charIds: [a, b], now: 0, onEvent: (t, p) => events.push([t, p]) });
  return { game, events };
}

test('集氣未滿不能出招，滿了才可以', () => {
  const { game } = setup();
  const word = game.avail[0][0];
  assert.strictEqual(game.castSkill(0, word).reason, 'gauge');
  game.update(20000);
  assert.strictEqual(game.fighters[0].gauge, C.GAUGE_MAX);
  assert.ok(game.castSkill(0, word).ok);
  assert.strictEqual(game.fighters[0].gauge, 0);
});

test('身法越高集氣越快', () => {
  const { game } = setup('jingyuan', 'yuer'); // 身法 48 vs 62
  game.update(3000);
  assert.ok(game.fighters[1].gauge > game.fighters[0].gauge);
});

test('不能使用對手的招式、盤面上沒有的招式', () => {
  const { game } = setup();
  game.update(20000);
  assert.strictEqual(game.castSkill(0, '雷咒').reason, 'notyours');
  const missing = game.fighters[0].ch.moves.map(m => m.name).find(m => !game.avail[0].includes(m));
  if (missing) assert.strictEqual(game.castSkill(0, missing).reason, 'notonboard');
});

test('出招會消除方塊並在命中時刻造成傷害', () => {
  const { game, events } = setup();
  game.update(20000);
  const atk = game.fighters[0].ch.moves.find(m => m.type === 'atk' || m.type === 'multi');
  // 確保該招式在盤面上：直接種到盤面
  if (!game.board.hasWord(atk.name)) {
    [...atk.name].forEach((ch, k) => { game.board.cells[k].ch = ch; });
  }
  const hp = game.fighters[1].hp;
  assert.ok(game.castSkill(0, atk.name).ok);
  const skill = events.find(e => e[0] === 'skill')[1];
  assert.strictEqual(skill.pathIds.length, [...atk.name].length);
  assert.strictEqual(game.fighters[1].hp, hp, '命中前不扣血');
  game.update(20000 + C.SKILL_IMPACT + 2000);
  assert.ok(game.fighters[1].hp < hp);
});

test('重置每場只有一次，重置後仍保證有招式', () => {
  const { game } = setup();
  assert.ok(game.reset(1).ok);
  assert.strictEqual(game.reset(1).reason, 'noreset');
  assert.ok(game.avail[0].length >= 2 && game.avail[1].length >= 2);
});

test('沒有普攻，只能靠招式造成傷害', () => {
  const { game } = setup();
  assert.strictEqual(game.normalAttack, undefined);
  game.update(60000);
  assert.strictEqual(game.fighters[1].hp, game.fighters[1].maxHp, '只集氣不出招不會扣血');
});

test('氣血歸零即結束，之後不能再行動', () => {
  const { game, events } = setup();
  game.fighters[1].hp = 1;
  for (let t = 0; t < 120000 && !game.over; t += 100) {
    game.update(t);
    const atk = game.avail[0].find(n => ['atk', 'multi', 'drain', 'dot', 'debuff'].includes(game.fighters[0].ch.moves.find(m => m.name === n).type));
    if (atk) game.castSkill(0, atk);
  }
  assert.ok(game.over);
  assert.strictEqual(game.winner, 0);
  assert.ok(events.some(e => e[0] === 'ko'));
  game.fighters[1].gauge = 100;
  assert.strictEqual(game.castSkill(1, game.fighters[1].ch.moves[0].name).reason, 'over');
});
