# 召唤物机制 · 侦察结果与设计方案（待实现）

> 状态：**侦察完成，引擎通道未建**。本文件是接续实现的起点。
> 背景：数据集构建时按 `REAL_PROFESSIONS` 过滤掉了 `TOKEN`/`TRAP` 职业（跳过 914 条），
> 所以**召唤物的输出目前完全没算** —— 这不是"算得不准"，而是"没有"。也是当前最大的功能缺口。

---

## 1. 数据在哪（已核实）

| 数据 | 位置 | 说明 |
|---|---|---|
| **召唤物本体** | `character_table` 中 `profession === 'TOKEN'`（**74 条**） | 含完整面板：`atk` / `baseAttackTime` / `blockCnt` / `maxHp` / `cost`，以及**自己的技能**（`skills`，1–3 个） |
| 干员 ↔ 召唤物关联 | **待定**（见 §3） | 未打通，这是实现前唯一的前置未知项 |
| ~~`token_table.json`~~ | ❌ **不是召唤物名录** | 该表只有 **4 条**，全是 `trap_*` 地图装置（封印的地面/木桩/传感器…），实现时**不要**用它 |

召唤物 ID 命名规律：`token_10002_kalts_mon3tr`（`token_<序号>_<干员代号>_<召唤物代号>`），
所以**大多数召唤物能从 id 反推所属干员**；令/麦哲伦这类多召唤物的用序号后缀区分（`ling_soul1/2/3`）。

## 2. 召唤物分类（关键：要区分"能打的"和"装置"）

74 条里混着大量**非战斗装置**，特征很好识别 —— 面板是占位值 **`atk=100 / 间隔=1 / 生命=100`**：

| 类型 | 判定 | 例子 |
|---|---|---|
| **战斗召唤物**（要算 DPS） | atk 显著 > 100，或有阻挡 | Mon3tr `atk1402/2s/阻挡3`，令·弦惊 `823/1.5s/阻挡2`，麦哲伦·龙腾.A `753/2.3s` |
| **装置/工具**（不算 DPS） | `atk=100 间隔=1`（占位行） | 雷鸣地雷、夹子、迎宾踏垫、投递坐标、旧日残影… |
| **纯阻挡/护盾** | atk=0 但有阻挡/生命 | 夜莺幻影 `atk0/生命6000`、耀阳 `阻挡2`、机动盾牌 `生命3802` |

**主要战斗召唤物（首批实现目标）**：

| 干员 | 召唤物 ID | atk | 间隔 | 阻挡 |
|---|---|---|---|---|
| 凯尔希 | `token_10002_kalts_mon3tr`（Mon3tr） | 1402 | 2.0 | 3 |
| 令 | `ling_soul1` 清平 / `soul2` 逍遥 / `soul3` 弦惊 | 549 / 406 / 823 | 1.25 / 1.6 / 1.5 | 1 / 1 / 2 |
| 麦哲伦 | `mgllan_drone1` 龙腾.F / `drone2` .L / `drone3` .A | 0 / 509 / 753 | — / 1.0 / 2.3 | 0 |
| 傀影 | `phatom_twin` 镜中虚影 | 548 | 0.93 | 1 |
| 温蒂 | `weedy_cannon` 工程蓄水炮 | 585 | 2.4 | 0 |
| 早露 | `bgsnow_subbow` “打字机” | 866 | 1.6 | 0 |
| 深海色 | `deepcl_tentac` 触手 | 462 | 1.25 | 1 |
| 梅尔 | `otter_motter` 机械水獭 | 444 | 1.25 | 1 |
| 苇草（根号） | `vigil_wolf` 狼群 | 371 | 1.25 | 0 |
| 夕 | `dusk_drgn` “小自在” | 398 | 1.9 | 2 |
| 罗宾/霜华 | `robin_mine` / `rfrost_mine` | 100 | 1 | 0 |（陷阱型，已归 trap 通道）|
| 森蚺/黑键等 | `radian_tower1/2/3` 戴乌/赛柯/桑特拉 | 471 / 773 / 741 | 1.2 / 1.8 / 1.3 | 3 / 2 / 1 |

## 3. 干员 ↔ 召唤物关联 —— ✅ **已解决（确定性，无需 LLM 兜底）**

**解法**：干员 id 是 `char_<序号>_<代号>`，召唤物 id 是 `token_<序号>_<代号>_<名称>`
→ **代号段相同即同一干员**：`char_003_kalts` ↔ `token_10002_kalts_mon3tr`。

实测（`node tools/build-summons.mjs`）：**73/74 一次命中**，交叉印证（扫干员 blackboard 里的 token id 字符串）
命中 **0** 次也不需要；唯一未关联的是 `trap_079_allydonq`（`trap_` 前缀的地图装置）。

→ **结论：LLM 层不需要介入关联**。`tools/overrides.mjs` 的二层兜底仍保留给未来边缘案例（异格/跨干员/编号不一致）。

### 已产出的数据：`data/summons.json`（74 条）
```json
{ "id": "token_10002_kalts_mon3tr", "name": "Mon3tr", "owner": "凯尔希", "link": "code",
  "combat": true, "device": false, "atk": 1402, "interval": 2, "blockCnt": 3, "maxHp": 5433,
  "cost": 20, "skillIds": ["skcom_..."] }
```
- `combat: true` 共 **50 条**（占位面板判据筛掉 24 条装置）
- 战斗型前列：Mon3tr 1402 · 鸿雪"打字机" 866 · 令"弦惊" 823 · 维什戴尔魂灵之影 777 ·
  乌尔比安"从不混淆的方向" 777 · 电弧赛柯 773 · 风丸纸偶 772 · 麦哲伦龙腾.A 753 ·
  温蒂工程蓄水炮 585 · 傀影镜中虚影 548 · 令"清平" 549 · 梅尔机械水獭 444 …

---

## 3b.（历史记录）关联方式的原始排查线索

已知线索（`tools/probe-summon2.mjs` 正在探）：
- 天赋/技能 blackboard 里出现过 `token_key`、`talent@token_key`、`max_token_cnt`、`additional_token_cnt`、
  `token_cost_modify`、`token_recharge_cnt`、`max_target_token`、`attack@tokenduration` 等键
- 注意 `token_key` 出现过**数值 `0`**（不是 id 字符串）→ 说明该键在不同干员语义不同，**不能只看键名**
- 更可靠的路径候选：
  1. `character_table[op].tokenKey`（若存在）
  2. 技能/天赋 blackboard 里值为 `token_*` 字符串的条目
  3. `handbook_info_table` 或 `char_patch_table` 里的召唤物说明
  4. **按 id 前缀反推**（`token_*_<干员代号>_*`）—— 可作为兜底与交叉校验

**下一步（第一件事）**：写 `tools/build-summons.mjs`，把"干员 → 战斗召唤物[]（含面板与技能）"落成
`data/summons.json`；用 id 前缀反推做兜底，并用已知案例（令/凯尔希/麦哲伦/傀影）验证关联正确。

## 4. 引擎通道设计（照 `trap` / `burst` 的既有模式）

新增 `summon` 字段（与 trap/burst 并列，不混算）：

```js
summon: {
  count,          // 可同时存在的召唤物数（上限：max_token_cnt；缺省按 1）
  units: [ { name, atk, interval, hits?, blockCnt, mult? } ],
  uptimeAssumption, // 部署/存活假设（召唤物需时间铺场或被击倒）
}
```

**口径**：
- 召唤物 DPS = Σ(单位 atk × 段数 / 间隔) × 同时存在数
- **与本体分开报**：召唤物的攻击是另一条输出线，不能并入本体 `skillDps`
- 召唤物**自己还有技能**（1–3 个）→ 第一版先只算普攻，技能标注为待建模
- 必须标注的假设：同时存在数（受部署位与 `max_token_cnt` 限制）、铺场时间、是否会被击倒

**报告形态**（新增一行，类似 trap）：
```
召唤物：Mon3tr ×1 · atk1402/2.0s → 单独 DPS 701（自身技能未计；同时存在数按 1 假设）
        合计（本体+召唤物）…
```

## 5. 验证清单（实现时照做）

1. `engine/test.mjs` 加断言：召唤物 DPS 公式、多单位求和、上限截断
2. 手工可验证数：Mon3tr `1402/2.0 = 701`；令·弦惊 `823/1.5 = 548.7`
3. `node tools/smoke.mjs` 意外异常保持 0（新增字段不能让 454 名干员报错）
4. 锚点不动：既有 63 断言与银灰 5524.6 / 望 179056 必须不变（纯新增通道）
5. `node tools/anchors.mjs` 增补召唤物锚点行
6. 文档：`docs/dps-calculation.md` 加 §17；`docs/HANDOFF.md` §8 第 12 项改 ✅

## 6. 相关脚本（本地侦察用，已被 .gitignore 排除）

- `tools/probe-summon.mjs` —— TOKEN 名录与 token 键扫描
- `tools/probe-summon2.mjs` —— 召唤物面板明细 + 召唤师关联线索（**第二部分有报错待修**：技能表按 id 取值处）
