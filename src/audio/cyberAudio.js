window.LagHero = window.LagHero || {};

(function (LH) {
  // ============================================================================
  // 原生合成音效 + 动态赛博电子 BGM 音序器 (Web Audio API - 零外部音频依赖)
  // ============================================================================
  class CyberAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.bgmEnabled = true;
      this.lagOsc = null;
      this.lagGain = null;

      // 动态 BGM 步进音序器状态
      this.bgmTimer = null;
      this.bgmStep = 0;
      this.bgmMode = 'normal'; // 'normal' | 'lag' | 'boss'
      this.bgmPlaying = false;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        try {
          this.ctx.resume();
        } catch (e) {}
      }
    }

    // 启动动态赛博合成器背景音乐
    startBGM() {
      if (this.bgmPlaying) return;
      this.init();
      this.bgmPlaying = true;
      this.bgmStep = 0;

      const tick = () => {
        if (!this.bgmPlaying) return;
        if (this.enabled && this.bgmEnabled && this.ctx) {
          this.playBGMStep();
        }
        const interval = this.bgmMode === 'lag' ? 280 : (this.bgmMode === 'boss' ? 115 : 145);
        if (typeof setTimeout === 'function') {
          this.bgmTimer = setTimeout(tick, interval);
        }
      };
      tick();
    }

    stopBGM() {
      this.bgmPlaying = false;
      if (this.bgmTimer && typeof clearTimeout === 'function') {
        clearTimeout(this.bgmTimer);
        this.bgmTimer = null;
      }
    }

    playBGMStep() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const normalScale = [110, 110, 130.81, 110, 146.83, 130.81, 164.81, 146.83];
      const bossScale = [123.47, 123.47, 146.83, 155.56, 185.0, 155.56, 146.83, 110.0];
      const notes = this.bgmMode === 'boss' ? bossScale : normalScale;
      let freq = notes[this.bgmStep % notes.length];

      // 主动卡死期间：BGM 自动降八度慢放，营造磁带卡死感
      if (this.bgmMode === 'lag') {
        freq *= 0.55;
      }

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = this.bgmMode === 'boss' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      const dur = this.bgmMode === 'lag' ? 0.24 : 0.11;
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + dur);

      // 每 4 拍加一声高频赛博琶音点缀
      if (this.bgmStep % 4 === 0 && this.bgmMode !== 'lag') {
        const arp = this.ctx.createOscillator();
        const arpGain = this.ctx.createGain();
        arp.type = 'sine';
        arp.frequency.setValueAtTime(freq * 4, now);
        arpGain.gain.setValueAtTime(0.025, now);
        arpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        arp.connect(arpGain);
        arpGain.connect(this.ctx.destination);
        arp.start(now);
        arp.stop(now + 0.08);
      }

      this.bgmStep++;
    }

    // 跳跃哔声
    playJump(isDouble = false) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = isDouble ? 'square' : 'triangle';
      const startFreq = isDouble ? 360 : 240;
      const endFreq = isDouble ? 780 : 540;

      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.12);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    }

    // 卡顿斩刀光音效
    playSlash(isQueuedLag = false) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(isQueuedLag ? 880 : 620, now);
      osc.frequency.exponentialRampToValueAtTime(isQueuedLag ? 260 : 140, now + 0.11);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    }

    // 神技一：主动卡死骤停低频持续嗡鸣音
    startLagDrone() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx || this.lagOsc) return;

      const now = this.ctx.currentTime;
      this.lagOsc = this.ctx.createOscillator();
      this.lagGain = this.ctx.createGain();

      this.lagOsc.type = 'sawtooth';
      this.lagOsc.frequency.setValueAtTime(190, now);
      this.lagOsc.frequency.exponentialRampToValueAtTime(52, now + 0.18);

      this.lagGain.gain.setValueAtTime(0.01, now);
      this.lagGain.gain.linearRampToValueAtTime(0.14, now + 0.06);

      this.lagOsc.connect(this.lagGain);
      this.lagGain.connect(this.ctx.destination);
      this.lagOsc.start(now);
    }

    stopLagDrone() {
      if (!this.lagOsc || !this.ctx) return;
      const now = this.ctx.currentTime;
      try {
        this.lagOsc.frequency.setValueAtTime(Math.max(20, this.lagOsc.frequency.value), now);
        this.lagOsc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
        this.lagGain.gain.setValueAtTime(Math.max(0.001, this.lagGain.gain.value), now);
        this.lagGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        this.lagOsc.stop(now + 0.09);
      } catch (e) {}
      this.lagOsc = null;
      this.lagGain = null;
    }

    // 神技二：丢包回溯倒带哨声
    playRewind() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const mod = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(980, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(1250, now + 0.32);

      mod.type = 'square';
      mod.frequency.setValueAtTime(45, now);
      modGain.gain.setValueAtTime(120, now);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

      mod.connect(modGain);
      modGain.connect(osc.frequency);
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      mod.start(now);
      osc.stop(now + 0.34);
      mod.stop(now + 0.34);
    }

    // 神技三：穿模滋滋电磁杂音
    playPhaseGlitch(shortSpark = false) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const dur = shortSpark ? 0.12 : 0.32;
      const bufferSize = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        const pulse = Math.sin(i * 0.09) > 0 ? 1 : -0.4;
        data[i] = (Math.random() * 2 - 1) * pulse;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(shortSpark ? 2400 : 1400, now);
      filter.Q.setValueAtTime(3.5, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(shortSpark ? 0.18 : 0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(now);
    }

    // 拾取数据金币或 Bug 碎片音效
    playPickup(isShard = false) {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = isShard ? 'sawtooth' : 'sine';
      const f1 = isShard ? 520 : 660;
      const f2 = isShard ? 1180 : 990;

      osc.frequency.setValueAtTime(f1, now);
      osc.frequency.setValueAtTime(f2, now + 0.055);

      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    }

    // 撞毁爆炸音
    playCrash() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      this.stopLagDrone();
      const now = this.ctx.currentTime;
      const dur = 0.45;
      const bufferSize = Math.floor(this.ctx.sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.15));
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(920, now);
      filter.frequency.exponentialRampToValueAtTime(90, now + dur);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.36, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      const sub = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      sub.type = 'triangle';
      sub.frequency.setValueAtTime(130, now);
      sub.frequency.exponentialRampToValueAtTime(28, now + dur);
      subGain.gain.setValueAtTime(0.32, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      sub.connect(subGain);
      subGain.connect(this.ctx.destination);

      noise.start(now);
      sub.start(now);
      sub.stop(now + dur);
    }

    // 受击扣血警报音
    playHurt() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.22);

      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    }

    // VN 终端打字机音效
    playTypewriterBlip() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(740 + Math.random() * 160, now);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.025);
    }
  }

  LH.CyberAudio = CyberAudio;
  LH.audio = new CyberAudio();
})(window.LagHero);
