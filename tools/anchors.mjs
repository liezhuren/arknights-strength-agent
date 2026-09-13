// tools/anchors.mjs —— 生成回归锚点表（HANDOFF §9 用）
// 说明：旧锚点记录于"天赋计入面板"与"天赋穿透"之前，数值偏低；本脚本产出当前口径的权威值。
import { findOperator, evaluate } from './evaluate.mjs'
import { modulesOf } from './modules.mjs'

const CASES = [
  ['银灰', 'physical', 2, '真银斩'],
  ['艾雅法拉', 'magical', 2, '火山'],
  ['史尔特尔', 'magical', 2, '黄昏'],
  ['能天使', 'physical', 2, '过载模式'],
  ['水月', 'physical', 2, '镜花水月'],
  ['伊芙利特', 'magical', 2, '灼地'],
  ['铃兰', null, 2, '狐火渺然'],
  ['妮芙', null, 2, ''],
  ['塑心', null, 2, ''],
  ['酒神', null, 2, ''],
  ['多萝西', null, 2, ''],
  ['望', null, 2, '天下劫'],
]

console.log('| 对象 | 期望值 |')
console.log('|---|---|')
for (const [name, dmg, idx, skill] of CASES) {
  const op = findOperator(name)
  if (!op) { console.log(`| ${name} | 数据集缺失 |`); continue }
  const r = evaluate(op, { damageType: dmg ?? 'auto', skillIndex: idx })
  const key = r.damageType === 'physical' ? 'Vs400Def' : 'Vs50Res'
  const b = r.benchmark
  const bits = []
  if (r.burst) {
    bits.push(`每次部署 ${r.burstDeployDamage.toFixed(0)}`)
    bits.push(`单次技能 ${r.burstSkillTotal.toFixed(0)}·${r.burst.skillWindowSec}s`)
    bits.push(`轴 ${r.burstTotalDamage.toFixed(0)}·${r.burst.windowSec}s→${r.burstDps.toFixed(0)}`)
  } else if (r.trap) {
    bits.push(`陷阱 DPS ${r.trapDps.toFixed(1)}`)
  } else if (r.nextAttack) {
    bits.push(`强化周期平均 ${b[`cycleAvgDps${key}`].toFixed(1)}`)
  } else {
    bits.push(`技能期 ${b[`skillDps${key}`].toFixed(1)}`)
    bits.push(`平A ${b[`sustainDps${key}`].toFixed(1)}`)
    bits.push(`平均 ${b[`avgDps${key}`].toFixed(1)}`)
    bits.push(`费效 ${b[`costEff${key}`].toFixed(1)}`)
  }
  bits.push(`ATK ${r.panel.atk.toFixed(1)}`)
  if (r.coverage && !r.burst && !r.trap) bits.push(`覆盖 ${(r.coverage * 100).toFixed(1)}%`)
  if (r.element) bits.push(`元素累积 ${r.elementAccrualPerSec.toFixed(1)}/s`)
  if (r.elementBurstAvgDps) bits.push(`元素爆发 ${r.elementBurstAvgDps.toFixed(1)}/s（领袖 ${r.elementBurstAvgDpsLeader.toFixed(1)}）`)
  const pen = r.penetrate
  if (pen && (pen.defFixed || pen.defPct || pen.resFixed)) {
    bits.push(`穿透 ${[pen.defFixed ? `无视${pen.defFixed}防` : '', pen.defPct ? `无视${Math.round(pen.defPct * 100)}%防` : '', pen.resFixed ? `无视${pen.resFixed}抗` : ''].filter(Boolean).join('+')}`)
  }
  console.log(`| ${name}·${r.skill}（${r.damageType}） | ${bits.join(' / ')} |`)
  // 控制栏
  const ctrl = (r.controlSection ?? '').split('\n').filter((l) => /^\s{2}\S/.test(l) && !l.includes('说明'))
  for (const c of ctrl) console.log(`| ${name} 控制 | ${c.trim()} |`)
}

// ④ 生存锚点
console.log('\n## 生存锚点（④ 生存栏）\n')
console.log('| 干员 | 期望值 |')
console.log('|---|---|')
for (const [name, spec, why] of [
  ['泥岩', null, '高防重装：物理·精英'],
  ['星熊', 'X', 'X 模组后 防御1217'],
  ['水月', 'Y', 'Y 模组 65% 物法闪避'],
  ['水月', 'isw', '特限 自回4%/s'],
  ['棘刺', null, '天赋 自回4%/s'],
  ['杜林', null, '50% 法术闪避'],
  ['史尔特尔', null, '保命机制'],
  ['休谟斯', null, '屏障'],
  ['清流', null, '抵抗'],
  ['闪灵', null, '医疗 治疗输出'],
  ['塞雷娅', null, '守护者 AoE 治疗'],
]) {
  const op = findOperator(name)
  if (!op) continue
  let r
  try {
    r = evaluate(op, { damageType: 'auto', skillIndex: 2, moduleSpec: spec ?? undefined })
  } catch (e) {
    // 无技能干员（1★ 机器人等）走不了输出评测，但生存仍可评 → 提示用独立入口
    console.log(`| ${name}${spec ? `[${spec}]` : ''}·${why} | 无技能干员，请用 tools/survival-eval.mjs |`)
    continue
  }
  const surv = (r.survivalSection ?? '').split('\n')
  const panel = surv.find((l) => l.includes('面板：生命'))?.trim().replace(/^面板：/, '') ?? ''
  const elite = surv.find((l) => l.includes('物理·精英'))?.trim() ?? ''
  const mech = surv.find((l) => l.includes('自身机制：'))?.trim().replace(/^自身机制：/, '') ?? ''
  const heal = surv.find((l) => l.includes('治疗输出（估算）'))?.trim() ?? ''
  const bits = [panel, elite, mech, heal].filter(Boolean).map((x) => x.replace(/\s+/g, ' '))
  console.log(`| ${name}${spec ? `[${spec}]` : ''}·${why} | ${bits.join(' ‖ ')} |`)
}

// 模组锚点（三配置）
console.log('\n## 模组三配置锚点\n')
console.log('| 干员 | 无模组 | 默认模组 | 特限模组 |')
console.log('|---|---|---|---|')
for (const name of ['水月', '能天使', '艾雅法拉', '史尔特尔']) {
  const op = findOperator(name)
  const cells = []
  for (const spec of [undefined, 'default', 'isw']) {
    const list = modulesOf(op)
    let val
    if (spec === 'isw' && !list.some((m) => m.isSpecial && m.hasCombatData)) { cells.push('无特限'); continue }
    if (spec === 'default' && !list.some((m) => m.hasCombatData && !m.isSpecial)) { cells.push('无模组'); continue }
    const r = evaluate(op, { damageType: 'auto', skillIndex: 2, moduleSpec: spec })
    const key = r.damageType === 'physical' ? 'Vs400Def' : 'Vs50Res'
    val = r.burst ? `轴 ${r.burstDps.toFixed(0)}` : `${r.benchmark[`skillDps${key}`].toFixed(1)}`
    cells.push(val)
  }
  console.log(`| ${name} | ${cells.join(' | ')} |`)
}

// 召唤物锚点（§17 通道：独立输出线，不与本体相加）
console.log('\n## 召唤物锚点（独立输出线，不与本体 DPS 相加）\n')
console.log('| 干员 | 召唤物 | 期望值 |')
console.log('|---|---|---|')
for (const name of ['凯尔希', '令', '鸿雪', '维什戴尔', '夕', '温蒂']) {
  const op = findOperator(name)
  if (!op) { console.log(`| ${name} | 数据集缺失 | — |`); continue }
  const r = evaluate(op, { damageType: 'auto', skillIndex: 2 })
  if (!r.summon) { console.log(`| ${name} | 无召唤物通道 | — |`); continue }
  const m = r.summon.meta
  const per = r.summon.units[0]
  const bits = [
    `${m.mode} atk${per.atk}/${per.interval}s`,
    `单体 ${(per.atk / per.interval).toFixed(1)}`,
    `基准 1 个 → ${r.summonDps.toFixed(1)}`,
    `基准口径 ${r.summonDpsBench.toFixed(1)}`,
  ]
  if (m.maxCopies > 1) bits.push(`最多存在 ${m.maxCopies} 个 → 上限 ${(r.summonDps * m.maxCopies).toFixed(0)}`)
  if (m.durationSec) bits.push(`限时 ${m.durationSec}s`)
  if (m.modeCount > 1) bits.push(`${m.modeCount} 种形态取最强`)
  console.log(`| ${name} | ${m.mode} | ${bits.join(' / ')} |`)
}
