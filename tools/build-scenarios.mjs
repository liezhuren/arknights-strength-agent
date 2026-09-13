// tools/build-scenarios.mjs —— 标准评测场景定义
// 从 enemy-scenarios.json 的组合代表 + 知名 Boss 推导 6 个标准场景（DEF/RES 画像）。
// 输出：data/scenarios.json
// 运行：node tools/build-scenarios.mjs
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.resolve(import.meta.dirname, '../data')
const scenarios = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'enemy-scenarios.json'), 'utf8'))
const combos = scenarios.comboRepresentatives ?? {}

// 场景规格：(def, res) 显式给出，附上数据依据（敌人名）
const SPECS = [
  { id: 'horde-lowdef', name: '清杂·低甲', def: 100, res: 0, enemy: '无人机（低甲/低抗代表）' },
  { id: 'elite-mid', name: '精英·中甲中抗', def: 400, res: 20, enemy: '勤奋劳工（中甲/中抗代表）' },
  { id: 'elite-heavy', name: '精英·高甲', def: 800, res: 0, enemy: '重装防御者（高甲/低抗代表）' },
  { id: 'elite-hires', name: '精英·高抗', def: 160, res: 65, enemy: '高塔术师（低甲/高抗代表）' },
  { id: 'boss', name: 'Boss·攻坚', def: 600, res: 45, enemy: '塔露拉（DEF700/RES50）与爱国者（500/45）的折中' },
  { id: 'boss-veres', name: 'Boss·极高抗', def: 50, res: 80, enemy: '凝缩热力（低甲/极高抗代表）' },
]

const out = {
  generatedAt: new Date().toISOString(),
  note: '场景 = 目标敌人 DEF/RES 画像；物理伤害看 DEF，法术伤害看 RES。',
  scenarios: SPECS,
}
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(path.join(DATA_DIR, 'scenarios.json'), JSON.stringify(out, null, 2), 'utf8')

for (const s of SPECS) {
  // 找最接近的已知敌人做交叉验证
  const closest = Object.values(combos)
    .map((c) => c.representative)
    .map((e) => ({ name: e.name, def: e.def, res: e.res, d: Math.abs(e.def - s.def) + Math.abs(e.res - s.res) * 3 }))
    .sort((a, b) => a.d - b.d)[0]
  console.log(`${s.id.padEnd(16)} ${s.name.padEnd(12)} DEF${String(s.def).padStart(4)}/RES${String(s.res).padStart(3)}  ← 最近敌人: ${closest.name} (${closest.def}/${closest.res})`)
}
console.log(`\n[written] ${path.join(DATA_DIR, 'scenarios.json')}`)
