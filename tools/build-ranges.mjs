// tools/build-ranges.mjs —— 射程几何管线：range_table.json → data/ranges.json
//
// 背景（2026 修正）：`range_table.json` **一直存在于游戏数据仓库**（73 个范围，每个带 direction 与
// 完整格子坐标），项目此前只是**没有接**这一层 —— 之前文档里"射程几何未建模"的说法不准确：
// 形状数据是有的，缺的是管线。本脚本把它落成数据，并预先算好可用的形状指标。
//
// 坐标约定：`row` 向上为正、`col` 向右为正，`{row:0,col:0}` 是干员自身所在格。
import { readFile, writeFile } from 'node:fs/promises'

const ROOT = 'E:/github/ArknightsGameData/zh_CN/gamedata/excel'
const OUT = 'E:/github/arknights-strength-agent/data/ranges.json'
const rt = JSON.parse(await readFile(`${ROOT}/range_table.json`, 'utf8'))

/** 形状指标：把格子集合变成可比较、可展示的量 */
function metrics(r) {
  const rows = r.grids.map((g) => g.row)
  const cols = r.grids.map((g) => g.col)
  const h = Math.max(...rows) - Math.min(...rows) + 1
  const w = Math.max(...cols) - Math.min(...cols) + 1
  const tiles = r.grids.length
  const containsSelf = r.grids.some((g) => g.row === 0 && g.col === 0)
  // 最大射程（切比雪夫距离，方舟按格子算）
  const reach = Math.max(...r.grids.map((g) => Math.max(Math.abs(g.row), Math.abs(g.col))))
  // 最近可打距离（曼哈顿，用于判断有没有"贴脸盲区"）
  const nearest = Math.min(...r.grids.map((g) => Math.abs(g.row) + Math.abs(g.col)))
  let shape
  if (tiles === 1) shape = '单格'
  else if (rows.every((x) => x === 0)) shape = `横向 ${tiles} 格直线`
  else if (cols.every((x) => x === 0)) shape = `纵向 ${tiles} 格直线`
  else if (tiles === h * w) shape = `${w}×${h} 实心`
  else shape = `${w}×${h} 不规则（${tiles} 格）`
  return { tiles, width: w, height: h, reach, nearest, containsSelf, shape }
}

const ranges = {}
for (const [id, r] of Object.entries(rt)) {
  const m = metrics(r)
  ranges[id] = {
    id: r.direction !== undefined ? r.id : id,
    direction: r.direction ?? null,
    grids: r.grids.map((g) => [g.row, g.col]), // 压成数组对，省体积
    ...m,
  }
}

const byReach = Object.values(ranges).sort((a, b) => b.reach - a.reach)
const payload = {
  builtAt: new Date().toISOString().slice(0, 10),
  source: 'ArknightsGameData(zh_CN) range_table.json',
  notes: [
    '射程形状来自 range_table（**一直存在于游戏数据仓库**，此前项目未接这一层）',
    '坐标：[row, col]，row 向上为正、col 向右为正，[0,0] = 干员自身所在格',
    'metrics.tiles = 覆盖格数（输出面）；reach = 最大射程（切比雪夫）；nearest = 最近可打距离（曼哈顿，用于找贴脸盲区）',
    '干员面板射程在 dataset 的 panel.rangeId；技能改射程在 skills[].levels[].rangeId',
  ],
  stats: {
    total: Object.keys(ranges).length,
    maxTiles: Math.max(...Object.values(ranges).map((r) => r.tiles)),
    maxReach: byReach[0]?.reach ?? 0,
  },
  ranges,
}
await writeFile(OUT, JSON.stringify(payload, null, 1), 'utf8')
console.log(`✅ 写入 ${OUT}`)
console.log(`   射程 ${payload.stats.total} 个 · 最大格数 ${payload.stats.maxTiles} · 最大射程 ${payload.stats.maxReach}`)
console.log('\n   按射程排序（前 12）：')
for (const r of byReach.slice(0, 12)) {
  console.log(`     ${r.id.padEnd(6)} ${String(r.shape).padEnd(22)} 格数=${String(r.tiles).padStart(2)} 射程=${r.reach} 最近=${r.nearest}`)
}
console.log('\n   格数最多的（前 6）：')
for (const r of [...Object.values(ranges)].sort((a, b) => b.tiles - a.tiles).slice(0, 6)) {
  console.log(`     ${r.id.padEnd(6)} ${String(r.shape).padEnd(22)} 格数=${r.tiles} 射程=${r.reach}`)
}
