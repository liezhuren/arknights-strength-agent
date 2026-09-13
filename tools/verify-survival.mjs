// tools/verify-survival.mjs —— ④ 生存栏专项验证（2026 新增，补上此前缺失的覆盖）
//
// 起因：**条件型减伤被无条件计入**这个真实 bug 逃过了全部六套验证 ——
//   泥岩「受到来自【萨卡兹】敌人的伤害降低30%」、止颂「阻挡时，受到来自非自身阻挡敌人的伤害降低35%」
//   都被当成对**所有敌人**生效 → 承伤偏低、生存偏高（泥岩每击 278 应为 398，可挨 15 击应为 10 击）。
//   根因是没有任何断言覆盖减伤/生存数值。本套件补上。
import { readFileSync } from 'node:fs'
import { extractSurvival, formatSurvivalSection } from './survival.mjs'
import { findOperator, evaluate } from './evaluate.mjs'
import { incomingHit, surviveGroup, survival } from '../engine/survival.mjs'

let pass = 0
let fail = 0
const assert = (name, ok, detail = '') => {
  if (ok) { pass++; return }
  fail++
  console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`)
}

const ops = JSON.parse(readFileSync('E:/github/arknights-strength-agent/data/operators.json', 'utf8')).operators
const byName = new Map(ops.map((o) => [o.name, o]))

// ---- ① 条件型减伤：必须**不计入**硬扛，且标出条件 ----
{
  const ny = extractSurvival(byName.get('泥岩'), 2, { atkPct: 0, aspd: 0 })
  assert('泥岩 减伤 30% 不进 drPct', ny.normal.panel.drPct === 0, `drPct=${ny.normal.panel.drPct}`)
  assert('泥岩 减伤进入 drConditional', (ny.normal.panel.drConditional ?? []).length === 1,
    JSON.stringify(ny.normal.panel.drConditional))
  assert('泥岩 条件写出"仅来自【萨卡兹】"', /萨卡兹/.test(ny.normal.panel.drConditional[0].condition),
    ny.normal.panel.drConditional[0].condition)
  const zs = extractSurvival(byName.get('止颂'), 2, { atkPct: 0, aspd: 0 })
  assert('止颂 减伤 35% 不进 drPct', zs.normal.panel.drPct === 0, `drPct=${zs.normal.panel.drPct}`)
  assert('止颂 条件写出"未被自身阻挡"', /未被自身阻挡/.test(zs.normal.panel.drConditional[0]?.condition ?? ''),
    zs.normal.panel.drConditional[0]?.condition)
}

// ---- ② 锚点数值（条件型减伤不再计入后的正确值）----
{
  const ny = extractSurvival(byName.get('泥岩'), 2, { atkPct: 0, aspd: 0 })
  const p = ny.normal.panel
  // 生命 3928 / 防御 602 · 精英画像 1000 atk / 2.6s → 每击 398
  const per = incomingHit(1000, { damageType: 'physical', def: p.def, drPct: p.drPct })
  assert('泥岩 面板防御 602', p.def === 602, `${p.def}`)
  assert('泥岩 对物理·精英 每击 398（原 278 含了不该含的减伤）', per === 398, `${per}`)
  const sim = survival({ atk: 1000, interval: 2.6, damageType: 'physical' }, { maxHp: p.maxHp, def: p.def, drPct: p.drPct })
  assert('泥岩 可挨 10 击（原 15）', sim.hitsToDie === 10, `${sim.hitsToDie}`)
  assert('泥岩 承受 26.0s（原 39.0s）', Math.abs(sim.seconds - 26.0) < 0.05, `${sim.seconds}`)
}

// ---- ③ 报告必须写明"未计入" ----
{
  const sec = formatSurvivalSection(byName.get('泥岩'), 2, { atkPct: 0, aspd: 0 })
  assert('泥岩 报告标注条件型减伤未计入', /条件型，未计入硬扛/.test(sec))
  assert('泥岩 报告写出条件内容', /仅来自【萨卡兹】的敌人/.test(sec))
}

// ---- ④ 无条件减伤仍应计入（不能矫枉过正）----
{
  // 引擎层：无条件减伤必须生效
  const withDr = incomingHit(1000, { damageType: 'physical', def: 0, drPct: 0.5 })
  assert('无条件减伤 50% 生效', withDr === 500, `${withDr}`)
  // 全库扫描：有减伤天赋的干员里，只有那 2 个带条件
  const condNames = []
  for (const o of ops) {
    for (const t of o.talents ?? []) {
      const d = String(t.description ?? '').replace(/<[^>]*>/g, '')
      if (/受到.{0,20}伤害(?:降低|减少)/.test(d) && /来自【|来自非/.test(d)) condNames.push(o.name)
    }
  }
  assert('全库条件型减伤天赋 = 2 条（泥岩/止颂）', condNames.length === 2, condNames.join(','))
}

// ---- ⑤ 集火口径（§22）回归 ----
{
  const one = surviveGroup({ atk: 1000, interval: 2.6, damageType: 'physical' }, { maxHp: 3928, def: 602 }, 1)
  const two = surviveGroup({ atk: 1000, interval: 2.6, damageType: 'physical' }, { maxHp: 3928, def: 602 }, 2)
  assert('集火 ×1 每击 398', one.perHit === 398, `${one.perHit}`)
  assert('集火 ×2 每击 = 2000−602 = 1398', two.perHitGroup === 1398, `${two.perHitGroup}`)
  assert('集火 ×2 更致命', two.seconds < one.seconds)
}

// ---- ⑥ 全库不报错 ----
{
  let bad = 0
  for (const o of ops) {
    if (!(o.skills ?? []).length) continue
    try { extractSurvival(o, 2, { atkPct: 0, aspd: 0 }) } catch { bad++ }
  }
  assert('全库 extractSurvival 无异常', bad === 0, `${bad}`)
}

console.log(`\n===== 生存栏验证：PASS=${pass} FAIL=${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
