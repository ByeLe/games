import { Bid, DiceFace, PlayerId, PlayerProfile, PlayerState, RoomListener, RoomService, RoomState, SharePayload } from '../model/GameTypes';
import { DICE_PER_PLAYER, MAX_PLAYERS, MIN_PLAYERS, isLegalBid, nextPlayerId, randomLegalBid, rollDice, settleRound } from '../model/GameRules';

const AI_NAMES = ['阿豪', '小青', '老陈', '豆豆', '阿峰'];

export class LocalRoomService implements RoomService {
    private state: RoomState | null = null;
    private listeners: RoomListener[] = [];
    private autoTimer = -1;

    async createRoom(profile: PlayerProfile): Promise<RoomState> {
        const localPlayer: PlayerState = {
            id: 'player-local',
            name: profile.name || '我',
            avatarUrl: profile.avatarUrl,
            seatIndex: this.nextSeatIndex([]),
            isHost: true,
            isLocal: true,
            isReady: false,
            hasRolled: false,
            dice: [],
        };

        const players = [localPlayer];
        for (let i = 0; i < 3; i += 1) {
            players.push(this.createAiPlayer(players));
        }

        this.state = {
            roomId: String(Math.floor(100000 + Math.random() * 900000)),
            phase: 'lobby',
            hostId: localPlayer.id,
            localPlayerId: localPlayer.id,
            players,
            currentTurnPlayerId: null,
            firstBidderId: localPlayer.id,
            previousLoserId: null,
            lastBid: null,
            onesAreWild: true,
            bidHistory: [],
            settlement: null,
            message: '房间已创建，点击准备开始。',
        };
        this.emit();
        this.scheduleAi();
        return this.cloneState();
    }

    async joinRoom(roomId: string, profile: PlayerProfile): Promise<RoomState> {
        if (!this.state) {
            await this.createRoom(profile);
        }
        this.ensureState().roomId = roomId || this.ensureState().roomId;
        this.ensureState().message = `已加入房间 ${this.ensureState().roomId}`;
        this.emit();
        return this.cloneState();
    }

    getSharePayload(): SharePayload {
        const state = this.ensureState();
        return {
            roomId: state.roomId,
            title: `加入我的大话骰房间：${state.roomId}`,
            query: `roomId=${state.roomId}`,
        };
    }

    async ready(): Promise<void> {
        const state = this.ensureState();
        if (state.phase !== 'lobby') {
            return;
        }
        const playerId = state.localPlayerId;
        const player = this.getPlayer(playerId);
        player.isReady = true;
        state.message = `${player.name} 已准备`;
        if (state.players.length >= MIN_PLAYERS && state.players.every((item) => item.isReady)) {
            state.phase = 'rolling';
            state.message = '所有人已准备，请摇骰。';
        }
        this.emit();
        this.scheduleAi();
    }

    async roll(): Promise<void> {
        const state = this.ensureState();
        if (state.phase !== 'rolling') {
            return;
        }
        const playerId = state.localPlayerId;
        const player = this.getPlayer(playerId);
        if (player.hasRolled) {
            return;
        }
        player.dice = rollDice(DICE_PER_PLAYER);
        player.hasRolled = true;
        state.message = `${player.name} 已摇骰`;
        if (state.players.every((item) => item.hasRolled)) {
            state.phase = 'bidding';
            state.currentTurnPlayerId = state.firstBidderId;
            state.message = `轮到 ${this.getPlayer(state.currentTurnPlayerId).name} 叫牌`;
        }
        this.emit();
        this.scheduleAi();
    }

    async bid(quantity: number, face: DiceFace): Promise<void> {
        const state = this.ensureState();
        const playerId = state.localPlayerId;
        if (state.phase !== 'bidding' || state.currentTurnPlayerId !== playerId) {
            return;
        }
        const bid: Bid = { playerId, quantity, face };
        if (!isLegalBid(state.lastBid, bid)) {
            state.message = '叫牌不合法：数量要更大，或数量相同点数更大。';
            this.emit();
            return;
        }

        state.lastBid = bid;
        state.bidHistory.push(bid);
        if (face === 1) {
            state.onesAreWild = false;
        }
        state.currentTurnPlayerId = nextPlayerId(state.players, playerId);
        state.message = `${this.getPlayer(playerId).name} 叫 ${quantity} 个 ${face}`;
        this.emit();
        this.scheduleAi();
    }

    async open(): Promise<void> {
        const state = this.ensureState();
        const playerId = state.localPlayerId;
        if (state.phase !== 'bidding' || state.currentTurnPlayerId !== playerId || !state.lastBid) {
            return;
        }
        const settlement = settleRound(state.players, playerId, state.lastBid, state.onesAreWild);
        state.phase = 'settlement';
        state.currentTurnPlayerId = null;
        state.previousLoserId = settlement.loserId;
        state.firstBidderId = settlement.loserId;
        state.settlement = settlement;
        state.message = `${this.getPlayer(playerId).name} 开牌，${this.getPlayer(settlement.loserId).name} 输`;
        this.emit();
    }

    async restart(): Promise<void> {
        const state = this.ensureState();
        const firstBidderId = state.previousLoserId || state.hostId;
        state.players.forEach((player) => {
            player.isReady = false;
            player.hasRolled = false;
            player.dice = [];
        });
        state.phase = 'lobby';
        state.currentTurnPlayerId = null;
        state.firstBidderId = firstBidderId;
        state.lastBid = null;
        state.onesAreWild = true;
        state.bidHistory = [];
        state.settlement = null;
        state.message = `新一局，${this.getPlayer(firstBidderId).name} 先叫。`;
        this.emit();
        this.scheduleAi();
    }

    subscribe(listener: RoomListener): () => void {
        this.listeners.push(listener);
        if (this.state) {
            listener(this.cloneState());
        }
        return () => {
            this.listeners = this.listeners.filter((item) => item !== listener);
        };
    }

    getState(): RoomState | null {
        return this.state ? this.cloneState() : null;
    }

    private createAiPlayer(existingPlayers: PlayerState[]): PlayerState {
        const seatIndex = this.nextSeatIndex(existingPlayers);
        return {
            id: `player-ai-${seatIndex}`,
            name: AI_NAMES[seatIndex - 1] || `玩家${seatIndex + 1}`,
            seatIndex,
            isHost: false,
            isLocal: false,
            isReady: false,
            hasRolled: false,
            dice: [],
        };
    }

    private nextSeatIndex(players: PlayerState[]): number {
        const usedSeats = new Set(players.map((player) => player.seatIndex));
        for (let seatIndex = 0; seatIndex < MAX_PLAYERS; seatIndex += 1) {
            if (!usedSeats.has(seatIndex)) {
                return seatIndex;
            }
        }
        throw new Error('Room is full.');
    }

    private scheduleAi(): void {
        if (this.autoTimer !== -1) {
            clearTimeout(this.autoTimer);
        }
        this.autoTimer = setTimeout(() => void this.runAiStep(), 650) as unknown as number;
    }

    private async runAiStep(): Promise<void> {
        const state = this.state;
        if (!state) {
            return;
        }
        if (state.phase === 'lobby') {
            const nextAi = state.players.find((player) => !player.isLocal && !player.isReady);
            if (nextAi) {
                await this.readyAi(nextAi.id);
            }
            return;
        }
        if (state.phase === 'rolling') {
            const nextAi = state.players.find((player) => !player.isLocal && !player.hasRolled);
            if (nextAi) {
                await this.rollAi(nextAi.id);
            }
            return;
        }
        if (state.phase === 'bidding' && state.currentTurnPlayerId) {
            const player = this.getPlayer(state.currentTurnPlayerId);
            if (!player.isLocal) {
                const shouldOpen = !!state.lastBid && state.bidHistory.length >= 2 && Math.random() < 0.28;
                if (shouldOpen) {
                    await this.openAi(player.id);
                } else {
                    const bid = randomLegalBid(state.lastBid, player.id, state.players.length * DICE_PER_PLAYER);
                    await this.bidAi(player.id, bid.quantity, bid.face);
                }
            }
        }
    }

    private async readyAi(playerId: PlayerId): Promise<void> {
        const originalLocalId = this.ensureState().localPlayerId;
        this.ensureState().localPlayerId = playerId;
        await this.ready();
        this.ensureState().localPlayerId = originalLocalId;
    }

    private async rollAi(playerId: PlayerId): Promise<void> {
        const originalLocalId = this.ensureState().localPlayerId;
        this.ensureState().localPlayerId = playerId;
        await this.roll();
        this.ensureState().localPlayerId = originalLocalId;
    }

    private async bidAi(playerId: PlayerId, quantity: number, face: DiceFace): Promise<void> {
        const originalLocalId = this.ensureState().localPlayerId;
        this.ensureState().localPlayerId = playerId;
        await this.bid(quantity, face);
        this.ensureState().localPlayerId = originalLocalId;
    }

    private async openAi(playerId: PlayerId): Promise<void> {
        const originalLocalId = this.ensureState().localPlayerId;
        this.ensureState().localPlayerId = playerId;
        await this.open();
        this.ensureState().localPlayerId = originalLocalId;
    }

    private getPlayer(playerId: PlayerId): PlayerState {
        const player = this.ensureState().players.find((item) => item.id === playerId);
        if (!player) {
            throw new Error(`Player not found: ${playerId}`);
        }
        return player;
    }

    private ensureState(): RoomState {
        if (!this.state) {
            throw new Error('Room has not been created.');
        }
        return this.state;
    }

    private emit(): void {
        const snapshot = this.cloneState();
        this.listeners.forEach((listener) => listener(snapshot));
    }

    private cloneState(): RoomState {
        return JSON.parse(JSON.stringify(this.ensureState())) as RoomState;
    }
}
