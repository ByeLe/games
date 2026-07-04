export type PlayerId = string;
export type RoomPhase = 'lobby' | 'rolling' | 'bidding' | 'settlement';
export type DiceFace = 1 | 2 | 3 | 4 | 5 | 6;

export interface PlayerState {
    id: PlayerId;
    name: string;
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
    roomId: string;
    phase: RoomPhase;
    hostId: PlayerId;
    localPlayerId: PlayerId;
    players: PlayerState[];
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
    title: string;
    query: string;
}

export interface RoomService {
    createRoom(localName: string): Promise<RoomState>;
    joinRoom(roomId: string, playerName: string): Promise<RoomState>;
    getSharePayload(): SharePayload;
    ready(playerId: PlayerId): Promise<void>;
    roll(playerId: PlayerId): Promise<void>;
    bid(playerId: PlayerId, quantity: number, face: DiceFace): Promise<void>;
    open(playerId: PlayerId): Promise<void>;
    restart(): Promise<void>;
    subscribe(listener: RoomListener): () => void;
    getState(): RoomState | null;
}
