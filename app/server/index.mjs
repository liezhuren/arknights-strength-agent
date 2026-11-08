// app/server/index.mjs —— 本地单机 API 服务（Node 内置 http，零依赖）
//
// 定位：把已有的评测管线（tools/ + engine/）与数据库（app/db）暴露成 REST，
// 供前端（app/web，Vite+React+TS）调用。**不重复实现任何评测逻辑** —— 全部复用既有模块。
//
// 启动：node app/server/index.mjs [--port 8787]
// 设计原则：无模型也能用（规则层已覆盖大部分）；模型配置为 BYOK，Key 只存本地且永不回显。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import {
  getOperator, searchOperators, facets, getScenarios, getThreats, getBaseline, getRanges,
  saveCustom, listCustom, deleteCustom, recordEvaluation, recentEvaluations, getEvaluation,
  saveParse, getParse, listParses, deleteParse, exportOverrides,
} from '../db/index.mjs'
import { evaluate, formatReport } from '../../tools/evaluate.mjs'
import { splitSections } from '../../tools/section.mjs'
import { evaluateCustom, validateCustomOperator } from '../../tools/evaluate-custom.mjs'
import { modulesOf } from '../../tools/modules.mjs'
import { parseMechanism, reviewEvaluation, reestimateWithAccepted, chat, activeProvider } from './llm.mjs'
import { extractVersatility, scenarioValue } from '../../tools/versatility.mjs'
import { extractRotation } from '../../tools/rotation.mjs'
import { extractSurvival, runProfiles } from '../../tools/survival.mjs'
import { extractDifficulty } from '../../tools/difficulty.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const WEB_DIST = path.join(ROOT, 'app/web/dist')
const CONFIG = path.join(ROOT, 'app/config.json')
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8787

// ---- 模型配置（BYOK，多 provider；Key 只落本地文件，永不回显）----
const DEFAULT_CONFIG = {
  provider: '',            // '' = 不启用模型（纯规则层）
  providers: {
    deepseek: { label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' },
    openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
    anthropic: { label: 'Anthropic', baseURL: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest', apiKey: '' },
    ollama: { label: '本地 Ollama', baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:14b', apiKey: 'local' },
  },
}
const readConfig = () => {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) } } catch { return { ...DEFAULT_CONFIG } }
}
const maskConfig = (c) => ({
  provider: c.provider,
  // label 以代码为准（防止持久化文件里的中文被编码问题损坏），其余字段用持久化值
  providers: Object.fromEntries(Object.entries(c.providers).map(([k, v]) => [k, {
    ...v,
    label: DEFAULT_CONFIG.providers[k]?.label ?? v.label,
    apiKey: v.apiKey ? '••••••' + String(v.apiKey).slice(-4) : '',
  }])),
  modelEnabled: !!c.provider,
})

// ---- 工具 ----
const json = (res, code, data) => {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}
const readBody = (req) => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', (c) => { s += c; if (s.length > 2e6) reject(new Error('请求体过大')) })
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch (e) { reject(new Error('JSON 解析失败')) } })
  req.on('error', reject)
})
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

/** 核心：跑一次评测（数据集干员），返回结构化结果 + 文本报告。
 *  除格式化文本外，另给**结构化数据**（charts），供前端画图 —— 口径与文本完全同源，不重复计算。 */
function runEvaluation({ query, skillIndex = 2, moduleSpec, moduleLevel, damageType = 'auto', axis }) {
  const op = getOperator(query)
  if (!op) throw new Error(`未找到干员：${query}`)
  const si = Number(skillIndex)
  const r = evaluate(op, { damageType, skillIndex: si, moduleSpec, moduleLevel, axis })
  // 结构化：泛用性六场景 / 回转身周期 / 生存分档 / 操作难度因素
  const v = extractVersatility(r.engine)
  const rot = extractRotation(op, si, r.engine)
  const sv = extractSurvival(op, si)
  const normalRows = runProfiles(sv.normal.panel)
  const skillRows = sv.skill.active ? runProfiles(sv.skill.panel) : null
  const diff = extractDifficulty(op, r.engine, si)
  const slim = (rows) => rows.map((x) => ({
    id: x.threat.id, dps: x.threat.dps, perHit: x.perHit,
    hitsToDie: x.hitsToDie, seconds: x.seconds, sustained: x.sustained,
  }))
  // DPS 门禁：未接入文本解析时，任何 DPS 派生视图都不生成（用户定调：
  // 没有天赋/元素参与的 DPS 不成立，不该出现在界面上）
  const dpsGated = !r.dpsGate?.verified
  // 泛用性/衰减来自规则层的六场景 DPS，通道校准不会喂进去 → 必须单独判
  const ruleDpsOk = r.dpsGate?.verified && !r.channel && r.modeling?.level !== 'blocked'
  const GATE_NOTE = '输出 DPS 未给出：天赋与元素未参与建模，规则层数值不成立。\n接入模型解析后，本栏会自动显示数值。'
  return {
    result: r,
    report: formatReport(r),
    // 各栏的**展示形态**（标题剥掉元信息、结尾口径旁白分离）——
    // 网页渲染这个；`result` 里的 *Section 原文（含旁白）保留给 LLM/agent 与终端报告
    sections: splitSections({
      versatility: ruleDpsOk ? r.versatilitySection : GATE_NOTE,
      difficulty: r.difficultySection,
      rotation: r.rotationSection,
      teamBuff: r.teamBuffSection,
      control: r.controlSection,
      // 生存栏同样依赖"天赋未消费"的前提：防御/生命/减伤/闪避天赋都没进模型 → 独立门禁
      survival: !r.survivalGate?.verified
        ? '④ 生存栏未给出：防御/生命/减伤/闪避类天赋未参与建模，承伤推算不成立。\n接入模型解析后，本栏会自动显示数值。'
        : r.survivalSection,
    }),
    operator: { id: op.id, name: op.name, rarity: op.rarity, profession: op.profession, subProfessionId: op.subProfessionId },
    modules: modulesOf(op).map((m) => ({ id: m.id, name: m.name, type: m.type, isSpecial: !!m.isSpecial, hasCombatData: !!m.hasCombatData })),
    charts: {
      // 泛用性 = 六场景干员输出分布 → 纯 DPS 派生，门禁关闭时不给
      versatility: !ruleDpsOk
        ? null
        : {
            rows: v.rows.map((x) => ({ id: x.id, name: x.name, def: x.def, res: x.res, value: x.value, p25: x.p25, p50: x.p50, ok25: x.ok25, ok50: x.ok50 })),
            coverageP25: v.coverageP25, coverageP50: v.coverageP50, worstOverMedian: v.worstOverMedian,
            decayPct: v.decayPct, phys: v.phys, tier: v.tier,
          },
      rotation: rot
        ? { spLabel: rot.spLabel, spCost: rot.spCost, initSp: rot.initSp, rate: rot.rate, firstUse: rot.firstUse, duration: rot.duration, cycle: rot.cycle, coverage: rot.coverage, downtime: rot.downtime, permanent: rot.permanent, casts60: rot.casts60, casts90: rot.casts90, ammo: rot.ammo }
        : null,
      // 生存分档 = 面板防御/生命 + 敌人来袭画像；防御/闪避/减伤类天赋未参与建模 → 独立门禁
      survival: !r.survivalGate?.verified
        ? null
        : {
            normal: slim(normalRows),
            skill: skillRows ? slim(skillRows) : null,
            stateNote: sv.stateNote,
            immune: sv.immune,
            healPerSec: sv.normal.panel.healPerSec,
            dodge: sv.normal.panel.dodge,
          },
      difficulty: { tier: diff.tier, score: diff.score, factors: diff.factors.map((f) => ({ kind: f.kind, level: f.level, text: f.text })) },
      // 属性衰减曲线（物理看 DEF，法术看 RES）—— 同样是干员 DPS 派生
      decay: !ruleDpsOk
        ? []
        : (r.damageType === 'physical' ? [0, 200, 400, 800, 1200] : [0, 20, 50, 80, 95])
            .map((x) => ({ x, value: scenarioValue(r.engine, r.damageType === 'physical' ? x : 0, r.damageType === 'physical' ? 0 : x) })),
    },
    // 模型建议（只读展示用）：来自机制解析表中该 (干员, 技能) 的记录。
    // ⚠ 引擎**不消费**这些建议；它们只是审阅意见，状态由人改。
    review: (() => {
      const p = getParse(op.id, si)
      const patches = p?.patches ?? {}
      const sugs = Array.isArray(patches.suggestions) ? patches.suggestions : []
      if (!sugs.length && !patches.modelEstimate && !patches.verdict) return null
      return {
        suggestions: sugs,
        modelEstimate: patches.modelEstimate ?? null,
        // 采纳后的再估结果（模型按已采纳建议重给的版本）
        reestimate: patches.reestimate ?? null,
        verdict: patches.verdict ?? null,
        model: p?.model ?? null,
        updatedAt: p?.updated_at ?? null,
      }
    })(),
  }
}

const routes = {
  'GET /api/health': () => ({ ok: true, node: process.version, db: 'sqlite', modelEnabled: !!readConfig().provider }),

  'GET /api/operators': ({ url }) => searchOperators({
    q: url.searchParams.get('q') ?? '',
    profession: url.searchParams.get('profession') ?? '',
    subProfession: url.searchParams.get('subProfession') ?? '',
    rarity: url.searchParams.get('rarity') ?? '',
    limit: Math.min(Number(url.searchParams.get('limit')) || 50, 300),
    offset: Number(url.searchParams.get('offset')) || 0,
  }),
  'GET /api/facets': () => facets(),
  'GET /api/scenarios': () => ({ scenarios: getScenarios(), threats: getThreats(), baseline: getBaseline() }),
  // 射程几何（range_table）：形状 + 指标，供前端画范围图
  'GET /api/ranges': () => ({ ranges: getRanges() }),

  'POST /api/evaluate': async ({ body }) => {
    const out = runEvaluation(body)
    try { recordEvaluation({ opId: out.operator.id, opName: out.operator.name, skillIdx: body.skillIndex, moduleSpec: body.moduleSpec, damageType: out.result.damageType, result: { benchmark: out.result.benchmark, coverage: out.result.coverage } }) } catch { /* 历史失败不影响评测 */ }
    return out
  },
  'POST /api/compare': async ({ body }) => {
    const queries = Array.isArray(body.queries) ? body.queries.slice(0, 6) : []
    if (!queries.length) throw new Error('queries 不能为空（最多 6 名）')
    const rows = queries.map((q) => {
      const op = getOperator(q)
      if (!op) return { query: q, error: '未找到' }
      const r = evaluate(op, { damageType: body.damageType ?? 'auto', skillIndex: Number(body.skillIndex ?? 2), moduleSpec: body.moduleSpec, moduleLevel: body.moduleLevel })
      const v = r.versatilitySection ? null : null
      return {
        query: q, name: op.name, skill: r.skill, damageType: r.damageType,
        // DPS 门禁：未接入文本解析时不返回 benchmark 数值，避免对比页展示规则层 DPS
        benchmark: r.dpsGate?.verified ? r.benchmark : null,
        dpsGated: !r.dpsGate?.verified, coverage: r.coverage, tier: /分级：\*\*(.+?)\*\*/.exec(r.versatilitySection ?? '')?.[1] ?? null,
        difficulty: /分级：\*\*(.+?)\*\*/.exec(r.difficultySection ?? '')?.[1] ?? null,
        firstUse: /首轮可用 ([\d.]+)s/.exec(r.rotationSection ?? '')?.[1] ?? null,
      }
    })
    return { rows }
  },

  // ---- 自制干员 ----
  'GET /api/custom': () => listCustom().map((c) => ({ ...c, data: JSON.parse(c.data) })),
  'POST /api/custom': async ({ body }) => {
    const errors = validateCustomOperator(body.data ?? body)
    if (errors.length) return { ok: false, errors }
    const data = body.data ?? body
    saveCustom(data.name, data)
    return { ok: true, name: data.name }
  },
  'POST /api/custom/evaluate': async ({ body }) => {
    const data = body.data ?? body
    const r = evaluateCustom(data)
    return { result: r, report: typeof r === 'string' ? r : formatReport?.(r) ?? null }
  },
  'DELETE /api/custom': async ({ url }) => { deleteCustom(url.searchParams.get('name')); return { ok: true } },

  // ---- 评测历史 ----
  'GET /api/evaluations': ({ url }) => recentEvaluations(Math.min(Number(url.searchParams.get('limit')) || 20, 100)),
  'GET /api/evaluation': ({ url }) => getEvaluation(Number(url.searchParams.get('id'))),

  // ---- 模型设置（BYOK）----
  'GET /api/config': () => maskConfig(readConfig()),
  'POST /api/config': async ({ body }) => {
    const cur = readConfig()
    const next = {
      provider: body.provider ?? cur.provider,
      providers: { ...cur.providers },
    }
    for (const [k, v] of Object.entries(body.providers ?? {})) {
      next.providers[k] = { ...(cur.providers[k] ?? {}), ...v }
      // label 一律以代码里的 DEFAULT_CONFIG 为准（纯防御：label 只是显示名，
      // 不值得从持久化文件读取 —— 用户手工编辑 config.json 时可能被编辑器改坏编码）
      if (DEFAULT_CONFIG.providers[k]?.label) next.providers[k].label = DEFAULT_CONFIG.providers[k].label
      if (v.apiKey === '' || v.apiKey === undefined) next.providers[k].apiKey = cur.providers[k]?.apiKey ?? ''  // 空值不覆盖已存 Key
    }
    fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2), 'utf8')
    return maskConfig(next)
  },

  // ---- 模型（BYOK）：长尾机制解析 + 连通性测试 ----
  'GET /api/llm/status': () => {
    const p = activeProvider()
    return p
      ? { enabled: true, provider: p.id, kind: p.kind, model: p.model, baseURL: p.baseURL, hasKey: !!p.apiKey }
      : { enabled: false, hint: '未启用模型 —— 规则层功能完整；需要长尾机制解析时请在「模型设置」里选择 provider' }
  },
  'POST /api/llm/parse': async ({ body }) => {
    const op = getOperator(body.query)
    if (!op) throw new Error(`未找到干员：${body.query}`)
    const si = Number(body.skillIndex ?? 2)
    const lv = op.skills?.[si]?.levels?.[9]
    if (!lv) throw new Error('该干员无此技能')
    // 命中已沉淀的解析 → 直接返回缓存（不再重复调模型、省额度且结果稳定）
    if (body.useCache !== false) {
      const cached = getParse(op.id, si)
      if (cached) return { ok: true, ...cached, patches: cached.patches, cached: true }
    }
    const r = await parseMechanism({
      operator: op.name,
      skillName: lv.name ?? '—',
      description: lv.description ?? '',
      blackboard: Object.fromEntries((lv.blackboard ?? []).map((b) => [b.key, b.value])),
      trait: op.trait?.description ?? undefined,
      // 全部天赋都喂进去（原先只传第一条 → 多天赋干员漏解析）
      talents: (op.talents ?? []).map((t) => t.description).filter(Boolean),
      // 字段语义知识库：把本次出现的 blackboard 键（技能+天赋+特性）交给解析层查表，
      // 让模型不必猜「atk 是加算还是乘算」「interval 单位是秒还是别的」
      kbKeys: [
        ...(lv.blackboard ?? []).map((b) => b.key),
        ...(op.talents ?? []).flatMap((t) => (t.blackboard ?? []).map((b) => b.key)),
        ...(op.trait?.blackboard ?? []).map((b) => b.key),
      ],
    })
    // 成功则**沉淀入库**（AI 提议；是否并入 overrides.mjs 由人工审核决定）
    if (r.ok) {
      saveParse({ opId: op.id, skillIdx: si, form: r.form, patches: r.patches, reasoning: r.reasoning, confidence: r.confidence, provider: r.provider, model: r.model })
    }
    return r
  },
  // ── 审阅：让模型对四栏结果提出**参数级建议**（不产出最终数字）──────────────
  'POST /api/llm/review': async ({ body }) => {
    const op = getOperator(body.query)
    if (!op) throw new Error(`未找到干员：${body.query}`)
    const si = Number(body.skillIndex ?? 2)
    const lv = op.skills?.[si]?.levels?.[9]
    if (!lv) throw new Error('该干员无此技能')

    // 当前引擎算出来的东西（参数 + 四栏摘要）
    const r = evaluate(op, { damageType: body.damageType ?? 'auto', skillIndex: si })
    const parsed = getParse(op.id, si)
    const params = {
      skill: {
        damageType: r.damageType,
        attackMult: r.skillData?.attackMult ?? null,
        hits: r.skillData?.hits ?? null,
        targets: r.skillData?.targetCount ?? null,
        noAttack: r.skillData?.noAttack ?? false,
      },
      channel: r.channel
        ? {
            kind: r.channel.kind,
            balls: r.channel.balls,
            elementBalls: r.channel.elementBalls,
            perBallAtkScale: null, // 已折算进 damage，暴露给模型的是结果
            totalDamage: Math.round(r.channel.totalDamage),
            dps: Math.round(r.channel.dps * 10) / 10,
            rawDps: Math.round(r.channel.rawDps * 10) / 10,
          }
        : null,
      parse: parsed?.patches ?? null,
    }
    const results = {
      panel: r.panel,
      coverage: Math.round((r.coverage ?? 0) * 1000) / 10,
      dps: r.channel
        ? { kind: 'channel', dps: Math.round(r.channel.dps), rawDps: Math.round(r.channel.rawDps) }
        : { kind: 'rule-layer', gated: !r.dpsGate?.verified, reason: r.dpsGate?.reason ?? null },
      survival: r.survivalGate?.verified ? '已展示' : '未建模（门禁中）',
      tips: '生存栏/团队增益/控制栏同样可以提建议，字段自拟但必须是参数。',
    }

    const rev = await reviewEvaluation({
      operator: op.name,
      skillName: lv.name ?? '—',
      description: lv.description ?? '',
      trait: op.trait?.description ?? undefined,
      talents: (op.talents ?? []).map((t) => t.description).filter(Boolean),
      params,
      results,
    })
    if (!rev.ok) return rev

    // 建议沉淀：**累积**而不是覆盖（早期实现整体覆盖 → 第二次审阅返回空建议时
    // 把上一次的 3 条建议全冲掉了）。同一 (column, field) 视为同一条建议，新值覆盖旧值；
    // 其余历史保留，并记录状态与时间，供人工接受/拒绝。
    // 注意：**引擎不会消费这些建议** —— 引擎保持确定性；建议由人/agent 审阅后
    // 落到 overrides.mjs 或引擎代码里才生效。
    const prev = parsed?.patches ?? {}
    const prevSugs = Array.isArray(prev.suggestions) ? prev.suggestions : []
    const stamp = new Date().toISOString()
    const fresh = rev.suggestions.map((s) => ({ ...s, status: 'proposed', at: stamp, model: rev.model }))
    const merged = [
      ...prevSugs.filter((p) => !fresh.some((f) => f.column === p.column && f.field === p.field)),
      ...fresh,
    ]
    saveParse({
      opId: op.id,
      skillIdx: si,
      form: parsed?.form ?? null,
      patches: {
        ...prev,
        suggestions: merged,
        verdict: rev.verdict ?? prev.verdict ?? null,
        modelEstimate: rev.modelEstimate ?? prev.modelEstimate ?? null,
      },
      reasoning: rev.verdict ?? parsed?.reasoning ?? null,
      confidence: rev.confidence ?? parsed?.confidence ?? null,
      provider: rev.provider,
      model: rev.model,
    })
    return { ...rev, mergedCount: merged.length, params, results }
  },
  // ── 建议状态：接受 / 拒绝（**只改状态，不触发任何重算**）──────────────────
  // 引擎不消费建议；这里只是登记"人已经看过并表过态"，真正生效要改 overrides.mjs。
  'POST /api/llm/suggestion-status': async ({ body }) => {
    const op = getOperator(body.query)
    if (!op) throw new Error(`未找到干员：${body.query}`)
    const si = Number(body.skillIndex ?? 2)
    const p = getParse(op.id, si)
    if (!p) throw new Error('该干员/技能还没有解析记录')
    const patches = p.patches ?? {}
    const sugs = Array.isArray(patches.suggestions) ? patches.suggestions : []
    const want = String(body.status ?? '')
    if (!['proposed', 'accepted', 'rejected'].includes(want)) throw new Error('status 必须是 proposed/accepted/rejected')
    let hit = 0
    const note = typeof body.note === 'string' && body.note ? body.note : null
    const next = sugs.map((s) => {
      if (s.column === body.column && s.field === body.field) {
        hit++
        return { ...s, status: want, reviewedAt: new Date().toISOString(), ...(note ? { landedNote: note } : {}) }
      }
      return s
    })
    if (!hit) throw new Error('未找到该建议')
    saveParse({
      opId: op.id, skillIdx: si,
      form: p.form, confidence: p.confidence, provider: p.provider, model: p.model,
      reasoning: p.reasoning,
      patches: { ...patches, suggestions: next },
    })
    return { ok: true, updated: hit, suggestions: next }
  },
  // ── 采纳后的再估：模型按"已采纳的建议"重给一版四栏数值（仍是模型自估）──────────
  // ⚠ 引擎不消费建议；这里的数字只回答"若按模型思路改，大概会变成多少"。
  'POST /api/llm/reestimate': async ({ body }) => {
    const op = getOperator(body.query)
    if (!op) throw new Error(`未找到干员：${body.query}`)
    const si = Number(body.skillIndex ?? 2)
    const lv = op.skills?.[si]?.levels?.[9]
    if (!lv) throw new Error('该干员无此技能')
    const p = getParse(op.id, si)
    if (!p) throw new Error('该干员/技能还没有解析记录，无法再估')
    const sugs = Array.isArray(p.patches?.suggestions) ? p.patches.suggestions : []
    const accepted = sugs.filter((s) => s.status === 'accepted')
    if (!accepted.length) throw new Error('还没有已采纳的建议')

    const r = evaluate(op, { damageType: body.damageType ?? 'auto', skillIndex: si })
    const engineResult = {
      panel: r.panel,
      coverage: Math.round((r.coverage ?? 0) * 100) / 100,
      dps: r.channel
        ? { kind: 'channel', dps: Math.round(r.channel.dps), rawDps: Math.round(r.channel.rawDps) }
        : { kind: 'rule-layer', gated: !r.dpsGate?.verified },
      survival: r.survivalGate?.verified ? '已展示' : '未建模（门禁中）',
    }
    const est = await reestimateWithAccepted({
      operator: op.name,
      skillName: lv.name ?? '—',
      description: lv.description ?? '',
      trait: op.trait?.description ?? undefined,
      talents: (op.talents ?? []).map((t) => t.description).filter(Boolean),
      accepted,
      engineResult,
    })
    if (!est.ok) return est

    // 沉淀再估结果（覆盖旧的，带时间与来源）
    saveParse({
      opId: op.id, skillIdx: si,
      form: p.form, confidence: est.confidence ?? p.confidence, provider: est.provider, model: est.model,
      reasoning: p.reasoning,
      patches: {
        ...(p.patches ?? {}),
        reestimate: { ...est.estimate, at: new Date().toISOString(), model: est.model, acceptedCount: est.acceptedCount },
      },
    })
    return { ...est, engineResult }
  },
  'GET /api/llm/parses': ({ url }) => listParses(Math.min(Number(url.searchParams.get('limit')) || 100, 500)),
  'DELETE /api/llm/parses': async ({ url }) => {
    deleteParse(url.searchParams.get('opId'), Number(url.searchParams.get('skillIdx') ?? 2))
    return { ok: true }
  },
  'GET /api/llm/export': () => ({ snippet: exportOverrides(), count: listParses(500).filter((r) => Object.keys(r.patches ?? {}).length).length }),
  'POST /api/llm/ping': async () => {
    const p = activeProvider()
    if (!p) return { ok: false, error: '未启用模型' }
    const r = await chat({ user: '回复两个字：可用', maxTokens: 16, timeoutMs: 20000 })
    return { ok: r.ok, provider: r.provider, model: r.model, ms: r.ms, reply: r.text?.slice(0, 60), error: r.error }
  },
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const key = `${req.method} ${url.pathname}`
  try {
    const handler = routes[key]
    if (handler) {
      const out = await handler({ url, body: req.method === 'POST' ? await readBody(req) : null })
      return json(res, 200, out)
    }
    if (url.pathname.startsWith('/api/operators/')) {
      const op = getOperator(decodeURIComponent(url.pathname.slice('/api/operators/'.length)))
      return op ? json(res, 200, op) : json(res, 404, { error: '未找到干员' })
    }
    // 静态托管前端构建产物（app/web/dist）；未构建时给提示
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const file = path.join(WEB_DIST, rel)
      if (file.startsWith(WEB_DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
        return res.end(fs.readFileSync(file))
      }
      if (!fs.existsSync(WEB_DIST)) {
        return json(res, 200, { hint: '前端尚未构建。cd app/web && pnpm install && pnpm build', api: Object.keys(routes) })
      }
    }
    return json(res, 404, { error: `未知接口：${key}` })
  } catch (e) {
    return json(res, 400, { error: e.message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const cfg = readConfig()
  console.log(`🐋 明日方舟强度评测 API  →  http://127.0.0.1:${PORT}`)
  console.log(`   DB: app/db/arknights.db · 模型: ${cfg.provider || '未启用（纯规则层，功能完整）'}`)
  console.log(`   接口: ${Object.keys(routes).length} 个 · 前端: ${fs.existsSync(WEB_DIST) ? '已构建' : '未构建（仅 API）'}`)
})
