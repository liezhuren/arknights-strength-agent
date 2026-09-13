# 明日方舟干员强度评测 Agent —— 项目设计文档

> 状态：数据层 ✅ + 评测管线 ✅ + 语义校准 ✅ + 敌人场景库 ✅ + 自创干员闭环 ✅ + 场景评测 ✅ + 对比 ✅ + **agent skill 落地** ✅ · 待：dsh 工具插件（可选工程化）、用户细节
> 目标：在 DeepSeek Harness 中构建一个特化 agent，支持（1）评测现有干员强度（2）评测用户自创干员
> 数据源：游戏数据仓库（数值权威）+ PRTS wiki（中文描述/机制补充）

## 0. 已完成组件

| 组件 | 路径 | 状态 |
|---|---|---|
| 数值引擎原型（伤害公式/攻速/覆盖率/DPS画像/费用效率） | `engine/dps-engine.mjs` | ✅ 15/15 自测通过 |
| 引擎自测 | `engine/test.mjs` | ✅ `node test.mjs` 全绿 |
| 自创干员输入 Schema | `engine/custom-operator.schema.json` | ✅ JSON 校验通过 |
| 机制公式文档（含待校准清单） | `docs/mechanics.md` | ✅ |
| **游戏数据（11 张表已拉取）** | `E:\github\ArknightsGameData` | ✅ 网络窗口抓住 |
| **数据盘点脚本** | `tools/inspect-data.mjs` | ✅ 可重复运行 |
| **数据资产清单** | `docs/data-inventory.md` | ✅ 自动生成 |
| 设计文档 | `PROJECT-DESIGN.md` | ✅ |
| **数据管线** | `tools/build-dataset.mjs` → `data/operators.json`（416 干员 / 888 技能 / 7.93MB） | ✅ |
| **评测管线** | `tools/evaluate.mjs`（数据集→引擎→报告；CLI：`node tools/evaluate.mjs 银灰`，damageType 自动推断） | ✅ 真实干员跑通 |
| **敌人场景库** | `tools/build-enemy-scenarios.mjs` → `data/enemy-scenarios.json`（2130 敌人 DEF/RES 分层 + 16 组合代表） | ✅ |
| **技能语义探测** | `tools/probe-skills.mjs`（blackboard key 语义校准工具） | ✅ |
| **自创干员评测闭环** | `tools/evaluate-custom.mjs`（schema 动态校验→评测→报告；CLI：`node tools/evaluate-custom.mjs examples/custom-demo.json`） | ✅ 合法/非法样例验证 |
| **示例** | `examples/custom-demo.json`（合法）/ `custom-invalid.json`（非法） | ✅ |
| **标准场景** | `tools/build-scenarios.mjs` → `data/scenarios.json`（6 场景：清杂低甲/中甲/高甲/高抗/Boss/极高抗） | ✅ |
| **场景评测** | `tools/scenario-eval.mjs`（分场景 DPS 画像；支持数据集干员 + `--custom` 自创干员） | ✅ 物理/法术规律验证 |
| **对比评测** | `tools/compare.mjs`（多干员分场景对比 + `--all-skills` 全技能模式，每场景最佳标 ★） | ✅ |
| **Agent Skill（特化 agent 落地）** | `~/.dsh/skills/arknights-evaluator/SKILL.md`（dsh 自动发现，任何会话可用） | ✅ 已注册本会话 |
| **强化攻击模型 + 校准表** | `engine/dps-engine.mjs`（nextAttackDps）+ `tools/overrides.mjs`（特殊机制校准：棘刺等） | ✅ |
| **SP 模型 v2** | auto→面板 spRecoveryPerSec / attack→计入 increment / 受击回复 hit（含受击频率假设）/ 部署触发 deploy（数字8）；强化攻击按回复类型算周期 | ✅ 测试 15→23 |
| **元素损伤累积 v1** | 引擎 elementAccrualPerSec（每击型/dot 型）+ evaluate extractElement（类型/ratio 识别）→ 报告"元素累积/秒"；爆发收益数值待 PRTS 核实 | ✅ 测试 23→26；妮芙/塑心/酒神手算自洽 |
| **元素爆发收益** | PRTS(2.7.61) 核实损伤条（普通1000/领袖2000）+ 敌人爆条收益表（神经6000/侵蚀5000/灼燃7000/凋亡12000）→ elementBurstAvgDps | ✅ 测试 26→30 |
| **陷阱/棋子模型 v1** | 6 陷阱师识别 + trapDps（倍率×cnt/cdSec）+ 普攻倍率强制 1（防 atk_scale 误用）+ compare 越界回退 | ✅ 测试 30→33；望S3=1492 等手算自洽 |
| **LLM 描述解析层** | 架构：读描述（dump-op.mjs）→ agent 生成机制补丁 → overrides.mjs 沉淀 → 引擎消费；已沉淀棘刺 S3（倍率）、望 S3（burst：十字5枚×8部署，单次技能 89528/14s、理想轴 179056/78s→2296，实测校准） | ✅ 示范通过 |
| **天赋计入 + 口径分层** | extractTalentBonuses（atk 加法%/攻速/防御/生命 → 面板；118 干员含攻击力天赋、56 含攻速）；报告显示天赋清单；单次部署/单次技能/轴三层口径分开报；评测定位=强度量级评判（非极限复现） | ✅ 测试 38/38 |
| **破甲穿透** | 伤害公式支持无视固定防御/无视%防御/无视固定法抗（26 干员；艾拉"无视800防"验证） | ✅ 测试 43/43 |
| **对敌减益（自身受益）** | `enemyDebuff`（技能层+天赋层；单位归一：小数% / 绝对点数）；伊芙利特减抗44、多萝西减防35 已计入 DPS | ✅ |
| **三栏评测标准** | `docs/eval-standards.md`：输出栏 / 团队增益栏 / 控制栏（维度、折算公式、评级框架、LLM 介入点） | ✅ 设计落地 |
| **②团队增益栏 + ③控制栏** | `tools/extra-metrics.mjs`：提取（减防/减抗/易伤脆弱/虚弱/友方增益；眩晕/停顿/束缚/睡眠/恐惧）+ 折算（对标准队友输出提升%）+ 描述型控制提取（铃兰 S3 停顿） | ✅ 铃兰/伊芙利特验证 |
| **控制覆盖率（触发间隔）** | 控制强度 = 单次时长 ÷ 攻击间隔（含攻速/base_attack_time 修正）；水月 S3 28.6% vs S2 65% 验证；保持"类型分级+时长分列"不做换算 | ✅ |
| **模组纳入** | 数据集补模组元数据（391 干员 / 20 个特限）；`MODULE_OVERRIDES` 沉淀数值效果（水月特限 ISW-α 从 PRTS 解析）；报告标注生效范围（特限仅对应玩法） | ✅ 水月验证 |
| **通用描述模式库（第一层解析）** | `tools/patterns.mjs`：数据驱动覆盖高频表述（额外攻击N目标 9 干员 / 停止攻击 52 / 连击 36 / 同时攻击 27 / 充能 28 / 蓄力·对空·减速）→ 自动转引擎参数；报告显示"描述解析"发现 | ✅ 未打补丁的水月自动解析验证（S3 3目标/S2 2目标） |
| **技能期停止攻击** | 引擎 `noAttack`：停止攻击型技能技能期普攻不计（铃兰 S3 技能期 DPS 归零，符合纯控制定位） | ✅ |
| **权限** | `/permission danger-full-access` 已切换，无审批弹窗 | ✅ 用户已授权 |

## 0.4 Agent 集成（goal round 8）

- **Skill 形态（已落地）**：`~/.dsh/skills/arknights-evaluator/SKILL.md` —— dsh 原生 skill 发现（`~/.dsh/skills/<name>/SKILL.md`，watcher 自动生效），包含：评测工具调用表、输出解读规则（物理看 DEF/法术看 RES、覆盖率、费效）、评测回答形态、自创干员流程、已知限制
- **对比示例**（银灰 vs 史尔特尔 vs 艾雅法拉 S3）：高甲/低抗场景法术碾压（黄昏 7094 vs 真银斩 1935）；高抗场景物理反超（真银斩 4037 vs 黄昏 2483）；Boss 攻坚黄昏 3900 最优 —— 每个场景赢家不同 = "强度内容相关"的直接证据
- **已知限制（skill 内如实声明）**：下次攻击型技能（强力击类）无 DPS 模型；天赋/模组/潜能未计入面板；生存/控制维度未建模

## 0.2 评测管线 MVP 结果（goal round 4-5，已校准）

- **银灰·真银斩**（physical）：ATK713/1.3s/SP90(初75)/30s/×2/6目标 → vs400防 平均 DPS **3237** · 费效 161.9
- **艾雅法拉·火山**（magical，自动推断）：ATK645/间隔-1.1s/SP80(初55)/15s/×1.3/6目标 → vs50抗 平均 DPS **2011** · 费效 95.8
- **史尔特尔·黄昏**（magical，artsfghter 兜底）：永续覆盖率100% ×3.3/4目标 → vs50抗 DPS **3545** · 费效 168.8
- **能天使·过载模式**（physical）：×1.1/5段/间隔-0.11s → vs400防 平均 DPS **709** · 费效 50.7
- 数值全部人工核对自洽 ✓

## 0.3 倍率语义映射结论（goal round 5，probe-skills.mjs 实证）

| blackboard key | 语义 | 引擎映射 |
|---|---|---|
| `atk` | 攻击力倍率（值即 1+X%，真银斩 2=+100%、黄昏 3.3=+230%） | attackMult |
| `atk_scale` | 单次攻击伤害倍率（强力击 2.9） | attackMult |
| `attack@atk_scale` | 命名空间倍率（能天使 1.1） | attackMult |
| `base_attack_time` | 攻击间隔秒差（火山 -1.1s，**减法**） | baseAttackTimeDelta |
| `attack_speed` | 攻速百分比（棘刺 +25） | aspdBonus |
| `attack@times` | 连射段数（能天使 5） | hits |
| `attack@max_target` | 同时目标数（真银斩 6） | targetCount |
| 描述含"法术/物理/真实伤害" | damageType 推断 | inferDamageType |
| 职业 CASTER / artsfghter | damageType 兜底 | magical |
| `duration < 0` | 永续技能（黄昏），覆盖率=1 | skillCoverage |

**敌人场景库**（`data/enemy-scenarios.json`）：DEF 分层 低<200×785 / 中200-500×601 / 高500-1000×444 / 重≥1000×300；RES 分层 低<20×860 / 中20-50×718 / 高50-80×493 / 极高≥80×59；16 个 DEF×RES 组合代表敌人；知名 Boss 已查证（爱国者 500防/45抗/45000HP、塔露拉 700防/50抗/50000HP、重装防御者 800防/0抗）。

## 0.1 数据盘点关键结论（goal round 3）

- 真干员 **416** 个（6★×115 / 5★×193 / 4★×70 / 3★×22 / 2★×5 / 1★×11；排除 TRAP 840 + TOKEN 74 + 异格标记）
- **满练面板**：`character_table[].phases[最后]`（E2）→ `maxLevel`（6★=90）+ `attributesKeyFrames` 末段
  - 关键字段：`maxHp/atk/def/magicResistance/cost/blockCnt/baseAttackTime(基础攻击间隔)/respawnTime/spRecoveryPerSec` + 状态免疫 flag
- **技能**：`skill_table` key 为 `skillId`（带 `[N]` 后缀），字段 `levels[0..9]`（8/9/10=专一/二/三），数值在 `blackboard`（`attack_speed=100` 等）+ `duration`
- **敌人**：`enemy_database.enemies` 数组，每项 `{Key: id, Value: [难度等级]}`，字段 `{m_defined,m_value}` 包装；样例：简饲源石虫 4500HP/200atk/50def/0抗
- **模组**：`uniequip_table.equipDict`，898 个模组
- **攻击范围**：range_table 73 种形状
- **常量**：gamedata_const 含 `attackMax/defMax/hpMax` 等

## 5. 下一步计划

1. **体验**：用户直接试用（本会话已注册 skill）—— "评一下/对比一下/我设计的干员" 即可
2. **可选工程化**：注册为 dsh 工具插件（ctx.tools，正式模型可调用工具，需重建 web bundle）
3. **引擎增强**（按需）：下次攻击型技能 DPS 模型、天赋/模组计入面板、生存/控制维度
4. 等待用户确认：输出形态 / 评测深度 / 交互形态 / 数据范围

---

## 1. 已验证的基础资产（本轮完成）

### 1.1 游戏数据仓库（数值真相源）

- 仓库：`Kengxxiao/ArknightsGameData`（zh_CN）
- 本地位置：`E:\github\ArknightsGameData`（sparse clone 已完成，`.git` 完整）
- **待办**：网络恢复后拉取数据 blobs（见 §5）

已确认的关键数据表（精确路径）：

| 表 | 路径 | 用途 |
|---|---|---|
| 干员 | `zh_CN/gamedata/excel/character_table.json` | 面板/特性/天赋/技能引用/潜能 |
| 技能 | `zh_CN/gamedata/excel/skill_table.json` | 技能数值（倍率/SP/持续时间/专精） |
| 敌人 | `zh_CN/gamedata/levels/enemydata/enemy_database.json` | 敌人数值（注意：**不在 excel 目录**） |
| 敌人图鉴 | `zh_CN/gamedata/excel/enemy_handbook_table.json` | 敌人中文描述 |
| 模组 | `zh_CN/gamedata/excel/uniequip_table.json` + `uniequip_data.json` | 模组数值 + 文本 |
| 攻击范围 | `zh_CN/gamedata/excel/range_table.json` | 射程形状 |
| 常量 | `zh_CN/gamedata/excel/gamedata_const.json` | 全局数值常量 |
| 专精/升级 | `zh_CN/gamedata/excel/char_master_table.json` | 技能专精数据 |
| 档案 | `zh_CN/gamedata/excel/handbook_table.json` | 干员档案（可能用于 flavor） |
| 关卡 | `zh_CN/gamedata/excel/stage_table.json` | 关卡/敌人编队（可选） |

### 1.2 网络状况（重要）

- git 全局代理配置：`http://127.0.0.1:7897`（Clash 系）—— **当前无进程监听该端口，代理未开启**
- 直连 GitHub：不稳定（曾成功 1 次，随后连续失败，疑似 GFW 干扰）
- **绕过方式（已验证可行）**：`git -c http.proxy= -c https.proxy= -c http.sslBackend=openssl <cmd>`
- PRTS 爬取路径：沙箱内 curl 的 schannel TLS 有问题；代理开启后可用 `curl -x 127.0.0.1:7897` 让代理代做 TLS
- **请用户配合**：使用本项目期间保持代理软件开启（端口 7897），或告知新的代理端口

### 1.3 PRTS 爬取先例（已有社区方案）

- [3aKHP/prts-mcp](https://github.com/3akhp/prts-mcp) —— PRTS Wiki + 本地游戏数据的 MCP Server（有 Python 和 TypeScript 双实现，npm 包 `prts-mcp-ts`）→ **强烈建议借鉴其 PRTS 数据获取实现**
- [TonybotNi/Doctah-MCP](https://github.com/TonybotNi/Doctah-MCP) —— 另一款方舟 MCP
- [PRTS 爬取实战教程（cnblogs）](https://www.cnblogs.com/foxcharon/p/22643886) —— 验证了 PRTS 爬取可行
- PRTS 是 MediaWiki，可用 `api.php`（action=parse / query）或 Cargo 数据库；内容许可 **CC BY-NC-SA**（个人/学习可用，勿商用）

---

## 2. 四层架构（设计草案）

```
┌─────────────────────────────────────────────────────────┐
│ ④ Agent 层：dsh 特化 agent（工具型）                      │
│    工具：查干员 / 查敌人 / DPS 模拟 / 机制词典 / 自创干员输入│
├─────────────────────────────────────────────────────────┤
│ ③ 评测引擎（核心难点）                                    │
│    分场景（合约/肉鸽/日常/Boss）× 多维画像（输出/生存/控制/  │
│    费用效率/泛用性），数值引擎 + LLM 推理解读              │
├─────────────────────────────────────────────────────────┤
│ ② 机制层：伤害公式、物理/法术、攻速、DP/再部署/阻挡/射程、  │
│    状态机制（眩晕/冰冻/束缚/脆弱）、模组/潜能/专精         │
├─────────────────────────────────────────────────────────┤
│ ① 数据层：ArknightsGameData（数值）+ PRTS（中文描述）      │
│    满练 = E2 满级 + 技能专三 + 模组（X/Y/δ）+ 潜能         │
└─────────────────────────────────────────────────────────┘
```

## 3. 核心设计判断

1. **强度是内容相关的** → 不做单一强度分，做"分场景 + 多维画像"，由 agent 按场景推理
2. **数据双源**：游戏仓库当数值真相源（精度高、无需爬几千页面），PRTS 当中文描述/机制补充源
3. **用户自创干员** = 同一套画像管线吃用户结构化输入（面板/技能/天赋），跑同一评测流程
4. **评测 = 数值引擎 + LLM 解读**：引擎算 DPS 曲线/生存等硬指标，agent 负责场景适配和定性结论

## 4. 开放决策点（等待用户细节）

- [ ] 输出形态：S/A/B 分级？分场景报告？数值+评语混合？
- [ ] 评测深度：纯规则/模拟，还是 LLM 推理生成评价？
- [ ] 交互形态：dsh 对话内工具型 agent？独立脚本？
- [ ] 数据范围：先六星 MVP，还是全星级？

---

## 6. 数据层完整记录（goal round 1-3，历史）

见 §0/§0.1/§0.2 与 `docs/data-inventory.md`、`docs/mechanics.md`。

*创建于 goal round 1 · 网络阻塞期间完成离线部分*
