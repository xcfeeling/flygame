import * as THREE from 'three';
import { getAircraftType } from '../sim/aircraftTypes.js';

const KT_PER_MS = 1.94384449;
const FT_PER_M = 3.280839895;
const FPM_PER_MS = 196.8503937;
const RAD_TO_DEG = 180 / Math.PI;
const FALLBACK_FLAPS = [0, 1, 5, 10, 20, 25, 30];

const DISPLAY_INTERVALS = {
  pfd: 1 / 20,
  nd: 1 / 20,
  ecam: 1 / 10,
  systems: 1 / 5,
  standby: 1 / 4,
  mcp: 1 / 4
};

const RUNWAY = { threshold: -1800, length: 3600, width: 45 };

const COLORS = {
  sky: '#167ab8',
  ground: '#76512a',
  white: '#f7fbff',
  green: '#48f595',
  cyan: '#68e9ff',
  magenta: '#ff72dc',
  amber: '#ffc14d',
  red: '#ff5148',
  dim: '#a8bdc7',
  black: '#02070b'
};

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext('2d') };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeHeading(value) {
  return ((value % 360) + 360) % 360;
}

function padded(value, digits) {
  return String(Math.round(Math.abs(value))).padStart(digits, '0');
}

function activeFlag(value) {
  if (value && typeof value === 'object') {
    return Boolean(value.on ?? value.active ?? value.available ?? value.running ?? value.pressure);
  }
  return Boolean(value);
}

function enginePercent(value) {
  let result = Math.max(0, number(value));
  if (result > 2) result /= 100;
  return clamp(result, 0, 1.15);
}

function daylightFactor(environment) {
  const value = environment?.timeOfDay;
  if (typeof value === 'number') {
    if (value < 5.5 || value > 19.5) return 0.06;
    if (value < 7.5 || value > 17.5) return 0.45;
    return 1;
  }
  const phase = String(value ?? 'day').toLowerCase();
  if (phase.includes('night') || phase.includes('夜')) return 0.06;
  if (phase.includes('dusk') || phase.includes('dawn') || phase.includes('evening') || phase.includes('暮') || phase.includes('晨')) return 0.45;
  return 1;
}

function box(width, height, depth, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(radiusTop, radiusBottom, height, material, x = 0, y = 0, z = 0, segments = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r, x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

export class Cockpit {
  constructor(aircraftRoot, typeId = 'b747-400') {
    if (!aircraftRoot?.add) throw new Error('Cockpit requires an aircraft root Group.');
    this.aircraftRoot = aircraftRoot;
    this.typeId = getAircraftType(String(typeId).toLowerCase()).id;
    this.spec = getAircraftType(this.typeId);
    this.cockpitEye = new THREE.Vector3();
    this.cockpitTarget = new THREE.Vector3();
    this.group = new THREE.Group();
    this.group.name = 'b747-cockpit-interior';
    aircraftRoot.add(this.group);

    this.pickables = [];
    this.buttons = [];
    this.overheadButtons = [];
    this.controlYokes = [];
    this.yokes = this.controlYokes;
    this.rudderPedals = [];
    this.throttleLevers = [];
    this.reverseLevers = [];
    this.engineWarningLights = [];
    this.fuelFlowLights = [];
    this.gearIndicatorLights = [];
    this.ownedTextures = new Set();
    this.disposed = false;
    this.nightFactor = 0;
    this.displayPending = true;
    this.displayTimers = { pfd: 0, nd: 0, ecam: 0, systems: 0, standby: 0, mcp: 0 };

    this.setAircraftType(this.typeId);
    this.buildMaterials();
    this.buildLights();
    this.buildShell();
    this.buildInstrumentPanel();
    this.buildDisplays();
    this.buildOverheadPanel();
    this.buildPedestal();
    this.buildYokesAndPedals();
    this.applyLighting(1);
  }

  setAircraftType(typeId) {
    this.spec = getAircraftType(String(typeId).toLowerCase());
    this.typeId = this.spec.id;
    const eye = this.spec.cockpitEye;
    const target = this.spec.cockpitTarget;
    this.cockpitEye.set(number(eye?.x), number(eye?.y), number(eye?.z));
    this.cockpitTarget.set(number(target?.x), number(target?.y), number(target?.z));
    this.group.position.copy(this.cockpitEye);
    this.group.userData.aircraftType = this.typeId;
    this.aircraftRoot.cockpitEye = this.cockpitEye;
    this.aircraftRoot.cockpitTarget = this.cockpitTarget;
    this.aircraftRoot.userData.cockpitEye = this.cockpitEye;
    this.aircraftRoot.userData.cockpitTarget = this.cockpitTarget;
    this.displayPending = true;
  }

  makeTexture(canvas, anisotropy = 4) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    this.ownedTextures.add(texture);
    return texture;
  }

  buildMaterials() {
    const standard = (color, roughness = 0.75, metalness = 0.1) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials = {
      shell: standard(0x6b777c, 0.88, 0.06),
      shellLight: standard(0x8a969b, 0.84, 0.06),
      floor: standard(0x2c363b, 0.94, 0.03),
      panel: standard(0x3f4d4a, 0.78, 0.12),
      panelLight: standard(0x60706b, 0.76, 0.12),
      trim: standard(0x2a3236, 0.7, 0.2),
      glare: standard(0x2b3534, 0.92, 0.04),
      bezel: standard(0x080d10, 0.48, 0.32),
      metal: standard(0xaab4b7, 0.3, 0.78),
      metalDark: standard(0x59666a, 0.42, 0.62),
      rubber: standard(0x171c1e, 0.96, 0.02),
      handle: standard(0x2c3436, 0.72, 0.2),
      handleWhite: standard(0xe2e5df, 0.48, 0.08),
      redHandle: standard(0xc23d35, 0.48, 0.14),
      leather: standard(0x35434c, 0.9, 0.03),
      keyCap: standard(0xaab3b2, 0.62, 0.08),
      keyDark: standard(0x20292c, 0.6, 0.16),
      glass: new THREE.MeshBasicMaterial({
        color: 0xc4e2ec,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      }),
      guard: new THREE.MeshStandardMaterial({
        color: 0xe74d42,
        transparent: true,
        opacity: 0.38,
        roughness: 0.35,
        metalness: 0.1,
        depthWrite: false
      })
    };

    const basic = (color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
    this.indicatorMaterials = {
      off: basic(0x152022),
      dim: basic(0x31433e),
      on: basic(0x45f18b),
      working: basic(0xffb42e),
      warning: basic(0xff4d42),
      view: basic(0x54ccff)
    };

    const button = (color, emissive) => new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 0.25,
      roughness: 0.52,
      metalness: 0.24
    });
    this.buttonMaterials = {
      off: button(0x293336, 0x0b1719),
      on: button(0x327c59, 0x31db7e),
      working: button(0x8b6425, 0xffad30),
      warning: button(0x91342c, 0xff4d42),
      view: button(0x285f80, 0x4fc9ff)
    };
  }

  buildLights() {
    this.lights = {
      panel: new THREE.PointLight(0xffedcf, 0.75, 3.6, 2),
      pedestal: new THREE.PointLight(0xd8edff, 0.6, 3.2, 2),
      overhead: new THREE.PointLight(0xffe4b8, 0.5, 3.0, 2),
      dome: new THREE.PointLight(0xffd6a0, 0.28, 4.0, 2),
      cabin: new THREE.PointLight(0xc7d8e0, 1.15, 7.0, 2)
    };
    this.lights.panel.position.set(0.82, -0.3, 0.25);
    this.lights.pedestal.position.set(0.82, -0.95, -0.35);
    this.lights.overhead.position.set(0.82, 0.75, -0.55);
    this.lights.dome.position.set(0.82, 1.15, -1.35);
    this.lights.cabin.position.set(0.82, 0.55, 0.1);
    for (const light of Object.values(this.lights)) this.group.add(light);
  }

  registerAction(object, action, value) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.userData.action = action;
      if (value !== undefined) child.userData.value = value;
      this.pickables.push(child);
    });
  }

  createTextPlane(text, width, height, options = {}) {
    const canvasWidth = options.canvasWidth ?? 512;
    const canvasHeight = Math.max(64, Math.round(canvasWidth * height / width));
    const { canvas, context } = makeCanvas(canvasWidth, canvasHeight);
    context.fillStyle = options.background ?? '#10191b';
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    if (options.border !== false) {
      context.strokeStyle = options.borderColor ?? '#77908e';
      context.lineWidth = Math.max(2, canvasHeight * 0.035);
      context.strokeRect(2, 2, canvasWidth - 4, canvasHeight - 4);
    }
    context.fillStyle = options.color ?? '#f2f8f5';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const lines = String(text).split('\n');
    let fontSize = options.fontSize ?? Math.min(canvasHeight * 0.52, canvasWidth / Math.max(...lines.map((line) => line.length), 1) * 1.55);
    context.font = `700 ${fontSize}px Arial, sans-serif`;
    const maxWidth = canvasWidth * 0.92;
    while (fontSize > 10 && lines.some((line) => context.measureText(line).width > maxWidth)) {
      fontSize -= 1;
      context.font = `700 ${fontSize}px Arial, sans-serif`;
    }
    lines.forEach((line, index) => {
      const y = canvasHeight * (index + 1) / (lines.length + 1);
      context.fillText(line, canvasWidth / 2, y);
    });
    const material = new THREE.MeshBasicMaterial({
      map: this.makeTexture(canvas, 2),
      toneMapped: false,
      side: THREE.FrontSide
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  buildShell() {
    const m = this.materials;
    this.group.add(box(3.65, 0.16, 4.45, m.floor, 0.82, -2.2, 0.05));
    this.group.add(box(3.65, 0.15, 2.5, m.shell, 0.82, 1.52, -0.55));
    this.group.add(box(3.65, 3.6, 0.18, m.shell, 0.82, -0.35, -2.12));
    this.group.add(box(1.05, 2.45, 0.12, m.shellDark ?? m.trim, 0.82, -0.65, -2.01));
    this.group.add(box(0.92, 2.3, 0.07, m.panelLight, 0.82, -0.65, -1.94));
    this.group.add(box(0.18, 0.07, 0.08, m.metal, 1.12, -0.7, -1.89));

    for (const side of [-1, 1]) {
      const x = 0.82 + side * 1.79;
      this.group.add(box(0.14, 1.65, 4.1, m.shell, x, -1.36, 0));
      this.group.add(box(0.14, 0.36, 2.5, m.shell, x, 1.31, -0.55));
      this.group.add(box(0.14, 1.25, 0.38, m.shell, x, 0.47, -1.7));
      this.group.add(box(0.14, 1.25, 0.32, m.shell, x, 0.47, 1.72));
      const sideWindow = new THREE.Mesh(new THREE.PlaneGeometry(2.75, 1.08), m.glass);
      sideWindow.rotation.y = side * Math.PI / 2;
      sideWindow.position.set(x, 0.47, 0.05);
      sideWindow.castShadow = false;
      this.group.add(sideWindow);
      this.group.add(box(0.17, 0.08, 2.82, m.trim, x, -0.09, 0.05));
      this.group.add(box(0.17, 0.08, 2.82, m.trim, x, 1.03, 0.05));
      this.group.add(box(0.24, 0.12, 1.25, m.leather, x - side * 0.11, -0.45, -0.15));
    }

    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(3.35, 1.28), m.glass);
    windshield.position.set(0.82, 0.45, 2.38);
    windshield.castShadow = false;
    this.group.add(windshield);
    for (const x of [-0.82, 0.82, 2.46]) {
      const pillar = box(x === 0.82 ? 0.065 : 0.11, 1.42, 0.12, m.trim, x, 0.45, 2.34);
      if (x !== 0.82) pillar.rotation.z = x < 0.82 ? -0.1 : 0.1;
      this.group.add(pillar);
    }
    this.group.add(box(3.4, 0.1, 0.14, m.trim, 0.82, -0.21, 2.34));
    this.group.add(box(3.4, 0.12, 0.14, m.trim, 0.82, 1.11, 2.34));
    this.group.add(box(0.75, 0.05, 0.06, m.metalDark, 1.18, -0.13, 2.26));

    for (const x of [0, 1.64]) {
      this.group.add(box(0.66, 0.22, 0.72, m.leather, x, -1.75, -0.85));
      const back = box(0.68, 1.25, 0.22, m.leather, x, -1.0, -1.17);
      back.rotation.x = -0.09;
      this.group.add(back);
      this.group.add(box(0.48, 0.34, 0.2, m.leather, x, -0.25, -1.25));
      this.group.add(box(0.09, 0.65, 0.09, m.metalDark, x - 0.22, -1.93, -0.85));
      this.group.add(box(0.09, 0.65, 0.09, m.metalDark, x + 0.22, -1.93, -0.85));
    }
  }

  buildInstrumentPanel() {
    const m = this.materials;
    this.group.add(box(3.42, 1.58, 0.22, m.panel, 0.82, -0.94, 1.4));
    this.group.add(box(3.5, 0.1, 0.28, m.trim, 0.82, -1.75, 1.36));
    this.group.add(box(0.16, 1.58, 0.32, m.panelLight, -0.85, -0.94, 1.34));
    this.group.add(box(0.16, 1.58, 0.32, m.panelLight, 2.49, -0.94, 1.34));

    const glareshield = box(3.52, 0.1, 0.72, m.glare, 0.82, -0.1, 1.15);
    glareshield.rotation.x = -0.035;
    this.group.add(glareshield);
    this.group.add(box(3.5, 0.07, 0.12, m.trim, 0.82, -0.055, 0.81));
    for (const x of [-0.78, 2.42]) {
      const cheek = box(0.18, 0.32, 0.65, m.panel, x, -0.25, 1.14);
      cheek.rotation.x = -0.05;
      this.group.add(cheek);
    }

    this.buildMCP();

    this.gearLever = new THREE.Group();
    this.gearLever.position.set(2.25, -1.35, 1.14);
    this.gearLever.add(box(0.3, 0.42, 0.1, m.panelLight, 0, 0, 0.06));
    this.gearLever.add(box(0.055, 0.36, 0.055, m.metal, 0, 0.05, -0.04));
    this.gearLever.add(box(0.18, 0.16, 0.14, m.handle, 0, 0.25, -0.05));
    this.group.add(this.gearLever);
    this.gearLeverBaseY = this.gearLever.position.y;
    this.registerAction(this.gearLever, 'gear');

    for (let index = 0; index < 4; index += 1) {
      const light = box(0.09, 0.065, 0.025, this.indicatorMaterials.off, 1.52 + index * 0.13, -1.55, 1.25);
      light.castShadow = false;
      this.group.add(light);
      this.engineWarningLights.push(light);
    }
    const warningLabel = this.createTextPlane('ENG 1   2   3   4', 0.58, 0.09, { fontSize: 46 });
    warningLabel.rotation.y = Math.PI;
    warningLabel.position.set(1.715, -1.43, 1.24);
    this.group.add(warningLabel);

    for (let index = 0; index < 3; index += 1) {
      const light = box(0.09, 0.07, 0.025, this.indicatorMaterials.off, -0.55 + index * 0.13, -1.55, 1.25);
      light.castShadow = false;
      this.group.add(light);
      this.gearIndicatorLights.push(light);
    }
  }

  buildMCP() {
    const m = this.materials;
    const group = new THREE.Group();
    group.position.set(0.82, -0.22, 1.03);
    group.add(box(2.34, 0.28, 0.15, m.bezel, 0, 0, 0.04));
    const { canvas, context } = makeCanvas(1024, 128);
    this.mcpCanvas = canvas;
    this.mcpContext = context;
    this.mcpTexture = this.makeTexture(canvas, 2);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.92, 0.2),
      new THREE.MeshBasicMaterial({ map: this.mcpTexture, toneMapped: false, side: THREE.FrontSide })
    );
    screen.rotation.y = Math.PI;
    screen.position.z = -0.041;
    group.add(screen);
    for (const x of [-1.05, -0.72, -0.24, 0.24, 0.72, 1.05]) {
      const knob = cylinder(0.045, 0.052, 0.055, m.metalDark, x, 0, -0.065, 16);
      knob.rotation.x = Math.PI / 2;
      group.add(knob);
    }
    this.group.add(group);
    this.mcp = group;
  }

  createDisplay(width, height, x, y, z, canvasWidth = 512, canvasHeight = 512) {
    const { canvas, context } = makeCanvas(canvasWidth, canvasHeight);
    const texture = this.makeTexture(canvas, 4);
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.FrontSide });
    const screen = this.addScreen(width, height, x, y, z, material);
    return { canvas, context, texture, material, screen };
  }

  addScreen(width, height, x, y, z, material) {
    this.group.add(box(width + 0.09, height + 0.09, 0.09, this.materials.bezel, x, y, z + 0.045));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    screen.rotation.y = Math.PI;
    screen.position.set(x, y, z);
    screen.castShadow = false;
    screen.receiveShadow = false;
    this.group.add(screen);
    return screen;
  }

  createGauge(x, y, z) {
    const { canvas, context } = makeCanvas(256, 256);
    const texture = this.makeTexture(canvas, 4);
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.FrontSide });
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.018, 8, 28), this.materials.bezel);
    bezel.position.set(x, y, z + 0.012);
    this.group.add(bezel);
    const screen = new THREE.Mesh(new THREE.CircleGeometry(0.106, 32), material);
    screen.rotation.y = Math.PI;
    screen.position.set(x, y, z);
    this.group.add(screen);
    return { canvas, context, texture, material, screen };
  }

  buildDisplays() {
    this.pfd = this.createDisplay(0.54, 0.56, -0.36, -0.66, 1.25);
    this.nd = this.createDisplay(0.54, 0.56, 0.24, -0.66, 1.25);
    this.addScreen(0.54, 0.56, 1.4, -0.66, 1.25, this.nd.material);
    this.addScreen(0.54, 0.56, 2.0, -0.66, 1.25, this.pfd.material);
    this.ecam = this.createDisplay(0.62, 0.57, 0.82, -0.54, 1.25, 640, 640);
    this.systemsDisplay = this.createDisplay(0.62, 0.4, 0.82, -1.09, 1.25, 640, 400);
    this.standby = this.createGauge(0.6, -1.53, 1.24);
    this.standbySpeed = this.createGauge(0.82, -1.53, 1.24);
    this.standbyAltitude = this.createGauge(1.04, -1.53, 1.24);
  }

  createOverheadSection({ title, x, z, buttons, columns = 4, guarded = [] }) {
    const width = 1.56;
    const depth = 0.78;
    const baseY = 1.3;
    this.group.add(box(width, 0.1, depth, this.materials.panel, x, baseY, z));
    this.group.add(box(width + 0.04, 0.04, 0.045, this.materials.metalDark, x, baseY - 0.055, z + depth / 2));
    const { canvas, context } = makeCanvas(768, 384);
    context.fillStyle = '#24322f';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#101b1c';
    context.fillRect(0, 0, canvas.width, 58);
    context.strokeStyle = '#91aaa1';
    context.lineWidth = 5;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    context.fillStyle = '#f3f8e9';
    context.font = '700 31px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(title, canvas.width / 2, 30);

    const rows = Math.max(1, Math.ceil(buttons.length / columns));
    const cellWidth = canvas.width / columns;
    const cellHeight = (canvas.height - 58) / rows;
    buttons.forEach((entry, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cx = column * cellWidth + cellWidth / 2;
      const cy = 58 + row * cellHeight;
      context.strokeStyle = '#435b54';
      context.lineWidth = 2;
      context.strokeRect(column * cellWidth + 4, cy + 3, cellWidth - 8, cellHeight - 6);
      context.fillStyle = '#f4f7ed';
      context.font = `700 ${entry.label.length > 10 ? 23 : 27}px Arial, sans-serif`;
      context.fillText(entry.label, cx, cy + cellHeight * 0.79);
      const u = cx / canvas.width;
      const v = (cy + cellHeight * 0.34) / canvas.height;
      const control = this.createOverheadControl(
        entry.action,
        x + (u - 0.5) * width,
        z + (0.5 - v) * depth,
        entry.kind,
        entry.guard || guarded.includes(entry.action)
      );
      this.group.add(control);
      this.overheadButtons.push(control);
    });

    const texture = this.makeTexture(canvas, 4);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.025, depth - 0.025),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.FrontSide })
    );
    plate.rotation.x = Math.PI / 2;
    plate.position.set(x, baseY - 0.052, z);
    plate.castShadow = false;
    this.group.add(plate);
    return plate;
  }

  createOverheadControl(action, x, z, kind = 'toggle', guard = false) {
    const group = new THREE.Group();
    group.position.set(x, 1.19, z);
    group.add(box(0.19, 0.025, 0.16, this.materials.trim, 0, 0.035, 0));
    let cap;
    if (kind === 'rotary') {
      cap = cylinder(0.067, 0.073, 0.09, this.buttonMaterials.off, 0, -0.015, 0, 20);
      cap.add(box(0.018, 0.012, 0.09, this.materials.handleWhite, 0, -0.051, -0.018));
    } else {
      cap = box(0.07, 0.13, 0.07, this.buttonMaterials.off, 0, -0.025, 0);
      cap.rotation.x = -0.15;
    }
    group.add(cap);
    const indicator = box(0.11, 0.018, 0.035, this.indicatorMaterials.off, 0, -0.055, 0.105);
    indicator.castShadow = false;
    group.add(indicator);
    if (guard) {
      group.add(box(0.018, 0.12, 0.18, this.materials.redHandle, -0.105, 0, 0));
      group.add(box(0.018, 0.12, 0.18, this.materials.redHandle, 0.105, 0, 0));
      const cover = box(0.21, 0.025, 0.17, this.materials.guard, 0, 0.09, 0.065);
      cover.rotation.x = -0.75;
      group.add(cover);
    }
    this.registerAction(group, action);
    this.buttons.push({ action, cap, indicator, group, baseY: group.position.y });
    return group;
  }

  buildOverheadPanel() {
    this.createOverheadSection({
      title: 'ELECTRICAL / APU', x: -0.03, z: 0.45,
      buttons: [
        { action: 'battery', label: 'BAT', guard: true },
        { action: 'externalPower', label: 'EXT PWR' },
        { action: 'avionics', label: 'AVIONICS' },
        { action: 'apu', label: 'APU', guard: true },
        { action: 'generator1', label: 'GEN 1' },
        { action: 'generator2', label: 'GEN 2' },
        { action: 'generator3', label: 'GEN 3' },
        { action: 'generator4', label: 'GEN 4' }
      ]
    });
    this.buildFuelOverheadSection(1.67, 0.45);
    this.createOverheadSection({
      title: 'BLEED AIR / ANTI-ICE', x: -0.03, z: -0.43,
      buttons: [
        { action: 'apuBleed', label: 'APU BLEED' },
        { action: 'bleedAir', label: 'ENG BLEED' },
        { action: 'packOff', label: 'PACK OFF' },
        { action: 'probeHeat', label: 'PROBE HEAT' },
        { action: 'antiIce1', label: 'NACELLE 1' },
        { action: 'antiIce2', label: 'NACELLE 2' },
        { action: 'antiIce3', label: 'NACELLE 3' },
        { action: 'antiIce4', label: 'NACELLE 4' }
      ]
    });
    this.createOverheadSection({
      title: 'HYDRAULICS', x: 1.67, z: -0.43,
      buttons: [
        { action: 'electricPump1', label: 'ELEC PUMP 1' },
        { action: 'electricPump2', label: 'ELEC PUMP 2' },
        { action: 'electricPump3', label: 'ELEC PUMP 3' },
        { action: 'electricPump4', label: 'ELEC PUMP 4' }
      ]
    });
    this.createOverheadSection({
      title: 'ENGINE START', x: -0.03, z: -1.31,
      buttons: [
        { action: 'startEngine1', label: 'START 1', kind: 'rotary', guard: true },
        { action: 'startEngine2', label: 'START 2', kind: 'rotary', guard: true },
        { action: 'startEngine3', label: 'START 3', kind: 'rotary', guard: true },
        { action: 'startEngine4', label: 'START 4', kind: 'rotary', guard: true }
      ]
    });
    this.createOverheadSection({
      title: 'EXTERIOR LIGHTS / VIEW', x: 1.67, z: -1.31,
      buttons: [
        { action: 'landingLights', label: 'LANDING' },
        { action: 'navLights', label: 'NAV' },
        { action: 'beacon', label: 'BEACON' },
        { action: 'view', label: 'VIEW' }
      ]
    });
  }

  buildFuelOverheadSection(x, z) {
    const width = 1.56;
    const depth = 0.78;
    this.group.add(box(width, 0.1, depth, this.materials.panel, x, 1.3, z));
    const { canvas, context } = makeCanvas(768, 384);
    context.fillStyle = '#24322f';
    context.fillRect(0, 0, 768, 384);
    context.fillStyle = '#101b1c';
    context.fillRect(0, 0, 768, 58);
    context.strokeStyle = '#91aaa1';
    context.lineWidth = 5;
    context.strokeRect(3, 3, 762, 378);
    context.fillStyle = '#f3f8e9';
    context.font = '700 31px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('FUEL', 384, 30);
    context.font = '700 28px Arial';
    context.fillText('MAIN PUMPS     1       2       3       4', 384, 112);
    context.fillText('CROSSFEED  1 / 2 / 3 / 4     FUEL JETT', 384, 310);
    context.strokeStyle = '#5f7d70';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(90, 240);
    context.lineTo(678, 240);
    context.stroke();
    const texture = this.makeTexture(canvas, 4);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.025, depth - 0.025),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.FrontSide })
    );
    plate.rotation.x = Math.PI / 2;
    plate.position.set(x, 1.248, z);
    this.group.add(plate);
    for (let index = 0; index < 4; index += 1) {
      const light = box(0.12, 0.025, 0.07, this.indicatorMaterials.dim, x - 0.45 + index * 0.3, 1.2, z - 0.05);
      light.castShadow = false;
      this.group.add(light);
      this.fuelFlowLights.push(light);
    }
  }

  buildPedestal() {
    const m = this.materials;
    this.group.add(box(0.86, 0.58, 2.6, m.panel, 0.82, -1.75, -0.08));
    this.group.add(box(0.9, 0.08, 2.64, m.trim, 0.82, -1.43, -0.08));
    this.group.add(box(0.82, 0.06, 2.52, m.panelLight, 0.82, -1.38, -0.08));
    this.buildThrustQuadrant();
    this.buildCDU();

    this.flapLever = this.createGateLever(1.2, -1.34, 0.05, 'flaps', m.handleWhite, 0.42);
    this.spoilerLever = this.createGateLever(0.44, -1.34, 0.05, 'spoilers', m.handle, 0.38);
    this.parkingLever = this.createGateLever(0.47, -1.34, -1.02, 'parkingBrake', m.redHandle, 0.28);

    const flaps = this.createTextPlane('FLAPS\n0 1 5 10 20 25 30', 0.42, 0.18, { background: '#111b1c', color: '#f6f4df' });
    flaps.rotation.set(-Math.PI / 2, 0, Math.PI);
    flaps.position.set(1.02, -1.337, -0.23);
    this.group.add(flaps);
    const parking = this.createTextPlane('PARK BRAKE', 0.35, 0.1, { background: '#311514', color: '#ffe7df' });
    parking.rotation.set(-Math.PI / 2, 0, Math.PI);
    parking.position.set(0.72, -1.337, -1.02);
    this.group.add(parking);
  }

  buildThrustQuadrant() {
    const m = this.materials;
    const quadrant = new THREE.Group();
    quadrant.position.set(0.82, -1.34, 0.65);
    quadrant.add(box(0.78, 0.16, 0.78, m.panelLight, 0, -0.03, 0));
    quadrant.add(box(0.8, 0.045, 0.8, m.trim, 0, 0.065, 0));
    for (let index = 0; index < 4; index += 1) {
      const x = -0.225 + index * 0.15;
      const lever = new THREE.Group();
      lever.position.set(x, 0.08, 0.02);
      lever.add(box(0.045, 0.43, 0.055, m.metal, 0, 0.215, 0));
      lever.add(box(0.115, 0.115, 0.18, m.handleWhite, 0, 0.46, 0.025));
      lever.add(box(0.118, 0.035, 0.182, m.handle, 0, 0.51, 0.025));
      quadrant.add(lever);
      this.throttleLevers.push(lever);
      lever.userData.baseZ = lever.position.z;

      const reverse = new THREE.Group();
      reverse.position.set(x, 0.19, -0.15);
      reverse.add(box(0.035, 0.2, 0.04, m.metalDark, 0, 0.1, 0));
      reverse.add(box(0.09, 0.075, 0.09, m.redHandle, 0, 0.2, 0));
      quadrant.add(reverse);
      this.reverseLevers.push(reverse);
      this.registerAction(reverse, 'reverse');
    }
    const label = this.createTextPlane('ENG  1     2     3     4\nTOGA / CLB / IDLE / REV', 0.68, 0.18, { background: '#15201f', color: '#f4f6e8' });
    label.rotation.set(-Math.PI / 2, 0, Math.PI);
    label.position.set(0, 0.092, 0.29);
    quadrant.add(label);
    this.group.add(quadrant);
    this.thrustQuadrant = quadrant;
  }

  createGateLever(x, y, z, action, material, height) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.add(box(0.18, 0.035, 0.48, this.materials.trim, 0, 0, 0));
    for (const offset of [-0.18, -0.09, 0, 0.09, 0.18]) {
      group.add(box(0.12, 0.018, 0.018, this.materials.metalDark, 0, 0.025, offset));
    }
    group.add(box(0.05, height, 0.055, this.materials.metal, 0, height / 2, 0));
    group.add(box(0.11, 0.1, 0.15, material, 0, height + 0.025, 0));
    this.group.add(group);
    this.registerAction(group, action);
    return group;
  }

  buildCDU() {
    const m = this.materials;
    const cdu = new THREE.Group();
    cdu.position.set(0.82, -1.32, -0.55);
    cdu.add(box(0.64, 0.11, 0.65, m.bezel, 0, 0, 0));
    const { canvas, context } = makeCanvas(512, 256);
    context.fillStyle = '#03110c';
    context.fillRect(0, 0, 512, 256);
    context.strokeStyle = '#54df9b';
    context.lineWidth = 5;
    context.strokeRect(4, 4, 504, 248);
    context.fillStyle = '#77ffbc';
    context.font = '700 30px Consolas, monospace';
    context.textAlign = 'left';
    context.fillText(`FMC  ${this.spec.shortName}`, 22, 44);
    context.font = '700 25px Consolas, monospace';
    context.fillText('PERF INIT  >', 22, 91);
    context.fillText('RTE 1      >', 22, 132);
    context.fillText('DEP/ARR    >', 22, 173);
    context.fillStyle = '#ffd46a';
    context.fillText('FOUR ENGINE PROFILE', 22, 222);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.25),
      new THREE.MeshBasicMaterial({ map: this.makeTexture(canvas, 4), toneMapped: false })
    );
    screen.rotation.set(-Math.PI / 2, 0, Math.PI);
    screen.position.set(0, 0.061, 0.14);
    cdu.add(screen);
    const geometry = new THREE.BoxGeometry(0.058, 0.025, 0.045);
    const keys = new THREE.InstancedMesh(geometry, m.keyCap, 30);
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 30; index += 1) {
      const column = index % 6;
      const row = Math.floor(index / 6);
      matrix.makeTranslation(-0.21 + column * 0.084, 0.067, -0.07 - row * 0.052);
      keys.setMatrixAt(index, matrix);
    }
    keys.instanceMatrix.needsUpdate = true;
    cdu.add(keys);
    this.group.add(cdu);
    this.cdu = cdu;
  }

  buildYokesAndPedals() {
    for (const x of [0, 1.64]) this.createControlYoke(x);
    for (const seatX of [0, 1.64]) {
      for (const side of [-1, 1]) {
        const pedal = new THREE.Group();
        pedal.position.set(seatX + side * 0.18, -1.88, 1.12);
        const plate = box(0.27, 0.065, 0.36, this.materials.metal, 0, 0, 0);
        plate.rotation.x = -0.48;
        pedal.add(plate);
        const toe = box(0.25, 0.15, 0.055, this.materials.metalDark, 0, 0.14, 0.16);
        toe.rotation.x = -0.48;
        pedal.add(toe);
        pedal.add(box(0.2, 0.045, 0.18, this.materials.rubber, 0, -0.14, -0.05));
        this.group.add(pedal);
        this.rudderPedals.push({ group: pedal, baseZ: pedal.position.z, side });
      }
    }
  }

  createControlYoke(x) {
    const m = this.materials;
    const group = new THREE.Group();
    group.position.set(x, -1.48, 0.67);
    group.add(cylinder(0.11, 0.15, 0.15, m.rubber, 0, 0.075, 0, 20));
    group.add(cylinder(0.045, 0.06, 0.62, m.metalDark, 0, 0.39, 0, 16));
    const wheel = new THREE.Group();
    wheel.position.set(0, 0.72, 0);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.29, 0.18, 0),
      new THREE.Vector3(-0.32, 0.01, 0),
      new THREE.Vector3(-0.25, -0.16, 0),
      new THREE.Vector3(-0.1, -0.2, 0),
      new THREE.Vector3(0, -0.1, 0),
      new THREE.Vector3(0.1, -0.2, 0),
      new THREE.Vector3(0.25, -0.16, 0),
      new THREE.Vector3(0.32, 0.01, 0),
      new THREE.Vector3(0.29, 0.18, 0)
    ]);
    wheel.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.035, 8, false), m.rubber));
    wheel.add(box(0.5, 0.055, 0.065, m.rubber, 0, 0.025, 0));
    const hub = cylinder(0.095, 0.095, 0.09, m.handle, 0, 0, 0, 20);
    hub.rotation.x = Math.PI / 2;
    wheel.add(hub);
    wheel.add(box(0.11, 0.045, 0.04, m.handleWhite, 0, 0.0, -0.065));
    wheel.add(box(0.055, 0.04, 0.035, m.redHandle, -0.2, 0.07, -0.04));
    group.add(wheel);
    this.group.add(group);
    this.controlYokes.push({ group, wheel, baseZ: group.position.z });
  }

  buttonState(action, state) {
    const systems = state?.systems ?? {};
    const engines = state?.engines ?? [];
    const controls = state?.controls ?? {};
    const indexed = /^(electricPump|startEngine|generator|antiIce)([1-4])$/.exec(action);
    if (indexed) {
      const index = Number(indexed[2]) - 1;
      if (indexed[1] === 'electricPump') return activeFlag(systems.electricPumps?.[index]);
      if (indexed[1] === 'generator') return activeFlag(systems.generators?.[index]);
      if (indexed[1] === 'antiIce') return Boolean(engines[index]?.antiIce);
      return engines[index]?.running ? true : engines[index]?.starter ? 'working' : false;
    }
    switch (action) {
      case 'battery': return Boolean(systems.battery);
      case 'externalPower': return Boolean(systems.externalPower);
      case 'avionics': return Boolean(systems.avionics);
      case 'apu': return systems.apu?.available ? true : systems.apu?.switch ? 'working' : false;
      case 'apuBleed': return Boolean(systems.apu?.bleed);
      case 'bleedAir': return Boolean(systems.bleedAir);
      case 'packOff': return systems.packOff ? 'working' : false;
      case 'flaps': return number(state?.flaps?.target ?? controls.flapTarget) > 0;
      case 'gear': return state?.gear?.moving ? 'working' : number(state?.gear?.position) > 0.99;
      case 'parkingBrake': return controls.parkingBrake ? 'warning' : false;
      case 'spoilers': return controls.spoilers !== 'stowed' || number(systems.speedBrake) > 0.05 ? 'working' : false;
      case 'reverse': return Boolean(controls.reverse) || engines.some((engine) => number(engine?.reverser) > 0.05);
      case 'landingLights': return Boolean(systems.landingLights);
      case 'navLights': return Boolean(systems.navLights);
      case 'beacon': return Boolean(systems.beacon);
      case 'probeHeat': return Boolean(systems.probeHeat);
      case 'view': return 'view';
      default: return false;
    }
  }

  updateButtons(state) {
    const materials = this.buttonMaterials;
    const led = this.indicatorMaterials;
    const backlight = 0.35 + this.nightFactor * 0.85;
    materials.off.emissiveIntensity = backlight * 0.32;
    materials.on.emissiveIntensity = backlight * 1.5;
    materials.working.emissiveIntensity = backlight * 1.65;
    materials.warning.emissiveIntensity = backlight * 1.7;
    materials.view.emissiveIntensity = backlight * 1.25;

    for (const button of this.buttons) {
      const status = this.buttonState(button.action, state);
      let cap = materials.off;
      let indicator = this.nightFactor > 0.4 ? led.dim : led.off;
      let pressed = false;
      if (status === true) {
        cap = materials.on;
        indicator = led.on;
        pressed = true;
      } else if (status === 'working') {
        cap = materials.working;
        indicator = led.working;
        pressed = true;
      } else if (status === 'warning') {
        cap = materials.warning;
        indicator = led.warning;
        pressed = true;
      } else if (status === 'view') {
        cap = materials.view;
        indicator = led.view;
      }
      if (button.cap.material !== cap) button.cap.material = cap;
      if (button.indicator.material !== indicator) button.indicator.material = indicator;
      button.group.position.y = button.baseY + (pressed ? 0.012 : 0);
    }

    const gearDown = number(state?.gear?.position) > 0.99 && !state?.gear?.moving;
    const gearUp = number(state?.gear?.position) < 0.02 && !state?.gear?.moving;
    for (const light of this.gearIndicatorLights) {
      light.material = gearDown ? led.on : gearUp ? led.off : led.working;
    }
    const engines = state?.engines ?? [];
    this.engineWarningLights.forEach((light, index) => {
      const engine = engines[index];
      light.material = engine?.fire ? led.warning : engine?.failed ? led.working : engine?.running ? led.on : led.off;
    });
    this.fuelFlowLights.forEach((light, index) => {
      light.material = number(state?.fuel?.qty) <= 0 ? led.warning : engines[index]?.running ? led.on : led.dim;
    });
  }

  applyLighting(lightLevel) {
    const day = clamp(lightLevel, 0, 1);
    const night = 1 - day;
    this.nightFactor = night;
    this.lights.panel.intensity = 0.22 + night * 1.55;
    this.lights.pedestal.intensity = 0.18 + night * 1.15;
    this.lights.overhead.intensity = 0.15 + night * 0.9;
    this.lights.dome.intensity = 0.05 + night * 0.32;
    const emissive = (material, color, intensity) => {
      material.emissive.setHex(color);
      material.emissiveIntensity = intensity;
    };
    emissive(this.materials.panel, night > 0.4 ? 0x0d201d : 0x07100f, 0.05 + night * 0.35);
    emissive(this.materials.panelLight, night > 0.4 ? 0x142822 : 0x09110f, 0.04 + night * 0.28);
    emissive(this.materials.trim, 0x071211, 0.03 + night * 0.22);
    emissive(this.materials.keyCap, 0x18211f, 0.04 + night * 0.24);
  }

  engineThrottleAmount(engine, state) {
    const controls = state.controls ?? {};
    const reverser = clamp(number(engine?.reverser), 0, 1);
    if (engine && Number.isFinite(Number(engine.thrust)) && this.spec.maxThrust > 0) {
      return clamp(Math.abs(Number(engine.thrust)) / this.spec.maxThrust, 0, 1);
    }
    const explicit = engine?.throttle ?? engine?.lever ?? engine?.thrustCommand;
    if (explicit !== undefined) return clamp(number(explicit), 0, 1);
    const n1 = enginePercent(engine?.n1);
    if (engine?.running || n1 > 0.01) return clamp((n1 - 0.18) / 0.9 + reverser * 0.12, 0, 1);
    return clamp(number(controls.throttle), 0, 1) * 0.04;
  }

  nearestFlapIndex(value) {
    const settings = this.spec.flapSettings ?? FALLBACK_FLAPS;
    let best = 0;
    for (let index = 1; index < settings.length; index += 1) {
      if (Math.abs(settings[index] - value) < Math.abs(settings[best] - value)) best = index;
    }
    return best;
  }

  update(state, dt = 0) {
    if (!state || this.disposed) return;
    const requestedType = state.aircraft?.type;
    if (requestedType && requestedType !== this.typeId) this.setAircraftType(requestedType);
    const step = clamp(number(dt), 0, 0.25);
    const controls = state.controls ?? {};
    const input = state.input ?? controls;
    const engines = Array.isArray(state.engines) ? state.engines : [];
    this.applyLighting(daylightFactor(state.environment));

    const pitch = clamp(number(input.pitch ?? controls.pitch), -1, 1);
    const roll = clamp(number(input.roll ?? controls.roll), -1, 1);
    for (const yoke of this.controlYokes) {
      yoke.group.position.z = yoke.baseZ - pitch * 0.15;
      yoke.group.rotation.x = pitch * 0.1;
      yoke.wheel.rotation.z = -roll * 0.92;
    }

    const yaw = clamp(number(input.yaw ?? controls.yaw), -1, 1);
    for (const pedal of this.rudderPedals) {
      pedal.group.position.z = pedal.baseZ + yaw * pedal.side * 0.15;
      pedal.group.rotation.x = -yaw * pedal.side * 0.08;
      pedal.group.rotation.y = yaw * 0.08;
    }

    for (let index = 0; index < this.throttleLevers.length; index += 1) {
      const engine = engines[index] ?? {};
      const amount = this.engineThrottleAmount(engine, state);
      const reverse = clamp(number(engine.reverser ?? (controls.reverse ? 1 : 0)), 0, 1);
      const lever = this.throttleLevers[index];
      lever.rotation.x = -0.28 + amount * 0.74 - reverse * 0.16;
      lever.position.z = lever.userData.baseZ + amount * 0.055;
      this.reverseLevers[index].rotation.x = -reverse * 1.08;
    }

    const flapSettings = this.spec.flapSettings ?? FALLBACK_FLAPS;
    const flapTarget = number(state.flaps?.target ?? controls.flapTarget ?? controls.flaps);
    const flapIndex = this.nearestFlapIndex(flapTarget);
    this.flapLever.rotation.x = -0.35 + flapIndex / Math.max(1, flapSettings.length - 1) * 0.82;
    const spoilers = controls.spoilers !== 'stowed'
      ? 1
      : clamp(number(state.systems?.speedBrake), 0, 1);
    this.spoilerLever.rotation.x = -0.22 + spoilers * 0.7;
    this.parkingLever.rotation.x = controls.parkingBrake ? -0.65 : 0.18;
    const gearDown = clamp(number(state.gear?.target ?? (controls.gear === 'up' ? 0 : 1), 1), 0, 1);
    this.gearLever.position.y = this.gearLeverBaseY + gearDown * 0.15;
    this.gearLever.rotation.x = (1 - gearDown) * -0.5;

    this.updateButtons(state);
    if (this.displayPending) {
      this.displayPending = false;
      this.drawAllDisplays(state);
      return;
    }
    if (this.tickDisplay('pfd', step)) this.refreshDisplay(this.pfd, () => this.drawPFD(state));
    if (this.tickDisplay('nd', step)) this.refreshDisplay(this.nd, () => this.drawND(state));
    if (this.tickDisplay('ecam', step)) this.refreshDisplay(this.ecam, () => this.drawECAM(state));
    if (this.tickDisplay('systems', step)) this.refreshDisplay(this.systemsDisplay, () => this.drawSystems(state));
    if (this.tickDisplay('standby', step)) {
      this.drawStandby(state);
      this.standby.texture.needsUpdate = true;
      this.standbySpeed.texture.needsUpdate = true;
      this.standbyAltitude.texture.needsUpdate = true;
    }
    if (this.tickDisplay('mcp', step)) {
      this.drawMCP(state);
      this.mcpTexture.needsUpdate = true;
    }
  }

  tickDisplay(key, step) {
    const interval = DISPLAY_INTERVALS[key];
    this.displayTimers[key] += step;
    if (this.displayTimers[key] < interval) return false;
    this.displayTimers[key] %= interval;
    return true;
  }

  refreshDisplay(display, draw) {
    draw();
    display.texture.needsUpdate = true;
  }

  drawAllDisplays(state) {
    this.drawPFD(state);
    this.drawND(state);
    this.drawECAM(state);
    this.drawSystems(state);
    this.drawStandby(state);
    this.drawMCP(state);
    this.pfd.texture.needsUpdate = true;
    this.nd.texture.needsUpdate = true;
    this.ecam.texture.needsUpdate = true;
    this.systemsDisplay.texture.needsUpdate = true;
    this.standby.texture.needsUpdate = true;
    this.standbySpeed.texture.needsUpdate = true;
    this.standbyAltitude.texture.needsUpdate = true;
    this.mcpTexture.needsUpdate = true;
    for (const key of Object.keys(this.displayTimers)) this.displayTimers[key] = 0;
    this.displayTimers.nd = DISPLAY_INTERVALS.nd * 0.45;
    this.displayTimers.ecam = DISPLAY_INTERVALS.ecam * 0.55;
    this.displayTimers.systems = DISPLAY_INTERVALS.systems * 0.25;
    this.displayTimers.standby = DISPLAY_INTERVALS.standby * 0.65;
  }

  drawBackdrop(context, width, height) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#02080d';
    context.fillRect(0, 0, width, height);
  }

  drawFrame(context, width, height) {
    context.strokeStyle = '#000000';
    context.lineWidth = 12;
    context.strokeRect(6, 6, width - 12, height - 12);
    context.strokeStyle = '#536a76';
    context.lineWidth = 2;
    context.strokeRect(13, 13, width - 26, height - 26);
  }

  drawPlate(context, x, y, width, height, text, options = {}) {
    context.fillStyle = options.background ?? '#01070b';
    context.fillRect(x, y, width, height);
    context.strokeStyle = options.border ?? '#e9f3f7';
    context.lineWidth = options.borderWidth ?? 2;
    context.strokeRect(x + 1, y + 1, width - 2, height - 2);
    context.fillStyle = options.color ?? COLORS.white;
    context.font = options.font ?? '700 24px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, x + width / 2, y + height / 2 + 1);
  }

  drawPFD(state) {
    const context = this.pfd.context;
    const width = this.pfd.canvas.width;
    const height = this.pfd.canvas.height;
    const speed = Math.max(0, number(state.airspeed) * KT_PER_MS);
    const altitude = number(state.altitude) * FT_PER_M;
    const verticalSpeed = number(state.verticalSpeed) * FPM_PER_MS;
    const pitch = clamp(number(state.pitch) * RAD_TO_DEG, -80, 80);
    const roll = clamp(number(state.roll) * RAD_TO_DEG, -180, 180);
    const heading = normalizeHeading(number(state.heading) * RAD_TO_DEG);
    const cx = 256;
    const cy = 224;
    const left = 112;
    const right = 400;
    const top = 48;
    const bottom = 388;
    const pitchScale = 4.6;
    this.drawBackdrop(context, width, height);

    context.save();
    context.beginPath();
    context.rect(left, top, right - left, bottom - top);
    context.clip();
    context.save();
    context.translate(cx, cy + pitch * pitchScale);
    context.rotate(-roll * Math.PI / 180);
    context.fillStyle = state.stallWarning ? '#8a743b' : COLORS.sky;
    context.fillRect(-1200, -1000, 2400, 1000);
    context.fillStyle = COLORS.ground;
    context.fillRect(-1200, 0, 2400, 1000);
    context.strokeStyle = COLORS.white;
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(-1200, 0);
    context.lineTo(1200, 0);
    context.stroke();
    context.font = '700 18px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let degrees = -70; degrees <= 70; degrees += 5) {
      if (!degrees) continue;
      const y = -degrees * pitchScale;
      const major = degrees % 10 === 0;
      const half = major ? 62 : 35;
      context.lineWidth = major ? 3 : 2;
      context.beginPath();
      context.moveTo(-half, y);
      context.lineTo(half, y);
      context.stroke();
      if (major) {
        context.fillStyle = COLORS.white;
        context.fillText(String(Math.abs(degrees)), -half - 21, y);
        context.fillText(String(Math.abs(degrees)), half + 21, y);
      }
    }
    context.restore();

    context.strokeStyle = '#f2f7fa';
    context.fillStyle = '#ffd84e';
    context.lineWidth = 3;
    const radius = 148;
    for (const angle of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const radians = angle * Math.PI / 180;
      context.beginPath();
      context.moveTo(cx + Math.sin(radians) * radius, cy - Math.cos(radians) * radius);
      context.lineTo(cx + Math.sin(radians) * (radius - 10), cy - Math.cos(radians) * (radius - 10));
      context.stroke();
    }
    context.save();
    context.translate(cx, cy);
    context.rotate(-roll * Math.PI / 180);
    context.beginPath();
    context.moveTo(0, -radius + 2);
    context.lineTo(-9, -radius + 17);
    context.lineTo(9, -radius + 17);
    context.closePath();
    context.fill();
    context.restore();

    context.strokeStyle = '#ffe25c';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(cx - 94, cy);
    context.lineTo(cx - 28, cy);
    context.lineTo(cx - 16, cy + 12);
    context.lineTo(cx + 16, cy + 12);
    context.lineTo(cx + 28, cy);
    context.lineTo(cx + 94, cy);
    context.stroke();
    context.fillStyle = '#ffe25c';
    context.fillRect(cx - 3, cy - 3, 6, 6);
    const slipX = cx + clamp(number(state.beta) * RAD_TO_DEG * 4, -28, 28);
    context.beginPath();
    context.moveTo(slipX - 9, cy + 22);
    context.lineTo(slipX + 9, cy + 22);
    context.lineTo(slipX, cy + 34);
    context.closePath();
    context.fill();
    context.restore();

    this.drawSpeedTape(context, speed, top, bottom, state);
    this.drawAltitudeTape(context, altitude, verticalSpeed, top, bottom);
    this.drawHeadingTape(context, heading, 394, 58);
    this.drawFMA(context, state);

    const flap = Math.round(number(state.flaps?.target ?? state.controls?.flapTarget));
    const vApp = flap >= 30 ? this.spec.vApp30 : this.spec.vApp25;
    context.font = '700 18px Consolas, monospace';
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = COLORS.green;
    context.fillText(`VR ${Math.round(this.spec.vr)}`, 20, 474);
    context.fillStyle = COLORS.magenta;
    context.fillText(`VAPP ${Math.round(vApp)}`, 116, 474);
    context.textAlign = 'center';
    context.fillStyle = COLORS.white;
    context.fillText(`FLAP ${flap}`, 305, 474);
    context.textAlign = 'right';
    context.fillStyle = COLORS.cyan;
    context.fillText(this.spec.shortName, 492, 474);
    if (state.stallWarning || state.overspeed) {
      this.drawPlate(context, 164, 332, 184, 40, state.stallWarning ? 'STALL' : 'OVERSPEED', {
        background: '#8e120d', color: '#ffffff', font: '700 27px Arial'
      });
    }
    this.drawFrame(context, width, height);
  }

  drawFMA(context, state) {
    const engines = Array.isArray(state.engines) ? state.engines : [];
    const running = engines.filter((engine) => engine?.running).length;
    const armed = Boolean(state.systems?.avionics);
    context.fillStyle = '#01070b';
    context.fillRect(18, 14, 476, 30);
    context.strokeStyle = '#3f5964';
    context.lineWidth = 2;
    context.strokeRect(19, 15, 474, 28);
    context.font = '700 20px Consolas, monospace';
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = running ? COLORS.green : COLORS.amber;
    context.fillText(`THR ${running}/${engines.length || this.spec.engineCount}`, 28, 30);
    context.textAlign = 'center';
    context.fillStyle = armed ? COLORS.green : COLORS.amber;
    context.fillText(armed ? 'AP CMD  LNAV VNAV' : 'AP OFF  FD OFF', 285, 30);
    context.textAlign = 'right';
    context.fillStyle = COLORS.white;
    context.fillText(state.onGround ? 'TO/GA' : 'HOLD', 484, 30);
  }

  drawSpeedTape(context, speed, top, bottom, state) {
    const x = 14;
    const width = 94;
    const centerY = (top + bottom) / 2;
    const scale = 5;
    context.fillStyle = '#02090e';
    context.fillRect(x, top, width, bottom - top);
    context.strokeStyle = '#4b626d';
    context.lineWidth = 2;
    context.strokeRect(x + 1, top + 1, width - 2, bottom - top - 2);
    context.font = '17px Consolas, monospace';
    context.textBaseline = 'middle';
    const first = Math.floor((speed - 38) / 5) * 5;
    for (let value = first; value <= speed + 38; value += 5) {
      if (value < 0) continue;
      const y = centerY + (speed - value) * scale;
      if (y < top + 10 || y > bottom - 10) continue;
      const major = value % 10 === 0;
      context.strokeStyle = COLORS.white;
      context.lineWidth = major ? 2 : 1;
      context.beginPath();
      context.moveTo(x + width - (major ? 33 : 19), y);
      context.lineTo(x + width - 3, y);
      context.stroke();
      if (major) {
        context.fillStyle = COLORS.white;
        context.textAlign = 'right';
        context.fillText(String(value), x + width - 38, y);
      }
    }
    const flap = number(state.flaps?.target ?? state.controls?.flapTarget);
    const markers = [
      { speed: number(this.spec.vr), label: 'VR', color: COLORS.green },
      { speed: number(flap >= 30 ? this.spec.vApp30 : this.spec.vApp25), label: 'VAPP', color: COLORS.magenta },
      { speed: number(this.spec.v2), label: 'V2', color: COLORS.cyan }
    ];
    for (const marker of markers) {
      if (!(marker.speed > 20)) continue;
      const y = centerY + (speed - marker.speed) * scale;
      if (y < top + 8 || y > bottom - 8) continue;
      context.fillStyle = marker.color;
      context.fillRect(x + 2, y - 4, 10, 8);
      context.font = '700 13px Consolas, monospace';
      context.textAlign = 'left';
      context.fillText(marker.label, x + 15, y - 10);
      context.font = '17px Consolas, monospace';
    }
    this.drawPlate(context, x + 2, centerY - 23, width - 4, 46, padded(speed, 3), {
      color: state.overspeed ? COLORS.red : COLORS.green, font: '700 32px Consolas, monospace'
    });
    this.drawPlate(context, x + 2, bottom - 29, width - 4, 22, 'IAS KT', {
      color: COLORS.dim, border: '#4b626d', font: '700 14px Consolas, monospace'
    });
  }

  drawAltitudeTape(context, altitude, verticalSpeed, top, bottom) {
    const x = 404;
    const width = 88;
    const centerY = (top + bottom) / 2;
    const scale = 0.23;
    context.fillStyle = '#02090e';
    context.fillRect(x, top, width, bottom - top);
    context.strokeStyle = '#4b626d';
    context.lineWidth = 2;
    context.strokeRect(x + 1, top + 1, width - 2, bottom - top - 2);
    context.font = '16px Consolas, monospace';
    context.textBaseline = 'middle';
    const first = Math.floor((altitude - 780) / 100) * 100;
    for (let value = first; value <= altitude + 780; value += 100) {
      const y = centerY + (altitude - value) * scale;
      if (y < top + 10 || y > bottom - 10) continue;
      const major = value % 500 === 0;
      context.strokeStyle = COLORS.white;
      context.lineWidth = major ? 2 : 1;
      context.beginPath();
      context.moveTo(x + 3, y);
      context.lineTo(x + (major ? 27 : 15), y);
      context.stroke();
      if (major) {
        context.fillStyle = COLORS.white;
        context.textAlign = 'left';
        context.fillText(String(Math.round(value)), x + 31, y);
      }
    }
    this.drawPlate(context, x + 2, centerY - 23, width - 4, 46, padded(altitude, 5), {
      color: COLORS.green, font: '700 27px Consolas, monospace'
    });
    const vs = clamp(verticalSpeed, -2000, 2000);
    const barHeight = Math.abs(vs) / 2000 * 110;
    context.fillStyle = Math.abs(vs) > 1600 ? COLORS.amber : COLORS.green;
    context.fillRect(496, centerY - (vs > 0 ? barHeight : 0), 7, Math.max(2, barHeight));
    context.fillStyle = COLORS.dim;
    context.font = '700 14px Consolas, monospace';
    context.textAlign = 'right';
    context.fillText(`${Math.round(vs / 100) / 10}`, 492, bottom - 15);
  }

  drawHeadingTape(context, heading, top, height) {
    const left = 112;
    const right = 400;
    const center = 256;
    context.fillStyle = '#02090e';
    context.fillRect(left, top, right - left, height);
    context.strokeStyle = '#4b626d';
    context.lineWidth = 2;
    context.strokeRect(left + 1, top + 1, right - left - 2, height - 2);
    context.font = '700 16px Consolas, monospace';
    context.textBaseline = 'middle';
    for (let offset = -55; offset <= 55; offset += 5) {
      const value = normalizeHeading(Math.round((heading + offset) / 5) * 5);
      const delta = ((value - heading + 540) % 360) - 180;
      const x = center + delta * 2.5;
      if (x < left + 5 || x > right - 5) continue;
      context.strokeStyle = COLORS.white;
      context.beginPath();
      context.moveTo(x, top + 3);
      context.lineTo(x, top + (value % 10 === 0 ? 17 : 11));
      context.stroke();
      if (value % 30 === 0) {
        context.fillStyle = COLORS.white;
        context.textAlign = 'center';
        const label = value === 0 ? 'N' : value === 90 ? 'E' : value === 180 ? 'S' : value === 270 ? 'W' : padded(value / 10, 2);
        context.fillText(label, x, top + 31);
      }
    }
    context.fillStyle = '#ffe25c';
    context.beginPath();
    context.moveTo(center, top + 2);
    context.lineTo(center - 8, top + 14);
    context.lineTo(center + 8, top + 14);
    context.closePath();
    context.fill();
    this.drawPlate(context, center - 43, top + 34, 86, 22, `${padded(heading, 3)}°`, {
      color: COLORS.green, font: '700 18px Consolas, monospace'
    });
  }

  drawND(state) {
    const context = this.nd.context;
    const width = this.nd.canvas.width;
    const height = this.nd.canvas.height;
    const heading = normalizeHeading(number(state.heading) * RAD_TO_DEG);
    const cx = 256;
    const cy = 254;
    const radius = 190;
    const phase = String(state.mission?.phase ?? state.status ?? '');
    const range = state.onGround ? 1852 : ['takeoff', 'departure', 'climb'].includes(phase) ? 9260 : 37040;
    const scale = radius / range;
    this.drawBackdrop(context, width, height);

    context.save();
    context.translate(cx, cy);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.clip();
    context.strokeStyle = '#365d6b';
    context.lineWidth = 2;
    for (const ring of [0.33, 0.66, 1]) {
      context.beginPath();
      context.arc(0, 0, radius * ring, 0, Math.PI * 2);
      context.stroke();
    }
    if (state.pos) {
      const sin = Math.sin(number(state.heading));
      const cos = Math.cos(number(state.heading));
      const toMap = (worldX, worldZ) => {
        const dx = worldX - number(state.pos.x);
        const dz = worldZ - number(state.pos.z);
        return { x: (dx * cos - dz * sin) * scale, y: -(dx * sin + dz * cos) * scale };
      };
      const center = toMap(0, RUNWAY.threshold + RUNWAY.length / 2);
      const runwayLength = RUNWAY.length * scale;
      const runwayWidth = Math.max(3, RUNWAY.width * scale);
      context.save();
      context.translate(center.x, center.y);
      context.rotate(Math.PI - number(state.heading));
      context.fillStyle = '#7f929b';
      context.fillRect(-runwayWidth / 2, -runwayLength / 2, runwayWidth, runwayLength);
      context.strokeStyle = COLORS.white;
      context.beginPath();
      context.moveTo(0, -runwayLength / 2);
      context.lineTo(0, runwayLength / 2);
      context.stroke();
      context.restore();
    }
    context.rotate(-heading * Math.PI / 180);
    context.font = '700 19px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let degrees = 0; degrees < 360; degrees += 5) {
      const radians = degrees * Math.PI / 180;
      const major = degrees % 30 === 0;
      const inner = radius - (major ? 24 : degrees % 10 === 0 ? 13 : 7);
      context.strokeStyle = COLORS.white;
      context.lineWidth = major ? 3 : 1;
      context.beginPath();
      context.moveTo(Math.sin(radians) * inner, -Math.cos(radians) * inner);
      context.lineTo(Math.sin(radians) * radius, -Math.cos(radians) * radius);
      context.stroke();
      if (major) {
        const label = degrees === 0 ? 'N' : degrees === 90 ? 'E' : degrees === 180 ? 'S' : degrees === 270 ? 'W' : padded(degrees / 10, 2);
        context.fillStyle = degrees % 90 === 0 ? COLORS.green : COLORS.white;
        context.fillText(label, Math.sin(radians) * (radius - 42), -Math.cos(radians) * (radius - 42));
      }
    }
    context.restore();

    context.strokeStyle = '#ffe25c';
    context.fillStyle = '#ffe25c';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(cx, cy - 45);
    context.lineTo(cx, cy + 45);
    context.moveTo(cx - 42, cy);
    context.lineTo(cx + 42, cy);
    context.stroke();
    context.beginPath();
    context.moveTo(cx, cy - 45);
    context.lineTo(cx - 8, cy - 32);
    context.lineTo(cx + 8, cy - 32);
    context.closePath();
    context.fill();

    const windDirection = normalizeHeading(number(state.environment?.windDirection));
    const windSpeed = number(state.environment?.windSpeed) * KT_PER_MS;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.font = '700 21px Consolas, monospace';
    context.fillStyle = COLORS.green;
    context.fillText(`GS ${Math.round(number(state.groundSpeed) * KT_PER_MS)}`, 20, 28);
    context.fillText(`TAS ${Math.round(number(state.airspeed) * KT_PER_MS)}`, 20, 57);
    context.fillStyle = COLORS.cyan;
    context.fillText(`WIND ${padded(windDirection, 3)}/${Math.round(windSpeed)}`, 20, 86);
    this.drawPlate(context, 176, 18, 160, 36, 'MAP  VOR/ADF', {
      color: COLORS.cyan, font: '700 19px Consolas, monospace'
    });
    context.fillStyle = COLORS.dim;
    context.font = '700 18px Consolas, monospace';
    context.textAlign = 'left';
    context.fillText('B747 NAV', 20, 474);
    context.textAlign = 'center';
    context.fillText(`RANGE ${Math.round(range / 1852)} NM`, 270, 474);
    context.textAlign = 'right';
    context.fillStyle = COLORS.green;
    context.fillText(`HDG ${padded(heading, 3)}°`, 492, 474);
    this.drawFrame(context, width, height);
  }

  drawECAM(state) {
    const context = this.ecam.context;
    const width = this.ecam.canvas.width;
    const height = this.ecam.canvas.height;
    const engines = Array.isArray(state.engines) ? state.engines : null;
    const count = engines ? engines.length : this.spec.engineCount;
    this.drawBackdrop(context, width, height);
    context.fillStyle = '#06251b';
    context.fillRect(18, 16, width - 36, 44);
    context.strokeStyle = '#4b9a78';
    context.lineWidth = 2;
    context.strokeRect(19, 17, width - 38, 42);
    context.fillStyle = COLORS.green;
    context.font = '700 25px Consolas, monospace';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText('EICAS  ENGINE', 30, 39);
    context.textAlign = 'right';
    context.fillStyle = COLORS.white;
    context.fillText(this.spec.shortName, width - 30, 39);

    const columnWidth = (width - 40) / Math.max(1, count);
    for (let index = 0; index < count; index += 1) {
      const engine = engines?.[index] ?? {};
      const n1 = enginePercent(engine.n1);
      const n2 = enginePercent(engine.n2);
      const egt = number(engine.egt, number(state.environment?.temperature, 15));
      const rawFF = number(engine.fuelFlowKgH ?? engine.fuelFlow);
      const fuelFlow = engine.fuelFlowKgH !== undefined
        ? rawFF
        : rawFF <= 20 ? rawFF * number(this.spec.fuelDensity, 0.802) * 3600 : rawFF;
      const left = 20 + index * columnWidth;
      const cx = left + columnWidth / 2;
      const cy = 145;
      const radius = Math.min(46, columnWidth * 0.31);
      const color = engine.fire ? COLORS.red : engine.failed ? COLORS.amber : COLORS.green;
      context.fillStyle = '#071d18';
      context.fillRect(left + 3, 72, columnWidth - 6, 310);
      context.strokeStyle = '#285c49';
      context.strokeRect(left + 4, 73, columnWidth - 8, 308);
      context.strokeStyle = '#245341';
      context.lineWidth = 10;
      context.beginPath();
      context.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25);
      context.stroke();
      context.strokeStyle = color;
      context.beginPath();
      context.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 0.75 + n1 / 1.1 * Math.PI * 1.5);
      context.stroke();
      context.fillStyle = color;
      context.font = '700 20px Consolas, monospace';
      context.textAlign = 'center';
      context.fillText(`ENG ${engine.id ?? index + 1}`, cx, 91);
      context.fillStyle = COLORS.white;
      context.font = '700 25px Consolas, monospace';
      context.fillText((n1 * 100).toFixed(1), cx, cy);
      context.fillStyle = COLORS.green;
      context.font = '700 16px Consolas, monospace';
      context.fillText('N1 %', cx, cy - radius - 13);
      context.font = '700 18px Consolas, monospace';
      context.fillStyle = COLORS.white;
      context.fillText(`N2 ${(n2 * 100).toFixed(1)}`, cx, 226);
      context.fillStyle = egt > 800 ? COLORS.red : egt > 650 ? COLORS.amber : COLORS.green;
      context.fillText(`EGT ${Math.round(egt)}`, cx, 259);
      context.fillStyle = '#102b22';
      context.fillRect(left + 12, 278, columnWidth - 24, 16);
      context.fillStyle = egt > 800 ? COLORS.red : egt > 650 ? COLORS.amber : COLORS.green;
      context.fillRect(left + 13, 279, clamp(egt / 950, 0, 1) * (columnWidth - 26), 14);
      context.fillStyle = COLORS.white;
      context.font = '700 16px Consolas, monospace';
      context.fillText(`FF ${Math.round(fuelFlow)}`, cx, 320);
      context.fillStyle = number(engine.reverser) > 0.05 ? COLORS.amber : COLORS.dim;
      context.fillText(number(engine.reverser) > 0.05 ? 'REV DEPLOY' : `FF KG/H  ${engine.antiIce ? 'AI ON' : 'AI OFF'}`, cx, 352);
    }

    const flap = number(state.flaps?.target ?? state.controls?.flapTarget);
    const settings = this.spec.flapSettings ?? FALLBACK_FLAPS;
    context.fillStyle = '#071d18';
    context.fillRect(20, 398, width - 40, 70);
    context.strokeStyle = '#3d7d63';
    context.strokeRect(21, 399, width - 42, 68);
    context.fillStyle = COLORS.white;
    context.font = '700 19px Consolas, monospace';
    context.textAlign = 'left';
    context.fillText(`FLAP ${Math.round(flap)}${state.flaps?.moving ? '  IN TRANSIT' : ''}`, 32, 420);
    context.textAlign = 'center';
    settings.forEach((setting, index) => {
      const x = 44 + index * (width - 88) / Math.max(1, settings.length - 1);
      context.fillStyle = this.nearestFlapIndex(flap) === index ? COLORS.green : COLORS.dim;
      context.fillRect(x - 3, 438, 6, 12);
      context.fillText(String(setting), x, 459);
    });

    const alerts = [];
    if (state.stallWarning) alerts.push('STALL');
    if (state.overspeed) alerts.push('OVERSPEED');
    for (let index = 0; index < count; index += 1) {
      const engine = engines?.[index];
      if (engine?.fire) alerts.push(`ENG ${index + 1} FIRE`);
      else if (engine?.failed) alerts.push(`ENG ${index + 1} FAIL`);
      else if (engine?.startReason && !engine?.running) alerts.push(`ENG ${index + 1} START ABORT`);
    }
    if (state.flaps?.fault) alerts.push('FLAP FAULT');
    const warnings = Array.isArray(state.systems?.warnings) ? state.systems.warnings : [];
    for (const warning of warnings) {
      const text = typeof warning === 'string' ? warning : String(warning?.text ?? warning?.message ?? '');
      if (text) alerts.push(text);
    }
    context.fillStyle = alerts.length ? '#66150f' : '#06251b';
    context.fillRect(20, 486, width - 40, 118);
    context.strokeStyle = alerts.length ? COLORS.red : '#3d7d63';
    context.lineWidth = 3;
    context.strokeRect(21, 487, width - 42, 116);
    context.fillStyle = alerts.length ? '#fff0e8' : COLORS.green;
    context.font = '700 20px Consolas, monospace';
    context.textAlign = 'left';
    const alertText = alerts.length ? alerts.join('  ') : '4 ENG SYSTEM NORMAL';
    const split = [];
    for (let index = 0; index < alertText.length; index += 46) split.push(alertText.slice(index, index + 46));
    split.slice(0, 4).forEach((line, index) => context.fillText(line, 32, 510 + index * 25));
    this.drawFrame(context, width, height);
  }

  drawSystems(state) {
    const context = this.systemsDisplay.context;
    const width = this.systemsDisplay.canvas.width;
    const height = this.systemsDisplay.canvas.height;
    const systems = state.systems ?? {};
    const engines = state.engines ?? [];
    this.drawBackdrop(context, width, height);
    context.textBaseline = 'middle';
    context.font = '700 21px Consolas, monospace';
    context.fillStyle = COLORS.green;
    context.textAlign = 'left';
    context.fillText('ELECTRICAL / HYDRAULIC / FUEL', 20, 26);

    const generatorText = [0, 1, 2, 3].map((index) => `G${index + 1}:${activeFlag(systems.generators?.[index]) ? 'ON' : 'OFF'}`).join(' ');
    const pumpText = [0, 1, 2, 3].map((index) => `P${index + 1}:${activeFlag(systems.electricPumps?.[index]) ? 'ON' : 'OFF'}`).join(' ');
    const hydraulicText = [0, 1, 2, 3].map((index) => {
      const value = systems.hydraulic?.[index];
      const pressurized = activeFlag(value) || (value === undefined && (engines[index]?.running || activeFlag(systems.electricPumps?.[index])));
      return `H${index + 1}:${pressurized ? '3000' : 'LOW'}`;
    }).join(' ');
    const rows = [
      [`GEN  ${generatorText}`, generatorText.includes('OFF') ? COLORS.amber : COLORS.green],
      [`HYD  ${hydraulicText}`, hydraulicText.includes('LOW') ? COLORS.amber : COLORS.green],
      [`ELEC ${pumpText}`, pumpText.includes('OFF') ? COLORS.white : COLORS.green],
      [`APU ${systems.apu?.available ? 'AVAIL' : systems.apu?.switch ? 'START' : 'OFF'}  BLEED ${systems.bleedAir ? 'ON' : 'OFF'}  PACK ${systems.packOff ? 'OFF' : 'ON'}`, systems.apu?.available ? COLORS.green : COLORS.white]
    ];
    rows.forEach((row, index) => {
      const y = 62 + index * 39;
      context.fillStyle = '#071d18';
      context.fillRect(16, y - 16, width - 32, 32);
      context.fillStyle = row[1];
      context.font = '700 20px Consolas, monospace';
      context.textAlign = 'left';
      context.fillText(row[0], 24, y);
    });

    const fuelKg = number(state.fuel?.mass ?? state.fuel?.weight, number(state.fuel?.qty) * number(this.spec.fuelDensity, 0.802));
    const usedKg = Math.max(0, number(state.fuel?.initial) * number(this.spec.fuelDensity, 0.802) - fuelKg);
    context.fillStyle = '#0a241c';
    context.fillRect(16, 222, 300, 96);
    context.fillRect(324, 222, 300, 96);
    context.strokeStyle = '#43836a';
    context.lineWidth = 2;
    context.strokeRect(17, 223, 298, 94);
    context.strokeRect(325, 223, 298, 94);
    context.fillStyle = COLORS.white;
    context.font = '700 25px Consolas, monospace';
    context.textAlign = 'center';
    context.fillText(`FOB ${(fuelKg / 1000).toFixed(1)} T`, 166, 253);
    context.fillText(`GROSS WT ${(number(state.weight) / 1000).toFixed(1)} T`, 474, 253);
    context.fillStyle = COLORS.cyan;
    context.font = '700 20px Consolas, monospace';
    context.fillText(`USED ${(usedKg / 1000).toFixed(1)} T`, 166, 291);
    const flap = Math.round(number(state.flaps?.target));
    context.fillText(`FLAP ${flap}  GEAR ${state.gear?.moving ? 'TRANSIT' : number(state.gear?.position) > 0.5 ? 'DOWN' : 'UP'}`, 474, 291);

    const reverse = engines.some((engine) => number(engine?.reverser) > 0.05) || state.controls?.reverse;
    const memo = [
      `PARK BRK ${state.controls?.parkingBrake ? 'SET' : 'OFF'}`,
      `SPOILERS ${state.controls?.spoilers === 'stowed' ? 'STOWED' : 'EXTENDED'}`,
      `REVERSERS ${reverse ? 'UNLOCKED' : 'STOWED'}`
    ];
    context.fillStyle = '#071d18';
    context.fillRect(16, 334, width - 32, 44);
    context.fillStyle = reverse || state.controls?.parkingBrake ? COLORS.amber : COLORS.green;
    context.font = '700 18px Consolas, monospace';
    context.textAlign = 'center';
    context.fillText(memo.join('   '), width / 2, 356);
    this.drawFrame(context, width, height);
  }

  drawStandby(state) {
    const attitude = this.standby.context;
    const pitch = clamp(number(state.pitch) * RAD_TO_DEG, -60, 60);
    const roll = clamp(number(state.roll) * RAD_TO_DEG, -60, 60);
    attitude.setTransform(1, 0, 0, 1, 0, 0);
    attitude.fillStyle = '#061018';
    attitude.fillRect(0, 0, 256, 256);
    attitude.save();
    attitude.beginPath();
    attitude.arc(128, 128, 116, 0, Math.PI * 2);
    attitude.clip();
    attitude.translate(128, 128 + pitch * 2.2);
    attitude.rotate(-roll * Math.PI / 180);
    attitude.fillStyle = COLORS.sky;
    attitude.fillRect(-300, -400, 600, 400);
    attitude.fillStyle = COLORS.ground;
    attitude.fillRect(-300, 0, 600, 400);
    attitude.strokeStyle = COLORS.white;
    attitude.lineWidth = 4;
    attitude.beginPath();
    attitude.moveTo(-300, 0);
    attitude.lineTo(300, 0);
    attitude.stroke();
    attitude.restore();
    attitude.strokeStyle = '#ffe25c';
    attitude.lineWidth = 5;
    attitude.beginPath();
    attitude.moveTo(72, 128);
    attitude.lineTo(116, 128);
    attitude.moveTo(140, 128);
    attitude.lineTo(184, 128);
    attitude.stroke();
    attitude.fillStyle = COLORS.white;
    attitude.font = '700 19px Consolas, monospace';
    attitude.textAlign = 'center';
    attitude.fillText('STBY ATT', 128, 26);

    this.drawStandbyTape(this.standbySpeed.context, 'IAS', Math.round(number(state.airspeed) * KT_PER_MS), 'KT', COLORS.green);
    this.drawStandbyTape(this.standbyAltitude.context, 'ALT', Math.round(number(state.altitude) * FT_PER_M), 'FT', COLORS.cyan);
  }

  drawStandbyTape(context, label, value, unit, color) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#061018';
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = '#d7e4e8';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(128, 128, 111, 0, Math.PI * 2);
    context.stroke();
    for (let index = 0; index < 24; index += 1) {
      const angle = index / 24 * Math.PI * 2;
      context.beginPath();
      context.moveTo(128 + Math.sin(angle) * 96, 128 - Math.cos(angle) * 96);
      context.lineTo(128 + Math.sin(angle) * 108, 128 - Math.cos(angle) * 108);
      context.stroke();
    }
    context.fillStyle = '#02070b';
    context.fillRect(35, 91, 186, 78);
    context.strokeStyle = color;
    context.strokeRect(37, 93, 182, 74);
    context.fillStyle = color;
    context.font = `700 ${String(value).length > 4 ? 37 : 46}px Consolas, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(value), 128, 130);
    context.fillStyle = COLORS.white;
    context.font = '700 22px Consolas, monospace';
    context.fillText(`${label} ${unit}`, 128, 205);
  }

  drawMCP(state) {
    const context = this.mcpContext;
    const width = this.mcpCanvas.width;
    const height = this.mcpCanvas.height;
    const values = [
      ['IAS/MACH', padded(number(state.airspeed) * KT_PER_MS, 3)],
      ['HEADING', padded(normalizeHeading(number(state.heading) * RAD_TO_DEG), 3)],
      ['ALTITUDE', padded(number(state.altitude) * FT_PER_M, 5)],
      ['VERT SPEED', `${number(state.verticalSpeed) >= 0 ? '+' : '-'}${padded(Math.abs(number(state.verticalSpeed) * FPM_PER_MS) / 100, 2)}`]
    ];
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#02080a';
    context.fillRect(0, 0, width, height);
    values.forEach((entry, index) => {
      const x = 8 + index * 256;
      context.fillStyle = '#061c15';
      context.fillRect(x, 4, 248, 120);
      context.strokeStyle = '#39755d';
      context.lineWidth = 3;
      context.strokeRect(x + 2, 6, 244, 116);
      context.fillStyle = COLORS.green;
      context.font = '700 21px Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(entry[0], x + 124, 25);
      context.fillStyle = '#8affba';
      context.font = '700 43px Consolas, monospace';
      context.fillText(entry[1], x + 124, 72);
      context.fillStyle = state.systems?.avionics ? COLORS.green : COLORS.amber;
      context.font = '700 17px Consolas, monospace';
      context.fillText(state.systems?.avionics ? 'CMD  ARMED' : 'OFF', x + 124, 106);
    });
  }

  setVisible(visible) {
    this.group.visible = visible;
    if (visible) {
      this.displayPending = true;
      for (const key of Object.keys(this.displayTimers)) this.displayTimers[key] = 0;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set(this.ownedTextures);
    this.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) materials.add(material);
    });
    for (const collection of [this.materials, this.indicatorMaterials, this.buttonMaterials]) {
      for (const material of Object.values(collection)) materials.add(material);
    }
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    this.ownedTextures.clear();
    this.pickables.length = 0;
    this.buttons.length = 0;
    this.overheadButtons.length = 0;
    this.controlYokes.length = 0;
    this.rudderPedals.length = 0;
    this.throttleLevers.length = 0;
    this.reverseLevers.length = 0;
    this.group.removeFromParent();
    this.group.clear();
  }
}

export default Cockpit;
