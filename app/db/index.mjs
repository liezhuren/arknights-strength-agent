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

/** 干员检索（名称模糊 + 职业/稀有度过滤 + 分页）。 */
export function searchOperators({ q = '', profession = '', rarity = '', limit = 50, offset = 0 } = {}) {
  const where = []
  const args = []
  if (q) { where.push('(name LIKE ? OR id LIKE ?)'); args.push(`%${q}%`, `%${q}%`) }
  if (profession) { where.push('profession = ?'); args.push(profession) }
  if (rarity) { where.push('rarity = ?'); args.push(rarity) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM operators ${w}`).get(...args).c
  const rows = db.prepare(
    `SELECT id,name,rarity,rarity_num,profession,sub_profession,atk,def,max_hp,cost,block_cnt,trait_desc
     FROM operators ${w} ORDER BY rarity_num DESC, name LIMIT ? OFFSET ?`,
  ).all(...args, limit, offset)
  return { total, rows }
}

/** 职业 / 稀有度清单（前端筛选用）。 */
export function facets() {
  return {
    professions: db.prepare(`SELECT profession, COUNT(*) c FROM operators GROUP BY profession ORDER BY c DESC`).all(),
    rarities: db.prepare(`SELECT rarity, COUNT(*) c FROM operators GROUP BY rarity ORDER BY rarity`).all(),
    subProfessions: db.prepare(`SELECT sub_profession, COUNT(*) c FROM operators GROUP BY sub_profession ORDER BY c DESC`).all(),
  }
}

export const getScenarios = () => db.prepare(`SELECT * FROM scenarios`).all()
export const getThreats = () => db.prepare(`SELECT * FROM threat_profiles`).all()
export const getBaseline = () => db.prepare(`SELECT * FROM scenario_baseline`).all()

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

export { hydrateOperator, withSp }
