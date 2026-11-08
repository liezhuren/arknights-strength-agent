// app/server/llm.mjs —— BYOK 多 provider 模型接入（零依赖，用内置 fetch）
//
// 定位：模型只负责**规则层覆盖不到的长尾机制**（读技能/天赋描述 → 产出结构化机制补丁），
// 以及自然语言评注。**未配置模型时全部功能仍可用**（规则层已覆盖高频机制）——这是硬约束。
//
// 协议适配：OpenAI 兼容（DeepSeek / OpenAI / 本地 Ollama / vLLM 等）+ Anthropic Messages。
import fs from 'node:fs'
import path from 'node:path'
import { renderKbBlock, lookupTerms, renderKbIndex } from '../../tools/mechanism-kb.mjs'

const CONFIG = path.resolve(import.meta.dirname, '../config.json')
export const readConfig = () => {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } catch { return { provider: '', providers: {} } }
}

/** 当前启用的 provider（未配置则 null）。 */
export function activeProvider() {
  const c = readConfig()
  if (!c.provider) return null
  const p = c.providers?.[c.provider]
  if (!p) return null
  return { id: c.provider, ...p, kind: c.provider === 'anthropic' ? 'anthropic' : 'openai' }
}

/**
 * 统一的对话调用。
 * @param {{system?:string, user:string, json?:boolean, maxTokens?:number, timeoutMs?:number}} req
 * @returns {Promise<{ok:boolean, text?:string, error?:string, provider?:string, model?:string, ms?:number}>}
 */
export async function chat({ system, user, json = false, maxTokens = 2048, timeoutMs = 60000 }) {
  const p = activeProvider()
  if (!p) return { ok: false, error: '未启用模型（设置 → 选择 provider 并填 API Key）；规则层不受影响', disabled: true }
  const t0 = Date.now()
  const url = p.kind === 'anthropic' ? `${p.baseURL}/messages` : `${p.baseURL}/chat/completions`
  const headers = { 'content-type': 'application/json' }
  let body
  if (p.kind === 'anthropic') {
    headers['x-api-key'] = p.apiKey ?? ''
    headers['anthropic-version'] = '2023-06-01'
    body = { model: p.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }
  } else {
    if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`
    body = {
      model: p.model, max_tokens: maxTokens, temperature: 0.2,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }
  }
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    const txt = await r.text()
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}：${txt.slice(0, 300)}`, provider: p.id, model: p.model }
    const j = JSON.parse(txt)
    const text = p.kind === 'anthropic'
      ? (j.content ?? []).map((c) => c.text ?? '').join('')
      : j.choices?.[0]?.message?.content ?? ''
    // 推理过程（DeepSeek/部分 OpenAI 兼容提供方会把思维链单独放在 reasoning_content）
    // 拿它只为"给人看"，不参与解析 —— 解析只用 content 里的 JSON。
    const reasoning = p.kind === 'anthropic'
      ? (j.content ?? []).filter((c) => c.type === 'thinking').map((c) => c.thinking ?? '').join('')
      : (j.choices?.[0]?.message?.reasoning_content ?? j.choices?.[0]?.message?.reasoning ?? '')
    return { ok: true, text, reasoning: reasoning || null, provider: p.id, model: p.model, ms: Date.now() - t0, usage: j.usage ?? null }
  } catch (e) {
    return { ok: false, error: `调用失败：${e.message}`, provider: p.id, model: p.model }
  }
}

/** 从模型输出里抠出 JSON（容忍 ```json 围栏与前后废话）。 */
export function extractJson(text) {
  if (!text) return null
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fence ? fence[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) } catch { return null }
}

const SYSTEM = `你是《明日方舟》机制解析器。任务：把**技能描述 + 天赋描述 + 分支特性**翻译成
结构化参数，供数值引擎直接计算。**必须填表，禁止回答"无需补丁"** —— 引擎只认你填出来的字段，
你留空就等于该机制不计入。

输出严格 JSON（不要解释、不要 markdown）：

{
  "form": "稳态持续|单次窗口爆发|陷阱触发|下次攻击强化|元素累积|引导或召唤通道|纯增益",
  "patches": {
    "talents": [
      {
        "name": "天赋名（原文）",
        "kind": "numeric|conditional|element|mechanic",
        "stat": "atk|aspd|def|hp|res|none",
        "value": 0.13,
        "condition": "触发条件（原文片段；无条件填 null）",
        "element": { "type": "灼燃|凋亡|侵蚀|神经", "ratio": 0.13, "trigger": "造成法术伤害时" },
        "evidence": "原文片段（必须逐字来自输入，≥4 字）"
      }
    ],
    "skill": {
      "damageType": "physical|magical|true|element",
      "attackMult": 1.4,
      "hits": 1,
      "targets": 1,
      "noAttack": true,
      "channel": {
        "kind": "summon_wave|trap|burst|dot|retaliation|none",
        "intervalSec": 2.67,
        "atkScale": 2.5,
        "repeatScale": 0.15,
        "lanes": 5,
        "evidence": "原文片段"
      }
    },
    "element": { "type": "灼燃", "perHitRatio": 0.13, "burstDamage": null, "evidence": "原文片段" }
  },
  "confidence": "high|medium|low",
  "reasoning": "一句话说明依据（引用原文关键词）"
}

硬性规则：
0. **不确定就来查（建议，非强制）**：输入末尾的【可查询术语】只覆盖常见术语，**并不完整**。
   如果描述里有你**没把握**的游戏术语（例如"沉睡""脆弱""缴械""庇护"这类），
   可以先只输出 {"needLookup": ["术语1", "术语2"]}（**不要带 patches**）来问，
   我会把知识库解释发给你，然后你再正式填表。最多问两轮。
   有把握就直接填；拿不准的字段标 confidence=low 并在 reasoning 里说明原因。
   —— 输入里出现【用户反馈：上一次生成有问题】时，**优先去查词典**、优先找描述里的权威依据，
   不要凭直觉再填一遍。
1. **skill.attackMult 专指「攻击力加成后的普攻倍率」，只从这两类键取**：
   · atk 键（加算）→ 填 **1 + 值**（atk=1.4 表示 +140% → 填 **2.4**）
   · atk_scale / attack@atk_scale 键（乘算）→ 填**键值本身**（2.35 → 填 2.35）
   **不要把其他倍率（如 *_atk_scale、heatwave_atk_scale、s3_atk_scale 这类
   专属命名的通道/额外伤害倍率）填进 attackMult** —— 它们应填到 skill.channel.atkScale。
2. **talents 一项都不能漏**：输入给几条天赋就输出几条（含数值型）。攻击力/防御/生命/攻速加成
   也要填（kind=numeric，stat 与 value 必填），引擎会用它们修正面板。
3. **skill.channel 必填**：即使规则层已能处理攻击力倍率，也必须说明伤害到底怎么落地
   （普通攻击 / 引导波 / 召唤物 / 陷阱 / 持续伤害）。没有额外通道就填 {"kind":"none"}。
3. 每个数字必须能从输入文本或 blackboard 推出；**推不出就填 null，不要猜**。
4. evidence 必须逐字摘自输入原文，用来人工核对；编造的 evidence 会被校验拒绝。
5. "附带 X% 元素损伤"属于 element（同时记进 talents 对应项）；有条件触发的天赋是 conditional。`

/**
 * 长尾机制解析：把技能/天赋原文交给模型产出结构化机制补丁。
 * @param {{operator:string, skillName:string, description:string, blackboard:object, trait?:string, talents?:string[]}} ctx
 */
/**
 * 构造发给模型的输入文本（**导出以便审计/测试**：想知道"模型到底看到了什么"时直接调它）。
 *
 * 刻意保持"原文 + 数值并列"的形态：
 *   · 技能原文：带 `{key:format}` 占位符的原始描述（占位符本身是格式说明，会暴露字段名）
 *   · blackboard：键值对，模型可据此把文本里的百分比与具体数值对上号
 *   · 分支特性 + 全部天赋：天赋是仅次于技能的解读来源，必须和技能一起给
 *
 * 不给的东西（避免模型瞎猜）：面板数值、其他技能、其他干员、任何评分先验。
 */
export function buildParseInput(ctx) {
  const talentLines = (ctx.talents ?? []).map((t, i) => `天赋${i + 1}：${t}`)
  // 字段语义参考：只渲染"本次实际出现的键"（由机制知识库解析），避免模型猜单位与加/乘算
  const kb = ctx.kbKeys?.length ? renderKbBlock(ctx.kbKeys) : ''
  return [
    `干员：${ctx.operator}`,
    `技能：${ctx.skillName}`,
    `技能原文：${ctx.description}`,
    // 数值代入版：解决"模型只看到 {attack@atk_scale:0%} 模板、以为倍率未给出"的问题
    ctx.resolvedDescription && ctx.resolvedDescription !== ctx.description
      ? `技能原文（数值已代入 blackboard）：${ctx.resolvedDescription}`
      : '',
    `blackboard：${JSON.stringify(ctx.blackboard)}`,
    ctx.trait ? `分支特性：${ctx.trait}` : '',
    ...talentLines,
    kb ? '' : '',
    kb ? '【字段语义参考】（本次出现的键；单位与语义以此为准，不要自行推测）' : '',
    kb,
    // 术语词典：模型遇到不懂的词可以主动来查（见 SYSTEM 的"先问再填"规则）
    ctx.kbIndex ? '【可查询术语】（遇到不确定的词，按 needLookup 协议来问）' : '',
    ctx.kbIndex ? ctx.kbIndex : '',
    ctx.lookupText ? '【你查询到的术语解释】' : '',
    ctx.lookupText ?? '',
    // 用户点"重新生成"：明确告知上一版不可靠，促使其查词典 / 找更权威依据
    ctx.regenerate
      ? '\n【用户反馈：上一次生成有问题】用户认为上一次解析结果不可靠，已要求重新生成。' +
        '请重新审视原文，优先用 needLookup 查证没把握的术语；' +
        '无法确认的字段标 confidence=low 并在 reasoning 里说明，不要沿用上一版的猜测。'
      : '',
  ].filter(Boolean).join('\n')
}

export async function parseMechanism(ctx) {
  const kbIndex = renderKbIndex()
  // ── "先问再填"协议 ──────────────────────────────────────────────────────
  // 用户要的形态：模型读完描述后，遇到不确定的**术语/键**可以先来查词典，
  // 查完再填表；而不是由我们预先猜它会用到哪些字段。
  // 约定：只输出 {"needLookup": [...]} 表示请求查询（不带 patches）；否则按正常 schema 填表。
  let lookupText = ''
  const lookedUp = []
  let r = null
  let parsed = null
  let lastText = ''

  for (let round = 0; round < 3; round++) {
    const user = buildParseInput({ ...ctx, kbIndex, lookupText })
    const ask = (sys) => chat({ system: sys, user, json: true, maxTokens: 6144 })
    // 模型偶发输出非法 JSON（截断/围栏/尾随逗号）→ 最多试 3 次，逐次收紧要求。
    // 实测同一干员两次调用结果不同，所以单次失败不能直接判死。
    const attempts = [
      SYSTEM,
      `${SYSTEM}\n\n上一次输出不是合法 JSON（可能被截断）。这次只输出唯一的 JSON 对象，不要解释、不要 markdown 围栏，evidence 尽量短。`,
      `${SYSTEM}\n\n严格只输出 JSON。若字段太多会导致截断，请把 evidence 压到 6-10 个字。`,
    ]
    parsed = null
    for (const sys of attempts) {
      r = await ask(sys)
      if (!r.ok) return { ok: false, error: r.error, disabled: !!r.disabled }
      lastText = r.text ?? ''
      parsed = extractJson(lastText)
      if (!parsed) {
        // 轻量修复：尾随逗号是这类长 JSON 最常见的语法错误
        const repaired = lastText.replace(/,\s*([}\]])/g, '$1')
        parsed = repaired !== lastText ? extractJson(repaired) : null
      }
      if (parsed) break
    }
    if (!parsed) return { ok: false, error: '模型输出无法解析为 JSON（已重试 3 次）', raw: lastText.slice(0, 800), provider: r.provider, model: r.model }

    // 查询请求：只带 needLookup、不带 patches → 查词典后重问
    if (Array.isArray(parsed.needLookup) && parsed.needLookup.length && !parsed.patches) {
      const defs = lookupTerms(parsed.needLookup)
      lookedUp.push(...parsed.needLookup.map(String))
      const block = defs.length ? defs.join('\n') : `（知识库中没有这些词条：${parsed.needLookup.join('、')}；请按原文语义自行判断并标注 confidence=low）`
      lookupText += `${lookupText ? '\n' : ''}${block}`
      if (round < 2) continue
    }
    break
  }

  // 证据校验：talents[].evidence / element.evidence 必须逐字出自输入文本。
  // 编造的证据直接标低置信并剔除，避免"看起来有依据"的假解析。
  const source = [ctx.description ?? '', ctx.trait ?? '', ...(ctx.talents ?? [])].join('\n')
  const norm = (s) => String(s ?? '').replace(/\s+/g, '')
  const srcNorm = norm(source)
  const patches = parsed.patches ?? {}
  const dropped = []
  if (Array.isArray(patches.talents)) {
    patches.talents = patches.talents.filter((t) => {
      const ev = norm(t?.evidence)
      if (!ev || ev.length < 4 || !srcNorm.includes(ev)) { dropped.push(t?.name ?? '(未知天赋)'); return false }
      return true
    })
  }
  if (patches.element?.evidence) {
    const ev = norm(patches.element.evidence)
    if (ev.length < 4 || !srcNorm.includes(ev)) { delete patches.element; dropped.push('element') }
  }

  return {
    ok: true, ...parsed, patches,
    provider: r.provider, model: r.model, ms: r.ms,
    // 模型主动查过哪些术语（"先问再填"协议的审计记录；空数组表示它没问就填了）
    lookedUp,
    ...(dropped.length ? { droppedEvidence: dropped } : {}),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 建议层（advisor）—— 模型不产出最终数字，只产出**可审计的参数建议**
//
// 定位：规则引擎算的是"结构化参数 → 确定性结果"，它不可能面面俱到；
// 模型的价值在于读懂机制、指出引擎没覆盖的部分。所以它的产出必须是：
//   · 落在**参数**上（不是"我觉得 DPS 应该是 5000"）
//   · 带 evidence（逐字原文）和 reason
//   · 能给出"应用后大概会变成多少"的预期，供人对账
// 四栏都可提建议：dps / survival（生存）/ teamBuff（团队增益）/ control（控制）。
// ════════════════════════════════════════════════════════════════════════════

const REVIEW_SYSTEM = `你是《明日方舟》数值模型的审阅者。用户给你：一名干员的技能/天赋原文、
当前引擎解析出的结构化参数、以及引擎算出的四栏结果。

你的任务：找出**引擎没覆盖或算错的地方**，输出参数级建议。严格 JSON，不要解释、不要 markdown：

{
  "suggestions": [
    {
      "column": "dps|survival|teamBuff|control",
      "field": "参数名（如 elementBalls / perBallAtkScale / talentAtkMult / damageReduce / teamBuffAtkPct / controlDurationSec）",
      "current": 当前值或 null,
      "suggested": 建议值,
      "reason": "为什么（一句话，指向机制）",
      "evidence": "原文片段（必须逐字来自输入，≥4 字）",
      "confidence": "high|medium|low",
      "expectedEffect": "应用后的预期影响（如「木桩口径 DPS 约 4683」）"
    }
  ],
  "verdict": "对当前结果的一句话总评（哪里可信、哪里不可信）",
  "modelEstimate": {
    "dps": 数字或 null,
    "survival": "自估结论或 null",
    "teamBuff": "自估结论或 null",
    "control": "自估结论或 null",
    "reasoning": "你是怎么估出来的（一句话）"
  },
  "confidence": "high|medium|low"
}

硬性规则：
1. **suggestions 只提参数**，不要在里面写最终 DPS 数字——数字由引擎算。
   你自己的估值请放在 modelEstimate（那是你的判断，会与引擎数值并列展示，标注来源）。
2. 每个建议必须有 evidence，逐字摘自输入的技能/天赋/特性原文；编造会被剔除。
3. 引擎已经算对的部分不要提建议（宁缺勿滥）。
4. 四栏都可以提：输出（通道/倍率/元素）、生存（减伤/闪避/自回/屏障）、
   团队增益（增益幅度与覆盖率）、控制（类型/时长/覆盖率）。
5. 不确定就标 confidence: "low"，不要猜。
6. **必须返回非空 JSON 对象**。若确实没有可提的，返回 {"suggestions":[],"verdict":"..."}。

输出示例（照抄结构，值换成对当前干员的判断）：
{"suggestions":[{"column":"dps","field":"elementBalls","current":null,"suggested":13,"reason":"灼燃爆发期间伤害改判元素","evidence":"若目标处于灼燃损伤爆发期间则改为造成元素伤害","confidence":"high","expectedEffect":"木桩口径 DPS 约 4683"}],"verdict":"通道参数基本正确，生存栏未建模","confidence":"medium"}`

/**
 * 审阅一次评测，产出参数级建议。
 * @param {object} ctx
 * @param {string} ctx.operator
 * @param {string} ctx.skillName
 * @param {string} ctx.description
 * @param {string[]} [ctx.talents]
 * @param {string} [ctx.trait]
 * @param {object} ctx.params      当前引擎使用的结构化参数（解析产物 + 通道参数）
 * @param {object} ctx.results     引擎算出的四栏结果摘要
 */
export async function reviewEvaluation(ctx) {
  const desc = ctx.resolvedDescription ?? ctx.description
  const user = [
    `干员：${ctx.operator}`,
    `技能：${ctx.skillName}`,
    `技能原文（数值已代入）：${desc}`,
    ctx.trait ? `分支特性：${ctx.trait}` : '',
    ...(ctx.talents ?? []).map((t, i) => `天赋${i + 1}：${t}`),
    '',
    '当前引擎参数：',
    JSON.stringify(ctx.params ?? {}, null, 2),
    '',
    '引擎结果（四栏）：',
    JSON.stringify(ctx.results ?? {}, null, 2),
    // 用户点"重新生成"：沿用上一次的问题，但要求更严谨地重审
    ctx.regenerate
      ? '\n【用户反馈：上一次生成有问题】用户不认可上一版审阅结果，要求重新生成。' +
        (ctx.previous
          ? `\n上一版你给出的内容（作为"不要重复同一错误"的参考）：\n${JSON.stringify(ctx.previous).slice(0, 1200)}`
          : '') +
        '\n这次请：① 先用原文逐句核对参数是否与描述一致；' +
        '② 不确定的术语优先查机制知识库（needLookup 协议）或明确标注 confidence=low；' +
        '③ 在 verdict 里说明这次与上一版的差异点。'
      : '',
  ].filter(Boolean).join('\n')

  const attempts = [
    { json: true, sys: REVIEW_SYSTEM },
    { json: false, sys: REVIEW_SYSTEM + '\n\n再次强调：只输出一个 JSON 对象，不要任何其他文字。' },
    { json: true, sys: REVIEW_SYSTEM + '\n\n上一轮输出为空。这次必须返回完整的 JSON，可以只给一条建议。' },
    { json: false, sys: REVIEW_SYSTEM },
  ]
  let r = null
  let parsed = null
  let lastText = ''
  for (const at of attempts) {
    r = await chat({ system: at.sys, user, json: at.json, maxTokens: 4096 })
    if (!r.ok) return { ok: false, error: r.error, disabled: !!r.disabled }
    lastText = r.text ?? ''
    if (!lastText.trim()) continue // 模型偶发返回空内容 → 直接重试
    parsed = extractJson(lastText)
    if (!parsed) {
      const repaired = lastText.replace(/,\s*([}\]])/g, '$1')
      parsed = repaired !== lastText ? extractJson(repaired) : null
    }
    if (parsed) break
  }
  if (!parsed) {
    return { ok: false, error: '审阅输出无法解析为 JSON（已重试 4 次）', raw: lastText.slice(0, 800), provider: r.provider, model: r.model }
  }

  // 证据校验：与解析层同一套规则 —— 逐字出自输入，否则剔除
  const source = [ctx.description ?? '', ctx.trait ?? '', ...(ctx.talents ?? []), JSON.stringify(ctx.params ?? {})].join('\n')
  const norm = (s) => String(s ?? '').replace(/\s+/g, '')
  const srcNorm = norm(source)
  const dropped = []
  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).filter((s) => {
    const ev = norm(s?.evidence)
    if (!ev || ev.length < 4 || !srcNorm.includes(ev)) { dropped.push(s?.field ?? '(未知字段)'); return false }
    if (typeof s?.suggested !== 'number') { dropped.push(`${s?.field ?? '?'}(suggested 非数字)`); return false }
    return true
  })

  return {
    ok: true,
    suggestions,
    verdict: parsed.verdict ?? null,
    // 模型自估值：**不是引擎结果**，界面上必须与引擎数值并列且标注来源
    modelEstimate: parsed.modelEstimate ?? null,
    confidence: parsed.confidence ?? null,
    provider: r.provider, model: r.model, ms: r.ms,
    ...(dropped.length ? { droppedEvidence: dropped } : {}),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 直接评测（judge）：对比页用。只要四栏结论 + 模型自估数值，不要参数建议。
// 与 reviewEvaluation 的区别：更短、更快、不产出 suggestions，适合一次评多个干员。
// ════════════════════════════════════════════════════════════════════════════

const JUDGE_SYSTEM = `你是《明日方舟》数值评测者。根据技能原文、天赋、引擎结果，给出**四栏判断**。

严格 JSON，不要解释、不要 markdown：

{
  "dps": 数字或 null,
  "survival": "一句话结论或 null",
  "teamBuff": "一句话结论或 null",
  "control": "一句话结论或 null",
  "verdict": "一句话总评（这个干员这套技能强在哪、弱在哪）",
  "basis": "你的判断依据（引用了原文哪些字段/机制）",
  "confidence": "high|medium|low"
}

规则：
1. 引擎结果被门禁时（DPS 未给出），**你仍必须给一个 dps 数字**（数量级即可）：
   按原文自己算，并在 basis 里写清楚你补了哪些引擎没算的部分、用了什么假设。
   只有确实缺少关键倍率（原文是占位符且无数值）时，才允许给 null，并在 basis 说明缺什么。
2. 数值口径跟引擎一致：物理 vs 400 防、法术 vs 50 抗。
3. 不要编造原文没有的机制。
4. 必须返回非空 JSON 对象。`

/** 对单个干员做"直接评测"（对比页用，轻量）。 */
export async function judgeEvaluation(ctx) {
  // ⚠ 关键：必须给**数值已代入**的描述。游戏描述是模板（{attack@atk_scale:0%}），
  // 真实倍率在 blackboard 里；早期只传模板 → 模型一律报"关键倍率均为占位符"、给不出数。
  const desc = ctx.resolvedDescription ?? ctx.description
  const user = [
    `干员：${ctx.operator}`,
    `技能：${ctx.skillName}`,
    `技能原文（数值已代入）：${desc}`,
    ctx.blackboard && Object.keys(ctx.blackboard).length ? `blackboard：${JSON.stringify(ctx.blackboard)}` : '',
    ctx.trait ? `分支特性：${ctx.trait}` : '',
    ...(ctx.talents ?? []).map((t, i) => `天赋${i + 1}：${t}`),
    '',
    '引擎当前结果（可能是门禁状态，仅供参考）：',
    JSON.stringify(ctx.engineResult ?? {}, null, 2),
    // 用户反馈 → **驱动再算一轮**（不是让模型照抄）
    ctx.feedback
      ? '\n【用户反馈】用户认为这套技能的 DPS 约为 ' +
        `${ctx.feedback.dps ?? '（未给数）'}` +
        (ctx.feedback.note ? `，理由：「${ctx.feedback.note}」` : '') +
        '。\n请把这条反馈当作**线索**重新评估：' +
        '\n① 复核你的算式，找出可能与用户判断不一致的地方（多目标要不要算、覆盖率怎么取、' +
        '元素/通道伤害是否漏算、天赋期望是否正确）；' +
        '\n② 给出你**重新计算后**的 dps —— 可以同意用户，也可以不同意，但必须是**你自己算出来的**，' +
        '不要直接把用户给的值抄进去；' +
        '\n③ 在 basis 里写清这次改了什么、为什么改；如果最终仍与用户差距较大，明确说明分歧点。'
      : '',
  ].filter(Boolean).join('\n')

  let r = null
  let parsed = null
  let lastText = ''
  for (const attempt of [true, false, true]) {
    r = await chat({ system: JUDGE_SYSTEM, user, json: attempt, maxTokens: 4096 })
    if (!r.ok) return { ok: false, error: r.error, disabled: !!r.disabled }
    lastText = r.text ?? ''
    if (!lastText.trim()) continue
    parsed = extractJson(lastText)
    if (!parsed) {
      const repaired = lastText.replace(/,\s*([}\]])/g, '$1')
      parsed = repaired !== lastText ? extractJson(repaired) : null
    }
    if (parsed) break
  }
  if (!parsed) return { ok: false, error: '模型输出无法解析为 JSON（已重试 3 次）', provider: r.provider, model: r.model }

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    ok: true,
    judge: {
      dps: num(parsed.dps),
      survival: parsed.survival ?? null,
      teamBuff: parsed.teamBuff ?? null,
      control: parsed.control ?? null,
      verdict: parsed.verdict ?? null,
      basis: parsed.basis ?? null,
      confidence: parsed.confidence ?? null,
    },
    // 模型的思维链（若提供方返回）：给人看，判断它的推理靠不靠谱
    thinking: r.reasoning ?? null,
    provider: r.provider, model: r.model, ms: r.ms,
  }
}


//
// 用户采纳某些建议后，让模型**照着自己被采纳的建议**重算一版数值。
// 关键约束：这仍然是**模型自估**，不是引擎结果 —— 引擎不会消费建议。
// 用途：让用户看到"若按模型的思路改，数值大概会变成多少"，
// 从而判断值不值得让 agent 把这些参数落进 overrides.mjs。
// ════════════════════════════════════════════════════════════════════════════

const RESTIMATE_SYSTEM = `你是《明日方舟》数值模型的审阅者。用户**已经采纳**了一批参数建议，
现在要你**按照被采纳后的参数**重新给出四栏估值。

严格 JSON，不要解释、不要 markdown：

{
  "dps": 数字或 null,
  "survival": "一句话结论或 null",
  "teamBuff": "一句话结论或 null",
  "control": "一句话结论或 null",
  "delta": "与引擎当前值的差异（一句话，例如「比引擎当前 3559.7 高约 18%」）",
  "reasoning": "你是怎么按采纳后的参数算出来的（引用被采纳的字段）",
  "confidence": "high|medium|low"
}

规则：
1. 只依据给定的「已采纳参数」与原文、引擎当前结果来估；不要引入未采纳的改动。
2. 数值口径要跟引擎一致（基准：物理 vs 400 防 / 法术 vs 50 抗；木桩 RES0 另注）。
3. 必须返回非空 JSON 对象。`

/**
 * 按"已采纳的建议"重新估值（模型自估，非引擎）。
 */
export async function reestimateWithAccepted(ctx) {
  const user = [
    `干员：${ctx.operator}`,
    `技能：${ctx.skillName}`,
    `技能原文：${ctx.description}`,
    ctx.trait ? `分支特性：${ctx.trait}` : '',
    ...(ctx.talents ?? []).map((t, i) => `天赋${i + 1}：${t}`),
    '',
    '已采纳的参数建议（按这些来重算）：',
    JSON.stringify(ctx.accepted ?? [], null, 2),
    '',
    '引擎当前结果（作为对照基线）：',
    JSON.stringify(ctx.engineResult ?? {}, null, 2),
  ].filter(Boolean).join('\n')

  const attempts = [
    { json: true, sys: RESTIMATE_SYSTEM },
    { json: false, sys: RESTIMATE_SYSTEM + '\n\n再次强调：只输出一个 JSON 对象。' },
    { json: true, sys: RESTIMATE_SYSTEM + '\n\n上一轮输出为空，这次必须返回完整 JSON。' },
  ]
  let r = null
  let parsed = null
  let lastText = ''
  for (const at of attempts) {
    r = await chat({ system: at.sys, user, json: at.json, maxTokens: 4096 })
    if (!r.ok) return { ok: false, error: r.error, disabled: !!r.disabled }
    lastText = r.text ?? ''
    if (!lastText.trim()) continue
    parsed = extractJson(lastText)
    if (!parsed) {
      const repaired = lastText.replace(/,\s*([}\]])/g, '$1')
      parsed = repaired !== lastText ? extractJson(repaired) : null
    }
    if (parsed) break
  }
  if (!parsed) return { ok: false, error: '再估输出无法解析为 JSON（已重试 3 次）', raw: lastText.slice(0, 800), provider: r.provider, model: r.model }

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    ok: true,
    estimate: {
      dps: num(parsed.dps),
      survival: parsed.survival ?? null,
      teamBuff: parsed.teamBuff ?? null,
      control: parsed.control ?? null,
      delta: parsed.delta ?? null,
      reasoning: parsed.reasoning ?? null,
    },
    confidence: parsed.confidence ?? null,
    provider: r.provider, model: r.model, ms: r.ms,
    acceptedCount: (ctx.accepted ?? []).length,
  }
}
