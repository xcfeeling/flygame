import { createInitialState } from './state.js';

export const SAVE_KEY = 'yunyi-flight-save-v1';
export const SAVE_VERSION = 1;
const MAX_SAVE_LENGTH = 750000;
const TRANSIENT_KEYS = new Set(['messages', 'debug', 'effects']);

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeString(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new TypeError('Invalid string');
  return value;
}

function projectObject(template, source, partial = false) {
  if (!isPlainObject(source)) throw new TypeError('Invalid object');
  const result = {};
  for (const key of Object.keys(template)) {
    if (TRANSIENT_KEYS.has(key)) continue;
    if (!(key in source)) {
      if (partial) continue;
      result[key] = template[key];
      continue;
    }
    result[key] = projectValue(template[key], source[key], partial);
  }
  return result;
}

function projectValue(template, value, partial) {
  if (template === null) return null;
  if (typeof template === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Invalid number');
    return value;
  }
  if (typeof template === 'string') return safeString(value);
  if (typeof template === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError('Invalid boolean');
    return value;
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) throw new TypeError('Invalid array');
    if (template.length === 0) return [];
    return template.map((item, index) => projectValue(item, value[index], partial));
  }
  if (isPlainObject(template)) return projectObject(template, value, partial);
  return null;
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) throw new TypeError('Invalid nullable number');
  return value;
}

function nullableString(value) {
  if (value === null || value === undefined) return null;
  return safeString(value);
}

function nullablePosition(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) throw new TypeError('Invalid position');
  return { x: nullableNumber(value.x), y: nullableNumber(value.y), z: nullableNumber(value.z) };
}

function projectNullableFields(data, source) {
  data.outcome = nullableString(source.outcome);
  data.stats.takeoffTime = nullableNumber(source.stats.takeoffTime);
  data.stats.touchdownSink = nullableNumber(source.stats.touchdownSink);
  data.stats.touchdownSpeed = nullableNumber(source.stats.touchdownSpeed);
  data.stats.touchdownG = nullableNumber(source.stats.touchdownG);
  data.stats.touchdownPosition = nullablePosition(source.stats.touchdownPosition);
  if ('landingResult' in source.stats) data.stats.landingResult = nullableString(source.stats.landingResult);
  return data;
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveGame(state, storage) {
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.setItem !== 'function' || !state) return false;
    const template = createInitialState({ aircraftType: state.aircraft?.type });
    const data = projectNullableFields(projectObject(template, state), state);
    const serialized = JSON.stringify({ version: SAVE_VERSION, data });
    if (serialized.length > MAX_SAVE_LENGTH) return false;
    target.setItem(SAVE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function loadGame(storage) {
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== 'function') return null;
    const serialized = target.getItem(SAVE_KEY);
    if (typeof serialized !== 'string' || serialized.length === 0 || serialized.length > MAX_SAVE_LENGTH) return null;
    const envelope = JSON.parse(serialized);
    if (!isPlainObject(envelope) || envelope.version !== SAVE_VERSION || !isPlainObject(envelope.data)) return null;
    const savedType = envelope.data.aircraft?.type;
    const fresh = createInitialState({ aircraftType: typeof savedType === 'string' ? savedType : undefined });
    const projected = projectObject(fresh, envelope.data, true);
    const merged = { ...fresh, ...projected };
    merged.aircraft = { ...fresh.aircraft };
    projectNullableFields(merged, envelope.data);
    merged.messages = [];
    merged.debug = {};
    merged.effects = { ...fresh.effects };
    if (merged.flaps.moving) {
      merged.flaps.fromLeft = merged.flaps.left;
      merged.flaps.fromRight = merged.flaps.right;
      merged.flaps.elapsed = 0;
    }
    if (merged.gear.moving) {
      merged.gear.startPosition = merged.gear.position;
      merged.gear.transition = 0;
    }
    return merged;
  } catch {
    return null;
  }
}

export function clearSave(storage) {
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.removeItem !== 'function') return false;
    target.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

export const saveState = saveGame;
export const loadState = loadGame;
export const clearState = clearSave;
export const saveSimulation = saveGame;
export const loadSimulation = loadGame;
export const clearSimulation = clearSave;
export const loadSave = loadGame;
