window.LagHero = window.LagHero || {};

(function (LH) {
  // ============================================================================
  // 1. 三大可选特工机体 (`rpg` 基础属性与被动特性)
  // ============================================================================
  const AGENT_CLASSES = {
    zero: {
      id: 'zero',
      name: '零号黑客 · ZERO',
      costCoins: 0,
      color: '#00f3ff',
      scarfColor: '#00ff88',
      desc: '均衡型初始机体。网络带宽恢复速度 +15%，自带稳定帧率核心。',
      baseMods: [
        { stat: 'lagRechargePct', type: 'percent', value: 0.15, source: 'class_zero' }
      ]
    },
    phantom: {
      id: 'phantom',
      name: '幽灵行者 · PHANTOM',
      costCoins: 80,
      color: '#b829ff',
      scarfColor: '#00f3ff',
      desc: '穿模态特化机体。【穿模滑铲】持续时间 +0.8s，且穿墙时自动磁吸周围金币与碎片。',
      baseMods: [
        { stat: 'phaseDurationAdd', type: 'flat', value: 0.8, source: 'class_phantom' },
        { stat: 'magnetRadius', type: 'flat', value: 110, source: 'class_phantom' }
      ]
    },
    chrono: {
      id: 'chrono',
      name: '时之剑客 · CHRONO',
      costCoins: 140,
      color: '#ffe600',
      scarfColor: '#ff0055',
      desc: '高爆发战斗机体。【卡顿斩】伤害 +45%、刀光范围 +30%，主动卡死积蓄斩击上限提升至 6 道。',
      baseMods: [
        { stat: 'slashDamagePct', type: 'percent', value: 0.45, source: 'class_chrono' },
        { stat: 'slashRangePct', type: 'percent', value: 0.30, source: 'class_chrono' },
        { stat: 'maxLagSlashes', type: 'flat', value: 1, source: 'class_chrono' }
      ]
    }
  };

  // ============================================================================
  // 2. 局外黑市改装车间升级项 (`rpg` Pattern 1 Modifier Layer)
  // ============================================================================
  const SHOP_UPGRADES = [
    {
      id: 'max_hp',
      name: '核心生命扩容',
      desc: '每级永久提升 +20 最大生命值上限。',
      maxLevel: 5,
      currency: 'coins',
      baseCost: 30,
      costStep: 25,
      modPerLevel: { stat: 'maxHp', type: 'flat', value: 20 }
    },
    {
      id: 'bandwidth_boost',
      name: '光纤超频模块',
      desc: '每级降低 8% 主动卡死带宽消耗，并提升 10% 充能速度。',
      maxLevel: 5,
      currency: 'coins',
      baseCost: 35,
      costStep: 30,
      modPerLevel: { stat: 'lagRechargePct', type: 'percent', value: 0.12 }
    },
    {
      id: 'slash_amplifier',
      name: '高频脉冲刀锋',
      desc: '每级提升 +20%【卡顿斩】伤害与剑气范围，更容易斩碎无人机与 Boss 装甲。',
      maxLevel: 5,
      currency: 'coins',
      baseCost: 40,
      costStep: 35,
      modPerLevel: { stat: 'slashDamagePct', type: 'percent', value: 0.20 }
    },
    {
      id: 'data_magnet',
      name: '数据磁极线圈',
      desc: '每级增加 +55px 自动吸附数据金币与 Bug 碎片的磁场半径。',
      maxLevel: 4,
      currency: 'coins',
      baseCost: 30,
      costStep: 30,
      modPerLevel: { stat: 'magnetRadius', type: 'flat', value: 55 }
    },
    {
      id: 'glitch_shield',
      name: '冗余防火墙护盾',
      desc: '每级使开局自带 +1 层免伤故障护盾（可抵挡一次致命碰撞或激光）。',
      maxLevel: 3,
      currency: 'shards',
      baseCost: 5,
      costStep: 6,
      modPerLevel: { stat: 'startShields', type: 'flat', value: 1 }
    }
  ];

  // ============================================================================
  // 3. 局内 Roguelike 故障协议卡牌库 (`card-game` Effects as Data + Triggers)
  // ============================================================================
  const PERK_CARDS = [
    {
      id: 'quantum_packet',
      name: '量子丢包爆破',
      rarity: 'RARE',
      weight: 22,
      desc: '触发【丢包回溯】时，在原地留下一枚量子残影炸弹，震碎全屏陷阱并对 Boss 造成 140 点真实伤害。',
      effects: [
        { op: 'register_trigger', trigger: 'on_rewind', action: 'quantum_blast', power: 140 }
      ]
    },
    {
      id: 'ddos_nova',
      name: 'DDoS 脉冲新星',
      rarity: 'RARE',
      weight: 22,
      desc: '结束【主动卡死】恢复帧率瞬间，若持续卡顿超过 0.4s，释放全屏电磁震波清除弹幕并摧毁近身障碍。',
      effects: [
        { op: 'register_trigger', trigger: 'on_lag_end', action: 'ddos_shockwave', power: 95 }
      ]
    },
    {
      id: 'overclock_phase',
      name: '超频穿模引擎',
      rarity: 'COMMON',
      weight: 30,
      desc: '【穿模滑铲】持续时间延长 +0.7 秒，且穿模期间全屏磁力吸附所有数据金币与 Bug 碎片。',
      effects: [
        { op: 'add_mod', stat: 'phaseDurationAdd', type: 'flat', value: 0.7 },
        { op: 'register_trigger', trigger: 'on_phase_tick', action: 'phase_vacuum' }
      ]
    },
    {
      id: 'lag_blade_storm',
      name: '延迟剑气风暴',
      rarity: 'LEGENDARY',
      weight: 14,
      desc: '【卡顿斩】额外发射一道向前飞行的穿透型赛博剑气波，可远程斩杀无人机与 Boss！',
      effects: [
        { op: 'add_mod', stat: 'swordWaveCount', type: 'flat', value: 1 },
        { op: 'add_mod', stat: 'slashDamagePct', type: 'percent', value: 0.35 }
      ]
    },
    {
      id: 'triple_jump_driver',
      name: '三段跃迁驱动',
      rarity: 'RARE',
      weight: 20,
      desc: '空中跳跃次数上限 +1（解锁三段跳），且每次空中跳跃立即恢复 12% 网络带宽。',
      effects: [
        { op: 'add_mod', stat: 'extraJumps', type: 'flat', value: 1 },
        { op: 'register_trigger', trigger: 'on_air_jump', action: 'restore_bandwidth', amount: 12 }
      ]
    },
    {
      id: 'vampiric_compiler',
      name: '吸血编译器',
      rarity: 'RARE',
      weight: 20,
      desc: '斩碎无人机/障碍或拾取 Bug 碎片时额外回复 +10 HP；满血时将溢出治疗转化为护盾能量。',
      effects: [
        { op: 'register_trigger', trigger: 'on_kill_or_shard', action: 'vampiric_heal', amount: 10 }
      ]
    },
    {
      id: 'zero_point_bandwidth',
      name: '零点带宽协议',
      rarity: 'COMMON',
      weight: 28,
      desc: '【主动卡死】网络带宽消耗速度降低 35%，充能速度提升 25%。',
      effects: [
        { op: 'add_mod', stat: 'lagDrainMult', type: 'percent', value: -0.35 },
        { op: 'add_mod', stat: 'lagRechargePct', type: 'percent', value: 0.25 }
      ]
    },
    {
      id: 'bug_bounty_hunter',
      name: '赏金猎人协议',
      rarity: 'COMMON',
      weight: 28,
      desc: '本局拾取的所有数据金币与 Bug 碎片收益翻倍（×2），且自动吸附半径 +90px。',
      effects: [
        { op: 'add_mod', stat: 'lootMultiplier', type: 'flat', value: 1 },
        { op: 'add_mod', stat: 'magnetRadius', type: 'flat', value: 90 }
      ]
    },
    {
      id: 'hotfix_aegis',
      name: '热修复圣盾',
      rarity: 'LEGENDARY',
      weight: 14,
      desc: '立即回复 50 HP，最大生命值 +40，并立即获得 +2 层免伤故障护盾！',
      effects: [
        { op: 'add_mod', stat: 'maxHp', type: 'flat', value: 40 },
        { op: 'heal', amount: 50 },
        { op: 'grant_shield', amount: 2 }
      ]
    }
  ];

  // ============================================================================
  // 4. 悬赏任务与成就系统 (`rpg/references/stats-combat-quests.md` §6)
  // ============================================================================
  const QUEST_DEFINITIONS = [
    {
      id: 'q_phase_walls',
      title: '穿墙骇客',
      desc: '利用【穿模滑铲】累计穿透 8 面巨型防火墙或障碍。',
      event: 'phase_through',
      needed: 8,
      rewardCoins: 60,
      rewardShards: 2
    },
    {
      id: 'q_lag_slash',
      title: '时空刀客',
      desc: '使用【卡顿斩】累计斩碎 10 个赛博无人机、陷阱或弹幕。',
      event: 'slash_destroy',
      needed: 10,
      rewardCoins: 80,
      rewardShards: 3
    },
    {
      id: 'q_rewind_save',
      title: '丢包后悔药',
      desc: '使用【丢包回溯】累计时空倒带 5 次。',
      event: 'use_rewind',
      needed: 5,
      rewardCoins: 50,
      rewardShards: 2
    },
    {
      id: 'q_collect_shards',
      title: '漏洞收集者',
      desc: '累计收集 12 枚隐藏在危险区的 Bug 碎片。',
      event: 'collect_shard',
      needed: 12,
      rewardCoins: 90,
      rewardShards: 4
    },
    {
      id: 'q_boss_slayer',
      title: '404 终结者',
      desc: '在赛博矩阵中击败任意 1 尊守门人 Boss。',
      event: 'kill_boss',
      needed: 1,
      rewardCoins: 150,
      rewardShards: 6
    },
    {
      id: 'q_distance_1000',
      title: '千兆狂飙',
      desc: '单局奔跑距离突破 600 米。',
      event: 'reach_600m',
      needed: 1,
      rewardCoins: 100,
      rewardShards: 4
    }
  ];

  // ============================================================================
  // 5. 阶段 Boss 配置表 (`Boss Encounters`)
  // ============================================================================
  const BOSS_TEMPLATES = [
    {
      id: 'boss_404_titan',
      name: '404 守门人 · 防火墙巨像',
      baseHp: 420,
      color: '#ff0055',
      coreColor: '#00f3ff',
      rewardCoins: 45,
      rewardShards: 3
    },
    {
      id: 'boss_loop_matriarch',
      name: '死循环核心 · 木马母体',
      baseHp: 620,
      color: '#b829ff',
      coreColor: '#ffe600',
      rewardCoins: 75,
      rewardShards: 5
    }
  ];

  // ============================================================================
  // 6. Visual Novel 赛博终端剧情脚本 (`visual-novel/references/script-and-flow.md`)
  // ============================================================================
  const VN_SCRIPTS = {
    prologue: {
      id: 'prologue',
      nodes: [
        {
          kind: 'line',
          speaker: 'OPERATOR · 艾拉',
          avatar: 'AI',
          text: '特工，你已成功接入濒临崩溃的「2077 核心矩阵」。侦测到全网延迟极度异常——但现在，“卡顿”就是你的武器！'
        },
        {
          kind: 'line',
          speaker: 'OPERATOR · 艾拉',
          avatar: 'AI',
          text: '按 [A/D] 可微调走位，按 [J] 或点击挥出「卡顿斩」斩碎无人机与弹幕！长按 [空格] 开启主动卡死时，每次出刀都会积蓄延迟残影斩！'
        },
        {
          kind: 'choice',
          speaker: '系统终端 · 初始协议注入',
          avatar: '⚡',
          text: '出发前，请选择你的初始黑客战术装载（对本局立即生效）：',
          options: [
            {
              label: '🗡️ 激进超频（卡顿斩伤害 +25%，获赠 10 金币）',
              setFlag: 'choice_aggressive',
              effect: { type: 'buff_slash', value: 0.25, coins: 10 },
              nextIndex: 3
            },
            {
              label: '🛡️ 冗余防护（立即获得 +1 层免伤故障护盾）',
              setFlag: 'choice_defensive',
              effect: { type: 'buff_shield', value: 1 },
              nextIndex: 3
            }
          ]
        },
        {
          kind: 'line',
          speaker: 'OPERATOR · 艾拉',
          avatar: 'AI',
          text: '协议挂载完毕！前方 300m 将迎来第一次「内存溢出」协议构筑，550m 处有 404 守门人拦路，祝你好运！'
        }
      ]
    },
    boss_intro_1: {
      id: 'boss_intro_1',
      nodes: [
        {
          kind: 'line',
          speaker: 'WARNING · 系统警报',
          avatar: '⚠️',
          text: '警告！前方侦测到高维实体【404 守门人 · 防火墙巨像】！已封锁前进扇区！'
        },
        {
          kind: 'line',
          speaker: 'OPERATOR · 艾拉',
          avatar: 'AI',
          text: '用 [J] 卡顿斩直接劈砍它或反弹它的数据弹幕！在【主动卡死】期间连续按 [J] 积蓄多道残影斩，松开空格即可瞬间引爆巨额伤害！'
        }
      ]
    },
    sector_bsod: {
      id: 'sector_bsod',
      nodes: [
        {
          kind: 'line',
          speaker: 'OPERATOR · 艾拉',
          avatar: 'AI',
          text: '已突破第一扇区！正在进入【Sector 02 · 蓝屏死机深渊】，此区域重力系数降低 14%，注意空中巡逻的故障无人机！'
        }
      ]
    }
  };

  LH.ContentData = {
    AGENT_CLASSES,
    SHOP_UPGRADES,
    PERK_CARDS,
    QUEST_DEFINITIONS,
    BOSS_TEMPLATES,
    VN_SCRIPTS
  };
})(window.LagHero);
