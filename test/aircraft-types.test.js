import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import { createScenario } from '../src/sim/scenarios.js';
import { getAircraftParams, getAircraftType, listAircraftTypes } from '../src/sim/aircraftTypes.js';
import { loadGame, saveGame } from '../src/sim/save.js';

test('747-400 与 747-8F 都是四发且参数独立', () => {
  const types = listAircraftTypes();
  assert.ok(types.length >= 2);
  const classic = getAircraftType('b747-400');
  const freighter = getAircraftType('b747-8f');
  assert.equal(classic.engineCount, 4);
  assert.equal(freighter.engineCount, 4);
  assert.notEqual(classic.id, freighter.id);
  assert.ok(freighter.maxTakeoffMass > classic.maxTakeoffMass);
  assert.ok(freighter.wingspan > classic.wingspan);
  assert.ok(freighter.length > classic.length);
  assert.notEqual(classic.vr, freighter.vr);
  assert.equal(classic.flapSettings.includes(classic.takeoffFlap), true);
  assert.equal(classic.flapSettings.includes(classic.landingFlap), true);
});

test('初始状态按机型生成四台发动机和正确重量', () => {
  const classic = createInitialState({ aircraftType: 'b747-400' });
  const freighter = createInitialState({ aircraftType: 'b747-8f' });
  assert.equal(classic.aircraft.type, 'b747-400');
  assert.equal(freighter.aircraft.type, 'b747-8f');
  assert.equal(classic.engines.length, 4);
  assert.equal(freighter.engines.length, 4);
  assert.equal(classic.systems.generators.length, 4);
  assert.equal(classic.systems.electricPumps.length, 4);
  assert.equal(classic.systems.hydraulic.length, 4);
  assert.ok(freighter.weight > classic.weight);
  assert.equal(getAircraftParams(classic).id, 'b747-400');
  assert.equal(getAircraftParams(freighter).id, 'b747-8f');
});

test('起飞与进近情景使用该机型的四发与襟翼设置', () => {
  const takeoff = createScenario('takeoff', { aircraftType: 'b747-8f', windSpeed: 0 });
  assert.equal(takeoff.engines.length, 4);
  assert.ok(takeoff.engines.every((engine) => engine.running));
  assert.deepEqual(takeoff.systems.generators, [true, true, true, true]);
  assert.equal(takeoff.controls.flaps, getAircraftType('b747-8f').takeoffFlap);

  const approach = createScenario('approach', { aircraftType: 'b747-400', windSpeed: 0 });
  assert.equal(approach.engines.length, 4);
  assert.equal(approach.controls.flaps, getAircraftType('b747-400').landingFlap);
  assert.equal(approach.gear.position, 1);
});

test('存档保留机型 id', () => {
  const store = new Map();
  const storage = {
    setItem: (key, value) => store.set(key, value),
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    removeItem: (key) => store.delete(key)
  };
  const state = createInitialState({ aircraftType: 'b747-8f' });
  assert.equal(saveGame(state, storage), true);
  const loaded = loadGame(storage);
  assert.ok(loaded);
  assert.equal(loaded.aircraft.type, 'b747-8f');
  assert.equal(loaded.engines.length, 4);
});
