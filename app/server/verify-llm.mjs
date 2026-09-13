// app/server/verify-llm.mjs —— BYOK 模型接入验证
// 关键手法：起一个**本地 mock provider**（OpenAI 兼容），把 config 指向它 ——
// 于是无需真实 API Key 也能验证：请求协议（URL/鉴权头/body 形状）、响应解析、JSON 抠取、降级路径。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const CONFIG = path.join(ROOT, 'app/config.json')
const API = process.env.API_BASE ?? 'http://127.0.0.1:8787'
const MOCK = 'http://127.0.0.1:8799/v1'
let pass = 0, fail = 0
const ok = (n, c, extra = '') => { c ? (pass++, console.log(`PASS  ${n}${extra ? ' → ' + extra : ''}`)) : (fail++, console.log(`FAIL  ${n}${extra ? ' → ' + extra : ''}`)) }
const post = async (p, body) => (await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json()
const get = async (p) => (await fetch(API + p)).json()

// ---- mock provider：记录收到的请求，返回带 ```json 围栏的输出（顺便验证抠取）----
let seen = null
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    seen = { url: req.url, auth: req.headers.authorization, contentType: req.headers['content-type'], body: JSON.parse(body || '{}') }
    const content = '好的，解析如下：\n```json\n' + JSON.stringify({
      form: '单次窗口爆发',
      patches: { burstPatch: { perDeployHits: 5, hitMult: 3.8, maxDeploysPerSkill: 8, skillWindowSec: 14, deploys: 16, windowSec: 78 } },
      reasoning: '原文"每次部署生成十字五枚棋子"，属单次窗口爆发形态',
      confidence: 'high',
    }) + '\n```'
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
  })
})
await new Promise((r) => mock.listen(8799, '127.0.0.1', r))

const backup = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, 'utf8') : null
try {
  // ---- 1. 未启用模型：必须优雅降级（这是硬约束）----
  fs.writeFileSync(CONFIG, JSON.stringify({ provider: '', providers: {} }), 'utf8')
  const st0 = await get('/api/llm/status')
  ok('未启用模型 → status.enabled=false', st0.enabled === false)
  const p0 = await post('/api/llm/parse', { query: '望', skillIndex: 2 })
  ok('未启用模型 → parse 走降级不报错', p0.ok === false && p0.disabled === true, p0.error?.slice(0, 28))
  const ev0 = await post('/api/evaluate', { query: '银灰', skillIndex: 2, damageType: 'physical' })
  ok('  未启用模型时评测仍正常（规则层完整）', Math.abs(ev0.result.benchmark.skillDpsVs400Def - 5524.6) < 0.1)

  // ---- 2. 指向 mock provider ----
  fs.writeFileSync(CONFIG, JSON.stringify({
    provider: 'mock',
    providers: { mock: { label: 'Mock', baseURL: MOCK, model: 'mock-1', apiKey: 'sk-mock-1234' } },
  }), 'utf8')
  const st1 = await get('/api/llm/status')
  ok('启用后 → status 正确', st1.enabled === true && st1.model === 'mock-1' && st1.hasKey === true, `${st1.kind} ${st1.model}`)

  const ping = await post('/api/llm/ping')
  ok('POST /api/llm/ping 连通', ping.ok === true, `${ping.ms}ms · 回复「${ping.reply}」`)

  const pr = await post('/api/llm/parse', { query: '望', skillIndex: 2 })
  ok('POST /api/llm/parse 产出机制补丁', pr.ok === true && pr.form === '单次窗口爆发', `form=${pr.form} confidence=${pr.confidence}`)
  ok('  补丁字段完整', pr.patches?.burstPatch?.perDeployHits === 5 && pr.patches.burstPatch.windowSec === 78)
  ok('  含依据说明', /棋子/.test(pr.reasoning ?? ''), (pr.reasoning ?? '').slice(0, 30))

  // ---- 3. 协议正确性（mock 记录的实际请求）----
  ok('请求打到 OpenAI 兼容路径 /v1/chat/completions', seen?.url === '/v1/chat/completions', seen?.url)
  ok('鉴权头 Bearer 正确', seen?.auth === 'Bearer sk-mock-1234')
  ok('请求体形状（model + messages + json 模式）', seen?.body.model === 'mock-1' && Array.isArray(seen.body.messages) && seen.body.response_format?.type === 'json_object')
  ok('system 提示已下发（机制解析器角色）', /机制解析器/.test(seen?.body.messages?.[0]?.content ?? ''), (seen?.body.messages?.[0]?.content ?? '').slice(0, 24))
  ok('技能原文与 blackboard 已随请求下发', /望/.test(seen?.body.messages?.[1]?.content ?? '') && /blackboard/.test(seen?.body.messages?.[1]?.content ?? ''))

  // ---- 4. 解析结果沉淀（AI 提议 → 入库 → 可复用 → 可导出供人工审核）----
  const list1 = await get('/api/llm/parses')
  ok('解析结果已沉淀入库', list1.some((x) => x.op_id && x.form === '单次窗口爆发'), `共 ${list1.length} 条`)
  seen = null
  const pr2 = await post('/api/llm/parse', { query: '望', skillIndex: 2 })
  ok('二次解析命中缓存（不再调模型）', pr2.cached === true && seen === null, pr2.cached ? '来自沉淀库' : '仍调用了模型')
  ok('  缓存返回的补丁与首次一致', pr2.patches?.burstPatch?.perDeployHits === 5)
  const exp = await get('/api/llm/export')
  ok('可导出 overrides.mjs 审核片段', exp.snippet.includes('必须人工审核') && exp.snippet.includes('burstPatch') && exp.count >= 1, `${exp.count} 条`)
  await fetch(API + '/api/llm/parses?opId=' + encodeURIComponent('char_2027_wang') + '&skillIdx=2', { method: 'DELETE' })
  ok('  可删除沉淀条目', !(await get('/api/llm/parses')).some((x) => x.form === '单次窗口爆发'))
} finally {
  if (backup !== null) fs.writeFileSync(CONFIG, backup, 'utf8')  // 还原用户配置
  mock.close()
}
console.log(`\n===== 模型接入：PASS=${pass} FAIL=${fail} =====`)
console.log('（config.json 已还原）')
process.exit(fail === 0 ? 0 : 1)
