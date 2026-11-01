window.LagHero = window.LagHero || {};

(function (LH) {
  const {
    clamp,
    lerp,
    easeOutBack,
    RISE_GRAVITY,
    FALL_GRAVITY,
    JUMP_VELOCITY,
    APEX_THRESHOLD,
    APEX_GRAVITY_MULT,
    EARLY_RELEASE_CUT,
    MAX_FALL_SPEED,
    COYOTE_TIME,
    JUMP_BUFFER_TIME,
    SLASH_COOLDOWN
  } = LH.Constants;
  const { audio } = LH;
  const { spawnParticles, spawnPopText, spawnShockwave, triggerFeedback } = LH.CameraFX;

  const player = {
    x: 190,
    y: 500,
    vx: 0,
    vy: 0,
    width: 40,
    height: 58,
    normalHeight: 58,
    slideHeight: 32,

    // RPG & 衍生战斗属性
    hp: 100,
    maxHp: 100,
    trailHp: 100,
    shields: 0,
    maxJumps: 2,
    jumpsLeft: 2,
    slashDamage: 45,
    slashRange: 115,
    maxLagSlashes: 4,
    magnetRadius: 42,
    swordWaveCount: 0,
    lootMultiplier: 1,

    // 平台跳跃状态
    onGround: true,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    invulnTimer: 0,
    flashTimer: 0,
    runAnimTime: 0,

    // 卡顿斩 (Lag Slash) 状态
    slashCd: 0,
    slashAnimTimer: 0,
    queuedLagSlashes: [], // 主动卡死期间积蓄的残影斩队列
    swordWaves: [],       // 剑气风暴飞弹

    // Squash & Stretch 挤压拉伸状态 (`game-feel` Pattern 3)
    scaleX: 1,
    scaleY: 1,
    startScaleX: 1,
    startScaleY: 1,
    scaleTimer: 1,
    scaleDuration: 0.18,

    triggerPop(sx, sy, dur = 0.18) {
      this.startScaleX = sx;
      this.startScaleY = sy;
      this.scaleX = sx;
      this.scaleY = sy;
      this.scaleTimer = 0;
      this.scaleDuration = dur;
    },

    reset(groundY, derivedStats) {
      this.x = 190;
      this.y = groundY;
      this.vx = 0;
      this.vy = 0;
      this.height = this.normalHeight;
      this.onGround = true;
      this.coyoteTimer = COYOTE_TIME;
      this.jumpBufferTimer = 0;
      this.invulnTimer = 0;
      this.flashTimer = 0;
      this.slashCd = 0;
      this.slashAnimTimer = 0;
      this.queuedLagSlashes = [];
      this.swordWaves = [];

      this.applyDerivedStats(derivedStats, true);
      this.jumpsLeft = this.maxJumps;
      this.shields = derivedStats.startShields || 0;
      this.triggerPop(1.25, 0.78, 0.2);
    },

    applyDerivedStats(derivedStats, resetFullHp = false) {
      const oldMax = this.maxHp || 100;
      this.maxHp = derivedStats.maxHp;
      if (resetFullHp) {
        this.hp = this.maxHp;
        this.trailHp = this.maxHp;
      } else if (this.maxHp > oldMax) {
        this.hp += this.maxHp - oldMax;
      }
      this.maxJumps = derivedStats.maxJumps;
      this.slashDamage = derivedStats.slashDamage;
      this.slashRange = derivedStats.slashRange;
      this.maxLagSlashes = derivedStats.maxLagSlashes;
      this.magnetRadius = derivedStats.magnetRadius;
      this.swordWaveCount = derivedStats.swordWaveCount;
      this.lootMultiplier = derivedStats.lootMultiplier;
    },

    // 触发【卡顿斩 (Lag Slash)】
     performSlash(gameCtx) {
      const { game, obstacles, projectiles, bossManager } = gameCtx;

      // 若处于【主动卡死】期间，允许高频积蓄残影斩！
      if (game.lagActive) {
        if (this.slashCd > 0) return;
        if (this.queuedLagSlashes.length < this.maxLagSlashes) {
          this.slashCd = 0.12;
          this.slashAnimTimer = 0.18;
          this.triggerPop(1.28, 0.82, 0.14);
          audio.playSlash(true);
          this.queuedLagSlashes.push({
            x: this.x + this.width + 20 + this.queuedLagSlashes.length * 28,
            y: this.y - this.height / 2,
            radius: this.slashRange * 0.85,
            damage: Math.round(this.slashDamage * 1.25)
          });
          spawnPopText(
            this.x + 30,
            this.y - 75,
            `🗡️ 积蓄卡顿斩 (${this.queuedLagSlashes.length}/${this.maxLagSlashes})`,
            '#ffe600',
            15
          );
          return;
        }
      }

      if (this.slashCd > 0) return;
      this.slashCd = SLASH_COOLDOWN;
      this.slashAnimTimer = 0.20;
      this.triggerPop(1.32, 0.78, 0.16);
      audio.playSlash(false);

      const slashBox = {
        x: this.x + this.width * 0.3,
        y: this.y - this.height - 18,
        w: this.slashRange,
        h: this.height + 32
      };

      spawnParticles(this.x + this.width + 35, this.y - this.height / 2, 10, '#ffe600', 1.1, 'glitch');

      // 若拥有【延迟剑气风暴】词条，发射远程穿透剑气波
      if (this.swordWaveCount > 0) {
        this.swordWaves.push({
          x: this.x + this.width + 10,
          y: this.y - this.height / 2,
          vx: 760,
          w: 36,
          h: 54,
          damage: Math.round(this.slashDamage * 0.85),
          life: 0,
          maxLife: 1.4
        });
      }

      this.executeSlashHitbox(slashBox, this.slashDamage, gameCtx);
    },

    // 松开主动卡死瞬间：引爆所有积蓄的延迟残影斩！
    detonateQueuedLagSlashes(gameCtx) {
      if (this.queuedLagSlashes.length === 0) return;
      const count = this.queuedLagSlashes.length;
      const totalDmg = this.queuedLagSlashes.reduce((acc, s) => acc + s.damage, 0);

      for (const s of this.queuedLagSlashes) {
        spawnShockwave(s.x, s.y, '#ffe600', 160);
        spawnParticles(s.x, s.y, 14, '#ffe600', 1.3, 'glitch');
        const box = {
          x: s.x - s.radius,
          y: s.y - s.radius,
          w: s.radius * 2.2,
          h: s.radius * 2
        };
        this.executeSlashHitbox(box, s.damage, gameCtx);
      }

      // 若 Boss 在场，积蓄满 2 道以上残影斩直接对 Boss 进行远程时空次元斩！
      if (gameCtx.bossManager && gameCtx.bossManager.activeBoss) {
        const bossHitDmg = Math.round(totalDmg * 0.9);
        gameCtx.bossManager.damageBoss(bossHitDmg, this);
        spawnPopText(
          gameCtx.bossManager.activeBoss.x,
          gameCtx.bossManager.activeBoss.y - 60,
          `⚡ 次元连斩 x${count} (-${bossHitDmg})!`,
          '#ffe600',
          20
        );
      }

      triggerFeedback(this.x + 60, this.y - 30, count >= 3 ? 'large' : 'medium', '#ffe600');
      this.queuedLagSlashes = [];
    },

    executeSlashHitbox(box, dmg, gameCtx) {
      const { game, obstacles, projectiles, bossManager, rogueSystem, saveManager } = gameCtx;

      // 1. 斩碎可破坏障碍物与无人机 (DRONE, FALLING_ROCK, SPIKE, SLAM_GATE)
      if (obstacles) {
        for (let i = obstacles.length - 1; i >= 0; i--) {
          const obs = obstacles[i];
          if (obs.type === 'FIREWALL') continue; // 巨型防火墙需穿模通过
          const obsRect = obs.type === 'LASER_SPINNER'
            ? { x: obs.x - obs.hubRadius, y: obs.y - obs.hubRadius, w: obs.hubRadius * 2, h: obs.hubRadius * 2 }
            : { x: obs.x, y: obs.y || (gameCtx.groundY - (obs.maxH || obs.h || 40)), w: obs.w || 40, h: obs.h || obs.maxH || 40 };

          if (
            box.x < obsRect.x + obsRect.w &&
            box.x + box.w > obsRect.x &&
            box.y < obsRect.y + obsRect.h &&
            box.y + box.h > obsRect.y
          ) {
            spawnParticles(obsRect.x + obsRect.w / 2, obsRect.y + obsRect.h / 2, 16, '#00ff88', 1.2, 'glitch');
            game.bonusScore += obs.type === 'CYBER_DRONE' ? 85 : 45;
            spawnPopText(obsRect.x, obsRect.y - 10, obs.type === 'CYBER_DRONE' ? '💥 斩杀无人机 +85' : '⚔️ 斩碎陷阱 +45', '#00ff88', 15);
            obstacles.splice(i, 1);
            if (saveManager) saveManager.recordEvent('slash_destroy', 1);
            if (rogueSystem) rogueSystem.fireTrigger('on_kill_or_shard', gameCtx);
          }
        }
      }

      // 2. 弹反敌方数据弹幕 (`Deflect Projectiles`)
      if (projectiles) {
        for (const proj of projectiles) {
          if (proj.deflected) continue;
          if (
            proj.x + proj.r > box.x &&
            proj.x - proj.r < box.x + box.w &&
            proj.y + proj.r > box.y &&
            proj.y - proj.r < box.y + box.h
          ) {
            proj.deflected = true;
            proj.vx = Math.abs(proj.vx) * 1.8 + 420;
            proj.vy = -60;
            proj.color = '#00ff88';
            game.bonusScore += 50;
            triggerFeedback(proj.x, proj.y, 'medium', '#00ff88');
            spawnPopText(proj.x, proj.y - 20, '⚡ 完美弹反! +50', '#00ff88', 16);
            if (saveManager) saveManager.recordEvent('slash_destroy', 1);
          }
        }
      }

      // 3. 直接命中 Boss
      if (bossManager && bossManager.activeBoss) {
        const b = bossManager.activeBoss;
        if (
          box.x < b.x + b.w / 2 &&
          box.x + box.w > b.x - b.w / 2 &&
          box.y < b.y + b.h / 2 &&
          box.y + box.h > b.y - b.h / 2
        ) {
          bossManager.damageBoss(dmg, this);
        }
      }
    },

    updatePhysics(dt, rawDt, input, groundY, screenW, biomeGravityMult, platforms, gameCtx) {
      // 1. A/D 左右微操走位 (`platformer` 加减速手感)
      const moveDir = (input.rightHeld ? 1 : 0) - (input.leftHeld ? 1 : 0);
      const maxHorizSpeed = 290;
      if (moveDir !== 0) {
        this.vx = lerp(this.vx, moveDir * maxHorizSpeed, Math.min(1, rawDt * 14));
      } else {
        this.vx = lerp(this.vx, 0, Math.min(1, rawDt * 12));
      }
      this.x = clamp(this.x + this.vx * rawDt, 75, Math.min(580, screenW * 0.52));

      // 2. 冷却计时更新
      if (this.slashCd > 0) this.slashCd = Math.max(0, this.slashCd - rawDt);
      if (this.slashAnimTimer > 0) this.slashAnimTimer = Math.max(0, this.slashAnimTimer - rawDt);
      if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - rawDt);
      if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - rawDt);

      // 3. 剑气飞弹更新
      for (let i = this.swordWaves.length - 1; i >= 0; i--) {
        const sw = this.swordWaves[i];
        sw.x += sw.vx * rawDt;
        sw.life += rawDt;
        this.executeSlashHitbox(
          { x: sw.x, y: sw.y - sw.h / 2, w: sw.w, h: sw.h },
          sw.damage,
          gameCtx
        );
        if (sw.life >= sw.maxLife || sw.x > screenW + 100) {
          this.swordWaves.splice(i, 1);
        }
      }

      // 4. 土狼时间与跳跃预输入 (`platformer` Pattern 1 & 2)
      if (this.onGround) {
        this.coyoteTimer = COYOTE_TIME;
        this.jumpsLeft = this.maxJumps;
      } else {
        this.coyoteTimer = Math.max(0, this.coyoteTimer - rawDt);
      }

      if (input.jumpPressedThisFrame) {
        this.jumpBufferTimer = JUMP_BUFFER_TIME;
      } else {
        this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - rawDt);
      }

      if (this.jumpBufferTimer > 0) {
        if (this.coyoteTimer > 0) {
          this.vy = JUMP_VELOCITY;
          this.onGround = false;
          this.coyoteTimer = 0;
          this.jumpBufferTimer = 0;
          this.jumpsLeft = this.maxJumps - 1;
          this.triggerPop(0.76, 1.28, 0.18);
          audio.playJump(false);
          spawnParticles(this.x + this.width / 2, this.y, 8, '#00f3ff', 0.8);
        } else if (this.jumpsLeft > 0) {
          this.vy = JUMP_VELOCITY * 0.92;
          this.onGround = false;
          this.jumpBufferTimer = 0;
          this.jumpsLeft--;
          this.triggerPop(0.72, 1.32, 0.20);
          audio.playJump(true);
          spawnParticles(this.x + this.width / 2, this.y, 12, '#00ff88', 1.0);
          spawnPopText(this.x + 20, this.y - 40, 'DOUBLE JUMP!', '#00ff88', 13);
          if (gameCtx && gameCtx.rogueSystem) {
            gameCtx.rogueSystem.fireTrigger('on_air_jump', gameCtx);
          }
        }
      }

      // 可变跳跃高度
      if (input.jumpReleasedThisFrame && this.vy < 0) {
        this.vy *= EARLY_RELEASE_CUT;
      }

      // 非对称重力 + 顶点悬停 + 扇区重力系数 + 半步积分 (`feel-tuning.md` §1)
      let currentGravity = (this.vy < 0 ? RISE_GRAVITY : FALL_GRAVITY) * (biomeGravityMult || 1.0);
      if (Math.abs(this.vy) < APEX_THRESHOLD) {
        currentGravity *= APEX_GRAVITY_MULT;
      }

      const prevY = this.y;
      this.vy = Math.min(MAX_FALL_SPEED, this.vy + 0.5 * currentGravity * dt);
      this.y += this.vy * dt;
      this.vy = Math.min(MAX_FALL_SPEED, this.vy + 0.5 * currentGravity * dt);

      // 地面与单向浮台碰撞检测
      let landedThisFrame = false;
      if (this.vy >= 0) {
        for (const plat of platforms) {
          const playerRight = this.x + this.width * 0.85;
          const playerLeft = this.x + this.width * 0.15;
          if (playerRight > plat.x && playerLeft < plat.x + plat.w) {
            if (prevY <= plat.y + 4 && this.y >= plat.y) {
              this.y = plat.y;
              this.vy = 0;
              if (!this.onGround) landedThisFrame = true;
              this.onGround = true;
              break;
            }
          }
        }
      }

      if (this.y >= groundY) {
        this.y = groundY;
        this.vy = 0;
        if (!this.onGround) landedThisFrame = true;
        this.onGround = true;
      } else if (this.vy !== 0) {
        this.onGround = false;
      }

      if (landedThisFrame && gameCtx.game.phaseTimer <= 0) {
        this.triggerPop(1.26, 0.78, 0.15);
        spawnParticles(this.x + this.width / 2, this.y, 5, '#00f3ff', 0.5);
      }

      // 挤压拉伸回弹更新 (`game-feel` Pattern 3)
      if (this.scaleTimer < 1) {
        this.scaleTimer = Math.min(1, this.scaleTimer + rawDt / this.scaleDuration);
        const eased = easeOutBack(this.scaleTimer);
        this.scaleX = lerp(this.startScaleX, 1, eased);
        this.scaleY = lerp(this.startScaleY, 1, eased);
      } else {
        this.scaleX = 1;
        this.scaleY = 1;
      }

      this.runAnimTime += dt * 14;
    }
  };

  LH.player = player;
})(window.LagHero);
