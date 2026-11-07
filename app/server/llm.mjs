// app/server/llm.mjs —— BYOK 多 provider 模型接入（零依赖，用内置 fetch）
//
// 定位：模型只负责**规则层覆盖不到的长尾机制**（读技能/天赋描述 → 产出结构化机制补丁），
// 以及自然语言评注。**未配置模型时全部功能仍可用**（规则层已覆盖高频机制）——这是硬约束。
//
// 协议适配：OpenAI 兼容（DeepSeek / OpenAI / 本地 Ollama / vLLM 等）+ Anthropic Messages。
import fs from 'node:fs'
import path from 'node:path'

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
    return { ok: true, text, provider: p.id, model: p.model, ms: Date.now() - t0 }
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
1. **talents 一项都不能漏**：输入给几条天赋就输出几条（含数值型）。攻击力/防御/生命/攻速加成
   也要填（kind=numeric，stat 与 value 必填），引擎会用它们修正面板。
2. **skill.channel 必填**：即使规则层已能处理攻击力倍率，也必须说明伤害到底怎么落地
   （普通攻击 / 引导波 / 召唤物 / 陷阱 / 持续伤害）。没有额外通道就填 {"kind":"none"}。
3. 每个数字必须能从输入文本或 blackboard 推出；**推不出就填 null，不要猜**。
4. evidence 必须逐字摘自输入原文，用来人工核对；编造的 evidence 会被校验拒绝。
5. "附带 X% 元素损伤"属于 element（同时记进 talents 对应项）；有条件触发的天赋是 conditional。`

/**
 * 长尾机制解析：把技能/天赋原文交给模型产出结构化机制补丁。
 * @param {{operator:string, skillName:string, description:string, blackboard:object, trait?:string, talents?:string[]}} ctx
 */
export async function parseMechanism(ctx) {
  const talentLines = (ctx.talents ?? []).map((t, i) => `天赋${i + 1}：${t}`)
  const user = [
    `干员：${ctx.operator}`,
    `技能：${ctx.skillName}`,
    `技能原文：${ctx.description}`,
    `blackboard：${JSON.stringify(ctx.blackboard)}`,
    ctx.trait ? `分支特性：${ctx.trait}` : '',
    ...talentLines,
  ].filter(Boolean).join('\n')
  const ask = (sys) => chat({ system: sys, user, json: true, maxTokens: 4096 })
  // 模型偶发输出非法 JSON（截断/围栏/尾随逗号）→ 最多试 3 次，逐次收紧要求。
  // 实测同一干员两次调用结果不同，所以单次失败不能直接判死。
  const attempts = [
    SYSTEM,
    `${SYSTEM}\n\n上一次输出不是合法 JSON（可能被截断）。这次只输出唯一的 JSON 对象，不要解释、不要 markdown 围栏，evidence 尽量短。`,
    `${SYSTEM}\n\n严格只输出 JSON。若字段太多会导致截断，请把 evidence 压到 6-10 个字。`,
  ]
  let r = null
  let parsed = null
  let lastText = ''
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
    ...(dropped.length ? { droppedEvidence: dropped } : {}),
  }
}
