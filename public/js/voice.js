// 語音辨識包裝（Web Speech API，繁體中文）＋收音降噪
//
// 降噪流程（瀏覽器支援 recognition.start(audioTrack) 時啟用，例如新版 Chrome）：
//   麥克風（瀏覽器內建 noiseSuppression / echoCancellation / autoGainControl）
//   → 高通 120Hz（濾掉低頻轟隆聲、風切、冷氣）→ 低通 5kHz（濾掉高頻嘶聲）
//   → 預讀延遲 60ms → 自適應噪音閘（持續估計環境噪音，只有明顯大於環境音的人聲才放行）
//   → 壓縮器（拉平音量）→ 交給語音辨識
// 不支援的瀏覽器（例如 iPhone Safari）自動退回一般收音。
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const LS_NOTRACK = 'vf-notrack';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  class MicPipeline {
    constructor() {
      this.ctx = null; this.stream = null; this.track = null;
      this.rms = 0; this.floor = 0.006; this.open_ = false; this.lastLoud = 0;
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
      hp.type = 'highpass'; hp.frequency.value = 120; hp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 5000; lp.Q.value = 0.7;
      const delay = ctx.createDelay(0.2);
      delay.delayTime.value = 0.06; // 讓噪音閘「先聽後放」，不會切掉字頭
      this.gate = ctx.createGain();
      this.gate.gain.value = 0.1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -32; comp.knee.value = 18; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.buf = new Float32Array(this.analyser.fftSize);
      const dest = ctx.createMediaStreamDestination();

      src.connect(hp); hp.connect(lp);
      lp.connect(this.analyser);
      lp.connect(delay); delay.connect(this.gate); this.gate.connect(comp); comp.connect(dest);
      this.track = dest.stream.getAudioTracks()[0];
      this.timer = setInterval(() => this.updateGate(), 20);
    }

    // 自適應噪音閘：安靜時慢慢學環境音量，人聲明顯大於環境音才開門
    updateGate() {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      const rms = Math.sqrt(sum / this.buf.length);
      this.rms = rms;
      const now = performance.now();
      if (!this.open_) {
        // 低於目前估計就快速下修，高於則緩慢上修（避免把人聲學成噪音）
        this.floor = rms < this.floor ? this.floor * 0.85 + rms * 0.15 : this.floor * 0.995 + rms * 0.005;
        this.floor = Math.max(0.002, Math.min(0.08, this.floor));
      }
      const openAt = Math.max(this.floor * 2.8, 0.012);
      const keepAt = Math.max(this.floor * 1.8, 0.008);
      if (rms > openAt) { this.open_ = true; this.lastLoud = now; }
      else if (rms > keepAt && this.open_) this.lastLoud = now;
      else if (this.open_ && now - this.lastLoud > 350) this.open_ = false;
      const t = this.ctx.currentTime;
      this.gate.gain.setTargetAtTime(this.open_ ? 1 : 0.08, t, this.open_ ? 0.005 : 0.08);
    }

    // 0~1 的音量（給畫面上的音量條）
    level() { return Math.min(1, this.rms * 8); }
    isVoice() { return this.open_; }

    close() {
      clearInterval(this.timer);
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      if (this.ctx) this.ctx.close().catch(() => {});
      this.ctx = this.stream = this.track = this.analyser = null;
      this.open_ = false; this.rms = 0;
    }
  }

  class Voice {
    constructor({ onResult, onState, lang = 'zh-TW' }) {
      this.supported = !!SR && window.isSecureContext !== false;
      this.onResult = onResult; // (alts: string[], isFinal: boolean)
      this.onState = onState;   // ('listening' | 'idle' | 'error', msg)
      this.lang = lang;
      this.rec = null;
      this.active = false;
      this.starting = false;
      this.wantStop = false;
      this.lastInterim = '';
      this.denoise = lsGet('vf-denoise') !== '0';
      // undefined = 尚未偵測；true / false = 是否支援 start(audioTrack)
      this.trackSupport = lsGet(LS_NOTRACK) === '1' ? false : undefined;
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

    makeRec() {
      const rec = new SR();
      rec.lang = this.lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 5;
      let gotResult = false;
      rec.onstart = () => { this.active = true; this.starting = false; this.onState('listening'); if (this.wantStop) this.stop(); };
      rec.onresult = e => {
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
        // 降噪管線在這台裝置上不可用時，記住並退回一般收音
        if (this.usingPipe && !gotResult && (e.error === 'audio-capture' || e.error === 'service-not-allowed' || e.error === 'bad-grammar')) {
          this.trackSupport = false;
          lsSet(LS_NOTRACK, '1');
          this.pipe.close();
          this.onState('error', '此裝置不支援降噪收音，已改用一般收音，請再按一次');
          return;
        }
        const msg = {
          'not-allowed': '請允許麥克風權限',
          'service-not-allowed': '此瀏覽器不允許語音辨識',
          'no-speech': '沒有聽到聲音',
          'network': '語音辨識需要網路連線',
          'audio-capture': '找不到麥克風'
        }[e.error];
        if (e.error !== 'aborted') this.onState('error', msg || ('語音錯誤：' + e.error));
      };
      rec.onend = () => {
        this.active = false; this.starting = false; this.rec = null; this.lastInterim = '';
        this.onState('idle');
      };
      return rec;
    }

    async start() {
      if (!this.supported || this.active || this.starting) return;
      this.starting = true;
      this.wantStop = false;
      this.usingPipe = false;
      const rec = this.rec = this.makeRec();
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
        }
        if (this.wantStop) { this.starting = false; this.rec = null; this.onState('idle'); return; }
        if (this.usingPipe) rec.start(this.pipe.track); else rec.start();
      } catch (err) {
        this.starting = false; this.rec = null;
        this.onState('error', '無法啟動麥克風');
      }
    }

    stop() {
      if (this.starting && !this.active) { this.wantStop = true; return; }
      if (this.rec) try { this.rec.stop(); } catch (e) { /* ignore */ }
    }
    abort() { if (this.rec) try { this.rec.abort(); } catch (e) { /* ignore */ } }

    level() { return this.usingPipe && this.pipe.ready ? this.pipe.level() : 0; }

    // 離開對戰時釋放麥克風
    release() { this.abort(); this.pipe.close(); }
  }

  window.Voice = Voice;
})();
