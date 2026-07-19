import { DiceFace, PlayerProfile, PlayerState, RoomListener, RoomService, RoomState, SharePayload } from '../model/GameTypes';
import { ROOM_CONTAINER_SERVICE } from './WechatCloudConfig';
import { WechatPlatform } from './WechatPlatform';

interface SocketTask {
    send(options: { data: string; success?: () => void; fail?: (error: unknown) => void }): void;
    close(options?: { code?: number; reason?: string }): void;
    onOpen(callback: () => void): void;
    onMessage(callback: (event: { data: string }) => void): void;
    onError(callback: (error: unknown) => void): void;
    onClose(callback: () => void): void;
}

interface ServerPlayer { id: string; name: string; avatarUrl?: string; seatIndex: number; isHost: boolean; isReady: boolean; hasRolled: boolean; }
interface ServerRoom { roomId: string; joinToken?: string; version: number; phase: RoomState['phase']; hostId: string; localPlayerId: string; players: ServerPlayer[]; waitingPlayers: ServerPlayer[]; currentTurnPlayerId: string | null; firstBidderId: string; previousLoserId: string | null; lastBid: RoomState['lastBid']; onesAreWild: boolean; bidHistory: RoomState['bidHistory']; settlement: RoomState['settlement']; message: string; canRestart: boolean; privateDice?: DiceFace[]; }
interface Pending { resolve: (value: any) => void; reject: (reason: unknown) => void; }

/** WebSocket 房间客户端：服务端是唯一权威状态，断线后自动认证并请求房间快照。 */
export class CloudRoomService implements RoomService {
    private state: RoomState | null = null;
    private roomId = '';
    private joinToken = '';
    private localPlayerId = '';
    private profile: PlayerProfile | null = null;
    private task: SocketTask | null = null;
    private openPromise: Promise<void> | null = null;
    private pending = new Map<string, Pending>();
    private listeners: RoomListener[] = [];
    private reconnectTimer: number | null = null;
    private heartbeatTimer: number | null = null;
    private reconnectAttempt = 0;
    private disposed = false;

    constructor(private readonly platform = new WechatPlatform()) {}

    async createRoom(profile: PlayerProfile): Promise<RoomState> {
        this.profile = profile;
        await this.ensureConnected();
        const room = await this.request<ServerRoom>('createRoom', { profile });
        this.applyRoom(room);
        return this.cloneState();
    }

    async joinRoom(roomId: string, profile: PlayerProfile, joinToken = ''): Promise<RoomState> {
        this.profile = profile;
        this.roomId = roomId;
        this.joinToken = joinToken;
        await this.ensureConnected();
        const room = await this.request<ServerRoom>('joinRoom', { roomId, joinToken, profile });
        this.applyRoom(room);
        return this.cloneState();
    }

    getSharePayload(): SharePayload {
        const state = this.ensureState();
        return { roomId: state.roomId, joinToken: this.joinToken, title: `加入我的大话骰房间：${state.roomId}`, query: `roomId=${encodeURIComponent(state.roomId)}&joinToken=${encodeURIComponent(this.joinToken)}` };
    }

    async ready(): Promise<void> { await this.action('ready'); }
    async roll(): Promise<void> { await this.action('roll'); }
    async bid(quantity: number, face: DiceFace): Promise<void> { await this.action('bid', { quantity, face }); }
    async open(): Promise<void> { await this.action('open'); }
    async restart(): Promise<void> { await this.action('restart'); }

    subscribe(listener: RoomListener): () => void {
        this.listeners.push(listener);
        if (this.state) listener(this.cloneState());
        return () => { this.listeners = this.listeners.filter((item) => item !== listener); };
    }
    getState(): RoomState | null { return this.state ? this.cloneState() : null; }
    dispose(): void {
        this.disposed = true;
        if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
        this.stopHeartbeat();
        this.rejectPending(new Error('房间连接已关闭。'));
        this.task?.close({ reason: 'leave room' });
        this.task = null;
    }

    private async action(type: string, payload: Record<string, unknown> = {}): Promise<void> {
        await this.ensureConnected();
        const room = await this.request<ServerRoom>('action', { action: type, roomId: this.roomId, ...payload, actionId: `${type}-${Date.now()}-${Math.random()}` });
        this.applyRoom(room);
    }

    private async ensureConnected(): Promise<void> {
        if (this.task && !this.openPromise) return;
        if (this.openPromise) return this.openPromise;
        this.platform.initCloud();
        const wxApi = (globalThis as { wx?: { cloud?: { connectContainer?: (options: { service: string; path: string }) => Promise<{ socketTask: SocketTask }> } } }).wx;
        if (!wxApi?.cloud?.connectContainer) throw new Error('当前环境不支持云托管 WebSocket。');
        this.openPromise = new Promise<void>((resolve, reject) => {
            wxApi.cloud?.connectContainer?.({ service: ROOM_CONTAINER_SERVICE, path: '/ws' })
                .then(({ socketTask: task }) => {
                    this.task = task;
                    task.onOpen(() => void this.authenticate().then(() => { this.startHeartbeat(); resolve(); }).catch(reject));
                    task.onMessage((event) => this.handleMessage(event.data));
                    task.onError((error) => console.error('[RoomSocket] error', error));
                    task.onClose(() => this.handleClose());
                })
                .catch(reject);
        }).finally(() => { this.openPromise = null; });
        return this.openPromise;
    }

    private async authenticate(): Promise<void> {
        const code = await this.platform.login();
        const auth = await this.request<{ playerId: string }>('auth', { code });
        this.localPlayerId = auth.playerId;
        if (this.roomId && this.joinToken) {
            const room = await this.request<ServerRoom>('resume', { roomId: this.roomId, joinToken: this.joinToken, profile: this.profile });
            this.applyRoom(room);
        }
    }

    private request<T>(type: string, payload: Record<string, unknown>): Promise<T> {
        if (!this.task) return Promise.reject(new Error('房间未连接。'));
        const requestId = `${Date.now()}-${Math.random()}`;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            this.task?.send({ data: JSON.stringify({ type, requestId, ...payload }), fail: (error) => { this.pending.delete(requestId); reject(error); } });
        });
    }

    private handleMessage(raw: string): void {
        let message: any;
        try { message = JSON.parse(raw); } catch (_) { return; }
        if (message.type === 'roomState') { this.applyRoom(message.room as ServerRoom); return; }
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        message.ok ? pending.resolve(message.data) : pending.reject(new Error(message.error || '房间操作失败。'));
    }

    private handleClose(): void {
        this.task = null;
        this.stopHeartbeat();
        this.rejectPending(new Error('连接已断开，正在重连。'));
        if (this.disposed) return;
        const delay = Math.min(1000 * (2 ** this.reconnectAttempt++), 10000);
        this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.ensureConnected().catch(() => this.handleClose()); }, delay) as unknown as number;
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        // 云托管网关会回收长期空闲的 WebSocket，定时心跳维持连接。
        this.heartbeatTimer = setInterval(() => {
            this.task?.send({ data: JSON.stringify({ type: 'ping' }) });
        }, 10000) as unknown as number;
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private applyRoom(room: ServerRoom): void {
        this.reconnectAttempt = 0;
        this.roomId = room.roomId || this.roomId;
        this.joinToken = room.joinToken || this.joinToken;
        this.localPlayerId = room.localPlayerId || this.localPlayerId;
        const dice = room.privateDice || [];
        this.state = { ...room, roomDocId: room.roomId, joinToken: this.joinToken, localPlayerId: this.localPlayerId,
            players: room.players.map((player) => ({ ...player, isLocal: player.id === this.localPlayerId, dice: player.id === this.localPlayerId ? dice : (room.settlement?.playerDice?.[player.id] || []) } as PlayerState)),
            waitingPlayers: (room.waitingPlayers || []).map((player) => ({ ...player, isLocal: player.id === this.localPlayerId, dice: [] } as PlayerState)),
        };
        this.listeners.forEach((listener) => listener(this.cloneState()));
    }
    private rejectPending(error: Error): void { this.pending.forEach((pending) => pending.reject(error)); this.pending.clear(); }
    private ensureState(): RoomState { if (!this.state) throw new Error('还没有进入联网房间。'); return this.state; }
    private cloneState(): RoomState { return JSON.parse(JSON.stringify(this.ensureState())) as RoomState; }
}
