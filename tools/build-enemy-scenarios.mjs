// tools/build-enemy-scenarios.mjs —— 敌人场景库：从 enemy_database 构建典型敌人画像
// 输出：data/enemy-scenarios.json（DEF/RES 分层 + 代表敌人 + 知名敌人查证）
// 运行：node tools/build-enemy-scenarios.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'E:/github/ArknightsGameData/zh_CN/gamedata'
const DATA_DIR = path.resolve(import.meta.dirname, '../data')
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels/enemydata/enemy_database.json'), 'utf8'))
const list = Array.isArray(db.enemies) ? db.enemies : Object.values(db.enemies ?? {})

/** 取敌人的第一难度段数值（m_value 解包） */
function baseAttrs(entry) {
  const d = entry?.Value?.[0]?.enemyData?.attributes ?? {}
  const g = (k) => (d[k]?.m_value !== undefined ? d[k].m_value : null)
  return {
    name: entry?.Value?.[0]?.enemyData?.name?.m_value ?? null,
    maxHp: g('maxHp'), atk: g('atk'), def: g('def'), res: g('magicResistance'),
  }
}

const enemies = list.map(baseAttrs).filter((e) => e.name && e.def !== null && e.res !== null)

// DEF/RES 分箱（明日方舟常见数值量级）
const defTiers = [
  { id: '低甲', range: [0, 200], label: 'DEF <200（脆皮）' },
  { id: '中甲', range: [200, 500], label: 'DEF 200-500（中甲）' },
  { id: '高甲', range: [500, 1000], label: 'DEF 500-1000（高甲）' },
  { id: '重甲', range: [1000, Infinity], label: 'DEF ≥1000（重甲）' },
]
const resTiers = [
  { id: '低抗', range: [0, 20], label: 'RES <20（低抗）' },
  { id: '中抗', range: [20, 50], label: 'RES 20-50（中抗）' },
  { id: '高抗', range: [50, 80], label: 'RES 50-80（高抗）' },
  { id: '极高抗', range: [80, Infinity], label: 'RES ≥80（极高抗）' },
]

function tierOf(tiers, v) {
  return tiers.find((t) => v >= t.range[0] && v < t.range[1])?.id ?? '未知'
}

const defDist = {}
const resDist = {}
for (const e of enemies) {
  const d = tierOf(defTiers, e.def)
  const r = tierOf(resTiers, e.res)
  defDist[d] = (defDist[d] ?? 0) + 1
  resDist[r] = (resDist[r] ?? 0) + 1
}

// 每箱取代表性敌人（DEF/RES 双维度组合的代表）
const comboReps = {}
for (const d of defTiers) {
  for (const r of resTiers) {
    const key = `${d.id}/${r.id}`
    const inBox = enemies.filter((e) => tierOf(defTiers, e.def) === d.id && tierOf(resTiers, e.res) === r.id)
    if (inBox.length === 0) continue
    // 代表 = 该箱中 maxHp 中位数附近的敌人（取 sort 中间）
    inBox.sort((a, b) => a.maxHp - b.maxHp)
    const rep = inBox[Math.floor(inBox.length / 2)]
    comboReps[key] = { count: inBox.length, representative: rep }
  }
}

// 知名敌人查证（验证数据可识别）
const WELL_KNOWN = ['源石虫', '猎狗', '重装防御者', '高阶术师', '红刀哥', '大盾', '爱国者', '霜星', '塔露拉', '梅菲斯特', '泥岩']
const known = WELL_KNOWN.map((n) => {
  const hit = enemies.find((e) => e.name.includes(n))
  return hit ? { query: n, name: hit.name, def: hit.def, res: hit.res, maxHp: hit.maxHp, atk: hit.atk } : { query: n, found: false }
})

const out = {
  generatedAt: new Date().toISOString(),
  totalEnemies: enemies.length,
  defTiers,
  resTiers,
  defDist,
  resDist,
  comboRepresentatives: comboReps,
  wellKnown: known,
}
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(path.join(DATA_DIR, 'enemy-scenarios.json'), JSON.stringify(out, null, 1), 'utf8')

console.log(`敌人（有数值）：${enemies.length}`)
console.log('DEF 分布:', JSON.stringify(defDist))
console.log('RES 分布:', JSON.stringify(resDist))
console.log('\n知名敌人查证:')
for (const k of known) {
  console.log(k.found === false ? `  ${k.query}: 未找到` : `  ${k.query} → ${k.name} | DEF ${k.def} / RES ${k.res} / HP ${k.maxHp}`)
}
console.log('\n组合代表样本（前8箱）:')
for (const [k, v] of Object.entries(comboReps).slice(0, 8)) {
  console.log(`  ${k}: ${v.count}个 | 代表 ${v.representative.name} (DEF ${v.representative.def}/RES ${v.representative.res}/HP ${v.representative.maxHp})`)
}
console.log(`\n[written] ${path.join(DATA_DIR, 'enemy-scenarios.json')}`)
