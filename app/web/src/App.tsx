// App.tsx —— 明日方舟强度评测（本地单机前端）
// 五个页签：干员浏览 / 评测面板（五栏） / 多干员对比 / 自制干员 / 模型设置
// 设计原则：前端只消费 API，不含任何评测逻辑（数值一律来自 app/server → tools/ → engine/）
import { useEffect, useMemo, useState } from 'react'
import { api, type CompareRow, type ConfigView, type EvaluationResult, type OperatorRow } from './api'
import ChartsView from './Charts'

const RARITY_LABEL: Record<string, string> = {
  TIER_1: '1★', TIER_2: '2★', TIER_3: '3★', TIER_4: '4★', TIER_5: '5★', TIER_6: '6★',
}
const PROF_LABEL: Record<string, string> = {
  PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击',
  CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种',
}

type Tab = 'ops' | 'eval' | 'compare' | 'custom' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('ops')
  const [health, setHealth] = useState<{ node: string; modelEnabled: boolean } | null>(null)
  const [facets, setFacets] = useState<{ professions: { profession: string; c: number }[]; rarities: { rarity: string; c: number }[]; subProfessions: { id: string; name: string; profession: string; c: number }[] }>({ professions: [], rarities: [], subProfessions: [] })
  const [q, setQ] = useState('')
  const [prof, setProf] = useState('')
  const [subProf, setSubProf] = useState('')
  const [rows, setRows] = useState<OperatorRow[]>([])
  const [total, setTotal] = useState(0)
  const [current, setCurrent] = useState<OperatorRow | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setErr(String(e.message)))
    api.facets().then(setFacets).catch(() => {})
  }, [])
  useEffect(() => {
    api.search({ q, profession: prof, subProfession: subProf, limit: 60 })
      .then((r) => { setRows(r.rows); setTotal(r.total) })
      .catch((e) => setErr(String(e.message)))
  }, [q, prof, subProf])
  // 只显示当前职业下的分支（选了职业才出分支下拉，避免 72 项过长）
  const subOptions = facets.subProfessions.filter((s) => !prof || s.profession === prof)

  const openEval = (op: OperatorRow) => { setCurrent(op); setTab('eval') }

  return (
    <div className="app">
      <header>
        <img className="logo" src="./logo.png" alt="logo" />
        <h1>明日方舟 · 强度评测</h1>
        <div className="status">
          {health ? <>API 就绪（{health.node}） · 模型：{health.modelEnabled ? '已启用' : '未启用（纯规则层）'}</> : '连接 API 中…'}
        </div>
      </header>
      {err && <div className="err">⚠ {err} <button onClick={() => setErr('')}>×</button></div>}

      <nav>
        {([['ops', '干员浏览'], ['eval', '评测面板'], ['compare', '多干员对比'], ['custom', '自制干员'], ['settings', '模型设置']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>

      {tab === 'ops' && (
        <section>
          <div className="bar">
            <input placeholder="搜索干员（名称/ID）" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={prof} onChange={(e) => { setProf(e.target.value); setSubProf('') }}>
              <option value="">全部职业</option>
              {facets.professions.map((p) => <option key={p.profession} value={p.profession}>{PROF_LABEL[p.profession] ?? p.profession}（{p.c}）</option>)}
            </select>
            <select value={subProf} onChange={(e) => setSubProf(e.target.value)} title="分支（子职业）">
              <option value="">全部分支{prof ? `（${subOptions.length}）` : `（${facets.subProfessions.length}）`}</option>
              {subOptions.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.c}）</option>)}
            </select>
            <span className="muted">共 {total} 名</span>
          </div>
          <table>
            <thead><tr><th>干员</th><th>稀有度</th><th>职业 / 分支</th><th>ATK</th><th>DEF</th><th>生命</th><th>费用</th><th>分支特性</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td>
                  <td>{RARITY_LABEL[r.rarity] ?? r.rarity}</td>
                  <td className="muted">
                    {PROF_LABEL[r.profession] ?? r.profession}
                    <span className="branch">/ {r.sub_profession_name ?? r.sub_profession}</span>
                  </td>
                  <td>{r.atk}</td><td>{r.def}</td><td>{r.max_hp}</td><td>{r.cost}</td>
                  <td className="trait">{(r.trait_desc ?? '').replace(/<[^>]+>/g, '').slice(0, 28)}</td>
                  <td><button onClick={() => openEval(r)}>评测</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'eval' && <EvalPanel op={current} onPick={() => setTab('ops')} onError={setErr} />}
      {tab === 'compare' && <ComparePanel initial={current?.id} onError={setErr} />}
      {tab === 'custom' && <CustomPanel onError={setErr} />}
      {tab === 'settings' && <SettingsPanel onError={setErr} />}

      <footer className="credit">
        <b>数据来源</b>：干员/技能/模组数值抓取自 GitHub 开源项目{' '}
        <a href="https://github.com/Kengxxiao/ArknightsGameData" target="_blank" rel="noreferrer">Kengxxiao/ArknightsGameData</a>
        ，机制与模组数值交叉校验引用 <a href="https://prts.wiki" target="_blank" rel="noreferrer">PRTS Wiki</a>。
        <br />
        《明日方舟》及相关素材版权归<b>上海鹰角网络科技有限公司</b>所有；本项目为<b>非商业性研究/学习工具</b>，
        与鹰角网络无关联，数值引擎与评测标准为独立实现，不保证与游戏内实际表现一致。
      </footer>
    </div>
  )
}

/** 评测面板：关键数值 + 五栏（关键点各自独立成栏，不与输出合并） */
function EvalPanel({ op, onPick, onError }: { op: OperatorRow | null; onPick: () => void; onError: (s: string) => void }) {
  const [data, setData] = useState<EvaluationResult | null>(null)
  const [skill, setSkill] = useState(2)
  const [mod, setMod] = useState('')
  const [dmg, setDmg] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState<{ ok: boolean; disabled?: boolean; error?: string; form?: string; confidence?: string; reasoning?: string; patches?: Record<string, unknown>; model?: string; ms?: number } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  // 轴参数（玩法层）：仅爆发型技能需要。留空 = 用补丁里的理想轴
  const [axisD, setAxisD] = useState('')
  const [axisW, setAxisW] = useState('')

  useEffect(() => { if (op) run() /* eslint-disable-next-line */ }, [op])

  /** 交给模型做长尾机制解析（规则层覆盖不到时才需要；未配置模型会明确提示） */
  async function askAi() {
    if (!op) return
    setAiBusy(true)
    try { setAi(await api.llmParse(op.id, skill)) } catch (e) { onError((e as Error).message) } finally { setAiBusy(false) }
  }

  async function run() {
    if (!op) return
    setBusy(true)
    try {
      setData(await api.evaluate({
        query: op.id, skillIndex: skill, moduleSpec: mod || undefined, damageType: dmg,
        axis: axisD || axisW ? { deploys: axisD ? Number(axisD) : undefined, windowSec: axisW ? Number(axisW) : undefined } : undefined,
      }))
    } catch (e) { onError((e as Error).message); setData(null) } finally { setBusy(false) }
  }
  if (!op) return <section className="empty">请先在「干员浏览」里选择一名干员 <button onClick={onPick}>去选择</button></section>

  const r = data?.result
  const bench = r?.benchmark ?? {}
  const key = r?.damageType === 'physical' ? 'Vs400Def' : 'Vs50Res'
  const sections: [string, string | null][] = [
    ['泛用性（关键点）', r?.versatilitySection ?? null],
    ['操作难度（关键点）', r?.difficultySection ?? null],
    ['回转（关键点）', r?.rotationSection ?? null],
    ['团队增益', r?.teamBuffSection ?? null],
    ['控制', r?.controlSection ?? null],
    ['生存（锦上添花但关键）', r?.survivalSection ?? null],
  ]
  return (
    <section>
      <div className="bar">
        <b>{op.name}</b>
        <select value={skill} onChange={(e) => setSkill(Number(e.target.value))}>
          <option value={0}>S1</option><option value={1}>S2</option><option value={2}>S3</option>
        </select>
        <select value={dmg} onChange={(e) => setDmg(e.target.value)}>
          <option value="auto">伤害类型自动</option><option value="physical">物理</option>
          <option value="magical">法术</option><option value="true">真实</option>
        </select>
        <select value={mod} onChange={(e) => setMod(e.target.value)}>
          <option value="">无模组</option>
          {data?.modules.filter((m) => m.hasCombatData).map((m) => (
            <option key={m.id} value={m.id}>{m.name}（{m.type}{m.isSpecial ? '·特限' : ''}）</option>
          ))}
        </select>
        <button onClick={run} disabled={busy}>{busy ? '评测中…' : '评测'}</button>
        <button onClick={askAi} disabled={aiBusy} title="把技能原文交给模型做长尾机制解析（需在「模型设置」配置 provider）">
          {aiBusy ? 'AI 解析中…' : 'AI 解析技能描述'}
        </button>
        {r?.burst && (
          <span className="axis">
            轴参数：
            <input style={{ width: 62 }} placeholder={`${r.burst.deploys}`} value={axisD} onChange={(e) => setAxisD(e.target.value)} title="轴内部署次数（留空=理想轴）" />
            次部署 /
            <input style={{ width: 62 }} placeholder={`${r.burst.windowSec}`} value={axisW} onChange={(e) => setAxisW(e.target.value)} title="轴长（秒）" />
            秒
            <button onClick={run}>按此轴重算</button>
            {r.burst.axisFromUser && <em className="muted">（当前为用户给定轴）</em>}
          </span>
        )}
      </div>

      {ai && (
        <div className={ai.ok ? 'trait-line' : 'warn'}>
          {ai.disabled
            ? `未启用模型：${ai.error}`
            : ai.ok
              ? <>AI 解析（{ai.model}，{ai.ms}ms）：形态 <b>{ai.form}</b> · 置信度 {ai.confidence}<br />
                  依据：{ai.reasoning}<br />
                  <code>{JSON.stringify(ai.patches)}</code></>
              : `AI 解析失败：${ai.error}`}
        </div>
      )}

      {r && (
        <>
          <div className="cards">
            <Card title="技能期 DPS" value={bench[`skillDps${key}`]?.toFixed(1) ?? '—'} />
            <Card title="平均 DPS" value={bench[`avgDps${key}`]?.toFixed(1) ?? '—'} />
            <Card title="覆盖率" value={`${((r.coverage ?? 0) * 100).toFixed(1)}%`} />
            <Card title="费效" value={bench[`costEff${key}`]?.toFixed(1) ?? '—'} />
            <Card title="面板 ATK" value={r.panel.atk.toFixed(1)} />
          </div>
          {r.trait && <p className="trait-line">分支特性：{r.trait}</p>}
          {r.moduleApplied?.entry && (
            <p className="trait-line">模组：{r.moduleApplied.entry.name}（{r.moduleApplied.entry.type} L{r.moduleApplied.level?.level}）
              {Object.entries(r.moduleApplied.attr ?? {}).map(([k, v]) => ` ${k}${v > 0 ? '+' : ''}${v}`)}
            </p>
          )}
          {r.moduleApplied?.warnings?.map((w, i) => <p key={i} className="warn">⚠ {w}</p>)}
          {data.charts && <ChartsView charts={data.charts} />}
          <div className="sections">
            {sections.filter(([, s]) => s).map(([title, s]) => (
              <div className="panel" key={title}>
                <h3>{title}</h3>
                <pre>{s}</pre>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Card({ title, value }: { title: string; value: string }) {
  return <div className="card"><span>{title}</span><b>{value}</b></div>
}

/** 多干员对比 */
function ComparePanel({ initial, onError }: { initial?: string; onError: (s: string) => void }) {
  const [text, setText] = useState(initial ?? '银灰, 史尔特尔, 能天使')
  const [rows, setRows] = useState<CompareRow[]>([])
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const list = text.split(/[,，\s]+/).filter(Boolean)
      setRows((await api.compare(list)).rows)
    } catch (e) { onError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <section>
      <div className="bar">
        <input style={{ minWidth: 360 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="用逗号分隔，最多 6 名" />
        <button onClick={run} disabled={busy}>{busy ? '对比中…' : '对比'}</button>
      </div>
      {!!rows.length && (
        <table>
          <thead><tr><th>干员</th><th>技能</th><th>类型</th><th>技能期 DPS</th><th>平均 DPS</th><th>覆盖</th><th>泛用性</th><th>操作难度</th><th>首轮</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.query}>
                <td><b>{r.name ?? r.query}</b></td>
                <td className="muted">{r.skill ?? r.error}</td>
                <td>{r.damageType === 'physical' ? '物理' : r.damageType === 'magical' ? '法术' : r.damageType}</td>
                <td>{r.benchmark ? (r.benchmark.skillDpsVs400Def ?? r.benchmark.skillDpsVs50Res)?.toFixed(1) : '—'}</td>
                <td>{r.benchmark ? (r.benchmark.avgDpsVs400Def ?? r.benchmark.avgDpsVs50Res)?.toFixed(1) : '—'}</td>
                <td>{r.coverage !== undefined ? `${(r.coverage * 100).toFixed(1)}%` : '—'}</td>
                <td>{r.tier ?? '—'}</td><td>{r.difficulty ?? '—'}</td>
                <td>{r.firstUse ? `${r.firstUse}s` : '永续/—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// 严格对齐 engine/custom-operator.schema.json（additionalProperties:false —— 多余字段会被拒）
const SAMPLE = {
  name: '自制演示·蓝闪', rarity: 6, archetype: '术师-核心术师',
  atk: 700, maxHp: 1800, def: 200, res: 10, cost: 20, blockCount: 1,
  baseInterval: 1.5, damageType: 'magical', hitCount: 1, targetCount: 1,
  skill: { name: '高压水刃', spType: 'auto', spCost: 40, spStart: 20, duration: 25, attackMult: 2.5, hits: 3, targetCount: 4 },
}

/** 自制干员：编辑 JSON → 校验 → 保存 / 评测 */
function CustomPanel({ onError }: { onError: (s: string) => void }) {
  const [text, setText] = useState(JSON.stringify(SAMPLE, null, 2))
  const [errors, setErrors] = useState<string[]>([])
  const [report, setReport] = useState('')
  const [saved, setSaved] = useState<{ id: number; name: string; updated_at: string }[]>([])
  const refresh = () => api.listCustom().then(setSaved).catch(() => {})
  useEffect(() => { refresh() }, [])
  const parse = () => { try { return JSON.parse(text) } catch (e) { setErrors([`JSON 语法错误：${(e as Error).message}`]); return null } }

  async function save() {
    const data = parse(); if (!data) return
    const r = await api.saveCustom(data)
    setErrors(r.ok ? [] : r.errors ?? [])
    if (r.ok) refresh()
  }
  async function run() {
    const data = parse(); if (!data) return
    try { const r = await api.evaluateCustom(data); setReport(r.report ?? JSON.stringify(r.result, null, 2)) }
    catch (e) { onError((e as Error).message) }
  }
  return (
    <section className="split">
      <div>
        <div className="bar">
          <button onClick={save}>保存到数据库</button>
          <button onClick={run}>评测</button>
          <button onClick={() => setText(JSON.stringify(SAMPLE, null, 2))}>恢复示例</button>
        </div>
        <textarea rows={22} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {errors.length > 0 && <div className="err">校验失败：<ul>{errors.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      </div>
      <div>
        <h3>已保存的自制干员（{saved.length}）</h3>
        <ul className="list">
          {saved.map((c) => (
            <li key={c.id}><b>{c.name}</b> <span className="muted">{c.updated_at}</span>
              <button onClick={async () => { await api.deleteCustom(c.name); refresh() }}>删除</button></li>
          ))}
        </ul>
        {report && <><h3>评测输出</h3><pre className="panel">{report}</pre></>}
      </div>
    </section>
  )
}

/** 解析沉淀：AI 提议入库的机制补丁，可导出 overrides.mjs 片段供人工审核 */
function ParseSink({ onError }: { onError: (s: string) => void }) {
  const [rows, setRows] = useState<{ op_id: string; op_name: string | null; skill_idx: number; form: string | null; patches: Record<string, unknown>; reasoning: string | null; confidence: string | null; provider: string | null; model: string | null; updated_at: string }[]>([])
  const [snippet, setSnippet] = useState('')
  const refresh = () => api.listParses().then(setRows).catch((e) => onError((e as Error).message))
  useEffect(() => { refresh() }, [])
  return (
    <>
      <h3>解析沉淀（{rows.length}）</h3>
      <p className="muted">
        AI 的解析结果会自动入库，二次请求直接命中缓存（不再耗额度）。
        <b>导出片段必须人工审核后才能并入 `tools/overrides.mjs`</b> —— 未经审核的模型输出不会影响任何数值。
      </p>
      <div className="bar">
        <button onClick={() => api.exportOverrides().then((r) => setSnippet(r.snippet)).catch((e) => onError((e as Error).message))}>导出审核片段</button>
        <button onClick={refresh}>刷新</button>
      </div>
      <ul className="list">
        {rows.map((r) => (
          <li key={`${r.op_id}-${r.skill_idx}`}>
            <b>{r.op_name ?? r.op_id}</b>
            <span className="muted">S{r.skill_idx + 1} · {r.form ?? '—'} · {r.confidence ?? '?'} · {r.provider}/{r.model} · {r.updated_at}</span>
            <button onClick={async () => { await api.deleteParse(r.op_id, r.skill_idx); refresh() }}>删除</button>
          </li>
        ))}
        {!rows.length && <li className="muted">暂无 —— 在「评测面板」点「AI 解析技能描述」后会自动沉淀</li>}
      </ul>
      {snippet && <><h3>审核片段（复制进 tools/overrides.mjs）</h3><pre className="panel">{snippet}</pre></>}
    </>
  )
}

/** 模型设置（BYOK 多 provider；不填 Key 时走纯规则层，功能完整） */
function SettingsPanel({ onError }: { onError: (s: string) => void }) {
  const [cfg, setCfg] = useState<ConfigView | null>(null)
  const [edit, setEdit] = useState<Record<string, { apiKey?: string; model?: string; baseURL?: string }>>({})
  useEffect(() => { api.config().then(setCfg).catch((e) => onError((e as Error).message)) }, [])
  const providers = useMemo(() => Object.entries(cfg?.providers ?? {}), [cfg])

  async function save() {
    if (!cfg) return
    try { setCfg(await api.saveConfig({ provider: cfg.provider, providers: edit })); setEdit({}) }
    catch (e) { onError((e as Error).message) }
  }
  if (!cfg) return <section className="empty">读取配置中…</section>
  return (
    <section>
      <p className="muted">模型用于长尾技能描述的语义解析与自然语言评注。<b>不配置也能用</b> —— 规则层已覆盖大部分机制。</p>
      <div className="bar">
        <label>启用的 provider：</label>
        <select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value })}>
          <option value="">不启用（纯规则层）</option>
          {providers.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={save}>保存</button>
      </div>
      <table>
        <thead><tr><th>provider</th><th>Base URL</th><th>模型</th><th>API Key</th></tr></thead>
        <tbody>
          {providers.map(([k, v]) => (
            <tr key={k}>
              <td><b>{v.label}</b></td>
              <td><input defaultValue={v.baseURL} onChange={(e) => setEdit((s) => ({ ...s, [k]: { ...s[k], baseURL: e.target.value } }))} /></td>
              <td><input defaultValue={v.model} onChange={(e) => setEdit((s) => ({ ...s, [k]: { ...s[k], model: e.target.value } }))} /></td>
              <td><input placeholder={v.apiKey || '未设置（本地存储，不回显）'} onChange={(e) => setEdit((s) => ({ ...s, [k]: { ...s[k], apiKey: e.target.value } }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bar">
        <button onClick={async () => { try { const r = await api.llmPing(); onError(r.ok ? '' : `连通失败：${r.error}`); if (r.ok) alert(`连通正常（${r.ms}ms）`) } catch (e) { onError((e as Error).message) } }}>测试连接</button>
      </div>
      <ParseSink onError={onError} />
    </section>
  )
}
