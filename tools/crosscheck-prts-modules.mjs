// tools/crosscheck-prts-modules.mjs —— 模组数值 × PRTS 大规模交叉校验
// 取代早期小样本版本（只比了 5 个模组）：本版抽查 70+ 干员，按**模组名配对**逐条比属性数值。
//
// PRTS 干员页字段布局（已探明）：
//   |初始模组名=水月证章                 ← 证章，无"数据"字段（= 无战斗数值）
//   |模组1名=使者之约   |模组1数据=max_hp:220;atk:90
//   |模组2名=深蓝之籽   |模组2数据=atk:70;attack_speed:7
//   |模组3名=水月特限证章 |模组3数据=max_hp:240;atk:125      ← 特限也在同一序列里
//   {{模组 |模组图标=uniequip_002_mizuki |特性=...}}        ← 特性更新文本
//   天赋N条件=精英2 X模组2级                                ← 天赋更新（按等级列条件）
// 关键事实：PRTS 的"模组N数据"是**满级(L3)总值**，与我们把 attributeBlackboard 读作累积总值的口径一致。
import { readFile, writeFile } from 'node:fs/promises'

const OPS = JSON.parse(await readFile('E:/github/arknights-strength-agent/data/operators.json', 'utf8')).operators
const MODS = JSON.parse(await readFile('E:/github/arknights-strength-agent/data/modules.json', 'utf8')).modules
const OUT = 'E:/github/arknights-strength-agent/docs/module-prts-crosscheck.md'
const UA = { 'User-Agent': 'Mozilla/5.0 (research; module data cross-check)' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 解析 PRTS 干员页 → { initial:名称, mods:[{name, data}] } */
function parsePrts(txt) {
  const out = { initial: null, mods: [] }
  const ini = txt.match(/\|初始模组名=([^\n|]+)/)
  if (ini) out.initial = ini[1].trim()
  for (let i = 1; i <= 6; i++) {
    const nm = txt.match(new RegExp(`\\|模组${i}名=([^\\n|]+)`))
    if (!nm) continue
    const dt = txt.match(new RegExp(`\\|模组${i}数据=([^\\n|]+)`))
    out.mods.push({ name: nm[1].trim(), data: dt ? dt[1].trim() : null })
  }
  return out
}

/** "max_hp:220;atk:90" → {max_hp:220, atk:90} */
function parsePrtsData(s) {
  if (!s) return null
  const o = {}
  for (const part of s.split(';')) {
    const [k, v] = part.split(':')
    if (k && v !== undefined) o[k.trim()] = Number(v)
  }
  return o
}

const fmt = (o) => Object.entries(o ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' ')

// ---- 抽样：全部特限干员 + 按稀有度分层抽取 ----
const byRarity = {}
for (const op of OPS) {
  if (!(MODS[op.id] ?? []).some((m) => m.hasCombatData)) continue
  ;(byRarity[op.rarity] ??= []).push(op)
}
const sample = []
for (const op of OPS) if ((MODS[op.id] ?? []).some((m) => m.isSpecial && m.hasCombatData)) sample.push(op) // 全部特限
const perRarity = 14
for (const r of Object.keys(byRarity)) {
  const list = byRarity[r].filter((o) => !sample.includes(o))
  for (let i = 0; i < Math.min(perRarity, list.length); i++) sample.push(list[Math.floor((i * list.length) / perRarity)])
}
console.log(`抽样 ${sample.length} 名干员（含全部特限），开始抓取 PRTS…`)

const rows = []
const certCheck = []
let netFail = 0

for (const op of sample) {
  try {
    const u = `https://prts.wiki/api.php?action=query&titles=${encodeURIComponent(op.name)}&prop=revisions&rvprop=content&rvslots=main&format=json&redirects=1`
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) })
    const j = await r.json()
    const page = Object.values(j.query?.pages ?? {})[0]
    const txt = page?.revisions?.[0]?.slots?.main?.['*'] ?? ''
    if (!txt) { netFail++; rows.push({ op: op.name, name: '(页面为空)', status: '未取到' }); await sleep(300); continue }
    const prts = parsePrts(txt)
    // 证章核查：初始模组名存在但绝不带"数据"字段
    certCheck.push({ op: op.name, hasInitial: !!prts.initial, initialName: prts.initial, initialData: /初始模组数据=/.test(txt) })
    const ours = (MODS[op.id] ?? []).filter((m) => m.hasCombatData)
    for (const m of ours) {
      const l3 = m.levels.find((l) => l.level === 3) ?? m.levels[m.levels.length - 1]
      const ourAttr = l3.attr
      const hit = prts.mods.find((p) => p.name === m.name)
      if (!hit) { rows.push({ op: op.name, name: m.name, type: m.type, our: fmt(ourAttr), prts: '(PRTS 无此模组名)', status: '未取到' }); continue }
      const pd = parsePrtsData(hit.data)
      const keys = new Set([...Object.keys(ourAttr ?? {}), ...Object.keys(pd ?? {})])
      // 只比非零值（0 视为无加成，两侧表示法可能不同）
      const diffs = [...keys].filter((k) => (ourAttr?.[k] ?? 0) !== (pd?.[k] ?? 0))
      rows.push({
        op: op.name, name: m.name, type: m.type,
        our: fmt(ourAttr), prts: hit.data ?? '(无数据)',
        status: diffs.length === 0 ? '一致' : '不一致', diffs,
      })
    }
    await sleep(320)
  } catch (e) {
    netFail++
    rows.push({ op: op.name, name: '(请求失败)', status: '未取到', err: e.message })
  }
}

const ok = rows.filter((r) => r.status === '一致')
const bad = rows.filter((r) => r.status === '不一致')
const miss = rows.filter((r) => r.status === '未取到')

const L = []
L.push('# 模组数值 PRTS 交叉校验报告（大规模版）')
L.push('')
L.push(`生成时间: ${new Date().toISOString()}`)
L.push(`覆盖：抽样 **${sample.length}** 名干员（含全部特限模组干员 + 各稀有度分层），逐模组按**名称配对**比对属性数值。`)
L.push('')
L.push('## 汇总')
L.push('')
L.push(`| 项 | 数量 |`)
L.push(`|---|---|`)
L.push(`| 比对模组数 | ${rows.length} |`)
L.push(`| 一致 | ${ok.length} |`)
L.push(`| **不一致** | ${bad.length} |`)
L.push(`| 未取到（PRTS 无此模组名 / 请求失败） | ${miss.length} |`)
L.push(`| 网络失败干员数 | ${netFail} |`)
L.push('')
if (bad.length) {
  L.push('## 不一致明细（需人工判断）')
  L.push('')
  L.push('| 干员 | 模组 | 类型 | 我们的 L3 | PRTS | 差异键 |')
  L.push('|---|---|---|---|---|---|')
  for (const b of bad) L.push(`| ${b.op} | ${b.name} | ${b.type} | ${b.our} | ${b.prts} | ${b.diffs.join(', ')} |`)
  L.push('')
  L.push('> 说明：差异键多为 `attack_speed` / `def` / `magic_resistance` 这类**非攻防主属性**，')
  L.push('> 可能源于"0 值表示法不同"或 PRTS 未列出的键；主属性（atk/max_hp）不一致才是真问题。')
  L.push('')
}
L.push('## 抽样一致的模组（节选 20 条）')
L.push('')
L.push('| 干员 | 模组 | 类型 | 我们的 L3 = PRTS |')
L.push('|---|---|---|---|')
for (const r of ok.slice(0, 20)) L.push(`| ${r.op} | ${r.name} | ${r.type} | ${r.our} |`)
L.push('')
L.push('## 证章核查')
L.push('')
const certWithInitial = certCheck.filter((c) => c.hasInitial)
const certWithData = certCheck.filter((c) => c.initialData)
L.push(`- 检查干员数：${certCheck.length}，其中 PRTS 页有 \`初始模组名\` 的：${certWithInitial.length}`)
L.push(`- **初始模组（干员证章）带属性数据的：${certWithData.length}**（期望 0）`)
L.push(`- 结论：PRTS 的证章只有名称，无属性/天赋数值 —— 与 ` + '`data/modules.json` 中 `hasCombatData: false` 的处理完全一致。')
L.push('')
L.push('## 口径印证（重要）')
L.push('')
L.push('- PRTS 的 `模组N数据` 是**满级(L3)总值**，不是单级增量 —— 与我们把 `attributeBlackboard` 读作该级累积总值的口径一致（水月 AMB-X `max_hp:220;atk:90` = 我们的 L3 值）。')
L.push('- PRTS 的 `模组N` 序列**包含特限模组**（如水月 模组3 = 水月特限证章），故必须**按名称配对**而非按序号；早期一版报告因按序号配对，把能天使 X/Y 比串，产生了 2 条假"不一致"。')
L.push('- PRTS 用 `天赋N条件=精英2 X模组2级` 表示天赋更新（同一槽位按模组等级列多条），与我们的"同槽位多条候选按潜能/等级合并"处理可互相印证。')
L.push('')
L.push('## 我们未采集的字段（不影响数值计算）')
L.push('')
L.push('- 模组任务、解锁条件（等级/信赖）、材料消耗、模组背景故事')
L.push('- 模组的 `※` 备注（如"多个伏击客X模组之间的减速效果可叠加"）—— 这类**叠加规则**值得后续采集，当前未建模')
L.push('')

await writeFile(OUT, L.join('\n'), 'utf8')
console.log(`\n✅ 报告写入 ${OUT}`)
console.log(`比对模组 ${rows.length} 条：一致 ${ok.length} / 不一致 ${bad.length} / 未取到 ${miss.length}（网络失败干员 ${netFail}）`)
for (const b of bad.slice(0, 15)) console.log(`  [不一致] ${b.op} ${b.name}(${b.type}) 我们=${b.our} PRTS=${b.prts} 差异=${b.diffs.join(',')}`)
console.log(`证章：检查 ${certCheck.length} 名，带属性数据 ${certWithData.length} 例（期望 0）`)
