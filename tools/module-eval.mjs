// tools/module-eval.mjs —— 模组三配置对照（无模组 / 各 ADVANCED 模组 / 特限模组）
// 对应 HANDOFF §8 未完成项 #1："评测时选择'无模组 / 默认模组 / 特限模组'三配置分别出数值"
// 用法：
//   node tools/module-eval.mjs 水月            # 对照全部可用模组配置
//   node tools/module-eval.mjs 水月 --skill 2  # 指定技能（0/1/2）
//   node tools/module-eval.mjs 水月 --lvl 3    # 模组等级（默认满级）
import { findOperator, evaluate } from './evaluate.mjs'
import { modulesOf, formatAttr } from './modules.mjs'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(name)
  return i < 0 ? dflt : argv[i + 1]
}
const query = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true)
const skillIndex = Number(flag('--skill', 2))
const level = flag('--lvl') === undefined ? undefined : Number(flag('--lvl'))

const op = findOperator(query)
if (!op) {
  console.error(`未找到干员：${query}`)
  process.exit(1)
}

const list = modulesOf(op)
const usable = list.filter((m) => m.hasCombatData)
const certs = list.filter((m) => !m.hasCombatData)

/** 单次评测 → 紧凑指标。 */
function metrics(spec) {
  const r = evaluate(op, { damageType: 'auto', skillIndex, moduleSpec: spec, moduleLevel: level })
  const key = r.damageType === 'physical' ? 'Vs400Def' : 'Vs50Res'
  const b = r.benchmark
  const skillDps = b[`skillDps${key}`] ?? b[`cycleAvgDps${key}`] ?? 0
  const avgDps = b[`avgDps${key}`] ?? 0
  const costEff = b[`costEff${key}`] ?? 0
  const ctrl = (r.controlSection ?? '').split('\n').filter((l) => /^\s{2}\S/.test(l) && !l.includes('说明')).map((l) => l.trim())
  // ④ 生存栏：取物理·精英 的每击伤害与可挨击数（最能体现模组对生存的影响）
  const surv = (r.survivalSection ?? '').split('\n')
  const hitLine = surv.find((l) => l.includes('物理·精英'))
  const perHit = hitLine ? Number(hitLine.match(/每击\s+([\d]+)/)?.[1] ?? 0) : null
  const hits = hitLine ? (hitLine.match(/可挨\s+(∞|[\d]+)/)?.[1] ?? null) : null
  const dodge = surv.find((l) => l.includes('自身机制') && l.includes('闪避'))
  return { r, skillDps, avgDps, costEff, ctrl, perHit, hits, dodge: dodge ? dodge.trim().replace(/^自身机制：/, '') : null }
}

const base = metrics(undefined)
const cfgList = [{ label: '无模组（基准）', spec: undefined, m: base }]
for (const m of usable) {
  cfgList.push({
    label: `${m.name}(${m.type}${m.isSpecial ? '·特限' : ''})`,
    spec: m.id,
    m: metrics(m.id),
    entry: m,
  })
}

console.log(`【${op.name}】${op.rarity} · ${op.profession}/${op.subProfessionId} · 技能「${base.r.skill}」(${base.r.damageType}) · 专三`)
console.log(`对照口径：技能期 DPS / 平均 DPS / 费效 → 基准 ${base.r.damageType === 'physical' ? 'vs 400 防' : 'vs 50 抗'}；变化以无模组为基准`)
if (certs.length) console.log(`（${certs.map((c) => c.name).join('、')} 为干员证章，游戏数据中无战斗数值，不参与对照）`)

// ---- 指标表 ----
const pad = (s, n) => {
  const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)
  return String(s) + ' '.repeat(Math.max(n - w, 0))
}
console.log(`\n${pad('配置', 34)}${pad('面板ATK', 10)}${pad('间隔', 8)}${pad('技能期DPS', 12)}${pad('平均DPS', 11)}${pad('费效', 9)}变化`)

for (const c of cfgList) {
  const r = c.m.r
  const d = c.spec
    ? `技能期 ${(( c.m.skillDps / (base.skillDps || 1) - 1) * 100).toFixed(1)}% · 平均 ${((c.m.avgDps / (base.avgDps || 1) - 1) * 100).toFixed(1)}%`
    : '—'
  console.log(
    pad(c.label, 34) + pad(r.panel.atk.toFixed(1), 10) + pad(`${r.panel.baseInterval.toFixed(2)}s`, 8)
    + pad(c.m.skillDps.toFixed(1), 12) + pad(c.m.avgDps.toFixed(1), 11) + pad(c.m.costEff.toFixed(1), 9) + d,
  )
}

// ---- 机制变化明细 ----
for (const c of cfgList) {
  if (!c.spec) continue
  const ap = c.m.r.moduleApplied
  console.log(`\n── ${c.label}${ap?.level ? ` L${ap.level.level}` : ''}`)
  if (ap?.attr && Object.keys(ap.attr).length) console.log(`   属性：${formatAttr(ap.attr)}`)
  for (const n of ap?.talentNotes ?? []) console.log(`   天赋：${n}`)
  for (const n of ap?.traitNotes ?? []) console.log(`   特性：${n}`)
  if (ap?.warnings?.length) for (const w of ap.warnings) console.log(`   ⚠ ${w}`)
  const p = c.m.r.penetrate
  if (p && (p.defFixed || p.defPct || p.resFixed)) {
    console.log(`   穿透：${[p.defFixed ? `无视${p.defFixed}防御` : '', p.defPct ? `无视${Math.round(p.defPct * 100)}%防御` : '', p.resFixed ? `无视${p.resFixed}法抗` : ''].filter(Boolean).join(' · ')}`)
  }
  // ④ 生存差异（模组对承伤/闪避/自回的影响）
  const svParts = []
  if (c.m.perHit !== null && base.perHit !== null && c.m.perHit !== base.perHit) {
    svParts.push(`对物理·精英 每击 ${base.perHit} → ${c.m.perHit}（可挨 ${base.hits} → ${c.m.hits} 击）`)
  }
  if (c.m.dodge && c.m.dodge !== base.dodge) svParts.push(`生存机制：${c.m.dodge}`)
  if (svParts.length) for (const x of svParts) console.log(`   生存：${x}`)
  // 控制栏差异：先找"同名但数值变化"的项，其余才算新增（避免同一行重复列出）
  const keyOf = (l) => l.trim().split('（')[0].trim()
  const changed = c.m.ctrl.filter((l) => {
    const same = base.ctrl.find((b) => keyOf(b) === keyOf(l))
    return same && same !== l
  })
  const added = c.m.ctrl.filter((l) => !base.ctrl.includes(l) && !changed.includes(l))
  for (const a of added) console.log(`   控制：${a}`)
  for (const ch of changed) {
    const was = base.ctrl.find((b) => keyOf(b) === keyOf(ch))
    console.log(`   控制：${ch}  ← 原 ${was?.match(/覆盖率 [\d.]+%/)?.[0] ?? '无覆盖率'}`)
  }
}

console.log('\n说明：特限模组增益仅在集成战略生效；模组的条件型特性（对空/距离/闪避等）未自动折算，需按场景判断。')
