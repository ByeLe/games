# 大话骰 Cocos Creator 原型

## 打开方式
1. 使用 Cocos Creator 3.8.8 打开当前项目目录。
2. 等待编辑器导入 `assets`。
3. 打开 `assets/main.scene` 并点击预览。

`assets/main.scene` 的 `Canvas` 节点已经挂载 `assets/scripts/ui/GameRoot.ts` 组件，打开场景后可以直接预览。

## 当前已实现
- 竖屏 720 x 1280 动态 UI。
- 单机模式：本机一副骰盅，支持摇 5 个骰子、上拖看牌、下拖盖住，适合线下玩家各自用手机玩。
- 联网模式：通过云托管 Node.js WebSocket 服务完成头像昵称授权、分享参数、创房/加入/准备/摇骰/叫牌/开牌/结算/房主再来一局。
- `CloudRoomService` 名称为兼容现有 UI 保留，内部已改为 WebSocket 客户端；服务端是房间状态的唯一权威。
- 云函数保存公共房间状态和私有骰面，动作身份以云端 `OPENID` 为准，前端不传玩家身份。
- 开局后加入的玩家会进入等待列表，下局由房主重开时加入当局。
- 每人 5 个骰子；`1` 默认万能，本轮有人叫过 `1` 后不再万能。
- 叫牌规则：数量更大，或数量相同但点数更大。

## 云托管 WebSocket 配置
已写入：

- `AppID`: `wx79916d4daf5d3ccd`
- `envId`: `cloudbase-d3g1ll45q9cd4cc90`

实时服务目录在 `cloudrun/room-server`，不使用云数据库、不保存对局记录。房间状态只存在云托管进程内存中，服务重启、发布或 4 小时无操作后会自动结束房间。

1. 在环境 `cloudbase-d3g1ll45q9cd4cc90` 的云托管中新建 Node.js 服务，使用 [云托管部署说明](cloudrun/room-server/README.md)。
2. 将服务设置为 **最小实例 = 最大实例 = 1**；无数据库设计下不得扩容为多个实例。
3. 在云托管环境变量配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`。
4. 开通服务公网访问，把 `wss://<服务域名>/ws` 配置到小游戏后台的 Socket 合法域名。
5. 将同一地址写入 `assets/scripts/services/WechatCloudConfig.ts` 的 `ROOM_WEBSOCKET_URL`。

分享 query 会包含展示房号 `roomId` 和高熵 `joinToken`。客户端不能只凭短房号加入，必须由云函数校验 token。

## 验证
本地可运行：

```bash
npm run test:room
npm run generate:scene
```

真实联网流程需要在微信开发者工具里预览或真机调试：先部署云托管服务，再用两个微信客户端/模拟器分别测试创房、分享加入、准备、摇骰、叫牌、开牌、结算、断线重连和房主再来一局。
