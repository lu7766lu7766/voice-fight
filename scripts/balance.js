'use strict';
// 角色平衡模擬：以真實 Game 邏輯讓兩個機器人互打，輸出各組合勝率。
// 用法：node scripts/balance.js [每組場數]

const { Game } = require('../server/game');
const { CHARACTERS } = require('../public/shared/characters');

const N = Number(process.argv[2]) || 400;
const DT = 50;

// 模擬玩家：集氣滿後需要 1.5~4.5 秒找字念出
function makeBot(game, slot) {
  let readyAt = null;
  return function act(now) {
    const f = game.fighters[slot];
    if (f.gauge >= 100) {
      if (readyAt === null) readyAt = now + 1500 + Math.random() * 3000;
      if (now >= readyAt) {
        const avail = game.avail[slot];
        if (!avail.length) { game.reset(slot); return; }
        const moves = avail.map(n => f.ch.moves.find(m => m.name === n));
        const low = f.hp / f.maxHp < 0.55;
        const heals = moves.filter(m => m.type === 'heal');
        const useful = moves.filter(m => m.type !== 'heal' && !(m.type === 'buff' && f.buffs.some(b => b.name === m.name)));
        let pick;
        if (low && heals.length) pick = heals[0];
        else if (useful.length) pick = useful[Math.floor(Math.random() * useful.length)];
        else pick = moves[Math.floor(Math.random() * moves.length)];
        game.castSkill(slot, pick.name);
        readyAt = null;
      }
    }
  };
}

function fight(a, b) {
  let now = 0;
  const stats = { casts: [0, 0], maxHit: 0 };
  const onEvent = (type, ev) => {
    if (type === 'skill') stats.casts[ev.slot]++;
    if (type === 'hit' && ev.kind === 'dmg') stats.maxHit = Math.max(stats.maxHit, ev.amount / game.fighters[ev.dst].maxHp);
  };
  const game = new Game({ charIds: [a, b], now, onEvent });
  const bots = [makeBot(game, 0), makeBot(game, 1)];
  const starved = [0, 0];
  while (!game.over && now < 300000) {
    now += DT;
    game.update(now);
    if (game.over) break;
    // 以隨機順序行動避免先手優勢
    if (Math.random() < 0.5) { bots[0](now); bots[1](now); } else { bots[1](now); bots[0](now); }
    game.avail.forEach((av, i) => { if (av.length < 2) starved[i]++; });
  }
  return { winner: game.winner, time: now, starved, casts: stats.casts[game.winner] || 0, maxHit: stats.maxHit };
}

const ids = CHARACTERS.map(c => c.id);
const wins = {}; ids.forEach(i => { wins[i] = { w: 0, n: 0 }; });
const matrix = {};
let totalTime = 0, games = 0, starvedTicks = 0, totalCasts = 0, maxHit = 0;

for (const a of ids) {
  matrix[a] = {};
  for (const b of ids) {
    if (a === b) { matrix[a][b] = '  -  '; continue; }
    let aw = 0;
    for (let k = 0; k < N; k++) {
      // 左右各打一半
      const swap = k % 2 === 1;
      const r = swap ? fight(b, a) : fight(a, b);
      const aWon = swap ? r.winner === 1 : r.winner === 0;
      if (aWon) aw++;
      totalTime += r.time; games++; totalCasts += r.casts; maxHit = Math.max(maxHit, r.maxHit);
      starvedTicks += r.starved[0] + r.starved[1];
    }
    matrix[a][b] = (aw / N * 100).toFixed(0).padStart(3) + '% ';
    wins[a].w += aw; wins[a].n += N;
  }
}

const name = id => CHARACTERS.find(c => c.id === id).name;
console.log('勝率矩陣（列 vs 欄）');
console.log('      ' + ids.map(i => name(i).padEnd(4, '　')).join(' '));
for (const a of ids) console.log(name(a).padEnd(3, '　') + ' ' + ids.map(b => matrix[a][b]).join(' '));
console.log('\n總勝率');
for (const a of ids) console.log(`${name(a)}  ${(wins[a].w / wins[a].n * 100).toFixed(1)}%`);
console.log(`\n平均對戰時間 ${(totalTime / games / 1000).toFixed(1)} 秒；勝方平均出招 ${(totalCasts / games).toFixed(1)} 次；單次最大傷害 ${(maxHit * 100).toFixed(0)}% 氣血；盤面招式不足的 tick 數：${starvedTicks}`);
