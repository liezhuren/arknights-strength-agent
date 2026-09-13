// tools/build-module-data.mjs —— 从游戏数据构建模组数值表
// 数据源：ArknightsGameData/zh_CN/gamedata/excel
//   uniequip_table.json     模组元数据（名称/类型/是否特限/所属干员）
//   battle_equip_table.json 模组战斗数据（属性加成 / 天赋更新 / 特性更新）★数值来自这里
//
// 语义要点（踩坑记录）：
//   1. phases[].attributeBlackboard 是该等级的**累积总值**，不是增量 —— 直接用 L3 即可，不要累加
//   2. ORIGINAL(干员证章) 模组在战斗表中**无条目**（393 个全部如此）→ 无战斗数值
//   3. 天赋更新是**替换**语义（talentIndex>=0 覆盖基础天赋；talentIndex=-1 为追加的隐藏天赋）
//   4. 同组候选取 requiredPotentialRank 最高者 —— 与数据集天赋取满潜值的既有约定保持一致
//   5. validInGameTag='roguelike' 的增益**仅集成战略生效**（特限模组）
import { readFile, writeFile } from 'node:fs/promises'

const ROOT = 'E:/github/ArknightsGameData/zh_CN/gamedata/excel'
const OUT = 'E:/github/arknights-strength-agent/data/modules.json'

const stripTags = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/\\n/g, ' ').trim()
const bbOf = (arr) => Object.fromEntries((arr ?? []).map((b) => [b.key, b.value]))
/** 模组类型：游戏用 typeName1='AMB' + typeName2='X'，数据集约定 'AMB-X'（与 operators.json 保持一致）。
 *  ORIGINAL(证章) 的 typeName2 为空 → 退化为 'ORIGINAL'。 */
const typeOf = (meta) =>
  meta.typeName2 ? `${meta.typeName1}-${meta.typeName2}` : (meta.typeName1 ?? meta.type ?? '')

/** 从候选数组里取 requiredPotentialRank 最高的（满潜约定）。 */
function pickMaxPot(candidates) {
  if (!candidates?.length) return null
  return candidates.reduce((best, c) =>
    (c.requiredPotentialRank ?? 0) >= (best.requiredPotentialRank ?? 0) ? c : best,
  )
}

/** 解析一个等级的 parts → { talents, trait }。
 *  天赋候选按 talentIndex 合并（同一槽位可能有多条候选：描述覆盖包 + 数值包，如特限模组的 '#' 与 '1'）；
 *  数值按 requiredPotentialRank 升序覆盖（高潜胜出），描述取最高潜的非空值。 */
function parseLevel(parts) {
  const byIndex = new Map() // talentIndex → { candidates:[], tags:Set, targets:Set, prefabKeys:Set, isHide }
  let trait = null
  for (const p of parts ?? []) {
    const tag = p.validInGameTag ?? null
    for (const c of p.addOrOverrideTalentDataBundle?.candidates ?? []) {
      const key = c.validModeIndices ? `${c.talentIndex}|m${c.validModeIndices.join(',')}` : `${c.talentIndex}`
      const cur = byIndex.get(key) ?? { candidates: [], tags: new Set(), targets: new Set(), prefabKeys: new Set(), isHide: false, index: c.talentIndex }
      cur.candidates.push({ c, tag })
      if (tag) cur.tags.add(tag)
      cur.targets.add(p.target)
      if (c.prefabKey) cur.prefabKeys.add(c.prefabKey)
      cur.isHide = cur.isHide || !!c.isHideTalent
      byIndex.set(key, cur)
    }
    const tc = pickMaxPot(p.overrideTraitDataBundle?.candidates)
    if (tc && (!trait || (tc.requiredPotentialRank ?? 0) > (trait.c.requiredPotentialRank ?? 0))) {
      trait = { c: tc, tag, target: p.target }
    }
  }

  const talents = [...byIndex.values()].map((g) => {
    const sorted = [...g.candidates].sort((a, b) => (a.c.requiredPotentialRank ?? 0) - (b.c.requiredPotentialRank ?? 0))
    const blackboard = {}
    let desc = null
    let name = null
    let pot = 0
    for (const { c } of sorted) {
      Object.assign(blackboard, bbOf(c.blackboard)) // 后写（高潜）胜出
      pot = Math.max(pot, c.requiredPotentialRank ?? 0)
      if (stripTags(c.upgradeDescription)) desc = stripTags(c.upgradeDescription)
      if (stripTags(c.name)) name = stripTags(c.name)
    }
    return {
      index: g.index,
      prefabKeys: [...g.prefabKeys],
      tags: [...g.tags],
      tag: g.tags.size === 1 ? [...g.tags][0] : (g.tags.size ? [...g.tags].join(',') : null),
      targets: [...g.targets],
      isHide: g.isHide,
      pot,
      name,
      desc,
      blackboard,
    }
  })
  return {
    talents,
    trait: trait
      ? {
          // 关键区分：overrideDescripton = **覆盖**基础特性；additionalDescription = **追加**（基础特性仍然生效）
          // 例：水月 Y 模组覆盖（50%→65% 闪避）；水月 X / 星熊 X 是追加（减速光环 / 阻挡时防御+20%）
          mode: trait.c.overrideDescripton ? 'override' : 'add',
          tag: trait.tag,
          target: trait.target,
          desc: stripTags(trait.c.overrideDescripton ?? trait.c.additionalDescription) || null,
          blackboard: bbOf(trait.c.blackboard),
        }
      : null,
  }
}

const uni = JSON.parse(await readFile(`${ROOT}/uniequip_table.json`, 'utf8'))
const battle = JSON.parse(await readFile(`${ROOT}/battle_equip_table.json`, 'utf8'))
const { equipDict, charEquip } = uni

const out = {}
let withData = 0
let noData = 0

for (const [charId, modIds] of Object.entries(charEquip)) {
  const list = []
  for (const mid of modIds) {
    const meta = equipDict[mid]
    if (!meta) continue
    const b = battle[mid]
    if (!b) {
      // ORIGINAL 证章无战斗数据（全部 393 个）—— 保留元数据，无数值效果
      noData++
      list.push({
        id: mid,
        name: meta.uniEquipName,
        type: typeOf(meta),
        isSpecial: !!meta.isSpecialEquip,
        kind: meta.typeName1 ?? null,
        order: meta.charEquipOrder ?? 99,
        hasCombatData: false,
        levels: [],
      })
      continue
    }
    withData++
    const levels = (b.phases ?? []).map((ph) => ({
      level: ph.equipLevel,
      attr: bbOf(ph.attributeBlackboard),
      ...parseLevel(ph.parts),
    }))
    const scopeTags = [...new Set(levels.flatMap((l) => [
      ...l.talents.map((t) => t.tag),
      l.trait?.tag ?? null,
    ]).filter(Boolean))]
    list.push({
      id: mid,
      name: meta.uniEquipName,
      type: typeOf(meta),
      isSpecial: !!meta.isSpecialEquip,
      kind: meta.typeName1 ?? null,
      order: meta.charEquipOrder ?? 99,
      scopeTags, // roguelike = 仅集成战略生效
      hasCombatData: true,
      levels,
    })
  }
  // 按游戏 charEquipOrder 排序（数组顺序并不保证与之相同：星熊/山的 X·Y 顺序在数组里是反的）
  // → 保证「模组1」= X 模组，与游戏 UI 及 PRTS 的 模组N 编号一致
  list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  out[charId] = list
}

const payload = {
  builtAt: new Date().toISOString().slice(0, 10),
  source: 'ArknightsGameData(zh_CN) uniequip_table.json + battle_equip_table.json',
  notes: [
    'attributeBlackboard 为该等级累积总值，取 L3 即满配，勿累加',
    'ORIGINAL(干员证章) 无战斗数据 → hasCombatData=false，无数值效果',
    '天赋更新为替换语义：index>=0 覆盖基础天赋，index=-1 为追加隐藏天赋',
    '同组候选取 requiredPotentialRank 最高者（满潜约定）',
    'scopeTags 含 roguelike 者仅集成战略生效（特限模组）',
  ],
  stats: { operators: Object.keys(out).length, modulesWithData: withData, modulesWithoutData: noData },
  modules: out,
}

await writeFile(OUT, JSON.stringify(payload, null, 1), 'utf8')
console.log(`✅ 写入 ${OUT}`)
console.log(`   干员 ${payload.stats.operators} · 有数值模组 ${withData} · 无数值(证章) ${noData}`)

// 抽样自检
for (const [cid, want] of [['char_437_mizuki', 'ISW-A'], ['char_103_angel', 'MAR-X'], ['char_180_amgoat', 'CCR-X']]) {
  const m = out[cid]?.find((x) => x.type === want)
  if (!m) { console.log(`  [!] ${cid} ${want} 缺失：现有 ${out[cid]?.map((x) => x.type).join('/')}`); continue }
  const l3 = m.levels.find((l) => l.level === 3)
  console.log(`  ${cid} ${m.name}(${m.type}) L3 attr=${JSON.stringify(l3.attr)} 天赋更新${l3.talents.length}条 特性${l3.trait ? '有' : '无'}`)
}
