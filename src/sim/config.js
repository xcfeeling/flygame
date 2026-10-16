export const M = Object.freeze({
  g: 9.80665,
  rho0: 1.225,
  gamma: 1.4,
  R: 287.05287,
  T0: 288.15,
  p0: 101325,
  dt: 1 / 120,
  runwayLength: 3600,
  runwayWidth: 45,
  runwayThreshold: -1800
});

export const TOUCHDOWN_SINK_SOFT = -2.2;
export const TOUCHDOWN_SINK_HARD = -3.6;
export const GO_AROUND_SINK = -2.6;
export const STALL_WARNING_MARGIN = 0.03;
export const MAX_HORIZON = 6 * 3600;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(min, max, value) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

export function knots(ms) {
  return ms * 1.94384449;
}

export function metersPerSecond(kts) {
  return kts / 1.94384449;
}

export function feet(meters) {
  return meters * 3.280839895;
}

export function feetPerMinute(ms) {
  return ms * 196.8503937;
}

export function airDensity(altitude) {
  const h = Math.max(-500, altitude);
  if (h < 11000) {
    const t = M.T0 - 0.0065 * h;
    return M.rho0 * Math.pow(t / M.T0, M.g / (M.R * 0.0065) - 1);
  }
  const t11 = M.T0 - 0.0065 * 11000;
  const rho11 = M.rho0 * Math.pow(t11 / M.T0, M.g / (M.R * 0.0065) - 1);
  return rho11 * Math.exp(-M.g * (h - 11000) / (M.R * 216.65));
}

export function speedOfSound(altitude) {
  return Math.sqrt(M.gamma * M.R * (M.T0 - 0.0065 * Math.min(altitude, 11000)));
}

export function terrainHeight(x, z) {
  if (x > -90 && x < 90 && z > -1900 && z < 1900) return 0;
  if (x > -125 && x < -35 && z > -2100 && z < 2100) return 0;
  if (x > -1000 && x < -120 && z > -1800 && z < -1400) return 0;
  if (x > -1000 && x < -120 && z > 1380 && z < 1700) return 0;
  const hills = Math.sin(x * 0.00077) * 115 + Math.cos(z * 0.00091) * 95;
  const ridges = Math.sin((x + z) * 0.00043) * 170 + Math.cos((x - z) * 0.00031) * 85;
  const distance = Math.max(0, Math.hypot(x, z) - 2500) * 0.013;
  return Math.max(-8, hills + ridges + distance - 120);
}

export function isOnRunway(x, z) {
  return Math.abs(x) <= M.runwayWidth / 2 && z >= M.runwayThreshold && z <= M.runwayThreshold + M.runwayLength;
}

export function isOnPavedSurface(x, z) {
  if (isOnRunway(x, z)) return true;
  if (x >= -122 && x <= -36 && z >= -2100 && z <= 2100) return true;
  if (x >= -1000 && x <= -120 && z >= -1800 && z <= -1400) return true;
  if (x >= -1000 && x <= -120 && z >= 1380 && z <= 1700) return true;
  if (x >= -430 && x <= -160 && z >= 1450 && z <= 1850) return true;
  return false;
}
