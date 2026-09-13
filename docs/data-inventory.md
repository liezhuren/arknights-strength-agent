# 数据资产清单与字段结构（data inventory）

> 生成时间：2026-09-02T03:08:28.626Z · 数据源：Kengxxiao/ArknightsGameData (zh_CN)

## 1. character_table.json（干员）

- 总条目：1368（含 TRAP/TOKEN 等非干员）
- 真干员（排除 TRAP/召唤物/异格标记）：416
- 星级分布：1★: 11，2★: 5，3★: 22，4★: 70，5★: 193，6★: 115

### 满练字段结构（E2 满级）

```
样例干员：阿（6★ · SPECIAL/geek · RANGED）
phases 数：3（精0/精1/精2）
E2 满级等级：90
满级面板 keyframe：{"maxHp":2034,"atk":703,"def":152,"magicResistance":10,"cost":13,"blockCnt":1,"moveSpeed":1,"attackSpeed":100,"baseAttackTime":1.3,"respawnTime":70,"hpRecoveryPerSec":0,"spRecoveryPerSec":1,"maxDeployCount":1,"maxDeckStackCnt":0,"tauntLevel":0,"massLevel":0,"baseForceLevel":0,"stunImmune":false,"silenceImmune":false,"sleepImmune":false,"frozenImmune":false,"levitateImmune":false,"disarmedCombatImmune":false,"fearedImmune":false,"palsyImmune":false,"attractImmune":false,"teleportImmune":false,"groundBoundImmune":false}
attributesKeyFrames 级数：2（0 级 + 满级等关键帧）
天赋数：2（每个含 candidates 分级数据）
技能数：3（skillId + 解锁条件 phase/level）
潜能等级：5（每级含属性加成）
信赖加成：favorKeyFrames（按信赖值关键帧）
特性 trait：{"candidates":[{"unlockCondition":{"phase":"PHASE_0","level":1},"requiredPotentialRank":0,"blackboard":[{"key":"hp_ratio
```

## 2. skill_table.json（技能数值）

- 技能总数：1803
- levels 数组：10 级（1-7 为技能等级，8/9/10 = 专一/专二/专三）

```
样例技能：skchr_haak_1（快速射击）
levels 数：10
专三 blackboard（数值表）：attack_speed=100
专三 duration：30
```

## 3. enemy_database.json（敌人）

- 敌人总数：2130
- 结构：enemies 为数组，每项 { Key: 敌人id, Value: [难度等级数组] }；字段用 {m_defined, m_value} 包装

```
样例敌人：简饲源石虫（?）
难度段数：1
属性：maxHp=4500，atk=200，def=50，magicResistance=0，moveSpeed=1，attackSpeed=100
```

## 4. uniequip_table.json（模组）

- 模组总数：898
- 结构：顶层 equipDict，key 为模组 id（uniequip_001_xxx 等）

```
样例模组：?（original）
顶层 keys：uniEquipId, uniEquipName, uniEquipIcon, uniEquipDesc, typeIcon, typeName1, typeName2, equipShiningColor, showEvolvePhase, unlockEvolvePhase, charId, tmplId, showLevel, unlockLevel, missionList, unlockFavors, itemCost, type, uniEquipGetTime, uniEquipShowEnd, charEquipOrder, hasUnlockMission, isSpecialEquip, specialEquipDesc, specialEquipColor, charColor
levels 数（等级加成）：?
```

## 5. range_table.json / gamedata_const.json

- 攻击范围形状数：73
- 全局常量 keys（部分）：maxPlayerLevel, playerExpMap, playerApMap, maxLevel, characterExpMap, characterUpgradeCostMap, evolveGoldCost, completeGainBonus, playerApRegenSpeed, maxPracticeTicket, advancedGachaCrystalCost, completeCrystalBonus, initPlayerGold, initPlayerDiamondShard, initCampaignTotalFee, initRecruitTagList, initCharIdList, attackMax, defMax, hpMax
