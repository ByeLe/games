import assert from 'node:assert/strict';
import roomCore from '../cloudfunctions/room/roomCore.js';

const {
  bid,
  createRoom,
  joinRoom,
  open,
  ready,
  restart,
  roll,
  toProjection,
} = roomCore;

let now = 1000;
const profile = (name) => ({ name, avatarUrl: `https://example.com/${name}.png` });
const context = (openid, room, actionId, extra = {}) => ({
  openid,
  now: now += 1,
  expectedVersion: room.version,
  actionId,
  ...extra,
});

let room = createRoom({
  openid: 'host',
  profile: profile('房主'),
  roomId: '100001',
  joinTokenHash: 'token-hash',
  now,
});

assert.equal(room.players.length, 1);
assert.equal(room.players[0].id, 'host');

room = joinRoom(room, { openid: 'p2', profile: profile('玩家2'), now: now += 1 });
assert.equal(room.players.length, 2);
assert.equal(room.waitingPlayers.length, 0);

room = ready(room, context('host', room, 'host-ready'));
room = ready(room, context('p2', room, 'p2-ready'));
assert.equal(room.phase, 'rolling');

const hostRoll = roll(room, context('host', room, 'host-roll'));
room = hostRoll.room;
const p2Roll = roll(room, context('p2', room, 'p2-roll'));
room = p2Roll.room;
assert.equal(room.phase, 'bidding');
assert.equal(hostRoll.dice.length, 5);
assert.equal(toProjection(room, { openid: 'host', roomDocId: 'doc1', joinToken: 'join', privateDice: hostRoll.dice }).players[1].dice, undefined);

const duplicated = bid(room, context('host', room, 'host-bid', { quantity: 1, face: 2 }));
const afterDuplicate = bid(duplicated, { ...context('host', duplicated, 'host-bid', { quantity: 2, face: 2 }), expectedVersion: duplicated.version - 1 });
assert.equal(afterDuplicate.version, duplicated.version);
room = duplicated;

assert.throws(() => bid(room, context('host', room, 'bad-turn', { quantity: 2, face: 2 })), /还没有轮到你/);
room = bid(room, context('p2', room, 'p2-bid', { quantity: 2, face: 2 }));
room = joinRoom(room, { openid: 'p3', profile: profile('玩家3'), now: now += 1 });
assert.equal(room.waitingPlayers.length, 1);

room = open(room, context('host', room, 'host-open'), {
  host: hostRoll.dice,
  p2: p2Roll.dice,
});
assert.equal(room.phase, 'settlement');
assert.ok(room.settlement.playerDice.host);

assert.throws(() => restart(room, context('p3', room, 'p3-restart')), /只有房主/);
room = restart(room, context('host', room, 'host-restart'));
assert.equal(room.phase, 'lobby');
assert.equal(room.players.length, 3);
assert.equal(room.waitingPlayers.length, 0);

console.log('roomCore tests passed');
