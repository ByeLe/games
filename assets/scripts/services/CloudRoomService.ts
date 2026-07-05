import { DiceFace, PlayerProfile, PlayerState, RoomListener, RoomService, RoomState, SharePayload } from '../model/GameTypes';
import { ROOM_FUNCTION_NAME } from './WechatCloudConfig';
import { WechatPlatform } from './WechatPlatform';

interface CloudPlayer {
    id: string;
    name: string;
    avatarUrl?: string;
    seatIndex: number;
    isHost: boolean;
    isReady: boolean;
    hasRolled: boolean;
}

interface CloudRoomProjection {
    roomDocId: string;
    roomId: string;
    joinToken?: string;
    version: number;
    phase: RoomState['phase'];
    hostId: string;
    localPlayerId: string;
    players: CloudPlayer[];
    waitingPlayers?: CloudPlayer[];
    currentTurnPlayerId: string | null;
    firstBidderId: string;
    previousLoserId: string | null;
    lastBid: RoomState['lastBid'];
    onesAreWild: boolean;
    bidHistory: RoomState['bidHistory'];
    settlement: RoomState['settlement'] & { playerDice?: Record<string, DiceFace[]> } | null;
    message: string;
    canRestart?: boolean;
    privateDice?: DiceFace[];
}

interface CloudActionResult {
    room: CloudRoomProjection;
    roomDocId: string;
    privateDice?: DiceFace[];
}

export class CloudRoomService implements RoomService {
    private state: RoomState | null = null;
    private roomDocId = '';
    private joinToken = '';
    private localPlayerId = '';
    private privateDice: DiceFace[] = [];
    private listeners: RoomListener[] = [];
    private unwatch: (() => void) | null = null;

    constructor(private readonly platform = new WechatPlatform()) {}

    async createRoom(profile: PlayerProfile): Promise<RoomState> {
        this.platform.initCloud();
        const result = await this.callRoomFunction('createRoom', { profile });
        this.applyResult(result);
        return this.cloneState();
    }

    async joinRoom(roomId: string, profile: PlayerProfile, joinToken = ''): Promise<RoomState> {
        this.platform.initCloud();
        const result = await this.callRoomFunction('joinRoom', { roomId, joinToken, profile });
        this.applyResult(result);
        return this.cloneState();
    }

    getSharePayload(): SharePayload {
        const state = this.ensureState();
        return {
            roomId: state.roomId,
            joinToken: state.joinToken,
            title: `加入我的大话骰房间：${state.roomId}`,
            query: `roomId=${encodeURIComponent(state.roomId)}&joinToken=${encodeURIComponent(state.joinToken || this.joinToken)}`,
        };
    }

    async ready(): Promise<void> {
        await this.action('ready', {}, true);
    }

    async roll(): Promise<void> {
        await this.action('roll');
    }

    async bid(quantity: number, face: DiceFace): Promise<void> {
        await this.action('bid', { quantity, face });
    }

    async open(): Promise<void> {
        await this.action('open');
    }

    async restart(): Promise<void> {
        await this.action('restart');
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

    dispose(): void {
        this.unwatch?.();
        this.unwatch = null;
    }

    private async action(action: string, payload: Record<string, unknown> = {}, retryOnVersionConflict = false): Promise<void> {
        const state = this.ensureState();
        const actionId = this.createActionId(action);
        let result: CloudActionResult;
        try {
            result = await this.callRoomFunction(action, {
                ...payload,
                roomDocId: this.roomDocId || state.roomDocId,
                joinToken: this.joinToken || state.joinToken,
                expectedVersion: state.version || 0,
                actionId,
            });
        } catch (error) {
            if (!retryOnVersionConflict || !this.isVersionConflict(error)) {
                throw error;
            }
            const freshState = this.ensureState();
            result = await this.callRoomFunction(action, {
                ...payload,
                roomDocId: this.roomDocId || freshState.roomDocId,
                joinToken: this.joinToken || freshState.joinToken,
                expectedVersion: freshState.version || 0,
                actionId: this.createActionId(action),
            });
        }
        this.applyResult(result);
    }

    private async callRoomFunction(action: string, payload: Record<string, unknown>): Promise<CloudActionResult> {
        return this.platform.callFunction<CloudActionResult>(ROOM_FUNCTION_NAME, { action, ...payload });
    }

    private applyResult(result: CloudActionResult): void {
        this.roomDocId = result.roomDocId || result.room.roomDocId || this.roomDocId;
        this.joinToken = result.room.joinToken || this.joinToken;
        this.localPlayerId = result.room.localPlayerId || this.localPlayerId;
        if (result.privateDice) {
            this.privateDice = result.privateDice;
        }
        this.state = this.toRoomState(result.room);
        this.startWatch();
        this.emit();
    }

    private startWatch(): void {
        if (!this.roomDocId || this.unwatch) {
            return;
        }
        try {
            this.unwatch = this.platform.watchRoom(this.roomDocId, (doc) => {
                this.state = this.toRoomState(doc as CloudRoomProjection);
                this.emit();
            }, (error) => {
                console.error('[CloudRoomService] room watch failed', error);
                this.setMessage(`房间同步失败：${this.errorMessage(error)}`);
            });
        } catch (error) {
            console.error('[CloudRoomService] start room watch failed', error);
            if (this.state) {
                this.state.message = `已进入房间；实时同步不可用：${this.errorMessage(error)}`;
            }
        }
    }

    private toRoomState(room: CloudRoomProjection): RoomState {
        const privateDice = room.privateDice || this.privateDice;
        const localPlayerId = room.localPlayerId || this.localPlayerId;
        if (room.privateDice) {
            this.privateDice = room.privateDice;
        }
        const players = room.players.map((player) => this.toPlayerState(player, localPlayerId, room, privateDice));
        const waitingPlayers = (room.waitingPlayers || []).map((player) => ({
            ...this.toPlayerState(player, localPlayerId, room, []),
            isReady: false,
            hasRolled: false,
            dice: [],
        }));
        return {
            roomDocId: room.roomDocId || this.roomDocId,
            roomId: room.roomId,
            joinToken: room.joinToken || this.joinToken,
            version: room.version,
            canRestart: !!room.canRestart,
            phase: room.phase,
            hostId: room.hostId,
            localPlayerId,
            players,
            waitingPlayers,
            currentTurnPlayerId: room.currentTurnPlayerId,
            firstBidderId: room.firstBidderId,
            previousLoserId: room.previousLoserId,
            lastBid: room.lastBid,
            onesAreWild: room.onesAreWild,
            bidHistory: room.bidHistory || [],
            settlement: room.settlement,
            message: room.message,
        };
    }

    private toPlayerState(player: CloudPlayer, localPlayerId: string, room: CloudRoomProjection, privateDice: DiceFace[]): PlayerState {
        const settlementDice = room.settlement?.playerDice?.[player.id];
        const dice = settlementDice || (player.id === localPlayerId ? privateDice : []);
        return {
            id: player.id,
            name: player.name,
            avatarUrl: player.avatarUrl,
            seatIndex: player.seatIndex,
            isHost: player.isHost,
            isLocal: player.id === localPlayerId,
            isReady: player.isReady,
            hasRolled: player.hasRolled,
            dice,
        };
    }

    private setMessage(message: string): void {
        if (this.state) {
            this.state.message = message;
            this.emit();
        }
    }

    private emit(): void {
        const snapshot = this.cloneState();
        this.listeners.forEach((listener) => listener(snapshot));
    }

    private ensureState(): RoomState {
        if (!this.state) {
            throw new Error('还没有进入联网房间。');
        }
        return this.state;
    }

    private cloneState(): RoomState {
        return JSON.parse(JSON.stringify(this.ensureState())) as RoomState;
    }

    private createActionId(action: string): string {
        return `${action}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    }

    private isVersionConflict(error: unknown): boolean {
        return this.errorMessage(error).includes('房间状态已更新');
    }

    private errorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'object' && error) {
            const detail = error as { errMsg?: unknown; message?: unknown; errno?: unknown; code?: unknown; error?: unknown; detail?: unknown };
            const nested = detail.error || detail.detail;
            if (nested && nested !== error) {
                const nestedMessage = this.errorMessage(nested);
                if (nestedMessage && nestedMessage !== '未知错误') {
                    return nestedMessage;
                }
            }
            const message = detail.errMsg || detail.message;
            if (message) {
                return String(message);
            }
            const code = detail.errno || detail.code;
            if (code) {
                return `操作失败：${String(code)}`;
            }
            try {
                return JSON.stringify(error);
            } catch (_error) {
                return '操作失败，请重试。';
            }
        }
        return String(error || '未知错误');
    }
}
