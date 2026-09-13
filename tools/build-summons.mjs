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
const SEMANTICS = 'E:/github/arknights-strength-agent/data/summon-semantics.json'
const chars = JSON.parse(await readFile(`${ROOT}/character_table.json`, 'utf8'))
const skills = JSON.parse(await readFile(`${ROOT}/skill_table.json`, 'utf8'))

// 语义层（AI/人工阅读描述的产物，**只采信带原文引用的事实**）：目前只用于补"文本声明的限时寿命"
// —— 黑匣子 attack@tokenduration 只覆盖夕；鸿雪「打字机」持续25秒、温蒂蓄水炮持续20秒只能从文本拿。
// ⚠ 该文件经复核有**三类不可信处**，故本管线只取"限时寿命 + 原文引用"这一项：
//   ① `existence` 判定把麦哲伦无人机误判为 skillOnly，且引用的是**电弧的句子**（无人机是携带即有，不绑技能）
//   ② 4 条 `id` 是**编造**的（打字机真实 id = token_10026_bgsnow_subbow，文件写成 token_10014_…；电弧三条同）
//      → 因此关联**按 owner+name 解析**，不采信它给的 id（与"召唤物关联靠确定性匹配"同一原则）
//   ③ `concurrency` 是干员级总上限，不是单体倍数（见 §17 口径③）
let semantics = {}
try {
  const raw = JSON.parse(await readFile(SEMANTICS, 'utf8'))
  for (const s of raw.summons ?? []) {
    if (s.owner && s.name && s.durationSec && typeof s.durationSec === 'number' && s.quote) {
      semantics[`${s.owner}|${s.name}`] = { durationSec: s.durationSec, quote: s.quote }
    }
  }
} catch { /* 语义文件不存在时静默跳过（数据层可独立复现） */ }
const kf = (c) => { const l = c.phases?.[c.phases.length - 1]; return l?.attributesKeyFrames?.[l.attributesKeyFrames.length - 1]?.data ?? {} }
const val = (x) => (x && typeof x === 'object' && 'm_value' in x ? x.m_value : x)

/** 占位面板 = 非战斗装置 */
const isPlaceholder = (d) => d.atk === 100 && d.baseAttackTime === 1 && d.maxHp === 100

// ---- "同时存在数"抽取（决定召唤物 DPS 的倍数）----
//
// ⚠ 两条踩过的坑（都能造成 2–3 倍误差）：
//   ① 天赋里的 `cnt`/「可以使用5个」是**总数/携带上限**，不是同时数 —— 令/麦哲伦/电弧写作
//      「可以使用5个召唤物（最多同时部署3个）」。
//   ② 更不能把那个 3 直接乘到单体上：麦哲伦/电弧/令的召唤物是**技能选择的功能模式**
//      （S2「无人机可部署在近战位，单体法术攻击」/ S3「远程位，群体物理攻击」），
//      **同一时刻只有 1 种在场**，所以单体 DPS 已代表该形态的全部输出。
//   ③ 只有当"数量"表述**直接指向这个召唤物**时才算真·多副本：
//      维什戴尔 S3「立刻召唤2个魂灵之影（最多存在3个，技能结束后保留）」→ 3；
//      特克诺「被击倒时生成一个木偶舞者（最多存在5个）」→ 5。
//
// 规则：在**同一段文本**里同时出现「最多同时部署/存在/可部署 N 个」与召唤物关键词（召唤/部署/自身名/无人机/虚影…）
// 才采信 N；否则取 1（`confidence: default`），并在报告里标注为下限。
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const asNum = (s) => (s === undefined || s === null ? null : /^\d+$/.test(s) ? Number(s) : (CN_NUM[s] ?? null))
const SIMUL_RE = /(?:最多同时部署|最多存在|最多可部署)[约]?([0-9]+|[一二两三四五六七八九十])个/g
/** 该 summoned 关键词是否与数量表述同处一段（同段 = 表述直接指向它） */
const TOKEN_WORDS = ['召唤物', '召唤', '部署', '无人机', '虚影', '傀儡', '装置', '羽兽', '水獭', '摄影', '纸偶', '狼', '触手', '眠兽', '仆役', '舞者', '棋子', '地雷', '夹子', '盟誓', '打字机', 'Mon3tr', '自在', '清平', '逍遥', '弦惊', '戴乌', '赛柯', '桑特拉', '龙腾']

/**
 * 取同时存在数。返回 { value, confidence, quote }
 * @param {string} text - 与这个召唤物有关的文本（该干员的技能段落；退化时用天赋段落）
 * @param {string|null} name - 召唤物自身名字（最直接的证据：文本里点名了它）
 */
function concurrencyFor(text, name) {
  const parts = String(text).split(/[\n]|(?<=[。；;])/)
  let best = null
  let quote = ''
  for (const part of parts) {
    SIMUL_RE.lastIndex = 0
    const m = SIMUL_RE.exec(part)
    if (!m) continue
    const n = asNum(m[1])
    if (n === null || n <= 0) continue
    const namesIt = name && part.includes(name)
    const generic = TOKEN_WORDS.some((w) => part.includes(w))
    if (!namesIt && !generic) continue
    if (best === null || n > best) { best = n; quote = part.trim().slice(0, 60) }
  }
  return best === null ? { value: 1, confidence: 'default', quote: '' } : { value: best, confidence: 'phrase', quote }
}

// ---- 召唤物**自身技能**的伤害改量提取（2026 §18）----
//
// 结构事实（已核实）：
//   · 召唤物的 skills[N] 对应其**第 N+1 个技能**；干员的技能可以给召唤物换技能
//     （鸿雪 S3「锐笔速写」→ 打字机 sktok_bgsnow_3）
//   · **不能用召唤物技能序号反推干员技能序号**：令三种形态共用 sktok_ling_soul3
//     （形态由"功能"决定，不是技能序号）→ 只能按**效果**判定
//   · `2.` 前缀的键属于**第二形态**（弦惊「普通形态/高级形态」），**不作用于基础形态** → 跳过
//
// 只建模"无条件且改变普攻"的两类（其余只统计+标注，绝不硬套）：
//   ① 攻击力倍率：`atk`(值 v → ×(1+v)) 或 `atk_scale`/`attack@atk_scale`(值 v → ×v)
//   ② 攻击间隔：`attack_speed`（**是百分比**，+60 → 间隔 ÷1.6）或 `base_attack_time`（秒差，负值缩短）
//
// ⚠ 已知**不能**当普攻倍率的（会算错，故排除）：
//   · 一次性入场伤害：梅尔「爆破回收」6 倍、傀影「夜幕突袭」3 倍、W 2.8 倍、蜜蜡「沙之碑召唤」3 倍…
//   · 周期/持续伤害：死芒 S3「每秒造成攻击力120%」、望 S2 5.8 倍
//   · 条件/概率型：傀影 S1（50% 概率）、鸿雪 S1（40% 概率 2.25 倍）、琳琅诗怀雅（在场3秒后）
//   · 高级形态专属：弦惊 `2.*`（且高级形态的真实加成不在这几个键里，硬套会算成 −20% 的错值）
const SKILL_SCALE_KEYS = ['atk', 'atk_scale', 'attack@atk_scale']
const SKILL_INTERVAL_KEYS = ['base_attack_time', 'attack_speed']
const isSecondForm = (key) => /^\d+\./.test(key)
const cleanDesc = (d) => String(d ?? '').replace(/<[^>]*>/g, '')

/**
 * 判断某个召唤物技能能否作为"改变普攻持续输出"的倍率。
 * 返回 { atkMult, intervalMult, modeled, reason }
 * 判据顺序（先用描述把已知的"非普攻"类型摘出去，再认无条件的普攻强化）：
 */
function classifySummonSkill(lv, name = '') {
  const bb = (lv.blackboard ?? []).map((b) => ({ key: b.key, value: val(b.value) }))
  const desc = cleanDesc(lv.description)
  const firstForm = bb.filter((b) => !isSecondForm(b.key))
  let atkMult = null
  let intervalMult = null
  for (const { key, value } of firstForm) {
    if (SKILL_SCALE_KEYS.includes(key) && typeof value === 'number') {
      const m = key === 'atk' ? 1 + value : value
      if (m > 0) atkMult = atkMult === null ? m : Math.max(atkMult, m)
    }
    if (SKILL_INTERVAL_KEYS.includes(key) && typeof value === 'number') {
      const m = key === 'attack_speed' ? 1 / (1 + value / 100) : 1 + value
      if (m > 0) intervalMult = intervalMult === null ? m : Math.min(intervalMult, m)
    }
  }
  const hasAtk = atkMult !== null
  // ---- 认定项（优先级最高）：叠层型"每击消耗一层"是**最强的普攻强化证据**，必须先判，
  //      否则会被下面的"部署后立即…"关键词误杀（傀影「血色乐章」就是这么被误判的）----
  const times = firstForm.find((b) => /^(times|max_stack_cnt)$/.test(b.key))?.value
  const atkEntry = firstForm.find((b) => b.key === 'atk' && typeof b.value === 'number')
  if (times > 0 && atkEntry) {
    return {
      atkMult: 1 + atkEntry.value,
      intervalMult,
      modeled: true,
      reason: `叠层攻击力强化（${times} 层 ×${Math.round(atkEntry.value * 100)}%，每击消耗一层 → 全程平均 ×${(1 + atkEntry.value).toFixed(2)}）`,
    }
  }
  // ---- 排除项（按描述判定）----
  if (/每秒/.test(desc)) return { atkMult, intervalMult, modeled: false, reason: '周期伤害（每秒结算），非普攻' }
  if (/概率/.test(desc) || firstForm.some((b) => b.key === 'prob')) return { atkMult, intervalMult, modeled: false, reason: '概率触发' }
  if (/下次攻击|下次的|部署后立即|部署时|出现时|触发时|引爆时|开启时|立即对|立即发射|连续攻击/.test(desc)) {
    return { atkMult, intervalMult, modeled: false, reason: '一次性入场/触发伤害，非普攻倍率' }
  }
  // 无描述时用技能名判定：爆破/引爆/触发/冲锋/召唤 都是"效果伤害"而非普攻强化
  if (/爆破|引爆|触发|冲锋|召唤|回收/.test(name)) {
    return { atkMult, intervalMult, modeled: false, reason: '技能名为效果伤害（爆破/触发/冲锋类），非普攻倍率' }
  }
  // ---- 认定项 ----
  // 描述明确说"攻击力增强" → 强化普攻
  if (hasAtk && /自身?攻击力提升|攻击力\+|攻击力提高|攻击力增强/.test(desc)) {
    return { atkMult, intervalMult, modeled: true, reason: `描述明确为攻击力强化（×${atkMult}）` }
  }
  // 攻速改量（intervalMult 命中）→ 与描述无关，`attack_speed`/`base_attack_time` 语义唯一
  if (intervalMult !== null) return { atkMult, intervalMult, modeled: true, reason: '攻击间隔改量（攻速/间隔键语义唯一）' }
  // 无描述、只有倍率键 → 无法判定是否作用于普攻，保守不计
  if (hasAtk) return { atkMult, intervalMult, modeled: false, reason: '无描述可判定，保守不计（可能是任一类型的倍率）' }
  return { atkMult, intervalMult, modeled: false, reason: '无伤害改量键' }
}

/** 提取某召唤物"自身技能"里可建模的伤害改量（逐条分类，取效率最高的一条作代表） */
function ownSkillMods(tokenChar) {
  const all = []
  const seen = new Set()
  for (const [i, sk] of (tokenChar.skills ?? []).entries()) {
    const t = skills[sk.skillId]
    if (!t) continue
    // 同一个 skillId 会在多个技能位上重复出现（令三形态共用 sktok_ling_soul3）→ 去重，避免条数虚高
    if (seen.has(sk.skillId)) continue
    seen.add(sk.skillId)
    const lv = t.levels[t.levels.length - 1]
    const c = classifySummonSkill(lv, t.levels[0]?.name ?? '')
    all.push({
      index: i,
      id: sk.skillId,
      name: t.levels[0]?.name ?? sk.skillId,
      duration: lv.duration,
      spCost: lv.spData?.spCost ?? null,
      ...c,
      // 供人工复核的关键字（只保留可能影响伤害的键）
      keys: (lv.blackboard ?? [])
        .map((b) => `${b.key}=${val(b.value)}`)
        .filter((x) => !/^(withdraw|sp_max|sp_min)=/.test(x)),
    })
  }
  const modeled = all.filter((s) => s.modeled)
  const best = modeled.sort(
    (a, b) => (b.atkMult ?? 1) / (b.intervalMult ?? 1) - (a.atkMult ?? 1) / (a.intervalMult ?? 1),
  )[0] ?? null
  return { mods: best, all, burst: burstCandidate(tokenChar, seen), modeledCount: modeled.length }
}

// ---- 召唤物"一次性入场/触发伤害"（burst 层，§19）----
//
// 这类伤害**不吃普攻倍率**（§18 已排除），但它是真实输出：傀影「夜幕突袭」3 倍、W 2.8 倍、
// 蜜蜡「沙之碑召唤」3 倍、温蒂「液氮大炮」3.5 倍…**按次结算**，与既有 `burst` 通道形态一致。
// 口径：报告"**每次触发**的伤害"，**不给 DPS**（触发次数依赖操作/部署位/回收节奏，属玩法层，
//       与望「天下劫」用理想轴同理）—— 强给频率会把假设伪装成事实。
// 排除：周期伤害（描述含"每秒"，形态不同）、概率型（描述含"概率"或 bb 有 prob）。
function burstCandidate(tokenChar, seen) {
  const val_ = val
  const out = []
  for (const sk of tokenChar.skills ?? []) {
    const t = skills[sk.skillId]
    if (!t) continue
    const lv = t.levels[t.levels.length - 1]
    const name = t.levels[0]?.name ?? sk.skillId
    const desc = cleanDesc(lv.description)
    const bb = (lv.blackboard ?? []).map((b) => ({ key: b.key, value: val_(b.value) }))
    // 一击倍率：`atk_scale`（不带 attack@ 前缀，那是按次/每秒攻击的倍率）
    const scaleEntry = bb.find((b) => b.key === 'atk_scale' && typeof b.value === 'number' && b.value > 1)
    if (!scaleEntry) continue
    if (/每秒/.test(desc)) continue // 周期伤害，不属 burst
    if (/概率/.test(desc) || bb.some((b) => b.key === 'prob')) continue // 概率触发
    // 多次命中（"造成两次"）→ 乘上次数
    const timesEntry = bb.find((b) => b.key === 'times' && typeof b.value === 'number' && b.value > 0)
    const hits = timesEntry ? timesEntry.value : 1
    out.push({
      name,
      mult: scaleEntry.value,
      hits,
      total: scaleEntry.value * hits,
      spCost: lv.spData?.spCost ?? null,
      duration: lv.duration,
      desc: desc.slice(0, 80),
    })
  }
  if (!out.length) return null
  return out.sort((a, b) => b.total - a.total)[0]
}

// ---- "限时"时长：只认黑匣子键 attack@tokenduration（夕天赋「小自在」持续25秒）----
// ⚠ 位置坑：该键在**干员的天赋/技能 blackboard**里，不在召唤物自身技能里（召唤物技能只有 skcom_withdraw）。
// ⚠ 教训：不要用文本里的「持续N秒」兜底 —— 那是**减益/护盾时长**（夜烟 抗性-23% 持续1秒、
//   罗比菈塔 护盾持续25秒…），全库 29 名命中里极少数与召唤物寿命有关，误命中代价远大于收益。
//   文本声明的召唤物寿命（鸿雪「打字机」持续25秒、温蒂蓄水炮持续20秒）由 data/summon-semantics.json
//   语义层记录，报告里标注"限时/技能绑定"。
function durationOf(ownerChar) {
  if (!ownerChar) return null
  const nums = []
  const scan = (bb) => {
    for (const b of bb ?? []) {
      if (/tokenduration|token_duration/.test(b.key)) {
        const v = val(b.value)
        if (typeof v === 'number' && v > 0) nums.push(v)
      }
    }
  }
  // ⚠ 形状坑：原始 character_table 的天赋黑匣子在 talents[].candidates[] 里（数据集里才是展平的 t.blackboard）
  for (const t of ownerChar.talents ?? []) {
    for (const cand of t.candidates ?? []) scan(cand.blackboard)
    scan(t.blackboard)
  }
  for (const s of ownerChar.skills ?? []) for (const lv of skills[s.skillId]?.levels ?? []) scan(lv.blackboard)
  return nums.length ? Math.max(...nums) : null
}

// ---- 干员 id → 完整描述文本（天赋 + 技能），供"同时部署数/持续秒数"抽取 ----
const textByOpId = new Map()
for (const [id, c] of Object.entries(chars)) {
  if (c.profession === 'TOKEN' || c.profession === 'TRAP') continue
  const parts = []
  for (const t of c.talents ?? []) parts.push(t.description ?? '')
  for (const s of c.skills ?? []) for (const lv of skills[s.skillId]?.levels ?? []) parts.push(lv.description ?? '')
  textByOpId.set(id, parts.join('\n').replace(/<[^>]*>/g, ''))
}

// ---- 干员 id → 技能段文本（数量表述"直接点名召唤物"时优先用这里）----
const skillTextByOpId = new Map()
for (const [id, c] of Object.entries(chars)) {
  if (c.profession === 'TOKEN' || c.profession === 'TRAP') continue
  const parts = []
  for (const s of c.skills ?? []) {
    const levels = skills[s.skillId]?.levels ?? []
    const lv = levels[levels.length - 1]
    if (lv) parts.push(`${levels[0]?.name ?? ''}：${(lv.description ?? '').replace(/<[^>]*>/g, '')}`)
  }
  skillTextByOpId.set(id, parts.join('\n'))
}

// ---- 干员 id → 按技能描述推断"该技能产出哪个召唤物"（仅用于报告溯源，判不准就留 null）----
// 只接受**名字直接出现**的技能；名字里含引号/修饰的（“小自在”、“打字机”）按去引号后的核心词匹配。
function skillRefFor(c, summonName) {
  if (!summonName) return null
  const core = summonName.replace(/[“”"'（）()]/g, '').trim()
  if (core.length < 2) return null
  for (const [i, s] of (c.skills ?? []).entries()) {
    const levels = skills[s.skillId]?.levels ?? []
    const lv = levels[levels.length - 1]
    const text = `${levels[0]?.name ?? ''} ${lv?.description ?? ''}`
    if (text.includes(summonName) || text.includes(core)) return i
  }
  return null
}

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

// ---- 伤害判定：三条判据（缺一不可的教训见 docs/dps-calculation.md §17）----
// ① 自身技能黑匣子有 atk_scale / attack@atk_scale > 1 → 一定是伤害型（梅尔 6、傀影 3、望 5.8…）
// ② 面板攻击力显著高于装置档（>100）→ 伤害型（Mon3tr 1402、令弦惊 823、乌尔比安 777… 这些没有倍率键）
// ③ atk=100 且无倍率键 → 默认装置/功能型，仅下列人工核对过的例外计入
//    （逐个核对过自身技能文本：沙之碑"造成…法术伤害"、铁钳号/旧日残影/香槟炸弹/矿石杀手有伤害表述）
const ATK100_DAMAGE = new Set([
  'token_10011_beewax_oblisk', // 沙之碑：出现时造成攻击力300%法术伤害
  'token_10027_ironmn_pile3', // 铁钳号·原型机：atk_scale 3
  'token_10024_ebnhlz_rcube', // 旧日残影：闪回 atk_scale 2.45
  'token_10031_swire2_gdtrap', // 香槟炸弹：见面礼 attack@atk_scale 2
  'token_10044_wulfen_mine', // 矿石"杀手"：atk_scale 2.5
])
/** 战斗型但**不造成伤害**的例外（逐个核对过本体与召唤物文本） */
const NO_DAMAGE_COMBAT = new Set([
  'token_10000_silent_healrb', // 赫默·医疗探机：治疗无人机，atk125/0.5 是**治疗量**不是伤害
])
/** 自身技能里是否存在 >1 的伤害倍率键 */
function hasDamageScale(c) {
  for (const s of c.skills ?? []) {
    for (const lv of skills[s.skillId]?.levels ?? []) {
      for (const b of lv.blackboard ?? []) {
        if (/atk_scale$/.test(b.key)) {
          const v = val(b.value)
          if (typeof v === 'number' && v > 1) return true
        }
      }
    }
  }
  return false
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
  const atk = d.atk ?? 0
  const placeholder = isPlaceholder(d)
  // 战斗召唤物 = 非占位面板 且 有攻击力；再按三条判据决定是否真的造成伤害
  const combat = !placeholder && atk > 0
  const dealsDamage = combat && !NO_DAMAGE_COMBAT.has(id) && (hasDamageScale(c) || atk > 100 || ATK100_DAMAGE.has(id))
  const ownerText = (owner?.id ? textByOpId.get(owner.id) : null) ?? ''
  // 数量表述优先在**点名了这个召唤物**的技能段里找（维什戴尔 S3「召唤2个魂灵之影（最多存在3个）」）；
  // 找不到再退到全文本（天赋里的"最多同时部署N个"是干员级总上限，不作为单体倍数 —— 见上方注释③）
  const skillText = (owner?.id ? skillTextByOpId.get(owner.id) : null) ?? ''
  const named = skillText.includes(c.name ?? '\u0000')
  const conc = concurrencyFor(named ? skillText : ownerText, c.name)
  const skillRef = owner?.id ? skillRefFor(chars[owner.id], c.name) : null
  summons.push({
    id,
    name: c.name ?? null,
    owner: owner?.name ?? null,
    link: how,
    combat,
    device: placeholder,
    dealsDamage,
    kind: !combat ? 'device' : dealsDamage ? 'damage' : 'support',
    atk,
    interval: d.baseAttackTime ?? null,
    blockCnt: d.blockCnt ?? 0,
    maxHp: d.maxHp ?? 0,
    def: d.def ?? 0,
    res: d.magicResistance ?? 0,
    cost: d.cost ?? null,
    // 同时存在数：只采信"点名了这个召唤物"的数量表述，否则 1（报告须转述这是下限假设）
    concurrency: conc.value,
    concurrencyConfidence: conc.confidence,
    concurrencyQuote: conc.quote,
    skillIndex: skillRef,
    // 限时寿命：黑匣子优先（夕），否则用语义层的文本事实（鸿雪 25s / 温蒂 20s）；按 owner+name 关联
    ...(() => {
      const bbDur = durationOf(owner?.id ? chars[owner.id] : null)
      const semDur = owner ? semantics[`${owner.name}|${c.name}`]?.durationSec ?? null : null
      return { durationSec: bbDur ?? semDur, durationSource: bbDur ? 'blackboard' : semDur ? 'text' : null }
    })(),
    skillIds: (c.skills ?? []).map((s) => s.skillId),
    // 自身技能里可建模的伤害改量（攻击力倍率 / 攻击间隔）、未能建模的条数、一次性触发伤害
    ownSkill: ownSkillMods(c),
  })
}

const combat = summons.filter((s) => s.combat)
const damage = summons.filter((s) => s.dealsDamage)
const payload = {
  builtAt: new Date().toISOString().slice(0, 10),
  source: 'ArknightsGameData(zh_CN) character_table.json (profession=TOKEN)',
  notes: [
    '召唤物本体在 character_table 的 TOKEN 职业下；token_table.json 不是召唤物名录（只有 trap_* 地图装置）',
    'owner 关联：一级按 id 代号段匹配，二级按"干员 blackboard 中出现的 token id"交叉印证；仍未关联的见 link=null',
    'combat=false 且 device=true 的是装置/工具（占位面板 atk100/间隔1/生命100），不计 DPS',
    'dealsDamage：① 自身技能有 >1 的 atk_scale ② atk>100 ③ 人工核对的 atk100 例外；kind = damage|support|device',
    '⚠ 无伤害的"战斗召唤物"（如赫默医疗探机=治疗无人机、巫恋诅咒娃娃=减攻减防图腾）kind=support，不计 DPS',
    'concurrency：只认「最多同时部署N个 / 最多存在N个 / 最多可部署N个」；天赋 cnt 是总数不是同时数，不可用',
    '召唤物自身技能（skillIds）未建模，仅记录 —— 已知会改变伤害的有弦惊/逍遥/打字机/机械水獭/虚影等',
  ],
  stats: {
    total: summons.length,
    combat: combat.length,
    damage: damage.length,
    support: combat.length - damage.length,
    linkedByCode, linkedByRef, unlinked,
  },
  summons,
}
await writeFile(OUT, JSON.stringify(payload, null, 1), 'utf8')
console.log(`✅ 写入 ${OUT}`)

// ---- 召唤物自身技能表（供 §23 范围/索敌/目标数解析；只收 TOKEN 实际引用的技能）----
const tokenSkillIds = []
for (const [id, c] of Object.entries(chars)) {
  if (c.profession !== 'TOKEN') continue
  for (const s of c.skills ?? []) if (s.skillId && skills[s.skillId]) tokenSkillIds.push(s.skillId)
}
const skillSubset = {}
for (const sid of new Set(tokenSkillIds)) skillSubset[sid] = skills[sid]
await writeFile(
  'E:/github/arknights-strength-agent/data/summon-skills.json',
  JSON.stringify({
    builtAt: new Date().toISOString().slice(0, 10),
    source: 'ArknightsGameData(zh_CN) skill_table.json（只含 TOKEN 职业引用的技能）',
    notes: [
      '召唤物自身技能表（§18 伤害改量 / §19 触发伤害 / §23 范围与目标数都从这里取）',
      '与 data/summons.json 的 skillIds 对应',
    ],
    skills: skillSubset,
  }, null, 1),
  'utf8',
)
console.log(`✅ 写入 data/summon-skills.json（${Object.keys(skillSubset).length} 个召唤物技能）`)

console.log(`   召唤物 ${summons.length} 条：战斗型 ${combat.length}（伤害型 ${damage.length} / 功能型 ${combat.length - damage.length}）· 代号段关联 ${linkedByCode} · 引用印证 ${linkedByRef} · 未关联 ${unlinked}`)
console.log('\n   伤害型召唤物（按 atk 排序，前 18）：')
for (const s of [...damage].sort((a, b) => b.atk - a.atk).slice(0, 18)) {
  console.log(`     ${String(s.owner ?? '??').padEnd(9)} ${String(s.name).padEnd(14)} atk=${String(s.atk).padStart(5)} 间隔=${String(s.interval).padStart(4)} 阻挡=${s.blockCnt} 同时=${s.concurrency}${s.concurrencyConfidence === 'default' ? '(假设)' : ''}${s.durationSec ? ` 限时${s.durationSec}s` : ''}`)
}
console.log('\n   不计 DPS 的功能型召唤物（无伤害）：')
for (const s of summons.filter((x) => x.kind === 'support')) console.log(`     ${String(s.owner ?? '??').padEnd(9)} ${String(s.name).padEnd(14)} atk=${s.atk}`)
console.log('\n   未关联的召唤物：')
for (const s of summons.filter((x) => !x.owner)) console.log(`     ${s.id.padEnd(32)} ${s.name} atk=${s.atk}`)
