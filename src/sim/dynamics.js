import {
  M,
  STALL_WARNING_MARGIN,
  airDensity,
  clamp,
  isOnPavedSurface,
  isOnRunway,
  knots,
  speedOfSound,
  terrainHeight
} from './config.js';
import { getAircraftParams } from './aircraftTypes.js';
import { failMission, handleTouchdown } from './mission.js';
import { addWarning, pushMessage } from './systems.js';

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 1e-8) return { x: 0, y: 0, z: 0 };
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function bodyAxes(state) {
  const sinHeading = Math.sin(state.heading);
  const cosHeading = Math.cos(state.heading);
  const sinPitch = Math.sin(state.pitch);
  const cosPitch = Math.cos(state.pitch);
  const sinRoll = Math.sin(state.roll);
  const cosRoll = Math.cos(state.roll);
  const flatForward = { x: sinHeading, y: 0, z: cosHeading };
  const flatRight = { x: cosHeading, y: 0, z: -sinHeading };
  const pitchedUp = { x: -flatForward.x * sinPitch, y: cosPitch, z: -flatForward.z * sinPitch };
  return {
    forward: {
      x: flatForward.x * cosPitch,
      y: sinPitch,
      z: flatForward.z * cosPitch
    },
    right: {
      x: flatRight.x * cosRoll - pitchedUp.x * sinRoll,
      y: -pitchedUp.y * sinRoll,
      z: flatRight.z * cosRoll - pitchedUp.z * sinRoll
    },
    up: {
      x: pitchedUp.x * cosRoll + flatRight.x * sinRoll,
      y: pitchedUp.y * cosRoll,
      z: pitchedUp.z * cosRoll + flatRight.z * sinRoll
    }
  };
}

function windVector(state) {
  const direction = finite(state.environment.windDirection) * Math.PI / 180;
  const speed = Math.max(0, finite(state.environment.windSpeed));
  return {
    x: -Math.sin(direction) * speed,
    y: 0,
    z: -Math.cos(direction) * speed
  };
}

export function computeAerodynamics(state) {
  const params = getAircraftParams(state);
  const terrain = terrainHeight(state.pos.x, state.pos.z);
  state.altitude = state.pos.y;
  state.radioAltitude = Math.max(0, state.pos.y - terrain);
  const wind = windVector(state);
  const airVelocity = {
    x: state.vel.x - wind.x,
    y: state.vel.y - wind.y,
    z: state.vel.z - wind.z
  };
  const airspeed = Math.max(0, Math.hypot(airVelocity.x, airVelocity.y, airVelocity.z));
  const horizontalAirspeed = Math.hypot(airVelocity.x, airVelocity.z);
  const flightPath = airspeed > 0.5 ? Math.atan2(airVelocity.y, Math.max(0.01, horizontalAirspeed)) : 0;
  const axes = bodyAxes(state);
  const airDirection = normalize(airVelocity);
  const alpha = state.pitch - flightPath;
  const beta = airspeed > 0.5
    ? Math.asin(clamp((airVelocity.x * axes.right.x + airVelocity.y * axes.right.y + airVelocity.z * axes.right.z) / airspeed, -1, 1))
    : 0;
  const rho = airDensity(state.altitude);
  const dynamicPressure = 0.5 * rho * airspeed * airspeed;
  const mach = airspeed / Math.max(1, speedOfSound(state.altitude));
  const flap = Math.max(0, state.controls.flaps);
  const groundEffect = Math.exp(-Math.max(0, state.radioAltitude) / params.groundEffectHeight);
  const compressibility = mach > 0.3 ? Math.min(1.35, 1 / Math.sqrt(Math.max(0.25, 1 - mach * mach))) : 1;
  let cL = (params.cLAlpha * alpha + params.cLAlpha0 + params.flapPerDeg * flap) * compressibility;
  cL += 0.025 * (state.slats.left + state.slats.right) * 0.5;
  cL *= 1 + groundEffect * 0.07;
  let stallFactor = 1;
  if (alpha > params.alphaStall) stallFactor = Math.max(0.12, Math.exp(-5 * (alpha - params.alphaStall)));
  if (alpha < -0.18) stallFactor = Math.max(0.2, Math.exp(-5 * (-0.18 - alpha)));
  cL *= stallFactor;
  if (state.systems.groundSpoilers) cL *= 0.55;
  const inducedFactor = 1 - groundEffect * 0.48;
  const machDrag = mach > 0.76 ? 0.11 * Math.pow(mach - 0.76, 2) : 0;
  const cD = Math.max(
    0.005,
    params.cD0 + params.k * cL * cL * inducedFactor + state.gear.position * 0.018 +
    flap * 0.00065 + state.systems.speedBrake * 0.035 +
    (state.systems.groundSpoilers ? 0.045 : 0) + beta * beta * 0.35 + machDrag
  );
  const lift = dynamicPressure * params.wingArea * cL;
  const drag = dynamicPressure * params.wingArea * cD;
  state.alpha = alpha;
  state.beta = beta;
  state.q = dynamicPressure;
  state.mach = mach;
  state.airspeed = airspeed;
  state.lift = lift;
  state.drag = drag;
  state.stallWarning = !state.onGround && airspeed > 12 && alpha > params.alphaStall - STALL_WARNING_MARGIN;
  state.stalled = !state.onGround && airspeed > 12 && alpha > params.alphaStall;
  state.overspeed = mach > params.maxOperatingMach;
  state.debug.cL = cL;
  state.debug.cD = cD;
  state.debug.groundEffect = groundEffect;
  state.debug.stallFactor = stallFactor;
  if (state.stallWarning) addWarning(state, state.stalled ? '失速：立即减小迎角' : '失速裕量不足');
  if (state.overspeed) addWarning(state, '超过最大使用马赫数');
  if (state.stallWarning && !state.onGround) {
    state.effects.shake = Math.max(finite(state.effects.shake), state.stalled ? 0.65 : 0.3);
    state.systems.stickShaker = 1;
  }
  if (state.overspeed) state.effects.shake = Math.max(finite(state.effects.shake), 0.4);
  return { airVelocity, airDirection, axes, rho, lift, drag, cL };
}

function updateThrust(state, rho) {
  const params = getAircraftParams(state);
  const densityRatio = clamp(rho / M.rho0, 0.18, 1.1);
  let total = 0;
  for (const engine of state.engines) {
    const maximum = params.maxThrust * densityRatio * (1 - clamp(engine.damage, 0, 0.9) * 0.75);
    const normalized = clamp((engine.n1 - 0.22) / 0.78, 0, 1);
    let thrust = engine.running ? maximum * (0.025 + 0.975 * Math.pow(normalized, 1.65)) : 0;
    if (engine.antiIce) thrust *= 0.96;
    if (engine.reverser > 0) {
      const reversePower = clamp((engine.n1 - 0.22) / (params.reverseMinN1 - 0.22), 0, 1);
      thrust = -maximum * 0.62 * engine.reverser * reversePower;
    }
    engine.thrust = thrust;
    total += thrust;
  }
  state.thrust = total;
  return total;
}

function controlInput(state, name) {
  const direct = finite(state.input?.[name], NaN);
  const fallback = finite(state.controls[name], 0);
  return clamp(Number.isFinite(direct) ? direct : fallback, -1, 1);
}

function updateAttitude(state, dt, aero) {
  const params = getAircraftParams(state);
  const effectiveness = clamp(state.q / (0.5 * M.rho0 * params.refV * params.refV), 0.08, 1.15);
  const pitchInput = controlInput(state, 'pitch');
  const rollInput = controlInput(state, 'roll');
  const yawInput = controlInput(state, 'yaw');
  const trim = clamp(finite(state.input?.pitchTrim), -0.5, 0.5);
  const flapMoment = -0.0025 * state.controls.flaps;
  const pitchAcceleration = effectiveness * (1.45 * pitchInput + 0.55 * trim + flapMoment) -
    0.5 * state.alpha - 0.95 * state.pitchRate;
  state.debug.pitchMoment = pitchAcceleration;
  if (state.onGround) {
    state.pitchRate = clamp(state.pitchRate + pitchAcceleration * dt, -0.7, 0.7);
    state.pitch = clamp(state.pitch + state.pitchRate * dt, 0, 0.3);
    if (state.pitch > 0.02 && state.stats.rotateSpeed === 0) state.stats.rotateSpeed = state.airspeed;
    if (state.pitch <= 0 && state.pitchRate < 0) state.pitchRate = 0;
    state.roll = 0;
    state.rollRate = 0;
    const speed = Math.hypot(state.vel.x, state.vel.z);
    const targetYawRate = yawInput * 0.3 * clamp(speed / 3, 0, 1) / (1 + speed / 24);
    state.yawRate += (targetYawRate - state.yawRate) * Math.min(1, dt * 5);
    state.heading += state.yawRate * dt;
    if (state.pitch > 0.245 && speed > 30) {
      state.damage.fuselage = clamp(state.damage.fuselage + dt * 0.08, 0, 1.2);
      addWarning(state, '抬轮角度过大：尾部擦地');
    }
  } else {
    state.pitchRate = clamp(state.pitchRate + pitchAcceleration * dt, -1.2, 1.2);
    state.rollRate = clamp(
      state.rollRate + (effectiveness * 2.1 * rollInput - 1.75 * state.rollRate - 0.08 * state.roll) * dt,
      -1.4,
      1.4
    );
    state.yawRate = clamp(
      state.yawRate + (effectiveness * 0.75 * yawInput - 1.3 * state.yawRate - 0.55 * state.beta) * dt,
      -0.8,
      0.8
    );
    state.pitch = clamp(state.pitch + state.pitchRate * dt, -1.25, 1.25);
    state.roll = clamp(state.roll + state.rollRate * dt, -1.35, 1.35);
    const coordinatedTurn = M.g * Math.tan(clamp(state.roll, -1.1, 1.1)) / Math.max(35, state.airspeed);
    state.heading += (state.yawRate + coordinatedTurn * 0.75) * dt;
  }
  state.heading = ((state.heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return aero;
}

function applyGroundResistance(state, dt, normalLoad, mass) {
  const speed = Math.hypot(state.vel.x, state.vel.z);
  if (speed < 1e-5) return;
  const paved = isOnPavedSurface(state.pos.x, state.pos.z);
  const rollingCoefficient = paved ? 0.018 : 0.075;
  const requestedBrake = Math.max(
    clamp(finite(state.input?.brake), 0, 1),
    clamp(finite(state.controls.brake), 0, 1),
    state.controls.parkingBrake ? 1 : 0
  );
  const hottestBrake = Math.max(...(state.systems.brakeTemps ?? [18, 18]));
  const brakeFade = hottestBrake > 420 ? 0.55 : 1;
  let brakeCoefficient = (paved ? 0.62 : 0.34) * requestedBrake * brakeFade;
  state.systems.wheelSkid = requestedBrake > 0.86 && speed > 24 && (!paved || state.environment.weather === 'rain');
  if (state.systems.wheelSkid) {
    brakeCoefficient *= 0.62;
    addWarning(state, '机轮抱死：已降低有效制动力');
  }
  const deceleration = (rollingCoefficient + brakeCoefficient) * Math.max(0, normalLoad) / mass;
  const change = Math.min(speed, deceleration * dt);
  state.vel.x -= state.vel.x / speed * change;
  state.vel.z -= state.vel.z / speed * change;
  state.effects.dust = paved ? Math.max(0, state.effects.dust - dt * 2) : clamp(speed / 35, 0, 1);
  state.effects.spray = state.environment.weather === 'rain' && paved ? clamp(speed / 45, 0, 1) : 0;
}

function alignGroundVelocity(state, dt) {
  const speed = Math.hypot(state.vel.x, state.vel.z);
  if (speed < 0.01) return;
  const forward = { x: Math.sin(state.heading), z: Math.cos(state.heading) };
  const direction = Math.sign(state.vel.x * forward.x + state.vel.z * forward.z) || 1;
  const alignment = 1 - Math.exp(-dt * 7);
  state.vel.x += (forward.x * speed * direction - state.vel.x) * alignment;
  state.vel.z += (forward.z * speed * direction - state.vel.z) * alignment;
}

function applyBirdStrike(state, bird = {}) {
  state.damage.birdStrike = true;
  state.damage.wings = clamp(state.damage.wings + (bird.wingDamage ?? 0.08), 0, 1.2);
  state.stats.collisions += 1;
  const engineNumber = Number.isFinite(bird.engine) ? Math.trunc(bird.engine) : 1;
  const engineIndex = clamp(engineNumber - 1, 0, state.engines.length - 1);
  if (bird.engineFail !== false) {
    const engine = state.engines[engineIndex];
    engine.damage = clamp(engine.damage + 0.55, 0, 1);
    engine.running = false;
    engine.failed = true;
    engine.startReason = '鸟击导致发动机损坏';
  }
  state.effects.flash = 1;
  state.effects.shake = 0.8;
  state.stats.events.push({ type: 'birdStrike', time: state.time, engine: engineIndex + 1 });
  pushMessage(state, `鸟击！发动机 ${engineIndex + 1} 损坏，执行发动机停车程序`, 'danger');
  if (bird.severe) {
    state.damage.structuralFailure = true;
    failMission(state, 'birdStrike', '严重鸟击造成翼面结构失效');
  }
}

function checkObjectCollisions(state) {
  const params = getAircraftParams(state);
  if (state.status === 'failed') return;
  if (state.debug.birdStrike && !state.damage.birdStrike) applyBirdStrike(state, { engine: 2 });
  for (const bird of state.environment.birds ?? []) {
    if (!bird || bird.hit || bird.active === false) continue;
    const position = bird.pos ?? bird;
    const distance = Math.hypot(state.pos.x - finite(position.x), state.pos.y - finite(position.y), state.pos.z - finite(position.z));
    if (distance <= (bird.radius ?? 14)) {
      bird.hit = true;
      applyBirdStrike(state, bird);
    }
  }
  for (const tree of state.environment.trees ?? []) {
    const position = tree.pos ?? tree;
    const height = tree.height ?? 22;
    const radius = (tree.radius ?? 5) + params.wingspan * 0.25;
    const ground = terrainHeight(position.x, position.z);
    if (
      Math.hypot(state.pos.x - position.x, state.pos.z - position.z) < radius &&
      state.pos.y < ground + height && state.pos.y > ground - 2
    ) {
      state.effects.treeStrike = 1;
      state.damage.wings = 1;
      state.damage.structuralFailure = true;
      state.stats.collisions += 1;
      failMission(state, 'treeCollision', '翼面撞树，结构严重损坏');
      return;
    }
  }
}

function checkGroundOutcome(state) {
  if (state.status === 'failed' || !state.onGround) return;
  const phase = state.mission.phase;
  const beyondEnd = state.pos.z > M.runwayThreshold + M.runwayLength || state.pos.z < M.runwayThreshold;
  if ((phase === 'takeoff' || phase === 'vacate' || phase === 'landing') && beyondEnd && !isOnPavedSurface(state.pos.x, state.pos.z) && state.groundSpeed > 8) {
    state.damage.gear = clamp(state.damage.gear + 0.4, 0, 1.2);
    state.stats.collisions += 1;
    failMission(state, 'runwayOverrun', '冲出跑道末端，起落架和机体受损');
    return;
  }
  if ((phase === 'vacate' || phase === 'landing') && !isOnPavedSurface(state.pos.x, state.pos.z) && state.groundSpeed > 35) {
    state.damage.gear = clamp(state.damage.gear + 0.3, 0, 1.2);
    failMission(state, 'runwayExcursion', '高速冲出跑道道面，飞机受损');
  }
}

function updateStructuralDamage(state, dt) {
  const params = getAircraftParams(state);
  if (state.gLoad > 4.2 || state.gLoad < -1.8) {
    state.damage.wings = clamp(state.damage.wings + dt * 0.3, 0, 1.2);
    addWarning(state, '过载超限：翼面结构受损');
  }
  if (state.mach > params.maxOperatingMach + 0.04) {
    state.damage.wings = clamp(state.damage.wings + dt * (state.mach - params.maxOperatingMach) * 0.8, 0, 1.2);
  }
  if (state.damage.wings >= 1 || state.damage.fuselage >= 1) {
    state.damage.structuralFailure = true;
  }
}

export function checkCollisions(state) {
  checkObjectCollisions(state);
  checkGroundOutcome(state);
}

export function updateDynamics(state, dt) {
  const params = getAircraftParams(state);
  const startedOnGround = state.onGround;
  const aero = computeAerodynamics(state);
  const thrust = updateThrust(state, aero.rho);
  updateAttitude(state, dt, aero);
  const axes = bodyAxes(state);
  const mass = Math.max(params.emptyMass, finite(state.weight, params.emptyMass + params.payload));
  const normalLoad = Math.max(0, mass * M.g - Math.max(0, state.lift * axes.up.y + thrust * axes.forward.y));
  const dragForce = {
    x: -aero.airDirection.x * state.drag,
    y: -aero.airDirection.y * state.drag,
    z: -aero.airDirection.z * state.drag
  };
  const sideMagnitude = state.q * params.wingArea * 0.9 * state.beta;
  const acceleration = {
    x: (thrust * axes.forward.x + state.lift * axes.up.x + dragForce.x - axes.right.x * sideMagnitude) / mass,
    y: (thrust * axes.forward.y + state.lift * axes.up.y + dragForce.y - axes.right.y * sideMagnitude) / mass - M.g,
    z: (thrust * axes.forward.z + state.lift * axes.up.z + dragForce.z - axes.right.z * sideMagnitude) / mass
  };
  state.gLoad = startedOnGround ? 1 : clamp((state.lift + Math.max(0, thrust * axes.forward.y)) / (mass * M.g), -3, 6);
  if (startedOnGround) {
    state.vel.x += acceleration.x * dt;
    state.vel.z += acceleration.z * dt;
    state.vel.y = 0;
    applyGroundResistance(state, dt, normalLoad, mass);
    alignGroundVelocity(state, dt);
    state.pos.x += state.vel.x * dt;
    state.pos.z += state.vel.z * dt;
    const upwardForce = state.lift * axes.up.y + thrust * axes.forward.y;
    const justLanded = state.stats.touchdownTime !== null &&
      state.time - state.stats.touchdownTime < 2.5;
    const goAroundPower = state.controls.throttle > 0.85 && state.pitch > 0.12;
    const canLiftoff = state.pitch > 0.025 && state.airspeed > 18 && upwardForce > mass * M.g &&
      (!justLanded || goAroundPower);
    const ground = terrainHeight(state.pos.x, state.pos.z);
    if (canLiftoff) {
      state.onGround = false;
      const horizontalSpeed = Math.hypot(state.vel.x, state.vel.z);
      state.vel.y = Math.max(0.2, horizontalSpeed * Math.sin(state.pitch) * 0.12);
      state.pos.y = ground + state.vel.y * dt;
      state.stats.takeoffTime ??= state.time;
      state.stats.liftoffSpeed = state.airspeed;
      state.stats.takeoffSpeed = state.airspeed;
      pushMessage(state, `离地，表速 ${Math.round(knots(state.airspeed))} 节`, 'success');
    } else {
      state.pos.y = ground;
      state.onGround = true;
    }
  } else {
    state.vel.x += acceleration.x * dt;
    state.vel.y += acceleration.y * dt;
    state.vel.z += acceleration.z * dt;
    state.pos.x += state.vel.x * dt;
    state.pos.y += state.vel.y * dt;
    state.pos.z += state.vel.z * dt;
    const ground = terrainHeight(state.pos.x, state.pos.z);
    if (state.pos.y <= ground) {
      const sink = state.vel.y;
      state.pos.y = ground;
      state.onGround = true;
      state.groundSpeed = Math.hypot(state.vel.x, state.vel.z);
      handleTouchdown(state, sink);
      state.vel.y = 0;
      if (sink < -7) {
        state.damage.fuselage = 1;
        state.damage.structuralFailure = true;
        failMission(state, 'terrainCollision', '极高下降率撞地，机体结构失效');
      }
    }
  }
  const ground = terrainHeight(state.pos.x, state.pos.z);
  state.altitude = state.pos.y;
  state.radioAltitude = Math.max(0, state.pos.y - ground);
  state.groundSpeed = Math.hypot(state.vel.x, state.vel.z);
  state.verticalSpeed = state.vel.y;
  const compression = state.onGround ? clamp(normalLoad / (mass * M.g), 0, 1) : 0;
  state.gear.compression = 0.04 + compression * 0.18;
  state.gear.leftCompression = state.gear.compression;
  state.gear.rightCompression = state.gear.compression;
  state.gear.noseCompression = state.gear.compression * 0.75;
  state.gear.tireSmoke = Math.max(0, state.gear.tireSmoke - dt * 0.7);
  state.effects.tireSmoke = state.gear.tireSmoke;
  state.wasOnGround = startedOnGround;
  updateStructuralDamage(state, dt);
  checkCollisions(state);
  if (!Number.isFinite(state.pos.x + state.pos.y + state.pos.z + state.vel.x + state.vel.y + state.vel.z)) {
    state.pos = { x: 0, y: 0, z: -1700 };
    state.vel = { x: 0, y: 0, z: 0 };
    failMission(state, 'numericalFailure', '飞行数据异常，模拟已安全停止');
  }
}
