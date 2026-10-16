import * as THREE from 'three';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const DOME_RADIUS = 7000;
const STAR_RADIUS = 5600;
const GALAXY_RADIUS = 5900;
const CLOUD_SIZE = 36000;
const CLOUD_DRIFT_WRAP = 1000;
const PUFF_DRIFT_WRAP = 20000;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_RADIUS = 85;
const SHADOW_LIGHT_DISTANCE = 620;
const MOON_PHASE = 0.42;
const MOON_ANGULAR_RADIUS = 0.03;
const LATITUDE = 26 * DEG;
const SUN_DECLINATION = -6 * DEG;
const MOON_DECLINATION = -28 * DEG;
const MAX_VISIBILITY = 20000;
const MIN_VISIBILITY = 120;
const NIGHT_FOG_LUMINANCE = 0.015;
const MIN_PRECIPITATION_RADIUS = 1.6;

const PHASE_HOURS = { dawn: 6.1, day: 12.6, dusk: 18.2, night: 23.2 };

const WEATHER_VISIBILITY = {
  clear: 18000,
  overcast: 12000,
  rain: 5000,
  storm: 3500,
  snow: 4000,
  fog: 800
};
const WEATHER_LIGHT = { clear: 1, overcast: 0.55, rain: 0.44, storm: 0.26, snow: 0.52, fog: 0.5 };
const WEATHER_AMBIENT = { clear: 1, overcast: 1.12, rain: 1.05, storm: 0.9, snow: 1.2, fog: 1.3 };
const WEATHER_SKY_COVER = { clear: 0, overcast: 0.72, rain: 0.6, storm: 0.88, snow: 0.66, fog: 0.52 };
const WEATHER_CLOUD_SHIFT = { clear: 0, overcast: 0.34, rain: 0.3, storm: 0.44, snow: 0.27, fog: 0.3 };
const WEATHER_CLOUD_OPACITY = { clear: 1, overcast: 1.3, rain: 1.45, storm: 1.7, snow: 1.4, fog: 1 };
const WEATHER_STAR = { clear: 1, overcast: 0.1, rain: 0.06, storm: 0.04, snow: 0.25, fog: 0.15 };
const WEATHER_RAIN_COUNT = { rain: 900, storm: 1600 };

const HEMI_DAY_SKY = new THREE.Color(0xb9dcff);
const HEMI_DAY_GROUND = new THREE.Color(0x4c5c34);
const HEMI_NIGHT_SKY = new THREE.Color(0x2c3f66);
const HEMI_NIGHT_GROUND = new THREE.Color(0x141c1c);
const AMBIENT_DAY = new THREE.Color(0xdfeaff);
const AMBIENT_NIGHT = new THREE.Color(0x33436b);
const SUN_LOW_COLOR = new THREE.Color(0xff9d5c);
const SUN_HIGH_COLOR = new THREE.Color(0xfff2dc);
const MOON_LIGHT_COLOR = new THREE.Color(0x9fb8e8);
const SUN_DISC_LOW = new THREE.Color(0xffd9a0);
const SUN_DISC_HIGH = new THREE.Color(0xfff6e2);
const MOON_DISC_COLOR = new THREE.Color(0xc9d9f5);
const FLASH_COLOR = new THREE.Color(0x9fb4e8);
const RAIN_DAY_COLOR = new THREE.Color(0xaec6db);
const RAIN_NIGHT_COLOR = new THREE.Color(0x9db4d6);

const OVERCAST_GRAY = {
  day: new THREE.Color(0x939aa3),
  dusk: new THREE.Color(0x4b4549),
  night: new THREE.Color(0x151b29)
};
const CLOUD_TINT = {
  day: new THREE.Color(0xf7fbff),
  dusk: new THREE.Color(0xffc9a0),
  night: new THREE.Color(0x36435f)
};
const CLOUD_STORM_TINT = new THREE.Color(0x4b535f);
const CLOUD_NIGHT_STORM_TINT = new THREE.Color(0x141a26);
const CLOUD_SUNSET = new THREE.Color(0xffab72);
const GALACTIC_POLE = new THREE.Vector3(0.32, 0.62, -0.72).normalize();

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapCentered(value, size) {
  return value - size * Math.round(value / size);
}

function seededRandom(seed = 1234567) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function gridNoise(x, y, periodX, periodY, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % periodX) + periodX) % periodX;
  const x1 = (x0 + 1) % periodX;
  const y0 = ((yi % periodY) + periodY) % periodY;
  const y1 = (y0 + 1) % periodY;
  const top = lerp(hash2(x0, y0, seed), hash2(x1, y0, seed), u);
  const bottom = lerp(hash2(x0, y1, seed), hash2(x1, y1, seed), u);
  return lerp(top, bottom, v);
}

function gridFbm(x, y, periodX, periodY, octaves, seed) {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let fx = 1;
  let fy = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * gridNoise(x * periodX * fx, y * periodY * fy, periodX * fx, periodY * fy, seed + i * 733);
    norm += amplitude;
    amplitude *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

function ensureLuminance(color, minimum) {
  const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  if (luminance >= minimum || luminance <= 0) return;
  color.multiplyScalar(minimum / luminance);
}

function createCloudTexture(size, seed, periodX, periodY, octaves, sharpen) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const base = gridFbm(u, v, periodX, periodY, octaves, seed);
      const fine = gridFbm(u, v, periodX * 4, periodY * 4, 2, seed + 5171);
      const density = clamp((base - 0.5) * sharpen + 0.5, 0, 1);
      const detail = clamp(0.35 + base * 0.95 - fine * 0.4, 0, 1);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(density * 255);
      data[offset + 1] = Math.round(detail * 255);
      data[offset + 2] = Math.round(clamp(base * 1.15, 0, 1) * 255);
      data[offset + 3] = Math.round(density * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function createPuffTexture(size, seed) {
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const radial = clamp(1 - Math.sqrt(dx * dx + dy * dy), 0, 1);
      const noise = gridFbm(x / size, y / size, 3, 3, 4, seed);
      const puff = clamp(Math.pow(radial, 0.75) * (0.5 + 0.8 * noise), 0, 1);
      const shade = clamp(0.45 + noise * 0.75 - radial * 0.22, 0, 1);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(puff * 255);
      data[offset + 1] = Math.round(shade * 255);
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(puff * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createGalaxyTexture(width, height, seed, pole) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const tv = (y + 0.5) / height;
    const theta = (1 - tv) * Math.PI;
    const sinTheta = Math.sin(theta);
    const dy = Math.cos(theta);
    for (let x = 0; x < width; x += 1) {
      const tu = (x + 0.5) / width;
      const angle = tu * Math.PI * 2;
      const dx = -Math.cos(angle) * sinTheta;
      const dz = Math.sin(angle) * sinTheta;
      const band = Math.abs(dx * pole.x + dy * pole.y + dz * pole.z);
      const core = Math.pow(clamp(1 - band / 0.34, 0, 1), 1.7);
      const halo = Math.pow(clamp(1 - band / 0.75, 0, 1), 2.6);
      const noise = gridFbm(tu, tv, 6, 3, 4, seed);
      const grain = gridFbm(tu, tv, 48, 24, 2, seed + 911);
      const brightness = core * (0.55 + 0.75 * noise) + halo * 0.18 * (0.6 + 0.5 * noise);
      const speck = Math.pow(clamp((grain - 0.6) / 0.4, 0, 1), 2.4) * core;
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(clamp(brightness * 0.36 + speck * 0.5, 0, 1) * 255);
      data[offset + 1] = Math.round(clamp(brightness * 0.33 + speck * 0.52, 0, 1) * 255);
      data[offset + 2] = Math.round(clamp(brightness * 0.42 + speck * 0.56, 0, 1) * 255);
      data[offset + 3] = Math.round(clamp(brightness * 1.4, 0, 1) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
}

function skyStop(alt, zenith, horizon, ground, scatter, glow, haze, gradient, twilight) {
  return {
    alt,
    zenith: new THREE.Color(zenith),
    horizon: new THREE.Color(horizon),
    ground: new THREE.Color(ground),
    scatter: new THREE.Color(scatter),
    glow,
    haze,
    gradient,
    twilight
  };
}

const SKY_STOPS = [
  skyStop(-90, 0x01030a, 0x05090f, 0x04070c, 0x101830, 0.04, 0.5, 0.6, 0),
  skyStop(-16, 0x030713, 0x0b1224, 0x070c17, 0x1c2642, 0.1, 0.58, 0.6, 0.04),
  skyStop(-9, 0x081029, 0x272a52, 0x121527, 0x57415c, 0.3, 0.68, 0.72, 0.3),
  skyStop(-4, 0x142348, 0x8a4636, 0x2a2130, 0xc26440, 0.62, 0.78, 0.86, 0.85),
  skyStop(0, 0x224477, 0xff9455, 0x54403c, 0xffab6b, 1, 0.84, 0.95, 1),
  skyStop(4, 0x2a63a8, 0xf3bd8f, 0x7b6a5b, 0xffd49b, 0.8, 0.7, 1.05, 0.5),
  skyStop(14, 0x2f6cb3, 0xc9dff2, 0x9fb3bd, 0xffeccd, 0.45, 0.46, 1.25, 0.14),
  skyStop(90, 0x2b66ad, 0xc3dcf0, 0xa8bcc6, 0xfff4e2, 0.34, 0.38, 1.4, 0.06)
];

const SKY_VERTEX = `
varying vec3 vSkyDirection;
void main() {
  vSkyDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDirection;
uniform vec3 uSunDiscColor;
uniform vec3 uSunScatter;
uniform vec3 uMoonDirection;
uniform vec3 uMoonColor;
uniform vec3 uFlashDirection;
uniform vec3 uFlashColor;
uniform float uGradient;
uniform float uHaze;
uniform float uSunGlow;
uniform float uSunDisc;
uniform float uTwilight;
uniform float uMoonPhase;
uniform float uMoonVisibility;
uniform float uFlash;
varying vec3 vSkyDirection;

void main() {
  vec3 dir = normalize(vSkyDirection);
  float height = clamp(dir.y, -1.0, 1.0);
  float up = pow(clamp(height, 0.0, 1.0), uGradient);
  vec3 color = mix(uHorizon, uZenith, up);

  float horizonBand = exp(-abs(height) * 20.0);
  float groundMix = max(1.0 - smoothstep(-0.07, 0.0, height), horizonBand * uHaze);
  color = mix(color, uGround, groundMix);

  vec3 sunDirection = normalize(uSunDirection);
  float sunAmount = max(dot(dir, sunDirection), 0.0);
  float sunGlow = pow(sunAmount, 8.0) * 0.4 + pow(sunAmount, 48.0) * 0.7 + pow(sunAmount, 420.0) * 0.85;
  color += uSunScatter * sunGlow * uSunGlow;
  color += uSunScatter * pow(sunAmount, 3.0) * exp(-max(height, 0.0) * 6.0) * uTwilight * 0.5;
  color += uSunDiscColor * pow(sunAmount, 3200.0) * uSunDisc;

  vec3 moonDirection = normalize(uMoonDirection);
  float moonAmount = max(dot(dir, moonDirection), 0.0);
  vec3 moonReference = normalize(mix(vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0), step(0.985, abs(moonDirection.y))));
  vec3 moonRight = normalize(cross(moonDirection, moonReference));
  vec3 moonUp = cross(moonRight, moonDirection);
  vec2 moonPlane = vec2(dot(dir, moonRight), dot(dir, moonUp)) / ${MOON_ANGULAR_RADIUS};
  float moonDisc = 1.0 - smoothstep(0.93, 1.02, length(moonPlane));
  float moonShadow = 1.0 - smoothstep(0.93, 1.02, length(moonPlane - vec2(uMoonPhase, 0.0)));
  float moonLit = moonDisc * (1.0 - 0.9 * moonShadow);
  float moonHalo = pow(moonAmount, 260.0) * 0.3 + pow(moonAmount, 22.0) * 0.05;
  color += uMoonColor * (moonLit + moonHalo) * uMoonVisibility;

  float flashAmount = max(dot(dir, normalize(uFlashDirection)), 0.0);
  color += uFlashColor * uFlash * (0.28 + 1.5 * pow(flashAmount, 1.6) + horizonBand * 0.35);

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CLOUD_VERTEX = `
#include <fog_pars_vertex>
varying vec3 vCloudWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vCloudWorldPosition = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const CLOUD_FRAGMENT = `
uniform sampler2D uMap;
uniform vec2 uDrift;
uniform float uTile;
uniform float uCoverage;
uniform float uSoftness;
uniform float uOpacity;
uniform float uDetail;
uniform vec3 uTint;
uniform vec3 uSunDirection;
uniform float uSunLip;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec3 vCloudWorldPosition;
#include <fog_pars_fragment>
void main() {
  vec2 uv = (vCloudWorldPosition.xz + uDrift) / uTile;
  vec4 texel = texture2D(uMap, uv);
  float density = texel.r;
  float alpha = smoothstep(uCoverage, uCoverage + uSoftness, density) * uOpacity;

  float distanceToCamera = distance(vCloudWorldPosition, cameraPosition);
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, distanceToCamera);
  alpha = clamp(alpha * fade, 0.0, 1.0);
  if (alpha <= 0.004) discard;

  float core = smoothstep(uCoverage, min(uCoverage + uSoftness * 2.2, 1.0), density);
  float shade = mix(1.0, 0.86 + 0.26 * texel.g, uDetail) * mix(1.0, 0.86, core * uDetail);
  vec3 toCloud = normalize(vCloudWorldPosition - cameraPosition);
  float facing = max(dot(toCloud, normalize(uSunDirection)), 0.0);
  float lip = 1.0 + uSunLip * pow(facing, 3.0);
  vec3 color = uTint * shade * lip;

  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const PUFF_VERTEX = `
#include <fog_pars_vertex>
varying vec2 vPuffUv;
varying vec3 vPuffWorldPosition;
varying float vPuffInstanceShade;
void main() {
  vPuffUv = uv;
  #ifdef USE_INSTANCING
    vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 size = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  #else
    vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 size = vec3(1.0);
  #endif
  #ifdef USE_INSTANCING_COLOR
    vPuffInstanceShade = instanceColor.r;
  #else
    vPuffInstanceShade = 1.0;
  #endif
  vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 cameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 worldPosition = center + cameraRight * position.x * size.x + cameraUp * position.y * size.y;
  vPuffWorldPosition = worldPosition;
  vec4 mvPosition = viewMatrix * vec4(worldPosition, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const PUFF_FRAGMENT = `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform vec3 uSunDirection;
uniform float uSunLip;
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uDetail;
varying vec2 vPuffUv;
varying vec3 vPuffWorldPosition;
varying float vPuffInstanceShade;
#include <fog_pars_fragment>
void main() {
  vec4 texel = texture2D(uMap, vPuffUv);
  float distanceToCamera = distance(vPuffWorldPosition, cameraPosition);
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, distanceToCamera);
  float alpha = clamp(texel.a * fade, 0.0, 1.0);
  if (alpha <= 0.01) discard;

  float shade = (0.86 + 0.28 * texel.g) * mix(1.0, vPuffInstanceShade, uDetail);
  vec3 toPuff = normalize(vPuffWorldPosition - cameraPosition);
  float facing = max(dot(toPuff, normalize(uSunDirection)), 0.0);
  float lip = 1.0 + uSunLip * pow(facing, 3.0);
  vec3 color = uTint * shade * lip;

  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const STAR_VERTEX = `
attribute float aStarSize;
attribute float aStarBrightness;
attribute vec3 aStarColor;
attribute float aStarPhase;
uniform float uPixelRatio;
uniform float uTime;
uniform float uOpacity;
varying vec3 vStarColor;
varying float vStarAlpha;
void main() {
  vStarColor = aStarColor;
  float twinkle = 0.78 + 0.22 * sin(uTime * (0.6 + aStarPhase * 1.9) + aStarPhase * 37.0);
  vStarAlpha = aStarBrightness * twinkle * uOpacity;
  gl_PointSize = max(1.0, aStarSize * uPixelRatio);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAR_FRAGMENT = `
varying vec3 vStarColor;
varying float vStarAlpha;
void main() {
  float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float falloff = 1.0 - smoothstep(0.05, 1.0, radius);
  float alpha = falloff * vStarAlpha;
  if (alpha <= 0.003) discard;
  gl_FragColor = vec4(vStarColor * alpha, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SNOW_VERTEX = `
attribute float aFlakeSize;
attribute float aFlakePhase;
uniform float uSizeScale;
uniform float uOpacity;
uniform float uTime;
varying float vFlakeAlpha;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float flutter = 0.82 + 0.18 * sin(uTime * 1.7 + aFlakePhase * 12.0);
  vFlakeAlpha = uOpacity * flutter;
  gl_PointSize = clamp(aFlakeSize * uSizeScale / max(-mvPosition.z, 0.6), 1.0, 48.0);
}
`;

const SNOW_FRAGMENT = `
uniform vec3 uFlakeColor;
varying float vFlakeAlpha;
void main() {
  float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float alpha = (1.0 - smoothstep(0.3, 1.0, radius)) * vFlakeAlpha;
  if (alpha <= 0.004) discard;
  gl_FragColor = vec4(uFlakeColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function hourFromEnvironment(environment) {
  const value = environment?.timeOfDay;
  if (typeof value === 'number' && Number.isFinite(value)) return ((value % 24) + 24) % 24;
  const text = String(value ?? 'day').toLowerCase();
  if (text.includes('night') || text.includes('midnight') || text.includes('夜')) return PHASE_HOURS.night;
  if (text.includes('dawn') || text.includes('sunrise') || text.includes('morning') || text.includes('黎明') || text.includes('晨')) {
    return PHASE_HOURS.dawn;
  }
  if (text.includes('dusk') || text.includes('sunset') || text.includes('evening') || text.includes('黄昏') || text.includes('暮')) {
    return PHASE_HOURS.dusk;
  }
  return PHASE_HOURS.day;
}

function phaseFromEnvironment(environment) {
  const value = environment?.timeOfDay;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const hours = ((value % 24) + 24) % 24;
    if (hours < 5.0 || hours >= 19.4) return 'night';
    if (hours < 6.9) return 'dawn';
    if (hours > 17.6) return 'dusk';
    return 'day';
  }
  const text = String(value ?? 'day').toLowerCase();
  if (text.includes('night') || text.includes('midnight') || text.includes('夜')) return 'night';
  if (text.includes('dawn') || text.includes('sunrise') || text.includes('黎明') || text.includes('晨')) return 'dawn';
  if (text.includes('dusk') || text.includes('sunset') || text.includes('evening') || text.includes('黄昏') || text.includes('暮')) return 'dusk';
  return 'day';
}

function weatherFromEnvironment(environment) {
  const weather = String(environment?.weather ?? 'clear').toLowerCase();
  if (weather.includes('snow') || weather.includes('雪')) return 'snow';
  if (weather.includes('storm') || weather.includes('thunder') || weather.includes('雷')) return 'storm';
  if (weather.includes('rain') || weather.includes('雨')) return 'rain';
  if (weather.includes('fog') || weather.includes('mist') || weather.includes('雾')) return 'fog';
  if (weather.includes('overcast') || weather.includes('cloud') || weather.includes('阴')) return 'overcast';
  return 'clear';
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.phase = 'day';
    this.weather = 'clear';
    this.visibility = WEATHER_VISIBILITY.clear;
    this.starfield = WEATHER_STAR.clear;
    this.sunDirection = new THREE.Vector3(-0.45, 0.82, 0.35).normalize();
    this.moonDirection = new THREE.Vector3(0.35, 0.7, 0.4).normalize();
    this.lightDirection = this.sunDirection.clone();
    this.flashDirection = new THREE.Vector3(0.3, 0.5, 0.4).normalize();
    this.flashLevel = 0;
    this.flashTimer = 4.5;
    this.flashAge = 0;
    this.flashActive = false;
    this.flashPeak = 1;
    this.drift = new THREE.Vector2(0, 0);
    this.cloudDrift = new THREE.Vector2(0, 0);
    this.shadowTexel = (SHADOW_RADIUS * 2) / SHADOW_MAP_SIZE;
    this.cloudFade = { near: 6000, far: 15000 };

    this._zenith = new THREE.Color();
    this._horizon = new THREE.Color();
    this._ground = new THREE.Color();
    this._scatter = new THREE.Color();
    this._overcast = new THREE.Color();
    this._fogColor = new THREE.Color();
    this._cloudTint = new THREE.Color();
    this._lightColor = new THREE.Color();
    this._hemiSky = new THREE.Color();
    this._hemiGround = new THREE.Color();
    this._ambientColor = new THREE.Color();
    this._palette = { glow: 1, haze: 0.4, gradient: 1, twilight: 0.2 };

    const random = seededRandom(48151);

    this.cumulusTexture = createCloudTexture(256, 1301, 4, 4, 4, 1.45);
    this.cirrusTexture = createCloudTexture(256, 7331, 2, 8, 4, 1.15);
    this.puffTexture = createPuffTexture(128, 2711);
    this.galaxyTexture = createGalaxyTexture(256, 128, 6173, GALACTIC_POLE);

    this.uniforms = {
      uZenith: { value: this._zenith },
      uHorizon: { value: this._horizon },
      uGround: { value: this._ground },
      uSunDirection: { value: this.sunDirection },
      uSunDiscColor: { value: SUN_DISC_HIGH.clone() },
      uSunScatter: { value: this._scatter },
      uMoonDirection: { value: this.moonDirection },
      uMoonColor: { value: MOON_DISC_COLOR.clone() },
      uFlashDirection: { value: this.flashDirection },
      uFlashColor: { value: FLASH_COLOR.clone() },
      uGradient: { value: 1.2 },
      uHaze: { value: 0.45 },
      uSunGlow: { value: 0.5 },
      uSunDisc: { value: 1 },
      uTwilight: { value: 0.2 },
      uMoonPhase: { value: MOON_PHASE },
      uMoonVisibility: { value: 0 },
      uFlash: { value: 0 }
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 48, 28),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
      })
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    this.galaxy = new THREE.Mesh(
      new THREE.SphereGeometry(GALAXY_RADIUS, 40, 24),
      new THREE.MeshBasicMaterial({
        map: this.galaxyTexture,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
        fog: false
      })
    );
    this.galaxy.frustumCulled = false;
    this.galaxy.renderOrder = -950;
    scene.add(this.galaxy);

    const starCount = 2400;
    const starPositions = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const starBrightness = new Float32Array(starCount);
    const starColors = new Float32Array(starCount * 3);
    const starPhases = new Float32Array(starCount);
    const starPalette = [0xbfd4ff, 0xdce8ff, 0xffffff, 0xfff0d0, 0xffd7a8, 0xffb492];
    const starColor = new THREE.Color();
    const bandRight = new THREE.Vector3(GALACTIC_POLE.y, -GALACTIC_POLE.x, 0).normalize();
    const bandUp = new THREE.Vector3().crossVectors(GALACTIC_POLE, bandRight).normalize();
    const direction = new THREE.Vector3();
    for (let i = 0; i < starCount; i += 1) {
      const inBand = i % 5 < 2;
      if (inBand) {
        const angle = random() * Math.PI * 2;
        const spread = (random() - 0.5) * (random() * random()) * 0.62;
        direction.copy(bandRight).multiplyScalar(Math.cos(angle)).addScaledVector(bandUp, Math.sin(angle));
        direction.addScaledVector(GALACTIC_POLE, spread).normalize();
      } else {
        const azimuth = random() * Math.PI * 2;
        const height = random() * 1.9 - 0.9;
        const radius = Math.sqrt(Math.max(0, 1 - height * height));
        direction.set(Math.cos(azimuth) * radius, height, Math.sin(azimuth) * radius).normalize();
      }
      starPositions[i * 3] = direction.x * STAR_RADIUS;
      starPositions[i * 3 + 1] = direction.y * STAR_RADIUS;
      starPositions[i * 3 + 2] = direction.z * STAR_RADIUS;
      const magnitude = Math.pow(random(), 3.2);
      starSizes[i] = 1 + magnitude * 3.4;
      starBrightness[i] = clamp(0.35 + magnitude * 1.5, 0.2, 1.8) * (inBand ? 0.62 : 1);
      starColor.setHex(starPalette[Math.floor(random() * starPalette.length)]);
      starColors[i * 3] = starColor.r;
      starColors[i * 3 + 1] = starColor.g;
      starColors[i * 3 + 2] = starColor.b;
      starPhases[i] = random();
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('aStarSize', new THREE.BufferAttribute(starSizes, 1));
    starGeometry.setAttribute('aStarBrightness', new THREE.BufferAttribute(starBrightness, 1));
    starGeometry.setAttribute('aStarColor', new THREE.BufferAttribute(starColors, 3));
    starGeometry.setAttribute('aStarPhase', new THREE.BufferAttribute(starPhases, 1));
    this.starUniforms = {
      uPixelRatio: { value: Math.min(globalThis.devicePixelRatio || 1, 2) },
      uTime: { value: 0 },
      uOpacity: { value: 0 }
    };
    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });
    this.stars = new THREE.Points(starGeometry, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -960;
    scene.add(this.stars);

    this.cloudGeometry = new THREE.PlaneGeometry(CLOUD_SIZE, CLOUD_SIZE);
    this.cloudLayers = [];
    const layerSettings = [
      { altitude: 1500, tile: 9000, texture: this.cumulusTexture, coverage: 0.5, softness: 0.28, opacity: 0.96, detail: 0.55, lip: 0.34, sunset: 0.1, order: -880 },
      { altitude: 3400, tile: 16000, texture: this.cirrusTexture, coverage: 0.54, softness: 0.3, opacity: 0.66, detail: 0.4, lip: 0.5, sunset: 0.3, order: -890 },
      { altitude: 5400, tile: 26000, texture: this.cirrusTexture, coverage: 0.48, softness: 0.32, opacity: 0.74, detail: 0.3, lip: 0.62, sunset: 0.5, order: -900 }
    ];
    for (const settings of layerSettings) {
      const uniforms = {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uMap: { value: settings.texture },
        uDrift: { value: this.cloudDrift },
        uTile: { value: settings.tile },
        uCoverage: { value: settings.coverage },
        uSoftness: { value: settings.softness },
        uOpacity: { value: settings.opacity },
        uDetail: { value: settings.detail },
        uTint: { value: CLOUD_TINT.day.clone() },
        uSunDirection: { value: this.lightDirection },
        uSunLip: { value: settings.lip },
        uFadeNear: { value: this.cloudFade.near },
        uFadeFar: { value: this.cloudFade.far }
      };
      const mesh = new THREE.Mesh(this.cloudGeometry, new THREE.ShaderMaterial({
        uniforms,
        vertexShader: CLOUD_VERTEX,
        fragmentShader: CLOUD_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = settings.altitude;
      mesh.frustumCulled = false;
      mesh.renderOrder = settings.order;
      scene.add(mesh);
      this.cloudLayers.push({
        mesh,
        uniforms,
        altitude: settings.altitude,
        coverage: settings.coverage,
        softness: settings.softness,
        opacity: settings.opacity,
        sunset: settings.sunset
      });
    }

    const puffCount = 54;
    this.puffUniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uMap: { value: this.puffTexture },
      uTint: { value: CLOUD_TINT.day.clone() },
      uSunDirection: { value: this.lightDirection },
      uSunLip: { value: 0.42 },
      uFadeNear: { value: this.cloudFade.near },
      uFadeFar: { value: this.cloudFade.far },
      uDetail: { value: 0.5 }
    };
    this.puffMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        uniforms: this.puffUniforms,
        vertexShader: PUFF_VERTEX,
        fragmentShader: PUFF_FRAGMENT,
        transparent: true,
        depthWrite: false,
        fog: true
      }),
      puffCount
    );
    const matrix = new THREE.Matrix4();
    const puffPosition = new THREE.Vector3();
    const puffScale = new THREE.Vector3();
    const puffQuaternion = new THREE.Quaternion();
    const puffEuler = new THREE.Euler();
    const puffShade = new THREE.Color();
    for (let i = 0; i < puffCount; i += 1) {
      const cluster = Math.floor(i / 9);
      const clusterAngle = cluster * 2.1 + random() * 0.7;
      const clusterRadius = 2600 + random() * 5200;
      const clusterX = Math.cos(clusterAngle) * clusterRadius;
      const clusterZ = Math.sin(clusterAngle) * clusterRadius - 900;
      const clusterY = 950 + cluster * 130 + random() * 260;
      const spread = 1 - (i % 9) / 12;
      puffPosition.set(
        clusterX + (random() - 0.5) * 1300 * spread,
        clusterY + (random() - 0.35) * 220,
        clusterZ + (random() - 0.5) * 1300 * spread
      );
      const size = 320 + random() * 520;
      puffScale.set(size, size * (0.62 + random() * 0.22), size);
      puffQuaternion.setFromEuler(puffEuler.set(0, random() * Math.PI, 0));
      matrix.compose(puffPosition, puffQuaternion, puffScale);
      this.puffMesh.setMatrixAt(i, matrix);
      puffShade.setScalar(0.72 + random() * 0.42);
      this.puffMesh.setColorAt(i, puffShade);
    }
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
    this.puffMesh.frustumCulled = false;
    this.puffMesh.renderOrder = -870;
    this.puffGroup = new THREE.Group();
    this.puffGroup.add(this.puffMesh);
    scene.add(this.puffGroup);

    this.hemisphere = new THREE.HemisphereLight(0xb9dcff, 0x41552d, 1.1);
    scene.add(this.hemisphere);
    this.ambient = new THREE.AmbientLight(0xdfeaff, 0.06);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff3dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.camera.left = -SHADOW_RADIUS;
    this.sun.shadow.camera.right = SHADOW_RADIUS;
    this.sun.shadow.camera.top = SHADOW_RADIUS;
    this.sun.shadow.camera.bottom = -SHADOW_RADIUS;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = SHADOW_LIGHT_DISTANCE + 780;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.00022;
    this.sun.shadow.normalBias = 0.028;
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    scene.add(this.sun);

    this.lightning = new THREE.PointLight(0xd6e4ff, 0, 7000, 2);
    this.lightning.position.set(0, 2400, 0);
    scene.add(this.lightning);

    const rainCapacity = WEATHER_RAIN_COUNT.storm;
    this.rainData = new Float32Array(rainCapacity * 4);
    const rainPositions = new Float32Array(rainCapacity * 6);
    for (let i = 0; i < rainCapacity; i += 1) {
      this.rainData[i * 4] = (random() - 0.5) * 260;
      this.rainData[i * 4 + 1] = random() * 200 - 40;
      this.rainData[i * 4 + 2] = (random() - 0.5) * 260;
      this.rainData[i * 4 + 3] = 62 + random() * 62;
    }
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    this.rainGeometry.setDrawRange(0, 0);
    this.rainMaterial = new THREE.LineBasicMaterial({
      color: RAIN_DAY_COLOR.clone(),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      fog: false
    });
    this.rain = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = -800;
    scene.add(this.rain);

    const snowCapacity = 1100;
    this.snowData = new Float32Array(snowCapacity * 5);
    const snowPositions = new Float32Array(snowCapacity * 3);
    const snowSizes = new Float32Array(snowCapacity);
    const snowPhases = new Float32Array(snowCapacity);
    for (let i = 0; i < snowCapacity; i += 1) {
      this.snowData[i * 5] = (random() - 0.5) * 240;
      this.snowData[i * 5 + 1] = random() * 200 - 40;
      this.snowData[i * 5 + 2] = (random() - 0.5) * 240;
      this.snowData[i * 5 + 3] = 1.4 + random() * 3.4;
      this.snowData[i * 5 + 4] = random() * Math.PI * 2;
      snowSizes[i] = 0.05 + random() * 0.14;
      snowPhases[i] = random();
    }
    this.snowGeometry = new THREE.BufferGeometry();
    this.snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
    this.snowGeometry.setAttribute('aFlakeSize', new THREE.BufferAttribute(snowSizes, 1));
    this.snowGeometry.setAttribute('aFlakePhase', new THREE.BufferAttribute(snowPhases, 1));
    this.snowGeometry.setDrawRange(0, 0);
    this.snowUniforms = {
      uSizeScale: { value: 720 },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uFlakeColor: { value: new THREE.Color(1.15, 1.18, 1.25) }
    };
    this.snowMaterial = new THREE.ShaderMaterial({
      uniforms: this.snowUniforms,
      vertexShader: SNOW_VERTEX,
      fragmentShader: SNOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false
    });
    this.snow = new THREE.Points(this.snowGeometry, this.snowMaterial);
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.snow.renderOrder = -800;
    scene.add(this.snow);

    this.fog = new THREE.FogExp2(0xc7e5f2, 0.00012);
    scene.fog = this.fog;
  }

  samplePalette(altitudeDeg) {
    let index = 0;
    while (index < SKY_STOPS.length - 2 && altitudeDeg >= SKY_STOPS[index + 1].alt) index += 1;
    const low = SKY_STOPS[index];
    const high = SKY_STOPS[index + 1];
    const t = smoothstep(low.alt, high.alt, altitudeDeg);
    this._zenith.copy(low.zenith).lerp(high.zenith, t);
    this._horizon.copy(low.horizon).lerp(high.horizon, t);
    this._ground.copy(low.ground).lerp(high.ground, t);
    this._scatter.copy(low.scatter).lerp(high.scatter, t);
    this._palette.glow = lerp(low.glow, high.glow, t);
    this._palette.haze = lerp(low.haze, high.haze, t);
    this._palette.gradient = lerp(low.gradient, high.gradient, t);
    this._palette.twilight = lerp(low.twilight, high.twilight, t);
  }

  update(environment = {}, focus, camera, dt = 0, elapsed = 0) {
    const env = environment || {};
    this.phase = phaseFromEnvironment(env);
    this.weather = weatherFromEnvironment(env);
    const step = clamp(Number(dt) || 0, 0, 0.1);
    this.time = Number.isFinite(elapsed) ? elapsed : this.time + step;

    const hours = hourFromEnvironment(env);
    const hourAngle = (hours - 12) * (Math.PI / 12);
    const sunAltitude = Math.asin(clamp(
      Math.sin(LATITUDE) * Math.sin(SUN_DECLINATION) + Math.cos(LATITUDE) * Math.cos(SUN_DECLINATION) * Math.cos(hourAngle),
      -1,
      1
    ));
    const sunAltitudeDeg = sunAltitude * RAD;
    const sunAzimuth = (90 + (hours - 6) * 15) * DEG;
    this.sunDirection.set(
      Math.cos(sunAltitude) * Math.sin(sunAzimuth),
      Math.sin(sunAltitude),
      Math.cos(sunAltitude) * Math.cos(sunAzimuth)
    ).normalize();

    const moonHourAngle = (hours - 1.7) * (Math.PI / 12);
    const moonAltitude = Math.asin(clamp(
      Math.sin(LATITUDE) * Math.sin(MOON_DECLINATION) + Math.cos(LATITUDE) * Math.cos(MOON_DECLINATION) * Math.cos(moonHourAngle),
      -1,
      1
    ));
    const moonAltitudeDeg = moonAltitude * RAD;
    const moonAzimuth = (180 + (hours - 1.7) * 15) * DEG;
    this.moonDirection.set(
      Math.cos(moonAltitude) * Math.sin(moonAzimuth),
      Math.sin(moonAltitude),
      Math.cos(moonAltitude) * Math.cos(moonAzimuth)
    ).normalize();

    const weather = this.weather;
    const overcast = WEATHER_SKY_COVER[weather] ?? 0;
    const lightFactor = WEATHER_LIGHT[weather] ?? 1;
    const ambientFactor = WEATHER_AMBIENT[weather] ?? 1;
    const dayAmount = smoothstep(-4, 12, sunAltitudeDeg);
    const nightAmount = smoothstep(-2, -14, sunAltitudeDeg);
    const duskAmount = clamp(1 - dayAmount - nightAmount, 0, 1);

    const requestedVisibility = Number(env.visibility);
    this.visibility = clamp(
      Number.isFinite(requestedVisibility) && requestedVisibility > 0
        ? requestedVisibility
        : (WEATHER_VISIBILITY[weather] ?? WEATHER_VISIBILITY.clear),
      MIN_VISIBILITY,
      MAX_VISIBILITY
    );
    this.starfield = (WEATHER_STAR[weather] ?? 1) * clamp(this.visibility / 9000, 0.05, 1);

    this.samplePalette(sunAltitudeDeg);
    const palette = this._palette;
    this._overcast.copy(OVERCAST_GRAY.day)
      .lerp(OVERCAST_GRAY.dusk, clamp(duskAmount * 1.6, 0, 1))
      .lerp(OVERCAST_GRAY.night, nightAmount);
    this._zenith.lerp(this._overcast, overcast * 0.82);
    this._horizon.lerp(this._overcast, overcast * 0.6);
    this._ground.lerp(this._overcast, overcast * 0.7);

    this.updateLightning(step);
    const flash = this.flashLevel;

    const uniforms = this.uniforms;
    uniforms.uSunScatter.value = this._scatter;
    uniforms.uGradient.value = lerp(palette.gradient, palette.gradient * 0.72, overcast);
    uniforms.uHaze.value = clamp(lerp(palette.haze, 0.92, overcast) + (1 - clamp(this.visibility / 12000, 0, 1)) * 0.25, 0, 1);
    uniforms.uSunGlow.value = palette.glow * lightFactor;
    uniforms.uSunDisc.value = smoothstep(-2.5, 1.5, sunAltitudeDeg) * (1 - overcast * 0.9);
    uniforms.uTwilight.value = palette.twilight * (1 - overcast * 0.6);
    uniforms.uSunDiscColor.value.copy(sunAltitudeDeg < 4 ? SUN_DISC_LOW : SUN_DISC_HIGH);
    uniforms.uMoonVisibility.value = smoothstep(-2, 4, moonAltitudeDeg) * nightAmount * (1 - overcast * 0.92) * this.starfield;
    uniforms.uFlash.value = flash * 0.85;

    const sunFactor = Math.sqrt(smoothstep(-7, 14, sunAltitudeDeg));
    const moonUp = smoothstep(-2, 8, moonAltitudeDeg);
    const sunPower = 2.6 * sunFactor * lightFactor;
    const moonPower = 0.75 * moonUp * smoothstep(-2, -9, sunAltitudeDeg) * lightFactor;
    const useMoon = moonPower > sunPower;
    this.lightDirection.copy(useMoon ? this.moonDirection : this.sunDirection);
    if (this.lightDirection.y < 0.045) {
      this.lightDirection.y = 0.045;
      this.lightDirection.normalize();
    }
    this.sun.intensity = useMoon ? moonPower + 0.06 * nightAmount * ambientFactor : sunPower;
    if (useMoon) {
      this._lightColor.copy(MOON_LIGHT_COLOR);
    } else {
      this._lightColor.copy(SUN_LOW_COLOR).lerp(SUN_HIGH_COLOR, smoothstep(0, 16, sunAltitudeDeg));
    }
    this.sun.color.copy(this._lightColor);
    this.sun.castShadow = sunAltitudeDeg > -1.5 && sunPower > 0.12;

    this._hemiSky.copy(HEMI_NIGHT_SKY).lerp(HEMI_DAY_SKY, dayAmount);
    this._hemiGround.copy(HEMI_NIGHT_GROUND).lerp(HEMI_DAY_GROUND, dayAmount);
    this.hemisphere.color.copy(this._hemiSky);
    this.hemisphere.groundColor.copy(this._hemiGround);
    this.hemisphere.intensity = lerp(0.44, 1.15, dayAmount) * ambientFactor + flash * 1.5;

    this._ambientColor.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAY, dayAmount);
    this.ambient.color.copy(this._ambientColor);
    this.ambient.intensity = lerp(0.2, 0.05, dayAmount) + flash * 0.45;

    this.lightning.intensity = flash * 9e5;
    this.lightning.position.set(
      (camera ? camera.position.x : this.sunTarget.position.x) + this.flashDirection.x * 720,
      (camera ? camera.position.y : this.sunTarget.position.y) + this.flashDirection.y * 720,
      (camera ? camera.position.z : this.sunTarget.position.z) + this.flashDirection.z * 720
    );

    this._cloudTint.copy(CLOUD_TINT.night)
      .lerp(CLOUD_TINT.dusk, clamp(duskAmount * 1.4, 0, 1))
      .lerp(CLOUD_TINT.day, dayAmount)
      .lerp(CLOUD_STORM_TINT, overcast * 0.55 * (1 - nightAmount))
      .lerp(CLOUD_NIGHT_STORM_TINT, overcast * 0.5 * nightAmount)
      .multiplyScalar((1 + flash * 1.5) * (1 - overcast * 0.12));

    const windDirection = Number(env.windDirection);
    const windSpeed = Number(env.windSpeed);
    const windAngle = (Number.isFinite(windDirection) ? windDirection : 180) * DEG;
    const windMagnitude = Number.isFinite(windSpeed) ? Math.max(0, windSpeed) : 2;
    const windX = -Math.sin(windAngle) * windMagnitude;
    const windZ = -Math.cos(windAngle) * windMagnitude;
    this.drift.x += windX * 0.85 * step;
    this.drift.y += windZ * 0.85 * step;
    this.cloudDrift.set(wrapCentered(this.drift.x, CLOUD_DRIFT_WRAP), wrapCentered(this.drift.y, CLOUD_DRIFT_WRAP));
    this.puffGroup.position.set(wrapCentered(this.drift.x, PUFF_DRIFT_WRAP), 0, wrapCentered(this.drift.y, PUFF_DRIFT_WRAP));

    const fadeFar = clamp(Math.min(this.visibility * 0.85, 16000), 600, 16000);
    const fadeNear = fadeFar * 0.4;
    this.cloudFade.near = fadeNear;
    this.cloudFade.far = fadeFar;
    const coverageShift = WEATHER_CLOUD_SHIFT[weather] ?? 0;
    const opacityScale = WEATHER_CLOUD_OPACITY[weather] ?? 1;
    for (const layer of this.cloudLayers) {
      layer.uniforms.uCoverage.value = clamp(layer.coverage - coverageShift, 0.04, 0.92);
      layer.uniforms.uSoftness.value = clamp(layer.softness + coverageShift * 1.1, 0.08, 0.72);
      layer.uniforms.uOpacity.value = clamp(layer.opacity * opacityScale * (1 - overcast * 0.06), 0, 1);
      layer.uniforms.uFadeNear.value = fadeNear;
      layer.uniforms.uFadeFar.value = fadeFar;
      layer.uniforms.uTint.value.copy(this._cloudTint).lerp(CLOUD_SUNSET, layer.sunset * duskAmount * (1 - overcast * 0.7));
    }
    this.puffUniforms.uTint.value.copy(this._cloudTint).lerp(CLOUD_SUNSET, 0.12 * duskAmount);
    this.puffUniforms.uFadeNear.value = fadeNear;
    this.puffUniforms.uFadeFar.value = fadeFar;
    this.puffMesh.visible = overcast < 0.85;

    const focusX = focus ? Number(focus.x) || 0 : 0;
    const focusY = focus ? Number(focus.y) || 0 : 0;
    const focusZ = focus ? Number(focus.z) || 0 : 0;
    const cameraX = camera ? camera.position.x : focusX;
    const cameraY = camera ? camera.position.y : focusY;
    const cameraZ = camera ? camera.position.z : focusZ;

    for (const layer of this.cloudLayers) {
      layer.mesh.position.set(cameraX, layer.altitude, cameraZ);
    }

    const shadowCenterX = Math.round(focusX / this.shadowTexel) * this.shadowTexel;
    const shadowCenterZ = Math.round(focusZ / this.shadowTexel) * this.shadowTexel;
    this.sunTarget.position.set(shadowCenterX, focusY, shadowCenterZ);
    this.sun.position.copy(this.sunTarget.position).addScaledVector(this.lightDirection, SHADOW_LIGHT_DISTANCE);
    this.sunTarget.updateMatrixWorld();

    if (camera) {
      this.dome.position.copy(camera.position);
      this.galaxy.position.copy(camera.position);
      this.stars.position.copy(camera.position);
    }

    const starVisibility = clamp(nightAmount * this.starfield, 0, 1);
    this.starUniforms.uOpacity.value = starVisibility;
    this.starUniforms.uTime.value = this.time;
    this.stars.visible = starVisibility > 0.01;
    this.galaxy.material.opacity = clamp(Math.pow(starVisibility, 1.2) * 0.6, 0, 1);
    this.galaxy.visible = this.galaxy.material.opacity > 0.01;

    this.fog.density = clamp(2.4 / this.visibility, 0.00006, 0.02);
    this._fogColor.copy(this._horizon).lerp(this._overcast, overcast * 0.55);
    if (nightAmount > 0.05) ensureLuminance(this._fogColor, NIGHT_FOG_LUMINANCE);
    this.fog.color.copy(this._fogColor);
    this._ground.copy(this._fogColor);

    this.updateRain(step, cameraX, cameraY, cameraZ, windX, windZ, nightAmount);
    this.updateSnow(step, cameraX, cameraY, cameraZ, windX, windZ, nightAmount, camera);

    this.dome.material.uniformsNeedUpdate = true;
    this.starMaterial.uniformsNeedUpdate = true;
    this.snowMaterial.uniformsNeedUpdate = true;
    this.puffMesh.material.uniformsNeedUpdate = true;
    for (const layer of this.cloudLayers) layer.mesh.material.uniformsNeedUpdate = true;
  }

  updateLightning(step) {
    if (this.weather !== 'storm') {
      this.flashLevel = Math.max(0, this.flashLevel - step * 4);
      this.flashActive = false;
      this.flashTimer = 3 + Math.random() * 6;
      return;
    }
    if (this.flashActive) {
      this.flashAge += step;
      const age = this.flashAge;
      const pulse = Math.exp(-age * 22)
        + Math.exp(-Math.max(0, age - 0.17) * 26) * 0.7
        + Math.exp(-Math.max(0, age - 0.45) * 34) * 0.35;
      this.flashLevel = clamp(pulse * this.flashPeak, 0, 1.6);
      if (age > 0.95) {
        this.flashActive = false;
        this.flashTimer = 3.5 + Math.random() * 9;
      }
      return;
    }
    this.flashLevel = Math.max(0, this.flashLevel - step * 4);
    this.flashTimer -= step;
    if (this.flashTimer > 0) return;
    this.flashActive = true;
    this.flashAge = 0;
    this.flashPeak = 0.55 + Math.random() * 0.9;
    const azimuth = Math.random() * Math.PI * 2;
    this.flashDirection.set(
      Math.cos(azimuth) * 0.85,
      0.28 + Math.random() * 0.5,
      Math.sin(azimuth) * 0.85
    ).normalize();
  }

  updateRain(step, cameraX, cameraY, cameraZ, windX, windZ, nightAmount) {
    const count = WEATHER_RAIN_COUNT[this.weather] ?? 0;
    this.rain.visible = count > 0;
    if (count <= 0) {
      this.rainGeometry.setDrawRange(0, 0);
      return;
    }
    const tiltX = clamp(windX, -55, 55);
    const tiltZ = clamp(windZ, -55, 55);
    const positions = this.rainGeometry.attributes.position.array;
    const data = this.rainData;
    for (let i = 0; i < count; i += 1) {
      const offset = i * 4;
      const fallSpeed = data[offset + 3];
      let x = data[offset] + tiltX * step;
      let y = data[offset + 1] - fallSpeed * step;
      let z = data[offset + 2] + tiltZ * step;
      if (y < -70) {
        y += 210;
        x = (Math.random() - 0.5) * 260;
        z = (Math.random() - 0.5) * 260;
      }
      x = wrapCentered(x, 260);
      z = wrapCentered(z, 260);
      const radius = Math.sqrt(x * x + y * y + z * z);
      if (radius < MIN_PRECIPITATION_RADIUS) {
        const scale = MIN_PRECIPITATION_RADIUS / (radius || 0.001);
        x *= scale;
        y *= scale;
        z *= scale;
      }
      data[offset] = x;
      data[offset + 1] = y;
      data[offset + 2] = z;

      const velocityX = tiltX;
      const velocityY = -fallSpeed;
      const speed = Math.hypot(velocityX, velocityY, tiltZ) || 1;
      const length = 1.1 + fallSpeed * 0.026;
      const vertex = i * 6;
      const pointX = cameraX + x;
      const pointY = cameraY + y;
      const pointZ = cameraZ + z;
      positions[vertex] = pointX;
      positions[vertex + 1] = pointY;
      positions[vertex + 2] = pointZ;
      positions[vertex + 3] = pointX - (velocityX / speed) * length;
      positions[vertex + 4] = pointY - (velocityY / speed) * length;
      positions[vertex + 5] = pointZ - (tiltZ / speed) * length;
    }
    this.rainGeometry.setDrawRange(0, count * 2);
    this.rainGeometry.attributes.position.needsUpdate = true;
    this.rainMaterial.color.copy(nightAmount > 0.5 ? RAIN_NIGHT_COLOR : RAIN_DAY_COLOR);
    this.rainMaterial.opacity = this.weather === 'storm' ? 0.5 : 0.4;
  }

  updateSnow(step, cameraX, cameraY, cameraZ, windX, windZ, nightAmount, camera) {
    const active = this.weather === 'snow';
    this.snow.visible = active;
    if (!active) {
      this.snowGeometry.setDrawRange(0, 0);
      return;
    }
    const data = this.snowData;
    const positions = this.snowGeometry.attributes.position.array;
    const count = this.snowGeometry.attributes.aFlakeSize.count;
    const driftX = windX * 0.55;
    const driftZ = windZ * 0.55;
    for (let i = 0; i < count; i += 1) {
      const offset = i * 5;
      const phase = data[offset + 4];
      const flutterX = Math.sin(this.time * 1.1 + phase) * 1.4;
      const flutterZ = Math.cos(this.time * 0.9 + phase * 1.6) * 1.4;
      let x = data[offset] + (driftX + flutterX) * step;
      let y = data[offset + 1] - data[offset + 3] * step;
      let z = data[offset + 2] + (driftZ + flutterZ) * step;
      if (y < -50) {
        y += 200;
        x = (Math.random() - 0.5) * 240;
        z = (Math.random() - 0.5) * 240;
      }
      x = wrapCentered(x, 240);
      z = wrapCentered(z, 240);
      const radius = Math.sqrt(x * x + y * y + z * z);
      if (radius < MIN_PRECIPITATION_RADIUS) {
        const scale = MIN_PRECIPITATION_RADIUS / (radius || 0.001);
        x *= scale;
        y *= scale;
        z *= scale;
      }
      data[offset] = x;
      data[offset + 1] = y;
      data[offset + 2] = z;
      const vertex = i * 3;
      positions[vertex] = cameraX + x;
      positions[vertex + 1] = cameraY + y;
      positions[vertex + 2] = cameraZ + z;
    }
    this.snowGeometry.setDrawRange(0, count);
    this.snowGeometry.attributes.position.needsUpdate = true;
    this.snowUniforms.uTime.value = this.time;
    this.snowUniforms.uOpacity.value = lerp(0.88, 0.72, nightAmount);
    this.snowUniforms.uFlakeColor.value.setRGB(
      lerp(1.18, 0.6, nightAmount),
      lerp(1.2, 0.68, nightAmount),
      lerp(1.26, 0.95, nightAmount)
    );
    if (camera) {
      const projection = Math.abs(camera.projectionMatrix.elements[5]);
      const drawingHeight = clamp((globalThis.innerHeight || 900) * Math.min(globalThis.devicePixelRatio || 1, 2), 320, 3000);
      this.snowUniforms.uSizeScale.value = projection * drawingHeight * 0.5;
    }
  }

  dispose() {
    const objects = [
      this.dome,
      this.galaxy,
      this.stars,
      this.rain,
      this.snow,
      this.puffGroup,
      this.puffMesh,
      this.sun,
      this.lightning,
      this.sunTarget,
      this.hemisphere,
      this.ambient
    ];
    for (const layer of this.cloudLayers) objects.push(layer.mesh);
    for (const object of objects) {
      if (object) this.scene.remove(object);
    }
    const geometries = new Set([this.cloudGeometry]);
    const materials = new Set();
    const textures = new Set([this.cumulusTexture, this.cirrusTexture, this.puffTexture, this.galaxyTexture]);
    for (const object of objects) {
      if (!object) continue;
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of objectMaterials) {
        materials.add(material);
        for (const uniform of Object.values(material.uniforms || {})) {
          if (uniform?.value?.isTexture) textures.add(uniform.value);
        }
      }
    }
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    this.sun.dispose();
    this.lightning.dispose();
    this.sun.shadow?.map?.dispose();
    if (this.scene.fog === this.fog) this.scene.fog = null;
  }
}

export { phaseFromEnvironment, weatherFromEnvironment, hourFromEnvironment };
