// app/db/build-db.mjs —— 数据入库：data/*.json → app/db/arknights.db（SQLite，Node 内置 node:sqlite）
//
// 设计：JSON 是**构建产物**（由 tools/build-*.mjs 从游戏数据生成），SQLite 是**运行时数据库**。
// 软件层只读数据库（查询/筛选/历史），不再每次加载 10 MB JSON。
// 重建：node app/db/build-db.mjs   （幂等：先 DROP 再建）
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DB = path.join(ROOT, 'app/db/arknights.db')
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))

fs.mkdirSync(path.dirname(DB), { recursive: true })
if (fs.existsSync(DB)) fs.rmSync(DB)
const db = new DatabaseSync(DB)
db.exec('PRAGMA journal_mode = WAL')

db.exec(`
-- 干员（含面板与分支特性）
CREATE TABLE operators (
  id TEXT PRIMARY KEY, name TEXT, rarity TEXT, rarity_num INTEGER,
  profession TEXT, sub_profession TEXT, position TEXT,
  max_hp INTEGER, atk INTEGER, def INTEGER, magic_resistance INTEGER,
  cost INTEGER, block_cnt INTEGER, base_attack_time REAL, sp_recovery_per_sec REAL,
  respawn_time INTEGER, attack_speed INTEGER,
  trait_desc TEXT, trait_blackboard TEXT,
  tag_list TEXT, panel_json TEXT
);
CREATE INDEX idx_op_name ON operators(name);
CREATE INDEX idx_op_sub ON operators(sub_profession);

-- 天赋
CREATE TABLE talents (
  op_id TEXT, idx INTEGER, description TEXT, blackboard TEXT, unlock_phase TEXT, unlock_level INTEGER,
  PRIMARY KEY (op_id, idx)
);

-- 技能（一行一技能）
CREATE TABLE skills (
  op_id TEXT, idx INTEGER, skill_id TEXT, name TEXT, sp_type TEXT, sp_cost INTEGER, init_sp INTEGER,
  increment INTEGER, duration REAL, duration_type TEXT, range_id TEXT, has_mastery3 INTEGER,
  PRIMARY KEY (op_id, idx)
);

-- 技能等级（专三 = level_idx 9）
CREATE TABLE skill_levels (
  op_id TEXT, skill_idx INTEGER, level_idx INTEGER, level INTEGER, name TEXT,
  description TEXT, duration REAL, blackboard TEXT,
  PRIMARY KEY (op_id, skill_idx, level_idx)
);

-- 模组（含数值）
CREATE TABLE modules (
  module_id TEXT PRIMARY KEY, op_id TEXT, name TEXT, type TEXT, is_special INTEGER,
  has_combat_data INTEGER, scope_tags TEXT, sort_order INTEGER
);
CREATE INDEX idx_mod_op ON modules(op_id);

CREATE TABLE module_levels (
  module_id TEXT, level INTEGER, attr TEXT, talents TEXT, trait TEXT,
  PRIMARY KEY (module_id, level)
);

-- 标准场景 / 来袭画像 / 场景基准线
CREATE TABLE scenarios (id TEXT PRIMARY KEY, name TEXT, def INTEGER, res INTEGER, enemy TEXT);
CREATE TABLE threat_profiles (id TEXT PRIMARY KEY, damage_type TEXT, atk INTEGER, interval REAL, dps REAL, anchor TEXT);
CREATE TABLE scenario_baseline (id TEXT PRIMARY KEY, name TEXT, def INTEGER, res INTEGER,
  count INTEGER, p10 REAL, p25 REAL, p50 REAL, p75 REAL, p90 REAL, top TEXT);

-- 用户自制干员（软件功能：自制干员参与评测）
CREATE TABLE custom_operators (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, data TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
);

-- 评测历史（软件功能：可回看）
CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT, op_name TEXT, skill_idx INTEGER,
  module_spec TEXT, damage_type TEXT, payload TEXT, created_at TEXT DEFAULT (datetime('now'))
);
`)

const ins = (sql) => db.prepare(sql)
const RARITY_NUM = { TIER_1: 1, TIER_2: 2, TIER_3: 3, TIER_4: 4, TIER_5: 5, TIER_6: 6 }

// ---- 干员 / 天赋 / 技能 ----
const ops = load('data/operators.json').operators
const iOp = ins(`INSERT INTO operators (id,name,rarity,rarity_num,profession,sub_profession,position,
  max_hp,atk,def,magic_resistance,cost,block_cnt,base_attack_time,sp_recovery_per_sec,respawn_time,attack_speed,
  trait_desc,trait_blackboard,tag_list,panel_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
const iTal = ins(`INSERT INTO talents (op_id,idx,description,blackboard,unlock_phase,unlock_level) VALUES (?,?,?,?,?,?)`)
const iSk = ins(`INSERT INTO skills (op_id,idx,skill_id,name,sp_type,sp_cost,init_sp,increment,duration,duration_type,range_id,has_mastery3) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
const iLv = ins(`INSERT INTO skill_levels (op_id,skill_idx,level_idx,level,name,description,duration,blackboard) VALUES (?,?,?,?,?,?,?,?)`)

let levels = 0
for (const op of ops) {
  const p = op.panel ?? {}
  iOp.run(op.id, op.name, op.rarity, RARITY_NUM[op.rarity] ?? 5, op.profession, op.subProfessionId,
    op.position ?? null, p.maxHp ?? null, p.atk ?? null, p.def ?? null, p.magicResistance ?? null,
    p.cost ?? null, p.blockCnt ?? null, p.baseAttackTime ?? null, p.spRecoveryPerSec ?? null,
    p.respawnTime ?? null, p.attackSpeed ?? null,
    op.trait?.description ?? null, JSON.stringify(op.trait?.blackboard ?? []),
    JSON.stringify(op.tagList ?? []), JSON.stringify(p))
  for (const [i, t] of (op.talents ?? []).entries()) {
    iTal.run(op.id, i + 1, t.description ?? null, JSON.stringify(t.blackboard ?? []), t.unlock?.phase ?? null, t.unlock?.level ?? null)
  }
  for (const [si, s] of (op.skills ?? []).entries()) {
    const lv9 = s.levels?.[9]
    iSk.run(op.id, si, s.id ?? null, lv9?.name ?? null, lv9?.spData?.spType ?? null, lv9?.spData?.spCost ?? null,
      lv9?.spData?.initSp ?? null, lv9?.spData?.increment ?? null, lv9?.duration ?? null, lv9?.durationType ?? null,
      lv9?.rangeId ?? null, s.levels?.length >= 10 ? 1 : 0)
    for (const [li, l] of (s.levels ?? []).entries()) {
      iLv.run(op.id, si, li, l.level ?? null, l.name ?? null, l.description ?? null, l.duration ?? null, JSON.stringify(l.blackboard ?? []))
      levels++
    }
  }
}

// ---- 模组 ----
const mods = load('data/modules.json').modules
const iMod = ins(`INSERT INTO modules VALUES (?,?,?,?,?,?,?,?)`)
const iModLv = ins(`INSERT INTO module_levels VALUES (?,?,?,?,?)`)
let modCount = 0
for (const [charId, list] of Object.entries(mods)) {
  for (const [i, m] of list.entries()) {
    iMod.run(m.id, charId, m.name, m.type, m.isSpecial ? 1 : 0, m.hasCombatData ? 1 : 0,
      JSON.stringify(m.scopeTags ?? []), m.order ?? i)
    for (const l of m.levels ?? []) {
      iModLv.run(m.id, l.level, JSON.stringify(l.attr ?? {}), JSON.stringify(l.talents ?? []), JSON.stringify(l.trait ?? null))
    }
    modCount++
  }
}

// ---- 场景 / 来袭画像 / 基准线 ----
const iSc = ins(`INSERT INTO scenarios VALUES (?,?,?,?,?)`)
for (const s of load('data/scenarios.json').scenarios) iSc.run(s.id, s.name, s.def, s.res, s.enemy ?? null)
const iTh = ins(`INSERT INTO threat_profiles VALUES (?,?,?,?,?,?)`)
for (const t of load('data/threat-scenarios.json').profiles) iTh.run(t.id, t.damageType, t.atk, t.interval, t.dps, t.anchor)
const iBl = ins(`INSERT INTO scenario_baseline VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
for (const b of load('data/scenario-baseline.json').scenarios) {
  iBl.run(b.id, b.name, b.def, b.res, b.count, b.p10, b.p25, b.p50, b.p75, b.p90, JSON.stringify(b.top))
}

const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c
const stats = {
  operators: count('operators'), talents: count('talents'), skills: count('skills'), skill_levels: count('skill_levels'),
  modules: count('modules'), module_levels: count('module_levels'), scenarios: count('scenarios'),
  threats: count('threat_profiles'), baseline: count('scenario_baseline'),
}
db.close()
const size = (fs.statSync(DB).size / 1024 / 1024).toFixed(1)
console.log(`✅ ${DB}（${size} MB）`)
console.log('   ' + Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(' · '))
