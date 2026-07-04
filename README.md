# 大话骰 Cocos Creator 原型

## 打开方式
1. 使用 Cocos Creator 3.8.8 打开当前项目目录。
2. 等待编辑器导入 `assets`。
3. 打开 `assets/main.scene` 并点击预览。

`assets/main.scene` 的 `Canvas` 节点已经挂载 `assets/scripts/ui/GameRoot.ts` 组件，打开场景后可以直接预览。

## 当前已实现
- 竖屏 720 x 1280 动态 UI。
- 本地 4 人模拟房，逻辑支持 2-6 人。
- 创建房间、分享提示、准备、摇骰、叫牌、开牌、结算、再来一局。
- 非本机玩家自动准备、摇骰、叫牌或开牌。
- 每人 5 个骰子。
- `1` 默认万能；本轮有人叫过 `1` 后，`1` 不再万能。
- 叫牌规则：数量更大，或数量相同但点数更大。
- `RoomService` 接口、`LocalRoomService` 本地实现、`CloudRoomService` 微信云开发预留空壳。
- 生成素材占位：`assets/textures/generated/dice_cup_atlas.png`。

## 后续接微信云开发
后续只需要新增真实的 `CloudRoomService` 实现，并在 `GameRoot.ts` 中把 `LocalRoomService` 替换成云服务实现。云端需要补：房间集合、玩家状态、回合状态、骰子保密、并发校验、断线重连和房间清理。
