import * as THREE from 'three';
import { Sky } from './sky.js';
import { Airport } from './airport.js';
import { Aircraft } from './aircraft.js';
import { Cockpit } from './cockpit.js';

const CAMERA_MODES = new Set(['cockpit', 'chase', 'tower', 'flyby', 'wing']);

function normalizedCameraMode(mode) {
  const value = String(mode ?? 'cockpit').toLowerCase();
  if (value === 'external' || value === 'exterior' || value === 'follow') return 'chase';
  return CAMERA_MODES.has(value) ? value : 'cockpit';
}

export class World {
  constructor(container, options = {}) {
    this.container = container;
    this.typeId = options.aircraftType || 'b747-400';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.06, 20000);
    this.renderer = null;
    this.webglAvailable = false;
    this.disposed = false;
    this.cameraMode = 'cockpit';
    this.state = null;
    this.errorElement = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tempPosition = new THREE.Vector3();
    this.tempTarget = new THREE.Vector3();
    this.tempUp = new THREE.Vector3();
    this.lookDirection = new THREE.Vector3();
    this.lookRight = new THREE.Vector3();
    this.lookQuaternion = new THREE.Quaternion();
    this.look = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, active: false };
    this.zoom = 1;
    this.minZoom = 0.45;
    this.maxZoom = 3.2;

    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('无法初始化 3D 世界：请提供有效的画布容器。');
    }

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance'
      });
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setClearColor(0x9fc6dd, 1);
      this.renderer.domElement.style.display = 'block';
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.renderer.domElement.style.touchAction = 'none';
      container.appendChild(this.renderer.domElement);
      this.webglAvailable = true;
    } catch (error) {
      this.renderer = null;
      this.showError('无法启动 3D 飞行画面：当前浏览器或设备未提供 WebGL。请开启硬件加速，或更换支持 WebGL 的浏览器后重试。');
      return;
    }

    this.sky = new Sky(this.scene);
    this.airport = new Airport(this.scene);
    this.aircraft = new Aircraft(this.scene, this.typeId);
    this.cockpit = new Cockpit(this.aircraft.root, this.typeId);
    this.setCameraMode('cockpit');
    this.resize();
  }

  showError(message) {
    if (this.errorElement) this.errorElement.remove();
    const element = document.createElement('div');
    element.setAttribute('role', 'alert');
    element.textContent = message;
    Object.assign(element.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
      padding: '32px',
      color: '#fff4e8',
      background: '#18232b',
      font: '16px/1.8 sans-serif',
      textAlign: 'center',
      zIndex: '20',
      pointerEvents: 'none'
    });
    this.container.appendChild(element);
    this.errorElement = element;
  }

  setCameraMode(mode) {
    this.cameraMode = normalizedCameraMode(mode);
    const cockpit = this.cameraMode === 'cockpit';
    if (this.aircraft) this.aircraft.setExteriorVisible(!cockpit);
    if (this.cockpit) this.cockpit.setVisible(cockpit);
    this.camera.fov = cockpit ? 76 : this.cameraMode === 'chase' ? 62 : this.cameraMode === 'wing' ? 58 : 46;
    this.camera.near = cockpit ? 0.055 : 0.2;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    return this.cameraMode;
  }

  applyZoom() {
    if (!this.camera) return this.zoom;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    return this.zoom;
  }

  setZoom(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return this.zoom;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, next));
    return this.applyZoom();
  }

  adjustZoom(steps) {
    const amount = Number(steps);
    if (!Number.isFinite(amount) || amount === 0) return this.zoom;
    return this.setZoom(this.zoom * Math.exp(amount * 0.22));
  }

  resetZoom() {
    this.zoom = 1;
    return this.applyZoom();
  }

  setLook(yaw, pitch, immediate = false) {
    let wrapped = (Number(yaw) || 0) % (Math.PI * 2);
    if (wrapped > Math.PI) wrapped -= Math.PI * 2;
    if (wrapped < -Math.PI) wrapped += Math.PI * 2;
    this.look.targetYaw = wrapped;
    this.look.targetPitch = Math.max(-1.45, Math.min(1.45, Number(pitch) || 0));
    if (immediate) {
      this.look.yaw = this.look.targetYaw;
      this.look.pitch = this.look.targetPitch;
    }
    this.look.active = true;
  }

  resetLook(immediate = true) {
    this.look.active = false;
    this.look.targetYaw = 0;
    this.look.targetPitch = 0;
    if (immediate) {
      this.look.yaw = 0;
      this.look.pitch = 0;
    }
  }

  releaseLook() {
    this.resetLook(true);
  }

  getLook() {
    return { yaw: this.look.yaw, pitch: this.look.pitch, active: this.look.active };
  }

  updateLook(dt) {
    const rate = this.look.active ? 1 - Math.exp(-Math.max(dt, 0) * 22) : 1 - Math.exp(-Math.max(dt, 0) * 9);
    this.look.yaw += (this.look.targetYaw - this.look.yaw) * rate;
    this.look.pitch += (this.look.targetPitch - this.look.pitch) * rate;
    if (!this.look.active && Math.abs(this.look.yaw) < 0.0015 && Math.abs(this.look.pitch) < 0.0015) {
      this.look.yaw = 0;
      this.look.pitch = 0;
    }
  }

  applyLook(position, target, up) {
    if (Math.abs(this.look.yaw) < 1e-4 && Math.abs(this.look.pitch) < 1e-4) return target;
    this.lookDirection.subVectors(target, position);
    const distance = this.lookDirection.length();
    if (distance < 1e-5) return target;
    this.lookDirection.normalize();
    this.lookDirection.applyAxisAngle(up, this.look.yaw);
    this.lookRight.crossVectors(up, this.lookDirection).normalize();
    if (this.lookRight.lengthSq() > 1e-6) this.lookDirection.applyAxisAngle(this.lookRight, -this.look.pitch);
    target.copy(position).addScaledVector(this.lookDirection, distance);
    return target;
  }

  update(state, dt = 0) {
    if (!this.webglAvailable || this.disposed || !state) return;
    this.state = state;
    if (state.camera && normalizedCameraMode(state.camera) !== this.cameraMode) this.setCameraMode(state.camera);
    const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    this.aircraft.update(state, step);
    this.airport.update(state);
    if (this.cameraMode === 'cockpit') this.cockpit.update(state, step);
    this.updateLook(step);
    this.updateCamera(state, step);
    this.sky.update(state.environment, this.aircraft.root.position, this.camera, step, state.time);
  }

  updateCamera(state) {
    const root = this.aircraft.root;
    root.updateMatrixWorld(true);
    if (this.cameraMode === 'tower') {
      this.camera.position.set(-600, 52, 1810);
      this.camera.up.set(0, 1, 0);
      this.tempTarget.copy(root.position);
      this.tempTarget.y += 4;
      this.applyLook(this.camera.position, this.tempTarget, this.camera.up);
      this.camera.lookAt(this.tempTarget);
      return;
    }
    if (this.cameraMode === 'flyby') {
      this.camera.position.set(125, 18, -350);
      this.camera.up.set(0, 1, 0);
      this.tempTarget.copy(root.position);
      this.tempTarget.y += 3.5;
      this.applyLook(this.camera.position, this.tempTarget, this.camera.up);
      this.camera.lookAt(this.tempTarget);
      return;
    }

    const spec = this.aircraft.typeSpec || {};
    if (this.cameraMode === 'cockpit') {
      const eye = this.aircraft.cockpitEye || { x: -0.57, y: 5.55, z: 10.45 };
      const target = this.aircraft.cockpitTarget || { x: eye.x, y: eye.y + 0.4, z: eye.z + 7 };
      this.tempPosition.set(eye.x, eye.y, eye.z);
      this.tempTarget.set(target.x, target.y, target.z);
    } else if (this.cameraMode === 'wing') {
      const span = spec.wingspan || 35.8;
      this.tempPosition.set(span * 0.7, 12, -24);
      this.tempTarget.set(0, 5.2, 2);
    } else {
      const length = spec.length || 38;
      this.tempPosition.set(0, Math.max(10.5, length * 0.18), -length * 1.05);
      this.tempTarget.set(0, Math.max(4, length * 0.08), length * 0.14);
    }
    this.tempPosition.applyMatrix4(root.matrixWorld);
    this.tempTarget.applyMatrix4(root.matrixWorld);
    this.tempUp.set(0, 1, 0).applyQuaternion(root.quaternion);
    this.camera.position.copy(this.tempPosition);
    this.camera.up.copy(this.tempUp);
    this.applyLook(this.camera.position, this.tempTarget, this.camera.up);
    const shake = Math.min(1, Number(state?.effects?.shake) || 0);
    const rumble = state?.onGround ? Math.min(1, (Number(state.groundSpeed) || 0) / 55) : 0;
    const vibration = shake * 0.055 + rumble * 0.014;
    if (vibration > 1e-4) {
      const clock = Number(state?.time) || 0;
      this.camera.position.x += Math.sin(clock * 73.1) * vibration;
      this.camera.position.y += Math.sin(clock * 91.7 + 1.3) * vibration * 0.7;
      this.camera.position.z += Math.cos(clock * 67.3 + 0.7) * vibration * 0.5;
    }
    this.camera.lookAt(this.tempTarget);
  }

  render() {
    if (!this.webglAvailable || this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    if (!this.renderer || this.disposed) return;
    const width = Math.max(1, Math.floor(this.container.clientWidth || globalThis.innerWidth || 1));
    const height = Math.max(1, Math.floor(this.container.clientHeight || globalThis.innerHeight || 1));
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  pick(clientX, clientY) {
    if (!this.webglAvailable || this.disposed || this.cameraMode !== 'cockpit') return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.cockpit.pickables, false);
    for (const intersection of intersections) {
      const action = intersection.object.userData.action;
      if (!action) continue;
      if (intersection.object.userData.value !== undefined) return { action, value: intersection.object.userData.value };
      return action;
    }
    return null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    this.scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of objectMaterials) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        if (material.uniforms) {
          for (const uniform of Object.values(material.uniforms)) if (uniform?.value?.isTexture) textures.add(uniform.value);
        }
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    this.cockpit?.dispose();
    this.aircraft?.dispose();
    this.airport?.dispose();
    this.sky?.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.errorElement?.remove();
    this.scene.clear();
  }
}

export default World;
