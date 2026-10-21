// Q 版人物繪製（Canvas 程序化繪圖，無外部圖檔）
// 座標：原點在腳底中心、面向右方，人物總高約 130 單位。
(function () {
  const TAU = Math.PI * 2;

  // ---------- 小工具 ----------
  function ell(ctx, x, y, rx, ry, rot = 0) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  }
  function fillStroke(ctx, fill, stroke = '#2b1b0e', lw = 2) {
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function dir(a) { return [Math.sin(a), Math.cos(a)]; } // a=0 向下、a=π/2 向前、a=π 向上
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }
  function capsule(ctx, x0, y0, x1, y1, w, fill, stroke = '#2b1b0e') {
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke; ctx.lineWidth = w + 3.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = fill; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => ease((t - a) / (b - a));

  // ---------- 姿勢 ----------
  function readyPose(look) {
    const p = {
      x: 0, y: 0, rot: 0, lean: 0.04, head: 0,
      armF: 0.75, armB: -0.35, legF: 0.22, legB: -0.2,
      wAbs: null, wOff: 1.55, eyes: 'normal', mouth: 'smile',
      glow: 0, flash: 0, alpha: 1, bow: 0, whip: 0
    };
    switch (look.weapon) {
      case 'staff': p.armF = 0.55; p.wAbs = Math.PI - 0.12; break;
      case 'bow': p.armF = 1.35; p.armB = 1.1; p.wAbs = Math.PI; break;
      case 'bell': p.armF = 1.15; p.wAbs = 0; break;
      case 'whip': p.armF = 0.55; p.wOff = 1.2; break;
      case 'talisman': p.armB = 1.4; break;
    }
    return p;
  }

  // anim: { name, start, dur, melee }  now: 毫秒
  function poseFor(look, anim, now) {
    const p = readyPose(look);
    const bob = Math.sin(now / 330) * 1.6;
    p.y = bob; p.head = Math.sin(now / 660) * 0.03;
    if (!anim) return p;
    const t = Math.max(0, now - anim.start) / anim.dur;
    const tc = Math.min(1, t);
    switch (anim.name) {
      case 'cast': {
        const up = seg(tc, 0, 0.42), rel = seg(tc, 0.42, 0.62), back = seg(tc, 0.75, 1);
        p.glow = Math.sin(Math.PI * Math.min(1, tc * 1.25)) ;
        p.y = bob - 6 * up * (1 - rel);
        if (anim.melee) {
          p.dash = tc < 0.6 ? seg(tc, 0.35, 0.55) : 1 - seg(tc, 0.7, 1);
          p.armF = lerp(lerp(p.armF, 2.1, up), 0.3, rel);
          p.armF = lerp(p.armF, readyPose(look).armF, back);
          p.lean = lerp(-0.08 * up, 0.32, rel) * (1 - back);
          p.whip = look.weapon === 'whip' ? Math.sin(Math.PI * seg(tc, 0.4, 0.85)) : 0;
          p.legF = lerp(0.22, 0.6, p.dash || 0); p.legB = lerp(-0.2, -0.55, p.dash || 0);
        } else {
          const base = readyPose(look);
          p.armF = lerp(lerp(base.armF, 1.95, up), 1.6, rel);
          p.armF = lerp(p.armF, base.armF, back);
          p.armB = lerp(lerp(base.armB, 2.6, up), 1.2, rel);
          p.armB = lerp(p.armB, base.armB, back);
          if (look.weapon === 'bow') { p.bow = up * (1 - rel); p.armF = lerp(1.35, 1.5, up); p.armB = lerp(1.1, 1.45, up * (1 - rel)); }
          p.lean = lerp(-0.1 * up, 0.18, rel) * (1 - back);
        }
        p.eyes = tc < 0.42 ? 'closed' : 'normal';
        p.mouth = tc > 0.4 && tc < 0.75 ? 'open' : 'flat';
        break;
      }
      case 'hurt': {
        const k = Math.sin(Math.PI * Math.min(1, tc * 1.1));
        p.x = -12 * k; p.lean = -0.38 * k; p.head = -0.15 * k;
        p.armF = lerp(p.armF, 0.1, k); p.armB = lerp(p.armB, -0.9, k);
        p.eyes = tc < 0.8 ? 'hurt' : 'normal'; p.mouth = 'hurt';
        p.flash = Math.max(0, 1 - tc * 1.6);
        break;
      }
      case 'ko': {
        const k = seg(t, 0, 0.6);
        p.rot = -1.5 * k; p.x = 10 * k; p.y = 32 * k;
        p.armF = lerp(p.armF, 2.2, k); p.armB = lerp(p.armB, 2.5, k);
        p.legF = 0.15; p.legB = -0.1;
        p.eyes = 'ko'; p.mouth = 'hurt';
        p.flash = Math.max(0, 1 - t * 2);
        p.wDrop = k;
        break;
      }
      case 'win': {
        const j = Math.abs(Math.sin(now / 260));
        p.y = -12 * j; p.armF = 2.0 + 0.15 * j; p.armB = 2.6 + 0.2 * j;
        p.legF = 0.35 * j; p.legB = -0.35 * j;
        p.eyes = 'happy'; p.mouth = 'open';
        break;
      }
      case 'select': {
        p.eyes = 'happy'; p.y = bob - Math.abs(Math.sin(now / 200)) * 6 * Math.max(0, 1 - t);
        break;
      }
    }
    return p;
  }

  // ---------- 各部位 ----------
  function drawLeg(ctx, look, hipX, ang, front) {
    const [dx, dy] = dir(ang);
    const hx = hipX, hy = -22, len = 21;
    const fx = hx + dx * len, fy = hy + dy * len;
    capsule(ctx, hx, hy, fx, fy, 8.5, front ? shade(look.sub, -0.08) : shade(look.sub, -0.2));
    // 靴
    ell(ctx, fx + 3, fy - 1, 7, 4.5);
    fillStroke(ctx, front ? '#3a2a20' : '#2c1f18', '#1a100a', 2);
  }

  function drawArm(ctx, look, sx, sy, ang, front) {
    const [dx, dy] = dir(ang);
    const len = 21;
    const hx = sx + dx * len, hy = sy + dy * len;
    capsule(ctx, sx, sy, hx, hy, 9, front ? look.main : shade(look.main, -0.22));
    // 袖口
    capsule(ctx, sx + dx * (len - 5), sy + dy * (len - 5), sx + dx * (len - 3), sy + dy * (len - 3), 10, look.trim);
    ell(ctx, hx, hy, 4.8, 4.8);
    fillStroke(ctx, look.skin, '#2b1b0e', 1.8);
    return [hx, hy];
  }

  function drawTorso(ctx, look) {
    // 下襬 / 裙
    ctx.beginPath();
    ctx.moveTo(-12, -42); ctx.lineTo(12, -42);
    ctx.quadraticCurveTo(19, -28, 20, -17);
    ctx.quadraticCurveTo(0, -12, -20, -17);
    ctx.quadraticCurveTo(-19, -28, -12, -42);
    ctx.closePath();
    fillStroke(ctx, shade(look.main, -0.12));
    // 下襬內層
    ctx.beginPath();
    ctx.moveTo(-3, -40); ctx.lineTo(9, -40); ctx.lineTo(13, -16); ctx.quadraticCurveTo(4, -14, -3, -15.5); ctx.closePath();
    fillStroke(ctx, look.sub, '#2b1b0e', 1.5);
    // 上身
    ctx.beginPath();
    ctx.moveTo(-12, -60);
    ctx.quadraticCurveTo(0, -64, 13, -60);
    ctx.lineTo(12, -40); ctx.lineTo(-12, -40); ctx.closePath();
    fillStroke(ctx, look.main);
    // 交領
    ctx.beginPath();
    ctx.moveTo(-5, -61); ctx.lineTo(6, -48); ctx.lineTo(12, -61);
    ctx.strokeStyle = look.sub; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5, -61); ctx.lineTo(6, -48); ctx.lineTo(12, -61);
    ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 1; ctx.stroke();
    // 腰帶
    ctx.beginPath(); ctx.rect(-13, -45, 26, 6);
    fillStroke(ctx, look.trim, '#2b1b0e', 1.5);
    ctx.beginPath(); ctx.moveTo(-10, -40); ctx.quadraticCurveTo(-16, -30, -20, -26);
    ctx.strokeStyle = look.trim; ctx.lineWidth = 3; ctx.stroke();
  }

  function drawHairBack(ctx, look, now) {
    const c = look.hair;
    const sway = Math.sin(now / 400) * 2;
    switch (look.hairStyle) {
      case 'spiky': {
        // 頭帶飄帶
        ctx.beginPath();
        ctx.moveTo(-22, -96);
        ctx.quadraticCurveTo(-40, -95 + sway, -52, -86 + sway * 1.5);
        ctx.lineTo(-48, -82 + sway);
        ctx.quadraticCurveTo(-38, -88, -22, -90);
        fillStroke(ctx, look.band, '#2b1b0e', 1.5);
        ell(ctx, -2, -88, 29, 26);
        fillStroke(ctx, c);
        break;
      }
      case 'twinbuns': {
        ctx.beginPath();
        ctx.moveTo(-26, -92);
        ctx.quadraticCurveTo(-34, -60, -28 + sway, -30);
        ctx.lineTo(-8 + sway, -34);
        ctx.quadraticCurveTo(-6, -60, 10, -92);
        ctx.closePath();
        fillStroke(ctx, c);
        ell(ctx, -1, -88, 29, 27);
        fillStroke(ctx, c);
        break;
      }
      case 'ponytail': {
        ctx.beginPath();
        ctx.moveTo(-14, -110);
        ctx.quadraticCurveTo(-46, -112, -44 + sway, -72);
        ctx.quadraticCurveTo(-42 + sway, -50, -34 + sway * 1.5, -40);
        ctx.quadraticCurveTo(-36, -70, -14, -98);
        ctx.closePath();
        fillStroke(ctx, c);
        ell(ctx, -1, -88, 29, 27);
        fillStroke(ctx, c);
        break;
      }
      case 'miao': {
        ctx.beginPath();
        ctx.moveTo(-27, -90); ctx.quadraticCurveTo(-32, -66, -24, -58); ctx.lineTo(-6, -62);
        ctx.quadraticCurveTo(-4, -80, 4, -96); ctx.closePath();
        fillStroke(ctx, c);
        ell(ctx, -1, -88, 29, 27);
        fillStroke(ctx, c);
        break;
      }
      case 'topknot': {
        ell(ctx, -1, -89, 28.5, 26.5);
        fillStroke(ctx, c);
        // 髮帶尾
        ctx.beginPath();
        ctx.moveTo(-6, -116); ctx.quadraticCurveTo(-22, -112 + sway, -30, -102 + sway);
        ctx.lineTo(-26, -100 + sway); ctx.quadraticCurveTo(-18, -108, -6, -112);
        fillStroke(ctx, look.band, '#2b1b0e', 1.5);
        break;
      }
      case 'furhat': {
        // 兩條辮子
        for (const [bx, k] of [[-20, 1], [-8, 0.6]]) {
          ctx.beginPath();
          ctx.moveTo(bx, -76);
          ctx.quadraticCurveTo(bx - 6 + sway * k, -56, bx - 2 + sway * k, -38);
          ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.stroke();
          ctx.strokeStyle = c; ctx.lineWidth = 6.5; ctx.stroke();
          ell(ctx, bx - 2 + sway * k, -36, 3.5, 3.5); fillStroke(ctx, look.trim, '#2b1b0e', 1.2);
        }
        ell(ctx, -1, -88, 28.5, 26.5);
        fillStroke(ctx, c);
        break;
      }
      default:
        ell(ctx, -1, -88, 29, 27); fillStroke(ctx, c);
    }
  }

  function drawFace(ctx, look, pose) {
    // 臉
    ell(ctx, 3, -83, 23, 21.5);
    fillStroke(ctx, look.skin, '#2b1b0e', 2);
    // 耳
    ell(ctx, -15, -82, 4.5, 6); fillStroke(ctx, look.skin, '#2b1b0e', 1.6);
    // 腮紅
    ctx.fillStyle = 'rgba(255,120,120,0.35)';
    ell(ctx, 0, -73, 4.5, 2.6); ctx.fill();
    ell(ctx, 20, -73, 4, 2.4); ctx.fill();
    const eyeC = look.eye || shade(look.hair, 0.15);
    const eyes = [[4, -80, 4.6], [17, -80, 4.2]];
    ctx.lineCap = 'round';
    for (const [ex, ey, r] of eyes) {
      switch (pose.eyes) {
        case 'closed':
          ctx.beginPath(); ctx.arc(ex, ey + 1, r * 0.9, Math.PI * 0.1, Math.PI * 0.9);
          ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 2; ctx.stroke(); break;
        case 'happy':
          ctx.beginPath(); ctx.arc(ex, ey + 2, r * 0.9, Math.PI * 1.15, Math.PI * 1.85);
          ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 2.4; ctx.stroke(); break;
        case 'hurt':
          ctx.beginPath(); ctx.moveTo(ex - r, ey - r * 0.8); ctx.lineTo(ex + r * 0.6, ey); ctx.lineTo(ex - r, ey + r * 0.8);
          ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 2.2; ctx.stroke(); break;
        case 'ko':
          ctx.beginPath(); ctx.moveTo(ex - r, ey - r); ctx.lineTo(ex + r, ey + r); ctx.moveTo(ex + r, ey - r); ctx.lineTo(ex - r, ey + r);
          ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 2.2; ctx.stroke(); break;
        default:
          ell(ctx, ex, ey, r, r * 1.3); ctx.fillStyle = '#1d1210'; ctx.fill();
          ell(ctx, ex, ey + r * 0.35, r * 0.75, r * 0.8); ctx.fillStyle = eyeC; ctx.fill();
          ell(ctx, ex + r * 0.3, ey - r * 0.45, r * 0.42, r * 0.5); ctx.fillStyle = '#fff'; ctx.fill();
          ell(ctx, ex - r * 0.35, ey + r * 0.55, r * 0.2, r * 0.2); ctx.fill();
      }
    }
    // 眉
    ctx.strokeStyle = shade(look.hair, -0.1); ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(0, -89); ctx.lineTo(8, -90); ctx.moveTo(14, -90); ctx.lineTo(21, -89); ctx.stroke();
    // 嘴
    ctx.strokeStyle = '#7a2e22'; ctx.lineWidth = 1.8;
    ctx.beginPath();
    switch (pose.mouth) {
      case 'open':
        ell(ctx, 11, -70, 3, 2.6); ctx.fillStyle = '#9b3a2c'; ctx.fill(); break;
      case 'hurt':
        ctx.moveTo(7, -69); ctx.quadraticCurveTo(11, -73, 15, -69); ctx.stroke(); break;
      case 'flat':
        ctx.moveTo(8, -70); ctx.lineTo(14, -70); ctx.stroke(); break;
      default:
        ctx.moveTo(7, -71); ctx.quadraticCurveTo(11, -67.5, 15, -71); ctx.stroke();
    }
  }

  function drawHairFront(ctx, look, now) {
    const c = look.hair;
    const hl = shade(c, 0.25);
    switch (look.hairStyle) {
      case 'spiky': {
        ctx.beginPath();
        ctx.moveTo(-27, -82);
        ctx.lineTo(-33, -100); ctx.lineTo(-20, -102); ctx.lineTo(-22, -116); ctx.lineTo(-6, -108);
        ctx.lineTo(0, -122); ctx.lineTo(10, -108); ctx.lineTo(22, -116); ctx.lineTo(22, -102);
        ctx.lineTo(32, -96); ctx.lineTo(25, -90); ctx.lineTo(27, -76);
        ctx.lineTo(19, -88); ctx.lineTo(14, -80); ctx.lineTo(9, -91); ctx.lineTo(2, -82); ctx.lineTo(-3, -92); ctx.lineTo(-10, -84);
        ctx.lineTo(-14, -90);
        ctx.closePath();
        fillStroke(ctx, c);
        // 頭帶
        ctx.beginPath(); ctx.moveTo(-25, -95); ctx.quadraticCurveTo(2, -104, 27, -95);
        ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 6; ctx.stroke();
        ctx.strokeStyle = look.band; ctx.lineWidth = 4; ctx.stroke();
        break;
      }
      case 'twinbuns': {
        for (const [bx, by] of [[-20, -110], [16, -112]]) {
          ell(ctx, bx, by, 11, 10); fillStroke(ctx, c);
          ctx.beginPath(); ctx.arc(bx, by, 7, Math.PI * 1.1, Math.PI * 1.7); ctx.strokeStyle = hl; ctx.lineWidth = 2; ctx.stroke();
          // 髮帶
          ell(ctx, bx + 2, by + 8, 5, 2.5); fillStroke(ctx, look.trim, '#2b1b0e', 1.2);
        }
        ctx.beginPath();
        ctx.moveTo(-25, -78);
        ctx.quadraticCurveTo(-28, -112, 2, -112);
        ctx.quadraticCurveTo(28, -110, 27, -82);
        ctx.lineTo(22, -90); ctx.lineTo(18, -84); ctx.lineTo(13, -92); ctx.lineTo(7, -86); ctx.lineTo(1, -93); ctx.lineTo(-5, -86); ctx.lineTo(-10, -92); ctx.lineTo(-16, -84);
        ctx.closePath();
        fillStroke(ctx, c);
        // 額飾
        ell(ctx, 6, -97, 3, 3.5); fillStroke(ctx, '#ffd36b', '#2b1b0e', 1.2);
        break;
      }
      case 'ponytail': {
        ctx.beginPath();
        ctx.moveTo(-25, -76);
        ctx.quadraticCurveTo(-30, -112, 2, -113);
        ctx.quadraticCurveTo(30, -110, 27, -80);
        ctx.quadraticCurveTo(22, -94, 8, -98);
        ctx.quadraticCurveTo(12, -90, 6, -84);
        ctx.quadraticCurveTo(0, -94, -12, -96);
        ctx.quadraticCurveTo(-16, -88, -18, -80);
        ctx.closePath();
        fillStroke(ctx, c);
        // 髮簪
        ctx.beginPath(); ctx.moveTo(-18, -112); ctx.lineTo(-2, -104);
        ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 4; ctx.stroke();
        ctx.strokeStyle = look.trim; ctx.lineWidth = 2.5; ctx.stroke();
        ell(ctx, -19, -113, 3.5, 3.5); fillStroke(ctx, '#ff6b6b', '#2b1b0e', 1.2);
        break;
      }
      case 'miao': {
        ctx.beginPath();
        ctx.moveTo(-26, -76);
        ctx.quadraticCurveTo(-28, -108, 2, -110);
        ctx.quadraticCurveTo(28, -108, 27, -78);
        ctx.lineTo(22, -88); ctx.lineTo(15, -90); ctx.lineTo(8, -88); ctx.lineTo(0, -91); ctx.lineTo(-8, -88); ctx.lineTo(-14, -90); ctx.lineTo(-20, -84);
        ctx.closePath();
        fillStroke(ctx, c);
        // 苗銀頭冠（牛角形）
        ctx.beginPath();
        ctx.moveTo(-22, -102);
        ctx.quadraticCurveTo(-44, -118, -36, -136);
        ctx.quadraticCurveTo(-30, -118, -8, -110);
        ctx.lineTo(10, -110);
        ctx.quadraticCurveTo(32, -118, 40, -136);
        ctx.quadraticCurveTo(44, -116, 24, -102);
        ctx.closePath();
        fillStroke(ctx, look.trim, '#4a4f58', 2);
        ctx.beginPath(); ctx.moveTo(-24, -101); ctx.quadraticCurveTo(1, -110, 26, -101);
        ctx.strokeStyle = '#4a4f58'; ctx.lineWidth = 6; ctx.stroke();
        ctx.strokeStyle = '#eef1f5'; ctx.lineWidth = 4; ctx.stroke();
        for (let k = -2; k <= 2; k++) {
          ell(ctx, 1 + k * 9, -97, 2, 3); fillStroke(ctx, '#eef1f5', '#4a4f58', 1);
        }
        ell(ctx, 1, -114, 4, 4); fillStroke(ctx, '#e74c3c', '#4a4f58', 1.2);
        break;
      }
      case 'topknot': {
        ell(ctx, -2, -118, 9, 8); fillStroke(ctx, c);
        ctx.beginPath(); ctx.rect(-8, -113, 12, 4); fillStroke(ctx, look.band, '#2b1b0e', 1.2);
        ctx.beginPath();
        ctx.moveTo(-25, -78);
        ctx.quadraticCurveTo(-28, -110, 2, -111);
        ctx.quadraticCurveTo(28, -110, 27, -80);
        ctx.quadraticCurveTo(20, -96, 6, -100);
        ctx.quadraticCurveTo(10, -92, 4, -88);
        ctx.quadraticCurveTo(-2, -96, -14, -96);
        ctx.quadraticCurveTo(-18, -88, -19, -80);
        ctx.closePath();
        fillStroke(ctx, c);
        break;
      }
      case 'furhat': {
        ctx.beginPath();
        ctx.moveTo(-24, -78); ctx.quadraticCurveTo(-26, -96, -10, -96);
        ctx.lineTo(-6, -88); ctx.lineTo(0, -95); ctx.lineTo(6, -87); ctx.lineTo(12, -95); ctx.lineTo(18, -88); ctx.lineTo(26, -80);
        ctx.quadraticCurveTo(28, -96, 20, -100); ctx.lineTo(-20, -100); ctx.closePath();
        fillStroke(ctx, c);
        // 帽頂
        ctx.beginPath();
        ctx.moveTo(-26, -100); ctx.quadraticCurveTo(-24, -132, 2, -134); ctx.quadraticCurveTo(28, -132, 30, -100); ctx.closePath();
        fillStroke(ctx, look.main);
        ctx.beginPath(); ctx.moveTo(2, -134); ctx.lineTo(2, -102); ctx.strokeStyle = look.trim; ctx.lineWidth = 3; ctx.stroke();
        // 毛邊
        ctx.beginPath();
        ctx.moveTo(-31, -96);
        for (let k = 0; k <= 10; k++) {
          const x = -31 + k * 6.4;
          ctx.quadraticCurveTo(x + 3.2, -108 - (k % 2) * 2, x + 6.4, -96);
        }
        ctx.lineTo(33, -92); ctx.quadraticCurveTo(2, -86, -31, -92); ctx.closePath();
        fillStroke(ctx, look.band, '#6b5a48', 1.8);
        // 羽毛
        ctx.beginPath(); ctx.moveTo(24, -112); ctx.quadraticCurveTo(40, -136, 34, -150); ctx.quadraticCurveTo(30, -132, 20, -114); ctx.closePath();
        fillStroke(ctx, look.trim, '#2b1b0e', 1.4);
        break;
      }
    }
  }

  function drawWeapon(ctx, look, hand, ang, pose, now) {
    const [hx, hy] = hand;
    const [dx, dy] = dir(ang);
    ctx.save();
    switch (look.weapon) {
      case 'sword':
      case 'talisman': {
        const blade = look.weapon === 'sword' ? '#e8f1ff' : '#ffe9a8';
        const len = 46;
        const tx = hx + dx * len, ty = hy + dy * len;
        if (pose.glow > 0) {
          ctx.shadowColor = look.aura; ctx.shadowBlur = 14 * pose.glow;
        }
        // 劍身
        const nx = -dy, ny = dx;
        ctx.beginPath();
        ctx.moveTo(hx + dx * 8 + nx * 3, hy + dy * 8 + ny * 3);
        ctx.lineTo(tx - dx * 6 + nx * 2.5, ty - dy * 6 + ny * 2.5);
        ctx.lineTo(tx, ty);
        ctx.lineTo(tx - dx * 6 - nx * 2.5, ty - dy * 6 - ny * 2.5);
        ctx.lineTo(hx + dx * 8 - nx * 3, hy + dy * 8 - ny * 3);
        ctx.closePath();
        fillStroke(ctx, blade, '#2b3a4a', 1.6);
        ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.moveTo(hx + dx * 10, hy + dy * 10); ctx.lineTo(tx - dx * 8, ty - dy * 8);
        ctx.strokeStyle = 'rgba(120,150,190,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        // 護手
        capsule(ctx, hx + dx * 7 + nx * 7, hy + dy * 7 + ny * 7, hx + dx * 7 - nx * 7, hy + dy * 7 - ny * 7, 3, look.trim);
        // 握柄
        capsule(ctx, hx - dx * 6, hy - dy * 6, hx + dx * 4, hy + dy * 4, 3.5, '#5a3520');
        // 劍穗
        const sx = hx - dx * 8, sy = hy - dy * 8;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx - 6, sy + 8 + Math.sin(now / 200) * 2, sx - 3, sy + 14);
        ctx.strokeStyle = look.band; ctx.lineWidth = 2; ctx.stroke();
        break;
      }
      case 'staff': {
        const top = 40, bottom = 28;
        const tx = hx + dx * top, ty = hy + dy * top, bx = hx - dx * bottom, by = hy - dy * bottom;
        capsule(ctx, bx, by, tx, ty, 4, '#9a6a3c');
        // 月牙杖頭
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(-ang + Math.PI);
        ctx.beginPath(); ctx.arc(0, -8, 10, Math.PI * 0.15, Math.PI * 0.85, true);
        ctx.arc(0, -4, 8, Math.PI * 0.85, Math.PI * 0.15, false);
        fillStroke(ctx, '#ffd36b', '#2b1b0e', 1.5);
        if (pose.glow > 0) { ctx.shadowColor = look.aura; ctx.shadowBlur = 18 * pose.glow; }
        ell(ctx, 0, -10, 4.5, 4.5); fillStroke(ctx, '#d58cff', '#2b1b0e', 1.2);
        ctx.restore();
        // 杖穗
        ctx.beginPath(); ctx.moveTo(tx - dx * 6, ty - dy * 6); ctx.quadraticCurveTo(tx - dx * 6 - 7, ty - dy * 6 + 10, tx - dx * 6 - 4 + Math.sin(now / 250) * 2, ty - dy * 6 + 18);
        ctx.strokeStyle = look.trim; ctx.lineWidth = 2.2; ctx.stroke();
        break;
      }
      case 'whip': {
        capsule(ctx, hx - dx * 4, hy - dy * 4, hx + dx * 10, hy + dy * 10, 4, '#5a3520');
        const sx = hx + dx * 10, sy = hy + dy * 10;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        if (pose.whip > 0.02) {
          const L = 60 + 50 * pose.whip;
          for (let k = 1; k <= 14; k++) {
            const s = k / 14;
            ctx.lineTo(sx + s * L, sy - 10 * pose.whip + Math.sin(s * 7 - now / 60) * 8 * (1 - s * 0.4) * pose.whip + s * s * 20);
          }
        } else {
          ctx.bezierCurveTo(sx + 14, sy + 6, sx + 10, sy + 22, sx - 2, sy + 18);
          ctx.bezierCurveTo(sx - 12, sy + 14, sx - 6, sy + 4, sx + 6, sy + 10);
          ctx.quadraticCurveTo(sx + 14, sy + 16, sx + 8, sy + 28);
        }
        ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 4.2; ctx.stroke();
        ctx.strokeStyle = '#e44c3c'; ctx.lineWidth = 2.4; ctx.stroke();
        break;
      }
      case 'bell': {
        // 手持銀鈴
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy + 6);
        ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.stroke();
        const swing = Math.sin(now / 180) * 0.25;
        ctx.save(); ctx.translate(hx, hy + 6); ctx.rotate(swing);
        if (pose.glow > 0) { ctx.shadowColor = look.aura; ctx.shadowBlur = 16 * pose.glow; }
        ctx.beginPath(); ctx.moveTo(-7, 12); ctx.quadraticCurveTo(-7, 0, 0, 0); ctx.quadraticCurveTo(7, 0, 7, 12); ctx.closePath();
        fillStroke(ctx, '#e9edf2', '#4a4f58', 1.6);
        ell(ctx, 0, 13, 2.5, 2.5); fillStroke(ctx, '#ffd36b', '#4a4f58', 1);
        ctx.restore();
        // 蠱蟲小綠光
        const bx = hx + 10 + Math.sin(now / 300) * 6, by = hy - 14 + Math.cos(now / 240) * 4;
        ctx.fillStyle = 'rgba(140,240,160,0.9)'; ell(ctx, bx, by, 2.5, 2); ctx.fill();
        break;
      }
      case 'bow': {
        // 弓直立於手前
        const pull = pose.bow || 0;
        const r = 30;
        ctx.save(); ctx.translate(hx + 3, hy);
        ctx.beginPath(); ctx.moveTo(-4, -r); ctx.quadraticCurveTo(16, 0, -4, r);
        ctx.strokeStyle = '#2b1b0e'; ctx.lineWidth = 5.5; ctx.stroke();
        ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-4, -r); ctx.lineTo(-4 - 22 * pull, 0); ctx.lineTo(-4, r);
        ctx.strokeStyle = '#f5f0e6'; ctx.lineWidth = 1.2; ctx.stroke();
        if (pull > 0.05) {
          ctx.beginPath(); ctx.moveTo(-4 - 22 * pull, 0); ctx.lineTo(26, 0);
          ctx.strokeStyle = '#5a3520'; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(24, -3); ctx.lineTo(24, 3); ctx.closePath(); ctx.fillStyle = '#c9d3dd'; ctx.fill();
        }
        ctx.restore();
        break;
      }
    }
    ctx.restore();
  }

  function drawExtrasBack(ctx, look) {
    if (look.weapon === 'bow') {
      // 箭筒
      ctx.save(); ctx.translate(-14, -56); ctx.rotate(-0.5);
      ctx.beginPath(); ctx.rect(-5, -14, 10, 26); fillStroke(ctx, '#7a4b22', '#2b1b0e', 1.6);
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath(); ctx.moveTo(k * 3, -14); ctx.lineTo(k * 3, -22);
        ctx.strokeStyle = '#e07b39'; ctx.lineWidth = 2.5; ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---------- 主繪製 ----------
  // facing: 1 向右，-1 向左。scale: 單位→像素
  function drawFighter(ctx, look, pose, x, y, scale, facing, now) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * facing, scale);
    ctx.globalAlpha = pose.alpha;

    // 影子
    ctx.save();
    ctx.globalAlpha *= 0.28;
    ell(ctx, pose.x, 1, pose.rot ? 44 : 26 - Math.min(10, -pose.y * 0.4), 5);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.restore();

    ctx.translate(pose.x, pose.y);
    // 以身體中段為支點旋轉（倒地時整個人留在畫面內）
    ctx.translate(0, -45); ctx.rotate(pose.rot); ctx.translate(0, 45);

    // 靈氣
    if (pose.glow > 0.01) {
      ctx.save();
      const g = ctx.createRadialGradient(0, -60, 10, 0, -60, 80);
      g.addColorStop(0, hexA(look.aura, 0.55 * pose.glow));
      g.addColorStop(1, hexA(look.aura, 0));
      ctx.fillStyle = g; ell(ctx, 0, -60, 80, 80); ctx.fill();
      ctx.restore();
    }

    const hipY = -22;
    // 後手
    ctx.save();
    ctx.translate(0, hipY); ctx.rotate(pose.lean); ctx.translate(0, -hipY);
    drawExtrasBack(ctx, look);
    const backHand = drawArm(ctx, look, -6, -57, pose.armB, false);
    if (look.weapon === 'talisman') drawTalisman(ctx, backHand, now);
    ctx.restore();

    drawLeg(ctx, look, -5, pose.legB, false);

    ctx.save();
    ctx.translate(0, hipY); ctx.rotate(pose.lean); ctx.translate(0, -hipY);
    ctx.save();
    ctx.translate(0, -62); ctx.rotate(pose.head); ctx.translate(0, 62);
    drawHairBack(ctx, look, now);
    ctx.restore();
    drawTorso(ctx, look);
    ctx.restore();

    drawLeg(ctx, look, 5, pose.legF, true);

    ctx.save();
    ctx.translate(0, hipY); ctx.rotate(pose.lean); ctx.translate(0, -hipY);
    ctx.save();
    ctx.translate(0, -62); ctx.rotate(pose.head); ctx.translate(0, 62);
    drawFace(ctx, look, pose);
    drawHairFront(ctx, look, now);
    ctx.restore();
    // 前手與武器
    const sx = 6, sy = -57;
    const [adx, ady] = dir(pose.armF);
    const hand = [sx + adx * 21, sy + ady * 21];
    const wAng = pose.wAbs !== null ? pose.wAbs : pose.armF + pose.wOff;
    if (!pose.wDrop) {
      drawWeapon(ctx, look, hand, wAng, pose, now);
    }
    drawArm(ctx, look, sx, sy, pose.armF, true);
    ctx.restore();

    // 受擊閃白/紅
    ctx.restore();
    if (pose.flash > 0) {
      // 在人物外框上疊加：用 source-atop 需要離屏，這裡以半透明光暈呈現
      ctx.save();
      ctx.translate(x + pose.x * scale * facing, y + pose.y * scale);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, -60 * scale, 5, 0, -60 * scale, 70 * scale);
      g.addColorStop(0, `rgba(255,80,60,${0.55 * pose.flash})`);
      g.addColorStop(1, 'rgba(255,80,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -60 * scale, 70 * scale, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function drawTalisman(ctx, hand, now) {
    const [hx, hy] = hand;
    ctx.save(); ctx.translate(hx, hy - 4); ctx.rotate(Math.sin(now / 300) * 0.1);
    ctx.beginPath(); ctx.rect(-5, -16, 10, 18); fillStroke(ctx, '#ffe066', '#8a5a00', 1.2);
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 0); ctx.moveTo(-3, -10); ctx.lineTo(3, -10); ctx.moveTo(-3, -5); ctx.lineTo(3, -4); ctx.stroke();
    ctx.restore();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // 人物肖像（選角卡片用）
  function drawPortrait(canvas, look, now, anim) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const scale = h / 165;
    drawFighter(ctx, look, poseFor(look, anim, now), w / 2 - 4 * scale, h - 8 * scale, scale, 1, now);
  }

  window.Sprites = { drawFighter, poseFor, drawPortrait, hexA, shade };
})();
