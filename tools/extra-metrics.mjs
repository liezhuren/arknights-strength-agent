// tools/extra-metrics.mjs —— ② 团队增益栏 + ③ 控制栏
// 设计依据：docs/eval-standards.md（三栏标准）。两栏均不并入 DPS 数字，只出独立指标 + 评注。
// 弹性部分（可用性/配合/场景价值/Boss 有效性）标注为 LLM 介入点，由 agent 判断。
import fs from 'node:fs'

const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '')
const bbOf = (x) => Object.fromEntries((x?.blackboard ?? []).map((b) => [b.key, b.value]))

/** 标准场景基准（折算用，可被调用方覆盖）。 */
export const BENCH = { def: 400, res: 50, atkRef: 800 }

/**
 * 提取团队增益项（对敌减益 / 易伤脆弱 / 虚弱 / 友方增益）。
 * @param {object} op - 数据集干员
 * @param {number} [skillIndex] - 取该技能专三数据（默认 2）
 */
export function extractTeamBuff(op, skillIndex = 2) {
  const items = []
  const lv = op.skills?.[skillIndex]?.levels?.[9]

  const push = (type, value, unit, durationSec, coverage, note, source) => {
    items.push({ type, value, unit, durationSec, coverage, note, source })
  }

  // 技能层
  if (lv) {
    const bb = bbOf(lv)
    const d = strip(lv.description)
    const dur = lv.duration > 0 ? lv.duration : null
    const cov = dur ? null : 1 // 覆盖率在调用处按技能周期算（此处留 null 表示待算）
    // 减防：百分比小数（多萝西 -0.35）或绝对点数（伊芙利特 -300）
    if (typeof bb.def === 'number' && bb.def < 0 && /使其|敌军|敌人|目标/.test(d)) {
      const abs = Math.abs(bb.def)
      if (abs <= 1) push('减防', abs * 100, '%', dur, cov, '队友物理输出受益', '技能')
      else push('减防', abs, '点', dur, cov, '队友物理输出受益', '技能')
    }
    // 减抗：天赋小数 / 技能点数
    if (typeof bb.magic_resistance === 'number' && bb.magic_resistance < 0 && /使其|敌军|敌人|目标/.test(d)) {
      const abs = Math.abs(bb.magic_resistance)
      push('减抗', abs <= 1 ? abs * 100 : abs, '点', dur, cov, '队友法术输出受益', '技能')
    }
    if (typeof bb.fake_damage_scale === 'number') push('易伤/脆弱', bb.fake_damage_scale * 100, '%', dur, cov, '受到伤害提升', '技能')
    // damage_scale：描述含"受到/脆弱"= 对敌易伤；否则是自身伤害倍率（不算团队）
    if (typeof bb.damage_scale === 'number') {
      if (/受到|脆弱/.test(d)) push('易伤/脆弱', (bb.damage_scale - 1) * 100, '%', dur, cov, '受到伤害提升', '技能')
      else push('伤害倍率(自身)', bb.damage_scale, 'x', dur, cov, '自身造成伤害倍率，非团队', '技能')
    }
    const weak = bb.weak ?? bb['weak[limit]']
    if (typeof weak === 'number') push('虚弱', weak * 100, '%', dur, cov, '降低敌方攻击力（偏生存）', '技能')
  }

  // 天赋层（常驻）
  for (const t of op.talents ?? []) {
    const bb = bbOf(t)
    const d = strip(t.description)
    if (typeof bb.def === 'number' && bb.def < 0 && /敌军|敌人|目标/.test(d)) {
      const abs = Math.abs(bb.def)
      push('减防', abs <= 1 ? abs * 100 : abs, abs <= 1 ? '%' : '点', null, 1, '天赋常驻', '天赋')
    }
    if (typeof bb.magic_resistance === 'number' && bb.magic_resistance < 0 && /敌军|敌人|目标/.test(d)) {
      const abs = Math.abs(bb.magic_resistance)
      push('减抗', abs <= 1 ? abs * 100 : abs, '点', null, 1, '天赋常驻', '天赋')
    }
    if (typeof bb.damage_scale === 'number' && /受到|脆弱/.test(d)) {
      push('易伤/脆弱', (bb.damage_scale - 1) * 100, '%', null, 1, '天赋常驻（如铃兰停顿→脆弱）', '天赋')
    }
    // 天赋里的负数 atk：描述指向敌人 = 对敌减攻（虚弱，偏生存）；描述含"自身"则是自身惩罚，不算团队
    if (typeof bb.atk === 'number' && bb.atk < 0 && /敌人|敌军|目标/.test(d) && !/自身/.test(d)) {
      push('虚弱', Math.abs(bb.atk) * 100, '%', null, 1, '天赋常驻：降低敌方攻击力（偏生存）', '天赋')
    }
    if (typeof bb['fake.b'] === 'number') push('易伤/脆弱', bb['fake.b'] * 100, '%', null, 1, '天赋常驻', '天赋')
    if (/友方|我方|队友|其他干员/.test(d) && /攻击力\+|攻击速度\+|防御力\+/.test(d)) {
      push('友方增益', null, '', null, 1, d.slice(0, 50), '天赋')
    }
  }
  return items
}

/**
 * 团队增益折算：对标准场景"队友输出"的相对提升（见 docs/eval-standards.md §2.3）。
 * @param {Array} items - extractTeamBuff 结果
 * @param {object} [bench]
 */
export function quantifyTeamBuff(items, bench = BENCH) {
  return items
    .filter((i) => i.value !== null && (i.type === '减防' || i.type === '减抗' || i.type === '易伤/脆弱'))
    .map((i) => {
      let gainPct = null
      if (i.type === '减防') {
        const before = Math.max(bench.atkRef - bench.def, bench.atkRef * 0.05)
        const after = Math.max(bench.atkRef - bench.def * (1 - i.value / 100), bench.atkRef * 0.05)
        gainPct = (after / before - 1) * 100
      } else if (i.type === '减抗') {
        const before = 1 - bench.res / 100
        const after = 1 - Math.max(bench.res - i.value, 0) / 100
        gainPct = (after / before - 1) * 100
      } else if (i.type === '易伤/脆弱') {
        gainPct = i.value
      }
      return { ...i, gainPct }
    })
}

/**
 * 提取控制项（眩晕/冻结/睡眠/束缚/停顿/恐惧）。
 * 关键：控制强度 = 单次时长 ÷ 触发间隔（不是单次时长本身）。
 * 例：水月 S3 攻击间隔 3.5s 只附带 1s 晕眩 → 覆盖率 28.6%；S2 间隔缩至 2.0s + 束缚 1.3s → 65%。
 * @param {object} op
 * @param {number} [skillIndex]
 */
export function extractControl(op, skillIndex = 2) {
  const RANK = { 眩晕: 1, 冻结: 1, 睡眠: 1, 束缚: 2, 恐惧: 2, 停顿: 3, 减速: 3 }
  const items = []
  const panel = op.panel ?? {}
  const lv = op.skills?.[skillIndex]?.levels?.[9]
  // 模组攻速影响攻击触发型控制的间隔（模组启用时由 applyModule 挂载）
  const modAspd = op._moduleAspd ?? 0
  const aspdFactor = 1 + modAspd / 100

  const push = (type, sec, mode, interval, note, source) => {
    const coverage = mode === 'attack' && interval > 0 ? Math.min(sec / interval, 1) : null
    items.push({ type, sec, hardness: RANK[type] ?? 3, mode, interval, coverage, note, source })
  }

  if (lv) {
    const bb = bbOf(lv)
    const d = strip(lv.description)
    // 技能期攻击间隔（含 base_attack_time 秒差与攻速加成）
    const baseDelta = typeof bb.base_attack_time === 'number' ? bb.base_attack_time : 0
    const aspd = typeof bb.attack_speed === 'number' ? bb.attack_speed : 0
    const skillInterval = Math.max((panel.baseAttackTime ?? 1.5) + baseDelta, 0.1) / (1 + (aspd + modAspd) / 100)
    // 攻击触发型（attack@ 前缀 = 每次攻击附带）
    const atkTriggers = [
      ['眩晕', bb['attack@stun']],
      ['束缚', bb['attack@unmovable'] ?? bb['attack@constraint']],
      ['停顿', bb['attack@sluggish']],
    ].filter(([, v]) => typeof v === 'number' && v > 0)
    for (const [type, sec] of atkTriggers) {
      push(type, sec, 'attack', skillInterval, `每次攻击附带，间隔${skillInterval.toFixed(2)}s`, '技能')
    }
    // 非攻击触发的控制（技能期持续 / 单次）
    if (!atkTriggers.length || (bb.stun && !bb['attack@stun'])) {
      if (bb.stun) push('眩晕', bb.stun, 'single', null, '单次触发', '技能')
    }
    if (bb.sleep) push('睡眠', bb.sleep, 'single', null, '受击唤醒', '技能')
    const bind = bb.unmove ?? bb.constraint ?? bb.bind
    if (bind && !bb['attack@unmovable']) push('束缚', bind, 'single', null, '不能移动', '技能')
    if (bb.fear) push('恐惧', bb.fear, 'single', null, '迫使移动', '技能')
    // 描述型控制（bb 无 key 时，如铃兰 S3"敌人被停顿"）
    const dur = lv.duration > 0 ? lv.duration : null
    const hasKey = bb.stun || bb.sluggish || bb.unmove || bb.constraint || atkTriggers.length
    if (dur && !hasKey) {
      if (/被停顿|使其停顿|敌人停顿/.test(d)) push('停顿', dur, 'continuous', null, '技能期间持续（描述提取）', '技能')
      else if (/被眩晕|使其眩晕/.test(d)) push('眩晕', dur, 'continuous', null, '技能期间持续（描述提取）', '技能')
      else if (/被束缚|使其束缚/.test(d)) push('束缚', dur, 'continuous', null, '技能期间持续（描述提取）', '技能')
      else if (/被冻结|使其冻结/.test(d)) push('冻结', dur, 'continuous', null, '技能期间持续（描述提取）', '技能')
    }
  }

  // 天赋层（常驻；攻击附带型按常态攻击间隔）
  for (const t of op.talents ?? []) {
    const bb = bbOf(t)
    const panelInterval = Math.max(panel.baseAttackTime ?? 1.5, 0.1) / aspdFactor
    if (typeof bb['attack@stun'] === 'number') push('眩晕', bb['attack@stun'], 'attack', panelInterval, '天赋：每次攻击附带', '天赋')
    else if (typeof bb.stun === 'number') push('眩晕', bb.stun, 'single', null, '天赋单次', '天赋')
    if (typeof bb['attack@unmovable'] === 'number') push('束缚', bb['attack@unmovable'], 'attack', panelInterval, '天赋：每次攻击附带', '天赋')
    if (typeof bb.sluggish === 'number') push('停顿', bb.sluggish, 'single', null, '天赋附带', '天赋')
  }

  // 分支特性层（有效特性：基础特性 or 模组覆盖/追加后的结果）
  // 覆盖：常驻减速光环（如水月 X"攻击范围内所有敌人移动速度-20%"）
  //      攻击附带停顿（如吟游者分支"攻击造成法术伤害，并对敌人造成短暂的停顿"，铃兰 sluggish 0.8）
  const mt = op.trait
  if (mt) {
    const bb = bbOf(mt)
    const d = strip(mt.description)
    const src = op._moduleName ? `模组${op._moduleName}` : '分支特性'
    const ms = typeof bb.move_speed === 'number' ? bb.move_speed : null
    if (ms !== null && ms < 0) {
      const pct = Math.abs(ms) <= 1 ? Math.abs(ms) * 100 : Math.abs(ms)
      items.push({
        type: '减速', sec: null, hardness: 3, mode: 'aura', interval: null, coverage: 1,
        note: `常驻光环（攻击范围内敌人移动速度-${pct}%），覆盖率视为 100%（无时长概念）`,
        source: src,
      })
    } else if (/移动速度\s*-?\s*\d+\s*%/.test(d) && /攻击范围内|范围内/.test(d)) {
      const m = d.match(/移动速度\s*-?\s*(\d+(?:\.\d+)?)\s*%/)
      items.push({
        type: '减速', sec: null, hardness: 3, mode: 'aura', interval: null, coverage: 1,
        note: `常驻光环（攻击范围内敌人移动速度-${m[1]}%），覆盖率视为 100%`,
        source: src,
      })
    }
    const interval = Math.max(panel.baseAttackTime ?? 1.5, 0.1) / aspdFactor
    if (typeof bb.sluggish === 'number') {
      // 停顿是"攻击附带"的软控 → 覆盖率按攻击间隔算
      push('停顿', bb.sluggish, 'attack', interval, `${src}：每次攻击附带停顿，间隔${interval.toFixed(2)}s`, src)
    }
    if (typeof bb['attack@sluggish'] === 'number') {
      push('停顿', bb['attack@sluggish'], 'attack', interval, `${src}：每次攻击附带停顿`, src)
    }
    for (const [key, type] of [['attack@stun', '眩晕'], ['attack@unmovable', '束缚']]) {
      if (typeof bb[key] === 'number') push(type, bb[key], 'attack', interval, `${src}：每次攻击附带`, src)
    }
  }
  return items
}

/** 渲染 ②团队增益栏。 */
export function formatTeamBuffSection(op, skillIndex = 2) {
  const items = extractTeamBuff(op, skillIndex)
  if (items.length === 0) return null
  const quantified = quantifyTeamBuff(items)
  const lines = ['【② 团队增益栏】']
  for (const q of quantified) {
    const gain = q.gainPct !== null ? ` · 对标准队友输出${q.gainPct >= 0 ? '+' : ''}${q.gainPct.toFixed(1)}%` : ''
    lines.push(`  ${q.type} ${q.value}${q.unit}（${q.source}${q.durationSec ? `，持续${q.durationSec}s` : ''}）${gain}`)
  }
  for (const i of items.filter((x) => !['减防', '减抗', '易伤/脆弱'].includes(x.type))) {
    lines.push(`  ${i.type}${i.value !== null && i.value !== undefined ? ` ${i.value}${i.unit ?? ''}` : ''}：${i.note}`)
  }
  lines.push('  说明：折算基准 400防/50抗/基准ATK800；可用性、配合价值、场景权重由 agent 判断')
  return lines.join('\n')
}

/** 渲染 ③控制栏。 */
export function formatControlSection(op, skillIndex = 2) {
  const items = extractControl(op, skillIndex)
  if (items.length === 0) return null
  const order = { 1: '硬控', 2: '中硬控', 3: '软控' }
  const lines = ['【③ 控制栏】（类型分级 + 时长分列，不做数值换算）']
  for (const i of items) {
    const cov = i.coverage !== null ? ` → 覆盖率 ${(i.coverage * 100).toFixed(1)}%` : ''
    const mode = i.mode === 'attack' ? '攻击触发' : i.mode === 'continuous' ? '技能期持续' : i.mode === 'aura' ? '常驻光环' : '单次'
    const dur = i.sec === null || i.sec === undefined ? '常驻' : `${i.sec}s`
    lines.push(`  ${i.type} ${dur}（${order[i.hardness]}，${mode}，${i.source}）${cov}`)
    if (i.note) lines.push(`      ${i.note}`)
  }
  lines.push('  说明：覆盖率 = 单次时长 ÷ 触发间隔（攻速慢的干员控制实际很弱）；对 Boss 有效性/抗性/协同价值由 agent 判断')
  return lines.join('\n')
}
