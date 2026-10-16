import { createInitialState } from './state.js';
import { metersPerSecond, terrainHeight } from './config.js';
import { getAircraftParams } from './aircraftTypes.js';

function setPhase(state, phase, title, objective, radio) {
  state.status = phase;
  state.mission.phase = phase;
  state.mission.title = title;
  state.mission.objective = objective;
  state.mission.radio = radio;
  state.mission.radioTimer = 6;
  state.mission.phaseTimer = 0;
}

function prepareAircraft(state, flapSetting) {
  state.systems.battery = true;
  state.systems.avionics = true;
  state.systems.externalPower = false;
  state.systems.generators = state.engines.map(() => true);
  state.systems.electricPumps = state.engines.map(() => true);
  state.systems.hydraulic = state.engines.map(() => true);
  state.systems.bleedAir = true;
  state.systems.bleedPressure = 1;
  state.systems.packOff = false;
  state.systems.navLights = true;
  state.systems.beacon = true;
  state.systems.probeHeat = true;
  state.systems.windowHeat = true;
  for (const engine of state.engines) {
    engine.running = true;
    engine.starter = false;
    engine.n1 = 0.24;
    engine.n2 = 0.72;
    engine.egt = 330;
    engine.oilTemp = 58;
    engine.oilPressure = 2.2;
    engine.startReason = '慢车稳定';
  }
  state.flaps.left = flapSetting;
  state.flaps.right = flapSetting;
  state.flaps.target = flapSetting;
  state.flaps.moving = false;
  state.controls.flaps = flapSetting;
  state.controls.flapTarget = flapSetting;
  state.slats.left = flapSetting > 0 ? 1 : 0;
  state.slats.right = flapSetting > 0 ? 1 : 0;
  state.gear.position = 1;
  state.gear.target = 1;
  state.gear.locked = true;
  state.gear.moving = false;
  state.controls.gear = 'down';
  state.controls.spoilers = 'armed';
  state.controls.parkingBrake = true;
}

export function createScenario(name = 'cold', options = {}) {
  const state = createInitialState(options);
  const params = getAircraftParams(state);
  state.camera = 'cockpit';
  if (name === 'cold') {
    state.pos = { x: -280, y: terrainHeight(-280, 1600), z: 1600 };
    state.heading = Math.PI / 2;
    setPhase(
      state,
      'cold',
      '冷舱准备',
      '接通主电瓶与外部电源',
      '云岭地面，CZ3261，停机位 6，开始冷舱准备。'
    );
    return state;
  }

  if (name === 'approach') {
    prepareAircraft(state, params.landingFlap);
    const landingFuel = Math.min(40000, params.initialFuel);
    state.fuel.qty = landingFuel;
    state.fuel.initial = landingFuel;
    state.weight = params.emptyMass + landingFuel * params.fuelDensity + params.payload;
    const approachSpeed = metersPerSecond(params.vApp25);
    const sink = -3.7;
    state.pos = { x: 0, y: 180, z: -5200 };
    state.vel = { x: 0, y: sink, z: Math.sqrt(approachSpeed * approachSpeed - sink * sink) };
    state.pitch = 0.14;
    state.onGround = false;
    state.wasOnGround = false;
    state.controls.parkingBrake = false;
    state.controls.throttle = 0.58;
    state.systems.landingLights = true;
    state.mission.clearedForLanding = true;
    setPhase(
      state,
      'approach',
      '五边进近',
      `保持约 ${params.vApp25} 节、3° 下滑道，着陆前襟翼 ${params.landingFlap}°；下降率过大时立即复飞`,
      '云岭塔台，CZ3261 五边，跑道 36，可以着陆。'
    );
    return state;
  }

  prepareAircraft(state, params.takeoffFlap);
  state.pos = { x: 0, y: 0, z: -1700 };
  state.heading = 0;
  state.systems.landingLights = true;
  state.mission.clearedForTakeoff = true;
  setPhase(
    state,
    'takeoff',
    '起飞',
    `松开停留刹车，起飞油门；约 ${params.vr} 节柔和抬轮`,
    '云岭塔台，CZ3261 进入跑道 36，可以起飞。'
  );
  return state;
}
