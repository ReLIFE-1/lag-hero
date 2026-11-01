window.LagHero = window.LagHero || {};

(function (LH) {
  const {
    clamp,
    lerp,
    SeededRNG,
    REWIND_HISTORY_SEC,
    LAG_TIME_SCALE,
    DIFFICULTY_CONFIGS,
    SECTOR_BIOMES
  } = LH.Constants;
  const { AGENT_CLASSES, SHOP_UPGRADES, QUEST_DEFINITIONS } = LH.ContentData;
  const {
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
  } = LH.CameraFX;
  const { audio, saveManager, vnSystem, rogueSystem, player, spawnObstaclePattern, bossManager } = LH;
  const { renderGame } = LH.Renderer;

  // ============================================================================
  // 1. 画布与全局游戏世界状态
  // ============================================================================
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const wrapperEl = document.getElementById('game-wrapper');

  let W = 1280;
  let H = 720;
  let GROUND_Y = 560;

  const game = {
    state: 'START', // 'START' | 'PLAYING' | 'PAUSED' | 'DRAFT' | 'GAMEOVER'
    difficulty: 'medium',
    seed: 'CYBER-2077',
    rng: new SeededRNG('CYBER-2077'),
    distance: 0,
    bonusScore: 0,
    runCoins: 0,
    runShards: 0,
    baseSpeed: 390,
    currentSpeed: 390,
    worldScrollX: 0,
    nextSpawnX: 680,
    currentBiome: SECTOR_BIOMES[0],
    bsodNotified: false,
    reached600Notified: false,

    // 神技一：主动卡死 (Lag Switch)
    lagActive: false,
    lagHoldDuration: 0,
    bandwidth: 100,
    bandwidthOverheated: false,

    // 神技二：丢包回溯 (Packet Loss)
    rewindCd: 0,
    historyBuffer: [],

    // 神技三：穿模滑铲 (Collision Glitch)
    phaseTimer: 0,
    phaseCd: 0,

    // 衍生属性缓存
    derivedStats: null,

    bgBuildings: [],
    dataLines: []
  };

  const entities = {
    obstacles: [],
    platforms: [],
    collectibles: [],
    projectiles: [],
    lastPatternIndex: -1
  };

  function getDiff() {
    return DIFFICULTY_CONFIGS[game.difficulty] || DIFFICULTY_CONFIGS.medium;
  }

  function initBackground() {
    game.bgBuildings = [];
    for (let i = 0; i < 18; i++) {
      game.bgBuildings.push({
        x: i * 150,
        w: 80 + Math.random() * 90,
        h: 120 + Math.random() * 240,
        layer: i % 2 === 0 ? 0.2 : 0.42,
        hue: i % 3 === 0 ? '#00f3ff' : (i % 3 === 1 ? '#ff0055' : '#b829ff')
      });
    }
    game.dataLines = [];
    for (let i = 0; i < 26; i++) {
      game.dataLines.push({
        x: Math.random() * W,
        y: 60 + Math.random() * (GROUND_Y - 100),
        len: 30 + Math.random() * 90,
        speed: 120 + Math.random() * 240
      });
    }
  }

  function resizeCanvas() {
    W = window.innerWidth || 1280;
    H = window.innerHeight || 720;
    canvas.width = W;
    canvas.height = H;
    GROUND_Y = Math.floor(H * 0.78);
    if (player.y > GROUND_Y) player.y = GROUND_Y;
    if (game.bgBuildings.length === 0) initBackground();
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // 构建传递给子系统的统一上下文对象
  const gameCtx = {
    game,
    player,
    get obstacles() { return entities.obstacles; },
    get platforms() { return entities.platforms; },
    get collectibles() { return entities.collectibles; },
    get projectiles() { return entities.projectiles; },
    get groundY() { return GROUND_Y; },
    get screenW() { return W; },
    bossManager,
    rogueSystem,
    saveManager,
    recomputePlayerStats() {
      game.derivedStats = saveManager.derivePlayerStats(game.difficulty, rogueSystem.runModifiers);
      player.applyDerivedStats(game.derivedStats, false);
    },
    onResumeFromModal() {
      clearFocus();
      lastTimestamp = performance.now();
    }
  };

  // ============================================================================
  // 2. 输入控制系统 (键盘 + 鼠标 + 触屏虚拟按键)
  // ============================================================================
  const input = {
    leftHeld: false,
    rightHeld: false,
    jumpPressedThisFrame: false,
    jumpReleasedThisFrame: false,
    jumpHeld: false,
    lagHeldKey: false,
    lagHeldPointer: false,
    rewindPressedThisFrame: false,
    phasePressedThisFrame: false,
    slashPressedThisFrame: false,

    get isLagHeld() {
      return this.lagHeldKey || this.lagHeldPointer;
    }
  };

  function triggerJumpInput(down) {
    const vbtn = document.getElementById('vbtn-jump');
    if (down) {
      if (!input.jumpHeld) input.jumpPressedThisFrame = true;
      input.jumpHeld = true;
      if (vbtn) vbtn.classList.add('pressed');
    } else {
      if (input.jumpHeld) input.jumpReleasedThisFrame = true;
      input.jumpHeld = false;
      if (vbtn) vbtn.classList.remove('pressed');
    }
  }

  window.addEventListener('keydown', (e) => {
    // 关键保护：在判断 e.repeat 前先 preventDefault，彻底杜绝长按空格触发按钮点击重置距离！
    const gameKeys = [
      'Space', 'Enter', 'Escape', 'KeyP',
      'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyE', 'KeyL',
      'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight',
      'KeyJ', 'KeyX', 'KeyK', 'KeyC',
      'ShiftLeft', 'ShiftRight', 'KeyQ',
      'Digit1', 'Digit2', 'Digit3'
    ];
    if (gameKeys.includes(e.code) && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
    }

    if (e.repeat) return;

    // 肉鸽三选一状态快捷键 1 / 2 / 3
    if (game.state === 'DRAFT') {
      if (e.code === 'Digit1') rogueSystem.pickCard(0, gameCtx);
      else if (e.code === 'Digit2') rogueSystem.pickCard(1, gameCtx);
      else if (e.code === 'Digit3') rogueSystem.pickCard(2, gameCtx);
      return;
    }

    // ESC 或 P 键：暂停 / 继续游戏
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (game.state === 'PLAYING') pauseGame();
      else if (game.state === 'PAUSED') resumeGame();
      return;
    }

    if (game.state === 'START' && e.code === 'Enter') {
      startGame();
      return;
    }
    if (game.state === 'GAMEOVER' && (e.code === 'Space' || e.code === 'Enter')) {
      startGame();
      return;
    }
    if (game.state !== 'PLAYING') return;

    // 若终端剧情开启，按 Enter 可快速推进对话
    if (vnSystem.active && e.code === 'Enter') {
      vnSystem.advance();
      return;
    }

    if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
      input.leftHeld = true;
    } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
      input.rightHeld = true;
    } else if (e.code === 'KeyW' || e.code === 'ArrowUp') {
      triggerJumpInput(true);
    } else if (e.code === 'Space') {
      input.lagHeldKey = true;
      document.getElementById('vbtn-lag')?.classList.add('pressed');
    } else if (e.code === 'KeyJ' || e.code === 'KeyX') {
      input.slashPressedThisFrame = true;
      document.getElementById('vbtn-slash')?.classList.add('pressed');
      if (typeof setTimeout === 'function') {
        setTimeout(() => document.getElementById('vbtn-slash')?.classList.remove('pressed'), 130);
      }
    } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyQ' || e.code === 'KeyK' || e.code === 'KeyC') {
      input.rewindPressedThisFrame = true;
      document.getElementById('vbtn-rewind')?.classList.add('pressed');
      if (typeof setTimeout === 'function') {
        setTimeout(() => document.getElementById('vbtn-rewind')?.classList.remove('pressed'), 140);
      }
    } else if (e.code === 'KeyS' || e.code === 'ArrowDown' || e.code === 'KeyE' || e.code === 'KeyL') {
      input.phasePressedThisFrame = true;
      document.getElementById('vbtn-phase')?.classList.add('pressed');
      if (typeof setTimeout === 'function') {
        setTimeout(() => document.getElementById('vbtn-phase')?.classList.remove('pressed'), 140);
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
      input.leftHeld = false;
    } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
      input.rightHeld = false;
    } else if (e.code === 'KeyW' || e.code === 'ArrowUp') {
      triggerJumpInput(false);
    } else if (e.code === 'Space') {
      input.lagHeldKey = false;
      document.getElementById('vbtn-lag')?.classList.remove('pressed');
    }
  });

  // 鼠标在画布上点击/长按
  canvas.addEventListener('pointerdown', (e) => {
    if (game.state !== 'PLAYING') return;
    if (e.button === 2) {
      input.slashPressedThisFrame = true;
    } else {
      input.lagHeldPointer = true;
      document.getElementById('vbtn-lag')?.classList.add('pressed');
    }
  });
  window.addEventListener('pointerup', () => {
    input.lagHeldPointer = false;
    document.getElementById('vbtn-lag')?.classList.remove('pressed');
  });

  function bindTouchButton(id, onDown, onUp) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      el.classList.add('pressed');
      onDown();
    });
    const release = (e) => {
      e.stopPropagation();
      el.classList.remove('pressed');
      if (onUp) onUp();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
  }

  bindTouchButton('vbtn-left', () => { input.leftHeld = true; }, () => { input.leftHeld = false; });
  bindTouchButton('vbtn-right', () => { input.rightHeld = true; }, () => { input.rightHeld = false; });
  bindTouchButton('vbtn-jump', () => triggerJumpInput(true), () => triggerJumpInput(false));
  bindTouchButton('vbtn-slash', () => { input.slashPressedThisFrame = true; });
  bindTouchButton('vbtn-lag', () => { input.lagHeldPointer = true; }, () => { input.lagHeldPointer = false; });
  bindTouchButton('vbtn-rewind', () => { input.rewindPressedThisFrame = true; });
  bindTouchButton('vbtn-phase', () => { input.phasePressedThisFrame = true; });

  // ============================================================================
  // 3. 主页中心 (Hub Tabs: 机体选择、黑市改装车间、悬赏任务馆)
  // ============================================================================
  function renderHubUI() {
    const p = saveManager.profile;

    // 同步顶部与主页钱包数值
    const hubCoins = document.getElementById('hub-coins');
    const hubShards = document.getElementById('hub-shards');
    if (hubCoins) hubCoins.textContent = p.coins;
    if (hubShards) hubShards.textContent = p.shards;

    // 1. 渲染三大特工机体卡片
    const classGrid = document.getElementById('class-grid');
    if (classGrid) {
      classGrid.innerHTML = '';
      Object.values(AGENT_CLASSES).forEach((cls) => {
        const unlocked = p.unlockedClasses.includes(cls.id);
        const selected = p.selectedClass === cls.id;
        const card = document.createElement('div');
        card.className = `class-card ${selected ? 'selected' : ''} ${!unlocked ? 'locked' : ''}`;
        card.innerHTML = `
          <div class="class-head">
            <span class="class-name" style="color:${cls.color}">${cls.name}</span>
            <span class="class-tag">${selected ? '当前出战' : (unlocked ? '已解锁' : `🪙 ${cls.costCoins} 解锁`)}</span>
          </div>
          <p class="class-desc">${cls.desc}</p>
        `;
        card.addEventListener('click', () => {
          audio.init();
          const res = saveManager.unlockOrSelectClass(cls.id);
          if (res.ok) {
            audio.playPickup(res.action === 'unlocked');
            renderHubUI();
          } else {
            audio.playHurt();
          }
        });
        classGrid.appendChild(card);
      });
    }

    // 2. 渲染黑市改装车间升级项
    const shopGrid = document.getElementById('shop-grid');
    if (shopGrid) {
      shopGrid.innerHTML = '';
      SHOP_UPGRADES.forEach((upg) => {
        const lvl = p.upgrades[upg.id] || 0;
        const isMax = lvl >= upg.maxLevel;
        const cost = upg.baseCost + lvl * upg.costStep;
        const currencyIcon = upg.currency === 'shards' ? '💠' : '🪙';
        const canAfford = upg.currency === 'shards' ? p.shards >= cost : p.coins >= cost;

        const item = document.createElement('div');
        item.className = 'shop-item';
        item.innerHTML = `
          <div>
            <div class="shop-item-head">
              <span class="shop-item-title">${upg.name}</span>
              <span class="shop-level-badge">Lv.${lvl} / ${upg.maxLevel}</span>
            </div>
            <p class="shop-item-desc">${upg.desc}</p>
          </div>
          <button type="button" class="shop-buy-btn" ${isMax || !canAfford ? 'disabled' : ''}>
            ${isMax ? '已满级 MAX' : `改装升级 (${currencyIcon} ${cost})`}
          </button>
        `;
        const btn = item.querySelector('button');
        btn.addEventListener('click', (e) => {
          if (e.currentTarget && typeof e.currentTarget.blur === 'function') e.currentTarget.blur();
          audio.init();
          const res = saveManager.buyShopUpgrade(upg.id);
          if (res.ok) {
            audio.playPickup(true);
            renderHubUI();
          }
        });
        shopGrid.appendChild(item);
      });
    }

    // 3. 渲染悬赏任务与成就馆
    const questGrid = document.getElementById('quest-grid');
    if (questGrid) {
      questGrid.innerHTML = '';
      QUEST_DEFINITIONS.forEach((qDef) => {
        const qState = p.quests[qDef.id] || { count: 0, done: false, claimed: false };
        const pct = clamp((qState.count / qDef.needed) * 100, 0, 100);
        const item = document.createElement('div');
        item.className = 'quest-item';
        item.innerHTML = `
          <div>
            <div class="shop-item-head">
              <span class="shop-item-title">${qDef.title}</span>
              <span class="shop-level-badge">${qState.count} / ${qDef.needed}</span>
            </div>
            <p class="shop-item-desc">${qDef.desc}</p>
            <div class="quest-progress-bar" style="margin-top:6px;">
              <div class="quest-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <button type="button" class="quest-claim-btn" ${!qState.done || qState.claimed ? 'disabled' : ''}>
            ${qState.claimed ? '✓ 已领取赏金' : (qState.done ? `🎁 领取 (🪙+${qDef.rewardCoins} 💠+${qDef.rewardShards})` : `悬赏: 🪙${qDef.rewardCoins} + 💠${qDef.rewardShards}`)}
          </button>
        `;
        const btn = item.querySelector('button');
        btn.addEventListener('click', (e) => {
          if (e.currentTarget && typeof e.currentTarget.blur === 'function') e.currentTarget.blur();
          if (saveManager.claimQuestReward(qDef.id)) {
            audio.playPickup(true);
            renderHubUI();
          }
        });
        questGrid.appendChild(item);
      });
    }
  }

  // 页签切换绑定
  document.querySelectorAll('.hub-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.currentTarget && typeof e.currentTarget.blur === 'function') e.currentTarget.blur();
      const targetTab = btn.getAttribute('data-tab');
      document.querySelectorAll('.hub-tab-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tab') === targetTab);
      });
      document.querySelectorAll('.hub-tab-content').forEach((panel) => {
        panel.classList.toggle('active', panel.id === targetTab);
      });
      renderHubUI();
    });
  });

  // 顶部与弹窗按钮绑定
  document.getElementById('btn-pause')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    if (game.state === 'PLAYING') pauseGame();
    else if (game.state === 'PAUSED') resumeGame();
  });

  document.getElementById('btn-bgm')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    audio.bgmEnabled = !audio.bgmEnabled;
    if (e && e.currentTarget) {
      e.currentTarget.textContent = `BGM: ${audio.bgmEnabled ? 'ON' : 'OFF'}`;
      e.currentTarget.classList.toggle('active', audio.bgmEnabled);
    }
  });

  document.getElementById('btn-sfx')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    audio.enabled = !audio.enabled;
    if (!audio.enabled) audio.stopLagDrone();
    if (e && e.currentTarget) {
      e.currentTarget.textContent = `SFX: ${audio.enabled ? 'ON' : 'OFF'}`;
      e.currentTarget.classList.toggle('active', audio.enabled);
    }
  });

  document.getElementById('btn-reduce-motion')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    camera.reduceMotion = !camera.reduceMotion;
    wrapperEl.classList.toggle('reduce-motion', camera.reduceMotion);
    if (e && e.currentTarget) {
      e.currentTarget.textContent = `减弱眩晕: ${camera.reduceMotion ? 'ON' : 'OFF'}`;
      e.currentTarget.classList.toggle('active', camera.reduceMotion);
    }
  });

  function selectDifficulty(diffKey) {
    if (!DIFFICULTY_CONFIGS[diffKey]) return;
    game.difficulty = diffKey;
    const cfg = getDiff();
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.classList.toggle('selected', btn.getAttribute('data-diff') === diffKey);
    });
    const diffTag = document.getElementById('hud-diff-tag');
    if (diffTag) diffTag.textContent = cfg.label;
  }

  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e && e.currentTarget) e.currentTarget.blur();
      audio.init();
      audio.playPickup(false);
      selectDifficulty(btn.getAttribute('data-diff'));
    });
  });

  document.getElementById('btn-start')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    if (game.state === 'PLAYING') return;
    startGame();
  });
  document.getElementById('btn-restart')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    if (game.state === 'PLAYING') return;
    startGame();
  });
  document.getElementById('btn-resume')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    resumeGame();
  });
  document.getElementById('btn-pause-restart')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    startGame();
  });
  document.getElementById('btn-pause-home')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    returnToHome();
  });
  document.getElementById('btn-go-home')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    returnToHome();
  });

  // VN 对话框交互绑定
  document.getElementById('vn-body-text')?.addEventListener('click', () => vnSystem.advance());
  document.getElementById('vn-btn-skip')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    vnSystem.skipAll();
  });
  document.getElementById('vn-btn-auto')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    vnSystem.toggleAuto();
  });
  document.getElementById('vn-btn-log')?.addEventListener('click', (e) => {
    if (e && e.currentTarget) e.currentTarget.blur();
    vnSystem.toggleBacklog();
  });

  // ============================================================================
  // 4. 游戏生命周期与三大时空神技实现
  // ============================================================================
  function clearFocus() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    if (typeof canvas.focus === 'function') {
      canvas.focus();
    }
  }

  function pauseGame() {
    if (game.state !== 'PLAYING') return;
    clearFocus();
    game.state = 'PAUSED';
    game.lagActive = false;
    input.lagHeldKey = false;
    input.lagHeldPointer = false;
    input.jumpHeld = false;
    input.leftHeld = false;
    input.rightHeld = false;
    wrapperEl.classList.remove('lag-active');
    audio.stopLagDrone();

    const diffCfg = getDiff();
    const totalScore = Math.floor((Math.floor(game.distance) + game.bonusScore) * diffCfg.scoreMult);
    document.getElementById('pause-distance').textContent = `${Math.floor(game.distance)}m`;
    document.getElementById('pause-score').textContent = totalScore;
    document.getElementById('pause-hp').textContent = `${Math.ceil(player.hp)}/${player.maxHp}`;
    document.getElementById('pause-modal').classList.remove('hidden');
  }

  function resumeGame() {
    if (game.state !== 'PAUSED') return;
    clearFocus();
    document.getElementById('pause-modal').classList.add('hidden');
    lastTimestamp = performance.now();
    game.state = 'PLAYING';
  }

  function returnToHome() {
    clearFocus();
    game.state = 'START';
    game.lagActive = false;
    game.phaseTimer = 0;
    input.lagHeldKey = false;
    input.lagHeldPointer = false;
    input.jumpHeld = false;
    input.leftHeld = false;
    input.rightHeld = false;
    wrapperEl.classList.remove('lag-active', 'phase-active', 'biome-bsod', 'biome-kernel');
    audio.stopLagDrone();
    audio.stopBGM();
    vnSystem.closeVN();

    document.getElementById('pause-modal').classList.add('hidden');
    document.getElementById('perk-modal').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    document.getElementById('start-modal').classList.remove('hidden');
    renderHubUI();
  }

  function startGame() {
    clearFocus();
    audio.init();
    audio.bgmMode = 'normal';
    audio.startBGM();

    document.getElementById('start-modal').classList.add('hidden');
    document.getElementById('pause-modal').classList.add('hidden');
    document.getElementById('perk-modal').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    document.getElementById('boss-hp-wrap')?.classList.add('hidden');

    const seedInput = document.getElementById('seed-input');
    const seedVal = seedInput && seedInput.value.trim() ? seedInput.value.trim() : `LAG-${Math.floor(Math.random() * 9000 + 1000)}`;
    game.seed = seedVal;
    game.rng.setSeed(seedVal);

    const diffCfg = getDiff();
    document.getElementById('hud-diff-tag').textContent = diffCfg.label;

    rogueSystem.resetRun(game.rng);
    bossManager.reset();
    game.derivedStats = saveManager.derivePlayerStats(game.difficulty, rogueSystem.runModifiers);

    game.state = 'PLAYING';
    game.distance = 0;
    game.bonusScore = 0;
    game.runCoins = 0;
    game.runShards = 0;
    game.baseSpeed = diffCfg.baseSpeed;
    game.currentSpeed = game.baseSpeed;
    game.worldScrollX = 0;
    game.nextSpawnX = 720;
    game.currentBiome = SECTOR_BIOMES[0];
    game.bsodNotified = false;
    game.reached600Notified = false;

    game.lagActive = false;
    game.lagHoldDuration = 0;
    game.bandwidth = 100;
    game.bandwidthOverheated = false;
    game.rewindCd = 0;
    game.historyBuffer = [];
    game.phaseTimer = 0;
    game.phaseCd = 0;

    input.lagHeldKey = false;
    input.lagHeldPointer = false;
    input.leftHeld = false;
    input.rightHeld = false;
    wrapperEl.classList.remove('lag-active', 'phase-active', 'biome-bsod', 'biome-kernel');

    player.reset(GROUND_Y, game.derivedStats);

    entities.obstacles = [];
    entities.platforms = [];
    entities.collectibles = [];
    entities.projectiles = [];
    entities.lastPatternIndex = -1;
    particles.length = 0;
    popTexts.length = 0;
    rewindGhosts.length = 0;
    shockwaves.length = 0;

    while (game.nextSpawnX < W + 900) {
      game.nextSpawnX = spawnObstaclePattern(
        game.nextSpawnX,
        GROUND_Y,
        game.difficulty,
        game.distance,
        game.rng,
        entities
      );
    }

    // 触发开局赛博终端通讯剧情（含初始战术分支选择）
    vnSystem.startScript('prologue', null, (choiceFx) => {
      if (choiceFx.type === 'buff_slash') {
        rogueSystem.runModifiers.push({
          stat: 'slashDamagePct',
          type: 'percent',
          value: choiceFx.value,
          source: 'vn_prologue'
        });
        gameCtx.recomputePlayerStats();
        if (choiceFx.coins) {
          game.runCoins += choiceFx.coins;
          saveManager.addCurrency(choiceFx.coins, 0);
        }
        spawnPopText(player.x + 30, player.y - 80, '🗡️ 激进超频已挂载!', '#ffe600', 16);
      } else if (choiceFx.type === 'buff_shield') {
        player.shields += choiceFx.value || 1;
        spawnPopText(player.x + 30, player.y - 80, '🛡️ 冗余护盾 +1!', '#b829ff', 16);
      }
    });
  }

  function gameOver(reasonText) {
    clearFocus();
    game.state = 'GAMEOVER';
    game.lagActive = false;
    game.phaseTimer = 0;
    input.lagHeldKey = false;
    input.lagHeldPointer = false;
    input.leftHeld = false;
    input.rightHeld = false;
    wrapperEl.classList.remove('lag-active', 'phase-active');
    audio.playCrash();
    audio.stopBGM();
    vnSystem.closeVN();
    triggerFeedback(player.x + player.width / 2, player.y - player.height / 2, 'large', '#ff0055');

    const diffCfg = getDiff();
    const finalDist = Math.floor(game.distance);
    const totalScore = Math.floor((finalDist + game.bonusScore) * diffCfg.scoreMult);

    if (totalScore > saveManager.profile.bestScore) {
      saveManager.profile.bestScore = totalScore;
    }
    if (finalDist > saveManager.profile.bestDistance) {
      saveManager.profile.bestDistance = finalDist;
    }
    saveManager.saveProfile();

    document.getElementById('death-reason').textContent = `${reasonText}（难度：${diffCfg.label} · 倍率 ${diffCfg.scoreMult}x）`;
    document.getElementById('go-distance').textContent = `${finalDist}m`;
    document.getElementById('go-score').textContent = totalScore;
    document.getElementById('go-coins').textContent = `+${game.runCoins} 🪙 / +${game.runShards} 💠`;
    document.getElementById('go-best').textContent = saveManager.profile.bestScore;
    document.getElementById('hud-best').textContent = `BEST: ${saveManager.profile.bestScore}`;

    document.getElementById('gameover-modal').classList.remove('hidden');
  }

  // 记录 1.5s 环形历史队列，用于【丢包回溯】
  function recordHistorySnapshot(nowSec) {
    game.historyBuffer.push({
      t: nowSec,
      worldScrollX: game.worldScrollX,
      distance: game.distance,
      playerX: player.x,
      playerY: player.y,
      playerVy: player.vy,
      playerHp: player.hp,
      onGround: player.onGround,
      jumpsLeft: player.jumpsLeft
    });

    const cutoff = nowSec - (REWIND_HISTORY_SEC + 0.15);
    while (game.historyBuffer.length > 0 && game.historyBuffer[0].t < cutoff) {
      game.historyBuffer.shift();
    }
  }

  function activatePacketLossRewind() {
    if (game.rewindCd > 0 || game.historyBuffer.length < 4) return;

    const diffCfg = getDiff();
    const targetSnap = game.historyBuffer[0];
    const deltaScroll = game.worldScrollX - targetSnap.worldScrollX;
    if (deltaScroll <= 5) return;

    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const idx = Math.floor(((steps - i) / steps) * (game.historyBuffer.length - 1));
      const snap = game.historyBuffer[idx];
      const ghostOffsetX = snap.worldScrollX - targetSnap.worldScrollX;
      rewindGhosts.push({
        x: player.x + ghostOffsetX,
        y: snap.playerY,
        w: player.width,
        h: player.normalHeight,
        alpha: 0.78 * (i / steps),
        life: 0,
        maxLife: 0.42 + i * 0.05
      });
    }

    for (const obs of entities.obstacles) {
      obs.x += deltaScroll;
      if (obs.type === 'FALLING_ROCK') {
        obs.y = GROUND_Y - 320;
        obs.vy = 0;
        obs.triggered = false;
        obs.landed = false;
      }
    }
    for (const plat of entities.platforms) plat.x += deltaScroll;
    for (const item of entities.collectibles) item.x += deltaScroll;
    game.nextSpawnX += deltaScroll;

    const hpRestored = targetSnap.playerHp > player.hp ? (targetSnap.playerHp - player.hp) : 0;
    game.worldScrollX = targetSnap.worldScrollX;
    game.distance = targetSnap.distance;
    player.y = targetSnap.playerY;
    player.vy = targetSnap.playerVy;
    if (targetSnap.playerHp > player.hp) {
      player.hp = targetSnap.playerHp;
    }
    player.onGround = targetSnap.onGround;
    player.jumpsLeft = player.maxJumps;
    player.invulnTimer = 0.55;
    player.flashTimer = 0.25;
    player.triggerPop(1.38, 0.68, 0.22);

    game.historyBuffer = [];
    game.rewindCd = diffCfg.rewindCd;

    camera.snowStaticTimer = 0.28;
    camera.addVertigo(0.85);
    audio.playRewind();
    triggerFeedback(player.x + player.width / 2, player.y - player.height / 2, 'medium', '#00ff88');
    const rewindLabel = hpRestored > 0
      ? `⏪ 丢包回溯 -1.5s (挽回 +${hpRestored} HP!)`
      : '⏪ 丢包回溯 -1.5s!';
    spawnPopText(player.x + 20, player.y - 70, rewindLabel, '#00ff88', 17);

    saveManager.recordEvent('use_rewind', 1);
    rogueSystem.fireTrigger('on_rewind', gameCtx);
  }

  function activatePhaseSlide() {
    if (game.phaseCd > 0) return;

    const diffCfg = getDiff();
    const dur = game.derivedStats ? game.derivedStats.phaseDuration : 2.2;
    game.phaseTimer = dur;
    game.phaseCd = diffCfg.phaseCd;
    player.height = player.slideHeight;
    player.triggerPop(1.42, 0.56, 0.20);
    wrapperEl.classList.add('phase-active');

    if (!player.onGround && player.vy < 340) {
      player.vy = 340;
    }

    audio.playPhaseGlitch(false);
    triggerFeedback(player.x + player.width / 2, player.y - player.height / 2, 'medium', '#b829ff');
    spawnPopText(player.x + 20, player.y - 60, `⚡ 穿模态 ON (${dur.toFixed(1)}s)`, '#b829ff', 17);
  }

  // ============================================================================
  // 5. 几何碰撞工具
  // ============================================================================
  function rectOverlap(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function checkLineRectCollision(x1, y1, x2, y2, rx, ry, rw, rh) {
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      if (px >= rx && px <= rx + rw && py >= ry && py <= ry + rh) {
        return true;
      }
    }
    return false;
  }

  function handlePlayerHit(reason, diffCfg) {
    // 优先消耗【冗余故障护盾】免伤！
    if (player.shields > 0) {
      player.shields--;
      player.invulnTimer = 1.2;
      player.flashTimer = 0.35;
      audio.playPhaseGlitch(true);
      triggerFeedback(player.x + player.width / 2, player.y - player.height / 2, 'medium', '#b829ff');
      spawnPopText(player.x + 20, player.y - 75, `🛡️ 故障护盾抵挡! (剩余 ${player.shields})`, '#b829ff', 17);
      return;
    }

    player.hp = Math.max(0, player.hp - diffCfg.hitDamage);
    if (player.hp <= 0) {
      gameOver(`致命碰撞：撞上【${reason}】导致连接中断`);
    } else {
      player.invulnTimer = 1.15;
      player.flashTimer = 0.35;
      player.triggerPop(1.35, 0.72, 0.22);
      if (player.vy > -220) player.vy = -340;
      audio.playHurt();
      triggerFeedback(player.x + player.width / 2, player.y - player.height / 2, 'medium', '#ff0055');
      spawnPopText(
        player.x + 20,
        player.y - 75,
        `-${diffCfg.hitDamage} HP! (按 SHIFT 丢包回溯可挽回!)`,
        '#ff0055',
        16
      );
    }
  }

  // ============================================================================
  // 6. 主物理与逻辑更新循环
  // ============================================================================
  let lastTimestamp = performance.now();
  let elapsedGameTime = 0;

  function update(now) {
    const rawDt = Math.min(0.05, (now - lastTimestamp) / 1000);
    lastTimestamp = now;

    camera.update(rawDt);
    vnSystem.update(rawDt);

    const hitStopScale = hitStopState.getScale(now);
    const dt = rawDt * hitStopScale;

    if (game.state === 'PLAYING') {
      elapsedGameTime += dt;
      const diffCfg = getDiff();
      const dStats = game.derivedStats || saveManager.derivePlayerStats(game.difficulty, rogueSystem.runModifiers);

      player.trailHp = lerp(player.trailHp, player.hp, Math.min(1, rawDt * 6.5));

      // 1. 处理【神技一：主动卡死 (Lag Switch)】
      const wasLagActive = game.lagActive;
      if (input.isLagHeld && !game.bandwidthOverheated && game.bandwidth > 0) {
        game.lagActive = true;
        game.lagHoldDuration += rawDt;
        game.bandwidth = Math.max(0, game.bandwidth - dStats.lagDrain * rawDt);
        if (game.bandwidth <= 0) {
          game.bandwidthOverheated = true;
          game.lagActive = false;
          spawnPopText(player.x + 20, player.y - 80, 'BANDWIDTH EXHAUSTED!', '#ff0055', 15);
        }
      } else {
        game.lagActive = false;
        game.bandwidth = Math.min(100, game.bandwidth + dStats.lagRecharge * rawDt);
        if (game.bandwidthOverheated && game.bandwidth >= 25) {
          game.bandwidthOverheated = false;
        }
      }

      if (game.lagActive) {
        wrapperEl.classList.add('lag-active');
        audio.startLagDrone();
        audio.bgmMode = 'lag';
        camera.addTrauma(0.52 * rawDt);
        camera.chromaticPunch = Math.max(camera.chromaticPunch, 0.92);
        camera.vertigoAmount = Math.min(1, camera.vertigoAmount + rawDt * 3.5);
        camera.stutterTick += rawDt;
      } else {
        wrapperEl.classList.remove('lag-active');
        audio.stopLagDrone();
        audio.bgmMode = bossManager.activeBoss ? 'boss' : 'normal';
        if (wasLagActive) {
          // 松开主动卡死瞬间：引爆积蓄的【卡顿残影斩】并触发【DDoS 脉冲新星】
          player.detonateQueuedLagSlashes(gameCtx);
          if (game.lagHoldDuration >= 0.35) {
            rogueSystem.fireTrigger('on_lag_end', gameCtx);
          }
          game.lagHoldDuration = 0;
        }
      }

      // 2. 处理技能输入与冷却
      if (game.rewindCd > 0) game.rewindCd = Math.max(0, game.rewindCd - rawDt);
      if (game.phaseTimer <= 0 && game.phaseCd > 0) {
        game.phaseCd = Math.max(0, game.phaseCd - rawDt);
      }

      if (input.slashPressedThisFrame) {
        player.performSlash(gameCtx);
      }
      if (input.rewindPressedThisFrame) {
        activatePacketLossRewind();
      }
      if (input.phasePressedThisFrame) {
        activatePhaseSlide();
      }

      if (game.phaseTimer > 0) {
        game.phaseTimer = Math.max(0, game.phaseTimer - rawDt);
        player.height = player.slideHeight;
        rogueSystem.fireTrigger('on_phase_tick', gameCtx);
        if (game.phaseTimer <= 0) {
          player.height = player.normalHeight;
          player.triggerPop(0.82, 1.22, 0.16);
          wrapperEl.classList.remove('phase-active');
        }
      }

      // 3. 时间流速与世界卷轴推进
      const trapTimeScale = game.lagActive ? LAG_TIME_SCALE : 1.0;
      const scrollTimeScale = game.lagActive ? 0.28 : 1.0;
      const playerPhysicsDt = dt * (game.lagActive ? 0.42 : 1.0);

      const speedMultiplier = 1 + Math.min(0.85, game.distance / 1800);
      game.currentSpeed = game.baseSpeed * speedMultiplier;
      const dx = game.currentSpeed * dt * scrollTimeScale;

      game.worldScrollX += dx;
      game.distance += dx / 48;

      // 检查多主题赛博扇区切换 (`Sector Biomes`)
      for (let i = SECTOR_BIOMES.length - 1; i >= 0; i--) {
        if (game.distance >= SECTOR_BIOMES[i].minDist) {
          if (game.currentBiome.id !== SECTOR_BIOMES[i].id) {
            game.currentBiome = SECTOR_BIOMES[i];
            wrapperEl.classList.remove('biome-bsod', 'biome-kernel');
            if (game.currentBiome.wrapperClass) {
              wrapperEl.classList.add(game.currentBiome.wrapperClass);
            }
            spawnPopText(W / 2, 160, `🌐 进入 ${game.currentBiome.name}`, '#00f3ff', 20);
            if (game.currentBiome.id === 'BSOD_ABYSS' && !game.bsodNotified) {
              game.bsodNotified = true;
              vnSystem.startScript('sector_bsod');
            }
          }
          break;
        }
      }

      if (!game.reached600Notified && game.distance >= 600) {
        game.reached600Notified = true;
        saveManager.recordEvent('reach_600m', 1);
      }

      // 检查是否到达 Roguelike 故障协议三选一里程碑
      if (game.distance >= rogueSystem.nextDraftDistance && !bossManager.activeBoss) {
        rogueSystem.nextDraftDistance += rogueSystem.draftStep;
        rogueSystem.openDraftModal(
          gameCtx,
          `突破 ${Math.floor(game.distance)}m · 内存溢出！请选择 1 项故障协议注入`
        );
      }

      // 检查是否触发阶段性 Boss 战
      bossManager.checkSpawnBoss(game.distance, game.difficulty, W, GROUND_Y, (boss, count) => {
        if (count === 1) {
          vnSystem.startScript('boss_intro_1');
        }
      });

      // 4. 更新玩家物理与跳跃
      player.updatePhysics(
        playerPhysicsDt,
        rawDt,
        input,
        GROUND_Y,
        W,
        game.currentBiome.gravityMult,
        entities.platforms,
        gameCtx
      );

      // 5. 更新 Boss 战与弹幕
      bossManager.update(dt, rawDt, trapTimeScale, gameCtx);
      bossManager.checkBossDefeated(gameCtx);

      // 6. 更新障碍物、无人机、平台与收集物
      const pRect = {
        x: player.x + 5,
        y: player.y - player.height + 4,
        w: player.width - 10,
        h: player.height - 8
      };

      // Boss 横扫激光碰撞判定
      if (
        bossManager.activeBoss &&
        bossManager.activeBoss.laserActiveTimer > 0 &&
        game.phaseTimer <= 0 &&
        player.invulnTimer <= 0
      ) {
        const ly = bossManager.activeBoss.laserY;
        if (pRect.y < ly + 12 && pRect.y + pRect.h > ly - 12) {
          handlePlayerHit(bossManager.activeBoss.name + '的高能激光', diffCfg);
        }
      }

      // 弹幕更新与碰撞
      for (let i = entities.projectiles.length - 1; i >= 0; i--) {
        const proj = entities.projectiles[i];
        const pScale = proj.deflected ? 1.0 : trapTimeScale;
        proj.x += proj.vx * dt * pScale;
        proj.y += proj.vy * dt * pScale;

        if (proj.deflected && bossManager.activeBoss) {
          const b = bossManager.activeBoss;
          if (
            proj.x + proj.r > b.x - b.w / 2 &&
            proj.x - proj.r < b.x + b.w / 2 &&
            proj.y + proj.r > b.y - b.h / 2 &&
            proj.y - proj.r < b.y + b.h / 2
          ) {
            bossManager.damageBoss(85, player);
            entities.projectiles.splice(i, 1);
            continue;
          }
        } else if (!proj.deflected && game.phaseTimer <= 0 && player.invulnTimer <= 0) {
          if (
            proj.x + proj.r > pRect.x &&
            proj.x - proj.r < pRect.x + pRect.w &&
            proj.y + proj.r > pRect.y &&
            proj.y - proj.r < pRect.y + pRect.h
          ) {
            entities.projectiles.splice(i, 1);
            handlePlayerHit('敌方数据弹幕', diffCfg);
            continue;
          }
        }

        if (proj.x < -80 || proj.x > W + 120) {
          entities.projectiles.splice(i, 1);
        }
      }

      for (let i = entities.platforms.length - 1; i >= 0; i--) {
        entities.platforms[i].x -= dx;
        if (entities.platforms[i].x + entities.platforms[i].w < -150) {
          entities.platforms.splice(i, 1);
        }
      }

      for (let i = entities.obstacles.length - 1; i >= 0; i--) {
        const obs = entities.obstacles[i];
        obs.x -= dx;

        if (obs.type === 'LASER_SPINNER') {
          obs.angle += obs.angularSpeed * dt * trapTimeScale;
        } else if (obs.type === 'SLAM_GATE') {
          obs.phase += obs.freq * dt * trapTimeScale;
          obs.openRatio = (Math.sin(obs.phase) + 1) * 0.5;
        } else if (obs.type === 'FALLING_ROCK') {
          if (!obs.triggered && obs.x - player.x < 280) {
            obs.triggered = true;
          }
          if (obs.triggered && !obs.landed) {
            obs.vy += 1750 * dt * trapTimeScale;
            obs.y += obs.vy * dt * trapTimeScale;
            if (obs.y + obs.h >= GROUND_Y) {
              obs.y = GROUND_Y - obs.h;
              obs.landed = true;
              camera.addTrauma(0.28);
              spawnParticles(obs.x + obs.w / 2, GROUND_Y, 10, '#ff7700', 0.9);
            }
          }
        } else if (obs.type === 'CYBER_DRONE') {
          obs.phase += dt * trapTimeScale * 3.5;
          obs.y = obs.baseY + Math.sin(obs.phase) * 26;
          obs.fireCd -= dt * trapTimeScale;
          if (obs.fireCd <= 0 && obs.x > player.x + 80 && obs.x < W - 40) {
            obs.fireCd = 1.6;
            entities.projectiles.push({
              x: obs.x,
              y: obs.y + obs.h / 2,
              vx: -320,
              vy: 0,
              r: 10,
              color: '#ff0055',
              deflected: false,
              damage: 25
            });
          }
        }

        // 碰撞检测
        let hit = false;
        let hitName = '';

        if (obs.type === 'LASER_SPINNER') {
          const cosA = Math.cos(obs.angle);
          const sinA = Math.sin(obs.angle);
          const x1 = obs.x - cosA * obs.radius;
          const y1 = obs.y - sinA * obs.radius;
          const x2 = obs.x + cosA * obs.radius;
          const y2 = obs.y + sinA * obs.radius;
          if (checkLineRectCollision(x1, y1, x2, y2, pRect.x, pRect.y, pRect.w, pRect.h)) {
            hit = true;
            hitName = '高速旋转激光';
          }
        } else if (obs.type === 'FIREWALL') {
          if (rectOverlap(pRect, obs)) {
            hit = true;
            hitName = '实心电网防火墙';
          }
        } else if (obs.type === 'SLAM_GATE') {
          const currentGateH = obs.maxH * (1 - obs.openRatio * 0.65);
          const gateRect = { x: obs.x, y: GROUND_Y - currentGateH, w: obs.w, h: currentGateH };
          if (rectOverlap(pRect, gateRect)) {
            hit = true;
            hitName = '高频下落闸门';
          }
        } else if (obs.type === 'FALLING_ROCK') {
          if (rectOverlap(pRect, obs)) {
            hit = true;
            hitName = '突发数据落石';
          }
        } else if (obs.type === 'SPIKE') {
          if (rectOverlap(pRect, obs)) {
            hit = true;
            hitName = '地面高压电刺';
          }
        } else if (obs.type === 'CYBER_DRONE') {
          if (rectOverlap(pRect, obs)) {
            hit = true;
            hitName = '赛博巡逻无人机';
          }
        }

        if (hit) {
          if (game.phaseTimer > 0) {
            // 【神技三·穿模滑铲】虚化穿透障碍物！
            if (!obs.phasedThrough) {
              obs.phasedThrough = true;
              game.bonusScore += 35;
              audio.playPhaseGlitch(true);
              spawnParticles(player.x + player.width, player.y - 16, 12, '#00f3ff', 1.1, 'glitch');
              spawnPopText(player.x + 25, player.y - 45, 'GLITCH PHASE +35', '#00f3ff', 14);
              saveManager.recordEvent('phase_through', 1);
            }
          } else if (player.invulnTimer <= 0) {
            handlePlayerHit(hitName, diffCfg);
          }
        }

        if (obs.x < -250) {
          entities.obstacles.splice(i, 1);
        }
      }

      // 7. 收集物（数据金币 & 隐藏 Bug 碎片）磁吸与拾取
      for (let i = entities.collectibles.length - 1; i >= 0; i--) {
        const item = entities.collectibles[i];
        item.x -= dx;

        const cx = player.x + player.width / 2;
        const cy = player.y - player.height / 2;
        const dist = Math.hypot(item.x - cx, item.y - cy);
        const attractDist = item.type === 'BUG_SHARD' && game.phaseTimer > 0
          ? Math.max(96, player.magnetRadius * 1.6)
          : player.magnetRadius;

        if (dist < attractDist + 45 && dist > 5) {
          item.x += ((cx - item.x) / dist) * 380 * rawDt;
          item.y += ((cy - item.y) / dist) * 380 * rawDt;
        }

        if (!item.collected && dist < attractDist) {
          item.collected = true;
          const mult = player.lootMultiplier || 1;
          if (item.type === 'BUG_SHARD') {
            game.bonusScore += 120 * mult;
            game.runShards += 1 * mult;
            saveManager.addCurrency(0, 1 * mult);
            saveManager.recordEvent('collect_shard', 1);
            const healAmt = Math.min(player.maxHp - player.hp, diffCfg.shardHeal);
            player.hp = Math.min(player.maxHp, player.hp + diffCfg.shardHeal);
            audio.playPickup(true);
            triggerFeedback(item.x, item.y, 'medium', '#ff0055');
            const healStr = healAmt > 0 ? ` (+${healAmt} HP)` : '';
            spawnPopText(item.x, item.y - 20, `💠 BUG 碎片 +${120 * mult}${healStr}`, '#ff0055', 16);
            rogueSystem.fireTrigger('on_kill_or_shard', gameCtx);
          } else {
            game.bonusScore += 25 * mult;
            game.runCoins += 1 * mult;
            saveManager.addCurrency(1 * mult, 0);
            audio.playPickup(false);
            triggerFeedback(item.x, item.y, 'small', '#ffe600');
            spawnPopText(item.x, item.y - 16, `🪙 +${25 * mult}`, '#ffe600', 14);
          }
        }

        if (item.collected || item.x < -100) {
          entities.collectibles.splice(i, 1);
        }
      }

      // 动态生成前方关卡（Boss 在场时减少普通密集墙体生成）
      game.nextSpawnX -= dx;
      while (game.nextSpawnX < W + 700) {
        if (bossManager.activeBoss) {
          game.nextSpawnX += 380;
        } else {
          game.nextSpawnX = spawnObstaclePattern(
            game.nextSpawnX,
            GROUND_Y,
            game.difficulty,
            game.distance,
            game.rng,
            entities
          );
        }
      }

      recordHistorySnapshot(elapsedGameTime);
    }

    // 粒子、浮动文字、残影与冲击波更新
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += rawDt;
      p.x += p.vx * rawDt;
      p.y += p.vy * rawDt;
      p.vy += 460 * rawDt;
      if (p.life >= p.maxLife) particles.splice(i, 1);
    }

    for (let i = popTexts.length - 1; i >= 0; i--) {
      const pt = popTexts[i];
      pt.life += rawDt;
      pt.y -= 42 * rawDt;
      if (pt.life >= pt.maxLife) popTexts.splice(i, 1);
    }

    for (let i = rewindGhosts.length - 1; i >= 0; i--) {
      rewindGhosts[i].life += rawDt;
      if (rewindGhosts[i].life >= rewindGhosts[i].maxLife) {
        rewindGhosts.splice(i, 1);
      }
    }

    for (let i = shockwaves.length - 1; i >= 0; i--) {
      shockwaves[i].life += rawDt;
      if (shockwaves[i].life >= shockwaves[i].maxLife) {
        shockwaves.splice(i, 1);
      }
    }

    // 重置单帧触发标志
    input.jumpPressedThisFrame = false;
    input.jumpReleasedThisFrame = false;
    input.rewindPressedThisFrame = false;
    input.phasePressedThisFrame = false;
    input.slashPressedThisFrame = false;

    updateHUD();
    renderGame(ctx, W, H, GROUND_Y, gameCtx);
    requestAnimationFrame(update);
  }

  // ============================================================================
  // 7. HUD 界面状态同步
  // ============================================================================
  function updateHUD() {
    const diffCfg = getDiff();
    const distInt = Math.floor(game.distance);
    const totalScore = Math.floor((distInt + game.bonusScore) * diffCfg.scoreMult);

    document.getElementById('hud-distance').textContent = `${distInt}m`;
    document.getElementById('hud-score').textContent = totalScore;
    document.getElementById('hud-speed').textContent = `SPEED: ${(game.currentSpeed / 390).toFixed(1)}x`;
    document.getElementById('hud-best').textContent = `BEST: ${saveManager.profile.bestScore}`;

    const hudCoins = document.getElementById('hud-coins');
    const hudShards = document.getElementById('hud-shards');
    const hudSector = document.getElementById('hud-sector');
    if (hudCoins) hudCoins.textContent = saveManager.profile.coins;
    if (hudShards) hudShards.textContent = saveManager.profile.shards;
    if (hudSector && game.currentBiome) hudSector.textContent = game.currentBiome.name;

    // 生命值与护盾更新
    const hpPct = clamp((player.hp / player.maxHp) * 100, 0, 100);
    const hpFill = document.getElementById('hp-fill');
    const hpTrail = document.getElementById('hp-trail');
    const hpText = document.getElementById('hp-text');
    const shieldTag = document.getElementById('hud-shield-tag');
    if (hpFill) {
      hpFill.style.width = `${hpPct}%`;
      hpFill.classList.toggle('hp-warn', hpPct <= 60 && hpPct > 30);
      hpFill.classList.toggle('hp-danger', hpPct <= 30);
    }
    if (hpTrail) hpTrail.style.width = `${hpPct}%`;
    if (hpText) hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
    if (shieldTag) {
      shieldTag.textContent = player.shields > 0 ? `🛡️x${player.shields}` : '';
      shieldTag.style.display = player.shields > 0 ? 'inline-block' : 'none';
    }

    // 带宽能量槽
    const bwFill = document.getElementById('bandwidth-fill');
    const bwText = document.getElementById('bandwidth-text');
    if (bwFill) {
      bwFill.style.width = `${game.bandwidth}%`;
      bwFill.classList.toggle('draining', game.lagActive);
      bwFill.classList.toggle('overheated', game.bandwidthOverheated);
    }
    if (bwText) {
      bwText.textContent = game.bandwidthOverheated ? 'OVERHEATED!' : `${Math.ceil(game.bandwidth)}%`;
    }

    // Ping 监控器
    const pingBox = document.getElementById('ping-box');
    const pingText = document.getElementById('ping-text');
    if (pingBox && pingText) {
      if (game.lagActive) {
        pingBox.classList.add('lag-danger');
        const fakeFps = 2 + Math.floor(Math.abs(Math.sin(performance.now() * 0.02)) * 5);
        pingText.textContent = `Ping: 999ms! | FPS: ${fakeFps} [卡顿]`;
      } else {
        pingBox.classList.remove('lag-danger');
        const jitter = 23 + Math.floor(Math.sin(performance.now() * 0.005) * 3);
        pingText.textContent = `Ping: ${jitter}ms | 60 FPS`;
      }
    }

    // 卡顿斩状态显示
    const badgeSlash = document.getElementById('badge-slash');
    const timerSlash = document.getElementById('timer-slash');
    if (badgeSlash && timerSlash) {
      if (game.lagActive) {
        badgeSlash.classList.add('ready');
        timerSlash.textContent = `积蓄 ${player.queuedLagSlashes.length}/${player.maxLagSlashes}`;
        timerSlash.style.color = '#ffe600';
      } else if (player.slashCd > 0) {
        badgeSlash.classList.remove('ready');
        timerSlash.textContent = `${player.slashCd.toFixed(1)}s`;
        timerSlash.style.color = '#ff6b8b';
      } else {
        badgeSlash.classList.add('ready');
        timerSlash.textContent = 'READY';
        timerSlash.style.color = '#00ff88';
      }
    }

    // 丢包回溯冷却显示
    const badgeRewind = document.getElementById('badge-rewind');
    const timerRewind = document.getElementById('timer-rewind');
    const cdRewind = document.getElementById('cd-rewind');
    const vcdRewind = document.getElementById('vcd-rewind');
    if (badgeRewind && timerRewind && cdRewind && vcdRewind) {
      if (game.rewindCd > 0) {
        badgeRewind.classList.remove('ready');
        timerRewind.textContent = `${game.rewindCd.toFixed(1)}s`;
        timerRewind.style.color = '#ff6b8b';
        const pct = (game.rewindCd / diffCfg.rewindCd) * 100;
        cdRewind.style.height = `${pct}%`;
        vcdRewind.style.height = `${pct}%`;
      } else {
        badgeRewind.classList.add('ready');
        timerRewind.textContent = 'READY';
        timerRewind.style.color = '#00ff88';
        cdRewind.style.height = '0%';
        vcdRewind.style.height = '0%';
      }
    }

    // 穿模滑铲冷却显示
    const badgePhase = document.getElementById('badge-phase');
    const timerPhase = document.getElementById('timer-phase');
    const cdPhase = document.getElementById('cd-phase');
    const vcdPhase = document.getElementById('vcd-phase');
    if (badgePhase && timerPhase && cdPhase && vcdPhase) {
      if (game.phaseTimer > 0) {
        badgePhase.classList.add('ready');
        timerPhase.textContent = `穿模 ${game.phaseTimer.toFixed(1)}s`;
        timerPhase.style.color = '#ffe600';
        cdPhase.style.height = '0%';
        vcdPhase.style.height = '0%';
      } else if (game.phaseCd > 0 && diffCfg.phaseCd > 0) {
        badgePhase.classList.remove('ready');
        timerPhase.textContent = `${game.phaseCd.toFixed(1)}s`;
        timerPhase.style.color = '#ff6b8b';
        const pct = (game.phaseCd / diffCfg.phaseCd) * 100;
        cdPhase.style.height = `${pct}%`;
        vcdPhase.style.height = `${pct}%`;
      } else {
        badgePhase.classList.add('ready');
        timerPhase.textContent = diffCfg.phaseCd === 0 ? 'NO CD' : 'READY';
        timerPhase.style.color = '#00ff88';
        cdPhase.style.height = '0%';
        vcdPhase.style.height = '0%';
      }
    }
  }

  // 初始化主页与主循环
  renderHubUI();
  requestAnimationFrame(update);

  // 暴露核心对象与控制函数便于调试与自动化验证
  LH.game = game;
  LH.entities = entities;
  LH.input = input;
  LH.startGame = startGame;
  LH.pauseGame = pauseGame;
  LH.resumeGame = resumeGame;
  LH.returnToHome = returnToHome;
  LH.selectDifficulty = selectDifficulty;
  LH.activatePhaseSlide = activatePhaseSlide;
  LH.activatePacketLossRewind = activatePacketLossRewind;
})(window.LagHero);
