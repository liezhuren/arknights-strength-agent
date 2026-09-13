// tools/survival-eval.mjs —— ④ 生存栏独立入口（不依赖技能，1★ 无技能干员同样可评）
// 用法：
//   node tools/survival-eval.mjs 泥岩
//   node tools/survival-eval.mjs 水月 --module Y
//   node tools/survival-eval.mjs 杜林              # 无技能干员也能评
import { findOperator, extractTalentBonuses } from './evaluate.mjs'
import { resolveModule, applyModule, formatAttr } from './modules.mjs'
import { formatSurvivalSection, THREAT_DIST, THREAT_META } from './survival.mjs'

const argv = process.argv.slice(2)
const flag = (n) => {
  const i = argv.indexOf(n)
  if (i < 0) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : 'default'
}
const moduleSpec = flag('--module') ?? flag('-m')
const moduleLevel = flag('--mlvl')
const skillArg = flag('--skill')
const query = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')))

const op = findOperator(query)
if (!op) {
  console.error(`未找到干员：${query}`)
  process.exit(1)
}
const mod = applyModule(op, resolveModule(op, moduleSpec), moduleLevel === undefined ? undefined : Number(moduleLevel))
const eop = mod.op
const talent = extractTalentBonuses(eop)
// 技能下标回退（无技能干员用 -1 → 不取技能层效果）
const n = eop.skills?.length ?? 0
const skillIndex = skillArg !== undefined ? Number(skillArg) : Math.max(Math.min(n - 1, 2), 0)

console.log(`【${op.name}】${op.rarity} · ${op.profession}/${op.subProfessionId}${n ? ` · 技能「${eop.skills[skillIndex]?.levels?.[9]?.name ?? '—'}」` : ' · 无技能（仅面板与天赋）'}`)
if (mod.entry) {
  console.log(`【模组】${mod.entry.name}(${mod.entry.type})${mod.level ? ` L${mod.level.level}` : ''}${Object.keys(mod.attr ?? {}).length ? ` · ${formatAttr(mod.attr)}` : ''}`)
}
console.log(`来袭画像：${THREAT_META.totalEnemies} 名敌人统计，DPS 分位 p25=${THREAT_DIST.p25} / p50=${THREAT_DIST.p50} / p75=${THREAT_DIST.p75} / p90=${THREAT_DIST.p90}`)
console.log('')
console.log(formatSurvivalSection(eop, skillIndex, talent))
