window.LagHero = window.LagHero || {};

(function (LH) {
  const { clamp, shakeAxis } = LH.Constants;

  // ============================================================================
  // 相机震屏 (Trauma)、真实时间顿帧 (Hit-Stop)、粒子与浮动文字系统 (`game-feel`)
  // ============================================================================
  const camera = {
    trauma: 0,
    shakeTime: 0,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    whiteFlash: 0,
    snowStaticTimer: 0,
    chromaticPunch: 0,
    vertigoAmount: 0,
    vertigoPhase: 0,
    stutterTick: 0,
    reduceMotion: false,

    addTrauma(amount) {
      this.trauma = clamp(this.trauma + amount, 0, 1);
    },

    addVertigo(amount) {
      this.vertigoAmount = clamp(this.vertigoAmount + amount, 0, 1);
    },

    update(realDt) {
      this.shakeTime += realDt;
      this.vertigoPhase += realDt * 5.2;
      this.trauma = Math.max(0, this.trauma - 1.35 * realDt);
      this.whiteFlash = Math.max(0, this.whiteFlash - 2.8 * realDt);
      this.snowStaticTimer = Math.max(0, this.snowStaticTimer - realDt);
      this.chromaticPunch = Math.max(0, this.chromaticPunch - 2.2 * realDt);
      this.vertigoAmount = Math.max(0, this.vertigoAmount - 1.6 * realDt);

      const motionScale = this.reduceMotion ? 0.15 : 1.0;
      const shake = this.trauma * this.trauma * motionScale;

      const swirlX = this.reduceMotion ? 0 : Math.sin(this.vertigoPhase) * 7 * this.vertigoAmount;
      const swirlY = this.reduceMotion ? 0 : Math.cos(this.vertigoPhase * 1.3) * 4.5 * this.vertigoAmount;

      this.offsetX = 15 * shake * shakeAxis(1.7, this.shakeTime) + swirlX;
      this.offsetY = 10 * shake * shakeAxis(4.3, this.shakeTime) + swirlY;
      this.rotation = 0.045 * shake * shakeAxis(8.9, this.shakeTime) +
        (this.reduceMotion ? 0 : Math.sin(this.vertigoPhase * 0.8) * 0.015 * this.vertigoAmount);
    }
  };

  // Real-time Hit-Stop (`game-feel` Pattern 2)
  const hitStopState = {
    activeId: 0,
    endRealTime: 0,
    frozenScale: 0.05,

    trigger(durationSec, scale = 0.04) {
      if (camera.reduceMotion) return;
      this.activeId++;
      const now = performance.now();
      this.endRealTime = Math.max(this.endRealTime, now + durationSec * 1000);
      this.frozenScale = scale;
    },

    getScale(now) {
      return now < this.endRealTime ? this.frozenScale : 1.0;
    }
  };

  const particles = [];
  const popTexts = [];
  const rewindGhosts = [];
  const shockwaves = [];

  function spawnShockwave(x, y, color = '#00f3ff', maxRadius = 220) {
    shockwaves.push({
      x,
      y,
      color,
      maxRadius,
      life: 0,
      maxLife: 0.42
    });
  }

  function spawnParticles(x, y, count, color, speedScale = 1, style = 'square') {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (60 + Math.random() * 250) * speedScale;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 40,
        size: 3 + Math.random() * 6,
        color,
        style,
        life: 0,
        maxLife: 0.25 + Math.random() * 0.32
      });
    }
  }

  function spawnPopText(x, y, text, color = '#ffe600', size = 16) {
    popTexts.push({
      x,
      y,
      text,
      color,
      size,
      life: 0,
      maxLife: 0.80
    });
  }

  function triggerFeedback(x, y, tier, color = '#00f3ff') {
    if (tier === 'small') {
      camera.addTrauma(0.14);
      spawnParticles(x, y, 5, color, 0.7);
    } else if (tier === 'medium') {
      camera.addTrauma(0.38);
      camera.addVertigo(0.42);
      hitStopState.trigger(0.045, 0.06);
      camera.chromaticPunch = Math.max(camera.chromaticPunch, 0.55);
      spawnParticles(x, y, 14, color, 1.0, 'glitch');
      spawnShockwave(x, y, color, 180);
    } else if (tier === 'large') {
      camera.addTrauma(0.85);
      camera.addVertigo(0.85);
      hitStopState.trigger(0.11, 0.03);
      camera.chromaticPunch = 1.0;
      if (!camera.reduceMotion) camera.whiteFlash = 0.45;
      spawnParticles(x, y, 34, color, 1.45, 'glitch');
      spawnShockwave(x, y, color, 320);
    }
  }

  LH.CameraFX = {
    camera,
    hitStopState,
    particles,
    popTexts,
    rewindGhosts,
    shockwaves,
    spawnShockwave,
    spawnParticles,
    spawnPopText,
    triggerFeedback
  };
})(window.LagHero);
