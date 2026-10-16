import * as THREE from 'three';
import { M, clamp, lerp, smoothstep, terrainHeight, isOnPavedSurface } from '../sim/config.js';

/*
 * 场地布局常量：全部与 sim/config.js 中的 M / terrainHeight / isOnPavedSurface 对齐。
 *   x 向东、y 向上、z 向北。RWY36 入口在 z = -1800，RWY18 入口在 z = +1800，跑道宽 45 m。
 *   平行滑行道 A 中线 x = -80，铺装判定范围 x ∈ [-122, -36]、z ∈ [-2100, 2100]。
 *   西侧停机坪 x ∈ [-430, -160]、z ∈ [1450, 1850]。
 *   西南/西北两块混凝土场地对应 terrainHeight 里的其他平整区。
 */
const RUNWAY_LENGTH = M.runwayLength;
const RUNWAY_WIDTH = M.runwayWidth;
const RUNWAY_HALF_WIDTH = RUNWAY_WIDTH / 2;
const THRESHOLD_36 = M.runwayThreshold;
const THRESHOLD_18 = M.runwayThreshold + RUNWAY_LENGTH;
const TAXIWAY_A_X = -80;
const TAXIWAY_A_MAX_X = -36;
const APRON = { minX: -430, maxX: -160, minZ: 1450, maxZ: 1850 };
const SERVICE_SOUTH = { minX: -1000, maxX: -120, minZ: -1800, maxZ: -1400 };
const SERVICE_NORTH = { minX: -1000, maxX: -120, minZ: 1380, maxZ: 1700 };
const APRON_TAXILANE_Z = 1500;

const SURFACE_Y = 0.02;
const SHOULDER_Y = 0.012;
const DECAL_Y = 0.032;
const PAINT_Y = 0.05;

/* 机场平整场地：围栏（±1000 / ±2300）以内完全平坦，向外 420 m 过渡回自然地形。 */
const PLATFORM_HALF_X = 1080;
const PLATFORM_HALF_Z = 2380;
const PLATFORM_BLEND = 420;

function airfieldMask(x, z) {
  const outside = Math.max(Math.abs(x) - PLATFORM_HALF_X, Math.abs(z) - PLATFORM_HALF_Z);
  if (outside <= 0) return 1;
  return 1 - smoothstep(0, PLATFORM_BLEND, outside);
}

function groundHeight(x, z) {
  const mask = airfieldMask(x, z);
  if (mask >= 1) return 0;
  const natural = terrainHeight(x, z);
  if (mask <= 0) return natural;
  return lerp(natural, 0, mask);
}

function randomGenerator(seed = 0x7f4a7c15) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createCanvasTexture(width, height, painter, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  painter(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
  texture.anisotropy = options.anisotropy ?? 8;
  if (options.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(options.repeat[0], options.repeat[1]);
  }
  return texture;
}

/* ------------------------------------------------------------------ */
/* 程序化纹理                                                          */
/* ------------------------------------------------------------------ */

function paintAggregate(context, width, height, random, count, base) {
  for (let i = 0; i < count; i += 1) {
    const shade = base + Math.floor(random() * 74) - 30;
    context.fillStyle = `rgba(${shade},${shade},${Math.max(0, shade - 8)},${0.05 + random() * 0.24})`;
    const size = 0.6 + random() * 1.9;
    context.fillRect(random() * width, random() * height, size, size);
  }
}

function paintBlotches(context, width, height, random, count, light, dark) {
  for (let i = 0; i < count; i += 1) {
    const x = random() * width;
    const y = random() * height;
    const radius = 26 + random() * 140;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    const bright = random() > 0.48;
    gradient.addColorStop(0, bright ? light : dark);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

function paintCracks(context, width, height, random, count, feather) {
  for (let i = 0; i < count; i += 1) {
    context.strokeStyle = `rgba(14,16,18,${0.1 + random() * 0.26})`;
    context.lineWidth = feather * (0.6 + random() * 1.2);
    let x = random() * width;
    let y = random() * height;
    context.beginPath();
    context.moveTo(x, y);
    for (let step = 0; step < 5; step += 1) {
      x += (random() - 0.5) * 88;
      y += (random() - 0.5) * 88;
      context.lineTo(x, y);
    }
    context.stroke();
  }
}

function paintJoints(context, width, height, gutter) {
  context.strokeStyle = gutter;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 1);
  context.lineTo(width, 1);
  context.stroke();
  context.beginPath();
  context.moveTo(1, 0);
  context.lineTo(1, height);
  context.stroke();
  context.strokeStyle = 'rgba(168,172,168,0.14)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, 3);
  context.lineTo(width, 3);
  context.stroke();
  context.beginPath();
  context.moveTo(3, 0);
  context.lineTo(3, height);
  context.stroke();
}

function asphaltTexture(seed, options = {}) {
  const random = randomGenerator(seed);
  const texture = createCanvasTexture(512, 512, (context, width, height) => {
    context.fillStyle = options.base ?? '#3a4043';
    context.fillRect(0, 0, width, height);
    paintBlotches(context, width, height, random, 70, 'rgba(196,202,198,0.09)', 'rgba(18,21,23,0.13)');
    paintAggregate(context, width, height, random, 15000, 108);
    paintCracks(context, width, height, random, 24, 1);
    paintJoints(context, width, height, 'rgba(16,19,20,0.5)');
  }, { repeat: options.repeat });
  return texture;
}

function patchTexture(seed) {
  const random = randomGenerator(seed);
  return createCanvasTexture(256, 256, (context, width, height) => {
    context.fillStyle = '#2f3438';
    context.fillRect(0, 0, width, height);
    paintBlotches(context, width, height, random, 26, 'rgba(178,184,180,0.14)', 'rgba(10,12,13,0.2)');
    paintAggregate(context, width, height, random, 4200, 96);
    paintCracks(context, width, height, random, 14, 1);
    context.strokeStyle = 'rgba(22,25,26,0.72)';
    context.lineWidth = 3;
    context.strokeRect(1.5, 1.5, width - 3, height - 3);
  });
}

function concreteTexture(seed, options = {}) {
  const random = randomGenerator(seed);
  return createCanvasTexture(512, 512, (context, width, height) => {
    context.fillStyle = options.base ?? '#8b8f8b';
    context.fillRect(0, 0, width, height);
    paintBlotches(context, width, height, random, 60, 'rgba(232,234,228,0.1)', 'rgba(84,88,86,0.16)');
    paintAggregate(context, width, height, random, 9000, 150);
    paintCracks(context, width, height, random, 18, 1);
    if (options.joints !== false) paintJoints(context, width, height, 'rgba(72,76,74,0.55)');
  }, { repeat: options.repeat });
}

function grassTexture(seed, options = {}) {
  const random = randomGenerator(seed);
  return createCanvasTexture(512, 512, (context, width, height) => {
    context.fillStyle = options.base ?? '#5d7a3c';
    context.fillRect(0, 0, width, height);
    paintBlotches(context, width, height, random, 90, 'rgba(178,196,116,0.16)', 'rgba(38,58,26,0.22)');
    paintCracks(context, width, height, random, 40, 1.4);
    for (let i = 0; i < 26000; i += 1) {
      const green = 74 + Math.floor(random() * 66);
      context.fillStyle = `rgba(${Math.floor(green * 0.72)},${green},${Math.floor(green * 0.44)},${0.06 + random() * 0.3})`;
      context.fillRect(random() * width, random() * height, 1 + random() * 2, 1 + random() * 3);
    }
  }, { repeat: options.repeat });
}

function dirtTexture(seed) {
  const random = randomGenerator(seed);
  return createCanvasTexture(256, 256, (context, width, height) => {
    context.fillStyle = '#6d6551';
    context.fillRect(0, 0, width, height);
    paintBlotches(context, width, height, random, 40, 'rgba(196,180,142,0.16)', 'rgba(52,44,32,0.18)');
    paintAggregate(context, width, height, random, 7000, 128);
  });
}

function glowTexture(size = 128) {
  return createCanvasTexture(size, size, (context, width, height) => {
    const gradient = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.16, 'rgba(255,255,255,0.82)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(0.72, 'rgba(255,255,255,0.05)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  });
}

function rubberTexture(seed, options = {}) {
  const random = randomGenerator(seed);
  return createCanvasTexture(256, 512, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    for (let i = 0; i < 110; i += 1) {
      const x = random() * width;
      const y = random() * height;
      const length = 36 + random() * 240;
      const thickness = 2 + random() * 9;
      const alpha = 0.05 + random() * 0.24;
      const gradient = context.createLinearGradient(x, y, x, y + length);
      gradient.addColorStop(0, 'rgba(12,13,15,0)');
      gradient.addColorStop(0.38, `rgba(12,13,15,${alpha})`);
      gradient.addColorStop(1, 'rgba(12,13,15,0)');
      context.fillStyle = gradient;
      context.fillRect(x - thickness / 2, y, thickness, length);
    }
    const fade = context.createLinearGradient(0, 0, width, 0);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(options.edge ?? 0.14, 'rgba(0,0,0,0)');
    fade.addColorStop(1 - (options.edge ?? 0.14), 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = fade;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
  });
}

function stainTexture(seed) {
  const random = randomGenerator(seed);
  return createCanvasTexture(128, 128, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    for (let i = 0; i < 14; i += 1) {
      const x = width * (0.2 + random() * 0.6);
      const y = height * (0.2 + random() * 0.6);
      const radius = 8 + random() * 30;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(16,17,18,${0.3 + random() * 0.4})`);
      gradient.addColorStop(0.6, `rgba(22,24,26,${0.12 + random() * 0.18})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    const fade = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.7, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = fade;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
  });
}

function grassTuftTexture(seed) {
  const random = randomGenerator(seed);
  return createCanvasTexture(128, 128, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    for (let i = 0; i < 40; i += 1) {
      const baseX = 16 + random() * (width - 32);
      const blade = height * (0.42 + random() * 0.54);
      const lean = (random() - 0.5) * 36;
      context.strokeStyle = `hsl(${76 + random() * 30}, ${34 + random() * 26}%, ${21 + random() * 24}%)`;
      context.lineWidth = 1.5 + random() * 2.6;
      context.beginPath();
      context.moveTo(baseX, height);
      context.quadraticCurveTo(baseX + lean * 0.4, height - blade * 0.55, baseX + lean, height - blade);
      context.stroke();
    }
  }, { colorSpace: THREE.SRGBColorSpace });
}

function textSignTexture(options) {
  const {
    text,
    sub = '',
    background = '#d9ae19',
    color = '#151711',
    border = '#151711',
    width = 512,
    height = 160,
    fontSize = 104
  } = options;
  return createCanvasTexture(width, height, (context, w, h) => {
    context.fillStyle = background;
    context.fillRect(0, 0, w, h);
    if (border) {
      const lineWidth = Math.max(4, h * 0.05);
      context.strokeStyle = border;
      context.lineWidth = lineWidth;
      context.strokeRect(lineWidth / 2, lineWidth / 2, w - lineWidth, h - lineWidth);
    }
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `700 ${fontSize}px "Arial Narrow", Arial, sans-serif`;
    context.fillText(text, w / 2, sub ? h * 0.38 : h * 0.5);
    if (sub) {
      context.font = `700 ${fontSize * 0.62}px Arial, sans-serif`;
      context.fillText(sub, w / 2, h * 0.76);
    }
  });
}

/* 跑道号码字形：横向压缩的粗体数字，比例接近真实跑道标志（约 18 m 高、12 m 宽）。 */
function runwayNumberTexture(text) {
  return createCanvasTexture(256, 384, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#f5f4ea';
    const fontSize = 320;
    context.font = `700 ${fontSize}px "Arial Black", Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const digits = String(text).split('');
    const widths = digits.map((digit) => context.measureText(digit).width);
    const gap = fontSize * 0.1;
    const total = widths.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, digits.length - 1);
    context.translate(width / 2, height / 2);
    context.scale(0.52, 1);
    let cursor = -total / 2;
    digits.forEach((digit, index) => {
      context.fillText(digit, cursor + widths[index] / 2, 0);
      cursor += widths[index] + gap;
    });
  });
}

function standNumberTexture(text) {
  return createCanvasTexture(256, 384, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#e9c72c';
    context.font = '700 300px "Arial Black", Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.translate(width / 2, height / 2);
    context.scale(0.58, 1);
    context.fillText(text, 0, 0);
  });
}

/* ------------------------------------------------------------------ */
/* 网格小工具                                                          */
/* ------------------------------------------------------------------ */

function horizontalPlane(width, depth, material, x, y, z, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rotation;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  return mesh;
}

function boxMesh(width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function instanced(geometry, material, transforms, options = {}) {
  const count = transforms.length;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    const item = transforms[index];
    position.set(item.x || 0, item.y || 0, item.z || 0);
    quaternion.setFromEuler(euler.set(item.rx || 0, item.ry || 0, item.rz || 0, 'YXZ'));
    scale.set(item.sx ?? item.w ?? 1, item.sy ?? item.h ?? 1, item.sz ?? item.d ?? 1);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    if (options.colors) {
      color.set(options.colors[index] ?? 0xffffff);
      mesh.setColorAt(index, color);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (options.colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? true;
  if (options.name) mesh.name = options.name;
  if (options.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

/* 涂装在道面上的标线：统一的薄板实例，避免与道面 z-fighting。 */
function paintMesh(transforms, material, thickness = 0.014) {
  const list = transforms.map((item) => ({
    x: item.x,
    y: item.y ?? PAINT_Y,
    z: item.z,
    sx: item.w,
    sy: thickness,
    sz: item.d,
    ry: item.ry || 0
  }));
  return instanced(new THREE.BoxGeometry(1, 1, 1), material, list, { name: 'paint' });
}

function lightEntries(points, material, options = {}) {
  const count = points.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    const item = points[index];
    positions[index * 3] = item.x;
    positions[index * 3 + 1] = item.y;
    positions[index * 3 + 2] = item.z;
    color.set(item.color);
    const gain = item.gain ?? 1;
    colors[index * 3] = color.r * gain;
    colors[index * 3 + 1] = color.g * gain;
    colors[index * 3 + 2] = color.b * gain;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.attributes.position.setUsage(options.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
  const points_ = new THREE.Points(geometry, material);
  points_.frustumCulled = options.frustumCulled ?? false;
  if (options.name) points_.name = options.name;
  return points_;
}

/* 圆弧标线：滑行道进出跑道的转弯引导线。 */
function arcTransforms(centerX, centerZ, radius, startAngle, endAngle, segments, thickness, y) {
  const transforms = [];
  for (let index = 0; index < segments; index += 1) {
    const angle0 = lerp(startAngle, endAngle, index / segments);
    const angle1 = lerp(startAngle, endAngle, (index + 1) / segments);
    const middle = (angle0 + angle1) / 2;
    transforms.push({
      x: centerX + Math.cos(middle) * radius,
      y,
      z: centerZ + Math.sin(middle) * radius,
      w: thickness,
      d: Math.abs(angle1 - angle0) * radius * 1.25,
      ry: -middle
    });
  }
  return transforms;
}

function straightTransforms(x1, z1, x2, z2, thickness, y) {
  const length = Math.hypot(x2 - x1, z2 - z1);
  return [{
    x: (x1 + x2) / 2,
    y,
    z: (z1 + z2) / 2,
    w: thickness,
    d: length,
    ry: -Math.atan2(x2 - x1, z2 - z1)
  }];
}

/* 立式指示牌：黄色位置牌 / 红色跑道等待牌 / 蓝色停机位牌。
 * 建模阶段只登记参数，最后由 buildSigns() 统一合批：框架与立柱用 InstancedMesh，
 * 牌面因每块贴图不同各占一个 draw call（正反面合进同一块几何体，避免背面文字镜像）。 */
function createSign(materials, texture, options) {
  materials.signQueue.push({
    texture,
    x: options.x,
    z: options.z,
    ry: options.ry || 0,
    width: options.width ?? 5.2,
    height: options.height ?? 1.6,
    postHeight: options.postHeight ?? 1.5
  });
  return new THREE.Group();
}

function signFaceGeometry(width, height) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const positions = [
    -halfWidth, -halfHeight, 0.095, halfWidth, -halfHeight, 0.095, halfWidth, halfHeight, 0.095, -halfWidth, halfHeight, 0.095,
    halfWidth, -halfHeight, -0.095, -halfWidth, -halfHeight, -0.095, -halfWidth, halfHeight, -0.095, halfWidth, halfHeight, -0.095
  ];
  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1
  ];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geometry;
}

function buildSigns(ctx) {
  const { group, materials } = ctx;
  const queue = materials.signQueue;
  if (queue.length === 0) return null;
  const signs = new THREE.Group();
  signs.name = 'signs';
  group.add(signs);
  const frames = [];
  const posts = [];

  for (const item of queue) {
    const ground = groundHeight(item.x, item.z);
    const centerY = ground + item.postHeight + item.height / 2;
    frames.push({
      x: item.x,
      y: centerY,
      z: item.z,
      sx: item.width + 0.16,
      sy: item.height + 0.16,
      sz: 0.18,
      ry: item.ry
    });
    for (const side of [-1, 1]) {
      const offset = side * item.width * 0.3;
      posts.push({
        x: item.x + Math.cos(item.ry) * offset,
        y: ground + item.postHeight / 2,
        z: item.z - Math.sin(item.ry) * offset,
        sx: 0.13,
        sy: item.postHeight,
        sz: 0.13,
        ry: item.ry
      });
    }
    const material = new THREE.MeshStandardMaterial({
      map: item.texture,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: item.texture,
      emissiveIntensity: 0.02,
      roughness: 0.6,
      metalness: 0.05
    });
    const face = new THREE.Mesh(signFaceGeometry(item.width, item.height), material);
    face.position.set(item.x, centerY, item.z);
    face.rotation.y = item.ry;
    face.castShadow = true;
    signs.add(face);
    materials.signFaces.push(material);
  }

  signs.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.signFrame, frames, { name: 'signFrames', castShadow: true }));
  signs.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.signPost, posts, { name: 'signPosts' }));
  return signs;
}

/* ------------------------------------------------------------------ */
/* 地面与平整场地                                                      */
/* ------------------------------------------------------------------ */

function createTerrain(materials) {
  const half = 10000;
  const segments = 200;
  const axis = (t) => half * (0.35 * t + 0.65 * t * t * t);
  const vertices = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const color = new THREE.Color();
  for (let row = 0; row <= segments; row += 1) {
    const z = axis((row / segments) * 2 - 1);
    for (let column = 0; column <= segments; column += 1) {
      const x = axis((column / segments) * 2 - 1);
      const height = groundHeight(x, z);
      const mown = Math.abs(x) < 150 && Math.abs(z) < 2250;
      const variation = Math.sin(x * 0.019 + z * 0.013) * 0.035 + Math.sin(z * 0.21) * 0.012;
      if (height > 180) color.setRGB(0.3 + variation, 0.31 + variation, 0.28 + variation);
      else if (height > 90) color.setRGB(0.24 + variation, 0.3 + variation, 0.19 + variation);
      else if (mown) color.setRGB(0.3 + variation, 0.42 + variation, 0.2 + variation);
      else color.setRGB(0.25 + variation, 0.37 + variation, 0.17 + variation);
      vertices.push(x, height, z);
      colors.push(color.r, color.g, color.b);
      uvs.push(x / 30, z / 30);
    }
  }
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const a = row * (segments + 1) + column;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    map: materials.grassDetail,
    vertexColors: true,
    roughness: 1,
    metalness: 0
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* 跑道                                                                */
/* ------------------------------------------------------------------ */

function runwayMarkingTransforms() {
  const list = [];
  const add = (x, z, w, d) => list.push({ x, y: PAINT_Y, z, w, d });
  for (const side of [-1, 1]) add(side * (RUNWAY_HALF_WIDTH - 0.45), 0, 0.9, RUNWAY_LENGTH - 24);
  for (let z = THRESHOLD_36 + 45; z <= THRESHOLD_18 - 45; z += 50) add(0, z, 0.9, 30);
  for (const threshold of [THRESHOLD_36, THRESHOLD_18]) {
    const inward = threshold === THRESHOLD_36 ? 1 : -1;
    const at = (offset) => threshold + inward * offset;
    add(0, at(1.6), RUNWAY_WIDTH - 1.8, 1.8);                     // 入口横线
    for (const side of [-1, 1]) {
      for (const offset of [2.7, 6.3, 9.9, 13.5]) add(side * offset, at(18), 1.8, 30); // 入口“钢琴键”
      for (const [distance, bars] of [[150, 3], [300, 2], [450, 1]]) {                  // 接地带标志
        for (let bar = 0; bar < bars; bar += 1) add(side * (3.6 + bar * 3.4), at(distance), 1.8, 22.5);
      }
      add(side * 12.9, at(327.5), 3, 45);                                              // 瞄准点
    }
  }
  return list;
}

function createRunway(ctx) {
  const { group, materials } = ctx;
  const runway = new THREE.Group();
  runway.name = 'runway';
  group.add(runway);

  runway.add(horizontalPlane(RUNWAY_WIDTH, RUNWAY_LENGTH, materials.runwayAsphalt, 0, SURFACE_Y, 0));
  for (const side of [-1, 1]) {
    runway.add(horizontalPlane(3.6, RUNWAY_LENGTH, materials.shoulder, side * (RUNWAY_HALF_WIDTH + 1.8), SHOULDER_Y, 0));
    runway.add(horizontalPlane(1.1, RUNWAY_LENGTH, materials.gutter, side * (RUNWAY_HALF_WIDTH + 4.15), SHOULDER_Y - 0.006, 0));
    runway.add(horizontalPlane(2.4, RUNWAY_LENGTH, materials.dirtBand, side * (RUNWAY_HALF_WIDTH + 5.9), 0.006, 0));
    runway.add(horizontalPlane(10, RUNWAY_LENGTH, materials.mownGrass, side * (RUNWAY_HALF_WIDTH + 12.1), 0.006, 0));
  }

  const random = randomGenerator(913771);
  const patches = [];
  for (let index = 0; index < 26; index += 1) {
    const width = 2.5 + random() * 7;
    const depth = 3 + random() * 12;
    patches.push({
      x: (random() - 0.5) * (RUNWAY_WIDTH - width - 2),
      y: 0.026,
      z: (random() - 0.5) * (RUNWAY_LENGTH - depth - 40),
      sx: width,
      sy: 0.01,
      sz: depth,
      ry: random() > 0.5 ? Math.PI / 2 : 0
    });
  }
  runway.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.patch, patches, { name: 'runwayPatches' }));

  for (const [threshold, inward] of [[THRESHOLD_36, 1], [THRESHOLD_18, -1]]) {
    const heavy = new THREE.Mesh(new THREE.PlaneGeometry(24, 300), materials.rubberHeavy);
    heavy.rotation.x = -Math.PI / 2;
    heavy.position.set(0, DECAL_Y, threshold + inward * 250);
    runway.add(heavy);
    const light = new THREE.Mesh(new THREE.PlaneGeometry(40, 780), materials.rubberLight);
    light.rotation.x = -Math.PI / 2;
    light.position.set(0, DECAL_Y - 0.002, threshold + inward * 560);
    runway.add(light);
  }

  runway.add(paintMesh(runwayMarkingTransforms(), materials.paint));

  for (const item of [
    { text: '36', z: THRESHOLD_36 + 49, rotation: Math.PI },
    { text: '18', z: THRESHOLD_18 - 49, rotation: 0 }
  ]) {
    const texture = runwayNumberTexture(item.text);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      roughness: 0.85,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const plane = horizontalPlane(12, 18, material, 0, PAINT_Y + 0.012, item.z);
    plane.rotation.z = item.rotation;
    plane.name = `runwayNumber${item.text}`;
    runway.add(plane);
  }

  /* 道面排水沟篦子 */
  const grates = [];
  for (const side of [-1, 1]) {
    for (let z = -1770; z <= 1770; z += 90) {
      grates.push({ x: side * (RUNWAY_HALF_WIDTH + 4.15), y: SHOULDER_Y + 0.004, z, sx: 0.9, sy: 0.02, sz: 0.55 });
    }
  }
  runway.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.grate, grates, { name: 'runwayGrates' }));

  /* 跑道边灯灯具（夜间发光，白天只见灯具本体） */
  const fixtures = [];
  for (let z = THRESHOLD_36; z <= THRESHOLD_18; z += 60) {
    for (const side of [-1, 1]) {
      fixtures.push({ x: side * (RUNWAY_HALF_WIDTH + 1.1), y: 0.16, z, sx: 0.34, sy: 0.32, sz: 0.34 });
    }
  }
  runway.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.lightBase, fixtures, { name: 'runwayLightBases', castShadow: true }));

  return runway;
}

/* ------------------------------------------------------------------ */
/* 滑行道 / 联络道                                                     */
/* ------------------------------------------------------------------ */

const CONNECTORS = [
  { z: -1750, width: 34, label: 'A1' },
  { z: -1500, width: 30, label: 'A2' },
  { z: 0, width: 30, label: 'A3' },
  { z: 900, width: 26, label: 'A4' },
  { z: APRON_TAXILANE_Z, width: 34, label: 'A5' },
  { z: 1750, width: 30, label: 'A6' }
];

function createTaxiways(ctx) {
  const { group, materials } = ctx;
  const taxi = new THREE.Group();
  taxi.name = 'taxiways';
  group.add(taxi);

  /* 平行滑行道 A：中央沥青 + 两侧混凝土道肩，完整覆盖逻辑判定范围 */
  taxi.add(horizontalPlane(48, 4200, materials.taxiAsphalt, TAXIWAY_A_X, SURFACE_Y, 0));
  taxi.add(horizontalPlane(18, 4200, materials.taxiShoulder, -113, SHOULDER_Y, 0));
  taxi.add(horizontalPlane(20, 4200, materials.taxiShoulder, -46, SHOULDER_Y, 0));

  const yellow = [];
  const PAINT = PAINT_Y;
  for (const item of straightTransforms(TAXIWAY_A_X, -2050, TAXIWAY_A_X, 2050, 0.3, PAINT)) yellow.push(item);

  for (const connector of CONNECTORS) {
    const { z, width } = connector;
    taxi.add(horizontalPlane(99.5, width, materials.connectorAsphalt, -72.25, SURFACE_Y, z));
    /* 交叉口加宽（道口喇叭口），并一直铺到跑道边线，和逻辑路面判定衔接 */
    taxi.add(horizontalPlane(84, 62, materials.connectorAsphalt, -68, SURFACE_Y - 0.002, z));

    const radius = 24;
    for (const item of arcTransforms(TAXIWAY_A_X + radius, z - radius, radius, Math.PI, Math.PI / 2, 10, 0.3, PAINT)) yellow.push(item);
    for (const item of arcTransforms(TAXIWAY_A_X + radius, z + radius, radius, Math.PI, Math.PI * 1.5, 10, 0.3, PAINT)) yellow.push(item);
    for (const item of straightTransforms(TAXIWAY_A_X + radius, z, -RUNWAY_HALF_WIDTH - 2.5, z, 0.3, PAINT)) yellow.push(item);

    /* 跑道等待位置：两条实线 + 两条虚线 */
    const half = width / 2;
    for (const offset of [0.9, 1.9]) {
      yellow.push({ x: -44 - offset, y: PAINT, z, w: 0.3, d: width });
    }
    for (const offset of [0.9, 1.9]) {
      for (let step = -half + 0.7; step < half - 0.7; step += 2.4) {
        yellow.push({ x: -40 - offset, y: PAINT, z: z + step, w: 0.3, d: 1.2 });
      }
    }

    /* 跑道口警戒灯：等待位置两侧各一对黄灯，夜间交替闪光 */
    for (const side of [-1, 1]) {
      for (const pair of [-1, 1]) {
        ctx.lights.guard.push({
          x: -44,
          y: 0.52,
          z: z + side * (width / 2 + 1.4) + pair * 1.1,
          color: 0xffc21f,
          gain: 0
        });
      }
    }
  }
  taxi.add(paintMesh(yellow, materials.yellowPaint, 0.016));

  /* 滑行道边灯（蓝）+ 中线灯（绿） */
  const blue = [];
  const green = [];
  for (let z = -2050; z <= 2050; z += 60) {
    blue.push({ x: -122.8, y: 0.2, z, color: 0x2f7bff, gain: 1.1 });
    blue.push({ x: -35.4, y: 0.2, z, color: 0x2f7bff, gain: 1.1 });
  }
  for (let z = -2040; z <= 2040; z += 30) green.push({ x: TAXIWAY_A_X, y: 0.09, z, color: 0x2df07a, gain: 0.95 });
  for (const connector of CONNECTORS) {
    for (let x = -110; x <= -26; x += 21) {
      green.push({ x, y: 0.09, z: connector.z, color: 0x2df07a, gain: 0.9 });
      blue.push({ x, y: 0.2, z: connector.z - connector.width / 2 - 0.8, color: 0x2f7bff, gain: 1 });
      blue.push({ x, y: 0.2, z: connector.z + connector.width / 2 + 0.8, color: 0x2f7bff, gain: 1 });
    }
  }
  ctx.lights.taxiwayEdge.push(...blue);
  ctx.lights.taxiwayCenter.push(...green);

  /* 滑行道指示牌 */
  for (const connector of CONNECTORS) {
    const atRunway = connector.z === 0 || connector.z === APRON_TAXILANE_Z;
    taxi.add(createSign(materials, textSignTexture({ text: connector.label, width: 320, height: 160, fontSize: 108 }), {
      x: -78,
      z: connector.z + connector.width / 2 + 6,
      ry: -Math.PI / 2,
      width: 3.6,
      height: 1.6,
      postHeight: 1.6
    }));
    taxi.add(createSign(materials, textSignTexture({
      text: '18-36',
      background: '#b1261f',
      color: '#ffffff',
      border: '#ffffff',
      width: 512,
      height: 160,
      fontSize: 96
    }), {
      x: atRunway ? -30 : -60,
      z: connector.z + connector.width / 2 + 6,
      ry: -Math.PI / 2,
      width: 5.4,
      height: 1.6,
      postHeight: 1.6
    }));
  }
  taxi.add(createSign(materials, textSignTexture({ text: 'A', width: 256, height: 160, fontSize: 116 }), {
    x: -122, z: -1200, ry: -Math.PI / 2, width: 2.6, height: 1.6, postHeight: 1.7
  }));
  taxi.add(createSign(materials, textSignTexture({ text: 'A6  ↑', width: 448, height: 160, fontSize: 92 }), {
    x: -122, z: 1620, ry: -Math.PI / 2, width: 4.4, height: 1.6, postHeight: 1.7
  }));

  return taxi;
}

/* ------------------------------------------------------------------ */
/* 停机坪 / 混凝土场地                                                 */
/* ------------------------------------------------------------------ */

function createApron(ctx) {
  const { group, materials } = ctx;
  const apron = new THREE.Group();
  apron.name = 'apron';
  group.add(apron);

  const width = APRON.maxX - APRON.minX;
  const depth = APRON.maxZ - APRON.minZ;
  const centerX = (APRON.minX + APRON.maxX) / 2;
  const centerZ = (APRON.minZ + APRON.maxZ) / 2;
  apron.add(horizontalPlane(width + 40, depth + 40, materials.apronConcrete, centerX - 10, SURFACE_Y - 0.004, centerZ));

  for (const area of [SERVICE_SOUTH, SERVICE_NORTH]) {
    apron.add(horizontalPlane(
      area.maxX - area.minX,
      area.maxZ - area.minZ,
      materials.rampConcrete,
      (area.minX + area.maxX) / 2,
      SURFACE_Y - 0.016,
      (area.minZ + area.maxZ) / 2
    ));
  }

  /* 机坪滑行通道：东西主通道 + 东西两侧南北通道 */
  const taxilanes = [
    { x: -220, z: APRON_TAXILANE_Z, w: 320, d: 26 },
    { x: -180, z: 1685, w: 26, d: 370 },
    { x: -390, z: 1685, w: 26, d: 370 }
  ];
  for (const lane of taxilanes) {
    apron.add(horizontalPlane(lane.w, lane.d, materials.taxiAsphalt, lane.x, SURFACE_Y, lane.z));
  }

  const yellow = [];
  for (const lane of taxilanes) {
    if (lane.w > lane.d) {
      for (const item of straightTransforms(lane.x - lane.w / 2, lane.z, lane.x + lane.w / 2, lane.z, 0.3, PAINT_Y)) yellow.push(item);
    } else {
      for (const item of straightTransforms(lane.x, lane.z - lane.d / 2, lane.x, lane.z + lane.d / 2, 0.3, PAINT_Y)) yellow.push(item);
    }
  }

  /* 停机位引入线 + 停止横线 + 机位号
   * 1/2/3 号为廊桥近机位（机头朝西对着航站楼），4/5/6 号为远机位（机头朝东）。
   * 6 号位停止点 x = -266、z = 1600，与 scenarios.js 中冷舱起始点 (-280, 1600) 对齐：
   * 飞机中心在 (-280, 1600)、机头朝东（heading = π/2）时，前轮正好压在引入线上。 */
  const passengerStands = [
    { id: '1', z: 1820, noseX: -450, taxiX: -390 },
    { id: '2', z: 1710, noseX: -450, taxiX: -390 },
    { id: '3', z: 1600, noseX: -450, taxiX: -390 }
  ];
  const remoteStands = [
    { id: '4', z: 1820, noseX: -266, taxiX: -180 },
    { id: '5', z: 1710, noseX: -266, taxiX: -180 },
    { id: '6', z: 1600, noseX: -266, taxiX: -180 }
  ];
  ctx.stands = { passenger: passengerStands, remote: remoteStands };

  for (const stand of [...passengerStands, ...remoteStands]) {
    for (const item of straightTransforms(stand.taxiX, stand.z, stand.noseX - 6, stand.z, 0.3, PAINT_Y)) yellow.push(item);
    yellow.push({ x: stand.noseX, y: PAINT_Y, z: stand.z, w: 0.4, d: 8 });
    yellow.push({ x: stand.noseX - 2.5, y: PAINT_Y, z: stand.z - 4.5, w: 1.4, d: 0.35 });
    yellow.push({ x: stand.noseX - 2.5, y: PAINT_Y, z: stand.z + 4.5, w: 1.4, d: 0.35 });
  }
  apron.add(paintMesh(yellow, materials.yellowPaint, 0.016));

  for (const stand of [...passengerStands, ...remoteStands]) {
    const texture = standNumberTexture(stand.id);
    const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.85, depthWrite: false });
    const plane = horizontalPlane(4, 6, material, stand.noseX + 8, PAINT_Y + 0.014, stand.z - 13);
    plane.rotation.z = Math.PI / 2;
    apron.add(plane);
    apron.add(createSign(materials, textSignTexture({
      text: stand.id,
      background: '#123a6b',
      color: '#ffffff',
      border: '#ffffff',
      width: 256,
      height: 256,
      fontSize: 150
    }), {
      x: stand.taxiX - 8,
      z: stand.z + 9,
      ry: Math.PI,
      width: 1.8,
      height: 1.8,
      postHeight: 1.5
    }));
  }

  /* 机坪井盖、油污、轮胎印 */
  const random = randomGenerator(448021);
  const covers = [];
  for (let index = 0; index < 34; index += 1) {
    const x = APRON.minX + 20 + random() * (APRON.maxX - APRON.minX - 40);
    const z = APRON.minZ + 20 + random() * (APRON.maxZ - APRON.minZ - 40);
    covers.push({ x, y: SURFACE_Y + 0.008, z, sx: 0.85 + random() * 0.5, sy: 0.02, sz: 0.85 + random() * 0.5 });
  }
  apron.add(instanced(new THREE.BoxGeometry(1, 0.02, 1), materials.manhole, covers, { name: 'manholes' }));

  const stains = [];
  const allStands = [...passengerStands, ...remoteStands];
  for (let index = 0; index < 42; index += 1) {
    const onStand = index < 24;
    const stand = allStands[index % allStands.length];
    stains.push({
      x: onStand ? stand.noseX + 12 - random() * 26 : APRON.minX + 30 + random() * (APRON.maxX - APRON.minX - 60),
      y: DECAL_Y,
      z: onStand ? stand.z + (random() - 0.5) * 16 : APRON.minZ + 30 + random() * (APRON.maxZ - APRON.minZ - 60),
      sx: 4 + random() * 12,
      sy: 1,
      sz: 4 + random() * 12,
      ry: random() * Math.PI
    });
  }
  const stainGeometry = new THREE.PlaneGeometry(1, 1);
  stainGeometry.rotateX(-Math.PI / 2);
  apron.add(instanced(stainGeometry, materials.oilStain, stains, { name: 'oilStains' }));

  const tireMarks = allStands.map((stand) => ({
    x: stand.noseX - 52,
    y: DECAL_Y,
    z: stand.z,
    sx: 120,
    sy: 1,
    sz: 14,
    ry: 0
  }));
  const markGeometry = new THREE.PlaneGeometry(1, 1);
  markGeometry.rotateX(-Math.PI / 2);
  apron.add(instanced(markGeometry, materials.rubberLight, tireMarks, { name: 'apronTireMarks' }));

  return apron;
}

/* ------------------------------------------------------------------ */
/* 灯光系统                                                            */
/* ------------------------------------------------------------------ */

const LIGHT_CLASSES = {
  runwayEdge: { day: 0.14, night: 1, daySize: 2.6, nightSize: 3.6 },
  runwayThreshold: { day: 0.16, night: 1, daySize: 2.8, nightSize: 3.8 },
  runwayEnd: { day: 0.16, night: 1, daySize: 2.8, nightSize: 3.8 },
  taxiwayEdge: { day: 0.1, night: 0.92, daySize: 1.9, nightSize: 2.7 },
  taxiwayCenter: { day: 0.08, night: 0.8, daySize: 1.6, nightSize: 2.2 },
  approach: { day: 0.1, night: 1, daySize: 3, nightSize: 4.4 },
  flood: { day: 0.02, night: 0.95, daySize: 2.2, nightSize: 3.2 },
  obstruction: { day: 0.2, night: 0.95, daySize: 1.8, nightSize: 2.4 },
  flasher: { day: 0, night: 1, daySize: 2.6, nightSize: 3.8, dynamic: true },
  papi: { day: 0.1, night: 1, daySize: 2.4, nightSize: 3.2, dynamic: true },
  guard: { day: 0.05, night: 1, daySize: 1.8, nightSize: 2.6, dynamic: true }
};

const PAPI_UNIT_ANGLES = [2.75, 2.9, 3.1, 3.25];

function createLighting(ctx) {
  const { group, materials, lights } = ctx;

  for (let z = THRESHOLD_36; z <= THRESHOLD_18; z += 60) {
    const color = Math.abs(z) > 1200 ? 0xffcd55 : 0xf1f6ff;
    for (const side of [-1, 1]) {
      lights.runwayEdge.push({ x: side * (RUNWAY_HALF_WIDTH + 1.1), y: 0.36, z, color, gain: 1.15 });
    }
  }

  for (const [threshold, inward] of [[THRESHOLD_36, 1], [THRESHOLD_18, -1]]) {
    for (let x = -21; x <= 21; x += 3) {
      lights.runwayThreshold.push({ x, y: 0.36, z: threshold + inward * 0.8, color: 0x38f78f, gain: 1.05 });
      lights.runwayEnd.push({ x: x + 1.5, y: 0.36, z: threshold - inward * 1.6, color: 0xff4a3a, gain: 1.05 });
    }
  }

  /* 进近灯光系统：中线灯 + 横排灯 + 顺序闪光灯 */
  const approachSupports = [];
  const barSupports = [];
  for (const [threshold, inward] of [[THRESHOLD_36, 1], [THRESHOLD_18, -1]]) {
    for (let distance = 30; distance <= 900; distance += 30) {
      const z = threshold - inward * distance;
      const y = groundHeight(0, z);
      lights.approach.push({ x: 0, y: y + 1.15, z, color: 0xf7f3e4, gain: 1.1 });
      approachSupports.push({ x: 0, y: y + 0.58, z, sx: 0.16, sy: 1.16, sz: 0.16 });
    }
    for (const distance of [150, 300, 450, 600, 750]) {
      const z = threshold - inward * distance;
      const y = groundHeight(0, z);
      const spread = distance === 300 ? [-18, -13.5, -9, -4.5, 0, 4.5, 9, 13.5, 18] : [-9, -6, -3, 0, 3, 6, 9];
      for (const x of spread) {
        lights.approach.push({ x, y: y + 0.92, z, color: 0xf7f3e4, gain: distance === 300 ? 1.15 : 1 });
      }
      barSupports.push({ x: 0, y: y + 0.72, z, sx: (spread[spread.length - 1] - spread[0]) + 0.8, sy: 0.22, sz: 0.28 });
      for (const x of [spread[0], spread[spread.length - 1]]) {
        barSupports.push({ x, y: y + 0.36, z, sx: 0.16, sy: 0.72, sz: 0.16 });
      }
    }
    for (let index = 0; index < 12; index += 1) {
      const distance = 390 + index * 50;
      const z = threshold - inward * distance;
      const y = groundHeight(0, z);
      lights.flasher.push({ x: 0, y: y + 1.6, z, color: 0xfdfbef, gain: 0 });
      approachSupports.push({ x: 0, y: y + 0.85, z, sx: 0.15, sy: 1.7, sz: 0.15 });
    }
  }
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.lightPole, approachSupports, { name: 'approachSupports', castShadow: true }));
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.lightPole, barSupports, { name: 'approachBars', castShadow: true }));

  /* PAPI：每端 4 灯，位于跑道入口内 300 m、跑道边外侧 */
  const papiBanks = [];
  const papiSupports = [];
  for (const item of [
    { threshold: THRESHOLD_36, z: THRESHOLD_36 + 300, side: -1 },
    { threshold: THRESHOLD_18, z: THRESHOLD_18 - 300, side: 1 }
  ]) {
    const bank = { points: [], indices: [], baseAngle: 0, z: item.z, y: 1.05 };
    for (let unit = 0; unit < 4; unit += 1) {
      const x = item.side * (25.5 + unit * 3);
      papiSupports.push({ x, y: 0.42, z: item.z, sx: 1.1, sy: 0.84, sz: 0.8 });
      papiSupports.push({ x, y: 0.9, z: item.z, sx: 1.3, sy: 0.12, sz: 1 });
      bank.indices.push(lights.papi.length);
      lights.papi.push({ x, y: 1.05, z: item.z, color: 0xff3b2f, gain: 1.1 });
    }
    bank.z = item.z;
    bank.side = item.side;
    papiBanks.push(bank);
  }
  group.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.lightBase, papiSupports, { name: 'papiSupports', castShadow: true }));

  /* 高杆泛光灯盘光晕 */
  for (const mast of ctx.masts) {
    for (const offset of [-1.9, -0.65, 0.65, 1.9]) {
      lights.flood.push({ x: mast.x + offset, y: mast.height + 0.4, z: mast.z, color: 0xffe9b8, gain: 1.05 });
    }
  }
  for (const beacon of ctx.obstructionLights) {
    lights.obstruction.push({ x: beacon.x, y: beacon.y, z: beacon.z, color: 0xff3f32, gain: 1.1 });
  }

  const classes = [];
  const meshes = {};
  for (const [name, spec] of Object.entries(LIGHT_CLASSES)) {
    const points = lights[name];
    if (!points || points.length === 0) continue;
    const material = new THREE.PointsMaterial({
      map: materials.glow,
      size: spec.nightSize,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: spec.night,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });
    const mesh = lightEntries(points, material, { name: `lights:${name}`, dynamic: spec.dynamic });
    group.add(mesh);
    meshes[name] = mesh;
    classes.push({ name, material, ...spec });
  }

  return { classes, meshes, papiBanks, flasherCount: 12 };
}

/* ------------------------------------------------------------------ */
/* 建筑与环境                                                          */
/* ------------------------------------------------------------------ */

function createTerminal(ctx) {
  const { group, materials } = ctx;
  const terminal = new THREE.Group();
  terminal.name = 'terminal';
  group.add(terminal);

  const centerZ = 1625;
  terminal.add(boxMesh(88, 16, 300, materials.wall, -520, 8, centerZ));
  terminal.add(boxMesh(96, 2.2, 308, materials.roof, -520, 17, centerZ));
  terminal.add(boxMesh(2.4, 11, 292, materials.terminalGlass, -474.6, 8.5, centerZ));
  terminal.add(boxMesh(6, 4, 312, materials.darkWall, -471.5, 15.3, centerZ));
  terminal.add(boxMesh(4, 1.6, 316, materials.roof, -470, 18, centerZ));

  const mullions = [];
  for (let z = 1478; z <= 1772; z += 7.5) mullions.push({ x: -474.2, y: 8.5, z, sx: 0.3, sy: 11.4, sz: 0.5 });
  for (let z = 1480; z <= 1770; z += 30) mullions.push({ x: -473.6, y: 8.5, z, sx: 0.7, sy: 11.6, sz: 1.2 });
  terminal.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.darkWall, mullions, { name: 'terminalMullions' }));

  /* 屋顶设备 */
  const roofUnits = [];
  const random = randomGenerator(77213);
  for (let index = 0; index < 16; index += 1) {
    roofUnits.push({
      x: -540 + random() * 50,
      y: 19,
      z: 1480 + index * 18,
      sx: 2.6 + random() * 1.6,
      sy: 1.6,
      sz: 3.4 + random() * 2
    });
  }
  terminal.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.metal, roofUnits, { name: 'roofUnits', castShadow: true }));
  terminal.add(boxMesh(6, 4.5, 6, materials.metal, -548, 20.4, 1520));
  terminal.add(boxMesh(6, 4.5, 6, materials.metal, -548, 20.4, 1740));

  /* 入口雨棚与门厅 */
  for (const z of [1475, 1625, 1775]) {
    terminal.add(boxMesh(14, 0.7, 18, materials.roof, -462, 6.4, z));
    terminal.add(boxMesh(1.2, 6.4, 1.2, materials.darkWall, -456, 3.2, z - 8));
    terminal.add(boxMesh(1.2, 6.4, 1.2, materials.darkWall, -456, 3.2, z + 8));
  }

  /* 玻璃廊桥：通向 1/2/3 号近机位。三座尺寸一致，按材质合并后实例化复用。 */
  const bridge = partCollector();
  const bridgeAdd = bridge.add.bind(bridge);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 14);
  bridgeAdd(materials.bridgeBody, unitBox, { x: -455, y: 4.3, z: -14, sx: 38, sy: 1.4, sz: 4.6 });
  bridgeAdd(materials.bridgeBody, unitCylinder, { x: -436, y: 4.3, z: -14, sx: 3.4, sy: 1.6, sz: 3.4 });
  bridgeAdd(materials.bridgeBody, unitBox, { x: -433, y: 4.3, z: -8.5, sx: 3.4, sy: 1.2, sz: 11 });
  bridgeAdd(materials.bridgeBody, unitBox, { x: -433, y: 4.3, z: -3, sx: 3.8, sy: 1.5, sz: 1.6 });
  bridgeAdd(materials.darkWall, unitBox, { x: -452, y: 1.8, z: -14, sx: 1, sy: 3.6, sz: 1 });
  bridgeAdd(materials.darkWall, unitBox, { x: -437, y: 1.8, z: -11, sx: 1, sy: 3.6, sz: 1 });
  for (const offset of [-2, -1, 0, 1, 2]) {
    bridgeAdd(materials.metal, unitBox, { x: -433.9, y: 4.3, z: -3 + offset * 1.2, sx: 0.16, sy: 1.4, sz: 1.6 });
  }
  const bridgeGeometries = new Map();
  for (const [material, parts] of bridge.buckets) bridgeGeometries.set(material, mergeParts(parts));
  unitBox.dispose();
  unitCylinder.dispose();
  const bridgeStands = [1820, 1710, 1600].map((z) => ({ x: 0, y: 0, z }));
  for (const [material, geometry] of bridgeGeometries) {
    terminal.add(instanced(geometry, material, bridgeStands, { name: 'jetBridge', castShadow: true }));
  }

  return terminal;
}

function createTower(ctx) {
  const { group, materials } = ctx;
  const tower = new THREE.Group();
  tower.name = 'tower';
  group.add(tower);
  const x = -600;
  const z = 1810;

  tower.add(boxMesh(24, 5, 24, materials.wall, x, 2.5, z));
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 6, 32, 14), materials.wall);
  shaft.position.set(x, 21, z);
  shaft.castShadow = true;
  tower.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 6.4, 16), materials.terminalGlass);
  cab.position.set(x, 40, z);
  cab.castShadow = true;
  tower.add(cab);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 0.6, 16), materials.metal);
  ring.position.set(x, 43.4, z);
  tower.add(ring);
  tower.add(boxMesh(0.4, 7, 0.4, materials.darkWall, x, 47, z));

  const radar = new THREE.Group();
  radar.position.set(x, 47.4, z);
  radar.add(boxMesh(0.5, 0.5, 3.4, materials.metal, 0, 0, 0));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.8, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), materials.metal);
  dish.rotation.x = Math.PI / 2.4;
  dish.position.set(0, 0.7, 1.2);
  radar.add(dish);
  tower.add(radar);

  const beaconLamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), materials.beaconLamp);
  beaconLamp.position.set(x, 51.6, z);
  tower.add(beaconLamp);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 26, 12, 1, true), materials.beaconBeam);
  beam.rotation.z = Math.PI / 2;
  beam.position.set(x, 51.6, z);
  tower.add(beam);

  ctx.obstructionLights.push({ x, y: 43.6, z: z + 7.6 }, { x, y: 51.4, z });
  return { radar, beaconLamp, beam };
}

function createHangars(ctx) {
  const { group, materials } = ctx;
  const hangars = new THREE.Group();
  hangars.name = 'hangars';
  group.add(hangars);
  const shape = new THREE.Shape();
  shape.moveTo(-56, 0);
  shape.lineTo(0, 19);
  shape.lineTo(56, 0);
  shape.closePath();
  const roofGeometry = new THREE.ExtrudeGeometry(shape, { depth: 110, bevelEnabled: false });

  const ribs = [];
  for (const z of [1450, 1620]) {
    hangars.add(boxMesh(110, 15, 110, materials.darkWall, -790, 7.5, z));
    const roof = new THREE.Mesh(roofGeometry, materials.roof);
    roof.position.set(-790, 15, z - 55);
    roof.castShadow = true;
    hangars.add(roof);
    hangars.add(boxMesh(0.9, 14, 88, materials.hangarDoor, -734.6, 7, z));
    for (let offset = -40; offset <= 40; offset += 10) {
      ribs.push({ x: -734.2, y: 7, z: z + offset, sx: 1.1, sy: 14, sz: 0.5 });
    }
    hangars.add(boxMesh(6, 4, 14, materials.wall, -838, 2, z + 62));
    ctx.obstructionLights.push({ x: -790, y: 35.5, z });
  }
  hangars.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.darkWall, ribs, { name: 'hangarRibs' }));
  return hangars;
}

function createCargoArea(ctx) {
  const { group, materials } = ctx;
  const cargo = new THREE.Group();
  cargo.name = 'cargo';
  group.add(cargo);

  cargo.add(boxMesh(150, 13, 80, materials.wallLight, -720, 6.5, -1620));
  cargo.add(boxMesh(158, 1.6, 88, materials.roof, -720, 13.8, -1620));
  cargo.add(boxMesh(120, 11, 60, materials.wallLight, -420, 5.5, -1700));
  cargo.add(boxMesh(126, 1.4, 66, materials.roof, -420, 11.5, -1700));
  for (const z of [-1660, -1580]) {
    cargo.add(boxMesh(0.8, 8, 20, materials.hangarDoor, -644, 4, z));
  }

  const random = randomGenerator(5150);
  const containers = [];
  const containerColors = [0xb4553c, 0x2f6a92, 0x3f7a4a, 0xa8983c, 0x8a8f94];
  const colors = [];
  for (let row = 0; row < 26; row += 1) {
    const stack = Math.floor(random() * 3);
    const baseX = -960 + random() * 200;
    const baseZ = -1780 + random() * 60;
    for (let level = 0; level <= stack; level += 1) {
      containers.push({ x: baseX, y: 1.3 + level * 2.6, z: baseZ, sx: 2.6, sy: 2.6, sz: 12.2 });
      colors.push(containerColors[Math.floor(random() * containerColors.length)]);
    }
  }
  cargo.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.container, containers, { colors, name: 'containers', castShadow: true }));

  const loaders = [];
  for (let index = 0; index < 8; index += 1) {
    loaders.push({
      x: -660 + random() * 180,
      y: 0.9,
      z: -1560 - random() * 120,
      sx: 3.4,
      sy: 1.8,
      sz: 6.4,
      ry: random() > 0.5 ? Math.PI / 2 : 0
    });
  }
  cargo.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.forklift, loaders, { name: 'cargoLoaders', castShadow: true }));

  const yellow = [];
  for (const item of straightTransforms(-980, -1460, -200, -1460, 0.3, PAINT_Y)) yellow.push(item);
  for (const item of straightTransforms(-700, -1420, -700, -1780, 0.3, PAINT_Y)) yellow.push(item);
  cargo.add(paintMesh(yellow, materials.yellowPaint, 0.016));
  return cargo;
}

function createFireStation(ctx) {
  const { group, materials } = ctx;
  const station = new THREE.Group();
  station.name = 'fireStation';
  group.add(station);
  const x = -250;
  const z = -1730;

  station.add(boxMesh(38, 8, 30, materials.wallLight, x, 4, z));
  station.add(boxMesh(42, 1.4, 34, materials.roof, x, 8.6, z));
  for (const offset of [-10, 0, 10]) {
    station.add(boxMesh(0.8, 5.6, 8, materials.hangarDoor, x + 19.4, 2.8, z + offset));
  }
  station.add(boxMesh(4, 14, 4, materials.wall, x - 14, 7, z - 12));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 12, 8), materials.lightPole);
  mast.position.set(x + 22, 6, z - 16);
  station.add(mast);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), materials.floodLamp);
  lamp.position.set(x + 22, 12, z - 16);
  station.add(lamp);

  for (const offset of [-10, 0, 10]) {
    const truck = createVehicle('fire', materials, x + 26, z + offset, Math.PI / 2);
    station.add(truck);
  }
  return station;
}

function createVehicle(kind, materials, x, z, ry) {
  const group = new THREE.Group();
  group.position.set(x, groundHeight(x, z), z);
  group.rotation.y = ry;
  if (kind === 'bus') {
    group.add(boxMesh(2.6, 2.4, 11, materials.vehicleBody, 0, 1.7, 0));
    group.add(boxMesh(2.68, 0.9, 9.4, materials.vehicleGlass, 0, 2.5, -0.2));
    group.add(boxMesh(2.4, 0.3, 11, materials.vehicleTrim, 0, 1.0, 0));
  } else if (kind === 'fuel') {
    group.add(boxMesh(2.4, 1.1, 8.6, materials.vehicleTrim, 0, 1.15, 0));
    group.add(boxMesh(2.2, 1.6, 2.6, materials.vehicleBody, 0, 2.2, 3.6));
    group.add(boxMesh(2.3, 1.1, 2.2, materials.vehicleGlass, 0, 2.5, 3.9));
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 5.4, 16), materials.fuelTank);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, 2.5, -1.2);
    tank.castShadow = true;
    group.add(tank);
  } else if (kind === 'fire') {
    group.add(boxMesh(2.5, 2.2, 9.2, materials.fireTruck, 0, 1.5, 0));
    group.add(boxMesh(2.5, 1.4, 2.6, materials.fireTruck, 0, 2.9, 2.6));
    group.add(boxMesh(2.56, 0.9, 1.4, materials.vehicleGlass, 0, 3.3, 3.1));
    group.add(boxMesh(2.3, 0.5, 6.4, materials.vehicleBody, 0, 2.8, -1.2));
    const ladder = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 6.4, 8), materials.metal);
    ladder.rotation.x = Math.PI / 2;
    ladder.position.set(0, 3.5, -1);
    group.add(ladder);
  } else {
    group.add(boxMesh(1.9, 0.8, 3.4, materials.vehicleBody, 0, 0.75, 0));
    group.add(boxMesh(1.7, 1.1, 1.6, materials.vehicleGlass, 0, 1.5, 0.9));
    group.add(boxMesh(1.9, 0.4, 1.6, materials.vehicleTrim, 0, 1.35, -1.1));
  }
  const wheels = [];
  for (const side of [-1, 1]) {
    for (const offset of kind === 'fire' || kind === 'bus' ? [-3.2, 3.2] : [-1.2, 1.5]) {
      wheels.push({ x: side * 1.15, y: 0.5, z: offset, sx: 0.34, sy: 1, sz: 1 });
    }
  }
  const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.34, 12);
  wheelGeometry.rotateZ(Math.PI / 2);
  group.add(instanced(wheelGeometry, materials.tire, wheels, { name: 'wheels' }));
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return group;
}

function createParkingLot(ctx) {
  const { group, materials } = ctx;
  const lot = new THREE.Group();
  lot.name = 'parking';
  group.add(lot);
  const random = randomGenerator(60671);

  lot.add(horizontalPlane(92, 300, materials.parkingDeck, -660, SURFACE_Y - 0.002, 1555));

  const lines = [];
  for (let row = 0; row < 6; row += 1) {
    const x = -700 + row * 16;
    for (const item of straightTransforms(x, 1440, x, 1670, 0.14, PAINT_Y)) lines.push(item);
  }
  for (let z = 1440; z <= 1670; z += 2.8) {
    for (let row = 0; row < 6; row += 1) {
      lines.push({ x: -700 + row * 16 + 8, y: PAINT_Y, z, w: 16, d: 0.14 });
    }
  }
  lot.add(paintMesh(lines, materials.paint, 0.012));

  const cars = [];
  const colors = [0xc9ccd0, 0x2f3b4a, 0x8c2f2a, 0x1f5c3c, 0x4c4f55, 0xa8b3bd, 0x1c1e21, 0xb2873a];
  const carColors = [];
  for (let row = 0; row < 6; row += 1) {
    for (let index = 0; index < 22; index += 1) {
      if (random() < 0.35) continue;
      cars.push({
        x: -700 + row * 16 + 8,
        y: 0.75,
        z: 1442 + index * 2.8,
        sx: 1.85,
        sy: 1.4,
        sz: 4.3,
        ry: row % 2 === 0 ? 0 : Math.PI
      });
      carColors.push(colors[Math.floor(random() * colors.length)]);
    }
  }
  lot.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.car, cars, { colors: carColors, name: 'cars', castShadow: true }));

  const poleTransforms = [];
  const lampTransforms = [];
  for (const x of [-700, -600]) {
    for (let z = 1460; z <= 1660; z += 66) {
      poleTransforms.push({ x, y: 5, z, sx: 0.28, sy: 10, sz: 0.28 });
      lampTransforms.push({ x, y: 10.3, z, sx: 0.9, sy: 0.35, sz: 2 });
      ctx.obstructionLights.push({ x, y: 10.4, z });
    }
  }
  lot.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.lightPole, poleTransforms, { name: 'parkingPoles', castShadow: true }));
  lot.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.floodLamp, lampTransforms, { name: 'parkingLamps' }));

  for (let index = 0; index < 3; index += 1) {
    const bus = createVehicle('bus', materials, -570, 1470 + index * 40, 0);
    lot.add(bus);
  }
  return lot;
}

function createLightMasts(ctx) {
  const { group, materials } = ctx;
  const masts = new THREE.Group();
  masts.name = 'lightMasts';
  group.add(masts);
  const poles = [];
  const heads = [];
  const ctxMasts = [];
  for (const x of [-455, -180]) {
    for (const z of [1520, 1680, 1830]) {
      const height = 22;
      ctxMasts.push({ x, z, height });
      poles.push({ x, y: height / 2, z, sx: 0.5, sy: height, sz: 0.5 });
      heads.push({ x, y: height + 0.4, z, sx: 5.4, sy: 0.7, sz: 1.4 });
      ctx.obstructionLights.push({ x, y: height + 1.2, z, mast: true });
    }
  }
  masts.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.lightPole, poles, { name: 'mastPoles', castShadow: true }));
  masts.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.floodLamp, heads, { name: 'mastHeads' }));
  ctx.masts = ctxMasts;
  return masts;
}

function createRoads(ctx) {
  const { group, materials } = ctx;
  const roads = new THREE.Group();
  roads.name = 'roads';
  group.add(roads);
  roads.add(horizontalPlane(8, 3900, materials.road, -880, SURFACE_Y - 0.008, 0));
  roads.add(horizontalPlane(960, 8, materials.road, -520, SURFACE_Y - 0.008, 1400));
  roads.add(horizontalPlane(560, 8, materials.road, -250, SURFACE_Y - 0.008, 1880));
  roads.add(horizontalPlane(400, 8, materials.road, -380, SURFACE_Y - 0.008, 1910));
  const marks = [];
  for (let z = -1900; z <= 1900; z += 24) {
    marks.push({ x: -880, y: PAINT_Y - 0.012, z, w: 0.16, d: 8 });
  }
  roads.add(paintMesh(marks, materials.paint, 0.01));
  return roads;
}

function createFence(ctx) {
  const { group, materials } = ctx;
  const fence = new THREE.Group();
  fence.name = 'fence';
  group.add(fence);
  const posts = [];
  const wirePositions = [];
  const addSide = (x1, z1, x2, z2) => {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.max(1, Math.ceil(length / 45));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const x = lerp(x1, x2, t);
      const z = lerp(z1, z2, t);
      posts.push({ x, y: groundHeight(x, z) + 1.3, z, sx: 0.14, sy: 2.6, sz: 0.14 });
    }
    for (const height of [0.6, 1.3, 2.1]) {
      const y1 = groundHeight(x1, z1) + height;
      const y2 = groundHeight(x2, z2) + height;
      wirePositions.push(x1, y1, z1, x2, y2, z2);
    }
  };
  addSide(-1000, -2300, 1000, -2300);
  addSide(1000, -2300, 1000, 2300);
  addSide(1000, 2300, -1000, 2300);
  addSide(-1000, 2300, -1000, -2300);
  fence.add(instanced(new THREE.BoxGeometry(1, 1, 1), materials.fencePost, posts, { name: 'fencePosts', castShadow: true }));
  const wireGeometry = new THREE.BufferGeometry();
  wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wirePositions, 3));
  fence.add(new THREE.LineSegments(wireGeometry, materials.fenceWire));

  /* 大门与门卫房 */
  const gate = new THREE.Group();
  gate.position.set(-1000, 0, 1560);
  gate.add(boxMesh(6, 3.4, 9, materials.wallLight, 0, 1.7, 0));
  gate.add(boxMesh(8, 1.2, 11, materials.roof, 0, 3.9, 0));
  gate.add(boxMesh(0.4, 6, 0.4, materials.lightPole, 0, 3, -8));
  gate.add(boxMesh(0.4, 6, 0.4, materials.lightPole, 0, 3, 8));
  gate.add(boxMesh(9.6, 0.4, 0.4, materials.lightPole, 0, 6, -8));
  gate.add(boxMesh(0.5, 1.2, 9, materials.metal, 0, 1.2, -14));
  fence.add(gate);
  return fence;
}

function createWindsocks(ctx) {
  const { group, materials } = ctx;
  const pivots = [];
  for (const [x, z] of [[118, -1120], [118, 1120]]) {
    const root = new THREE.Group();
    root.position.set(x, groundHeight(x, z), z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 10, 8), materials.lightPole);
    pole.position.y = 5;
    pole.castShadow = true;
    root.add(pole);
    const pivot = new THREE.Group();
    pivot.position.y = 9.6;
    pivot.rotation.order = 'YXZ';
    const sockGeometry = new THREE.CylinderGeometry(0.24, 0.78, 4.4, 18, 1, true);
    sockGeometry.rotateX(Math.PI / 2);
    const sock = new THREE.Mesh(sockGeometry, materials.windsock);
    sock.position.z = 2.2;
    pivot.add(sock);
    for (let index = 0; index < 3; index += 1) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.34 + index * 0.16, 0.09, 6, 16), materials.windsockBand);
      band.position.z = 0.6 + index * 1.35;
      band.scale.set(1, 1, 0.7);
      pivot.add(band);
    }
    root.add(pivot);
    group.add(root);
    pivots.push(pivot);
  }
  return pivots;
}

/* 把若干带变换的几何体合并成一块 BufferGeometry（同材质合批），减少 draw call。 */
function mergeParts(parts) {
  const prepared = [];
  let total = 0;
  for (const part of parts) {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    geometry.applyMatrix4(part.matrix);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    prepared.push(geometry);
    total += geometry.attributes.position.count;
  }
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let offset = 0;
  for (const geometry of prepared) {
    position.set(geometry.attributes.position.array, offset * 3);
    normal.set(geometry.attributes.normal.array, offset * 3);
    if (geometry.attributes.uv) uv.set(geometry.attributes.uv.array, offset * 2);
    offset += geometry.attributes.position.count;
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

function partCollector() {
  const buckets = new Map();
  return {
    buckets,
    add(material, geometry, options = {}) {
      const {
        x = 0, y = 0, z = 0,
        rx = 0, ry = 0, rz = 0,
        sx = 1, sy = 1, sz = 1
      } = options;
      if (!buckets.has(material)) buckets.set(material, []);
      const matrix = new THREE.Matrix4();
      matrix.compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
        new THREE.Vector3(sx, sy, sz)
      );
      buckets.get(material).push({ geometry, matrix });
    }
  };
}

/* 停机坪上的两架停场客机：按材质合并成 6 块几何体，两架共用同一份几何数据。 */
function createParkedAirliners(ctx) {
  const { group, materials } = ctx;
  const root = new THREE.Group();
  root.name = 'parkedAircraft';
  group.add(root);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 22);
  const unitCone = new THREE.ConeGeometry(1, 1, 20);
  const unitSphere = new THREE.SphereGeometry(1, 20, 14);
  const collector = partCollector();
  const add = collector.add.bind(collector);

  add(materials.airlinerBody, unitCylinder, { y: 4.1, rx: Math.PI / 2, sx: 2.05, sy: 32, sz: 2.05 });
  add(materials.airlinerBody, unitSphere, { y: 4.1, z: 14.6, sx: 2.05, sy: 2.05, sz: 2.4 });
  add(materials.airlinerBody, unitCone, { y: 4.6, z: -17.6, rx: -Math.PI / 2, sx: 2.05, sy: 7.2, sz: 2.05 });
  for (const side of [-1, 1]) {
    add(materials.airlinerBody, unitBox, { x: side * 10.5, y: 3.7, z: -0.8, ry: side * 0.33, sx: 17, sy: 0.42, sz: 5 });
    add(materials.airlinerBody, unitBox, { x: side * 3.6, y: 5.4, z: -20.6, ry: side * 0.4, sx: 6, sy: 0.34, sz: 3 });
    add(materials.airlinerBody, unitBox, { x: side * 6.4, y: 3.3, z: 2.4, sx: 0.4, sy: 1.2, sz: 2.6 });
    add(materials.airlinerEngine, unitCylinder, { x: side * 6.6, y: 2.5, z: 2.6, rx: Math.PI / 2, sx: 1.15, sy: 3.4, sz: 1.15 });
    add(materials.airlinerTail, unitBox, { x: side * 2.06, y: 4.6, z: -1, sx: 0.06, sy: 0.5, sz: 26 });
    add(materials.vehicleGlass, unitBox, { x: side * 2.12, y: 4.2, z: -1, sx: 0.06, sy: 0.9, sz: 24 });
    add(materials.metal, unitBox, { x: side * 3.2, y: 1.6, z: -1.4, sx: 0.3, sy: 3.2, sz: 0.3 });
    for (const offset of [-0.28, 0.28]) {
      add(materials.tire, unitCylinder, { x: side * 3.2 + offset, y: 0.58, z: -1.4, rz: Math.PI / 2, sx: 0.58, sy: 0.36, sz: 0.58 });
    }
  }
  add(materials.airlinerTail, unitBox, { y: 8.6, z: -20.4, sx: 0.5, sy: 6.4, sz: 5.4 });
  add(materials.airlinerTail, unitBox, { y: 11.9, z: -21.6, sx: 0.4, sy: 1.4, sz: 3.4 });
  add(materials.metal, unitBox, { y: 1.6, z: 12.2, sx: 0.3, sy: 3.2, sz: 0.3 });
  for (const side of [-1, 1]) {
    add(materials.tire, unitCylinder, { x: side * 0.34, y: 0.58, z: 12.2, rz: Math.PI / 2, sx: 0.58, sy: 0.34, sz: 0.58 });
  }

  const geometries = new Map();
  for (const [material, parts] of collector.buckets) geometries.set(material, mergeParts(parts));
  unitBox.dispose();
  unitCylinder.dispose();
  unitCone.dispose();
  unitSphere.dispose();

  const build = () => {
    const aircraft = new THREE.Group();
    for (const [material, geometry] of geometries) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      aircraft.add(mesh);
    }
    return aircraft;
  };
  const first = build();
  first.position.set(-431, 0, 1820);
  first.rotation.y = -Math.PI / 2;
  root.add(first);
  const second = build();
  second.position.set(-431, 0, 1710);
  second.rotation.y = -Math.PI / 2;
  root.add(second);
  return root;
}

function createVehicles(ctx) {
  const { group, materials } = ctx;
  const vehicles = new THREE.Group();
  vehicles.name = 'vehicles';
  group.add(vehicles);

  const staticVehicles = [
    ['tug', -300, 1900, 0], ['tug', -240, 1900, 0], ['tug', -334, 1470, Math.PI],
    ['fuel', -330, 1560, 0], ['fuel', -200, 1780, Math.PI], ['bus', -520, 1470, 0],
    ['fire', -560, -1560, Math.PI / 2], ['fuel', -420, -1520, 0]
  ];
  for (const [kind, x, z, ry] of staticVehicles) vehicles.add(createVehicle(kind, materials, x, z, ry));

  const routes = [
    {
      kind: 'bus',
      speed: 7,
      offset: 0,
      points: [[-455, 1478], [-205, 1478], [-205, 1620], [-350, 1620], [-350, 1478]]
    },
    {
      kind: 'bus',
      speed: 6,
      offset: 90,
      points: [[-355, 1486], [-190, 1486], [-190, 1860], [-345, 1860]]
    },
    {
      kind: 'fuel',
      speed: 5,
      offset: 30,
      points: [[-300, 1500], [-300, 1870], [-165, 1870], [-165, 1500]]
    },
    {
      kind: 'tug',
      speed: 4.5,
      offset: 12,
      points: [[-380, 1560], [-200, 1560], [-200, 1700], [-380, 1700]]
    },
    {
      kind: 'tug',
      speed: 5.5,
      offset: 55,
      points: [[-300, 1470], [-300, 1900], [-160, 1900], [-160, 1470]]
    }
  ];

  const moving = [];
  for (const route of routes) {
    const object = createVehicle(route.kind, materials, route.points[0][0], route.points[0][1], 0);
    vehicles.add(object);
    const segments = [];
    let total = 0;
    for (let index = 0; index < route.points.length; index += 1) {
      const from = route.points[index];
      const to = route.points[(index + 1) % route.points.length];
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      segments.push({ from, to, length, start: total });
      total += length;
    }
    moving.push({ object, segments, total, speed: route.speed, offset: route.offset });
  }
  return moving;
}

function createLocalizers(ctx) {
  const { group, materials } = ctx;
  const localizers = new THREE.Group();
  localizers.name = 'navAids';
  group.add(localizers);
  for (const [x, z, ry] of [[0, -3000, 0], [0, 3000, Math.PI], [42, -1500, 0], [42, 1500, Math.PI]]) {
    const base = boxMesh(1.4, 0.6, 1.4, materials.wallLight, x, groundHeight(x, z) + 0.3, z);
    localizers.add(base);
    const mast = boxMesh(0.16, 5, 0.16, materials.lightPole, x, groundHeight(x, z) + 2.8, z);
    localizers.add(mast);
    const array = boxMesh(Math.abs(z) > 2500 ? 12 : 2.6, 0.9, 0.3, materials.metal, x, groundHeight(x, z) + 5, z);
    array.rotation.y = ry + Math.PI / 2;
    localizers.add(array);
  }
  return localizers;
}

/* ------------------------------------------------------------------ */
/* 植被                                                                */
/* ------------------------------------------------------------------ */

function crossQuadGeometry(width, height) {
  const half = width / 2;
  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];
  for (let plane = 0; plane < 2; plane += 1) {
    const angle = (plane * Math.PI) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const offset = plane * 4;
    const corners = [[-half, 0], [half, 0], [half, height], [-half, height]];
    for (const [x, y] of corners) {
      positions.push(x * cos, y, x * sin);
      normals.push(0, 1, 0);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function createVegetation(ctx) {
  const { group, materials } = ctx;
  const vegetation = new THREE.Group();
  vegetation.name = 'vegetation';
  group.add(vegetation);
  const random = randomGenerator(20250318);

  const inClearZone = (x, z) => {
    if (Math.abs(x) < 165 && Math.abs(z) < 2350) return true;
    if (x > -155 && x < -5 && Math.abs(z) < 2150) return true;
    const approach = Math.abs(z) - 2350;
    if (approach > 0 && Math.abs(x) < 165 + approach * 0.14) return true;
    return false;
  };
  const inAirport = (x, z) => Math.abs(x) < 1040 && Math.abs(z) < 2340;

  const trees = [];
  let attempts = 0;
  while (trees.length < 900 && attempts < 30000) {
    attempts += 1;
    const x = (random() - 0.5) * 14000;
    const z = (random() - 0.5) * 14000;
    if (Math.hypot(x, z) < 2700) continue;
    if (inClearZone(x, z)) continue;
    const y = groundHeight(x, z);
    if (y > 330) continue;
    if (random() < 0.4) continue;
    trees.push({ x, y, z, height: 4 + random() * 8, width: 2 + random() * 2.8, tint: random() });
  }

  /* 场内防风林带：沿围栏内侧成排，避开净空区与铺装面 */
  const belts = [
    { x: 900, z0: -2200, z1: 2200, step: 30 },
    { x: 620, z0: -2200, z1: 2200, step: 46 },
    { x: 380, z0: -2200, z1: 2200, step: 62 },
    { x: -960, z0: -1320, z1: 1320, step: 32 },
    { x: -700, z0: 1750, z1: 2250, step: 30 },
    { x: -400, z0: 1900, z1: 2250, step: 30 }
  ];
  for (const belt of belts) {
    for (let z = belt.z0; z <= belt.z1; z += belt.step) {
      const x = belt.x + (random() - 0.5) * 14;
      const jittered = z + (random() - 0.5) * 12;
      if (isOnPavedSurface(x, jittered) || inClearZone(x, jittered)) continue;
      trees.push({
        x,
        y: groundHeight(x, jittered),
        z: jittered,
        height: 5 + random() * 6,
        width: 2 + random() * 2,
        tint: random()
      });
    }
  }
  for (let z = -2200; z <= 2200; z += 34) {
    for (const x of [random() * 900 + 260, -(random() * 300 + 260)]) {
      if (isOnPavedSurface(x, z) || inClearZone(x, z)) continue;
      trees.push({ x, y: groundHeight(x, z), z, height: 4.5 + random() * 6, width: 1.8 + random() * 2, tint: random() });
    }
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.46, 1, 5);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkGeometry, materials.bark, trees.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, materials.leaf, trees.length * 2);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const color = new THREE.Color();
  trees.forEach((tree, index) => {
    position.set(tree.x, tree.y + tree.height * 0.32, tree.z);
    scale.set(0.9, tree.height * 0.64, 0.9);
    quaternion.identity();
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(index, matrix);
    for (let layer = 0; layer < 2; layer += 1) {
      const radius = tree.width * (1 - layer * 0.26);
      position.set(tree.x + (layer ? tree.width * 0.22 : 0), tree.y + tree.height * (0.62 + layer * 0.22), tree.z);
      scale.set(radius, tree.height * 0.3, radius);
      quaternion.setFromEuler(euler.set(0, tree.tint * Math.PI * 2 + layer, 0));
      matrix.compose(position, quaternion, scale);
      const instance = index * 2 + layer;
      crowns.setMatrixAt(instance, matrix);
      color.setHSL(0.26 + tree.tint * 0.05, 0.42 + tree.tint * 0.2, 0.2 + layer * 0.05);
      crowns.setColorAt(instance, color);
    }
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.castShadow = true;
  crowns.castShadow = true;
  trunks.receiveShadow = true;
  crowns.receiveShadow = true;
  vegetation.add(trunks, crowns);

  const bushes = [];
  const bushCount = 1100;
  let placed = 0;
  while (placed < bushCount && attempts < 60000) {
    attempts += 1;
    const inside = random() < 0.45;
    const x = inside ? (random() - 0.5) * 2000 : (random() - 0.5) * 9000;
    const z = inside ? (random() - 0.5) * 4600 : (random() - 0.5) * 9000;
    if (isOnPavedSurface(x, z) || inClearZone(x, z)) continue;
    if (inside && !inAirport(x, z)) continue;
    const size = 0.7 + random() * 1.8;
    bushes.push({ x, y: groundHeight(x, z) + size * 0.4, z, sx: size * 1.4, sy: size * 0.75, sz: size, ry: random() * Math.PI });
    placed += 1;
  }
  vegetation.add(instanced(new THREE.IcosahedronGeometry(1, 0), materials.bush, bushes, { name: 'bushes' }));

  /* 草丛：跑道与滑行道之间的修剪草地上 */
  const tufts = [];
  let tuftCount = 0;
  let tuftAttempts = 0;
  while (tuftCount < 1500 && tuftAttempts < 40000) {
    tuftAttempts += 1;
    const x = (random() - 0.5) * 460;
    const z = (random() - 0.5) * 4700;
    if (isOnPavedSurface(x, z)) continue;
    if (Math.abs(x) < 24) continue;
    const size = 0.9 + random() * 1.4;
    tufts.push({ x, y: groundHeight(x, z), z, sx: size * 1.5, sy: size, sz: size * 1.5, ry: random() * Math.PI });
    tuftCount += 1;
  }
  vegetation.add(instanced(crossQuadGeometry(1, 1), materials.grassTuft, tufts, { name: 'grassTufts' }));

  return vegetation;
}

/* ------------------------------------------------------------------ */
/* 材质                                                                */
/* ------------------------------------------------------------------ */

function createMaterials() {
  const materials = {};
  materials.grassDetail = grassTexture(1001, { repeat: [1, 1] });
  materials.runwayAsphalt = new THREE.MeshStandardMaterial({
    map: asphaltTexture(2001, { repeat: [4, 300] }),
    roughness: 0.95,
    metalness: 0.02
  });
  materials.taxiAsphalt = new THREE.MeshStandardMaterial({
    map: asphaltTexture(2002, { repeat: [4, 350] }),
    roughness: 0.95,
    metalness: 0.02
  });
  materials.connectorAsphalt = new THREE.MeshStandardMaterial({
    map: asphaltTexture(2003, { repeat: [8, 2] }),
    roughness: 0.95,
    metalness: 0.02
  });
  materials.shoulder = new THREE.MeshStandardMaterial({
    map: concreteTexture(2004, { base: '#71746a', repeat: [1, 250] }),
    roughness: 0.98
  });
  materials.taxiShoulder = new THREE.MeshStandardMaterial({
    map: concreteTexture(2005, { base: '#7d817c', repeat: [2, 300] }),
    roughness: 0.96
  });
  materials.apronConcrete = new THREE.MeshStandardMaterial({
    map: concreteTexture(2006, { repeat: [26, 36] }),
    roughness: 0.93
  });
  materials.rampConcrete = new THREE.MeshStandardMaterial({
    map: concreteTexture(2007, { repeat: [68, 30] }),
    roughness: 0.93
  });
  materials.dirtBand = new THREE.MeshStandardMaterial({
    map: dirtTexture(2015),
    roughness: 1
  });
  materials.mownGrass = new THREE.MeshStandardMaterial({
    map: grassTexture(2008, { repeat: [1, 380] }),
    roughness: 1
  });
  materials.parkingDeck = new THREE.MeshStandardMaterial({
    map: asphaltTexture(2009, { base: '#41464a', repeat: [8, 26] }),
    roughness: 0.96
  });
  materials.road = new THREE.MeshStandardMaterial({
    map: asphaltTexture(2010, { base: '#3d4245', repeat: [2, 320] }),
    roughness: 0.97
  });
  materials.patch = new THREE.MeshStandardMaterial({ map: patchTexture(2011), roughness: 0.96 });
  materials.paint = new THREE.MeshStandardMaterial({ color: 0xeeeada, roughness: 0.72, metalness: 0.02 });
  materials.yellowPaint = new THREE.MeshStandardMaterial({ color: 0xe4b42c, roughness: 0.7 });
  materials.rubberHeavy = new THREE.MeshStandardMaterial({
    map: rubberTexture(2012),
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    roughness: 1
  });
  materials.rubberLight = new THREE.MeshStandardMaterial({
    map: rubberTexture(2013, { edge: 0.24 }),
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    roughness: 1
  });
  materials.oilStain = new THREE.MeshStandardMaterial({
    map: stainTexture(2014),
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    roughness: 1
  });
  materials.gutter = new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.9 });
  materials.grate = new THREE.MeshStandardMaterial({ color: 0x2b2f31, roughness: 0.7, metalness: 0.6 });
  materials.manhole = new THREE.MeshStandardMaterial({ color: 0x4b5053, roughness: 0.6, metalness: 0.6 });
  materials.wall = new THREE.MeshStandardMaterial({ color: 0xd8dad3, roughness: 0.78 });
  materials.wallLight = new THREE.MeshStandardMaterial({ color: 0xe5e7e0, roughness: 0.8 });
  materials.darkWall = new THREE.MeshStandardMaterial({ color: 0x59626a, roughness: 0.72, metalness: 0.2 });
  materials.roof = new THREE.MeshStandardMaterial({ color: 0x333e46, roughness: 0.62, metalness: 0.32 });
  materials.metal = new THREE.MeshStandardMaterial({ color: 0x8d9498, roughness: 0.55, metalness: 0.55 });
  materials.terminalGlass = new THREE.MeshStandardMaterial({
    color: 0x3d6679,
    roughness: 0.2,
    metalness: 0.55,
    emissive: 0x9db9c0,
    emissiveIntensity: 0.04
  });
  materials.bridgeBody = new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.5, metalness: 0.3 });
  materials.hangarDoor = new THREE.MeshStandardMaterial({ color: 0x9aa4a8, roughness: 0.6, metalness: 0.4 });
  materials.lightPole = new THREE.MeshStandardMaterial({ color: 0x6b7276, roughness: 0.6, metalness: 0.5 });
  materials.lightBase = new THREE.MeshStandardMaterial({ color: 0x3d4245, roughness: 0.7, metalness: 0.5 });
  materials.floodLamp = new THREE.MeshStandardMaterial({
    color: 0xd9d9c6,
    emissive: 0xffe7b0,
    emissiveIntensity: 0.1,
    roughness: 0.4
  });
  materials.signFrame = new THREE.MeshStandardMaterial({ color: 0x1b1f21, roughness: 0.7 });
  materials.signPost = new THREE.MeshStandardMaterial({ color: 0x585e5b, roughness: 0.75, metalness: 0.4 });
  materials.signFaces = [];
  materials.signQueue = [];
  materials.fencePost = new THREE.MeshStandardMaterial({ color: 0x747c78, roughness: 0.8, metalness: 0.5 });
  materials.fenceWire = new THREE.LineBasicMaterial({ color: 0x7c8480, transparent: true, opacity: 0.75 });
  materials.container = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.15 });
  materials.forklift = new THREE.MeshStandardMaterial({ color: 0xd8a52c, roughness: 0.7 });
  materials.car = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.25 });
  materials.vehicleBody = new THREE.MeshStandardMaterial({ color: 0xe8e9e4, roughness: 0.55 });
  materials.vehicleTrim = new THREE.MeshStandardMaterial({ color: 0x4b5257, roughness: 0.65, metalness: 0.3 });
  materials.vehicleGlass = new THREE.MeshStandardMaterial({
    color: 0x2c3d47,
    roughness: 0.25,
    metalness: 0.4,
    emissive: 0x6f8b98,
    emissiveIntensity: 0.03
  });
  materials.fuelTank = new THREE.MeshStandardMaterial({ color: 0xc9cdd0, roughness: 0.35, metalness: 0.6 });
  materials.fireTruck = new THREE.MeshStandardMaterial({ color: 0xb52c22, roughness: 0.5 });
  materials.tire = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.95 });
  materials.airlinerBody = new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.42, metalness: 0.22 });
  materials.airlinerTail = new THREE.MeshStandardMaterial({ color: 0x1d4d86, roughness: 0.45 });
  materials.airlinerEngine = new THREE.MeshStandardMaterial({ color: 0x8e969c, roughness: 0.4, metalness: 0.6 });
  materials.beaconLamp = new THREE.MeshBasicMaterial({ color: 0xff4a3a, toneMapped: false });
  materials.beaconBeam = new THREE.MeshBasicMaterial({
    color: 0xff8a72,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false
  });
  materials.windsock = new THREE.MeshStandardMaterial({ color: 0xef6a25, roughness: 0.85, side: THREE.DoubleSide });
  materials.windsockBand = new THREE.MeshStandardMaterial({ color: 0xf5f2e6, roughness: 0.85, side: THREE.DoubleSide });
  materials.bark = new THREE.MeshStandardMaterial({ color: 0x59452f, roughness: 1 });
  materials.leaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  materials.bush = new THREE.MeshStandardMaterial({ color: 0x4a6f33, roughness: 1 });
  materials.grassTuft = new THREE.MeshStandardMaterial({
    map: grassTuftTexture(3001),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 1
  });
  materials.glow = glowTexture();
  return materials;
}

function resolvePhase(value) {
  if (typeof value === 'number') {
    if (value < 5.5 || value > 19.5) return 'night';
    if (value < 7.5 || value > 17.5) return 'dusk';
    return 'day';
  }
  const text = String(value ?? 'day').toLowerCase();
  if (text.includes('night') || text.includes('夜')) return 'night';
  if (text.includes('dusk') || text.includes('evening') || text.includes('sunset')
    || text.includes('dawn') || text.includes('暮') || text.includes('晨')) return 'dusk';
  return 'day';
}

/* ------------------------------------------------------------------ */
/* 机场                                                                */
/* ------------------------------------------------------------------ */

export class Airport {
  constructor(scene) {
    this.scene = scene;
    this.disposed = false;
    this.nightLevel = 0;
    this.visibility = 16000;
    this.group = new THREE.Group();
    this.group.name = 'airport';
    scene.add(this.group);

    this.tempColor = new THREE.Color();
    this.materials = createMaterials();

    const ctx = {
      scene,
      group: this.group,
      materials: this.materials,
      masts: [],
      obstructionLights: [],
      stands: null,
      lights: {
        runwayEdge: [],
        runwayThreshold: [],
        runwayEnd: [],
        taxiwayEdge: [],
        taxiwayCenter: [],
        approach: [],
        flood: [],
        obstruction: [],
        flasher: [],
        papi: [],
        guard: []
      }
    };

    this.terrain = createTerrain(this.materials);
    this.group.add(this.terrain);
    this.runway = createRunway(ctx);
    this.taxiways = createTaxiways(ctx);
    this.apron = createApron(ctx);
    this.stands = ctx.stands;
    createRoads(ctx);
    this.terminal = createTerminal(ctx);
    const tower = createTower(ctx);
    this.radar = tower.radar;
    this.beaconLamp = tower.beaconLamp;
    this.beaconBeam = tower.beam;
    createHangars(ctx);
    createCargoArea(ctx);
    createFireStation(ctx);
    createParkingLot(ctx);
    createLightMasts(ctx);
    createFence(ctx);
    createLocalizers(ctx);
    createParkedAirliners(ctx);
    this.vehicles = createVehicles(ctx);
    this.windsocks = createWindsocks(ctx);
    this.vegetation = createVegetation(ctx);
    this.signs = buildSigns(ctx);
    this.lighting = createLighting(ctx);

    this.apronLights = [
      new THREE.PointLight(0xffe6bd, 0, 220, 2),
      new THREE.PointLight(0xffe6bd, 0, 220, 2)
    ];
    this.apronLights[0].position.set(-180, 21, 1520);
    this.apronLights[1].position.set(-455, 21, 1680);
    for (const light of this.apronLights) this.group.add(light);
  }

  update(state) {
    if (this.disposed) return;
    const environment = state?.environment ?? {};
    const time = Number(state?.time) || 0;

    const phase = resolvePhase(environment.timeOfDay);
    const target = phase === 'night' ? 1 : phase === 'dusk' ? 0.55 : 0;
    this.nightLevel += (target - this.nightLevel) * 0.08;
    const night = this.nightLevel;

    this.visibility = clamp(Number(environment.visibility) || 16000, 400, 20000);
    const visibilityScale = clamp(this.visibility / 13000, 0.55, 1);
    for (const entry of this.lighting.classes) {
      entry.material.opacity = clamp(lerp(entry.day, entry.night, night) * visibilityScale, 0, 1);
      entry.material.size = lerp(entry.daySize, entry.nightSize, night);
    }

    this.materials.floodLamp.emissiveIntensity = lerp(0.08, 3.2, night);
    this.materials.terminalGlass.emissiveIntensity = lerp(0.04, 0.9, night);
    this.materials.vehicleGlass.emissiveIntensity = lerp(0.03, 0.5, night);
    for (const face of this.materials.signFaces) face.emissiveIntensity = lerp(0.02, 0.85, night);
    for (const light of this.apronLights) light.intensity = night * 900;

    /* 塔台：旋转雷达、旋转航空灯 */
    if (this.radar) this.radar.rotation.y = time * 0.5;
    const sweep = 0.5 + 0.5 * Math.sin(time * 4.2);
    if (this.beaconBeam) {
      this.beaconBeam.rotation.y = time * 1.9;
      this.beaconBeam.material.opacity = (0.1 + 0.5 * sweep) * (0.35 + night * 0.65);
    }
    if (this.beaconLamp) {
      const brightness = 0.4 + 0.6 * sweep;
      this.beaconLamp.material.color.setRGB(brightness, 0.24 * brightness, 0.2 * brightness);
    }

    /* 风向袋：朝向随风向，松弛程度随风速 */
    const windSpeed = Math.max(0, Number(environment.windSpeed) || 0);
    const windDirection = Number(environment.windDirection) || 0;
    const droop = lerp(0.9, 0.04, clamp(windSpeed / 10, 0, 1));
    const flutter = Math.min(windSpeed * 0.004, 0.06);
    for (let index = 0; index < this.windsocks.length; index += 1) {
      const pivot = this.windsocks[index];
      pivot.rotation.y = THREE.MathUtils.degToRad(windDirection + 180);
      pivot.rotation.x = droop + Math.sin(time * 3.4 + index) * flutter * 0.4;
      pivot.rotation.z = Math.sin(time * 4.6 + index * 1.7) * flutter;
    }

    this.updateVehicles(time);
    this.updatePapi(state);
    this.updateFlashers(state, time);
  }

  updateVehicles(time) {
    for (const vehicle of this.vehicles) {
      const distance = ((time * vehicle.speed + vehicle.offset) % vehicle.total + vehicle.total) % vehicle.total;
      let segment = vehicle.segments[0];
      for (const candidate of vehicle.segments) {
        if (distance >= candidate.start && distance < candidate.start + candidate.length) {
          segment = candidate;
          break;
        }
      }
      const t = (distance - segment.start) / Math.max(0.001, segment.length);
      const x = lerp(segment.from[0], segment.to[0], t);
      const z = lerp(segment.from[1], segment.to[1], t);
      vehicle.object.position.set(x, groundHeight(x, z), z);
      vehicle.object.rotation.y = Math.atan2(segment.to[0] - segment.from[0], segment.to[1] - segment.from[1]);
    }
  }

  /* PAPI 随飞机实际下滑角变色：高于下滑道偏白，低于偏红。 */
  updatePapi(state) {
    const mesh = this.lighting.meshes.papi;
    if (!mesh) return;
    const position = state?.pos ?? {};
    const altitude = Number(position.y) || 0;
    const x = Number(position.x) || 0;
    const z = Number(position.z) || 0;
    const colors = mesh.geometry.attributes.color;
    for (const bank of this.lighting.papiBanks) {
      const referenceX = bank.side * 30;
      const ground = Math.hypot(x - referenceX, z - bank.z);
      const angle = Math.atan2(Math.max(0, altitude - 1.05), Math.max(1, ground)) * 180 / Math.PI;
      for (let unit = 0; unit < 4; unit += 1) {
        this.tempColor.set(angle >= PAPI_UNIT_ANGLES[unit] ? 0xfff4dd : 0xff2f20);
        colors.setXYZ(bank.indices[unit], this.tempColor.r, this.tempColor.g, this.tempColor.b);
      }
    }
    colors.needsUpdate = true;
  }

  /* 进近顺序闪光灯（由外向内依次点亮）+ 跑道口黄色警戒灯（交替闪烁）。 */
  updateFlashers(state, time) {
    const mesh = this.lighting.meshes.flasher;
    const guard = this.lighting.meshes.guard;
    const count = this.lighting.flasherCount;
    const active = this.nightLevel > 0.12;
    const z = Number(state?.pos?.z) || 0;
    const altitude = Number(state?.pos?.y) || 0;
    const onApproach = altitude < 2200;
    const lit = 11 - (((Math.floor(time * 24) % 16) + 16) % 16);
    const blink = Math.floor(time * 1.1) % 2 === 0;

    if (mesh) {
      const colors = mesh.geometry.attributes.color;
      const total = colors.count;
      for (let index = 0; index < total; index += 1) {
        const isSouth = index < count;
        const position = isSouth ? index : index - count;
        const bankActive = active && onApproach && (isSouth ? z < -1200 : z > 1200);
        const gain = bankActive && position === lit ? 1 : 0.015;
        this.tempColor.setRGB(gain, gain * 0.98, gain * 0.92);
        colors.setXYZ(index, this.tempColor.r, this.tempColor.g, this.tempColor.b);
      }
      colors.needsUpdate = true;
    }

    if (guard) {
      const colors = guard.geometry.attributes.color;
      const total = colors.count;
      for (let index = 0; index < total; index += 1) {
        const gain = ((index % 2 === 0) === blink) ? 1 : 0.03;
        this.tempColor.setRGB(gain, gain * 0.74, gain * 0.1);
        colors.setXYZ(index, this.tempColor.r, this.tempColor.g, this.tempColor.b);
      }
      colors.needsUpdate = true;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene?.remove(this.group);
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    this.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of list) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    this.group.clear();
    this.vehicles = [];
    this.windsocks = [];
  }
}
