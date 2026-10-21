// 文字方塊棋盤（DOM）：方塊以 id 對應，消除後的掉落與補字皆以 CSS transition 呈現
(function () {
  class BoardView {
    constructor(el) {
      this.el = el;
      this.cells = new Map(); // id -> { el, idx, ch }
      this.snapshot = null;
      this.queue = Promise.resolve();
      this.tapMode = false;
      this.selection = [];
      this.onSubmit = null;
      el.addEventListener('pointerdown', e => this.onTap(e));
      window.addEventListener('resize', () => this.layout(false));
    }

    measure() {
      const r = this.el.getBoundingClientRect();
      const cols = this.snapshot.cols, rows = this.snapshot.rows;
      this.cellSize = Math.floor(Math.min(r.width / cols, r.height / rows));
      this.offX = Math.floor((r.width - this.cellSize * cols) / 2);
      this.offY = Math.floor((r.height - this.cellSize * rows) / 2);
      this.el.style.setProperty('--cell', this.cellSize + 'px');
    }

    pos(idx, rowOverride) {
      const cols = this.snapshot.cols;
      const x = idx % cols, y = rowOverride !== undefined ? rowOverride : Math.floor(idx / cols);
      return `translate(${this.offX + x * this.cellSize}px, ${this.offY + y * this.cellSize}px)`;
    }

    // 立即套用整個盤面（初始、重連）
    setBoard(snap) {
      this.queue = this.queue.then(() => {
        this.el.querySelectorAll('.cell').forEach(n => n.remove());
        this.cells.clear();
        this.snapshot = snap;
        this.measure();
        snap.cells.forEach(([id, ch], idx) => this.createCell(id, ch, idx));
        this.clearSelection();
      });
    }

    // 洗牌：全部翻轉換字
    reshuffle(snap) {
      this.queue = this.queue.then(() => new Promise(res => {
        this.el.classList.add('shuffling');
        setTimeout(() => {
          this.el.classList.remove('shuffling');
          this.setBoardNow(snap, true);
          res();
        }, 350);
      }));
    }

    setBoardNow(snap, flip) {
      this.el.querySelectorAll('.cell').forEach(n => n.remove());
      this.cells.clear();
      this.snapshot = snap;
      this.measure();
      snap.cells.forEach(([id, ch], idx) => {
        const c = this.createCell(id, ch, idx);
        if (flip) { c.el.classList.add('flipin'); c.el.style.animationDelay = (idx % snap.cols) * 30 + Math.floor(idx / snap.cols) * 30 + 'ms'; }
      });
      this.clearSelection();
    }

    createCell(id, ch, idx, startRow) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.innerHTML = `<span>${ch}</span>`;
      el.style.transform = this.pos(idx, startRow);
      el.dataset.id = id;
      this.el.appendChild(el);
      const c = { el, idx, ch, id };
      this.cells.set(id, c);
      return c;
    }

    // 出招消除：路徑發光 → 爆開 → 落下補字
    playRemoval(pathIds, snap, side) {
      this.queue = this.queue.then(() => new Promise(res => {
        if (!this.snapshot) { this.setBoardNow(snap); return res(); }
        this.clearSelection();
        pathIds.forEach((id, k) => {
          const c = this.cells.get(id);
          if (!c) return;
          setTimeout(() => c.el.classList.add('hit', 'side' + side), k * 70);
        });
        const glowMs = pathIds.length * 70 + 260;
        setTimeout(() => {
          pathIds.forEach(id => { const c = this.cells.get(id); if (c) c.el.classList.add('pop'); });
        }, glowMs);
        setTimeout(() => {
          pathIds.forEach(id => { const c = this.cells.get(id); if (c) { c.el.remove(); this.cells.delete(id); } });
          this.applyFall(snap);
          setTimeout(res, 330);
        }, glowMs + 220);
      }));
    }

    applyFall(snap) {
      this.snapshot = snap;
      this.measure();
      const cols = snap.cols;
      const newPerCol = new Array(cols).fill(0);
      // 每欄新方塊數，用來決定從多高掉下來
      snap.cells.forEach(([id], idx) => { if (!this.cells.has(id)) newPerCol[idx % cols]++; });
      const seen = new Set();
      snap.cells.forEach(([id, ch], idx) => {
        seen.add(id);
        const c = this.cells.get(id);
        if (c) {
          c.idx = idx;
          c.el.style.transform = this.pos(idx);
          if (c.ch !== ch) { c.ch = ch; c.el.querySelector('span').textContent = ch; c.el.classList.add('swap'); }
        } else {
          const row = Math.floor(idx / cols);
          const n = this.createCell(id, ch, idx, row - newPerCol[idx % cols] - 0.3);
          n.el.classList.add('fresh');
          void n.el.offsetWidth; // 觸發 reflow 讓 transition 生效
          n.el.style.transform = this.pos(idx);
        }
      });
      for (const [id, c] of this.cells) if (!seen.has(id)) { c.el.remove(); this.cells.delete(id); }
      setTimeout(() => this.el.querySelectorAll('.swap,.fresh').forEach(n => n.classList.remove('swap', 'fresh')), 600);
    }

    layout() {
      if (!this.snapshot) return;
      this.measure();
      for (const c of this.cells.values()) c.el.style.transform = this.pos(c.idx);
    }

    // ---------- 手動點選（備援模式） ----------
    setTapMode(on) { this.tapMode = on; this.el.classList.toggle('tapmode', on); this.clearSelection(); }

    onTap(e) {
      if (!this.tapMode) return;
      const cellEl = e.target.closest('.cell');
      if (!cellEl) return;
      const c = this.cells.get(Number(cellEl.dataset.id));
      if (!c) return;
      const sel = this.selection;
      const last = sel[sel.length - 1];
      const pos = sel.indexOf(c.idx);
      if (pos >= 0) {
        if (pos === sel.length - 1 && sel.length >= 2) { this.submit(); return; }
        sel.length = pos + 1;
      } else if (last === undefined || this.adjacent(last, c.idx)) {
        sel.push(c.idx);
      } else {
        sel.length = 0; sel.push(c.idx);
      }
      this.renderSelection();
    }

    adjacent(a, b) {
      const cols = this.snapshot.cols;
      return Math.abs((a % cols) - (b % cols)) <= 1 && Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) <= 1;
    }

    selectedWord() {
      return this.selection.map(i => this.snapshot.cells[i][1]).join('');
    }

    renderSelection() {
      const set = new Set(this.selection);
      for (const c of this.cells.values()) c.el.classList.toggle('sel', set.has(c.idx));
      if (this.onSelect) this.onSelect(this.selectedWord());
    }

    submit() {
      if (this.selection.length >= 2 && this.onSubmit) this.onSubmit(this.selection.slice());
      this.clearSelection();
    }

    clearSelection() {
      this.selection = [];
      if (this.snapshot) this.renderSelection();
    }
  }

  window.BoardView = BoardView;
})();
