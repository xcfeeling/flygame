export const DEFAULT_AIRCRAFT_TYPE = 'b747-400';

const COMMON = Object.freeze({
  category: 'airplane',
  manufacturer: 'Boeing',
  family: '747',
  fuelDensity: 0.802,
  engineCount: 4,
  cD0: 0.021,
  k: 0.042,
  cLAlpha: 4.9,
  flapPerDeg: 0.018,
  cLAlpha0: 0.24,
  alphaStall: 0.24,
  alphaMax: 0.42,
  geSpan: 64.4,
  groundEffectHeight: 11,
  flapSettings: Object.freeze([0, 1, 5, 10, 20, 25, 30]),
  takeoffFlap: 10,
  approachFlap: 25,
  landingFlap: 30,
  maxGearSpeed: 270,
  maxFlapSpeed: 265,
  maxOperatingMach: 0.9,
  reverseMinN1: 0.82,
  maxDemoCrosswind: 35,
  maxTailwindTakeoff: 10,
  maxTailwindLanding: 10,
  gearTransitionTime: 8,
  flapTransitionTime: 7,
  cockpitModel: 'b747',
  exteriorModel: 'b747'
});

export const AIRCRAFT_TYPES = Object.freeze({
  'b747-400': Object.freeze({
    ...COMMON,
    id: 'b747-400',
    name: '波音 747-400',
    shortName: 'B747-400',
    description: '经典四发宽体客机，上层甲板、四油门与双人驾驶盘座舱。',
    cockpitEye: Object.freeze({ x: -0.82, y: 7.1, z: 25.2 }),
    cockpitTarget: Object.freeze({ x: -0.82, y: 7.35, z: 36 }),
    length: 70.6,
    wingspan: 64.4,
    wingArea: 525,
    wingChord: 12.4,
    refV: 76,
    emptyMass: 178800,
    maxTakeoffMass: 396890,
    maxLandingMass: 295740,
    maxZeroFuelMass: 242500,
    payload: 42000,
    initialFuel: 100000,
    maxThrust: 282000,
    engineName: 'CF6-80C2',
    v1: 155,
    vr: 160,
    v2: 168,
    vApp25: 150,
    vApp30: 145,
    visualScale: 1,
    enginePositions: Object.freeze([
      Object.freeze({ x: -20.6, y: 2.77, z: -2.22 }),
      Object.freeze({ x: -10.4, y: 1.66, z: 4.75 }),
      Object.freeze({ x: 10.4, y: 1.66, z: 4.75 }),
      Object.freeze({ x: 20.6, y: 2.77, z: -2.22 })
    ])
  }),
  'b747-8f': Object.freeze({
    ...COMMON,
    id: 'b747-8f',
    name: '波音 747-8F',
    shortName: 'B747-8F',
    description: '加长机身货运型，GEnx 发动机，更大翼展与最大起飞重量。',
    cockpitEye: Object.freeze({ x: -0.82, y: 7.1, z: 27.4 }),
    cockpitTarget: Object.freeze({ x: -0.82, y: 7.35, z: 38.5 }),
    length: 76.3,
    wingspan: 68.5,
    wingArea: 554,
    wingChord: 13.1,
    refV: 78,
    emptyMass: 197131,
    maxTakeoffMass: 447700,
    maxLandingMass: 337000,
    maxZeroFuelMass: 295000,
    payload: 65000,
    initialFuel: 110000,
    maxThrust: 296000,
    engineName: 'GEnx-2B67',
    v1: 160,
    vr: 165,
    v2: 173,
    vApp25: 154,
    vApp30: 149,
    visualScale: 1.075,
    enginePositions: Object.freeze([
      Object.freeze({ x: -22.2, y: 2.78, z: -3.47 }),
      Object.freeze({ x: -11.1, y: 1.73, z: 4.32 }),
      Object.freeze({ x: 11.1, y: 1.73, z: 4.32 }),
      Object.freeze({ x: 22.2, y: 2.78, z: -3.47 })
    ])
  })
});

export function getAircraftType(id = DEFAULT_AIRCRAFT_TYPE) {
  return AIRCRAFT_TYPES[id] || AIRCRAFT_TYPES[DEFAULT_AIRCRAFT_TYPE];
}

export function listAircraftTypes() {
  return Object.values(AIRCRAFT_TYPES);
}

export function getAircraftParams(state) {
  return getAircraftType(state?.aircraft?.type ?? DEFAULT_AIRCRAFT_TYPE);
}
