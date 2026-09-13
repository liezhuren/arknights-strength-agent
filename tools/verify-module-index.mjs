// 校验：模组天赋 talentIndex 与数据集天赋顺序是否一致（错位会导致替换到错误的天赋槽）
import { readFile } from 'node:fs/promises'
const ops = JSON.parse(await readFile('E:/github/arknights-strength-agent/data/operators.json', 'utf8')).operators
const mods = JSON.parse(await readFile('E:/github/arknights-strength-agent/data/modules.json', 'utf8')).modules
const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '')

let checked = 0, mismatch = 0, outOfRange = 0
const samples = []
for (const op of ops) {
  const list = mods[op.id] ?? []
  const talents = op.talents ?? []
  for (const m of list) {
    const l3 = m.levels?.find((l) => l.level === 3) ?? m.levels?.[m.levels.length - 1]
    for (const t of l3?.talents ?? []) {
      if (t.index < 0) continue
      if (t.index >= talents.length) { outOfRange++; samples.push(`[越界] ${op.name} ${m.type} idx=${t.index} 但只有${talents.length}个天赋`); continue }
      checked++
      // 语义相关性：模组候选的描述/名称 与 数据集中该槽位天赋描述 是否指向同一机制
      const base = strip(talents[t.index].description)
      const modDesc = strip(t.desc)
      if (!modDesc) continue
      const kw = ['攻击力', '攻击速度', '防御力', '法术抗性', '生命', '技力', '伤害', '眩晕', '停顿', '无视', '中毒', '脆弱', '闪避', '阻挡', '部署', '召唤']
      const baseKw = kw.filter((k) => base.includes(k))
      const modKw = kw.filter((k) => modDesc.includes(k))
      const overlap = baseKw.some((k) => modKw.includes(k))
      if (!overlap && baseKw.length && modKw.length) {
        mismatch++
        if (samples.length < 25) samples.push(`[可疑] ${op.name} ${m.type} idx=${t.index}\n    数据集: ${base.slice(0, 60)}\n    模组:   ${modDesc.slice(0, 60)}`)
      }
    }
  }
}
console.log(`可校验的天赋槽位数 ${checked} · 关键词不重叠(可疑) ${mismatch} · 索引越界 ${outOfRange}`)
console.log(samples.slice(0, 25).join('\n'))
