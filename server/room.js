'use strict';
// 房間：最多兩位玩家，先進房者在左（slot 0），後進者在右（slot 1）。

const { Game, C } = require('./game');
const { rankWords } = require('./speech');
const { CHARACTERS, byId, RESET_WORDS } = require('../public/shared/characters');
const { LEVELS, makeBot } = require('./bot');

const COUNTDOWN_MS = 10000; // 開戰前倒數，期間可以先看招式表
const DISCONNECT_GRACE_MS = 30000;
const STATE_INTERVAL_MS = 100;

const REASONS = {
  over: '對戰已結束',
  notyours: '這不是你的招式',
  gauge: '集氣未滿！',
  notonboard: '盤面上找不到這個招式',
  badpath: '方塊路徑不正確',
  noreset: '重置機會已用完',
  nomatch: '沒有聽到你的招式',
  notbattle: '尚未開戰'
};

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = [null, null]; // { pid, socketId, connected, charId, rematch, dropTimer }，電腦對手另有 bot: 難度
    this.bots = [];              // 對戰中電腦對手的行動函式
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
      // 預設是雙人對戰：還在選角時有真人進房，就取代電腦對手
      const botSlot = this.players.findIndex(p => p && p.bot);
      if (slot < 0 && botSlot >= 0 && this.phase === 'lobby') {
        slot = botSlot;
        this.players[slot] = null;
        this.players.forEach(q => { if (q) q.charId = null; });
        this.emit('notice', { msg: '有玩家進房，改為雙人對戰' });
      }
      if (slot < 0) return { ok: false, reason: botSlot >= 0 ? '房間正在與電腦對戰' : '房間已滿（最多兩人）' };
      if (this.phase !== 'lobby') return { ok: false, reason: '對戰進行中，無法加入' };
      this.players[slot] = { pid, charId: null, rematch: false };
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
    this.maybeStart();
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
    // 真人都離開了，電腦對手也一起退場
    if (this.players.every(q => !q || q.bot)) {
      this.players = [null, null];
      this.phase = 'lobby';
      this.game = null;
      this.broadcastRoom();
      return;
    }
    if (this.phase === 'over') { this.phase = 'lobby'; this.game = null; }
    if (this.phase === 'battle' && this.game && !this.game.over) {
      this.game.finish(1 - slot);
      this.emit('notice', { msg: '對手已離線，判定勝利' });
    }
    if (this.phase === 'countdown') { this.phase = 'lobby'; this.game = null; }
    if (this.phase !== 'battle') {
      // 有人離開後，留下的人要重新確定角色（避免新對手一確定就直接開戰）
      this.players.forEach(q => { if (q) { q.rematch = false; if (this.phase === 'lobby') q.charId = null; } });
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

  // 選角即確定；兩人都在房內且都選好角色就自動開始倒數
  pick(slot, charId) {
    if (this.phase !== 'lobby' || !byId[charId]) return;
    const p = this.players[slot];
    if (!p) return;
    p.charId = charId;
    this.broadcastRoom();
    this.maybeStart();
  }

  // 取消已確定的角色（玩家改點其他角色查看時）
  unpick(slot) {
    if (this.phase !== 'lobby') return;
    const p = this.players[slot];
    if (!p || !p.charId) return;
    p.charId = null;
    this.broadcastRoom();
  }

  // 等待對手時改成和電腦對戰（電腦隨機選一個和你不同的角色）
  setBot(slot, level) {
    if (this.phase !== 'lobby' || !this.players[slot] || !LEVELS[level]) return;
    const other = 1 - slot;
    const q = this.players[other];
    if (q && !q.bot) return;
    if (q) q.bot = level;
    else this.players[other] = { pid: 'bot', bot: level, connected: true, charId: this.botChar(slot), rematch: false };
    this.broadcastRoom();
    this.maybeStart();
  }

  // 換一個電腦角色
  rerollBot(slot) {
    const q = this.players[1 - slot];
    if (this.phase !== 'lobby' || !this.players[slot] || !q || !q.bot) return;
    q.charId = this.botChar(slot, q.charId);
    this.broadcastRoom();
  }

  // 改回等待真人玩家
  removeBot(slot) {
    const q = this.players[1 - slot];
    if (this.phase !== 'lobby' || !this.players[slot] || !q || !q.bot) return;
    this.players[1 - slot] = null;
    this.broadcastRoom();
  }

  botChar(humanSlot, avoid) {
    const human = this.players[humanSlot];
    const ids = CHARACTERS.map(c => c.id).filter(id => id !== (human && human.charId) && id !== avoid);
    return ids[Math.floor(Math.random() * ids.length)];
  }

  maybeStart() {
    if (this.phase === 'lobby' && this.players.every(q => q && q.charId && q.connected)) this.startCountdown();
  }

  startCountdown() {
    this.phase = 'countdown';
    this.countdownEnd = Date.now() + COUNTDOWN_MS;
    this.game = new Game({
      charIds: this.players.map(p => p.charId),
      now: Date.now(),
      onEvent: (type, payload) => this.onGameEvent(type, payload)
    });
    this.bots = this.players.map((p, i) => p.bot && makeBot(this.game, i, p.bot)).filter(Boolean);
    this.broadcastRoom();
    this.emit('battle', this.battleInfo());
  }

  rematch(slot) {
    if (this.phase !== 'over') return;
    const p = this.players[slot];
    if (!p) return;
    p.rematch = true;
    this.players.forEach(q => { if (q && q.bot) q.rematch = true; });
    // 對手已離開房間時，按「再來一局」直接回到選角畫面等新對手
    if (this.players.every(q => !q || q.rematch)) {
      // 回到選角畫面重新選（選好即自動開戰）
      this.phase = 'lobby';
      this.game = null;
      this.players.forEach((q, i) => { if (q) { q.charId = q.bot ? this.botChar(1 - i) : null; q.rematch = false; } });
    }
    this.broadcastRoom();
  }

  // ---------- 對戰 ----------

  battleInfo() {
    return {
      chars: this.players.map(p => p && p.charId),
      // 倒數期間不送盤面，開戰時才讓方塊落下
      board: this.phase === 'countdown' ? null : this.game.board.snapshot(),
      countdownEnd: this.countdownEnd,
      serverNow: Date.now(),
      gaugeMax: C.GAUGE_MAX,
      state: this.publicState()
    };
  }

  // 倒數期間不透露盤面上有哪些招式
  publicState() {
    const st = this.game.state();
    if (this.phase === 'countdown') st.f.forEach(f => { f.avail = []; });
    return st;
  }

  tick(now) {
    if (this.phase === 'countdown' && now >= this.countdownEnd) {
      this.phase = 'battle';
      this.game.update(now);
      // 倒數期間不集氣：從開戰時刻起算
      this.game.fighters.forEach(f => { f.gauge = 0; });
      this.broadcastRoom();
      this.emit('begin', { board: this.game.board.snapshot(), state: this.game.state() });
    }
    if (this.phase === 'battle' && this.game) {
      this.game.update(now);
      this.bots.forEach(act => act(now));
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

  // 語音：alts 為辨識引擎給的候選句子
  // interim：辨識中的暫時結果，失敗時不回報（避免訊息洗版）
  speech(socket, alts, interim) {
    const slot = socket.data.slot;
    const heard = String(alts[0] || '').slice(0, 40);
    if (!this.inBattle(slot)) return interim ? null : socket.emit('speechResult', { ok: false, heard, msg: REASONS.notbattle });
    this.game.update(Date.now());
    const f = this.game.fighters[slot];
    const moves = f.ch.moves.map(m => m.name);
    // 綜合所有候選句子，取每個招式的最高分（排名越後面的候選句稍微扣分）
    const best = new Map();
    alts.slice(0, 6).forEach((alt, k) => {
      for (const { word, score } of rankWords(String(alt).slice(0, 60), moves.concat(RESET_WORDS), RESET_WORDS)) {
        const s = score * (1 - 0.03 * k);
        if (s > (best.get(word) || 0)) best.set(word, s);
      }
    });
    // 暫時結果要更有把握才出招，避免話還沒說完就誤判
    const ranked = [...best].filter(([, s]) => !interim || s >= 0.8).sort((a, b) => b[1] - a[1]).map(([w]) => w);
    if (!ranked.length) return interim ? null : socket.emit('speechResult', { ok: false, heard, msg: REASONS.nomatch });

    // 盤面上有的招式優先（同樣聽起來像，就選找得到的那一個）
    const avail = this.game.avail[slot];
    const order = ranked.filter(w => avail.includes(w)).concat(ranked.filter(w => RESET_WORDS.includes(w)), ranked.filter(w => !avail.includes(w) && !RESET_WORDS.includes(w)));
    let last = null;
    for (const word of order) {
      const res = RESET_WORDS.includes(word) ? this.game.reset(slot) : this.game.castSkill(slot, word);
      if (res.ok) return socket.emit('speechResult', { ok: true, heard, word });
      last = last || { word, reason: res.reason };
      if (res.reason === 'gauge') { last = { word, reason: res.reason }; break; }
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
        charId: p.charId, connected: p.connected, rematch: p.rematch, bot: p.bot || null
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
