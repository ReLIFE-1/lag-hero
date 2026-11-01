window.LagHero = window.LagHero || {};

(function (LH) {
  const { BOSS_TEMPLATES } = LH.ContentData;
  const { DIFFICULTY_CONFIGS, clamp, lerp } = LH.Constants;
  const { audio } = LH;
  const { spawnParticles, spawnPopText, spawnShockwave, triggerFeedback } = LH.CameraFX;

  // ============================================================================
  // 1. 赛博关卡障碍与巡逻无人机生成器 (`stageDirector` & `obstacles`)
  // ============================================================================
  function spawnObstaclePattern(startX, groundY, difficultyKey, distance, rng, entities) {
    const { obstacles, platforms, collectibles } = entities;
    const diffCfg = DIFFICULTY_CONFIGS[difficultyKey] || DIFFICULTY_CONFIGS.medium;
    const trapMult = diffCfg.trapSpeedMult;

    // 7 种机关模板（新增：6=赛博巡逻无人机群，7=蓝屏跳台矩阵）
    const maxPattern = distance > 180 ? 7 : 5;
    let patternIndex = rng ? rng.intInclusive(0, maxPattern - 1) : Math.floor(Math.random() * maxPattern);
    if (patternIndex === entities.lastPatternIndex) {
      patternIndex = (patternIndex + 1) % maxPattern;
    }
    entities.lastPatternIndex = patternIndex;

    // 模板 0：【高速旋转激光阵】
    if (patternIndex === 0) {
      const cx = startX + 180;
      const cy = groundY - 95;
      obstacles.push({
        type: 'LASER_SPINNER',
        x: cx,
        y: cy,
        radius: 96,
        angle: rng ? rng.nextFloat() * Math.PI : 0.5,
        angularSpeed: 6.2 * trapMult,
        hubRadius: 18,
        hint: '按住[SPACE]主动卡死 或 [J]斩核心'
      });

      for (let i = -1; i <= 1; i++) {
        collectibles.push({
          type: 'COIN',
          x: cx + i * 50,
          y: groundY - 32,
          r: 11,
          collected: false
        });
      }
      return startX + 440;
    }

    // 模板 1：【巨型实心电网防火墙 + 墙内隐藏 Bug 碎片】
    if (patternIndex === 1) {
      const wallW = 86;
      const wallH = 260;
      obstacles.push({
        type: 'FIREWALL',
        x: startX + 140,
        y: groundY - wallH,
        w: wallW,
        h: wallH,
        hint: '按[S/E]穿模滑铲'
      });

      collectibles.push({
        type: 'BUG_SHARD',
        x: startX + 140 + wallW * 0.32,
        y: groundY - 38,
        r: 13,
        collected: false
      });
      collectibles.push({
        type: 'BUG_SHARD',
        x: startX + 140 + wallW * 0.72,
        y: groundY - 38,
        r: 13,
        collected: false
      });
      return startX + 430;
    }

    // 模板 2：【高频下落激光闸门】
    if (patternIndex === 2) {
      const gateX = startX + 160;
      obstacles.push({
        type: 'SLAM_GATE',
        x: gateX,
        w: 52,
        maxH: 215,
        phase: rng ? rng.nextFloat() * Math.PI * 2 : 1.0,
        freq: 5.4 * trapMult,
        openRatio: 0,
        hint: '长按[SPACE]卡点通过'
      });

      collectibles.push({
        type: 'COIN',
        x: gateX + 26,
        y: groundY - 28,
        r: 11,
        collected: false
      });
      return startX + 410;
    }

    // 模板 3：【赛博浮台 + 地面电刺阵】
    if (patternIndex === 3) {
      const platX = startX + 110;
      const platW = 210;
      const platY = groundY - 108;

      platforms.push({ x: platX, y: platY, w: platW, h: 14 });
      obstacles.push({
        type: 'SPIKE',
        x: platX + 15,
        y: groundY - 34,
        w: platW - 30,
        h: 34,
        hint: '[W]二段跳上浮台'
      });

      for (let i = 0; i < 3; i++) {
        collectibles.push({
          type: 'COIN',
          x: platX + 35 + i * 65,
          y: platY - 30,
          r: 11,
          collected: false
        });
      }
      return startX + 450;
    }

    // 模板 4：【突发天降数据落石】
    if (patternIndex === 4) {
      const rockX = startX + 190;
      obstacles.push({
        type: 'FALLING_ROCK',
        x: rockX,
        y: groundY - 320,
        w: 56,
        h: 56,
        vy: 0,
        triggered: false,
        landed: false,
        hint: '[SHIFT]回溯 或 [J]卡顿斩劈碎'
      });

      collectibles.push({
        type: 'COIN',
        x: rockX - 65,
        y: groundY - 95,
        r: 11,
        collected: false
      });
      collectibles.push({
        type: 'COIN',
        x: rockX + 28,
        y: groundY - 140,
        r: 11,
        collected: false
      });
      return startX + 430;
    }

    // 模板 5：【赛博巡逻无人机编队 (可被 J 卡顿斩击落或弹反子弹)】
    if (patternIndex === 5) {
      const droneX = startX + 180;
      obstacles.push({
        type: 'CYBER_DRONE',
        x: droneX,
        y: groundY - 85,
        baseY: groundY - 85,
        w: 46,
        h: 36,
        phase: 0,
        fireCd: 1.1,
        hint: '按[J/点击]卡顿斩击落 & 弹反'
      });

      collectibles.push({
        type: 'BUG_SHARD',
        x: droneX + 20,
        y: groundY - 140,
        r: 13,
        collected: false
      });
      return startX + 420;
    }

    // 模板 6：【复合陷阱：电刺 + 实心防火墙】
    obstacles.push({
      type: 'SPIKE',
      x: startX + 90,
      y: groundY - 34,
      w: 78,
      h: 34,
      hint: '先跳后穿模'
    });
    const wallX = startX + 280;
    obstacles.push({
      type: 'FIREWALL',
      x: wallX,
      y: groundY - 250,
      w: 80,
      h: 250,
      hint: '按[S/E]穿模'
    });
    collectibles.push({
      type: 'BUG_SHARD',
      x: wallX + 40,
      y: groundY - 40,
      r: 13,
      collected: false
    });
    return startX + 510;
  }

  // ============================================================================
  // 2. 阶段性 Boss 战系统 (`BossManager`)
  // ============================================================================
  class BossManager {
    constructor() {
      this.reset();
    }

    reset() {
      this.activeBoss = null;
      this.nextBossDistance = 520;
      this.bossStep = 550;
      this.bossCount = 0;
    }

    checkSpawnBoss(distance, difficultyKey, screenW, groundY, onBossSpawn) {
      if (this.activeBoss || distance < this.nextBossDistance) return false;

      const template = BOSS_TEMPLATES[this.bossCount % BOSS_TEMPLATES.length];
      const diffCfg = DIFFICULTY_CONFIGS[difficultyKey] || DIFFICULTY_CONFIGS.medium;
      const scale = 1 + this.bossCount * 0.35;
      const maxHp = Math.round(template.baseHp * diffCfg.bossHpMult * scale);

      this.activeBoss = {
        id: template.id,
        name: template.name,
        color: template.color,
        coreColor: template.coreColor,
        rewardCoins: template.rewardCoins,
        rewardShards: template.rewardShards,
        maxHp,
        hp: maxHp,
        trailHp: maxHp,
        x: screenW + 140,
        targetX: screenW - 155,
        y: groundY - 125,
        baseY: groundY - 125,
        w: 96,
        h: 136,
        phaseTime: 0,
        attackTimer: 2.0,
        attackIndex: 0,
        laserWarningTimer: 0,
        laserActiveTimer: 0,
        laserY: groundY - 55,
        flashTimer: 0
      };

      this.bossCount++;
      this.nextBossDistance = distance + this.bossStep;

      const bossWrap = document.getElementById('boss-hp-wrap');
      const bossNameEl = document.getElementById('boss-name-text');
      if (bossWrap) bossWrap.classList.remove('hidden');
      if (bossNameEl) bossNameEl.textContent = `⚠️ BOSS · ${this.activeBoss.name}`;

      audio.bgmMode = 'boss';
      if (onBossSpawn) onBossSpawn(this.activeBoss, this.bossCount);
      return true;
    }

    update(dt, rawDt, trapTimeScale, gameCtx) {
      const b = this.activeBoss;
      if (!b) return;

      const { player, projectiles, obstacles, collectibles, groundY, screenW } = gameCtx;
      b.targetX = Math.max(420, screenW - 155);
      b.x = lerp(b.x, b.targetX, Math.min(1, rawDt * 3.5));
      b.trailHp = lerp(b.trailHp, b.hp, Math.min(1, rawDt * 5.5));
      if (b.flashTimer > 0) b.flashTimer = Math.max(0, b.flashTimer - rawDt);

      const bossDt = dt * trapTimeScale;
      b.phaseTime += bossDt;
      b.y = b.baseY + Math.sin(b.phaseTime * 2.2) * 38;

      // 高能横扫激光状态更新
      if (b.laserWarningTimer > 0) {
        b.laserWarningTimer = Math.max(0, b.laserWarningTimer - bossDt);
        if (b.laserWarningTimer <= 0) {
          b.laserActiveTimer = 0.65;
          audio.playPhaseGlitch(false);
          triggerFeedback(b.x - 100, b.laserY, 'medium', '#ff0055');
        }
      } else if (b.laserActiveTimer > 0) {
        b.laserActiveTimer = Math.max(0, b.laserActiveTimer - bossDt);
      }

      b.attackTimer -= bossDt;
      if (b.attackTimer <= 0) {
        this.performBossAttack(b, player, projectiles, obstacles, collectibles, groundY);
        b.attackTimer = 2.5;
      }

      this.updateBossHUD();
    }

    performBossAttack(b, player, projectiles, obstacles, collectibles, groundY) {
      const mode = b.attackIndex % 3;
      b.attackIndex++;

      if (mode === 0) {
        // 招式 1：发射 3 枚可被【卡顿斩】弹反的数据弹幕
        const heights = [groundY - 35, groundY - 95, groundY - 155];
        for (let i = 0; i < 3; i++) {
          projectiles.push({
            x: b.x - 50,
            y: heights[i],
            vx: -(360 + i * 45),
            vy: 0,
            r: 13,
            color: '#ff0055',
            deflected: false,
            damage: 35
          });
        }
        spawnPopText(b.x - 40, b.y - 80, '⚠️ 数据弹幕 (按 J 弹反!)', '#ff0055', 15);
      } else if (mode === 1) {
        // 招式 2：高能横扫激光预警
        b.laserY = player.y > groundY - 60 ? groundY - 38 : groundY - 115;
        b.laserWarningTimer = 0.85;
        spawnPopText(b.x - 60, b.laserY - 25, '⚠️ 激光锁定! (跳跃或穿模)', '#ffe600', 16);
      } else {
        // 招式 3：召唤移动防火墙 + 墙内回血漏洞核心
        obstacles.push({
          type: 'FIREWALL',
          x: b.x - 60,
          y: groundY - 230,
          w: 72,
          h: 230,
          hint: '按[S/E]穿模吃核心'
        });
        collectibles.push({
          type: 'BUG_SHARD',
          x: b.x - 24,
          y: groundY - 42,
          r: 14,
          collected: false
        });
      }
    }

    damageBoss(amount, player) {
      const b = this.activeBoss;
      if (!b) return;
      b.hp = Math.max(0, b.hp - amount);
      b.flashTimer = 0.14;
      spawnParticles(b.x, b.y, 14, '#00f3ff', 1.1, 'glitch');
      spawnPopText(b.x - 20, b.y - 45, `-${amount}`, '#ffe600', 18);
      this.updateBossHUD();
    }

    checkBossDefeated(gameCtx) {
      const b = this.activeBoss;
      if (!b || b.hp > 0) return false;

      const { game, player, obstacles, projectiles, saveManager, rogueSystem } = gameCtx;
      const bx = b.x;
      const by = b.y;
      const coinsWon = b.rewardCoins * (player.lootMultiplier || 1);
      const shardsWon = b.rewardShards * (player.lootMultiplier || 1);

      triggerFeedback(bx, by, 'large', '#ffe600');
      audio.playCrash();
      audio.bgmMode = 'normal';

      game.bonusScore += 500;
      game.runCoins += coinsWon;
      game.runShards += shardsWon;
      if (saveManager) {
        saveManager.addCurrency(coinsWon, shardsWon);
        saveManager.recordEvent('kill_boss', 1);
      }

      if (obstacles) obstacles.length = 0;
      if (projectiles) projectiles.length = 0;

      spawnPopText(bx - 60, by - 40, `🏆 击破 ${b.name}! +500分`, '#00ff88', 20);
      spawnPopText(bx - 60, by - 10, `🪙 +${coinsWon} 金币  💠 +${shardsWon} 碎片`, '#ffe600', 17);

      this.activeBoss = null;
      const bossWrap = document.getElementById('boss-hp-wrap');
      if (bossWrap) bossWrap.classList.add('hidden');

      // 击败 Boss 后触发专属三选一协议奖励
      if (rogueSystem) {
        setTimeout(() => {
          if (game.state === 'PLAYING') {
            rogueSystem.openDraftModal(gameCtx, `🏆 击破守门人！请选择 1 项战利品故障协议`);
          }
        }, 450);
      }
      return true;
    }

    updateBossHUD() {
      const b = this.activeBoss;
      if (!b) return;
      const pct = clamp((b.hp / b.maxHp) * 100, 0, 100);
      const trailPct = clamp((b.trailHp / b.maxHp) * 100, 0, 100);
      const fillEl = document.getElementById('boss-hp-fill');
      const trailEl = document.getElementById('boss-hp-trail');
      const textEl = document.getElementById('boss-hp-text');
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (trailEl) trailEl.style.width = `${trailPct}%`;
      if (textEl) textEl.textContent = `${Math.ceil(b.hp)} / ${b.maxHp}`;
    }
  }

  LH.spawnObstaclePattern = spawnObstaclePattern;
  LH.BossManager = BossManager;
  LH.bossManager = new BossManager();
})(window.LagHero);
