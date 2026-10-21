'use strict';
// 文字方塊棋盤：八方向相連（含斜角）、同一格不可重複使用。
// 消除後上方方塊落下、頂端補新字，並保證每位玩家都至少有 MIN_PER_PLAYER 個自己的招式可念。

const { FILLER } = require('../public/shared/characters');

const COLS = 6;
const ROWS = 6;
const MIN_PER_PLAYER = 2;

const DIRS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1]
];

class Board {
  constructor({ cols = COLS, rows = ROWS, rng = Math.random, minPerPlayer = MIN_PER_PLAYER } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.rng = rng;
    this.minPerPlayer = minPerPlayer;
    this.nextId = 1;
    this.cells = new Array(cols * rows).fill(null); // { id, ch }
    this.movesets = [[], []]; // 每位玩家可用招式名稱
    this.pool = [];
  }

  setMovesets(movesets) {
    this.movesets = movesets.map(m => m.slice());
    this.buildPool();
  }

  // 依權重建立補字池：場上玩家的招式字最常出現，其次是填充字
  buildPool() {
    const weights = new Map();
    const add = (ch, w) => weights.set(ch, (weights.get(ch) || 0) + w);
    for (const set of this.movesets) for (const name of set) for (const ch of name) add(ch, 2);
    for (const ch of FILLER) add(ch, 1);
    this.pool = [];
    for (const [ch, w] of weights) for (let i = 0; i < w; i++) this.pool.push(ch);
  }

  randomChar() {
    return this.pool[Math.floor(this.rng() * this.pool.length)];
  }

  idx(x, y) { return y * this.cols + x; }
  xy(i) { return [i % this.cols, Math.floor(i / this.cols)]; }

  neighbors(i) {
    const [x, y] = this.xy(i);
    const out = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < this.cols && ny < this.rows) out.push(this.idx(nx, ny));
    }
    return out;
  }

  isAdjacent(a, b) {
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    return (a !== b) && Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1;
  }

  newCell(ch) { return { id: this.nextId++, ch }; }

  generate() {
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = this.newCell(this.randomChar());
    const fresh = new Set(this.cells.map((_, i) => i));
    this.ensure(fresh, this.minPerPlayer + 1);
  }

  // 找出 word 在棋盤上的所有路徑（limit 筆）
  findPaths(word, limit = Infinity) {
    const chars = [...word];
    const results = [];
    const path = [];
    const used = new Uint8Array(this.cells.length);
    const dfs = (i, k) => {
      if (results.length >= limit) return;
      if (this.cells[i].ch !== chars[k]) return;
      path.push(i); used[i] = 1;
      if (k === chars.length - 1) results.push(path.slice());
      else for (const n of this.neighbors(i)) if (!used[n]) dfs(n, k + 1);
      path.pop(); used[i] = 0;
    };
    for (let i = 0; i < this.cells.length && results.length < limit; i++) dfs(i, 0);
    return results;
  }

  findPath(word) {
    const paths = this.findPaths(word, 8);
    if (!paths.length) return null;
    return paths[Math.floor(this.rng() * paths.length)];
  }

  hasWord(word) { return this.findPaths(word, 1).length > 0; }

  available(moves) { return moves.filter(m => this.hasWord(m)); }

  // 驗證玩家手動點選的路徑
  pathSpells(path, word) {
    const chars = [...word];
    if (!Array.isArray(path) || path.length !== chars.length) return false;
    const seen = new Set();
    for (let k = 0; k < path.length; k++) {
      const i = path[k];
      if (!Number.isInteger(i) || i < 0 || i >= this.cells.length || seen.has(i)) return false;
      seen.add(i);
      if (this.cells[i].ch !== chars[k]) return false;
      if (k > 0 && !this.isAdjacent(path[k - 1], i)) return false;
    }
    return true;
  }

  // 消除路徑上的方塊，往下掉落並由頂端補字。回傳新補上的格子索引。
  removeAndCollapse(path) {
    const removed = new Set(path);
    const fresh = new Set();
    for (let x = 0; x < this.cols; x++) {
      const keep = [];
      for (let y = this.rows - 1; y >= 0; y--) {
        const i = this.idx(x, y);
        if (!removed.has(i)) keep.push(this.cells[i]);
      }
      for (let y = this.rows - 1, k = 0; y >= 0; y--, k++) {
        const i = this.idx(x, y);
        if (k < keep.length) this.cells[i] = keep[k];
        else { this.cells[i] = this.newCell(this.randomChar()); fresh.add(i); }
      }
    }
    this.ensure(fresh, this.minPerPlayer);
    return fresh;
  }

  // 整盤重新洗牌（玩家念「重置」時）
  reshuffle() {
    this.generate();
  }

  // 保證每位玩家至少有 min 個招式在盤面上。
  // 優先把招式「種」在新落下的格子上，並避開其他現存招式的路徑，讓畫面變動最小。
  ensure(fresh, min) {
    for (let guard = 0; guard < 40; guard++) {
      const counts = this.movesets.map(set => this.available(set));
      let worst = -1, worstCount = Infinity;
      counts.forEach((avail, p) => {
        const need = Math.min(min, this.movesets[p].length);
        if (this.movesets[p].length && avail.length < need && avail.length < worstCount) {
          worst = p; worstCount = avail.length;
        }
      });
      if (worst < 0) return;

      const missing = this.movesets[worst].filter(m => !counts[worst].includes(m));
      const word = missing[Math.floor(this.rng() * missing.length)];

      // 受保護格：目前每個可用招式的一條路徑
      const protectedCells = new Set();
      counts.forEach(avail => avail.forEach(m => {
        const p = this.findPaths(m, 1)[0];
        if (p) p.forEach(i => protectedCells.add(i));
      }));

      const path = this.bestPlantPath([...word].length, fresh, protectedCells);
      if (!path) continue;
      [...word].forEach((ch, k) => {
        const i = path[k];
        if (this.cells[i].ch !== ch) {
          // 非新落下的格子被改寫時給新 id，前端會以「換字」動畫呈現
          this.cells[i] = fresh.has(i) ? { id: this.cells[i].id, ch } : this.newCell(ch);
        }
      });
    }
  }

  bestPlantPath(len, fresh, protectedCells) {
    let best = null, bestScore = -Infinity;
    for (let attempt = 0; attempt < 160; attempt++) {
      const path = this.randomWalk(len);
      if (!path) continue;
      let score = this.rng() * 0.5;
      for (const i of path) {
        if (fresh.has(i)) score += 3;
        if (protectedCells.has(i)) score -= 10;
      }
      if (score > bestScore) { bestScore = score; best = path; }
    }
    return best;
  }

  randomWalk(len) {
    const start = Math.floor(this.rng() * this.cells.length);
    const path = [start];
    const used = new Set(path);
    while (path.length < len) {
      const opts = this.neighbors(path[path.length - 1]).filter(n => !used.has(n));
      if (!opts.length) return null;
      const n = opts[Math.floor(this.rng() * opts.length)];
      path.push(n); used.add(n);
    }
    return path;
  }

  snapshot() {
    return { cols: this.cols, rows: this.rows, cells: this.cells.map(c => [c.id, c.ch]) };
  }
}

module.exports = { Board, COLS, ROWS, MIN_PER_PLAYER };
