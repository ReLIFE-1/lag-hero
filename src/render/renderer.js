window.LagHero = window.LagHero || {};

(function (LH) {
  const { clamp, easeOutCubic } = LH.Constants;
  const { AGENT_CLASSES } = LH.ContentData;
  const { camera, particles, popTexts, rewindGhosts, shockwaves } = LH.CameraFX;

  function renderGame(ctx, W, H, groundY, gameCtx) {
    const {
      game,
      player,
      obstacles,
      platforms,
      collectibles,
      projectiles,
      bossManager,
      saveManager
    } = gameCtx;

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // 应用 Trauma 相机震屏偏移与旋转 (`game-feel` §1)
    ctx.translate(W / 2 + camera.offsetX, H / 2 + camera.offsetY);
    ctx.rotate(camera.rotation);
    ctx.translate(-W / 2, -H / 2);

    // 1. 远景赛博城市与数据流视差背景
    drawParallaxBackground(ctx, W, H, groundY, game);

    // 2. 地面电网与透视扫描线
    drawCyberGround(ctx, W, H, groundY, game);

    // 3. 单向赛博浮台
    for (const plat of platforms) {
      drawPlatform(ctx, plat);
    }

    // 4. 金币与 Bug 碎片
    for (const item of collectibles) {
      if (!item.collected) drawCollectible(ctx, item);
    }

    // 5. 陷阱障碍物与巡逻无人机
    for (const obs of obstacles) {
      drawObstacle(ctx, obs, W, groundY, game);
      if ((game.lagActive || camera.vertigoAmount > 0.2) && !camera.reduceMotion) {
        ctx.save();
        ctx.globalAlpha = 0.26 * Math.max(camera.vertigoAmount, game.lagActive ? 0.85 : 0);
        ctx.translate(Math.sin(camera.vertigoPhase * 2) * 14, Math.cos(camera.vertigoPhase * 2) * 6);
        drawObstacle(ctx, obs, W, groundY, game);
        ctx.restore();
      }
    }

    // 6. 敌方与弹反数据弹幕
    if (projectiles) {
      for (const proj of projectiles) {
        drawProjectile(ctx, proj);
      }
    }

    // 7. 阶段性守门人 Boss
    if (bossManager && bossManager.activeBoss) {
      drawBoss(ctx, bossManager.activeBoss, W);
    }

    // 8. 丢包回溯残影
    for (const g of rewindGhosts) {
      const k = 1 - g.life / g.maxLife;
      ctx.save();
      ctx.globalAlpha = g.alpha * k;
      ctx.fillStyle = '#00ff88';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.fillRect(g.x, g.y - g.h, g.w, g.h);
      ctx.strokeRect(g.x, g.y - g.h, g.w, g.h);
      ctx.restore();
    }

    // 9. 积蓄在时空中的【卡顿残影斩】幻影与远程剑气波
    drawSlashEffects(ctx, player);

    // 10. 玩家角色本体
    drawPlayer(ctx, player, game, saveManager);

    // 11. 冲击波、粒子与浮动数字
    drawParticlesAndPopTexts(ctx);

    ctx.restore();

    // 12. 屏幕空间故障后处理滤镜
    drawPostProcessing(ctx, W, H, game);
  }

  function drawParallaxBackground(ctx, W, H, groundY, game) {
    const biome = game.currentBiome;
    for (const b of game.bgBuildings) {
      const drawX = ((b.x - game.worldScrollX * b.layer) % (W + 300) + (W + 300)) % (W + 300) - 150;
      const by = groundY - b.h;

      ctx.fillStyle = biome.id === 'BSOD_ABYSS'
        ? 'rgba(6, 24, 68, 0.78)'
        : (biome.id === 'KERNEL_PANIC' ? 'rgba(38, 10, 18, 0.78)' : 'rgba(11, 16, 34, 0.75)');
      ctx.strokeStyle = b.hue;
      ctx.lineWidth = 1;
      ctx.globalAlpha = b.layer === 0.2 ? 0.35 : 0.55;
      ctx.fillRect(drawX, by, b.w, b.h);
      ctx.strokeRect(drawX, by, b.w, b.h);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = game.lagActive ? 'rgba(255, 0, 85, 0.35)' : 'rgba(0, 243, 255, 0.22)';
    for (const line of game.dataLines) {
      const factor = game.lagActive ? 0.1 : 1.0;
      const sx = ((line.x - game.worldScrollX * 0.6 * factor) % (W + 200) + (W + 200)) % (W + 200) - 100;
      ctx.fillRect(sx, line.y, line.len, 2);
    }
  }

  function drawCyberGround(ctx, W, H, groundY, game) {
    const biome = game.currentBiome;
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, groundY, W, H - groundY);

    ctx.strokeStyle = game.lagActive ? '#ff0055' : (biome ? biome.groundColor : '#00f3ff');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();

    const gridStep = 64;
    const offset = -(game.worldScrollX % gridStep);
    ctx.strokeStyle = game.lagActive
      ? 'rgba(255, 0, 85, 0.28)'
      : (biome ? biome.gridColor : 'rgba(0, 243, 255, 0.22)');
    ctx.lineWidth = 1.5;

    for (let x = offset; x < W + gridStep; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x - 90, H);
      ctx.stroke();
    }

    for (let y = groundY + 22; y < H; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function drawPlatform(ctx, plat) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 243, 255, 0.18)';
    ctx.strokeStyle = '#00f3ff';
    ctx.lineWidth = 2;
    ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
    ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
    ctx.restore();
  }

  function drawCollectible(ctx, item) {
    ctx.save();
    ctx.translate(item.x, item.y);
    const pulse = 1 + 0.12 * Math.sin(performance.now() * 0.008 + item.x);
    ctx.scale(pulse, pulse);

    if (item.type === 'BUG_SHARD') {
      ctx.fillStyle = '#ff0055';
      ctx.strokeStyle = '#00f3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -item.r);
      ctx.lineTo(item.r, 0);
      ctx.lineTo(0, item.r);
      ctx.lineTo(-item.r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffe600';
      ctx.fillRect(-item.r * 0.8, -3, item.r * 1.6, 3);
    } else {
      ctx.fillStyle = '#ffe600';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, item.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#070810';
      ctx.fillRect(-3, -5, 6, 10);
    }
    ctx.restore();
  }

  function drawObstacle(ctx, obs, W, groundY, game) {
    ctx.save();

    if (obs.type === 'LASER_SPINNER') {
      const cosA = Math.cos(obs.angle);
      const sinA = Math.sin(obs.angle);
      const x1 = obs.x - cosA * obs.radius;
      const y1 = obs.y - sinA * obs.radius;
      const x2 = obs.x + cosA * obs.radius;
      const y2 = obs.y + sinA * obs.radius;

      ctx.strokeStyle = game.lagActive ? '#00f3ff' : '#ff0055';
      ctx.lineWidth = 12;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.fillStyle = '#182238';
      ctx.strokeStyle = '#ff0055';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.hubRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (obs.type === 'FIREWALL') {
      const grad = ctx.createLinearGradient(obs.x, obs.y, obs.x + obs.w, obs.y);
      grad.addColorStop(0, 'rgba(255, 0, 85, 0.78)');
      grad.addColorStop(0.5, 'rgba(184, 41, 255, 0.55)');
      grad.addColorStop(1, 'rgba(255, 0, 85, 0.78)');
      ctx.fillStyle = grad;
      ctx.fillRect(obs.x, obs.y, obs.w, obs.h);

      ctx.strokeStyle = '#ff0055';
      ctx.lineWidth = 3;
      ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);

      ctx.strokeStyle = 'rgba(255, 230, 0, 0.55)';
      ctx.lineWidth = 1.5;
      for (let y = obs.y + 18; y < obs.y + obs.h; y += 24) {
        ctx.beginPath();
        ctx.moveTo(obs.x + 4, y);
        ctx.lineTo(obs.x + obs.w - 4, y);
        ctx.stroke();
      }
    } else if (obs.type === 'SLAM_GATE') {
      const currentGateH = obs.maxH * (1 - obs.openRatio * 0.65);
      const gy = groundY - currentGateH;

      ctx.strokeStyle = 'rgba(0, 243, 255, 0.25)';
      ctx.strokeRect(obs.x + 6, groundY - obs.maxH, obs.w - 12, obs.maxH);

      ctx.fillStyle = '#ff0055';
      ctx.fillRect(obs.x, gy, obs.w, currentGateH);
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 2;
      ctx.strokeRect(obs.x, gy, obs.w, currentGateH);
    } else if (obs.type === 'FALLING_ROCK') {
      if (!obs.landed) {
        ctx.strokeStyle = 'rgba(255, 0, 85, 0.55)';
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(obs.x + obs.w / 2, obs.y + obs.h);
        ctx.lineTo(obs.x + obs.w / 2, groundY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = '#ff5500';
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 2.5;
      ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
      ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
    } else if (obs.type === 'SPIKE') {
      const count = Math.max(2, Math.floor(obs.w / 24));
      const step = obs.w / count;
      ctx.fillStyle = '#ff0055';
      ctx.strokeStyle = '#00f3ff';
      ctx.lineWidth = 2;
      for (let i = 0; i < count; i++) {
        const sx = obs.x + i * step;
        ctx.beginPath();
        ctx.moveTo(sx, groundY);
        ctx.lineTo(sx + step / 2, obs.y);
        ctx.lineTo(sx + step, groundY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (obs.type === 'CYBER_DRONE') {
      // 赛博巡逻无人机
      ctx.fillStyle = '#1a1034';
      ctx.strokeStyle = '#b829ff';
      ctx.lineWidth = 2.5;
      ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
      ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);

      // 红色扫描独眼
      ctx.fillStyle = '#ff0055';
      ctx.beginPath();
      ctx.arc(obs.x + 12, obs.y + obs.h / 2, 6, 0, Math.PI * 2);
      ctx.fill();

      // 顶部悬浮旋翼
      ctx.strokeStyle = '#00f3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(obs.x - 6, obs.y - 5);
      ctx.lineTo(obs.x + obs.w + 6, obs.y - 5);
      ctx.stroke();
    }

    if (obs.hint && obs.x > 60 && obs.x < W - 40) {
      ctx.fillStyle = 'rgba(232, 244, 255, 0.78)';
      ctx.font = 'bold 11px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      const labelY = obs.type === 'LASER_SPINNER' ? obs.y - obs.radius - 14 : (obs.y - 12);
      ctx.fillText(obs.hint, obs.x + (obs.w ? obs.w / 2 : 0), Math.max(95, labelY));
    }

    ctx.restore();
  }

  function drawProjectile(ctx, proj) {
    ctx.save();
    ctx.fillStyle = proj.color || '#ff0055';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, proj.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawBoss(ctx, b, W) {
    ctx.save();

    // 1. 若有高能横扫激光预警或激活，先绘制激光束
    if (b.laserWarningTimer > 0) {
      ctx.strokeStyle = 'rgba(255, 230, 0, 0.75)';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(0, b.laserY);
      ctx.lineTo(b.x, b.laserY);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (b.laserActiveTimer > 0) {
      ctx.fillStyle = 'rgba(255, 0, 85, 0.45)';
      ctx.fillRect(0, b.laserY - 18, b.x, 36);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, b.laserY - 6, b.x, 12);
    }

    // 2. Boss 装甲躯干
    const left = b.x - b.w / 2;
    const top = b.y - b.h / 2;
    ctx.fillStyle = b.flashTimer > 0 ? '#ffffff' : '#160d2a';
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3.5;
    ctx.fillRect(left, top, b.w, b.h);
    ctx.strokeRect(left, top, b.w, b.h);

    // 核心发光晶体
    ctx.fillStyle = b.coreColor;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 20 + Math.sin(b.phaseTime * 6) * 3, 0, Math.PI * 2);
    ctx.fill();

    // 404 故障文字标识
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 12px "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ERR:404', b.x, top + 20);

    ctx.restore();
  }

  function drawSlashEffects(ctx, player) {
    // 1. 绘制主动卡死期间积蓄的残影斩
    for (const q of player.queuedLagSlashes) {
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 28, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();

      ctx.strokeStyle = '#00f3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-18, -18);
      ctx.lineTo(18, 18);
      ctx.moveTo(18, -18);
      ctx.lineTo(-18, 18);
      ctx.stroke();
      ctx.restore();
    }

    // 2. 绘制远程穿透剑气波
    for (const sw of player.swordWaves) {
      ctx.save();
      ctx.translate(sw.x, sw.y);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, sw.h / 2, -Math.PI * 0.38, Math.PI * 0.38);
      ctx.stroke();
      ctx.restore();
    }

    // 3. 绘制当前挥出的卡顿斩刀光弧线
    if (player.slashAnimTimer > 0) {
      const k = player.slashAnimTimer / 0.20;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.translate(player.x + player.width / 2, player.y - player.height / 2);
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 8 * k;
      ctx.beginPath();
      ctx.arc(10, 0, player.slashRange * 0.65, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * k;
      ctx.beginPath();
      ctx.arc(14, 0, player.slashRange * 0.65, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPlayer(ctx, player, game, saveManager) {
    const clsKey = saveManager ? saveManager.profile.selectedClass : 'zero';
    const agent = AGENT_CLASSES[clsKey] || AGENT_CLASSES.zero;

    ctx.save();

    const pivotX = player.x + player.width / 2;
    const pivotY = player.y;
    ctx.translate(pivotX, pivotY);
    ctx.scale(player.scaleX, player.scaleY);

    const w = player.width;
    const h = player.height;
    const left = -w / 2;
    const top = -h;

    if (game.lagActive || camera.chromaticPunch > 0.1) {
      const split = game.lagActive ? 6 : camera.chromaticPunch * 7;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(left - split, top, w, h);
      ctx.fillStyle = '#00f3ff';
      ctx.fillRect(left + split, top, w, h);
      ctx.globalAlpha = 1;
    }

    if (game.phaseTimer > 0) {
      const cols = 4;
      const rows = 5;
      const cw = w / cols;
      const ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() < 0.18) continue;
          const jitterX = (Math.random() - 0.5) * 9;
          const jitterY = (Math.random() - 0.5) * 4;
          ctx.fillStyle = (r + c) % 2 === 0 ? '#b829ff' : '#00f3ff';
          ctx.fillRect(left + c * cw + jitterX, top + r * ch + jitterY, cw - 1, ch - 1);
        }
      }
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 2;
      ctx.strokeRect(left - 4, top - 3, w + 8, h + 6);
    } else {
      ctx.fillStyle = player.flashTimer > 0 ? '#ffffff' : agent.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fillRect(left, top, w, h);
      ctx.strokeRect(left, top, w, h);

      // 赛博战术护目镜
      ctx.fillStyle = '#070810';
      ctx.fillRect(left + w * 0.35, top + 10, w * 0.6, 11);
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(left + w * 0.45, top + 13, w * 0.45, 5);

      // 奔跑动态能量飘带
      const scarfWave = Math.sin(player.runAnimTime) * 6;
      ctx.fillStyle = agent.scarfColor;
      ctx.beginPath();
      ctx.moveTo(left, top + 16);
      ctx.lineTo(left - 24, top + 12 + scarfWave);
      ctx.lineTo(left - 18, top + 24 + scarfWave);
      ctx.closePath();
      ctx.fill();

      // 冗余故障护盾光环
      if (player.shields > 0) {
        ctx.strokeStyle = '#b829ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, -h / 2, Math.max(w, h) * 0.72, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (player.invulnTimer > 0) {
        ctx.strokeStyle = Math.sin(performance.now() * 0.04) > 0 ? '#00ff88' : '#ff0055';
        ctx.lineWidth = 2;
        ctx.strokeRect(left - 5, top - 4, w + 10, h + 8);
      }
    }

    ctx.restore();

    // 绘制角色头顶跟随微缩血条与 BUFFERING 转圈图标
    if (game.state === 'PLAYING' || game.state === 'PAUSED' || game.state === 'DRAFT') {
      const barW = 48;
      const barH = 6;
      const bx = player.x + player.width / 2 - barW / 2;
      const by = player.y - player.height * player.scaleY - 16;
      const hpRatio = clamp(player.hp / player.maxHp, 0, 1);
      const trailRatio = clamp(player.trailHp / player.maxHp, 0, 1);

      ctx.save();
      ctx.fillStyle = 'rgba(7, 10, 20, 0.85)';
      ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(bx, by, barW * trailRatio, barH);

      ctx.fillStyle = hpRatio > 0.6 ? '#00ff88' : (hpRatio > 0.3 ? '#ffe600' : '#ff0055');
      ctx.fillRect(bx, by, barW * hpRatio, barH);

      ctx.strokeStyle = 'rgba(0, 243, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 1, by - 1, barW + 2, barH + 2);

      if (game.lagActive) {
        const cx = player.x + player.width / 2;
        const cy = by - 22;
        const stepAngle = Math.floor(performance.now() / 110) * (Math.PI / 4);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(stepAngle);
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 1.35);
        ctx.stroke();
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 5, Math.PI, Math.PI * 2.1);
        ctx.stroke();
        ctx.restore();

        ctx.font = '900 10px "Courier New", monospace';
        ctx.fillStyle = '#ffe600';
        ctx.textAlign = 'center';
        ctx.fillText('BUFFERING 999ms...', cx, cy - 13);
      }

      ctx.restore();
    }
  }

  function drawParticlesAndPopTexts(ctx) {
    for (const sw of shockwaves) {
      const k = sw.life / sw.maxLife;
      const radius = sw.maxRadius * easeOutCubic(k);
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.75;
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = Math.max(1.5, 6 * (1 - k));
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const p of particles) {
      const k = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      if (p.style === 'glitch') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size * 0.25, p.size * 1.4, p.size * 0.5);
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }

    for (const pt of popTexts) {
      const progress = pt.life / pt.maxLife;
      const alpha = 1 - easeOutCubic(progress);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `900 ${pt.size}px "Segoe UI", "Microsoft YaHei", monospace`;
      ctx.fillStyle = pt.color;
      ctx.strokeStyle = '#050811';
      ctx.lineWidth = 3;
      ctx.textAlign = 'center';
      ctx.strokeText(pt.text, pt.x, pt.y);
      ctx.fillText(pt.text, pt.x, pt.y);
      ctx.restore();
    }
  }

  function drawPostProcessing(ctx, W, H, game) {
    if (game.lagActive && !camera.reduceMotion) {
      for (let i = 0; i < 6; i++) {
        const sliceY = Math.random() * H;
        const sliceH = 8 + Math.random() * 28;
        const shift = (Math.random() - 0.5) * 34;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 0, 85, 0.19)' : 'rgba(0, 243, 255, 0.19)';
        ctx.fillRect(shift, sliceY, W, sliceH);
      }

      for (let b = 0; b < 8; b++) {
        const bx = Math.random() * W;
        const by = Math.random() * H;
        const bw = 24 + Math.random() * 64;
        const bh = 12 + Math.random() * 28;
        ctx.fillStyle = b % 3 === 0
          ? 'rgba(255, 230, 0, 0.22)'
          : (b % 2 === 0 ? 'rgba(0, 243, 255, 0.24)' : 'rgba(255, 0, 85, 0.24)');
        ctx.fillRect(bx, by, bw, bh);
      }
    }

    if ((camera.vertigoAmount > 0.05 || game.lagActive) && !camera.reduceMotion) {
      const vStrength = Math.max(camera.vertigoAmount, game.lagActive ? 0.75 : 0);
      const radGrad = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, Math.max(W, H) * 0.72);
      radGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      radGrad.addColorStop(0.7, `rgba(184, 41, 255, ${0.14 * vStrength})`);
      radGrad.addColorStop(1, `rgba(255, 0, 85, ${0.38 * vStrength})`);
      ctx.fillStyle = radGrad;
      ctx.fillRect(0, 0, W, H);
    }

    if (camera.snowStaticTimer > 0) {
      const intensity = (camera.snowStaticTimer / 0.28) * (camera.reduceMotion ? 0.35 : 0.78);
      ctx.save();
      ctx.globalAlpha = intensity;
      const bands = 30;
      for (let i = 0; i < bands; i++) {
        const by = (i / bands) * H;
        const bh = H / bands;
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(220, 255, 240, 0.42)' : 'rgba(0, 255, 136, 0.26)';
        ctx.fillRect((Math.random() - 0.5) * 45, by, W, bh * 0.65);
      }
      ctx.restore();
    }

    if (camera.whiteFlash > 0 && !camera.reduceMotion) {
      ctx.fillStyle = `rgba(255, 255, 255, ${camera.whiteFlash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  LH.Renderer = {
    renderGame
  };
})(window.LagHero);
