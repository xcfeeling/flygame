import { M, clamp } from './sim/config.js';
import { stepSimulation, performAction, getMissionSnapshot } from './sim/simulation.js';
import { createScenario } from './sim/scenarios.js';
import { saveGame, loadGame, clearSave } from './sim/save.js';
import { World } from './view/world.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { Effects } from './effects.js';
import { DEFAULT_AIRCRAFT_TYPE, getAircraftType } from './sim/aircraftTypes.js';

const SETTINGS_KEY = 'yunyi-flight-settings-v1';
const CAMERA_CYCLE = ['cockpit', 'chase', 'wing', 'tower', 'flyby'];
const TIME_CYCLE = ['day', 'dusk', 'night'];
const WEATHER_CYCLE = ['clear', 'rain', 'fog', 'storm', 'snow'];
const CONTROL_KEYS = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight',
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End',
  'F1', 'F2', 'F3', 'F4',
  'KeyF', 'KeyV', 'KeyG', 'KeyB', 'KeyP', 'KeyR', 'KeyX', 'KeyY', 'KeyZ',
  'KeyJ', 'KeyK', 'KeyI', 'KeyL', 'KeyN', 'KeyO',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0',
  'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'Numpad0',
  'Minus', 'Equal', 'Backslash', 'Comma', 'Period',
  'Space', 'KeyC', 'Escape', 'KeyH', 'KeyM', 'KeyT', 'KeyU', 'BracketLeft', 'BracketRight'
]);

const DIGIT_ACTIONS = {
  Digit5: 'apu', Digit6: 'apuBleed', Digit7: 'bleedAir', Digit8: 'packOff',
  Digit9: 'battery', Digit0: 'externalPower', Minus: 'battery', Equal: 'externalPower',
  Backslash: 'avionics'
};

const DIGIT_ENGINE_PATTERN = /^Digit([1-4])$/;
const NUMPAD_PATTERN = /^Numpad([0-9])$/;
const THROTTLE_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'F1', 'F2', 'F3', 'F4']);

const LIGHT_ACTIONS = {
  KeyL: 'landingLights', KeyN: 'navLights', KeyO: 'beacon', KeyI: 'probeHeat'
};

const TITLE_KEYS = { Digit1: 'cold', Numpad1: 'cold', Digit2: 'takeoff', Numpad2: 'takeoff', Digit3: 'approach', Numpad3: 'approach' };

function loadSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const settings = {
  volume: 0.8,
  muted: false,
  sensitivity: 1,
  timeOfDay: 'day',
  weather: 'clear',
  windDirection: 180,
  windSpeed: 2,
  aircraftType: DEFAULT_AIRCRAFT_TYPE,
  ...loadSettings()
};

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    return false;
  }
  return true;
}

const audio = new AudioSystem(settings);
const ui = new UI(handleAction);
ui.localSettings.volume = settings.volume;
ui.localSettings.muted = settings.muted;
ui.localSettings.sensitivity = settings.sensitivity;
const volumeInput = document.getElementById('setting-volume');
const sensitivityInput = document.getElementById('setting-sensitivity');
if (volumeInput) volumeInput.value = String(Math.round(clamp(settings.volume, 0, 1) * 100));
if (sensitivityInput) sensitivityInput.value = String(clamp(settings.sensitivity, 0.2, 2));
ui.syncSettingOutputs();
ui.syncMute();

let currentAircraftType = getAircraftType(settings.aircraftType).id;
let world = null;
let effects = null;
createWorld(currentAircraftType);
let state = createScenario('cold', { ...settings, aircraftType: currentAircraftType });
let currentScenario = 'cold';
let running = false;
let accumulator = 0;
let lastFrame = performance.now();
let saveTimer = 0;
let lastMessageId = 0;
let previousPadButtons = [];
const keys = new Set();
const mouse = {
  pointerId: null,
  startX: 0,
  startY: 0,
  moved: 0,
  mode: null,
  picked: null,
  lookYaw: 0,
  lookPitch: 0,
  lookActive: false
};

function createWorld(typeId) {
  const container = document.getElementById('game');
  if (world) {
    const canvas = world.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    }
    effects?.dispose();
    world.dispose();
  }
  world = new World(container, { aircraftType: typeId });
  effects = new Effects(world.scene);
  const canvas = world.renderer?.domElement;
  if (canvas) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }
  if (!world.webglAvailable) ui.notify('3D 画面初始化失败，请检查浏览器硬件加速设置', 'red');
}

state.camera = 'chase';
ui.showScreen('title');
ui.update(state);

function scenarioOptions() {
  return {
    timeOfDay: settings.timeOfDay,
    weather: settings.weather,
    windDirection: settings.windDirection,
    windSpeed: settings.windSpeed,
    aircraftType: currentAircraftType
  };
}

function selectAircraft(typeId) {
  const spec = getAircraftType(typeId);
  const changed = currentAircraftType !== spec.id;
  currentAircraftType = spec.id;
  settings.aircraftType = spec.id;
  persistSettings();
  if (changed) createWorld(spec.id);
  state = createScenario('cold', { ...settings, aircraftType: spec.id });
  state.camera = 'chase';
  currentScenario = 'cold';
  running = false;
  accumulator = 0;
  clearInput();
  resetView();
  ui.lastOutcome = null;
  ui.showScreen('title');
  ui.update(state);
  ui.notify(`已选择 ${spec.name} · ${spec.engineName} × ${spec.engineCount}`, 'info');
}

function resetView() {
  mouse.lookYaw = 0;
  mouse.lookPitch = 0;
  mouse.lookActive = false;
  if (world) {
    world.resetLook(true);
    world.resetZoom();
  }
}

function clearInput() {
  keys.clear();
  mouse.mode = null;
  mouse.picked = null;
  mouse.pointerId = null;
  if (state?.input) {
    state.input.pitch = 0;
    state.input.roll = 0;
    state.input.yaw = 0;
    state.input.throttleDelta = 0;
    state.input.brake = 0;
  }
}

function startScenario(name = 'cold') {
  currentScenario = ['cold', 'takeoff', 'approach'].includes(name) ? name : 'cold';
  state = createScenario(currentScenario, scenarioOptions());
  running = true;
  accumulator = 0;
  saveTimer = 0;
  lastMessageId = 0;
  clearInput();
  resetView();
  ui.lastOutcome = null;
  ui.showScreen('hud');
  ui.notify(
    currentScenario === 'cold' ? '冷舱准备开始：先接通电瓶与外部电源' :
      currentScenario === 'takeoff' ? '跑道 36 起飞构型已设置' : '五边进近：稳定速度、航向与下降率',
    'info'
  );
  audio.unlock();
}

function continueSavedFlight() {
  const loaded = loadGame();
  if (!loaded) {
    ui.notify('没有可继续的有效本地存档', 'warning');
    return;
  }
  state = loaded;
  const savedType = getAircraftType(state.aircraft?.type).id;
  if (savedType !== currentAircraftType) {
    currentAircraftType = savedType;
    settings.aircraftType = savedType;
    createWorld(savedType);
  }
  currentScenario = state.mission.phase === 'cold' ? 'cold' :
    ['approach', 'landing', 'goAround'].includes(state.mission.phase) ? 'approach' : 'takeoff';
  state.paused = false;
  running = true;
  accumulator = 0;
  lastMessageId = 0;
  clearInput();
  resetView();
  ui.lastOutcome = null;
  ui.showScreen('hud');
  ui.notify('已恢复上次本地飞行进度', 'info');
}

function applyCameraMode(mode) {
  performAction(state, 'camera', mode);
  world.setCameraMode(state.camera);
  resetView();
}

function cycleCamera() {
  const current = CAMERA_CYCLE.indexOf(state.camera);
  applyCameraMode(CAMERA_CYCLE[(current + 1 + CAMERA_CYCLE.length) % CAMERA_CYCLE.length]);
}

function cycleSpoilers() {
  const next = state.controls.spoilers === 'stowed' ? 'armed' : 'stowed';
  performAction(state, 'spoilers', next);
  if (next === 'armed') ui.notify('地面扰流板已预位，接地后自动展开', 'info');
}

function cycleSpeedBrake() {
  const next = state.controls.spoilers === 'speedbrake' ? 'stowed' : 'speedbrake';
  performAction(state, 'spoilers', next);
  ui.notify(next === 'speedbrake' ? '速度刹车已放出' : '速度刹车已收回', 'info');
}

function cycleWeather() {
  const next = WEATHER_CYCLE[(WEATHER_CYCLE.indexOf(state.environment.weather) + 1) % WEATHER_CYCLE.length];
  handleAction('weather', next);
}

function cycleTimeOfDay() {
  const next = TIME_CYCLE[(TIME_CYCLE.indexOf(state.environment.timeOfDay) + 1) % TIME_CYCLE.length];
  handleAction('timeOfDay', next);
}

function toggleEngine(index) {
  if (!state.engines[index]) return;
  const action = `startEngine${index + 1}`;
  performAction(state, action, !state.engines[index].running);
  const engine = state.engines[index];
  if (state.lastAction?.action === action && !state.lastAction.accepted) {
    ui.notify(state.lastAction.reason || '发动机操作被联锁拒绝', 'warning');
  } else {
    ui.notify(`发动机 ${index + 1}${engine.running ? ' 正在启动/运转' : ' 已关车'}`, 'info');
  }
  audio.playClick('relay');
}

function handleAction(action, value) {
  if (!action) return;
  audio.unlock();

  if (action === 'aircraft') {
    selectAircraft(value);
    return;
  }
  if (action === 'start') {
    startScenario(value);
    return;
  }
  if (action === 'continue') {
    continueSavedFlight();
    return;
  }
  if (action === 'reset') {
    startScenario(currentScenario);
    return;
  }
  const engineAction = /^startEngine([1-4])$/.exec(action);
  if (engineAction) {
    toggleEngine(Number(engineAction[1]) - 1);
    return;
  }
  if (action === 'resume') {
    state.paused = false;
    running = true;
    ui.showScreen('hud');
    return;
  }
  if (action === 'pause') {
    if (!running) return;
    state.paused = typeof value === 'boolean' ? value : !state.paused;
    ui.showScreen(state.paused ? 'pause' : 'hud');
    clearInput();
    return;
  }
  if (action === 'camera' || action === 'view') {
    if (value && CAMERA_CYCLE.includes(value)) {
      applyCameraMode(value);
    } else {
      cycleCamera();
    }
    audio.playClick();
    return;
  }
  if (action === 'throttleSet') {
    const throttle = clamp(Number(value) || 0, 0, 1);
    performAction(state, 'throttle', throttle);
    ui.notify(`油门 ${Math.round(throttle * 100)}%`, 'info');
    audio.playClick('relay');
    return;
  }
  if (action === 'throttleStep' || action === 'throttleUp' || action === 'throttleDown') {
    const step = action === 'throttleStep' ? Number(value) || 0 : action === 'throttleUp' ? 0.05 : -0.05;
    performAction(state, 'throttle', clamp(state.controls.throttle + step, 0, 1));
    audio.playClick('relay');
    return;
  }
  if (action === 'help' || action === 'settings') {
    if (running) state.paused = true;
    audio.playClick();
    return;
  }
  if (action === 'back') {
    if (running && ui.activeOverlay !== 'pause' && !state.outcome) state.paused = false;
    audio.playClick();
    return;
  }
  if (action === 'volume') {
    settings.volume = clamp(Number(value) || 0, 0, 1);
    audio.setVolume(settings.volume);
    persistSettings();
    return;
  }
  if (action === 'mute') {
    settings.muted = Boolean(value);
    audio.setMuted(settings.muted);
    persistSettings();
    return;
  }
  if (action === 'sensitivity') {
    settings.sensitivity = clamp(Number(value) || 1, 0.2, 2);
    persistSettings();
    return;
  }
  if (action === 'timeOfDay' && !value) {
    value = TIME_CYCLE[(TIME_CYCLE.indexOf(state.environment.timeOfDay) + 1) % TIME_CYCLE.length];
  }
  if (action === 'weather' && !value) {
    value = WEATHER_CYCLE[(WEATHER_CYCLE.indexOf(state.environment.weather) + 1) % WEATHER_CYCLE.length];
  }
  if (action === 'flaps' && (value === 1 || value === -1)) value = value === 1 ? 'down' : 'up';
  if (action === 'spoilers' && value === undefined) {
    cycleSpoilers();
    audio.playClick('relay');
    return;
  }

  performAction(state, action, value);
  if (action === 'timeOfDay') settings.timeOfDay = state.environment.timeOfDay;
  if (action === 'weather') settings.weather = state.environment.weather;
  if (action === 'windDirection') settings.windDirection = state.environment.windDirection;
  if (action === 'windSpeed') settings.windSpeed = state.environment.windSpeed;
  if (['timeOfDay', 'weather', 'windDirection', 'windSpeed', 'tutorial'].includes(action)) persistSettings();

  if (state.lastAction?.action === action && !state.lastAction.accepted) {
    ui.notify(state.lastAction.reason || '当前操作被系统联锁拒绝', 'warning');
  } else {
    audio.playClick(['battery', 'generator1', 'generator2', 'apu'].includes(action) ? 'relay' : 'button');
  }
}

function processMessages() {
  for (const message of state.messages) {
    if (!message.id || message.id <= lastMessageId) continue;
    lastMessageId = Math.max(lastMessageId, message.id);
    if (message.kind === 'radio') {
      audio.playRadio(message.text);
    } else {
      const tone = message.kind === 'danger' ? 'red' : message.kind === 'warning' ? 'amber' : 'info';
      ui.notify(message.text, tone);
    }
  }
}

function deadzone(value, zone = 0.12) {
  const number = Number(value) || 0;
  if (Math.abs(number) <= zone) return 0;
  return Math.sign(number) * (Math.abs(number) - zone) / (1 - zone);
}

function pollGamepad(input) {
  const pads = navigator.getGamepads?.() || [];
  const pad = Array.from(pads).find((item) => item?.connected);
  if (!pad) {
    previousPadButtons = [];
    return input;
  }
  input.roll = clamp(input.roll + deadzone(pad.axes[0]), -1, 1);
  input.pitch = clamp(input.pitch + deadzone(pad.axes[1]), -1, 1);
  input.yaw = clamp(input.yaw + (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0), -1, 1);
  const lookX = deadzone(pad.axes[2], 0.16);
  const lookY = deadzone(pad.axes[3], 0.16);
  if (Math.abs(lookX) > 0 || Math.abs(lookY) > 0) {
    let yaw = mouse.lookYaw + lookX * 0.06;
    yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    mouse.lookYaw = yaw;
    mouse.lookPitch = clamp(mouse.lookPitch - lookY * 0.05, -1.4, 1.4);
    world.setLook(mouse.lookYaw, mouse.lookPitch, true);
  }
  const decrease = pad.buttons[6]?.value || 0;
  const increase = pad.buttons[7]?.value || 0;
  input.throttleDelta += (increase - decrease) * 0.55;
  input.brake = Math.max(input.brake, pad.buttons[0]?.value || 0);
  const pressed = pad.buttons.map((button) => button.pressed);
  const edge = (index) => pressed[index] && !previousPadButtons[index];
  if (edge(1)) handleAction('reverse');
  if (edge(2)) handleAction('flaps', 'down');
  if (edge(3)) handleAction('gear');
  if (edge(4)) handleAction('flaps', 'up');
  if (edge(5)) cycleSpoilers();
  if (edge(8)) cycleCamera();
  if (edge(9)) handleAction('pause');
  previousPadButtons = pressed;
  return input;
}

function updateInput() {
  if (!running || state.paused || state.outcome) {
    state.input.pitch = 0;
    state.input.roll = 0;
    state.input.yaw = 0;
    state.input.throttleDelta = 0;
    state.input.brake = 0;
    return;
  }
  const arrowLeft = keys.has('ArrowLeft');
  const arrowRight = keys.has('ArrowRight');
  const groundSteering = state.onGround;
  const input = {
    pitch: (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
      (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0),
    roll: groundSteering ? 0 : (keys.has('KeyD') || arrowRight ? 1 : 0) - (keys.has('KeyA') || arrowLeft ? 1 : 0),
    yaw: (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0) +
      (groundSteering ? (arrowRight ? 1 : 0) - (arrowLeft ? 1 : 0) : 0),
    throttleDelta: (keys.has('PageUp') ? 0.6 : keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.36 : 0) -
      (keys.has('PageDown') ? 0.6 : keys.has('ControlLeft') || keys.has('ControlRight') ? 0.36 : 0),
    brake: keys.has('KeyB') ? 1 : 0,
    pitchTrim: state.input.pitchTrim
  };
  pollGamepad(input);
  state.input.pitch = clamp(input.pitch, -1, 1);
  state.input.roll = clamp(input.roll, -1, 1);
  state.input.yaw = clamp(input.yaw, -1, 1);
  state.input.throttleDelta = clamp(input.throttleDelta, -1, 1);
  state.input.brake = clamp(input.brake, 0, 1);
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function onKeyDown(event) {
  audio.unlock();
  if (isTypingTarget(event.target) || !CONTROL_KEYS.has(event.code)) return;
  event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;

  if (!running && TITLE_KEYS[event.code]) {
    startScenario(TITLE_KEYS[event.code]);
    return;
  }

  const numpadKey = NUMPAD_PATTERN.exec(event.code);
  if (numpadKey) {
    const number = Number(numpadKey[1]);
    if (number >= 1 && number <= 4) {
      if (event.altKey || event.shiftKey) handleAction(`generator${number}`);
      else toggleEngine(number - 1);
      return;
    }
    if (number === 5) { handleAction('antiIce3'); return; }
    if (number === 6) { handleAction('antiIce4'); return; }
    if (number === 7 || number === 8 || number === 9) { handleAction(`electricPump${number - 6}`); return; }
    if (number === 0) { handleAction('electricPump4'); return; }
    return;
  }

  const engineKey = DIGIT_ENGINE_PATTERN.exec(event.code);
  if (engineKey) {
    const index = Number(engineKey[1]) - 1;
    if (event.altKey || event.shiftKey) handleAction(`generator${index + 1}`);
    else if (event.ctrlKey) handleAction(`electricPump${index + 1}`);
    else toggleEngine(index);
    return;
  }

  if (THROTTLE_KEYS.has(event.code)) {
    if (event.code === 'Home' || event.code === 'F1') handleAction('throttleSet', 0);
    else if (event.code === 'End' || event.code === 'F4') handleAction('throttleSet', 1);
    else if (event.code === 'F2') handleAction('throttleStep', -0.05);
    else if (event.code === 'F3') handleAction('throttleStep', 0.05);
    return;
  }

  const digitAction = DIGIT_ACTIONS[event.code];
  if (digitAction) {
    handleAction(digitAction);
    return;
  }
  if (LIGHT_ACTIONS[event.code]) {
    handleAction(LIGHT_ACTIONS[event.code]);
    return;
  }

  switch (event.code) {
    case 'KeyJ': handleAction(event.shiftKey ? 'antiIce4' : 'antiIce2'); break;
    case 'KeyK': handleAction(event.shiftKey ? 'antiIce3' : 'antiIce1'); break;
    case 'KeyF': handleAction('flaps', 'down'); break;
    case 'KeyV': handleAction('flaps', 'up'); break;
    case 'KeyG': handleAction('gear'); break;
    case 'KeyP': handleAction('parkingBrake'); break;
    case 'KeyR': handleAction('reverse'); break;
    case 'KeyX': cycleSpeedBrake(); break;
    case 'KeyY': cycleWeather(); break;
    case 'KeyZ': cycleTimeOfDay(); break;
    case 'Comma': handleAction('pitchTrim', clamp(state.input.pitchTrim - 0.02, -0.5, 0.5)); break;
    case 'Period': handleAction('pitchTrim', clamp(state.input.pitchTrim + 0.02, -0.5, 0.5)); break;
    case 'Space': cycleSpoilers(); break;
    case 'KeyC': cycleCamera(); break;
    case 'Escape':
      if (ui.activeOverlay && ui.activeOverlay !== 'pause') {
        ui.closeOverlay();
        handleAction('back');
      } else {
        handleAction('pause');
      }
      break;
    case 'KeyH':
      if (ui.activeOverlay === 'help') {
        ui.closeOverlay();
        handleAction('back');
      } else {
        ui.showScreen('help');
        handleAction('help');
      }
      break;
    case 'KeyM':
      ui.localSettings.muted = !settings.muted;
      handleAction('mute', !settings.muted);
      ui.syncMute();
      break;
    case 'KeyT': handleAction('tutorial'); break;
    case 'KeyU': {
      const minimal = document.body.classList.toggle('hud-minimal');
      ui.notify(minimal ? '已进入精简 HUD 模式（U 恢复）' : '已恢复完整 HUD 面板', 'info');
      break;
    }
    case 'BracketLeft': handleAction('pitchTrim', clamp(state.input.pitchTrim - 0.02, -0.5, 0.5)); break;
    case 'BracketRight': handleAction('pitchTrim', clamp(state.input.pitchTrim + 0.02, -0.5, 0.5)); break;
    default: break;
  }
}

function onKeyUp(event) {
  keys.delete(event.code);
  if (CONTROL_KEYS.has(event.code) && !isTypingTarget(event.target)) event.preventDefault();
}

function onPointerDown(event) {
  audio.unlock();
  if (!running || state.paused || state.outcome) return;
  if (event.button !== 0 && event.button !== 2) return;
  mouse.pointerId = event.pointerId;
  mouse.startX = event.clientX;
  mouse.startY = event.clientY;
  mouse.moved = 0;
  mouse.picked = event.button === 0 ? world.pick(event.clientX, event.clientY) : null;
  mouse.mode = mouse.picked ? 'click' : 'look';
  if (mouse.mode === 'look') {
    mouse.lookActive = true;
    world.setLook(mouse.lookYaw, mouse.lookPitch, true);
  }
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onPointerMove(event) {
  if (event.pointerId !== mouse.pointerId || mouse.mode !== 'look') return;
  mouse.moved += Math.abs(event.clientX - mouse.startX) + Math.abs(event.clientY - mouse.startY);
  const scale = 0.0035 / clamp(settings.sensitivity, 0.2, 2);
  let yaw = mouse.lookYaw + (event.clientX - mouse.startX) * scale;
  yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  mouse.lookYaw = yaw;
  mouse.lookPitch = clamp(mouse.lookPitch - (event.clientY - mouse.startY) * scale, -1.4, 1.4);
  mouse.startX = event.clientX;
  mouse.startY = event.clientY;
  world.setLook(mouse.lookYaw, mouse.lookPitch, true);
}

function onPointerUp(event) {
  if (event.pointerId !== mouse.pointerId) return;
  const wasClick = mouse.mode === 'click' && mouse.moved < 8;
  if (wasClick && mouse.picked) {
    if (typeof mouse.picked === 'string') handleAction(mouse.picked);
    else handleAction(mouse.picked.action, mouse.picked.value);
  }
  mouse.mode = null;
  mouse.picked = null;
  mouse.pointerId = null;
  mouse.moved = 0;
  mouse.lookActive = false;
}

function onWheel(event) {
  if (isTypingTarget(event.target)) return;
  event.preventDefault();
  const steps = -Math.max(-2, Math.min(2, event.deltaY / 120));
  const zoom = world.adjustZoom(steps);
  const percent = Math.round(zoom * 100);
  if (zoom <= world.minZoom + 1e-3 || zoom >= world.maxZoom - 1e-3) {
    ui.notify(`视角缩放 ${percent}%`, 'info');
  }
}

function advanceSimulation(seconds, input) {
  const duration = clamp(Number(seconds) || 0, 0, 600);
  const previousInput = state.input;
  if (input) state.input = { ...state.input, ...input };
  const steps = Math.round(duration / M.dt);
  for (let index = 0; index < steps; index += 1) stepSimulation(state, state.input, M.dt);
  if (input) state.input = previousInput;
  processMessages();
  return getMissionSnapshot(state);
}

function frame(now) {
  const frameDt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  updateInput();

  if (running && !state.paused && !state.outcome) {
    accumulator += frameDt * clamp(state.simRate || 1, 0.25, 64);
    const maxSteps = 1024;
    let steps = 0;
    while (accumulator >= M.dt && steps < maxSteps) {
      stepSimulation(state, state.input, M.dt);
      accumulator -= M.dt;
      steps += 1;
    }
    if (steps === maxSteps) accumulator = 0;
    processMessages();
    saveTimer += frameDt;
    if (saveTimer >= 12) {
      saveTimer = 0;
      saveGame(state);
    }
  }

  world.update(state, frameDt);
  effects.update(state, state.paused ? 0 : frameDt);
  audio.update(state, frameDt);
  ui.update(state);
  world.render();
  requestAnimationFrame(frame);
}

window.addEventListener('keydown', onKeyDown, { passive: false });
window.addEventListener('keyup', onKeyUp, { passive: false });
window.addEventListener('blur', () => {
  clearInput();
  if (running && !state.outcome) state.paused = true;
});
window.addEventListener('resize', () => world.resize(), { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running && !state.outcome) {
    state.paused = true;
    saveGame(state);
  }
});
Object.defineProperty(window, '__flightSim', {
  value: Object.freeze({
    get state() { return state; },
    get running() { return running; },
    start: startScenario,
    action: handleAction,
    step: advanceSimulation,
    snapshot: () => getMissionSnapshot(state),
    setSimRate(rate) { state.simRate = clamp(Number(rate) || 1, 0.25, 64); },
    save: () => saveGame(state),
    load: continueSavedFlight,
    clearSave,
    get world() { return world; },
    get aircraftType() { return currentAircraftType; },
    spec: () => getAircraftType(currentAircraftType),
    selectAircraft,
    ui
  }),
  configurable: false,
  writable: false
});

if (!world.webglAvailable) ui.notify('3D 画面初始化失败，请检查浏览器硬件加速设置', 'red');
requestAnimationFrame(frame);
