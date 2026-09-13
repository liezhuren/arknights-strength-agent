// Charts.tsx —— 图形化呈现（纯 SVG/CSS，不引图表库）
// 设计：每个图都**直接从 API 的 charts 结构化数据**画，与文本报告同源同口径。
// 类名约定见 styles.css：.cbar = 图表横条（.bar 是筛选行容器，勿混用）
import type { Charts } from './api'

const pct = (v: number) => `${(v * 100).toFixed(0)}%`

/** 泛用性：六场景横向条 + 可用线标记（p25 灰线 / p50 白线） */
function VersatilityChart({ v }: { v: Charts['versatility'] }) {
  const max = Math.max(...v.rows.map((r) => Math.max(r.value, r.p50)), 1)
  return (
    <div className="chart">
      <div className="chart-head">
        <h3>泛用性 · 六场景输出与可用线</h3>
        <span className={`chip ${v.tier === '全能型' ? 'good' : v.tier === '特化型' ? 'bad' : ''}`}>{v.tier}</span>
        <span className="muted">稳健线 {v.coverageP50}/6 · 基本线 {v.coverageP25}/6 · 波动比 {v.worstOverMedian.toFixed(2)}</span>
      </div>
      {v.rows.map((r) => (
        <div className="chartrow" key={r.id}>
          <span className="rl">{r.name}<em>DEF{r.def}/RES{r.res}</em></span>
          <div className="track">
            <div className={`cbar ${r.ok50 ? 'ok' : r.ok25 ? 'mid' : 'low'}`} style={{ width: `${(r.value / max) * 100}%` }} />
            <span className="mark m25" style={{ left: `${(r.p25 / max) * 100}%` }} title={`基本可用线 ${Math.round(r.p25)}`} />
            <span className="mark m50" style={{ left: `${(r.p50 / max) * 100}%` }} title={`稳健线 ${Math.round(r.p50)}`} />
          </div>
          <span className="rv">{Math.round(r.value)}</span>
        </div>
      ))}
      <div className="legend">
        <span><i className="sw ok" /> 达稳健线</span>
        <span><i className="sw mid" /> 达基本线</span>
        <span><i className="sw low" /> 低于可用线</span>
        <span><i className="mk" /> 竖线 = p25 / p50 可用线</span>
      </div>
    </div>
  )
}

/** 属性衰减曲线（物理看 DEF、法术看 RES） */
function DecayChart({ decay, phys }: { decay: Charts['decay']; phys: boolean }) {
  const max = Math.max(...decay.map((d) => d.value), 1)
  const W = 320, H = 90, pad = 6
  const pts = decay.map((d, i) => {
    const x = pad + (i / (decay.length - 1)) * (W - pad * 2)
    const y = H - pad - (d.value / max) * (H - pad * 2)
    return { ...d, x, y }
  })
  return (
    <div className="chart">
      <div className="chart-head">
        <h3>属性衰减</h3>
        <span className="muted">{phys ? 'DEF' : 'RES'} 升高时的输出（越平越泛用）</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="spark">
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4da3ff" strokeWidth="2" />
        {pts.map((p) => <circle key={p.x} cx={p.x} cy={p.y} r="3" fill="#4da3ff" />)}
      </svg>
      <div className="decay-axis">
        {pts.map((p) => <span key={p.x} style={{ left: `${(p.x / W) * 100}%` }}>{p.x}<em>{Math.round(p.value)}</em></span>)}
      </div>
    </div>
  )
}

/** 回转：一个完整周期的时间轴（充能 → 技能期 → 空窗） */
function RotationChart({ r }: { r: NonNullable<Charts['rotation']> }) {
  if (r.permanent) {
    return (
      <div className="chart">
        <div className="chart-head"><h3>回转</h3><span className="chip good">永续</span></div>
        <p className="muted">开启后长期生效，无充能周期（覆盖率 100%）</p>
      </div>
    )
  }
  const total = (r.cycle ?? 1) || 1
  const chargeW = ((r.firstUse ?? 0) / total) * 100
  const durW = (r.duration / total) * 100
  // 窄段不渲染文字，否则会被 overflow 裁成半截字（看起来像坏掉的色条）
  const label = (w: number, text: string) => (w >= 17 ? text : '')
  return (
    <div className="chart">
      <div className="chart-head">
        <h3>回转 · 一个完整周期</h3>
        <span className="muted">覆盖率 {pct(r.coverage)} · 60s 内可开 {r.casts60} 次 · 90s 内 {r.casts90} 次</span>
      </div>
      <div className="timeline">
        <div className="seg charge" style={{ width: `${chargeW}%` }} title={`充能 ${r.firstUse}s（首轮可用）`}>{label(chargeW, `充能 ${r.firstUse}s`)}</div>
        <div className="seg active" style={{ width: `${durW}%` }} title={`技能期 ${r.duration}s`}>{label(durW, `技能 ${r.duration}s`)}</div>
        <div className="seg down" style={{ width: `${100 - chargeW - durW}%` }} title={`空窗 ${r.downtime}s`}>{label(100 - chargeW - durW, `空窗 ${r.downtime}s`)}</div>
      </div>
      <div className="legend">
        <span><i className="sw charge" /> 充能 {r.firstUse}s（首轮可用）</span>
        <span><i className="sw active" /> 技能期 {r.duration}s</span>
        <span><i className="sw down" /> 空窗 {r.downtime}s</span>
        <span className="muted">{r.spLabel} · 消耗 {r.spCost} · 初始 {r.initSp}{r.ammo ? ' · 弹药型' : ''}</span>
      </div>
    </div>
  )
}

/** 生存：分档硬扛（每击伤害 + 可挨击数） */
function SurvivalChart({ s }: { s: Charts['survival'] }) {
  const rows = s.normal
  const maxHit = Math.max(...rows.map((x) => x.perHit), 1)
  const skillMap = new Map((s.skill ?? []).map((x) => [x.id, x]))
  return (
    <div className="chart">
      <div className="chart-head">
        <h3>生存 · 分档硬扛</h3>
        {s.stateNote && <span className="chip mid" title={s.stateNote}>分支两态</span>}
      </div>
      {rows.map((x) => {
        const sk = skillMap.get(x.id)
        const better = sk && sk.perHit < x.perHit
        return (
          <div className="chartrow" key={x.id}>
            <span className="rl">{x.id}<em>{x.dps} DPS</em></span>
            <div className="track">
              <div className={`cbar ${x.sustained ? 'ok' : 'mid'}`} style={{ width: `${(x.perHit / maxHit) * 100}%` }} />
              {sk && <div className="cbar ghost" style={{ width: `${(sk.perHit / maxHit) * 100}%` }} title={`技能期每击 ${sk.perHit}`} />}
            </div>
            <span className="rv">
              每击 {x.perHit} · {x.sustained ? '站得住' : `${x.hitsToDie} 击 / ${x.seconds}s`}
              {better && <em className="up">技能期 →{sk!.perHit}</em>}
            </span>
          </div>
        )
      })}
      <div className="legend">
        {s.dodge.physical > 0 && <span>物理闪避 {pct(s.dodge.physical)}</span>}
        {s.dodge.magical > 0 && <span>法术闪避 {pct(s.dodge.magical)}</span>}
        {s.healPerSec > 0 && <span>自回 {s.healPerSec.toFixed(1)} HP/s</span>}
        {s.immune.length > 0 && <span>免疫：{s.immune.join('/')}</span>}
        <span className="muted">条长 = 每击伤害（越短越硬）</span>
      </div>
    </div>
  )
}

/** 操作难度：因素分级色块 */
function DifficultyChart({ d }: { d: Charts['difficulty'] }) {
  const label: Record<number, string> = { 3: '高', 2: '中', 1: '低', 0: '无' }
  return (
    <div className="chart">
      <div className="chart-head">
        <h3>操作难度 · 客观因素</h3>
        <span className={`chip ${d.tier === '高' ? 'bad' : d.tier === '低' ? 'good' : 'mid'}`}>{d.tier}</span>
        <span className="muted">加权 {d.score} 分（仅供参考排序）</span>
      </div>
      {d.factors.map((f, i) => (
        <div className="factor" key={i}>
          <span className={`lv lv${f.level}`}>{label[f.level] ?? f.level}</span>
          <b>{f.kind}</b>
          <span className="muted">{f.text}</span>
        </div>
      ))}
    </div>
  )
}

export default function ChartsView({ charts }: { charts: Charts }) {
  return (
    <div className="charts">
      <VersatilityChart v={charts.versatility} />
      <DecayChart decay={charts.decay} phys={charts.versatility.phys} />
      {charts.rotation && <RotationChart r={charts.rotation} />}
      <SurvivalChart s={charts.survival} />
      <DifficultyChart d={charts.difficulty} />
    </div>
  )
}
