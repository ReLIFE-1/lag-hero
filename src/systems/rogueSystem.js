window.LagHero = window.LagHero || {};

(function (LH) {
  const { PERK_CARDS } = LH.ContentData;
  const { audio } = LH;
  const { spawnPopText, triggerFeedback, spawnShockwave } = LH.CameraFX;

  // ============================================================================
  // 局内 Roguelike 故障协议卡牌构筑系统 (`card-game` Patterns 1 & 2 + `roguelike` §4)
  // ============================================================================
  class RogueSystem {
    constructor() {
      this.resetRun(null);
    }

    resetRun(rng) {
      this.rng = rng;
      // Zones: deck -> hand (draft choices) -> activePerks / discard (`card-game` Pattern 1)
      this.deck = PERK_CARDS.map((c) => ({ ...c }));
      this.hand = [];
      this.discard = [];
      this.activePerks = [];
      this.runModifiers = [];
      this.triggers = {
        on_rewind: [],
        on_lag_end: [],
        on_phase_tick: [],
        on_air_jump: [],
        on_kill_or_shard: []
      };
      this.nextDraftDistance = 280;
      this.draftStep = 300;
      this.isDrafting = false;

      if (this.rng) {
        this.deck = this.rng.shuffle(this.deck);
      }
      this.renderActivePerksHUD();
    }

    // `card-game` Pattern 1: Draw from deck with automatic discard reshuffle
    drawChoices(count = 3) {
      // 将上一轮未选中的手牌移入弃牌堆
      while (this.hand.length > 0) {
        this.discard.push(this.hand.pop());
      }

      for (let i = 0; i < count; i++) {
        if (this.deck.length === 0) {
          if (this.discard.length === 0) break;
          this.deck = this.rng ? this.rng.shuffle(this.discard) : this.discard.slice();
          this.discard = [];
        }
        if (this.deck.length > 0) {
          this.hand.push(this.deck.pop());
        }
      }
      return this.hand;
    }

    openDraftModal(gameCtx, reasonText = '内存溢出 · 选择 1 项故障协议注入') {
      if (this.isDrafting) return;
      const choices = this.drawChoices(3);
      if (choices.length === 0) return;

      this.isDrafting = true;
      gameCtx.game.state = 'DRAFT';
      gameCtx.game.lagActive = false;
      audio.stopLagDrone();

      const modal = document.getElementById('perk-modal');
      const subEl = document.getElementById('perk-modal-subtitle');
      const container = document.getElementById('perk-cards-container');
      if (subEl) subEl.textContent = reasonText;

      if (container) {
        container.innerHTML = '';
        choices.forEach((card, idx) => {
          const cardEl = document.createElement('div');
          cardEl.className = `perk-card rarity-${card.rarity}`;
          cardEl.innerHTML = `
            <div>
              <span class="perk-rarity-tag">${card.rarity} PROTOCOL</span>
              <div class="perk-title">${card.name}</div>
              <p class="perk-desc">${card.desc}</p>
            </div>
            <div class="perk-pick-hint">[按键 ${idx + 1} / 点击挂载] ▶</div>
          `;
          cardEl.addEventListener('click', (e) => {
            if (e.currentTarget && typeof e.currentTarget.blur === 'function') {
              e.currentTarget.blur();
            }
            this.pickCard(idx, gameCtx);
          });
          container.appendChild(cardEl);
        });
      }

      if (modal) modal.classList.remove('hidden');
    }

    // `card-game` Pattern 2: Atomic card play & data-driven effect resolution
    pickCard(handIndex, gameCtx) {
      if (!this.isDrafting || handIndex < 0 || handIndex >= this.hand.length) return false;

      // 从 hand 移除选中卡牌，其余移入 discard（严格保证单区域归属）
      const chosen = this.hand.splice(handIndex, 1)[0];
      while (this.hand.length > 0) {
        this.discard.push(this.hand.pop());
      }
      // 允许可叠加协议再次洗回弃牌堆，保证长局后期仍有牌可抽
      this.discard.push({ ...chosen });
      this.activePerks.push(chosen);

      // 解释执行卡牌效果列表 (`card-game/references/effect-resolution.md` §1)
      for (const fx of chosen.effects) {
        this.resolveEffectOp(fx, chosen, gameCtx);
      }

      // 重新推导玩家属性 (`rpg` Pattern 1)
      if (typeof gameCtx.recomputePlayerStats === 'function') {
        gameCtx.recomputePlayerStats();
      }

      audio.playPickup(true);
      this.renderActivePerksHUD();

      const modal = document.getElementById('perk-modal');
      if (modal) modal.classList.add('hidden');
      this.isDrafting = false;
      gameCtx.game.state = 'PLAYING';
      if (typeof gameCtx.onResumeFromModal === 'function') {
        gameCtx.onResumeFromModal();
      }

      spawnPopText(
        gameCtx.player.x + 20,
        gameCtx.player.y - 75,
        `⚡ 协议激活: ${chosen.name}!`,
        '#ffe600',
        18
      );
      return true;
    }

    resolveEffectOp(fx, card, gameCtx) {
      const player = gameCtx.player;
      switch (fx.op) {
        case 'add_mod':
          this.runModifiers.push({
            stat: fx.stat,
            type: fx.type,
            value: fx.value,
            source: `perk_${card.id}`
          });
          break;
        case 'register_trigger':
          if (this.triggers[fx.trigger]) {
            this.triggers[fx.trigger].push({
              action: fx.action,
              power: fx.power || 0,
              amount: fx.amount || 0,
              source: card.id
            });
          }
          break;
        case 'heal':
          if (player) {
            player.hp = Math.min(player.maxHp + 40, player.hp + (fx.amount || 30));
          }
          break;
        case 'grant_shield':
          if (player) {
            player.shields = (player.shields || 0) + (fx.amount || 1);
          }
          break;
        default:
          break;
      }
    }

    // 触发事件总线 (`card-game/references/effect-resolution.md` §3)
    fireTrigger(triggerName, context) {
      const list = this.triggers[triggerName];
      if (!list || list.length === 0) return;

      const { game, player, obstacles, projectiles, collectibles, bossManager } = context;

      for (const trig of list) {
        if (trig.action === 'quantum_blast') {
          // 量子丢包爆破：震碎全屏陷阱并对 Boss 造成伤害
          spawnShockwave(player.x + 20, player.y - 30, '#00ff88', 460);
          triggerFeedback(player.x + 20, player.y - 30, 'large', '#00ff88');
          if (obstacles) obstacles.length = 0;
          if (projectiles) projectiles.length = 0;
          if (bossManager && bossManager.activeBoss) {
            bossManager.damageBoss(trig.power || 140, player);
          }
          spawnPopText(player.x + 40, player.y - 95, '💥 量子丢包爆破!', '#00ff88', 19);
        } else if (trig.action === 'ddos_shockwave') {
          // DDoS 脉冲新星：清屏弹幕与近身陷阱
          spawnShockwave(player.x + 20, player.y - 30, '#00f3ff', 380);
          if (projectiles) projectiles.length = 0;
          if (obstacles) {
            for (let i = obstacles.length - 1; i >= 0; i--) {
              if (obstacles[i].x < player.x + 480) {
                obstacles.splice(i, 1);
              }
            }
          }
          if (bossManager && bossManager.activeBoss) {
            bossManager.damageBoss(trig.power || 95, player);
          }
          spawnPopText(player.x + 30, player.y - 85, '🌊 DDoS 电磁脉冲!', '#00f3ff', 17);
        } else if (trig.action === 'phase_vacuum') {
          // 超频穿模：全屏吸附金币与碎片
          if (collectibles) {
            for (const item of collectibles) {
              if (!item.collected && item.x < 1300) {
                item.x += (player.x - item.x) * 0.22;
                item.y += (player.y - 30 - item.y) * 0.22;
              }
            }
          }
        } else if (trig.action === 'restore_bandwidth') {
          if (game) {
            game.bandwidth = Math.min(100, game.bandwidth + (trig.amount || 12));
          }
        } else if (trig.action === 'vampiric_heal') {
          if (player) {
            const healAmt = trig.amount || 10;
            if (player.hp < player.maxHp) {
              player.hp = Math.min(player.maxHp, player.hp + healAmt);
              spawnPopText(player.x, player.y - 65, `🩸 +${healAmt} HP`, '#00ff88', 14);
            }
          }
        }
      }
    }

    renderActivePerksHUD() {
      const bar = document.getElementById('active-perks-bar');
      if (!bar) return;
      if (this.activePerks.length === 0) {
        bar.innerHTML = '';
        return;
      }
      bar.innerHTML = this.activePerks
        .map((p) => `<span class="perk-mini-chip" title="${p.desc}">⚡ ${p.name}</span>`)
        .join('');
    }
  }

  LH.RogueSystem = RogueSystem;
  LH.rogueSystem = new RogueSystem();
})(window.LagHero);
