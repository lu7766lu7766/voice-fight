// 電腦端首頁：顯示房間號碼與 QR Code
(function () {
  const $ = s => document.querySelector(s);
  const { byId } = window.GameData;
  const socket = io();
  let code = null;
  try { code = sessionStorage.getItem('vf-host-room'); } catch (e) { /* ignore */ }
  let players = [null, null];
  let phase = 'lobby';
  let winner = -1;

  socket.on('connect', () => socket.emit('host:create', { code }));

  socket.on('host:room', d => {
    code = d.code;
    try { sessionStorage.setItem('vf-host-room', code); } catch (e) { /* ignore */ }
    $('#code').textContent = d.code;
    $('#qr').src = d.qr;
    $('#url').textContent = d.url;
    const via = { ngrok: '（透過 ngrok）', PUBLIC_URL: '（公開網址）', origin: '', lan: '（區網直連・首次需略過憑證警告）' }[d.via] || '';
    $('#alts').textContent = via + (d.alternatives.length ? '  其他網路位址：' + d.alternatives.join('  ') : '');
    renderRoom(d.room);
  });

  socket.on('room', renderRoom);

  function renderRoom(info) {
    if (!info || info.code !== code) return;
    players = info.players;
    phase = info.phase;
    winner = info.winner;
    if (phase === 'lobby') showLive(false);
    else if (phase === 'over') setTimeout(showResult, 1600);
    if (live) renderMoves();
    const phaseText = { lobby: '', countdown: '・即將開戰', battle: '・對戰中', over: '・對戰結束' }[phase];
    players.forEach((p, i) => {
      const slot = $('#slot' + i);
      const side = i === 0 ? '左方' : '右方';
      slot.classList.toggle('on', !!p);
      let st = `${side}：等待玩家…`;
      if (p) {
        if (!p.connected) st = `${side}：連線中斷`;
        else if (!p.charId) st = `${side}：選擇角色中`;
        else st = `${side}：${p.bot ? '電腦・' : ''}${byId[p.charId].name} ✓${phaseText}`;
      }
      slot.querySelector('.st').textContent = st;
    });
  }

  $('#newRoom').addEventListener('click', () => socket.emit('host:new'));

  // ---------- 直播畫面 ----------
  const TYPE_LABEL = { atk: '攻擊', multi: '連擊', heal: '回復', drain: '吸血', dot: '持續', buff: '增益', debuff: '減益' };
  const SIDE = ['左方', '右方'];
  const scene = new BattleScene($('#scene'));
  const board = new BoardView($('#board'));
  let live = false, battle = null, state = null, timeOffset = 0, cdTimer = 0, resultShown = false;

  function showLive(on) {
    if (on === live) return;
    live = on;
    $('#live').classList.toggle('hidden', !on);
    $('.host-wrap').classList.toggle('hidden', on);
    if (on) {
      requestAnimationFrame(() => { scene.resize(); board.layout(); });
      scene.start();
    } else {
      scene.stop();
      battle = null;
      clearInterval(cdTimer);
      hideResult();
    }
  }

  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), ms);
  }

  socket.on('battle', b => {
    battle = b;
    timeOffset = b.serverNow - Date.now();
    resultShown = false;
    hideResult();
    $('#liveRoom').textContent = code;
    showLive(true);
    const chars = b.chars.map(id => byId[id]);
    scene.setFighters(chars);
    buildHud(chars);
    applySideColors(chars);
    renderState(b.state);
    if (b.board) {
      // 對戰中才打開電腦畫面：直接顯示目前盤面
      clearInterval(cdTimer);
      board.setBoard(b.board);
      $('#boardCover').classList.add('hide');
    } else {
      board.clear();
      runCountdown(b.countdownEnd);
    }
  });

  socket.on('begin', d => {
    if (!battle) return;
    clearInterval(cdTimer);
    $('#boardCover').classList.add('hide');
    const cd = $('#countdown');
    cd.textContent = '開戰！'; cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
    setTimeout(() => { if (cd.textContent === '開戰！') cd.textContent = ''; }, 900);
    board.dropIn(d.board);
    renderState(d.state);
  });

  function runCountdown(end) {
    const num = $('#cdNum');
    $('#boardCover').classList.remove('hide');
    $('#countdown').textContent = '';
    clearInterval(cdTimer);
    const tick = () => {
      const left = end - (Date.now() + timeOffset);
      const n = String(Math.max(0, Math.ceil(left / 1000)));
      if (num.textContent !== n) { num.textContent = n; num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop'); }
      if (left <= 0) clearInterval(cdTimer);
    };
    tick();
    cdTimer = setInterval(tick, 100);
  }

  socket.on('state', st => { if (battle) renderState(st); });
  socket.on('skill', ev => {
    if (!battle) return;
    scene.onSkill(ev);
    board.playRemoval(ev.pathIds, ev.board, ev.slot, ev.weatheredIds);
  });
  socket.on('hit', ev => { if (battle) scene.onHit(ev); });
  socket.on('reset', ev => {
    if (!battle) return;
    board.reshuffle(ev.board);
    toast(`${SIDE[ev.slot]} ${byId[battle.chars[ev.slot]].name} 使用了「重置」，盤面重新洗牌！`);
  });
  socket.on('ko', ev => { if (battle) scene.onKO(ev); });
  socket.on('notice', d => { if (live) toast(d.msg); });

  function buildHud(chars) {
    chars.forEach((ch, i) => {
      const p = players[i];
      $('#hud' + i).innerHTML = `
        <div class="hud-name"><span>${ch.name}</span><em class="you">${p && p.bot ? '電腦' : SIDE[i]}</em></div>
        <div class="bar hp"><b class="lag"></b><i></i><span></span></div>
        <div class="bar gauge"><i></i></div>
        <div class="buffs"></div>`;
    });
  }

  function renderState(st) {
    if (!st) return;
    state = st;
    scene.setStatus(st);
    st.f.forEach((f, i) => {
      const hud = $('#hud' + i);
      if (!hud.firstElementChild) return;
      const pct = f.hp / f.maxHp * 100;
      const hp = hud.querySelector('.bar.hp');
      hp.querySelector('i').style.width = pct + '%';
      hp.querySelector('.lag').style.width = pct + '%';
      hp.querySelector('span').textContent = `${f.hp} / ${f.maxHp}`;
      hp.classList.toggle('mid', pct <= 50 && pct > 25);
      hp.classList.toggle('low', pct <= 25);
      const g = hud.querySelector('.bar.gauge');
      g.querySelector('i').style.width = (f.gauge / battle.gaugeMax * 100) + '%';
      g.classList.toggle('full', f.gauge >= battle.gaugeMax);
      const statName = s => s === 'atk' ? '攻' : s === 'def' ? '防' : '速';
      hud.querySelector('.buffs').innerHTML =
        f.buffs.map(b => `<span class="${b.amount > 0 ? 'up' : 'down'}">${statName(b.stat)}${b.amount > 0 ? '↑' : '↓'}${Math.ceil(b.left / 1000)}</span>`).join('') +
        f.dots.map(d => `<span class="dot">毒${Math.ceil(d.left / 1000)}</span>`).join('');
    });
    renderMoves();
  }

  // 雙方招式表：盤面上拼得出的招式會亮起
  function renderMoves() {
    if (!battle) return;
    battle.chars.forEach((id, i) => {
      const ch = byId[id];
      const avail = (state && state.f[i] && state.f[i].avail) || [];
      const html = `<li class="lm-head">${SIDE[i]}・${ch.name}</li>` + ch.moves.map(m =>
        `<li class="${avail.includes(m.name) ? 'on' : ''}"><b>${m.name}</b><span class="tag ${m.type}">${TYPE_LABEL[m.type]}</span></li>`).join('');
      const el = $('#lm' + i);
      if (el.innerHTML !== html) el.innerHTML = html;
    });
  }

  // 盤面上色：左方招式的字染藍、右方染紅，兩邊都有的字一半一半
  function applySideColors(chars) {
    const colors = new Map();
    chars.forEach((ch, i) => {
      for (const m of ch.moves) for (const c of m.name) {
        const list = colors.get(c) || [];
        if (!list.includes(SIDE_COLORS[i])) list.push(SIDE_COLORS[i]);
        colors.set(c, list);
      }
    });
    board.setCharColors(colors);
  }

  function showResult() {
    if (!live || !battle || phase !== 'over' || resultShown || winner < 0) return;
    resultShown = true;
    const w = winner;
    $('#liveWinner').textContent = `${byId[battle.chars[w]].name} 獲勝！`;
    $('#liveSub').textContent = `${SIDE[w]}贏得了這場對決`;
    $('#liveResult').classList.remove('hidden');
  }
  function hideResult() { $('#liveResult').classList.add('hidden'); }

  // 已選角色的小動畫
  function loop(now) {
    if (live) return requestAnimationFrame(loop);
    players.forEach((p, i) => {
      const cv = document.querySelector(`#slot${i} canvas`);
      const ctx = cv.getContext('2d');
      if (p && p.charId) Sprites.drawPortrait(cv, byId[p.charId].look, now, null);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    });
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
