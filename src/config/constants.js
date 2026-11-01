window.LagHero = window.LagHero || {};

(function (LH) {
  // ============================================================================
  // 1. 数学与 Game-Feel 曲线工具 (`game-feel/references/feedback-recipes.md`)
  // ============================================================================
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // EaseOutBack: 超调回弹曲线 ("pop")
  function easeOutBack(k) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const m = k - 1;
    return 1 + c3 * m * m * m + c1 * m * m;
  }

  // EaseOutCubic: 平滑减速曲线 ("settle")
  function easeOutCubic(k) {
    return 1 - Math.pow(1 - k, 3);
  }

  // 1D 伪随机平滑正弦采样 (`game-feel` §1: 避免每帧 rand() 造成刺耳高频杂乱抖动)
  function shakeAxis(seed, t) {
    return 0.6 * Math.sin(t * 11.0 + seed) + 0.4 * Math.sin(t * 23.0 + seed * 2.0);
  }

  // ============================================================================
  // 2. 可复现种子随机数发生器与公平洗牌 (`roguelike` Pattern 1 & `card-game` §6)
  // ============================================================================
  class SeededRNG {
    constructor(seedStr) {
      this.setSeed(seedStr || String(Date.now()));
    }

    setSeed(seedStr) {
      this.seedString = String(seedStr).trim() || 'LAG-2077';
      let h = 2166136261 >>> 0;
      for (let i = 0; i < this.seedString.length; i++) {
        h ^= this.seedString.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      this.state = h >>> 0;
      if (this.state === 0) this.state = 0xdeadbeef;
    }

    // Mulberry32: 返回 [0, 1) 浮点数
    nextFloat() {
      let t = (this.state += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // 返回 [min, max] 闭区间整数 (`card-game` §6)
    intInclusive(min, max) {
      return min + Math.floor(this.nextFloat() * (max - min + 1));
    }

    // 标准无偏 Fisher-Yates 洗牌 (`card-game` §6)
    shuffle(array) {
      const arr = array.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.intInclusive(0, i);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }

    // 权重随机抽取 (`roguelike/references/generation-fov-loot.md` §4)
    weightedPick(entries) {
      let total = 0;
      for (const item of entries) total += item.weight;
      if (total <= 0) return entries[0] ? entries[0].value : null;
      let pick = this.nextFloat() * total;
      let upto = 0;
      for (const item of entries) {
        upto += item.weight;
        if (pick <= upto) return item.value;
      }
      return entries[entries.length - 1].value;
    }
  }

  // ============================================================================
  // 3. 平台跳跃物理参数 (`platformer/references/feel-tuning.md` §1-2)
  // ============================================================================
  const JUMP_HEIGHT = 152;
  const TIME_TO_APEX = 0.34;
  const RISE_GRAVITY = (2 * JUMP_HEIGHT) / (TIME_TO_APEX * TIME_TO_APEX);
  const JUMP_VELOCITY = -(2 * JUMP_HEIGHT) / TIME_TO_APEX;
  const FALL_MULTIPLIER = 1.85;
  const FALL_GRAVITY = RISE_GRAVITY * FALL_MULTIPLIER;
  const APEX_THRESHOLD = 85;
  const APEX_GRAVITY_MULT = 0.48;
  const EARLY_RELEASE_CUT = 0.48;
  const MAX_FALL_SPEED = 1050;
  const COYOTE_TIME = 0.10;
  const JUMP_BUFFER_TIME = 0.12;

  // 技能基础常量
  const REWIND_HISTORY_SEC = 1.5;
  const BASE_PHASE_DURATION = 2.2;
  const LAG_TIME_SCALE = 0.10;
  const SLASH_COOLDOWN = 0.32;

  // ============================================================================
  // 4. 难度档位与三大赛博扇区章节 (`Sector Biomes`)
  // ============================================================================
  const DIFFICULTY_CONFIGS = {
    easy: {
      key: 'easy',
      label: '简单',
      maxHp: 100,
      hitDamage: 25,
      baseSpeed: 330,
      trapSpeedMult: 0.82,
      lagDrain: 30,
      lagRecharge: 38,
      rewindCd: 2.5,
      phaseCd: 0.0,
      shardHeal: 15,
      scoreMult: 1.0,
      bossHpMult: 0.8
    },
    medium: {
      key: 'medium',
      label: '中等',
      maxHp: 100,
      hitDamage: 35,
      baseSpeed: 390,
      trapSpeedMult: 1.0,
      lagDrain: 40,
      lagRecharge: 30,
      rewindCd: 3.5,
      phaseCd: 0.4,
      shardHeal: 10,
      scoreMult: 1.2,
      bossHpMult: 1.0
    },
    hard: {
      key: 'hard',
      label: '困难',
      maxHp: 100,
      hitDamage: 50,
      baseSpeed: 470,
      trapSpeedMult: 1.25,
      lagDrain: 50,
      lagRecharge: 25,
      rewindCd: 4.0,
      phaseCd: 0.8,
      shardHeal: 8,
      scoreMult: 1.5,
      bossHpMult: 1.3
    }
  };

  const SECTOR_BIOMES = [
    {
      id: 'NEON_CACHE',
      name: 'Sector 01 · 霓虹缓存区',
      minDist: 0,
      wrapperClass: '',
      groundColor: '#00f3ff',
      gridColor: 'rgba(0, 243, 255, 0.22)',
      gravityMult: 1.0
    },
    {
      id: 'BSOD_ABYSS',
      name: 'Sector 02 · 蓝屏死机深渊',
      minDist: 450,
      wrapperClass: 'biome-bsod',
      groundColor: '#4da6ff',
      gridColor: 'rgba(77, 166, 255, 0.28)',
      gravityMult: 0.86 // 蓝屏深渊微低重力体验
    },
    {
      id: 'KERNEL_PANIC',
      name: 'Sector 03 · 内核熔毁炼狱',
      minDist: 950,
      wrapperClass: 'biome-kernel',
      groundColor: '#ff6a00',
      gridColor: 'rgba(255, 106, 0, 0.26)',
      gravityMult: 1.05
    }
  ];

  LH.Constants = {
    clamp,
    lerp,
    easeOutBack,
    easeOutCubic,
    shakeAxis,
    SeededRNG,
    JUMP_HEIGHT,
    TIME_TO_APEX,
    RISE_GRAVITY,
    JUMP_VELOCITY,
    FALL_MULTIPLIER,
    FALL_GRAVITY,
    APEX_THRESHOLD,
    APEX_GRAVITY_MULT,
    EARLY_RELEASE_CUT,
    MAX_FALL_SPEED,
    COYOTE_TIME,
    JUMP_BUFFER_TIME,
    REWIND_HISTORY_SEC,
    BASE_PHASE_DURATION,
    LAG_TIME_SCALE,
    SLASH_COOLDOWN,
    DIFFICULTY_CONFIGS,
    SECTOR_BIOMES
  };
})(window.LagHero);
