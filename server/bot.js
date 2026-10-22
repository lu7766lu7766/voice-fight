'use strict';
// 電腦對手：集氣滿後「找字」一段時間才出招，難度決定找字速度和選招聰明程度。

const LEVELS = {
  easy: { label: '簡單', delay: [4500, 8000], smart: false },
  normal: { label: '普通', delay: [2500, 5000], smart: true },
  hard: { label: '困難', delay: [1300, 2800], smart: true }
};

// 從盤面上找得到的招式中挑一招
function chooseMove(game, slot, smart, rand = Math.random) {
  const f = game.fighters[slot];
  const moves = game.avail[slot].map(n => f.ch.moves.find(m => m.name === n)).filter(Boolean);
  if (!moves.length) return null;
  const pickRandom = list => list[Math.floor(rand() * list.length)];
  if (!smart) return pickRandom(moves);
  const heals = moves.filter(m => m.type === 'heal');
  if (f.hp / f.maxHp < 0.55 && heals.length) return heals[0];
  const useful = moves.filter(m => m.type !== 'heal' && !(m.type === 'buff' && f.buffs.some(b => b.name === m.name)));
  return pickRandom(useful.length ? useful : moves);
}

// 回傳每個 tick 呼叫一次的行動函式
function makeBot(game, slot, level = 'normal', rand = Math.random) {
  const cfg = LEVELS[level] || LEVELS.normal;
  let readyAt = null;
  return function act(now) {
    const f = game.fighters[slot];
    if (game.over || f.gauge < 100) { readyAt = null; return; }
    if (readyAt === null) readyAt = now + cfg.delay[0] + rand() * (cfg.delay[1] - cfg.delay[0]);
    if (now < readyAt) return;
    readyAt = null;
    const move = chooseMove(game, slot, cfg.smart, rand);
    if (move) game.castSkill(slot, move.name);
    else if (f.resetsLeft > 0) game.reset(slot);
  };
}

module.exports = { LEVELS, chooseMove, makeBot };
