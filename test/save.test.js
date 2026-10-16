import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/sim/state.js';
import {
  SAVE_KEY,
  SAVE_VERSION,
  clearSave,
  loadGame,
  saveGame,
  saveState,
  loadState
} from '../src/sim/save.js';
import { performAction, stepSimulation } from '../src/sim/simulation.js';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    setItem(key, value) { values.set(key, String(value)); },
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); }
  };
}

test('存档往返仅恢复白名单状态并保留飞行进度', () => {
  const storage = memoryStorage();
  const state = createInitialState({ weather: 'rain' });
  performAction(state, 'battery', true);
  performAction(state, 'externalPower', true);
  state.pos = { x: 3, y: 1200, z: 800 };
  state.vel = { x: 1, y: 2, z: 110 };
  state.onGround = false;
  state.controls.throttle = 0.75;
  state.mission.phase = 'cruise';
  state.status = 'cruise';
  state.stats.touchdownSink = -1.7;
  state.stats.touchdownPosition = { x: 1, y: 0, z: -300 };
  state.messages.push({ text: '不应保存的临时消息' });
  state.debug.secretRuntimeValue = 42;
  assert.equal(saveGame(state, storage), true);
  const envelope = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(envelope.version, SAVE_VERSION);
  assert.equal('messages' in envelope.data, false);
  assert.equal('debug' in envelope.data, false);
  assert.equal('secretRuntimeValue' in envelope.data, false);

  const loaded = loadGame(storage);
  assert.equal(loaded.pos.y, 1200);
  assert.equal(loaded.vel.z, 110);
  assert.equal(loaded.controls.throttle, 0.75);
  assert.equal(loaded.mission.phase, 'cruise');
  assert.equal(loaded.stats.touchdownSink, -1.7);
  assert.deepEqual(loaded.stats.touchdownPosition, { x: 1, y: 0, z: -300 });
  assert.deepEqual(loaded.messages, []);
  assert.deepEqual(loaded.debug, {});
  assert.equal(loaded.systems.battery, true);
  assert.doesNotThrow(() => stepSimulation(loaded));
});

test('损坏、错误版本和错误类型存档返回 null 而非抛出', () => {
  const storage = memoryStorage();
  storage.setItem(SAVE_KEY, '{broken json');
  assert.equal(loadGame(storage), null);
  storage.setItem(SAVE_KEY, JSON.stringify({ version: 999, data: {} }));
  assert.equal(loadGame(storage), null);
  storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, data: { pos: { x: 'bad' } } }));
  assert.equal(loadGame(storage), null);
  storage.setItem(SAVE_KEY, 'null');
  assert.equal(loadGame(storage), null);
});

test('未知存档字段被忽略且不能污染加载状态原型', () => {
  const storage = memoryStorage();
  const state = createInitialState();
  saveGame(state, storage);
  const envelope = JSON.parse(storage.getItem(SAVE_KEY));
  envelope.data.injected = 'not-whitelisted';
  envelope.data.pos.extra = 123;
  storage.setItem(SAVE_KEY, JSON.stringify(envelope));
  const loaded = loadGame(storage);
  assert.equal('injected' in loaded, false);
  assert.equal('extra' in loaded.pos, false);
  assert.equal({}.polluted, undefined);
});

test('Node 无 localStorage 与存储异常均优雅降级', () => {
  const state = createInitialState();
  assert.equal(saveGame(state, null), false);
  assert.equal(loadGame(null), null);
  assert.equal(clearSave(null), false);
  const throwing = {
    setItem() { throw new Error('denied'); },
    getItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); }
  };
  assert.doesNotThrow(() => saveGame(state, throwing));
  assert.equal(saveGame(state, throwing), false);
  assert.equal(loadGame(throwing), null);
  assert.equal(clearSave(throwing), false);
});

test('清除存档及导出的状态别名可用', () => {
  const storage = memoryStorage();
  const state = createInitialState();
  assert.equal(saveState(state, storage), true);
  assert.ok(loadState(storage));
  assert.equal(clearSave(storage), true);
  assert.equal(loadGame(storage), null);
});
