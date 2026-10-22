// 手機端主程式
(function () {
  const { CHARACTERS, STAT_LABELS, byId } = window.GameData;
  const $ = s => document.querySelector(s);
  const TYPE_LABEL = { atk: '攻擊', multi: '連擊', heal: '回復', drain: '吸血', dot: '持續', buff: '增益', debuff: '減益' };
  const STAT_MAX = { hp: 1100, spi: 80, spd: 80, luck: 80, def: 80 };

  // ---------- 防止畫面縮放 ----------
  // iOS Safari 不理會 viewport 的 user-scalable=no，要自己擋雙指縮放和點兩下放大
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouchEnd < 350 && !e.target.closest('input, textarea, select')) {
      e.preventDefault();          // 擋掉第二下觸發的放大
      e.target.click();            // 但點擊照常生效（快速連點按鈕不會被吃掉）
    }
    lastTouchEnd = now;
  }, { passive: false });

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
  });

  socket.on('room', info => {
    S.info = info;
    S.timeOffset = info.serverNow - Date.now();
    const me = info.players[S.slot];
    S.pick = me ? me.charId : null; // 已送出的角色，以伺服器為準（再戰時會清空重選）
    if (!S.preview && S.pick) S.preview = S.pick;
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
        // 點選只是查看能力，按「確定」才送出；已確定後改點別的角色，就取消原本的確定
        if (S.pick && ch.id !== S.pick) socket.emit('unpick');
        S.preview = ch.id;
        portraitAnim[ch.id] = { name: 'select', start: performance.now(), dur: 600 };
        renderLobby();
        requestAnimationFrame(() => $('#charDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
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
      if (big && S.preview) Sprites.drawPortrait(big, byId[S.preview].look, now, portraitAnim[S.preview]);
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
    else oppEl.innerHTML = `對手選擇了 <b>${byId[opp.charId].name}</b> <span class="ok">✓</span>`;

    document.querySelectorAll('.char-card').forEach(card => {
      card.classList.toggle('sel', card.dataset.id === S.preview);
      let mine = card.querySelector('.mine');
      if (card.dataset.id === S.pick) {
        if (!mine) { mine = document.createElement('span'); mine.className = 'mine'; mine.textContent = '已確定'; card.appendChild(mine); }
      } else if (mine) mine.remove();
      let badge = card.querySelector('.opp-pick');
      if (opp && opp.charId === card.dataset.id) {
        if (!badge) { badge = document.createElement('span'); card.appendChild(badge); }
        badge.className = 'opp-pick s' + (1 - S.slot);
        badge.textContent = '對手';
      } else if (badge) badge.remove();
    });

    if (S.preview && detailFor !== S.preview) {
      detailFor = S.preview;
      const ch = byId[S.preview];
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
        <ul class="moves-mini">${ch.moves.map(m => `<li><span class="tag ${m.type}">${TYPE_LABEL[m.type]}</span><b><i class="chip" style="background:${m.color}"></i>${m.name}</b><span>${m.desc}</span></li>`).join('')}</ul>`;
    }

    const st = $('#lobbyStatus'), btn = $('#confirmBtn');
    st.classList.remove('go');
    btn.classList.remove('done');
    if (!S.preview) {
      btn.disabled = true; btn.textContent = '點選角色查看能力';
      st.textContent = '點選角色查看能力，按「確定」送出，雙方都確定後自動開戰';
    } else if (S.preview !== S.pick) {
      btn.disabled = false; btn.textContent = `確定選擇 ${byId[S.preview].name}`;
      st.textContent = opp && opp.charId ? '對手已確定，看完能力後按「確定」送出就開戰' : '看完能力後按「確定」送出';
    } else {
      btn.disabled = true; btn.classList.add('done'); btn.textContent = `✓ 已確定 ${byId[S.pick].name}`;
      if (opp && opp.charId) { st.textContent = '雙方就緒，即將開戰！'; st.classList.add('go'); }
      else st.textContent = opp ? '等待對手確定角色…（還可以點其他角色改選）' : '等待對手加入房間…（還可以點其他角色改選）';
    }
  }

  $('#confirmBtn').addEventListener('click', () => {
    if (!S.preview || !S.info || S.info.phase !== 'lobby') return;
    // 在這次點擊裡開始持續聆聽（iOS 只允許點擊時啟動收音），倒數期間聽到的話會忽略
    if (voice.supported && !S.tapMode) { S.listenWanted = true; voice.enable(); }
    socket.emit('pick', { charId: S.preview });
  });

  // ---------- 離開房間 ----------
  function leaveRoom() {
    const inBattle = S.battle && S.info && (S.info.phase === 'battle' || S.info.phase === 'countdown');
    if (inBattle && !confirm('對戰中離開會判定落敗，確定要離開房間嗎？')) return;
    socket.emit('leave');
    voice.release();
    S.room = null; S.slot = -1; S.info = null; S.battle = null; S.started = false;
    S.pick = null; S.preview = null; detailFor = null;
    $('#charDetail').innerHTML = '';
    setMovesOpen(false);
    hideResult();
    history.replaceState(null, '', '/play');
    $('#roomInput').value = '';
    $('#joinMsg').textContent = '';
    show('join');
  }
  document.querySelectorAll('[data-leave]').forEach(b => b.addEventListener('click', leaveRoom));

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
    applyCharColors();
    show('battle');
    renderState(b.state);
    setTapMode(S.tapMode || !voice.supported);
    if (b.board) {
      // 對戰中重新連線：直接顯示目前盤面
      S.started = true;
      board.setBoard(b.board);
      setAdjHint(b.board);
      clearInterval(cdTimer);
      $('#boardCover').classList.add('hide');
      $('#controls').classList.remove('locked');
    } else {
      S.started = false;
      board.clear();
      runCountdown(b.countdownEnd);
    }
  });

  // 開戰：方塊落下
  socket.on('begin', d => {
    if (!S.battle) return;
    S.started = true;
    clearInterval(cdTimer);
    setMovesOpen(false);
    $('#boardCover').classList.add('hide');
    $('#controls').classList.remove('locked');
    const cd = $('#countdown');
    cd.textContent = '開戰！'; cd.classList.remove('pop'); void cd.offsetWidth; cd.classList.add('pop');
    setTimeout(() => { if (cd.textContent === '開戰！') cd.textContent = ''; }, 900);
    board.dropIn(d.board);
    setAdjHint(d.board);
    renderState(d.state);
    setSpeech(S.tapMode || !voice.supported ? '點選相連方塊組成招式，再點一次最後一格出招'
      : voice.wanted && !voice.needTap ? '🎤 持續聆聽中，集氣滿後直接念出招式！' : '點一下 🎤 開始聆聽', '');
    updateMicLabel();
  });

  function setAdjHint(snap) {
    $('#adjHint').textContent = snap.diagonal ? '相連（上下左右或斜角，可以轉彎）' : '上下左右相連（可以轉彎）';
  }

  // 開戰前倒數（期間可以看招式表，方塊尚未出現）
  let cdTimer = 0;
  function runCountdown(end) {
    const num = $('#cdNum');
    $('#boardCover').classList.remove('hide');
    $('#controls').classList.add('locked');
    $('#countdown').textContent = '';
    setSpeech('倒數結束後方塊會落下，準備開戰！', '');
    clearInterval(cdTimer);
    const tick = () => {
      const left = end - (Date.now() + S.timeOffset);
      const n = String(Math.max(0, Math.ceil(left / 1000)));
      if (num.textContent !== n) { num.textContent = n; num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop'); }
      if (left <= 0) clearInterval(cdTimer); // 等伺服器的 begin 事件
    };
    tick();
    cdTimer = setInterval(tick, 100);
  }
  $('#cdMoves').addEventListener('click', () => setMovesOpen(true));

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
    updateMicLabel();
    $('#resetLeft').textContent = me.resets;
    updateHint(full, me.avail || []);
  }

  // 招式字上色：自己招式裡的每個字都有該招式的顏色（只在自己的手機）
  function applyCharColors() {
    const colors = new Map();
    if (S.battle) {
      for (const m of byId[S.battle.chars[S.slot]].moves) {
        for (const ch of m.name) {
          const list = colors.get(ch) || [];
          if (!list.includes(m.color)) list.push(m.color);
          colors.set(ch, list);
        }
      }
    }
    board.setCharColors(colors);
  }

  // 集氣滿了一段時間還沒出招，就讓盤面上一組自己的招式方塊閃爍（只在自己的手機）
  const HINT_DELAY_MS = 3000;
  let fullSince = 0, hintWord = null;
  function updateHint(full, avail) {
    if (!S.started || !full) { fullSince = 0; clearHint(); return; }
    if (!fullSince) fullSince = Date.now();
    if (Date.now() - fullSince < HINT_DELAY_MS) return;
    if (hintWord && avail.includes(hintWord)) return;
    hintWord = avail[Math.floor(Math.random() * avail.length)] || null;
    board.setHint(hintWord ? board.findPathIds(hintWord) : null);
  }
  function clearHint() {
    if (hintWord) { hintWord = null; board.setHint(null); }
  }

  function updateMicLabel() {
    const mic = $('#micBtn');
    let label;
    if (S.tapMode) label = board.selection.length ? '出招：' + board.selectedWord() : '點選方塊';
    else if (!voice.supported) label = '不支援語音';
    else if (voice.needTap) label = '點一下恢復聆聽';
    else if (voice.wanted) label = S.gaugeFull ? '集氣滿！直接念招式' : '聆聽中（點一下暫停）';
    else label = '點一下開始聆聽';
    $('#micLabel').textContent = label;
    mic.classList.toggle('listening', !S.tapMode && voice.wanted && !voice.needTap);
    mic.classList.toggle('needtap', !S.tapMode && voice.needTap);
  }

  socket.on('state', st => { if (S.battle) renderState(st); });

  socket.on('skill', ev => {
    clearHint();
    scene.onSkill(ev);
    board.playRemoval(ev.pathIds, ev.board, ev.slot);
    if (ev.slot === S.slot) vibrate([30, 40, 30]);
  });
  socket.on('hit', ev => {
    scene.onHit(ev);
    if (ev.dst === S.slot && (ev.kind === 'dmg' || ev.kind === 'dot') && ev.src !== S.slot) vibrate(25);
  });
  socket.on('reset', ev => {
    clearHint();
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
    updateMicLabel();
    if (state === 'listening') {
      meterLoop();
      if (S.started && !$('#speechText').textContent.startsWith('聽到')) setSpeech('🎤 持續聆聽中，直接念出招式' + (voice.usingPipe ? '（降噪中）' : ''), 'listen');
    } else if (state === 'needtap') {
      setSpeech(msg || '點一下恢復聆聽', 'bad');
    } else if (state === 'paused') {
      setSpeech('聆聽已暫停，點一下 🎤 繼續', '');
    } else if (state === 'error') {
      setSpeech(msg, 'bad');
    }
  }

  // iOS 拒絕自動重開收音時，玩家在畫面任何地方點一下就恢復
  document.addEventListener('pointerdown', e => {
    if (S.listenWanted && voice.needTap && !e.target.closest('#micBtn')) { voice.enable(); updateMicLabel(); }
  }, true);

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

  // 持續聆聽時，同一段辨識結果會越來越長（iOS 甚至會把整段話累積在一起），
  // 已經用來出招的部分要剪掉，避免同一句話重複觸發
  const consumed = new Map(); // 結果編號 → 已用掉的字數
  let lastSent = null;
  function onVoiceResult(alts, isFinal, key) {
    if (!S.started || S.tapMode) return; // 倒數期間聽到的話不算
    const cut = consumed.get(key) || 0;
    const trimmed = alts.map(a => a.slice(Math.min(cut, a.length)).trim());
    const heard = trimmed[0];
    if (!heard) return;
    if (Date.now() >= S.speechLockUntil) setSpeech(`聽到：<span class="heard">「${escapeHtml(heard)}」</span>`, '');
    if (!isFinal && heard.replace(/\s/g, '').length < 2) return;
    lastSent = { key, len: alts[0].length };
    socket.emit('speech', { alts: trimmed, interim: !isFinal });
  }

  socket.on('speechResult', r => {
    if (r.ok) {
      S.speechLockUntil = Date.now() + 900;
      if (lastSent) consumed.set(lastSent.key, lastSent.len);
      setSpeech(`<span class="ok">✓ ${escapeHtml(r.word)}！</span>`, '');
    } else if (Date.now() >= S.speechLockUntil) {
      setSpeech(`聽到「${escapeHtml(r.heard || '')}」 <span class="bad">✗ ${escapeHtml(r.msg || '')}</span>`, '');
      if (r.word) vibrate(80);
    }
  });

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // 麥克風按鈕：持續聆聽的開關（不用按住）
  const mic = $('#micBtn');
  mic.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (S.tapMode) { if (S.started) board.submit(); return; }
    if (!voice.supported) { toast('此瀏覽器不支援語音辨識，請改用手動點選'); return; }
    if (voice.wanted && !voice.needTap) { S.listenWanted = false; voice.disable(); }
    else { S.listenWanted = true; voice.enable(); }
    updateMicLabel();
  });
  mic.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- 招式表 ----------
  function renderMoves() {
    const me = S.battle && byId[S.battle.chars[S.slot]];
    if (!me) return;
    $('#movesList').innerHTML = me.moves.map(m => {
      return `<li style="border-left: 6px solid ${m.color}"><span class="mn"><i class="chip" style="background:${m.color}"></i>${m.name}</span><span class="st"></span>
        <span class="ds"><span class="tag ${m.type}">${TYPE_LABEL[m.type]}</span>${m.desc}</span></li>`;
    }).join('');
    $('#statsBox').innerHTML = Object.keys(STAT_LABELS).map(k => `<div>${STAT_LABELS[k]}<b>${me.stats[k]}</b></div>`).join('');
  }
  // 招式表：同一顆按鈕開／關
  function setMovesOpen(open) {
    if (open) {
      renderMoves(); renderDenoise();
      document.documentElement.style.setProperty('--ctrl-h', $('#controls').offsetHeight + 'px');
    }
    $('#movesModal').classList.toggle('hidden', !open);
    $('#movesBtn').classList.toggle('open', open);
    $('#movesIcon').textContent = open ? '✕' : '📜';
    $('#movesLabel').textContent = open ? '關閉' : '招式表';
  }
  $('#movesBtn').addEventListener('click', () => setMovesOpen($('#movesModal').classList.contains('hidden')));
  $('#movesModal').addEventListener('click', e => {
    if (e.target.id === 'movesModal' || e.target.hasAttribute('data-close')) setMovesOpen(false);
  });
  $('#resultModal').addEventListener('click', e => { if (e.target.id === 'resultModal') $('#resultModal').classList.add('hidden'); });

  // ---------- 手動點選模式 ----------
  function setTapMode(on) {
    S.tapMode = on;
    $('#tapToggle').checked = on;
    $('#tapResetBtn').classList.toggle('hidden', !on);
    board.setTapMode(on);
    $('#micBtn').classList.toggle('tapmode', on);
    $('#micBtn b').textContent = on ? '👆' : '🎤';
    updateMicLabel();
  }
  $('#tapToggle').addEventListener('change', e => setTapMode(e.target.checked));
  $('#tapResetBtn').addEventListener('click', () => { socket.emit('tapReset'); setMovesOpen(false); });
  board.onSubmit = path => socket.emit('tapMove', { path });
  board.onSelect = word => {
    if (!S.tapMode) return;
    updateMicLabel();
    if (word) setSpeech(`選取：<span class="heard">${escapeHtml(word)}</span>（再點最後一格或按 👆 出招）`, '');
  };

  // ---------- 初始化 ----------
  buildGrid();
  if (!S.room) show('join');
  if (!voice.supported) {
    console.warn('SpeechRecognition 不可用', { secure: window.isSecureContext });
  }
  window.__vf = { S, scene, board, socket, voice }; // 除錯用
})();
