const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const DICE_PER_PLAYER = 5;
const ACTION_ID_LIMIT = 80;

function createRoom({ openid, profile, roomId, joinTokenHash, now }) {
  const player = createPlayer(openid, profile, 0, true);
  return {
    roomId,
    joinTokenHash,
    phase: 'lobby',
    hostId: openid,
    players: [player],
    waitingPlayers: [],
    currentTurnPlayerId: null,
    firstBidderId: openid,
    previousLoserId: null,
    lastBid: null,
    onesAreWild: true,
    bidHistory: [],
    settlement: null,
    version: 1,
    recentActionIds: [],
    createdAt: now,
    updatedAt: now,
    message: '房间已创建，等待玩家加入。',
  };
}

function joinRoom(room, { openid, profile, now }) {
  const active = room.players.find((player) => player.id === openid);
  if (active) {
    active.name = profile.name;
    active.avatarUrl = profile.avatarUrl;
    room.updatedAt = now;
    room.message = `${active.name} 已回到房间`;
    return room;
  }
  const waiting = room.waitingPlayers.find((player) => player.id === openid);
  if (waiting) {
    waiting.name = profile.name;
    waiting.avatarUrl = profile.avatarUrl;
    room.updatedAt = now;
    room.message = `${waiting.name} 等待下局加入`;
    return room;
  }
  if (room.players.length >= MAX_PLAYERS && room.phase === 'lobby') {
    throw new Error('房间已满。');
  }
  if (room.players.length + room.waitingPlayers.length >= MAX_PLAYERS && room.phase !== 'lobby') {
    throw new Error('房间已满，下局也没有空位。');
  }
  if (room.phase === 'lobby') {
    const player = createPlayer(openid, profile, nextSeatIndex(room.players), false);
    room.players.push(player);
    room.message = `${player.name} 已加入房间`;
  } else {
    const player = createPlayer(openid, profile, -1, false);
    room.waitingPlayers.push(player);
    room.message = `${player.name} 已加入，将在下局开始时参与`;
  }
  room.version += 1;
  room.updatedAt = now;
  return room;
}

function ready(room, context) {
  return withAction(room, context, () => {
    assertActive(room, context.openid);
    assertPhase(room, 'lobby');
    const player = findPlayer(room, context.openid);
    player.isReady = true;
    room.message = `${player.name} 已准备`;
    if (room.players.length >= MIN_PLAYERS && room.players.every((item) => item.isReady)) {
      room.phase = 'rolling';
      room.message = '所有人已准备，请摇骰。';
    }
  });
}

function roll(room, context) {
  let dice = [];
  withAction(room, context, () => {
    assertActive(room, context.openid);
    assertPhase(room, 'rolling');
    const player = findPlayer(room, context.openid);
    if (player.hasRolled) {
      throw new Error('本轮已经摇过骰。');
    }
    dice = rollDice();
    player.hasRolled = true;
    room.message = `${player.name} 已摇骰`;
    if (room.players.every((item) => item.hasRolled)) {
      room.phase = 'bidding';
      room.currentTurnPlayerId = room.firstBidderId;
      room.message = `轮到 ${findPlayer(room, room.currentTurnPlayerId).name} 叫牌`;
    }
  });
  return { room, dice };
}

function bid(room, context) {
  return withAction(room, context, () => {
    assertActive(room, context.openid);
    assertPhase(room, 'bidding');
    if (room.currentTurnPlayerId !== context.openid) {
      throw new Error('还没有轮到你。');
    }
    const nextBid = { playerId: context.openid, quantity: context.quantity, face: context.face };
    if (!isLegalBid(room.lastBid, nextBid)) {
      throw new Error('叫牌不合法：数量要更大，或数量相同点数更大。');
    }
    room.lastBid = nextBid;
    room.bidHistory.push(nextBid);
    if (nextBid.face === 1) {
      room.onesAreWild = false;
    }
    room.currentTurnPlayerId = nextPlayerId(room.players, context.openid);
    room.message = `${findPlayer(room, context.openid).name} 叫 ${nextBid.quantity} 个 ${nextBid.face}`;
  });
}

function open(room, context, diceByPlayer) {
  return withAction(room, context, () => {
    assertActive(room, context.openid);
    assertPhase(room, 'bidding');
    if (room.currentTurnPlayerId !== context.openid) {
      throw new Error('还没有轮到你。');
    }
    if (!room.lastBid) {
      throw new Error('还没有叫牌，不能开。');
    }
    const playersWithDice = room.players.map((player) => ({
      ...player,
      dice: diceByPlayer[player.id] || [],
    }));
    if (playersWithDice.some((player) => player.dice.length !== DICE_PER_PLAYER)) {
      throw new Error('还有玩家骰面缺失，不能结算。');
    }
    const settlement = settleRound(playersWithDice, context.openid, room.lastBid, room.onesAreWild);
    room.phase = 'settlement';
    room.currentTurnPlayerId = null;
    room.previousLoserId = settlement.loserId;
    room.firstBidderId = settlement.loserId;
    room.settlement = {
      ...settlement,
      playerDice: Object.fromEntries(playersWithDice.map((player) => [player.id, player.dice])),
    };
    room.message = `${findPlayer(room, context.openid).name} 开牌，${findPlayer(room, settlement.loserId).name} 输`;
  });
}

function restart(room, context) {
  return withAction(room, context, () => {
    assertPhase(room, 'settlement');
    if (room.hostId !== context.openid) {
      throw new Error('只有房主可以开始下一局。');
    }
    const activeIds = new Set(room.players.map((player) => player.id));
    if (!activeIds.has(context.openid)) {
      throw new Error('等待下局的玩家不能重开房间。');
    }
    const merged = [...room.players];
    room.waitingPlayers.forEach((player) => {
      if (merged.length < MAX_PLAYERS && !merged.some((item) => item.id === player.id)) {
        merged.push({ ...player, seatIndex: nextSeatIndex(merged), isReady: false, hasRolled: false });
      }
    });
    room.players = merged.map((player, index) => ({
      ...player,
      seatIndex: index,
      isReady: false,
      hasRolled: false,
    }));
    room.waitingPlayers = [];
    room.phase = 'lobby';
    room.currentTurnPlayerId = null;
    room.firstBidderId = room.previousLoserId || room.hostId;
    room.lastBid = null;
    room.onesAreWild = true;
    room.bidHistory = [];
    room.settlement = null;
    room.message = `新一局，${findPlayer(room, room.firstBidderId).name} 先叫。`;
  });
}

function toProjection(room, { openid, roomDocId, joinToken, privateDice = [] }) {
  return {
    roomDocId,
    roomId: room.roomId,
    joinToken,
    version: room.version,
    phase: room.phase,
    hostId: room.hostId,
    localPlayerId: openid,
    players: room.players.map(publicPlayer(room)),
    waitingPlayers: room.waitingPlayers.map(publicPlayer(room)),
    currentTurnPlayerId: room.currentTurnPlayerId,
    firstBidderId: room.firstBidderId,
    previousLoserId: room.previousLoserId,
    lastBid: room.lastBid,
    onesAreWild: room.onesAreWild,
    bidHistory: room.bidHistory,
    settlement: room.settlement,
    canRestart: room.phase === 'settlement' && room.hostId === openid,
    message: room.message,
    privateDice,
  };
}

function publicPlayer(room) {
  return (player) => ({
    id: player.id,
    name: player.name,
    avatarUrl: player.avatarUrl,
    seatIndex: player.seatIndex,
    isHost: player.id === room.hostId,
    isReady: !!player.isReady,
    hasRolled: !!player.hasRolled,
  });
}

function withAction(room, context, mutate) {
  if (room.recentActionIds.includes(context.actionId)) {
    return room;
  }
  assertVersion(room, context.expectedVersion);
  mutate();
  room.recentActionIds = [...room.recentActionIds, context.actionId].slice(-ACTION_ID_LIMIT);
  room.version += 1;
  room.updatedAt = context.now;
  return room;
}

function createPlayer(openid, profile, seatIndex, isHost) {
  return {
    id: openid,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    seatIndex,
    isHost,
    isReady: false,
    hasRolled: false,
  };
}

function assertVersion(room, expectedVersion) {
  if (typeof expectedVersion === 'number' && room.version !== expectedVersion) {
    throw new Error('房间状态已更新，请稍后重试。');
  }
}

function assertPhase(room, phase) {
  if (room.phase !== phase) {
    throw new Error(`当前阶段不能执行该操作。`);
  }
}

function assertActive(room, openid) {
  if (!room.players.some((player) => player.id === openid)) {
    throw new Error('你还在等待下局加入。');
  }
}

function findPlayer(room, openid) {
  const player = room.players.find((item) => item.id === openid);
  if (!player) {
    throw new Error('玩家不存在。');
  }
  return player;
}

function nextSeatIndex(players) {
  const used = new Set(players.map((player) => player.seatIndex));
  for (let seatIndex = 0; seatIndex < MAX_PLAYERS; seatIndex += 1) {
    if (!used.has(seatIndex)) {
      return seatIndex;
    }
  }
  throw new Error('房间已满。');
}

function isLegalBid(previous, next) {
  if (!Number.isInteger(next.quantity) || !Number.isInteger(next.face) || next.quantity < 1 || next.face < 1 || next.face > 6) {
    return false;
  }
  if (!previous) {
    return true;
  }
  return next.quantity > previous.quantity || (next.quantity === previous.quantity && next.face > previous.face);
}

function nextPlayerId(players, currentPlayerId) {
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  const index = sorted.findIndex((player) => player.id === currentPlayerId);
  return sorted[(index + 1 + sorted.length) % sorted.length].id;
}

function rollDice() {
  return Array.from({ length: DICE_PER_PLAYER }, () => Math.floor(Math.random() * 6) + 1);
}

function countFaces(players) {
  const totals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  players.forEach((player) => {
    player.dice.forEach((face) => {
      totals[face] += 1;
    });
  });
  return totals;
}

function settleRound(players, openedBy, lastBid, onesAreWild) {
  const totals = countFaces(players);
  const effectiveCount = lastBid.face === 1 || !onesAreWild
    ? totals[lastBid.face]
    : totals[lastBid.face] + totals[1];
  const bidSucceeded = effectiveCount >= lastBid.quantity;
  return {
    openedBy,
    lastBid,
    totals,
    effectiveCount,
    onesAreWild,
    bidSucceeded,
    loserId: bidSucceeded ? openedBy : lastBid.playerId,
  };
}

module.exports = {
  ACTION_ID_LIMIT,
  DICE_PER_PLAYER,
  MAX_PLAYERS,
  bid,
  createRoom,
  joinRoom,
  open,
  ready,
  restart,
  roll,
  toProjection,
};
