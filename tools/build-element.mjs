// tools/build-element.mjs —— 元素损伤爆发数值管线：gamedata_const → data/element-breaks.json
//
// 背景（2026 修正）：这四个数值此前**手抄**在 engine 里，且出处标注为"PRTS"。
// 实际上它们就在**游戏数据仓库**的 `gamedata_const.json` → `termDescriptionDict`：
//
//   ba.dt.neural2    神经损伤·我方：…敌人立即受到6000点元素伤害且获得3层麻痹。10秒冷却
//   ba.dt.erosion2   侵蚀损伤·我方：…敌人立即受到5000点元素伤害且永久降低120点防御力（可叠加）。8秒冷却
//   ba.dt.burning2   灼燃损伤·我方：…敌人立即受到7000点元素伤害且期间法术抗性-20。10秒冷却
//   ba.dt.apoptosis2 凋亡损伤·我方：…每秒受到800点元素伤害。15秒冷却
//
// 它们**以中文描述文本存放**（不是独立数值字段），所以必须解析文本。
// 本管线按"通用模板"解析，而不是为四个损伤各写一条规则 —— 同一模板下的新损伤会自动被覆盖。
import { readFile, writeFile } from 'node:fs/promises'

const ROOT = 'E:/github/ArknightsGameData/zh_CN/gamedata/excel'
const OUT = 'E:/github/arknights-strength-agent/data/element-breaks.json'
const gc = JSON.parse(await readFile(`${ROOT}/gamedata_const.json`, 'utf8'))
const dict = gc.termDescriptionDict ?? {}
const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, '')

/**
 * 解析一条"·我方"元素损伤描述。通用规则（顺序即优先级）：
 *   · 直伤：「立即受到 N 点元素伤害」
 *   · 每秒型：「每秒受到 N 点元素伤害」→ dotPerSec
 *   · 冷却：「N秒冷却」→ durationSec（同时作爆条后的冷却假设）
 *   · 附带：法抗-N / 降低N点防御力 / N层麻痹 / N%虚弱
 */
function parseElement(text) {
  const t = strip(text)
  const burst = t.match(/立即受到(\d+)点元素伤害/)
  const dot = t.match(/每秒受到(\d+)点元素伤害/)
  const cd = t.match(/(\d+(?:\.\d+)?)秒冷却/)
  const res = t.match(/法术抗性-(\d+)/)
  const def = t.match(/降低(\d+)点防御力/)
  const palsy = t.match(/获得(\d+)层麻痹/)
  const weak = t.match(/(\d+)%虚弱/)
  if (!burst && !dot) return null
  return {
    burstDamage: burst ? Number(burst[1]) : 0,
    dotPerSec: dot ? Number(dot[1]) : 0,
    durationSec: cd ? Number(cd[1]) : null,
    effects: {
      resDown: res ? Number(res[1]) : 0,
      defDown: def ? Number(def[1]) : 0,
      palsyStacks: palsy ? Number(palsy[1]) : 0,
      weakPct: weak ? Number(weak[1]) / 100 : 0,
    },
    quote: t,
  }
}

const elements = {}
const raw = {}
for (const [k, v] of Object.entries(dict)) {
  const name = String(v?.termName ?? '')
  if (!/损伤/.test(name) || !/·我方/.test(name)) continue
  const parsed = parseElement(v.description)
  if (!parsed) continue
  const base = name.replace('·我方', '')
  elements[base] = parsed
  raw[k] = { termName: name, description: strip(v.description) }
}

const payload = {
  builtAt: new Date().toISOString().slice(0, 10),
  source: 'ArknightsGameData(zh_CN) gamedata_const.json → termDescriptionDict（条目 ba.dt.*2 = "·我方"版）',
  notes: [
    '元素损伤爆发数值以**描述文本**形式存放在 termDescriptionDict，需解析文本（不是独立数值字段）',
    '此前这四个值手抄在 engine 里、且出处误标为 PRTS —— 实际就在游戏数据仓库中',
    '解析按通用模板（立即受到N点 / 每秒受到N点 / N秒冷却 / 法抗-N / 降N防 / N层麻痹 / N%虚弱）',
    '领袖敌人的损伤条为 2000，普通与精英为 1000（该值在描述里也写了）',
  ],
  count: Object.keys(elements).length,
  elements,
  raw,
}
await writeFile(OUT, JSON.stringify(payload, null, 1), 'utf8')
console.log(`✅ 写入 ${OUT}`)
console.log(`   解析出 ${Object.keys(elements).length} 种元素损伤（·我方 版本）：`)
for (const [k, v] of Object.entries(elements)) {
  const bits = []
  if (v.burstDamage) bits.push(`直伤 ${v.burstDamage}`)
  if (v.dotPerSec) bits.push(`每秒 ${v.dotPerSec}`)
  if (v.durationSec) bits.push(`冷却 ${v.durationSec}s`)
  if (v.effects.resDown) bits.push(`法抗-${v.effects.resDown}`)
  if (v.effects.defDown) bits.push(`防御-${v.effects.defDown}`)
  if (v.effects.palsyStacks) bits.push(`麻痹 ${v.effects.palsyStacks} 层`)
  if (v.effects.weakPct) bits.push(`虚弱 ${Math.round(v.effects.weakPct * 100)}%`)
  console.log(`     ${k.padEnd(6)} ${bits.join(' · ')}`)
}
