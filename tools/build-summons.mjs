// tools/build-summons.mjs —— 召唤物数据管线：character_table(TOKEN) → data/summons.json
//
// 关联策略（双层，符合项目架构）：
//   第一层（确定性）：干员 id = char_<序号>_<代号>，召唤物 id = token_<序号>_<代号>_<名字>
//                     → **代号段相同即为同一干员**（char_003_kalts ↔ token_10002_kalts_mon3tr）
//                     另外用"干员天赋/技能 blackboard 里出现该 token id 字符串"做交叉印证
//   第二层（LLM 兜底）：代号对不上的（如跨干员/异格/编号不同的）走 tools/overrides.mjs 的人工补丁
//
// 战斗召唤物判定：面板不是占位值（atk=100 且 间隔=1 且 生命=100 视为装置/工具，不算 DPS）
import { readFile, writeFile } from 'node:fs/promises'

const ROOT = 'E:/github/ArknightsGameData/zh_CN/gamedata/excel'
const OUT = 'E:/github/arknights-strength-agent/data/summons.json'
const chars = JSON.parse(await readFile(`${ROOT}/character_table.json`, 'utf8'))
const skills = JSON.parse(await readFile(`${ROOT}/skill_table.json`, 'utf8'))
const kf = (c) => { const l = c.phases?.[c.phases.length - 1]; return l?.attributesKeyFrames?.[l.attributesKeyFrames.length - 1]?.data ?? {} }
const val = (x) => (x && typeof x === 'object' && 'm_value' in x ? x.m_value : x)

/** 占位面板 = 非战斗装置 */
const isPlaceholder = (d) => d.atk === 100 && d.baseAttackTime === 1 && d.maxHp === 100

// ---- 干员：代号段 → 干员 ----
const opsByCode = new Map()
for (const [id, c] of Object.entries(chars)) {
  if (c.profession === 'TOKEN' || c.profession === 'TRAP') continue
  const m = id.match(/^char_\d+_(\w+)$/)
  if (m) opsByCode.set(m[1], { id, name: c.name })
}

// ---- 干员引用的 token id（交叉印证用）----
const refsByOp = new Map() // opName → Set(tokenId)
const scan = (opName, bbList) => {
  for (const bb of bbList) for (const b of bb ?? []) {
    const v = val(b.value)
    if (typeof v === 'string' && v.startsWith('token_')) (refsByOp.get(opName) ?? refsByOp.set(opName, new Set()).get(opName)).add(v)
  }
}
for (const [, c] of Object.entries(chars)) {
  if (c.profession === 'TOKEN' || c.profession === 'TRAP') continue
  for (const t of c.talents ?? []) for (const cand of t.candidates ?? []) scan(c.name, [cand.blackboard])
  for (const s of c.skills ?? []) for (const lv of (skills[s.skillId]?.levels ?? [])) scan(c.name, [lv.blackboard])
}

// ---- 召唤物 ----
const summons = []
let linkedByCode = 0, linkedByRef = 0, unlinked = 0
for (const [id, c] of Object.entries(chars)) {
  if (c.profession !== 'TOKEN') continue
  const d = kf(c)
  const m = id.match(/^token_\d+_(\w+?)(?:_|$)/)
  const code = m?.[1]
  let owner = opsByCode.get(code) ?? null
  let how = owner ? 'code' : null
  if (!owner) {
    // 交叉印证：谁的天赋/技能里出现了这个 id
    for (const [opName, set] of refsByOp) if (set.has(id)) { owner = { id: null, name: opName }; how = 'ref'; break }
  }
  if (owner) (how === 'code' ? linkedByCode++ : linkedByRef++); else unlinked++
  summons.push({
    id,
    name: c.name ?? null,
    owner: owner?.name ?? null,
    link: how,
    combat: !isPlaceholder(d) && (d.atk ?? 0) > 0,
    device: isPlaceholder(d),
    atk: d.atk ?? 0,
    interval: d.baseAttackTime ?? null,
    blockCnt: d.blockCnt ?? 0,
    maxHp: d.maxHp ?? 0,
    cost: d.cost ?? null,
    skillIds: (c.skills ?? []).map((s) => s.skillId),
  })
}

const combat = summons.filter((s) => s.combat)
const payload = {
  builtAt: new Date().toISOString().slice(0, 10),
  source: 'ArknightsGameData(zh_CN) character_table.json (profession=TOKEN)',
  notes: [
    '召唤物本体在 character_table 的 TOKEN 职业下；token_table.json 不是召唤物名录（只有 trap_* 地图装置）',
    'owner 关联：一级按 id 代号段匹配，二级按"干员 blackboard 中出现的 token id"交叉印证；仍未关联的见 link=null',
    'combat=false 且 device=true 的是装置/工具（占位面板 atk100/间隔1/生命100），不计 DPS',
    '召唤物自身技能（skillIds）未建模，仅记录',
  ],
  stats: { total: summons.length, combat: combat.length, linkedByCode, linkedByRef, unlinked },
  summons,
}
await writeFile(OUT, JSON.stringify(payload, null, 1), 'utf8')
console.log(`✅ 写入 ${OUT}`)
console.log(`   召唤物 ${summons.length} 条：战斗型 ${combat.length} · 代号段关联 ${linkedByCode} · 引用印证 ${linkedByRef} · 未关联 ${unlinked}`)
console.log('\n   战斗型召唤物（按 atk 排序，前 18）：')
for (const s of [...combat].sort((a, b) => b.atk - a.atk).slice(0, 18)) {
  console.log(`     ${String(s.owner ?? '??').padEnd(9)} ${String(s.name).padEnd(14)} atk=${String(s.atk).padStart(5)} 间隔=${String(s.interval).padStart(4)} 阻挡=${s.blockCnt} 技能${s.skillIds.length}`)
}
console.log('\n   未关联的召唤物：')
for (const s of summons.filter((x) => !x.owner)) console.log(`     ${s.id.padEnd(32)} ${s.name} atk=${s.atk}`)
