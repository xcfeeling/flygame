import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { M, clamp, knots, terrainHeight } from '../src/sim/config.js';
import { getAircraftType } from '../src/sim/aircraftTypes.js';
import { performAction, stepSimulation } from '../src/sim/simulation.js';
import { computeAerodynamics } from '../src/sim/dynamics.js';
import { updateConfiguration } from '../src/sim/systems.js';
import { makeAirborne, makeRunning, runFor, setFlaps } from './helpers.js';

function flyTakeoff(options = {}) {
  const state = createInitialState({ windSpeed: options.windSpeed ?? 0, windDirection: options.windDirection ?? 180, aircraftType: options.aircraftType });
  const spec = getAircraftType(state.aircraft.type);
  const weight = options.weight ?? state.weight;
  const flaps = options.flaps ?? spec.takeoffFlap;
  const rotateKnots = options.rotateKnots ?? spec.vr;
  makeRunning(state, { n1: 1, weight });
  setFlaps(state, flaps);
  performAction(state, 'throttle', 1);
  let steps = 0;
  while (state.onGround && state.status !== 'failed' && steps < 120 * 140) {
    state.input.pitch = knots(state.airspeed) >= rotateKnots
      ? clamp((0.15 - state.pitch) * 2, -0.2, 0.35)
      : 0;
    stepSimulation(state);
    steps += 1;
  }
  return state;
}

test('747 起飞构型可在跑道内离地并记录实际离地速度', () => {
  const state = flyTakeoff();
  assert.equal(state.status === 'failed', false, state.outcomeDetail);
  assert.equal(state.engines.length, 4);
  assert.equal(state.onGround, false);
  assert.ok(state.stats.liftoffSpeed > 60);
  assert.equal(state.mission.phase, 'climb');
  assert.ok(state.pos.z < 1800);
  assert.ok(state.radioAltitude > 0);
});

test('重量增加会提高离地速度或延长滑跑', () => {
  const light = flyTakeoff({ weight: 240000, flaps: 10 });
  const heavy = flyTakeoff({ weight: 345000, flaps: 10 });
  assert.equal(light.onGround, false);
  assert.equal(heavy.onGround, false);
  const lightDistance = light.pos.z + 1700;
  const heavyDistance = heavy.pos.z + 1700;
  assert.ok(
    heavy.stats.liftoffSpeed > light.stats.liftoffSpeed + 1 || heavyDistance > lightDistance + 60,
    `light ${light.stats.liftoffSpeed} m/s ${lightDistance} m, heavy ${heavy.stats.liftoffSpeed} m/s ${heavyDistance} m`
  );
});

test('顺风会延长起飞滑跑并提高离地速度', () => {
  const still = flyTakeoff({ weight: 300000, flaps: 10, windSpeed: 0 });
  const tailwind = flyTakeoff({ weight: 300000, flaps: 10, windSpeed: 8, windDirection: 180 });
  assert.equal(still.onGround, false);
  assert.equal(tailwind.onGround, false);
  const stillDistance = still.pos.z + 1700;
  const tailwindDistance = tailwind.pos.z + 1700;
  assert.ok(
    tailwindDistance > stillDistance + 20 || tailwind.stats.liftoffSpeed > still.stats.liftoffSpeed + 1,
    `still ${still.stats.liftoffSpeed} m/s ${stillDistance} m, tailwind ${tailwind.stats.liftoffSpeed} m/s ${tailwindDistance} m`
  );
});

test('起飞襟翼增加会改变离地速度或滑跑距离', () => {
  const flap10 = flyTakeoff({ weight: 300000, flaps: 10 });
  const flap25 = flyTakeoff({ weight: 300000, flaps: 25 });
  assert.equal(flap10.onGround, false);
  assert.equal(flap25.onGround, false);
  const speedDifference = Math.abs(flap10.stats.liftoffSpeed - flap25.stats.liftoffSpeed);
  const distanceDifference = Math.abs((flap10.pos.z + 1700) - (flap25.pos.z + 1700));
  assert.ok(speedDifference > 0.5 || distanceDifference > 30, `${speedDifference}, ${distanceDifference}`);
});

test('超过失速迎角后升力衰减并触发警告', () => {
  const stalled = createInitialState({ windSpeed: 0 });
  const spec = getAircraftType(stalled.aircraft.type);
  makeAirborne(stalled, { speed: 90, pitch: 0.4 });
  setFlaps(stalled, 0);
  computeAerodynamics(stalled);
  assert.ok(stalled.alpha > spec.alphaStall);
  assert.equal(stalled.stalled, true);
  assert.equal(stalled.stallWarning, true);
  assert.ok(stalled.debug.stallFactor < 1);

  const attached = createInitialState({ windSpeed: 0 });
  makeAirborne(attached, { speed: 90, pitch: 0.16 });
  setFlaps(attached, 0);
  computeAerodynamics(attached);
  assert.equal(attached.stalled, false);
  assert.ok(stalled.debug.cL < attached.debug.cL);
});

test('动压随空气密度变化并包含马赫压缩修正', () => {
  const low = createInitialState({ windSpeed: 0 });
  const spec = getAircraftType(low.aircraft.type);
  makeAirborne(low, { y: 0, speed: 200, pitch: 0.1 });
  computeAerodynamics(low);
  const high = createInitialState({ windSpeed: 0 });
  makeAirborne(high, { y: 10000, speed: 200, pitch: 0.1 });
  computeAerodynamics(high);
  assert.ok(high.q < low.q * 0.45);
  assert.ok(high.mach > low.mach);
  assert.ok(high.debug.cL / ((spec.cLAlpha * high.alpha + spec.cLAlpha0)) > 1);
});

test('草地滚阻显著高于跑道滚阻', () => {
  function rollingState(x) {
    const state = createInitialState({ windSpeed: 0 });
    makeRunning(state, { n1: 0.22 });
    for (const engine of state.engines) {
      engine.running = false;
      engine.n1 = 0;
    }
    state.systems.generators = state.systems.generators.map(() => false);
    state.pos = { x, y: terrainHeight(x, 0), z: 0 };
    state.vel.z = 25;
    state.onGround = true;
    return state;
  }
  const runway = rollingState(0);
  const grass = rollingState(500);
  runFor(runway, 2);
  runFor(grass, 2);
  assert.ok(grass.groundSpeed < runway.groundSpeed - 1, `runway ${runway.groundSpeed}, grass ${grass.groundSpeed}`);
});

test('襟翼和起落架超速会造成持续结构损伤', () => {
  const state = createInitialState({ windSpeed: 0 });
  const spec = getAircraftType(state.aircraft.type);
  makeAirborne(state, { speed: spec.maxFlapSpeed / 1.94384449 + 60, gear: 1 });
  setFlaps(state, spec.landingFlap);
  state.airspeed = spec.maxFlapSpeed / 1.94384449 + 60;
  for (let index = 0; index < 120; index += 1) {
    updateConfiguration(state, M.dt);
    state.airspeed = spec.maxFlapSpeed / 1.94384449 + 60;
  }
  assert.ok(state.damage.wings > 0);
  assert.ok(state.damage.gear > 0);
});

test('零输入和零姿态长时步进保持有限数值', () => {
  const state = createInitialState({ windSpeed: 0 });
  state.input = { pitch: 0, roll: 0, yaw: 0, throttleDelta: 0, brake: 0, pitchTrim: 0 };
  runFor(state, 10);
  function assertFinite(value) {
    assert.ok(Number.isFinite(value), `not finite: ${value}`);
  }
  assertFinite(state.pos.x);
  assertFinite(state.pos.y);
  assertFinite(state.pos.z);
  assertFinite(state.vel.x);
  assertFinite(state.vel.y);
  assertFinite(state.vel.z);
  assertFinite(state.pitch);
  assertFinite(state.roll);
  assertFinite(state.airspeed);
});
