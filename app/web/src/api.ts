// API 客户端：与 app/server 的接口一一对应（开发模式经 vite proxy，生产由 server 静态托管同源）
export type Rarity = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6'

export interface OperatorRow {
  id: string; name: string; rarity: Rarity; rarity_num: number; profession: string
  sub_profession: string; sub_profession_name: string | null
  atk: number; def: number; max_hp: number; cost: number
  block_cnt: number; trait_desc: string | null
}
export interface SearchResult { total: number; rows: OperatorRow[] }
export interface ModuleInfo { id: string; name: string; type: string; isSpecial: boolean; hasCombatData: boolean }

export interface Charts {
  /** 泛用性 = 六场景干员输出分布：纯 DPS 派生，DPS 门禁关闭时为 null */
  versatility: {
    rows: { id: string; name: string; def: number; res: number; value: number; p25: number; p50: number; ok25: boolean; ok50: boolean }[]
    coverageP25: number; coverageP50: number; worstOverMedian: number; decayPct: number; phys: boolean; tier: string
  } | null
  rotation: {
    spLabel: string; spCost: number; initSp: number; rate: number | null; firstUse: number | null
    duration: number; cycle: number | null; coverage: number; downtime: number | null
    permanent: boolean; casts60: number; casts90: number; ammo: boolean
  } | null
  survival: {
    normal: { id: string; dps: number; perHit: number; hitsToDie: number | null; seconds: number | null; sustained: boolean }[]
    skill: { id: string; dps: number; perHit: number; hitsToDie: number | null; seconds: number | null; sustained: boolean }[] | null
    stateNote: string | null; immune: string[]; healPerSec: number; dodge: { physical: number; magical: number }
  } | null
  difficulty: { tier: string; score: number; factors: { kind: string; level: number; text: string }[] }
  decay: { x: number; value: number }[]
}

/** 一栏的展示形态：标题（已剥掉元信息）+ 正文 + 口径旁白（旁白是给 agent 看的，网页不渲染） */
export interface SectionView {
  title: string
  content: string[]
  notes: string[]
}

export interface EvaluationResult {
  operator: { id: string; name: string; rarity: string; profession: string; subProfessionId: string }
  modules: ModuleInfo[]
  report: string
  charts: Charts
  /** 各栏的展示形态（网页渲染这个，避免把给 agent 的口径旁白糊到用户脸上） */
  sections: Record<string, SectionView>
  result: {
    skill: string; damageType: string; coverage: number
    benchmark: Record<string, number>
    // 五栏文本（关键点：与输出不合并）
    versatilitySection: string | null
    difficultySection: string | null
    rotationSection: string | null
    survivalSection: string | null
    teamBuffSection: string | null
    controlSection: string | null
    panel: { atk: number; baseInterval: number; cost: number; maxHp: number; def: number; res: number; block: number }
    talentList: string[]
    trait: string | null
    burst?: {
      perDeployHits: number; hitMult: number; deploys: number; windowSec: number
      maxDeploysPerSkill: number; skillWindowSec: number; axisFromUser?: boolean
    } | null
    trap?: { mult: number; cdSec: number; cnt?: number } | null
    element?: { type: string; perHitRatio: number } | null
    nextAttack?: boolean
    /**
     * 建模覆盖度判定（服务端 tools/model-coverage.mjs 产出）。
     * level==='blocked' 表示技能期 DPS 不可用（伤害走未建模通道）——
     * 此时界面**不得**把 benchmark 里的 0 当成结果展示。
     */
    modeling?: {
      level: 'blocked' | 'partial' | 'full'
      basis: string
      skillDpsUsable: boolean
      gaps: { code: string; severity: 'blocking' | 'material' | 'note'; label: string; detail?: string }[]
    } | null
    /** DPS 展示门禁：verified=false 时整站不展示任何干员 DPS 数值 */
    dpsGate?: { verified: boolean; reason: string | null } | null
    /** 生存栏独立门禁（防御/生命/减伤/闪避类天赋未建模时不展示承伤推算） */
    survivalGate?: { verified: boolean; reason: string | null } | null
    /** 通道类技能（引导/波次）的校准结果；存在时用它替代普攻循环 DPS */
    channel?: {
      kind: string
      balls: number
      perBallDamage: number
      totalDamage: number
      durationSec: number
      dps: number
      leaderDps: number
      elementTotal: number | null
      note: string
      source: string
    } | null
    moduleApplied: { entry: { name: string; type: string } | null; level: { level: number } | null; attr: Record<string, number>; warnings: string[] } | null
  }
  /**
   * 模型建议（只读展示）。
   * ⚠ 引擎**不消费**这些建议 —— 它们只是审阅意见；接受/拒绝只改状态，
   * 真正生效要改 tools/overrides.mjs。
   */
  review?: {
    suggestions: SuggestionView[]
    modelEstimate: {
      dps?: number | null
      survival?: string | null
      teamBuff?: string | null
      control?: string | null
      reasoning?: string
    } | null
    verdict: string | null
    /** 采纳后模型按已采纳建议重给的一版数值（仍是模型自估，非引擎） */
    reestimate?: {
      dps: number | null
      survival?: string | null
      teamBuff?: string | null
      control?: string | null
      delta?: string | null
      reasoning?: string | null
      at?: string
      model?: string | null
      acceptedCount?: number
    } | null
    model: string | null
    updatedAt: string | null
  } | null
}

export interface SuggestionView {
  column: 'dps' | 'survival' | 'teamBuff' | 'control'
  field: string
  current: number | null
  suggested: number
  reason: string
  evidence: string
  confidence: 'high' | 'medium' | 'low'
  expectedEffect?: string
  status?: 'proposed' | 'accepted' | 'rejected'
  /** 处置说明（落地到哪个配置 / 为何驳回） */
  landedNote?: string
  at?: string
  reviewedAt?: string
  model?: string
}
export interface CompareRow {
  query: string; name?: string; skill?: string; damageType?: string
  /** DPS 门禁关闭时为 null（不返回规则层数值） */
  benchmark?: Record<string, number> | null; coverage?: number
  /** true 表示该行 DPS 未给出（缺天赋/元素建模） */
  dpsGated?: boolean
  tier?: string | null; difficulty?: string | null; firstUse?: string | null
  error?: string
}
export interface ConfigView {
  provider: string; modelEnabled: boolean
  providers: Record<string, { label: string; baseURL: string; model: string; apiKey: string }>
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  const j = await r.json()
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`)
  return j as T
}
const post = <T,>(p: string, body: unknown) =>
  req<T>(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  health: () => req<{ ok: boolean; node: string; modelEnabled: boolean }>('/api/health'),
  facets: () => req<{
    professions: { profession: string; c: number }[]
    rarities: { rarity: string; c: number }[]
    subProfessions: { id: string; name: string; profession: string; c: number }[]
  }>('/api/facets'),
  search: (p: { q?: string; profession?: string; subProfession?: string; rarity?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    return req<SearchResult>(`/api/operators?${qs}`)
  },
  detail: (id: string) => req<Record<string, unknown>>(`/api/operators/${encodeURIComponent(id)}`),
  scenarios: () => req<{ scenarios: unknown[]; threats: unknown[]; baseline: unknown[] }>('/api/scenarios'),
  evaluate: (p: { query: string; skillIndex?: number; moduleSpec?: string; moduleLevel?: number; damageType?: string; axis?: { deploys?: number; windowSec?: number } }) =>
    post<EvaluationResult>('/api/evaluate', p),
  compare: (queries: string[], skillIndex = 2) => post<{ rows: CompareRow[] }>('/api/compare', { queries, skillIndex }),
  /** 对比页"让模型直接评测"：四栏判断 + 模型自估数值 */
  compareAi: (queries: string[], skillIndex = 2) =>
    post<{
      ok: boolean
      disabled?: boolean
      error?: string
      rows: Array<{
        query: string
        name?: string
        skill?: string | null
        ok: boolean
        error?: string
        ms?: number
        model?: string
        judge?: {
          dps: number | null
          survival: string | null
          teamBuff: string | null
          control: string | null
          verdict: string | null
          basis: string | null
          confidence: string | null
        }
      }>
    }>('/api/compare/ai', { queries, skillIndex }),
  listCustom: () => req<{ id: number; name: string; data: Record<string, unknown>; updated_at: string }[]>('/api/custom'),
  saveCustom: (data: unknown) => post<{ ok: boolean; errors?: string[]; name?: string }>('/api/custom', { data }),
  deleteCustom: (name: string) => req<{ ok: boolean }>(`/api/custom?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
  evaluateCustom: (data: unknown) => post<{ result: unknown; report: string | null }>('/api/custom/evaluate', { data }),
  reviewOp: (p: { query: string; skillIndex?: number; regenerate?: boolean }) =>
    post<{ ok: boolean; suggestions: SuggestionView[]; modelEstimate?: unknown; verdict?: string | null; error?: string; mergedCount?: number; lookedUp?: string[] }>('/api/llm/review', p),
  setSuggestionStatus: (p: { query: string; skillIndex?: number; column: string; field: string; status: 'proposed' | 'accepted' | 'rejected' }) =>
    post<{ ok: boolean; updated: number; suggestions: SuggestionView[] }>('/api/llm/suggestion-status', p),
  /** 采纳后让模型按已采纳建议重给一版数值（仍是模型自估） */
  reestimate: (p: { query: string; skillIndex?: number }) =>
    post<{
      ok: boolean
      estimate?: { dps: number | null; survival: string | null; teamBuff: string | null; control: string | null; delta: string | null; reasoning: string | null }
      acceptedCount?: number
      error?: string
    }>('/api/llm/reestimate', p),
  config: () => req<ConfigView>('/api/config'),
  saveConfig: (body: unknown) => post<ConfigView>('/api/config', body),
  // BYOK 模型：长尾机制解析（未启用模型时返回 disabled，规则层不受影响）
  llmStatus: () => req<{ enabled: boolean; provider?: string; model?: string; kind?: string; hasKey?: boolean; hint?: string }>('/api/llm/status'),
  llmPing: () => post<{ ok: boolean; ms?: number; reply?: string; error?: string }>('/api/llm/ping', {}),
  llmParse: (query: string, skillIndex: number) => post<{
    ok: boolean; disabled?: boolean; error?: string; form?: string; confidence?: string
    reasoning?: string; patches?: Record<string, unknown>; provider?: string; model?: string; ms?: number; cached?: boolean
  }>('/api/llm/parse', { query, skillIndex }),
  // 解析沉淀（AI 提议入库；是否并入 overrides.mjs 由人工审核决定）
  listParses: (limit = 100) => req<{
    op_id: string; op_name: string | null; skill_idx: number; form: string | null
    patches: Record<string, unknown>; reasoning: string | null; confidence: string | null
    provider: string | null; model: string | null; updated_at: string
  }[]>(`/api/llm/parses?limit=${limit}`),
  exportOverrides: () => req<{ snippet: string; count: number }>('/api/llm/export'),
  deleteParse: (opId: string, skillIdx: number) =>
    req<{ ok: boolean }>(`/api/llm/parses?opId=${encodeURIComponent(opId)}&skillIdx=${skillIdx}`, { method: 'DELETE' }),
}
