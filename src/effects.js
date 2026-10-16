import * as THREE from 'three';
import { getAircraftParams } from './sim/aircraftTypes.js';
import { clamp, isOnPavedSurface } from './sim/config.js';

const POINT_CAPACITY = 768;
const DEBRIS_CAPACITY = 96;

const POINT_VERTEX_SHADER = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (280.0 / max(1.0, -viewPosition.z)), 0.0, 128.0);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const POINT_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float distanceFromCenter = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float softness = 1.0 - smoothstep(0.18, 1.0, distanceFromCenter);
    float alpha = vAlpha * softness;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(vColor, alpha);
    #include <colorspace_fragment>
  }
`;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function level(value) {
  return clamp(finite(value), 0, 1);
}

function canonicalType(type) {
  const key = String(type ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
  const aliases = {
    'runway-smoke': 'tire-smoke',
    'tyre-smoke': 'tire-smoke',
    'grass-dust': 'dust',
    'rain-splash': 'spray',
    'rain-spray': 'spray',
    'snow-splash': 'snow-spray',
    'snow-spray': 'snow-spray',
    smoke: 'engine-smoke',
    'damage-smoke': 'engine-smoke',
    'tree-strike': 'vegetation',
    trees: 'vegetation',
    'hardlanding': 'hard-landing',
    'birdstrike': 'bird-strike',
    impact: 'collision',
    'impact-dust': 'impact-smoke'
  };
  return aliases[key] || key;
}

class PointPool {
  constructor(scene, capacity) {
    this.scene = scene;
    this.capacity = capacity;
    this.cursor = 0;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.opacity = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    this.sizeAttribute = new THREE.BufferAttribute(this.sizes, 1);
    this.alphaAttribute = new THREE.BufferAttribute(this.alphas, 1);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttribute.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('aColor', this.colorAttribute);
    this.geometry.setAttribute('aSize', this.sizeAttribute);
    this.geometry.setAttribute('aAlpha', this.alphaAttribute);

    this.material = new THREE.ShaderMaterial({
      vertexShader: POINT_VERTEX_SHADER,
      fragmentShader: POINT_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  spawn(position, inheritedVelocity, options) {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const offset = index * 3;
    const spread = options.spread ?? 0;
    const inherit = options.inherit ?? 0;
    const jitter = options.jitter ?? 0;
    const velocity = options.velocity || [0, 0, 0];
    const lifetime = Math.max(0.03, options.life * (0.82 + Math.random() * 0.36));

    this.positions[offset] = finite(position.x) + (Math.random() - 0.5) * spread;
    this.positions[offset + 1] = finite(position.y) + (Math.random() - 0.5) * (options.spreadY ?? spread * 0.25);
    this.positions[offset + 2] = finite(position.z) + (Math.random() - 0.5) * spread;
    this.velocities[offset] = finite(inheritedVelocity?.x) * inherit + velocity[0] + (Math.random() - 0.5) * jitter;
    this.velocities[offset + 1] = finite(inheritedVelocity?.y) * inherit + velocity[1] + Math.random() * jitter * 0.45;
    this.velocities[offset + 2] = finite(inheritedVelocity?.z) * inherit + velocity[2] + (Math.random() - 0.5) * jitter;

    this.colors[offset] = options.color[0];
    this.colors[offset + 1] = options.color[1];
    this.colors[offset + 2] = options.color[2];
    this.sizes[index] = options.size * (0.78 + Math.random() * 0.44);
    this.life[index] = lifetime;
    this.maxLife[index] = lifetime;
    this.opacity[index] = options.opacity;
    this.alphas[index] = options.opacity * 0.15;
    this.growth[index] = options.growth ?? 0;
    this.gravity[index] = options.gravity ?? 0;
    this.drag[index] = options.drag ?? 0;

    this.colorAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        this.alphas[i] = 0;
        continue;
      }

      const offset = i * 3;
      const damping = Math.max(0, 1 - this.drag[i] * dt);
      this.velocities[offset] *= damping;
      this.velocities[offset + 1] = this.velocities[offset + 1] * damping - this.gravity[i] * dt;
      this.velocities[offset + 2] *= damping;
      this.positions[offset] += this.velocities[offset] * dt;
      this.positions[offset + 1] += this.velocities[offset + 1] * dt;
      this.positions[offset + 2] += this.velocities[offset + 2] * dt;
      this.sizes[i] = Math.max(0, this.sizes[i] + this.growth[i] * dt);

      const age = this.maxLife[i] - this.life[i];
      const fadeIn = Math.min(1, age * 14);
      const fadeOut = Math.min(1, this.life[i] / Math.max(0.001, this.maxLife[i] * 0.38));
      this.alphas[i] = this.opacity[i] * fadeIn * fadeOut;
    }

    this.positionAttribute.needsUpdate = true;
    this.alphaAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

class DebrisPool {
  constructor(scene, capacity) {
    this.scene = scene;
    this.capacity = capacity;
    this.cursor = 0;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.rotations = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 3);
    this.scales = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);

    this.geometry = new THREE.TetrahedronGeometry(1, 0);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();

    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < capacity; i += 1) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }

  spawn(position, inheritedVelocity, options) {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const offset = index * 3;
    const spread = options.spread ?? 0.2;
    const inherit = options.inherit ?? 0.25;
    const size = options.size * (0.65 + Math.random() * 0.7);

    this.positions[offset] = finite(position.x) + (Math.random() - 0.5) * spread;
    this.positions[offset + 1] = finite(position.y) + Math.random() * spread * 0.4;
    this.positions[offset + 2] = finite(position.z) + (Math.random() - 0.5) * spread;
    this.velocities[offset] = finite(inheritedVelocity?.x) * inherit + (Math.random() - 0.5) * options.jitter;
    this.velocities[offset + 1] = finite(inheritedVelocity?.y) * inherit + options.lift * (0.55 + Math.random() * 0.8);
    this.velocities[offset + 2] = finite(inheritedVelocity?.z) * inherit + (Math.random() - 0.5) * options.jitter;
    this.rotations[offset] = Math.random() * Math.PI;
    this.rotations[offset + 1] = Math.random() * Math.PI;
    this.rotations[offset + 2] = Math.random() * Math.PI;
    this.spin[offset] = (Math.random() - 0.5) * 12;
    this.spin[offset + 1] = (Math.random() - 0.5) * 12;
    this.spin[offset + 2] = (Math.random() - 0.5) * 12;
    this.scales[offset] = size * (0.55 + Math.random() * 0.8);
    this.scales[offset + 1] = size * (0.5 + Math.random() * 0.75);
    this.scales[offset + 2] = size * (0.55 + Math.random() * 0.8);
    this.life[index] = options.life * (0.75 + Math.random() * 0.5);

    this.color.setRGB(options.color[0], options.color[1], options.color[2]);
    this.mesh.setColorAt(index, this.color);
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const offset = i * 3;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        this.dummy.scale.setScalar(0);
      } else {
        this.velocities[offset + 1] -= 8.2 * dt;
        this.positions[offset] += this.velocities[offset] * dt;
        this.positions[offset + 1] += this.velocities[offset + 1] * dt;
        this.positions[offset + 2] += this.velocities[offset + 2] * dt;
        this.rotations[offset] += this.spin[offset] * dt;
        this.rotations[offset + 1] += this.spin[offset + 1] * dt;
        this.rotations[offset + 2] += this.spin[offset + 2] * dt;
        this.dummy.scale.set(this.scales[offset], this.scales[offset + 1], this.scales[offset + 2]);
      }

      this.dummy.position.set(this.positions[offset], this.positions[offset + 1], this.positions[offset + 2]);
      this.dummy.rotation.set(this.rotations[offset], this.rotations[offset + 1], this.rotations[offset + 2]);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class Effects {
  constructor(scene) {
    if (!scene || typeof scene.add !== 'function') {
      throw new TypeError('Effects requires a Three.js scene.');
    }
    this.scene = scene;
    this.points = new PointPool(scene, POINT_CAPACITY);
    this.debris = new DebrisPool(scene, DEBRIS_CAPACITY);
    this._scratchPosition = new THREE.Vector3();
    this._accumulators = Object.create(null);
    this._previous = null;
    this._lastState = null;
    this._disposed = false;
  }

  update(state, dt = 0) {
    if (this._disposed || !state) return;
    const step = clamp(finite(dt), 0, 0.1);
    this._lastState = state;
    const previous = this._previous;
    const snapshot = this._makeSnapshot(state);
    const timeReset = previous && finite(state.time) < finite(previous.time);
    if (previous && !timeReset) this._processEvents(state, previous, snapshot);

    const effects = state.effects || {};
    const position = state.pos || {};
    const groundSpeed = Math.max(0, finite(state.groundSpeed));
    const offPaved = state.onGround && !isOnPavedSurface(finite(position.x), finite(position.z))
      ? clamp((groundSpeed - 2) / 48, 0, 1)
      : 0;
    const weather = String(state.environment?.weather ?? 'clear').toLowerCase();
    const snowy = /snow|雪/.test(weather);
    const precipitation = snowy || /rain|storm|雨/.test(weather);
    const weatherSpray = state.onGround && precipitation ? clamp((groundSpeed - 3) / 55, 0, 1) * 0.8 : 0;

    const tireSmoke = Math.max(level(effects.tireSmoke), level(state.gear?.tireSmoke));
    const dust = Math.max(level(effects.dust), offPaved * 0.5);
    const spray = Math.max(level(effects.spray), weatherSpray);
    const gravel = Math.max(level(effects.gravel), offPaved * 0.14);
    const impactSmoke = level(effects.smoke);
    const looseDebris = level(effects.debris);
    const vegetation = level(effects.treeStrike);

    this._emitContinuous('tires', 'tire-smoke', 48 * tireSmoke, tireSmoke, step, state, 0, 0.16, -2.4, 7);
    this._emitContinuous('dust', 'dust', 48 * dust, dust, step, state, 0, 0.12, -2.8, 7);
    this._emitContinuous('spray', snowy ? 'snow-spray' : 'spray', 64 * spray, spray, step, state, 0, 0.1, -2.2, 8);
    this._emitContinuous('gravel', 'gravel', 20 * gravel, gravel, step, state, 0, 0.12, -2.2, 4);
    this._emitContinuous('impact', 'impact-smoke', 30 * impactSmoke, impactSmoke, step, state, 0, 0.5, 0, 5);
    this._emitContinuous('debris', 'debris', 20 * looseDebris, looseDebris, step, state, 0, 0.5, 0, 4);
    this._emitContinuous('vegetation', 'vegetation', 30 * vegetation, vegetation, step, state, 0, 0.8, 0, 5);

    const engines = Array.isArray(state.engines) ? state.engines : [];
    const aircraft = getAircraftParams(state);
    const enginePositions = Array.isArray(aircraft.enginePositions) ? aircraft.enginePositions : [];
    for (let i = 0; i < engines.length; i += 1) {
      const engine = engines[i] || {};
      const enginePosition = enginePositions[i];
      const lateral = finite(enginePosition?.x);
      const up = finite(enginePosition?.y);
      const forward = finite(enginePosition?.z);
      const damage = level(engine.damage);
      const smoke = Math.max(damage > 0.08 ? damage : 0, engine.fire ? 1 : 0);
      const fire = engine.fire ? 1 : 0;
      const reverse = state.onGround && engine.running && !engine.failed
        ? level(engine.reverser) * level(engine.n1)
        : 0;
      this._emitContinuous(`engine-${i}`, 'engine-smoke', 34 * smoke, smoke, step, state, lateral, up, forward, 5);
      this._emitContinuous(`engine-fire-${i}`, 'engine-flame', 42 * fire, fire, step, state, lateral, up, forward, 4);
      this._emitContinuous(`engine-reverse-${i}`, 'reverse', 28 * reverse, reverse, step, state, lateral, up, forward, 4);
    }

    const airborne = state.onGround === false;
    const highAlpha = Math.max(0, (Math.abs(finite(state.alpha)) - 0.15) / 0.2);
    const highLoad = Math.max(0, (finite(state.gLoad, 1) - 1.4) / 2);
    const vortex = airborne ? clamp(Math.max(highAlpha, highLoad), 0, 1) : 0;
    const halfSpan = Math.max(1, finite(aircraft.wingspan, finite(aircraft.geSpan, 35.8)) * 0.5);
    this._emitContinuous('vortex-left', 'vortex', 9 * vortex, vortex, step, state, -halfSpan, 0.7, -1, 2);
    this._emitContinuous('vortex-right', 'vortex', 9 * vortex, vortex, step, state, halfSpan, 0.7, -1, 2);

    this._previous = snapshot;
    this.points.update(step);
    this.debris.update(step);
  }

  emit(type, position, intensity = 1) {
    if (this._disposed) return 0;
    const kind = canonicalType(type);
    const amount = clamp(finite(intensity, 1), 0, 3);
    const origin = position || this._lastState?.pos;
    if (!origin || amount <= 0) return 0;

    const burstSizes = {
      'tire-smoke': 9,
      touchdown: 20,
      dust: 10,
      spray: 12,
      'snow-spray': 12,
      gravel: 10,
      debris: 9,
      vegetation: 16,
      'impact-smoke': 14,
      'hard-landing': 42,
      collision: 48,
      'engine-smoke': 6,
      'engine-flame': 5,
      reverse: 8,
      'bird-strike': 22,
      vortex: 5,
      'ground-fog': 8
    };
    const baseCount = burstSizes[kind];
    if (!baseCount) return 0;
    const count = Math.min(64, Math.max(1, Math.round(baseCount * Math.sqrt(amount))));
    for (let i = 0; i < count; i += 1) this._spawnOne(kind, origin, amount);
    return count;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.points.dispose();
    this.debris.dispose();
    this._previous = null;
    this._lastState = null;
    this._accumulators = Object.create(null);
  }

  _emitContinuous(key, type, rate, intensity, dt, state, lateral, up, forward, maxPerUpdate) {
    if (rate <= 0 || intensity <= 0 || dt <= 0) {
      this._accumulators[key] = 0;
      return;
    }
    let total = (this._accumulators[key] || 0) + rate * dt;
    let count = Math.floor(total);
    total -= count;
    if (count > maxPerUpdate) {
      count = maxPerUpdate;
      total = 0;
    }
    this._accumulators[key] = total;
    for (let i = 0; i < count; i += 1) {
      const position = this._localPosition(state, lateral, up, forward);
      this._spawnOne(type, position, intensity);
    }
  }

  _spawnOne(type, position, intensity) {
    const inheritedVelocity = this._lastState?.vel;
    const strength = clamp(intensity, 0.08, 2.5);

    switch (type) {
      case 'tire-smoke':
      case 'touchdown':
        this.points.spawn(position, inheritedVelocity, {
          color: [0.78, 0.82, 0.84],
          size: 0.65 + strength * 0.45,
          opacity: 0.52,
          life: 0.85 + strength * 0.35,
          growth: 1.6,
          gravity: -0.18,
          drag: 1.1,
          spread: 1.2 + strength,
          spreadY: 0.2,
          inherit: 0.32,
          jitter: 1.4,
          velocity: [0, 0.35 + strength * 0.25, 0]
        });
        break;
      case 'dust':
        this.points.spawn(position, inheritedVelocity, {
          color: [0.52, 0.39, 0.23],
          size: 0.7 + strength * 0.5,
          opacity: 0.5,
          life: 1.1 + strength * 0.55,
          growth: 1.8,
          gravity: -0.08,
          drag: 1.25,
          spread: 1.8,
          inherit: 0.22,
          jitter: 2.4,
          velocity: [0, 0.45 + strength * 0.5, 0]
        });
        break;
      case 'spray':
      case 'snow-spray': {
        const snow = type === 'snow-spray';
        this.points.spawn(position, inheritedVelocity, {
          color: snow ? [0.88, 0.94, 1] : [0.62, 0.8, 0.94],
          size: (snow ? 0.22 : 0.16) + strength * 0.14,
          opacity: snow ? 0.68 : 0.62,
          life: 0.42 + strength * 0.24,
          growth: 0.4,
          gravity: snow ? 2.2 : 5.8,
          drag: 0.35,
          spread: 2.4,
          spreadY: 0.12,
          inherit: 0.48,
          jitter: 4.2,
          velocity: [0, 1.2 + strength * 2.2, 0]
        });
        break;
      }
      case 'engine-smoke':
        this.points.spawn(position, inheritedVelocity, {
          color: [0.36, 0.39, 0.42],
          size: 0.85 + strength * 0.55,
          opacity: 0.56,
          life: 2.1 + strength * 1.2,
          growth: 2.2,
          gravity: -0.32,
          drag: 0.72,
          spread: 0.75,
          inherit: 0.72,
          jitter: 1.1,
          velocity: [0, 0.7 + strength * 0.6, 0]
        });
        break;
      case 'engine-flame': {
        const heading = finite(this._lastState?.heading);
        const exhaust = 7 + strength * 6;
        this.points.spawn(position, inheritedVelocity, {
          color: [1, 0.26 + Math.random() * 0.3, 0.035],
          size: 0.45 + strength * 0.3,
          opacity: 0.82,
          life: 0.18 + strength * 0.12,
          growth: -0.35,
          gravity: 0,
          drag: 1.4,
          spread: 0.42,
          spreadY: 0.3,
          inherit: 0.9,
          jitter: 0.7,
          velocity: [-Math.sin(heading) * exhaust, 0.15, -Math.cos(heading) * exhaust]
        });
        break;
      }
      case 'reverse': {
        const heading = finite(this._lastState?.heading);
        const flow = 4 + strength * 5;
        this.points.spawn(position, inheritedVelocity, {
          color: [0.64, 0.62, 0.57],
          size: 0.5 + strength * 0.45,
          opacity: 0.3,
          life: 0.55 + strength * 0.25,
          growth: 1.5,
          gravity: 0.35,
          drag: 1.2,
          spread: 0.8,
          spreadY: 0.3,
          inherit: 0.45,
          jitter: 2.2,
          velocity: [Math.sin(heading) * flow, 0.8, Math.cos(heading) * flow]
        });
        break;
      }
      case 'impact-smoke':
        this.points.spawn(position, inheritedVelocity, {
          color: [0.5, 0.47, 0.42],
          size: 0.9 + strength * 0.7,
          opacity: 0.56,
          life: 1.5 + strength * 0.7,
          growth: 2.4,
          gravity: -0.22,
          drag: 1.05,
          spread: 2.2 + strength,
          inherit: 0.2,
          jitter: 3.1,
          velocity: [0, 0.8 + strength * 0.7, 0]
        });
        break;
      case 'hard-landing':
        if (Math.random() < 0.18) {
          this._spawnDebris('debris', position, inheritedVelocity, strength);
        } else {
          this._spawnOne(Math.random() < 0.45 ? 'tire-smoke' : 'impact-smoke', position, strength);
        }
        break;
      case 'collision':
        if (Math.random() < 0.32) {
          this._spawnDebris('debris', position, inheritedVelocity, strength);
        } else {
          this._spawnOne('impact-smoke', position, strength);
        }
        break;
      case 'bird-strike':
        if (Math.random() < 0.48) {
          this._spawnDebris('bird-strike', position, inheritedVelocity, strength);
        } else {
          this.points.spawn(position, inheritedVelocity, {
            color: [0.86, 0.84, 0.78],
            size: 0.12 + strength * 0.09,
            opacity: 0.78,
            life: 0.7 + strength * 0.35,
            growth: 0.08,
            gravity: 2.8,
            drag: 0.65,
            spread: 1.1,
            inherit: 0.4,
            jitter: 5,
            velocity: [0, 1.1, 0]
          });
        }
        break;
      case 'vortex':
        this.points.spawn(position, inheritedVelocity, {
          color: [0.68, 0.8, 0.9],
          size: 0.5 + strength * 0.3,
          opacity: 0.24,
          life: 0.65,
          growth: 1.1,
          gravity: 0,
          drag: 1.8,
          spread: 0.45,
          inherit: 0.15,
          jitter: 0.6,
          velocity: [0, 0.15, 0]
        });
        break;
      case 'ground-fog':
        this.points.spawn(position, inheritedVelocity, {
          color: [0.58, 0.65, 0.7],
          size: 1.4 + strength,
          opacity: 0.24,
          life: 2.4,
          growth: 1.4,
          gravity: -0.03,
          drag: 1.4,
          spread: 3.5,
          spreadY: 0.2,
          inherit: 0,
          jitter: 0.8,
          velocity: [0, 0.12, 0]
        });
        break;
      case 'gravel':
      case 'debris':
      case 'vegetation':
        this._spawnDebris(type, position, inheritedVelocity, strength);
        break;
      default:
        break;
    }
  }

  _spawnDebris(type, position, inheritedVelocity, strength) {
    let color = [0.3, 0.28, 0.25];
    let size = 0.14;
    let life = 1.15;
    let lift = 2.8 + strength * 2.2;
    let jitter = 5 + strength * 2.5;
    if (type === 'gravel') {
      color = [0.27, 0.25, 0.21];
      size = 0.075;
      life = 0.8;
      lift = 1.6 + strength * 1.6;
      jitter = 3.8;
    } else if (type === 'vegetation') {
      color = Math.random() < 0.5 ? [0.16, 0.38, 0.12] : [0.32, 0.29, 0.12];
      size = 0.17;
      life = 1.5;
      lift = 2.2 + strength * 2.4;
    } else if (type === 'bird-strike') {
      color = Math.random() < 0.35 ? [0.48, 0.12, 0.09] : [0.22, 0.18, 0.14];
      size = 0.1;
      life = 0.95;
      lift = 1.8 + strength;
      jitter = 4.5;
    }
    this.debris.spawn(position, inheritedVelocity, {
      color,
      size: size * (0.8 + strength * 0.35),
      life,
      lift,
      jitter,
      spread: 0.8 + strength * 0.6,
      inherit: 0.32
    });
  }

  _localPosition(state, lateral = 0, up = 0, forward = 0) {
    const position = state.pos || {};
    const heading = finite(state.heading);
    const sine = Math.sin(heading);
    const cosine = Math.cos(heading);
    this._scratchPosition.set(
      finite(position.x) + lateral * cosine + forward * sine,
      finite(position.y) + up,
      finite(position.z) - lateral * sine + forward * cosine
    );
    return this._scratchPosition;
  }

  _makeSnapshot(state) {
    return {
      time: finite(state.time),
      onGround: Boolean(state.onGround),
      verticalSpeed: finite(state.verticalSpeed),
      hardLandings: finite(state.stats?.hardLandingCount),
      collisions: finite(state.stats?.collisions),
      structuralFailure: Boolean(state.damage?.structuralFailure),
      birdStrike: Boolean(state.damage?.birdStrike),
      treeStrike: finite(state.effects?.treeStrike),
      engines: (state.engines || []).map((engine) => ({
        damage: finite(engine?.damage),
        fire: Boolean(engine?.fire)
      }))
    };
  }

  _processEvents(state, previous, current) {
    const groundPosition = this._localPosition(state, 0, 0.18, -2.2);
    const hardLanding = current.hardLandings > previous.hardLandings;
    if (!previous.onGround && current.onGround) {
      const sink = finite(state.stats?.touchdownSink, previous.verticalSpeed);
      const gLoad = finite(state.stats?.touchdownG, 1);
      const intensity = clamp(Math.max(Math.abs(Math.min(0, sink)) / 3.2, (gLoad - 0.8) / 1.6, 0.35), 0.35, 2.4);
      this.emit(hardLanding ? 'hard-landing' : 'touchdown', groundPosition, intensity);
    } else if (hardLanding) {
      this.emit('hard-landing', groundPosition, 1.5);
    }

    if (current.collisions > previous.collisions) {
      this.emit('collision', this._localPosition(state, 0, 0.7, 0), 1 + Math.min(1.2, current.collisions - previous.collisions));
    }
    if (current.structuralFailure && !previous.structuralFailure) {
      this.emit('collision', this._localPosition(state, 0, 1.1, 0), 2.2);
    }
    if (current.birdStrike && !previous.birdStrike) {
      this.emit('bird-strike', this._localPosition(state, 0, 1.5, 3.5), 1);
    }
    if (current.treeStrike > 0.6 && previous.treeStrike <= 0.6) {
      this.emit('vegetation', this._localPosition(state, 0, 1, 1), 1.3);
    }

    const enginePositions = getAircraftParams(state).enginePositions || [];
    for (let i = 0; i < current.engines.length; i += 1) {
      const engine = current.engines[i];
      const oldEngine = previous.engines[i] || { damage: 0, fire: false };
      if (engine.damage - oldEngine.damage > 0.12 || (engine.fire && !oldEngine.fire)) {
        const enginePosition = enginePositions[i];
        const position = this._localPosition(
          state,
          finite(enginePosition?.x),
          finite(enginePosition?.y),
          finite(enginePosition?.z)
        );
        this.emit(engine.fire ? 'engine-smoke' : 'debris', position, 1.1);
      }
    }
  }
}
