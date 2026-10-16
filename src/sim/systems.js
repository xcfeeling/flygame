import { M, clamp, knots, lerp } from './config.js';
import { getAircraftParams, listAircraftTypes } from './aircraftTypes.js';

const BASE_SYSTEM_ACTIONS = new Set([
  'battery',
  'externalPower',
  'avionics',
  'apu',
  'apuBleed',
  'bleedAir',
  'packOff',
  'flaps',
  'gear',
  'reverse'
]);
const ENGINE_ACTION_PATTERN = /^(startEngine|generator|electricPump|antiIce)([1-9]\d*)$/;
const MAX_ENGINE_COUNT = Math.max(...listAircraftTypes().map((spec) => spec.engineCount));

function parseEngineAction(action) {
  const match = ENGINE_ACTION_PATTERN.exec(action);
  if (!match) return null;
  return { kind: match[1], index: Number(match[2]) - 1 };
}

function hasHydraulicPower(state) {
  return state.systems.hydraulic.some(Boolean);
}

function booleanValue(current, value) {
  return typeof value === 'boolean' ? value : !current;
}

function setActionResult(state, action, accepted, reason = '') {
  state.lastAction = { action, accepted, reason, time: state.time };
  return accepted;
}

function accept(state, action) {
  return setActionResult(state, action, true, '');
}

function reject(state, action, reason, engine = null) {
  if (engine) engine.startReason = reason;
  pushMessage(state, reason, 'warning');
  return setActionResult(state, action, false, reason);
}

export function pushMessage(state, text, kind = 'info') {
  if (!text) return;
  if (!Array.isArray(state.messages)) state.messages = [];
  const previous = state.messages[state.messages.length - 1];
  if (previous && previous.text === text && state.time - previous.time < 2) return;
  state.messages.push({
    id: (state.messageSequence = (state.messageSequence ?? 0) + 1),
    text,
    kind,
    time: state.time
  });
  if (state.messages.length > 50) state.messages.splice(0, state.messages.length - 50);
}

export function addWarning(state, text) {
  if (!Array.isArray(state.systems.warnings)) state.systems.warnings = [];
  if (!state.systems.warnings.includes(text)) state.systems.warnings.push(text);
}

export function hasElectricalPower(state) {
  return Boolean(
    state.systems.battery ||
    state.systems.externalPower ||
    state.systems.generators.some(Boolean)
  );
}

export function hasBleedPressure(state) {
  const apuPressure = state.systems.apu.available && state.systems.apu.bleed;
  const enginePressure = state.engines.some((engine) => engine.running && engine.n1 >= 0.2);
  return Boolean(apuPressure || (state.systems.bleedAir && enginePressure));
}

function engineStartReason(state, index) {
  const engineNumber = index + 1;
  if (!state.systems.electricPumps[index]) {
    const pump = index === 0 ? '左' : index === 1 ? '右' : `${engineNumber} 号`;
    return `${pump}电泵未接通，无法启动发动机 ${engineNumber}`;
  }
  if (!state.systems.packOff) return '组件（PACK）未关闭，禁止启动发动机';
  if (index === 0) {
    if (!state.systems.apu.available) return 'APU 尚未可用，无法启动发动机 1';
    if (!state.systems.apu.bleed || !hasBleedPressure(state)) {
      return 'APU 引气未接通或无引气压力，无法启动发动机 1';
    }
  } else {
    const apuReady = state.systems.apu.available && state.systems.apu.bleed;
    if (!state.systems.generators.some(Boolean) && !apuReady) {
      return `需要至少一台发电机或可用 APU，无法启动发动机 ${engineNumber}`;
    }
    if (!state.systems.bleedAir) return `发动机引气电门未接通，无法启动发动机 ${engineNumber}`;
    if (!hasBleedPressure(state)) return `无引气压力，无法启动发动机 ${engineNumber}`;
  }
  if (state.fuel.qty <= 0) return '燃油不足，无法启动发动机';
  return '';
}

function startEngine(state, index, action, value) {
  const engine = state.engines[index];
  if (value === false) {
    engine.running = false;
    engine.starter = false;
    engine.starterTimer = 0;
    engine.startReason = '发动机已关车';
    state.systems.generators[index] = false;
    return accept(state, action);
  }
  if (engine.failed) return reject(state, action, `发动机 ${index + 1} 已损坏，无法启动`, engine);
  if (engine.running) return reject(state, action, `发动机 ${index + 1} 已在运转`, engine);
  const reason = engineStartReason(state, index);
  if (reason) return reject(state, action, reason, engine);
  engine.running = true;
  engine.starter = true;
  engine.starterTimer = 0;
  engine.startReason = '启动机已接通，N1 上升中';
  pushMessage(state, `发动机 ${index + 1} 启动：点火与供油正常`, 'success');
  return accept(state, action);
}

function setFlaps(state, value) {
  const params = getAircraftParams(state);
  const settings = params.flapSettings;
  const flaps = state.flaps;
  let target;
  if (value === undefined) value = 'down';
  if (typeof value === 'string') {
    const currentIndex = settings.reduce(
      (best, setting, index) =>
        Math.abs(setting - flaps.target) < Math.abs(settings[best] - flaps.target) ? index : best,
      0
    );
    const delta = value === 'up' ? -1 : 1;
    target = settings[clamp(currentIndex + delta, 0, settings.length - 1)];
  } else {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return reject(state, 'flaps', '襟翼目标值无效');
    target = settings.reduce((best, setting) =>
      Math.abs(setting - numeric) < Math.abs(best - numeric) ? setting : best
    , settings[0]);
  }
  if (!hasElectricalPower(state)) return reject(state, 'flaps', '无可用电源，襟翼无法作动');
  if (!hasHydraulicPower(state)) {
    return reject(state, 'flaps', '液压压力不足，襟翼无法作动');
  }
  if (flaps.fault) return reject(state, 'flaps', '襟翼系统损伤，无法作动');
  if (target === flaps.target && !flaps.moving) return accept(state, 'flaps');
  flaps.fromLeft = flaps.left;
  flaps.fromRight = flaps.right;
  flaps.target = target;
  flaps.elapsed = 0;
  flaps.moving = true;
  state.controls.flapTarget = target;
  pushMessage(state, `襟翼目标 ${target}°，作动约 ${params.flapTransitionTime} 秒`);
  return accept(state, 'flaps');
}

function setGear(state, value) {
  const params = getAircraftParams(state);
  let down;
  if (value === 'down') down = true;
  else if (value === 'up') down = false;
  else if (typeof value === 'number') down = value > 0;
  else if (typeof value === 'boolean') down = value;
  else down = !(state.gear.target > 0.5);
  if (!down && state.onGround) return reject(state, 'gear', '飞机在地面，起落架收上被联锁');
  if (!hasHydraulicPower(state)) {
    return reject(state, 'gear', '液压压力不足，起落架无法作动');
  }
  const target = down ? 1 : 0;
  if (target === state.gear.target && !state.gear.moving) return accept(state, 'gear');
  state.gear.startPosition = state.gear.position;
  state.gear.target = target;
  state.gear.transition = 0;
  state.gear.moving = true;
  state.gear.inTransit = true;
  state.gear.locked = false;
  pushMessage(state, `起落架${down ? '放下' : '收上'}，作动约 ${params.gearTransitionTime} 秒`);
  return accept(state, 'gear');
}

function setReverse(state, value) {
  const requested = booleanValue(state.controls.reverse, value);
  if (!requested) {
    state.controls.reverse = false;
    return accept(state, 'reverse');
  }
  if (!state.onGround) return reject(state, 'reverse', '反推仅可在地面使用');
  if (state.controls.throttle > 0.03) return reject(state, 'reverse', '油门不在慢车位，反推被联锁');
  if (!state.engines.every((engine) => engine.running)) {
    return reject(state, 'reverse', `${state.engines.length} 台发动机未全部运转，反推被联锁`);
  }
  if (!state.systems.groundSpoilers) return reject(state, 'reverse', '地面扰流板未展开或不可用，反推被联锁');
  if (!hasHydraulicPower(state)) {
    return reject(state, 'reverse', '液压压力不足，反推被联锁');
  }
  state.controls.reverse = true;
  pushMessage(state, '反推已解锁，N1 将随反推手柄上升', 'success');
  return accept(state, 'reverse');
}

function performEngineAction(state, action, value, engineAction) {
  const { kind, index } = engineAction;
  const engine = state.engines[index];
  if (kind === 'startEngine') return startEngine(state, index, action, value);
  if (kind === 'electricPump') {
    const requested = booleanValue(state.systems.electricPumps[index], value);
    if (requested && !hasElectricalPower(state)) {
      return reject(state, action, '无可用电源，电泵无法接通');
    }
    state.systems.electricPumps[index] = requested;
    return accept(state, action);
  }
  if (kind === 'generator') {
    const requested = booleanValue(state.systems.generators[index], value);
    if (requested && (!engine.running || engine.n1 < 0.2)) {
      return reject(state, action, `发动机 ${index + 1} 转速不足，发电机无法接入`);
    }
    state.systems.generators[index] = requested;
    return accept(state, action);
  }
  const requested = booleanValue(engine.antiIce, value);
  if (requested && (!engine.running || !hasElectricalPower(state))) {
    return reject(state, action, `发动机 ${index + 1} 防冰需要电源和发动机引气`);
  }
  engine.antiIce = requested;
  return accept(state, action);
}

export function performSystemAction(state, action, value) {
  const engineAction = parseEngineAction(action);
  if (engineAction && engineAction.index < state.engines.length) {
    return { handled: true, accepted: performEngineAction(state, action, value, engineAction) };
  }
  if (!BASE_SYSTEM_ACTIONS.has(action)) return { handled: false, accepted: false };
  let accepted;
  switch (action) {
    case 'battery':
      state.systems.battery = booleanValue(state.systems.battery, value);
      accepted = accept(state, action);
      break;
    case 'externalPower':
      state.systems.externalPower = booleanValue(state.systems.externalPower, value);
      accepted = accept(state, action);
      break;
    case 'avionics':
      if (booleanValue(state.systems.avionics, value) && !hasElectricalPower(state)) {
        accepted = reject(state, action, '无可用电源，航空电子设备无法接通');
      } else {
        state.systems.avionics = booleanValue(state.systems.avionics, value);
        accepted = accept(state, action);
      }
      break;
    case 'apu': {
      const requested = booleanValue(state.systems.apu.switch, value);
      if (requested && !hasElectricalPower(state)) {
        accepted = reject(state, action, '请先接通电瓶或外部电源，再启动 APU');
      } else {
        state.systems.apu.switch = requested;
        state.systems.apu.starter = requested;
        if (!requested) {
          state.systems.apu.bleed = false;
          state.systems.apu.available = false;
        }
        accepted = accept(state, action);
      }
      break;
    }
    case 'apuBleed':
      if (booleanValue(state.systems.apu.bleed, value) && !state.systems.apu.available) {
        accepted = reject(state, action, 'APU 尚未达到可用转速，引气无压力');
      } else {
        state.systems.apu.bleed = booleanValue(state.systems.apu.bleed, value);
        accepted = accept(state, action);
      }
      break;
    case 'bleedAir':
      state.systems.bleedAir = booleanValue(state.systems.bleedAir, value);
      accepted = accept(state, action);
      if (state.systems.bleedAir && !hasBleedPressure(state)) {
        pushMessage(state, '引气电门已接通，但当前无引气压力', 'warning');
      }
      break;
    case 'packOff':
      state.systems.packOff = booleanValue(state.systems.packOff, value);
      accepted = accept(state, action);
      break;
    case 'flaps':
      accepted = setFlaps(state, value);
      break;
    case 'gear':
      accepted = setGear(state, value);
      break;
    case 'reverse':
      accepted = setReverse(state, value);
      break;
    default:
      accepted = false;
  }
  return { handled: true, accepted };
}

function updateApu(state, dt) {
  const apu = state.systems.apu;
  const rate = apu.switch ? 1 / 6 : 1 / 2.5;
  apu.rpm = clamp(apu.rpm + (apu.switch ? rate : -rate) * dt, 0, 1);
  apu.timer = apu.switch ? apu.timer + dt : 0;
  apu.available = apu.switch && apu.rpm >= 0.95;
  apu.starter = apu.switch && !apu.available;
  if (!apu.available) apu.bleed = false;
  return apu.rpm > 0.02 ? 0.055 + apu.rpm * 0.055 : 0;
}

function updateEngine(state, engine, dt) {
  const params = getAircraftParams(state);
  if (state.fuel.qty <= 0 && engine.running) {
    engine.running = false;
    engine.starter = false;
    engine.startReason = '燃油耗尽，发动机停车';
    pushMessage(state, `发动机 ${engine.id} 燃油耗尽停车`, 'warning');
  }
  if (engine.starter) {
    engine.starterTimer += dt;
    if (!hasBleedPressure(state) && engine.n1 < 0.2) {
      engine.starter = false;
      engine.running = false;
      engine.startReason = '启动中引气压力丧失，启动中止';
      pushMessage(state, `发动机 ${engine.id} 启动中止：无引气压力`, 'warning');
    }
  }
  const reverserTarget = state.controls.reverse && engine.running && state.onGround ? 1 : 0;
  engine.reverser = clamp(engine.reverser + Math.sign(reverserTarget - engine.reverser) * dt * 1.8, 0, 1);
  const idleN1 = 0.22;
  const throttleTarget = engine.running ? idleN1 + (1 - idleN1) * state.controls.throttle : 0;
  const reverseTarget = engine.running && engine.reverser > 0
    ? idleN1 + (params.reverseMinN1 - idleN1) * engine.reverser
    : 0;
  const target = Math.max(throttleTarget, reverseTarget);
  let rate = target > engine.n1 ? 0.16 : 0.22;
  if (engine.running && engine.n1 < idleN1) rate = 0.045;
  const delta = clamp(target - engine.n1, -rate * dt, rate * dt);
  engine.n1 = clamp(engine.n1 + delta, 0, 1.08);
  if (engine.starter && engine.n1 >= idleN1 * 0.98) {
    engine.starter = false;
    engine.startReason = '慢车稳定';
    pushMessage(state, `发动机 ${engine.id} 启动完成，慢车稳定`, 'success');
  }
  engine.n2 = clamp(engine.n2 + (engine.n1 * 1.12 - engine.n2) * Math.min(1, dt * 1.5), 0, 1.1);
  const antiIcePenalty = engine.antiIce ? 1.04 : 1;
  engine.fuelFlow = engine.running ? (0.065 + 0.73 * Math.pow(engine.n1, 2.6)) * antiIcePenalty : 0;
  const fireEgt = engine.fire ? 180 : 0;
  const targetEgt = engine.running ? 285 + 480 * Math.pow(engine.n1, 1.8) + fireEgt : state.environment.temperature;
  engine.egt += (targetEgt - engine.egt) * Math.min(1, dt * (engine.running ? 0.8 : 0.08));
  engine.oilTemp += ((engine.running ? 55 + engine.n1 * 65 : state.environment.temperature) - engine.oilTemp) * Math.min(1, dt * 0.05);
  engine.oilPressure = engine.running ? clamp(1.2 + engine.n1 * 4.2, 0, 6) : Math.max(0, engine.oilPressure - dt);
  return engine.fuelFlow;
}

function updateFlaps(state, dt) {
  const params = getAircraftParams(state);
  const flaps = state.flaps;
  if (flaps.moving) {
    flaps.elapsed = (flaps.elapsed ?? 0) + dt;
    const progress = clamp(flaps.elapsed / params.flapTransitionTime, 0, 1);
    flaps.left = lerp(flaps.fromLeft ?? flaps.left, flaps.target, progress);
    flaps.right = lerp(flaps.fromRight ?? flaps.right, flaps.target, progress);
    if (progress >= 1) {
      flaps.left = flaps.target;
      flaps.right = flaps.target;
      flaps.moving = false;
    }
  }
  state.controls.flaps = (flaps.left + flaps.right) * 0.5;
  state.slats.left = clamp(flaps.left / 5, 0, 1);
  state.slats.right = clamp(flaps.right / 5, 0, 1);
  if (state.controls.flaps > 0.1 && knots(state.airspeed) > params.maxFlapSpeed) {
    const excess = knots(state.airspeed) - params.maxFlapSpeed;
    state.damage.wings = clamp(state.damage.wings + dt * (0.015 + excess * 0.0008), 0, 1.2);
    if (state.damage.wings > 0.65) flaps.fault = true;
    addWarning(state, '襟翼超速：翼面正在受损');
  }
}

function updateGear(state, dt) {
  const params = getAircraftParams(state);
  const gear = state.gear;
  if (gear.moving) {
    gear.transition = clamp(gear.transition + dt / params.gearTransitionTime, 0, 1);
    gear.position = lerp(gear.startPosition ?? gear.position, gear.target, gear.transition);
    gear.doors = Math.sin(Math.PI * gear.transition);
    if (gear.transition >= 1) {
      gear.position = gear.target;
      gear.moving = false;
      gear.inTransit = false;
      gear.locked = true;
      gear.doors = 0;
    }
  }
  state.controls.gear = gear.moving ? 'transit' : gear.position > 0.5 ? 'down' : 'up';
  state.systems.gearValve = gear.moving ? 1 : 0;
  if (gear.position > 0.02 && knots(state.airspeed) > params.maxGearSpeed) {
    state.damage.gear = clamp(state.damage.gear + dt * 0.035, 0, 1.2);
    addWarning(state, '起落架超速：结构正在受损');
  }
}

export function updateConfiguration(state, dt) {
  updateFlaps(state, dt);
  updateGear(state, dt);
}

export function updateSystems(state, dt) {
  const params = getAircraftParams(state);
  const engineCount = state.engines.length;
  state.systems.warnings = [];
  state.systems.brakeTemps ??= [];
  for (let index = 0; index < engineCount; index += 1) {
    if (!Number.isFinite(state.systems.brakeTemps[index])) {
      state.systems.brakeTemps[index] = state.environment.temperature;
    }
  }
  state.systems.electricalPower = hasElectricalPower(state);
  const apuBurn = updateApu(state, dt);
  let fuelBurn = apuBurn * dt;
  for (const engine of state.engines) {
    fuelBurn += updateEngine(state, engine, dt) * dt;
    if (engine.fire) addWarning(state, `发动机 ${engine.id} 火警`);
  }
  if (fuelBurn > 0 && state.fuel.qty > 0) {
    const availableBurn = Math.min(fuelBurn, state.fuel.qty * params.fuelDensity);
    state.fuel.qty = Math.max(0, state.fuel.qty - availableBurn / params.fuelDensity);
    state.fuel.burn += availableBurn;
    state.weight = Math.max(params.emptyMass, state.weight - availableBurn);
  }
  for (let index = 0; index < engineCount; index += 1) {
    if (state.systems.generators[index] && (!state.engines[index].running || state.engines[index].n1 < 0.18)) {
      state.systems.generators[index] = false;
    }
  }
  state.systems.electricalPower = hasElectricalPower(state);
  state.systems.bleedPressure = hasBleedPressure(state) ? 1 : 0;
  for (let index = 0; index < engineCount; index += 1) {
    state.systems.hydraulic[index] = Boolean(
      (state.engines[index].running && state.engines[index].n1 >= 0.2) ||
      (state.systems.electricPumps[index] && state.systems.electricalPower)
    );
  }
  if (state.controls.reverse && (
    !state.onGround ||
    state.controls.throttle > 0.03 ||
    !state.systems.groundSpoilers ||
    !state.engines.every((engine) => engine.running)
  )) {
    state.controls.reverse = false;
    pushMessage(state, '反推联锁条件不再满足，反推已收回', 'warning');
  }
  const spoilers = state.controls.spoilers;
  const hydraulic = hasHydraulicPower(state);
  const groundSpoilersWereDeployed = state.systems.groundSpoilers;
  state.systems.groundSpoilers = Boolean(
    hydraulic && state.onGround && state.controls.throttle <= 0.05 &&
    (spoilers === 'ground' || spoilers === 'deployed' ||
      (spoilers === 'armed' && (!state.wasOnGround || groundSpoilersWereDeployed)))
  );
  state.systems.speedBrake = spoilers === 'speedbrake' && hydraulic ? 1 : 0;
  updateConfiguration(state, dt);
  const braking = Math.max(state.controls.brake, state.input?.brake ?? 0, state.controls.parkingBrake ? 1 : 0);
  const heat = braking * state.groundSpeed * 0.055;
  for (let index = 0; index < engineCount; index += 1) {
    const cooling = (state.systems.brakeTemps[index] - state.environment.temperature) * 0.012;
    state.systems.brakeTemps[index] = Math.max(
      state.environment.temperature,
      state.systems.brakeTemps[index] + (heat - cooling) * dt
    );
  }
  if (Math.max(...state.systems.brakeTemps) > 420) addWarning(state, '刹车温度过高，制动力下降');
  const packsOn = !state.systems.packOff && state.systems.bleedPressure > 0;
  const targetCockpit = packsOn ? 22 : state.environment.temperature;
  state.systems.cockpitHeat += (targetCockpit - state.systems.cockpitHeat) * Math.min(1, dt * 0.02);
  state.systems.packTemp = packsOn ? 18 : state.environment.temperature;
  state.systems.stickShaker = state.stallWarning ? 1 : Math.max(0, state.systems.stickShaker - dt * 3);
  state.systems.rudderLimiter = state.airspeed > 150 ? 0.35 : 1;
  if (state.fuel.qty < state.fuel.initial * 0.1) addWarning(state, '燃油量低');
}

export function isSystemAction(action) {
  if (BASE_SYSTEM_ACTIONS.has(action)) return true;
  const engineAction = parseEngineAction(action);
  return Boolean(engineAction && engineAction.index < MAX_ENGINE_COUNT);
}
