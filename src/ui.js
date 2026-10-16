import { getAircraftType } from './sim/aircraftTypes.js';

const KT_PER_MS = 1.94384449;
const FT_PER_M = 3.280839895;
const FPM_PER_MS = 196.8503937;
const RAD_TO_DEG = 180 / Math.PI;
const RUNWAY_THRESHOLD_Z = -1800;

const SCREEN_ALIASES = {
  game: 'hud',
  playing: 'hud',
  flight: 'hud',
  resume: 'hud',
  paused: 'pause',
  landing: 'results',
  result: 'results',
  score: 'results',
  debrief: 'results',
  menu: 'title'
};

const PHASE_NAMES = {
  cold: '冷舱准备',
  preflight: '开车前准备',
  pushback: '推出开车',
  taxi: '地面滑行',
  takeoff: '起飞',
  departure: '离场',
  climb: '爬升',
  cruise: '巡航',
  descent: '下降',
  approach: '进近',
  final: '五边进近',
  landing: '着陆',
  rollout: '着陆滑跑',
  vacated: '脱离跑道',
  complete: '任务完成'
};

const TIME_NAMES = {
  day: '白天',
  night: '夜间',
  dawn: '清晨',
  dusk: '黄昏'
};

const WEATHER_NAMES = {
  clear: '晴朗',
  rain: '降雨',
  storm: '雷雨',
  cloudy: '多云',
  fog: '低能见',
  snow: '降雪'
};

const CAMERA_NAMES = {
  cockpit: '驾驶舱',
  chase: '追尾',
  external: '外部',
  orbit: '环绕',
  wing: '机翼',
  tower: '塔台',
  flyby: '飞越'
};

// 主程序键位契约：动作 -> 按键标签。界面按键徽标统一由这里注入，HTML 不重复写死。
const ACTION_KEYS = {
  startEngine1: '1',
  startEngine2: '2',
  startEngine3: '3',
  startEngine4: '4',
  generator1: 'Alt+1',
  generator2: 'Alt+2',
  generator3: 'Alt+3',
  generator4: 'Alt+4',
  electricPump1: 'Num7',
  electricPump2: 'Num8',
  electricPump3: 'Num9',
  electricPump4: 'Num0',
  apu: '5',
  apuBleed: '6',
  bleedAir: '7',
  packOff: '8',
  battery: '9',
  externalPower: '0',
  avionics: '\\',
  antiIce1: 'K',
  antiIce2: 'J',
  antiIce3: 'Num5',
  antiIce4: 'Num6',
  probeHeat: 'I',
  windowHeat: 'I',
  landingLights: 'L',
  navLights: 'N',
  beacon: 'O',
  gear: 'G',
  parkingBrake: 'P',
  reverse: 'R',
  spoilers: 'Space',
  speedBrake: 'X',
  throttleUp: 'PgUp',
  throttleDown: 'PgDn',
  throttleSet: 'Home/End',
  throttleStep: 'F2/F3',
  camera: 'C',
  weather: 'Y',
  timeOfDay: 'Z',
  hudMinimal: 'U',
  mute: 'M',
  tutorial: 'T',
  help: 'H',
  pause: 'Esc'
};

// 同一个动作在不同按钮上对应不同按键时，用 data-value 区分。
const ACTION_VALUE_KEYS = {
  'flaps:1': 'F',
  'flaps:-1': 'V',
  'start:cold': '1',
  'start:takeoff': '2',
  'start:approach': '3'
};

// HUD 上无法逐个按钮标注的系统按键，汇总为一条图例。
const HUD_KEY_LEGEND = [
  { keys: ['L'], label: '着陆灯' },
  { keys: ['N'], label: '航行灯' },
  { keys: ['O'], label: '防撞灯' },
  { keys: ['I'], label: '探头 / 风挡加温' },
  { keys: ['X'], label: '速度刹车' },
  { keys: [','], label: '配平低头' },
  { keys: ['.'], label: '配平抬头' }
];

// 按键总览分组（帮助页复用同一份数据）
const KEY_SECTIONS = [
  {
    title: '系统与电源（四发）',
    items: [
      { keys: ['1 / 2 / 3 / 4'], label: 'ENG1 / ENG2 / ENG3 / ENG4 启动或关闭' },
      { keys: ['Alt+1 / 2 / 3 / 4'], label: 'GEN1 / GEN2 / GEN3 / GEN4 切换（推荐，不用 Shift）' },
      { keys: ['Numpad 7 / 8 / 9 / 0'], label: '电动泵 1 / 2 / 3 / 4 切换' },
      { keys: ['5'], label: 'APU 启动 / 关车' },
      { keys: ['6'], label: 'APU 引气' },
      { keys: ['7'], label: '发动机引气' },
      { keys: ['8'], label: 'PACK 组件关断' },
      { keys: ['9', '-'], label: '主电瓶（- 为备用）' },
      { keys: ['0', '='], label: '外部电源（= 为备用）' },
      { keys: ['\\'], label: '航空电子' }
    ]
  },
  {
    title: '四发防冰与加温',
    items: [
      { keys: ['K', 'J'], label: 'ENG1 / ENG2 防冰' },
      { keys: ['Numpad 5 / 6'], label: 'ENG3 / ENG4 防冰' },
      { keys: ['I'], label: '探头 / 风挡加温' }
    ]
  },
  {
    title: '灯光',
    items: [
      { keys: ['L'], label: '着陆灯' },
      { keys: ['N'], label: '航行灯' },
      { keys: ['O'], label: '防撞灯' }
    ]
  },
  {
    title: '构型与减速',
    items: [
      { keys: ['F'], label: '襟翼加（下一档）' },
      { keys: ['V'], label: '襟翼减（上一档）' },
      { keys: ['G'], label: '起落架收放' },
      { keys: ['P'], label: '停留刹车' },
      { keys: ['R'], label: '反推' },
      { keys: ['Space'], label: '扰流板 预位 / 收上' },
      { keys: ['X'], label: '速度刹车' },
      { keys: [','], label: '配平低头' },
      { keys: ['.'], label: '配平抬头' }
    ]
  },
  {
    title: '油门（推荐，不占用 Shift）',
    items: [
      { keys: ['PageUp'], label: '增加推力（可按住连续调节）' },
      { keys: ['PageDown'], label: '减少推力（可按住连续调节）' },
      { keys: ['Home', 'F1'], label: '慢车 0%' },
      { keys: ['End', 'F4'], label: '起飞推力 100%' },
      { keys: ['F2', 'F3'], label: '每次减少 / 增加 5%' },
      { keys: ['鼠标'], label: '点击 HUD 上的油门档位按钮', mouse: true }
    ]
  },
  {
    title: '飞行操纵',
    items: [
      { keys: ['W', 'S', '↑', '↓'], label: '俯仰控制' },
      { keys: ['A', 'D', '←', '→'], label: '横滚；地面时 ← / → 为前轮转向' },
      { keys: ['Q', 'E'], label: '方向舵脚舵' },
      { keys: ['Shift', 'Ctrl'], label: '油门备用键（旧键位，可继续使用）' },
      { keys: ['B'], label: '机轮刹车（按住）' }
    ]
  },
  {
    title: '视角与界面',
    items: [
      { keys: ['C'], label: '切换视角' },
      { keys: ['Y'], label: '切换天气' },
      { keys: ['Z'], label: '切换昼夜' },
      { keys: ['U'], label: '精简 / 恢复 HUD 面板' },
      { keys: ['M'], label: '静音开关' },
      { keys: ['T'], label: '飞行教程开关' },
      { keys: ['H'], label: '按键总览 / 帮助' },
      { keys: ['Esc'], label: '暂停 / 继续' }
    ]
  },
  {
    title: '情景、机型与鼠标',
    items: [
      { keys: ['1', '2', '3'], label: '标题页：冷舱 / 起飞 / 进近' },
      { keys: ['鼠标'], label: '标题页：点击机型卡选择飞机', mouse: true },
      { keys: ['鼠标'], label: '按住左键在空白处拖动 = 360° 自由环视，松开保持', mouse: true },
      { keys: ['鼠标'], label: '按住右键拖动 = 360° 自由环视，松开保持；切换视角时回正', mouse: true },
      { keys: ['滚轮'], label: '滚轮向上放大、向下缩小视角（45%～320%，切换视角恢复 100%）', mouse: true },
      { keys: ['鼠标'], label: '点击座舱按钮或检查单执行对应操作', mouse: true }
    ]
  }
];

const TOGGLE_ACTIONS = new Set([
  'battery', 'externalPower', 'avionics', 'apu', 'apuBleed', 'bleedAir',
  'electricPump1', 'electricPump2', 'electricPump3', 'electricPump4', 'packOff',
  'generator1', 'generator2', 'generator3', 'generator4',
  'startEngine1', 'startEngine2', 'startEngine3', 'startEngine4',
  'antiIce1', 'antiIce2', 'antiIce3', 'antiIce4', 'gear',
  'parkingBrake', 'spoilers', 'reverse', 'mute', 'tutorial',
  'landingLights', 'navLights', 'beacon', 'probeHeat', 'windowHeat', 'speedBrake'
]);

// 主题由 timeOfDay + weather 共同决定，取值：day / light-sky / dusk / night / storm
const THEME_NAMES = ['day', 'light-sky', 'dusk', 'night', 'storm'];

function resolveTheme(environment) {
  const time = environment && typeof environment.timeOfDay === 'string' ? environment.timeOfDay : 'day';
  const weather = environment && typeof environment.weather === 'string' ? environment.weather : 'clear';
  if (weather === 'storm') return 'storm';
  if (time === 'night') return 'night';
  if (time === 'dusk' || time === 'dawn') return 'dusk';
  return weather === 'clear' ? 'day' : 'light-sky';
}

// 仪表画布配色：白天深色柔和，夜间高对比
const INSTRUMENT_PALETTE_BASE = {
  tapeBg: 'rgba(4, 16, 26, 0.86)',
  tickMajor: 'rgba(186, 218, 230, 0.62)',
  tickMinor: 'rgba(142, 190, 210, 0.28)',
  tickText: '#bacdd5',
  tapeEdge: '#62e4ef',
  tapeEdgeCaution: '#ffbf69',
  tapeEdgeCritical: '#ff5f61',
  valueText: '#f1fdff',
  valueHalo: 'rgba(2, 10, 18, 0.92)',
  readoutBg: 'rgba(3, 14, 23, 0.96)',
  readoutLabel: '#8ea7b3',
  vsTrack: 'rgba(142, 190, 210, 0.28)',
  vsStable: '#7ce6ad',
  vsCaution: '#ffbf69',
  horizonSky: '#153b52',
  horizonGround: '#493c2e',
  horizonLine: 'rgba(230, 240, 231, 0.88)',
  pitchMajor: 'rgba(230, 240, 235, 0.78)',
  pitchMinor: 'rgba(230, 240, 235, 0.5)',
  bankTick: 'rgba(215, 232, 236, 0.65)',
  bankPointer: '#ffbf69',
  fpv: '#7ce6ad',
  director: '#ffbf69',
  overlayBox: 'rgba(3, 13, 22, 0.68)',
  overlayText: '#c6d8de',
  headingBg: 'rgba(3, 13, 22, 0.9)',
  headingTickMajor: 'rgba(196, 224, 231, 0.75)',
  headingTickMinor: 'rgba(142, 190, 210, 0.34)',
  headingText: '#b4cbd2',
  headingCardinal: '#62e4ef',
  headingMarker: '#62e4ef',
  headingFoot: 'rgba(126, 156, 170, 0.85)'
};

const INSTRUMENT_PALETTE_OVERRIDES = {
  'light-sky': {
    tapeBg: 'rgba(8, 20, 30, 0.9)',
    tickMajor: 'rgba(178, 202, 214, 0.52)',
    tickMinor: 'rgba(150, 180, 196, 0.24)',
    tickText: '#c9d7dd',
    headingBg: 'rgba(8, 20, 30, 0.92)',
    headingTickMajor: 'rgba(186, 212, 222, 0.68)',
    headingTickMinor: 'rgba(150, 180, 196, 0.3)',
    readoutBg: 'rgba(5, 16, 26, 0.97)'
  },
  dusk: {
    tapeBg: 'rgba(13, 13, 22, 0.88)',
    tickMajor: 'rgba(232, 206, 178, 0.6)',
    tickMinor: 'rgba(206, 172, 140, 0.26)',
    tickText: '#e2cfb9',
    readoutBg: 'rgba(12, 11, 19, 0.96)',
    readoutLabel: '#b39c86',
    headingBg: 'rgba(12, 11, 19, 0.92)',
    headingText: '#e0cdb9',
    headingCardinal: '#7fe3ef',
    headingMarker: '#7fe3ef',
    headingFoot: 'rgba(178, 152, 130, 0.85)'
  },
  night: {
    tapeBg: 'rgba(0, 6, 13, 0.93)',
    tickMajor: 'rgba(158, 240, 255, 0.82)',
    tickMinor: 'rgba(120, 210, 235, 0.4)',
    tickText: '#e0f6fc',
    tapeEdge: '#8bf4ff',
    valueText: '#ffffff',
    valueHalo: 'rgba(0, 0, 0, 0.96)',
    readoutBg: 'rgba(0, 8, 16, 0.97)',
    readoutLabel: '#a9c7d3',
    vsTrack: 'rgba(120, 210, 235, 0.4)',
    horizonSky: '#0e3a58',
    horizonGround: '#5d4a32',
    horizonLine: 'rgba(246, 253, 251, 0.95)',
    pitchMajor: 'rgba(240, 252, 255, 0.86)',
    pitchMinor: 'rgba(240, 252, 255, 0.56)',
    bankTick: 'rgba(240, 252, 255, 0.78)',
    overlayBox: 'rgba(0, 8, 16, 0.76)',
    overlayText: '#d5e7ec',
    headingBg: 'rgba(0, 5, 11, 0.94)',
    headingTickMajor: 'rgba(214, 246, 252, 0.86)',
    headingTickMinor: 'rgba(120, 210, 235, 0.38)',
    headingText: '#d6eaef',
    headingCardinal: '#8bf4ff',
    headingMarker: '#8bf4ff',
    headingFoot: 'rgba(152, 192, 206, 0.88)'
  },
  storm: {
    tapeBg: 'rgba(2, 8, 16, 0.94)',
    tickMajor: 'rgba(150, 212, 234, 0.7)',
    tickMinor: 'rgba(120, 182, 206, 0.32)',
    tickText: '#c8dde6',
    tapeEdge: '#7fd8e6',
    valueText: '#f4fdff',
    readoutBg: 'rgba(1, 6, 12, 0.97)',
    vsTrack: 'rgba(120, 182, 206, 0.34)',
    headingBg: 'rgba(2, 7, 14, 0.94)',
    headingTickMajor: 'rgba(178, 224, 238, 0.76)',
    headingText: '#c8dde6',
    headingCardinal: '#7fd8e6',
    headingMarker: '#7fd8e6'
  }
};

function instrumentPalette(theme) {
  const overrides = INSTRUMENT_PALETTE_OVERRIDES[theme];
  return overrides ? { ...INSTRUMENT_PALETTE_BASE, ...overrides } : { ...INSTRUMENT_PALETTE_BASE };
}

const CHECKLIST = [
  { key: 'battery', label: '主电瓶', done: (s) => !!s.systems?.battery },
  { key: 'externalPower', label: '外部电源', done: (s) => !!s.systems?.externalPower },
  { key: 'avionics', label: '航空电子', done: (s) => !!s.systems?.avionics },
  { key: 'apu', label: 'APU', done: (s) => !!s.systems?.apu?.available },
  { key: 'apuBleed', label: 'APU 引气', done: (s) => !!s.systems?.apu?.bleed },
  ...Array.from({ length: 4 }, (_, index) => ({
    key: `electricPump${index + 1}`,
    label: `${index + 1} 号电动泵`,
    done: (s) => !!s.systems?.electricPumps?.[index]
  })),
  { key: 'packOff', label: '组件（PACK）关闭', done: (s) => !!s.systems?.packOff },
  { key: 'bleedAir', label: '发动机引气', done: (s) => !!s.systems?.bleedAir },
  ...Array.from({ length: 4 }, (_, index) => {
    const number = index + 1;
    return [
      { key: `startEngine${number}`, label: `ENG ${number} · ${number} 号发动机`, done: (s) => !!s.engines?.[index]?.running },
      { key: `generator${number}`, label: `GEN ${number} · ${number} 号发电机`, done: (s) => !!s.systems?.generators?.[index] }
    ];
  }).flat()
];

function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function firstFinite(...values) {
  for (const value of values) {
    if (finite(value)) return value;
  }
  return NaN;
}

function fixed(value, digits = 0, placeholder = '--') {
  return finite(value) ? value.toFixed(digits) : placeholder;
}

function integer(value, placeholder = '---') {
  return finite(value) ? String(Math.round(value)) : placeholder;
}

function signed(value, digits = 0, placeholder = '--') {
  if (!finite(value)) return placeholder;
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
}

function normalizeDegrees(value) {
  if (!finite(value)) return NaN;
  return ((value % 360) + 360) % 360;
}

function enginePercent(value) {
  if (!finite(value)) return NaN;
  return Math.abs(value) <= 2.5 ? value * 100 : value;
}

function fuelFlowPerHour(value) {
  if (!finite(value)) return NaN;
  return Math.abs(value) <= 20 ? value * 3600 : value;
}

function safeText(value, fallback = '—') {
  if (typeof value === 'string' && value.trim()) return value;
  if (finite(value)) return String(value);
  return fallback;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function warning(code, title, detail, tone = 'amber') {
  return { code, title, detail, tone };
}

export class UI {
  constructor(onAction = () => {}) {
    this.onAction = typeof onAction === 'function' ? onAction : () => {};
    this.root = document.getElementById('ui');
    if (!this.root) throw new Error('UI 初始化失败：缺少 #ui 根节点。');

    this.el = Object.create(null);
    this.root.querySelectorAll('[id]').forEach((node) => {
      this.el[node.id] = node;
    });

    this.screens = new Map();
    this.root.querySelectorAll('[data-screen]').forEach((node) => {
      this.screens.set(node.dataset.screen, node);
    });
    this.overlays = new Map();
    this.root.querySelectorAll('[data-overlay]').forEach((node) => {
      this.overlays.set(node.dataset.overlay, node);
    });

    this.actionElements = Array.from(this.root.querySelectorAll('[data-action]'));
    this.actionButtons = this.actionElements.filter((node) => node.tagName === 'BUTTON');
    this.aircraftButtons = this.actionButtons.filter((node) => node.dataset.action === 'aircraft');
    this.checkItems = new Map();
    this.root.querySelectorAll('[data-check]').forEach((node) => {
      this.checkItems.set(node.dataset.check, node);
    });
    this.warningSlots = Array.from(this.root.querySelectorAll('[data-warning-slot]'));
    this.engineRows = [];
    this.engineRowCount = 0;
    this.canvases = {
      speed: this.el['airspeed-canvas'],
      altitude: this.el['altitude-canvas'],
      attitude: this.el['attitude-canvas'],
      heading: this.el['heading-canvas']
    };

    this.baseScreen = 'loading';
    this.activeOverlay = null;
    this.returnOverlay = null;
    this.lastState = null;
    this.telemetry = null;
    this.lastOutcome = null;
    this.lastWarningSignature = '';
    this.lastChecklistDone = null;
    this.lastDrawTime = 0;
    this.drawRequest = 0;
    this.destroyed = false;
    this.timers = new Set();
    this.toastTimers = new Map();
    this.localSettings = { muted: false, volume: 0.8, sensitivity: 1 };
    this.aircraftSpec = getAircraftType();
    this.theme = '';
    this.palette = instrumentPalette('day');
    this.keyHintNodes = [];

    this.boundClick = (event) => this.handleClick(event);
    this.boundInput = (event) => this.handleInput(event);
    this.boundChange = (event) => this.handleChange(event);
    this.boundResize = () => this.scheduleDraw(true);
    this.root.addEventListener('click', this.boundClick);
    this.root.addEventListener('input', this.boundInput);
    this.root.addEventListener('change', this.boundChange);
    window.addEventListener('resize', this.boundResize, { passive: true });

    this.syncSettingOutputs();
    this.renderKeyHints();
    this.renderKeyOverview();
    this.renderKeyLegend();
    this.applyTheme(null);
    this.showScreen('loading');
  }

  setText(node, value) {
    if (!node) return;
    const text = String(value);
    if (!node.children.length) {
      if (node.textContent !== text) node.textContent = text;
      return;
    }
    // 保留注入的按键徽标等子元素，只更新首个文本节点
    const first = node.firstChild;
    if (first && first.nodeType === Node.TEXT_NODE) {
      if (first.nodeValue !== text) first.nodeValue = text;
    } else {
      node.insertBefore(document.createTextNode(text), node.firstChild);
    }
  }

  setHidden(node, hidden) {
    if (node && node.hidden !== !!hidden) node.hidden = !!hidden;
  }

  setClass(node, className, enabled) {
    if (node && node.classList.contains(className) !== !!enabled) {
      node.classList.toggle(className, !!enabled);
    }
  }

  setTimer(callback, delay) {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed) callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  readValue(element) {
    if (element.tagName === 'SELECT') return element.value;
    if (element.tagName === 'INPUT') {
      if (element.type === 'checkbox') return element.checked;
      const numeric = Number(element.value);
      return Number.isFinite(numeric) ? numeric : element.value;
    }
    if (!element.hasAttribute('data-value')) return undefined;
    const value = element.dataset.value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value !== '' && Number.isFinite(Number(value))) return Number(value);
    return value;
  }

  emit(element, forcedValue) {
    if (!element || this.destroyed) return;
    const action = element.dataset.action;
    if (!action) return;
    let value = forcedValue;
    if (value === undefined) value = this.readValue(element);

    if (action === 'volume' && element.tagName === 'INPUT') {
      value = clamp(0, 1, Number(element.value) / 100);
      this.localSettings.volume = value;
    } else if (action === 'sensitivity') {
      this.localSettings.sensitivity = finite(value) ? value : 1;
    } else if (action === 'mute') {
      this.localSettings.muted = !this.localSettings.muted;
      value = this.localSettings.muted;
      this.syncMute();
    } else if (action === 'tutorial' && !this.lastState) {
      value = true;
    }

    if (action === 'help' || action === 'settings' || action === 'pause') {
      this.showScreen(action);
    } else if (action === 'back') {
      this.closeOverlay();
    } else if (action === 'resume' || action === 'reset') {
      this.showScreen('hud');
    }

    if (element.classList.contains('check-item')) {
      const item = CHECKLIST.find((entry) => entry.key === action);
      this.setText(this.el['checklist-command-feedback'], `指令已发送：${item?.label || '系统'} · 等待系统响应`);
      this.setClass(this.el['checklist-command-feedback'], 'is-confirmed', false);
      element.classList.remove('is-commanded');
      void element.offsetWidth;
      element.classList.add('is-commanded');
      this.setTimer(() => element.classList.remove('is-commanded'), 380);
    }

    this.syncSettingOutputs();
    this.onAction(action, value, element);
  }

  handleClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || !this.root.contains(button) || button.disabled) return;
    this.emit(button);
  }

  handleInput(event) {
    const element = event.target;
    if (!element.matches?.('input[type="range"][data-action]')) return;
    this.syncSettingOutputs();
    this.emit(element);
  }

  handleChange(event) {
    const element = event.target;
    if (!element.matches?.('select[data-action], input[data-action]:not([type="range"])')) return;
    this.emit(element);
  }

  showScreen(name) {
    if (this.destroyed) return;
    const requested = SCREEN_ALIASES[name] || name;

    if (this.screens.has(requested)) {
      this.screens.forEach((node, key) => {
        this.setHidden(node, key !== requested);
      });
      this.overlays.forEach((node) => this.setHidden(node, true));
      this.baseScreen = requested;
      this.activeOverlay = null;
      this.returnOverlay = null;
      this.root.dataset.screen = requested;
      if (requested === 'hud') this.scheduleDraw(true);
      this.syncKeyOverviewState();
      return;
    }

    if (!this.overlays.has(requested)) return;
    if (requested === 'pause' && this.baseScreen !== 'hud') {
      this.screens.forEach((node, key) => this.setHidden(node, key !== 'hud'));
      this.baseScreen = 'hud';
      this.root.dataset.screen = 'hud';
    }

    const previous = this.activeOverlay;
    this.returnOverlay = previous && previous !== requested && requested !== 'pause' ? previous : null;
    this.overlays.forEach((node, key) => this.setHidden(node, key !== requested));
    this.activeOverlay = requested;
    const overlay = this.overlays.get(requested);
    const focusTarget = overlay?.querySelector('button, select, input');
    if (focusTarget) {
      this.setTimer(() => focusTarget.focus({ preventScroll: true }), 0);
    }
    if (this.baseScreen === 'hud') this.scheduleDraw(true);
    this.syncKeyOverviewState();
  }

  closeOverlay() {
    if (!this.activeOverlay) return;
    this.overlays.forEach((node) => this.setHidden(node, true));
    this.activeOverlay = null;
    if (this.returnOverlay) {
      const target = this.returnOverlay;
      this.returnOverlay = null;
      this.showScreen(target);
      return;
    }
    this.syncKeyOverviewState();
  }

  notify(text, tone = 'info') {
    if (this.destroyed || !this.el['toast-stack']) return;
    const message = safeText(text, '');
    if (!message) return;

    const toast = document.createElement('div');
    const normalizedTone = ['red', 'amber'].includes(tone) ? tone :
      (['error', 'danger', 'critical'].includes(tone) ? 'red' :
        (['warning', 'caution'].includes(tone) ? 'amber' : 'info'));
    toast.className = `toast${normalizedTone === 'info' ? '' : ` is-${normalizedTone}`}`;
    toast.setAttribute('role', normalizedTone === 'red' ? 'alert' : 'status');
    toast.textContent = message;
    this.el['toast-stack'].appendChild(toast);

    while (this.el['toast-stack'].children.length > 4) {
      const oldest = this.el['toast-stack'].firstElementChild;
      const oldTimer = this.toastTimers.get(oldest);
      if (oldTimer) window.clearTimeout(oldTimer);
      this.toastTimers.delete(oldest);
      oldest.remove();
    }

    const remove = () => {
      toast.classList.add('is-leaving');
      this.setTimer(() => {
        toast.remove();
        this.toastTimers.delete(toast);
      }, 190);
    };
    const timer = this.setTimer(remove, normalizedTone === 'red' ? 5200 : 3600);
    this.toastTimers.set(toast, timer);
  }

  update(state) {
    if (this.destroyed || !state || typeof state !== 'object') return;
    this.lastState = state;
    this.telemetry = this.readTelemetry(state);
    this.applyTheme(state);
    this.updateAircraft(state);

    this.updateMission(state);
    this.updateFlightData(this.telemetry);
    this.updateEngines(state);
    this.updateSystems(state);
    this.updateChecklist(state);
    this.updateWarnings(state);
    this.updateRadio(state);
    this.updateResults(state);
    this.updateSettings(state);
    this.updateActionStates(state);

    if (state.paused && this.baseScreen === 'hud' && !this.activeOverlay) {
      this.showScreen('pause');
    } else if (!state.paused && this.activeOverlay === 'pause') {
      this.showScreen('hud');
    }

    if (state.outcome && !this.lastOutcome && this.baseScreen === 'hud') {
      this.showScreen('results');
    }
    this.lastOutcome = state.outcome || null;

    if (this.baseScreen === 'hud') this.scheduleDraw(false);
  }

  updateAircraft(state) {
    const spec = getAircraftType(state.aircraft?.type);
    const shortName = safeText(spec.shortName, 'B747-400');
    const engineName = safeText(spec.engineName, '—');
    this.aircraftSpec = spec;

    this.setText(this.el['hud-aircraft-type'], shortName);
    this.setText(this.el['hud-aircraft-engine'], engineName);
    this.setText(this.el['engine-aircraft-name'], `${shortName} / ${engineName}`);
    this.setText(this.el['aircraft-selection-status'], `当前：${shortName}`);

    this.aircraftButtons.forEach((button) => {
      const selected = button.dataset.value === spec.id;
      this.setClass(button, 'is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      this.setText(button.querySelector('.aircraft-selection-state'), selected ? '当前选中' : '点击选择');
    });

    const flapSettings = Array.isArray(spec.flapSettings) ? spec.flapSettings.filter((value) => finite(value)) : [];
    this.setText(this.el['flap-settings'], flapSettings.length ? `${flapSettings.map((value) => fixed(value, 0)).join(' / ')}°` : '—');
    this.setText(
      this.el['v-speed-reference'],
      `V1 ${integer(spec.v1, '---')} · VR ${integer(spec.vr, '---')} · V2 ${integer(spec.v2, '---')} · VAPP ${integer(spec.vApp25, '---')} / ${integer(spec.vApp30, '---')} kt`
    );
  }

  readTelemetry(state) {
    const airspeed = firstFinite(state.airspeed, state.tas);
    const groundSpeed = firstFinite(state.groundSpeed, state.gs);
    const verticalSpeed = state.verticalSpeed;
    const altitude = state.altitude;
    const radioAltitude = state.radioAltitude;
    const windSpeed = state.environment?.windSpeed;
    const flap = firstFinite(state.controls?.flaps, state.flaps?.left, state.flaps?.target);

    return {
      tasKt: finite(airspeed) ? airspeed * KT_PER_MS : NaN,
      gsKt: finite(groundSpeed) ? groundSpeed * KT_PER_MS : NaN,
      altitudeFt: finite(altitude) ? altitude * FT_PER_M : NaN,
      radioAltitudeFt: finite(radioAltitude) ? Math.max(0, radioAltitude) * FT_PER_M : NaN,
      vsMs: finite(verticalSpeed) ? verticalSpeed : NaN,
      vsFpm: finite(verticalSpeed) ? verticalSpeed * FPM_PER_MS : NaN,
      mach: state.mach,
      alphaDeg: finite(state.alpha) ? state.alpha * RAD_TO_DEG : NaN,
      betaDeg: finite(state.beta) ? state.beta * RAD_TO_DEG : NaN,
      gLoad: state.gLoad,
      heading: finite(state.heading) ? normalizeDegrees(state.heading * RAD_TO_DEG) : NaN,
      pitch: finite(state.pitch) ? state.pitch : 0,
      roll: finite(state.roll) ? state.roll : 0,
      pitchDeg: finite(state.pitch) ? state.pitch * RAD_TO_DEG : 0,
      rollDeg: finite(state.roll) ? state.roll * RAD_TO_DEG : 0,
      flap,
      windDirection: normalizeDegrees(state.environment?.windDirection),
      windSpeed: finite(windSpeed) ? windSpeed : NaN,
      windKt: finite(windSpeed) ? windSpeed * KT_PER_MS : NaN
    };
  }

  updateMission(state) {
    const mission = state.mission || {};
    const phase = safeText(mission.phase, safeText(state.status, 'cold'));
    const phaseName = safeText(mission.title, PHASE_NAMES[phase] || phase);
    const objective = safeText(mission.objective, '等待飞行指令');
    this.setText(this.el['mission-phase'], phaseName);
    this.setText(this.el['mission-objective-top'], objective);
    this.setText(this.el['mission-objective'], objective);

    const isCold = phase === 'cold' || state.status === 'cold';
    this.setText(this.el['checklist-title'], isCold ? '冷舱检查单' : '任务目标');
    this.setHidden(this.el['cold-checklist'], !isCold);
    if (!isCold) {
      this.setText(this.el['checklist-progress'], '任务引导');
      this.setText(this.el['checklist-command-feedback'], '按照当前目标继续飞行');
    }

    let hint = '保持姿态与速度，监控飞机系统 · H 按键总览';
    if (isCold) {
      const next = CHECKLIST.find((entry) => !entry.done(state));
      const key = next ? ACTION_KEYS[next.key] || '' : '';
      hint = next ?
        (key ? `点击检查单或按 ${key}：${next.label}` : `点击检查单：${next.label}`) :
        '冷舱检查单完成，等待后续指令';
    } else if (state.onGround) {
      hint = 'PageUp/PageDown 油门 · Home/End 慢车/起飞 · G 起落架 · H 按键总览';
    } else if (phase === 'approach' || phase === 'final' || phase === 'landing') {
      hint = '稳定速度、航向与下降率，柔和拉平 · H 按键总览';
    }
    this.setText(this.el['interaction-text'], hint);
    this.setHidden(this.el['interaction-hint'], state.tutorial === false);
  }

  updateFlightData(t) {
    this.setText(this.el['tas-value'], integer(t.tasKt));
    this.setText(this.el['gs-value'], integer(t.gsKt));
    this.setText(this.el['mach-value'], fixed(t.mach, 2, '-.--'));
    this.setText(this.el['aoa-value'], `${signed(t.alphaDeg, 1, '--.-')}°`);
    this.setText(this.el['g-value'], `${fixed(t.gLoad, 2, '-.--')} G`);
    this.setText(this.el['altitude-value'], integer(t.altitudeFt, '-----'));
    this.setText(this.el['radio-altitude-value'], integer(t.radioAltitudeFt, '----'));
    this.setText(this.el['vs-fpm-value'], signed(t.vsFpm, 0, '-----'));
    this.setText(this.el['vs-ms-value'], `${signed(t.vsMs, 1, '--.-')} m/s`);
    this.setText(this.el['heading-value'], finite(t.heading) ? `${String(Math.round(t.heading) % 360).padStart(3, '0')}°` : '---°');
  }

  createEngineRow(index) {
    const number = index + 1;
    const row = document.createElement('div');
    row.className = 'engine-row';
    row.dataset.engine = String(index);
    row.setAttribute('role', 'row');

    const label = document.createElement('strong');
    label.textContent = `ENG ${number}`;
    label.setAttribute('role', 'rowheader');
    row.appendChild(label);

    const fields = [
      ['n1', '--.-'],
      ['n2', '--.-'],
      ['egt', '---'],
      ['ff', '----']
    ];
    fields.forEach(([field, placeholder]) => {
      const cell = document.createElement('span');
      cell.id = `eng-${number}-${field}`;
      cell.textContent = placeholder;
      cell.setAttribute('role', 'cell');
      this.el[cell.id] = cell;
      row.appendChild(cell);
    });

    const bar = document.createElement('i');
    bar.className = 'engine-bar';
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('b');
    fill.id = `eng-${number}-bar`;
    this.el[fill.id] = fill;
    bar.appendChild(fill);
    row.appendChild(bar);
    return row;
  }

  ensureEngineRows(count) {
    const container = this.el['engine-rows'];
    if (!container || count === this.engineRowCount) return;

    for (let number = 1; number <= this.engineRowCount; number += 1) {
      ['n1', 'n2', 'egt', 'ff', 'bar'].forEach((field) => {
        delete this.el[`eng-${number}-${field}`];
      });
    }

    const fragment = document.createDocumentFragment();
    this.engineRows = [];
    for (let index = 0; index < count; index += 1) {
      const row = this.createEngineRow(index);
      this.engineRows.push(row);
      fragment.appendChild(row);
    }
    container.replaceChildren(fragment);
    this.engineRowCount = count;
  }

  updateEngines(state) {
    const engines = Array.isArray(state.engines) ? state.engines : [];
    const count = engines.length;
    this.ensureEngineRows(count);
    let running = 0;
    let failed = 0;
    let starting = 0;

    for (let index = 0; index < count; index += 1) {
      const engine = engines[index] || {};
      const n1 = enginePercent(engine.n1);
      const n2 = enginePercent(engine.n2);
      const flow = fuelFlowPerHour(engine.fuelFlow);
      const number = index + 1;
      if (engine.running) running += 1;
      if (engine.failed || engine.fire) failed += 1;
      if (engine.starter && !engine.running) starting += 1;

      this.setText(this.el[`eng-${number}-n1`], fixed(n1, 1, '--.-'));
      this.setText(this.el[`eng-${number}-n2`], fixed(n2, 1, '--.-'));
      this.setText(this.el[`eng-${number}-egt`], integer(engine.egt));
      this.setText(this.el[`eng-${number}-ff`], integer(flow, '----'));
      const bar = this.el[`eng-${number}-bar`];
      if (bar) {
        const width = finite(n1) ? `${clamp(0, 100, n1 / 1.1).toFixed(1)}%` : '0%';
        if (bar.style.width !== width) bar.style.width = width;
      }
      this.setClass(this.engineRows[index], 'is-failed', !!(engine.failed || engine.fire));
    }

    let summary = '无发动机数据';
    if (count > 0) {
      if (failed > 0) summary = failed === 4 && count === 4 ? '四发故障' : `${failed} / ${count} 台故障`;
      else if (starting > 0) summary = `${starting} / ${count} 台启动中`;
      else if (running === count) summary = count === 4 ? '四发运转' : `${running} / ${count} 台运转`;
      else if (running > 0) summary = `${running} / ${count} 台运转`;
      else summary = count === 4 ? '四发关车' : `${count} 台发动机关车`;
    }
    this.setText(this.el['engine-summary'], summary);

    const weight = finite(state.weight) ? state.weight / 1000 : NaN;
    const fuelQuantity = state.fuel?.qty;
    const fuelDensity = finite(this.aircraftSpec?.fuelDensity) ? this.aircraftSpec.fuelDensity : 0.802;
    const fuel = finite(fuelQuantity) ? fuelQuantity * fuelDensity / 1000 : NaN;
    this.setText(this.el['weight-value'], `${fixed(weight, 1, '--.-')} t`);
    this.setText(this.el['fuel-value'], `${fixed(fuel, 1, '--.-')} t`);

    const throttle = clamp(0, 1, finite(state.controls?.throttle) ? state.controls.throttle : 0);
    const reversing = Boolean(state.controls?.reverse);
    const detent = reversing ? '反推' : throttle <= 0.03 ? '慢车' : throttle >= 0.97 ? '起飞 TOGA' :
      throttle >= 0.8 ? '爬升 CLB' : throttle >= 0.5 ? '中等推力' : '低推力';
    const throttleNode = this.el['throttle-value'];
    if (throttleNode) this.setText(throttleNode, `${detent} · ${Math.round(throttle * 100)}%`);
    const throttleBar = this.el['throttle-bar'];
    if (throttleBar) {
      const width = `${(throttle * 100).toFixed(1)}%`;
      if (throttleBar.style.width !== width) throttleBar.style.width = width;
    }
  }

  updateSystems(state) {
    const t = this.telemetry;
    const controls = state.controls || {};
    const gear = state.gear || {};
    const flaps = state.flaps || {};
    const systems = state.systems || {};

    const flapMoving = !!flaps.moving;
    this.setText(this.el['flaps-value'], finite(t.flap) ? `${fixed(t.flap, 0)}°${flapMoving ? ' · 移动中' : ''}` : '--°');
    const slatPosition = Math.max(Math.abs(state.slats?.left || 0), Math.abs(state.slats?.right || 0));
    this.setText(this.el['slats-value'], slatPosition > 0.02 ? '放出' : '收上');

    let gearText = '收放中';
    const gearDown = gear.position > 0.95 || (!finite(gear.position) && controls.gear === 'down');
    const gearUp = gear.position < 0.05 || (!finite(gear.position) && controls.gear === 'up');
    if (!gear.moving && !gear.inTransit) {
      if (gearDown) gearText = '放下锁定';
      else if (gearUp) gearText = '收上锁定';
      else if (finite(gear.position)) gearText = `${Math.round(gear.position * 100)}%`;
    }
    this.setText(this.el['gear-value'], gearText);
    this.setClass(this.el['gear-value'], 'is-caution', !!(gear.moving || gear.inTransit));

    let spoilerText = '收上';
    if (systems.groundSpoilers) spoilerText = '地面扰流板';
    else if (finite(systems.speedBrake) && systems.speedBrake > 0.02) spoilerText = `放出 ${Math.round(systems.speedBrake * 100)}%`;
    else if (controls.spoilers && controls.spoilers !== 'stowed') {
      spoilerText = ({ armed: '预位', deployed: '放出', up: '放出', flight: '飞行扰流板' })[controls.spoilers] || safeText(controls.spoilers);
    }
    this.setText(this.el['spoilers-value'], spoilerText);
    this.setText(this.el['parking-brake-value'], controls.parkingBrake ? '已设置' : '松开');
    this.setClass(this.el['parking-brake-value'], 'is-caution', !!controls.parkingBrake && !state.onGround);

    const reversing = !!controls.reverse || (state.engines || []).some((engine) => engine.reverser > 0.02);
    this.setText(this.el['reverse-value'], reversing ? '放出' : '收上');
    this.setClass(this.el['reverse-value'], 'is-caution', reversing);
    this.setText(this.el['configuration-summary'], state.onGround ? '地面构型' : (t.flap > 0 ? '高升力构型' : '洁净构型'));

    this.setText(this.el['wind-value'], finite(t.windDirection) && finite(t.windSpeed) ?
      `${String(Math.round(t.windDirection) % 360).padStart(3, '0')}° / ${fixed(t.windSpeed, 0)} m/s` : '---° / -- m/s');
    this.setText(this.el['wind-knots'], `${integer(t.windKt, '--')} kt`);
    if (this.el['wind-arrow'] && finite(t.windDirection)) {
      const transform = `rotate(${t.windDirection.toFixed(0)}deg)`;
      if (this.el['wind-arrow'].style.transform !== transform) this.el['wind-arrow'].style.transform = transform;
    }
  }

  updateChecklist(state) {
    const phase = state.mission?.phase || state.status;
    if (phase !== 'cold' && state.status !== 'cold') return;
    const states = CHECKLIST.map((entry) => !!entry.done(state));
    const doneCount = states.filter(Boolean).length;
    const firstIncomplete = states.indexOf(false);

    CHECKLIST.forEach((entry, index) => {
      const node = this.checkItems.get(entry.key);
      this.setClass(node, 'is-done', states[index]);
      this.setClass(node, 'is-current', index === firstIncomplete);
      node?.setAttribute('aria-pressed', String(states[index]));
    });
    this.setText(this.el['checklist-progress'], `${doneCount} / ${CHECKLIST.length}`);

    if (this.lastChecklistDone !== null && doneCount > this.lastChecklistDone) {
      this.setText(this.el['checklist-command-feedback'], doneCount === CHECKLIST.length ?
        '冷舱检查单全部完成' : `系统响应正常 · 已完成 ${doneCount} / ${CHECKLIST.length}`);
      this.setClass(this.el['checklist-command-feedback'], 'is-confirmed', true);
    }
    this.lastChecklistDone = doneCount;
  }

  collectWarnings(state) {
    const warnings = [];
    const keys = new Set();
    const add = (key, item) => {
      if (keys.has(key) || warnings.length >= 8) return;
      keys.add(key);
      warnings.push(item);
    };

    if (state.stalled || state.stallWarning) {
      add('stall', warning('STALL', '失速警告', '立即减小迎角并增加推力', 'red'));
    }
    if (state.overspeed) {
      add('overspeed', warning('OVER SPEED', '超速警告', '收油门并按需使用减速板', 'red'));
    }
    (state.engines || []).forEach((engine, index) => {
      if (engine.fire) add(`fire${index}`, warning('ENG FIRE', `${index + 1} 号发动机火警`, '执行发动机火警处置', 'red'));
      else if (engine.failed) add(`failed${index}`, warning('ENG FAIL', `${index + 1} 号发动机故障`, '保持操纵并检查推力', 'red'));
    });
    if (state.damage?.structuralFailure) {
      add('structure', warning('STRUCTURE', '机体结构故障', '避免机动载荷，尽快安全着陆', 'red'));
    } else if (state.stats?.hardLandingCount > 0) {
      add('hardLanding', warning('HARD LDG', '硬着陆', '检查机体与起落架损伤', 'amber'));
    }
    if (state.damage?.birdStrike) {
      add('bird', warning('BIRD STRIKE', '鸟击损伤', '检查发动机与飞行操纵', 'amber'));
    }
    if (state.systems?.packTrip) {
      add('pack', warning('PACK TRIP', '空调组件故障', '组件已跳开，监控座舱温度', 'amber'));
    }
    if (state.flaps?.fault) {
      add('flaps', warning('FLAP FAULT', '襟翼系统故障', '避免继续改变襟翼构型', 'amber'));
    }
    if (finite(state.fuel?.qty) && state.fuel.qty < 1000) {
      add('fuel', warning('FUEL LOW', '燃油不足', '尽快着陆并监控燃油流量', 'amber'));
    }

    const systemWarnings = Array.isArray(state.systems?.warnings) ? state.systems.warnings : [];
    systemWarnings.forEach((entry, index) => {
      const item = this.translateWarning(entry, index);
      if (item) add(item.key, warning(item.code, item.title, item.detail, item.tone));
    });

    return warnings.slice(0, this.warningSlots.length);
  }

  translateWarning(entry, index) {
    const raw = typeof entry === 'object' && entry !== null ?
      safeText(entry.text, safeText(entry.message, safeText(entry.title, safeText(entry.code, safeText(entry.type, '系统故障'))))) :
      safeText(entry, '系统故障');
    const lower = raw.toLowerCase();
    const toneValue = typeof entry === 'object' ? safeText(entry.tone, safeText(entry.level, '')) : '';
    const tone = /critical|error|warning|red|严重/.test(toneValue) ? 'red' : 'amber';
    const code = typeof entry === 'object' ? safeText(entry.code, 'SYS') : 'SYS';

    if (lower.includes('stall')) return { key: 'stall', code: 'STALL', title: '失速警告', detail: '立即减小迎角并增加推力', tone: 'red' };
    if (lower.includes('overspeed')) return { key: 'overspeed', code: 'OVER SPEED', title: '超速警告', detail: '立即降低空速', tone: 'red' };
    if (lower.includes('fire')) return { key: `fire-${index}`, code, title: '发动机或系统火警', detail: raw, tone: 'red' };
    if (lower.includes('hard') && lower.includes('land')) return { key: 'hardLanding', code: 'HARD LDG', title: '硬着陆', detail: raw, tone: 'amber' };
    if (lower.includes('fuel')) return { key: `fuel-${index}`, code, title: '燃油系统告警', detail: raw, tone };
    if (lower.includes('hydraulic')) return { key: `hydraulic-${index}`, code, title: '液压系统故障', detail: raw, tone };
    if (lower.includes('generator') || lower.includes('electric')) return { key: `electric-${index}`, code, title: '电源系统故障', detail: raw, tone };
    if (lower.includes('gear')) return { key: `gear-${index}`, code, title: '起落架系统告警', detail: raw, tone };
    if (lower.includes('flap') || lower.includes('slat')) return { key: `flap-system-${index}`, code, title: '高升力系统告警', detail: raw, tone };
    if (lower.includes('engine') || lower.includes('eng')) return { key: `engine-${index}`, code, title: '发动机系统告警', detail: raw, tone };
    return { key: `system-${index}-${raw}`, code, title: /[\u4e00-\u9fff]/.test(raw) ? raw : '系统故障', detail: /[\u4e00-\u9fff]/.test(raw) ? '请检查系统状态并按程序处置' : raw, tone };
  }

  updateWarnings(state) {
    const warnings = this.collectWarnings(state);
    const signature = warnings.map((item) => `${item.code}|${item.title}|${item.detail}|${item.tone}`).join('||');
    if (signature === this.lastWarningSignature) return;
    this.lastWarningSignature = signature;
    this.setHidden(this.el['warning-area'], warnings.length === 0);

    this.warningSlots.forEach((slot, index) => {
      const item = warnings[index];
      this.setHidden(slot, !item);
      if (!item) return;
      this.setClass(slot, 'is-critical', item.tone === 'red');
      this.setText(slot.querySelector('.warning-code'), item.code);
      this.setText(slot.querySelector('strong'), item.title);
      this.setText(slot.querySelector('small'), item.detail);
    });
  }

  updateRadio(state) {
    const radio = safeText(state.mission?.radio, '');
    const timer = state.mission?.radioTimer;
    const visible = !!radio && (!finite(timer) || timer > 0);
    this.setHidden(this.el['radio-subtitle'], !visible);
    if (visible) this.setText(this.el['radio-text'], radio);
  }

  updateResults(state) {
    const stats = state.stats || {};
    const sink = finite(stats.touchdownSink) ? stats.touchdownSink : NaN;
    const speed = finite(stats.touchdownSpeed) ? stats.touchdownSpeed * KT_PER_MS : NaN;
    const score = state.score;
    this.setText(this.el['result-sink'], `${integer(sink * FPM_PER_MS)} fpm`);
    this.setText(this.el['result-sink-ms'], `${fixed(sink, 1, '--.-')} m/s`);
    this.setText(this.el['result-speed'], `${integer(speed)} kt`);
    this.setText(this.el['result-g'], `${fixed(stats.touchdownG, 2, '-.--')} G`);
    this.setText(this.el['result-position'], this.formatTouchdownPosition(stats.touchdownPosition));
    this.setText(this.el['result-distance'], `${integer(stats.landingDistance, '----')} m`);
    this.setText(this.el['result-deviation'], `${fixed(stats.approachDeviation, 1, '--.-')} m`);
    this.setText(this.el['score-value'], finite(score) ? integer(score, '--') : '--');

    let grade = '—';
    if (finite(score)) grade = score >= 95 ? 'S' : score >= 85 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
    this.setText(this.el['score-grade'], grade);

    const outcome = safeText(state.outcome, '');
    const outcomeText = outcome.toLowerCase();
    const failed = /fail|crash|destroy|lost|abort|失败|坠毁|损毁/.test(outcomeText);
    let outcomeLabel = '飞行已完成';
    if (/success|landed|complete|成功/.test(outcomeText)) outcomeLabel = '任务完成 · 安全着陆';
    else if (/crash|destroy|坠毁|损毁/.test(outcomeText)) outcomeLabel = '模拟结束 · 航空器损毁';
    else if (failed) outcomeLabel = '任务未完成';
    this.setText(this.el['results-outcome'], outcomeLabel);

    const reason = safeText(state.outcomeDetail, this.deriveFailureReason(state));
    this.setHidden(this.el['failure-reason'], !failed);
    if (failed) this.setText(this.el['failure-reason-text'], reason);

    let comment = '本次飞行已记录，可再次挑战更平稳的接地。';
    if (failed) comment = '根据失败原因检查构型、速度和系统状态后重试。';
    else if (finite(score) && score >= 90) comment = '出色的能量管理与接地控制，航线飞行完成。';
    else if (finite(score) && score >= 75) comment = '着陆有效，继续减小进近偏差与接地下降率。';
    else if (finite(score) && score >= 60) comment = '完成着陆，注意保持稳定五边与拉平时机。';
    this.setText(this.el['results-comment'], comment);
  }

  formatTouchdownPosition(position) {
    if (typeof position === 'string' && position.trim()) return position;
    if (finite(position)) return `${Math.round(position)} m`;
    const point = Array.isArray(position) ? { x: position[0], z: position[2] } : position;
    if (!point || !finite(point.x) || !finite(point.z)) return '暂无数据';
    const along = point.z - RUNWAY_THRESHOLD_Z;
    const lateral = Math.abs(point.x) < 0.05 ? 0 : point.x;
    return `${Math.round(along)} m / ${signed(lateral, 0)} m`;
  }

  deriveFailureReason(state) {
    if (state.damage?.structuralFailure) return '机体结构失效';
    if (state.damage?.birdStrike) return '鸟击造成严重损伤';
    if (state.stats?.hardLandingCount > 0) return '接地下降率过大，发生硬着陆';
    if ((state.engines || []).some((engine) => engine.fire)) return '发动机火警';
    if (state.engines?.length > 0 && state.engines.every((engine) => engine.failed)) return '全部发动机失效';
    return '未满足安全飞行条件';
  }

  updateSettings(state) {
    const environment = state.environment || {};
    this.setSelectValue(this.el['setting-time'], environment.timeOfDay);
    this.setSelectValue(this.el['setting-weather'], environment.weather);
    this.setRangeValue(this.el['setting-wind-direction'], environment.windDirection);
    this.setRangeValue(this.el['setting-wind-speed'], environment.windSpeed);
    this.setText(this.el['time-of-day'], TIME_NAMES[environment.timeOfDay] || safeText(environment.timeOfDay, '—'));
    this.setText(this.el['weather-value'], WEATHER_NAMES[environment.weather] || safeText(environment.weather, '—'));
    this.setText(this.el['camera-value'], CAMERA_NAMES[state.camera] || safeText(state.camera, '—'));

    const tutorial = state.tutorial !== false;
    this.setText(this.el['tutorial-button'], tutorial ? '教程开启' : '教程关闭');
    this.setClass(this.el['tutorial-button'], 'is-active', tutorial);
    this.el['tutorial-button']?.setAttribute('aria-pressed', String(tutorial));
    this.syncSettingOutputs();
  }

  setSelectValue(select, value) {
    if (!select || typeof value !== 'string' || document.activeElement === select) return;
    const exists = Array.from(select.options).some((option) => option.value === value);
    if (exists && select.value !== value) select.value = value;
  }

  setRangeValue(input, value) {
    if (!input || !finite(value) || document.activeElement === input) return;
    const text = String(value);
    if (input.value !== text) input.value = text;
  }

  syncSettingOutputs() {
    const direction = Number(this.el['setting-wind-direction']?.value);
    const speed = Number(this.el['setting-wind-speed']?.value);
    const volume = Number(this.el['setting-volume']?.value);
    const sensitivity = Number(this.el['setting-sensitivity']?.value);
    this.setText(this.el['wind-direction-output'], `${finite(direction) ? Math.round(direction) : '--'}°`);
    this.setText(this.el['wind-speed-output'], `${finite(speed) ? Math.round(speed) : '--'} m/s`);
    this.setText(this.el['volume-output'], `${finite(volume) ? Math.round(volume) : '--'}%`);
    this.setText(this.el['sensitivity-output'], `${finite(sensitivity) ? sensitivity.toFixed(1) : '-.-'}×`);
    this.syncMute();
  }

  syncMute() {
    const muted = this.localSettings.muted;
    this.setText(this.el['mute-button'], muted ? '已静音' : '声音开启');
    this.setClass(this.el['mute-button'], 'is-active', muted);
    this.el['mute-button']?.setAttribute('aria-pressed', String(muted));
  }

  keyLabelFor(node) {
    if (!node || !node.dataset) return '';
    if (node.dataset.key) return node.dataset.key;
    const action = node.dataset.action;
    if (!action) return '';
    const value = node.dataset.value;
    if (value !== undefined) {
      const valued = ACTION_VALUE_KEYS[`${action}:${value}`];
      if (valued) return valued;
    }
    return ACTION_KEYS[action] || '';
  }

  keySlotFor(node) {
    if (!node) return null;
    if (node.classList.contains('scenario-card')) return node.querySelector('.scenario-meta') || node;
    if (node.classList.contains('setting-row')) return node.querySelector('span') || node;
    return node;
  }

  attachKeyBadge(node, label, mouse = false) {
    if (!node || !label) return null;
    if (node.querySelector('kbd')) return null;
    const isMouse = mouse || label === '鼠标';
    const badge = document.createElement('kbd');
    badge.className = isMouse ? 'key-hint is-mouse' : 'key-hint';
    badge.textContent = label;
    badge.setAttribute('aria-hidden', 'true');
    const slot = this.keySlotFor(node);
    if (!slot) return null;
    slot.appendChild(badge);
    node.classList.add('has-key-hint');
    if (node.tagName === 'BUTTON' && !node.hasAttribute('aria-keyshortcuts')) {
      node.setAttribute('aria-keyshortcuts', label);
    }
    this.keyHintNodes.push(badge);
    return badge;
  }

  // 按 ACTION_KEYS / data-key 为每个带动作的元素统一注入按键徽标
  renderKeyHints() {
    this.root.querySelectorAll('[data-action], [data-key]').forEach((node) => {
      const label = this.keyLabelFor(node);
      if (!label) return;
      const tag = node.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
        const row = node.closest('.setting-row');
        if (row) this.attachKeyBadge(row, label);
        return;
      }
      this.attachKeyBadge(node, label);
    });
  }

  // 按键总览：与帮助页复用同一个弹层，内容按分组生成
  renderKeyOverview() {
    const container = this.el['key-groups'];
    if (!container) return;
    container.replaceChildren();
    KEY_SECTIONS.forEach((section) => {
      const block = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = section.title;
      const list = document.createElement('dl');
      list.className = 'key-list';
      section.items.forEach((item) => {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        item.keys.forEach((key, index) => {
          if (index > 0) term.appendChild(document.createTextNode(' / '));
          const badge = document.createElement('kbd');
          badge.textContent = key;
          if (item.mouse) badge.className = 'key-hint is-mouse';
          term.appendChild(badge);
        });
        const detail = document.createElement('dd');
        detail.textContent = item.label;
        row.append(term, detail);
        list.appendChild(row);
      });
      block.append(heading, list);
      container.appendChild(block);
    });
  }

  // HUD 上无法逐个按钮标注的系统按键图例
  renderKeyLegend() {
    const container = this.el['system-key-legend'];
    if (!container) return;
    container.replaceChildren();
    HUD_KEY_LEGEND.forEach((item) => {
      const entry = document.createElement('span');
      const badge = document.createElement('kbd');
      badge.className = 'key-hint';
      badge.textContent = item.keys[0];
      badge.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = item.label;
      entry.append(badge, text);
      container.appendChild(entry);
    });
  }

  // 主题：timeOfDay + weather -> #ui[data-theme]，同时刷新仪表画布配色
  applyTheme(state) {
    const environment = state && state.environment ? state.environment : {};
    const theme = resolveTheme(environment);
    const weather = typeof environment.weather === 'string' ? environment.weather : 'clear';
    const time = typeof environment.timeOfDay === 'string' ? environment.timeOfDay : 'day';
    if (this.root.dataset.theme !== theme) this.root.dataset.theme = theme;
    if (this.root.dataset.weather !== weather) this.root.dataset.weather = weather;
    if (this.root.dataset.timeOfDay !== time) this.root.dataset.timeOfDay = time;
    if (theme !== this.theme) {
      this.theme = theme;
      this.palette = instrumentPalette(THEME_NAMES.includes(theme) ? theme : 'day');
      this.scheduleDraw(true);
    }
    this.syncKeyOverviewState();
  }

  keyOverviewToggles() {
    if (!this.overviewToggles) {
      this.overviewToggles = Array.from(this.root.querySelectorAll('[data-action="help"]'));
    }
    return this.overviewToggles;
  }

  syncKeyOverviewState() {
    const open = this.activeOverlay === 'help';
    if (open === this.overviewOpen) return;
    this.overviewOpen = open;
    this.keyOverviewToggles().forEach((node) => node.setAttribute('aria-expanded', String(open)));
  }

  actionActive(action, state) {
    const systems = state.systems || {};
    const controls = state.controls || {};
    const actions = {
      battery: () => !!systems.battery,
      externalPower: () => !!systems.externalPower,
      avionics: () => !!systems.avionics,
      apu: () => !!systems.apu?.switch,
      apuBleed: () => !!systems.apu?.bleed,
      bleedAir: () => !!systems.bleedAir,
      packOff: () => !!systems.packOff,
      gear: () => state.gear?.position > 0.5 || controls.gear === 'down',
      parkingBrake: () => !!controls.parkingBrake,
      spoilers: () => controls.spoilers !== 'stowed' || systems.speedBrake > 0.02,
      reverse: () => !!controls.reverse,
      landingLights: () => !!systems.landingLights,
      navLights: () => !!systems.navLights,
      beacon: () => !!systems.beacon,
      probeHeat: () => !!systems.probeHeat,
      windowHeat: () => !!systems.windowHeat,
      speedBrake: () => (finite(systems.speedBrake) && systems.speedBrake > 0.02) || controls.spoilers === 'speedbrake',
      mute: () => this.localSettings.muted,
      tutorial: () => state.tutorial !== false
    };
    for (let index = 0; index < 4; index += 1) {
      const number = index + 1;
      actions[`electricPump${number}`] = () => !!systems.electricPumps?.[index];
      actions[`generator${number}`] = () => !!systems.generators?.[index];
      actions[`startEngine${number}`] = () => !!state.engines?.[index]?.running;
      actions[`antiIce${number}`] = () => !!state.engines?.[index]?.antiIce;
    }
    return actions[action] ? actions[action]() : null;
  }

  updateActionStates(state) {
    this.actionButtons.forEach((button) => {
      const action = button.dataset.action;
      if (!TOGGLE_ACTIONS.has(action)) return;
      const active = !!this.actionActive(action, state);
      this.setClass(button, 'is-active', active);
      button.setAttribute('aria-pressed', String(active));
      if (action === 'packOff' || (action === 'parkingBrake' && !state.onGround)) {
        this.setClass(button, 'is-warning', active);
      } else if (button.classList.contains('is-warning')) {
        button.classList.remove('is-warning');
      }
    });
  }

  scheduleDraw(force) {
    if (this.destroyed || this.baseScreen !== 'hud' || !this.telemetry) return;
    if (force) this.lastDrawTime = 0;
    if (this.drawRequest) return;
    this.drawRequest = window.requestAnimationFrame(() => {
      this.drawRequest = 0;
      const now = performance.now();
      if (!force && now - this.lastDrawTime < 30) return;
      this.lastDrawTime = now;
      this.drawInstruments();
    });
  }

  prepareCanvas(canvas) {
    if (!canvas) return null;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = clamp(1, 4, window.devicePixelRatio || 1);
    const scaleX = rect.width > 0 ? rect.width / width : 1;
    const scaleY = rect.height > 0 ? rect.height / height : 1;
    const pixelWidth = Math.max(1, Math.round(width * dpr * scaleX));
    const pixelHeight = Math.max(1, Math.round(height * dpr * scaleY));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr * scaleX, 0, 0, dpr * scaleY, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    return { ctx, width, height };
  }

  drawInstruments() {
    if (!this.telemetry || this.baseScreen !== 'hud') return;
    this.drawSpeedTape(this.canvases.speed, this.telemetry);
    this.drawAltitudeTape(this.canvases.altitude, this.telemetry);
    this.drawAttitude(this.canvases.attitude, this.telemetry);
    this.drawHeadingTape(this.canvases.heading, this.telemetry);
  }

  drawSpeedTape(canvas, t) {
    const surface = this.prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, width: w, height: h } = surface;
    const palette = this.palette;
    const speed = finite(t.tasKt) ? Math.max(0, t.tasKt) : 0;
    const center = h / 2;
    const pixelsPerKt = 2;
    ctx.fillStyle = palette.tapeBg;
    ctx.fillRect(0, 0, w, h);

    ctx.font = '9px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const first = Math.floor((speed - center / pixelsPerKt) / 10) * 10;
    const last = speed + center / pixelsPerKt + 10;
    for (let tick = Math.max(0, first); tick <= last; tick += 10) {
      const y = center + (speed - tick) * pixelsPerKt;
      if (y < 5 || y > h - 5) continue;
      const major = tick % 20 === 0;
      ctx.strokeStyle = major ? palette.tickMajor : palette.tickMinor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w - (major ? 39 : 28), Math.round(y) + 0.5);
      ctx.lineTo(w - 12, Math.round(y) + 0.5);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = palette.tickText;
        ctx.fillText(String(tick), w - 45, y);
      }
    }

    const edge = this.lastState?.overspeed ? palette.tapeEdgeCritical :
      (this.lastState?.stallWarning ? palette.tapeEdgeCaution : palette.tapeEdge);
    ctx.fillStyle = edge;
    ctx.fillRect(w - 7, 0, 2, h);
    const boxWidth = w - 18;
    roundedRect(ctx, 4, center - 17, boxWidth, 34, 3);
    ctx.fillStyle = palette.readoutBg;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.font = '600 20px Consolas, monospace';
    ctx.textAlign = 'center';
    const speedText = finite(t.tasKt) ? String(Math.max(0, Math.round(t.tasKt))) : '---';
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.valueHalo;
    ctx.strokeText(speedText, w / 2 - 3, center + 1);
    ctx.fillStyle = palette.valueText;
    ctx.fillText(speedText, w / 2 - 3, center + 1);
    ctx.lineWidth = 1;
    ctx.fillStyle = palette.readoutLabel;
    ctx.font = '8px Consolas, monospace';
    ctx.fillText('TAS', w / 2 - 3, center + 24);
  }

  drawAltitudeTape(canvas, t) {
    const surface = this.prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, width: w, height: h } = surface;
    const palette = this.palette;
    const altitude = finite(t.altitudeFt) ? t.altitudeFt : 0;
    const center = h / 2;
    const pixelsPerFoot = 0.12;
    ctx.fillStyle = palette.tapeBg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '9px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const first = Math.floor((altitude - center / pixelsPerFoot) / 100) * 100;
    const last = altitude + center / pixelsPerFoot + 100;
    for (let tick = first; tick <= last; tick += 100) {
      const y = center + (altitude - tick) * pixelsPerFoot;
      if (y < 5 || y > h - 5) continue;
      const major = Math.abs(tick % 500) < 1;
      ctx.strokeStyle = major ? palette.tickMajor : palette.tickMinor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(12, Math.round(y) + 0.5);
      ctx.lineTo(major ? 39 : 28, Math.round(y) + 0.5);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = palette.tickText;
        ctx.fillText(String(Math.round(tick)), 45, y);
      }
    }

    roundedRect(ctx, 4, center - 17, w - 26, 34, 3);
    ctx.fillStyle = palette.readoutBg;
    ctx.fill();
    ctx.strokeStyle = palette.tapeEdge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.font = '600 18px Consolas, monospace';
    ctx.textAlign = 'center';
    const altitudeText = finite(t.altitudeFt) ? String(Math.round(t.altitudeFt)) : '-----';
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.valueHalo;
    ctx.strokeText(altitudeText, (w - 16) / 2, center + 1);
    ctx.fillStyle = palette.valueText;
    ctx.fillText(altitudeText, (w - 16) / 2, center + 1);
    ctx.lineWidth = 1;

    const vsX = w - 10;
    const vsTop = 14;
    const vsBottom = h - 14;
    ctx.strokeStyle = palette.vsTrack;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vsX, vsTop);
    ctx.lineTo(vsX, vsBottom);
    ctx.stroke();
    for (const vs of [-2000, -1000, 0, 1000, 2000]) {
      const y = center - vs / 2000 * (h / 2 - 16);
      ctx.beginPath();
      ctx.moveTo(vsX - 4, y);
      ctx.lineTo(vsX + 1, y);
      ctx.stroke();
    }
    if (finite(t.vsFpm)) {
      const vsY = center - clamp(-2000, 2000, t.vsFpm) / 2000 * (h / 2 - 16);
      ctx.fillStyle = Math.abs(t.vsFpm) > 1800 ? palette.vsCaution : palette.vsStable;
      ctx.beginPath();
      ctx.moveTo(vsX - 7, vsY);
      ctx.lineTo(vsX - 1, vsY - 4);
      ctx.lineTo(vsX - 1, vsY + 4);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawAttitude(canvas, t) {
    const surface = this.prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, width: w, height: h } = surface;
    const palette = this.palette;
    const cx = w / 2;
    const cy = h / 2;
    const pitch = finite(t.pitch) ? t.pitch : 0;
    const roll = finite(t.roll) ? t.roll : 0;
    const pitchDegrees = pitch * RAD_TO_DEG;
    const pixelsPerDegree = 2.15;

    ctx.save();
    roundedRect(ctx, 0, 0, w, h, 2);
    ctx.clip();
    ctx.fillStyle = palette.horizonSky;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);
    ctx.translate(0, pitchDegrees * pixelsPerDegree);
    ctx.fillStyle = palette.horizonSky;
    ctx.fillRect(-w * 3, -h * 4, w * 6, h * 4);
    ctx.fillStyle = palette.horizonGround;
    ctx.fillRect(-w * 3, 0, w * 6, h * 4);
    ctx.strokeStyle = palette.horizonLine;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-w * 3, 0);
    ctx.lineTo(w * 3, 0);
    ctx.stroke();

    ctx.font = '8px Consolas, monospace';
    ctx.textBaseline = 'middle';
    for (let angle = -30; angle <= 30; angle += 5) {
      if (angle === 0) continue;
      const y = -angle * pixelsPerDegree;
      const major = angle % 10 === 0;
      const half = major ? 30 : 17;
      ctx.strokeStyle = major ? palette.pitchMajor : palette.pitchMinor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = palette.pitchMajor;
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.abs(angle)), -half - 5, y);
        ctx.textAlign = 'left';
        ctx.fillText(String(Math.abs(angle)), half + 5, y);
      }
    }
    ctx.restore();

    const radius = 72;
    ctx.strokeStyle = palette.bankTick;
    ctx.fillStyle = palette.bankTick;
    ctx.lineWidth = 1;
    for (const angle of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const radians = angle * Math.PI / 180;
      const x1 = cx + Math.sin(radians) * radius;
      const y1 = cy - Math.cos(radians) * radius;
      const length = angle % 30 === 0 ? 7 : 4;
      const x2 = cx + Math.sin(radians) * (radius - length);
      const y2 = cy - Math.cos(radians) * (radius - length);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(cx, cy - radius + 2);
    ctx.rotate(-roll);
    ctx.fillStyle = palette.bankPointer;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-4, -7);
    ctx.lineTo(4, -7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (finite(t.alphaDeg) && finite(t.betaDeg)) {
      const fpvX = cx + clamp(-9, 9, t.betaDeg) * 4.2;
      const fpvY = cy + clamp(-10, 12, t.alphaDeg) * 2.4;
      ctx.strokeStyle = palette.fpv;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(fpvX, fpvY, 5, 0, Math.PI * 2);
      ctx.moveTo(fpvX - 13, fpvY);
      ctx.lineTo(fpvX - 5, fpvY);
      ctx.moveTo(fpvX + 5, fpvY);
      ctx.lineTo(fpvX + 13, fpvY);
      ctx.moveTo(fpvX, fpvY - 5);
      ctx.lineTo(fpvX, fpvY - 10);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = palette.director;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx - 64, cy);
    ctx.lineTo(cx - 24, cy);
    ctx.lineTo(cx - 12, cy + 8);
    ctx.moveTo(cx + 64, cy);
    ctx.lineTo(cx + 24, cy);
    ctx.lineTo(cx + 12, cy + 8);
    ctx.stroke();
    ctx.fillStyle = palette.director;
    ctx.fillRect(cx - 2, cy - 2, 4, 4);

    ctx.fillStyle = palette.overlayBox;
    ctx.fillRect(5, 5, 48, 16);
    ctx.fillRect(w - 53, 5, 48, 16);
    ctx.fillStyle = palette.overlayText;
    ctx.font = '8px Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`P ${signed(t.pitchDeg, 0)}°`, 9, 13);
    ctx.textAlign = 'right';
    ctx.fillText(`R ${signed(t.rollDeg, 0)}°`, w - 9, 13);
  }

  drawHeadingTape(canvas, t) {
    const surface = this.prepareCanvas(canvas);
    if (!surface) return;
    const { ctx, width: w, height: h } = surface;
    const palette = this.palette;
    const heading = finite(t.heading) ? t.heading : 0;
    const center = w / 2;
    const pixelsPerDegree = 2.8;
    ctx.fillStyle = palette.headingBg;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const first = Math.floor((heading - center / pixelsPerDegree) / 5) * 5;
    const last = heading + center / pixelsPerDegree + 5;
    for (let tick = first; tick <= last; tick += 5) {
      const delta = ((tick - heading + 540) % 360) - 180;
      const x = center + delta * pixelsPerDegree;
      if (x < 0 || x > w) continue;
      const normalized = ((tick % 360) + 360) % 360;
      const major = normalized % 30 === 0;
      const medium = normalized % 15 === 0;
      ctx.lineWidth = major ? 1.4 : 1;
      ctx.strokeStyle = major ? palette.headingTickMajor : palette.headingTickMinor;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, major ? 13 : (medium ? 9 : 6));
      ctx.stroke();
      if (major) {
        const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[normalized];
        ctx.fillStyle = cardinal ? palette.headingCardinal : palette.headingText;
        ctx.font = cardinal ? '600 11px Consolas, monospace' : '9px Consolas, monospace';
        ctx.fillText(cardinal || String(normalized / 10).padStart(2, '0'), x, 17);
      }
    }

    ctx.fillStyle = palette.headingMarker;
    ctx.beginPath();
    ctx.moveTo(center, 0);
    ctx.lineTo(center - 5, 7);
    ctx.lineTo(center + 5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = palette.headingMarker;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.moveTo(center, 8);
    ctx.lineTo(center, h - 14);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.headingFoot;
    ctx.font = '7px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('MAG', 7, h - 12);
    ctx.textAlign = 'right';
    ctx.fillText('HDG', w - 7, h - 12);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.removeEventListener('click', this.boundClick);
    this.root.removeEventListener('input', this.boundInput);
    this.root.removeEventListener('change', this.boundChange);
    window.removeEventListener('resize', this.boundResize);
    if (this.drawRequest) window.cancelAnimationFrame(this.drawRequest);
    this.drawRequest = 0;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
    this.toastTimers.clear();
    this.el['toast-stack']?.replaceChildren();
    this.lastState = null;
    this.telemetry = null;
  }
}

export default UI;
