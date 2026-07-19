const http = require('http');
const crypto = require('crypto');
const Koa = require('koa');
const { WebSocketServer } = require('ws');
const { createRoom, joinRoom, ready, roll, bid, open, restart, toProjection } = require(process.env.ROOM_CORE_PATH || '../../cloudfunctions/room/roomCore');

const PORT = Number(process.env.PORT || 80);
const APP_ID = process.env.WECHAT_APP_ID;
const APP_SECRET = process.env.WECHAT_APP_SECRET;
const ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const rooms = new Map(); // 明确的无持久化设计：实例重启后房间自动失效。

let count = 0;
const app = new Koa();
app.use(async (ctx) => {
  if (ctx.path === '/health') {
    ctx.body = { ok: true, service: 'dahuatou-room' };
    return;
  }
  // 保留现有 Koa 示例接口，部署后 wx.cloud.callContainer 的示例仍可使用。
  if (ctx.path === '/api/count' && ctx.method === 'POST') {
    let body = '';
    for await (const chunk of ctx.req) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    if (payload.action === 'inc') count += 1;
    ctx.body = { count };
    return;
  }
  ctx.status = 404;
  ctx.body = { error: 'Not Found' };
});
const server = http.createServer(app.callback());
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  socket.playerId = '';
  socket.roomId = '';
  socket.on('message', async (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch (_) { return reply(socket, '', false, null, '消息格式错误。'); }
    try {
      const data = await dispatch(socket, message);
      reply(socket, message.requestId, true, data);
    } catch (error) {
      reply(socket, message.requestId, false, null, error.message || '操作失败。');
    }
  });
  socket.on('close', () => { socket.roomId = ''; });
});

async function dispatch(socket, message) {
  if (message.type === 'auth') {
    socket.playerId = await exchangeCode(message.code);
    return { playerId: socket.playerId };
  }
  if (!socket.playerId) throw new Error('请先登录。');
  if (message.type === 'createRoom') {
    const roomId = uniqueRoomId(); const joinToken = token();
    const room = createRoom({ openid: socket.playerId, profile: profile(message.profile), roomId, joinTokenHash: hash(joinToken), now: Date.now() });
    rooms.set(roomId, { room, joinToken, dice: new Map(), touchedAt: Date.now() });
    socket.roomId = roomId;
    return projection(rooms.get(roomId), socket.playerId);
  }
  if (message.type === 'joinRoom' || message.type === 'resume') {
    const entry = findRoom(message.roomId, message.joinToken);
    if (message.type === 'joinRoom') {
      entry.room = joinRoom(entry.room, { openid: socket.playerId, profile: profile(message.profile), now: Date.now() });
    } else if (!entry.room.players.some((p) => p.id === socket.playerId) && !entry.room.waitingPlayers.some((p) => p.id === socket.playerId)) {
      throw new Error('该房间已失效或你不在房间中。');
    }
    entry.touchedAt = Date.now(); socket.roomId = message.roomId;
    broadcast(entry); return projection(entry, socket.playerId);
  }
  if (message.type === 'action') {
    const entry = findRoom(message.roomId, message.joinToken || tokenForSocket(socket, message.roomId));
    const ctx = { openid: socket.playerId, now: Date.now(), actionId: String(message.actionId || crypto.randomUUID()) };
    if (message.action === 'ready') entry.room = ready(entry.room, ctx);
    else if (message.action === 'roll') { const result = roll(entry.room, ctx); entry.room = result.room; entry.dice.set(socket.playerId, result.dice); }
    else if (message.action === 'bid') entry.room = bid(entry.room, { ...ctx, quantity: message.quantity, face: message.face });
    else if (message.action === 'open') entry.room = open(entry.room, ctx, Object.fromEntries(entry.dice));
    else if (message.action === 'restart') { entry.room = restart(entry.room, ctx); entry.dice.clear(); }
    else throw new Error('未知操作。');
    entry.touchedAt = Date.now(); broadcast(entry); return projection(entry, socket.playerId);
  }
  throw new Error('未知请求。');
}

function tokenForSocket(socket, roomId) { const entry = rooms.get(roomId); if (!entry || socket.roomId !== roomId) throw new Error('房间连接无效。'); return entry.joinToken; }
function projection(entry, playerId) { return toProjection(entry.room, { openid: playerId, roomDocId: entry.room.roomId, joinToken: entry.joinToken, privateDice: entry.dice.get(playerId) || [] }); }
function broadcast(entry) { for (const client of wss.clients) if (client.readyState === 1 && client.roomId === entry.room.roomId) send(client, { type: 'roomState', room: projection(entry, client.playerId) }); }
function findRoom(roomId, joinToken) { const entry = rooms.get(roomId); if (!entry || entry.joinToken !== joinToken) throw new Error('房间不存在或分享已失效。'); return entry; }
function profile(value) { return { name: String(value?.name || '玩家').slice(0, 20), avatarUrl: String(value?.avatarUrl || '') }; }
function uniqueRoomId() { let id; do { id = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(id)); return id; }
function token() { return crypto.randomBytes(24).toString('base64url'); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function reply(socket, requestId, ok, data = null, error = '') { send(socket, { type: 'response', requestId, ok, data, error }); }
function send(socket, data) { if (socket.readyState === 1) socket.send(JSON.stringify(data)); }

async function exchangeCode(code) {
  if (!code) throw new Error('缺少微信登录凭证。');
  if (!APP_ID || !APP_SECRET) throw new Error('服务端未配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET。');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({ appid: APP_ID, secret: APP_SECRET, js_code: code, grant_type: 'authorization_code' });
  const response = await fetch(url); const result = await response.json();
  if (!result.openid) throw new Error(`微信登录失败：${result.errmsg || result.errcode || '未知错误'}`);
  return result.openid;
}

setInterval(() => { const cutoff = Date.now() - ROOM_TTL_MS; for (const [id, entry] of rooms) if (entry.touchedAt < cutoff) rooms.delete(id); }, 10 * 60 * 1000).unref();
server.listen(PORT, () => console.log(`room websocket server listening on ${PORT}`));
