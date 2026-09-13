// tools/section.mjs —— 栏位文本的"双形态"切分（2026 新增）
//
// 背景（用户反馈）：各栏的 `formatXxxSection()` 产出的是**同一份字符串**，同时喂给：
//   ① 终端报告（给 agent / 开发者看，含口径旁白）；② 网页评测面板（给用户看）。
// 于是用户界面上出现了一堆**不是给用户看的**内容：
//   · 标题里塞的元信息：`【泛用性】（关键点之一：换场景还强不强；可用线 = 全库 433 名干员分布）`
//   · 结尾的旁白块：`说明：可用线来自全库干员主力技能输出分布…`、`需 agent 判断…`
// 这些东西对 **LLM/agent 是必要的**（它要靠这些口径判断），但对用户是噪音。
//
// 解法：把一份文本切成两半 ——
//   · `content` = 展示用（标题行的括号说明剥掉，结尾旁白剥掉）→ 网页渲染这个
//   · `notes`   = 旁白（原样保留）→ 只给 agent / 终端用
// 原文（含旁白与元信息）不动，所以终端报告与 agent 拿到的信息**零损失**。
//
// 切分规则依赖各 `formatXxxSection` 的稳定形状：首行标题 + 中间内容 + 结尾 1~5 行旁白块。

/** 旁白块的起始标记（各栏统一用「说明：」，生存栏的续行靠缩进判定） */
const NOTE_START = /^\s*(?:说明|注)：/

/**
 * 把一栏文本切成 { title, content, notes }。
 * @param {string|null} text - formatXxxSection 的产物
 * @returns {{title:string, content:string[], notes:string[]}|null}
 */
export function splitSection(text) {
  if (!text) return null
  const lines = String(text).split('\n')
  // ① 标题行：剥掉外层的【…】与行尾的（…）元信息（可能有多层括号，如【泛用性】（关键点之一：…））
  let title = lines[0].trim()
  title = title.replace(/^【\s*/, '').replace(/\s*】\s*$/, '')
  for (let i = 0; i < 3; i++) {
    const next = title.replace(/（[^（）]*）\s*$/, '').trim()
    if (next === title) break
    title = next
  }
  title = title.replace(/[】）]\s*$/, '').trim()
  let rest = lines.slice(1)
  // ② 结尾旁白块：从最后一个「说明：」起，连同其后缩进更深的续行
  let cut = -1
  for (let i = rest.length - 1; i >= 0; i--) {
    if (NOTE_START.test(rest[i])) { cut = i; break }
  }
  let notes = []
  if (cut >= 0) {
    notes = rest.slice(cut)
    rest = rest.slice(0, cut)
  }
  // ③ 去掉内容尾部的空行
  while (rest.length && !rest[rest.length - 1].trim()) rest.pop()
  return { title, content: rest, notes }
}

/** 批量切分：{ key: text } → { key: { title, content, notes } } */
export function splitSections(map) {
  const out = {}
  for (const [k, v] of Object.entries(map)) {
    const s = splitSection(v)
    if (s) out[k] = s
  }
  return out
}
