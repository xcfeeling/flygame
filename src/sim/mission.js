import {
  GO_AROUND_SINK,
  M,
  TOUCHDOWN_SINK_HARD,
  TOUCHDOWN_SINK_SOFT,
  clamp,
  isOnPavedSurface,
  isOnRunway,
  knots
} from './config.js';
import { getAircraftParams } from './aircraftTypes.js';
import { addWarning, pushMessage } from './systems.js';

const PHASE_TEXT = Object.freeze({
  cold: {
    title: '冷舱准备',
    objective: '接通电源、启动 APU，并按顺序启动四发',
    radio: '云岭地面，CZ3261，停机位 6，开始冷舱准备。'
  },
  taxi: {
    title: '滑行',
    objective: (params) => `松开停留刹车，滑入 RWY36；起飞襟翼 ${params.takeoffFlap}°`,
    radio: '云岭地面，CZ3261 请求滑行至 RWY36。'
  },
  takeoff: {
    title: '起飞',
    objective: (params) => `保持跑道中线，约 ${params.vr} 节柔和抬轮`,
    radio: '云岭塔台，CZ3261 进入 RWY36，准备起飞。'
  },
  climb: {
    title: '爬升',
    objective: '建立正上升率，收轮并按计划收襟翼',
    radio: 'CZ3261 已离地，正上升率，起落架收上。'
  },
  cruise: {
    title: '巡航',
    objective: '保持高度与速度，准备下降和进近检查单',
    radio: '云岭区调，CZ3261 巡航稳定，准备下降。'
  },
  approach: {
    title: '进近',
    objective: (params) => `放轮、进近襟翼 ${params.approachFlap}°，着陆前襟翼 ${params.landingFlap}°`,
    radio: '云岭进近，CZ3261 建立 RWY36 进近。'
  },
  landing: {
    title: '着陆',
    objective: (params) => `襟翼 ${params.landingFlap}° 稳定进近；低高度下降率过大时必须复飞`,
    radio: '云岭塔台，CZ3261 五边，请求着陆。'
  },
  goAround: {
    title: '复飞',
    objective: '复飞油门，柔和抬头，正上升率后收轮',
    radio: 'CZ3261 复飞！建立正上升率。'
  },
  vacate: {
    title: '脱离跑道',
    objective: '减速并使用反推，转入联络道脱离跑道',
    radio: 'CZ3261 已接地，减速并准备脱离跑道。'
  },
  complete: {
    title: '任务完成',
    objective: '已安全脱离跑道，查看本次飞行评分',
    radio: 'CZ3261 已脱离跑道，感谢引导。'
  },
  failed: {
    title: '任务失败',
    objective: '查看事故原因与最终飞行参数',
    radio: 'CZ3261 飞行任务中止。'
  }
});

function phaseText(state, phase) {
  const params = getAircraftParams(state);
  const text = PHASE_TEXT[phase] ?? PHASE_TEXT.cold;
  return {
    ...text,
    objective: typeof text.objective === 'function' ? text.objective(params) : text.objective
  };
}

function setPhase(state, phase) {
  if (state.mission.phase === phase) return;
  state.mission.phase = phase;
  state.mission.phaseTimer = 0;
  state.status = phase;
  const text = phaseText(state, phase);
  state.mission.title = text.title;
  state.mission.objective = text.objective;
  state.mission.radio = text.radio;
  state.mission.radioTimer = 6;
  pushMessage(state, text.radio, 'radio');
  if (phase === 'takeoff') state.mission.clearedForTakeoff = true;
  if (phase === 'approach') state.mission.clearedForLanding = true;
}

export function calculateScore(state) {
  const params = getAircraftParams(state);
  const sink = state.stats.touchdownSink;
  if (sink === null || !Number.isFinite(sink)) return state.status === 'failed' ? 0 : state.score;
  const sinkPenalty = sink >= -1.2 ? 0 : sink >= -2.2 ? (-sink - 1.2) * 8 : 12 + (-sink - 2.2) * 14;
  const touchdown = state.stats.touchdownPosition;
  const deviation = touchdown ? Math.abs(touchdown.x) : M.runwayWidth;
  const deviationPenalty = Math.min(30, deviation * 1.1);
  const distance = state.stats.landingDistance;
  const distancePenalty = distance < 180 ? (180 - distance) * 0.025 : Math.max(0, distance - 1500) * 0.018;
  const damage = state.damage;
  const damagePenalty = Math.min(
    45,
    (damage.fuselage + damage.wings + damage.gear) * 24 +
    (damage.structuralFailure ? 35 : 0) +
    (damage.birdStrike ? 5 : 0)
  );
  const goAroundPenalty = (state.mission.goAroundCount ?? 0) * 4;
  const hardPenalty = state.stats.hardLandingCount * 10;
  const overweightPenalty = state.weight > params.maxLandingMass
    ? Math.min(12, (state.weight - params.maxLandingMass) / 1500)
    : 0;
  return Math.round(clamp(100 - sinkPenalty - deviationPenalty - distancePenalty - damagePenalty - goAroundPenalty - hardPenalty - overweightPenalty, 0, 100));
}

export function failMission(state, outcome, detail) {
  if (state.status === 'failed') return;
  state.status = 'failed';
  state.mission.phase = 'failed';
  state.mission.phaseTimer = 0;
  state.mission.title = PHASE_TEXT.failed.title;
  state.mission.objective = PHASE_TEXT.failed.objective;
  state.mission.radio = detail;
  state.outcome = outcome;
  state.outcomeDetail = detail;
  state.score = calculateScore(state);
  state.stats.events.push({ type: outcome, time: state.time, detail });
  pushMessage(state, detail, 'danger');
}

export function completeMission(state) {
  if (state.status === 'failed' || state.status === 'complete') return;
  state.mission.vacated = true;
  state.outcome = 'complete';
  state.outcomeDetail = '安全着陆并脱离跑道';
  state.score = calculateScore(state);
  setPhase(state, 'complete');
  pushMessage(state, `任务完成，综合评分 ${state.score}`, 'success');
}

export function enterGoAround(state, reason = '低高度下降率过大，立即复飞') {
  if (state.mission.phase === 'goAround' || state.status === 'failed') return;
  state.mission.goAroundCount = (state.mission.goAroundCount ?? 0) + 1;
  state.mission.goAroundReason = reason;
  state.mission.goAroundActive = true;
  setPhase(state, 'goAround');
  state.mission.radio = `云岭塔台，${reason}，CZ3261 复飞。`;
  addWarning(state, '复飞：建立正上升率');
  pushMessage(state, reason, 'danger');
}

export function handleTouchdown(state, sink) {
  const safeSink = Number.isFinite(sink) ? sink : -M.g;
  state.stats.touchdownSink = safeSink;
  state.stats.touchdownTime = state.time;
  state.stats.touchdownSpeed = state.groundSpeed;
  state.stats.touchdownG = state.gLoad;
  state.stats.touchdownPosition = { ...state.pos };
  state.stats.maxSink = Math.min(state.stats.maxSink, safeSink);
  const southbound = Math.cos(state.heading) < 0;
  state.stats.landingDistance = Math.max(
    0,
    southbound ? M.runwayThreshold + M.runwayLength - state.pos.z : state.pos.z - M.runwayThreshold
  );
  state.stats.approachDeviation = Math.max(state.stats.approachDeviation, Math.abs(state.pos.x));
  state.gear.tireSmoke = clamp((-safeSink - 0.5) / 3, 0.15, 1);
  state.effects.tireSmoke = state.gear.tireSmoke;
  let result;
  if (safeSink >= TOUCHDOWN_SINK_SOFT) {
    result = '正常着陆';
  } else if (safeSink >= TOUCHDOWN_SINK_HARD) {
    result = '硬着陆';
    state.stats.hardLandingCount += 1;
    state.damage.gear = clamp(state.damage.gear + 0.16 + (-safeSink + TOUCHDOWN_SINK_SOFT) * 0.12, 0, 1.2);
    pushMessage(state, `硬着陆：接地下降率 ${safeSink.toFixed(1)} m/s，检查起落架`, 'warning');
  } else {
    result = '重着陆/损坏';
    state.stats.hardLandingCount += 1;
    state.damage.gear = 1;
    state.damage.fuselage = clamp(state.damage.fuselage + 0.45, 0, 1.2);
  }
  state.stats.landingResult = result;
  state.stats.events.push({
    type: 'touchdown',
    time: state.time,
    sink: safeSink,
    speed: state.stats.touchdownSpeed,
    result
  });
  if (!isOnRunway(state.pos.x, state.pos.z)) {
    failMission(state, 'runwayExcursion', `冲出跑道：${result}，接地点不在跑道范围内`);
    return;
  }
  if (state.gear.position < 0.95 || Math.abs(state.roll) > 0.35) {
    state.damage.fuselage = clamp(state.damage.fuselage + 0.5, 0, 1.2);
    failMission(state, 'runwayExcursion', '起落架未放好或坡度过大，机体擦地');
    return;
  }
  if (safeSink < TOUCHDOWN_SINK_HARD) {
    failMission(state, 'heavyLanding', `重着陆：接地下降率 ${safeSink.toFixed(1)} m/s，起落架和机体损坏`);
    return;
  }
  state.score = calculateScore(state);
  setPhase(state, 'vacate');
  if (result === '正常着陆') {
    pushMessage(state, `正常接地：下降率 ${safeSink.toFixed(1)} m/s`, 'success');
  }
}

function updateChecklist(state) {
  const params = getAircraftParams(state);
  const phase = state.mission.phase;
  let items;
  if (phase === 'cold') {
    items = [
      ['电瓶与外部电源接通', state.systems.battery && state.systems.externalPower],
      ['APU 可用并接通引气', state.systems.apu.available && state.systems.apu.bleed],
      ['四路电泵接通，PACK 关闭', state.systems.electricPumps.every(Boolean) && state.systems.packOff]
    ];
    for (let index = 0; index < state.engines.length; index += 1) {
      const number = index + 1;
      items.push([
        `ENG${number} 启动并接入 GEN${number}`,
        state.engines[index].running && state.systems.generators[index]
      ]);
    }
  } else if (phase === 'taxi' || phase === 'takeoff') {
    items = [
      ['四发运转，停留刹车松开', state.engines.every((engine) => engine.running) && !state.controls.parkingBrake],
      [`起飞襟翼 ${params.takeoffFlap}°`, Math.abs(state.controls.flaps - params.takeoffFlap) < 1],
      ['配平与飞行操纵检查', Math.abs(state.input.pitchTrim) <= 0.5],
      ['保持 RWY36 中线', Math.abs(state.pos.x) < 8]
    ];
  } else if (phase === 'approach' || phase === 'landing' || phase === 'goAround') {
    const flap = phase === 'landing' ? params.landingFlap : params.approachFlap;
    items = [
      ['起落架放下并锁定', state.gear.position > 0.99 && state.gear.locked],
      [`${phase === 'landing' ? '着陆' : '进近'}襟翼至少 ${flap}°`, state.controls.flaps >= flap - 1],
      ['扰流板预位', state.controls.spoilers === 'armed' || state.controls.spoilers === 'ground'],
      ['下降率处于安全范围', state.verticalSpeed >= GO_AROUND_SINK]
    ];
  } else if (phase === 'vacate') {
    items = [
      ['油门慢车', state.controls.throttle <= 0.03],
      ['离开跑道进入联络道', !isOnRunway(state.pos.x, state.pos.z) && isOnPavedSurface(state.pos.x, state.pos.z)],
      ['滑行速度安全', state.groundSpeed < 12]
    ];
  } else {
    items = [
      ['保持飞行操纵', !state.damage.structuralFailure],
      ['监控系统与燃油', state.fuel.qty > 0],
      ['遵守当前管制指令', true]
    ];
  }
  state.mission.checklist = items.map(([text, done], index) => ({ id: `${phase}-${index}`, text, done: Boolean(done) }));
  const firstPending = state.mission.checklist.findIndex((item) => !item.done);
  state.mission.checklistIndex = firstPending < 0 ? state.mission.checklist.length : firstPending;
}

function updateColdObjective(state) {
  if (state.mission.phase !== 'cold') return;
  const params = getAircraftParams(state);
  let objective = '接通主电瓶与外部电源';
  if (state.systems.battery && state.systems.externalPower) objective = '启动 APU，等待 APU 可用后接通引气';
  if ((state.systems.apu.available && state.systems.apu.bleed) || state.engines.some((engine) => engine.running)) {
    for (let index = 0; index < state.engines.length; index += 1) {
      const number = index + 1;
      if (!state.engines[index].running) {
        const pump = index === 0 ? '左' : index === 1 ? '右' : `${number} 号`;
        objective = index === 0
          ? '接通左电泵、关闭 PACK，启动 ENG1'
          : `接通${pump}电泵与引气，启动 ENG${number}`;
        break;
      }
      if (!state.systems.generators[index]) {
        objective = `接入 GEN${number}`;
        break;
      }
    }
  }
  if (state.engines.every((engine) => engine.running) && state.systems.generators.every(Boolean)) {
    objective = `四发与四台发电机已接通，设置襟翼 ${params.takeoffFlap}°，松开停留刹车滑行`;
  }
  state.mission.objective = objective;
}

export function updateMission(state, dt) {
  if (state.status === 'failed') return;
  state.mission.phaseTimer += dt;
  state.mission.radioTimer = Math.max(0, state.mission.radioTimer - dt);
  if (state.verticalSpeed < 0) state.stats.maxSink = Math.min(state.stats.maxSink, state.verticalSpeed);
  state.stats.maxAltitude = Math.max(state.stats.maxAltitude, state.altitude);
  if (state.status === 'complete') {
    updateChecklist(state);
    return;
  }
  const phase = state.mission.phase;
  if (phase === 'cold' && state.engines.some((engine) => engine.running) && !state.controls.parkingBrake && state.groundSpeed > 0.5) {
    setPhase(state, 'taxi');
  } else if (phase === 'taxi' && isOnRunway(state.pos.x, state.pos.z) && state.controls.throttle > 0.75 && state.groundSpeed > 15) {
    setPhase(state, 'takeoff');
  } else if (phase === 'takeoff' && !state.onGround) {
    setPhase(state, 'climb');
  } else if (phase === 'climb' && state.radioAltitude > 600) {
    setPhase(state, 'cruise');
  } else if (phase === 'cruise' && state.verticalSpeed < -0.5 && state.radioAltitude < 500) {
    setPhase(state, 'approach');
  } else if (phase === 'approach' && state.radioAltitude < 80) {
    setPhase(state, 'landing');
  }
  const currentPhase = state.mission.phase;
  if ((currentPhase === 'approach' || currentPhase === 'landing') && !state.onGround) {
    if (state.radioAltitude < 55 && state.verticalSpeed < GO_AROUND_SINK) {
      enterGoAround(state, `低高度下降率 ${state.verticalSpeed.toFixed(1)} m/s，超过复飞门槛`);
    } else if (state.radioAltitude < 140 && state.verticalSpeed > 1.2 && state.controls.throttle > 0.85) {
      enterGoAround(state, '机组执行复飞');
    }
  } else if (currentPhase === 'goAround') {
    addWarning(state, '复飞中：保持正上升率');
    if (state.radioAltitude > 150 && state.verticalSpeed > 1) {
      state.mission.goAroundActive = false;
      setPhase(state, 'climb');
      pushMessage(state, '复飞状态稳定，重新加入爬升', 'success');
    }
  } else if (currentPhase === 'vacate') {
    const offRunway = !isOnRunway(state.pos.x, state.pos.z);
    if (offRunway && isOnPavedSurface(state.pos.x, state.pos.z) && state.groundSpeed < 12) {
      state.mission.vacated = true;
      completeMission(state);
    }
  }
  if (state.damage.structuralFailure) failMission(state, 'structuralFailure', '翼面或机体结构失效，任务失败');
  if (state.stalled && !state.onGround) addWarning(state, '失速：减小迎角并增加速度');
  updateWeightWarnings(state);
  updateWindWarnings(state);
  updateColdObjective(state);
  updateChecklist(state);
}

function updateWeightWarnings(state) {
  const params = getAircraftParams(state);
  const phase = state.mission.phase;
  if ((phase === 'takeoff' || phase === 'climb') && state.weight > params.maxTakeoffMass) {
    addWarning(state, `超过最大起飞重量 ${Math.round(params.maxTakeoffMass / 1000)} 吨`);
  }
  if (['approach', 'landing', 'vacate'].includes(phase) && state.weight > params.maxLandingMass) {
    addWarning(state, `超过最大着陆重量 ${Math.round(params.maxLandingMass / 1000)} 吨`);
  }
}

function updateWindWarnings(state) {
  const params = getAircraftParams(state);
  const phase = state.mission.phase;
  if (!['takeoff', 'climb', 'approach', 'landing', 'goAround', 'vacate'].includes(phase)) return;
  const relative = state.environment.windDirection * Math.PI / 180 - state.heading;
  const windSpeed = Math.max(0, state.environment.windSpeed);
  const headwind = windSpeed * Math.cos(relative);
  const crosswind = Math.abs(windSpeed * Math.sin(relative));
  const takeoff = phase === 'takeoff' || phase === 'climb';
  const maxTailwind = takeoff ? params.maxTailwindTakeoff : params.maxTailwindLanding;
  if (headwind < -maxTailwind / 1.94384449) {
    const tailwindKnots = -headwind * 1.94384449;
    addWarning(state, `顺风 ${tailwindKnots.toFixed(0)} 节：超过${takeoff ? '起飞' : '着陆'}顺风限制`);
  }
  if (crosswind > params.maxDemoCrosswind / 1.94384449) {
    addWarning(state, `侧风 ${(crosswind * 1.94384449).toFixed(0)} 节：超过演示侧风限制`);
  }
}

export function buildMissionSnapshot(state) {
  const text = phaseText(state, state.mission.phase);
  return {
    status: state.status,
    phase: state.mission.phase,
    title: state.mission.title || text.title,
    objective: state.mission.objective || text.objective,
    radio: state.mission.radio,
    radioTimer: state.mission.radioTimer,
    phaseTimer: state.mission.phaseTimer,
    tutorial: state.tutorial,
    checklistIndex: state.mission.checklistIndex,
    checklist: state.mission.checklist.map((item) => ({ ...item })),
    clearedForTakeoff: state.mission.clearedForTakeoff,
    clearedForLanding: state.mission.clearedForLanding,
    vacated: state.mission.vacated,
    goAround: state.mission.phase === 'goAround',
    goAroundCount: state.mission.goAroundCount ?? 0,
    outcome: state.outcome,
    outcomeDetail: state.outcomeDetail,
    score: state.score,
    warnings: [...state.systems.warnings],
    finalParameters: {
      touchdownSink: state.stats.touchdownSink,
      touchdownSpeedKnots: state.stats.touchdownSpeed === null ? null : knots(state.stats.touchdownSpeed),
      landingDistance: state.stats.landingDistance,
      approachDeviation: state.stats.approachDeviation,
      landingResult: state.stats.landingResult ?? null,
      hardLandingCount: state.stats.hardLandingCount,
      damage: { ...state.damage }
    }
  };
}
