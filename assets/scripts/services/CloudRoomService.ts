import { DiceFace, PlayerId, RoomListener, RoomService, RoomState, SharePayload } from '../model/GameTypes';

export class CloudRoomService implements RoomService {
    createRoom(): Promise<RoomState> {
        return this.notReady();
    }

    joinRoom(): Promise<RoomState> {
        return this.notReady();
    }

    getSharePayload(): SharePayload {
        return { roomId: '', title: '大话骰房间' };
    }

    ready(): Promise<void> {
        return this.notReady();
    }

    roll(): Promise<void> {
        return this.notReady();
    }

    bid(_playerId: PlayerId, _quantity: number, _face: DiceFace): Promise<void> {
        return this.notReady();
    }

    open(): Promise<void> {
        return this.notReady();
    }

    restart(): Promise<void> {
        return this.notReady();
    }

    subscribe(_listener: RoomListener): () => void {
        return () => {};
    }

    getState(): RoomState | null {
        return null;
    }

    private notReady<T>(): Promise<T> {
        return Promise.reject(new Error('CloudRoomService is reserved for WeChat Cloud Development integration.'));
    }
}

