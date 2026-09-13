// app/db/index.mjs —— 数据库访问层（软件层唯一的数据入口）
// 软件只读这里；数据集的构建仍由 tools/build-*.mjs 负责（JSON → build-db.mjs → SQLite）
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'

const DB = path.resolve(import.meta.dirname, 'arknights.db')
if (!fs.existsSync(DB)) {
  throw new Error(`数据库不存在：${DB}\n请先运行：node app/db/build-db.mjs`)
}
export const db = new DatabaseSync(DB)
db.exec('PRAGMA foreign_keys = ON')

// 幂等建表：软件演进新增的表在这里 IF NOT EXISTS 建立
// （自制干员/评测历史是用户数据，不能依赖 build-db.mjs 的 DROP 重建）
db.exec(`
CREATE TABLE IF NOT EXISTS mechanism_parses (
  op_id TEXT, skill_idx INTEGER, form TEXT, patches TEXT, reasoning TEXT,
  confidence TEXT, provider TEXT, model TEXT, source TEXT DEFAULT 'llm',
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT,
  PRIMARY KEY (op_id, skill_idx)
);
CREATE INDEX IF NOT EXISTS idx_parse_updated ON mechanism_parses(updated_at DESC);
`)

const parse = (s, dflt) => { try { return s ? JSON.parse(s) : dflt } catch { return dflt } }

/** 把一行 operators 还原成评测管线需要的干员对象（形状与 data/operators.json 一致）。 */
function hydrateOperator(row) {
  if (!row) return null
  const skills = db.prepare(
    `SELECT s.idx, s.skill_id AS id, s.has_mastery3 FROM skills s WHERE s.op_id = ? ORDER BY s.idx`,
  ).all(row.id)
  const iLv = db.prepare(
    `SELECT level, name, description, duration, blackboard FROM skill_levels WHERE op_id=? AND skill_idx=? ORDER BY level_idx`,
  )
  const iTal = db.prepare(`SELECT description, blackboard, unlock_phase, unlock_level FROM talents WHERE op_id=? ORDER BY idx`)
  const iMod = db.prepare(`SELECT module_id AS id, name, type, is_special, has_combat_data, scope_tags, sort_order FROM modules WHERE op_id=? ORDER BY sort_order`)
  const iModLv = db.prepare(`SELECT level, attr, talents, trait FROM module_levels WHERE module_id=? ORDER BY level`)
  return {
    id: row.id,
    name: row.name,
    rarity: row.rarity,
    profession: row.profession,
    subProfessionId: row.sub_profession,
    position: row.position,
    tagList: parse(row.tag_list, []),
    panel: parse(row.panel_json, {}),
    trait: row.trait_desc
      ? { name: null, description: row.trait_desc, blackboard: parse(row.trait_blackboard, []) }
      : null,
    talents: iTal.all(row.id).map((t) => ({
      name: null, description: t.description, blackboard: parse(t.blackboard, []),
      unlock: t.unlock_phase ? { phase: t.unlock_phase, level: t.unlock_level } : null,
    })),
    skills: skills.map((s) => ({
      id: s.id,
      levels: iLv.all(row.id, s.idx).map((l) => ({
        level: l.level,
        name: l.name,
        description: l.description,
        duration: l.duration,
        blackboard: parse(l.blackboard, []),
        // spData 由 skills 表的专三行提供（评测固定用专三）
        spData: null,
      })),
      hasMastery3: !!s.has_mastery3,
    })),
    modules: iMod.all(row.id).map((m) => ({
      id: m.id, name: m.name, type: m.type, isSpecial: !!m.is_special,
      hasCombatData: !!m.has_combat_data, scopeTags: parse(m.scope_tags, []), order: m.sort_order,
      levels: iModLv.all(m.id).map((l) => ({
        level: l.level, attr: parse(l.attr, {}), talents: parse(l.talents, []), trait: parse(l.trait, null),
      })),
    })),
  }
}

/** 补回专三 spData（skills 表存的是专三行的 sp 数据）。 */
function withSp(skillIdx, row, skillRows) {
  const s = skillRows.find((x) => x.idx === skillIdx)
  return s ? { spType: s.sp_type, spCost: s.sp_cost, initSp: s.init_sp, increment: s.increment, durationType: s.duration_type } : null
}

/** 单个干员（含技能/天赋/模组全量）。 */
export function getOperator(query) {
  const row = db.prepare(`SELECT * FROM operators WHERE id=? OR name=? LIMIT 1`).get(query, query)
  if (!row) return null
  const op = hydrateOperator(row)
  // 把 skills 表的专三 sp/duration 数据补进每个技能的最后一档（levels[9]）
  const srows = db.prepare(`SELECT * FROM skills WHERE op_id=? ORDER BY idx`).all(row.id)
  for (const [i, s] of op.skills.entries()) {
    const meta = srows[i]
    const last = s.levels[9] ?? s.levels[s.levels.length - 1]
    if (last && meta) {
      last.spData = { spType: meta.sp_type, spCost: meta.sp_cost, initSp: meta.init_sp, increment: meta.increment }
      last.durationType = meta.duration_type
      last.rangeId = meta.range_id
      if (last.duration === null || last.duration === undefined) last.duration = meta.duration
    }
  }
  return op
}

/** 干员检索（名称模糊 + 职业/分支/稀有度过滤 + 分页）。 */
export function searchOperators({ q = '', profession = '', subProfession = '', rarity = '', limit = 50, offset = 0 } = {}) {
  const where = []
  const args = []
  if (q) { where.push('(name LIKE ? OR id LIKE ?)'); args.push(`%${q}%`, `%${q}%`) }
  if (profession) { where.push('profession = ?'); args.push(profession) }
  if (subProfession) { where.push('sub_profession = ?'); args.push(subProfession) }
  if (rarity) { where.push('rarity = ?'); args.push(rarity) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM operators ${w}`).get(...args).c
  const rows = db.prepare(
    `SELECT id,name,rarity,rarity_num,profession,sub_profession,sub_profession_name,atk,def,max_hp,cost,block_cnt,trait_desc
     FROM operators ${w} ORDER BY rarity_num DESC, sub_profession_name, name LIMIT ? OFFSET ?`,
  ).all(...args, limit, offset)
  return { total, rows }
}

/** 职业 / 分支 / 稀有度清单（前端筛选用）。分支带中文名与所属职业，供"职业→分支"二级筛选。 */
export function facets() {
  return {
    professions: db.prepare(`SELECT profession, COUNT(*) c FROM operators GROUP BY profession ORDER BY c DESC`).all(),
    rarities: db.prepare(`SELECT rarity, COUNT(*) c FROM operators GROUP BY rarity ORDER BY rarity`).all(),
    subProfessions: db.prepare(
      `SELECT sub_profession AS id, COALESCE(sub_profession_name, sub_profession) AS name, profession, COUNT(*) c
       FROM operators GROUP BY sub_profession ORDER BY profession, c DESC`,
    ).all(),
  }
}

export const getScenarios = () => db.prepare(`SELECT * FROM scenarios`).all()
export const getThreats = () => db.prepare(`SELECT * FROM threat_profiles`).all()
export const getBaseline = () => db.prepare(`SELECT * FROM scenario_baseline`).all()
/** 射程几何（range_table）：DB 列名 → 前端习惯的字段名，grids 从 JSON 还原成 [row,col] 数组 */
export const getRanges = () =>
  db.prepare(`SELECT * FROM ranges`).all().map((r) => ({
    id: r.range_id,
    direction: r.direction,
    grids: JSON.parse(r.grids ?? '[]'),
    tiles: r.tiles,
    width: r.width,
    height: r.height,
    reach: r.reach,
    nearest: r.nearest,
    containsSelf: !!r.contains_self,
    shape: r.shape,
  }))

/** 自制干员 CRUD。 */
export const listCustom = () => db.prepare(`SELECT * FROM custom_operators ORDER BY id DESC`).all()
export function saveCustom(name, data) {
  db.prepare(
    `INSERT INTO custom_operators (name, data, updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(name) DO UPDATE SET data=excluded.data, updated_at=datetime('now')`,
  ).run(name, JSON.stringify(data))
  return db.prepare(`SELECT * FROM custom_operators WHERE name=?`).get(name)
}
export const deleteCustom = (name) => db.prepare(`DELETE FROM custom_operators WHERE name=?`).run(name)

/** 评测历史。 */
export function recordEvaluation(payload) {
  return db.prepare(
    `INSERT INTO evaluations (op_id,op_name,skill_idx,module_spec,damage_type,payload) VALUES (?,?,?,?,?,?)`,
  ).run(payload.opId ?? null, payload.opName ?? null, payload.skillIdx ?? null, payload.moduleSpec ?? null,
    payload.damageType ?? null, JSON.stringify(payload.result ?? null))
}
export const recentEvaluations = (limit = 20) =>
  db.prepare(`SELECT id,op_name,skill_idx,module_spec,damage_type,created_at FROM evaluations ORDER BY id DESC LIMIT ?`).all(limit)
export const getEvaluation = (id) => {
  const r = db.prepare(`SELECT * FROM evaluations WHERE id=?`).get(id)
  return r ? { ...r, payload: parse(r.payload, null) } : null
}

// ---- 机制解析沉淀（AI 产出的长尾机制补丁）----
// 定位：AI **提议**、人工**审核**、审核后手工并入 tools/overrides.mjs。
// 绝不自动注入引擎 —— 未经审核的模型输出不能影响数值。
export function saveParse({ opId, skillIdx, form, patches, reasoning, confidence, provider, model, source = 'llm' }) {
  db.prepare(
    `INSERT INTO mechanism_parses (op_id, skill_idx, form, patches, reasoning, confidence, provider, model, source, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(op_id, skill_idx) DO UPDATE SET
       form=excluded.form, patches=excluded.patches, reasoning=excluded.reasoning,
       confidence=excluded.confidence, provider=excluded.provider, model=excluded.model,
       source=excluded.source, updated_at=datetime('now')`,
  ).run(opId, skillIdx, form ?? null, JSON.stringify(patches ?? {}), reasoning ?? null,
    confidence ?? null, provider ?? null, model ?? null, source)
  return getParse(opId, skillIdx)
}
export const getParse = (opId, skillIdx) => {
  const r = db.prepare(`SELECT * FROM mechanism_parses WHERE op_id=? AND skill_idx=?`).get(opId, skillIdx)
  return r ? { ...r, patches: parse(r.patches, {}) } : null
}
export const listParses = (limit = 100) => db.prepare(
  `SELECT p.*, o.name AS op_name FROM mechanism_parses p LEFT JOIN operators o ON o.id = p.op_id
   ORDER BY p.updated_at DESC LIMIT ?`,
).all(limit).map((r) => ({ ...r, patches: parse(r.patches, {}) }))
export const deleteParse = (opId, skillIdx) => db.prepare(`DELETE FROM mechanism_parses WHERE op_id=? AND skill_idx=?`).run(opId, skillIdx)

/** 导出为 tools/overrides.mjs 的 SKILL_OVERRIDES 片段（供人工审核后手工并入）。 */
export function exportOverrides(limit = 100) {
  const rows = listParses(limit).filter((r) => r.patches && Object.keys(r.patches).length)
  const lines = rows.map((r) => {
    const name = r.op_name ?? r.op_id
    return `  // ${name} · 技能${r.skill_idx + 1} · 置信度 ${r.confidence ?? '?'} · 来源 ${r.provider ?? '?'}/${r.model ?? '?'}\n` +
      `  // 依据：${(r.reasoning ?? '').slice(0, 90)}\n` +
      `  '${name}': { ${r.skill_idx}: ${JSON.stringify(r.patches)} },`
  })
  return `// ⚠ 由软件导出（AI 提议），**必须人工审核**后再并入 SKILL_OVERRIDES。\n// 生成时间：${new Date().toISOString()}\n// 共 ${rows.length} 条\nconst _GENERATED_CANDIDATES = {\n${lines.join('\n')}\n}\n`
}

export { hydrateOperator, withSp }
