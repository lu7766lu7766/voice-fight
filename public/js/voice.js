// 語音辨識包裝（Web Speech API，繁體中文）＋收音降噪
//
// 降噪流程（瀏覽器支援 recognition.start(audioTrack) 時啟用，例如新版 Chrome）：
//   麥克風（瀏覽器內建 noiseSuppression / echoCancellation / autoGainControl）
//   → 高通 90Hz（濾掉冷氣、風切等低頻轟隆聲）→ 交給語音辨識
// 刻意不做噪音閘、壓縮等重處理：那些會切掉字頭或壓扁人聲，反而讓辨識變差。
// 不支援的瀏覽器（例如 iPhone Safari）自動退回一般收音。
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const LS_NOTRACK = 'vf-notrack';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  class MicPipeline {
    constructor() {
      this.ctx = null; this.stream = null; this.track = null;
      this.rms = 0; this.floor = 0.006;
    }

    get ready() { return !!(this.track && this.track.readyState === 'live'); }

    async open() {
      if (this.ready) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
      this.close();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx = new AC();
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(this.stream);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.7;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.buf = new Float32Array(this.analyser.fftSize);
      const dest = ctx.createMediaStreamDestination();
      src.connect(hp); hp.connect(dest); hp.connect(this.analyser);
      this.track = dest.stream.getAudioTracks()[0];
      this.timer = setInterval(() => this.measure(), 30);
    }

    // 量音量並估計環境噪音（只用來顯示音量條，不會改動送去辨識的聲音）
    measure() {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const rms = this.rms = Math.sqrt(sum / this.buf.length);
      this.floor = rms < this.floor ? this.floor * 0.85 + rms * 0.15 : this.floor * 0.995 + rms * 0.005;
      this.floor = Math.max(0.002, Math.min(0.08, this.floor));
    }

    // 0~1 的音量（給畫面上的音量條）
    level() { return Math.min(1, this.rms * 8); }
    isVoice() { return this.rms > Math.max(this.floor * 2.5, 0.012); }

    close() {
      clearInterval(this.timer);
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      if (this.ctx) this.ctx.close().catch(() => {});
      this.ctx = this.stream = this.track = this.analyser = null;
      this.rms = 0;
    }
  }

  // iPhone / iPad（含 iPadOS 的桌面版 UA）上的 Safari 語音辨識有不少怪癖，需要特別處理
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // 持續聆聽：開啟後一直收音，辨識器結束就自動重開（不用按住麥克風）。
  // iOS 只允許在使用者點擊時啟動收音，所以第一次要由點擊（例如「確定角色」）呼叫 enable()；
  // 之後若 iOS 拒絕自動重開，needTap 會變成 true，畫面請玩家再點一下。
  class Voice {
    constructor({ onResult, onState, lang = 'zh-TW' }) {
      this.supported = !!SR && window.isSecureContext !== false;
      this.isIOS = IS_IOS;
      this.onResult = onResult; // (alts: string[], isFinal: boolean, key: string)
      this.onState = onState;   // ('listening' | 'needtap' | 'error', msg)
      this.lang = lang;
      this.rec = null;
      this.session = 0;         // 每個辨識器一個編號，舊辨識器遲來的事件一律忽略
      this.wanted = false;      // 玩家是否開著聆聽
      this.active = false;
      this.needTap = false;
      this.quickEnds = 0;       // 連續「很快就結束」的次數，用來避免無限重開
      this.restartTimer = 0;
      this.denoise = true;      // 降噪管線一律開啟（切換會重開收音，有些手機重開後收不到音）
      // undefined = 尚未偵測；true / false = 是否支援 start(audioTrack)。iOS Safari 不支援
      this.trackSupport = IS_IOS || lsGet(LS_NOTRACK) === '1' ? false : undefined;
      this.pipe = new MicPipeline();
      this.usingPipe = false;
    }

    get denoiseActive() { return this.denoise && this.trackSupport === true; }

    // 開始持續聆聽（請在點擊事件裡呼叫）
    enable() {
      if (!this.supported) return;
      this.wanted = true;
      this.needTap = false;
      this.quickEnds = 0;
      if (!this.active) this.startNow();
    }

    makeRec(id) {
      const rec = new SR();
      rec.lang = this.lang;
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 5;
      let gotResult = false;
      const startedAt = performance.now();
      const mine = () => id === this.session;
      rec.onstart = () => {
        if (!mine()) return;
        this.active = true;
        this.onState('listening');
      };
      rec.onresult = e => {
        if (!mine()) return;
        gotResult = true;
        this.quickEnds = 0;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const alts = [];
          for (let k = 0; k < r.length; k++) if (r[k].transcript) alts.push(r[k].transcript.trim());
          if (alts.length) this.onResult(alts, r.isFinal, id + ':' + i);
        }
      };
      rec.onerror = e => {
        if (!mine()) return;
        if (this.usingPipe && !gotResult && (e.error === 'audio-capture' || e.error === 'service-not-allowed' || e.error === 'bad-grammar')) {
          // 降噪管線在這台裝置上不可用：記住並改用一般收音
          this.trackSupport = false;
          lsSet(LS_NOTRACK, '1');
          this.pipe.close();
          return;
        }
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          // iOS 不允許在非點擊時機重開，或權限被拒
          this.needTap = true;
          this.onState('needtap', e.error === 'service-not-allowed' && IS_IOS ? '請到「設定 > Siri」開啟 Siri 與聽寫' : '點一下恢復聆聽');
          return;
        }
        if (e.error === 'no-speech' || e.error === 'aborted') return; // 持續聆聽時的正常狀況
        const msg = { 'network': '語音辨識需要網路連線', 'audio-capture': '找不到麥克風' }[e.error];
        this.onState('error', msg || ('語音錯誤：' + e.error));
      };
      rec.onend = () => {
        if (!mine()) return;
        this.active = false;
        this.rec = null;
        if (!this.wanted || this.needTap) return;
        // 很快就結束（例如 iOS 拒絕在背景啟動）連續好幾次，就改請玩家點一下
        if (!gotResult && performance.now() - startedAt < 1500) this.quickEnds++;
        else this.quickEnds = 0;
        if (this.quickEnds >= 4) { this.needTap = true; this.onState('needtap', '點一下恢復聆聽'); return; }
        this.restart(this.quickEnds ? 400 * this.quickEnds : 150);
      };
      return rec;
    }

    restart(ms) {
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => {
        if (!this.wanted || this.needTap) return;
        this.discard();
        this.startNow();
      }, ms);
    }

    async startNow() {
      if (!this.supported || !this.wanted) return;
      this.discard();
      const id = ++this.session;
      this.usingPipe = false;
      const rec = this.rec = this.makeRec(id);
      try {
        if (this.denoise && this.trackSupport !== false) {
          if (this.trackSupport === undefined) {
            // 偵測：支援 start(audioTrack) 的瀏覽器遇到非音軌參數會丟 TypeError；
            // 不支援的會忽略參數、直接用麥克風開始收音（那就直接當作這次的收音）。
            try {
              rec.start({});
              this.trackSupport = false;
              return;
            } catch (e) {
              this.trackSupport = e instanceof TypeError;
              if (!this.trackSupport) throw e;
            }
          }
          try {
            await this.pipe.open();
            this.usingPipe = true;
          } catch (e) {
            console.warn('降噪管線開啟失敗，改用一般收音', e);
          }
          if (id !== this.session) return;
        }
        if (this.usingPipe) rec.start(this.pipe.track); else rec.start();
      } catch (err) {
        if (id !== this.session) return;
        this.rec = null;
        this.needTap = true;
        this.onState('needtap', '點一下恢復聆聽');
      }
    }

    // 丟掉目前的辨識器（Safari 常常 stop/abort 之後不回報 onend，所以不等它）
    discard() {
      const rec = this.rec;
      this.session++;
      this.rec = null;
      this.active = false;
      if (rec) {
        rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
        try { rec.abort(); } catch (e) { /* ignore */ }
      }
    }

    level() { return this.usingPipe && this.pipe.ready ? this.pipe.level() : 0; }

    // 離開對戰時停止聆聽並釋放麥克風
    release() {
      this.wanted = false;
      this.needTap = false;
      clearTimeout(this.restartTimer);
      this.discard();
      this.pipe.close();
    }
  }

  window.Voice = Voice;
})();
