const cloud = require('wx-server-sdk');
const https = require('https');
const {
  bid,
  createRoom,
  joinRoom,
  open,
  ready,
  restart,
  roll,
  toProjection,
} = require('./roomCore');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const rooms = db.collection('rooms');
const privateDice = db.collection('room_private_dice');

exports.main = async (event) => {
  await ensureCollections();
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();
  const action = event.action;

  if (action === 'createRoom') {
    return createRoomAction(event, OPENID, now);
  }
  if (action === 'joinRoom') {
    return joinRoomAction(event, OPENID, now);
  }
  return mutateRoomAction(event, OPENID, now);
};

async function ensureCollections() {
  await Promise.all([
    ensureCollection('rooms'),
    ensureCollection('room_private_dice'),
  ]);
}

async function ensureCollection(name) {
  if (!db.createCollection) {
    return;
  }
  try {
    await db.createCollection(name);
  } catch (error) {
    if (isCollectionExistsError(error)) {
      return;
    }
    throw error;
  }
}

function isCollectionExistsError(error) {
  const message = String(error?.errMsg || error?.message || error || '');
  return message.includes('already exists') ||
    message.includes('ResourceExist') ||
    message.includes('Table exist') ||
    message.includes('collection exists') ||
    message.includes('DATABASE_COLLECTION_ALREADY_EXIST') ||
    message.includes('DATABASE_COLLECTION_ALREADY_EXISTS') ||
    message.includes('-502003');
}

async function createRoomAction(event, openid, now) {
  const profile = await normalizeProfile(event.profile, openid);
  const joinToken = randomToken();
  const roomId = await createUniqueRoomId();
  const room = createRoom({
    openid,
    profile,
    roomId,
    joinTokenHash: hashToken(joinToken),
    now,
  });
  const addResult = await rooms.add({ data: room });
  const roomDocId = addResult._id;
  return {
    roomDocId,
    room: toProjection(room, { openid, roomDocId, joinToken }),
  };
}

async function joinRoomAction(event, openid, now) {
  const profile = await normalizeProfile(event.profile, openid);
  const { roomDocId, room } = await findRoomByToken(event.roomId, event.joinToken);
  const oldVersion = room.version;
  const nextRoom = joinRoom(room, { openid, profile, now });
  await updateRoomIfVersion(roomDocId, oldVersion, nextRoom);
  const dice = await getPrivateDice(roomDocId, openid);
  return {
    roomDocId,
    room: toProjection(nextRoom, { openid, roomDocId, joinToken: event.joinToken, privateDice: dice }),
    privateDice: dice,
  };
}


async function mutateRoomAction(event, openid, now) {
  if (!event.roomDocId) {
    throw new Error('缺少房间 ID。');
  }
  const { data } = await rooms.doc(event.roomDocId).get();
  if (!data) {
    throw new Error('房间不存在。');
  }
  const room = stripCloudId(data);
  await assertTokenForRoom(room, event.joinToken);

  let nextRoom = room;
  const oldVersion = room.version;
  let dice = await getPrivateDice(event.roomDocId, openid);
  if (event.action === 'ready') {
    nextRoom = ready(room, actionContext(event, openid, now));
  } else if (event.action === 'roll') {
    const result = roll(room, actionContext(event, openid, now));
    nextRoom = result.room;
    dice = result.dice;
  } else if (event.action === 'bid') {
    nextRoom = bid(room, { ...actionContext(event, openid, now), quantity: event.quantity, face: event.face });
  } else if (event.action === 'open') {
    const diceByPlayer = await getAllPrivateDice(event.roomDocId, room.players.map((player) => player.id));
    nextRoom = open(room, actionContext(event, openid, now), diceByPlayer);
  } else if (event.action === 'restart') {
    nextRoom = restart(room, actionContext(event, openid, now));
  } else {
    throw new Error(`未知操作：${event.action}`);
  }

  await updateRoomIfVersion(event.roomDocId, oldVersion, nextRoom);
  if (event.action === 'roll') {
    await setPrivateDice(event.roomDocId, openid, dice, nextRoom.version);
  }
  if (event.action === 'restart') {
    await clearPrivateDice(event.roomDocId);
    dice = [];
  }
  return {
    roomDocId: event.roomDocId,
    room: toProjection(nextRoom, { openid, roomDocId: event.roomDocId, joinToken: event.joinToken, privateDice: dice }),
    privateDice: dice,
  };
}

async function updateRoomIfVersion(roomDocId, oldVersion, nextRoom) {
  const result = await rooms.where({ _id: roomDocId, version: oldVersion }).update({ data: stripCloudId(nextRoom) });
  if (!result.stats?.updated) {
    throw new Error('房间状态已更新，请稍后重试。');
  }
}

function actionContext(event, openid, now) {
  return {
    openid,
    now,
    expectedVersion: event.expectedVersion,
    actionId: String(event.actionId || ''),
  };
}

async function findRoomByToken(roomId, joinToken) {
  if (!roomId || !joinToken) {
    throw new Error('分享参数不完整。');
  }
  const result = await rooms.where({ roomId, joinTokenHash: hashToken(joinToken) }).limit(1).get();
  const room = result.data[0];
  if (!room) {
    throw new Error('房间不存在或分享已失效。');
  }
  return { roomDocId: room._id, room: stripCloudId(room) };
}

async function assertTokenForRoom(room, joinToken) {
  if (!joinToken || room.joinTokenHash !== hashToken(joinToken)) {
    throw new Error('房间分享校验失败。');
  }
}


async function getPrivateDice(roomDocId, openid) {
  try {
    const { data } = await privateDice.doc(privateDiceId(roomDocId, openid)).get();
    return data?.dice || [];
  } catch (_error) {
    return [];
  }
}

async function setPrivateDice(roomDocId, openid, dice, roundVersion) {
  await privateDice.doc(privateDiceId(roomDocId, openid)).set({
    data: { roomDocId, openid, dice, roundVersion, updatedAt: Date.now() },
  });
}

async function getAllPrivateDice(roomDocId, openids) {
  const entries = await Promise.all(openids.map(async (openid) => [openid, await getPrivateDice(roomDocId, openid)]));
  return Object.fromEntries(entries);
}

async function clearPrivateDice(roomDocId) {
  const result = await privateDice.where({ roomDocId }).get();
  await Promise.all(result.data.map((doc) => privateDice.doc(doc._id).remove()));
}

function privateDiceId(roomDocId, openid) {
  return `${roomDocId}_${openid}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

function randomRoomId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createUniqueRoomId() {
  for (let i = 0; i < 8; i += 1) {
    const roomId = randomRoomId();
    const result = await rooms.where({ roomId }).limit(1).get();
    if (!result.data.length) {
      return roomId;
    }
  }
  throw new Error('房号生成失败，请重试。');
}

function randomToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function hashToken(token) {
  let hash = 2166136261;
  const text = String(token || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function assertProfile(profile) {
  if (!profile?.name) {
    throw new Error('需要授权头像昵称后才能联网游戏。');
  }
}

async function normalizeProfile(profile, openid) {
  assertProfile(profile);
  const name = String(profile.name).trim().slice(0, 20);
  const avatarUrl = String(profile.avatarUrl || '');
  if (!avatarUrl) {
    return { name, avatarUrl: '' };
  }
  if (isCloudAvatarUrl(avatarUrl)) {
    return { name, avatarUrl };
  }
  try {
    return { name, avatarUrl: await cacheAvatar(avatarUrl, openid) };
  } catch (error) {
    console.error('[room] cache avatar failed', { openid, avatarUrl, error });
    return { name, avatarUrl: '' };
  }
}

function isCloudAvatarUrl(url) {
  return url.includes('.tcb.qcloud.la') || url.startsWith('cloud://');
}

async function cacheAvatar(url, openid) {
  const fileContent = await downloadFileBuffer(url);
  const cloudPath = `avatars/${safeFilePart(openid)}-${hashToken(url)}.jpg`;
  const uploadResult = await cloud.uploadFile({ cloudPath, fileContent });
  if (!uploadResult.fileID) {
    throw new Error('头像云文件上传失败。');
  }
  return uploadResult.fileID;
}

function downloadFileBuffer(url, redirectCount = 0) {
  if (redirectCount > 3) {
    return Promise.reject(new Error('头像下载重定向过多。'));
  }
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        resolve(downloadFileBuffer(new URL(location, url).toString(), redirectCount + 1));
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`头像下载失败：${statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function safeFilePart(text) {
  return String(text || 'anonymous').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function stripCloudId(room) {
  const clone = { ...room };
  delete clone._id;
  return clone;
}
