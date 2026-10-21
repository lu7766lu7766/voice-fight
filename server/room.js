'use strict';
// 房間：最多兩位玩家，先進房者在左（slot 0），後進者在右（slot 1）。

const { Game, C } = require('./game');
const { matchWords } = require('./speech');
const { byId, RESET_WORDS } = require('../public/shared/characters');

const COUNTDOWN_MS = 3000;
const DISCONNECT_GRACE_MS = 30000;
const STATE_INTERVAL_MS = 100;

const REASONS = {
  over: '對戰已結束',
  notyours: '這不是你的招式',
  gauge: '集氣未滿！',
  notonboard: '盤面上找不到這個招式',
  badpath: '方塊路徑不正確',
  noreset: '重置機會已用完',
  cooldown: '普攻冷卻中',
  nomatch: '沒有聽到你的招式',
  notbattle: '尚未開戰'
};

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = [null, null]; // { pid, socketId, connected, charId, ready, rematch, dropTimer }
    this.phase = 'lobby';
    this.game = null;
    this.countdownEnd = 0;
    this.lastState = 0;
    this.touched = Date.now();
  }

  get channel() { return 'room:' + this.code; }

  slotOf(pid) { return this.players.findIndex(p => p && p.pid === pid); }

  isEmpty() { return this.players.every(p => !p); }

  // ---------- 加入 / 離開 ----------

  join(socket, pid) {
    this.touched = Date.now();
    let slot = this.slotOf(pid);
    if (slot < 0) {
      slot = this.players.findIndex(p => !p);
      if (slot < 0) return { ok: false, reason: '房間已滿（最多兩人）' };
      if (this.phase !== 'lobby') return { ok: false, reason: '對戰進行中，無法加入' };
      this.players[slot] = { pid, charId: null, ready: false, rematch: false };
    }
    const p = this.players[slot];
    if (p.socketId && p.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(p.socketId);
      if (old) { old.emit('kicked', { reason: '已在其他分頁連線' }); old.leave(this.channel); old.data.room = null; }
    }
    clearTimeout(p.dropTimer);
    p.socketId = socket.id;
    p.connected = true;
    socket.join(this.channel);
    socket.data.room = this;
    socket.data.slot = slot;
    socket.emit('joined', { room: this.code, slot });
    this.broadcastRoom();
    if (this.game) socket.emit('battle', this.battleInfo());
    return { ok: true, slot };
  }

  disconnect(socket) {
    const slot = socket.data.slot;
    const p = this.players[slot];
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    this.broadcastRoom();
    p.dropTimer = setTimeout(() => this.drop(slot, p), DISCONNECT_GRACE_MS);
  }

  leave(socket) {
    const slot = socket.data.slot;
    const p = this.players[slot];
    socket.leave(this.channel);
    socket.data.room = null;
    if (p && p.socketId === socket.id) this.drop(slot, p);
  }

  drop(slot, p) {
    if (this.players[slot] !== p) return;
    clearTimeout(p.dropTimer);
    this.players[slot] = null;
    if (this.phase === 'over') { this.phase = 'lobby'; this.game = null; }
    if (this.phase === 'battle' && this.game && !this.game.over) {
      this.game.finish(1 - slot);
      this.emit('notice', { msg: '對手已離線，判定勝利' });
    }
    if (this.phase === 'countdown') this.phase = 'lobby';
    if (this.phase !== 'battle') {
      this.players.forEach(q => { if (q) { q.ready = false; q.rematch = false; } });
    }
    // 只剩一人時，留在房內的玩家移到左邊（先進房者）
    if (!this.players[0] && this.players[1] && this.phase === 'lobby') {
      this.players[0] = this.players[1];
      this.players[1] = null;
      const s = this.io.sockets.sockets.get(this.players[0].socketId);
      if (s) { s.data.slot = 0; s.emit('joined', { room: this.code, slot: 0 }); }
    }
    this.broadcastRoom();
  }

  // ---------- 大廳 ----------

  pick(slot, charId) {
    if (this.phase !== 'lobby' || !byId[charId]) return;
    const p = this.players[slot];
    if (!p) return;
    p.charId = charId;
    p.ready = false;
    this.broadcastRoom();
  }

  setReady(slot, ready) {
    if (this.phase !== 'lobby') return;
    const p = this.players[slot];
    if (!p || !p.charId) return;
    p.ready = !!ready;
    this.broadcastRoom();
    if (this.players.every(q => q && q.ready && q.connected)) this.startCountdown();
  }

  startCountdown() {
    this.phase = 'countdown';
    this.countdownEnd = Date.now() + COUNTDOWN_MS;
    this.game = new Game({
      charIds: this.players.map(p => p.charId),
      now: Date.now(),
      onEvent: (type, payload) => this.onGameEvent(type, payload)
    });
    this.broadcastRoom();
    this.emit('battle', this.battleInfo());
  }

  rematch(slot) {
    if (this.phase !== 'over') return;
    const p = this.players[slot];
    if (!p) return;
    p.rematch = true;
    if (this.players.every(q => q && q.rematch)) {
      this.phase = 'lobby';
      this.game = null;
      this.players.forEach(q => { q.ready = false; q.rematch = false; });
    }
    this.broadcastRoom();
  }

  // ---------- 對戰 ----------

  battleInfo() {
    return {
      chars: this.players.map(p => p && p.charId),
      board: this.game.board.snapshot(),
      countdownEnd: this.countdownEnd,
      serverNow: Date.now(),
      gaugeMax: C.GAUGE_MAX,
      normalCd: C.NORMAL_CD,
      state: this.game.state()
    };
  }

  tick(now) {
    if (this.phase === 'countdown' && now >= this.countdownEnd) {
      this.phase = 'battle';
      this.game.update(now);
      // 倒數期間不集氣：從開戰時刻起算
      this.game.fighters.forEach(f => { f.gauge = 0; f.nextNormalAt = now; });
      this.broadcastRoom();
    }
    if (this.phase === 'battle' && this.game) {
      this.game.update(now);
      if (now - this.lastState >= STATE_INTERVAL_MS) {
        this.lastState = now;
        this.emit('state', this.game.state());
      }
    }
  }

  onGameEvent(type, payload) {
    this.emit(type, payload);
    if (type === 'ko') {
      this.phase = 'over';
      this.emit('state', this.game.state());
      this.broadcastRoom();
    }
  }

  inBattle(slot) {
    return this.phase === 'battle' && this.game && !this.game.over && this.players[slot];
  }

  normal(socket) {
    const slot = socket.data.slot;
    if (!this.inBattle(slot)) return;
    this.game.update(Date.now());
    this.game.normalAttack(slot);
  }

  // 語音：alts 為辨識引擎給的候選句子
  // interim：辨識中的暫時結果，失敗時不回報（避免訊息洗版）
  speech(socket, alts, interim) {
    const slot = socket.data.slot;
    const heard = String(alts[0] || '').slice(0, 40);
    if (!this.inBattle(slot)) return interim ? null : socket.emit('speechResult', { ok: false, heard, msg: REASONS.notbattle });
    this.game.update(Date.now());
    const f = this.game.fighters[slot];
    const words = f.ch.moves.map(m => m.name).concat(RESET_WORDS);
    const candidates = [];
    for (const alt of alts.slice(0, 6)) {
      for (const w of matchWords(String(alt).slice(0, 60), words)) if (!candidates.includes(w)) candidates.push(w);
    }
    if (!candidates.length) return interim ? null : socket.emit('speechResult', { ok: false, heard, msg: REASONS.nomatch });

    let last = null;
    for (const word of candidates) {
      const res = RESET_WORDS.includes(word) ? this.game.reset(slot) : this.game.castSkill(slot, word);
      if (res.ok) return socket.emit('speechResult', { ok: true, heard, word });
      last = { word, reason: res.reason };
      if (res.reason === 'gauge') break;
    }
    if (!interim) socket.emit('speechResult', { ok: false, heard, word: last.word, msg: `${last.word}：${REASONS[last.reason] || last.reason}` });
  }

  // 手動點選方塊出招（無法使用麥克風時的備援）
  tapMove(socket, path) {
    const slot = socket.data.slot;
    if (!this.inBattle(slot) || !Array.isArray(path)) return;
    this.game.update(Date.now());
    const cells = this.game.board.cells;
    if (!path.every(i => Number.isInteger(i) && cells[i])) return;
    const word = path.map(i => cells[i].ch).join('');
    const own = this.game.fighters[slot].ch.moves.some(m => m.name === word);
    const res = own ? this.game.castSkill(slot, word, path) : { ok: false, reason: 'notyours' };
    socket.emit('speechResult', { ok: res.ok, heard: word, word, msg: res.ok ? '' : `${word}：${REASONS[res.reason]}` });
  }

  tapReset(socket) {
    const slot = socket.data.slot;
    if (!this.inBattle(slot)) return;
    const res = this.game.reset(slot);
    if (!res.ok) socket.emit('speechResult', { ok: false, heard: '重置', msg: REASONS[res.reason] });
  }

  // ---------- 廣播 ----------

  emit(type, payload) { this.io.to(this.channel).emit(type, payload); }

  roomInfo() {
    return {
      code: this.code,
      phase: this.phase,
      countdownEnd: this.countdownEnd,
      serverNow: Date.now(),
      winner: this.game && this.game.over ? this.game.winner : -1,
      players: this.players.map(p => p && {
        charId: p.charId, ready: p.ready, connected: p.connected, rematch: p.rematch
      })
    };
  }

  broadcastRoom() {
    this.touched = Date.now();
    this.emit('room', this.roomInfo());
    this.io.to('host:' + this.code).emit('room', this.roomInfo());
  }
}

module.exports = { Room };
