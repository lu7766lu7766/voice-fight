// 招式特效：粒子系統、繪圖工具，以及每招各自的特效。
// 每個特效函式以 this = BattleScene 呼叫：fx(t0, a, b, f, ev)
//   t0 施放時刻、a 施放者、b 目標、f 施放者資料、ev 伺服器送來的招式事件
// 傷害在 t0 + IMPACT 結算（多段每段再加 ev.multiGap），特效的命中瞬間要對齊這個時間。
// 若 public/img/fx/ 有對應的特效圖（見 manifest），會優先用圖，否則用程式繪製。
(function () {
  const TAU = Math.PI * 2;
  const IMPACT = 750;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
  const easeOut = t => 1 - Math.pow(1 - clamp01(t), 3);
  const easeIn = t => Math.pow(clamp01(t), 2.2);
  const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  // 0→1→0 的包絡：前 inF 淡入、最後 outF 淡出
  const env = (t, inF = 0.15, outF = 0.3) => t < inF ? t / inF : t > 1 - outF ? Math.max(0, (1 - t) / outF) : 1;

  // ---------- 貼圖快取 ----------
  const cache = {};
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }
  // 柔光點：中心白、外圈帶色、邊緣透明
  function softDot(color, core = 0.35) {
    const key = 'dot' + color + core;
    if (cache[key]) return cache[key];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(core, rgba(color, 0.85));
    gr.addColorStop(0.7, rgba(color, 0.25));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (cache[key] = c);
  }
  // 煙霧團（正常混色）
  function smokeDot(color) {
    const key = 'smoke' + color;
    if (cache[key]) return cache[key];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(color, 0.9));
    gr.addColorStop(0.5, rgba(color, 0.5));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (cache[key] = c);
  }

  // ---------- 粒子 ----------
  // 速度單位：場景單位/秒（會乘上 scene.scale）；g 為重力（單位/秒²，正值向下）
  function makePart(scene, at, x, y, o) {
    const s = scene.scale;
    const ang = Array.isArray(o.angle) ? rand(o.angle[0], o.angle[1]) : (o.angle ?? rand(0, TAU));
    const sp = (Array.isArray(o.speed) ? rand(o.speed[0], o.speed[1]) : (o.speed ?? 60)) * s;
    const spread = o.spread ? o.spread * s : 0;
    const ox = spread ? rand(-1, 1) * spread : 0, oy = spread ? rand(-1, 1) * spread * (o.flat ?? 1) : 0;
    return {
      born: at, x: x + ox, y: y + oy,
      vx: Math.cos(ang) * sp + (o.vx || 0) * s, vy: Math.sin(ang) * sp + (o.vy || 0) * s,
      g: (o.g || 0) * s, drag: o.drag ?? 1.5,
      life: Array.isArray(o.life) ? rand(o.life[0], o.life[1]) : (o.life || 700),
      size: (Array.isArray(o.size) ? rand(o.size[0], o.size[1]) : (o.size || 4)) * s,
      grow: o.grow ?? 0.3,
      color: Array.isArray(o.color) ? pick(o.color) : (o.color || '#ffffff'),
      kind: o.kind || 'glow',
      rot: rand(0, TAU), vr: o.spin ? rand(-o.spin, o.spin) : 0,
      wob: o.wob || 0, wobPh: rand(0, TAU),
      alpha: o.alpha ?? 1,
      seed: Math.random(),
      to: o.to || null, // 收束目標 {x,y}：粒子會被吸過去
      pull: o.pull || 0
    };
  }

  // raw = true：直接用目前的 globalAlpha 畫（特效裡手動畫單隻蟲、葉子用）
  function drawPart(ctx, p, k, now, raw = false) {
    const fade = raw ? 1 : p.kind === 'smoke' ? Math.sin(Math.PI * k) : (k < 0.1 ? k / 0.1 : 1 - Math.pow(Math.max(0, k - 0.1) / 0.9, 1.5));
    const size = raw ? p.size : p.size * (1 + (p.grow - 1) * k);
    if (size <= 0.1) return;
    if (!raw) ctx.globalAlpha = Math.max(0, fade * p.alpha);
    switch (p.kind) {
      case 'glow': {
        ctx.globalCompositeOperation = 'lighter';
        const r = size * 2.4;
        ctx.drawImage(softDot(p.color), p.x - r, p.y - r, r * 2, r * 2);
        break;
      }
      case 'ember': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha *= 0.6 + 0.4 * Math.sin(now / 40 + p.seed * 20);
        const r = size * 2;
        ctx.drawImage(softDot(p.color, 0.2), p.x - r, p.y - r, r * 2, r * 2);
        break;
      }
      case 'spark': {
        ctx.globalCompositeOperation = 'lighter';
        const v = Math.hypot(p.vx, p.vy) || 1;
        const len = Math.min(60, v * 0.045) + size;
        const dx = p.vx / v * len, dy = p.vy / v * len;
        ctx.lineCap = 'round';
        ctx.strokeStyle = p.color; ctx.lineWidth = size;
        ctx.beginPath(); ctx.moveTo(p.x - dx, p.y - dy); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = size * 0.45;
        ctx.beginPath(); ctx.moveTo(p.x - dx * 0.5, p.y - dy * 0.5); ctx.lineTo(p.x, p.y); ctx.stroke();
        break;
      }
      case 'smoke': {
        const r = size * 2.5;
        ctx.globalAlpha *= 0.55;
        ctx.drawImage(smokeDot(p.color), p.x - r, p.y - r, r * 2, r * 2);
        break;
      }
      case 'snow': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, size * 0.3); ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI / 3;
          ctx.moveTo(Math.cos(a) * size, Math.sin(a) * size); ctx.lineTo(-Math.cos(a) * size, -Math.sin(a) * size);
        }
        ctx.stroke();
        ctx.drawImage(softDot(p.color), -size, -size, size * 2, size * 2);
        break;
      }
      case 'shard': {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -size * 1.4); ctx.lineTo(size * 0.7, size * 0.6); ctx.lineTo(-size * 0.6, size * 0.8); ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'rock': {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-size, -size * 0.4); ctx.lineTo(-size * 0.2, -size); ctx.lineTo(size, -size * 0.3);
        ctx.lineTo(size * 0.6, size * 0.8); ctx.lineTo(-size * 0.7, size * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'leaf':
      case 'petal':
      case 'feather': {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.scale(1, Math.sin(now / 160 + p.seed * 10)); // 翻轉飄動
        if (p.kind === 'feather') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(softDot(p.color), -size * 2, -size * 2, size * 4, size * 4);
        }
        ctx.fillStyle = p.color;
        const L = p.kind === 'petal' ? size * 0.9 : size * 1.5, W = p.kind === 'feather' ? size * 0.35 : size * 0.6;
        ctx.beginPath(); ctx.moveTo(-L, 0); ctx.quadraticCurveTo(0, -W * 1.6, L, 0); ctx.quadraticCurveTo(0, W * 1.6, -L, 0); ctx.fill();
        if (p.kind === 'leaf') {
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(-L * 0.8, 0); ctx.lineTo(L * 0.8, 0); ctx.stroke();
        }
        break;
      }
      case 'bug': {
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        const flap = Math.abs(Math.sin(now / 25 + p.seed * 30));
        ctx.fillStyle = 'rgba(190,255,170,0.55)';
        ctx.beginPath(); ctx.ellipse(-size * 0.2, -size * 0.6 * flap, size * 0.7, size * 0.35, -0.5, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-size * 0.2, size * 0.6 * flap, size * 0.7, size * 0.35, 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.ellipse(0, 0, size, size * 0.45, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c6ff6a';
        ctx.beginPath(); ctx.arc(size * 0.8, 0, size * 0.22, 0, TAU); ctx.fill();
        break;
      }
      case 'butterfly': {
        // 彩蝶：兩對翅膀拍動，身上帶光
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI / 2);
        ctx.drawImage(softDot(p.color), -size * 2.2, -size * 2.2, size * 4.4, size * 4.4);
        const flap = 0.25 + 0.75 * Math.abs(Math.sin(now / 55 + p.seed * 30));
        ctx.fillStyle = p.color;
        for (const side of [-1, 1]) {
          ctx.beginPath(); ctx.ellipse(side * size * 0.7 * flap, -size * 0.35, size * 0.8 * flap, size * 0.65, side * 0.5, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.ellipse(side * size * 0.5 * flap, size * 0.45, size * 0.55 * flap, size * 0.45, -side * 0.4, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-size * 0.08, -size * 0.6, size * 0.16, size * 1.2);
        break;
      }
      case 'ring': {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.5, p.size * 0.15 * (1 - k));
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, TAU); ctx.stroke();
        break;
      }
      case 'bubble': {
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.2;
        ctx.fillStyle = rgba(p.color, 0.25);
        ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(p.x - size * 0.35, p.y - size * 0.35, size * 0.25, 0, TAU); ctx.fill();
        break;
      }
    }
  }

  // ---------- 掛到 BattleScene 上的工具 ----------
  // 四角星芒（追星破月的星點）
  function twinkle(ctx, x, y, r, color, alpha) {
    if (r <= 0 || alpha <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(softDot(color), x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU - Math.PI / 2, rr = i % 2 ? r * 0.18 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  const kit = {
    initFx() {
      this.parts = [];
      this.timers = [];
      this.dims = [];
      this.lastNow = 0;
    },

    // 在指定時刻執行（跟著畫面時鐘走，不用 setTimeout）
    at(time, fn) { this.timers.push({ time, fn }); },

    runTimers(now) {
      if (!this.timers.length) return;
      const due = this.timers.filter(t => t.time <= now);
      if (!due.length) return;
      this.timers = this.timers.filter(t => t.time > now);
      due.forEach(t => t.fn(now));
    },

    // 單次噴發粒子：pos 可以是 {x,y} 或回傳 {x,y} 的函式（在發射當下才取值）
    burst(at, pos, n, o) {
      this.at(at, () => {
        const p = typeof pos === 'function' ? pos() : pos;
        for (let i = 0; i < n; i++) this.parts.push(makePart(this, at, p.x, p.y, o));
      });
    },
    // 持續噴發：rate 每秒顆數
    stream(at, dur, rate, pos, o) {
      let acc = 0, last = null;
      this.addFx(at, dur, (ctx, t, el, now) => {
        const dt = last === null ? 16 : now - last; last = now;
        acc += rate * dt / 1000;
        const n = Math.floor(acc); acc -= n;
        for (let i = 0; i < n; i++) {
          const p = typeof pos === 'function' ? pos(t) : pos;
          this.parts.push(makePart(this, now, p.x, p.y, typeof o === 'function' ? o(t) : o));
        }
      });
    },

    updateParts(now, dt) {
      const sec = dt / 1000;
      this.parts = this.parts.filter(p => now < p.born + p.life);
      for (const p of this.parts) {
        if (now < p.born) continue;
        const damp = Math.exp(-p.drag * sec);
        p.vx *= damp; p.vy *= damp;
        p.vy += p.g * sec;
        if (p.to) {
          const dx = p.to.x - p.x, dy = p.to.y - p.y;
          p.vx += dx * p.pull * sec; p.vy += dy * p.pull * sec;
        }
        if (p.wob) { p.vx += Math.sin(now / 120 + p.wobPh) * p.wob * this.scale * sec * 60; }
        p.x += p.vx * sec; p.y += p.vy * sec;
        p.rot += p.vr * sec;
      }
    },

    drawParts(ctx, now) {
      for (const p of this.parts) {
        if (now < p.born) continue;
        ctx.save();
        drawPart(ctx, p, (now - p.born) / p.life, now);
        ctx.restore();
      }
    },

    // 畫面壓暗（大招用）
    dimScreen(at, dur, amount = 0.5, color = '#000') { this.dims.push({ at, dur, amount, color }); },
    drawDim(ctx, now) {
      this.dims = this.dims.filter(d => now < d.at + d.dur);
      let best = null, k = 0;
      for (const d of this.dims) {
        if (now < d.at) continue;
        const v = env((now - d.at) / d.dur, 0.12, 0.3) * d.amount;
        if (v > k) { k = v; best = d; }
      }
      if (!best) return;
      ctx.save();
      ctx.globalAlpha = k; ctx.fillStyle = best.color;
      ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
      ctx.restore();
    },

    // 位置
    feet(slot) { return { x: this.baseX(slot), y: this.groundY }; },
    head(slot) { return { x: this.baseX(slot), y: this.groundY - 105 * this.scale }; },
    dirTo(a, b) { return Math.sign(this.baseX(b) - this.baseX(a)) || 1; },

    // ---------- 繪圖基本元件 ----------
    glowAt(ctx, x, y, r, color, alpha = 1, core) {
      if (r <= 0 || alpha <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(softDot(color, core), x - r, y - r, r * 2, r * 2);
      ctx.restore();
    },

    // 衝擊波圓環（squash < 1 為地面上的橢圓）
    shock(ctx, x, y, t, o = {}) {
      const s = this.scale, { r0 = 10, r1 = 80, w = 10, color = '#ffffff', squash = 1, alpha = 1 } = o;
      const r = (r0 + (r1 - r0) * easeOut(t)) * s;
      const a = (1 - t) * alpha;
      if (a <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(x, y); ctx.scale(1, squash);
      ctx.globalAlpha = a * 0.35; ctx.strokeStyle = color; ctx.lineWidth = w * s * (1 - t * 0.6) * 2.2;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = w * s * (1 - t * 0.7) * 0.6;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(0.6, w * s * 0.18 * (1 - t));
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.restore();
    },

    // 命中閃光：光球 + 十字星芒
    flare(ctx, x, y, t, size, color, rays = 4) {
      const s = this.scale * size;
      const a = 1 - easeIn(t);
      this.glowAt(ctx, x, y, (18 + 26 * easeOut(t)) * s, color, a * 0.8);
      this.glowAt(ctx, x, y, 10 * s * (1 - t), '#ffffff', a);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
      ctx.translate(x, y); ctx.rotate(0.3);
      for (let i = 0; i < rays; i++) {
        ctx.rotate(TAU / rays);
        const L = (i % 2 ? 50 : 85) * s * (0.5 + easeOut(t * 2) * 0.7), W = 4 * s * (1 - t);
        const g = ctx.createLinearGradient(0, 0, L, 0);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, color); g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, -W); ctx.lineTo(L, 0); ctx.lineTo(0, W); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },

    // 標準命中：閃光 + 衝擊波 + 火花 + 震動
    impact(at, slot, color, size = 1, o = {}) {
      const p = () => {
        const b = this.body(slot);
        return { x: b.x + (o.dx || 0) * this.scale, y: b.y + (o.dy || 0) * this.scale };
      };
      this.addFx(at, 300, (ctx, t) => { const q = p(); this.flare(ctx, q.x, q.y, t, size, color); });
      this.addFx(at, 450, (ctx, t) => { const q = p(); this.shock(ctx, q.x, q.y, t, { r1: 70 * size, w: 7 * size, color }); });
      this.burst(at, p, Math.round(14 * size), { kind: 'spark', speed: [160, 420], life: [220, 420], size: [1.6, 3], color: ['#ffffff', color], drag: 4 });
      this.burst(at, p, Math.round(8 * size), { kind: 'glow', speed: [30, 120], life: [300, 600], size: [2, 4], color, drag: 3 });
      if (o.shake !== false) this.at(at, now => this.doShake(now, 160 + 120 * size, 3 + 3.5 * size));
    },

    // 刀光／劍氣月牙：u 從 lo 到 hi 的部分，中間最厚、兩端尖
    crescent(ctx, cx, cy, r, thick, a0, sweep, lo, hi, color, alpha = 1) {
      lo = clamp01(lo); hi = clamp01(hi);
      if (hi - lo < 0.01 || alpha <= 0) return;
      const N = 24, outer = [], inner = [];
      for (let i = 0; i <= N; i++) {
        const u = lo + (hi - lo) * i / N;
        const a = a0 + sweep * u;
        const w = thick * Math.pow(Math.sin(Math.PI * u), 0.7) * (0.35 + 0.65 * u); // 刀尾較細
        outer.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        inner.push([cx + Math.cos(a) * (r - w), cy + Math.sin(a) * (r - w)]);
      }
      const path = () => {
        ctx.beginPath();
        outer.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
        ctx.closePath();
      };
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.45; ctx.fillStyle = color;
      ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.lineWidth = thick * 0.6;
      path(); ctx.stroke(); ctx.fill();
      ctx.globalAlpha = alpha; path(); ctx.fill();
      // 白色刀芯（貼外緣）
      ctx.globalAlpha = alpha * 0.95; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, thick * 0.18); ctx.lineCap = 'round';
      ctx.beginPath(); outer.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      ctx.restore();
    },

    // 閃電路徑（中點位移法），帶分支
    boltPts(x0, y0, x1, y1, disp, depth = 6) {
      let pts = [[x0, y0], [x1, y1]];
      let d = disp;
      for (let k = 0; k < depth; k++) {
        const next = [pts[0]];
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const nx = -(by - ay), ny = bx - ax, L = Math.hypot(nx, ny) || 1;
          const off = rand(-d, d);
          next.push([mx + nx / L * off, my + ny / L * off], pts[i + 1]);
        }
        pts = next; d *= 0.55;
      }
      return pts;
    },
    makeBolt(x0, y0, x1, y1, disp, branches = 3) {
      const main = this.boltPts(x0, y0, x1, y1, disp);
      const list = [{ pts: main, w: 1 }];
      for (let i = 0; i < branches; i++) {
        const idx = Math.floor(rand(0.2, 0.7) * main.length);
        const [sx, sy] = main[idx];
        const len = Math.hypot(x1 - x0, y1 - y0) * rand(0.15, 0.35);
        const ang = Math.atan2(y1 - y0, x1 - x0) + rand(0.4, 0.9) * (Math.random() < 0.5 ? -1 : 1);
        list.push({ pts: this.boltPts(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len, disp * 0.4, 4), w: 0.45 });
      }
      return list;
    },
    drawBoltList(ctx, list, width, color, alpha) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const { pts, w } of list) {
        for (const [lw, col, a] of [[width * w * 5, color, 0.18], [width * w * 2, color, 0.7], [width * w * 0.8, '#ffffff', 1]]) {
          ctx.globalAlpha = alpha * a; ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.6, lw);
          ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
        }
      }
      ctx.restore();
    },
    // 一道閃電：每 60ms 重新生成形狀造成閃爍
    strike(at, dur, from, to, o = {}) {
      const { width = 3, color = '#b98cff', disp = 40, branches = 3 } = o;
      let list = null, made = -1;
      this.addFx(at, dur, (ctx, t, el) => {
        const A = typeof from === 'function' ? from() : from, B = typeof to === 'function' ? to() : to;
        const gen = Math.floor(el / 60);
        if (gen !== made) { list = this.makeBolt(A.x, A.y, B.x, B.y, disp * this.scale, branches); made = gen; }
        const flick = t < 0.25 ? 1 : (gen % 2 ? 0.55 : 1) * (1 - t);
        this.drawBoltList(ctx, list, width * this.scale, color, flick);
      });
    },

    // 集中線（大招命中）
    speedLines(ctx, cx, cy, t, color = '#ffffff', n = 28) {
      const s = this.scale;
      const R = Math.hypot(this.W, this.H) * 0.7;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 * (1 - t);
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + Math.sin(i * 91.7) * 0.1;
        const r0 = (70 + 50 * Math.abs(Math.sin(i * 12.3))) * s + easeOut(t) * 30 * s, w = (1 + (i % 3)) * s;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.lineTo(cx + Math.cos(a + 0.012) * r0 + Math.cos(a + Math.PI / 2) * w, cy + Math.sin(a + 0.012) * r0 + Math.sin(a + Math.PI / 2) * w);
        ctx.lineTo(cx + Math.cos(a - 0.012) * r0, cy + Math.sin(a - 0.012) * r0);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },

    // 法陣：bagua 八卦 / seal 符陣 / rune 符文環 / leaf 草木陣。squash 0.3 = 鋪在地上
    // 有 bagua.png、circle.png 時，金色的八卦、符陣、符文環改用圖片
    magicCircle(ctx, x, y, r, t, color, kind = 'seal', squash = 0.32, spin = 1) {
      const s = this.scale; r *= s;
      const a = env(t, 0.15, 0.3);
      const open = easeOut(t * 3);
      const tex = kind === 'leaf' ? null : this.fxTex(kind === 'bagua' ? 'bagua' : 'circle');
      ctx.save();
      ctx.translate(x, y); ctx.scale(1, squash);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a;
      ctx.rotate(t * 1.6 * spin);
      if (tex) {
        const R = r * 1.15 * open;
        ctx.drawImage(tex.img, -R, -R, R * 2, R * 2);
        ctx.restore();
        return;
      }
      ctx.drawImage(softDot(color), -r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
      ctx.strokeStyle = color; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(0, 0, r * open, 0, TAU); ctx.stroke();
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.86 * open, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.5 * open, 0, TAU); ctx.stroke();
      // 外環刻度
      for (let i = 0; i < 36; i++) {
        const ang = i / 36 * TAU, r1 = r * 0.86 * open, r2 = r1 + (i % 3 ? 4 : 8) * s * open;
        ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1); ctx.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2); ctx.stroke();
      }
      if (kind === 'bagua') {
        // 八卦爻（三條槓，陰爻中斷）
        const TRI = [7, 0, 3, 4, 2, 5, 1, 6];
        ctx.lineWidth = 2.4 * s;
        for (let i = 0; i < 8; i++) {
          ctx.save();
          ctx.rotate(i / 8 * TAU);
          for (let l = 0; l < 3; l++) {
            const rr = r * (0.58 + l * 0.08) * open, half = r * 0.14 * open;
            const yin = (TRI[i] >> l) & 1;
            ctx.beginPath();
            if (yin) { ctx.moveTo(-half, -rr); ctx.lineTo(-half * 0.2, -rr); ctx.moveTo(half * 0.2, -rr); ctx.lineTo(half, -rr); }
            else { ctx.moveTo(-half, -rr); ctx.lineTo(half, -rr); }
            ctx.stroke();
          }
          ctx.restore();
        }
        // 太極
        const rr = r * 0.32 * open;
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -rr / 2, rr / 2, -Math.PI / 2, Math.PI / 2); ctx.arc(0, rr / 2, rr / 2, -Math.PI / 2, Math.PI / 2, true); ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(0, -rr / 2, rr * 0.12, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(0, rr / 2, rr * 0.12, 0, TAU); ctx.fill();
      } else {
        // 五芒星 + 符文
        ctx.lineWidth = 1.6 * s;
        ctx.beginPath();
        for (let i = 0; i <= 5; i++) { const ang = -Math.PI / 2 + i * TAU * 2 / 5; ctx.lineTo(Math.cos(ang) * r * 0.86 * open, Math.sin(ang) * r * 0.86 * open); }
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = `700 ${Math.round(r * 0.16)}px "Noto Serif TC", serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const runes = kind === 'rune' ? '風雷雲雨天地水火' : kind === 'leaf' ? '草木回春生生不息' : '敕令鎮妖急急如律';
        for (let i = 0; i < 8; i++) {
          const ang = i / 8 * TAU;
          ctx.save(); ctx.rotate(ang); ctx.translate(0, -r * 0.68 * open); ctx.fillText(runes[i], 0, 0); ctx.restore();
        }
      }
      ctx.restore();
    },

    // 光柱
    pillar(ctx, x, t, color, width = 40, top = 0) {
      const s = this.scale, w = width * s * (0.4 + 0.6 * easeOut(t * 3)) * (1 - easeIn(seg(t, 0.6, 1)));
      if (w <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = env(t, 0.1, 0.35);
      const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
      g.addColorStop(0, rgba(color, 0)); g.addColorStop(0.35, rgba(color, 0.55)); g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.65, rgba(color, 0.55)); g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g; ctx.fillRect(x - w, top, w * 2, this.groundY - top);
      ctx.restore();
    },

    // 漸層拖尾：posAt(u) 回傳 u（0~1 進度）時的位置
    trail(ctx, posAt, t, span, width, color, alpha = 1) {
      const N = 14, s = this.scale;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      let prev = posAt(Math.max(0, t - span));
      for (let i = 1; i <= N; i++) {
        const u = Math.max(0, t - span + span * i / N);
        const p = posAt(u);
        const k = i / N;
        ctx.globalAlpha = alpha * k * 0.9;
        ctx.strokeStyle = color; ctx.lineWidth = width * s * k;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        prev = p;
      }
      ctx.restore();
    },

    // 飛劍
    sword(ctx, x, y, ang, len, color, alpha = 1, glow = 0.6) {
      const s = this.scale * len / 60;
      const tex = this.fxTex('sword');
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = alpha;
      this.glowAt(ctx, 4 * s, 0, 30 * s, color, glow * alpha);
      if (tex) {
        const w = 90 * s, h = w * tex.h / tex.w;
        ctx.globalCompositeOperation = tex.blend;
        ctx.drawImage(tex.img, -w / 2, -h / 2, w, h);
        ctx.restore();
        return;
      }
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, -4 * s, 0, 4 * s);
      g.addColorStop(0, rgba(color, 0.9)); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, rgba(color, 0.9));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(34 * s, 0); ctx.lineTo(24 * s, -3.6 * s); ctx.lineTo(-12 * s, -3.2 * s); ctx.lineTo(-12 * s, 3.2 * s); ctx.lineTo(24 * s, 3.6 * s); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#e8c35a';
      ctx.fillRect(-15 * s, -8 * s, 3.5 * s, 16 * s);
      ctx.fillStyle = '#5a3a20';
      ctx.fillRect(-26 * s, -2.2 * s, 11 * s, 4.4 * s);
      ctx.fillStyle = '#e8c35a';
      ctx.beginPath(); ctx.arc(-27 * s, 0, 2.6 * s, 0, TAU); ctx.fill();
      ctx.restore();
    },

    // 符咒（黃紙硃砂）
    charm(ctx, x, y, ang, size, burning = 0, glowColor = '#ffd84a') {
      const s = this.scale * size;
      const tex = this.fxTex('talisman');
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      this.glowAt(ctx, 0, 0, 26 * s, glowColor, 0.5);
      if (tex) {
        const h = 30 * s, w = h * tex.w / tex.h;
        ctx.globalCompositeOperation = tex.blend;
        ctx.drawImage(tex.img, -w / 2, -h / 2, w, h);
      } else {
        ctx.fillStyle = '#ffe27a'; ctx.strokeStyle = '#b07a10'; ctx.lineWidth = 0.8 * s;
        ctx.fillRect(-7 * s, -15 * s, 14 * s, 30 * s); ctx.strokeRect(-7 * s, -15 * s, 14 * s, 30 * s);
        ctx.strokeStyle = '#c0261b'; ctx.lineWidth = 1.4 * s; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-4 * s, -11 * s); ctx.lineTo(4 * s, -11 * s);
        ctx.moveTo(0, -13 * s); ctx.lineTo(0, 11 * s);
        ctx.moveTo(-4 * s, -5 * s); ctx.quadraticCurveTo(0, -2 * s, 4 * s, -5 * s);
        ctx.moveTo(-4 * s, 1 * s); ctx.lineTo(4 * s, 3 * s);
        ctx.moveTo(-3 * s, 7 * s); ctx.quadraticCurveTo(3 * s, 6 * s, 2 * s, 11 * s);
        ctx.stroke();
      }
      if (burning > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = burning;
        ctx.drawImage(softDot('#ff7a1a', 0.2), -18 * s, -24 * s, 36 * s, 36 * s);
      }
      ctx.restore();
    },

    // 書法大字印記
    stamp(ctx, p, text, color, t, size = 1) {
      const s = this.scale * size;
      const pop = t < 0.12 ? 1.8 - 0.8 * easeOut(t / 0.12) : 1 + 0.04 * (t - 0.12);
      ctx.save();
      ctx.globalAlpha = env(t, 0.05, 0.3);
      ctx.translate(p.x, p.y); ctx.scale(pop, pop); ctx.rotate(-0.08);
      this.glowAt(ctx, 0, 0, 50 * s, color, 0.7);
      ctx.font = `900 ${Math.round(48 * s)}px "Noto Serif TC", "Songti TC", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 7 * s; ctx.strokeStyle = 'rgba(20,10,5,0.9)'; ctx.strokeText(text, 0, 0);
      const g = ctx.createLinearGradient(0, -24 * s, 0, 24 * s);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, color);
      ctx.fillStyle = g; ctx.fillText(text, 0, 0);
      ctx.restore();
    },

    // 角色身後浮現的大字（增益招式用）
    bigGlyph(ctx, slot, text, color, t) {
      const s = this.scale, p = this.body(slot);
      const k = 1.25 - 0.25 * easeOut(t * 2);
      ctx.save();
      ctx.globalAlpha = env(t, 0.2, 0.35) * 0.75;
      ctx.translate(p.x, p.y - 8 * s); ctx.scale(k, k);
      this.glowAt(ctx, 0, 0, 70 * s, color, 0.5);
      ctx.font = `900 ${Math.round(92 * s)}px "Noto Serif TC", "Songti TC", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(color, 0.55); ctx.fillText(text, 0, 0);
      ctx.lineWidth = 1.5 * s; ctx.strokeStyle = '#ffffff'; ctx.strokeText(text, 0, 0);
      ctx.restore();
    },

    // 殘影：把施放者畫到離屏畫布、染色後以發光方式疊上
    ghost(ctx, slot, dx, alpha, now, tint) {
      const f = this.fighters[slot];
      if (!f || alpha <= 0) return;
      const s = this.scale, w = Math.ceil(200 * s), h = Math.ceil(170 * s), dpr = this.dpr;
      const c = this.ghostCv || (this.ghostCv = document.createElement('canvas'));
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      g.clearRect(0, 0, w, h);
      Sprites.drawFighter(g, f.look, Sprites.poseFor(f.look, null, now), w / 2, h - 12 * s, s, f.facing, now, { noShadow: true });
      g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.6;
      g.fillStyle = tint || f.look.aura; g.fillRect(0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha); ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(c, this.baseX(slot) + dx * s - w / 2, this.groundY - h + 12 * s, w, h);
      ctx.restore();
    },

    // 特效貼圖（public/img/fx/，由 sprites.js 載入）
    fxTex(name) { return Sprites.fxTex ? Sprites.fxTex(name) : null; },

    // 烏雲
    cloud(ctx, x, y, w, t, color = '#2a2440', lit = 0) {
      const s = this.scale;
      const a = env(t, 0.2, 0.25);
      ctx.save();
      for (let i = 0; i < 9; i++) {
        const ox = Math.sin(i * 2.7) * w * 0.5 * s * (0.6 + 0.4 * easeOut(t * 2)), oy = Math.cos(i * 1.9) * 9 * s;
        const r = (22 + (i % 3) * 9) * s * (0.6 + 0.4 * easeOut(t * 2));
        ctx.globalAlpha = a * 0.85;
        ctx.drawImage(smokeDot(color), x + ox - r, y + oy - r, r * 2, r * 2);
      }
      if (lit > 0) this.glowAt(ctx, x, y, w * s, '#c9b6ff', lit * a);
      ctx.restore();
    },

    // 弓箭
    arrowShape(ctx, x, y, ang, size, color) {
      const s = this.scale * size;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      this.glowAt(ctx, 6 * s, 0, 18 * s, color, 0.8);
      ctx.strokeStyle = '#f3e6c8'; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(-26 * s, 0); ctx.lineTo(12 * s, 0); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(19 * s, 0); ctx.lineTo(9 * s, -4.5 * s); ctx.lineTo(11 * s, 0); ctx.lineTo(9 * s, 4.5 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(-26 * s, 0); ctx.lineTo(-32 * s, -5 * s); ctx.lineTo(-20 * s, 0); ctx.lineTo(-32 * s, 5 * s); ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    // 用特效貼圖畫（有圖時）。回傳是否有畫
    drawTex(ctx, name, x, y, w, ang = 0, alpha = 1, flip = 1) {
      const tex = this.fxTex(name);
      if (!tex) return false;
      const h = w * tex.h / tex.w;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang); ctx.scale(flip, 1);
      ctx.globalAlpha = alpha; ctx.globalCompositeOperation = tex.blend;
      ctx.drawImage(tex.img, -w / 2, -h / 2, w, h);
      ctx.restore();
      return true;
    }
  };

  // ---------- 各招特效 ----------
  // 每招註解寫的是想呈現的意境
  const moves = {
    // ===== 李逍遙 =====
    // 御劍：劍在手邊凝聚靈光，化作流光飛劍貫穿敵人
    swordbeam(t0, a, b, f) {
      const col = '#7fc8ff', dir = this.dirTo(a, b);
      // 有施法立繪時，劍懸在往前伸的劍訣指尖前方
      const empty = Sprites.hasPose(f.look.id, 'cast');
      const start = () => empty
        ? { x: this.baseX(a) + dir * 78 * this.scale, y: this.groundY - 84 * this.scale }
        : (h => ({ x: h.x, y: h.y - 30 * this.scale }))(this.hand(a));
      this.burst(t0 + 150, start, 16, { kind: 'glow', speed: [40, 80], life: [350, 500], size: [1.5, 3], color: col, to: start(), pull: 18, drag: 1 });
      this.addFx(t0 + 200, 300, (ctx, t) => {
        const p = start();
        this.sword(ctx, p.x, p.y + Math.sin(t * 9) * 2 * this.scale, dir > 0 ? 0 : Math.PI, 50 + 10 * t, col, easeOut(t * 2));
      });
      const path = u => {
        const A = start(), B = this.body(b);
        return { x: A.x + (B.x - A.x) * easeIn(u), y: A.y + (B.y - A.y) * u - Math.sin(Math.PI * u) * 22 * this.scale };
      };
      this.addFx(t0 + 500, 250, (ctx, t) => {
        this.trail(ctx, path, t, 0.55, 12, col, 0.8);
        [0.18, 0.1].forEach((d, i) => { const g = path(Math.max(0, t - d)); this.sword(ctx, g.x, g.y, dir > 0 ? 0 : Math.PI, 60, col, 0.25 + i * 0.15); });
        const p = path(t);
        this.sword(ctx, p.x, p.y, dir > 0 ? 0 : Math.PI, 66, col, 1);
      });
      this.impact(t0 + IMPACT, b, col, 1.1);
      this.burst(t0 + IMPACT, () => this.body(b), 10, { kind: 'spark', angle: dir > 0 ? [-0.5, 0.5] : [Math.PI - 0.5, Math.PI + 0.5], speed: [300, 520], life: [200, 350], size: 2, color: '#d6efff', drag: 3 });
      // 施法立繪是空手劍訣：命中後飛劍迴旋飛回手上
      if (empty) this.addFx(t0 + IMPACT + 30, 250, (ctx, t) => {
        const A = this.body(b), B = this.hand(a), u = easeOut(t);
        const x = A.x + (B.x - A.x) * u, y = A.y + (B.y - A.y) * u - Math.sin(Math.PI * u) * 36 * this.scale;
        this.sword(ctx, x, y, dir * t * TAU * 1.5, 56, col, 1 - 0.4 * t, 0.4);
      });
    },

    // 劍氣斬：揮劍劈出巨大的青色月牙劍氣，貼地飛馳斬過敵人
    swordqi(t0, a, b, f) {
      const col = '#4fd1e8', dir = this.dirTo(a, b);
      const X = u => this.baseX(a) + (this.baseX(b) - this.baseX(a)) * u;
      this.addFx(t0 + 380, 160, (ctx, t) => {
        const h = this.hand(a), r = 40 * this.scale;
        this.crescent(ctx, h.x - dir * 10 * this.scale, h.y, r, 14 * this.scale, dir > 0 ? -1.9 : Math.PI + 1.9, dir * 2.6, t - 0.5, t, col, 1);
      });
      this.addFx(t0 + 480, 290, (ctx, t) => {
        const u = easeIn(t) * 0.85 + 0.1;
        const x = X(u), y = this.body(b).y, r = 55 * this.scale;
        // 月牙主體（直立，凸面朝前）
        this.crescent(ctx, x - dir * r * 0.7, y, r, 24 * this.scale, dir > 0 ? -1.2 : Math.PI + 1.2, dir * 2.4, 0, 1, col, 1);
        this.glowAt(ctx, x - dir * 8 * this.scale, y, 55 * this.scale, col, 0.45);
        // 地面劃痕
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(X(0.1), 0, x, 0);
        g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, 0.7));
        ctx.fillStyle = g; ctx.fillRect(Math.min(X(0.1), x), this.groundY - 2 * this.scale, Math.abs(x - X(0.1)), 4 * this.scale);
      });
      this.stream(t0 + 480, 270, 90, t => ({ x: X(easeIn(t) * 0.85 + 0.1), y: this.groundY - 4 * this.scale }), { kind: 'glow', angle: [-Math.PI * 0.9, -Math.PI * 0.1], speed: [20, 70], life: [300, 500], size: [1.2, 2.4], color: col, g: 60 });
      // 命中：交叉十字斬
      this.addFx(t0 + IMPACT, 320, (ctx, t) => {
        const p = this.body(b), r = 60 * this.scale;
        this.crescent(ctx, p.x, p.y + r * 0.2, r, 10 * this.scale, -2.4, 1.6, t * 2 - 0.6, t * 2, '#bff4ff', 1 - t);
        this.crescent(ctx, p.x, p.y - r * 0.2, r, 10 * this.scale, 2.4, -1.6, t * 2 - 0.8, t * 2 - 0.2, '#bff4ff', 1 - t);
      });
      this.impact(t0 + IMPACT, b, col, 1.2);
    },

    // 醉仙步（醉仙望月步）：身形如醉，左右飄出多道殘影，周身清風捲葉
    drunkstep(t0, a, b, f) {
      const col = '#8dffc0';
      this.addFx(t0 + 250, 1000, (ctx, t, el, now) => {
        const sway = Math.sin(t * Math.PI * 4);
        const a1 = env(t, 0.15, 0.4);
        this.ghost(ctx, a, -30 * sway, 0.35 * a1, now, col);
        this.ghost(ctx, a, 30 * sway, 0.25 * a1, now, col);
        this.ghost(ctx, a, -55 * Math.sin(t * Math.PI * 3), 0.15 * a1, now, col);
      });
      this.addFx(t0 + 300, 950, (ctx, t, el) => {
        const p = this.feet(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        for (let k = 0; k < 5; k++) {
          const y = p.y - (12 + k * 22) * s, r = (34 + k * 3) * s, a0 = el / 130 + k * 1.3;
          ctx.globalAlpha = env(t) * (0.8 - k * 0.1);
          ctx.strokeStyle = col; ctx.lineWidth = (3.5 - k * 0.4) * s;
          ctx.beginPath(); ctx.ellipse(p.x, y, r, r * 0.22, 0, a0, a0 + 2.4); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 * s;
          ctx.beginPath(); ctx.ellipse(p.x, y, r, r * 0.22, 0, a0 + 0.6, a0 + 1.8); ctx.stroke();
        }
      });
      this.stream(t0 + 300, 800, 26, () => { const p = this.body(a); return { x: p.x + rand(-40, 40) * this.scale, y: p.y + rand(10, 60) * this.scale }; },
        { kind: 'leaf', angle: [-Math.PI * 0.8, -Math.PI * 0.2], speed: [60, 130], life: [700, 1000], size: [3, 5], color: ['#7ed957', '#b5e48c', '#52b788'], spin: 6, drag: 1 });
      this.layerBack(t0 + 400, 800, (ctx, t) => this.bigGlyph(ctx, a, '醉', '#8dffc0', t));
    },

    // 天罡戰氣：腳下金色法陣，周身燃起金色鬥氣火焰，「罡」字浮現
    aura(t0, a, b, f) {
      const col = '#ffc94a';
      this.addFx(t0 + 200, 1150, (ctx, t) => { const p = this.feet(a); this.magicCircle(ctx, p.x, p.y, 62, t, col, 'rune'); });
      this.layerBack(t0 + 300, 1050, (ctx, t, el) => {
        const p = this.feet(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter';
        // 火焰狀鬥氣：多條上竄的光舌
        for (let k = 0; k < 9; k++) {
          const ph = (el / 520 + k / 9) % 1;
          const x = p.x + Math.sin(k * 2.39) * 30 * s;
          const h = (70 + 40 * Math.sin(k * 1.7 + el / 200)) * s * env(t, 0.2, 0.35);
          const w = (14 - ph * 6) * s;
          const g = ctx.createLinearGradient(0, p.y, 0, p.y - h);
          g.addColorStop(0, rgba(col, 0.75)); g.addColorStop(0.6, rgba('#ff8a3d', 0.35)); g.addColorStop(1, rgba('#ff8a3d', 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(x - w, p.y);
          ctx.quadraticCurveTo(x - w * 0.8 + Math.sin(el / 90 + k) * 6 * s, p.y - h * 0.6, x + Math.sin(el / 120 + k) * 8 * s, p.y - h);
          ctx.quadraticCurveTo(x + w * 0.8, p.y - h * 0.5, x + w, p.y);
          ctx.closePath(); ctx.fill();
        }
      });
      this.addFx(t0 + 300, 1050, (ctx, t) => { const p = this.body(a); this.glowAt(ctx, p.x, p.y, 75 * this.scale, col, 0.45 * env(t)); });
      this.stream(t0 + 300, 900, 40, () => { const p = this.feet(a); return { x: p.x + rand(-35, 35) * this.scale, y: p.y }; },
        { kind: 'ember', angle: [-Math.PI * 0.6, -Math.PI * 0.4], speed: [80, 160], life: [500, 900], size: [1.5, 3], color: [col, '#fff2b0', '#ff9a3d'], drag: 0.8 });
      this.layerBack(t0 + 450, 900, (ctx, t) => this.bigGlyph(ctx, a, '罡', col, t));
    },

    // 萬劍歸宗（萬劍訣）：敵人頭頂展開旋轉劍陣，萬劍如雨齊落，最後一道光柱貫地
    swords(t0, a, b, f, ev) {
      const col = '#a5d8ff', hits = ev.hits || 5, gap = ev.multiGap || 160;
      const N = 14;
      this.dimScreen(t0 + 150, IMPACT + hits * gap + 500, 0.55, '#05081a');
      const center = () => ({ x: this.baseX(b), y: this.H * 0.16 });
      this.addFx(t0 + 200, IMPACT - 200 + hits * gap, (ctx, t, el) => {
        const c = center(), s = this.scale;
        this.glowAt(ctx, c.x, c.y, 80 * s, col, 0.35 * env(t));
        this.magicCircle(ctx, c.x, c.y, 70, t, col, 'rune', 0.28, 1.5);
        // 劍陣：環狀排列、劍尖朝下，依序浮現
        for (let i = 0; i < N; i++) {
          const show = clamp01((el - i * 25) / 120);
          const ang = i / N * TAU + el / 900;
          const x = c.x + Math.cos(ang) * 64 * s, y = c.y + Math.sin(ang) * 15 * s;
          const fired = el > IMPACT - 450 + (i % hits) * gap;
          if (!fired) this.sword(ctx, x, y + 6 * s, Math.PI / 2, 40, col, show * env(t, 0.1, 0.1), 0.15);
        }
      });
      for (let k = 0; k < hits; k++) {
        const at = t0 + IMPACT + k * gap;
        for (let j = 0; j < 3; j++) {
          const ox = (j - 1) * 22 + rand(-8, 8);
          this.addFx(at - 140 + j * 30, 140, (ctx, t) => {
            const c = center(), B = this.body(b), s = this.scale;
            const x0 = c.x + ox * 1.5 * s, y0 = c.y + 10 * s, x1 = B.x + ox * 0.5 * s, y1 = B.y + 10 * s;
            const pos = u => ({ x: x0 + (x1 - x0) * easeIn(u), y: y0 + (y1 - y0) * easeIn(u) });
            this.trail(ctx, pos, t, 0.6, 7, col, 0.9);
            const p = pos(t);
            this.sword(ctx, p.x, p.y, Math.atan2(y1 - y0, x1 - x0), 48, col, 1);
          });
        }
        this.impact(at, b, col, 0.75, { dy: rand(-15, 15), shake: k === hits - 1 });
      }
      const end = t0 + IMPACT + (hits - 1) * gap;
      this.addFx(end, 600, (ctx, t) => this.pillar(ctx, this.baseX(b), t, col, 46));
      this.addFx(end, 600, (ctx, t) => { const p = this.feet(b); this.shock(ctx, p.x, p.y, t, { r1: 140, w: 10, color: col, squash: 0.3 }); });
      this.at(t0 + IMPACT, now => this.doShake(now, hits * gap + 300, 5));
    },

    // ===== 趙靈兒 =====
    // 雷咒：敵人頭頂聚起紫色雷雲，一道分岔落雷劈下
    thunder(t0, a, b) {
      const col = '#b98cff';
      const top = () => ({ x: this.baseX(b), y: this.H * 0.1 });
      this.addFx(t0 + 200, 1000, (ctx, t, el) => { const c = top(); this.cloud(ctx, c.x, c.y, 50, t, '#2d2050', el > 520 && el < 700 ? 0.8 : 0.15); });
      this.strike(t0 + 690, 330, top, () => { const p = this.feet(b); return { x: p.x, y: p.y - 20 * this.scale }; }, { width: 3.4, color: col, disp: 36 });
      this.at(t0 + 690, now => this.doFlash(now, 140, '#e8dcff'));
      this.addFx(t0 + IMPACT, 450, (ctx, t) => { const p = this.feet(b); this.shock(ctx, p.x, p.y, t, { r1: 70, w: 6, color: col, squash: 0.3 }); });
      // 地面竄出的小電弧
      for (let i = 0; i < 3; i++) {
        this.strike(t0 + IMPACT + i * 70, 150, () => this.feet(b), () => { const p = this.feet(b); return { x: p.x + rand(-50, 50) * this.scale, y: p.y - rand(0, 30) * this.scale }; }, { width: 1.2, color: col, disp: 12, branches: 0 });
      }
      this.impact(t0 + IMPACT, b, col, 1);
    },

    // 冰心訣：腳下冰蓮綻放，心如止水，晶瑩雪花緩緩升起
    icelotus(t0, a, b) {
      const col = '#9fdcff';
      this.addFx(t0 + 200, 1250, (ctx, t) => {
        const p = this.feet(a), s = this.scale;
        if (this.drawTex(ctx, 'lotus', p.x, p.y - 22 * s, 110 * s * easeOut(t * 2.5), 0, env(t, 0.15, 0.3))) return;
        const open = easeOut(t * 2.5), al = env(t, 0.15, 0.3);
        ctx.globalCompositeOperation = 'lighter';
        this.glowAt(ctx, p.x, p.y - 10 * s, 60 * s, col, 0.5 * al);
        // 兩層花瓣
        for (const [n, R, Wd, ph, c2] of [[8, 46, 13, 0, '#6fb8ff'], [6, 32, 11, 0.4, '#e6f7ff']]) {
          for (let i = 0; i < n; i++) {
            const ang = -Math.PI / 2 + (i - (n - 1) / 2) / n * Math.PI * 1.4 * open + ph * 0;
            ctx.save();
            ctx.translate(p.x, p.y - 2 * s); ctx.scale(1, 0.75); ctx.rotate(ang + Math.PI / 2);
            const L = R * s * open;
            const g = ctx.createLinearGradient(0, 0, 0, -L);
            g.addColorStop(0, rgba(c2, 0.25)); g.addColorStop(1, rgba(c2, 0.9));
            ctx.globalAlpha = al; ctx.fillStyle = g; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-Wd * s, -L * 0.6, 0, -L); ctx.quadraticCurveTo(Wd * s, -L * 0.6, 0, 0); ctx.fill(); ctx.stroke();
            ctx.restore();
          }
        }
      });
      this.addFx(t0 + 300, 1100, (ctx, t) => { const p = this.feet(a); this.shock(ctx, p.x, p.y, (t * 2) % 1, { r0: 10, r1: 70, w: 3, color: col, squash: 0.28, alpha: env(t) }); });
      this.stream(t0 + 250, 900, 22, () => { const p = this.feet(a); return { x: p.x + rand(-40, 40) * this.scale, y: p.y - 10 * this.scale }; },
        { kind: 'snow', angle: -Math.PI / 2, speed: [40, 80], life: [800, 1200], size: [2.5, 4.5], color: '#dff3ff', spin: 2, drag: 0.5, wob: 0.6 });
      this.addFx(t0 + 650, 500, (ctx, t) => { const p = this.body(a); this.glowAt(ctx, p.x, p.y, 70 * this.scale * easeOut(t), '#c9ecff', 0.8 * (1 - t)); });
    },

    // 天雷破：天色驟暗，厚重雷雲翻湧，三道巨雷連續轟擊，地面電光四竄
    thunderbig(t0, a, b) {
      const col = '#a98bff';
      this.dimScreen(t0 + 100, 1500, 0.5, '#0b0620');
      const top = () => ({ x: this.baseX(b), y: this.H * 0.08 });
      this.addFx(t0 + 100, 1350, (ctx, t, el) => {
        const c = top();
        const lit = (el > 600 && el < 800) ? 1 : 0.2 + 0.2 * Math.sin(el / 50);
        this.cloud(ctx, c.x - 40 * this.scale, c.y, 60, t, '#251a45', lit);
        this.cloud(ctx, c.x + 40 * this.scale, c.y + 6 * this.scale, 60, t, '#251a45', lit);
      });
      [0, 90, 180].forEach((d, k) => {
        this.strike(t0 + 640 + d, 360, () => { const c = top(); return { x: c.x + (k - 1) * 40 * this.scale, y: c.y }; },
          () => { const p = this.feet(b); return { x: p.x + (k - 1) * 12 * this.scale, y: p.y - 15 * this.scale }; }, { width: k === 1 ? 5 : 3, color: col, disp: 50 });
        this.at(t0 + 640 + d, now => this.doFlash(now, 120, '#efe6ff'));
      });
      for (let i = 0; i < 6; i++) {
        this.strike(t0 + IMPACT + i * 60, 180, () => this.feet(b), () => { const p = this.feet(b); const a2 = rand(Math.PI, TAU); return { x: p.x + Math.cos(a2) * 80 * this.scale, y: p.y + Math.sin(a2) * 25 * this.scale }; }, { width: 1.4, color: col, disp: 15, branches: 1 });
      }
      this.addFx(t0 + IMPACT, 600, (ctx, t) => { const p = this.feet(b); this.shock(ctx, p.x, p.y, t, { r1: 130, w: 10, color: col, squash: 0.3 }); });
      this.addFx(t0 + IMPACT, 420, (ctx, t) => { const p = this.body(b); this.speedLines(ctx, p.x, p.y, t, '#e2d6ff'); });
      this.impact(t0 + IMPACT, b, col, 1.6);
    },

    // 五氣朝元：金木水火土五色靈氣環繞周身，旋轉收束入體，化為治癒光柱
    fiveqi(t0, a) {
      const cols = ['#5cd65c', '#ff5a3d', '#ffd23f', '#f2f2f2', '#3d8bff'];
      this.addFx(t0 + 150, 650, (ctx, t, el) => {
        const p = this.body(a), s = this.scale;
        const R = (70 - 60 * easeIn(seg(t, 0.55, 1))) * s;
        cols.forEach((c, i) => {
          const ang = -Math.PI / 2 + i / 5 * TAU + el / 260;
          const x = p.x + Math.cos(ang) * R, y = p.y + Math.sin(ang) * R * 0.75;
          const al = env(t, 0.2, 0.05);
          this.trail(ctx, u => {
            const ag = -Math.PI / 2 + i / 5 * TAU + (u * 650) / 260;
            const RR = (70 - 60 * easeIn(seg(u, 0.55, 1))) * s;
            return { x: p.x + Math.cos(ag) * RR, y: p.y + Math.sin(ag) * RR * 0.75 };
          }, t, 0.2, 7, c, al * 0.7);
          this.glowAt(ctx, x, y, 22 * s, c, al);
          this.glowAt(ctx, x, y, 8 * s, '#ffffff', al);
        });
        // 五行連線
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * env(t);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 * s;
        ctx.beginPath();
        for (let i = 0; i <= 5; i++) {
          const ang = -Math.PI / 2 + (i * 2 % 5) / 5 * TAU + el / 260;
          ctx.lineTo(p.x + Math.cos(ang) * R, p.y + Math.sin(ang) * R * 0.75);
        }
        ctx.stroke();
      });
      this.addFx(t0 + 720, 800, (ctx, t) => this.pillar(ctx, this.baseX(a), t, '#bfffd0', 36));
      this.addFx(t0 + 720, 500, (ctx, t) => { const p = this.body(a); this.flare(ctx, p.x, p.y, t, 0.7, '#c8ffb0', 8); });
      this.burst(t0 + 740, () => this.body(a), 26, { kind: 'glow', speed: [40, 150], life: [600, 1000], size: [1.5, 3.5], color: cols, drag: 2, g: -40 });
      this.stream(t0 + 760, 600, 30, () => { const p = this.feet(a); return { x: p.x + rand(-30, 30) * this.scale, y: p.y }; },
        { kind: 'glow', angle: -Math.PI / 2, speed: [80, 160], life: [600, 900], size: [1.5, 2.8], color: '#d4ffd9', drag: 0.5 });
    },

    // 冰封千里：寒氣貼地蔓延至敵方，冰晶破土而出將敵人冰封，碎冰四濺
    ice(t0, a, b) {
      const col = '#8fd8ff', dir = this.dirTo(a, b);
      const X = u => this.baseX(a) + (this.baseX(b) - this.baseX(a)) * u;
      // 地面寒霜
      this.layerBack(t0 + 350, 1500, (ctx, t) => {
        const s = this.scale, reach = easeOut(t * 2.4);
        const x0 = X(0.12), x1 = X(0.12 + 0.95 * reach);
        const y = this.groundY;
        ctx.globalAlpha = env(t, 0.05, 0.25);
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, 'rgba(200,240,255,0.2)'); g.addColorStop(1, 'rgba(230,250,255,0.85)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse((x0 + x1) / 2, y, Math.abs(x1 - x0) / 2, 7 * s, 0, 0, TAU); ctx.fill();
        // 沿途小冰刺
        for (let i = 0; i < 9; i++) {
          const u = 0.15 + i * 0.09;
          if (u > 0.12 + 0.95 * reach) break;
          const x = X(u), h = (8 + (i % 3) * 6) * s;
          ctx.fillStyle = 'rgba(220,245,255,0.85)'; ctx.strokeStyle = '#3b7fb0'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x - 4 * s, y); ctx.lineTo(x + dir * 2 * s, y - h); ctx.lineTo(x + 4 * s, y); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      });
      this.stream(t0 + 350, 400, 60, t => ({ x: X(0.12 + 0.95 * easeOut(t * 0.96)), y: this.groundY - 4 * this.scale }),
        { kind: 'snow', angle: [-Math.PI * 0.8, -Math.PI * 0.2], speed: [30, 90], life: [500, 800], size: [2, 3.5], color: '#e6f8ff', spin: 3 });
      // 冰晶冰封
      this.addFx(t0 + IMPACT - 30, 1250, (ctx, t) => {
        const p = this.feet(b), s = this.scale;
        const grow = easeOut(t * 4), al = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
        if (this.drawTex(ctx, 'ice', p.x, p.y - 55 * s * grow, 120 * s * grow, 0, al)) return;
        const spikes = [[-38, 52, -0.35], [-20, 88, -0.12], [0, 120, 0], [22, 94, 0.15], [40, 58, 0.35], [-8, 66, -0.05], [12, 70, 0.08]];
        ctx.globalAlpha = al;
        for (const [ox, h, tilt] of spikes) {
          const H = h * s * grow, x = p.x + ox * s;
          ctx.save(); ctx.translate(x, p.y); ctx.rotate(tilt);
          const g = ctx.createLinearGradient(-10 * s, 0, 10 * s, 0);
          g.addColorStop(0, 'rgba(120,190,240,0.75)'); g.addColorStop(0.45, 'rgba(240,252,255,0.9)'); g.addColorStop(1, 'rgba(90,160,220,0.75)');
          ctx.fillStyle = g; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(-11 * s, 0); ctx.lineTo(-7 * s, -H * 0.8); ctx.lineTo(0, -H); ctx.lineTo(7 * s, -H * 0.8); ctx.lineTo(11 * s, 0); ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.beginPath(); ctx.moveTo(0, -H); ctx.lineTo(0, -H * 0.2); ctx.stroke();
          ctx.restore();
        }
        this.glowAt(ctx, p.x, p.y - 50 * s, 70 * s, '#cdeeff', 0.35 * al);
      });
      this.burst(t0 + IMPACT, () => this.body(b), 18, { kind: 'shard', speed: [120, 300], angle: [-Math.PI, 0], life: [500, 800], size: [3, 6], color: ['#d8f3ff', '#9fd4f5', '#ffffff'], g: 600, spin: 10, drag: 1 });
      this.burst(t0 + IMPACT + 950, () => this.body(b), 22, { kind: 'shard', speed: [80, 260], life: [500, 800], size: [3, 6], color: ['#d8f3ff', '#9fd4f5', '#ffffff'], g: 700, spin: 10, drag: 1 });
      this.impact(t0 + IMPACT, b, col, 1.2);
    },

    // ===== 林月如 =====
    // 鳳舞：長鞭帶著烈焰劃出鳳凰展翅般的弧線，紅金羽毛紛飛
    whip(t0, a, b, f) {
      const col = '#ff7a45', dir = this.dirTo(a, b);
      this.addFx(t0 + IMPACT - 140, 420, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        // 一左一右兩道羽翼形鞭痕
        this.crescent(ctx, p.x - dir * 30 * s, p.y + 10 * s, 62 * s, 16 * s, dir > 0 ? -2.6 : -0.5, dir * 2.2, t * 1.8 - 0.7, t * 1.8, '#ff9a3d', 1 - easeIn(t));
        this.crescent(ctx, p.x - dir * 30 * s, p.y - 10 * s, 62 * s, 16 * s, dir > 0 ? 2.6 : 0.5, -dir * 2.2, t * 1.8 - 0.9, t * 1.8 - 0.2, '#ff4d6d', 1 - easeIn(t));
      });
      this.addFx(t0 + IMPACT, 650, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        if (this.drawTex(ctx, 'phoenix', p.x, p.y - 10 * s, 170 * s * (0.7 + 0.3 * easeOut(t)), 0, env(t, 0.1, 0.5), dir)) return;
        // 程式版鳳翼：兩片扇形羽翼
        ctx.globalCompositeOperation = 'lighter';
        for (const side of [-1, 1]) {
          for (let i = 0; i < 7; i++) {
            const ang = -Math.PI / 2 + side * (0.35 + i * 0.17) * easeOut(t * 2);
            const L = (60 - i * 4) * s * easeOut(t * 2);
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang);
            ctx.globalAlpha = env(t, 0.1, 0.5) * 0.7;
            const g = ctx.createLinearGradient(0, 0, L, 0);
            g.addColorStop(0, 'rgba(255,240,180,0.9)'); g.addColorStop(0.5, rgba(col, 0.8)); g.addColorStop(1, 'rgba(255,60,60,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(L * 0.5, -7 * s, L, 0); ctx.quadraticCurveTo(L * 0.5, 7 * s, 0, 0); ctx.fill();
            ctx.restore();
          }
        }
      });
      this.burst(t0 + IMPACT, () => this.body(b), 16, { kind: 'feather', speed: [60, 200], life: [700, 1100], size: [3, 5], color: ['#ff7a45', '#ffd23f', '#ff4d6d'], g: 80, spin: 5, drag: 2.5 });
      this.impact(t0 + IMPACT, b, col, 1);
    },

    // 怒火：怒氣化為熊熊烈焰包覆全身，熱浪扭曲、火星四射
    fire(t0, a) {
      const p = () => this.feet(a);
      this.layerBack(t0 + 300, 1100, (ctx, t) => { const q = this.body(a); this.glowAt(ctx, q.x, q.y + 10 * this.scale, 85 * this.scale, '#ff5a1f', 0.55 * env(t)); });
      // 火焰：大量向上的光點（白黃→橘→紅→煙）
      this.stream(t0 + 300, 950, 110, () => { const q = p(); return { x: q.x + rand(-28, 28) * this.scale, y: q.y - rand(0, 20) * this.scale }; },
        t => ({ kind: 'glow', angle: [-Math.PI * 0.62, -Math.PI * 0.38], speed: [90, 170], life: [350, 600], size: [4, 8], grow: 0.1, color: ['#ffdf6b', '#ff8a3d', '#ff5a1f', '#ff3d1f'], drag: 0.8, wob: 0.8 }));
      this.stream(t0 + 400, 700, 8, () => { const q = p(); return { x: q.x + rand(-20, 20) * this.scale, y: q.y - 120 * this.scale }; },
        { kind: 'smoke', angle: -Math.PI / 2, speed: [40, 70], life: [500, 700], size: [5, 8], grow: 1.6, color: '#6a4a40', alpha: 0.6, drag: 0.5 });
      this.stream(t0 + 300, 950, 30, () => { const q = p(); return { x: q.x + rand(-30, 30) * this.scale, y: q.y - 30 * this.scale }; },
        { kind: 'ember', angle: [-Math.PI * 0.75, -Math.PI * 0.25], speed: [100, 220], life: [600, 1000], size: [1, 2], color: ['#fff2b0', '#ffb347'], drag: 1, wob: 1.2 });
      this.at(t0 + 450, now => this.doShake(now, 250, 3));
      this.layerBack(t0 + 450, 900, (ctx, t) => this.bigGlyph(ctx, a, '怒', '#ff7a45', t));
    },

    // 連環鞭：鞭影翻飛，三道蛇形鞭痕連環抽擊
    whipmulti(t0, a, b, f, ev) {
      const col = '#ff9a3d', gap = ev.multiGap || 160, dir = this.dirTo(a, b);
      const angles = [-0.5, 0.6, -0.1];
      for (let k = 0; k < (ev.hits || 3); k++) {
        const at = t0 + IMPACT + k * gap;
        const rot = angles[k % 3];
        this.addFx(at - 90, 260, (ctx, t) => {
          const p = this.body(b), s = this.scale;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot * dir);
          // 蛇形鞭痕：正弦曲線由左掃到右
          const L = 120 * s, head = easeOut(t * 1.6), tail = easeIn(seg(t, 0.25, 1));
          ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
          for (const [w, c, al] of [[10, col, 0.35], [4, '#ffd8a8', 0.9], [1.5, '#ffffff', 1]]) {
            ctx.strokeStyle = c; ctx.lineWidth = w * s; ctx.globalAlpha = al * (1 - tail * 0.8);
            ctx.beginPath();
            for (let i = 0; i <= 20; i++) {
              const u = tail + (head - tail) * i / 20;
              const x = (-0.5 + u) * L * dir, y = Math.sin(u * 9 + k) * 12 * s * (1 - u * 0.5);
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.stroke();
          }
          ctx.restore();
        });
        this.impact(at, b, col, 0.7, { dy: (k - 1) * 12, shake: true });
      }
    },

    // 破甲擊：重擊撞碎護甲，金屬碎片崩飛，裂痕擴散，「破」字震出
    crack(t0, a, b) {
      const col = '#ffb347';
      this.addFx(t0 + IMPACT, 650, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - easeIn(t);
        ctx.strokeStyle = '#ffe2b0'; ctx.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          const ang = i / 9 * TAU + 0.3;
          let x = p.x, y = p.y;
          ctx.lineWidth = 2.5 * s;
          ctx.beginPath(); ctx.moveTo(x, y);
          const L = 70 * s * easeOut(t * 3);
          for (let j = 1; j <= 4; j++) {
            const aa = ang + Math.sin(i * 7 + j * 3) * 0.4;
            x += Math.cos(aa) * L / 4; y += Math.sin(aa) * L / 4;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      });
      this.burst(t0 + IMPACT, () => this.body(b), 16, { kind: 'shard', speed: [180, 380], life: [600, 900], size: [3, 6], color: ['#c8d2dc', '#e9eef3', '#8a96a3'], g: 700, spin: 14, drag: 1 });
      this.addFx(t0 + IMPACT - 20, 750, (ctx, t) => this.stamp(ctx, this.body(b), '破', col, t, 1.2));
      this.impact(t0 + IMPACT, b, col, 1.3);
    },

    // 流星趕月：身後一彎新月升起，月光化作流星從天際劃過，重擊敵人
    meteor(t0, a, b) {
      const col = '#ffb347', dir = this.dirTo(a, b);
      this.dimScreen(t0 + 100, 1300, 0.45, '#070a1e');
      const moonP = () => ({ x: this.baseX(a) - dir * 20 * this.scale, y: this.H * 0.18 });
      this.addFx(t0 + 150, 1100, (ctx, t) => {
        const m = moonP(), s = this.scale, R = 26 * s, al = env(t, 0.2, 0.3);
        this.glowAt(ctx, m.x, m.y, 70 * s, '#fff1c4', 0.5 * al);
        ctx.globalAlpha = al;
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath(); ctx.arc(m.x, m.y, R, 0, TAU); ctx.arc(m.x + dir * R * 0.45, m.y - R * 0.2, R * 0.85, 0, TAU, true); ctx.fill('evenodd');
      });
      const path = u => {
        const m = moonP(), B = this.body(b);
        return { x: m.x + (B.x - m.x) * u, y: m.y + (B.y - m.y) * easeIn(u) };
      };
      this.addFx(t0 + 420, 330, (ctx, t) => {
        const p = path(t), s = this.scale;
        this.trail(ctx, path, t, 0.7, 26, '#ff7a1a', 0.7);
        this.trail(ctx, path, t, 0.45, 10, '#fff1c4', 1);
        if (!this.drawTex(ctx, 'meteor', p.x, p.y, 90 * s, Math.atan2(path(t).y - path(Math.max(0, t - 0.05)).y, path(t).x - path(Math.max(0, t - 0.05)).x), 1)) {
          this.glowAt(ctx, p.x, p.y, 34 * s, col, 1);
          this.glowAt(ctx, p.x, p.y, 14 * s, '#ffffff', 1);
        }
      });
      this.stream(t0 + 420, 330, 120, t => path(t), { kind: 'ember', speed: [20, 80], life: [300, 600], size: [1.5, 3], color: ['#ffd27a', '#ff8a3d'], drag: 2 });
      this.addFx(t0 + IMPACT, 600, (ctx, t) => { const p = this.feet(b); this.shock(ctx, p.x, p.y, t, { r1: 140, w: 12, color: col, squash: 0.3 }); });
      this.addFx(t0 + IMPACT, 420, (ctx, t) => { const p = this.body(b); this.speedLines(ctx, p.x, p.y, t, '#ffe2b0'); });
      this.burst(t0 + IMPACT, () => this.feet(b), 14, { kind: 'rock', speed: [150, 320], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [600, 900], size: [2.5, 5], color: ['#6b5a4a', '#8a7560'], g: 900, spin: 10, drag: 0.5 });
      this.at(t0 + IMPACT, now => this.doFlash(now, 160, '#ffe0b0'));
      this.impact(t0 + IMPACT, b, col, 1.7);
    },

    // ===== 阿奴 =====
    // 蠱毒：一隻發著綠光的蠱蟲蜿蜒飛去鑽入敵身，毒霧與毒泡冒出
    poison(t0, a, b) {
      const col = '#7dff6a';
      const path = u => {
        const A = this.hand(a), B = this.body(b), s = this.scale;
        return { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u + Math.sin(u * TAU * 2) * 16 * s - Math.sin(Math.PI * u) * 20 * s };
      };
      this.addFx(t0 + 420, 330, (ctx, t, el, now) => {
        this.trail(ctx, path, t, 0.35, 6, col, 0.8);
        const p = path(t), q = path(Math.max(0, t - 0.03));
        ctx.save(); drawPart(ctx, { kind: 'bug', x: p.x, y: p.y, vx: p.x - q.x, vy: p.y - q.y, size: 5 * this.scale, color: '#2f5f1f', seed: 0.3 }, 0, now, true); ctx.restore();
        this.glowAt(ctx, p.x, p.y, 16 * this.scale, col, 0.8);
      });
      this.burst(t0 + IMPACT, () => this.body(b), 10, { kind: 'smoke', speed: [20, 60], life: [700, 1100], size: [8, 12], grow: 1.6, color: '#3f8f2f', drag: 1.5, spread: 10 });
      this.burst(t0 + IMPACT, () => this.body(b), 12, { kind: 'bubble', angle: [-Math.PI * 0.8, -Math.PI * 0.2], speed: [40, 110], life: [700, 1100], size: [2, 4.5], color: '#8cff6a', drag: 1.5, wob: 0.8 });
      this.impact(t0 + IMPACT, b, col, 0.9, { shake: false });
    },

    // 噬魂：敵人身下開出暗紅漩渦，魂魄化作血色幽光被抽離，飛回阿奴身上
    drain(t0, a, b) {
      const col = '#ff3d6e';
      this.layerBack(t0 + 400, 1100, (ctx, t, el) => {
        const p = this.body(b), s = this.scale;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(-el / 200);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.globalAlpha = env(t) * 0.75;
          ctx.strokeStyle = i % 2 ? '#8b1e3f' : '#c22d5a'; ctx.lineWidth = 5 * s;
          ctx.beginPath();
          for (let k = 0; k <= 20; k++) { const r = (8 + k * 3) * s, ang = k * 0.25; k ? ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r * 0.8) : ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r * 0.8); }
          ctx.stroke();
        }
        ctx.restore();
      });
      this.impact(t0 + IMPACT, b, '#c22d5a', 0.9);
      // 魂魄
      for (let k = 0; k < 7; k++) {
        const off = rand(-40, 40), delay = k * 55;
        const path = u => {
          const A = this.body(b), B = this.body(a), s = this.scale;
          return { x: A.x + (B.x - A.x) * easeIn(u), y: A.y + (B.y - A.y) * u - Math.sin(Math.PI * u) * off * s - 10 * s };
        };
        this.addFx(t0 + IMPACT + delay, 520, (ctx, t) => {
          this.trail(ctx, path, t, 0.3, 9, col, 0.7);
          const p = path(t);
          this.glowAt(ctx, p.x, p.y, 16 * this.scale, col, 1);
          this.glowAt(ctx, p.x, p.y, 6 * this.scale, '#ffffff', 1);
        });
      }
      this.addFx(t0 + IMPACT + 450, 600, (ctx, t) => { const p = this.body(a); this.glowAt(ctx, p.x, p.y, 70 * this.scale, col, 0.5 * (1 - t)); });
    },

    // 銀鈴咒：苗家銀鈴懸空搖響，音波一圈圈震向敵人，銀鈴環繞將其束縛
    bells(t0, a, b) {
      const col = '#e8eef7';
      const bell = (ctx, x, y, size, swing) => {
        const s = this.scale * size;
        ctx.save(); ctx.translate(x, y); ctx.rotate(swing);
        this.glowAt(ctx, 0, 6 * s, 18 * s, '#dfe8ff', 0.7);
        if (!this.drawTex(ctx, 'bell', 0, 6 * s, 24 * s)) {
          const g = ctx.createLinearGradient(-8 * s, 0, 8 * s, 0);
          g.addColorStop(0, '#9aa6b5'); g.addColorStop(0.4, '#ffffff'); g.addColorStop(1, '#8792a1');
          ctx.fillStyle = g; ctx.strokeStyle = '#5b6573'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-3 * s, 0); ctx.quadraticCurveTo(-8 * s, 4 * s, -9 * s, 13 * s); ctx.lineTo(9 * s, 13 * s); ctx.quadraticCurveTo(8 * s, 4 * s, 3 * s, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#c0c7d1'; ctx.beginPath(); ctx.arc(0, 15 * s, 2.5 * s, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.2 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10 * s); ctx.stroke();
        }
        ctx.restore();
      };
      this.addFx(t0 + 200, 700, (ctx, t, el) => {
        const p = this.body(a), s = this.scale;
        ctx.globalAlpha = env(t, 0.15, 0.2);
        for (let i = 0; i < 3; i++) bell(ctx, p.x + (i - 1) * 26 * s, p.y - 60 * s + Math.abs(i - 1) * 10 * s, 1, Math.sin(el / 70 + i) * 0.5);
      });
      for (let k = 0; k < 4; k++) {
        this.addFx(t0 + 420 + k * 90, 380, (ctx, t) => {
          const A = this.body(a), B = this.body(b), s = this.scale;
          const x = A.x + (B.x - A.x) * t, d = Math.sign(B.x - A.x);
          ctx.globalCompositeOperation = 'lighter';
          for (const [w, c, al] of [[6, '#b8c7ff', 0.3], [2, col, 0.9]]) {
            ctx.globalAlpha = al * (1 - t * 0.5); ctx.strokeStyle = c; ctx.lineWidth = w * s;
            ctx.beginPath(); ctx.arc(x - d * 20 * s, A.y, (16 + 26 * t) * s, d > 0 ? -0.8 : Math.PI - 0.8, d > 0 ? 0.8 : Math.PI + 0.8); ctx.stroke();
          }
        });
      }
      this.addFx(t0 + IMPACT, 900, (ctx, t, el) => {
        const p = this.body(b), s = this.scale;
        ctx.globalAlpha = env(t, 0.1, 0.3);
        for (let i = 0; i < 5; i++) {
          const ang = i / 5 * TAU + el / 300;
          bell(ctx, p.x + Math.cos(ang) * 40 * s, p.y + Math.sin(ang) * 12 * s - 10 * s, 0.75, Math.sin(el / 60 + i) * 0.4);
        }
      });
      this.burst(t0 + IMPACT, () => this.body(b), 14, { kind: 'snow', speed: [50, 150], life: [500, 800], size: [2, 3], color: '#f0f4ff', spin: 4, drag: 2 });
      this.impact(t0 + IMPACT, b, '#b8c7ff', 0.8);
    },

    // 百草回春：大地湧出綠光，花草藤葉盤旋而上，花朵綻放
    herbs(t0, a) {
      const col = '#7dffb0';
      this.layerBack(t0 + 200, 1300, (ctx, t) => { const p = this.feet(a); this.magicCircle(ctx, p.x, p.y, 58, t, '#6be08a', 'leaf', 0.3, -0.6); });
      // 螺旋上升的葉片
      for (let i = 0; i < 16; i++) {
        const ph = i / 16;
        this.addFx(t0 + 250 + i * 30, 900, (ctx, t, el, now) => {
          const p = this.feet(a), s = this.scale;
          const ang = ph * TAU + t * 7, h = t * 120 * s, r = (40 - 15 * t) * s;
          const x = p.x + Math.cos(ang) * r, y = p.y - h + Math.sin(ang) * r * 0.3;
          ctx.save(); ctx.globalAlpha = env(t, 0.1, 0.3);
          drawPart(ctx, { kind: i % 3 ? 'leaf' : 'petal', x, y, rot: ang + 1.2, size: (i % 3 ? 5 : 4) * s, color: i % 3 ? (i % 2 ? '#52b788' : '#95d5b2') : '#ffafcc', seed: ph }, 0, now, true);
          ctx.restore();
        });
      }
      // 地上綻放的小花
      this.addFx(t0 + 350, 1150, (ctx, t) => {
        const p = this.feet(a), s = this.scale;
        ctx.globalAlpha = env(t, 0.2, 0.3);
        for (let i = 0; i < 6; i++) {
          const x = p.x + (i - 2.5) * 16 * s, y = p.y + (i % 2 ? 4 : -2) * s, r = 5 * s * easeOut(t * 3 - i * 0.15);
          if (r <= 0) continue;
          ctx.fillStyle = i % 2 ? '#ffafcc' : '#ffe066';
          for (let k = 0; k < 5; k++) { const aa = k / 5 * TAU; ctx.beginPath(); ctx.arc(x + Math.cos(aa) * r * 0.8, y + Math.sin(aa) * r * 0.5, r * 0.55, 0, TAU); ctx.fill(); }
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, TAU); ctx.fill();
        }
      });
      this.addFx(t0 + 650, 800, (ctx, t) => this.pillar(ctx, this.baseX(a), t, col, 30));
      this.stream(t0 + 650, 600, 30, () => { const p = this.feet(a); return { x: p.x + rand(-30, 30) * this.scale, y: p.y }; },
        { kind: 'glow', angle: -Math.PI / 2, speed: [60, 140], life: [600, 900], size: [1.5, 3], color: ['#b9fbc0', '#ffffff'], drag: 0.5 });
    },

    // 萬蠱蝕天：天色轉為慘綠，萬千蠱蟲自阿奴身後湧出，如黑潮般吞噬敵人
    swarm(t0, a, b) {
      this.dimScreen(t0 + 100, 1700, 0.5, '#06140a');
      const N = 70;
      const bugs = Array.from({ length: N }, (_, i) => ({ d: i * 0.008 + rand(0, 0.05), off: rand(-1, 1), ph: rand(0, TAU), r: rand(10, 40) }));
      this.addFx(t0 + 250, 1500, (ctx, t, el, now) => {
        const A = this.body(a), B = this.body(b), s = this.scale;
        for (const g of bugs) {
          const u = clamp01(t * 1.9 - g.d);
          if (u <= 0) continue;
          const e = easeOut(u);
          // 沿蛇形路線飛向敵人，抵達後繞著敵人盤旋
          let x = A.x + (B.x - A.x) * e, y = A.y + (B.y - A.y) * e + Math.sin(e * TAU + g.ph) * 30 * s * (1 - e) + g.off * 30 * s * Math.sin(Math.PI * e);
          if (u >= 1 || e > 0.95) { const ang = el / 160 + g.ph; x = B.x + Math.cos(ang) * g.r * s; y = B.y + Math.sin(ang * 1.3) * g.r * 0.8 * s; }
          const nx = x + Math.cos(el / 30 + g.ph), ny = y + Math.sin(el / 30 + g.ph);
          ctx.save(); ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
          drawPart(ctx, { kind: 'bug', x, y, vx: nx - x + (B.x - A.x) * 0.01, vy: ny - y, size: 3.2 * s, color: '#1f3a14', seed: g.ph }, 0, now, true);
          ctx.restore();
        }
      });
      this.addFx(t0 + 600, 1150, (ctx, t) => { const p = this.body(b); this.glowAt(ctx, p.x, p.y, 70 * this.scale, '#5cff5c', 0.4 * env(t)); });
      this.burst(t0 + IMPACT, () => this.body(b), 12, { kind: 'smoke', speed: [20, 70], life: [900, 1300], size: [8, 14], grow: 1.6, color: '#2f6b20', drag: 1.2, spread: 15 });
      this.impact(t0 + IMPACT, b, '#7dff6a', 1.2);
    },

    // ===== 陳靖仇 =====
    // 符火：甩出符咒，半空中自燃成火球，命中爆裂成一團烈焰
    firetalisman(t0, a, b) {
      const path = u => {
        const A = this.hand(a), B = this.body(b);
        return { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u - Math.sin(Math.PI * u) * 26 * this.scale };
      };
      this.addFx(t0 + 420, 330, (ctx, t) => {
        const p = path(t), burn = seg(t, 0.25, 0.7);
        this.trail(ctx, path, t, 0.5, 10 * burn + 2, '#ff7a1a', 0.8);
        this.charm(ctx, p.x, p.y, t * 14, 1, burn);
      });
      this.stream(t0 + 520, 230, 120, t => path(0.3 + t * 0.7), { kind: 'glow', speed: [10, 50], life: [250, 400], size: [3, 5], grow: 0.1, color: ['#ffdf6b', '#ff8a3d', '#ff5a1f'], drag: 2, g: -150 });
      this.burst(t0 + IMPACT, () => this.body(b), 40, { kind: 'glow', speed: [60, 200], life: [350, 650], size: [5, 9], grow: 0.15, color: ['#ffdf6b', '#ff8a3d', '#ff5a1f', '#ff3d1f'], drag: 3, g: -200 });
      this.burst(t0 + IMPACT, () => this.head(b), 5, { kind: 'smoke', speed: [20, 60], life: [500, 700], size: [6, 9], grow: 1.6, color: '#6a4a40', alpha: 0.5, drag: 1.5, g: -80 });
      this.burst(t0 + IMPACT, () => this.body(b), 12, { kind: 'ember', speed: [100, 260], life: [500, 900], size: [1, 2], color: ['#fff2b0', '#ffb347'], drag: 1.5, g: -50 });
      this.impact(t0 + IMPACT, b, '#ff8a3d', 1);
    },

    // 破軍斬：氣勢如破千軍，一刀由上而下的金色巨斬，地面裂開一道光縫
    cleave(t0, a, b) {
      const col = '#ffcc4a';
      this.addFx(t0 + IMPACT - 110, 380, (ctx, t) => {
        const p = this.body(b), s = this.scale, R = 95 * s;
        this.crescent(ctx, p.x - this.dirTo(a, b) * 45 * s, p.y + 5 * s, R, 26 * s, -Math.PI / 2 - 1.2, 2.4 * this.dirTo(a, b), t * 2.2 - 0.6, t * 2.2, col, 1 - easeIn(t));
        // 垂直刀光
        ctx.globalCompositeOperation = 'lighter';
        const h = 140 * s * easeOut(t * 3), w = 6 * s * (1 - t);
        const g = ctx.createLinearGradient(0, p.y - h, 0, p.y + 40 * s);
        g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, rgba(col, 0));
        ctx.globalAlpha = 1 - t; ctx.fillStyle = g;
        ctx.fillRect(p.x - w, p.y - h, w * 2, h + 40 * s);
      });
      // 地裂光縫
      this.layerBack(t0 + IMPACT, 900, (ctx, t) => {
        const p = this.feet(b), s = this.scale, L = 80 * s * easeOut(t * 3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - easeIn(t);
        ctx.strokeStyle = col; ctx.lineWidth = 3 * s; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(p.x - L, p.y);
        for (let i = -4; i <= 4; i++) ctx.lineTo(p.x + i / 4 * L, p.y + (i % 2 ? 3 : -2) * s);
        ctx.stroke();
        this.glowAt(ctx, p.x, p.y, L * 0.8, col, 0.4 * (1 - t));
      });
      this.burst(t0 + IMPACT, () => this.feet(b), 14, { kind: 'rock', speed: [120, 300], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [600, 900], size: [2.5, 5], color: ['#6b5a4a', '#8a7560'], g: 900, spin: 10, drag: 0.5 });
      this.addFx(t0 + IMPACT, 380, (ctx, t) => { const p = this.body(b); this.speedLines(ctx, p.x, p.y, t, '#fff2c4', 22); });
      this.impact(t0 + IMPACT, b, col, 1.4);
    },

    // 鎮妖符：五張符咒飛出環繞敵人，落地化為符陣，「鎮」字封印
    talisman(t0, a, b) {
      const col = '#ffd84a';
      for (let i = 0; i < 5; i++) {
        const ang0 = i / 5 * TAU;
        this.addFx(t0 + 380 + i * 30, 1150 - i * 30, (ctx, t, el) => {
          const A = this.hand(a), B = this.body(b), s = this.scale;
          const fly = easeOut(seg(el, 0, 330));
          const orbit = ang0 + el / 220;
          const tx = B.x + Math.cos(orbit) * 46 * s, ty = B.y + Math.sin(orbit) * 16 * s;
          const x = A.x + (tx - A.x) * fly, y = A.y + (ty - A.y) * fly - Math.sin(Math.PI * fly) * 40 * s;
          ctx.globalAlpha = t > 0.85 ? (1 - t) / 0.15 : 1;
          this.charm(ctx, x, y, Math.sin(el / 100 + i) * 0.3, 0.9, 0, col);
        });
      }
      this.layerBack(t0 + IMPACT - 50, 1000, (ctx, t) => { const p = this.feet(b); this.magicCircle(ctx, p.x, p.y, 62, t, col, 'seal'); });
      this.addFx(t0 + IMPACT, 800, (ctx, t) => this.stamp(ctx, this.body(b), '鎮', col, t, 1.1));
      this.impact(t0 + IMPACT, b, col, 0.9);
    },

    // 真元護體：腳下八卦陣旋轉，真氣凝成金色六角光盾罩住全身
    shield(t0, a) {
      const col = '#ffd84a';
      this.layerBack(t0 + 250, 1200, (ctx, t) => { const p = this.feet(a); this.magicCircle(ctx, p.x, p.y, 66, t, col, 'bagua'); });
      this.addFx(t0 + 450, 1000, (ctx, t, el) => {
        const p = this.body(a), s = this.scale, R = 64 * s * easeOut(t * 2.5), al = env(t, 0.1, 0.35);
        ctx.globalCompositeOperation = 'lighter';
        // 圓頂光罩
        const g = ctx.createRadialGradient(p.x, p.y, R * 0.6, p.x, p.y, R);
        g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.85, rgba(col, 0.25 * al)); g.addColorStop(1, rgba('#ffffff', 0.6 * al));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.fill();
        // 六角網格
        ctx.strokeStyle = rgba('#fff2b0', 0.5 * al); ctx.lineWidth = 1 * s;
        ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.clip();
        const hs = 12 * s;
        for (let row = -6; row <= 6; row++) {
          for (let c = -6; c <= 6; c++) {
            const hx = p.x + (c + (row % 2) * 0.5) * hs * 1.73, hy = p.y + row * hs * 1.5;
            const shine = 0.5 + 0.5 * Math.sin(el / 150 - (hx - p.x) / (20 * s));
            ctx.globalAlpha = shine;
            ctx.beginPath();
            for (let k = 0; k <= 6; k++) { const aa = k / 6 * TAU + Math.PI / 6; ctx.lineTo(hx + Math.cos(aa) * hs, hy + Math.sin(aa) * hs); }
            ctx.stroke();
          }
        }
        ctx.restore();
      });
      this.addFx(t0 + 450, 450, (ctx, t) => { const p = this.body(a); this.shock(ctx, p.x, p.y, t, { r0: 20, r1: 80, w: 5, color: col }); });
    },

    // 雷霆萬鈞：天地變色，一道貫穿天地的巨大雷柱轟然落下，雷光向四周炸開
    judgement(t0, a, b) {
      const col = '#7fe0ff';
      this.dimScreen(t0 + 100, 1500, 0.6, '#020814');
      this.addFx(t0 + 200, 600, (ctx, t) => { const p = this.feet(b); this.magicCircle(ctx, p.x, p.y, 80, t, col, 'rune', 0.3, 2); });
      // 蓄力：細電絲往上方集中
      for (let i = 0; i < 4; i++) {
        this.strike(t0 + 300 + i * 80, 140, () => ({ x: this.baseX(b) + rand(-80, 80) * this.scale, y: rand(0, this.H * 0.3) }), () => ({ x: this.baseX(b), y: this.H * 0.05 }), { width: 1, color: col, disp: 15, branches: 0 });
      }
      // 巨大雷柱
      this.addFx(t0 + 690, 520, (ctx, t) => this.pillar(ctx, this.baseX(b), t, col, 34));
      this.strike(t0 + 690, 480, () => ({ x: this.baseX(b), y: -10 }), () => this.feet(b), { width: 8, color: col, disp: 30, branches: 5 });
      this.at(t0 + 690, now => this.doFlash(now, 200, '#e6fbff'));
      // 炸開的雷光
      for (let i = 0; i < 8; i++) {
        const ang = Math.PI + i / 7 * Math.PI;
        this.strike(t0 + IMPACT + 20, 260, () => this.body(b), () => { const p = this.body(b); return { x: p.x + Math.cos(ang) * 90 * this.scale, y: p.y + Math.sin(ang) * 70 * this.scale }; }, { width: 1.6, color: col, disp: 18, branches: 1 });
      }
      this.addFx(t0 + IMPACT, 650, (ctx, t) => { const p = this.feet(b); this.shock(ctx, p.x, p.y, t, { r1: 160, w: 12, color: col, squash: 0.3 }); });
      this.addFx(t0 + IMPACT, 450, (ctx, t) => { const p = this.body(b); this.speedLines(ctx, p.x, p.y, t, '#d6f6ff', 34); });
      this.impact(t0 + IMPACT, b, col, 1.8);
    },

    // ===== 拓跋玉兒 =====
    // 馮虛御風：借風之力，疾風繞身，身影如風，帶起一陣青草與風痕
    gale(t0, a, b) {
      const col = '#9ff2e5', dir = this.dirTo(a, b);
      this.addFx(t0 + 250, 1000, (ctx, t, el, now) => {
        const a1 = env(t, 0.1, 0.4);
        for (let k = 1; k <= 3; k++) this.ghost(ctx, a, -dir * k * 18 * (0.5 + 0.5 * Math.sin(t * Math.PI * 3)), 0.22 * a1 / k, now, col);
      });
      this.addFx(t0 + 250, 1000, (ctx, t, el) => {
        const p = this.body(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        for (let k = 0; k < 7; k++) {
          const ph = (el / 450 + k / 7) % 1;
          const y = p.y + (k - 3) * 14 * s, x = p.x + dir * (-90 + ph * 180) * s, L = 50 * s;
          ctx.globalAlpha = Math.sin(Math.PI * ph) * env(t) * 0.8;
          const g = ctx.createLinearGradient(x - dir * L, 0, x, 0);
          g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, '#ffffff');
          ctx.strokeStyle = g; ctx.lineWidth = 2.2 * s;
          ctx.beginPath(); ctx.moveTo(x - dir * L, y); ctx.quadraticCurveTo(x - dir * L * 0.4, y - 6 * s, x, y); ctx.stroke();
        }
      });
      this.stream(t0 + 300, 800, 22, () => { const p = this.feet(a); return { x: p.x - dir * 50 * this.scale, y: p.y - rand(0, 70) * this.scale }; },
        { kind: 'leaf', angle: dir > 0 ? [-0.3, 0.1] : [Math.PI - 0.1, Math.PI + 0.3], speed: [150, 250], life: [600, 900], size: [3, 4.5], color: ['#a7c957', '#6a994e', '#c7f9cc'], spin: 8, drag: 1 });
    },

    // 追星破月：衝到眼前由下往上一記月牙斬，劈碎身後的滿月，星芒沿刀光散落；內勁一波波鑽進對手體內
    moonbreak(t0, a, b) {
      const col = '#bcd4ff', dir = this.dirTo(a, b);
      const moonP = () => { const p = this.head(b); return { x: p.x + dir * 10 * this.scale, y: p.y - 4 * this.scale }; };
      // 滿月浮現，命中時裂成兩半往上下錯開
      this.layerBack(t0 + 300, 1150, (ctx, t, el) => {
        const p = moonP(), s = this.scale, R = 42 * s, hit = seg(el, IMPACT - 300, IMPACT - 300 + 500);
        const al = env(t, 0.2, 0.35) * 0.85;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this.glowAt(ctx, p.x, p.y, R * 1.9, col, al * 0.5);
        for (const side of [-1, 1]) {
          const off = easeOut(hit) * 14 * s;
          ctx.save();
          ctx.translate(p.x + side * off * 0.4 * dir, p.y + side * off);
          ctx.beginPath();
          // 以斜線把月亮切成兩半
          ctx.rect(-R * 1.2, side > 0 ? 0 : -R * 1.2, R * 2.4, R * 1.2);
          ctx.clip();
          ctx.globalAlpha = al * (1 - 0.6 * hit);
          ctx.fillStyle = 'rgba(225,235,255,0.55)';
          ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
          ctx.restore();
        }
        if (hit > 0 && hit < 1) {
          ctx.globalAlpha = 1 - hit; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5 * s;
          ctx.beginPath(); ctx.moveTo(p.x - R * 1.3, p.y); ctx.lineTo(p.x + R * 1.3, p.y); ctx.stroke();
        }
        ctx.restore();
      });
      // 由下往上的月牙刀光
      const a0 = dir > 0 ? Math.PI * 0.75 : Math.PI * 0.25, sweep = dir * Math.PI;
      this.addFx(t0 + IMPACT - 120, 460, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        const lo = t * 2.4 - 0.9, hi = t * 2.4;
        this.crescent(ctx, p.x - dir * 8 * s, p.y - 6 * s, 78 * s, 22 * s, a0, sweep, lo, hi, col, 1 - easeIn(t));
        // 刀光前端拖著星芒
        const u = clamp01(hi);
        const ang = a0 + sweep * u;
        twinkle(ctx, p.x - dir * 8 * s + Math.cos(ang) * 78 * s, p.y - 6 * s + Math.sin(ang) * 78 * s, 16 * s * (1 - t), '#ffe8a0', 1 - t);
      });
      // 散落的星點
      this.addFx(t0 + IMPACT - 40, 700, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        for (let i = 0; i < 7; i++) {
          const ang = a0 + sweep * (0.15 + i * 0.12);
          const r = (78 + Math.sin(i * 5.3) * 12 + 30 * easeOut(t)) * s;
          const tw = 0.6 + 0.4 * Math.sin(t * 20 + i * 2);
          twinkle(ctx, p.x - dir * 8 * s + Math.cos(ang) * r, p.y - 6 * s + Math.sin(ang) * r + 10 * s * t, (5 + (i % 3) * 2.5) * s, i % 2 ? '#ffe8a0' : '#ffffff', (1 - easeIn(t)) * tw);
        }
      });
      this.impact(t0 + IMPACT, b, col, 1);
      // 內勁：三波光環往體內收縮，身上竄出細細的勁脈
      for (let k = 0; k < 3; k++) {
        this.addFx(t0 + IMPACT + 140 + k * 170, 300, (ctx, t) => {
          const p = this.body(b), s = this.scale, r = (46 - 40 * easeIn(t)) * s;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.sin(Math.PI * t) * 0.9;
          ctx.strokeStyle = '#8fb0ff'; ctx.lineWidth = 3 * s;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 1.25, 0, 0, TAU); ctx.stroke();
          ctx.strokeStyle = '#e6eeff'; ctx.lineWidth = 1.2 * s; ctx.lineCap = 'round';
          for (let i = 0; i < 6; i++) {
            const ang = i / 6 * TAU + k;
            let x = p.x, y = p.y;
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let j = 1; j <= 3; j++) {
              const aa = ang + Math.sin(i * 3 + j * 7 + k) * 0.6, L = 9 * s * easeOut(t * 2);
              x += Math.cos(aa) * L; y += Math.sin(aa) * L * 1.3; ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          ctx.restore();
          this.glowAt(ctx, p.x, p.y, 26 * s, '#6f8fff', Math.sin(Math.PI * t) * 0.6);
        });
        this.at(t0 + IMPACT + 140 + k * 170 + 240, now => this.doShake(now, 90, 2));
      }
    },

    // 伏虎沖天：刀頭往地上一頓，勁力一顆顆連珠竄地而去，到敵人腳下化作猛虎之勢直沖上天
    tigerrise(t0, a, b) {
      const col = '#ffa53d', dir = this.dirTo(a, b);
      const ground = u => { const A = this.feet(a), B = this.feet(b); return { x: A.x + dir * 40 * this.scale + (B.x - A.x - dir * 40 * this.scale) * u, y: B.y }; };
      // 頓地
      this.addFx(t0 + 260, 420, (ctx, t) => { const p = ground(0); this.shock(ctx, p.x, p.y, t, { r1: 60, w: 8, color: col, squash: 0.3 }); });
      this.burst(t0 + 260, () => ground(0), 8, { kind: 'rock', speed: [80, 200], angle: [-Math.PI * 0.85, -Math.PI * 0.15], life: [500, 700], size: [2, 3.5], color: ['#6b5a4a', '#8a7560'], g: 900, spin: 10, drag: 0.5 });
      // 地面上竄行的勁痕
      this.layerBack(t0 + 280, IMPACT - 280 + 300, (ctx, t, el) => {
        const s = this.scale, u = clamp01(el / (IMPACT - 330));
        const A = ground(0), P = ground(u);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - easeIn(seg(el, IMPACT - 280, IMPACT));
        const g = ctx.createLinearGradient(A.x, 0, P.x, 0);
        g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, '#fff1c9');
        ctx.strokeStyle = g; ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(A.x, A.y);
        for (let i = 1; i <= 16; i++) { const q = ground(u * i / 16); ctx.lineTo(q.x, q.y + (i % 2 ? 2 : -2) * s); }
        ctx.stroke();
        this.glowAt(ctx, P.x, P.y, 26 * s, col, 0.8);
        ctx.restore();
      });
      // 連珠：沿路一顆顆炸起的勁珠
      for (let k = 0; k < 4; k++) {
        const u = (k + 1) / 5, at = t0 + 280 + (IMPACT - 330) * u;
        this.addFx(at, 380, (ctx, t) => {
          const p = ground(u), s = this.scale;
          this.glowAt(ctx, p.x, p.y - 14 * s * easeOut(t), 22 * s * (1 - t * 0.5), col, 1 - t);
          this.glowAt(ctx, p.x, p.y - 14 * s * easeOut(t), 8 * s, '#ffffff', 1 - t);
          this.shock(ctx, p.x, p.y, t, { r1: 34, w: 5, color: col, squash: 0.3 });
        });
        this.burst(at, () => ground(u), 5, { kind: 'rock', speed: [60, 160], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [400, 600], size: [1.5, 3], color: ['#6b5a4a', '#8a7560'], g: 900, spin: 10, drag: 0.5 });
      }
      // 沖天勁柱
      this.addFx(t0 + IMPACT - 40, 750, (ctx, t) => { const p = this.feet(b); this.pillar(ctx, p.x, t, col, 46, 0); });
      // 虎形勁氣往上竄（有 tiger.png 用圖，沒有就用「虎」字）
      this.addFx(t0 + IMPACT - 20, 800, (ctx, t) => {
        const p = this.body(b), s = this.scale, rise = easeOut(t) * 70 * s;
        if (this.drawTex(ctx, 'tiger', p.x, p.y - 20 * s - rise, 150 * s * (0.8 + 0.2 * easeOut(t)), 0, env(t, 0.08, 0.45), dir)) return;
        this.stamp(ctx, { x: p.x, y: p.y - 30 * s - rise }, '虎', col, t, 1.5);
      });
      this.stream(t0 + IMPACT, 450, 70, () => { const p = this.feet(b); return { x: p.x + rand(-22, 22) * this.scale, y: p.y - rand(0, 40) * this.scale }; },
        { kind: 'spark', angle: [-Math.PI / 2 - 0.12, -Math.PI / 2 + 0.12], speed: [500, 900], life: [250, 450], size: [1.5, 2.5], color: ['#ffffff', '#ffd27a', col], drag: 1 });
      this.burst(t0 + IMPACT, () => this.feet(b), 14, { kind: 'rock', speed: [200, 420], angle: [-Math.PI * 0.65, -Math.PI * 0.35], life: [700, 1000], size: [2.5, 5], color: ['#6b5a4a', '#8a7560'], g: 900, spin: 10, drag: 0.4 });
      this.impact(t0 + IMPACT, b, col, 1.3, { dy: 10 });
    },

    // 蒼龍蓋天：長柄刀旋出一條蒼龍，蜿蜒游過半空，再一圈圈由下往上盤捲敵人，每纏一圈就是一擊
    azuredragon(t0, a, b, f, ev) {
      const col = '#3fd6c6', gap = ev.multiGap || 160, hits = ev.hits || 3, dir = this.dirTo(a, b);
      const start = t0 + 330, T1 = IMPACT - 330, T2 = (hits - 1) * gap + 180, D = T1 + T2;
      const ang0 = dir > 0 ? Math.PI : 0;
      // 龍身路徑：u = 0~1 對應整段時間
      const pos = u => {
        const s = this.scale, ms = u * D, B = this.body(b);
        const w0 = { x: B.x + Math.cos(ang0) * 46 * s, y: B.y + 24 * s };
        if (ms < T1) {
          const v = ms / T1, A = this.hand(a);
          return { x: A.x + (w0.x - A.x) * v, y: A.y + (w0.y - A.y) * v - Math.sin(Math.PI * v) * 55 * s + Math.sin(v * TAU * 1.5) * 12 * s };
        }
        const w = (ms - T1) / T2, ang = ang0 + w * (hits - 0.6) * TAU * dir;
        return { x: B.x + Math.cos(ang) * 46 * s, y: B.y + 24 * s - w * 80 * s + Math.sin(ang) * 14 * s };
      };
      this.addFx(start, D + 350, (ctx, t, el) => {
        const s = this.scale, head = clamp01(el / D), fade = 1 - seg(el, D, D + 350);
        const tail = Math.max(0, head - 0.42), N = 44;
        const pts = [];
        for (let i = 0; i <= N; i++) pts.push(pos(tail + (head - tail) * i / N));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        // 龍身：越靠近龍頭越粗，外層青光、內層白芯，再加一排鱗光
        for (const [wk, c, al] of [[2.6, col, 0.25], [1.2, col, 0.85], [0.45, '#e9fffb', 1]]) {
          for (let i = 1; i <= N; i++) {
            const k = i / N;
            ctx.globalAlpha = al * fade * (0.25 + 0.75 * k);
            ctx.strokeStyle = c; ctx.lineWidth = wk * (3 + 9 * Math.sin(Math.PI * Math.min(1, k * 1.15))) * s;
            ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
          }
        }
        for (let i = 3; i < N - 2; i += 3) {
          ctx.globalAlpha = 0.7 * fade; ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y - 3 * s, 1.4 * s, 0, TAU); ctx.fill();
        }
        // 龍頭：光球 + 兩支龍角 + 龍鬚
        const H = pts[N], P = pts[N - 2], ang = Math.atan2(H.y - P.y, H.x - P.x);
        if (head < 1) {
          this.glowAt(ctx, H.x, H.y, 26 * s, col, fade);
          this.glowAt(ctx, H.x, H.y, 9 * s, '#ffffff', fade);
          ctx.translate(H.x, H.y); ctx.rotate(ang);
          ctx.globalAlpha = fade; ctx.strokeStyle = '#e9fffb'; ctx.lineWidth = 2 * s;
          ctx.beginPath();
          ctx.moveTo(-4 * s, -4 * s); ctx.quadraticCurveTo(-12 * s, -10 * s, -20 * s, -14 * s);
          ctx.moveTo(-4 * s, 4 * s); ctx.quadraticCurveTo(-12 * s, 10 * s, -20 * s, 14 * s);
          ctx.stroke();
          ctx.strokeStyle = col; ctx.lineWidth = 1.2 * s;
          const wv = Math.sin(el / 50) * 4 * s;
          ctx.beginPath();
          ctx.moveTo(6 * s, -3 * s); ctx.quadraticCurveTo(-8 * s, -8 * s + wv, -26 * s, -4 * s - wv);
          ctx.moveTo(6 * s, 3 * s); ctx.quadraticCurveTo(-8 * s, 8 * s - wv, -26 * s, 4 * s + wv);
          ctx.stroke();
        }
        ctx.restore();
      });
      this.stream(start, D, 50, () => pos(clamp01((performance.now() - start) / D)),
        { kind: 'glow', speed: [10, 40], life: [300, 500], size: [1.5, 3], color: [col, '#e9fffb'], drag: 2 });
      for (let k = 0; k < hits; k++) {
        this.impact(t0 + IMPACT + k * gap, b, col, 0.75, { dy: 18 - k * 22 });
      }
      this.addFx(t0 + IMPACT + (hits - 1) * gap, 400, (ctx, t) => { const p = this.body(b); this.shock(ctx, p.x, p.y - 20 * this.scale, t, { r1: 90, w: 8, color: col, squash: 0.45 }); });
    },

    // 蝶靈神影：身化漫天彩蝶，一眨眼分出數道殘影從四面八方同時斬落，最後彩蝶自敵人身上紛飛四散
    butterfly(t0, a, b) {
      const col = '#ff8fd0', col2 = '#c9a0ff', dir = this.dirTo(a, b);
      this.dimScreen(t0 + 80, 1500, 0.5, '#14061c');
      // 起手：身邊湧出彩蝶，飛向敵人
      this.burst(t0 + 150, () => this.body(a), 18, { kind: 'butterfly', speed: [80, 200], angle: dir > 0 ? [-1.2, 0.6] : [Math.PI - 0.6, Math.PI + 1.2], life: [700, 1100], size: [4, 6], color: [col, col2, '#ffd6f0'], drag: 1.2, to: this.body(b), pull: 3, wob: 2 });
      // 殘影：四面八方閃現
      const spots = [[-70, 0.0], [62, 0.12], [-30, 0.24], [40, 0.36], [-85, 0.48], [80, 0.6]];
      spots.forEach(([dx, d], i) => {
        this.addFx(t0 + IMPACT - 300 + d * 500, 170, (ctx, t, el, now) => {
          const off = (this.baseX(b) - this.baseX(a)) / this.scale;
          this.ghost(ctx, a, off + dx, Math.sin(Math.PI * t) * 0.6, now, i % 2 ? col : col2);
        });
      });
      // 多方向斬擊
      for (let k = 0; k < 7; k++) {
        const at = t0 + IMPACT - 300 + k * 50, rot = k / 7 * TAU + 0.5, sw = (k % 2 ? 1 : -1) * 1.7;
        this.addFx(at, 200, (ctx, t) => {
          const p = this.body(b), s = this.scale;
          this.crescent(ctx, p.x, p.y, 58 * s, 13 * s, rot, sw, t * 2.2 - 0.8, t * 2.2, k % 2 ? col : col2, 1 - easeIn(t));
        });
        this.burst(at + 100, () => this.body(b), 4, { kind: 'spark', speed: [150, 320], life: [150, 280], size: [1.4, 2.2], color: ['#ffffff', col], drag: 4 });
      }
      // 收招：交叉大斬 + 蝶群四散
      this.addFx(t0 + IMPACT, 480, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        this.crescent(ctx, p.x, p.y, 100 * s, 22 * s, -2.4, 1.6, t * 2 - 0.7, t * 2, col, 1 - easeIn(t));
        this.crescent(ctx, p.x, p.y, 100 * s, 22 * s, 2.4, -1.6, t * 2 - 0.8, t * 2 - 0.1, col2, 1 - easeIn(t));
      });
      this.addFx(t0 + IMPACT, 450, (ctx, t) => { const p = this.body(b); this.speedLines(ctx, p.x, p.y, t, '#ffd6f0', 30); });
      this.burst(t0 + IMPACT + 60, () => this.body(b), 30, { kind: 'butterfly', speed: [120, 300], life: [900, 1400], size: [3.5, 6], color: [col, col2, '#ffd6f0', '#ffffff'], drag: 1.6, g: -30, wob: 3 });
      this.impact(t0 + IMPACT, b, col, 1.7);
    },

    // 預設（新角色沒指定特效時）
    default(t0, a, b, f) {
      this.impact(t0 + IMPACT, b, f.look.aura, 1);
    }
  };

  // 畫在角色後面的特效
  kit.layerBack = function (start, dur, fn) { this.effects.push({ start, dur, fn, back: true }); };

  // 近身招式：施放者會衝到對手面前
  const MELEE = ['whip', 'whipmulti', 'crack', 'cleave', 'moonbreak', 'butterfly'];
  // 出招時改用的立繪動作（角色沒有這張圖時退回 attack）
  const POSE = {
    swordbeam: 'cast', swords: 'cast_up', aura: 'cast_up', thunder: 'cast', thunderbig: 'cast',
    firetalisman: 'cast', talisman: 'cast', judgement: 'cast', shield: 'cast', cleave: 'slash'
  };
  window.SceneFX = { kit, moves, MELEE, POSE, IMPACT };
})();
