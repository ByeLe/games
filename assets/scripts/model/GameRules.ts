import { Bid, DiceFace, PlayerState, Settlement } from './GameTypes';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DICE_PER_PLAYER = 5;

export function isLegalBid(previous: Bid | null, next: Bid): boolean {
    if (next.quantity < 1 || next.face < 1 || next.face > 6) {
        return false;
    }
    if (!previous) {
        return true;
    }
    return next.quantity > previous.quantity || (next.quantity === previous.quantity && next.face > previous.face);
}

export function nextPlayerId(players: PlayerState[], currentPlayerId: string): string {
    const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
    const index = sorted.findIndex((player) => player.id === currentPlayerId);
    const next = sorted[(index + 1 + sorted.length) % sorted.length];
    return next.id;
}

export function rollDice(count = DICE_PER_PLAYER): DiceFace[] {
    const dice: DiceFace[] = [];
    for (let i = 0; i < count; i += 1) {
        dice.push((Math.floor(Math.random() * 6) + 1) as DiceFace);
    }
    return dice;
}

export function countFaces(players: PlayerState[]): Record<DiceFace, number> {
    const totals: Record<DiceFace, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    players.forEach((player) => {
        player.dice.forEach((face) => {
            totals[face] += 1;
        });
    });
    return totals;
}

export function effectiveBidCount(totals: Record<DiceFace, number>, face: DiceFace, onesAreWild: boolean): number {
    if (face === 1 || !onesAreWild) {
        return totals[face];
    }
    return totals[face] + totals[1];
}

export function settleRound(players: PlayerState[], openedBy: string, lastBid: Bid, onesAreWild: boolean): Settlement {
    const totals = countFaces(players);
    const effectiveCount = effectiveBidCount(totals, lastBid.face, onesAreWild);
    const bidSucceeded = effectiveCount >= lastBid.quantity;
    const loserId = bidSucceeded ? openedBy : lastBid.playerId;

    return {
        openedBy,
        lastBid,
        totals,
        effectiveCount,
        onesAreWild,
        bidSucceeded,
        loserId,
    };
}

export function lowestLegalBid(previous: Bid | null, playerId: string): Bid {
    if (!previous) {
        return { playerId, quantity: 1, face: 2 };
    }
    if (previous.face < 6) {
        return { playerId, quantity: previous.quantity, face: (previous.face + 1) as DiceFace };
    }
    return { playerId, quantity: previous.quantity + 1, face: 2 };
}

export function randomLegalBid(previous: Bid | null, playerId: string, maxDice: number): Bid {
    const minimum = lowestLegalBid(previous, playerId);
    const quantity = Math.min(maxDice, minimum.quantity + Math.floor(Math.random() * 2));
    const face = quantity === minimum.quantity
        ? (minimum.face + Math.floor(Math.random() * (7 - minimum.face))) as DiceFace
        : (Math.floor(Math.random() * 6) + 1) as DiceFace;
    return { playerId, quantity, face };
}

