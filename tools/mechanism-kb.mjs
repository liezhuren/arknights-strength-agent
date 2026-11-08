// tools/mechanism-kb.mjs —— 机制字段语义知识库（喂给解析层，避免模型猜单位与语义）
//
// 为什么需要它：blackboard 的键名不统一、语义不自明。同样是"倍率"，`atk` 是**加算**
// （0.13 = 攻击力 +13%），`atk_scale` 是**乘算**（1.6 = 160% 攻击力）；`attack_speed=70`
// 表示攻速 +70（间隔 = base/(1+70/100)），`base_attack_time=-0.7` 却是秒差。
// 模型不查表就会猜，猜错方向就会把 DPS 算错一倍以上。
//
// 结构：
//   ① KEY_RULES  —— 按**命名模式**匹配（覆盖 1044 个键的长尾，如 `*_atk_scale`）
//   ② KEY_ENTRIES —— 高频键的精确说明
//   ③ renderKbBlock(keys) —— 只渲染"本次实际出现的键"对应的条目（控制提示词体积）
//
// 约定：`unit` 用中文描述单位；`sem` 用一句话说明**怎么进入计算**。

/** ① 命名模式规则：正则匹配键名，越具体的放越前面 */
export const KEY_RULES = [
  // ── 攻击/伤害倍率（最容易搞错的一族）──────────────────────────
  { re: /^atk$/, name: 'atk', unit: '百分比小数', sem: '攻击力**加算**：0.13 = 攻击力 +13%（不是 ×0.13）', examples: ['0.13 → +13%', '1.4 → +140%'] },
  { re: /(^|[@_])atk_scale(_\d+)?$/, name: '*atk_scale', unit: '倍率', sem: '伤害**乘算**倍率：1.6 = 每次攻击造成 160% 攻击力', examples: ['2.5 → 250% 攻击力'] },
  { re: /^max_atk_scale$/, name: 'max_atk_scale', unit: '倍率', sem: '伤害倍率的上限值（叠层/蓄力的封顶）' },
  { re: /^damage_scale$/, name: 'damage_scale', unit: '倍率', sem: '伤害**乘算**倍率（与 atk_scale 同族）' },
  { re: /(^|@)times$/, name: 'times', unit: '段数', sem: '多段攻击的段数（伤害要乘上去）' },
  { re: /^atk_scale_fake$|^atk_scale_2$/, name: '*atk_scale_N', unit: '倍率', sem: '第二套/备用的伤害倍率（通常对应"暴击/特殊分支"）' },

  // ── 攻速与间隔 ─────────────────────────────────────────────
  { re: /^attack_speed$/, name: 'attack_speed', unit: '攻速加成（数值）', sem: '攻速 +N：实际间隔 = 基础间隔 / (1 + N/100)；N=70 → 间隔 ÷1.7', examples: ['70 → 间隔 ×0.588'] },
  { re: /^base_attack_time$/, name: 'base_attack_time', unit: '秒（秒差）', sem: '攻击间隔**秒差**：负值缩短（-0.7 → 间隔 -0.7s）', examples: ['-0.7 → 1.3s 变 0.6s'] },
  { re: /interval$/, name: '*interval', unit: '秒', sem: '时间间隔（秒）；注意是否与"技能持续"同名不同义' },
  { re: /^duration$/, name: 'duration', unit: '秒', sem: '持续时间（负值/0 通常表示永续或由其他条件结束）' },
  { re: /^ct$/, name: 'ct', unit: '秒', sem: '冷却时间' },

  // ── 元素损伤体系 ───────────────────────────────────────────
  { re: /^ep_damage_ratio$|(^|@)ep_damage_ratio(_\w+)?$/, name: 'ep_damage_ratio', unit: '百分比小数', sem: '造成伤害的 X% 转化为**元素损伤累积**（不是直接伤害）', examples: ['0.13 → 每击附带 13% 的损伤累积'] },
  { re: /^ep_damage_scale$/, name: 'ep_damage_scale', unit: '倍率', sem: '**元素伤害**的乘算倍率（元素伤害无视 DEF/RES）' },
  { re: /^ep_heal_scale$/, name: 'ep_heal_scale', unit: '倍率', sem: '元素相关治疗倍率' },
  { re: /^element_atk_scale$/, name: 'element_atk_scale', unit: '倍率', sem: '元素伤害倍率（同 ep_damage_scale 族）' },
  { re: /^ep_break_duration$/, name: 'ep_break_duration', unit: '秒', sem: '元素爆发后的持续/异常时长' },

  // ── 弹药体系 ───────────────────────────────────────────────
  { re: /^trigger_time$|(^|@)trigger_time$/, name: '*trigger_time', unit: '发', sem: '**弹药总数**；技能在弹药耗尽时结束（不是按持续时间）', examples: ['10 → 共 10 发'] },
  { re: /^addtional_ammo_each$/, name: 'addtional_ammo_each', unit: '发', sem: '额外获得的弹药数（条件满足时加在总量上）' },
  { re: /^recover_each_cnt$/, name: 'recover_each_cnt', unit: '发', sem: '每次恢复/获得的弹药数' },

  // ── 概率与条件 ─────────────────────────────────────────────
  { re: /(^|@)prob(_\w+)?$/, name: '*prob', unit: '0~1', sem: '触发概率；期望伤害 = 概率 × 触发时伤害 + (1-概率) × 常态伤害' },
  { re: /^one_minus_status_resistance$/, name: 'one_minus_status_resistance', unit: '0~1', sem: '（1 - 状态抗性），用于计算异常状态实际生效比例' },

  // ── 属性面板 ───────────────────────────────────────────────
  { re: /^def$/, name: 'def', unit: '点数/百分比', sem: '防御力（数值 = 点数；小数且描述带% = 百分比）' },
  { re: /^magic_resistance$/, name: 'magic_resistance', unit: '点数', sem: '法术抗性（0~100，按百分比减伤）' },
  { re: /^max_hp$/, name: 'max_hp', unit: '点数', sem: '最大生命值' },
  { re: /^hp_ratio$|^attack@hp_ratio$/, name: 'hp_ratio', unit: '百分比小数', sem: '按最大生命的比例（消耗/治疗/屏障）' },
  { re: /^hp_recovery_per_sec/, name: 'hp_recovery_per_sec*', unit: 'HP/秒', sem: '每秒自回生命；带 `_by_max_hp_ratio` 表示按最大生命的比例回' },
  { re: /^sp_recovery_per_sec$/, name: 'sp_recovery_per_sec', unit: 'SP/秒', sem: 'SP 自然回复速率（方舟通常 1/s）' },
  { re: /^sp$/, name: 'sp', unit: 'SP', sem: '技力值（回复/消耗）' },
  { re: /^cost$/, name: 'cost', unit: '费用', sem: '部署费用' },
  { re: /^block_cnt$/, name: 'block_cnt', unit: '个数', sem: '阻挡数' },
  { re: /^respawn_time$/, name: 'respawn_time', unit: '秒', sem: '再部署时间' },
  { re: /^taunt_level$/, name: 'taunt_level', unit: '等级', sem: '嘲讽等级（越高越容易被敌人优先攻击）' },
  { re: /^move_speed$|@move_speed$/, name: '*move_speed', unit: '百分比小数', sem: '移动速度变化（负值 = 减速）' },

  // ── 减伤/护盾/生存 ─────────────────────────────────────────
  { re: /^damage_resistance$/, name: 'damage_resistance', unit: '0~1', sem: '受到的伤害降低比例（0.35 = 减伤 35%）' },
  { re: /^shield_/, name: 'shield_*', unit: '比例/秒', sem: '屏障相关（多为最大生命的比例、持续与衰减）' },
  { re: /^damage_remaining_scale$/, name: 'damage_remaining_scale', unit: '倍率', sem: '剩余伤害的折算比例' },

  // ── 控制 ───────────────────────────────────────────────────
  { re: /(^|@)stun$/, name: '*stun', unit: '秒', sem: '眩晕时长（硬控）' },
  { re: /(^|@)sluggish$/, name: '*sluggish', unit: '0~1', sem: '停顿：目标攻击间隔被延长，值 = 停顿强度' },
  { re: /^force$/, name: 'force', unit: '等级', sem: '位移力度（推力/拉力等级）' },

  // ── 数量/范围/其他 ─────────────────────────────────────────
  { re: /^cnt$|@cnt$/, name: '*cnt', unit: '个数', sem: '数量（陷阱数/召唤数/目标数等，看描述）' },
  { re: /(^|@)max_target$/, name: '*max_target', unit: '个', sem: '同时攻击/作用的目标数' },
  { re: /^max_stack_cnt$/, name: 'max_stack_cnt', unit: '层', sem: '最大叠层数（叠满口径需注明）' },
  { re: /^talent_scale$/, name: 'talent_scale', unit: '倍率', sem: '对**天赋效果**的放大倍率（不是直接伤害）' },
  { re: /^range_radius$|^projectile_range$/, name: 'range_radius/projectile_range', unit: '格', sem: '范围半径 / 弹道射程（空间量，不是伤害）' },
  { re: /^ability_range_forward_extend$/, name: 'ability_range_forward_extend', unit: '格', sem: '射程向前延伸格数' },
  { re: /^def_penetrate(_fixed)?$/, name: 'def_penetrate*', unit: '百分比/点数', sem: '无视防御（百分比或固定点数）' },
  { re: /^value$/, name: 'value', unit: '看描述', sem: '通用数值槽：单位由描述决定，**必须结合原文判断**' },
  { re: /^scale$/, name: 'scale', unit: '倍率', sem: '通用倍率槽（含义看原文）' },

  // ── 长尾兜底：干员专属前缀 + 通用后缀（如 `jnight_t.taunt_level`、`attack@bomb_scale`）──
  { re: /(^|[@_.])scale$/, name: '*_scale', unit: '倍率', sem: '通用倍率槽（多与伤害/效果相关，按后缀判断）' },
  { re: /(^|[@_.])ratio$/, name: '*_ratio', unit: '比例小数', sem: '通用比例槽（常为按最大生命/按伤害的折算）' },
  { re: /(^|[@_.])prob\d*$/, name: '*prob*', unit: '0~1', sem: '触发概率（带数字后缀的是多段/多变体概率）' },
  { re: /(^|[@_.])stun/, name: '*stun*', unit: '秒', sem: '眩晕时长（含 *_stun_duration / *_stun_anim_duration 等变体）' },
  { re: /(^|[@_.])(fear|sleep|bind|frozen|freeze|levitate|silence|disarm)/, name: '*fear/sleep/bind…', unit: '秒', sem: '异常状态时长（恐惧/睡眠/束缚/冻结/浮空/沉默/缴械）' },
  { re: /(^|[@_.])weak/, name: '*weak*', unit: '0~1', sem: '虚弱：目标造成的伤害降低' },
  { re: /(^|[@_.])(shield|barrier)/, name: '*shield*', unit: '比例/点数', sem: '护盾/屏障（多为最大生命的比例或固定点数）' },
  { re: /(^|[@_.])cost$/, name: '*cost', unit: '费用', sem: '费用相关（正负决定增减）' },
  { re: /(^|[@_.])(atk_to_hp_recovery_ratio)$/, name: '*atk_to_hp_recovery_ratio', unit: '百分比小数', sem: '造成伤害的 X% 转化为自身生命回复' },
  // ── 带前缀的同名键（`attack@atk` / `attack@duration` / `max_cnt` / `attack@range_radius`…）──
  { re: /(^|[@_.])atk$/, name: '*atk', unit: '百分比小数', sem: '攻击力**加算**百分比（带前缀仍是加算语义）' },
  { re: /(^|[@_.])def$/, name: '*def', unit: '点数/百分比', sem: '防御力（数值或百分比）' },
  { re: /(^|[@_.])duration$/, name: '*duration', unit: '秒', sem: '持续/冷却时长' },
  { re: /(^|[@_.])cnt$/, name: '*cnt', unit: '个数', sem: '数量（触发次数/目标数/产出数）' },
  { re: /(^|[@_.])value$/, name: '*value', unit: '看描述', sem: '通用数值槽（单位由描述决定）' },
  { re: /(^|[@_.])time$/, name: '*time', unit: '秒/次', sem: '时间或次数（看描述）' },
  { re: /(^|[@_.])range_radius$/, name: '*range_radius', unit: '格', sem: '范围半径' },
  { re: /(^|[@_.])attack_speed$/, name: '*attack_speed', unit: '攻速加成', sem: '攻速 +N（间隔 = base/(1+N/100)）' },
  { re: /(^|[@_.])atk_scale(_\w+)?$/, name: '*atk_scale*', unit: '倍率', sem: '伤害**乘算**倍率（含 _boom 等变体）' },
  { re: /debuff/, name: '*debuff', unit: '—', sem: '减益标记：该字段描述的是施加给敌方的负面效果' },
]

/** ② 高频键的精确说明（优先级高于模式规则） */
export const KEY_ENTRIES = {
  heal_scale: { unit: '倍率', sem: '治疗量 = 攻击力 × 该倍率' },
  'attack@heal_scale': { unit: '倍率', sem: '每次攻击附带治疗 = 攻击力 × 该倍率' },
  'attack@atk_to_hp_recovery_ratio': { unit: '百分比小数', sem: '造成伤害的 X% 转化为自身生命回复' },
  'attack@times': { unit: '段数', sem: '每次攻击的段数（多段攻击）' },
  'audio_trigger_cnt': { unit: '次数', sem: '触发次数（表现/音效相关，通常不影响数值）' },
}

/**
 * 查一个键的语义：先精确条目，再模式规则。
 * @returns {{name:string, unit:string, sem:string, examples?:string[], exact?:boolean}|null}
 */
export function lookupKey(key) {
  if (KEY_ENTRIES[key]) return { name: key, ...KEY_ENTRIES[key], exact: true }
  for (const r of KEY_RULES) if (r.re.test(key)) return { name: key, unit: r.unit, sem: r.sem, examples: r.examples, exact: r.name === key }
  // 干员专属前缀兜底：`jnight_t.taunt_level` → 用最后一段 `taunt_level` 再查一次
  const tail = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : null
  if (tail) for (const r of KEY_RULES) if (r.re.test(tail)) return { name: key, unit: r.unit, sem: `${r.sem}（键名带干员前缀，取末段 ${tail} 的语义）`, examples: r.examples }
  return null
}

/** 覆盖率统计（用于衡量知识库能解释多少键） */
export function kbCoverage(keys) {
  let hit = 0
  const miss = []
  for (const k of keys) {
    if (lookupKey(k)) hit++
    else miss.push(k)
  }
  return { total: keys.length, hit, miss }
}

/**
 * 渲染给模型看的参考块：只列"本次实际出现的键"，控制提示词体积。
 * @param {string[]} keys 本次 blackboard 里出现的键
 */
export function renderKbBlock(keys) {
  const seen = new Set()
  const lines = []
  for (const k of keys) {
    const info = lookupKey(k)
    if (!info || seen.has(info.name)) continue
    seen.add(info.name)
    lines.push(`- ${info.name}：${info.unit}｜${info.sem}${info.examples ? `（例：${info.examples.join('；')}）` : ''}`)
  }
  return lines.length ? lines.join('\n') : ''
}

/** 全量知识（审计/文档用） */
export function kbAll() {
  return KEY_RULES.map((r) => ({ name: r.name, unit: r.unit, sem: r.sem, pattern: r.re.source }))
}
