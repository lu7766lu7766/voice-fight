'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../server/game');
const { makeBot, chooseMove } = require('../server/bot');

function duel(levelA, levelB, seed = 1) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let casts = [0, 0];
  const game = new Game({ charIds: ['xiaoyao', 'anu'], now: 0, onEvent: (t, p) => { if (t === 'skill') casts[p.slot]++; } });
  const bots = [makeBot(game, 0, levelA, rand), makeBot(game, 1, levelB, rand)];
  let now = 0;
  while (!game.over && now < 600000) { now += 50; game.update(now); bots.forEach(b => b(now)); }
  return { game, now, casts };
}

test('電腦對手會自己出招並打完一場', () => {
  const { game, casts } = duel('normal', 'normal');
  assert.ok(game.over);
  assert.ok(casts[0] > 3 && casts[1] > 3);
});

test('困難比簡單出招更快', () => {
  let hard = 0;
  for (let k = 1; k <= 20; k++) if (duel('hard', 'easy', k).game.winner === 0) hard++;
  assert.ok(hard >= 15, `困難只贏了 ${hard}/20`);
});

test('低血量時聰明的電腦會優先補血', () => {
  const game = new Game({ charIds: ['anu', 'xiaoyao'], now: 0 });
  const f = game.fighters[0];
  f.hp = Math.round(f.maxHp * 0.3);
  game.avail[0] = ['百草回春', '蠱毒'];
  assert.strictEqual(chooseMove(game, 0, true).name, '百草回春');
});
