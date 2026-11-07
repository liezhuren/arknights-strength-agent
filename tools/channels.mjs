// tools/channels.mjs —— 通用伤害通道模型
//
// 解决的问题：有一类技能的伤害**不走普通攻击循环**（引导波、召唤物、陷阱、持续伤害、
// 受击反击）。对这类技能，用 `ATK × 倍率 ÷ 攻击间隔` 去算，结果一定是错的 ——
// 塔露拉 S3 就是典型：模型算出 0，实测 4683 DPS。
//
// 设计原则（通用化的关键）：
//   1. 通道只认**参数**，不认干员。参数从哪来都可以（解析层 / 校准账本 / 手工），
//      引擎不含任何"某干员特判"。
//   2. 所有数值相对**技能期 ATK**（`eng.atk × skill.attackMult`），
//      这样装模组、换潜能时通道伤害自动跟着缩放，而不是写死绝对值。
//   3. 每个通道都必须能给出**分项拆分**（颗数 / 单颗伤害 / 地板 / 元素占比），
//      否则无法与实测逐项对账。
//
// ── 参数 schema（所有通道共用外层） ────────────────────────────────
// {
//   kind: 'summon_wave' | 'dot' | 'trap' | 'burst' | 'retaliation',
//   durationSec: number,        // 结算窗口（DPS = 总伤 / durationSec）
//   phases: [{                  // 释放节奏（可多段，如"过载前/过载后"）
//     windowSec: number,        //   该段持续
//     intervalSec: number,      //   每颗间隔
//     firstDelaySec?: number,   //   该段首颗延迟（默认 0）
//   }],
//   perBallAtkScale: number,    // 每颗伤害 = ATK × 该系数
//   fieldAtkScalePerSec?: number, // 持续地面/地板伤害 = ATK × 该系数 / 秒
//   elementShare?: number,      // 元素伤害占总伤比例（仅用于标注，不重复相加）
//   leaderFactor?: number,      // 对领袖的总伤系数（元素抗性等）
//   note / source               // 校准依据（必须能追溯到实测）
// }
//
// ⚠ 已知边界：phases 里的节奏**必须来自实测或解析**，不能从 blackboard 直接推 ——
//   塔露拉的 `normal_interval=2.67` 与实测 1.33s 差一倍，正是这个坑。

/** 单段释放次数：首次在 firstDelay 秒，之后每 interval 秒一颗，窗口内取整。 */
export function phaseCount(phase) {
  const win = Number(phase?.windowSec)
  const iv = Number(phase?.intervalSec)
  const delay = Number(phase?.firstDelaySec ?? 0)
  if (!Number.isFinite(win) || !Number.isFinite(iv) || iv <= 0 || win <= 0) return 0
  if (win < delay) return 0
  return Math.floor((win - delay) / iv) + 1
}

/**
 * 计算一个通道的总伤与 DPS。
 * @param {object} params 上面的 schema
 * @param {number} skillAtk 技能期 ATK（= 面板 ATK × 技能倍率）
 * @returns {{ok:boolean, error?:string, kind?:string, balls?:number, perBallDamage?:number,
 *            ballDamage?:number, fieldDamage?:number, totalDamage?:number, dps?:number,
 *            leaderDps?:number, elementTotal?:number|null, durationSec?:number, note?:string, source?:string,
 *            breakdown?:Array<{windowSec:number, intervalSec:number, count:number}>}}
 */
export function computeChannel(params, skillAtk, target = {}) {
  if (!params || typeof params !== 'object') return { ok: false, error: '通道参数为空' }
  const durationSec = Number(params.durationSec)
  if (!Number.isFinite(durationSec) || durationSec <= 0) return { ok: false, error: 'durationSec 非法' }
  if (!Number.isFinite(skillAtk) || skillAtk <= 0) return { ok: false, error: '技能期 ATK 非法' }

  const breakdown = (params.phases ?? []).map((p) => ({
    windowSec: Number(p.windowSec) || 0,
    intervalSec: Number(p.intervalSec) || 0,
    count: phaseCount(p),
  }))
  const balls = breakdown.reduce((a, b) => a + b.count, 0)

  // ── 伤害类型分流（通用机制，不是某个干员的特判）─────────────────────
  // 元素伤害**无视法抗**；法术伤害按 RES 减免。用 `elementBalls` 表示"有多少颗转成元素"，
  // 这是"目标处于元素爆发期间时伤害改为元素"这类机制的通用表达。
  const res = Math.max(0, Math.min(Number(target.res ?? 0), 100))
  const def = Math.max(0, Number(target.def ?? 0))
  const perBallRaw = Number(params.perBallAtkScale ?? 0) * skillAtk
  const elementBalls = Math.max(0, Math.min(Number(params.elementBalls ?? 0), balls))
  const magicBalls = balls - elementBalls

  const elementDamage = elementBalls * perBallRaw
  const magicDamage = magicBalls * perBallRaw * (1 - res / 100)
  const ballDamage = elementDamage + magicDamage

  const fieldRaw = Number(params.fieldAtkScalePerSec ?? 0) * skillAtk * durationSec
  // 地板默认按法术结算（吃法抗）；`fieldDamageType: 'element'` 时不减免
  const fieldIsElement = params.fieldDamageType === 'element'
  const fieldDamage = fieldIsElement ? fieldRaw : fieldRaw * (1 - res / 100)

  const totalDamage = ballDamage + fieldDamage
  const dps = totalDamage / durationSec
  // RES=0 的木桩口径（与社区"dph/总伤"实测对账用）
  const rawTotal = balls * perBallRaw + fieldRaw

  return {
    ok: true,
    kind: params.kind ?? 'unknown',
    balls,
    elementBalls,
    magicBalls,
    perBallDamage: perBallRaw,
    elementDamage,
    magicDamage,
    ballDamage,
    fieldDamage,
    totalDamage,
    durationSec,
    dps,
    leaderDps: dps * (Number(params.leaderFactor) || 1),
    res,
    def,
    // 木桩口径（RES=0）—— 用于和视频/社区实测对账
    rawTotalDamage: rawTotal,
    rawDps: rawTotal / durationSec,
    elementTotal: elementDamage || null,
    note: params.note ?? null,
    source: params.source ?? null,
    breakdown,
  }
}

/** 参数自检：给解析层/校准账本用，提前拦住明显填错的表。 */
export function validateChannelParams(params) {
  const errs = []
  if (!params || typeof params !== 'object') return ['通道参数为空']
  if (!(Number(params.durationSec) > 0)) errs.push('durationSec 必须 > 0')
  if (!Array.isArray(params.phases) || params.phases.length === 0) errs.push('phases 不能为空')
  for (const [i, p] of (params.phases ?? []).entries()) {
    if (!(Number(p.windowSec) > 0)) errs.push(`phases[${i}].windowSec 必须 > 0`)
    if (!(Number(p.intervalSec) > 0)) errs.push(`phases[${i}].intervalSec 必须 > 0`)
  }
  if (!(Number(params.perBallAtkScale) > 0)) errs.push('perBallAtkScale 必须 > 0')
  if (!params.note) errs.push('必须填写 note（校准依据）')
  if (!params.source) errs.push('必须填写 source（实测来源）')
  return errs
}
