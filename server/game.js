'use strict';
// 即時對戰邏輯（伺服器權威）。時間與亂數可注入，方便平衡模擬。

const { byId } = require('../public/shared/characters');
const { Board } = require('./board');

const C = {
  GAUGE_MAX: 100,
  GAUGE_BASE: 7,          // 每秒基礎集氣
  GAUGE_PER_SPD: 0.18,    // 每點身法增加的每秒集氣
  SKILL_BASE: 150,        // 招式基礎傷害（再乘以 power 與 靈力/55）
  HEAL_BASE: 50,
  HIT_CAP: 0.25,          // 單次傷害上限 = 對手最大氣血 × 25%（暴擊疊增益也不會一兩招秒殺）
  SPI_REF: 55,
  DEF_K: 80,              // 減傷 = DEF_K / (DEF_K + 防禦)
  CRIT_MULT: 1.35,
  SKILL_IMPACT: 750,
  MULTI_GAP: 160,
  RESETS: 1
};

class Game {
  constructor({ charIds, rng = Math.random, now = Date.now(), onEvent = () => {} }) {
    this.rng = rng;
    this.onEvent = onEvent;
    this.now = now;
    this.over = false;
    this.winner = -1;
    this.pending = [];
    this.fighters = charIds.map((id, slot) => {
      const ch = byId[id];
      if (!ch) throw new Error('unknown character ' + id);
      return {
        slot, ch,
        hp: ch.stats.hp, maxHp: ch.stats.hp,
        gauge: 0,
        resetsLeft: C.RESETS,
        buffs: [],  // { stat, amount, until, name }
        dots: []    // { name, nextAt, until, perTick, from }
      };
    });
    this.board = new Board({ rng });
    this.board.setMovesets(this.fighters.map(f => f.ch.moves.map(m => m.name)));
    this.board.generate();
    this.refreshAvail();
  }

  // ---------- 屬性與亂數 ----------

  stat(f, key) {
    const base = f.ch.stats[key];
    let mult = 1;
    const buffKey = key === 'spi' ? 'atk' : key; // 攻擊增減益作用在靈力
    for (const b of f.buffs) if (b.stat === buffKey) mult += b.amount;
    return base * Math.max(0.5, Math.min(1.6, mult));
  }

  // 吉運越高，越容易擲出好結果（有機率擲兩次取較佳）
  luckyRoll(f) {
    let r = this.rng();
    if (this.rng() < f.ch.stats.luck / 100 * 0.6) r = Math.max(r, this.rng());
    return r;
  }

  variance(f) { return 0.88 + 0.24 * this.luckyRoll(f); }
  critChance(f) { return 0.03 + f.ch.stats.luck * 0.0012; }
  defFactor(f) { return C.DEF_K / (C.DEF_K + this.stat(f, 'def')); }
  gaugeRate(f) { return Math.max(2, C.GAUGE_BASE + this.stat(f, 'spd') * C.GAUGE_PER_SPD); }

  // ---------- 主迴圈 ----------

  update(now) {
    const dt = Math.max(0, now - this.now) / 1000;
    this.now = now;
    if (this.over) return;
    for (const f of this.fighters) {
      f.gauge = Math.min(C.GAUGE_MAX, f.gauge + this.gaugeRate(f) * dt);
      f.buffs = f.buffs.filter(b => b.until > now);
      for (const d of f.dots) {
        while (d.nextAt <= now && d.nextAt <= d.until && !this.over) {
          d.nextAt += 1000;
          this.damage(this.fighters[d.from], f, d.perTick, { kind: 'dot', label: d.name });
        }
      }
      f.dots = f.dots.filter(d => d.nextAt <= d.until);
    }
    this.pending.sort((a, b) => a.at - b.at);
    while (this.pending.length && this.pending[0].at <= now && !this.over) {
      this.pending.shift().fn();
    }
  }

  schedule(delay, fn) { this.pending.push({ at: this.now + delay, fn }); }

  emit(type, payload) { this.onEvent(type, payload); }

  // ---------- 傷害 / 回復 ----------

  damage(src, dst, amount, extra = {}) {
    if (this.over) return 0;
    const dmg = Math.max(1, Math.round(Math.min(amount, dst.maxHp * C.HIT_CAP)));
    dst.hp = Math.max(0, dst.hp - dmg);
    this.emit('hit', { src: src.slot, dst: dst.slot, kind: extra.kind || 'dmg', amount: dmg, crit: !!extra.crit, label: extra.label || '', hp: dst.hp });
    if (dst.hp <= 0) this.finish(src.slot);
    return dmg;
  }

  heal(f, amount, label) {
    if (this.over) return 0;
    const before = f.hp;
    f.hp = Math.min(f.maxHp, f.hp + Math.round(amount));
    const healed = f.hp - before;
    this.emit('hit', { src: f.slot, dst: f.slot, kind: 'heal', amount: healed, label, hp: f.hp });
    return healed;
  }

  finish(winner) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.pending = [];
    this.emit('ko', { winner, loser: 1 - winner });
  }

  rollSkillDamage(src, dst, power) {
    let dmg = C.SKILL_BASE * power * (this.stat(src, 'spi') / C.SPI_REF) * this.variance(src) * this.defFactor(dst);
    const crit = this.rng() < this.critChance(src);
    if (crit) dmg *= C.CRIT_MULT;
    return { dmg, crit };
  }

  // ---------- 玩家動作 ----------

  // path: 選填，玩家手動點選的格子索引
  castSkill(slot, name, path) {
    if (this.over) return { ok: false, reason: 'over' };
    const f = this.fighters[slot], foe = this.fighters[1 - slot];
    const move = f.ch.moves.find(m => m.name === name);
    if (!move) return { ok: false, reason: 'notyours' };
    if (f.gauge < C.GAUGE_MAX) return { ok: false, reason: 'gauge' };
    if (path) {
      if (!this.board.pathSpells(path, name)) return { ok: false, reason: 'badpath' };
    } else {
      path = this.board.findPath(name);
      if (!path) return { ok: false, reason: 'notonboard' };
    }
    f.gauge = 0;
    const pathIds = path.map(i => this.board.cells[i].id);
    const { weathered } = this.board.removeAndCollapse(path);
    this.refreshAvail();
    this.emit('skill', {
      slot, name, type: move.type, fx: move.fx, hits: move.hits || 1,
      path, pathIds, weatheredIds: weathered, board: this.board.snapshot(), impactMs: C.SKILL_IMPACT, multiGap: C.MULTI_GAP
    });
    this.schedule(C.SKILL_IMPACT, () => this.applyMove(f, foe, move));
    return { ok: true, move };
  }

  applyMove(f, foe, move) {
    switch (move.type) {
      case 'atk': {
        const { dmg, crit } = this.rollSkillDamage(f, foe, move.power);
        this.damage(f, foe, dmg, { crit, label: move.name });
        break;
      }
      case 'multi': {
        const hits = move.hits || 3;
        for (let k = 0; k < hits; k++) {
          const doHit = () => {
            const { dmg, crit } = this.rollSkillDamage(f, foe, move.power / hits);
            this.damage(f, foe, dmg, { crit, label: move.name });
          };
          if (k === 0) doHit(); else this.schedule(k * C.MULTI_GAP, doHit);
        }
        break;
      }
      case 'drain': {
        const { dmg, crit } = this.rollSkillDamage(f, foe, move.power);
        const dealt = this.damage(f, foe, dmg, { crit, label: move.name });
        if (dealt) this.heal(f, dealt * 0.5, move.name);
        break;
      }
      case 'heal': {
        const luckBonus = 1 + 0.25 * this.luckyRoll(f); // 吉運高，加血更多
        this.heal(f, C.HEAL_BASE * move.power * (this.stat(f, 'spi') / C.SPI_REF) * luckBonus, move.name);
        break;
      }
      case 'dot': {
        const { dmg, crit } = this.rollSkillDamage(f, foe, move.power);
        const ticks = move.dur || 6;
        foe.dots = foe.dots.filter(d => d.name !== move.name);
        foe.dots.push({ name: move.name, from: f.slot, nextAt: this.now + 1000, until: this.now + ticks * 1000, perTick: dmg / ticks });
        this.emit('hit', { src: f.slot, dst: foe.slot, kind: 'status', amount: 0, crit, label: move.name + (crit ? '・強' : ''), hp: foe.hp });
        break;
      }
      case 'buff': {
        this.addBuff(f, move, move.amount);
        if (move.refund) f.gauge = Math.min(C.GAUGE_MAX, f.gauge + move.refund);
        this.emit('hit', { src: f.slot, dst: f.slot, kind: 'buff', amount: 0, label: move.name, stat: move.stat, hp: f.hp });
        break;
      }
      case 'debuff': {
        // 吉運影響減益持續時間
        this.addBuff(foe, move, move.amount, (move.dur || 8) * (0.9 + 0.3 * this.luckyRoll(f)));
        this.emit('hit', { src: f.slot, dst: foe.slot, kind: 'debuff', amount: 0, label: move.name, stat: move.stat, hp: foe.hp });
        if (move.power) {
          const { dmg, crit } = this.rollSkillDamage(f, foe, move.power);
          this.damage(f, foe, dmg, { crit, label: move.name });
        }
        break;
      }
    }
  }

  addBuff(f, move, amount, dur = move.dur || 10) {
    f.buffs = f.buffs.filter(b => b.name !== move.name);
    f.buffs.push({ name: move.name, stat: move.stat, amount, until: this.now + dur * 1000 });
  }

  reset(slot) {
    if (this.over) return { ok: false, reason: 'over' };
    const f = this.fighters[slot];
    if (f.resetsLeft <= 0) return { ok: false, reason: 'noreset' };
    f.resetsLeft--;
    this.board.reshuffle();
    this.refreshAvail();
    this.emit('reset', { slot, board: this.board.snapshot() });
    return { ok: true };
  }

  refreshAvail() {
    this.avail = this.fighters.map(f => this.board.available(f.ch.moves.map(m => m.name)));
  }

  state() {
    return {
      over: this.over,
      winner: this.winner,
      f: this.fighters.map((f, i) => ({
        hp: f.hp,
        maxHp: f.maxHp,
        gauge: Math.floor(f.gauge * 10) / 10,
        rate: Math.round(this.gaugeRate(f) * 100) / 100,
        resets: f.resetsLeft,
        buffs: f.buffs.map(b => ({ name: b.name, stat: b.stat, amount: b.amount, left: Math.max(0, b.until - this.now) })),
        dots: f.dots.map(d => ({ name: d.name, left: Math.max(0, d.until - this.now) })),
        avail: this.avail[i]
      }))
    };
  }
}

module.exports = { Game, C };
