# arknights-strength-agent · 明日方舟干员强度评测 Agent

基于 DeepSeek Harness 的特化 agent：以本地游戏数据驱动的数值引擎评测明日方舟干员强度，支持**现有干员**（416 名满练数据）与**用户自创干员**，输出**分场景输出画像**而非单一强度分——因为方舟的强度是内容相关的（物理怕高甲、法术怕高抗、每个场景赢家不同）。

## 快速开始

```bash
# 评测现有干员（S3 默认，damageType 自动推断）
node tools/evaluate.mjs 银灰

# 指定技能/伤害类型（0/1/2 = S1/S2/S3）
node tools/evaluate.mjs 艾雅法拉 magical 2

# 自创干员评测（JSON 需符合 engine/custom-operator.schema.json）
node tools/evaluate-custom.mjs examples/custom-demo.json

# 多干员分场景对比（每场景最佳标 ★）
node tools/compare.mjs 银灰 史尔特尔 艾雅法拉

# 单干员全技能对比
node tools/compare.mjs --all-skills 银灰

# 分场景画像明细
node tools/scenario-eval.mjs 银灰
```

在 dsh 会话中（已注册 `arknights-evaluator` skill，自动发现）：直接说"评一下 XX / 对比 XX 和 XX / 看看我设计的干员"，agent 会调用引擎并按分场景推理回答。

## 架构

```
┌─ Agent 层：arknights-evaluator skill（dsh 自动发现）
├─ 评测层：现有/自创/分场景/对比/全技能（tools/evaluate*.mjs, compare.mjs, scenario-eval.mjs）
├─ 语义层：blackboard 映射 + damageType 推断 + override 校准表（tools/overrides.mjs）
├─ 机制层：伤害公式/攻速/SP 覆盖率/永续/强化攻击（engine/dps-engine.mjs，15/15 测试）
└─ 数据层：416 干员数据集 + 2130 敌人场景 + 6 标准场景（data/）
```

## 数据源说明

- **数值真相源**：`Kengxxiao/ArknightsGameData`（zh_CN，本地 sparse clone 于 `E:\github\ArknightsGameData`）—— 游戏数据的直接提取，精度高于 wiki 整理。原计划"爬取 PRTS"被此方案替代（理由记录于 `PROJECT-DESIGN.md`：数值权威、免爬千页、字段完整）；PRTS（CC BY-NC-SA）可作为中文描述补充源（社区已有 [prts-mcp](https://github.com/3aKHP/prts-mcp) 可借鉴）。
- 满练 = E2 满级 + 技能专三（levels[9]），面板/技能/天赋/潜能/信赖全部来自游戏表。

## 目录

```
engine/      数值引擎（dps-engine.mjs + 测试 + 自创干员 schema）
tools/       数据管线 + 评测工具（build-dataset / evaluate / evaluate-custom / compare / scenario-eval / probe-skills / overrides）
data/        生成的规范化数据集（operators / scenarios / enemy-scenarios / meta）
examples/    自创干员样例（合法 + 非法）
docs/        机制文档 + 数据清单
~/.dsh/skills/arknights-evaluator/   agent skill（dsh 自动发现）
```

## 已知限制

- 天赋/模组/潜能未计入面板（裸满练面板）；生存/控制/射程维度未建模——结论基于输出画像，高难度评价需人工结合。
- "下次攻击强化"型技能有周期模型；特殊机制干员（棘刺等）走 `tools/overrides.mjs` 校准表。
- 仅供个人/学习研究使用：数值源自游戏数据提取（Kengxxiao/ArknightsGameData），勿商用。
