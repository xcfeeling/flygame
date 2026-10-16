import { M, clamp } from './config.js';
import { resetState } from './state.js';
import { hasElectricalPower, performSystemAction, pushMessage, updateSystems } from './systems.js';
import { updateDynamics } from './dynamics.js';
import { buildMissionSnapshot, updateMission } from './mission.js';

const CAMERA_MODES = new Set(['cockpit', 'chase', 'external', 'tower', 'flyby', 'wing']);
const TIMES_OF_DAY = new Set(['day', 'dusk', 'night', 'dawn']);
const WEATHER_MODES = new Set(['clear', 'rain', 'fog', 'storm', 'snow']);

function actionResult(state, action, accepted, reason = '') {
  state.lastAction = { action, accepted, reason, time: state.time };
  if (!accepted && reason) pushMessage(state, reason, 'warning');
  return state;
}

function resetInPlace(state, options) {
  const fresh = resetState(state, options);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, fresh);
  return state;
}

export function stepSimulation(state, input = state.input, dt = M.dt) {
  if (!state || typeof state !== 'object') return state;
  if (!Number.isFinite(dt) || dt <= 0 || state.paused || state.status === 'failed' || state.status === 'complete') return state;
  const step = dt;
  state.input = input && typeof input === 'object' ? input : state.input;
  const throttleDelta = Number.isFinite(state.input.throttleDelta) ? state.input.throttleDelta : 0;
  state.controls.throttle = clamp(state.controls.throttle + throttleDelta * step, 0, 1);
  state.time += step;
  updateSystems(state, step);
  updateDynamics(state, step);
  updateMission(state, step);
  for (const key of ['dust', 'spray', 'smoke', 'debris', 'gravel', 'treeStrike', 'shake', 'flash']) {
    state.effects[key] = Math.max(0, state.effects[key] - step * (key === 'shake' || key === 'flash' ? 2.5 : 0.35));
  }
  return state;
}

export function performAction(state, action, value) {
  if (!state || typeof state !== 'object' || typeof action !== 'string') return state;
  const systemResult = performSystemAction(state, action, value);
  if (systemResult.handled) return state;
  switch (action) {
    case 'throttle': {
      const throttle = Number(value);
      if (!Number.isFinite(throttle)) return actionResult(state, action, false, '油门值无效');
      state.controls.throttle = clamp(throttle, 0, 1);
      if (throttle > 0.03 && state.controls.reverse) {
        state.controls.reverse = false;
        pushMessage(state, '油门离开慢车位，反推已收回', 'warning');
      }
      return actionResult(state, action, true);
    }
    case 'parkingBrake':
      state.controls.parkingBrake = typeof value === 'boolean' ? value : !state.controls.parkingBrake;
      return actionResult(state, action, true);
    case 'brake': {
      const brake = Number(value);
      if (!Number.isFinite(brake)) return actionResult(state, action, false, '刹车值无效');
      state.controls.brake = clamp(brake, 0, 1);
      return actionResult(state, action, true);
    }
    case 'spoilers': {
      let setting;
      if (value === false || value === 'stowed' || value === 'down') setting = 'stowed';
      else if (value === 'armed') setting = 'armed';
      else if (value === 'speedbrake') setting = 'speedbrake';
      else setting = 'ground';
      const hydraulic = state.systems.hydraulic.some(Boolean);
      if (setting !== 'stowed' && !hydraulic) {
        return actionResult(state, action, false, '液压压力不足，扰流板不可用');
      }
      state.controls.spoilers = setting;
      state.systems.groundSpoilers = Boolean(
        setting === 'ground' && state.onGround && state.controls.throttle <= 0.05 && hydraulic
      );
      if (setting === 'stowed') state.systems.speedBrake = 0;
      return actionResult(state, action, true);
    }
    case 'pitchTrim': {
      const trim = Number(value);
      if (!Number.isFinite(trim)) return actionResult(state, action, false, '配平值无效');
      state.input.pitchTrim = clamp(trim, -0.5, 0.5);
      return actionResult(state, action, true);
    }
    case 'landingLights':
    case 'navLights':
    case 'beacon':
    case 'probeHeat':
    case 'windowHeat': {
      const requested = typeof value === 'boolean' ? value : !state.systems[action];
      if (requested && !hasElectricalPower(state)) {
        return actionResult(state, action, false, '无可用电源，灯光与加温不可接通');
      }
      state.systems[action] = requested;
      const names = {
        landingLights: '着陆灯',
        navLights: '航行灯',
        beacon: '防撞灯',
        probeHeat: '探头加温',
        windowHeat: '风挡加温'
      };
      pushMessage(state, `${names[action]}${requested ? '已接通' : '已关闭'}`, 'info');
      return actionResult(state, action, true);
    }
    case 'pause':
      state.paused = typeof value === 'boolean' ? value : !state.paused;
      return actionResult(state, action, true);
    case 'reset':
      resetInPlace(state, value && typeof value === 'object' ? value : {});
      return actionResult(state, action, true);
    case 'camera':
      if (!CAMERA_MODES.has(value)) return actionResult(state, action, false, '未知视角模式');
      state.camera = value;
      return actionResult(state, action, true);
    case 'timeOfDay':
      if (!TIMES_OF_DAY.has(value)) return actionResult(state, action, false, '未知时间设置');
      state.environment.timeOfDay = value;
      return actionResult(state, action, true);
    case 'weather': {
      if (!WEATHER_MODES.has(value)) return actionResult(state, action, false, '未知天气设置');
      state.environment.weather = value;
      state.environment.visibility = value === 'fog' ? 800 : value === 'rain' || value === 'snow' ? 5000 : value === 'storm' ? 3500 : 16000;
      state.environment.turbulence = value === 'storm' ? 0.8 : value === 'rain' ? 0.25 : 0;
      return actionResult(state, action, true);
    }
    case 'windDirection': {
      const direction = Number(value);
      if (!Number.isFinite(direction)) return actionResult(state, action, false, '风向值无效');
      state.environment.windDirection = ((direction % 360) + 360) % 360;
      return actionResult(state, action, true);
    }
    case 'windSpeed': {
      const speed = Number(value);
      if (!Number.isFinite(speed)) return actionResult(state, action, false, '风速值无效');
      state.environment.windSpeed = clamp(speed, 0, 60);
      return actionResult(state, action, true);
    }
    case 'tutorial':
      state.tutorial = typeof value === 'boolean' ? value : !state.tutorial;
      return actionResult(state, action, true);
    default:
      return actionResult(state, action, false, `未知动作：${action}`);
  }
}

export function getMissionSnapshot(state) {
  return buildMissionSnapshot(state);
}
