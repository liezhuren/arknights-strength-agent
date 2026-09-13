# 明日方舟 · 干员强度评测

> 一个自用的方舟强度评测小工具。想评谁就评谁，也能评自己瞎设计的干员 🐋

游戏里的强度榜看多了总觉得不对劲 —— 银灰打高甲和打杂兵能是一回事吗？
所以干脆自己撸了一个：**不给你一个分数，而是告诉你"这个干员在什么场合强、什么场合拉"**。

数据是扒的游戏客户端本体，所以数字不是瞎编的，每一条都能追到出处。

---

## 它能干嘛

- **评现有干员** —— 454 名满练干员，带模组、带天赋，分场景算给你看
- **自己设计干员** —— 填个 JSON，直接告诉你这设计是超模还是下水道
- **横向对比** —— 最多 6 名干员摆一起，每个场景标出谁最强
- **不想用命令行** —— 有网页界面，点点鼠标就行

---

## 怎么用

### 网页版（推荐）

```bash
node app/server/index.mjs --port 8787
```

然后浏览器打开 **http://127.0.0.1:8787** 就行。

第一次跑要先建库 + 打包前端：

```bash
node tools/build-dataset.mjs && node tools/build-modules.mjs && node tools/build-summons.mjs
node tools/build-ranges.mjs && node tools/build-threat-scenarios.mjs && node tools/build-scenario-baseline.mjs
node app/db/build-db.mjs
cd app/web && pnpm install && pnpm build
```

> ⚠️ 重建数据库前记得先关掉服务（Windows 会锁文件，不然报 EPERM）。

### 命令行

```bash
node tools/evaluate.mjs 银灰                  # 评银灰（默认 S3）
node tools/evaluate.mjs 艾雅法拉 magical 2     # 指定法术 / S3
node tools/evaluate.mjs 水月 --module isw      # 带上特限模组
node tools/module-eval.mjs 水月               # 三种模组配置摆一起比
node tools/survival-eval.mjs 泥岩             # 只看能不能扛（没技能的干员也能评）
node tools/compare.mjs 银灰 史尔特尔 艾雅法拉   # 三个一起比（每场景标 ★）
node tools/evaluate-custom.mjs 我的干员.json   # 评自己设计的
```

### 在 DSH 里直接用

项目注册了 `arknights-evaluator` skill。直接说「评一下银灰」「对比银灰和史尔特尔」
「看看我设计的干员」，agent 会自己调引擎然后跟你聊。

---

## 会输出什么

不是一个分数，是一张画像。比如银灰：

```
【银灰】6★ · 近卫 / 领主 · 技能「真银斩」
面板：ATK 798.6 · 间隔 1.30s · 费用 20（含天赋：攻击+12%）
射程（S3 3-7）：4×7 不规则（16 格） · 射程 3
          █···
          ██··
          ███·
          O███
          ███·
          ██··
          █···

基准 vs 400防：技能期 5524.6 · 平均 3785.1 · 覆盖率 66.7%

泛用性      全能型 —— 6/6 场景达稳健线，波动比 0.54
操作难度    低
回转        首轮 15.0s · 完整周期 45.0s
团队增益    编入队伍时全体再部署时间 -12%
生存        生命 2560 / 防御 397 → 对物理·精英可挨 5 击（13.0s）
```

几件事会被单独拎出来说：

- **射程长什么样** —— 直接画出来。银灰开技能是菱形，艾雅法拉 S3 是 25 格大菱形，
  伊芙利特是一条 6 格直线（射程 5）。群攻能力看这个比看文字描述准
- **召唤物单算** —— 凯尔希本体 31 DPS，Mon3tr 才是 701；令的三种形态取最强的那条
- **能不能扛住一群人** —— 泥岩单挑狂暴宿主组长能撑 6.5 秒，2 个一起上就只有 2.6 秒
- **模组值不值得刷** —— 同一干员三种配置（无模组 / 默认 / 特限）的数值差摆给你看
---

## 想设计干员的话

照着 `examples/custom-demo.json` 改就行：

```json
{
  "name": "深海试作·蓝闪",
  "rarity": 6,
  "archetype": "术师-核心术师",
  "atk": 700,
  "baseInterval": 1.5,
  "damageType": "magical",
  "skill": { "name": "高压水刃", "spCost": 40, "duration": 25, "attackMult": 2.5,
             "targetCount": 4, "hits": 1 }
}
```

填完直接评，会告诉你这数据放在现有干员里算什么水平。必填字段和取值范围见
`engine/custom-operator.schema.json`，填错了会报错并告诉你哪里错。

---

## 关于"准不准"

数字全部来自游戏客户端数据（[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData) 的 zh_CN 表），
核心公式和机制表跟 [PRTS](https://prts.wiki) 对过账。不是社区口口相传的经验值。

不过这只是**量级参考**，有几个地方我确实算不了：

- **极限轴不算** —— 什么时候开技能最赚、怎么卡轴，那是玩法层面的东西，得你自己给参数
- **队友支援没算** —— 有人奶你的时候完全不一样，生存栏是按"没人管你"算的
- **地形没算** —— 阻挡分流、一条路还是三条路，这些得结合关卡看
- **敌人的伤害类型数据里没有**（游戏里是写在 prefab 上的），所以来袭画像是挑了能确定的真实敌人当锚点
- **潜能和信赖没算** —— 统一按专三满级面板，不算信赖加成

报告里有个「显示口径说明」开关，点开会把每一栏的假设和边界讲清楚。想深究可以看
[`docs/dps-calculation.md`](docs/dps-calculation.md)。

---

## 给自己的备忘

<details>
<summary>开发者向：架构、验证、文档索引（点开）</summary>

### 架构

```
游戏数据仓库 ──build-*.mjs──▶ data/*.json ──build-db.mjs──▶ SQLite ──▶ API ──▶ 网页
                                  │
                                  └──▶ tools/evaluate.mjs ──▶ engine/ ──▶ 多栏报告
```

`engine/` 和 `tools/` 是不依赖 DSH、也不依赖软件层的纯 Node 模块；软件层只做存取和呈现，
**不含评测逻辑** —— 所以前端怎么改都不会动到数值基线。

### 数据规模

454 干员（8 职业 / 72 分支）· 994 技能 · 649 天赋 · 898 模组（505 个含战斗数值）·
74 召唤物 · 73 个射程 · 2130 敌人 · 6 标准场景 · 5 档来袭画像

### 验证（改数值后必跑）

```bash
node engine/test.mjs                   # 86 断言
node tools/verify-summons.mjs          # 56（召唤物，含"通道不双算"）
node tools/verify-conditional.mjs      # 38（条件型，含"不污染锚点"）
node tools/verify-ranges.mjs           # 29（射程几何）
node app/db/verify.mjs                 # 16
node app/server/verify.mjs             # 41（需先起服务）
node app/server/verify-llm.mjs         # 18（本地 mock provider）
node tools/smoke.mjs                   # 454 × 3 配置 = 1362 次，意外异常须 0
node tools/anchors.mjs                 # 重生成锚点表
```

**核心原则「数值零漂移」**：同一干员走 `JSON→工具链` 或 `SQLite→API`，结果必须与锚点完全一致。

关键锚点：银灰·真银斩 **5524.6** · 艾雅法拉·火山 5832.0 · 史尔特尔·黄昏 5107.2 ·
望·天下劫 轴 179056 · 玛恩纳 11645.8 · Mon3tr 701.0 · 泥岩 vs 物理·精英 278/15击/39.0s

### 文档

| 文档 | 内容 |
|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | 怎么接着做：恢复步骤、踩坑清单、未完成项 |
| [`docs/DELIVERY.md`](docs/DELIVERY.md) | 项目全貌：交付清单、架构、验证体系、决策记录 |
| [`docs/dps-calculation.md`](docs/dps-calculation.md) | 计算链路与全部假设（§13 模组 / §14 生存 / §17–§24 召唤物·条件型·射程） |
| [`docs/eval-standards.md`](docs/eval-standards.md) | 评测标准（四项关键点 + 各栏口径） |
| [`docs/summon-recon.md`](docs/summon-recon.md) | 召唤物侦察与设计 |
| [`docs/module-prts-crosscheck.md`](docs/module-prts-crosscheck.md) | PRTS 模组数值交叉校验（105/105 一致） |
| [`docs/data-inventory.md`](docs/data-inventory.md) · [`docs/mechanics.md`](docs/mechanics.md) | 数据资产清单 / 机制笔记 |

### 从零构建

```bash
# 游戏数据仓库不在本仓库内，需要自己 clone
git clone --depth 1 --filter=blob:none --sparse https://github.com/Kengxxiao/ArknightsGameData
cd ArknightsGameData && git sparse-checkout set zh_CN/gamedata/excel

cd ../arknights-strength-agent
# 路径默认 E:/github/ArknightsGameData，不同的话改 tools/build-*.mjs 里的 ROOT
node tools/build-dataset.mjs && node tools/build-modules.mjs && node tools/build-summons.mjs
node tools/build-ranges.mjs && node tools/build-threat-scenarios.mjs && node tools/build-scenario-baseline.mjs
node app/db/build-db.mjs
```

### 模型接入（可选）

评测数值**完全不经过模型**，不配也能用全部功能。模型只用在第二层"长尾机制解析"：
模式库覆盖不到的描述，让模型读原文产出机制补丁，入库沉淀可导出审核 ——
**但模型输出不会自动进引擎**，未经审核不影响任何数值。在网页「模型设置」里填
provider / API Key 即可（只落本地 `app/config.json`，接口永不回显）。

</details>

---

## 声明

《明日方舟》及相关素材版权归**上海鹰角网络科技有限公司**所有。
本项目是非商业的个人学习/娱乐项目，与鹰角无任何关联。数值为离线推算，仅供参考。
详见 [`NOTICE.md`](NOTICE.md)。
