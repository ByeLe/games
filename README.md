# 大话骰 Cocos Creator 原型

## 打开方式
1. 使用 Cocos Creator 3.8.8 打开当前项目目录。
2. 等待编辑器导入 `assets`。
3. 打开 `assets/main.scene` 并点击预览。

`assets/main.scene` 的 `Canvas` 节点已经挂载 `assets/scripts/ui/GameRoot.ts` 组件，打开场景后可以直接预览。

## 当前已实现
- 竖屏 720 x 1280 动态 UI。
- 单机模式：本机一副骰盅，支持摇 5 个骰子、上拖看牌、下拖盖住，适合线下玩家各自用手机玩。
- 联网模式：接入微信云开发配置、头像昵称授权、分享参数、创房/加入/准备/摇骰/叫牌/开牌/结算/房主再来一局。
- `CloudRoomService` 前端服务会调用 `room` 云函数，并监听 `rooms` 单房间公共投影。
- 云函数保存公共房间状态和私有骰面，动作身份以云端 `OPENID` 为准，前端不传玩家身份。
- 开局后加入的玩家会进入等待列表，下局由房主重开时加入当局。
- 每人 5 个骰子；`1` 默认万能，本轮有人叫过 `1` 后不再万能。
- 叫牌规则：数量更大，或数量相同但点数更大。

## 微信云开发配置
已写入：

- `AppID`: `wx79916d4daf5d3ccd`
- `envId`: `cloudbase-d3g1ll45q9cd4cc90`

云函数目录在 `cloudfunctions/room`。在微信开发者工具中需要：

1. 打开微信小游戏构建目录或项目。
2. 确认云开发环境为 `cloudbase-d3g1ll45q9cd4cc90`。
3. 创建集合 `rooms` 和 `room_private_dice`。
4. 上传并部署 `cloudfunctions/room` 云函数，函数名为 `room`。
5. 权限建议：`rooms` 只允许客户端读取单个被授权房间公共投影，禁止集合列表读取；`room_private_dice` 只允许云函数读写。

分享 query 会包含展示房号 `roomId` 和高熵 `joinToken`。客户端不能只凭短房号加入，必须由云函数校验 token。

## 验证
本地可运行：

```bash
npm run test:room
npm run generate:scene
```

真实联网流程需要在微信开发者工具里预览或真机调试：先部署云函数，再用两个微信客户端/模拟器分别测试创房、分享加入、准备、摇骰、叫牌、开牌、结算和房主再来一局。
