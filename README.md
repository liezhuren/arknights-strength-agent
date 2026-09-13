# arknights-strength-agent · 明日方舟干员强度评测

把《明日方舟》的游戏数据变成一套**可复算、可解释、可验证**的强度评测系统：
零依赖 Node 数值引擎 + 评测管线，外加一个**本地单机软件**（React 前端 + SQLite + 可接自有模型）。

支持评测 **454 名满练干员**与**你自己设计的干员**，输出「分场景 + 多维画像」而非单一分数 ——
因为方舟的强度是**内容相关**的（物理怕高甲、法术怕高抗、换场景换赢家）。

> ⚠ 本工具用于**强度量级评判与场景适配对比**，不追求复现理论极限轴。
> 所有假设都会在报告里标注（可用「显示口径说明」展开）。数值为离线推算，不保证与游戏内一致。

---

## 快速开始

### 方式一：命令行（无需安装任何依赖）

只要 Node ≥ 22（用到内置 `node:sqlite`）：

```bash
node tools/evaluate.mjs 银灰                  # 评测（默认 S3，伤害类型自动推断）
node tools/evaluate.mjs 艾雅法拉 magical 2     # 指定伤害类型与技能（0/1/2 = S1/S2/S3）
node tools/evaluate.mjs 水月 --module isw      # 启用模组（none 默认 / default / isw / X·Y·D / 模组名）
node tools/module-eval.mjs 水月               # 模组三配置对照（无模组 / 默认 / 特限）
node tools/survival-eval.mjs 泥岩             # 只看 ④ 生存栏（不依赖技能，1★ 也能评）
node tools/compare.mjs 银灰 史尔特尔 艾雅法拉   # 多干员分场景对比
node tools/compare.mjs --all-skills 银灰       # 单干员全技能对比
node tools/scenario-eval.mjs 银灰             # 分场景画像明细
node tools/evaluate-custom.mjs examples/custom-demo.json   # 自创干员
```

### 方式二：本地软件（有界面）

```bash
# 1) 数据与数据库（首次、或改了 data/ 之后；**需先停掉服务**，Windows 文件锁）
node tools/build-dataset.mjs
node tools/build-modules.mjs
node tools/build-summons.mjs
node tools/build-ranges.mjs
node tools/build-threat-scenarios.mjs
node tools/build-scenario-baseline.mjs
node app/db/build-db.mjs

# 2) 起服务（API + 静态托管前端）
node app/server/index.mjs --port 8787        # → http://127.0.0.1:8787

# 3) 构建前端（首次）
cd app/web && pnpm install && pnpm build
```

浏览器打开 **http://127.0.0.1:8787**。服务绑定 `127.0.0.1`，仅本机可访问。

> **数据仓库不在本仓库内**：本项目依赖 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)
> 的 `zh_CN` 数据，默认路径 `E:/github/ArknightsGameData`（见下方「自己从零构建」）。

### 方式三：在 DSH 会话里用

项目注册了 `arknights-evaluator` skill（dsh 自动发现）。直接说
「评一下银灰」「对比银灰和史尔特尔」「看看我设计的这个干员」，
agent 会调用引擎并结合场景推理回答。

---

## 输出形态：多栏并列，互不合并

```
【干员名】稀有度 · 职业 / 分支
├─ ① 输出栏        分场景 DPS / 技能期 / 平均 / 费效 / 覆盖率
├─ 泛用性          六场景 vs 全库可用线 → 全能型/通用型/偏科型/特化型
├─ 操作难度        客观约束清单 + 低/中/高分级（不合成假分数）
├─ 回转            首轮可用 / 完整周期 / 空窗 / 60·90s 内可开次数
├─ 射程            覆盖格数 / 射程 / 贴脸盲区 + 形状示意图
├─ ② 团队增益栏     对队友输出折算提升%（基准 400防/50抗/ATK800）
├─ ③ 控制栏        类型分级 + 时长分列 + 触发间隔 → 覆盖率（**不做类型换算**）
└─ ④ 生存栏        分档硬扛（每击/可挨击数/秒数）+ 多敌人集火 + 自回/闪避/减伤/屏障
附：假设与条件（⚠ 未计入项会显式列出）
```

**硬约束**：②③④ 与泛用性/操作难度/回转**都不并入 DPS 数字**；所有假设必须标注。

---

## 覆盖了什么

### 输出通道（按技能形态分流，套错通道量级全错）

| 形态 | 通道 | 例子 |
|---|---|---|
| 稳态持续 | 覆盖率模型（周期 = 充能 + 持续） | 银灰·真银斩 5524.6 |
| 单次窗口爆发 | `burst`（部署次数 × 每次枚数，分层口径） | 望·天下劫 每次部署 11191 / 轴 179056 |
| 陷阱/棋子触发 | `trap`（倍率 × 产出数 ÷ CD） | 多萝西 172.8 |
| **召唤物** | `summon`（**独立输出线，不与本体相加**） | Mon3tr 701.0 · 令弦惊 548.7 · 打字机 3450.5 |
| 元素累积 | `element`（累积速率 + 爆发收益） | 塑心 666.7 |
| 下次攻击强化 | `nextAttack`（每 N 次攻击 1 次强化） | 充能型技能 |

### 机制层（读描述，不是为个别干员打补丁）

**双层解析架构**：

- **第一层 `tools/patterns.mjs`**（自动）：技能描述里的高频通用表述 → 引擎参数。
  覆盖 额外目标 / 连击 / 同时攻击 / 充能 / 停止攻击 / 蓄力 / 索敌（`优先攻击X`，57 名）/
  对空 / 减速 / 闪避 / 自回 / 减伤。
  **判断标准：同一表述出现在多个干员身上 → 必须写进这一层。**
- **第二层 `tools/overrides.mjs` + 软件里的 AI 解析**：长尾独有机制。
  AI 读技能原文产出补丁、入库沉淀、可导出审核片段，
  **但绝不自动注入引擎**（未经审核的模型输出不影响任何数值）。

其他已建模：模组三配置（505 个含战斗数值）/ 天赋通用加成 / 穿透三源相加 /
对敌减益 / 状态型分支（阵法术师、解放者两态）/ 条件型加成（对空、距离、阻挡、未阻挡）/
召唤物自身技能与触发伤害 / 射程几何（73 个范围）。

### 软件层

五个页签：**干员浏览**（名称检索 + 职业→分支二级筛选 + 星级筛选）/ **评测面板**
（技能·伤害类型·模组选择 + 轴参数 + 五组图表 + 多栏文本 + AI 解析 + 口径说明开关）/
**多干员对比**（最多 6 名）/ **自制干员**（JSON 编辑 → schema 校验 → 存库 / 评测）/
**模型设置**（BYOK 多 provider + 测试连接 + 解析沉淀列表 + 导出审核片段）。

- 零图表库（纯 SVG/CSS），前端无第三方运行时依赖
- **不配模型也能用全部功能**（纯规则层）；Key 只落本地 `app/config.json`，接口永不回显
- 重建数据库会**备份并回填用户数据**（自制干员 / 评测历史 / 解析沉淀）

---

## 数据规模

| 数据 | 数量 |
|---|---|
| 干员 | **454**（8 职业 / 72 分支） |
| 技能 / 天赋 | 994 / 649 |
| 模组 | 898（**505 个含战斗数值**） |
| 召唤物 | 74（伤害型 42 / 功能型 8 / 装置 24） |
| 射程几何 | 73 |
| 敌人 | 2130（DEF/RES 分层） |
| 标准场景 / 来袭画像 | 6 / 5（画像锚点为真实敌人） |
| 场景基准线 | 433 名干员 × 6 场景分布 |

**满练口径** = E2 满级 + 技能专三（`levels[9]`）。面板含天赋通用加成（攻击%/攻速/防御%/生命%）；
潜能与信赖未计入。

---

## 验证体系（六套，全部可复跑）

```bash
node engine/test.mjs                   # 引擎 86 断言
node tools/verify-summons.mjs          # 召唤物 56 断言（含"通道不双算"）
node tools/verify-conditional.mjs      # 条件型 38 断言（含"不污染锚点"）
node tools/verify-ranges.mjs           # 射程几何 29 断言
node app/db/verify.mjs                 # 数据库 16 断言
node app/server/verify.mjs             # API 41 断言（需先起服务）
node app/server/verify-llm.mjs         # 模型接入 18 断言（本地 mock provider）
node tools/smoke.mjs                   # 全量冒烟 454 干员 × 3 配置 = 1362 次，意外异常须为 0
node tools/anchors.mjs                 # 生成锚点表（改数值逻辑后必跑）
node tools/crosscheck-prts-modules.mjs # 与 PRTS 独立对账（105 个模组逐条一致）
```

**最重要的原则：「数值零漂移」** —— 同一名干员，无论走
`JSON → 工具链` / `SQLite → API` 哪条路，结果必须与锚点**完全一致**。

关键锚点（回归对照）：银灰·真银斩 **5524.6** · 艾雅法拉·火山 **5832.0** ·
史尔特尔·黄昏 **5107.2** · 望·天下劫 轴 **179056** · 玛恩纳 **11645.8**（平A 0）·
Mon3tr **701.0** · 泥岩 vs 物理·精英 每击 278 / 15 击 / 39.0s。

---

## 架构

```
游戏数据仓库(ArknightsGameData) ──build-*.mjs──▶ data/*.json ──build-db.mjs──▶ SQLite ──▶ API ──▶ 前端
                                                │
                                                └──▶ tools/evaluate.mjs ──▶ engine/ ──▶ 多栏报告
```

**关键设计**：`engine/` 与 `tools/` 是**不依赖 DSH、不依赖软件层**的纯 Node 模块；
软件层只做数据存取与呈现，**不含任何评测逻辑** —— 所以前端怎么改，数值基线都不动。

---

## 目录

```
engine/                     数值引擎（纯数学，零依赖）
  dps-engine.mjs            伤害/攻速/SP/覆盖率/元素/陷阱/爆发/召唤物/穿透/减益
  survival.mjs              生存数学（离散受击/闪避/集火/等效生命）
  custom-operator.schema.json  自创干员输入 schema
  test.mjs                  86 断言
tools/                      评测管线
  evaluate.mjs              主入口：数据集干员 → 引擎输入 → 多栏报告
  patterns.mjs / overrides.mjs   描述解析双层（通用模式库 / 长尾补丁）
  modules.mjs / summon.mjs / conditional.mjs / range.mjs / section.mjs
  survival.mjs / versatility.mjs / rotation.mjs / difficulty.mjs / branch-traits.mjs
  build-*.mjs               数据管线（dataset / modules / summons / ranges / scenarios / baseline）
  verify-*.mjs / smoke.mjs / anchors.mjs   验证套件
data/                       数据集（入库，可从游戏数据一键重建）
app/                        独立软件
  db/                       SQLite 构建与访问层（12 张表）
  server/                   HTTP API + BYOK 模型接入（零依赖）
  web/                      Vite + React + TS 前端（零图表库）
docs/                       文档（见下）
examples/                   自创干员样例
```

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/DELIVERY.md`](docs/DELIVERY.md) | **项目全貌**：交付清单、架构、验证体系、决策与修正记录 |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **怎么接着做**：恢复步骤、踩坑清单、未完成项、数值锚点 |
| [`docs/dps-calculation.md`](docs/dps-calculation.md) | 计算链路与全部假设（§13 模组 / §14 生存 / §17–§24 召唤物·条件型·射程） |
| [`docs/eval-standards.md`](docs/eval-standards.md) | 评测标准（四项关键点 + 各栏口径 + LLM 介入点） |
| [`docs/summon-recon.md`](docs/summon-recon.md) | 召唤物侦察与设计 |
| [`docs/module-prts-crosscheck.md`](docs/module-prts-crosscheck.md) | PRTS 模组数值交叉校验（105/105 一致） |
| [`docs/data-inventory.md`](docs/data-inventory.md) / [`docs/mechanics.md`](docs/mechanics.md) | 数据资产清单 / 机制笔记 |
| [`NOTICE.md`](NOTICE.md) | 数据来源与版权声明 |

---

## 自己从零构建

```bash
# 1) 克隆游戏数据仓库（本项目不含原始数据）
git clone --depth 1 --filter=blob:none --sparse https://github.com/Kengxxiao/ArknightsGameData
cd ArknightsGameData && git sparse-checkout set zh_CN/gamedata/excel

# 2) 构建数据集与数据库（路径默认 E:/github/ArknightsGameData，否则改 tools/build-*.mjs 的 ROOT）
cd ../arknights-strength-agent
node tools/build-dataset.mjs && node tools/build-modules.mjs && node tools/build-summons.mjs
node tools/build-ranges.mjs && node tools/build-threat-scenarios.mjs && node tools/build-scenario-baseline.mjs
node app/db/build-db.mjs

# 3) 验证（应全绿）
node engine/test.mjs && node app/db/verify.mjs
node app/server/index.mjs --port 8787 &
node app/server/verify.mjs && node app/server/verify-llm.mjs
node tools/smoke.mjs
```

---

## 已知限制（诚实清单）

- **条件不成立就不算**：对空加成、距离/阻挡类条件型加成**不进基准 DPS**，
  报告单独标注并给出"条件满足时"的数值。
- **召唤物是一次性触发伤害**（梅尔 2664、傀影 1644 等）按次结算、**不给 DPS**
  （触发次数属玩法层）。
- **射程只标注不并进 DPS**：报告口径是"对单个目标"，群攻干员的实际清场效率高于对单值。
- **集火模型未含地形分流与阻挡分散**；生存为估算，未计入治疗干员支援。
- **敌人伤害类型不在游戏数据层**（由 prefab 决定）→ 来袭画像按"名字可确定判定"的真实敌人设定。
- **轴级最优节奏属玩法层**，描述推导不出，需用户给轴参数（已支持）。
- 潜能与信赖未计入面板；未完成项详见 `docs/HANDOFF.md` §8。

---

## 数据来源与声明

- **数值**：开源仓库 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)（zh_CN）的
  `character_table` / `skill_table` / `battle_equip_table` / `uniequip_table` / `range_table` / `enemy_database`
- **机制校验**：[PRTS Wiki](https://prts.wiki)（模组数值 105/105 一致；元素损伤数值取自其客户端 2.7.61）
- **本项目自有**：数值引擎、评测管线、评测标准与各栏口径、软件层
- **声明**：《明日方舟》及相关素材版权归**上海鹰角网络科技有限公司**所有。
  本项目为**非商业研究/学习工具**，与鹰角无关联。详见 [`NOTICE.md`](NOTICE.md)
