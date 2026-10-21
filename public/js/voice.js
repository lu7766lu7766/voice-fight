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

  class Voice {
    constructor({ onResult, onState, lang = 'zh-TW' }) {
      this.supported = !!SR && window.isSecureContext !== false;
      this.isIOS = IS_IOS;
      this.onResult = onResult; // (alts: string[], isFinal: boolean)
      this.onState = onState;   // ('listening' | 'idle' | 'error', msg)
      this.lang = lang;
      this.rec = null;
      this.session = 0;         // 每次收音一個編號，舊辨識器遲來的事件一律忽略
      this.active = false;
      this.starting = false;
      this.wantStop = false;
      this.lastInterim = '';
      this.timers = [];
      this.denoise = lsGet('vf-denoise') !== '0';
      // undefined = 尚未偵測；true / false = 是否支援 start(audioTrack)。iOS Safari 不支援
      this.trackSupport = IS_IOS || lsGet(LS_NOTRACK) === '1' ? false : undefined;
      this.pipe = new MicPipeline();
      this.usingPipe = false;
    }

    setDenoise(on) {
      this.denoise = on;
      lsSet('vf-denoise', on ? '1' : '0');
      if (!on) this.pipe.close();
    }

    // 目前是否真的走降噪管線
    get denoiseActive() { return this.denoise && this.trackSupport === true; }

    later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }
    clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }

    makeRec(id) {
      const rec = new SR();
      rec.lang = this.lang;
      rec.interimResults = true;
      // 按住期間持續收音、停頓也不中斷；iOS Safari 的連續模式在第一句之後就不再回傳結果，所以關掉
      rec.continuous = !IS_IOS;
      rec.maxAlternatives = 5;
      let gotResult = false;
      const mine = () => id === this.session;
      rec.onstart = () => {
        if (!mine()) return;
        this.active = true; this.starting = false;
        this.onState('listening');
        if (this.wantStop) this.stop();
      };
      rec.onresult = e => {
        if (!mine()) return;
        gotResult = true;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const alts = [];
          for (let k = 0; k < r.length; k++) if (r[k].transcript) alts.push(r[k].transcript.trim());
          if (!alts.length) continue;
          if (!r.isFinal) {
            if (alts[0] === this.lastInterim) continue;
            this.lastInterim = alts[0];
          }
          this.onResult(alts, r.isFinal);
        }
      };
      rec.onerror = e => {
        if (!mine()) return;
        // 降噪管線在這台裝置上不可用時，記住並退回一般收音
        if (this.usingPipe && !gotResult && (e.error === 'audio-capture' || e.error === 'service-not-allowed' || e.error === 'bad-grammar')) {
          this.trackSupport = false;
          lsSet(LS_NOTRACK, '1');
          this.pipe.close();
          this.finish('error', '此裝置不支援降噪收音，已改用一般收音，請再按一次');
          return;
        }
        const msg = {
          'not-allowed': '請允許麥克風權限',
          'service-not-allowed': IS_IOS ? '請到「設定 > Siri」開啟 Siri 與聽寫' : '此瀏覽器不允許語音辨識',
          'no-speech': '沒有聽到聲音',
          'network': '語音辨識需要網路連線',
          'audio-capture': '找不到麥克風'
        }[e.error];
        if (e.error !== 'aborted') this.finish('error', msg || ('語音錯誤：' + e.error));
      };
      rec.onend = () => { if (mine()) this.finish('idle'); };
      return rec;
    }

    // 結束目前這次收音（不論辨識器有沒有正常回報 onend）
    finish(state, msg, silent) {
      this.clearTimers();
      const wasActive = (this.active || this.starting) && !silent;
      this.session++; // 之後這個辨識器的任何事件都不理會
      this.active = false; this.starting = false; this.wantStop = false;
      this.rec = null; this.lastInterim = '';
      if (wasActive || state === 'error') this.onState(state, msg);
    }

    // 丟掉舊的辨識器（Safari 常常 stop/abort 之後不回報 onend，舊狀態會卡住）
    discard(silent) {
      const rec = this.rec;
      if (rec) {
        rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
        try { rec.abort(); } catch (e) { /* ignore */ }
      }
      this.finish('idle', null, silent);
    }

    async start() {
      if (!this.supported) return;
      // 每次按下都開一個全新的辨識器
      if (this.rec || this.active || this.starting) this.discard(true);
      const id = ++this.session;
      this.starting = true;
      this.wantStop = false;
      this.usingPipe = false;
      const rec = this.rec = this.makeRec(id);
      // 看門狗：辨識器一直沒有開始（iOS 偶爾會發生）就放棄，下次按會重開
      this.later(() => { if (id === this.session && this.starting && !this.active) { this.discard(); this.onState('error', '麥克風沒有回應，請再按一次'); } }, 3000);
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
        if (this.wantStop) { this.finish('idle'); return; }
        if (this.usingPipe) rec.start(this.pipe.track); else rec.start();
      } catch (err) {
        if (id === this.session) this.finish('error', '無法啟動麥克風');
      }
    }

    stop() {
      if (this.starting && !this.active) { this.wantStop = true; return; }
      if (!this.rec) return;
      const id = this.session;
      try { this.rec.stop(); } catch (e) { /* ignore */ }
      // 保險：一段時間內沒收到 onend 就強制結束，避免下一次按不動
      this.later(() => { if (id === this.session) this.discard(); }, 1500);
    }

    abort() { if (this.rec || this.active || this.starting) this.discard(); }

    level() { return this.usingPipe && this.pipe.ready ? this.pipe.level() : 0; }

    // 離開對戰時釋放麥克風
    release() { this.abort(); this.pipe.close(); }
  }

  window.Voice = Voice;
})();
