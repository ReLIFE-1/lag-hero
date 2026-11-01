window.LagHero = window.LagHero || {};

(function (LH) {
  const { AGENT_CLASSES, SHOP_UPGRADES, QUEST_DEFINITIONS } = LH.ContentData;
  const { DIFFICULTY_CONFIGS, BASE_PHASE_DURATION, clamp } = LH.Constants;

  const STORAGE_KEY = 'lag_hero_profile_v2';
  const LEGACY_BEST_KEY = 'lag_hero_best_score_v1';

  class SaveManager {
    constructor() {
      this.profile = this.loadProfile();
    }

    getDefaultProfile() {
      let legacyBest = 0;
      try {
        legacyBest = parseInt(localStorage.getItem(LEGACY_BEST_KEY) || '0', 10) || 0;
      } catch (e) {}

      const questsState = {};
      for (const q of QUEST_DEFINITIONS) {
        questsState[q.id] = { count: 0, done: false, claimed: false };
      }

      const upgradesState = {};
      for (const upg of SHOP_UPGRADES) {
        upgradesState[upg.id] = 0;
      }

      return {
        version: 2,
        coins: 40, // 初始赠送 40 启动数据金币供体验改装
        shards: 2, // 初始赠送 2 枚 Bug 碎片
        bestScore: legacyBest,
        bestDistance: 0,
        selectedClass: 'zero',
        unlockedClasses: ['zero'],
        upgrades: upgradesState,
        quests: questsState,
        seenLines: [],
        storyFlags: {}
      };
    }

    loadProfile() {
      const def = this.getDefaultProfile();
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return def;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return def;

        // 版本迁移与缺省字段补全 (`rpg` Pitfall 6)
        return {
          ...def,
          ...parsed,
          unlockedClasses: Array.isArray(parsed.unlockedClasses)
            ? parsed.unlockedClasses
            : def.unlockedClasses,
          upgrades: { ...def.upgrades, ...(parsed.upgrades || {}) },
          quests: { ...def.quests, ...(parsed.quests || {}) },
          seenLines: Array.isArray(parsed.seenLines) ? parsed.seenLines : [],
          storyFlags: { ...def.storyFlags, ...(parsed.storyFlags || {}) }
        };
      } catch (e) {
        return def;
      }
    }

    saveProfile() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile));
        localStorage.setItem(LEGACY_BEST_KEY, String(this.profile.bestScore));
      } catch (e) {}
    }

    addCurrency(coinsDelta, shardsDelta = 0) {
      this.profile.coins = Math.max(0, (this.profile.coins || 0) + coinsDelta);
      this.profile.shards = Math.max(0, (this.profile.shards || 0) + shardsDelta);
      this.saveProfile();
    }

    // ==========================================================================
    // `rpg` Pattern 1: Derived Stats from Base + Modifier Layers (Never mutate base)
    // ==========================================================================
    derivePlayerStats(difficultyKey, runModifiers = []) {
      const diff = DIFFICULTY_CONFIGS[difficultyKey] || DIFFICULTY_CONFIGS.medium;
      const agent = AGENT_CLASSES[this.profile.selectedClass] || AGENT_CLASSES.zero;

      // 收集所有修改器层：机体自带 + 局外改装商店 + 局内肉鸽卡牌/剧情分支
      const allMods = [];
      if (agent.baseMods) allMods.push(...agent.baseMods);

      for (const upg of SHOP_UPGRADES) {
        const lvl = this.profile.upgrades[upg.id] || 0;
        if (lvl > 0 && upg.modPerLevel) {
          allMods.push({
            stat: upg.modPerLevel.stat,
            type: upg.modPerLevel.type,
            value: upg.modPerLevel.value * lvl,
            source: `shop_${upg.id}`
          });
        }
      }

      if (Array.isArray(runModifiers)) {
        allMods.push(...runModifiers);
      }

      // 按属性汇总 flat 与 percent (`rpg/references/stats-combat-quests.md` §1)
      const sumStat = (statName, baseVal = 0) => {
        let flatSum = 0;
        let pctSum = 0;
        for (const m of allMods) {
          if (m.stat !== statName) continue;
          if (m.type === 'flat') flatSum += m.value;
          else if (m.type === 'percent') pctSum += m.value;
        }
        return (baseVal + flatSum) * (1 + pctSum);
      };

      const maxHp = Math.round(sumStat('maxHp', diff.maxHp));
      const lagRecharge = diff.lagRecharge * (1 + sumStat('lagRechargePct', 0));
      const lagDrain = Math.max(10, diff.lagDrain * clamp(1 + sumStat('lagDrainMult', 0), 0.35, 2.0));
      const phaseDuration = BASE_PHASE_DURATION + sumStat('phaseDurationAdd', 0);
      const magnetRadius = sumStat('magnetRadius', 42);
      const slashDamage = Math.round(45 * (1 + sumStat('slashDamagePct', 0)));
      const slashRange = Math.round(115 * (1 + sumStat('slashRangePct', 0)));
      const maxLagSlashes = 4 + Math.round(sumStat('maxLagSlashes', 0));
      const extraJumps = Math.round(sumStat('extraJumps', 0));
      const startShields = Math.round(sumStat('startShields', 0));
      const swordWaveCount = Math.round(sumStat('swordWaveCount', 0));
      const lootMultiplier = 1 + Math.round(sumStat('lootMultiplier', 0));

      return {
        maxHp,
        lagRecharge,
        lagDrain,
        phaseDuration,
        magnetRadius,
        slashDamage,
        slashRange,
        maxLagSlashes,
        maxJumps: 2 + extraJumps,
        startShields,
        swordWaveCount,
        lootMultiplier
      };
    }

    // ==========================================================================
    // `rpg` Pattern 3: Quest Objective Update Driven by Game Events
    // ==========================================================================
    recordEvent(eventKind, amount = 1) {
      let updated = false;
      for (const def of QUEST_DEFINITIONS) {
        if (def.event !== eventKind) continue;
        if (!this.profile.quests[def.id]) {
          this.profile.quests[def.id] = { count: 0, done: false, claimed: false };
        }
        const qState = this.profile.quests[def.id];
        if (!qState.done) {
          qState.count = Math.min(def.needed, qState.count + amount);
          if (qState.count >= def.needed) {
            qState.done = true;
          }
          updated = true;
        }
      }
      if (updated) this.saveProfile();
    }

    claimQuestReward(questId) {
      const def = QUEST_DEFINITIONS.find((q) => q.id === questId);
      const qState = this.profile.quests[questId];
      if (!def || !qState || !qState.done || qState.claimed) return false;

      qState.claimed = true;
      this.addCurrency(def.rewardCoins || 0, def.rewardShards || 0);
      return true;
    }

    buyShopUpgrade(upgradeId) {
      const upg = SHOP_UPGRADES.find((u) => u.id === upgradeId);
      if (!upg) return { ok: false, msg: '未知改装项' };
      const curLvl = this.profile.upgrades[upgradeId] || 0;
      if (curLvl >= upg.maxLevel) return { ok: false, msg: '已达最高等级' };

      const cost = upg.baseCost + curLvl * upg.costStep;
      if (upg.currency === 'shards') {
        if (this.profile.shards < cost) return { ok: false, msg: 'Bug 碎片不足' };
        this.profile.shards -= cost;
      } else {
        if (this.profile.coins < cost) return { ok: false, msg: '数据金币不足' };
        this.profile.coins -= cost;
      }

      this.profile.upgrades[upgradeId] = curLvl + 1;
      this.saveProfile();
      return { ok: true, level: curLvl + 1 };
    }

    unlockOrSelectClass(classId) {
      const cls = AGENT_CLASSES[classId];
      if (!cls) return { ok: false, msg: '未知机体' };

      if (this.profile.unlockedClasses.includes(classId)) {
        this.profile.selectedClass = classId;
        this.saveProfile();
        return { ok: true, action: 'selected' };
      }

      if (this.profile.coins < cls.costCoins) {
        return { ok: false, msg: `解锁需要 ${cls.costCoins} 金币` };
      }

      this.profile.coins -= cls.costCoins;
      this.profile.unlockedClasses.push(classId);
      this.profile.selectedClass = classId;
      this.saveProfile();
      return { ok: true, action: 'unlocked' };
    }
  }

  LH.SaveManager = SaveManager;
  LH.saveManager = new SaveManager();
})(window.LagHero);
