# 明日方舟强度评测 · 交付文档

> **用途**：项目交付与总结用。要"续做"请看 [HANDOFF.md](./HANDOFF.md)（含恢复步骤与踩坑）；
> 本文讲**做成了什么、依据是什么、怎么验证的、还差什么**。
> **最后更新**：召唤物数据管线落地时。

---

## 0. 一句话概括

把《明日方舟》的游戏数据（454 名满练干员 / 994 技能 / 898 模组 / 74 召唤物）变成一套**可复算、可解释、可验证**的强度评测系统：
一个零依赖 Node 数值引擎 + 评测管线，外挂一个本地单机软件（React 前端 + SQLite + 可接多模型）。

---

## 1. 项目定位（用户明确，写在最前面防止跑偏）

**强度是内容相关的** —— 不做单一分数，输出「分场景 + 多维画像」，由 agent 结合场景给结论。

### 1.1 四项关键点 + 生存的定位

| 关键点 | 状态 | 实现 |
|---|---|---|
| **① DPS** | ✅ | 分场景画像（6 标准场景）、技能期/平均/费效、覆盖率 |
| **② 泛用性** | ✅ | 场景覆盖（对全库可用线）+ 波动比 + 属性衰减 + 四级分类 |
| **③ 操作难度** | ✅ | 六类客观项 + 低/中/高分级（**不合成假分数**） |
| **④ 回转时间** | ✅ | 首轮可用 / 完整周期 / 空窗 / 60·90s 内可开次数 |
| **⑤ 生存** | ✅ | **"锦上添花但仍是关键一环"** —— 默认低权重（队友能保输出位），仅对承伤位与"以生存换输出"的分支是硬指标 |

### 1.2 输出形态：多栏并列，互不合并

```
【干员名】稀有度 · 职业 / 分支
├─ ① 输出栏      分场景 DPS / 覆盖率 / 费效 / 通道（稳态·爆发·陷阱·元素·召唤物）
├─ 泛用性        六场景 vs 全库可用线 → 全能型/通用型/偏科型/特化型
├─ 操作难度      客观约束清单 + 分级
├─ 回转          首轮可用时间 / 周期 / 空窗
├─ ② 团队增益栏   对队友输出折算提升%（基准 400防/50抗/ATK800）
├─ ③ 控制栏      类型分级 + 时长分列 + 触发间隔 → 覆盖率（**不做类型换算**）
└─ ④ 生存栏      分档硬扛（每击/可挨击数/秒数）+ 自回/闪避/减伤/屏障/抵抗/免疫
附：假设与条件（⚠ 报告会显式列出未计入项）
```

**硬约束**：②③④ 与泛用性/操作难度/回转**都不并入 DPS 数字**；所有假设必须在报告里标注。

---

## 2. 交付物清单

```
E:\github\arknights-strength-agent\
├── engine\                     数值引擎（纯数学，零依赖）
│   ├── dps-engine.mjs          伤害/攻速/SP/覆盖率/元素/陷阱/爆发/召唤物/穿透/减益
│   ├── survival.mjs            生存数学（离散受击/闪避/等效生命）
│   └── test.mjs                **63 条断言**（node engine/test.mjs）
├── tools\                      评测管线
│   ├── evaluate.mjs            主入口：数据集干员 → 引擎输入 → 多栏报告
│   ├── modules.mjs             模组启用层（构造"模组修改后的干员对象"）
│   ├── survival.mjs            ④ 生存栏提取与呈现
│   ├── versatility.mjs         泛用性（场景覆盖/波动比/属性衰减）
│   ├── rotation.mjs            回转时间
│   ├── difficulty.mjs          操作难度
│   ├── branch-traits.mjs       状态型分支（阵法术师/解放者 两态）
│   ├── extra-metrics.mjs       ②团队增益栏 + ③控制栏
│   ├── patterns.mjs            第一层：通用描述模式库
│   ├── overrides.mjs           第二层：LLM 解析补丁（含召唤物兜底位）
│   ├── build-dataset.mjs       数据管线 → data/operators.json
│   ├── build-modules.mjs       模组数值 → data/modules.json
│   ├── build-threat-scenarios.mjs  来袭画像 → data/threat-scenarios.json
│   ├── build-scenario-baseline.mjs 场景基准线 → data/scenario-baseline.json
│   ├── build-summons.mjs       召唤物 → data/summons.json
│   ├── module-eval.mjs         模组三配置对照（无/默认/特限）
│   ├── survival-eval.mjs       ④ 生存栏独立入口（**不依赖技能**，1★ 也能评）
│   ├── evaluate-custom.mjs     自创干员评测（schema 校验）
│   ├── anchors.mjs             锚点表生成（输出+生存+模组）
│   ├── smoke.mjs               全量冒烟（454 干员 × 3 配置）
│   ├── crosscheck-prts-modules.mjs  PRTS 模组数值交叉校验
│   └── compare/ scenario-eval/ dump-op/ verify-module-index …
├── data\                       数据集（**入库**）
│   ├── operators.json          454 干员 / 994 技能 / 649 天赋（含分支特性与模组元数据，9.6 MB）
│   ├── modules.json            898 模组（**505 个含战斗数值**，1.4 MB）
│   ├── summons.json            74 召唤物（50 输出型 / 14 功能型 / 10 装置，23 KB）
│   ├── scenarios.json          6 标准场景
│   ├── threat-scenarios.json   5 档来袭画像（锚点为真实敌人）
│   ├── scenario-baseline.json  全库 433 干员 × 6 场景可用线
│   └── enemy-scenarios.json    2130 敌人 DEF/RES 分层
├── app\                        **独立软件**
│   ├── db\build-db.mjs         data/*.json → SQLite（6.1 MB）
│   ├── db\index.mjs            访问层（软件唯一数据入口）
│   ├── db\verify.mjs           **16 条断言**
│   ├── server\index.mjs        HTTP API（Node 内置 http，零依赖）
│   ├── server\llm.mjs          BYOK 多 provider 模型接入
│   ├── server\verify.mjs       **30 条断言**
│   ├── server\verify-llm.mjs   **18 条断言**（本地 mock provider 验协议）
│   ├── web\                    Vite + React + TS 前端（零图表库，纯 SVG/CSS）
│   └── config.example.json     模型配置模板（真实 config.json 已 gitignore）
├── docs\                       文档
│   ├── HANDOFF.md              上下文恢复与踩坑（**续做先读这份**）
│   ├── DELIVERY.md             本文（交付与总结）
│   ├── eval-standards.md       评测标准（四项关键点 + 各栏口径 + LLM 介入点）
│   ├── dps-calculation.md      计算链路 / §13 模组 / §14 生存 / §15 分支特性 / §16 分支状态
│   ├── summon-recon.md         召唤物侦察与设计
│   ├── module-prts-crosscheck.md  PRTS 交叉校验报告（105/105 一致）
│   └── data-inventory.md / mechanics.md
└── NOTICE.md                   数据来源与版权声明
```

**远程仓库**：`git@github.com:liezhuren/arknights-strength-agent.git`（分支 `master`）

---

## 3. 架构

### 3.1 数据流

```
游戏数据仓库(ArknightsGameData) ──build-*.mjs──▶ data/*.json ──build-db.mjs──▶ SQLite ──▶ API ──▶ 前端
                                                │
                                                └──▶ tools/evaluate.mjs ──▶ engine/ ──▶ 多栏报告
```

**关键设计**：`engine/` 与 `tools/` 是**不依赖 DSH、不依赖软件层**的纯 Node 模块；
软件层只做数据存取与呈现，**不含任何评测逻辑**。因此前端怎么改，数值基线都不动。

### 3.2 技能形态分类（决定走哪个通道，套错量级全错）

| 形态 | 通道 |
|---|---|
| 稳态持续 | 覆盖率模型（周期 = 充能 + 持续） |
| 单次窗口爆发 | `burst`（部署次数 × 每次枚数，分层口径） |
| 陷阱/棋子触发 | `trap`（倍率 × 产出数 / CD） |
| **召唤物** | `summon` ⏳ 数据已备，通道待建 |
| 元素累积 | `element`（累积速率 + 爆发收益） |
| 下次攻击强化 | `nextAttack`（每 N 次攻击 1 次强化） |
| 技能期停止攻击 | `noAttack`（技能期普攻不计） |

### 3.3 描述解析双层（**核心方法论**）

- **第一层 `patterns.mjs`**：通用表述 → 引擎参数（自动生效）。
  覆盖：额外目标 / 停止攻击 / 连击 / 同时攻击 / 充能 / 蓄力 / 对空 / 减速 / 闪避 / 自回 / 减伤。
  **判断标准：同一表述出现在多个干员身上 → 必须写进这一层。**
- **第二层 `overrides.mjs` + 软件里的 AI 解析**：长尾独有机制的人工/AI 补丁。
  AI 产出入库沉淀、可导出审核片段，**但绝不自动注入引擎**（未经审核的模型输出不影响数值）。

### 3.4 数据类机制的通用解法（可复用的三条）

1. **单位归一**：`|v| ≤ 1` 视为小数百分比，`> 1` 视为固定点数（减益、天赋加成、特性加成通用）
2. **描述判定代替数值猜测**：`prob` 是通用概率键 → 靠描述含"闪避"区分；天赋 `atk>1` 是点数还是比例 → 看描述里有没有对应百分数
3. **替换 vs 追加**：模组天赋 `talentIndex` 命中即替换（`isHideTalent` 例外按追加）；特性看 `overrideDescripton`（覆盖）还是 `additionalDescription`（追加）

---

## 4. 软件形态

### 4.1 启动

```bash
# 1) 重建数据库（改了 data/ 后；**需先停掉服务**，Windows 文件锁）
node app/db/build-db.mjs
# 2) 起服务（API + 静态托管前端）
node app/server/index.mjs --port 8787     # → http://127.0.0.1:8787
# 3) 前端开发模式（可选，热更新）
cd app/web && pnpm dev                    # /api 反代到 8787
```

**端口 8787 独立于 DSH 自己的 3080**；绑定 `127.0.0.1`，仅本机可访问。

### 4.2 五个页签

| 页签 | 内容 |
|---|---|
| 干员浏览 | 名称检索 + **职业→分支二级筛选**（72 分支带中文名）+ 面板与分支特性表格 |
| 评测面板 | 技能/伤害类型/模组选择 + **轴参数输入**（爆发型）+ 关键指标卡片 + **五组图表** + 六栏文本 + **AI 解析技能描述**按钮 |
| 多干员对比 | 最多 6 名，含泛用性分级/操作难度/首轮可用时间 |
| 自制干员 | JSON 编辑 → schema 校验 → 存库 / 评测（严格对齐 `custom-operator.schema.json`）|
| 模型设置 | BYOK 多 provider + 测试连接 + **解析沉淀列表 + 导出审核片段** |

### 4.3 接口与数据

- API 分组：`operators`（检索/详情/facets）、`scenarios`、`evaluate`、`compare`、`custom`（CRUD+评测）、`evaluations`（历史）、`config`（BYOK 脱敏读写）、`llm`（status/ping/parse/parses/export）
- SQLite 表：`operators` / `talents` / `skills` / `skill_levels` / `modules` / `module_levels` / `scenarios` / `threat_profiles` / `scenario_baseline` / `custom_operators` / `evaluations` / `mechanism_parses`
- **重建数据库会备份并回填用户数据**（自制干员/评测历史/解析沉淀）；被服务占用时给出明确提示
- **模型**：`provider` 为空 = 纯规则层，功能完整（硬约束）。Key 只落本地 `app/config.json`，接口永不回显

---

## 5. 验证体系（五套，全部可复跑）

| 套件 | 命令 | 断言数 | 验证什么 |
|---|---|---|---|
| 引擎 | `node engine/test.mjs` | **63** | 伤害公式/攻速/SP/覆盖率/强化攻击/元素/陷阱/爆发/穿透/减益/生存/召唤物 |
| 数据库 | `node app/db/verify.mjs` | **16** | 检索/详情/场景/自制干员/历史 + **DB 还原对象进评测管线数值=锚点** |
| API | `node app/server/verify.mjs` | **30** | 全部接口 + **经 API 的数值=锚点** + 轴参数等比缩放 + 图表值与文本一致 |
| 模型接入 | `node app/server/verify-llm.mjs` | **18** | 用**本地 mock provider** 验协议（URL/鉴权头/请求体/system 提示）+ 降级路径 + 沉淀与缓存 |
| 全量冒烟 | `node tools/smoke.mjs` | 1362 次调用 | 454 干员 × {无模组/默认/特限}，**意外异常必须为 0** |

**另有**：
- `node tools/anchors.mjs` —— 生成锚点表（输出+生存+模组三配置），改数值逻辑后必跑
- `node tools/crosscheck-prts-modules.mjs` —— 与 PRTS 独立对账（**105 模组逐条一致**）

### 5.1 最重要的验证原则

**「数值零漂移」**：同样的干员，无论走
`JSON → 工具链` / `SQLite → API` 哪条路，结果必须与锚点**完全一致**。
实测：银灰 5524.6 在三条路径上一致；望 179056 在加入轴参数后默认口径不变。

---

## 6. 关键数值锚点（回归对照）

| 对象 | 值 |
|---|---|
| 银灰·真银斩（物理 vs400防） | 技能期 **5524.6** / 平A 306.2 / 平均 3785.1 / 覆盖 66.7% |
| 艾雅法拉·火山（法术 vs50抗） | 技能期 **5832.0** / 平均 2333.1 |
| 史尔特尔·黄昏（法术，永续） | **5107.2**（含天赋穿透 无视22法抗） |
| 能天使·过载（物理） | 技能期 1586.4 / 平均 1036.0 |
| 水月·镜花水月（物理） | 技能期 902.6 / 平均 532.4 |
| 望·天下劫（爆发） | 每次部署 11191 / 单次技能 89528·14s / **轴 179056·78s→2296** |
| 玛恩纳·未照耀的荣光 | 技能期 **11645.8**（解放者蓄力 ×5）/ 平A 0 |
| 蜜蜡（阵法术师两态） | 常态 防御 615 → 技能期 205，**可挨 11 击 → 4 击（×0.36）** |
| 泥岩（vs 物理·精英） | 每击 278 / 可挨 15 击 / 39.0s（减伤 30%） |
| 星熊[X 模组] | 防御 1460（含追加 防御+20%）→ **站得住** |
| 泛用性 | 银灰 全能型(6/6·0.54)；**能天使 通用型（护甲衰减 95%、波动比 0.07）** |
| 回转 | 能天使首轮 **10s** / 银灰 15s / 水月 30s / 史尔特尔 永续 |
| PRTS 模组对账 | **105/105 一致**，0 不一致 |
| 召唤物关联 | 代号段匹配 **73/74**（唯一未关联为地图装置） |

---

## 7. 决策与修正记录（**含被推翻的判断**，避免重复踩）

| 事项 | 曾经的判断 | 最终结论 | 依据 |
|---|---|---|---|
| 模组数值来源 | "仓库只有元数据，数值在 PRTS" | **仓库里就有**（`battle_equip_table.json`，505 个模组全含） | 实测解析成功 + PRTS 105/105 印证 |
| 基础分支特性 | "游戏数据里根本不存在" | **在 `character_table` 的干员级 `description`**（454/454），我当初只读了 `trait` 字段 | 水月本体 50% 物法闪避此前被漏算 |
| `token_table.json` | 以为它是召唤物名录 | **不是**（只有 4 条 `trap_*` 地图装置）；召唤物在 `character_table` 的 TOKEN 职业下 | 实测 74 条 TOKEN |
| 召唤物关联 | 以为需要 LLM 兜底 | **代号段匹配确定性解决**（`char_003_kalts` ↔ `token_10002_kalts_mon3tr`），73/74 | 实测 |
| `deepseek-flash` 视觉能力 | 我据 HTTP 状态码判断"**不支持**图片" | **支持**（官方文档 + 真实图片测试双重确认）；我那张 1×1 PNG 是坏样本 | 用户提供官方文档 + 真图复测 |
| 变更 CSS 类名 | —— | `.bar` 同时用作"筛选行容器"与"图表横条"→ 筛选行被套蓝色背景且延伸满屏 | 用户截图指出 |

---

## 8. 踩坑清单（按类型，完整版见 HANDOFF.md §5）

**游戏数据**
- 模组 `attributeBlackboard` 是**该级累积总值**，不是增量，勿累加
- 393 个 ORIGINAL（干员证章）**在战斗表中无条目** → 无数值效果（PRTS 双证）
- 模组天赋是**替换**语义；`isHideTalent` 例外按追加（否则误删本体天赋）
- 特性文本在**干员级 `description`**，`trait` 字段只在带数值时非空
- 天赋 `atk > 1` 是**固定点数**不是百分比（乌尔比安被算成 +3000%）
- `prob` 是通用概率键，必须靠描述区分闪避；"物理和法术闪避"要**双算**
- 敌人**伤害类型不在数据层**（由 prefab 决定）→ 来袭画像按可判定敌人设定
- 技能 `atk_scale` 与 `attack@atk_scale` 并存时**优先后者**（玛恩纳 S3 曾算成 0.12 倍）

**数值建模**
- 生存时长**不能用**"血池 ÷ 每秒承伤"（单击致死会误报 4.9s，实际 1 击即倒）→ 必须离散受击模拟
- 等效生命 = 血池 × 防御折算 × 闪避倍率（**各乘一次**；曾把闪避乘两次）
- 爆发通道默认不吃 DEF/RES → 已加**可选** mitigation（默认关闭以保锚点）

**工程**
- `~/.npmrc` 与 git 全局配置里写死了**失效的本地代理** `127.0.0.1:7897` → npm/git 全部 `ECONNREFUSED`
- **PowerShell 会破坏 UTF-8 与转义**：改含中文的源码/提交信息一律用文件工具或 `git commit -F`
- **`vite build` 不做类型检查** → 必须同时跑 `tsc -b`
- 数据库被运行中的服务占用 → `EPERM`，重建前先停服务
- 断言写太宽会掩盖失败（曾写 `ok || 有 errors`，把校验失败也放过了）

---

## 9. 未完成项（诚实清单）

| # | 项 | 状态 |
|---|---|---|
| 1 | **召唤物通道** | ⏳ **数据已就绪**（`data/summons.json`：50 输出型/14 功能型/10 装置），**引擎通道与报告行未建** —— 输出型召唤物的伤害目前仍未计入 |
| 2 | 模组条件型特性折算 | 对空/距离类只标注不计入（阻挡类已按"持续阻挡假设"计入）|
| 3 | 模组 `※` 叠加备注 | PRTS 有（如"多个伏击客X模组间减速可叠加"），未采集 |
| 4 | 模式库扩容 | 蓄力强化数值取法、优先攻击索敌、"对空"对场景的意义 |
| 5 | 生存多敌人集火模型 | 现按单敌人给数，集火靠人工判断 |
| 6 | 基础特性的范围/索敌几何 | 技能 `rangeId` 未入库，范围形状未建模 |
| 7 | 召唤物自身技能 | `summons.json` 已记录 `skillIds`，但未建模 |

### 已知口径限制（设计边界，非缺陷）
- 结论是**量级评判**，不追求复现理论极限轴；轴级参数需用户给（已支持）
- 面板含天赋通用加成（攻击%/攻速/防御%/生命%），**潜能/信赖/模组未全量折入**
- 治疗输出、闪避、集火等均为**估算**，报告已标注

---

## 10. 数据来源与声明

- **数值**：开源仓库 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)（zh_CN）的
  `character_table` / `skill_table` / `battle_equip_table` / `uniequip_table` / `enemy_database`
- **机制校验**：[PRTS Wiki](https://prts.wiki)（模组数值 105/105 一致；元素损伤爆发数值取自其客户端 2.7.61）
- **本项目自有**：数值引擎、评测管线、四项关键点/生存/三栏的评测标准、场景与来袭画像口径、软件层
- **声明**：《明日方舟》及相关素材版权归**上海鹰角网络科技有限公司**所有；本项目为**非商业研究/学习工具**，
  与鹰角无关联；数值为离线推算，不保证与游戏内一致。详见 `NOTICE.md`

---

## 11. 复现步骤

```bash
# 0) 前置：克隆游戏数据仓库（本项目不含原始数据），路径默认 E:/github/ArknightsGameData
git clone --depth 1 --filter=blob:none --sparse https://github.com/Kengxxiao/ArknightsGameData

cd arknights-strength-agent
node tools/build-dataset.mjs            # → data/operators.json
node tools/build-modules.mjs            # → data/modules.json
node tools/build-summons.mjs            # → data/summons.json
node tools/build-threat-scenarios.mjs   # → data/threat-scenarios.json
node tools/build-scenario-baseline.mjs  # → data/scenario-baseline.json
node app/db/build-db.mjs                # → app/db/arknights.db

# 验证（应全绿）
node engine/test.mjs                    # PASS=63 FAIL=0
node app/db/verify.mjs                  # PASS=16 FAIL=0
node app/server/index.mjs --port 8787 & # 起服务
node app/server/verify.mjs              # PASS=30 FAIL=0
node app/server/verify-llm.mjs          # PASS=18 FAIL=0
node tools/smoke.mjs                    # 意外异常 0

# 软件
cd app/web && pnpm install && pnpm build && cd ../..
# 浏览器打开 http://127.0.0.1:8787
```

---

## 12. 后续建议（按性价比排序）

1. **召唤物通道**（数据已就绪，工作量最小、收益最大 —— 50 个输出型召唤物目前完全没算）
2. 模组条件型特性折算（对空/距离）→ 模组数值利用率提升
3. 生存集火模型（多敌人压力）
4. 召唤物自身技能建模（`skillIds` 已在数据里）
5. `git init` 已完成；建议后续按功能切换分支，别再长时间无版本控制
