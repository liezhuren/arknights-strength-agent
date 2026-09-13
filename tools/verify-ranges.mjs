// tools/verify-ranges.mjs —— 射程几何专项验证（§24）
//
// 背景：`range_table.json` **一直存在于游戏数据仓库**（73 个范围，带完整格子坐标）。
// 之前的文档说"射程几何未建模"是不准确的 —— 缺的只是**管线**（build-dataset 把 phase.rangeId 丢了）。
// 本套件锁定：几何正确、管线不再丢字段、射程不污染 DPS。
import { readFileSync } from 'node:fs'
import { loadRanges, getRange, renderRange, describeRange, effectiveRangeId, formatRangeSection } from './range.mjs'
import { findOperator, evaluate } from './evaluate.mjs'

// 数据集路径：基于本文件位置解析，**不写死绝对路径**（否则别人克隆后跑不了）
const OPS = new URL('../data/operators.json', import.meta.url)

let pass = 0
let fail = 0
const assert = (name, ok, detail = '') => {
  if (ok) { pass++; return }
  fail++
  console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`)
}

const all = loadRanges()
const ops = JSON.parse(readFileSync(OPS, 'utf8')).operators

// ---- ① 几何本身 ----
assert('射程 73 个', Object.keys(all).length === 73, `${Object.keys(all).length}`)
assert('每个射程都有格子坐标', Object.values(all).every((r) => Array.isArray(r.grids) && r.grids.length > 0))
assert('格子数 = grids 长度', Object.values(all).every((r) => r.tiles === r.grids.length))
assert('射程 = 最大切比雪夫距离', Object.values(all).every((r) => r.reach === Math.max(...r.grids.map((g) => Math.max(Math.abs(g[0]), Math.abs(g[1]))))))
// 已知形状（可手工核对）
{
  const r41 = getRange('4-1') // 横向 5 格直线
  assert('4-1 = 横向 5 格直线', r41.tiles === 5 && r41.grids.every((g) => g[0] === 0), JSON.stringify(r41.grids))
  assert('4-1 射程 = 4（col 0..4）', r41.reach === 4, `${r41.reach}`)
  const x3 = getRange('x-3') // 艾雅法拉 S3：25 格菱形
  assert('x-3 = 25 格', x3.tiles === 25, `${x3.tiles}`)
  assert('x-3 含 [0,3] 与 [0,-3]（菱形两翼）',
    x3.grids.some((g) => g[0] === 0 && g[1] === 3) && x3.grids.some((g) => g[0] === 0 && g[1] === -3))
  const i11 = getRange('1-1')
  assert('1-1 = 2 格（近卫标准）', i11.tiles === 2)
  assert('0-1 = 单格', getRange('0-1').tiles === 1)
}

// ---- ② 渲染 ----
{
  const art = renderRange('4-1')
  // 4-1 = 横向 5 格（col 0..4，含自身格 [0,0]）→ 一行 5 个字符，自身格渲染为 O
  assert('4-1 渲染成一行 5 字符', art.length === 1 && art[0].length === 5, JSON.stringify(art))
  assert('4-1 自身格在首位', art[0][0] === 'O', art[0])
  const d = describeRange('1-1')
  assert('1-1 描述含格数与射程', /2 格/.test(d) && /射程 1/.test(d), d)
  // 盲区：4-6 最近只能打 3 格
  const blind = describeRange('4-6')
  assert('4-6 标出贴脸盲区', /盲区/.test(blind), blind)
}

// ---- ③ 管线不再丢字段（这是本轮根因）----
{
  assert('454/454 干员有 panel.rangeId', ops.every((o) => o.panel?.rangeId), `${ops.filter((o) => o.panel?.rangeId).length}`)
  // 技能（skill×level 组合）带 rangeId 的数量；同技能各档通常一致
  const skWithRange = ops.flatMap((o) => (o.skills ?? []).flatMap((s) => (s.levels ?? []).map((l) => l.rangeId))).filter(Boolean).length
  assert('技能 level 带 rangeId（>2000 条）', skWithRange > 2000, `${skWithRange}`)
  const skDistinct = ops.flatMap((o) => (o.skills ?? []).map((s) => s.levels?.[9]?.rangeId)).filter(Boolean).length
  assert('专三档带 rangeId 的技能 ≈237（共 994 个技能）', skDistinct >= 230 && skDistinct <= 245, `${skDistinct}`)
  // 技能改射程的干员数（银灰 S2 → 1-2、S3 → 3-7）
  let changed = 0
  for (const o of ops) for (const s of o.skills ?? []) {
    const rid = s.levels?.[9]?.rangeId
    if (rid && rid !== o.panel?.rangeId) { changed++; break }
  }
  assert('技能改变射程的干员 ≈176', changed >= 170 && changed <= 185, `${changed}`)
  // 银灰实测
  const yh = findOperator('银灰')
  assert('银灰 S3 射程 = 3-7', effectiveRangeId(yh, 2, 9).id === '3-7')
  assert('银灰 S2 射程 = 1-2', effectiveRangeId(yh, 1, 9).id === '1-2')
  assert('银灰 面板射程 = 3-12', effectiveRangeId(yh, null, 9).id === '3-12')
  // 所有 rangeId 都能在 range_table 找到
  const missing = new Set()
  for (const o of ops) {
    if (o.panel?.rangeId && !getRange(o.panel.rangeId)) missing.add(o.panel.rangeId)
    for (const s of o.skills ?? []) for (const l of s.levels ?? []) if (l.rangeId && !getRange(l.rangeId)) missing.add(l.rangeId)
  }
  assert('所有 rangeId 都能在几何表找到', missing.size === 0, [...missing].join(','))
}

// ---- ④ 不污染数值 ----
{
  const r = evaluate(findOperator('银灰'), { damageType: 'physical', skillIndex: 2 })
  assert('银灰 基准仍 5524.6', Math.abs(r.benchmark.skillDpsVs400Def - 5524.6) < 0.05, `${r.benchmark.skillDpsVs400Def}`)
  assert('报告含射程段', r.rangeSection.length > 0 && r.rangeSection[0].includes('射程'))
  assert('射程段含示意图', r.rangeSection.some((l) => /[█O]/.test(l)))
  // 射程是空间量，**不得**出现在 DPS 字段里
  assert('射程不进 skillDps 相关字段', !Object.keys(r).some((k) => /range/i.test(k) && /dps/i.test(k)))
}

// ---- ⑤ 报告渲染 ----
{
  const yh = findOperator('银灰')
  const sec = formatRangeSection(yh, 2, 9)
  assert('银灰 射程段标出"技能改变了射程"', sec.some((l) => l.includes('改变了射程')), JSON.stringify(sec.slice(0, 2)))
  const ex = formatRangeSection(findOperator('艾雅法拉'), 2, 9)
  assert('艾雅法拉 S3 射程 25 格', ex[0].includes('25 格'), ex[0])
  const st = formatRangeSection(findOperator('史尔特尔'), null, 9)
  assert('史尔特尔 近卫短射程 2 格', st[0].includes('2 格'), st[0])
}

console.log(`\n===== 射程几何验证：PASS=${pass} FAIL=${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
