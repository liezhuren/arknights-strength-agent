// tools/dump-op.mjs —— 输出干员的天赋/技能描述原文 + blackboard（LLM 机制解析的输入源）
// 用法：node tools/dump-op.mjs 望
import fs from 'node:fs'
import path from 'node:path'

const DATA = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/operators.json'), 'utf8'))
const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '')
const fmtBb = (bb) => (bb ?? []).map((b) => `${b.key}=${b.value}`).join(', ')

export function dumpOperator(query) {
  const op = DATA.operators.find((o) => o.name === query || o.appellation === query || o.id === query)
  if (!op) return `未找到干员：${query}`
  const out = []
  out.push(`===== ${op.name} ${op.id} ${op.rarity} ${op.profession}/${op.subProfessionId} =====`)
  out.push(`面板: ATK=${op.panel.atk} 间隔=${op.panel.baseAttackTime}s 费用=${op.panel.cost} HP=${op.panel.maxHp} 防御=${op.panel.def} 法抗=${op.panel.magicResistance}`)
  out.push(`特性: ${strip(op.trait?.description)}`)
  for (const t of op.talents ?? []) {
    out.push(`【天赋】${t.name ?? '?'}`)
    out.push(`  desc: ${strip(t.description)}`)
    if (t.blackboard?.length) out.push(`  bb: ${fmtBb(t.blackboard)}`)
  }
  op.skills.forEach((s, i) => {
    const lv = s.levels?.[9]
    out.push(`【S${i + 1}${lv ? ' ' + lv.name : ''}】${s.id}`)
    if (!lv) return
    out.push(`  SP:${lv.spData?.spType}/${lv.spData?.spCost}(+${lv.spData?.initSp}) 持续:${lv.duration}s`)
    out.push(`  desc: ${strip(lv.description)}`)
    if (lv.blackboard?.length) out.push(`  bb: ${fmtBb(lv.blackboard)}`)
  })
  // 潜能不能直接算数值，提示
  return out.join('\n')
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).pathname) {
  const q = process.argv[2]
  if (!q) {
    console.error('用法：node tools/dump-op.mjs <干员名>')
    process.exit(1)
  }
  console.log(dumpOperator(q))
}
