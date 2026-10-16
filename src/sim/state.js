import { getAircraftType } from './aircraftTypes.js';

function makeEngine(id) {
  return {
    id,
    n1: 0,
    n2: 0,
    egt: 18,
    oilTemp: 18,
    oilPressure: 0,
    fuelFlow: 0,
    thrust: 0,
    starter: false,
    starterTimer: 0,
    running: false,
    failed: false,
    fire: false,
    damage: 0,
    antiIce: false,
    reverser: 0,
    startReason: ''
  };
}

export function createInitialState(options = {}) {
  const spec = getAircraftType(options.aircraftType);
  const fuel = options.fuel ?? spec.initialFuel;
  const payload = options.payload ?? spec.payload;
  const timeOfDay = options.timeOfDay ?? 'day';
  const weather = options.weather ?? 'clear';
  const engineCount = spec.engineCount;
  return {
    version: 1,
    time: 0,
    status: 'cold',
    paused: false,
    outcome: null,
    outcomeDetail: '',
    score: 0,
    aircraft: {
      type: spec.id,
      name: spec.name,
      shortName: spec.shortName,
      category: spec.category
    },
    pos: { x: 0, y: 0, z: -1700 },
    vel: { x: 0, y: 0, z: 0 },
    heading: 0,
    pitch: 0,
    roll: 0,
    pitchRate: 0,
    rollRate: 0,
    yawRate: 0,
    alpha: 0,
    beta: 0,
    q: 0,
    mach: 0,
    gLoad: 1,
    lift: 0,
    drag: 0,
    thrust: 0,
    airspeed: 0,
    groundSpeed: 0,
    verticalSpeed: 0,
    altitude: 0,
    radioAltitude: 0,
    onGround: true,
    wasOnGround: true,
    stalled: false,
    stallWarning: false,
    overspeed: false,
    weight: spec.emptyMass + fuel * spec.fuelDensity + payload,
    fuel: { qty: fuel, burn: 0, initial: fuel },
    controls: {
      throttle: 0,
      pitch: 0,
      roll: 0,
      yaw: 0,
      flaps: 0,
      flapTarget: 0,
      brake: 0,
      parkingBrake: true,
      spoilers: 'stowed',
      gear: 'down',
      reverse: false
    },
    flaps: { left: 0, right: 0, target: 0, moving: false, fault: false },
    slats: { left: 0, right: 0 },
    gear: {
      position: 1,
      target: 1,
      moving: false,
      transition: 0,
      doors: 0,
      locked: true,
      inTransit: false,
      leftCompression: 0.18,
      rightCompression: 0.18,
      noseCompression: 0.12,
      compression: 0.16,
      tireSmoke: 0
    },
    engines: Array.from({ length: engineCount }, (_, index) => makeEngine(index + 1)),
    systems: {
      battery: false,
      batteryTimer: 0,
      externalPower: false,
      avionics: false,
      generators: Array(engineCount).fill(false),
      apu: { switch: false, starter: false, bleed: false, rpm: 0, available: false, timer: 0 },
      bleedAir: false,
      electricPumps: Array(engineCount).fill(false),
      hydraulic: Array(engineCount).fill(false),
      brakeTemps: Array(engineCount).fill(18),
      packOff: false,
      packTrip: false,
      cockpitHeat: 21,
      packTemp: 21,
      stickShaker: 0,
      rudderLimiter: 1,
      gearValve: 0,
      groundSpoilers: false,
      speedBrake: 0,
      probeHeat: false,
      windowHeat: false,
      beacon: false,
      navLights: false,
      landingLights: false,
      warnings: []
    },
    environment: {
      timeOfDay,
      weather,
      windDirection: options.windDirection ?? 180,
      windSpeed: options.windSpeed ?? 2,
      turbulence: 0,
      visibility: weather === 'rain' ? 5000 : 16000,
      temperature: 18,
      birds: []
    },
    mission: {
      phase: 'cold',
      title: '冷舱准备',
      objective: '接通主电瓶与外部电源',
      checklistIndex: 0,
      checklist: [],
      radio: '云岭地面，CZ3261，停机位 6，请求推出与滑行。',
      radioTimer: 0,
      phaseTimer: 0,
      clearedForTakeoff: false,
      clearedForLanding: false,
      backtracked: false,
      vacated: false
    },
    stats: {
      takeoffTime: null,
      takeoffSpeed: 0,
      rotateSpeed: 0,
      liftoffSpeed: 0,
      maxAltitude: 0,
      maxSink: 0,
      touchdownSink: null,
      touchdownTime: null,
      touchdownSpeed: null,
      touchdownG: null,
      touchdownPosition: null,
      landingDistance: 0,
      approachDeviation: 0,
      hardLandingCount: 0,
      collisions: 0,
      events: []
    },
    damage: {
      fuselage: 0,
      wings: 0,
      gear: 0,
      hydroLock: false,
      structuralFailure: false,
      birdStrike: false
    },
    effects: {
      dust: 0,
      spray: 0,
      smoke: 0,
      debris: 0,
      gravel: 0,
      tireSmoke: 0,
      treeStrike: 0,
      shake: 0,
      flash: 0
    },
    input: {
      pitch: 0,
      roll: 0,
      yaw: 0,
      throttleDelta: 0,
      brake: 0,
      pitchTrim: 0
    },
    messages: [],
    tutorial: true,
    camera: 'cockpit',
    simRate: 1,
    debug: {}
  };
}

export function resetState(state, options = {}) {
  const requestedType = options.aircraftType ?? state?.aircraft?.type;
  const spec = getAircraftType(requestedType);
  const preserveFuel = options.aircraftType === undefined || options.aircraftType === state?.aircraft?.type;
  const fuel = options.fuel ?? (preserveFuel ? state?.fuel?.initial : undefined) ?? spec.initialFuel;
  return createInitialState({ ...options, aircraftType: spec.id, fuel });
}
