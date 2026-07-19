# 大话骰 WebSocket 云托管服务

这是基于 Koa + WebSocket 的无数据库实时房间服务。房间只在单个 Node 进程内存中存在；发布、重启或超过 4 小时无操作后自动失效。

部署到当前 CloudBase 环境时：

1. 云托管新建服务，构建上下文选择仓库根目录，Dockerfile 选择 `cloudrun/room-server/Dockerfile`，端口为 `80`。
2. 环境变量填写 `WECHAT_APP_ID=wx79916d4daf5d3ccd` 与微信后台取得的 `WECHAT_APP_SECRET`。
3. **最小实例 = 最大实例 = 1**。无数据库设计下不得扩容为多个实例，否则不同玩家可能连接到不同内存房间。
4. 为服务开通公网访问，并把 `wss://<服务域名>/ws` 配置到小游戏后台的 Socket 合法域名。
5. 将同一地址写入 `assets/scripts/services/WechatCloudConfig.ts` 的 `ROOM_WEBSOCKET_URL`，重新构建小游戏。
