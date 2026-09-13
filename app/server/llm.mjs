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

const SYSTEM = `你是《明日方舟》机制解析器。用户会给你一名干员的技能/天赋**原文**与 blackboard 数值。
你的任务：只提取**规则引擎无法从 blackboard 直接推导的机制**，输出严格 JSON（不要解释、不要 markdown）：
{
  "form": "稳态持续|单次窗口爆发|陷阱触发|下次攻击强化|元素累积|技能期停止攻击 之一",
  "patches": {  // 只填需要的字段
    "attackMult": 数字,          // 技能伤害倍率（若 blackboard 的 atk_scale 语义不符时）
    "damageType": "physical|magical|true",
    "burstPatch": { "perDeployHits": 数, "hitMult": 数, "maxDeploysPerSkill": 数, "skillWindowSec": 数, "deploys": 数, "windowSec": 数 },
    "trapPatch": { "mult": 数, "multBonusPct": 数, "resPenetrate": 数, "cdSec": 数, "cnt": 数 }
  },
  "reasoning": "一句话说明依据（引用原文关键词）",
  "confidence": "high|medium|low"
}
要求：① 只依据给定文本与数值，不得编造；② 不确定时 confidence 标 low 并留空 patches；
③ 若规则层已能正确处理，返回 patches: {}。`

/**
 * 长尾机制解析：把技能描述交给模型产出机制补丁。
 * @param {{operator:string, skillName:string, description:string, blackboard:object, trait?:string, talent?:string}} ctx
 */
export async function parseMechanism(ctx) {
  const user = [
    `干员：${ctx.operator}`,
    `技能：${ctx.skillName}`,
    `技能原文：${ctx.description}`,
    `blackboard：${JSON.stringify(ctx.blackboard)}`,
    ctx.trait ? `分支特性：${ctx.trait}` : '',
    ctx.talent ? `天赋：${ctx.talent}` : '',
  ].filter(Boolean).join('\n')
  const r = await chat({ system: SYSTEM, user, json: true })
  if (!r.ok) return { ok: false, error: r.error, disabled: !!r.disabled }
  const parsed = extractJson(r.text)
  if (!parsed) return { ok: false, error: '模型输出无法解析为 JSON', raw: r.text?.slice(0, 800), provider: r.provider, model: r.model }
  return { ok: true, ...parsed, provider: r.provider, model: r.model, ms: r.ms }
}
