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
      this.initFx();
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    setFighters(chars) {
      this.fighters = chars.map((ch, i) => ch && { ch, look: ch.look, anim: null, slot: i, facing: i === 0 ? 1 : -1 });
      this.effects = []; this.texts = []; this.banners = [];
      this.initFx();
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

    onSkill(ev) {
      const s = ev.slot, f = this.fighters[s];
      if (!f) return;
      const melee = SceneFX.MELEE.includes(ev.fx);
      this.playAnim(s, 'cast', 1150, { melee });
      const now = performance.now();
      this.banners.push({ text: ev.name, slot: s, start: now, dur: 1400, color: SIDE_COLORS[s] });
      const fx = SceneFX.moves[ev.fx] || SceneFX.moves.default;
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
      if (!this.bg || this.bgVer !== Sprites.artVersion()) { this.bg = this.paintBackground(); this.bgVer = Sprites.artVersion(); }
      ctx.save();
      if (now < this.shake.until) {
        const k = (this.shake.until - now) / this.shake.dur;
        ctx.translate(rand(-1, 1) * this.shake.mag * k, rand(-1, 1) * this.shake.mag * k);
      }
      ctx.drawImage(this.bg, -10, -10, this.W + 20, this.H + 20);
      const dt = this.lastNow ? Math.min(50, Math.max(0, now - this.lastNow)) : 16;
      this.lastNow = now;
      this.runTimers(now);
      this.updateParts(now, dt);
      this.effects = this.effects.filter(e => now < e.start + e.dur);
      this.drawDim(ctx, now);

      // 狀態光環（腳下）與角色後方的特效
      this.fighters.forEach((f, i) => f && this.drawStatus(ctx, i, now, 'back'));
      this.drawEffects(ctx, now, true);

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

      // 特效與粒子
      this.drawEffects(ctx, now, false);
      this.drawParts(ctx, now);
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

    drawEffects(ctx, now, back) {
      for (const e of this.effects) {
        if (now < e.start || !!e.back !== back) continue;
        ctx.save();
        e.fn(ctx, (now - e.start) / e.dur, now - e.start, now);
        ctx.restore();
      }
    }

    layer(i, now) {
      const f = this.fighters[i];
      return f && f.anim && f.anim.name === 'cast' ? 1 : 0;
    }

    paintBackground() {
      const c = document.createElement('canvas');
      const W = this.W + 20, H = this.H + 20;
      c.width = Math.round(W * this.dpr); c.height = Math.round(H * this.dpr);
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      const art = Sprites.bgArt();
      if (art) {
        // 背景圖：鋪滿畫面，並讓圖上的地面對齊角色站的位置
        const k = Math.max(W / art.w, H / art.h);
        const dw = art.w * k, dh = art.h * k;
        const dy = Math.min(0, Math.max(H - dh, this.groundY + 10 - art.ground * dh));
        g.drawImage(art.img, (W - dw) / 2, dy, dw, dh);
        return c;
      }
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
  }

  function buffText(stat, up) {
    const name = stat === 'atk' ? '攻擊' : stat === 'def' ? '防禦' : '身法';
    return name + (up ? '↑' : '↓');
  }

  // ---------- 招式特效表 ----------
  Object.assign(BattleScene.prototype, SceneFX.kit);

  window.BattleScene = BattleScene;
  window.SIDE_COLORS = SIDE_COLORS;
})();
