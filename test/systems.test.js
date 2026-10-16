import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { M } from '../src/sim/config.js';
import { performAction, stepSimulation } from '../src/sim/simulation.js';
import { updateConfiguration } from '../src/sim/systems.js';
import { makeAirborne, makeRunning, runFor } from './helpers.js';

function prepareEngineOneStart(state) {
  performAction(state, 'battery', true);
  performAction(state, 'externalPower', true);
  state.systems.apu.switch = true;
  state.systems.apu.rpm = 1;
  state.systems.apu.available = true;
  state.systems.apu.bleed = true;
  state.systems.electricPumps[0] = true;
  state.systems.packOff = true;
}

test('冷舱错误顺序启动被拒绝并给出中文原因', () => {
  const state = createInitialState();
  performAction(state, 'startEngine1', true);
  assert.equal(state.engines[0].running, false);
  assert.equal(state.lastAction.accepted, false);
  assert.match(state.lastAction.reason, /左电泵/);

  prepareEngineOneStart(state);
  state.systems.packOff = false;
  performAction(state, 'startEngine1', true);
  assert.match(state.lastAction.reason, /PACK.*未关闭/);
  assert.equal(state.engines[0].running, false);

  state.systems.packOff = true;
  state.systems.apu.bleed = false;
  performAction(state, 'startEngine1', true);
  assert.match(state.lastAction.reason, /引气/);
  assert.equal(state.engines[0].running, false);
});

test('APU 未就绪时引气和发动机 2 无压启动均有可见拒绝原因', () => {
  const state = createInitialState();
  performAction(state, 'battery', true);
  performAction(state, 'apu', true);
  performAction(state, 'apuBleed', true);
  assert.equal(state.lastAction.accepted, false);
  assert.match(state.lastAction.reason, /APU.*引气无压力/);

  state.systems.externalPower = true;
  state.systems.electricPumps[1] = true;
  state.systems.packOff = true;
  state.systems.generators[0] = true;
  state.systems.bleedAir = true;
  performAction(state, 'startEngine2', true);
  assert.equal(state.lastAction.accepted, false);
  assert.match(state.lastAction.reason, /无引气压力/);
});

test('合理冷舱顺序可完成四发启动、发电和燃油消耗', () => {
  const state = createInitialState({ windSpeed: 0 });
  assert.equal(state.engines.length, 4);
  performAction(state, 'battery', true);
  performAction(state, 'externalPower', true);
  performAction(state, 'avionics', true);
  performAction(state, 'apu', true);
  runFor(state, 6.2);
  assert.equal(state.systems.apu.available, true);
  performAction(state, 'apuBleed', true);
  performAction(state, 'electricPump1', true);
  performAction(state, 'packOff', true);
  performAction(state, 'startEngine1', true);
  assert.equal(state.lastAction.accepted, true, state.lastAction.reason);
  runFor(state, 5.6);
  assert.equal(state.engines[0].running, true);
  assert.ok(state.engines[0].n1 >= 0.2);

  performAction(state, 'generator1', true);
  assert.equal(state.lastAction.accepted, true);
  performAction(state, 'bleedAir', true);
  for (let index = 1; index < 4; index += 1) {
    performAction(state, `electricPump${index + 1}`, true);
    performAction(state, `startEngine${index + 1}`, true);
    assert.equal(state.lastAction.accepted, true, state.lastAction.reason);
    runFor(state, 5.6);
    performAction(state, `generator${index + 1}`, true);
    assert.equal(state.lastAction.accepted, true, state.lastAction.reason);
  }

  assert.ok(state.engines.every((engine) => engine.running && engine.n1 >= 0.2));
  assert.deepEqual(state.systems.generators, [true, true, true, true]);
  assert.deepEqual(state.systems.hydraulic, [true, true, true, true]);
  assert.ok(state.fuel.burn > 0);
  assert.ok(state.fuel.qty < state.fuel.initial);
  assert.equal(state.engines[0].starter, false);
});

test('N1 平滑跟随油门而不是瞬时跳变', () => {
  const state = createInitialState({ windSpeed: 0 });
  makeRunning(state, { n1: 0.22, parkingBrake: true });
  performAction(state, 'throttle', 1);
  const before = state.engines[0].n1;
  stepSimulation(state);
  assert.ok(state.engines[0].n1 > before);
  assert.ok(state.engines[0].n1 - before < 0.002);
  runFor(state, 6);
  assert.ok(state.engines[0].n1 > 0.95);
});

test('襟翼按 747 的 7 秒速率作动并带动缝翼', () => {
  const state = createInitialState({ windSpeed: 0 });
  makeRunning(state, { parkingBrake: true });
  performAction(state, 'flaps', 30);
  assert.equal(state.lastAction.accepted, true);
  runFor(state, 3.5);
  assert.ok(Math.abs(state.controls.flaps - 15) < 0.2, `actual ${state.controls.flaps}`);
  assert.equal(state.flaps.moving, true);
  assert.equal(state.slats.left, 1);
  runFor(state, 3.6);
  assert.ok(Math.abs(state.controls.flaps - 30) < 1e-6);
  assert.equal(state.flaps.moving, false);
});

test('起落架按 747 的 8 秒速率作动且地面收轮被联锁', () => {
  const ground = createInitialState();
  makeRunning(ground, { parkingBrake: true });
  performAction(ground, 'gear', 'up');
  assert.equal(ground.lastAction.accepted, false);
  assert.match(ground.lastAction.reason, /地面/);

  const state = createInitialState({ windSpeed: 0 });
  makeAirborne(state);
  state.gear.position = 1;
  state.gear.target = 1;
  state.controls.gear = 'down';
  performAction(state, 'gear', 'up');
  assert.equal(state.lastAction.accepted, true);
  for (let index = 0; index < 480; index += 1) updateConfiguration(state, M.dt);
  assert.ok(Math.abs(state.gear.position - 0.5) < 0.002);
  assert.equal(state.gear.inTransit, true);
  for (let index = 0; index < 500; index += 1) updateConfiguration(state, M.dt);
  assert.equal(state.gear.position, 0);
  assert.equal(state.controls.gear, 'up');
  assert.equal(state.gear.locked, true);
});

test('反推要求地面、慢车、四发运转、液压和地面扰流板并驱动 N1', () => {
  const airborne = createInitialState({ windSpeed: 0 });
  makeAirborne(airborne);
  airborne.systems.groundSpoilers = true;
  performAction(airborne, 'reverse', true);
  assert.equal(airborne.lastAction.accepted, false);
  assert.match(airborne.lastAction.reason, /地面/);

  const noSpoiler = createInitialState({ windSpeed: 0 });
  makeRunning(noSpoiler, { n1: 0.24 });
  noSpoiler.onGround = true;
  performAction(noSpoiler, 'reverse', true);
  assert.equal(noSpoiler.lastAction.accepted, false);
  assert.match(noSpoiler.lastAction.reason, /扰流板/);

  const state = createInitialState({ windSpeed: 0 });
  makeRunning(state, { n1: 0.24 });
  state.onGround = true;
  state.mission.phase = 'vacate';
  state.status = 'vacate';
  performAction(state, 'spoilers', 'ground');
  performAction(state, 'reverse', true);
  assert.equal(state.lastAction.accepted, true, state.lastAction.reason);
  assert.equal(state.controls.reverse, true);
  const idleN1 = state.engines[0].n1;
  runFor(state, 3);
  assert.ok(state.engines[0].n1 > idleN1 + 0.2, `reverse N1 ${state.engines[0].n1}`);
  assert.ok(state.engines.every((engine) => engine.thrust < 0), 'reverse thrust should be negative');

  performAction(state, 'throttle', 0.2);
  assert.equal(state.controls.reverse, false);
  performAction(state, 'throttle', 0);
  performAction(state, 'reverse', true);
  state.onGround = false;
  stepSimulation(state);
  assert.equal(state.controls.reverse, false);
});

test('扰流板、动作参数与未知动作不会使模拟崩溃', () => {
  const state = createInitialState();
  assert.doesNotThrow(() => performAction(state, 'notAnAction', {}));
  assert.equal(state.lastAction.accepted, false);
  assert.match(state.lastAction.reason, /未知动作/);
  performAction(state, 'weather', 'storm');
  assert.equal(state.environment.turbulence, 0.8);
  performAction(state, 'windDirection', -90);
  assert.equal(state.environment.windDirection, 270);
  performAction(state, 'windSpeed', 999);
  assert.equal(state.environment.windSpeed, 60);
  performAction(state, 'pause', true);
  const time = state.time;
  stepSimulation(state);
  assert.equal(state.time, time);
  performAction(state, 'reset');
  assert.equal(state.status, 'cold');
  assert.equal(state.pos.z, -1700);
});
