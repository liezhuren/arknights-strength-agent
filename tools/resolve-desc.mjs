// tools/resolve-desc.mjs —— 把技能描述里的 `{key:fmt}` 占位符替换成 blackboard 的真实数值
//
// 为什么需要：游戏数据里描述是模板，形如
//   「造成相当于攻击力{attack@atk_scale:0%}的物理伤害」
// 真实数值 2.35 存在 blackboard 里。模型只看模板会以为"倍率未给出"，
// 于是给不出数或乱猜 —— 实测 judge 因此一直报"关键倍率均为占位符"。
//
// 支持格式：`{k:0%}` → 235% · `{k:0.0%}` → 235.0% · `{k:0}` → 2 · `{k}` → 2.35
// 无对应键时**保留原占位符**（宁可留痕迹，也不要显示成空或 NaN）。

export function resolvePlaceholders(desc, bb = {}) {
  const src = String(desc ?? '')
  return src.replace(/\{([^}:]+)(?::([^}]*))?\}/g, (whole, key, fmt) => {
    const v = bb[key]
    if (v === undefined || v === null) return whole
    if (typeof v !== 'number') return String(v)
    if (fmt && fmt.includes('%')) {
      const dec = (fmt.match(/\.(\d+)/) ?? [, '0'])[1]
      return `${(v * 100).toFixed(Number(dec))}%`
    }
    if (fmt && /^0(\.0+)?$/.test(fmt)) {
      const dec = (fmt.match(/\.(\d+)/) ?? [, '0'])[1]
      return v.toFixed(Number(dec))
    }
    return String(v)
  })
}

/** 返回 { text, unresolved } —— unresolved 列出没能在 blackboard 找到的键（便于审计） */
export function resolveWithAudit(desc, bb = {}) {
  const unresolved = []
  const text = resolvePlaceholders(desc, bb)
  const re = /\{([^}:]+)(?::[^}]*)?\}/g
  let m
  while ((m = re.exec(text))) unresolved.push(m[1])
  return { text, unresolved }
}
