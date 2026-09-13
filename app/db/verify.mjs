// app/db/verify.mjs —— 数据库层自检：查询 + 与评测管线对接（hydrate 出的干员对象能否直接评测）
import { getOperator, searchOperators, facets, getScenarios, getThreats, getBaseline, saveCustom, listCustom, deleteCustom, recordEvaluation, recentEvaluations } from './index.mjs'
import { evaluate, formatReport } from '../../tools/evaluate.mjs'

let pass = 0, fail = 0
const ok = (n, c) => { c ? (pass++, console.log(`PASS  ${n}`)) : (fail++, console.log(`FAIL  ${n}`)) }

// 1. 检索
const s = searchOperators({ q: '银灰' })
ok('检索「银灰」命中', s.total >= 1 && s.rows[0].name.includes('银灰'))
ok('按职业过滤（TANK）', searchOperators({ profession: 'TANK', limit: 100 }).total > 20)
ok('facets 返回职业/稀有度', facets().professions.length >= 8 && facets().rarities.length === 6)

// 2. 单干员全量
const yin = getOperator('银灰')
ok('取干员·银灰（技能 3 个）', yin?.skills.length === 3)
ok('技能含专三 spData', yin.skills[2].levels[9].spData?.spCost === 90)
ok('分支特性已入库', /远程攻击/.test(yin.trait?.description ?? ''))
ok('天赋已入库', yin.talents.length === 2)
ok('模组已入库（含数值）', yin.modules.some((m) => m.hasCombatData && m.levels.length === 3))

// 3. 场景/画像/基准线
ok('标准场景 6 个', getScenarios().length === 6)
ok('来袭画像 5 档', getThreats().length === 5)
ok('场景基准线 6 行', getBaseline().length === 6)

// 4. 关键：数据库还原的对象**能直接进评测管线**，且数值与 JSON 路径一致（锚点回归）
const r = evaluate(yin, { damageType: 'physical', skillIndex: 2 })
const anchor = 5524.6
ok(`DB→评测管线一致（银灰技能期 ${r.benchmark.skillDpsVs400Def.toFixed(1)} ≈ 锚点 ${anchor}）`,
  Math.abs(r.benchmark.skillDpsVs400Def - anchor) < 0.1)
ok('四栏（泛用性/操作难度/回转/生存）均产出', !!(r.versatilitySection && r.difficultySection && r.rotationSection && r.survivalSection))

// 5. 自制干员（软件功能）
saveCustom('验证用·测试干员', { name: '验证用·测试干员', atk: 800, baseInterval: 1.5, damageType: 'physical' })
ok('自制干员写入/读取', listCustom().some((c) => c.name === '验证用·测试干员'))
deleteCustom('验证用·测试干员')
ok('自制干员删除', !listCustom().some((c) => c.name === '验证用·测试干员'))

// 6. 评测历史
recordEvaluation({ opId: yin.id, opName: yin.name, skillIdx: 2, damageType: 'physical', result: { skillDps: r.benchmark.skillDpsVs400Def } })
ok('评测历史写入', recentEvaluations(5).some((e) => e.op_name === '银灰'))

console.log(`\n===== 数据库层：PASS=${pass} FAIL=${fail} =====`)
console.log('\n--- DB 还原对象直接评测（银灰，节选）---')
console.log(formatReport(r).split('\n').slice(0, 4).join('\n'))
process.exit(fail === 0 ? 0 : 1)
