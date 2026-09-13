// API 客户端：与 app/server 的接口一一对应（开发模式经 vite proxy，生产由 server 静态托管同源）
export type Rarity = 'TIER_1' | 'TIER_2' | 'TIER_3' | 'TIER_4' | 'TIER_5' | 'TIER_6'

export interface OperatorRow {
  id: string; name: string; rarity: Rarity; rarity_num: number; profession: string
  sub_profession: string; atk: number; def: number; max_hp: number; cost: number
  block_cnt: number; trait_desc: string | null
}
export interface SearchResult { total: number; rows: OperatorRow[] }
export interface ModuleInfo { id: string; name: string; type: string; isSpecial: boolean; hasCombatData: boolean }

export interface EvaluationResult {
  operator: { id: string; name: string; rarity: string; profession: string; subProfessionId: string }
  modules: ModuleInfo[]
  report: string
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
    panel: { atk: number; baseInterval: number; cost: number }
    talentList: string[]
    trait: string | null
    moduleApplied: { entry: { name: string; type: string } | null; level: { level: number } | null; attr: Record<string, number>; warnings: string[] } | null
  }
}
export interface CompareRow {
  query: string; name?: string; skill?: string; damageType?: string
  benchmark?: Record<string, number>; coverage?: number
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
  facets: () => req<{ professions: { profession: string; c: number }[]; rarities: { rarity: string; c: number }[] }>('/api/facets'),
  search: (p: { q?: string; profession?: string; rarity?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    return req<SearchResult>(`/api/operators?${qs}`)
  },
  detail: (id: string) => req<Record<string, unknown>>(`/api/operators/${encodeURIComponent(id)}`),
  scenarios: () => req<{ scenarios: unknown[]; threats: unknown[]; baseline: unknown[] }>('/api/scenarios'),
  evaluate: (p: { query: string; skillIndex?: number; moduleSpec?: string; moduleLevel?: number; damageType?: string }) =>
    post<EvaluationResult>('/api/evaluate', p),
  compare: (queries: string[], skillIndex = 2) => post<{ rows: CompareRow[] }>('/api/compare', { queries, skillIndex }),
  listCustom: () => req<{ id: number; name: string; data: Record<string, unknown>; updated_at: string }[]>('/api/custom'),
  saveCustom: (data: unknown) => post<{ ok: boolean; errors?: string[]; name?: string }>('/api/custom', { data }),
  deleteCustom: (name: string) => req<{ ok: boolean }>(`/api/custom?name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
  evaluateCustom: (data: unknown) => post<{ result: unknown; report: string | null }>('/api/custom/evaluate', { data }),
  config: () => req<ConfigView>('/api/config'),
  saveConfig: (body: unknown) => post<ConfigView>('/api/config', body),
  // BYOK 模型：长尾机制解析（未启用模型时返回 disabled，规则层不受影响）
  llmStatus: () => req<{ enabled: boolean; provider?: string; model?: string; kind?: string; hasKey?: boolean; hint?: string }>('/api/llm/status'),
  llmPing: () => post<{ ok: boolean; ms?: number; reply?: string; error?: string }>('/api/llm/ping', {}),
  llmParse: (query: string, skillIndex: number) => post<{
    ok: boolean; disabled?: boolean; error?: string; form?: string; confidence?: string
    reasoning?: string; patches?: Record<string, unknown>; provider?: string; model?: string; ms?: number
  }>('/api/llm/parse', { query, skillIndex }),
}
