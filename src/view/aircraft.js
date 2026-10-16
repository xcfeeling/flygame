import * as THREE from 'three';
import { getAircraftType } from '../sim/aircraftTypes.js';

const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 0, 1);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ENGINE_REFERENCE_Y = 3.65;
const FIN_ROOT_Y = 7.0;
const WINGLET_CANT = 0.18;
const WING_CUT = 0.77;
const FLAP_HINGE = 0.74;
const FLAP_CHORD = 0.26;
const AILERON_HINGE = 0.73;
const AILERON_CHORD = 0.27;
const TAIL_CUT = 0.66;
const ELEVATOR_HINGE = 0.64;
const ELEVATOR_CHORD = 0.36;
const FIN_CUT = 0.70;
const RUDDER_HINGE = 0.68;
const RUDDER_CHORD = 0.32;

function clampNumber(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value) {
  return clampNumber(value, 0, 1);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function smoothstep(min, max, value) {
  const t = clamp01((value - min) / (max - min));
  return t * t * (3 - 2 * t);
}

function damp(current, target, rate, dt) {
  if (dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function cosBlend(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * 2 * t);
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext('2d') };
}

function makeTexture(canvas, options = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = options.anisotropy ?? 4;
  const repeatX = options.repeatX ?? 1;
  const repeatY = options.repeatY ?? 1;
  if (repeatX !== 1 || repeatY !== 1) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
  }
  return texture;
}

function sectionAtZ(sections, z) {
  const first = sections[0];
  const last = sections[sections.length - 1];
  if (z <= first.z) return first;
  if (z >= last.z) return last;
  for (let i = 0; i < sections.length - 1; i += 1) {
    const a = sections[i];
    const b = sections[i + 1];
    if (z >= a.z && z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      return {
        z,
        rx: a.rx + (b.rx - a.rx) * t,
        ry: a.ry + (b.ry - a.ry) * t,
        cy: a.cy + (b.cy - a.cy) * t
      };
    }
  }
  return last;
}

function hullPointAt(sections, z, angle) {
  const section = sectionAtZ(sections, z);
  const nx = Math.cos(angle) / Math.max(section.rx, 1e-4);
  const ny = Math.sin(angle) / Math.max(section.ry, 1e-4);
  const length = Math.hypot(nx, ny) || 1;
  return {
    x: Math.cos(angle) * section.rx,
    y: section.cy + Math.sin(angle) * section.ry,
    nx: nx / length,
    ny: ny / length
  };
}

function createLoft(sections, options = {}) {
  const radial = options.radial ?? 40;
  const perRing = radial + 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  const repeatU = options.repeatU ?? 1;
  const repeatV = options.repeatV ?? 1;
  const zStart = sections[0].z;
  const zSpan = sections[sections.length - 1].z - zStart || 1;
  for (let s = 0; s < sections.length; s += 1) {
    const section = sections[s];
    const rx = section.rx ?? section.r ?? 1;
    const ry = section.ry ?? section.r ?? rx;
    const cy = section.cy ?? section.y ?? 0;
    for (let i = 0; i <= radial; i += 1) {
      const angle = i / radial * Math.PI * 2;
      positions.push(Math.cos(angle) * rx, cy + Math.sin(angle) * ry, section.z);
      uvs.push(i / radial * repeatU, (section.z - zStart) / zSpan * repeatV);
    }
  }
  for (let s = 0; s < sections.length - 1; s += 1) {
    for (let i = 0; i < radial; i += 1) {
      const a = s * perRing + i;
      const b = a + 1;
      const c = a + perRing;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const addCap = (sectionIndex, flip) => {
    const section = sections[sectionIndex];
    const rx = section.rx ?? section.r ?? 1;
    const ry = section.ry ?? section.r ?? rx;
    const cy = section.cy ?? section.y ?? 0;
    const center = positions.length / 3;
    positions.push(0, cy, section.z);
    uvs.push(0.5, 0.5);
    const offset = sectionIndex * perRing;
    for (let i = 0; i < radial; i += 1) {
      if (flip) indices.push(center, offset + i + 1, offset + i);
      else indices.push(center, offset + i, offset + i + 1);
    }
  };
  if (options.capStart) addCap(0, true);
  if (options.capEnd) addCap(sections.length - 1, false);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createHullPatch(sections, options) {
  const nz = options.nz ?? 12;
  const na = options.na ?? 10;
  const bulge = options.bulge ?? 0.02;
  const blendAngles = options.blendAngles !== false;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= nz; i += 1) {
    const tz = i / nz;
    const z = options.z0 + (options.z1 - options.z0) * tz;
    const fz = options.blendLength === false ? 1 : cosBlend(tz);
    for (let j = 0; j <= na; j += 1) {
      const ta = j / na;
      const angle = options.a0 + (options.a1 - options.a0) * ta;
      const point = hullPointAt(sections, z, angle);
      const offset = options.offset
        ? options.offset(tz, ta, z, angle)
        : bulge * fz * (blendAngles ? cosBlend(ta) : 1);
      positions.push(point.x + point.nx * offset, point.y + point.ny * offset, z);
      uvs.push(options.flipU ? 1 - tz : tz, ta);
    }
  }
  const perRing = na + 1;
  for (let i = 0; i < nz; i += 1) {
    for (let j = 0; j < na; j += 1) {
      const a = i * perRing + j;
      const b = a + 1;
      const c = a + perRing;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function thicknessDistribution(xc) {
  const x = clamp01(xc);
  const base = 5 * (
    0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x
  );
  return base * (1 - 0.3 * smoothstep(0.45, 1, x));
}

function camberDistribution(xc, position) {
  const x = clamp01(xc);
  const p = clampNumber(position, 0.05, 0.95);
  if (x < p) return (2 * p * x - x * x) / (p * p);
  return (1 - 2 * p + 2 * p * x - x * x) / ((1 - p) * (1 - p));
}

function profileRing(xcEnd, samples) {
  const ring = [];
  const n = Math.max(4, samples);
  const at = (i) => xcEnd * (0.5 - 0.5 * Math.cos(Math.PI * i / n));
  for (let i = 0; i <= n; i += 1) ring.push({ xc: at(i), side: 1 });
  for (let i = n; i >= 1; i -= 1) ring.push({ xc: at(i), side: -1 });
  return ring;
}

function createAirfoilGeometry(sections, options = {}) {
  const xcEnd = options.xcEnd ?? 1;
  const camber = options.camber ?? 0.012;
  const camberPosition = options.camberPosition ?? 0.4;
  const ring = profileRing(xcEnd, options.samples ?? 12);
  const perRing = ring.length;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let s = 0; s < sections.length; s += 1) {
    const section = sections[s];
    const thickness = section.thickness ?? 0.12;
    const twist = section.twist ?? 0;
    const sectionCamber = section.camber ?? camber;
    const cos = Math.cos(twist);
    const sin = Math.sin(twist);
    for (let i = 0; i < perRing; i += 1) {
      const point = ring[i];
      const half = thickness * section.chord * thicknessDistribution(point.xc);
      const mean = sectionCamber * section.chord * camberDistribution(point.xc, camberPosition);
      const dy = point.side * half + mean;
      const dz = -point.xc * section.chord;
      positions.push(section.x, section.y + dy * cos - dz * sin, section.z + dy * sin + dz * cos);
      uvs.push(point.xc, s / (sections.length - 1));
    }
  }
  for (let s = 0; s < sections.length - 1; s += 1) {
    for (let i = 0; i < perRing; i += 1) {
      const next = (i + 1) % perRing;
      const a = s * perRing + i;
      const b = s * perRing + next;
      const c = (s + 1) * perRing + i;
      const d = (s + 1) * perRing + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function sampleAirfoilSections(sections, x) {
  const first = sections[0];
  const last = sections[sections.length - 1];
  if (x <= first.x) return { ...first };
  if (x >= last.x) return { ...last };
  for (let i = 0; i < sections.length - 1; i += 1) {
    const a = sections[i];
    const b = sections[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return {
        x,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        chord: a.chord + (b.chord - a.chord) * t,
        thickness: (a.thickness ?? 0.12) + ((b.thickness ?? 0.12) - (a.thickness ?? 0.12)) * t,
        twist: (a.twist ?? 0) + ((b.twist ?? 0) - (a.twist ?? 0)) * t,
        camber: (a.camber ?? 0.012) + ((b.camber ?? 0.012) - (a.camber ?? 0.012)) * t
      };
    }
  }
  return { ...last };
}

function airfoilSurfacePoint(section, xc, side) {
  const camber = section.camber ?? 0.012;
  const half = side === 0 ? 0 : (section.thickness ?? 0.12) * section.chord * thicknessDistribution(xc);
  const mean = camber * section.chord * camberDistribution(xc, 0.4);
  const dy = side * half + mean;
  const dz = -xc * section.chord;
  const twist = section.twist ?? 0;
  const cos = Math.cos(twist);
  const sin = Math.sin(twist);
  return {
    x: section.x,
    y: section.y + dy * cos - dz * sin,
    z: section.z + dy * sin + dz * cos
  };
}

function createHullData(length) {
  const tail = -length / 2;
  const nose = length / 2;
  const hull = [
    { z: tail, rx: 0.14, ry: 0.20, cy: 7.05 },
    { z: tail + 0.8, rx: 0.56, ry: 0.70, cy: 6.95 },
    { z: tail + 3.0, rx: 1.35, ry: 1.48, cy: 6.65 },
    { z: tail + 7.0, rx: 2.25, ry: 2.40, cy: 6.15 },
    { z: tail + 13.0, rx: 2.95, ry: 3.02, cy: 5.70 },
    { z: -16.0, rx: 3.18, ry: 3.16, cy: 5.42 },
    { z: -10.0, rx: 3.24, ry: 3.20, cy: 5.30 },
    { z: 10.0, rx: 3.24, ry: 3.20, cy: 5.30 },
    { z: nose - 12.0, rx: 3.16, ry: 3.14, cy: 5.34 },
    { z: nose - 9.0, rx: 3.02, ry: 3.02, cy: 5.34 },
    { z: nose - 6.0, rx: 2.52, ry: 2.55, cy: 5.25 },
    { z: nose - 3.5, rx: 1.72, ry: 1.78, cy: 5.10 },
    { z: nose - 2.0, rx: 1.15, ry: 1.20, cy: 5.00 }
  ];
  const radome = [
    { z: nose - 2.0, rx: 1.15, ry: 1.20, cy: 5.00 },
    { z: nose - 1.25, rx: 0.83, ry: 0.88, cy: 4.98 },
    { z: nose - 0.55, rx: 0.43, ry: 0.48, cy: 4.95 },
    { z: nose, rx: 0.08, ry: 0.10, cy: 4.92 }
  ];
  return { hull, radome, tail, nose };
}

function createUpperDeckSections(nose, cockpitZ, cargo) {
  const rear = cargo ? -1.2 : 4.4;
  return [
    { z: rear, rx: 0.20, ry: 0.16, cy: 8.30 },
    { z: rear + 2.8, rx: 1.25, ry: 0.58, cy: 8.20 },
    { z: cockpitZ - 13.0, rx: 2.62, ry: 1.24, cy: 8.05 },
    { z: cockpitZ - 6.0, rx: 2.55, ry: 1.45, cy: 8.00 },
    { z: cockpitZ + 1.0, rx: 2.18, ry: 1.35, cy: 7.80 },
    { z: cockpitZ + 5.0, rx: 1.42, ry: 1.02, cy: 7.35 },
    { z: nose - 2.45, rx: 0.28, ry: 0.30, cy: 5.95 }
  ];
}

function createWingSections(wingspan, cargo) {
  const half = wingspan / 2 - (cargo ? 0 : 0.35);
  const tipLead = cargo ? -12.8 : -11.2;
  return [
    { x: 1.25, y: 3.62, z: 9.0, chord: 18.0, thickness: 0.155, twist: 0.025 },
    { x: 3.8, y: 3.76, z: 8.1, chord: 16.2, thickness: 0.150, twist: 0.020 },
    { x: 9.5, y: 4.05, z: 4.8, chord: 12.8, thickness: 0.140, twist: 0.010 },
    { x: 16.5, y: 4.48, z: 0.5, chord: 9.1, thickness: 0.128, twist: 0.000 },
    { x: 23.0, y: 4.95, z: -4.6, chord: 6.2, thickness: 0.116, twist: -0.012 },
    { x: half - 3.0, y: 5.35, z: tipLead + 2.5, chord: 3.9, thickness: 0.106, twist: -0.024 },
    { x: half - 0.35, y: 5.55, z: tipLead, chord: cargo ? 1.85 : 2.15, thickness: 0.100, twist: -0.030 },
    { x: half, y: 5.58, z: tipLead - (cargo ? 1.7 : 1.9), chord: 0.025, thickness: 0.095, twist: -0.030 }
  ];
}

function createTailSections(tail) {
  return [
    { x: 0.85, y: 6.10, z: tail + 12.0, chord: 9.2, thickness: 0.115, camber: 0 },
    { x: 3.8, y: 6.25, z: tail + 10.2, chord: 7.1, thickness: 0.105, camber: 0 },
    { x: 7.2, y: 6.50, z: tail + 7.8, chord: 4.9, thickness: 0.096, camber: 0 },
    { x: 10.8, y: 6.78, z: tail + 5.7, chord: 2.8, thickness: 0.090, camber: 0 },
    { x: 11.0, y: 6.80, z: tail + 3.0, chord: 0.025, thickness: 0.085, camber: 0 }
  ];
}

function createFinSections(tail) {
  return [
    { x: 0.0, y: 0, z: tail + 12.6, chord: 12.2, thickness: 0.120, camber: 0 },
    { x: 2.8, y: 0, z: tail + 11.2, chord: 10.0, thickness: 0.112, camber: 0 },
    { x: 6.0, y: 0, z: tail + 9.0, chord: 7.5, thickness: 0.104, camber: 0 },
    { x: 9.0, y: 0, z: tail + 6.9, chord: 5.4, thickness: 0.098, camber: 0 },
    { x: 11.6, y: 0, z: tail + 5.2, chord: 3.8, thickness: 0.092, camber: 0 },
    { x: 11.8, y: 0, z: tail + 1.5, chord: 0.025, thickness: 0.090, camber: 0 }
  ];
}

function createWingletSections(chord) {
  return [
    { x: 0.0, y: 0, z: 0.15, chord: Math.max(1.6, chord), thickness: 0.10 },
    { x: 0.9, y: 0, z: -0.20, chord: 1.45, thickness: 0.10 },
    { x: 1.75, y: 0, z: -0.85, chord: 0.95, thickness: 0.095 },
    { x: 2.15, y: 0, z: -1.45, chord: 0.025, thickness: 0.09 }
  ];
}

function createSkinTexture(base, lineColor, repeatX, repeatY) {
  const { canvas, context } = makeCanvas(256, 256);
  context.fillStyle = base;
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = lineColor;
  context.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const x = Math.round((i + 0.5) * 51) + 0.5;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 256);
    context.stroke();
  }
  for (let i = 0; i < 4; i += 1) {
    const y = Math.round((i + 0.75) * 62) + 0.5;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(256, y);
    context.stroke();
  }
  context.globalAlpha = 0.05;
  for (let i = 0; i < 420; i += 1) {
    context.fillStyle = i % 2 ? '#8d979c' : '#ffffff';
    const size = 1 + i % 3;
    context.fillRect((i * 61) % 256, (i * 97) % 256, size, size);
  }
  context.globalAlpha = 1;
  return makeTexture(canvas, { repeatX, repeatY });
}

function createTitleTexture(cargo) {
  const { canvas, context } = makeCanvas(1792, 128);
  context.clearRect(0, 0, 1792, 128);
  context.fillStyle = '#123a63';
  context.font = '700 58px Arial, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(cargo ? 'YUNLING CARGO' : 'YUNLING AIR', 55, 61);
  context.fillStyle = '#2f6fa8';
  context.font = '600 32px Arial, sans-serif';
  context.fillText(cargo ? '云岭货运  ·  BOEING 747-8F' : '云岭航空  ·  BOEING 747-400', 850, 65);
  return makeTexture(canvas);
}

function createRegistrationTexture(cargo) {
  const { canvas, context } = makeCanvas(512, 96);
  context.clearRect(0, 0, 512, 96);
  context.fillStyle = '#123a63';
  context.font = '700 58px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(cargo ? 'B-2478' : 'B-2447', 256, 50);
  return makeTexture(canvas);
}

function createFinLiveryTexture(cargo) {
  const { canvas, context } = makeCanvas(512, 512);
  context.fillStyle = cargo ? '#173f35' : '#123a63';
  context.fillRect(0, 0, 512, 512);
  context.strokeStyle = '#d8b25f';
  context.lineWidth = 42;
  context.beginPath();
  context.moveTo(-40, 470);
  context.bezierCurveTo(150, 430, 250, 220, 420, 120);
  context.stroke();
  context.strokeStyle = '#f3f6f7';
  context.lineWidth = 12;
  context.beginPath();
  context.moveTo(-40, 420);
  context.bezierCurveTo(150, 380, 250, 175, 420, 78);
  context.stroke();
  context.fillStyle = '#ffffff';
  context.font = '700 44px Arial, sans-serif';
  context.textAlign = 'center';
  context.fillText('747', 310, 300);
  return makeTexture(canvas);
}

function createFanBlurTexture() {
  const { canvas, context } = makeCanvas(128, 128);
  context.clearRect(0, 0, 128, 128);
  context.translate(64, 64);
  for (let i = 0; i < 72; i += 1) {
    const angle = i / 72 * Math.PI * 2;
    context.strokeStyle = i % 2 ? 'rgba(196,206,212,0.5)' : 'rgba(22,28,32,0.45)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(Math.cos(angle) * 10, Math.sin(angle) * 10);
    context.lineTo(Math.cos(angle) * 60, Math.sin(angle) * 60);
    context.stroke();
  }
  return makeTexture(canvas);
}

function createEngineMarkTexture(cargo, index) {
  const { canvas, context } = makeCanvas(512, 128);
  context.clearRect(0, 0, 512, 128);
  context.fillStyle = cargo ? '#173f35' : '#123a63';
  context.font = '700 48px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`${cargo ? 'GEnx-2B' : 'CF6-80C2'}  ·  ${index + 1}`, 256, 64);
  return makeTexture(canvas);
}

function createMaterials(typeSpec) {
  const cargo = typeSpec.id === 'b747-8f';
  const textures = {
    skin: createSkinTexture('#eef1f3', 'rgba(120,132,140,0.30)', 6, 20),
    wing: createSkinTexture('#dfe4e6', 'rgba(120,132,140,0.20)', 4, 3),
    title: createTitleTexture(cargo),
    registration: createRegistrationTexture(cargo),
    fin: createFinLiveryTexture(cargo),
    fanBlur: createFanBlurTexture(),
    engineMarks: typeSpec.enginePositions.map((_, index) => createEngineMarkTexture(cargo, index))
  };
  const fanBlur = typeSpec.enginePositions.map(() => new THREE.MeshBasicMaterial({
    map: textures.fanBlur,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide
  }));
  const materials = {
    hull: new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.skin, roughness: 0.34, metalness: 0.26 }),
    radome: new THREE.MeshStandardMaterial({ color: 0x343a3e, roughness: 0.58, metalness: 0.12 }),
    paint: new THREE.MeshStandardMaterial({ color: cargo ? 0x173f35 : 0x123a63, roughness: 0.34, metalness: 0.32, side: THREE.DoubleSide }),
    accent: new THREE.MeshStandardMaterial({ color: 0xd8b25f, roughness: 0.32, metalness: 0.5, side: THREE.DoubleSide }),
    wing: new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.wing, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide }),
    panel: new THREE.MeshStandardMaterial({ color: 0xc9d0d3, roughness: 0.42, metalness: 0.56, side: THREE.DoubleSide }),
    cargoDoor: new THREE.MeshStandardMaterial({ color: 0xdde3e5, roughness: 0.38, metalness: 0.48, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0xa9b2b6, roughness: 0.3, metalness: 0.82 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcbd3d6, roughness: 0.15, metalness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d2225, roughness: 0.62, metalness: 0.3, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0d1c26, roughness: 0.08, metalness: 0.9, emissive: 0x0b1f2b, emissiveIntensity: 0.3, side: THREE.DoubleSide }),
    window: new THREE.MeshStandardMaterial({ color: 0x14262f, roughness: 0.14, metalness: 0.7, emissive: 0xffca7a, emissiveIntensity: 0 }),
    engine: new THREE.MeshStandardMaterial({ color: 0xe7eaeb, roughness: 0.28, metalness: 0.58, side: THREE.DoubleSide }),
    engineDark: new THREE.MeshStandardMaterial({ color: 0x707a80, roughness: 0.38, metalness: 0.72, side: THREE.DoubleSide }),
    inlet: new THREE.MeshStandardMaterial({ color: 0x2c3338, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
    fanFace: new THREE.MeshBasicMaterial({ color: 0x0d1215, side: THREE.DoubleSide, toneMapped: false }),
    fanBlade: new THREE.MeshStandardMaterial({ color: 0x9aa4a9, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }),
    fanBlur,
    exhaust: new THREE.MeshStandardMaterial({ color: 0x4b423d, roughness: 0.55, metalness: 0.85 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x555d62, roughness: 0.42, metalness: 0.8, side: THREE.DoubleSide }),
    tire: new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.95, metalness: 0.02 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x99a2a6, roughness: 0.3, metalness: 0.85 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x50443c, roughness: 0.72, metalness: 0.5, emissive: 0x2b0800, emissiveIntensity: 0 }),
    navRed: new THREE.MeshBasicMaterial({ color: 0xff2f28, toneMapped: false }),
    navGreen: new THREE.MeshBasicMaterial({ color: 0x3bff8c, toneMapped: false }),
    navWhite: new THREE.MeshBasicMaterial({ color: 0xfff6e2, toneMapped: false }),
    lens: new THREE.MeshBasicMaterial({ color: 0xfff2cf, toneMapped: false, side: THREE.DoubleSide }),
    title: new THREE.MeshStandardMaterial({ map: textures.title, transparent: true, roughness: 0.36, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    registration: new THREE.MeshStandardMaterial({ map: textures.registration, transparent: true, roughness: 0.36, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide }),
    fin: new THREE.MeshStandardMaterial({ color: 0xffffff, map: textures.fin, roughness: 0.34, metalness: 0.3, side: THREE.DoubleSide }),
    engineMarks: textures.engineMarks.map((map) => new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.36, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide }))
  };
  return { materials, textures };
}

function prepareMesh(mesh, options = {}) {
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  return mesh;
}

function boxMesh(material, width, height, depth, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  return prepareMesh(mesh);
}

function collectResources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      if (material.uniforms) {
        for (const uniform of Object.values(material.uniforms)) if (uniform?.value?.isTexture) textures.add(uniform.value);
      }
    }
  });
  return { geometries, materials, textures };
}

export class Aircraft {
  constructor(scene, typeId = 'b747-400') {
    this.scene = scene ?? null;
    const normalizedTypeId = String(typeId ?? 'b747-400').toLowerCase();
    this.typeSpec = getAircraftType(normalizedTypeId);
    this.typeId = this.typeSpec.id;
    this.cargo = this.typeId === 'b747-8f';
    this.visualScale = finite(this.typeSpec.visualScale, 1) || 1;
    this.cockpitEye = new THREE.Vector3(
      finite(this.typeSpec.cockpitEye?.x, -0.82),
      finite(this.typeSpec.cockpitEye?.y, 7.1),
      finite(this.typeSpec.cockpitEye?.z, 25.2)
    );
    this.cockpitTarget = new THREE.Vector3(
      finite(this.typeSpec.cockpitTarget?.x, -0.82),
      finite(this.typeSpec.cockpitTarget?.y, 7.35),
      finite(this.typeSpec.cockpitTarget?.z, 36)
    );
    this.recommendedChaseOffset = new THREE.Vector3(0, 18, -92);
    this.recommendedChaseTarget = new THREE.Vector3(0, 6, 4);

    this.root = new THREE.Group();
    this.root.name = `player-aircraft-${this.typeId}`;
    this.exterior = new THREE.Group();
    this.exterior.name = 'aircraft-exterior';
    this.airframe = new THREE.Group();
    this.airframe.name = `${this.typeId}-airframe`;
    // The inverse inner scale preserves the spec's real length/wingspan while honoring visualScale once.
    this.exterior.scale.setScalar(this.visualScale);
    this.airframe.scale.setScalar(1 / this.visualScale);
    this.exterior.add(this.airframe);
    this.root.add(this.exterior);
    if (this.scene?.add) this.scene.add(this.root);

    const hullData = createHullData(this.typeSpec.length);
    this.hullSections = hullData.hull;
    this.radomeSections = hullData.radome;
    this.tailZ = hullData.tail;
    this.noseZ = hullData.nose;
    this.upperDeckSections = createUpperDeckSections(this.noseZ, this.cockpitEye.z, this.cargo);
    this.wingSections = createWingSections(this.typeSpec.wingspan, this.cargo);
    this.tailSections = createTailSections(this.tailZ);
    this.finSections = createFinSections(this.tailZ);
    this.wingTip = this.wingSections[this.wingSections.length - 2];
    this.finTipHeight = this.finSections[this.finSections.length - 2].x;
    this.noseGearZ = this.cockpitEye.z - 2.5;

    this.elapsed = 0;
    this.wheelAngle = 0;
    this.wheelSpeed = 0;
    this.exteriorVisible = true;
    this.disposed = false;
    const engineCount = this.typeSpec.enginePositions.length;
    this.anim = {
      flap: { left: 0, right: 0 },
      slat: { left: 0, right: 0 },
      aileron: 0,
      elevator: 0,
      rudder: 0,
      spoiler: 0,
      gear: 1,
      doors: 0,
      compression: [],
      n1: Array(engineCount).fill(0),
      reverse: Array(engineCount).fill(0),
      blur: Array(engineCount).fill(0),
      steer: 0,
      flex: 0
    };

    this.yawQuaternion = new THREE.Quaternion();
    this.pitchQuaternion = new THREE.Quaternion();
    this.rollQuaternion = new THREE.Quaternion();
    this.xAxis = X_AXIS;
    this.yAxis = new THREE.Vector3(0, 1, 0);
    this.zAxis = Z_AXIS;
    this.scratchPosition = new THREE.Vector3();
    this.scratchQuaternion = new THREE.Quaternion();

    const { materials, textures } = createMaterials(this.typeSpec);
    this.materials = materials;
    this.textures = textures;
    this.flaps = { left: [], right: [] };
    this.ailerons = { left: [], right: [] };
    this.slats = { left: [], right: [] };
    this.spoilers = { left: [], right: [] };
    this.elevators = { left: null, right: null };
    this.wingGroups = { left: null, right: null };
    this.engines = [];
    this.gears = [];
    this.gearDoors = [];
    this.navLights = [];
    this.strobeLights = [];
    this.beacons = [];
    this.landingLights = [];
    this.logoLights = [];

    this.buildFuselage();
    this.buildWings();
    this.buildTail();
    this.buildEngines();
    this.buildLandingGear();
    this.buildLights();
    this.anim.compression = this.gears.map((gear) => gear.restCompression);
    this.resources = collectResources(this.root);
  }

  buildFuselage() {
    const materials = this.materials;
    const group = new THREE.Group();
    group.name = 'b747-widebody-hull';
    this.airframe.add(group);
    this.hullGroup = group;

    const hull = new THREE.Mesh(createLoft(this.hullSections, { radial: 48, capStart: true, repeatV: 2 }), materials.hull);
    prepareMesh(hull);
    group.add(hull);
    const radome = new THREE.Mesh(createLoft(this.radomeSections, { radial: 40, capEnd: true }), materials.radome);
    prepareMesh(radome);
    group.add(radome);
    const upperDeck = new THREE.Mesh(createLoft(this.upperDeckSections, { radial: 40, capStart: true, capEnd: true }), materials.hull);
    upperDeck.name = this.cargo ? 'extended-upper-deck' : 'classic-upper-deck';
    prepareMesh(upperDeck);
    group.add(upperDeck);
    this.upperDeck = upperDeck;

    const belly = new THREE.Mesh(createHullPatch(this.hullSections, {
      z0: -13.0,
      z1: 8.0,
      a0: -2.62,
      a1: -0.52,
      bulge: 0.62,
      nz: 22,
      na: 22
    }), materials.panel);
    prepareMesh(belly);
    group.add(belly);
    const dorsal = new THREE.Mesh(createHullPatch(this.hullSections, {
      z0: this.tailZ + 3.0,
      z1: -13.0,
      a0: 0.95,
      a1: 2.19,
      bulge: 0.48,
      nz: 16,
      na: 16
    }), materials.hull);
    prepareMesh(dorsal);
    group.add(dorsal);

    const apu = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.28, 0.75, 18), materials.exhaust);
    apu.rotation.x = HALF_PI;
    apu.position.set(0, 7.05, this.tailZ + 0.22);
    prepareMesh(apu, { castShadow: false });
    group.add(apu);
    const apuRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 8, 20), materials.dark);
    apuRing.position.set(0, 7.05, this.tailZ - 0.12);
    prepareMesh(apuRing, { castShadow: false });
    group.add(apuRing);

    this.buildWindows(group);
    this.buildDoors(group);
    this.buildWindshield(group);
    this.buildAntennas(group);
    this.buildLivery(group);
    if (this.cargo) this.buildCargoDoor(group);
  }

  createWindowRow(group, sections, positions, y) {
    if (!positions.length) return null;
    const geometry = new THREE.BoxGeometry(0.075, 0.30, 0.46);
    const windows = new THREE.InstancedMesh(geometry, this.materials.window, positions.length * 2);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const position = new THREE.Vector3();
    let index = 0;
    for (const sign of [-1, 1]) {
      for (const z of positions) {
        const section = sectionAtZ(sections, z);
        const ratio = clampNumber((y - section.cy) / section.ry, -0.92, 0.92);
        const x = section.rx * Math.sqrt(1 - ratio * ratio);
        position.set(sign * x * 1.006, y, z);
        quaternion.setFromAxisAngle(Z_AXIS, sign * Math.asin(ratio));
        matrix.compose(position, quaternion, scale);
        windows.setMatrixAt(index, matrix);
        index += 1;
      }
    }
    windows.instanceMatrix.needsUpdate = true;
    windows.castShadow = false;
    windows.receiveShadow = false;
    group.add(windows);
    return windows;
  }

  buildWindows(group) {
    const mainPositions = [];
    if (!this.cargo) {
      const count = 44;
      const start = this.noseZ - 12.0;
      const end = this.tailZ + 12.0;
      for (let i = 0; i < count; i += 1) mainPositions.push(start + (end - start) * i / (count - 1));
    }
    const upperCount = this.cargo ? 4 : this.typeId === 'b747-400' ? 8 : 10;
    const upperPositions = [];
    const upperStart = this.upperDeckSections[0].z + (this.cargo ? 5.0 : 4.0);
    const upperEnd = this.cockpitEye.z - 5.0;
    for (let i = 0; i < upperCount; i += 1) {
      upperPositions.push(upperStart + (upperEnd - upperStart) * (i + 0.5) / upperCount);
    }
    this.cabinWindows = this.createWindowRow(group, this.hullSections, mainPositions, 6.35);
    this.upperDeckWindows = this.createWindowRow(group, this.upperDeckSections, upperPositions, 8.18);
  }

  buildDoors(group) {
    const entries = [];
    if (this.cargo) {
      entries.push({ z: this.noseZ - 12.0, y: 5.40, length: 1.0, height: 1.9, handle: true });
    } else {
      for (const z of [this.noseZ - 12, this.noseZ - 23, 0, -12, this.tailZ + 13]) {
        entries.push({ z, y: 5.40, length: 1.0, height: 1.9, handle: true });
      }
    }
    entries.push({ z: this.cockpitEye.z - 7.5, y: 7.95, length: 0.9, height: 1.5, upper: true, handle: true });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const outlines = new THREE.InstancedMesh(unit, this.materials.dark, entries.length * 2);
    const panels = new THREE.InstancedMesh(unit, this.materials.panel, entries.length * 2);
    const handles = new THREE.InstancedMesh(unit, this.materials.chrome, entries.length * 2);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let index = 0;
    for (const entry of entries) {
      const sections = entry.upper ? this.upperDeckSections : this.hullSections;
      const section = sectionAtZ(sections, entry.z);
      const ratio = clampNumber((entry.y - section.cy) / section.ry, -0.9, 0.9);
      const x = section.rx * Math.sqrt(1 - ratio * ratio);
      const tilt = Math.asin(ratio);
      for (const sign of [-1, 1]) {
        quaternion.setFromAxisAngle(Z_AXIS, sign * tilt);
        position.set(sign * (x - 0.012), entry.y, entry.z);
        scale.set(0.05, entry.height + 0.12, entry.length + 0.12);
        matrix.compose(position, quaternion, scale);
        outlines.setMatrixAt(index, matrix);
        position.set(sign * (x + 0.025), entry.y, entry.z);
        scale.set(0.065, entry.height, entry.length);
        matrix.compose(position, quaternion, scale);
        panels.setMatrixAt(index, matrix);
        position.set(sign * (x + 0.065), entry.y - entry.height * 0.32, entry.z - entry.length * 0.28);
        scale.set(0.055, 0.20, 0.26);
        matrix.compose(position, quaternion, scale);
        handles.setMatrixAt(index, matrix);
        index += 1;
      }
    }
    for (const mesh of [outlines, panels, handles]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    this.doorInstances = { outlines, panels, handles };
  }

  buildWindshield(group) {
    const z = this.cockpitEye.z;
    const panels = [
      { z0: z + 2.0, z1: z + 5.0, a0: -0.16, a1: 0.40 },
      { z0: z + 2.0, z1: z + 5.0, a0: Math.PI - 0.40, a1: Math.PI + 0.16 },
      { z0: z - 0.7, z1: z + 1.85, a0: -0.55, a1: -0.20 },
      { z0: z - 0.7, z1: z + 1.85, a0: Math.PI + 0.20, a1: Math.PI + 0.55 }
    ];
    for (const panel of panels) {
      const frame = new THREE.Mesh(createHullPatch(this.upperDeckSections, {
        z0: panel.z0 - 0.13,
        z1: panel.z1 + 0.13,
        a0: panel.a0 - 0.035,
        a1: panel.a1 + 0.035,
        bulge: 0.025,
        nz: 7,
        na: 7,
        blendAngles: false,
        blendLength: false
      }), this.materials.dark);
      frame.castShadow = false;
      group.add(frame);
      const glass = new THREE.Mesh(createHullPatch(this.upperDeckSections, {
        ...panel,
        bulge: 0.045,
        nz: 7,
        na: 7,
        blendAngles: false,
        blendLength: false
      }), this.materials.glass);
      glass.castShadow = false;
      glass.receiveShadow = false;
      group.add(glass);
    }
  }

  buildAntennas(group) {
    const parts = [
      { width: 0.06, height: 0.55, depth: 0.75, x: 0, y: 8.58, z: -5.0 },
      { width: 0.06, height: 0.40, depth: 0.55, x: 0, y: 8.55, z: -10.0 },
      { width: 0.10, height: 0.30, depth: 0.38, x: 1.15, y: 2.10, z: 2.2 },
      { width: 0.10, height: 0.30, depth: 0.38, x: -1.15, y: 2.10, z: 2.2 },
      { width: 0.65, height: 0.14, depth: 0.30, x: 0, y: 9.25, z: this.cockpitEye.z - 8.0 }
    ];
    for (const part of parts) {
      const mesh = boxMesh(this.materials.dark, part.width, part.height, part.depth, part.x, part.y, part.z);
      mesh.castShadow = false;
      group.add(mesh);
    }
    const probeGeometry = new THREE.CylinderGeometry(0.032, 0.032, 1.15, 8);
    for (const sign of [-1, 1]) {
      const probe = new THREE.Mesh(probeGeometry, this.materials.chrome);
      probe.rotation.x = HALF_PI;
      probe.position.set(sign * 1.45, 5.85, this.noseZ - 4.0);
      prepareMesh(probe, { castShadow: false });
      group.add(probe);
    }
  }

  buildLivery(group) {
    const stripes = [
      { a0: 0.02, a1: 0.15, material: this.materials.paint },
      { a0: -0.025, a1: 0.02, material: this.materials.accent }
    ];
    for (const stripe of stripes) {
      for (const sign of [-1, 1]) {
        const a0 = sign > 0 ? stripe.a0 : Math.PI - stripe.a1;
        const a1 = sign > 0 ? stripe.a1 : Math.PI - stripe.a0;
        const mesh = new THREE.Mesh(createHullPatch(this.hullSections, {
          z0: this.tailZ + 9,
          z1: this.noseZ - 8,
          a0,
          a1,
          bulge: 0.018,
          nz: 30,
          na: 2,
          blendAngles: false,
          blendLength: false
        }), stripe.material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        group.add(mesh);
      }
    }
    const decals = [
      { material: this.materials.title, a0: 0.17, a1: 0.42, z0: this.cockpitEye.z - 15, z1: this.cockpitEye.z - 4, nz: 14, na: 6 },
      { material: this.materials.registration, a0: 0.18, a1: 0.36, z0: this.tailZ + 10, z1: this.tailZ + 16, nz: 10, na: 4 }
    ];
    for (const decal of decals) {
      for (const sign of [-1, 1]) {
        const a0 = sign > 0 ? decal.a0 : Math.PI - decal.a1;
        const a1 = sign > 0 ? decal.a1 : Math.PI - decal.a0;
        const mesh = new THREE.Mesh(createHullPatch(this.hullSections, {
          z0: decal.z0,
          z1: decal.z1,
          a0,
          a1,
          bulge: 0.022,
          nz: decal.nz,
          na: decal.na,
          blendAngles: false,
          blendLength: false,
          flipU: true
        }), decal.material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        group.add(mesh);
      }
    }
  }

  buildCargoDoor(group) {
    const z0 = this.tailZ + 9.0;
    const z1 = this.tailZ + 20.5;
    const outline = new THREE.Mesh(createHullPatch(this.hullSections, {
      z0: z0 - 0.25,
      z1: z1 + 0.25,
      a0: Math.PI - 0.66,
      a1: Math.PI + 0.66,
      bulge: 0.020,
      nz: 14,
      na: 12,
      blendAngles: false,
      blendLength: false
    }), this.materials.dark);
    outline.castShadow = false;
    group.add(outline);
    const door = new THREE.Mesh(createHullPatch(this.hullSections, {
      z0,
      z1,
      a0: Math.PI - 0.62,
      a1: Math.PI + 0.62,
      bulge: 0.038,
      nz: 14,
      na: 12,
      blendAngles: false,
      blendLength: false
    }), this.materials.cargoDoor);
    door.name = '747-8f-aft-main-deck-cargo-door';
    prepareMesh(door, { castShadow: false });
    group.add(door);
    this.cargoDoor = door;
  }

  buildWings() {
    const wingGeometry = createAirfoilGeometry(this.wingSections, { samples: 16, xcEnd: WING_CUT });
    const wingletGeometry = this.cargo ? null : createAirfoilGeometry(createWingletSections(this.wingTip.chord), { samples: 10 });
    if (wingletGeometry) wingletGeometry.rotateZ(HALF_PI - WINGLET_CANT);
    for (const sign of [1, -1]) {
      const side = sign > 0 ? 'right' : 'left';
      const group = new THREE.Group();
      group.name = `747-main-wing-${side}`;
      if (sign < 0) group.scale.x = -1;
      this.airframe.add(group);
      this.wingGroups[side] = group;
      const wing = new THREE.Mesh(wingGeometry, this.materials.wing);
      prepareMesh(wing);
      group.add(wing);
      if (wingletGeometry) {
        const winglet = new THREE.Mesh(wingletGeometry, this.materials.paint);
        winglet.position.set(this.wingTip.x, this.wingTip.y, this.wingTip.z);
        winglet.name = '747-400-conventional-winglet';
        prepareMesh(winglet);
        group.add(winglet);
      }

      const flapRanges = [[2.8, 9.0], [9.4, 16.1], [16.5, 21.4]];
      flapRanges.forEach((range, index) => {
        const flap = this.createTrailingEdgeSurface({
          fromX: range[0],
          toX: range[1],
          hingeFraction: FLAP_HINGE,
          chordFraction: FLAP_CHORD,
          material: this.materials.wing,
          thicknessScale: 0.80,
          vaneCount: index < 2 ? 2 : 1
        });
        flap.flapIndex = index;
        group.add(flap.pivot);
        this.flaps[side].push(flap);
      });

      for (const range of [[21.8, 25.1], [26.0, this.wingTip.x - 0.65]]) {
        const aileron = this.createTrailingEdgeSurface({
          fromX: range[0],
          toX: range[1],
          hingeFraction: AILERON_HINGE,
          chordFraction: AILERON_CHORD,
          material: this.materials.wing,
          thicknessScale: 0.84
        });
        group.add(aileron.pivot);
        this.ailerons[side].push(aileron);
      }

      for (const range of [[3.2, 9.0], [9.4, 16.0], [16.4, 22.4], [23.0, this.wingTip.x - 0.7]]) {
        const slat = this.createSlatSurface(range[0], range[1], this.materials.wing);
        group.add(slat.pivot);
        this.slats[side].push(slat);
      }
      for (let i = 0; i < 6; i += 1) {
        const from = 3.7 + i * 3.05;
        const spoiler = this.createSpoilerSurface(from, from + 2.55, this.materials.panel);
        group.add(spoiler.pivot);
        this.spoilers[side].push(spoiler);
      }
    }
  }

  buildTail() {
    const tailGeometry = createAirfoilGeometry(this.tailSections, { samples: 12, xcEnd: TAIL_CUT, camber: 0 });
    for (const sign of [1, -1]) {
      const side = sign > 0 ? 'right' : 'left';
      const group = new THREE.Group();
      group.name = `747-horizontal-tail-${side}`;
      if (sign < 0) group.scale.x = -1;
      this.airframe.add(group);
      const tail = new THREE.Mesh(tailGeometry, this.materials.wing);
      prepareMesh(tail);
      group.add(tail);
      const elevator = this.createTrailingEdgeSurface({
        fromX: 1.1,
        toX: 10.55,
        hingeFraction: ELEVATOR_HINGE,
        chordFraction: ELEVATOR_CHORD,
        material: this.materials.wing,
        thicknessScale: 0.85,
        sourceSections: this.tailSections
      });
      group.add(elevator.pivot);
      this.elevators[side] = elevator;
    }

    const finGeometry = createAirfoilGeometry(this.finSections, { samples: 14, xcEnd: FIN_CUT, camber: 0 });
    finGeometry.rotateZ(HALF_PI);
    finGeometry.translate(0, FIN_ROOT_Y, 0);
    const fin = new THREE.Mesh(finGeometry, this.materials.fin);
    fin.name = '747-tall-vertical-stabilizer';
    prepareMesh(fin);
    this.airframe.add(fin);
    this.fin = fin;

    const hingeZ = this.finSections[0].z - RUDDER_HINGE * this.finSections[0].chord;
    const rudderSections = [];
    for (let i = 0; i <= 6; i += 1) {
      const height = this.finTipHeight * i / 6;
      const section = sampleAirfoilSections(this.finSections, height);
      const worldHinge = section.z - RUDDER_HINGE * section.chord;
      rudderSections.push({
        x: height,
        y: 0,
        z: worldHinge - hingeZ,
        chord: Math.max(0.02, section.chord * RUDDER_CHORD),
        thickness: 0.1,
        camber: 0
      });
    }
    const last = rudderSections[rudderSections.length - 1];
    last.z -= last.chord * 0.5;
    last.chord = 0.025;
    const rudderPivot = new THREE.Group();
    rudderPivot.position.set(0, FIN_ROOT_Y, hingeZ);
    rudderPivot.quaternion.setFromAxisAngle(Z_AXIS, HALF_PI);
    const rudderSwing = new THREE.Group();
    rudderPivot.add(rudderSwing);
    const rudderMesh = new THREE.Mesh(createAirfoilGeometry(rudderSections, { samples: 8, camber: 0 }), this.materials.paint);
    prepareMesh(rudderMesh);
    rudderSwing.add(rudderMesh);
    this.airframe.add(rudderPivot);
    this.rudder = { pivot: rudderPivot, swing: rudderSwing, mesh: rudderMesh };
  }

  createTrailingEdgeSurface(options) {
    const sourceSections = options.sourceSections ?? this.wingSections;
    const span = Math.abs(options.toX) - Math.abs(options.fromX);
    const steps = 5;
    const sections = [];
    let hingeA = null;
    let hingeB = null;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = Math.abs(options.fromX) + span * t;
      const wing = sampleAirfoilSections(sourceSections, x);
      const hingePoint = airfoilSurfacePoint(wing, options.hingeFraction, 0);
      if (i === 0) hingeA = new THREE.Vector3(x, hingePoint.y, hingePoint.z);
      hingeB = new THREE.Vector3(x, hingePoint.y, hingePoint.z);
      sections.push({
        x: span * t,
        y: 0,
        z: 0,
        chord: wing.chord * options.chordFraction,
        thickness: (wing.thickness ?? 0.12) * 0.85 * (options.thicknessScale ?? 1),
        camber: 0.02
      });
    }
    const surface = this.createHingedSurface({
      hingeA,
      hingeB,
      sections,
      material: options.material,
      samples: 8,
      xcEnd: 0.96
    });
    surface.vanes = [];
    const vaneCount = options.vaneCount ?? 0;
    for (let layer = 0; layer < vaneCount; layer += 1) {
      const vaneSections = sections.map((section, i) => {
        const x = Math.abs(options.fromX) + span * i / steps;
        const wing = sampleAirfoilSections(sourceSections, x);
        return {
          x: section.x,
          y: -wing.chord * (0.014 + layer * 0.009),
          z: wing.chord * (0.045 + layer * 0.055),
          chord: wing.chord * options.chordFraction * (0.44 - layer * 0.07),
          thickness: 0.055,
          camber: 0.03
        };
      });
      const vane = new THREE.Mesh(createAirfoilGeometry(vaneSections, { samples: 6, xcEnd: 0.96 }), options.material);
      prepareMesh(vane, { castShadow: false });
      surface.swing.add(vane);
      surface.vanes.push(vane);
    }
    return surface;
  }

  createSlatSurface(fromX, toX, material) {
    const span = Math.abs(toX) - Math.abs(fromX);
    const steps = 4;
    const sections = [];
    let hingeA = null;
    let hingeB = null;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = Math.abs(fromX) + span * t;
      const wing = sampleAirfoilSections(this.wingSections, x);
      const hingePoint = airfoilSurfacePoint(wing, 0.10, 1);
      if (i === 0) hingeA = new THREE.Vector3(x, hingePoint.y, hingePoint.z);
      hingeB = new THREE.Vector3(x, hingePoint.y, hingePoint.z);
      sections.push({
        x: span * t,
        y: -wing.chord * 0.03,
        z: wing.chord * 0.14,
        chord: wing.chord * 0.17,
        thickness: 0.11,
        camber: 0.05
      });
    }
    return this.createHingedSurface({ hingeA, hingeB, sections, material, samples: 8, xcEnd: 0.94 });
  }

  createSpoilerSurface(fromX, toX, material) {
    const span = Math.abs(toX) - Math.abs(fromX);
    const steps = 3;
    const sections = [];
    let hingeA = null;
    let hingeB = null;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = Math.abs(fromX) + span * t;
      const wing = sampleAirfoilSections(this.wingSections, x);
      const point = airfoilSurfacePoint(wing, 0.48, 1);
      if (i === 0) hingeA = new THREE.Vector3(x, point.y, point.z);
      hingeB = new THREE.Vector3(x, point.y, point.z);
      sections.push({
        x: span * t,
        y: wing.chord * 0.004,
        z: 0,
        chord: wing.chord * 0.23,
        thickness: 0.055,
        camber: 0.02
      });
    }
    return this.createHingedSurface({ hingeA, hingeB, sections, material, samples: 6 });
  }

  createHingedSurface(options) {
    const pivot = new THREE.Group();
    pivot.position.copy(options.hingeA);
    this.scratchPosition.subVectors(options.hingeB, options.hingeA);
    if (this.scratchPosition.lengthSq() > 1e-8) {
      this.scratchPosition.normalize();
      pivot.quaternion.setFromUnitVectors(X_AXIS, this.scratchPosition);
    }
    const swing = new THREE.Group();
    pivot.add(swing);
    const geometry = createAirfoilGeometry(options.sections, {
      xcEnd: options.xcEnd ?? 0.94,
      camber: options.camber ?? 0.014,
      samples: options.samples ?? 8
    });
    const mesh = new THREE.Mesh(geometry, options.material);
    prepareMesh(mesh);
    swing.add(mesh);
    return { pivot, swing, mesh };
  }

  buildEngines() {
    const materials = this.materials;
    const radius = this.cargo ? 1.64 : 1.52;
    const nacelleGeometry = createLoft([
      { z: -3.25, r: radius * 0.82 },
      { z: -2.55, r: radius * 0.91 },
      { z: -1.10, r: radius * 0.98 },
      { z: 0.80, r: radius * 1.02 },
      { z: 2.35, r: radius * 1.025 },
      { z: 3.10, r: radius },
      { z: 3.28, r: radius * 0.95 },
      { z: 3.18, r: radius * 0.90 }
    ], { radial: 38 });
    const sleeveGeometry = createLoft([
      { z: -3.28, r: radius * 0.83 },
      { z: -2.50, r: radius * 0.92 },
      { z: -1.10, r: radius * 0.99 },
      { z: 0.35, r: radius * 1.01 }
    ], { radial: 38 });
    const ductGeometry = createLoft([
      { z: 1.45, r: radius * 0.86 },
      { z: 2.30, r: radius * 0.88 },
      { z: 3.17, r: radius * 0.90 }
    ], { radial: 38 });
    const fanBladeGeometry = createAirfoilGeometry([
      { x: radius * 0.24, y: 0, z: 0.18, chord: 0.38, thickness: 0.12, camber: 0.05 },
      { x: radius * 0.55, y: 0, z: 0.03, chord: 0.55, thickness: 0.09, camber: 0.06 },
      { x: radius * 0.82, y: 0, z: -0.16, chord: 0.40, thickness: 0.07, camber: 0.05 },
      { x: radius * 0.85, y: 0, z: -0.35, chord: 0.02, thickness: 0.06, camber: 0.04 }
    ], { samples: 5 });
    fanBladeGeometry.rotateZ(HALF_PI);
    const fanFaceGeometry = new THREE.CircleGeometry(radius * 0.87, 34);
    const blurGeometry = new THREE.CircleGeometry(radius * 0.84, 30);
    const spinnerGeometry = new THREE.ConeGeometry(radius * 0.16, 0.60, 16);
    const nozzleGeometry = new THREE.CylinderGeometry(radius * 0.78, radius * 0.84, 0.52, 30, 1, true);
    const coreGeometry = new THREE.ConeGeometry(radius * 0.43, 2.65, 24);
    const grilleGeometry = new THREE.BoxGeometry(0.34, 0.54, 0.09);
    const markingGeometry = new THREE.PlaneGeometry(2.25, 0.56);
    const pylonGeometry = createAirfoilGeometry([
      { x: radius * 0.55, y: 0, z: 1.45, chord: 2.75, thickness: 0.20 },
      { x: radius * 0.95, y: 0, z: 1.50, chord: 3.40, thickness: 0.22 },
      { x: radius * 1.30, y: 0, z: 1.55, chord: 3.85, thickness: 0.23 },
      { x: radius * 1.33, y: 0, z: -2.15, chord: 0.02, thickness: 0.20 }
    ], { samples: 8, camber: 0.01 });
    pylonGeometry.rotateZ(HALF_PI);
    const gearboxGeometry = new THREE.BoxGeometry(0.95, 0.52, 1.65);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);

    this.typeSpec.enginePositions.forEach((enginePosition, index) => {
      const group = new THREE.Group();
      group.name = `747-engine-${index + 1}`;
      group.userData.engineIndex = index;
      const station = sampleAirfoilSections(this.wingSections, Math.abs(enginePosition.x));
      const halfThickness = station.chord * (station.thickness ?? 0.12) * 0.5;
      group.position.set(
        enginePosition.x,
        station.y - halfThickness - radius - 0.05,
        station.z + 0.5
      );
      this.airframe.add(group);

      const nacelle = new THREE.Mesh(nacelleGeometry, materials.engine);
      prepareMesh(nacelle);
      group.add(nacelle);
      const duct = new THREE.Mesh(ductGeometry, materials.inlet);
      prepareMesh(duct, { castShadow: false });
      group.add(duct);
      const fanFace = new THREE.Mesh(fanFaceGeometry, materials.fanFace);
      fanFace.position.z = 2.13;
      fanFace.castShadow = false;
      group.add(fanFace);

      const fan = new THREE.Group();
      fan.name = `engine-${index + 1}-n1-fan`;
      fan.position.z = 2.18;
      const blades = new THREE.InstancedMesh(fanBladeGeometry, materials.fanBlade, this.cargo ? 20 : 24);
      const bladeCount = blades.count;
      for (let i = 0; i < bladeCount; i += 1) {
        quaternion.setFromAxisAngle(Z_AXIS, i / bladeCount * Math.PI * 2);
        quaternion.multiply(this.scratchQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.42));
        matrix.compose(position, quaternion, scale);
        blades.setMatrixAt(i, matrix);
      }
      blades.instanceMatrix.needsUpdate = true;
      blades.castShadow = false;
      fan.add(blades);
      const spinner = new THREE.Mesh(spinnerGeometry, materials.chrome);
      spinner.rotation.x = HALF_PI;
      spinner.position.z = 0.27;
      prepareMesh(spinner, { castShadow: false });
      fan.add(spinner);
      const blur = new THREE.Mesh(blurGeometry, materials.fanBlur[index]);
      blur.position.z = 0.06;
      blur.castShadow = false;
      fan.add(blur);
      group.add(fan);

      const reverser = new THREE.Group();
      const sleeve = new THREE.Mesh(sleeveGeometry, materials.engineDark);
      prepareMesh(sleeve);
      reverser.add(sleeve);
      const nozzle = new THREE.Mesh(nozzleGeometry, materials.exhaust);
      nozzle.rotation.x = HALF_PI;
      nozzle.position.z = -3.38;
      prepareMesh(nozzle);
      reverser.add(nozzle);
      group.add(reverser);

      const grilles = new THREE.InstancedMesh(grilleGeometry, materials.grille, 24);
      for (let i = 0; i < 24; i += 1) {
        const angle = i / 24 * Math.PI * 2;
        quaternion.setFromAxisAngle(Z_AXIS, angle);
        quaternion.multiply(this.scratchQuaternion.setFromAxisAngle(X_AXIS, 0.55));
        position.set(Math.cos(angle) * radius * 1.02, Math.sin(angle) * radius * 1.02, -0.10);
        matrix.compose(position, quaternion, scale);
        grilles.setMatrixAt(i, matrix);
      }
      grilles.instanceMatrix.needsUpdate = true;
      grilles.castShadow = false;
      grilles.visible = false;
      group.add(grilles);

      const coreExhaust = new THREE.Mesh(coreGeometry, materials.exhaust);
      coreExhaust.rotation.x = -HALF_PI;
      coreExhaust.position.z = -1.55;
      prepareMesh(coreExhaust);
      group.add(coreExhaust);
      const pylon = new THREE.Mesh(pylonGeometry, materials.engine);
      pylon.position.y = 0.45;
      prepareMesh(pylon);
      group.add(pylon);
      const gearbox = new THREE.Mesh(gearboxGeometry, materials.engineDark);
      gearbox.position.set(0, -radius * 0.88, 0.05);
      prepareMesh(gearbox);
      group.add(gearbox);

      const side = Math.sign(enginePosition.x) || 1;
      const marking = new THREE.Mesh(markingGeometry, materials.engineMarks[index]);
      marking.position.set(side * radius * 1.035, 0.20, 0.20);
      marking.rotation.y = side * HALF_PI;
      marking.castShadow = false;
      group.add(marking);
      this.engines.push({ group, fan, reverser, sleeve, grilles, blur, fanAngle: index * 0.7, radius });
    });
  }

  buildLandingGear() {
    const mainTire = new THREE.CylinderGeometry(0.62, 0.62, 0.38, 22, 1);
    mainTire.rotateZ(HALF_PI);
    const mainHub = new THREE.CylinderGeometry(0.29, 0.29, 0.41, 18, 1);
    mainHub.rotateZ(HALF_PI);
    const noseTire = new THREE.CylinderGeometry(0.52, 0.52, 0.30, 20, 1);
    noseTire.rotateZ(HALF_PI);
    const noseHub = new THREE.CylinderGeometry(0.24, 0.24, 0.33, 16, 1);
    noseHub.rotateZ(HALF_PI);
    const mainBrake = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 18, 1);
    mainBrake.rotateZ(HALF_PI);
    const noseBrake = new THREE.CylinderGeometry(0.27, 0.27, 0.06, 16, 1);
    noseBrake.rotateZ(HALF_PI);
    const geometry = { mainTire, mainHub, noseTire, noseHub, mainBrake, noseBrake };

    this.gears.push(this.createGear({ type: 'nose', name: 'nose', x: 0, z: this.noseGearZ, attachY: 3.45, wheelRadius: 0.52 }, geometry));
    this.gears.push(this.createGear({ type: 'body', name: 'body-left', x: -4.55, z: -7.8, attachY: 3.70, wheelRadius: 0.62 }, geometry));
    this.gears.push(this.createGear({ type: 'body', name: 'body-right', x: 4.55, z: -7.8, attachY: 3.70, wheelRadius: 0.62 }, geometry));
    this.gears.push(this.createGear({ type: 'wing', name: 'wing-left', x: -10.8, z: -1.6, attachY: 4.05, wheelRadius: 0.62 }, geometry));
    this.gears.push(this.createGear({ type: 'wing', name: 'wing-right', x: 10.8, z: -1.6, attachY: 4.05, wheelRadius: 0.62 }, geometry));

    for (const gear of this.gears) {
      if (gear.type === 'nose') {
        this.createGearDoor(gear, -1, 0.72, 3.4, 2.40);
        this.createGearDoor(gear, 1, 0.72, 3.4, 2.40);
      } else {
        this.createGearDoor(gear, gear.side, gear.type === 'wing' ? 1.65 : 1.85, 4.5, gear.type === 'wing' ? 3.52 : 2.22);
      }
    }
  }

  createGear(options, geometry) {
    const main = options.type !== 'nose';
    const root = new THREE.Group();
    root.name = `747-landing-gear-${options.name}`;
    root.position.set(options.x, options.attachY, options.z);
    this.airframe.add(root);
    const steer = new THREE.Group();
    root.add(steer);
    const lower = new THREE.Group();
    steer.add(lower);
    const axleY = options.wheelRadius - options.attachY;
    const strutLength = -axleY;
    const restCompression = main ? 0.18 : 0.12;

    const upperStrut = new THREE.Mesh(
      new THREE.CylinderGeometry(main ? 0.20 : 0.14, main ? 0.23 : 0.17, strutLength * 0.58, 14),
      this.materials.metal
    );
    upperStrut.position.y = -strutLength * 0.29;
    prepareMesh(upperStrut);
    steer.add(upperStrut);
    const piston = new THREE.Mesh(
      new THREE.CylinderGeometry(main ? 0.135 : 0.10, main ? 0.135 : 0.10, strutLength * 0.72, 14),
      this.materials.chrome
    );
    piston.position.y = -strutLength * 0.66;
    prepareMesh(piston);
    lower.add(piston);

    const side = Math.sign(options.x) || 1;
    const braceA = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, strutLength * 0.95, 9), this.materials.metal);
    braceA.position.set(main ? side * 0.28 : 0, -strutLength * 0.43, -0.42);
    braceA.rotation.z = main ? side * 0.25 : 0;
    braceA.rotation.x = 0.31;
    prepareMesh(braceA);
    lower.add(braceA);
    const braceB = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, strutLength * 0.66, 9), this.materials.metal);
    braceB.position.set(main ? -side * 0.18 : 0, -strutLength * 0.34, 0.40);
    braceB.rotation.x = -0.38;
    prepareMesh(braceB);
    steer.add(braceB);
    const torque = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, strutLength * 0.46, 8), this.materials.chrome);
    torque.position.set(0, -strutLength * 0.72, 0.34);
    torque.rotation.x = -0.52;
    prepareMesh(torque);
    lower.add(torque);

    const bogie = new THREE.Group();
    bogie.name = main ? 'four-wheel-bogie' : 'dual-wheel-axle';
    bogie.position.y = axleY;
    lower.add(bogie);
    if (main) {
      const beam = boxMesh(this.materials.metal, 0.24, 0.25, 2.35);
      bogie.add(beam);
    }
    const axlePositions = main ? [-0.84, 0.84] : [0];
    const wheels = [];
    for (const axleZ of axlePositions) {
      const axleBar = boxMesh(this.materials.metal, main ? 1.85 : 1.10, 0.14, 0.14, 0, 0, axleZ);
      bogie.add(axleBar);
      for (const wheelSide of [-1, 1]) {
        const wheel = new THREE.Group();
        wheel.position.set(wheelSide * (main ? 0.70 : 0.40), 0, axleZ);
        const tire = new THREE.Mesh(main ? geometry.mainTire : geometry.noseTire, this.materials.tire);
        prepareMesh(tire);
        wheel.add(tire);
        const hub = new THREE.Mesh(main ? geometry.mainHub : geometry.noseHub, this.materials.hub);
        prepareMesh(hub);
        wheel.add(hub);
        const disc = new THREE.Mesh(main ? geometry.mainBrake : geometry.noseBrake, this.materials.brake);
        disc.position.x = wheelSide * 0.12;
        prepareMesh(disc, { castShadow: false });
        wheel.add(disc);
        bogie.add(wheel);
        wheels.push(wheel);
      }
    }

    let taxiLight = null;
    if (!main) {
      const housing = boxMesh(this.materials.dark, 0.46, 0.34, 0.28, 0, -strutLength * 0.45, 0.18);
      housing.castShadow = false;
      steer.add(housing);
      taxiLight = new THREE.Mesh(new THREE.CircleGeometry(0.21, 16), this.materials.lens);
      taxiLight.position.set(0, -strutLength * 0.45, 0.33);
      taxiLight.castShadow = false;
      steer.add(taxiLight);
      this.landingLights.push(taxiLight);
    }
    return {
      root,
      steer,
      lower,
      bogie,
      wheels,
      type: options.type,
      side,
      attachY: options.attachY,
      axleY,
      wheelRadius: options.wheelRadius,
      restCompression,
      compressionKey: main ? options.x < 0 ? 'left' : 'right' : 'nose',
      taxiLight
    };
  }

  createGearDoor(gear, sign, width, depth, y) {
    const pivot = new THREE.Group();
    const hingeX = gear.root.position.x + sign * (gear.type === 'nose' ? 0.72 : 1.05);
    pivot.position.set(hingeX, y, gear.root.position.z);
    const door = new THREE.Mesh(new THREE.BoxGeometry(width, 0.09, depth), this.materials.panel);
    door.position.x = -sign * width * 0.5;
    prepareMesh(door, { castShadow: false });
    pivot.add(door);
    this.airframe.add(pivot);
    this.gearDoors.push({ pivot, mesh: door, sign, gear });
  }

  buildLights() {
    const bulb = new THREE.SphereGeometry(0.17, 10, 8);
    const wingletX = this.cargo ? 0 : 2.15 * Math.sin(WINGLET_CANT);
    const wingletY = this.cargo ? 0 : 2.15 * Math.cos(WINGLET_CANT);
    const tipX = this.wingTip.x + wingletX;
    const tipY = this.wingTip.y + wingletY;
    const tipZ = this.wingTip.z - (this.cargo ? 0.8 : 1.35);
    for (const side of ['right', 'left']) {
      const group = this.wingGroups[side];
      const starboard = side === 'right';
      const nav = new THREE.Mesh(bulb, starboard ? this.materials.navGreen : this.materials.navRed);
      nav.position.set(tipX, tipY - 0.08, tipZ);
      nav.castShadow = false;
      group.add(nav);
      this.navLights.push(nav);
      const strobe = new THREE.Mesh(bulb, this.materials.navWhite);
      strobe.position.set(tipX, tipY + 0.15, tipZ + 0.45);
      strobe.scale.setScalar(0.85);
      strobe.castShadow = false;
      group.add(strobe);
      this.strobeLights.push(strobe);

      const landing = new THREE.Mesh(new THREE.CircleGeometry(0.34, 18), this.materials.lens);
      landing.position.set(2.2, 3.92, 7.55);
      landing.rotation.x = -0.32;
      landing.castShadow = false;
      group.add(landing);
      this.landingLights.push(landing);
    }

    const tailNav = new THREE.Mesh(bulb, this.materials.navWhite);
    tailNav.position.set(0, 7.22, this.tailZ + 0.05);
    tailNav.scale.setScalar(0.8);
    tailNav.castShadow = false;
    this.airframe.add(tailNav);
    this.navLights.push(tailNav);
    const tailStrobe = new THREE.Mesh(bulb, this.materials.navWhite);
    tailStrobe.position.set(0, 6.90, this.tailZ - 0.08);
    tailStrobe.castShadow = false;
    this.airframe.add(tailStrobe);
    this.strobeLights.push(tailStrobe);

    for (const [y, z] of [[8.64, -6.0], [1.94, -6.0]]) {
      const beacon = new THREE.Mesh(bulb, this.materials.navRed);
      beacon.position.set(0, y, z);
      beacon.castShadow = false;
      this.airframe.add(beacon);
      this.beacons.push(beacon);
    }
    for (const sign of [-1, 1]) {
      const logo = new THREE.Mesh(new THREE.CircleGeometry(0.20, 12), this.materials.lens);
      logo.position.set(sign * 4.0, 6.35, this.tailZ + 11.0);
      logo.rotation.x = -HALF_PI;
      logo.castShadow = false;
      this.airframe.add(logo);
      this.logoLights.push(logo);
    }
    this.landingLight = new THREE.PointLight(0xfff1d6, 0, 110, 2);
    this.landingLight.position.set(0, 3.0, this.noseGearZ + 1.0);
    this.root.add(this.landingLight);
  }

  update(state, dt = 0) {
    if (!state || this.disposed) return;
    const step = clampNumber(finite(dt), 0, 0.1);
    this.elapsed += step;
    const position = state.pos ?? { x: 0, y: 0, z: -1700 };
    this.root.position.set(finite(position.x), finite(position.y), finite(position.z));
    this.yawQuaternion.setFromAxisAngle(this.yAxis, finite(state.heading));
    this.pitchQuaternion.setFromAxisAngle(this.xAxis, -finite(state.pitch));
    this.rollQuaternion.setFromAxisAngle(this.zAxis, -finite(state.roll));
    this.root.quaternion.copy(this.yawQuaternion).multiply(this.pitchQuaternion).multiply(this.rollQuaternion);

    const anim = this.anim;
    const flapLeft = finite(state.flaps?.left ?? state.controls?.flaps);
    const flapRight = finite(state.flaps?.right ?? state.controls?.flaps);
    anim.flap.left = damp(anim.flap.left, clampNumber(flapLeft * DEG, 0, 0.65), 9, step);
    anim.flap.right = damp(anim.flap.right, clampNumber(flapRight * DEG, 0, 0.65), 9, step);
    const slatFallback = clamp01(Math.max(flapLeft, flapRight) / 20);
    anim.slat.left = damp(anim.slat.left, clamp01(finite(state.slats?.left, slatFallback)), 8, step);
    anim.slat.right = damp(anim.slat.right, clamp01(finite(state.slats?.right, slatFallback)), 8, step);

    const rollInput = clampNumber(finite(state.input?.roll ?? state.controls?.roll), -1, 1);
    const pitchInput = clampNumber(finite(state.input?.pitch ?? state.controls?.pitch), -1, 1);
    const yawInput = clampNumber(finite(state.input?.yaw ?? state.controls?.yaw), -1, 1);
    anim.aileron = damp(anim.aileron, rollInput, 12, step);
    anim.elevator = damp(anim.elevator, pitchInput, 10, step);
    const limiter = clampNumber(finite(state.systems?.rudderLimiter, 1), 0.35, 1);
    anim.rudder = damp(anim.rudder, clampNumber(yawInput * limiter, -1, 1), 12, step);
    let spoilerTarget = clamp01(finite(state.systems?.speedBrake));
    const groundSpoilers = Boolean(state.systems?.groundSpoilers) || state.controls?.spoilers === 'deployed';
    if (groundSpoilers) spoilerTarget = 1;
    anim.spoiler = damp(anim.spoiler, spoilerTarget, groundSpoilers ? 7 : 4, step);

    const gearTarget = clamp01(finite(state.gear?.position ?? (state.controls?.gear === 'up' ? 0 : 1), 1));
    anim.gear = damp(anim.gear, gearTarget, 3.2, step);
    const doorTarget = state.gear?.doors ?? (state.gear?.moving ? 1 : 0);
    anim.doors = damp(anim.doors, clamp01(finite(doorTarget)), 3.2, step);
    for (let i = 0; i < this.gears.length; i += 1) {
      const gear = this.gears[i];
      let compression;
      if (gear.compressionKey === 'nose') compression = state.gear?.noseCompression;
      else if (gear.compressionKey === 'left') compression = state.gear?.leftCompression;
      else compression = state.gear?.rightCompression;
      compression = state.gear?.bogieCompression?.[i] ?? compression ?? state.gear?.compression;
      const target = clamp01(finite(compression, gear.restCompression));
      anim.compression[i] = damp(anim.compression[i], target, 10, step);
    }
    const steerAuthority = state.onGround === false ? 0.16 : 0.65;
    anim.steer = damp(anim.steer, yawInput * steerAuthority, 8, step);

    for (let i = 0; i < this.engines.length; i += 1) {
      const engine = state.engines?.[i] ?? {};
      let n1 = finite(engine.n1);
      if (n1 > 2) n1 /= 100;
      anim.n1[i] = damp(anim.n1[i], clamp01(n1), 2.6, step);
      const reverse = clamp01(finite(engine.reverser ?? (state.controls?.reverse ? 1 : 0)));
      anim.reverse[i] = damp(anim.reverse[i], reverse, 2.4, step);
      anim.blur[i] = damp(anim.blur[i], clamp01((anim.n1[i] - 0.18) / 0.5) * 0.55, 3, step);
    }

    this.applyControlSurfaces();
    this.applyLandingGear();
    this.applyEngines(step);
    this.applyLights(state);

    const gLoad = clampNumber(finite(state.gLoad, 1), -2, 5);
    const buffet = clamp01(finite(state.effects?.shake));
    const turbulence = clamp01(finite(state.environment?.turbulence));
    const targetFlex = clampNumber((gLoad - 1) * 0.85 * DEG, -1.4 * DEG, 2.8 * DEG);
    anim.flex = damp(anim.flex, targetFlex, 3.5, step);
    const wobble = (Math.sin(this.elapsed * 5.4) * 0.4 + Math.sin(this.elapsed * 11.2) * 0.16) *
      (buffet * 0.7 + turbulence * 0.4) * DEG;
    const flex = anim.flex + wobble;
    if (this.wingGroups.right) this.wingGroups.right.rotation.z = flex;
    if (this.wingGroups.left) this.wingGroups.left.rotation.z = -flex;

    const groundSpeed = finite(state.groundSpeed);
    if (state.onGround !== false) this.wheelSpeed = groundSpeed / 0.62;
    else this.wheelSpeed = damp(this.wheelSpeed, 0, 1.1, step);
    this.wheelAngle += this.wheelSpeed * step;
    for (const gear of this.gears) {
      const angle = this.wheelAngle * 0.62 / gear.wheelRadius;
      for (const wheel of gear.wheels) wheel.rotation.x = angle;
    }
    const brake = clamp01(finite(state.controls?.brake ?? (state.controls?.parkingBrake ? 1 : 0)));
    this.materials.brake.emissiveIntensity = damp(this.materials.brake.emissiveIntensity, state.onGround === false ? 0 : brake * Math.min(1, Math.abs(groundSpeed) / 35) * 0.7, 2, step);
    this.root.updateMatrixWorld(true);
  }

  applyControlSurfaces() {
    const anim = this.anim;
    for (const side of ['left', 'right']) {
      const isRight = side === 'right';
      this.flaps[side].forEach((flap, index) => {
        const amount = anim.flap[side] * (index === 2 ? 0.88 : 1);
        flap.swing.rotation.x = -amount;
        flap.swing.position.z = -Math.sin(amount) * (0.82 + index * 0.08);
        flap.swing.position.y = -Math.sin(amount) * 0.18;
        flap.vanes.forEach((vane, layer) => {
          vane.position.z = -Math.sin(amount) * (0.10 + layer * 0.09);
          vane.position.y = -Math.sin(amount) * (0.035 + layer * 0.025);
          vane.rotation.x = -amount * (0.08 + layer * 0.05);
        });
      });
      this.ailerons[side].forEach((aileron, index) => {
        const rollSign = isRight ? 1 : -1;
        aileron.swing.rotation.x = anim.aileron * rollSign * (index === 0 ? 0.22 : 0.34);
        aileron.swing.position.z = -Math.abs(anim.aileron) * 0.06;
      });
      for (const slat of this.slats[side]) {
        const amount = anim.slat[side];
        slat.swing.rotation.x = amount * 0.36;
        slat.swing.position.z = amount * 0.34;
        slat.swing.position.y = -amount * 0.07;
      }
      const assistInput = Math.max(0, isRight ? anim.aileron : -anim.aileron);
      this.spoilers[side].forEach((spoiler, index) => {
        const assist = assistInput * 0.34 * (index >= 3 ? 1 : 0.45);
        spoiler.swing.rotation.x = Math.max(anim.spoiler * 1.0, assist);
      });
      const elevator = this.elevators[side];
      if (elevator) elevator.swing.rotation.x = anim.elevator * 0.38;
    }
    if (this.rudder) this.rudder.swing.rotation.x = anim.rudder * 0.44;
  }

  applyLandingGear() {
    const gearPosition = this.anim.gear;
    const retract = 1 - gearPosition;
    this.gears.forEach((gear, index) => {
      gear.root.rotation.set(0, 0, 0);
      if (gear.type === 'nose') gear.root.rotation.x = -retract * (HALF_PI + 0.12);
      else if (gear.type === 'body') gear.root.rotation.x = retract * (HALF_PI + 0.10);
      else gear.root.rotation.z = -gear.side * retract * (HALF_PI + 0.12);
      const compression = this.anim.compression[index] ?? gear.restCompression;
      gear.lower.position.y = clampNumber((compression - gear.restCompression) * 0.45, -0.09, 0.40) * gearPosition;
      if (gear.type === 'nose') gear.steer.rotation.y = this.anim.steer * gearPosition;
      if (gear.type !== 'nose') gear.bogie.rotation.x = retract * (gear.type === 'body' ? -0.28 : 0.20);
    });
    for (const door of this.gearDoors) door.pivot.rotation.z = door.sign * this.anim.doors * 1.28;
  }

  applyEngines(step) {
    this.engines.forEach((engine, index) => {
      engine.fanAngle += step * (0.4 + this.anim.n1[index] * 46);
      engine.fan.rotation.z = -engine.fanAngle;
      engine.blur.material.opacity = this.anim.blur[index];
      const reverse = this.anim.reverse[index];
      engine.reverser.position.z = -reverse * 0.78;
      engine.grilles.visible = reverse > 0.03;
      engine.grilles.rotation.z = reverse * 0.08;
    });
  }

  applyLights(state) {
    const systems = state.systems ?? {};
    const time = finite(state.time);
    const navOn = Boolean(systems.navLights);
    const beaconOn = Boolean(systems.beacon);
    const landingOn = Boolean(systems.landingLights);
    const phase = time % 1.5;
    const strobe = navOn && (phase < 0.06 || phase > 0.16 && phase < 0.22);
    for (const light of this.navLights) light.visible = navOn;
    for (const light of this.strobeLights) light.visible = strobe;
    for (const beacon of this.beacons) beacon.visible = beaconOn && time % 1.5 < 0.19;
    for (const light of this.landingLights) light.visible = landingOn;
    for (const light of this.logoLights) light.visible = navOn;
    this.materials.window.emissiveIntensity = this.nightFactor(state) * 0.85;
    if (this.landingLight) {
      const on = this.exteriorVisible && landingOn;
      this.landingLight.intensity = on ? 280 + this.nightFactor(state) * 760 : 0;
    }
  }

  nightFactor(state) {
    const value = state.environment?.timeOfDay ?? 'day';
    if (value === 'night') return 1;
    if (value === 'dusk' || value === 'dawn' || value === 'evening') return 0.55;
    if (typeof value === 'number') {
      if (value < 5.5 || value > 19.5) return 1;
      if (value < 7.5 || value > 17.5) return 0.55;
    }
    return 0;
  }

  setExteriorVisible(visible) {
    const next = visible !== false;
    this.exteriorVisible = next;
    this.exterior.visible = next;
    if (this.landingLight && !next) this.landingLight.intensity = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.landingLight) this.landingLight.intensity = 0;
    this.scene?.remove?.(this.root);
    if (this.resources) {
      for (const texture of this.resources.textures) texture.dispose();
      for (const material of this.resources.materials) material.dispose();
      for (const geometry of this.resources.geometries) geometry.dispose();
    }
    this.resources = null;
    this.root.clear();
  }
}

export default Aircraft;
