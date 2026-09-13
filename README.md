# 明日方舟 · 干员强度评测

一个本地运行的干员强度评测工具。评现有干员，也可以评测自己设计的干员。

不给单一分数，而是分场景给出输出画像 —— 因为强度是内容相关的：同一名干员打高甲和打杂兵
不是一个结论。

---

## 功能

- **评测现有干员** —— 454 名满练干员，可选技能、伤害类型与模组
- **评测自创干员** —— 按格式填写后直接评测，并对照现有干员给出定位
- **多干员对比** —— 最多 6 名同屏比较，逐场景标出最优
- **网页界面** —— 不想敲命令的话，浏览、筛选、评测、对比都能点

---

## 使用

### 网页界面

```bash
node app/server/index.mjs --port 8787
```

浏览器打开 **http://127.0.0.1:8787**。

首次运行需先建数据库与打包前端：

```bash
node tools/build-dataset.mjs && node tools/build-modules.mjs && node tools/build-summons.mjs
node tools/build-ranges.mjs && node tools/build-threat-scenarios.mjs && node tools/build-scenario-baseline.mjs
node app/db/build-db.mjs
cd app/web && pnpm install && pnpm build
```

> 重建数据库前需先停止服务，否则 Windows 会因文件占用报 EPERM。

### 命令行

```bash
node tools/evaluate.mjs 银灰                  # 评测（默认 S3，伤害类型自动推断）
node tools/evaluate.mjs 艾雅法拉 magical 2     # 指定法术伤害 / S3
node tools/evaluate.mjs 水月 --module isw      # 启用特限模组
node tools/module-eval.mjs 水月               # 三种模组配置对照
node tools/survival-eval.mjs 泥岩             # 只看承伤能力（无技能干员也可评）
node tools/compare.mjs 银灰 史尔特尔 艾雅法拉   # 多干员对比（逐场景标 ★）
node tools/evaluate-custom.mjs 我的干员.json   # 评测自创干员
```

### 在 DSH 会话中

项目注册了 `arknights-evaluator` skill，可直接说「评测银灰」「对比银灰和史尔特尔」
「看看我设计的干员」，agent 会调用引擎并给出场景化的结论。

---

## 输出内容

不是单一分数，是一份多维画像。以银灰为例：

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

几项会单独说明的内容：

- **射程形状**会直接画出来。银灰开启技能后是菱形，艾雅法拉 S3 是 25 格大菱形，
  伊芙利特是一条 6 格直线（射程 5）。判断群攻能力时这比文字描述更直观
- **召唤物与本体分开计**。凯尔希本体 31 DPS，Mon3tr 是 701；令的三种形态取最强的那个
- **多敌人集火**单独给一档。泥岩对狂暴宿主组长可支撑 6.5 秒，2 个同时进攻时只有 2.6 秒
- **模组**给出无模组 / 默认 / 特限三种配置的数值差

---

## 设计自创干员

参照 `examples/custom-demo.json` 的格式：

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

必填字段与取值范围见 `engine/custom-operator.schema.json`，格式有误会报错并指出位置。

---

## 数值口径

**数据来源**：干员面板、技能、天赋、模组、射程、敌人等，取自第三方维护的游戏数据提取仓库
[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)（zh_CN）——
**不是官方数据源**，是他人在 GitHub 上持续维护的客户端数据整理。核心公式与机制表另外与
[PRTS](https://prts.wiki) 核对过（模组数值 105/105 一致）。

**需要区分两件事**：数字有出处，但**适用范围里有我的判断**。以下是明确属于后者、或我算不了的部分：

| 项目 | 说明 |
|---|---|
| **条件不成立时不计入** | 泥岩的 30% 减伤只对【萨卡兹】、止颂的 35% 只对未被自身阻挡的敌人；对空加成只对空中单位。这类**条件型加成与减伤一律不进基准数值**，报告单独标注 |
| **我自己设的场景假设** | 受击频率按 0.5 次/秒折算、陷阱按"全部被触发"、爆发冷却按"≈爆发持续秒数"。这些**没有数据出处**，是拍的 |
| **极限轴不算** | 何时开技能、如何排轴属玩法层，需自行给参数（已支持传入） |
| **队友支援不算** | 生存栏按无人治疗计算 |
| **地形不算** | 阻挡分流、多路压力未建模 |
| **敌方伤害类型数据里没有** | 游戏数据不含"该敌人造成物理还是法术"（由 prefab 决定），来袭画像选取可确定判定类型的真实敌人作为锚点 |
| **潜能与信赖不算** | 统一按专三满级面板 |

报告中有一个「显示口径说明」开关，展开后可看到每一栏的假设与边界。
计算细节见 [`docs/dps-calculation.md`](docs/dps-calculation.md)。

---

## 开发者备忘

<details>
<summary>架构、验证、文档索引、从零构建（展开）</summary>

### 架构

```
游戏数据仓库 ──build-*.mjs──▶ data/*.json ──build-db.mjs──▶ SQLite ──▶ API ──▶ 网页
                                  │
                                  └──▶ tools/evaluate.mjs ──▶ engine/ ──▶ 多栏报告
```

`engine/` 与 `tools/` 是不依赖 DSH、也不依赖软件层的纯 Node 模块；软件层只做存取与呈现，
不含评测逻辑 —— 因此前端改动不会影响数值基线。

### 数据规模

454 干员（8 职业 / 72 分支）· 994 技能 · 649 天赋 · 898 模组（505 个含战斗数值）·
74 召唤物 · 73 个射程 · 2130 敌人 · 6 标准场景 · 5 档来袭画像

### 验证（改动数值逻辑后必跑）

```bash
node engine/test.mjs                   # 86 断言
node tools/verify-summons.mjs          # 56（召唤物，含"通道不双算"）
node tools/verify-conditional.mjs      # 38（条件型，含"不污染锚点"）
node tools/verify-ranges.mjs           # 29（射程几何）
node app/db/verify.mjs                 # 16
node app/server/verify.mjs             # 41（需先启动服务）
node app/server/verify-llm.mjs         # 18（本地 mock provider）
node tools/smoke.mjs                   # 454 × 3 配置 = 1362 次，意外异常须为 0
node tools/anchors.mjs                 # 重新生成锚点表
```

**核心原则「数值零漂移」**：同一干员经 `JSON→工具链` 或 `SQLite→API` 两条路径，
结果必须与锚点完全一致。

关键锚点：银灰·真银斩 **5524.6** · 艾雅法拉·火山 5832.0 · 史尔特尔·黄昏 5107.2 ·
望·天下劫 轴 179056 · 玛恩纳 11645.8 · Mon3tr 701.0 · 泥岩 vs 物理·精英 398/10击/26.0s

### 文档

| 文档 | 内容 |
|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | 恢复步骤、踩坑清单、未完成项 |
| [`docs/DELIVERY.md`](docs/DELIVERY.md) | 交付清单、架构、验证体系、决策与修正记录 |
| [`docs/dps-calculation.md`](docs/dps-calculation.md) | 计算链路与全部假设（§13 模组 / §14 生存 / §17–§24 召唤物·条件型·射程） |
| [`docs/eval-standards.md`](docs/eval-standards.md) | 评测标准（四项关键点 + 各栏口径） |
| [`docs/summon-recon.md`](docs/summon-recon.md) | 召唤物侦察与设计 |
| [`docs/module-prts-crosscheck.md`](docs/module-prts-crosscheck.md) | PRTS 模组数值交叉校验（105/105 一致） |
| [`docs/data-inventory.md`](docs/data-inventory.md) · [`docs/mechanics.md`](docs/mechanics.md) | 数据资产清单 / 机制笔记 |

### 从零构建

```bash
# 游戏数据仓库不在本仓库内，需自行 clone
git clone --depth 1 --filter=blob:none --sparse https://github.com/Kengxxiao/ArknightsGameData
cd ArknightsGameData && git sparse-checkout set zh_CN/gamedata/excel

cd ../arknights-strength-agent
# 路径默认 E:/github/ArknightsGameData，不同则修改 tools/build-*.mjs 中的 ROOT
node tools/build-dataset.mjs && node tools/build-modules.mjs && node tools/build-summons.mjs
node tools/build-ranges.mjs && node tools/build-threat-scenarios.mjs && node tools/build-scenario-baseline.mjs
node app/db/build-db.mjs
```

### 模型接入（可选）

评测数值不经过模型，未配置也可使用全部功能。模型仅用于第二层「长尾机制解析」：
模式库覆盖不到的描述，交由模型读取原文产出机制补丁，入库沉淀并可导出审核 ——
但模型输出不会自动进入引擎，未经审核不影响任何数值。在网页「模型设置」中填写
provider / API Key 即可（仅落本地 `app/config.json`，接口不回显）。

</details>

---

## 声明

《明日方舟》及相关素材版权归**上海鹰角网络科技有限公司**所有。
本项目为非商业的个人学习项目，与鹰角无任何关联。数值为离线推算，仅供参考。
详见 [`NOTICE.md`](NOTICE.md)。
