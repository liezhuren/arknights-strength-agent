// tools/conditional.mjs —— 条件型加成与索敌层（2026 新增）
//
// 解决三类"**不该进 DPS 但必须让用户看到**"的机制（与"条件型穿透只标注"同一原则）：
//
//   ① **对空加成**（`atk_scale_to_fly`）：只对**空中敌人**生效的额外伤害。
//      全库仅阿罗玛 1 人，且语义方向是**加成**而非惩罚（"对空中敌人额外造成X%"）。
//      我们的 5 档来袭画像与 6 个标准场景**全是地面敌人** → 默认场景下该加成不生效，
//      故只标注 + 单独给出"空战口径"的数值，**不并进默认 DPS**。
//
//   ② **索敌规则**（`优先攻击X`）：全库 **57 名干员**带此表述（狙击系的"优先攻击空中单位"
//      来自**分支特性**而非技能 → 描述来源必须包含特性文本，否则漏 23 名）。
//      它**不改变 DPS 总量，只改变落点** → 进操作难度栏与场景评注，不进输出数值。
//
//   ③ **蓄力两态**：9 名干员（卡涅利安/龙舌兰/温米/灵知/斥罪/薇薇安娜/流明/焰狐龙梓兰/假日威龙陈）。
//      蓄力把技能**强化到不同数值**，但**没有任何公共编码**（有的翻倍、有的换目标数、有的延时长），
//      且不能可靠地把"强化值"接到引擎参数上（脱离干员实测会算错）→
//      故做成**两态并列展示**（普通值 vs 蓄力强化值），**不自动改基准 DPS**，由 agent 结合场景判断。
import { readFileSync } from 'node:fs'

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '')
const val = (x) => (x && typeof x === 'object' && 'm_value' in x ? x.m_value : x)

/** 收集干员的所有文本源（天赋 + 特性 + 全部技能专三）——**特性必须包含**（对空/索敌多在特性里） */
function textSources(op) {
  const out = []
  for (const t of op.talents ?? []) {
    if (t.description) out.push({ src: '天赋', text: strip(t.description) })
  }
  if (op.trait?.description) out.push({ src: '特性', text: strip(op.trait.description) })
  for (const [i, s] of (op.skills ?? []).entries()) {
    const lv = s.levels?.[s.levels.length - 1]
    if (lv?.description) out.push({ src: `S${i + 1}`, text: strip(lv.description) })
  }
  return out
}

/** ① 对空加成：值来自 `atk_scale_to_fly`（与描述一一对应） */
function airBonus(op, skillIndex, masteryLevel) {
  const found = []
  for (const [i, s] of (op.skills ?? []).entries()) {
    const levels = s.levels ?? []
    // 用**已解析的专精等级**取值（0..9 对应 1..7 级 + 专一/二/三），不要"取最大值"（那是碰巧对）
    const lv = levels[masteryLevel] ?? levels[levels.length - 1]
    if (!lv) continue
    for (const b of lv.blackboard ?? []) {
      if (!/^(attack@)?atk_scale_to_fly$/.test(b.key)) continue
      const v = val(b.value)
      if (typeof v !== 'number' || v <= 0) continue
      found.push({ skillIndex: i, value: v, key: b.key, desc: strip(lv.description) })
    }
  }
  if (!found.length) return null
  // 主技能优先；否则取档位最高的那条（仅当当前技能没有该加成时）
  const main = found.find((f) => f.skillIndex === skillIndex)
    ?? found.sort((a, b) => b.value - a.value)[0]
  return {
    pct: main.value,
    skillIndex: main.skillIndex,
    key: main.key,
    desc: main.desc.slice(0, 70),
    note: `对空中敌人额外 ${Math.round(main.value * 100)}% 攻击力（仅空中场景生效；来自 S${main.skillIndex + 1}）`,
  }
}

/** ② 索敌规则：从特性/天赋/技能里取"优先攻击X" */
function priorityTargets(op) {
  const out = []
  for (const { src, text } of textSources(op)) {
    // 目标描述到标点/换行/"且"为止；注意文本里的换行是**转义序列 `\n`**，不是真换行
    const m = text.match(/优先攻击([^，。；、\n\\]{1,16})/)
    if (!m) continue
    let target = m[1].split(/且|并且|同时/)[0].trim()
    target = target.replace(/\s+$/, '')
    if (!target) continue
    out.push({ src, target })
  }
  // 去重（同一表述可能同时在特性和技能里）
  const seen = new Set()
  return out.filter((x) => {
    const k = `${x.src}|${x.target}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** ③ 蓄力两态：对比"普通形态"与"蓄力形态"的可展示差异 */
function chargeStates(op, skillIndex) {
  const s = op.skills?.[skillIndex] ?? (op.skills ?? []).at(-1)
  if (!s) return null
  // 专三两级：普通（下标 7）与蓄力（下标 9）
  const levels = s.levels ?? []
  if (levels.length < 10) return null
  const base = levels[7]
  const charged = levels[9]
  if (!base || !charged) return null
  const mapBb = (lv) => Object.fromEntries((lv.blackboard ?? []).map((b) => [b.key, val(b.value)]))
  const b1 = mapBb(base)
  const b2 = mapBb(charged)
  const diffs = []
  for (const k of new Set([...Object.keys(b1), ...Object.keys(b2)])) {
    const x = b1[k]
    const y = b2[k]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') diffs.push({ key: k, from: x, to: y })
  }
  if (!diffs.length) return null
  // 只截取"变化值所在的那一句"，避免两行都被截断成一样看不出差别
  const snippets = []
  for (const d of diffs) {
    const re = new RegExp(`[^。；\\n]{0,26}\\{${d.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[^}]*\\}[^。；\\n]{0,10}`)
    const hit = strip(charged.description).match(re)?.[0]
    if (hit) snippets.push(hit.trim())
  }
  return {
    skillIndex,
    name: levels[0]?.name ?? s.id,
    valueDiffs: diffs,
    snippets: [...new Set(snippets)].slice(0, 3),
    note: '蓄力形态仅展示强化后的值，**未自动改动基准 DPS**（不同干员编码不统一，硬接参数会算错）',
  }
}

/**
 * 汇总一个干员的条件型机制（只标注，不进默认 DPS）。
 * @param {object} op - 干员（模组修改后的对象同样适用）
 * @param {number} [skillIndex] - 当前评测的技能下标
 */
export function extractConditional(op, skillIndex = 2, masteryLevel = 9) {
  const priority = priorityTargets(op)
  const r = {
    airBonus: airBonus(op, skillIndex, masteryLevel),
    priority,
    charge: null,
  }
  for (const [i, s] of (op.skills ?? []).entries()) {
    const lv = s.levels?.[s.levels.length - 1]
    if (lv && /蓄力/.test(strip(lv.description))) {
      const st = chargeStates(op, i)
      if (st) { r.charge = st; break }
    }
  }
  const hasAny = r.airBonus || r.priority.length || r.charge
  return hasAny ? r : null
}

/** 报告行：条件型加成的呈现（⚠ 必须写明"未计入 DPS"） */
export function formatConditionalSection(c) {
  if (!c) return []
  const lines = []
  if (c.airBonus) {
    lines.push(`对空加成（⚠未计入默认 DPS）：${c.airBonus.note} —— 6 个标准场景与 5 档来袭画像均为**地面**敌人，故默认不生效`)
    lines.push(`          空战口径参考：对空 dtps ≈ 地面 × ${(1 + c.airBonus.pct).toFixed(2)}（仅对空中单位成立）`)
  }
  if (c.priority.length) {
    const byTarget = new Map()
    for (const p of c.priority) {
      if (!byTarget.has(p.target)) byTarget.set(p.target, [])
      byTarget.get(p.target).push(p.src)
    }
    const items = [...byTarget.entries()].map(([t, srcs]) => `${t}（${srcs.join('/')}）`)
    lines.push(`索敌规则：优先攻击 ${items.join(' · ')}（**不改 DPS 总量，只改变落点** → 影响场景价值与操作难度）`)
  }
  if (c.charge) {
    lines.push(`蓄力两态（${c.charge.name}）：普通形态 → 蓄力形态的强化`)
    for (const d of c.charge.valueDiffs.slice(0, 6)) {
      lines.push(`          ${d.key}: ${d.from} → ${d.to}`)
    }
    for (const s of c.charge.snippets) lines.push(`          原文：…${s}…`)
    lines.push(`          ⚠ ${c.charge.note}`)
  }
  return lines
}
