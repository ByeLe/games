# Plan Review Log: 接入微信云开发联网房间流程
Act 1 (grill) complete - plan locked with the user. MAX_ROUNDS=5.

## Round 1 - Codex
发现的实质问题：

- `GameRoot` 现在在启动时就固定 `new LocalRoomService()` 并先订阅，分享进入也仍调用本地服务（`GameRoot.ts:30`、`GameRoot.ts:56`、`GameRoot.ts:101`）；计划没有说明服务切换和取消订阅时机，联网入口会继续跑本地房。修复：先根据启动参数/入口选择服务工厂，再订阅对应服务，并在模式切换时清理旧订阅和状态。
- `RoomService` 接口仍把 `playerId` 作为前端动作参数，`createRoom/joinRoom` 只传名字（`GameTypes.ts:57`）；云函数若沿用这个契约，客户端可伪造他人 `playerId` 执行准备、叫牌、开牌。修复：云端动作只信任 `OPENID`，接口改为 create/join 传 profile，ready/roll/bid/open/restart 不接受可伪造 playerId，必要时只传 `expectedVersion`。
- “监听房间文档变化并转换成 `RoomState`”和“云端保存所有骰子”组合有泄密风险；当前 `PlayerState.dice` 是公共状态字段（`GameTypes.ts:14`），一旦客户端可监听原始 `rooms` 文档就能看到所有骰面。修复：公共房间文档不存未公开骰面，骰面放私有子集合/按 openid 分文档，或监听只读公共投影，自己的骰面通过云函数单独返回。
- 并发策略停留在“事务或原子更新降低踩踏”，不够实现；双击、网络重试、两端同时叫牌/开牌会产生重复动作、错 turn 或覆盖结算。修复：所有云函数动作必须在事务内校验 `phase/currentTurnPlayerId/lastBid/version/membership`，更新时递增版本，并用 `actionId` 做幂等去重。
- 加入和重开规则遗漏身份重入边界：同一 `OPENID` 重复 join、已在 active 又进 waiting、等待列表超过座位、结算中重连、房主离开/刷新后 `isLocal` 映射都未定义。修复：按 openid 做唯一玩家身份，join 分支明确 active/waiting/reconnect 三种路径，restart 合并 waiting 时重新分配 seat 并限制总 active <= 6。
- 单机模式改成 `LocalDiceService` 但计划仍说“保留当前 `RoomService` 抽象”；当前 UI 大量依赖 `RoomState.players/phase/currentTurnPlayerId/settlement` 来渲染按钮和座位（`GameRoot.ts:249`），单骰盅工具不适配这个状态机。修复：把单机工具做成独立状态和渲染分支，不要强塞进 `RoomService`，并删除/隐藏准备、分享、叫牌等控件。
- 新增授权、等待下局、观战/在线状态等 UI 没有纳入场景生成脚本；本项目所有运行时节点都必须预生成，缺节点会直接 throw，生成脚本目前只有旧按钮和固定结算玩家节点（`generate-scene.mjs:389`、`generate-scene.mjs:430`）。修复：计划中明确同步更新 `tools/generate-scene.mjs` 并执行 `npm run generate:scene`，覆盖所有新增节点和动态玩家 id 策略。
- 验证方案不可执行：`package.json` 只有 `generate:scene`，没有测试或 TS 检查脚本，`tsconfig` 还依赖 Cocos 的 `temp/tsconfig.cocos.json`。修复：先补可运行的云函数纯逻辑测试脚本和本地类型检查/构建说明，把命令写进 README 和验收清单。

VERDICT: REVISE

### Claude's response
已采纳全部 8 点。计划改为：入口先选择服务工厂再订阅；联网动作接口不接受客户端 `playerId`，由云函数从 `OPENID` 判定；公共房间投影与私有骰面拆分；所有动作使用事务、版本号和 `actionId` 幂等；join/restart 明确 active/waiting/reconnect；单机工具走独立状态和渲染分支；场景生成脚本必须同步新增节点；验证补云函数纯逻辑测试和可执行检查说明。未拒绝任何意见。

## Round 2 - Codex
上一轮指出的主要问题基本已补上：服务工厂/订阅时机、接口不信任前端 `playerId`、骰面私有化、事务+版本+`actionId`、join/reconnect/waiting、单机独立分支、场景生成和验证脚本都进入了计划。

仍有几个新缺口：

- 房间发现与读取权限仍不够安全：计划只说分享 `roomId` query 和客户端监听 `rooms` 公共投影，如果 `roomId` 是短码且数据库允许客户端按集合查询/监听，昵称头像、房间状态可能被枚举或旁观读取。修复：区分展示用短房号和高熵 `joinToken`，客户端只能用 token 订阅单房间公共投影，云函数校验 token 后返回可监听 doc id，禁止集合级列表读取。
- `restart` 权限和流程没定义：动作接口允许 `restart(expectedVersion, actionId)`，但计划没说谁能重开、是否需要全员确认、waiting 玩家是否可触发；结算页可能被任意 active 玩家抢先重置，其他人看不到结算。修复：云端限定 `phase === settlement`，只允许房主或所有 active 玩家确认后 restart，并明确 waiting 玩家不能触发。
- `actionId` 记录放在 `rooms` 文档摘要里但没有裁剪策略；长房间多局后文档可能膨胀，事务读写成本上升。修复：只保留最近 N 个 actionId 或按 `expireAt` 放独立幂等集合并定期清理。
- 在线/观战状态进入模型，但心跳、断线托管、完整观战又在 out of scope；这会让实现者做出不可验证的“在线”字段，UI 可能误导。修复：第一版把状态限定为 `active/waiting/local/self`，移除“在线”语义，或补最小心跳/lastSeen 规则和 UI 降级说明。

VERDICT: REVISE

### Claude's response
已采纳全部 4 点。计划新增短房号 + 高熵 `joinToken`，并禁止客户端集合级列表读取；明确第一版仅房主可在结算阶段重开，waiting 玩家不能触发；为 `actionId` 增加最近 N 条或带过期时间独立集合的裁剪策略；移除完整在线/观战承诺，仅保留 `self/active/waiting` 语义。未拒绝任何意见。

## Round 3 - Codex
复审结果：上轮遗留的 4 个问题都已被计划正面处理。

- 房间枚举/旁观读取：已加入短房号 + 高熵 `joinToken`、先经云函数校验、禁止集合级列表读取，足够作为第一版安全边界。
- `restart` 权限：已限定 `phase === settlement`、房主触发、waiting 不能触发，行为明确。
- `actionId` 膨胀：已加入最近 N 条或独立 `expireAt` 集合的裁剪策略。
- 在线/观战语义：已收窄为 `self/active/waiting`，并明确 UI 不展示误导性的实时在线状态。

没有发现新的实质性阻塞。剩余风险主要是微信授权 API、云开发监听权限、云函数部署流程这些外部平台约束；计划已经把它们列为风险并给了降级方向，足够进入实现。

VERDICT: APPROVED
