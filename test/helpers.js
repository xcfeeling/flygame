import { M } from '../src/sim/config.js';
import { stepSimulation } from '../src/sim/simulation.js';

export function runFor(state, seconds, onStep) {
  const steps = Math.ceil(seconds / M.dt);
  for (let index = 0; index < steps; index += 1) {
    if (onStep) onStep(state, index);
    stepSimulation(state, state.input, M.dt);
  }
  return state;
}

export function makeRunning(state, options = {}) {
  const count = state.engines.length;
  state.systems.battery = true;
  state.systems.externalPower = true;
  state.systems.avionics = true;
  state.systems.generators = Array(count).fill(true);
  state.systems.electricPumps = Array(count).fill(true);
  state.systems.hydraulic = Array(count).fill(true);
  state.systems.packOff = true;
  for (const engine of state.engines) {
    engine.running = true;
    engine.n1 = options.n1 ?? 0.85;
    engine.n2 = engine.n1 * 1.1;
    engine.starter = false;
  }
  state.controls.parkingBrake = options.parkingBrake ?? false;
  state.weight = options.weight ?? state.weight;
  state.mission.phase = options.phase ?? 'taxi';
  state.status = options.phase ?? 'taxi';
  return state;
}

export function makeAirborne(state, options = {}) {
  makeRunning(state, { ...options, phase: options.phase ?? 'climb' });
  state.onGround = false;
  state.wasOnGround = false;
  state.pos = { x: options.x ?? 0, y: options.y ?? 1000, z: options.z ?? 0 };
  state.vel = { x: 0, y: options.verticalSpeed ?? 0, z: options.speed ?? 105 };
  state.pitch = options.pitch ?? 0.08;
  state.roll = 0;
  state.heading = 0;
  state.gear.position = options.gear ?? 0;
  state.gear.target = state.gear.position;
  state.gear.locked = true;
  state.controls.gear = state.gear.position > 0.5 ? 'down' : 'up';
  return state;
}

export function setFlaps(state, degrees) {
  state.flaps.left = degrees;
  state.flaps.right = degrees;
  state.flaps.target = degrees;
  state.flaps.moving = false;
  state.controls.flaps = degrees;
  state.controls.flapTarget = degrees;
  state.slats.left = Math.min(1, degrees / 5);
  state.slats.right = Math.min(1, degrees / 5);
}
