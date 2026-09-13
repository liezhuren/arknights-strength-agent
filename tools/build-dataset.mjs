// tools/build-dataset.mjs —— 数据管线：原始游戏表 → 规范化满练干员数据集
// 输出：data/operators.json（416 真干员）+ data/meta.json（统计）
// 运行：node tools/build-dataset.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'E:/github/ArknightsGameData/zh_CN/gamedata'
const DATA_DIR = path.resolve(import.meta.dirname, '../data')
const excel = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'excel', p), 'utf8'))

const REAL_PROFESSIONS = new Set(['MEDIC', 'WARRIOR', 'SPECIAL', 'SNIPER', 'SUPPORT', 'TANK', 'PIONEER', 'CASTER'])

const chars = excel('character_table.json')
const skills = excel('skill_table.json')

/** 分支（子职业）中文名：uniequip_table.subProfDict → { 分支ID: 中文名 }。
 *  用途：把 `WARRIOR/librator` 显示为「近卫 / 解放者」，并支持按分支筛选。 */
function buildSubProfessionNames() {
  const table = excel('uniequip_table.json')
  const dict = table.subProfDict ?? {}
  const out = {}
  for (const [id, v] of Object.entries(dict)) out[id] = v?.subProfessionName ?? null
  return out
}

/** 提取满级面板（最后 phase 的最后 keyframe）
 *  ⚠ `rangeId` 在 **phase 级**（不在 attributesKeyFrames.data 里）—— 早期只读 data，把射程丢了，
 *  而 DB 层一直在读 `lv?.rangeId`（于是永远是 null）。2026 修正：面板与技能都带上射程 id。 */
function maxPanel(phases) {
  const last = phases[phases.length - 1]
  const kf = last?.attributesKeyFrames?.[last.attributesKeyFrames.length - 1]
  return {
    maxLevel: last?.maxLevel ?? null,
    rangeId: last?.rangeId ?? null, // 精英化会改射程（银灰 2-3 → 3-12）
    ...(kf?.data ?? {}),
  }
}

/** 提取天赋（取最后 candidate = 满潜满级效果） */
function extractTalents(talents) {
  return (talents ?? []).map((t) => {
    const c = t.candidates[t.candidates.length - 1]
    return {
      name: t.name ?? null,
      description: c?.description ?? null,
      blackboard: c?.blackboard ?? [],
      unlock: c?.unlockCondition ?? null,
    }
  })
}

/**
 * 提取**基础分支特性**。
 * 关键（2026 修正）：特性文本在**干员级 `description`** 字段里，不在 `trait` 里！
 *   - `c.description` = 特性文本（如银灰"可以进行远程攻击，但此时攻击力降低至80%"、水月"拥有50%的物理和法术闪避"）
 *   - `c.trait.candidates[].blackboard` = 特性的数值参数（仅当特性带数值时存在，如 atk_scale 0.8 / prob 0.5 / sluggish 0.8）
 * 早期版本只读了 `c.trait.candidates`，导致 454 名干员的特性全部为空 → 水月本体的 50% 物法闪避被漏算。
 */
function extractTrait(c) {
  const cands = c.trait?.candidates ?? []
  const best = cands.length ? cands[cands.length - 1] : null
  if (!c.description && !best) return null
  return {
    name: null,
    description: c.description ?? null,
    blackboard: best?.blackboard ?? [],
    overrideDescription: best?.overrideDescripton ?? null,
    unlock: best?.unlockCondition ?? null,
  }
}

/** 提取技能（全 10 级 levels；数值在 blackboard，语义解释留评测层） */
function extractSkills(skillRefs) {
  return (skillRefs ?? []).map((ref) => {
    const entry = skills[ref.skillId]
    if (!entry) return { id: ref.skillId, missing: true }
    const levels = (entry.levels ?? []).map((lv) => ({
      level: lv.level ?? null,
      name: lv.name ?? null,
      description: lv.description ?? null,
      skillType: lv.skillType ?? null,
      durationType: lv.durationType ?? null,
      duration: lv.duration ?? null,
      rangeId: lv.rangeId ?? null, // 技能可改射程（银灰 S2 → 1-2、S3 → 3-7）；437/1803 个技能有
      spData: lv.spData
        ? { spType: lv.spData.spType ?? null, spCost: lv.spData.spCost ?? null, initSp: lv.spData.initSp ?? null }
        : null,
      blackboard: lv.blackboard ?? [],
    }))
    return {
      id: ref.skillId,
      unlockPhase: ref.unlockCond?.phase ?? null,
      unlockLevel: ref.unlockCond?.level ?? null,
      levels,
    }
  })
}

/** 提取潜能加成（每潜 blackboard） */
function extractPotentials(potentialRanks) {
  return (potentialRanks ?? []).map((p) => ({
    blackboard: p.blackboard ?? [],
  }))
}

/** 提取信赖加成关键帧（最后一档 = 满信赖） */
function extractFavor(favorKeyFrames) {
  const frames = favorKeyFrames ?? []
  return frames.length ? (frames[frames.length - 1].data ?? null) : null
}

/** 提取模组元数据（uniequip_table.equipDict → 按 charId 归组）。
 *  注：元数据在此表；**数值**在 battle_equip_table.json（见 tools/build-modules.mjs → data/modules.json）。 */
function buildModuleIndex() {
  const table = excel('uniequip_table.json')
  const dict = table.equipDict ?? {}
  const byChar = new Map()
  for (const m of Object.values(dict)) {
    if (!m?.charId) continue
    const list = byChar.get(m.charId) ?? []
    const typeTag = [m.typeName1, m.typeName2].filter(Boolean).join('-')
    list.push({
      id: m.uniEquipId ?? null,
      name: m.uniEquipName ?? null,
      type: typeTag || null,
      isSpecial: m.isSpecialEquip === true, // 特限模组（如集成战略专用）
      desc: (m.uniEquipDesc ?? '').replace(/<[^>]+>/g, '').slice(0, 120),
    })
    byChar.set(m.charId, list)
  }
  for (const list of byChar.values()) list.sort((a, b) => (a.type ?? '').localeCompare(b.type ?? ''))
  return byChar
}

const moduleIndex = buildModuleIndex()
const subProfNames = buildSubProfessionNames()
const operators = []
const skipped = []
for (const [id, c] of Object.entries(chars)) {
  // 仅排除非干员职业（TRAP/TOKEN）；isSpChar=异格干员，属正常可获取干员，保留（如酒神/维什戴尔）
  if (!REAL_PROFESSIONS.has(c.profession)) {
    skipped.push(id)
    continue
  }
  operators.push({
    id,
    name: c.name ?? null,
    appellation: c.appellation ?? null,
    rarity: c.rarity ?? null,
    profession: c.profession ?? null,
    subProfessionId: c.subProfessionId ?? null,
    subProfessionName: subProfNames[c.subProfessionId] ?? null,
    position: c.position ?? null,
    tagList: c.tagList ?? [],
    panel: maxPanel(c.phases ?? []),
    trait: extractTrait(c),
    talents: extractTalents(c.talents ?? []),
    skills: extractSkills(c.skills ?? []),
    potentials: extractPotentials(c.potentialRanks ?? []),
    favor: extractFavor(c.favorKeyFrames ?? []),
    modules: moduleIndex.get(id) ?? [],
  })
}

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(path.join(DATA_DIR, 'operators.json'), JSON.stringify({ operators }, null, 1), 'utf8')
const meta = {
  generatedAt: new Date().toISOString(),
  operatorCount: operators.length,
  skippedCount: skipped.length,
  rarityDist: Object.fromEntries(
    [...new Set(operators.map((o) => o.rarity))].map((r) => [r, operators.filter((o) => o.rarity === r).length]),
  ),
  skillTotal: operators.reduce((n, o) => n + o.skills.length, 0),
  withMastery3: operators.filter((o) => o.skills.some((s) => !s.missing && s.levels.length >= 10)).length,
  damageTypeNote: 'damageType 语义未推断（blackboard 的 atk/atk_scale 区分留评测层），数据集原样保留数值',
}
fs.writeFileSync(path.join(DATA_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')

console.log(`干员数：${operators.length}（跳过 ${skipped.length} 非干员）`)
console.log(JSON.stringify(meta.rarityDist))
console.log(`技能总数：${meta.skillTotal} · 含专三（10级）：${meta.withMastery3}`)
const sample = operators.find((o) => o.name === '银灰')
console.log('样例（银灰）:', JSON.stringify({ name: sample.name, panel: { atk: sample.panel.atk, baseAttackTime: sample.panel.baseAttackTime, cost: sample.panel.cost }, skill3: sample.skills[2].levels[9] && { name: sample.skills[2].levels[9].name, spData: sample.skills[2].levels[9].spData, duration: sample.skills[2].levels[9].duration, blackboard: sample.skills[2].levels[9].blackboard } }, null, 1))
console.log(`\n[written] ${path.join(DATA_DIR, 'operators.json')} (${(fs.statSync(path.join(DATA_DIR, 'operators.json')).size / 1024 / 1024).toFixed(2)} MB)`)
