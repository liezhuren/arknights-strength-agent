// tools/inspect-data.mjs —— 游戏数据字段盘点脚本
// 输出：docs/data-inventory.md（数据资产清单 + 字段结构记录）
// 运行：node tools/inspect-data.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'E:/github/ArknightsGameData/zh_CN/gamedata'
const OUT = path.resolve(import.meta.dirname, '../docs/data-inventory.md')
const excel = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'excel', p), 'utf8'))

const REAL_PROFESSIONS = new Set(['MEDIC', 'WARRIOR', 'SPECIAL', 'SNIPER', 'SUPPORT', 'TANK', 'PIONEER', 'CASTER'])
const RARITY_LABEL = { TIER_1: '1★', TIER_2: '2★', TIER_3: '3★', TIER_4: '4★', TIER_5: '5★', TIER_6: '6★' }

// ---------- character_table ----------
const chars = excel('character_table.json')
const charKeys = Object.keys(chars)
const real = charKeys.filter((k) => REAL_PROFESSIONS.has(chars[k].profession) && !chars[k].isSpChar)
const byRarity = {}
for (const k of real) {
  const r = chars[k].rarity
  byRarity[r] = (byRarity[r] ?? 0) + 1
}

// 6★ 抽样：sortIndex 最小的真 6★（满练 = 最后一个 phase，即 E2）
const sixKeys = real.filter((k) => chars[k].rarity === 'TIER_6').sort((a, b) => chars[a].sortIndex - chars[b].sortIndex)
const sample = chars[sixKeys[0]]
const lastPhase = sample.phases[sample.phases.length - 1]
const maxKf = lastPhase?.attributesKeyFrames?.[lastPhase.attributesKeyFrames.length - 1] ?? null

// ---------- skill_table ----------
const skills = excel('skill_table.json')
const skillKeys = Object.keys(skills)
const sampleSkill = skills[sample.skills[0]?.skillId] ?? null
const lv9 = sampleSkill?.levels?.[9] ?? null

// ---------- enemy_database ----------
const enemies = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels/enemydata/enemy_database.json'), 'utf8'))
const enemyList = Array.isArray(enemies.enemies) ? enemies.enemies : Object.values(enemies.enemies ?? {})
const enemySampleEntry = enemyList.find((x) => x?.Value?.[0]?.enemyData?.name?.m_value) ?? enemyList[0]
const enemySample = enemySampleEntry?.Value?.[0]?.enemyData ?? null

// ---------- uniequip_table ----------
const uniequips = excel('uniequip_table.json')
const equipDict = uniequips.equipDict ?? uniequips
const uniequipKeys = Object.keys(equipDict)
const uniequipSample = uniequipKeys.length ? equipDict[uniequipKeys[0]] : null

// ---------- range / const ----------
const ranges = excel('range_table.json')
const gconst = excel('gamedata_const.json')

// ---------- 生成文档 ----------
const lines = []
lines.push('# 数据资产清单与字段结构（data inventory）')
lines.push('')
lines.push(`> 生成时间：${new Date().toISOString()} · 数据源：Kengxxiao/ArknightsGameData (zh_CN)`)
lines.push('')
lines.push('## 1. character_table.json（干员）')
lines.push('')
lines.push(`- 总条目：${charKeys.length}（含 TRAP/TOKEN 等非干员）`)
lines.push(`- 真干员（排除 TRAP/召唤物/异格标记）：${real.length}`)
lines.push(`- 星级分布：${Object.entries(byRarity).sort((a, b) => a[0].localeCompare(b[0])).map(([r, n]) => `${RARITY_LABEL[r]}: ${n}`).join('，')}`)
lines.push('')
lines.push('### 满练字段结构（E2 满级）')
lines.push('')
lines.push('```')
lines.push(`样例干员：${sample.name}（${RARITY_LABEL[sample.rarity]} · ${sample.profession}/${sample.subProfessionId} · ${sample.position}）`)
lines.push(`phases 数：${sample.phases.length}（精0/精1/精2）`)
lines.push(`E2 满级等级：${lastPhase?.maxLevel}`)
lines.push(`满级面板 keyframe：${JSON.stringify(maxKf?.data ?? null)}`)
lines.push(`attributesKeyFrames 级数：${lastPhase?.attributesKeyFrames?.length ?? 0}（0 级 + 满级等关键帧）`)
lines.push(`天赋数：${sample.talents.length}（每个含 candidates 分级数据）`)
lines.push(`技能数：${sample.skills.length}（skillId + 解锁条件 phase/level）`)
lines.push(`潜能等级：${sample.potentialRanks?.length}（每级含属性加成）`)
lines.push(`信赖加成：favorKeyFrames（按信赖值关键帧）`)
lines.push(`特性 trait：${JSON.stringify(sample.trait)?.slice(0, 120)}`)
lines.push('```')
lines.push('')
lines.push('## 2. skill_table.json（技能数值）')
lines.push('')
lines.push(`- 技能总数：${skillKeys.length}`)
lines.push('- levels 数组：10 级（1-7 为技能等级，8/9/10 = 专一/专二/专三）')
lines.push('')
lines.push('```')
if (sampleSkill) {
  lines.push(`样例技能：${sampleSkill.skillId ?? '?'}（${sampleSkill.levels?.[0]?.name ?? '?'}）`)
  lines.push(`levels 数：${sampleSkill.levels?.length ?? 0}`)
  if (lv9?.blackboard) {
    lines.push(`专三 blackboard（数值表）：${lv9.blackboard.map((b) => `${b.key}=${b.value}`).join('，')}`)
  }
  if (lv9?.duration) lines.push(`专三 duration：${JSON.stringify(lv9.duration)}`)
}
lines.push('```')
lines.push('')
lines.push('## 3. enemy_database.json（敌人）')
lines.push('')
lines.push(`- 敌人总数：${enemyList.length}`)
lines.push('- 结构：enemies 为数组，每项 { Key: 敌人id, Value: [难度等级数组] }；字段用 {m_defined, m_value} 包装')
lines.push('')
lines.push('```')
if (enemySample) {
  const attrs = enemySample.attributes ?? {}
  lines.push(`样例敌人：${enemySample.name?.m_value ?? '?'}（${enemySample.enemyRace?.m_value ?? '?'}）`)
  lines.push(`难度段数：${enemySampleEntry.Value?.length ?? 0}`)
  lines.push(`属性：${['maxHp', 'atk', 'def', 'magicResistance', 'moveSpeed', 'attackSpeed'].filter((k) => attrs[k]).map((k) => `${k}=${attrs[k].m_value}`).join('，')}`)
}
lines.push('```')
lines.push('')
lines.push('## 4. uniequip_table.json（模组）')
lines.push('')
lines.push(`- 模组总数：${uniequipKeys.length}`)
lines.push('- 结构：顶层 equipDict，key 为模组 id（uniequip_001_xxx 等）')
lines.push('')
lines.push('```')
if (uniequipSample) {
  lines.push(`样例模组：${uniequipSample.name ?? '?'}（${uniequipSample.typeIcon ?? '?'}）`)
  lines.push(`顶层 keys：${Object.keys(uniequipSample).join(', ')}`)
  lines.push(`levels 数（等级加成）：${uniequipSample.levels?.length ?? '?'}`)
}
lines.push('```')
lines.push('')
lines.push('## 5. range_table.json / gamedata_const.json')
lines.push('')
lines.push(`- 攻击范围形状数：${Object.keys(ranges).length}`)
lines.push(`- 全局常量 keys（部分）：${Object.keys(gconst).slice(0, 20).join(', ')}`)
lines.push('')

fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
console.log(`\n[written] ${OUT}`)
