export type PlayerId = string;
export type RoomPhase = 'lobby' | 'rolling' | 'bidding' | 'settlement';
export type DiceFace = 1 | 2 | 3 | 4 | 5 | 6;

export interface PlayerProfile {
    name: string;
    avatarUrl: string;
}

export interface PlayerState {
    id: PlayerId;
    name: string;
    avatarUrl?: string;
    /** Server-authoritative room seat. Clients map it to local visual positions. */
    seatIndex: number;
    isHost: boolean;
    isLocal: boolean;
    isReady: boolean;
    hasRolled: boolean;
    dice: DiceFace[];
}

export interface Bid {
    playerId: PlayerId;
    quantity: number;
    face: DiceFace;
}

export interface Settlement {
    openedBy: PlayerId;
    lastBid: Bid;
    totals: Record<DiceFace, number>;
    effectiveCount: number;
    onesAreWild: boolean;
    bidSucceeded: boolean;
    loserId: PlayerId;
}

export interface RoomState {
    roomDocId?: string;
    roomId: string;
    joinToken?: string;
    version?: number;
    canRestart?: boolean;
    phase: RoomPhase;
    hostId: PlayerId;
    localPlayerId: PlayerId;
    players: PlayerState[];
    waitingPlayers?: PlayerState[];
    currentTurnPlayerId: PlayerId | null;
    firstBidderId: PlayerId;
    previousLoserId: PlayerId | null;
    lastBid: Bid | null;
    onesAreWild: boolean;
    bidHistory: Bid[];
    settlement: Settlement | null;
    message: string;
}

export type RoomListener = (state: RoomState) => void;

export interface SharePayload {
    roomId: string;
    joinToken?: string;
    title: string;
    query: string;
}

export interface RoomService {
    createRoom(profile: PlayerProfile): Promise<RoomState>;
    joinRoom(roomId: string, profile: PlayerProfile, joinToken?: string): Promise<RoomState>;
    getSharePayload(): SharePayload;
    ready(): Promise<void>;
    roll(): Promise<void>;
    bid(quantity: number, face: DiceFace): Promise<void>;
    open(): Promise<void>;
    restart(): Promise<void>;
    subscribe(listener: RoomListener): () => void;
    getState(): RoomState | null;
}
