import {
    _decorator,
    Button,
    Canvas,
    Color,
    Component,
    Graphics,
    Label,
    Node,
    Tween,
    tween,
    UITransform,
    EventTouch,
    Vec3,
} from 'cc';
import { DiceFace, PlayerState, RoomService, RoomState } from '../model/GameTypes';
import { DICE_PER_PLAYER } from '../model/GameRules';
import { LocalRoomService } from '../services/LocalRoomService';

const { ccclass } = _decorator;

const DESIGN_WIDTH = 720;
const DESIGN_HEIGHT = 1280;
type EntryMode = 'menu' | 'room';
type RoomMode = 'single' | 'online';

@ccclass('GameRoot')
export class GameRoot extends Component {
    private service: RoomService = new LocalRoomService();
    private state: RoomState | null = null;
    private content: Node | null = null;
    private entryMode: EntryMode = 'menu';
    private roomMode: RoomMode = 'single';
    private selectedQuantity = 1;
    private selectedFace: DiceFace = 2;
    private nodeCache = new Map<string, Node>();
    private buttonHandlers = new Map<string, () => void>();
    private activeNodeKeys = new Set<string>();
    private rollingAnimationIds = new Set<string>();
    private isRollingLocal = false;
    private localCupOffsetY = 0;
    private cupDragStartY = 0;
    private isDraggingCup = false;
    private dragBoundNodes = new Set<string>();

    async start(): Promise<void> {
        this.setupCanvas();
        this.content = this.requireChild(this.node, 'RuntimeUI');
        this.cacheSceneNodes(this.content);
        this.service.subscribe((state) => {
            this.state = state;
            this.entryMode = 'room';
            this.syncSelection();
            this.render();
        });
        const sharedRoomId = this.getLaunchRoomId();
        if (sharedRoomId) {
            await this.startRoom('online', sharedRoomId);
            return;
        }
        this.render();
    }

    private setupCanvas(): void {
        const transform = this.node.getComponent(UITransform);
        if (!transform) {
            throw new Error('Canvas is missing UITransform. Run npm run generate:scene first.');
        }
        transform.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
        const canvas = this.node.getComponent(Canvas);
        if (!canvas) {
            throw new Error('Canvas is missing Canvas component. Run npm run generate:scene first.');
        }
        canvas.alignCanvasWithScreen = true;
    }

    private syncSelection(): void {
        const maxDice = (this.state?.players.length || 4) * DICE_PER_PLAYER;
        const lastBid = this.state?.lastBid;
        if (!lastBid) {
            this.selectedQuantity = Math.max(1, Math.min(this.selectedQuantity, maxDice));
            return;
        }
        if (this.selectedQuantity < lastBid.quantity || (this.selectedQuantity === lastBid.quantity && this.selectedFace <= lastBid.face)) {
            if (lastBid.face < 6) {
                this.selectedQuantity = lastBid.quantity;
                this.selectedFace = (lastBid.face + 1) as DiceFace;
            } else {
                this.selectedQuantity = Math.min(maxDice, lastBid.quantity + 1);
                this.selectedFace = 2;
            }
        }
    }

    private async startRoom(mode: RoomMode, roomId?: string): Promise<void> {
        this.roomMode = mode;
        this.entryMode = 'room';
        this.localCupOffsetY = 0;
        if (roomId) {
            await this.service.joinRoom(roomId, '我');
            this.toast(`通过分享加入房间 ${roomId}`);
            return;
        }
        await this.service.createRoom('我');
        if (mode === 'online') {
            this.toast('联网模式：当前使用本地模拟，后续接微信云开发接口。');
        }
    }

    private getLaunchRoomId(): string {
        const wxApi = (globalThis as { wx?: { getLaunchOptionsSync?: () => { query?: Record<string, string> } } }).wx;
        const query = wxApi?.getLaunchOptionsSync?.().query;
        return query?.roomId || query?.room || '';
    }

    private render(): void {
        if (!this.content) {
            return;
        }
        this.content.active = true;
        this.activeNodeKeys.clear();
        this.drawBackground(this.content);
        if (this.entryMode === 'menu' || !this.state) {
            this.drawEntryMenu(this.content);
            this.hideUnusedNodes();
            return;
        }
        this.drawTopBar(this.content, this.state);
        this.drawTable(this.content, this.state);
        this.drawPlayers(this.content, this.state);
        this.drawControls(this.content, this.state);
        this.drawRollingCenter(this.content, this.state);
        if (this.state.settlement) {
            this.drawSettlement(this.content, this.state);
        }
        this.hideUnusedNodes();
        this.syncRollingAnimations(this.state);
    }

    private drawBackground(parent: Node): void {
        const bg = this.createNode('Background', parent, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        const graphics = this.graphics(bg);
        graphics.clear();
        graphics.fillColor = new Color(56, 13, 18, 255);
        graphics.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, DESIGN_HEIGHT);
        graphics.fill();
        graphics.fillColor = new Color(97, 23, 28, 255);
        graphics.roundRect(-320, -540, 640, 1080, 28);
        graphics.fill();
        graphics.fillColor = new Color(145, 35, 30, 220);
        graphics.roundRect(-286, -506, 572, 1012, 22);
        graphics.fill();
    }

    private drawEntryMenu(parent: Node): void {
        this.panel(parent, 'EntryModePanel', 0, 95, 620, 460, new Color(28, 21, 22, 245), new Color(233, 187, 95, 255));
        this.text(parent, 'EntryTitleText', '大话骰', 0, 260, 52, new Color(255, 228, 162, 255), 560);
        this.text(parent, 'EntryHintText', '选择玩法后创建房间', 0, 198, 27, new Color(238, 211, 166, 255), 560);
        this.button(parent, 'SingleModeButton', '单机模式', 0, 72, 360, 78, () => void this.startRoom('single'));
        this.button(parent, 'OnlineModeButton', '联网模式', 0, -42, 360, 78, () => void this.startRoom('online'));
        this.text(parent, 'OnlineReservedText', '联网模式已预留微信云开发接口，当前先走本地模拟', 0, -138, 22, new Color(218, 201, 168, 255), 540);
    }

    private drawTopBar(parent: Node, state: RoomState): void {
        this.panel(parent, 'TopBar', 0, 570, 660, 110, new Color(42, 20, 20, 235), new Color(202, 154, 74, 255));
        this.text(parent, 'RoomIdText', `房间 ${state.roomId}`, -190, 596, 32, new Color(255, 230, 178, 255), 260);
        this.text(parent, 'PhaseText', `${this.phaseLabel(state)} · ${this.roomMode === 'single' ? '单机' : '联网'}`, -185, 556, 24, new Color(245, 206, 135, 255), 300);
        this.button(parent, 'ShareButton', '分享', 180, 590, 120, 52, () => {
            const payload = this.service.getSharePayload();
            this.toast(`分享：${payload.title}（${payload.query}）`);
        });
        this.text(parent, 'MessageText', state.message, 0, 508, 24, new Color(255, 238, 203, 255), 640);
    }

    private drawTable(parent: Node, state: RoomState): void {
        const table = this.createNode('Table', parent, 0, 120, 590, 480);
        const graphics = this.graphics(table);
        graphics.clear();
        graphics.fillColor = new Color(68, 34, 20, 255);
        graphics.ellipse(0, 0, 292, 226);
        graphics.fill();
        graphics.fillColor = new Color(42, 111, 74, 255);
        graphics.ellipse(0, 10, 250, 190);
        graphics.fill();
        graphics.strokeColor = new Color(223, 174, 90, 255);
        graphics.lineWidth = 8;
        graphics.ellipse(0, 10, 250, 190);
        graphics.stroke();

        const lastBid = state.lastBid ? `${this.playerName(state, state.lastBid.playerId)}：${state.lastBid.quantity} 个 ${state.lastBid.face}` : '等待叫牌';
        this.text(parent, 'LastBidText', lastBid, 0, 165, 34, new Color(255, 237, 184, 255), 480);
        this.text(parent, 'RuleText', state.onesAreWild ? '规则：1 当前为万能点' : '规则：1 已关闭万能', 0, 112, 24, new Color(219, 242, 209, 255), 420);
        this.drawBidHistory(parent, state);
    }

    private drawBidHistory(parent: Node, state: RoomState): void {
        const history = state.bidHistory.slice(-4).map((bid) => `${this.playerName(state, bid.playerId)} ${bid.quantity}个${bid.face}`).join('  /  ');
        this.text(parent, 'BidHistoryText', history || '叫牌记录会显示在这里', 0, -105, 22, new Color(234, 215, 168, 255), 560);
    }

    private drawPlayers(parent: Node, state: RoomState): void {
        const positions = [
            { x: 0, y: -330 },
            { x: -240, y: 290 },
            { x: 0, y: 385 },
            { x: 240, y: 290 },
            { x: -240, y: 80 },
            { x: 240, y: 80 },
        ];
        state.players.forEach((player) => {
            const pos = positions[player.seatIndex] || positions[0];
            this.drawPlayerSeat(parent, state, player, pos.x, pos.y);
        });
    }

    private drawPlayerSeat(parent: Node, state: RoomState, player: PlayerState, x: number, y: number): void {
        const seatRoot = this.createNode(`PlayerSeatPrefab-${player.id}`, parent, x, y, player.isLocal ? 630 : 190, player.isLocal ? 178 : 132);
        const isTurn = state.currentTurnPlayerId === player.id;
        const panelColor = isTurn ? new Color(119, 52, 30, 245) : new Color(42, 24, 24, 220);
        const seatWidth = player.isLocal ? 630 : 190;
        const seatHeight = player.isLocal ? 178 : 132;
        this.panel(seatRoot, 'SeatPanel', 0, 0, seatWidth, seatHeight, panelColor, isTurn ? new Color(255, 214, 98, 255) : new Color(151, 111, 71, 255));
        this.drawAvatar(seatRoot, player, -seatWidth / 2 + (player.isLocal ? 58 : 34), player.isLocal ? 38 : 25, player.isLocal ? 58 : 38);
        this.text(seatRoot, 'PlayerNameText', `${player.name}${player.isHost ? ' 房主' : ''}`, player.isLocal ? 42 : 18, player.isLocal ? 55 : 42, player.isLocal ? 28 : 21, new Color(255, 233, 190, 255), player.isLocal ? 410 : 118);
        this.text(seatRoot, 'PlayerStatusText', this.playerStatus(state, player), player.isLocal ? 42 : 18, player.isLocal ? 22 : 13, player.isLocal ? 22 : 18, new Color(230, 205, 155, 255), player.isLocal ? 410 : 118);

        if (player.isLocal || state.phase === 'settlement') {
            if (state.phase === 'rolling' && !player.hasRolled) {
                this.drawCup(seatRoot, player.isLocal ? 42 : 0, player.isLocal ? -43 : -30, player.isLocal ? 0.55 : 0.48, `SeatRollingCup-${player.id}`);
            } else {
                this.drawDiceRow(seatRoot, player.dice, player.isLocal ? 42 : 0, player.isLocal ? -43 : -30, player.isLocal ? 50 : 28, `SeatDiceRow-${player.id}`);
            }
        } else {
            this.drawCup(seatRoot, 0, -32, 0.48, `SeatCup-${player.id}`);
        }
    }

    private drawControls(parent: Node, state: RoomState): void {
        const local = state.players.find((player) => player.isLocal);
        if (!local) {
            return;
        }
        if (state.phase === 'lobby') {
            this.button(parent, 'ReadyButton', local.isReady ? '已准备' : '准备', -115, -570, 190, 62, () => void this.service.ready(local.id), local.isReady);
            this.button(parent, 'MockJoinButton', '模拟加入', 115, -570, 190, 62, () => this.toast('本地默认已加入 4 人房'));
            return;
        }
        if (state.phase === 'rolling') {
            this.button(parent, 'RollButton', this.isRollingLocal ? '摇骰中' : local.hasRolled ? '已摇骰' : '摇骰', 0, -570, 230, 62, () => this.rollLocalWithAnimation(local.id), local.hasRolled || this.isRollingLocal);
            return;
        }
        if (state.phase === 'bidding') {
            const isMyTurn = state.currentTurnPlayerId === local.id;
            this.drawBidPicker(parent, isMyTurn);
            this.button(parent, 'BidActionButton', '叫牌', -120, -570, 190, 62, () => void this.service.bid(local.id, this.selectedQuantity, this.selectedFace), !isMyTurn);
            this.button(parent, 'OpenActionButton', '开', 120, -570, 190, 62, () => void this.service.open(local.id), !isMyTurn || !state.lastBid);
            return;
        }
        if (state.phase === 'settlement') {
            this.button(parent, 'RestartButton', '再来一局', 0, -570, 240, 62, () => void this.service.restart());
        }
    }

    private drawRollingCenter(parent: Node, state: RoomState): void {
        if (state.phase !== 'rolling') {
            return;
        }
        const local = state.players.find((player) => player.isLocal);
        if (!local) {
            return;
        }
        const center = this.createNode('RollingCenterArea', parent, 0, 80, 560, 360);
        this.text(center, 'RollingCenterTitleText', local.hasRolled ? '上拖骰盅查看自己的牌' : '摇完后上拖骰盅看牌', 0, 152, 28, new Color(255, 230, 178, 255), 500);
        this.drawDiceTray(center, 0, -38, 1.1);
        this.drawDiceRow(center, local.dice, 0, -25, 62, 'CenterDiceRow');
        const coverY = -2 + this.localCupOffsetY;
        const cup = this.drawCup(center, 0, coverY, 1.75, `CenterRollingCup-${local.id}`);
        this.bindCupDrag(cup);
        this.text(center, 'CupDragHintText', '上拖看牌 · 下拖盖住', 0, -146, 22, new Color(218, 201, 168, 255), 500);
    }

    private drawBidPicker(parent: Node, enabled: boolean): void {
        this.panel(parent, 'BidPicker', 0, -470, 540, 76, new Color(28, 24, 24, 230), new Color(154, 112, 66, 255));
        this.button(parent, 'QuantityMinusButton', '-', -220, -470, 52, 52, () => this.changeQuantity(-1), !enabled);
        this.text(parent, 'SelectedQuantityText', `${this.selectedQuantity} 个`, -142, -477, 27, new Color(255, 233, 190, 255), 94);
        this.button(parent, 'QuantityPlusButton', '+', -62, -470, 52, 52, () => this.changeQuantity(1), !enabled);
        this.button(parent, 'FaceMinusButton', '-', 62, -470, 52, 52, () => this.changeFace(-1), !enabled);
        this.drawDie(parent, 136, -470, 40, this.selectedFace, !enabled, 'SelectedFaceDie');
        this.button(parent, 'FacePlusButton', '+', 220, -470, 52, 52, () => this.changeFace(1), !enabled);
    }

    private drawSettlement(parent: Node, state: RoomState): void {
        const settlement = state.settlement!;
        this.panel(parent, 'Settlement', 0, 35, 620, 560, new Color(22, 18, 18, 248), new Color(238, 190, 98, 255));
        this.text(parent, 'SettlementTitleText', '开牌结算', 0, 280, 40, new Color(255, 228, 162, 255), 560);
        this.text(parent, 'SettlementLastBidText', `上一手：${this.playerName(state, settlement.lastBid.playerId)} 叫 ${settlement.lastBid.quantity} 个`, -36, 226, 27, new Color(245, 219, 174, 255), 450);
        this.drawDie(parent, 225, 226, 40, settlement.lastBid.face, false, 'SettlementLastBidDie');
        this.text(parent, 'SettlementCountText', `实际计数：${settlement.effectiveCount}  /  ${settlement.bidSucceeded ? '叫牌成立' : '叫牌失败'}`, 0, 182, 27, new Color(245, 219, 174, 255), 560);
        this.text(parent, 'SettlementLoserText', `输家：${this.playerName(state, settlement.loserId)}`, 0, 140, 32, new Color(255, 116, 96, 255), 560);
        for (let face = 1; face <= 6; face += 1) {
            const col = (face - 1) % 3;
            const row = Math.floor((face - 1) / 3);
            const faceValue = face as DiceFace;
            const itemX = -205 + col * 205;
            const itemY = 72 - row * 70;
            this.drawDie(parent, itemX - 34, itemY, 38, faceValue, false, `SettlementFace${faceValue}Die`);
            this.text(parent, `SettlementFace${faceValue}CountText`, `x ${settlement.totals[faceValue]}`, itemX + 34, itemY - 4, 25, new Color(255, 240, 206, 255), 82);
        }
        this.text(parent, 'SettlementPlayersTitleText', '玩家骰面', 0, -80, 24, new Color(230, 205, 155, 255), 540);
        state.players.forEach((player, index) => {
            const y = -120 - index * 42;
            this.drawAvatar(parent, player, -250, y, 26);
            this.text(parent, `SettlementPlayer${player.seatIndex}NameText`, player.name, -198, y - 4, 20, new Color(255, 233, 190, 255), 82);
            this.drawDiceRow(parent, player.dice, 20, y, 30, `SettlementDiceRow-${player.id}`);
        });
    }

    private changeQuantity(delta: number): void {
        const maxDice = (this.state?.players.length || 4) * DICE_PER_PLAYER;
        this.selectedQuantity = Math.max(1, Math.min(maxDice, this.selectedQuantity + delta));
        this.render();
    }

    private changeFace(delta: number): void {
        const next = this.selectedFace + delta;
        this.selectedFace = (next < 1 ? 6 : next > 6 ? 1 : next) as DiceFace;
        this.render();
    }

    private drawDiceRow(parent: Node, dice: DiceFace[], x: number, y: number, size: number, name = 'DiceRow'): void {
        const row = this.createNode(name, parent, x, y, size * 6, size);
        const shown = dice.length ? dice : [1, 2, 3, 4, 5] as DiceFace[];
        const gap = size + 8;
        const start = -((shown.length - 1) * gap) / 2;
        shown.forEach((face, index) => {
            this.drawDie(row, start + index * gap, 0, size, face, dice.length === 0, `DieSlot${index + 1}`);
        });
    }

    private drawDie(parent: Node, x: number, y: number, size: number, face: DiceFace, muted: boolean, name = `DieFace${face}`): void {
        const node = this.createNode(name, parent, x, y, size, size);
        const graphics = this.graphics(node);
        graphics.clear();
        graphics.fillColor = muted ? new Color(160, 145, 124, 255) : new Color(255, 248, 228, 255);
        graphics.roundRect(-size / 2, -size / 2, size, size, size * 0.16);
        graphics.fill();
        graphics.strokeColor = new Color(105, 54, 42, 255);
        graphics.lineWidth = Math.max(2, size * 0.04);
        graphics.roundRect(-size / 2, -size / 2, size, size, size * 0.16);
        graphics.stroke();
        const pip = muted ? new Color(103, 84, 70, 255) : new Color(132, 19, 25, 255);
        const spots = this.pipPositions(face, size * 0.24);
        graphics.fillColor = pip;
        spots.forEach((spot) => {
            graphics.circle(spot.x, spot.y, size * 0.055);
            graphics.fill();
        });
    }

    private drawDiceTray(parent: Node, x: number, y: number, scale: number): Node {
        const node = this.createNode('DiceTray', parent, x, y, 390 * scale, 150 * scale);
        const graphics = this.graphics(node);
        graphics.clear();
        graphics.fillColor = new Color(72, 36, 23, 255);
        graphics.ellipse(0, -8 * scale, 180 * scale, 58 * scale);
        graphics.fill();
        graphics.fillColor = new Color(36, 108, 73, 255);
        graphics.ellipse(0, 2 * scale, 152 * scale, 45 * scale);
        graphics.fill();
        graphics.strokeColor = new Color(229, 179, 82, 255);
        graphics.lineWidth = 5 * scale;
        graphics.ellipse(0, 2 * scale, 152 * scale, 45 * scale);
        graphics.stroke();
        graphics.fillColor = new Color(25, 55, 43, 170);
        graphics.ellipse(0, -6 * scale, 122 * scale, 24 * scale);
        graphics.fill();
        return node;
    }

    private pipPositions(face: DiceFace, offset: number): { x: number; y: number }[] {
        const map: Record<DiceFace, { x: number; y: number }[]> = {
            1: [{ x: 0, y: 0 }],
            2: [{ x: -offset, y: offset }, { x: offset, y: -offset }],
            3: [{ x: -offset, y: offset }, { x: 0, y: 0 }, { x: offset, y: -offset }],
            4: [{ x: -offset, y: offset }, { x: offset, y: offset }, { x: -offset, y: -offset }, { x: offset, y: -offset }],
            5: [{ x: -offset, y: offset }, { x: offset, y: offset }, { x: 0, y: 0 }, { x: -offset, y: -offset }, { x: offset, y: -offset }],
            6: [{ x: -offset, y: offset }, { x: offset, y: offset }, { x: -offset, y: 0 }, { x: offset, y: 0 }, { x: -offset, y: -offset }, { x: offset, y: -offset }],
        };
        return map[face];
    }

    private drawCup(parent: Node, x: number, y: number, scale: number, name = 'Cup'): Node {
        const node = this.createNode(name, parent, x, y, 150 * scale, 150 * scale);
        const graphics = this.graphics(node);
        graphics.clear();
        graphics.fillColor = new Color(74, 12, 20, 255);
        graphics.moveTo(-58 * scale, -52 * scale);
        graphics.lineTo(58 * scale, -52 * scale);
        graphics.lineTo(44 * scale, 46 * scale);
        graphics.lineTo(-44 * scale, 46 * scale);
        graphics.close();
        graphics.fill();
        graphics.fillColor = new Color(130, 24, 31, 255);
        graphics.moveTo(-43 * scale, -42 * scale);
        graphics.lineTo(43 * scale, -42 * scale);
        graphics.lineTo(34 * scale, 34 * scale);
        graphics.lineTo(-34 * scale, 34 * scale);
        graphics.close();
        graphics.fill();
        graphics.fillColor = new Color(172, 43, 38, 255);
        graphics.ellipse(0, 48 * scale, 50 * scale, 15 * scale);
        graphics.fill();
        graphics.strokeColor = new Color(229, 179, 82, 255);
        graphics.lineWidth = 4 * scale;
        graphics.ellipse(0, 48 * scale, 50 * scale, 15 * scale);
        graphics.stroke();
        graphics.strokeColor = new Color(229, 179, 82, 230);
        graphics.lineWidth = 3 * scale;
        graphics.moveTo(-49 * scale, -28 * scale);
        graphics.lineTo(49 * scale, -28 * scale);
        graphics.stroke();
        graphics.fillColor = new Color(35, 10, 13, 120);
        graphics.ellipse(0, -53 * scale, 58 * scale, 12 * scale);
        graphics.fill();
        return node;
    }

    private drawAvatar(parent: Node, player: PlayerState, x: number, y: number, size: number): void {
        const node = this.createNode(`Avatar-${player.id}`, parent, x, y, size, size);
        const graphics = this.graphics(node);
        graphics.clear();
        const avatarColors = [
            new Color(242, 178, 83, 255),
            new Color(91, 165, 195, 255),
            new Color(139, 197, 108, 255),
            new Color(191, 112, 202, 255),
            new Color(229, 111, 97, 255),
            new Color(114, 132, 219, 255),
        ];
        graphics.fillColor = avatarColors[player.seatIndex % avatarColors.length];
        graphics.circle(0, 0, size / 2);
        graphics.fill();
        graphics.strokeColor = player.isLocal ? new Color(255, 235, 165, 255) : new Color(92, 52, 43, 255);
        graphics.lineWidth = Math.max(2, size * 0.08);
        graphics.circle(0, 0, size / 2);
        graphics.stroke();
        graphics.fillColor = new Color(76, 38, 36, 255);
        graphics.circle(0, size * 0.12, size * 0.15);
        graphics.fill();
        graphics.roundRect(-size * 0.24, -size * 0.26, size * 0.48, size * 0.28, size * 0.12);
        graphics.fill();
    }

    private button(parent: Node, name: string, label: string, x: number, y: number, width: number, height: number, onClick: () => void, disabled = false): Node {
        const node = this.panel(parent, name, x, y, width, height, disabled ? new Color(82, 75, 70, 230) : new Color(156, 35, 31, 245), new Color(234, 184, 94, 255));
        const button = node.getComponent(Button);
        if (!button) {
            throw new Error(`${node.name} is missing Button. Run npm run generate:scene first.`);
        }
        if (!this.buttonHandlers.has(node.name)) {
            node.on(Node.EventType.TOUCH_END, (_event: EventTouch) => {
                const handler = this.buttonHandlers.get(node.name);
                if (handler) {
                    handler();
                }
            }, this);
        }
        button.interactable = !disabled;
        this.buttonHandlers.set(node.name, () => {
            if (!disabled) {
                onClick();
            }
        });
        this.text(node, 'ButtonLabelText', label, 0, -4, Math.min(30, height * 0.42), disabled ? new Color(186, 176, 162, 255) : new Color(255, 235, 188, 255), width - 16);
        return node;
    }

    private panel(parent: Node, name: string, x: number, y: number, width: number, height: number, fill: Color, stroke: Color): Node {
        const node = this.createNode(name, parent, x, y, width, height);
        const graphics = this.graphics(node);
        graphics.clear();
        graphics.fillColor = fill;
        graphics.roundRect(-width / 2, -height / 2, width, height, 16);
        graphics.fill();
        graphics.strokeColor = stroke;
        graphics.lineWidth = 3;
        graphics.roundRect(-width / 2, -height / 2, width, height, 16);
        graphics.stroke();
        return node;
    }

    private text(parent: Node, name: string, value: string, x: number, y: number, fontSize: number, color: Color, width: number): Node {
        const node = this.createNode(name, parent, x, y, width, fontSize + 16);
        const label = node.getComponent(Label);
        if (!label) {
            throw new Error(`${node.name} is missing Label. Run npm run generate:scene first.`);
        }
        label.string = value;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 7;
        label.color = color;
        label.horizontalAlign = 1;
        label.verticalAlign = 1;
        label.overflow = 3;
        return node;
    }

    private createNode(name: string, parent: Node, x: number, y: number, width: number, height: number): Node {
        const key = this.nodeKey(parent, name, x, y, width, height);
        const safeName = this.safeNodeName(name);
        let node = this.nodeCache.get(key);
        if (!node) {
            node = parent.getChildByName(safeName);
            if (!node) {
                throw new Error(`Scene node "${safeName}" under "${parent.name}" is missing. Run npm run generate:scene first.`);
            }
            this.nodeCache.set(key, node);
        }
        this.activeNodeKeys.add(key);
        node.active = true;
        if (node.parent !== parent) {
            node.parent = parent;
        }
        node.setPosition(new Vec3(x, y, 0));
        node.layer = parent.layer;
        const transform = node.getComponent(UITransform);
        if (!transform) {
            throw new Error(`${node.name} is missing UITransform. Run npm run generate:scene first.`);
        }
        transform.setContentSize(width, height);
        return node;
    }

    private cacheSceneNodes(parent: Node): void {
        parent.children.forEach((child) => {
            this.nodeCache.set(this.nodeKey(parent, child.name, 0, 0, 0, 0), child);
            this.cacheSceneNodes(child);
        });
    }

    private requireChild(parent: Node, name: string): Node {
        const safeName = this.safeNodeName(name);
        const child = parent.getChildByName(safeName);
        if (!child) {
            throw new Error(`Scene node "${safeName}" under "${parent.name}" is missing. Run npm run generate:scene first.`);
        }
        return child;
    }

    private hideUnusedNodes(): void {
        this.nodeCache.forEach((node, key) => {
            if (node !== this.content && !this.activeNodeKeys.has(key)) {
                this.stopNodeAnimation(node);
                node.active = false;
            }
        });
    }

    private graphics(node: Node): Graphics {
        const graphics = node.getComponent(Graphics);
        if (!graphics) {
            throw new Error(`${node.name} is missing Graphics. Run npm run generate:scene first.`);
        }
        return graphics;
    }

    private syncRollingAnimations(state: RoomState): void {
        const activeRollingIds = new Set<string>();
        if (state.phase === 'rolling') {
            state.players.forEach((player) => {
                if (player.isLocal && !player.hasRolled) {
                    activeRollingIds.add(player.id);
                    const node = this.findNodeBySafeName(`CenterRollingCup-${player.id}`);
                    if (node && !this.rollingAnimationIds.has(player.id) && this.localCupOffsetY === 0 && !this.isDraggingCup && !this.isRollingLocal) {
                        this.startIdleShake(node);
                        this.rollingAnimationIds.add(player.id);
                    }
                }
            });
        }
        this.rollingAnimationIds.forEach((playerId) => {
            if (!activeRollingIds.has(playerId)) {
                const node = this.findNodeBySafeName(`CenterRollingCup-${playerId}`);
                if (node) {
                    this.stopNodeAnimation(node);
                }
                this.rollingAnimationIds.delete(playerId);
            }
        });
    }

    private rollLocalWithAnimation(playerId: string): void {
        if (this.isRollingLocal) {
            return;
        }
        this.localCupOffsetY = 0;
        this.render();
        const node = this.findNodeBySafeName(`CenterRollingCup-${playerId}`);
        if (!node) {
            void this.service.roll(playerId);
            return;
        }
        this.isRollingLocal = true;
        this.render();
        this.playStrongShake(node, () => {
            this.isRollingLocal = false;
            void this.service.roll(playerId);
        });
    }

    private startIdleShake(node: Node): void {
        this.stopNodeAnimation(node);
        const basePosition = node.position.clone();
        node.setPosition(basePosition);
        node.angle = 0;
        tween(node)
            .repeatForever(
                tween<Node>()
                    .to(0.12, { position: new Vec3(basePosition.x - 5, basePosition.y + 2, 0), angle: -5 })
                    .to(0.12, { position: new Vec3(basePosition.x + 5, basePosition.y - 2, 0), angle: 5 })
                    .to(0.12, { position: basePosition, angle: 0 }),
            )
            .start();
    }

    private playStrongShake(node: Node, onComplete: () => void): void {
        this.stopNodeAnimation(node);
        const basePosition = node.position.clone();
        node.angle = 0;
        tween(node)
            .to(0.07, { position: new Vec3(basePosition.x - 18, basePosition.y + 8, 0), angle: -14 })
            .to(0.07, { position: new Vec3(basePosition.x + 18, basePosition.y - 6, 0), angle: 14 })
            .to(0.06, { position: new Vec3(basePosition.x - 14, basePosition.y - 8, 0), angle: -12 })
            .to(0.06, { position: new Vec3(basePosition.x + 14, basePosition.y + 6, 0), angle: 12 })
            .to(0.06, { position: new Vec3(basePosition.x - 10, basePosition.y + 4, 0), angle: -8 })
            .to(0.06, { position: new Vec3(basePosition.x + 10, basePosition.y - 4, 0), angle: 8 })
            .to(0.08, { position: basePosition, angle: 0 })
            .call(onComplete)
            .start();
    }

    private bindCupDrag(node: Node): void {
        if (this.dragBoundNodes.has(node.name)) {
            return;
        }
        this.dragBoundNodes.add(node.name);
        node.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
            this.isDraggingCup = true;
            this.stopNodeAnimation(node);
            this.rollingAnimationIds.clear();
            this.cupDragStartY = event.getUILocation().y - this.localCupOffsetY;
        }, this);
        node.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
            const nextOffset = event.getUILocation().y - this.cupDragStartY;
            this.localCupOffsetY = Math.max(0, Math.min(145, nextOffset));
            this.render();
        }, this);
        node.on(Node.EventType.TOUCH_END, () => {
            this.isDraggingCup = false;
            this.localCupOffsetY = this.localCupOffsetY > 72 ? 128 : 0;
            this.render();
        }, this);
        node.on(Node.EventType.TOUCH_CANCEL, () => {
            this.isDraggingCup = false;
            this.localCupOffsetY = this.localCupOffsetY > 72 ? 128 : 0;
            this.render();
        }, this);
    }

    private stopNodeAnimation(node: Node): void {
        Tween.stopAllByTarget(node);
        node.angle = 0;
    }

    private findNodeBySafeName(name: string): Node | null {
        const safeName = this.safeNodeName(name);
        for (const node of this.nodeCache.values()) {
            if (node.name === safeName && node.active) {
                return node;
            }
        }
        return null;
    }

    private nodeKey(parent: Node, name: string, _x: number, _y: number, _width: number, _height: number): string {
        return `${parent.uuid}/${this.safeNodeName(name)}`;
    }

    private safeNodeName(name: string): string {
        return name.replace(/[^A-Za-z0-9_-]/g, '') || 'Node';
    }

    private playerStatus(state: RoomState, player: PlayerState): string {
        if (state.phase === 'lobby') {
            return player.isReady ? '已准备' : '未准备';
        }
        if (state.phase === 'rolling') {
            return player.hasRolled ? '已摇骰' : '等待摇骰';
        }
        if (state.phase === 'bidding') {
            return state.currentTurnPlayerId === player.id ? '正在行动' : '等待';
        }
        return state.settlement?.loserId === player.id ? '本局输家' : '已开牌';
    }

    private phaseLabel(state: RoomState): string {
        const labels: Record<string, string> = {
            lobby: '准备阶段',
            rolling: '摇骰阶段',
            bidding: '叫牌阶段',
            settlement: '结算阶段',
        };
        return labels[state.phase] || state.phase;
    }

    private playerName(state: RoomState, playerId: string): string {
        return state.players.find((player) => player.id === playerId)?.name || playerId;
    }

    private toast(message: string): void {
        if (this.state) {
            this.state.message = message;
            this.render();
        }
    }
}
