// 對戰場景：背景、角色動畫、招式特效、傷害數字
(function () {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
  const easeOut = t => 1 - Math.pow(1 - clamp01(t), 3);
  const SIDE_COLORS = ['#4fa3ff', '#ff6b5a'];

  class BattleScene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.fighters = [null, null];
      this.effects = [];
      this.texts = [];
      this.banners = [];
      this.shake = { until: 0, mag: 0 };
      this.flash = { until: 0, start: 0, color: '#fff' };
      this.status = [null, null];
      this.ko = -1;
      this.running = false;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    setFighters(chars) {
      this.fighters = chars.map((ch, i) => ch && { ch, look: ch.look, anim: null, slot: i, facing: i === 0 ? 1 : -1 });
      this.effects = []; this.texts = []; this.banners = [];
      this.ko = -1;
      this.status = [null, null];
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
      this.canvas.width = Math.round(this.W * dpr); this.canvas.height = Math.round(this.H * dpr);
      this.dpr = dpr;
      this.scale = Math.min(this.H / 235, this.W / 330);
      this.groundY = this.H * 0.9;
      this.bg = null;
    }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        this.draw(performance.now());
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    stop() { this.running = false; }

    baseX(slot) { return slot === 0 ? this.W * 0.24 : this.W * 0.76; }
    // 角色身體中心（特效瞄準點）
    body(slot) { return { x: this.baseX(slot), y: this.groundY - 62 * this.scale }; }
    hand(slot) { const f = this.fighters[slot]; return { x: this.baseX(slot) + 26 * this.scale * f.facing, y: this.groundY - 60 * this.scale }; }
    dashDist() { return Math.max(0, Math.abs(this.baseX(1) - this.baseX(0)) - 88 * this.scale); }

    // ---------- 事件 ----------

    playAnim(slot, name, dur, extra = {}) {
      const f = this.fighters[slot];
      if (!f || (this.ko === slot && name !== 'ko')) return;
      f.anim = Object.assign({ name, start: performance.now(), dur }, extra);
    }

    onNormal(ev) {
      const s = ev.slot, f = this.fighters[s];
      if (!f) return;
      const melee = Sprites.isMelee(f.look.weapon);
      this.playAnim(s, 'normal', 520);
      const now = performance.now();
      if (melee) {
        this.addFx(now + 230, 260, (ctx, t) => this.drawSlashArc(ctx, this.body(1 - s), f.look.aura, t, 0.6, f.facing));
      } else {
        const color = f.look.aura;
        const shape = f.look.weapon === 'bow' ? 'arrow' : 'orb';
        this.addFx(now + 120, 150, (ctx, t) => this.drawProjectile(ctx, this.hand(s), this.body(1 - s), t, color, shape, 0.7));
      }
    }

    onSkill(ev) {
      const s = ev.slot, f = this.fighters[s];
      if (!f) return;
      const melee = ['slash', 'whip', 'whipmulti', 'crack'].includes(ev.fx);
      this.playAnim(s, 'cast', 1150, { melee });
      const now = performance.now();
      this.banners.push({ text: ev.name, slot: s, start: now, dur: 1400, color: SIDE_COLORS[s] });
      const fx = FX[ev.fx] || FX.default;
      fx.call(this, now, s, 1 - s, f, ev);
    }

    onHit(ev) {
      const now = performance.now();
      const p = this.body(ev.dst);
      const jitter = rand(-14, 14) * this.scale;
      let text = '', color = '#fff', size = 22;
      switch (ev.kind) {
        case 'dmg':
        case 'dot':
          text = '-' + ev.amount; color = ev.kind === 'dot' ? '#9cff8a' : (ev.crit ? '#ffd23f' : '#ff5a4a');
          size = ev.crit ? 30 : (ev.kind === 'dot' ? 18 : 24);
          if (ev.crit) this.texts.push({ text: '暴擊！', x: p.x + jitter, y: p.y - 60 * this.scale, color: '#ffd23f', size: 18, start: now, dur: 900 });
          if (ev.kind !== 'dot' || ev.amount > 0) this.playAnim(ev.dst, 'hurt', 420);
          if (ev.crit) this.doShake(now, 260, 7);
          break;
        case 'heal':
          text = '+' + ev.amount; color = '#5dff9a'; size = 24; break;
        case 'miss':
          text = '閃避'; color = '#cfe8ff'; size = 20; break;
        case 'buff':
          text = buffText(ev.stat, true); color = '#ffe28a'; size = 18; break;
        case 'debuff':
          text = buffText(ev.stat, false); color = '#d59bff'; size = 18; break;
        case 'status':
          text = '中蠱'; color = '#9cff8a'; size = 18; break;
      }
      if (text) this.texts.push({ text, x: p.x + jitter, y: p.y - 30 * this.scale, color, size, start: now, dur: 1100 });
    }

    onKO(ev) {
      this.ko = ev.loser;
      this.playAnim(ev.loser, 'ko', 1000);
      setTimeout(() => this.playAnim(ev.winner, 'win', 1e9), 500);
      this.doShake(performance.now(), 450, 10);
      this.doFlash(performance.now(), 300, '#fff');
    }

    setStatus(state) { this.status = state ? state.f : [null, null]; }

    doShake(now, dur, mag) { this.shake = { until: now + dur, dur, mag }; }
    doFlash(now, dur, color, at = 0) { this.flash = { start: now + at, until: now + at + dur, color }; }

    addFx(start, dur, fn) { this.effects.push({ start, dur, fn }); }

    // ---------- 繪製 ----------

    draw(now) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (!this.bg) this.bg = this.paintBackground();
      ctx.save();
      if (now < this.shake.until) {
        const k = (this.shake.until - now) / this.shake.dur;
        ctx.translate(rand(-1, 1) * this.shake.mag * k, rand(-1, 1) * this.shake.mag * k);
      }
      ctx.drawImage(this.bg, -10, -10, this.W + 20, this.H + 20);

      // 狀態光環（腳下）
      this.fighters.forEach((f, i) => f && this.drawStatus(ctx, i, now, 'back'));

      // 角色：施招者畫在上層
      const order = [0, 1].sort((a, b) => this.layer(a, now) - this.layer(b, now));
      for (const i of order) {
        const f = this.fighters[i];
        if (!f) continue;
        if (f.anim && f.anim.name !== 'ko' && f.anim.name !== 'win' && now - f.anim.start > f.anim.dur) f.anim = null;
        const pose = Sprites.poseFor(f.look, f.anim, now);
        const x = this.baseX(i) + (pose.dash || 0) * this.dashDist() * f.facing;
        Sprites.drawFighter(ctx, f.look, pose, x, this.groundY, this.scale, f.facing, now);
      }
      this.fighters.forEach((f, i) => f && this.drawStatus(ctx, i, now, 'front'));

      // 特效
      this.effects = this.effects.filter(e => now < e.start + e.dur);
      for (const e of this.effects) {
        if (now < e.start) continue;
        ctx.save();
        e.fn(ctx, (now - e.start) / e.dur, now - e.start, now);
        ctx.restore();
      }
      ctx.restore();

      // 全畫面閃光
      if (now >= this.flash.start && now < this.flash.until) {
        const k = 1 - (now - this.flash.start) / (this.flash.until - this.flash.start);
        ctx.fillStyle = this.flash.color; ctx.globalAlpha = 0.45 * k;
        ctx.fillRect(0, 0, this.W, this.H); ctx.globalAlpha = 1;
      }
      this.drawBanners(ctx, now);
      this.drawTexts(ctx, now);
    }

    layer(i, now) {
      const f = this.fighters[i];
      return f && f.anim && (f.anim.name === 'normal' || f.anim.name === 'cast') ? 1 : 0;
    }

    paintBackground() {
      const c = document.createElement('canvas');
      const W = this.W + 20, H = this.H + 20;
      c.width = Math.round(W * this.dpr); c.height = Math.round(H * this.dpr);
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#2a3b6b'); sky.addColorStop(0.45, '#c9799a'); sky.addColorStop(0.75, '#f7c58c'); sky.addColorStop(1, '#f7d9a8');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      // 月
      g.fillStyle = 'rgba(255,248,220,0.9)';
      g.beginPath(); g.arc(W * 0.5, H * 0.2, Math.min(W, H) * 0.08, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,248,220,0.15)';
      g.beginPath(); g.arc(W * 0.5, H * 0.2, Math.min(W, H) * 0.14, 0, TAU); g.fill();
      // 星
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(255,255,255,${rand(0.2, 0.8)})`;
        g.fillRect(rand(0, W), rand(0, H * 0.35), 1.5, 1.5);
      }
      // 遠山（水墨層次）
      const layers = [['#6d5a84', 0.5, 0.18], ['#57476f', 0.6, 0.14], ['#3d3352', 0.7, 0.1]];
      layers.forEach(([col, base, amp], li) => {
        g.fillStyle = col;
        g.beginPath(); g.moveTo(0, H);
        const seed = li * 13.7;
        for (let x = 0; x <= W; x += 6) {
          const y = H * base - H * amp * (0.5 + 0.5 * Math.sin(x / W * 5 + seed)) * (0.6 + 0.4 * Math.sin(x / W * 13 + seed * 2));
          g.lineTo(x, y);
        }
        g.lineTo(W, H); g.closePath(); g.fill();
      });
      // 亭子剪影
      const px = W * 0.5, py = H * 0.66, s = Math.min(W, H) * 0.0025;
      g.fillStyle = '#2a2238';
      g.beginPath(); g.moveTo(px - 40 * s, py - 22 * s); g.quadraticCurveTo(px, py - 46 * s, px + 40 * s, py - 22 * s);
      g.lineTo(px + 30 * s, py - 20 * s); g.lineTo(px - 30 * s, py - 20 * s); g.closePath(); g.fill();
      g.fillRect(px - 24 * s, py - 20 * s, 4 * s, 20 * s); g.fillRect(px + 20 * s, py - 20 * s, 4 * s, 20 * s);
      // 地面
      const gy = this.groundY + 10;
      const ground = g.createLinearGradient(0, gy - 30, 0, H);
      ground.addColorStop(0, '#7a8f5a'); ground.addColorStop(1, '#4b5e36');
      g.fillStyle = ground;
      g.beginPath(); g.moveTo(0, gy - 18);
      g.quadraticCurveTo(W * 0.5, gy - 30, W, gy - 18); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
      // 草
      g.strokeStyle = 'rgba(40,60,30,0.5)'; g.lineWidth = 1;
      for (let k = 0; k < 70; k++) {
        const x = rand(0, W), y = rand(gy - 14, H);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-3, 3), y - rand(3, 8)); g.stroke();
      }
      return c;
    }

    drawStatus(ctx, i, now, layer) {
      const st = this.status[i];
      if (!st || this.ko === i) return;
      const x = this.baseX(i), y = this.groundY, s = this.scale;
      const buffs = st.buffs || [];
      if (layer === 'back') {
        buffs.forEach((b, k) => {
          const col = b.amount < 0 ? '#b065ff' : (b.stat === 'atk' ? '#ff7a45' : b.stat === 'def' ? '#ffd84a' : '#5ff0a0');
          const pulse = 0.6 + 0.4 * Math.sin(now / 200 + k);
          ctx.save();
          ctx.globalAlpha = 0.55 * pulse;
          ctx.strokeStyle = col; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(x, y, (30 + k * 6) * s, (7 + k * 1.5) * s, 0, 0, TAU); ctx.stroke();
          ctx.restore();
        });
        return;
      }
      // 前景：減益箭頭、中毒泡泡
      buffs.filter(b => b.amount < 0).forEach((b, k) => {
        const t = ((now / 900) + k * 0.3) % 1;
        ctx.save(); ctx.globalAlpha = 0.8 * (1 - t);
        ctx.fillStyle = '#c084ff';
        const ax = x + (k % 2 ? 22 : -22) * s, ay = y - (110 - t * 50) * s;
        ctx.beginPath(); ctx.moveTo(ax - 6 * s, ay); ctx.lineTo(ax + 6 * s, ay); ctx.lineTo(ax, ay + 8 * s); ctx.closePath(); ctx.fill();
        ctx.restore();
      });
      if ((st.dots || []).length) {
        for (let k = 0; k < 5; k++) {
          const t = ((now / 1200) + k / 5) % 1;
          ctx.save(); ctx.globalAlpha = 0.7 * (1 - t);
          ctx.fillStyle = '#7dff6a';
          ctx.beginPath(); ctx.arc(x + Math.sin(k * 2.1 + now / 400) * 18 * s, y - (20 + t * 100) * s, (2 + k % 3) * s, 0, TAU); ctx.fill();
          ctx.restore();
        }
      }
    }

    drawBanners(ctx, now) {
      this.banners = this.banners.filter(b => now < b.start + b.dur);
      for (const b of this.banners) {
        const t = (now - b.start) / b.dur;
        const appear = easeOut(t * 4);
        const alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
        const size = Math.round(Math.min(this.W / 9, 46) * (0.6 + 0.4 * appear));
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `900 ${size}px "Noto Serif TC", "Songti TC", "PMingLiU", serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const x = b.slot === 0 ? this.W * 0.3 : this.W * 0.7, y = this.H * 0.3;
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20,10,5,0.85)'; ctx.strokeText(b.text, x, y);
        const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
        g.addColorStop(0, '#fff7d6'); g.addColorStop(1, b.color);
        ctx.fillStyle = g; ctx.fillText(b.text, x, y);
        ctx.restore();
      }
    }

    drawTexts(ctx, now) {
      this.texts = this.texts.filter(t => now < t.start + t.dur);
      for (const t of this.texts) {
        const k = (now - t.start) / t.dur;
        const pop = k < 0.15 ? 0.6 + k / 0.15 * 0.6 : 1.2 - Math.min(0.2, (k - 0.15));
        ctx.save();
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.font = `900 ${Math.round(t.size * pop * Math.max(0.8, this.scale))}px "Noto Sans TC", sans-serif`;
        ctx.textAlign = 'center';
        const y = t.y - easeOut(k) * 40 * this.scale;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(t.text, t.x, y);
        ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, y);
        ctx.restore();
      }
    }

    // ---------- 特效繪製工具 ----------

    glow(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }

    drawSlashArc(ctx, p, color, t, size = 1, facing = 1, rot = -0.6) {
      const s = this.scale * size;
      ctx.translate(p.x, p.y); ctx.rotate(rot * facing); ctx.scale(facing, 1);
      ctx.globalCompositeOperation = 'lighter';
      const a0 = -1.6 + t * 2.4, a1 = a0 + 1.6 * (1 - t * 0.6);
      ctx.globalAlpha = 1 - t;
      this.glow(ctx, color, 20);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 8 * s * (1 - t * 0.5); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, 48 * s, a0, a1); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.arc(0, 0, 56 * s, a0, a1); ctx.stroke();
    }

    drawProjectile(ctx, from, to, t, color, shape, size = 1) {
      const e = clamp01(t);
      const x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e - Math.sin(e * Math.PI) * 10 * this.scale;
      const s = this.scale * size;
      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.globalCompositeOperation = 'lighter';
      this.glow(ctx, color, 18);
      if (shape === 'arrow') {
        ctx.strokeStyle = '#fff4d6'; ctx.lineWidth = 3 * s;
        ctx.beginPath(); ctx.moveTo(-34 * s, 0); ctx.lineTo(10 * s, 0); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(16 * s, 0); ctx.lineTo(6 * s, -5 * s); ctx.lineTo(6 * s, 5 * s); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 2 * s; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(-60 * s, 0); ctx.lineTo(-20 * s, 0); ctx.stroke();
      } else if (shape === 'sword') {
        ctx.fillStyle = '#eaf6ff';
        ctx.beginPath(); ctx.moveTo(30 * s, 0); ctx.lineTo(-10 * s, -5 * s); ctx.lineTo(-24 * s, -2 * s); ctx.lineTo(-24 * s, 2 * s); ctx.lineTo(-10 * s, 5 * s); ctx.closePath(); ctx.fill();
        ctx.fillStyle = color; ctx.fillRect(-28 * s, -8 * s, 4 * s, 16 * s);
        ctx.globalAlpha = 0.5; ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(-24 * s, -4 * s); ctx.lineTo(-80 * s, 0); ctx.lineTo(-24 * s, 4 * s); ctx.fill();
      } else if (shape === 'talisman') {
        ctx.rotate(e * 12);
        ctx.fillStyle = '#ffe066'; ctx.fillRect(-7 * s, -12 * s, 14 * s, 24 * s);
        ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.5 * s;
        ctx.beginPath(); ctx.moveTo(0, -9 * s); ctx.lineTo(0, 9 * s); ctx.moveTo(-4 * s, -3 * s); ctx.lineTo(4 * s, -3 * s); ctx.stroke();
      } else {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 14 * s);
        g.addColorStop(0, '#fff'); g.addColorStop(0.4, color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 14 * s, 0, TAU); ctx.fill();
      }
    }

    drawBurst(ctx, p, color, t, size = 1, n = 12) {
      const s = this.scale * size;
      ctx.translate(p.x, p.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - t;
      this.glow(ctx, color, 16);
      ctx.strokeStyle = color; ctx.lineWidth = 3 * s * (1 - t);
      ctx.beginPath(); ctx.arc(0, 0, (10 + 50 * easeOut(t)) * s, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff';
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + k;
        const r = (8 + 60 * easeOut(t)) * s;
        ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 2.5 * s * (1 - t), 0, TAU); ctx.fill();
      }
    }

    drawBolt(ctx, x, top, bottom, t, color, width = 1) {
      if (t > 1) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
      this.glow(ctx, color, 25);
      const pts = [[x + rand(-10, 10), top]];
      const n = 9;
      for (let k = 1; k <= n; k++) pts.push([x + rand(-18, 18) * this.scale * (k < n ? 1 : 0), top + (bottom - top) * k / n]);
      for (const [w, col] of [[9 * width, color], [3.5 * width, '#fff']]) {
        ctx.strokeStyle = col; ctx.lineWidth = w * this.scale; ctx.lineJoin = 'round';
        ctx.beginPath(); pts.forEach(([px, py], k) => k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.stroke();
      }
    }

    particles(ctx, origin, t, opts) {
      const { n = 20, color = '#fff', spread = 40, rise = 80, size = 3, seed = 1, shape = 'dot' } = opts;
      const s = this.scale;
      ctx.globalCompositeOperation = 'lighter';
      this.glow(ctx, color, 10);
      ctx.fillStyle = color; ctx.strokeStyle = color;
      for (let k = 0; k < n; k++) {
        const ph = (t * 1.3 + (k * 0.618 + seed) % 1) % 1;
        const x = origin.x + Math.sin(k * 12.9898 + seed) * spread * s + Math.sin(ph * 6 + k) * 4 * s;
        const y = origin.y + 30 * s - ph * rise * s;
        ctx.globalAlpha = Math.sin(ph * Math.PI) * (1 - Math.max(0, t - 0.7) / 0.3);
        if (shape === 'plus') {
          const r = size * 1.6 * s;
          ctx.lineWidth = 2.2 * s;
          ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(x, y, size * s, 0, TAU); ctx.fill();
        }
      }
    }

    glyph(ctx, p, text, color, t, size = 1) {
      const s = this.scale * size;
      ctx.globalAlpha = t < 0.15 ? t / 0.15 : t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      ctx.translate(p.x, p.y);
      ctx.scale(1 + 0.3 * (1 - easeOut(t * 3)), 1 + 0.3 * (1 - easeOut(t * 3)));
      ctx.font = `900 ${Math.round(46 * s)}px "Noto Serif TC", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this.glow(ctx, color, 20);
      ctx.lineWidth = 4 * s; ctx.strokeStyle = '#1a0f08'; ctx.strokeText(text, 0, 0);
      ctx.fillStyle = color; ctx.fillText(text, 0, 0);
    }
  }

  function buffText(stat, up) {
    const name = stat === 'atk' ? '攻擊' : stat === 'def' ? '防禦' : '身法';
    return name + (up ? '↑' : '↓');
  }

  // ---------- 招式特效表 ----------
  // this = scene, t0 = 施放時刻, a = 施放者, b = 目標, f = 施放者資料
  const IMPACT = 750;
  const FX = {
    default(t0, a, b, f) {
      this.addFx(t0 + IMPACT, 450, (ctx, t) => this.drawBurst(ctx, this.body(b), f.look.aura, t));
    },
    swordbeam(t0, a, b, f) {
      this.addFx(t0 + 450, 300, (ctx, t) => this.drawProjectile(ctx, this.hand(a), this.body(b), t, f.look.aura, 'sword', 1.2));
      this.addFx(t0 + IMPACT, 450, (ctx, t) => this.drawBurst(ctx, this.body(b), f.look.aura, t, 1.2));
    },
    slash(t0, a, b, f) {
      const fc = this.fighters[a].facing;
      this.addFx(t0 + 620, 330, (ctx, t) => this.drawSlashArc(ctx, this.body(b), f.look.aura, t, 1.4, fc, -0.7));
      this.addFx(t0 + 720, 330, (ctx, t) => this.drawSlashArc(ctx, this.body(b), '#ffffff', t, 1.2, fc, 0.9));
      this.addFx(t0 + IMPACT, 400, (ctx, t) => this.drawBurst(ctx, this.body(b), f.look.aura, t, 1));
    },
    swords(t0, a, b, f, ev) {
      const hits = ev.hits || 5;
      // 天空中的劍陣
      this.addFx(t0 + 300, 500 + hits * 160, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(Math.PI * t) * 0.8;
        this.glow(ctx, f.look.aura, 20);
        ctx.strokeStyle = f.look.aura; ctx.lineWidth = 2 * s;
        ctx.beginPath(); ctx.ellipse(p.x, this.H * 0.12, 70 * s, 14 * s, 0, 0, TAU); ctx.stroke();
      });
      for (let k = 0; k < hits; k++) {
        const ox = (k - (hits - 1) / 2) * 16;
        this.addFx(t0 + IMPACT - 200 + k * ev.multiGap, 200, (ctx, t) => {
          const p = this.body(b);
          this.drawProjectile(ctx, { x: p.x + ox * this.scale, y: this.H * 0.08 }, { x: p.x + ox * 0.3 * this.scale, y: p.y }, t, f.look.aura, 'sword', 1.1);
        });
        this.addFx(t0 + IMPACT + k * ev.multiGap, 300, (ctx, t) => this.drawBurst(ctx, this.body(b), f.look.aura, t, 0.7, 8));
      }
      this.addFx(t0 + IMPACT, hits * ev.multiGap, () => {});
      setTimeout(() => this.doShake(performance.now(), hits * ev.multiGap, 5), IMPACT);
    },
    thunder(t0, a, b) {
      this.addFx(t0 + 680, 260, (ctx, t) => this.drawBolt(ctx, this.body(b).x, 0, this.body(b).y + 20 * this.scale, t, '#b98cff'));
      this.addFx(t0 + IMPACT, 400, (ctx, t) => this.drawBurst(ctx, this.body(b), '#d0b0ff', t));
      this.doFlash(t0, 150, '#e8dcff', 700);
    },
    thunderbig(t0, a, b) {
      [0, 90, 180].forEach((d, k) => {
        this.addFx(t0 + 660 + d, 300, (ctx, t) => this.drawBolt(ctx, this.body(b).x + (k - 1) * 22 * this.scale, 0, this.body(b).y + 30 * this.scale, t, '#9fb6ff', 1.3));
      });
      this.addFx(t0 + IMPACT, 600, (ctx, t) => this.drawBurst(ctx, this.body(b), '#c7d6ff', t, 1.8, 16));
      this.doFlash(t0, 220, '#f0f4ff', 700);
      setTimeout(() => this.doShake(performance.now(), 400, 9), IMPACT);
    },
    heal(t0, a, b, f) {
      this.addFx(t0 + 450, 1100, (ctx, t) => this.particles(ctx, this.body(a), t, { n: 16, color: '#7dffb0', spread: 30, rise: 90, size: 3, shape: 'plus' }));
      this.addFx(t0 + 600, 700, (ctx, t) => {
        const p = this.body(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 3 * s; this.glow(ctx, '#7dffb0', 15);
        ctx.beginPath(); ctx.ellipse(p.x, this.groundY, (20 + 30 * t) * s, (5 + 8 * t) * s, 0, 0, TAU); ctx.stroke();
      });
    },
    healbig(t0, a, b, f) {
      FX.heal.call(this, t0, a, b, f);
      this.addFx(t0 + 400, 1200, (ctx, t) => {
        const p = this.body(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.sin(Math.PI * t) * 0.6;
        const g = ctx.createLinearGradient(p.x - 40 * s, 0, p.x + 40 * s, 0);
        g.addColorStop(0, 'rgba(120,255,170,0)'); g.addColorStop(0.5, 'rgba(200,255,200,0.9)'); g.addColorStop(1, 'rgba(120,255,170,0)');
        ctx.fillStyle = g; ctx.fillRect(p.x - 40 * s, 0, 80 * s, this.groundY);
      });
      this.addFx(t0 + 450, 1100, (ctx, t) => this.particles(ctx, this.body(a), t, { n: 18, color: '#ffe9a0', spread: 40, rise: 120, size: 2.5, seed: 0.5 }));
    },
    ice(t0, a, b) {
      this.addFx(t0 + 600, 800, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        ctx.globalAlpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
        for (let k = 0; k < 7; k++) {
          const x = p.x + (k - 3) * 14 * s, h = (40 + (k % 3) * 22) * s * easeOut(t * 3 - k * 0.1);
          const g = ctx.createLinearGradient(0, this.groundY - h, 0, this.groundY);
          g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#7fd3ff');
          ctx.fillStyle = g; ctx.strokeStyle = '#2b6a9a'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x - 8 * s, this.groundY); ctx.lineTo(x + (k % 2 ? 3 : -3) * s, this.groundY - h); ctx.lineTo(x + 8 * s, this.groundY); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= 0.5;
        ctx.fillStyle = '#bfe9ff'; ctx.beginPath(); ctx.arc(p.x, p.y, 50 * s, 0, TAU); ctx.fill();
      });
      this.addFx(t0 + 300, 500, (ctx, t) => this.particles(ctx, this.body(b), t, { n: 14, color: '#d8f3ff', spread: 50, rise: -60, size: 2 }));
    },
    whip(t0, a, b, f) {
      this.addFx(t0 + IMPACT - 40, 350, (ctx, t) => this.drawBurst(ctx, this.body(b), '#ff8a65', t, 0.9));
    },
    whipmulti(t0, a, b, f, ev) {
      for (let k = 0; k < (ev.hits || 3); k++) {
        this.addFx(t0 + IMPACT + k * ev.multiGap, 280, (ctx, t) => this.drawSlashArc(ctx, this.body(b), '#ff8a65', t, 0.9, this.fighters[a].facing, k % 2 ? 0.8 : -0.8));
      }
    },
    crack(t0, a, b) {
      this.addFx(t0 + IMPACT - 50, 650, (ctx, t) => this.glyph(ctx, this.body(b), '破', '#ffb347', t, 1.2));
      this.addFx(t0 + IMPACT, 500, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        ctx.fillStyle = '#d9e2ec'; ctx.globalAlpha = 1 - t;
        for (let k = 0; k < 10; k++) {
          const ang = k / 10 * TAU, r = 60 * easeOut(t) * s;
          ctx.save(); ctx.translate(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r + t * t * 40 * s); ctx.rotate(k + t * 6);
          ctx.beginPath(); ctx.moveTo(0, -6 * s); ctx.lineTo(5 * s, 4 * s); ctx.lineTo(-4 * s, 3 * s); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      });
    },
    fire(t0, a, b, f) {
      this.addFx(t0 + 350, 1200, (ctx, t) => {
        const p = this.body(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 9; k++) {
          const ph = (t * 3 + k / 9) % 1;
          const x = p.x + Math.sin(k * 2.4) * 26 * s, y = this.groundY - ph * 110 * s;
          const r = (14 - ph * 10) * s;
          ctx.globalAlpha = (1 - ph) * Math.sin(Math.PI * t);
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ff8a3d'); g.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        }
      });
    },
    meteor(t0, a, b, f) {
      const fc = this.fighters[a].facing;
      this.addFx(t0 + 420, 330, (ctx, t) => {
        const p = this.body(b);
        const from = { x: p.x - fc * this.W * 0.45, y: -20 };
        this.drawProjectile(ctx, from, p, t, '#ff9a3d', 'orb', 2.2);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.particles(ctx, { x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t }, t, { n: 8, color: '#ffcf70', spread: 10, rise: -30, size: 2 });
      });
      this.addFx(t0 + IMPACT, 600, (ctx, t) => this.drawBurst(ctx, this.body(b), '#ffb347', t, 1.9, 18));
      this.doFlash(t0, 160, '#ffe0b0', IMPACT);
      setTimeout(() => this.doShake(performance.now(), 350, 9), IMPACT);
    },
    poison(t0, a, b) {
      this.addFx(t0 + 450, 300, (ctx, t) => this.drawProjectile(ctx, this.hand(a), this.body(b), t, '#7dff6a', 'orb', 1.3));
      this.addFx(t0 + IMPACT, 700, (ctx, t) => this.particles(ctx, this.body(b), t, { n: 18, color: '#7dff6a', spread: 36, rise: 70, size: 4 }));
    },
    swarm(t0, a, b) {
      this.addFx(t0 + 300, 1200, (ctx, t, el) => {
        const A = this.hand(a), B = this.body(b), s = this.scale;
        ctx.fillStyle = '#2d3b1f';
        for (let k = 0; k < 36; k++) {
          const d = clamp01(t * 2.2 - k * 0.02);
          const cx = A.x + (B.x - A.x) * easeOut(d), cy = A.y + (B.y - A.y) * easeOut(d);
          const r = (8 + (k % 5) * 6) * s * (0.4 + d);
          const ang = el / 120 + k * 1.7;
          ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
          ctx.beginPath(); ctx.ellipse(cx + Math.cos(ang) * r, cy + Math.sin(ang * 1.3) * r * 0.7, 2.6 * s, 1.6 * s, ang, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 * Math.sin(Math.PI * t);
        ctx.fillStyle = '#7dff6a'; ctx.beginPath(); ctx.arc(B.x, B.y, 50 * s, 0, TAU); ctx.fill();
      });
    },
    drain(t0, a, b) {
      this.addFx(t0 + 500, 400, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        ctx.globalAlpha = Math.sin(Math.PI * t); ctx.strokeStyle = '#8b1e3f'; ctx.lineWidth = 4 * s;
        ctx.beginPath(); ctx.arc(p.x, p.y, 50 * s * (1 - t * 0.6), 0, TAU); ctx.stroke();
      });
      for (let k = 0; k < 8; k++) {
        this.addFx(t0 + IMPACT + k * 50, 450, (ctx, t) => {
          const A = this.body(b), B = this.body(a);
          this.drawProjectile(ctx, { x: A.x, y: A.y + (k - 4) * 6 * this.scale }, B, t, '#ff3d6e', 'orb', 0.7);
        });
      }
    },
    bells(t0, a, b) {
      for (let k = 0; k < 3; k++) {
        this.addFx(t0 + 420 + k * 110, 450, (ctx, t) => {
          const A = this.hand(a), B = this.body(b), s = this.scale;
          const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - t * 0.6;
          this.glow(ctx, '#e8eef7', 12);
          ctx.strokeStyle = '#e8eef7'; ctx.lineWidth = 3 * s;
          ctx.beginPath(); ctx.arc(x, y, (10 + 20 * t) * s, -1, 1); ctx.stroke();
        });
      }
      this.addFx(t0 + IMPACT - 50, 600, (ctx, t) => this.glyph(ctx, this.body(b), '鈴', '#e8eef7', t, 1));
    },
    firetalisman(t0, a, b) {
      this.addFx(t0 + 420, 330, (ctx, t) => this.drawProjectile(ctx, this.hand(a), this.body(b), t, '#ffcc33', 'talisman', 1.2));
      FX.fire.call(this, t0 + 400, b, b);
      this.addFx(t0 + IMPACT, 450, (ctx, t) => this.drawBurst(ctx, this.body(b), '#ff8a3d', t, 1.2));
    },
    talisman(t0, a, b) {
      this.addFx(t0 + 420, 330, (ctx, t) => this.drawProjectile(ctx, this.hand(a), this.body(b), t, '#ffcc33', 'talisman', 1.2));
      this.addFx(t0 + IMPACT, 800, (ctx, t) => {
        const p = this.body(b), s = this.scale;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(Math.PI * t);
        ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2.5 * s; this.glow(ctx, '#ffd84a', 15);
        ctx.translate(p.x, this.groundY); ctx.scale(1, 0.3); ctx.rotate(t * 3);
        ctx.beginPath(); ctx.arc(0, 0, 50 * s, 0, TAU); ctx.stroke();
        ctx.beginPath();
        for (let k = 0; k <= 5; k++) { const ang = k * TAU * 2 / 5; ctx.lineTo(Math.cos(ang) * 50 * s, Math.sin(ang) * 50 * s); }
        ctx.stroke();
      });
      this.addFx(t0 + IMPACT, 700, (ctx, t) => this.glyph(ctx, this.body(b), '鎮', '#ffd84a', t, 1));
    },
    shield(t0, a) {
      this.addFx(t0 + 450, 1100, (ctx, t) => {
        const p = this.body(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.sin(Math.PI * t) * 0.9;
        this.glow(ctx, '#ffd84a', 18);
        ctx.strokeStyle = '#ffe9a0'; ctx.fillStyle = 'rgba(255,216,74,0.15)'; ctx.lineWidth = 3 * s;
        const r = 62 * s * easeOut(t * 2);
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) { const ang = k / 6 * TAU + Math.PI / 6; ctx.lineTo(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r); }
        ctx.fill(); ctx.stroke();
      });
    },
    wind(t0, a) {
      this.addFx(t0 + 350, 1100, (ctx, t, el) => {
        const p = this.body(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#b6ffd8'; ctx.lineWidth = 2.5 * s; this.glow(ctx, '#7dffb0', 10);
        for (let k = 0; k < 4; k++) {
          ctx.globalAlpha = Math.sin(Math.PI * t) * 0.9;
          const y = this.groundY - (20 + k * 25) * s, a0 = el / 150 + k * 1.5;
          ctx.beginPath(); ctx.ellipse(p.x, y, (30 + k * 4) * s, 8 * s, 0, a0, a0 + 2.6); ctx.stroke();
        }
      });
    },
    aura(t0, a, b, f) {
      this.addFx(t0 + 400, 1150, (ctx, t) => {
        const p = this.body(a), s = this.scale;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.sin(Math.PI * t) * 0.7;
        const g = ctx.createLinearGradient(p.x - 45 * s, 0, p.x + 45 * s, 0);
        g.addColorStop(0, 'rgba(255,200,80,0)'); g.addColorStop(0.5, 'rgba(255,230,140,0.9)'); g.addColorStop(1, 'rgba(255,200,80,0)');
        ctx.fillStyle = g; ctx.fillRect(p.x - 45 * s, 0, 90 * s, this.groundY);
      });
      this.addFx(t0 + 400, 1100, (ctx, t) => this.particles(ctx, this.body(a), t, { n: 18, color: '#ffd36b', spread: 34, rise: 130, size: 2.5 }));
    },
    arrow(t0, a, b) {
      this.addFx(t0 + 600, 150, (ctx, t) => this.drawProjectile(ctx, this.hand(a), this.body(b), t, '#9ff2e5', 'arrow', 1.4));
      this.addFx(t0 + IMPACT, 400, (ctx, t) => this.drawBurst(ctx, this.body(b), '#9ff2e5', t, 1.1));
    },
    arrows(t0, a, b, f, ev) {
      for (let k = 0; k < (ev.hits || 3); k++) {
        this.addFx(t0 + IMPACT - 150 + k * ev.multiGap, 150, (ctx, t) => {
          const B = this.body(b);
          this.drawProjectile(ctx, this.hand(a), { x: B.x, y: B.y + (k - 1) * 12 * this.scale }, t, '#9ff2e5', 'arrow', 1.1);
        });
        this.addFx(t0 + IMPACT + k * ev.multiGap, 250, (ctx, t) => this.drawBurst(ctx, this.body(b), '#9ff2e5', t, 0.6, 6));
      }
    },
    howl(t0, a, b) {
      for (let k = 0; k < 3; k++) {
        this.addFx(t0 + 400 + k * 120, 450, (ctx, t) => {
          const A = this.body(a), B = this.body(b), s = this.scale;
          const x = A.x + (B.x - A.x) * t;
          ctx.globalAlpha = 1 - t; ctx.strokeStyle = '#f5efe4'; ctx.lineWidth = 3 * s;
          ctx.beginPath(); ctx.arc(x, A.y, (14 + 26 * t) * s, B.x > A.x ? -0.9 : Math.PI - 0.9, B.x > A.x ? 0.9 : Math.PI + 0.9); ctx.stroke();
        });
      }
      this.addFx(t0 + IMPACT - 50, 650, (ctx, t) => this.glyph(ctx, this.body(b), '嘯', '#f5efe4', t, 1));
    },
    eagle(t0, a, b) {
      this.addFx(t0 + 380, 370, (ctx, t) => {
        const B = this.body(b), s = this.scale;
        const sx = (this.baseX(a) + B.x) / 2, sy = -30;
        const x = sx + (B.x - sx) * easeOut(t), y = sy + (B.y - sy) * t * t;
        const flap = Math.sin(t * 30) * 0.5;
        ctx.translate(x, y); ctx.scale(B.x > sx ? 1 : -1, 1); ctx.rotate(0.6);
        this.glow(ctx, '#9ff2e5', 16);
        ctx.fillStyle = '#3a2a1e';
        ctx.beginPath(); ctx.moveTo(18 * s, 0); ctx.lineTo(-14 * s, -4 * s); ctx.lineTo(-20 * s, 0); ctx.lineTo(-14 * s, 4 * s); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(4 * s, 0); ctx.quadraticCurveTo(-6 * s, (-30 - flap * 20) * s, -26 * s, (-28 - flap * 16) * s); ctx.lineTo(-8 * s, 0); ctx.fill();
        ctx.beginPath(); ctx.moveTo(4 * s, 0); ctx.quadraticCurveTo(-6 * s, (30 + flap * 20) * s, -26 * s, (28 + flap * 16) * s); ctx.lineTo(-8 * s, 0); ctx.fill();
        ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.moveTo(18 * s, -1 * s); ctx.lineTo(25 * s, 2 * s); ctx.lineTo(17 * s, 3 * s); ctx.fill();
      });
      this.addFx(t0 + IMPACT, 600, (ctx, t) => this.drawBurst(ctx, this.body(b), '#9ff2e5', t, 1.7, 16));
      setTimeout(() => this.doShake(performance.now(), 300, 7), IMPACT);
    }
  };

  window.BattleScene = BattleScene;
  window.SIDE_COLORS = SIDE_COLORS;
})();
