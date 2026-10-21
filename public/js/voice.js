// 語音辨識包裝（Web Speech API，繁體中文）
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  class Voice {
    constructor({ onResult, onState, lang = 'zh-TW' }) {
      this.supported = !!SR && window.isSecureContext !== false;
      this.onResult = onResult; // (alts: string[], isFinal: boolean)
      this.onState = onState;   // ('listening' | 'idle' | 'error', msg)
      this.lang = lang;
      this.rec = null;
      this.active = false;
      this.lastInterim = '';
    }

    start() {
      if (!this.supported || this.active) return;
      const rec = new SR();
      rec.lang = this.lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 5;
      rec.onstart = () => { this.active = true; this.onState('listening'); };
      rec.onresult = e => {
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
        const msg = {
          'not-allowed': '請允許麥克風權限',
          'service-not-allowed': '此瀏覽器不允許語音辨識',
          'no-speech': '沒有聽到聲音',
          'network': '語音辨識需要網路連線',
          'audio-capture': '找不到麥克風'
        }[e.error];
        if (e.error !== 'aborted') this.onState('error', msg || ('語音錯誤：' + e.error));
      };
      rec.onend = () => { this.active = false; this.rec = null; this.lastInterim = ''; this.onState('idle'); };
      this.rec = rec;
      try { rec.start(); } catch (err) { this.onState('error', '無法啟動麥克風'); }
    }

    stop() { if (this.rec) try { this.rec.stop(); } catch (e) { /* ignore */ } }
    abort() { if (this.rec) try { this.rec.abort(); } catch (e) { /* ignore */ } }
  }

  window.Voice = Voice;
})();
