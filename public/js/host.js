// 電腦端首頁：顯示房間號碼與 QR Code
(function () {
  const $ = s => document.querySelector(s);
  const { byId } = window.GameData;
  const socket = io();
  let code = null;
  try { code = sessionStorage.getItem('vf-host-room'); } catch (e) { /* ignore */ }
  let players = [null, null];
  let phase = 'lobby';

  socket.on('connect', () => socket.emit('host:create', { code }));

  socket.on('host:room', d => {
    code = d.code;
    try { sessionStorage.setItem('vf-host-room', code); } catch (e) { /* ignore */ }
    $('#code').textContent = d.code;
    $('#qr').src = d.qr;
    $('#url').textContent = d.url;
    $('#alts').textContent = d.alternatives.length > 1 ? '其他網路位址：' + d.alternatives.slice(1).join('  ') : '';
    renderRoom(d.room);
  });

  socket.on('room', renderRoom);

  function renderRoom(info) {
    if (!info || info.code !== code) return;
    players = info.players;
    phase = info.phase;
    const phaseText = { lobby: '', countdown: '・即將開戰', battle: '・對戰中', over: '・對戰結束' }[phase];
    players.forEach((p, i) => {
      const slot = $('#slot' + i);
      const side = i === 0 ? '左方' : '右方';
      slot.classList.toggle('on', !!p);
      let st = `${side}：等待玩家…`;
      if (p) {
        if (!p.connected) st = `${side}：連線中斷`;
        else if (!p.charId) st = `${side}：選擇角色中`;
        else st = `${side}：${byId[p.charId].name} ${p.ready || phase !== 'lobby' ? '✓' : ''}${phaseText}`;
      }
      slot.querySelector('.st').textContent = st;
    });
  }

  $('#newRoom').addEventListener('click', () => socket.emit('host:new'));

  // 已選角色的小動畫
  function loop(now) {
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
