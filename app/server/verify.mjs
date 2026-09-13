// app/server/verify.mjs —— API 冒烟：逐个接口实打实请求一遍（需先启动服务）
const B = 'http://127.0.0.1:8787'
let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`PASS  ${n}${extra ? ' → ' + extra : ''}`)) : (fail++, console.log(`FAIL  ${n}${extra ? ' → ' + extra : ''}`)) }
const get = async (p) => (await fetch(B + p)).json()
const post = async (p, body) => (await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()

const h = await get('/api/health')
ok('GET /api/health', h.ok === true && h.db === 'sqlite', `node ${h.node} · 模型 ${h.modelEnabled ? '已启用' : '未启用'}`)

const s = await get('/api/operators?q=银灰')
ok('GET /api/operators（检索）', s.total >= 1, `命中 ${s.total} · 首位 ${s.rows[0]?.name}`)
const s2 = await get('/api/operators?profession=TANK&limit=5')
ok('GET /api/operators（职业过滤+分页）', s2.rows.length === 5 && s2.rows.every((r) => r.profession === 'TANK'))

const f = await get('/api/facets')
ok('GET /api/facets', f.professions.length >= 8 && f.rarities.length === 6, `${f.professions.length} 职业`)

const op = await get('/api/operators/银灰')
ok('GET /api/operators/:id（详情）', op.skills?.length === 3 && op.modules?.length >= 2, `${op.name} 技能${op.skills.length} 模组${op.modules.length}`)

const sc = await get('/api/scenarios')
ok('GET /api/scenarios', sc.scenarios.length === 6 && sc.threats.length === 5 && sc.baseline.length === 6)

const ev = await post('/api/evaluate', { query: '银灰', skillIndex: 2, damageType: 'physical' })
const dps = ev.result?.benchmark?.skillDpsVs400Def
ok('POST /api/evaluate（含五栏）', Math.abs(dps - 5524.6) < 0.1, `技能期 ${dps?.toFixed(1)}（锚点 5524.6）`)
ok('  评测返回五栏文本', ['versatilitySection', 'difficultySection', 'rotationSection', 'survivalSection'].every((k) => !!ev.result[k]))
ok('  评测写入历史', (await get('/api/evaluations?limit=3')).some((e) => e.op_name === '银灰'))

const cmp = await post('/api/compare', { queries: ['银灰', '史尔特尔', '能天使'], skillIndex: 2 })
ok('POST /api/compare', cmp.rows.length === 3 && cmp.rows.every((r) => r.benchmark),
  cmp.rows.map((r) => `${r.name}[${r.tier ?? '-'}/${r.difficulty ?? '-'}]`).join(' '))

// 严格对齐 engine/custom-operator.schema.json（required: name/atk/baseInterval/damageType；additionalProperties:false）
const CUSTOM = { name: 'API验证·测试干员', rarity: 6, archetype: '术师-核心术师', atk: 700, maxHp: 1800, def: 200, res: 10, cost: 20, blockCount: 1, baseInterval: 1.5, damageType: 'magical', hitCount: 1, skill: { name: '高压水刃', spType: 'auto', spCost: 40, spStart: 20, duration: 25, attackMult: 2.5, hits: 3, targetCount: 4 } }
const save = await post('/api/custom', { data: CUSTOM })
ok('POST /api/custom（自制干员保存·必须真正校验通过）', save.ok === true, save.ok ? `已保存 ${save.name}` : `校验失败：${save.errors?.join('/')}`)
ok('GET /api/custom', (await get('/api/custom')).some((c) => c.name === 'API验证·测试干员'))
const ce = await post('/api/custom/evaluate', { data: CUSTOM })
ok('POST /api/custom/evaluate（自制干员参与评测）', !!ce.result,
  ce.result ? `技能期 DPS ${(ce.result.benchmark?.skillDpsVs50Res ?? ce.result.benchmark?.skillDpsVs400Def)?.toFixed(1)}` : '无结果')
ok('  自制干员评测报告可用', typeof ce.report === 'string' && ce.report.length > 50, `report ${String(ce.report ?? '').length} 字`)
const bad = await post('/api/custom', { data: { name: '缺字段', atk: 100, damageType: 'physical' } })
ok('  缺 baseInterval 必须被拒（防宽松断言掩盖校验失效）', bad.ok === false && (bad.errors ?? []).some((e) => /baseInterval|必填/.test(e)), (bad.errors ?? []).join('/'))
await fetch(B + '/api/custom?name=' + encodeURIComponent('API验证·测试干员'), { method: 'DELETE' })
ok('DELETE /api/custom', !(await get('/api/custom')).some((c) => c.name === 'API验证·测试干员'))

const cfg = await get('/api/config')
ok('GET /api/config（Key 已脱敏）', cfg.providers && Object.keys(cfg.providers).length >= 4, Object.keys(cfg.providers).join('/'))
const cfg2 = await post('/api/config', { provider: 'deepseek', providers: { deepseek: { apiKey: 'sk-test-not-real-1234' } } })
ok('POST /api/config（BYOK 写入+脱敏）', cfg2.provider === 'deepseek' && cfg2.providers.deepseek.apiKey.startsWith('••'), cfg2.providers.deepseek.apiKey)
await post('/api/config', { provider: '' })
ok('  可切回"不启用模型"', (await get('/api/config')).modelEnabled === false)

console.log(`\n===== API 冒烟：PASS=${pass} FAIL=${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
