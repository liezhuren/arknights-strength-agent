// tools/range.mjs —— 射程几何工具层（2026 新增）
//
// 数据：`data/ranges.json`（来自 `range_table.json`，**一直存在于游戏数据仓库**，此前项目只是没接这一层）。
// 用法要点：射程不只是"能打多远"，它同时决定**站位自由度**与**是否能覆盖多路**，
// 所以给两个量：`tiles`（覆盖格数 → 输出面）与 `reach`/`nearest`（射程/贴脸盲区 → 站位与自保）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
let _cache = null

/** 全部射程（懒加载 + 缓存） */
export function loadRanges() {
  if (!_cache) {
    const raw = JSON.parse(readFileSync(join(HERE, '..', 'data', 'ranges.json'), 'utf8'))
    _cache = raw.ranges ?? {}
  }
  return _cache
}

/** 单个射程 */
export function getRange(id) {
  if (!id) return null
  return loadRanges()[id] ?? null
}

/**
 * 用矩形包围盒 + `row/col` 画成字符图（便于在报告/终端里看形状）。
 * `O` = 干员自身所在格，`█` = 覆盖格，`·` = 空。
 */
export function renderRange(id) {
  const r = getRange(id)
  if (!r) return null
  const rows = r.grids.map((g) => g[0])
  const cols = r.grids.map((g) => g[1])
  const rMin = Math.min(...rows, 0), rMax = Math.max(...rows, 0)
  const cMin = Math.min(...cols, 0), cMax = Math.max(...cols, 0)
  const set = new Set(r.grids.map((g) => `${g[0]},${g[1]}`))
  const out = []
  for (let row = rMax; row >= rMin; row--) {
    let line = ''
    for (let col = cMin; col <= cMax; col++) {
      if (row === 0 && col === 0) line += set.has('0,0') ? 'O' : 'o'
      else line += set.has(`${row},${col}`) ? '█' : '·'
    }
    out.push(line)
  }
  return out
}

/** 单行摘要（进报告） */
export function describeRange(id) {
  const r = getRange(id)
  if (!r) return null
  const bits = [`${r.shape}`, `${r.tiles} 格`, `射程 ${r.reach}`]
  if (r.nearest > 1) bits.push(`**最近只能打到 ${r.nearest} 格**（贴脸盲区）`)
  else if (r.nearest === 1) bits.push('贴脸可打')
  if (!r.containsSelf) bits.push('不含自身格')
  return bits.join(' · ')
}

/**
 * 从干员对象里取"当前生效的射程 id"：
 * 技能改射程优先（银灰 S2 → 1-2、S3 → 3-7），否则用面板射程（精英化后的）。
 */
export function effectiveRangeId(op, skillIndex = null, masteryLevel = 9) {
  if (skillIndex !== null) {
    const levels = op?.skills?.[skillIndex]?.levels ?? []
    // ⚠ 逐档回退：专三档（下标 9）偶尔没有 rangeId 而低档有（全库 1 例）→ 不能只看请求的那一档
    const lv = levels[masteryLevel] ?? levels[levels.length - 1]
    const rid = lv?.rangeId ?? levels.map((l) => l.rangeId).find(Boolean) ?? null
    // 仅当技能射程**确实不同于面板**时才算"技能改射程"（有些技能重复写面板同值）
    if (rid) return { id: rid, source: `S${skillIndex + 1}`, changed: rid !== op?.panel?.rangeId }
  }
  const pid = op?.panel?.rangeId
  return pid ? { id: pid, source: '面板', changed: false } : null
}

/**
 * 报告行：射程几何（附带示意图）。
 * @param {object} op - 干员（数据集对象）
 * @param {number|null} skillIndex
 */
export function formatRangeSection(op, skillIndex = null, masteryLevel = 9) {
  const eff = effectiveRangeId(op, skillIndex, masteryLevel)
  if (!eff) return []
  const r = getRange(eff.id)
  if (!r) return []
  const panel = op?.panel?.rangeId
  const lines = [`射程（${eff.source} ${eff.id}）：${describeRange(eff.id)}`]
  if (panel && panel !== eff.id) {
    const pr = getRange(panel)
    lines.push(`        面板射程 ${panel}：${pr ? `${pr.shape} · ${pr.tiles} 格 · 射程 ${pr.reach}` : '（缺失）'} → 该技能**改变了射程**`)
  }
  const art = renderRange(eff.id)
  if (art && art.length <= 9) {
    for (const l of art) lines.push(`        ${l}`)
    lines.push('        （█ 覆盖格 · 中心 O = 干员自身；row 向上为正）')
  }
  return lines
}
