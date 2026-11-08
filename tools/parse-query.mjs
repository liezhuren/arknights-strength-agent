// tools/parse-query.mjs —— 把自然语言对比/评测请求解析成 [{name, skillIndex}]
//
// 支持的写法（实测常见）：
//   评测赤刃明霄陈三技能和克莱门莎二技能
//   赤刃明霄陈S3、克莱门莎S2
//   赤刃明霄陈 3技能 / 克莱门莎2
//   银灰, 史尔特尔（不带技能 → 默认 S3）
//
// 设计：**规则优先**。这类输入形式有限，规则又快又不花钱；
// 只有一条都没解析出来时才建议上层走模型兜底（不在本模块内调用模型）。

const CN_NUM = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5 }

/** 把紧跟在干员名后面的技能说明解析成 0-based 技能下标；解析不到返回 null */
function skillAfter(rest) {
  // 只看名字后面很短的一小段，避免把后面别的干员的数字吃进来
  const head = rest.slice(0, 12)
  let m
  // 三技能 / 第三个技能 / 技能三
  if ((m = /^\s*(?:的)?\s*第?\s*([一二三四五六])\s*(?:个)?\s*技能/.exec(head))) return { idx: CN_NUM[m[1]], len: m[0].length }
  if ((m = /^\s*(?:的)?\s*技能\s*([一二三四五六])/.exec(head))) return { idx: CN_NUM[m[1]], len: m[0].length }
  // S3 / s2
  if ((m = /^\s*[Ss]\s*([1-6])/.exec(head))) return { idx: Number(m[1]) - 1, len: m[0].length }
  // 3技能 / 2 技能
  if ((m = /^\s*([1-6])\s*(?:号|个)?\s*技能/.exec(head))) return { idx: Number(m[1]) - 1, len: m[0].length }
  // 单独一个数字（如"克莱门莎2"）—— 仅在紧跟名字且后面是分隔/结尾时认
  if ((m = /^\s*([1-6])(?=\s*(?:$|[、,，和与+＋]|\s))/ .exec(head))) return { idx: Number(m[1]) - 1, len: m[0].length }
  return null
}

/**
 * @param {string} text 用户输入
 * @param {string[]} knownNames 全库干员名（用于最长匹配）
 * @param {{ defaultSkillIndex?: number }} [opts]
 * @returns {{ entries: {name:string, skillIndex:number, raw:string}[], unmatched: string[] }}
 */
export function parseCompareQuery(text, knownNames, opts = {}) {
  const def = opts.defaultSkillIndex ?? 2
  const s = String(text ?? '')
  const names = [...new Set(knownNames)].filter(Boolean).sort((a, b) => b.length - a.length)

  // 找出文本里出现的所有干员名（最长优先，避免"能天使"吃掉"新约能天使"）
  const hits = []
  let i = 0
  const consumed = new Array(s.length).fill(false)
  while (i < s.length) {
    let matched = null
    for (const n of names) {
      if (s.startsWith(n, i)) { matched = n; break }
    }
    if (matched) {
      hits.push({ name: matched, at: i })
      for (let k = i; k < i + matched.length; k++) consumed[k] = true
      i += matched.length
    } else i++
  }

  const entries = []
  for (let h = 0; h < hits.length; h++) {
    const { name, at } = hits[h]
    const restStart = at + name.length
    const restEnd = h + 1 < hits.length ? hits[h + 1].at : s.length
    const rest = s.slice(restStart, restEnd)
    const sk = skillAfter(rest)
    entries.push({ name, skillIndex: sk ? sk.idx : def, raw: s.slice(at, restStart + (sk?.len ?? 0)).trim() })
  }

  // 没匹配到任何干员名 → 把疑似名字的片段交回去，供上层决定是否走模型
  const unmatched = []
  if (!entries.length) {
    for (const piece of s.split(/[、,，和与+＋\s]+/).map((x) => x.trim()).filter(Boolean)) {
      unmatched.push(piece)
    }
  }
  return { entries, unmatched }
}

/** 校验解析结果里有没有不存在的干员（由调用方提供查找函数） */
export function validateEntries(entries, exists) {
  const ok = []
  const missing = []
  for (const e of entries) {
    if (exists(e.name)) ok.push(e)
    else missing.push(e.name)
  }
  return { ok, missing }
}
