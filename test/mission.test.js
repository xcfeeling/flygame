import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { getMissionSnapshot, performAction, stepSimulation } from '../src/sim/simulation.js';
import { makeAirborne, makeRunning, setFlaps } from './helpers.js';

function touchdown(sink) {
  const state = createInitialState({ windSpeed: 0 });
  makeRunning(state, { n1: 0.22, weight: 260000, phase: 'landing' });
  setFlaps(state, 30);
  state.gear.position = 1;
  state.gear.target = 1;
  state.gear.locked = true;
  state.controls.gear = 'down';
  state.onGround = false;
  state.wasOnGround = false;
  state.pos = { x: 0, y: 0.005, z: -500 };
  state.vel = { x: 0, y: sink, z: 76 };
  state.pitch = 0.05;
  stepSimulation(state);
  return state;
}

test('正常接地由最终下降率判定并进入脱离跑道阶段', () => {
  const state = touchdown(-1.5);
  assert.equal(state.onGround, true);
  assert.equal(state.stats.landingResult, '正常着陆');
  assert.ok(state.stats.touchdownSink < -1.5);
  assert.equal(state.stats.hardLandingCount, 0);
  assert.equal(state.mission.phase, 'vacate');
  assert.equal(state.status, 'vacate');
  assert.ok(state.score > 80);
});

test('硬着陆记录损伤但允许脱离，重着陆直接失败', () => {
  const hard = touchdown(-3);
  assert.equal(hard.stats.landingResult, '硬着陆');
  assert.equal(hard.stats.hardLandingCount, 1);
  assert.ok(hard.damage.gear > 0);
  assert.equal(hard.mission.phase, 'vacate');

  const severe = touchdown(-4);
  assert.equal(severe.stats.landingResult, '重着陆/损坏');
  assert.equal(severe.status, 'failed');
  assert.equal(severe.outcome, 'heavyLanding');
  assert.match(severe.outcomeDetail, /下降率/);
});

test('正常着陆评分高于硬着陆，脱离联络道后完成任务', () => {
  const normal = touchdown(-1.4);
  const hard = touchdown(-3.1);
  assert.ok(normal.score > hard.score);
  normal.pos = { x: -80, y: 0, z: -500 };
  normal.vel = { x: 0, y: 0, z: 0 };
  normal.groundSpeed = 0;
  normal.onGround = true;
  normal.controls.parkingBrake = true;
  stepSimulation(normal);
  assert.equal(normal.status, 'complete');
  assert.equal(normal.outcome, 'complete');
  assert.equal(normal.mission.vacated, true);
});

test('低高度大下降率锁存复飞，正上升率后稳定返回爬升', () => {
  const state = createInitialState({ windSpeed: 0 });
  makeAirborne(state, { y: 30, speed: 65, verticalSpeed: -3, phase: 'approach', gear: 1 });
  setFlaps(state, 30);
  stepSimulation(state);
  assert.equal(state.mission.phase, 'goAround');
  assert.equal(state.status, 'goAround');
  assert.equal(state.mission.goAroundCount, 1);
  assert.match(state.mission.radio, /复飞/);

  state.pos.y = 200;
  state.vel.y = 2;
  state.pitch = 0.15;
  state.controls.throttle = 1;
  stepSimulation(state);
  assert.equal(state.mission.phase, 'climb');
  assert.equal(state.mission.goAroundActive, false);
  assert.equal(state.mission.goAroundCount, 1);
});

test('跑道外接地和高速冲出产生不同失败结果', () => {
  const offRunway = touchdown(-1.5);
  offRunway.status = 'landing';
  offRunway.mission.phase = 'landing';
  offRunway.onGround = false;
  offRunway.pos = { x: -80, y: 0.005, z: -500 };
  offRunway.vel.y = -1.5;
  offRunway.stats.touchdownSink = null;
  stepSimulation(offRunway);
  assert.equal(offRunway.status, 'failed');
  assert.equal(offRunway.outcome, 'runwayExcursion');
});

test('确定性鸟击事件损伤发动机并保留可处置状态', () => {
  const state = createInitialState({ windSpeed: 0 });
  makeAirborne(state, { speed: 110, y: 500 });
  state.debug.birdStrike = true;
  stepSimulation(state);
  assert.equal(state.damage.birdStrike, true);
  assert.equal(state.engines[1].failed, true);
  assert.equal(state.engines[1].running, false);
  assert.equal(state.status === 'failed', false);
  assert.ok(state.messages.some((message) => /鸟击/.test(message.text)));
});

test('任务快照包含中文教程、无线电、检查单和最终参数', () => {
  const state = touchdown(-1.5);
  const snapshot = getMissionSnapshot(state);
  assert.equal(snapshot.phase, 'vacate');
  assert.match(snapshot.title, /脱离跑道/);
  assert.ok(snapshot.checklist.length >= 3);
  assert.ok(snapshot.checklist.every((item) => typeof item.text === 'string' && item.text.length > 0));
  assert.match(snapshot.radio, /CZ3261/);
  assert.equal(snapshot.finalParameters.landingResult, '正常着陆');
  assert.ok(Number.isFinite(snapshot.finalParameters.touchdownSpeedKnots));
  performAction(state, 'tutorial', false);
  assert.equal(getMissionSnapshot(state).tutorial, false);
});
