'use strict';
// 本機伺服器：HTTP（電腦端首頁）+ HTTPS（手機端，麥克風需要安全連線）共用同一個 Socket.IO。

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { Room } = require('./room');

const HTTP_PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const ROOT = path.join(__dirname, '..');

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  // 常見家用網段優先
  const rank = ip => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3;
  out.sort((a, b) => rank(a.address) - rank(b.address));
  return out;
}

function hostIp() {
  return process.env.HOST_IP || (lanAddresses()[0] || { address: '127.0.0.1' }).address;
}

// 自簽憑證：存在 .cert/ 以便手機只需信任一次
function loadCert() {
  const dir = path.join(ROOT, '.cert');
  const keyFile = path.join(dir, 'key.pem'), certFile = path.join(dir, 'cert.pem'), metaFile = path.join(dir, 'ips.json');
  const ips = ['127.0.0.1', ...lanAddresses().map(a => a.address), ...(process.env.HOST_IP ? [process.env.HOST_IP] : [])];
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (ips.every(ip => meta.includes(ip))) {
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
    }
  } catch (e) { /* 重新產生 */ }
  const selfsigned = require('selfsigned');
  const pems = selfsigned.generate([{ name: 'commonName', value: 'voice-fight.local' }], {
    days: 3650, keySize: 2048, algorithm: 'sha256',
    extensions: [{
      name: 'subjectAltName',
      altNames: [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))]
    }]
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(metaFile, JSON.stringify(ips));
  return { key: pems.private, cert: pems.cert };
}

const app = express();
app.use(express.static(path.join(ROOT, 'public'), { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.get('/play', (req, res) => res.sendFile(path.join(ROOT, 'public', 'play.html')));

const rooms = new Map();

function playUrl(code) {
  return `https://${hostIp()}:${HTTPS_PORT}/play?room=${code}`;
}

function createRoom() {
  let code;
  do { code = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(code));
  const room = new Room(code, io);
  rooms.set(code, room);
  return room;
}

async function hostPayload(room) {
  const url = playUrl(room.code);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#2b1b0e', light: '#fff8e8' } });
  return {
    code: room.code, url, qr,
    alternatives: lanAddresses().map(a => `https://${a.address}:${HTTPS_PORT}/play?room=${room.code}`),
    room: room.roomInfo()
  };
}

const io = new Server({ cors: { origin: true } });

io.on('connection', socket => {
  const safe = fn => (...args) => { try { fn(...args); } catch (e) { console.error(e); } };

  // ----- 電腦端 -----
  socket.on('host:create', safe(async (data = {}) => {
    let room = data.code && rooms.get(String(data.code));
    if (!room) room = createRoom();
    socket.join('host:' + room.code);
    socket.data.hostOf = room.code;
    socket.emit('host:room', await hostPayload(room));
  }));

  socket.on('host:new', safe(async () => {
    if (socket.data.hostOf) socket.leave('host:' + socket.data.hostOf);
    const room = createRoom();
    socket.join('host:' + room.code);
    socket.data.hostOf = room.code;
    socket.emit('host:room', await hostPayload(room));
  }));

  // ----- 手機端 -----
  socket.on('join', safe((data = {}) => {
    const code = String(data.room || '').trim();
    const pid = String(data.pid || '').slice(0, 64);
    const room = rooms.get(code);
    if (!room) return socket.emit('joinError', { reason: '找不到房間 ' + code });
    if (!pid) return socket.emit('joinError', { reason: '缺少玩家識別碼' });
    if (socket.data.room && socket.data.room !== room) socket.data.room.leave(socket);
    const res = room.join(socket, pid);
    if (!res.ok) socket.emit('joinError', { reason: res.reason });
  }));

  const inRoom = fn => safe((...args) => { const r = socket.data.room; if (r) fn(r, ...args); });

  socket.on('pick', inRoom((r, d = {}) => r.pick(socket.data.slot, String(d.charId))));
  socket.on('ready', inRoom((r, d = {}) => r.setReady(socket.data.slot, d.ready)));
  socket.on('attack', inRoom(r => r.normal(socket)));
  socket.on('speech', inRoom((r, d = {}) => r.speech(socket, Array.isArray(d.alts) ? d.alts.map(String) : [], !!d.interim)));
  socket.on('tapMove', inRoom((r, d = {}) => r.tapMove(socket, d.path)));
  socket.on('tapReset', inRoom(r => r.tapReset(socket)));
  socket.on('rematch', inRoom(r => r.rematch(socket.data.slot)));
  socket.on('leave', inRoom(r => r.leave(socket)));
  socket.on('timesync', (t, cb) => typeof cb === 'function' && cb(Date.now()));

  socket.on('disconnect', safe(() => { if (socket.data.room) socket.data.room.disconnect(socket); }));
});

// 遊戲主迴圈
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    room.tick(now);
    const hosts = io.sockets.adapter.rooms.get('host:' + code);
    if (room.isEmpty() && !hosts && now - room.touched > 30 * 60 * 1000) rooms.delete(code);
  }
}, 33);

const httpServer = http.createServer(app);
const httpsServer = https.createServer(loadCert(), app);
io.attach(httpServer);
io.attach(httpsServer);

httpServer.listen(HTTP_PORT, () => {
  httpsServer.listen(HTTPS_PORT, () => {
    const ip = hostIp();
    console.log('');
    console.log('  ⚔  聲控對戰 Voice Fight 伺服器已啟動');
    console.log(`  電腦開啟：  http://localhost:${HTTP_PORT}`);
    console.log(`  手機連線：  https://${ip}:${HTTPS_PORT}/play （掃描電腦畫面上的 QR Code）`);
    console.log('  首次連線手機會出現憑證警告，請選擇「繼續前往」以允許麥克風。');
    console.log('');
  });
});

module.exports = { app, io, rooms };
