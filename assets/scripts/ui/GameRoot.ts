import {
    _decorator,
    Button,
    Canvas,
    Color,
    Component,
    Graphics,
    Label,
    Node,
    UITransform,
    EventTouch,
    Vec3,
    Widget,
} from 'cc';
import { DiceFace, PlayerState, RoomService, RoomState } from '../model/GameTypes';
import { DICE_PER_PLAYER } from '../model/GameRules';
import { LocalRoomService } from '../services/LocalRoomService';

const { ccclass } = _decorator;

const DESIGN_WIDTH = 720;
const DESIGN_HEIGHT = 1280;

@ccclass('GameRoot')
export class GameRoot extends Component {
    private service: RoomService = new LocalRoomService();
    private state: RoomState | null = null;
    private content: Node | null = null;
    private selectedQuantity = 1;
    private selectedFace: DiceFace = 2;
    private nodeSerial = 0;

    async start(): Promise<void> {
        this.setupCanvas();
        this.content = this.createNode('RuntimeUI', this.node, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        this.service.subscribe((state) => {
            this.state = state;
            this.syncSelection();
            this.render();
        });
        await this.service.createRoom('我');
    }

    private setupCanvas(): void {
        if (!this.node.getComponent(UITransform)) {
            this.node.addComponent(UITransform);
        }
        this.node.getComponent(UITransform)!.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
        const canvas = this.node.getComponent(Canvas) || this.node.addComponent(Canvas);
        canvas.alignCanvasWithScreen = true;
        let widget = this.node.getComponent(Widget);
        if (!widget) {
            widget = this.node.addComponent(Widget);
        }
        widget.isAlignTop = true;
        widget.isAlignBottom = true;
        widget.isAlignLeft = true;
        widget.isAlignRight = true;
        widget.top = 0;
        widget.bottom = 0;
        widget.left = 0;
        widget.right = 0;
        widget.alignMode = Widget.AlignMode.ALWAYS;
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

    private render(): void {
        if (!this.content || !this.state) {
            return;
        }
        this.nodeSerial = 0;
        this.content.removeAllChildren();
        this.drawBackground(this.content);
        this.drawTopBar(this.content, this.state);
        this.drawTable(this.content, this.state);
        this.drawPlayers(this.content, this.state);
        this.drawControls(this.content, this.state);
        if (this.state.settlement) {
            this.drawSettlement(this.content, this.state);
        }
    }

    private drawBackground(parent: Node): void {
        const bg = this.createNode('Background', parent, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        const graphics = bg.addComponent(Graphics);
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

    private drawTopBar(parent: Node, state: RoomState): void {
        this.panel(parent, 'TopBar', 0, 570, 660, 110, new Color(42, 20, 20, 235), new Color(202, 154, 74, 255));
        this.text(parent, `房间 ${state.roomId}`, -190, 596, 32, new Color(255, 230, 178, 255), 260);
        this.text(parent, this.phaseLabel(state), -185, 556, 24, new Color(245, 206, 135, 255), 300);
        this.button(parent, '分享', 180, 590, 120, 52, () => {
            const payload = this.service.getSharePayload();
            this.toast(`分享：${payload.title}`);
        });
        this.text(parent, state.message, 0, 508, 24, new Color(255, 238, 203, 255), 640);
    }

    private drawTable(parent: Node, state: RoomState): void {
        const table = this.createNode('Table', parent, 0, 120, 590, 480);
        const graphics = table.addComponent(Graphics);
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
        this.text(parent, lastBid, 0, 165, 34, new Color(255, 237, 184, 255), 480);
        this.text(parent, state.onesAreWild ? '规则：1 当前为万能点' : '规则：1 已关闭万能', 0, 112, 24, new Color(219, 242, 209, 255), 420);
        this.drawBidHistory(parent, state);
    }

    private drawBidHistory(parent: Node, state: RoomState): void {
        const history = state.bidHistory.slice(-4).map((bid) => `${this.playerName(state, bid.playerId)} ${bid.quantity}个${bid.face}`).join('  /  ');
        this.text(parent, history || '叫牌记录会显示在这里', 0, -105, 22, new Color(234, 215, 168, 255), 560);
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
        const isTurn = state.currentTurnPlayerId === player.id;
        const panelColor = isTurn ? new Color(119, 52, 30, 245) : new Color(42, 24, 24, 220);
        const seatWidth = player.isLocal ? 630 : 190;
        const seatHeight = player.isLocal ? 178 : 132;
        this.panel(parent, `Seat-${player.id}`, x, y, seatWidth, seatHeight, panelColor, isTurn ? new Color(255, 214, 98, 255) : new Color(151, 111, 71, 255));
        this.drawAvatar(parent, player, x - seatWidth / 2 + (player.isLocal ? 58 : 34), y + (player.isLocal ? 38 : 25), player.isLocal ? 58 : 38);
        this.text(parent, `${player.name}${player.isHost ? ' 房主' : ''}`, x + (player.isLocal ? 42 : 18), y + (player.isLocal ? 55 : 42), player.isLocal ? 28 : 21, new Color(255, 233, 190, 255), player.isLocal ? 410 : 118);
        this.text(parent, this.playerStatus(state, player), x + (player.isLocal ? 42 : 18), y + (player.isLocal ? 22 : 13), player.isLocal ? 22 : 18, new Color(230, 205, 155, 255), player.isLocal ? 410 : 118);

        if (player.isLocal || state.phase === 'settlement') {
            this.drawDiceRow(parent, player.dice, x + (player.isLocal ? 42 : 0), y - (player.isLocal ? 43 : 30), player.isLocal ? 50 : 28);
        } else {
            this.drawCup(parent, x, y - 32, 0.48);
        }
    }

    private drawControls(parent: Node, state: RoomState): void {
        const local = state.players.find((player) => player.isLocal);
        if (!local) {
            return;
        }
        if (state.phase === 'lobby') {
            this.button(parent, local.isReady ? '已准备' : '准备', -115, -570, 190, 62, () => void this.service.ready(local.id), local.isReady);
            this.button(parent, '模拟加入', 115, -570, 190, 62, () => this.toast('本地默认已加入 4 人房'));
            return;
        }
        if (state.phase === 'rolling') {
            this.button(parent, local.hasRolled ? '已摇骰' : '摇骰', 0, -570, 230, 62, () => void this.service.roll(local.id), local.hasRolled);
            return;
        }
        if (state.phase === 'bidding') {
            const isMyTurn = state.currentTurnPlayerId === local.id;
            this.drawBidPicker(parent, isMyTurn);
            this.button(parent, '叫牌', -120, -570, 190, 62, () => void this.service.bid(local.id, this.selectedQuantity, this.selectedFace), !isMyTurn);
            this.button(parent, '开', 120, -570, 190, 62, () => void this.service.open(local.id), !isMyTurn || !state.lastBid);
            return;
        }
        if (state.phase === 'settlement') {
            this.button(parent, '再来一局', 0, -570, 240, 62, () => void this.service.restart());
        }
    }

    private drawBidPicker(parent: Node, enabled: boolean): void {
        this.panel(parent, 'BidPicker', 0, -470, 540, 76, new Color(28, 24, 24, 230), new Color(154, 112, 66, 255));
        this.button(parent, '-', -220, -470, 52, 52, () => this.changeQuantity(-1), !enabled);
        this.text(parent, `${this.selectedQuantity} 个`, -142, -477, 27, new Color(255, 233, 190, 255), 94);
        this.button(parent, '+', -62, -470, 52, 52, () => this.changeQuantity(1), !enabled);
        this.button(parent, '-', 62, -470, 52, 52, () => this.changeFace(-1), !enabled);
        this.drawDie(parent, 136, -470, 40, this.selectedFace, !enabled);
        this.button(parent, '+', 220, -470, 52, 52, () => this.changeFace(1), !enabled);
    }

    private drawSettlement(parent: Node, state: RoomState): void {
        const settlement = state.settlement!;
        this.panel(parent, 'Settlement', 0, 35, 620, 560, new Color(22, 18, 18, 248), new Color(238, 190, 98, 255));
        this.text(parent, '开牌结算', 0, 280, 40, new Color(255, 228, 162, 255), 560);
        this.text(parent, `上一手：${this.playerName(state, settlement.lastBid.playerId)} 叫 ${settlement.lastBid.quantity} 个`, -36, 226, 27, new Color(245, 219, 174, 255), 450);
        this.drawDie(parent, 225, 226, 40, settlement.lastBid.face, false);
        this.text(parent, `实际计数：${settlement.effectiveCount}  /  ${settlement.bidSucceeded ? '叫牌成立' : '叫牌失败'}`, 0, 182, 27, new Color(245, 219, 174, 255), 560);
        this.text(parent, `输家：${this.playerName(state, settlement.loserId)}`, 0, 140, 32, new Color(255, 116, 96, 255), 560);
        for (let face = 1; face <= 6; face += 1) {
            const col = (face - 1) % 3;
            const row = Math.floor((face - 1) / 3);
            const faceValue = face as DiceFace;
            const itemX = -205 + col * 205;
            const itemY = 72 - row * 70;
            this.drawDie(parent, itemX - 34, itemY, 38, faceValue, false);
            this.text(parent, `x ${settlement.totals[faceValue]}`, itemX + 34, itemY - 4, 25, new Color(255, 240, 206, 255), 82);
        }
        this.text(parent, '玩家骰面', 0, -80, 24, new Color(230, 205, 155, 255), 540);
        state.players.forEach((player, index) => {
            const y = -120 - index * 42;
            this.drawAvatar(parent, player, -250, y, 26);
            this.text(parent, player.name, -198, y - 4, 20, new Color(255, 233, 190, 255), 82);
            this.drawDiceRow(parent, player.dice, 20, y, 30);
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

    private drawDiceRow(parent: Node, dice: DiceFace[], x: number, y: number, size: number): void {
        const shown = dice.length ? dice : [1, 2, 3, 4, 5] as DiceFace[];
        const gap = size + 8;
        const start = x - ((shown.length - 1) * gap) / 2;
        shown.forEach((face, index) => {
            this.drawDie(parent, start + index * gap, y, size, face, dice.length === 0);
        });
    }

    private drawDie(parent: Node, x: number, y: number, size: number, face: DiceFace, muted: boolean): void {
        const node = this.createNode(`Die-${face}`, parent, x, y, size, size);
        const graphics = node.addComponent(Graphics);
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

    private drawCup(parent: Node, x: number, y: number, scale: number): void {
        const node = this.createNode('Cup', parent, x, y, 120 * scale, 120 * scale);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = new Color(101, 18, 25, 255);
        graphics.roundRect(-48 * scale, -45 * scale, 96 * scale, 90 * scale, 16 * scale);
        graphics.fill();
        graphics.fillColor = new Color(151, 38, 35, 255);
        graphics.ellipse(0, 42 * scale, 52 * scale, 15 * scale);
        graphics.fill();
        graphics.strokeColor = new Color(229, 179, 82, 255);
        graphics.lineWidth = 5 * scale;
        graphics.ellipse(0, 42 * scale, 52 * scale, 15 * scale);
        graphics.stroke();
    }

    private drawAvatar(parent: Node, player: PlayerState, x: number, y: number, size: number): void {
        const node = this.createNode(`Avatar-${player.id}`, parent, x, y, size, size);
        const graphics = node.addComponent(Graphics);
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

    private button(parent: Node, label: string, x: number, y: number, width: number, height: number, onClick: () => void, disabled = false): Node {
        const node = this.panel(parent, `Button-${this.nodeSerial}`, x, y, width, height, disabled ? new Color(82, 75, 70, 230) : new Color(156, 35, 31, 245), new Color(234, 184, 94, 255));
        const button = node.addComponent(Button);
        button.interactable = !disabled;
        node.on(Node.EventType.TOUCH_END, (_event: EventTouch) => {
            if (!disabled) {
                onClick();
            }
        }, this);
        this.text(node, label, 0, -4, Math.min(30, height * 0.42), disabled ? new Color(186, 176, 162, 255) : new Color(255, 235, 188, 255), width - 16);
        return node;
    }

    private panel(parent: Node, name: string, x: number, y: number, width: number, height: number, fill: Color, stroke: Color): Node {
        const node = this.createNode(name, parent, x, y, width, height);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = fill;
        graphics.roundRect(-width / 2, -height / 2, width, height, 16);
        graphics.fill();
        graphics.strokeColor = stroke;
        graphics.lineWidth = 3;
        graphics.roundRect(-width / 2, -height / 2, width, height, 16);
        graphics.stroke();
        return node;
    }

    private text(parent: Node, value: string, x: number, y: number, fontSize: number, color: Color, width: number): Node {
        const node = this.createNode('Text', parent, x, y, width, fontSize + 16);
        const label = node.addComponent(Label);
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
        const node = new Node(this.nodeName(name));
        node.parent = parent;
        node.setPosition(new Vec3(x, y, 0));
        node.layer = parent.layer;
        const transform = node.addComponent(UITransform);
        transform.setContentSize(width, height);
        return node;
    }

    private nodeName(name: string): string {
        const safeName = name.replace(/[^A-Za-z0-9_-]/g, '');
        this.nodeSerial += 1;
        return `${safeName || 'Node'}-${this.nodeSerial}`;
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
