// 手機端主程式
(function () {
  const { CHARACTERS, STAT_LABELS, byId } = window.GameData;
  const $ = s => document.querySelector(s);
  const TYPE_LABEL = { atk: '攻擊', multi: '連擊', heal: '回復', drain: '吸血', dot: '持續', buff: '增益', debuff: '減益' };
  const STAT_MAX = { hp: 1100, wu: 80, spi: 80, spd: 80, luck: 80, def: 80 };

  // ---------- 狀態 ----------
  const S = {
    room: null, slot: -1, info: null,
    pick: null, battle: null, state: null,
    timeOffset: 0, gaugeFull: false,
    speechLockUntil: 0, tapMode: false, resultShown: false
  };

  let pid = null;
  try { pid = localStorage.getItem('vf-pid'); } catch (e) { /* 私密模式 */ }
  if (!pid) {
    pid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('vf-pid', pid); } catch (e) { /* ignore */ }
  }

  const socket = io({ transports: ['websocket', 'polling'] });
  const scene = new BattleScene($('#scene'));
  const board = new BoardView($('#board'));
  const voice = new Voice({ onResult: onVoiceResult, onState: onVoiceState });

  // ---------- 畫面切換 ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    if (id === 'battle') {
      requestAnimationFrame(() => { scene.resize(); board.layout(); });
      scene.start();
    } else {
      scene.stop();
      voice.release();
    }
    if (id === 'lobby') startPortraits(); else stopPortraits();
  }

  let toastTimer = 0;
  function toast(msg, ms = 1600) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignore */ } }

  // ---------- 加入房間 ----------
  const params = new URLSearchParams(location.search);
  S.room = params.get('room');
  if (S.room) $('#roomInput').value = S.room;

  $('#joinForm').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('#roomInput').value.trim();
    if (!/^\d{4}$/.test(code)) { $('#joinMsg').textContent = '請輸入 4 位數房間號碼'; return; }
    S.room = code;
    history.replaceState(null, '', '/play?room=' + code);
    socket.emit('join', { room: code, pid });
  });

  socket.on('connect', () => {
    if (S.room) socket.emit('join', { room: S.room, pid });
    else show('join');
  });
  socket.on('disconnect', () => toast('連線中斷，重新連線中…', 3000));

  socket.on('joinError', d => {
    $('#joinMsg').textContent = d.reason;
    show('join');
  });
  socket.on('kicked', d => { toast(d.reason, 3000); S.room = null; show('join'); });
  socket.on('notice', d => toast(d.msg, 2500));

  socket.on('joined', d => {
    S.slot = d.slot;
    $('#lbRoom').textContent = d.room;
    const tag = $('#lbSide');
    tag.textContent = d.slot === 0 ? '你在左方（先進房）' : '你在右方（後進房）';
    tag.className = 'side-tag s' + d.slot;
  });

  socket.on('room', info => {
    S.info = info;
    S.timeOffset = info.serverNow - Date.now();
    const me = info.players[S.slot];
    if (me && me.charId && !S.pick) S.pick = me.charId;
    if (info.phase === 'lobby') {
      S.battle = null;
      hideResult();
      renderLobby();
      if (!$('#lobby').classList.contains('active')) show('lobby');
    } else if (info.phase === 'over') {
      setTimeout(showResult, 1600);
    }
  });

  // ---------- 選角 ----------
  const portraits = [];
  let portraitRaf = 0;

  function buildGrid() {
    const grid = $('#charGrid');
    grid.innerHTML = '';
    CHARACTERS.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'char-card';
      card.dataset.id = ch.id;
      card.innerHTML = `<canvas width="180" height="190"></canvas><div class="nm">${ch.name}</div><div class="tt">${ch.title}</div>`;
      card.addEventListener('click', () => {
        if (!S.info || S.info.phase !== 'lobby') return;
        S.pick = ch.id;
        portraitAnim[ch.id] = { name: 'select', start: performance.now(), dur: 600 };
        socket.emit('pick', { charId: ch.id });
        renderLobby();
      });
      grid.appendChild(card);
      portraits.push({ canvas: card.querySelector('canvas'), ch });
    });
  }
  const portraitAnim = {};

  function startPortraits() {
    if (portraitRaf) return;
    const loop = now => {
      portraits.forEach(p => Sprites.drawPortrait(p.canvas, p.ch.look, now, portraitAnim[p.ch.id]));
      const big = $('#detailCanvas');
      if (big && S.pick) Sprites.drawPortrait(big, byId[S.pick].look, now, portraitAnim[S.pick]);
      portraitRaf = requestAnimationFrame(loop);
    };
    portraitRaf = requestAnimationFrame(loop);
  }
  function stopPortraits() { cancelAnimationFrame(portraitRaf); portraitRaf = 0; }

  let detailFor = null;
  function renderLobby() {
    const info = S.info;
    if (!info) return;
    const me = info.players[S.slot];
    const opp = info.players[1 - S.slot];
    // 對手狀態
    const oppEl = $('#opponent');
    if (!opp) oppEl.innerHTML = '⏳ 等待對手加入房間…';
    else if (!opp.connected) oppEl.innerHTML = '⚠️ 對手連線中斷，等待重新連線…';
    else if (!opp.charId) oppEl.innerHTML = '對手已加入，正在選擇角色…';
    else oppEl.innerHTML = `對手選擇了 <b>${byId[opp.charId].name}</b> ${opp.ready ? '<span class="ok">✓ 已準備</span>' : '（選擇中）'}`;

    document.querySelectorAll('.char-card').forEach(card => {
      card.classList.toggle('sel', card.dataset.id === S.pick);
      let badge = card.querySelector('.opp-pick');
      if (opp && opp.charId === card.dataset.id) {
        if (!badge) { badge = document.createElement('span'); card.appendChild(badge); }
        badge.className = 'opp-pick s' + (1 - S.slot);
        badge.textContent = '對手';
      } else if (badge) badge.remove();
    });

    if (S.pick && detailFor !== S.pick) {
      detailFor = S.pick;
      const ch = byId[S.pick];
      $('#charDetail').innerHTML = `
        <div style="display:flex;gap:10px;align-items:center">
          <canvas id="detailCanvas" width="200" height="210" style="width:100px;height:105px;flex:none"></canvas>
          <div style="flex:1">
            <h3>${ch.name}<small>${ch.title}</small></h3>
            <div class="origin">${ch.origin}</div>
            ${Object.keys(STAT_LABELS).map(k => `
              <div class="stat-row"><span>${STAT_LABELS[k]}</span>
                <span class="track"><i style="width:${Math.min(100, ch.stats[k] / STAT_MAX[k] * 100)}%"></i></span>
                <span class="v">${ch.stats[k]}</span></div>`).join('')}
          </div>
        </div>
        <ul class="moves-mini">${ch.moves.map(m => `<li><span class="tag ${m.type}">${TYPE_LABEL[m.type]}</span><b>${m.name}</b><span>${m.desc}</span></li>`).join('')}</ul>`;
    }

    const btn = $('#readyBtn');
    if (!S.pick) { btn.disabled = true; btn.textContent = '請先選擇角色'; btn.classList.remove('ready'); }
    else {
      btn.disabled = false;
      const ready = me && me.ready;
      btn.classList.toggle('ready', !!ready);
      btn.textContent = ready ? (opp && opp.ready ? '開戰！' : '✓ 已準備（等待對手）') : '準備！';
    }
  }

  $('#readyBtn').addEventListener('click', () => {
    const me = S.info && S.info.players[S.slot];
    if (!me || !S.pick) return;
    if (me.charId !== S.pick) socket.emit('pick', { charId: S.pick });
    socket.emit('ready', { ready: !me.ready });
    unlockAudio();
  });

  // ---------- 對戰 ----------
  socket.on('battle', b => {
    S.battle = b;
    S.state = b.state;
    S.timeOffset = b.serverNow - Date.now();
    S.gaugeFull = false;
    S.resultShown = false;
    hideResult();
    const chars = b.chars.map(id => byId[id]);
    scene.setFighters(chars);
    buildHud(chars);
    show('battle');
    board.setBoard(b.board);
    $('#adjHint').textContent = b.board.diagonal ? '相連（上下左右或斜角，可以轉彎）' : '上下左右相連（可以轉彎）';
    renderState(b.state);
    setTapMode(S.tapMode || !voice.supported);
    runCountdown(b.countdownEnd);
  });

  let cdTimer = 0;
  function runCountdown(end) {
    const cd = $('#countdown');
    const cover = $('#boardCover');
    clearInterval(cdTimer);
    const tick = () => {
      const left = end - (Date.now() + S.timeOffset);
      if (left > 0) {
        const n = String(Math.ceil(left / 1000));
        cover.classList.remove('hide');
        cover.querySelector('span').textContent = '準備中…';
        if (cd.textContent !== n) { cd.textContent = n; cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop'); }
      } else {
        clearInterval(cdTimer);
        cd.textContent = '開戰！'; cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
        cover.classList.add('hide');
        setTimeout(() => { if (cd.textContent === '開戰！') cd.textContent = ''; }, 900);
        setSpeech(voice.supported && !S.tapMode ? '集氣滿後，按住 🎤 念出招式！' : '點選相連方塊組成招式，再點一次最後一格出招', '');
      }
    };
    if (end - (Date.now() + S.timeOffset) <= 0) { cover.classList.add('hide'); cd.textContent = ''; return; }
    tick();
    cdTimer = setInterval(tick, 100);
  }

  function buildHud(chars) {
    chars.forEach((ch, i) => {
      $('#hud' + i).innerHTML = `
        <div class="hud-name"><span>${ch.name}</span>${i === S.slot ? '<em class="you">你</em>' : ''}</div>
        <div class="bar hp"><b class="lag"></b><i></i><span></span></div>
        <div class="bar gauge"><i></i></div>
        <div class="buffs"></div>`;
    });
  }

  function renderState(st) {
    if (!st) return;
    S.state = st;
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
      g.querySelector('i').style.width = (f.gauge / S.battle.gaugeMax * 100) + '%';
      g.classList.toggle('full', f.gauge >= S.battle.gaugeMax);
      const statName = s => s === 'atk' ? '攻' : s === 'def' ? '防' : '速';
      hud.querySelector('.buffs').innerHTML =
        f.buffs.map(b => `<span class="${b.amount > 0 ? 'up' : 'down'}">${statName(b.stat)}${b.amount > 0 ? '↑' : '↓'}${Math.ceil(b.left / 1000)}</span>`).join('') +
        f.dots.map(d => `<span class="dot">毒${Math.ceil(d.left / 1000)}</span>`).join('');
    });
    const me = st.f[S.slot];
    if (!me) return;
    const full = me.gauge >= S.battle.gaugeMax;
    if (full && !S.gaugeFull) vibrate(60);
    S.gaugeFull = full;
    const mic = $('#micBtn');
    mic.classList.toggle('full', full && !S.tapMode);
    $('#micRing').style.width = (me.gauge / S.battle.gaugeMax * 100) + '%';
    if (!voice.active) $('#micLabel').textContent = micIdleLabel(full);
    $('#resetLeft').textContent = me.resets;
    if (!$('#movesModal').classList.contains('hidden')) renderMoves();
  }

  function micIdleLabel(full) {
    if (S.tapMode) return board.selection.length ? '出招：' + board.selectedWord() : '點選方塊';
    return full ? '集氣滿！按住念' : '按住念招式';
  }

  socket.on('state', st => { if (S.battle) renderState(st); });

  socket.on('normal', ev => scene.onNormal(ev));
  socket.on('skill', ev => {
    scene.onSkill(ev);
    board.playRemoval(ev.pathIds, ev.board, ev.slot);
    if (ev.slot === S.slot) vibrate([30, 40, 30]);
  });
  socket.on('hit', ev => {
    scene.onHit(ev);
    if (ev.dst === S.slot && (ev.kind === 'dmg' || ev.kind === 'dot') && ev.src !== S.slot) vibrate(25);
  });
  socket.on('reset', ev => {
    board.reshuffle(ev.board);
    toast((ev.slot === S.slot ? '你' : '對手') + '使用了「重置」，盤面重新洗牌！');
  });
  socket.on('ko', ev => {
    scene.onKO(ev);
    voice.release();
    vibrate(ev.winner === S.slot ? [50, 50, 50] : 300);
  });

  // ---------- 結果 ----------
  function showResult() {
    if (!S.info || S.info.phase !== 'over' || S.resultShown) return;
    S.resultShown = true;
    const win = S.info.winner === S.slot;
    const t = $('#resultTitle');
    t.textContent = win ? '勝利！' : '落敗…';
    t.classList.toggle('lose', !win);
    const chars = S.battle ? S.battle.chars.map(id => byId[id].name) : [];
    $('#resultSub').textContent = chars.length ? `${chars[S.info.winner]} 贏得了這場對決` : '';
    const btn = $('#rematchBtn');
    btn.disabled = false; btn.textContent = '再來一局';
    $('#resultModal').classList.remove('hidden');
  }
  function hideResult() { $('#resultModal').classList.add('hidden'); }
  $('#rematchBtn').addEventListener('click', () => {
    socket.emit('rematch');
    const btn = $('#rematchBtn');
    btn.disabled = true; btn.textContent = '等待對手…';
  });

  // ---------- 語音 ----------
  function setSpeech(html, cls) {
    const el = $('#speechText');
    el.className = cls || '';
    el.innerHTML = html;
  }

  function onVoiceState(state, msg) {
    const mic = $('#micBtn');
    mic.classList.toggle('listening', state === 'listening');
    if (state === 'listening') {
      $('#micLabel').textContent = '聆聽中…';
      setSpeech('🎤 請念出招式名稱…' + (voice.usingPipe ? '（降噪中）' : ''), 'listen');
      meterLoop();
    }
    else {
      $('#micLabel').textContent = micIdleLabel(S.gaugeFull);
      if (state === 'error') setSpeech(msg, 'bad');
    }
  }

  // 收音時在麥克風按鈕上顯示音量；綠色代表噪音閘判定為人聲
  function meterLoop() {
    const el = $('#micLevel'), btn = $('#micBtn');
    const tick = () => {
      if (!voice.active) { el.style.transform = 'scaleY(0)'; btn.classList.remove('voice'); return; }
      el.style.transform = `scaleY(${voice.level().toFixed(3)})`;
      btn.classList.toggle('voice', voice.usingPipe && voice.pipe.isVoice());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function renderDenoise() {
    $('#denoiseToggle').checked = voice.denoise;
    $('#denoiseNote').textContent = !voice.supported ? '' :
      voice.trackSupport === false ? '此瀏覽器不支援降噪管線，使用系統預設收音' :
      voice.trackSupport === true ? (voice.denoise ? '降噪已啟用' : '') : '第一次收音時會自動偵測是否支援';
  }
  $('#denoiseToggle').addEventListener('change', e => { voice.setDenoise(e.target.checked); renderDenoise(); });

  function onVoiceResult(alts, isFinal) {
    if (Date.now() < S.speechLockUntil) return;
    const heard = alts[0];
    setSpeech(`聽到：<span class="heard">「${escapeHtml(heard)}」</span>`, '');
    if (!isFinal && heard.replace(/\s/g, '').length < 2) return;
    socket.emit('speech', { alts, interim: !isFinal });
  }

  socket.on('speechResult', r => {
    if (r.ok) {
      S.speechLockUntil = Date.now() + 900;
      voice.abort();
      setSpeech(`<span class="ok">✓ ${escapeHtml(r.word)}！</span>`, '');
    } else if (Date.now() >= S.speechLockUntil) {
      setSpeech(`聽到「${escapeHtml(r.heard || '')}」 <span class="bad">✗ ${escapeHtml(r.msg || '')}</span>`, '');
      if (r.word) vibrate(80);
    }
  });

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // 麥克風按鈕：按住說話、放開送出；輕點則自動在說完後結束
  let micDownAt = 0;
  const mic = $('#micBtn');
  mic.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (S.tapMode) { board.submit(); return; }
    if (!voice.supported) { toast('此瀏覽器不支援語音辨識，請改用手動點選'); return; }
    if (voice.active) { voice.stop(); return; }
    micDownAt = Date.now();
    S.speechLockUntil = 0;
    voice.start();
  });
  const micUp = () => {
    if (S.tapMode || !micDownAt) return;
    const held = Date.now() - micDownAt;
    micDownAt = 0;
    if (held > 400) voice.stop();
  };
  mic.addEventListener('pointerup', micUp);
  mic.addEventListener('pointercancel', micUp);
  mic.addEventListener('contextmenu', e => e.preventDefault());

  // 普攻
  let atkReadyAt = 0;
  $('#atkBtn').addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!S.battle) return;
    const now = Date.now();
    if (now < atkReadyAt) return;
    atkReadyAt = now + S.battle.normalCd;
    socket.emit('attack');
    const cd = $('#atkCd');
    cd.style.transition = 'none'; cd.style.width = '100%';
    void cd.offsetWidth;
    cd.style.transition = `width ${S.battle.normalCd}ms linear`; cd.style.width = '0%';
  });

  // ---------- 招式表 ----------
  function renderMoves() {
    const me = S.battle && byId[S.battle.chars[S.slot]];
    if (!me) return;
    const avail = (S.state && S.state.f[S.slot] && S.state.f[S.slot].avail) || [];
    $('#movesList').innerHTML = me.moves.map(m => {
      const on = avail.includes(m.name);
      return `<li class="${on ? 'on' : ''}"><span class="mn">${m.name}</span><span class="st">${on ? '✓ 盤面上有' : '—'}</span>
        <span class="ds"><span class="tag ${m.type}">${TYPE_LABEL[m.type]}</span>${m.desc}</span></li>`;
    }).join('');
    $('#statsBox').innerHTML = Object.keys(STAT_LABELS).map(k => `<div>${STAT_LABELS[k]}<b>${me.stats[k]}</b></div>`).join('');
  }
  $('#movesBtn').addEventListener('click', () => { renderMoves(); renderDenoise(); $('#movesModal').classList.remove('hidden'); });
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => {
    if (e.target === m || e.target.hasAttribute('data-close')) m.classList.add('hidden');
  }));

  // ---------- 手動點選模式 ----------
  function setTapMode(on) {
    S.tapMode = on;
    $('#tapToggle').checked = on;
    $('#tapResetBtn').classList.toggle('hidden', !on);
    board.setTapMode(on);
    $('#micBtn').classList.toggle('tapmode', on);
    $('#micBtn b').textContent = on ? '👆' : '🎤';
    $('#micLabel').textContent = micIdleLabel(S.gaugeFull);
  }
  $('#tapToggle').addEventListener('change', e => setTapMode(e.target.checked));
  $('#tapResetBtn').addEventListener('click', () => { socket.emit('tapReset'); $('#movesModal').classList.add('hidden'); });
  board.onSubmit = path => socket.emit('tapMove', { path });
  board.onSelect = word => {
    if (!S.tapMode) return;
    $('#micLabel').textContent = micIdleLabel(S.gaugeFull);
    if (word) setSpeech(`選取：<span class="heard">${escapeHtml(word)}</span>（再點最後一格或按 👆 出招）`, '');
  };

  // iOS 需要使用者互動後才能播放震動/音效，這裡順便預熱語音權限
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    if (voice.supported && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
    }
  }

  // ---------- 初始化 ----------
  buildGrid();
  if (!S.room) show('join');
  if (!voice.supported) {
    console.warn('SpeechRecognition 不可用', { secure: window.isSecureContext });
  }
  window.__vf = { S, scene, board, socket, voice }; // 除錯用
})();
