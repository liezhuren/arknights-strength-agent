// tools/overrides.mjs —— 机制校准表（LLM 描述解析产物沉淀区）
// blackboard 通用规则无法解析的特殊干员/技能，由"LLM 阅读天赋/技能描述"产出机制补丁，
// 经人工审核后沉淀于此（评测 agent 流程：读描述 → 生成补丁 → 入表 → 引擎消费）。
// 字段：
//   attackMult?   普攻倍率修正（棘刺式特例）
//   damageType?   伤害类型修正
//   trapPatch?    陷阱/棋子持续模型补丁 { multBonusPct, resPenetrate, ... }
//   burstPatch?   单次窗口爆发技能补丁 { perDeployHits, hitMult, maxDeploysPerSkill, skillWindowSec, deploys, windowSec }
//                 （技能形态为"按部署次数 × 每次枚数结算"时用，覆盖持续模型口径）
//   note          解析依据（描述原文要点）
export const SKILL_OVERRIDES = {
  棘刺: {
    2: { attackMult: 1.6, note: '至高之术：攻击力+60%（atk=0.6 实为消除远程攻击-40%惩罚，非倍率）' },
  },
  望: {
    // 机制解析（用户提供 + 实测校准）：天下劫为"单次窗口爆发"技能。
    // 每次手动部署 1 枚棋子 → 天赋1 在 S3 强化下于周围四格额外部署 → 四格全空时形成十字阵 5 枚，
    // 每枚引爆造成 380% 面板法术伤害（即每次部署 = 5×380%）。
    // 库存 8 枚 → 单次技能 8 次部署 = 40 枚；战前积攒 + 技能结束弹药返还 → 理想轴 16 次部署 = 80 枚。
    // 校准：80 枚 × 380% × 589 = 179056（实测 179119，差 63 取整）；轴长 ~78s → DPS ≈ 2296（社区轴 50s+ × 2300+）。
    2: {
      burstPatch: {
        perDeployHits: 5, // 十字阵 5 枚
        hitMult: 3.8,
        maxDeploysPerSkill: 8, // 单次技能可用部署次数（8 枚库存棋子）
        skillWindowSec: 14, // 打完单次技能棋子的操作窗口
        deploys: 16, // 理想轴内总部署次数（含战前积攒与技能返还）
        windowSec: 78, // 轴长（秒）
        label: '天下劫：每次部署十字5枚×380%；单次技能8部署=40枚；理想轴16部署=80枚≈179056，78s→2296 DPS',
      },
    },
  },
}

// tools/overrides.mjs —— 干员级模组补丁（数值效果 PRTS 解析产物）
// 数据仓库只提供模组元数据（名称/类型/描述）；数值效果须从 PRTS 页面解析后沉淀于此。
// 字段：moduleName/type/scope（生效范围）/effect（结构化效果，可选）/note（描述要点）
// 注意：特限模组（ISW-*）仅在对应玩法（集成战略）生效，默认评测不启用，仅标注。
export const MODULE_OVERRIDES = {
  水月: {
    moduleName: '水月特限证章',
    type: 'ISW-α（集成战略特限）',
    scope: '集成战略',
    effect: { extraTargets: 1, extraTargetsInSkill: 2, drag: true },
    note: '集成战略中：目标数+1并将其大力拖拽到面前，技能期间目标数再+2（拖拽=位移聚怪，间接强化控制覆盖）',
    source: 'PRTS 水月页 ISW-α 3级（2026-09 抓取）',
  },
}
