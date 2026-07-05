import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const scenePath = resolve(root, 'assets/main.scene');

const DESIGN_WIDTH = 720;
const DESIGN_HEIGHT = 1280;
const GAME_ROOT_CLASS = '58c463TKptLbYib78h7FIbk';
const UI_LAYER = 33554432;
const DEFAULT_LAYER = 1073741824;
const UI_WHITE_SPRITE = '16c65df7-ef2a-4899-98d9-698a78d732e1@f9941';
const TABLE_SPRITE = '65dfc2aa-1370-4788-96aa-14d588dbfbec@f9941';
const CUP_SPRITE = '507f07b4-2025-4b94-b1a6-92cc49ae20ec@f9941';

let seed = 1;
const objects = [];

const id = (prefix) => `${prefix}${String((seed += 1)).padStart(5, '0')}`;
const ref = (index) => ({ __id__: index });
const vec2 = (x, y) => ({ __type__: 'cc.Vec2', x, y });
const vec3 = (x, y, z = 0) => ({ __type__: 'cc.Vec3', x, y, z });
const quat = () => ({ __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 });
const size = (width, height) => ({ __type__: 'cc.Size', width, height });
const color = (r, g, b, a = 255) => ({ __type__: 'cc.Color', r, g, b, a });
const rect = (x, y, width, height) => ({ __type__: 'cc.Rect', x, y, width, height });

function add(object) {
  objects.push(object);
  return objects.length - 1;
}

function sceneNode() {
  return add({
    __type__: 'cc.Scene',
    _name: 'main',
    _objFlags: 0,
    __editorExtras__: {},
    _parent: null,
    _children: [],
    _active: true,
    _components: [],
    _prefab: null,
    _lpos: vec3(0, 0),
    _lrot: quat(),
    _lscale: vec3(1, 1, 1),
    _mobility: 0,
    _layer: DEFAULT_LAYER,
    _euler: vec3(0, 0),
    autoReleaseAssets: false,
    _globals: null,
    _id: '0a6a8848-3a1d-4c86-80d4-11f489dc641a',
  });
}

function component(type, nodeIndex, fields = {}) {
  return add({
    __type__: type,
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: ref(nodeIndex),
    _enabled: true,
    __prefab: null,
    ...fields,
    _id: id(type.replace(/\W/g, '').toLowerCase()),
  });
}

function node(name, parentIndex, x, y, width, height, componentFactories = []) {
  const index = add({
    __type__: 'cc.Node',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _parent: parentIndex === null ? null : ref(parentIndex),
    _children: [],
    _active: true,
    _components: [],
    _prefab: null,
    _lpos: vec3(x, y),
    _lrot: quat(),
    _lscale: vec3(1, 1, 1),
    _mobility: 0,
    _layer: UI_LAYER,
    _euler: vec3(0, 0),
    _id: id('node'),
  });
  if (parentIndex !== null) {
    objects[parentIndex]._children.push(ref(index));
  }
  objects[index]._components.push(ref(uiTransform(index, width, height)));
  componentFactories.forEach((factory) => objects[index]._components.push(ref(factory(index))));
  return index;
}

function uiTransform(nodeIndex, width, height) {
  return component('cc.UITransform', nodeIndex, {
    _contentSize: size(width, height),
    _anchorPoint: vec2(0.5, 0.5),
  });
}

function graphics(nodeIndex) {
  return component('cc.Graphics', nodeIndex, {
    _visFlags: 0,
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: color(255, 255, 255),
    _lineWidth: 1,
    _strokeColor: color(0, 0, 0),
    _lineJoin: 2,
    _lineCap: 0,
    _fillColor: color(255, 255, 255),
    _miterLimit: 10,
  });
}

function sprite(nodeIndex, spriteFrameUuid = UI_WHITE_SPRITE, tint = color(255, 255, 255), type = 0) {
  return component('cc.Sprite', nodeIndex, {
    _visFlags: 0,
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: tint,
    _spriteFrame: {
      __uuid__: spriteFrameUuid,
      __expectedType__: 'cc.SpriteFrame',
    },
    _type: type,
    _fillType: 0,
    _sizeMode: 0,
    _fillCenter: vec2(0, 0),
    _fillStart: 0,
    _fillRange: 0,
    _isTrimmedMode: true,
    _useGrayscale: false,
    _atlas: null,
  });
}

function label(nodeIndex, value = '', fontSize = 24, tint = color(255, 255, 255)) {
  return component('cc.Label', nodeIndex, {
    _visFlags: 0,
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: tint,
    _string: value,
    _horizontalAlign: 1,
    _verticalAlign: 1,
    _actualFontSize: fontSize,
    _fontSize: fontSize,
    _fontFamily: 'Arial',
    _lineHeight: fontSize + 7,
    _overflow: 3,
    _enableWrapText: true,
    _font: null,
    _isSystemFontUsed: true,
    _isItalic: false,
    _isBold: false,
    _isUnderline: false,
    _underlineHeight: 2,
    _cacheMode: 0,
  });
}

function button(nodeIndex) {
  return component('cc.Button', nodeIndex, {
    clickEvents: [],
    _interactable: true,
    _transition: 0,
    _normalColor: color(214, 214, 214),
    _hoverColor: color(211, 211, 211),
    _pressedColor: color(255, 255, 255),
    _disabledColor: color(124, 124, 124),
    _normalSprite: null,
    _hoverSprite: null,
    _pressedSprite: null,
    _disabledSprite: null,
    _duration: 0.1,
    _zoomScale: 1.2,
    _target: null,
  });
}

function mask(nodeIndex) {
  return component('cc.Mask', nodeIndex, {
    _materials: [],
    _visFlags: 0,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: color(255, 255, 255),
    _type: 0,
    _inverted: false,
    _segments: 64,
  });
}

function canvas(nodeIndex, cameraIndex) {
  return component('cc.Canvas', nodeIndex, {
    _cameraComponent: ref(cameraIndex),
    _alignCanvasWithScreen: true,
  });
}

function widget(nodeIndex) {
  return component('cc.Widget', nodeIndex, {
    _alignFlags: 45,
    _target: null,
    _left: 0,
    _right: 0,
    _top: 0,
    _bottom: 0,
    _horizontalCenter: 0,
    _verticalCenter: 0,
    _isAbsLeft: true,
    _isAbsRight: true,
    _isAbsTop: true,
    _isAbsBottom: true,
    _isAbsHorizontalCenter: true,
    _isAbsVerticalCenter: true,
    _originalWidth: 0,
    _originalHeight: 0,
    _alignMode: 2,
    _lockFlags: 0,
  });
}

function camera(nodeIndex) {
  return component('cc.Camera', nodeIndex, {
    _projection: 0,
    _priority: 0,
    _fov: 45,
    _fovAxis: 0,
    _orthoHeight: 640,
    _near: 0,
    _far: 2000,
    _color: color(0, 0, 0),
    _depth: 1,
    _stencil: 0,
    _clearFlags: 7,
    _rect: rect(0, 0, 1, 1),
    _aperture: 19,
    _shutter: 7,
    _iso: 0,
    _screenScale: 1,
    _visibility: 1108344832,
    _targetTexture: null,
    _postProcess: null,
    _usePostProcess: false,
    _cameraType: -1,
    _trackingType: 0,
  });
}

function gameRoot(nodeIndex) {
  return component(GAME_ROOT_CLASS, nodeIndex);
}

function text(parent, name, x, y, width, height = 48, value = '', fontSize = 24, tint = color(255, 255, 255)) {
  return node(name, parent, x, y, width, height, [(nodeIndex) => label(nodeIndex, value, fontSize, tint)]);
}

function image(parent, name, x, y, width, height, spriteFrameUuid, tint = color(255, 255, 255)) {
  return node(name, parent, x, y, width, height, [(nodeIndex) => sprite(nodeIndex, spriteFrameUuid, tint)]);
}

function panel(parent, name, x, y, width, height, tint = color(36, 24, 24, 230)) {
  const root = node(name, parent, x, y, width, height, [graphics]);
  image(root, 'EditorPreview', 0, 0, width, height, UI_WHITE_SPRITE, tint);
  return root;
}

function buttonNode(parent, name, x, y, width, height, labelText = '') {
  const root = node(name, parent, x, y, width, height, [graphics, button]);
  image(root, 'EditorPreview', 0, 0, width, height, UI_WHITE_SPRITE, color(255, 212, 48, 255));
  text(root, 'ButtonLabelText', 0, -4, width - 16, height, labelText, Math.min(30, height * 0.42), color(83, 45, 22, 255));
  return root;
}

function diceRow(parent, name, x, y, dieSize) {
  const row = node(name, parent, x, y, dieSize * 6, dieSize);
  const gap = dieSize + 8;
  const start = -((5 - 1) * gap) / 2;
  for (let i = 0; i < 5; i += 1) {
    panel(row, `DieSlot${i + 1}`, start + i * gap, 0, dieSize, dieSize);
  }
}

function cup(parent, name, x, y, scale) {
  return image(parent, name, x, y, 150 * scale, 150 * scale, CUP_SPRITE);
}

function avatar(parent, name, x, y, valueSize) {
  return panel(parent, name, x, y, valueSize, valueSize);
}

function playerSeatTemplate(parent) {
  const seat = node('PlayerSeatTemplate', parent, 0, -330, 630, 178);
  objects[seat]._active = false;
  panel(seat, 'SeatPanel', 0, 0, 630, 178);
  avatar(seat, 'Avatar', -257, 38, 58);
  text(seat, 'PlayerNameText', 42, 55, 410, 48);
  text(seat, 'PlayerStatusText', 42, 22, 410, 40);
  cup(seat, 'SeatRollingCup', 42, -43, 0.55);
  diceRow(seat, 'SeatDiceRow', 42, -43, 50);
  cup(seat, 'SeatCup', 0, -32, 0.48);
}

function appendPreservedGlobals(sceneIndex) {
  const previousScene = JSON.parse(readFileSync(scenePath, 'utf8'));
  const globalsIndex = previousScene.findIndex((item) => item.__type__ === 'cc.SceneGlobals');
  if (globalsIndex < 0) {
    objects[sceneIndex]._globals = null;
    return;
  }
  const firstGlobal = objects.length;
  const clonedGlobals = JSON.parse(JSON.stringify(previousScene.slice(globalsIndex)));
  const oldBase = typeof clonedGlobals[0]?.ambient?.__id__ === 'number' ? clonedGlobals[0].ambient.__id__ - 1 : globalsIndex;
  rewriteRefs(clonedGlobals, oldBase, firstGlobal);
  objects.push(...clonedGlobals);
  objects[sceneIndex]._globals = ref(firstGlobal);
}

function rewriteRefs(value, oldBase, newBase) {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(value, '__id__') && typeof value.__id__ === 'number') {
    value.__id__ = value.__id__ - oldBase + newBase;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => rewriteRefs(item, oldBase, newBase));
    return;
  }
  Object.values(value).forEach((item) => rewriteRefs(item, oldBase, newBase));
}

function buildScene() {
  const sceneAssetIndex = add({
    __type__: 'cc.SceneAsset',
    _name: 'main',
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    scene: null,
  });
  const sceneIndex = sceneNode();
  objects[sceneAssetIndex].scene = ref(sceneIndex);

  const canvasNode = node('Canvas', sceneIndex, 360, 640, DESIGN_WIDTH, DESIGN_HEIGHT);
  const cameraNode = node('Camera', canvasNode, 0, 0, 1, 1);
  objects[cameraNode]._layer = DEFAULT_LAYER;
  objects[cameraNode]._lpos = vec3(0, 0, 1000);
  const cameraComp = camera(cameraNode);
  objects[cameraNode]._components.push(ref(cameraComp));
  objects[canvasNode]._components.push(ref(canvas(canvasNode, cameraComp)));
  objects[canvasNode]._components.push(ref(widget(canvasNode)));
  objects[canvasNode]._components.push(ref(gameRoot(canvasNode)));

  const runtime = node('RuntimeUI', canvasNode, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  image(runtime, 'Background', 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, TABLE_SPRITE);

  panel(runtime, 'EntryModePanel', 0, 95, 620, 460, color(28, 21, 22, 238));
  text(runtime, 'EntryTitleText', 0, 260, 560, 68, '大话骰', 52, color(255, 228, 162));
  text(runtime, 'EntryHintText', 0, 198, 560, 44, '选择玩法后创建房间', 27, color(238, 211, 166));
  buttonNode(runtime, 'SingleModeButton', 0, 72, 360, 78, '单机模式');
  buttonNode(runtime, 'OnlineModeButton', 0, -42, 360, 78, '联网模式');
  text(runtime, 'OnlineReservedText', 0, -138, 540, 40, '联网模式已预留微信云开发接口，当前先走本地模拟', 22, color(218, 201, 168));

  panel(runtime, 'TopBar', 0, 570, 660, 110, color(42, 20, 20, 235));
  text(runtime, 'RoomIdText', -190, 596, 260, 48, '房间 ----', 32, color(255, 230, 178));
  text(runtime, 'PhaseText', -185, 556, 300, 40, '大厅 · 单机', 24, color(245, 206, 135));
  buttonNode(runtime, 'ShareButton', 180, 590, 120, 52, '分享');
  text(runtime, 'MessageText', 0, 508, 640, 42, '等待创建房间', 24, color(255, 238, 203));

  panel(runtime, 'Table', 0, 120, 590, 480, color(22, 18, 18, 30));
  text(runtime, 'LastBidText', 0, 165, 480, 56, '等待叫牌', 34, color(255, 237, 184));
  text(runtime, 'RuleText', 0, 112, 420, 42, '', 24, color(219, 242, 209));
  text(runtime, 'BidHistoryText', 0, -105, 560, 38, '叫牌记录会显示在这里', 22, color(234, 215, 168));

  playerSeatTemplate(runtime);

  buttonNode(runtime, 'ReadyButton', -115, -570, 190, 62, '准备');
  buttonNode(runtime, 'MockJoinButton', 115, -570, 190, 62, '模拟加入');
  buttonNode(runtime, 'RollButton', 0, -570, 230, 62, '摇骰');
  buttonNode(runtime, 'BidActionButton', -120, -570, 190, 62, '叫牌');
  buttonNode(runtime, 'OpenActionButton', 120, -570, 190, 62, '开');
  buttonNode(runtime, 'RestartButton', 0, -570, 240, 62, '再来一局');

  panel(runtime, 'BidPicker', 0, -470, 540, 76, color(28, 24, 24, 230));
  buttonNode(runtime, 'QuantityMinusButton', -220, -470, 52, 52, '-');
  text(runtime, 'SelectedQuantityText', -142, -477, 94, 43, '1 个', 27, color(255, 233, 190));
  buttonNode(runtime, 'QuantityPlusButton', -62, -470, 52, 52, '+');
  buttonNode(runtime, 'FaceMinusButton', 62, -470, 52, 52, '-');
  panel(runtime, 'SelectedFaceDie', 136, -470, 40, 40, color(255, 248, 228));
  buttonNode(runtime, 'FacePlusButton', 220, -470, 52, 52, '+');

  const rolling = node('RollingCenterArea', runtime, 0, 80, 560, 360);
  text(rolling, 'RollingCenterTitleText', 0, 152, 500, 44, '摇完后上拖骰盅看牌', 28, color(255, 230, 178));
  panel(rolling, 'DiceTray', 0, -38, 429, 165, color(72, 36, 23));
  diceRow(rolling, 'CenterDiceRow', 0, -25, 62);
  cup(rolling, 'CenterRollingCup-player-local', 0, -2, 1.75);
  text(rolling, 'CupDragHintText', 0, -146, 500, 40, '上拖看牌 · 下拖盖住', 22, color(218, 201, 168));

  panel(runtime, 'Settlement', 0, 35, 620, 560, color(22, 18, 18, 248));
  text(runtime, 'SettlementTitleText', 0, 280, 560, 60, '开牌结算', 40, color(255, 228, 162));
  text(runtime, 'SettlementLastBidText', -36, 226, 450, 44, '上一手：--', 27, color(245, 219, 174));
  panel(runtime, 'SettlementLastBidDie', 225, 226, 40, 40, color(255, 248, 228));
  text(runtime, 'SettlementCountText', 0, 182, 560, 44, '实际计数：--', 27, color(245, 219, 174));
  text(runtime, 'SettlementLoserText', 0, 140, 560, 50, '输家：--', 32, color(255, 116, 96));
  for (let face = 1; face <= 6; face += 1) {
    const col = (face - 1) % 3;
    const row = Math.floor((face - 1) / 3);
    const itemX = -205 + col * 205;
    const itemY = 72 - row * 70;
    panel(runtime, `SettlementFace${face}Die`, itemX - 34, itemY, 38, 38, color(255, 248, 228));
    text(runtime, `SettlementFace${face}CountText`, itemX + 34, itemY - 4, 82, 42, 'x 0', 25, color(255, 240, 206));
  }
  text(runtime, 'SettlementPlayersTitleText', 0, -80, 540, 40, '玩家骰面', 24, color(230, 205, 155));
  panel(runtime, 'SettlementPlayersViewportBg', 0, -168, 550, 158, color(34, 25, 24, 210));
  const settlementViewport = node('SettlementPlayersViewport', runtime, 0, -168, 540, 150, [mask]);
  const settlementContent = node('SettlementPlayersContent', settlementViewport, 0, 0, 540, 260);
  const settlementPlayers = ['player-local', 'player-ai-1', 'player-ai-2', 'player-ai-3', 'player-ai-4', 'player-ai-5'];
  settlementPlayers.forEach((playerId, index) => {
    const y = 52 - index * 42;
    avatar(settlementContent, `SettlementAvatar-${playerId}`, -250, y, 26);
    text(settlementContent, `SettlementPlayer${index}NameText`, -198, y - 4, 82, 36);
    diceRow(settlementContent, `SettlementDiceRow-${playerId}`, 20, y, 30);
  });

  appendPreservedGlobals(sceneIndex);
}

buildScene();
writeFileSync(scenePath, `${JSON.stringify(objects, null, 2)}\n`);
console.log(`Generated ${scenePath}`);
