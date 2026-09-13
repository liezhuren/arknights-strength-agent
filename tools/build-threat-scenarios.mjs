// tools/build-threat-scenarios.mjs —— 从敌人数据库构建"标准来袭画像"
// 数据源：ArknightsGameData/zh_CN/gamedata/levels/enemydata/enemy_database.json
//   attributes: { maxHp, atk, def, magicResistance, baseAttackTime, attackSpeed, ... }
//
// 要点：
//  1. 来袭 DPS 分布（atk / baseAttackTime）是**真实统计**，画像的 ATK/间隔取自分布分位
//  2. **敌人伤害类型不在 JSON 里**（法术攻击由 prefab 决定，数据层无字段）→ 画像的伤害类型按
//     "名字可确定判定"的锚点敌人设定（法师/术师/巫术=法术；近战/宿主/重装=物理），并在 anchor 里写明来源
//  3. 排除地图装置类（源石球等 atk 上万、非正常威胁），按 interval 与 atk 做合理性过滤
import { readFile, writeFile } from 'node:fs/promises'

const SRC = 'E:/github/ArknightsGameData/zh_CN/gamedata/levels/enemydata/enemy_database.json'
const OUT = 'E:/github/arknights-strength-agent/data/threat-scenarios.json'
const val = (x) => (x && typeof x === 'object' && 'm_value' in x ? x.m_value : x)

const raw = JSON.parse(await readFile(SRC, 'utf8'))
const rows = []
for (const k of Object.keys(raw.enemies)) {
  const e = raw.enemies[k].Value?.[0]?.enemyData
  const a = e?.attributes
  if (!a) continue
  const atk = val(a.atk)
  const iv = val(a.baseAttackTime)
  if (!atk || !iv || iv <= 0) continue
  // 地图装置/演出类过滤：单次伤害 >5000 或间隔 <0.5s 视为异常威胁
  if (atk > 5000 || iv < 0.5) continue
  rows.push({
    name: val(e.name),
    atk,
    interval: iv,
    dps: atk / iv,
    hp: val(a.maxHp),
    def: val(a.def),
    res: val(a.magicResistance),
  })
}
rows.sort((a, b) => a.dps - b.dps)
const q = (p) => rows[Math.min(Math.floor(rows.length * p), rows.length - 1)]

const find = (kw, pred = () => true) =>
  rows.filter((r) => r.name.includes(kw) && pred(r)).sort((a, b) => b.dps - a.dps)[0]

/** 锚点敌人：伤害类型可由名字确定判定。 */
const pick = (kw, type) => {
  const r = find(kw)
  if (!r) throw new Error(`锚点敌人未找到：${kw}`)
  return { ...r, damageType: type }
}

const anchors = {
  clear: pick('富营养的猎食者', 'physical'),   // 近战猎食者 → 物理
  elite: pick('重装五十夫长', 'physical'),      // 重装近战 → 物理
  berserk: pick('狂暴宿主组长', 'physical'),    // 狂暴宿主 → 物理
  caster: pick('爆裂冰法师', 'magical'),        // 法师 → 法术
  warlock: pick('巫术巨像', 'magical'),         // 巫术 → 法术
}

const profiles = [
  { id: '物理·清杂', damageType: 'physical', src: anchors.clear, note: 'p50 级杂兵，盾位日常承压' },
  { id: '物理·精英', damageType: 'physical', src: anchors.elite, note: '精英近战，重装主要考验' },
  { id: '物理·狂暴', damageType: 'physical', src: anchors.berserk, note: '高压（p97 级），硬扛上限考验' },
  { id: '法术·中压', damageType: 'magical', src: anchors.caster, note: '法师单位，考法抗与自回' },
  { id: '法术·高压', damageType: 'magical', src: anchors.warlock, note: '高单次法术，考血线与减伤' },
].map((p) => ({
  id: p.id,
  damageType: p.damageType,
  atk: p.src.atk,
  interval: p.src.interval,
  dps: Math.round(p.src.dps * 10) / 10,
  anchor: `${p.src.name}（atk ${p.src.atk} / ${p.src.interval}s）`,
  note: p.note,
}))

const payload = {
  builtAt: new Date().toISOString().slice(0, 10),
  source: 'ArknightsGameData(zh_CN) levels/enemydata/enemy_database.json',
  notes: [
    'ATK/间隔取自真实敌人（已排除 atk>5000 或 间隔<0.5s 的地图装置/演出类）',
    '敌人伤害类型在数据层无字段（由 prefab 决定）→ 画像类型按名字可判定为准的锚点设定',
    'dps = atk / interval，为单敌人对 0 防御目标的每秒伤害（未计我方 DEF/RES/闪避）',
    '多敌人集火时实际压力按敌人数线性放大（评估时需说明假设）',
  ],
  totalEnemies: rows.length,
  distribution: {
    p10: +q(0.10).dps.toFixed(1), p25: +q(0.25).dps.toFixed(1), p50: +q(0.50).dps.toFixed(1),
    p75: +q(0.75).dps.toFixed(1), p90: +q(0.90).dps.toFixed(1), p95: +q(0.95).dps.toFixed(1), p99: +q(0.99).dps.toFixed(1),
  },
  profiles,
}

await writeFile(OUT, JSON.stringify(payload, null, 1), 'utf8')
console.log(`✅ 写入 ${OUT}`)
console.log(`   可用敌人 ${rows.length} · 来袭 DPS 分位 ${JSON.stringify(payload.distribution)}`)
for (const p of profiles) {
  console.log(`   ${p.id.padEnd(12)} ${p.damageType.padEnd(9)} atk ${String(p.atk).padStart(5)} / ${p.interval}s = ${String(p.dps).padStart(6)} DPS   ← ${p.anchor}`)
}
