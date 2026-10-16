import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { performAction, stepSimulation } from '../src/sim/simulation.js';
import { makeRunning, runFor } from './helpers.js';

test('灯光与加温需要电源并且可以独立开关', () => {
  const state = createInitialState();
  performAction(state, 'landingLights');
  assert.equal(state.lastAction.accepted, false);
  assert.match(state.lastAction.reason, /电源/);

  performAction(state, 'battery', true);
  for (const action of ['landingLights', 'navLights', 'beacon', 'probeHeat', 'windowHeat']) {
    performAction(state, action);
    assert.equal(state.systems[action], true, action);
    performAction(state, action);
    assert.equal(state.systems[action], false, action);
  }
});

test('发动机动作可用显式布尔值关车与启动', () => {
  const state = createInitialState();
  makeRunning(state, { n1: 0.8 });
  performAction(state, 'startEngine1', false);
  assert.equal(state.engines[0].running, false);
  assert.equal(state.lastAction.accepted, true);

  performAction(state, 'startEngine1');
  assert.equal(state.engines[0].running, false);
  assert.equal(state.lastAction.accepted, false);
  assert.match(state.lastAction.reason, /APU|引气/);

  state.systems.apu.available = true;
  state.systems.apu.bleed = true;
  performAction(state, 'startEngine1');
  assert.equal(state.engines[0].running, true);
  assert.equal(state.lastAction.accepted, true);
});

test('速度刹车与配平在合法范围内生效', () => {
  const state = createInitialState();
  makeRunning(state);
  state.onGround = false;
  performAction(state, 'spoilers', 'speedbrake');
  stepSimulation(state);
  assert.equal(state.controls.spoilers, 'speedbrake');
  assert.equal(state.systems.speedBrake, 1);
  performAction(state, 'spoilers', 'stowed');
  stepSimulation(state);
  assert.equal(state.systems.speedBrake, 0);

  performAction(state, 'pitchTrim', 5);
  assert.ok(state.input.pitchTrim <= 0.5);
  performAction(state, 'pitchTrim', -5);
  assert.ok(state.input.pitchTrim >= -0.5);
});

test('地面方向舵输入会改变航向而空中横滚不改变地面航向', () => {
  const ground = createInitialState();
  makeRunning(ground, { parkingBrake: false });
  ground.vel = { x: 0, y: 0, z: 8 };
  const heading = ground.heading;
  runFor(ground, 1, (state) => { state.input.yaw = 1; });
  assert.ok(Math.abs(ground.heading - heading) > 0.01, `heading ${ground.heading}`);

  const air = createInitialState();
  makeRunning(air);
  air.onGround = false;
  air.pos = { x: 0, y: 1000, z: 0 };
  air.vel = { x: 0, y: 0, z: 80 };
  runFor(air, 1, (state) => { state.input.roll = 1; });
  assert.ok(Math.abs(air.roll) > 0.1, `roll ${air.roll}`);
});
