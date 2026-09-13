# 数据来源与声明 / Data Sources & Notice

## 1. 数据来源

本项目的**干员、技能、天赋、模组、敌人**数值全部抓取自开源游戏数据仓库：

- **[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)**（`zh_CN` 分支）
  - `excel/character_table.json` —— 干员面板、分支特性（**特性文本在干员级 `description`**）、天赋、潜能
  - `excel/skill_table.json` —— 技能各等级与 blackboard
  - `excel/battle_equip_table.json` —— **模组数值**（属性加成 / 天赋更新 / 特性更新）
  - `excel/uniequip_table.json` —— 模组元数据、分支（子职业）中文名
  - `levels/enemydata/enemy_database.json` —— 敌人属性（用于"来袭画像"统计）

机制文本与模组数值另与 **[PRTS Wiki](https://prts.wiki)** 做了**独立交叉校验**：
105 个模组属性逐条比对**全部一致**（见 `docs/module-prts-crosscheck.md`），
元素损伤爆发数值（损伤条 1000/领袖 2000）亦取自 PRTS 客户端 2.7.61。

## 2. 本项目自有的部分

以下内容为**独立实现**，不来自上述数据源：

- `engine/` 数值引擎（伤害公式、攻速、SP 覆盖率、元素损伤、陷阱、爆发、穿透、生存）
- `tools/` 评测管线（描述解析双层架构、模组层、泛用性/操作难度/回转/生存四维标准）
- `docs/` 评测标准与计算链路文档
- 标准场景、来袭画像、场景基准线的**设定与统计口径**

## 3. 声明

- 《明日方舟》（Arknights）及相关素材、名称、数据的**版权归上海鹰角网络科技有限公司所有**。
- 本项目为**非商业性研究 / 学习工具**，与鹰角网络无任何关联，未获其授权或认可。
- 所有数值为**离线推算**，不保证与游戏内实际表现一致；结论仅供研究参考。
- **请勿用于商业用途**；转载或引用本项目代码/文档时请保留本声明及上述数据来源署名。
- 若数据来源方或权利方认为本项目存在不当使用，请联系删除。

## 4. 复现方式

```bash
# 1) 克隆游戏数据仓库（本项目不包含原始数据）
git clone --depth 1 --filter=blob:none --sparse https://github.com/Kengxxiao/ArknightsGameData
# 并设为 tools/ 脚本中的 ROOT 路径（默认 E:/github/ArknightsGameData）

# 2) 重建数据集与数据库
node tools/build-dataset.mjs        # → data/operators.json
node tools/build-modules.mjs        # → data/modules.json
node tools/build-threat-scenarios.mjs   # → data/threat-scenarios.json
node tools/build-scenario-baseline.mjs  # → data/scenario-baseline.json
node app/db/build-db.mjs            # → app/db/arknights.db（需先停掉 app/server）
```
