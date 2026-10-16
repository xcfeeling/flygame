import { clamp, isOnPavedSurface } from './sim/config.js';

const SILENCE = 0.0001;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalized(value) {
  const number = Math.max(0, finite(value));
  return clamp(number > 2 ? number / 100 : number, 0, 1.25);
}

function warningName(warning) {
  if (typeof warning === 'string') return warning;
  if (!warning || typeof warning !== 'object') return String(warning ?? '');
  return `${warning.level ?? ''} ${warning.code ?? ''} ${warning.id ?? ''} ${warning.text ?? ''} ${warning.message ?? ''}`;
}

function isCriticalWarning(warning) {
  return /fire|overspeed|stall|pull.?up|terrain|warning|火警|失速|超速|告警/i.test(warningName(warning));
}

export class AudioSystem {
  constructor(options = {}) {
    this.volume = clamp(finite(options.volume, 0.65), 0, 1);
    this.muted = Boolean(options.muted);
    this.context = null;
    this.master = null;

    this._compressor = null;
    this._noiseBuffer = null;
    this._nodes = new Set();
    this._sources = new Set();
    this._engines = [];
    this._layers = {};
    this._previous = null;
    this._disposed = false;
    this._lastImpactAt = -Infinity;
    this._lastClickAt = -Infinity;
    this._lastWarningAt = -Infinity;
    this._speechUtterance = null;
  }

  get unlocked() {
    return this.context?.state === 'running';
  }

  getSettings() {
    return { volume: this.volume, muted: this.muted };
  }

  async unlock() {
    if (this._disposed) return false;

    if (!this.context) {
      const root = typeof window !== 'undefined' ? window : globalThis;
      const Context = root.AudioContext || root.webkitAudioContext;
      if (!Context) return false;

      try {
        this.context = new Context({ latencyHint: 'interactive' });
        this._buildGraph();
      } catch {
        if (this.context) {
          try {
            await this.context.close();
          } catch {
            // A partially initialized context may not be closable.
          }
        }
        this.context = null;
        this.master = null;
        return false;
      }
    }

    try {
      if (this.context.state !== 'running') await this.context.resume();
      this._applyMasterVolume();
      return this.context.state === 'running';
    } catch {
      return false;
    }
  }

  setVolume(value) {
    this.volume = clamp(finite(Number(value), this.volume), 0, 1);
    this._applyMasterVolume();
    return this.volume;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._applyMasterVolume();
    return this.muted;
  }

  update(state, dt = 0) {
    if (this._disposed || !state) return;

    const previous = this._previous;
    const snapshot = this._makeSnapshot(state);
    this._previous = snapshot;

    if (this.context && this.master && this.context.state === 'running') {
      this._updateContinuous(state, dt);
      const timeReset = previous && finite(state.time) < finite(previous.time);
      if (previous && !timeReset) this._processEvents(state, previous, snapshot);
    }
  }

  playClick(kind = 'button') {
    if (!this._canPlayEvent() || this.muted || this.volume <= 0) return false;
    const now = this.context.currentTime;
    if (now - this._lastClickAt < 0.012) return false;
    this._lastClickAt = now;

    const relay = kind === 'relay' || kind === 'electrical';
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = relay ? 'square' : 'sine';
    oscillator.frequency.setValueAtTime(relay ? 155 : 1050, now);
    oscillator.frequency.exponentialRampToValueAtTime(relay ? 85 : 720, now + 0.035);
    gain.gain.setValueAtTime(SILENCE, now);
    gain.gain.exponentialRampToValueAtTime(relay ? 0.024 : 0.014, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(SILENCE, now + (relay ? 0.055 : 0.035));
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.065);
    this._cleanAfter(oscillator, [oscillator, gain]);
    return true;
  }

  playRadio(text) {
    if (!this._canPlayEvent() || this.muted || this.volume <= 0) return false;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(620, now);
    oscillator.frequency.setValueAtTime(820, now + 0.11);
    gain.gain.setValueAtTime(SILENCE, now);
    gain.gain.exponentialRampToValueAtTime(0.025, now + 0.015);
    gain.gain.setValueAtTime(0.025, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.28);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
    this._cleanAfter(oscillator, [oscillator, gain]);

    if (text) this._speakRadio(String(text));
    return true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._previous = null;

    if (this._speechUtterance && typeof window !== 'undefined') {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // Speech is optional and must never affect the simulation.
      }
      this._speechUtterance = null;
    }

    for (const source of this._sources) {
      try {
        source.stop();
      } catch {
        // A source can already have stopped while its context was closing.
      }
    }
    for (const node of this._nodes) {
      try {
        node.disconnect();
      } catch {
        // Disconnecting an already detached node is harmless.
      }
    }
    this._sources.clear();
    this._nodes.clear();
    this._engines = [];
    this._layers = {};

    if (this.context && this.context.state !== 'closed') {
      try {
        const closing = this.context.close();
        if (closing?.catch) closing.catch(() => {});
      } catch {
        // Some embedded browsers do not allow explicit context closure.
      }
    }
    this.context = null;
    this.master = null;
    this._compressor = null;
    this._noiseBuffer = null;
  }

  _buildGraph() {
    const context = this.context;
    this.master = context.createGain();
    this._compressor = context.createDynamicsCompressor();
    this._compressor.threshold.value = -18;
    this._compressor.knee.value = 16;
    this._compressor.ratio.value = 5;
    this._compressor.attack.value = 0.006;
    this._compressor.release.value = 0.18;
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this._compressor);
    this._compressor.connect(context.destination);
    this._track(this.master, this._compressor);

    const frames = Math.max(1, Math.floor(context.sampleRate * 2));
    this._noiseBuffer = context.createBuffer(1, frames, context.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < frames; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.15 + white * 0.85;
      data[i] = previous;
    }

    this._engines = [];

    this._layers = {
      apu: this._makeOscillator('sawtooth', 480, 'lowpass', 2400),
      airflow: this._makeNoise('lowpass', 700),
      wind: this._makeNoise('lowpass', 420),
      rain: this._makeNoise('highpass', 1900),
      tires: this._makeNoise('lowpass', 240),
      brakes: this._makeNoise('bandpass', 950),
      flaps: this._makeOscillator('sawtooth', 92, 'bandpass', 480),
      gear: this._makeOscillator('square', 58, 'bandpass', 310),
      shaker: this._makeOscillator('square', 38, 'lowpass', 180),
      warning: this._makeOscillator('square', 840, 'lowpass', 2400)
    };
  }

  _makeEngine(index) {
    return {
      low: this._makeOscillator('sine', 38 + index * 2),
      high: this._makeOscillator('sawtooth', 130 + index * 4, 'lowpass', 900),
      noise: this._makeNoise('bandpass', 420),
      starter: this._makeOscillator('triangle', 85, 'bandpass', 420),
      reverse: this._makeNoise('bandpass', 720)
    };
  }

  _ensureEngineLayers(count) {
    while (this._engines.length < count) {
      this._engines.push(this._makeEngine(this._engines.length));
    }
  }

  _makeOscillator(type, frequency, filterType = null, filterFrequency = 1000) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.value = 0;
    let filter = null;

    if (filterType) {
      filter = this.context.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFrequency;
      filter.Q.value = filterType === 'bandpass' ? 1.4 : 0.7;
      oscillator.connect(filter);
      filter.connect(gain);
    } else {
      oscillator.connect(gain);
    }
    gain.connect(this.master);
    oscillator.start();
    this._track(oscillator, gain);
    if (filter) this._track(filter);
    this._sources.add(oscillator);
    return { source: oscillator, filter, gain };
  }

  _makeNoise(filterType, frequency) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this._noiseBuffer;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = filterType === 'bandpass' ? 0.9 : 0.65;
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(0, Math.random() * this._noiseBuffer.duration);
    this._track(source, filter, gain);
    this._sources.add(source);
    return { source, filter, gain };
  }

  _track(...nodes) {
    for (const node of nodes) this._nodes.add(node);
  }

  _applyMasterVolume() {
    if (!this.context || !this.master || this.context.state === 'closed') return;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.025);
  }

  _setParam(param, value, timeConstant = 0.06, epsilon = 0.001) {
    if (Math.abs(param.value - value) <= epsilon) return;
    param.setTargetAtTime(value, this.context.currentTime, timeConstant);
  }

  _updateContinuous(state) {
    const engines = Array.isArray(state.engines) ? state.engines : [];
    this._ensureEngineLayers(engines.length);

    for (let i = 0; i < this._engines.length; i += 1) {
      const layer = this._engines[i];
      const engine = engines[i] || {};
      const failed = Boolean(engine.failed);
      const running = Boolean(engine.running) && !failed;
      const n1 = normalized(engine.n1);
      const n2 = normalized(engine.n2);
      const thrust = clamp(finite(engine.thrust) / 120000, 0, 1.2);
      const load = clamp(n1 * 0.86 + thrust * 0.14, 0, 1.25);
      const audible = clamp(load + (running ? 0.018 : 0), 0, 1.25);

      this._setParam(layer.low.source.frequency, 36 + load * 82 + thrust * 9, 0.08, 0.2);
      this._setParam(layer.high.source.frequency, 115 + Math.pow(load, 1.15) * 980, 0.07, 0.5);
      this._setParam(layer.high.filter.frequency, 650 + load * 3900, 0.08, 2);
      this._setParam(layer.noise.filter.frequency, 330 + load * 2600, 0.08, 2);
      this._setParam(layer.low.gain.gain, 0.072 * audible, 0.07);
      this._setParam(layer.high.gain.gain, 0.019 * Math.pow(audible, 1.45), 0.08);
      this._setParam(layer.noise.gain.gain, 0.043 * Math.pow(audible, 1.8), 0.09);

      const starting = engine.starter && !failed ? clamp(0.3 + n2 * 0.7, 0, 1) : 0;
      this._setParam(layer.starter.source.frequency, 78 + n2 * 410 + n1 * 85, 0.045, 0.3);
      this._setParam(layer.starter.filter.frequency, 280 + n2 * 1050, 0.06, 2);
      this._setParam(layer.starter.gain.gain, 0.025 * starting, 0.035);

      const reverseAmount = failed ? 0 : normalized(engine.reverser) * clamp(n1 * 1.3, 0, 1);
      this._setParam(layer.reverse.filter.frequency, 580 + reverseAmount * 2200, 0.06, 2);
      this._setParam(layer.reverse.gain.gain, 0.073 * reverseAmount, 0.06);
    }

    const apu = state.systems?.apu || {};
    const apuRpm = normalized(apu.rpm);
    const apuLevel = apu.switch || apu.starter || apuRpm > 0.01 ? apuRpm : 0;
    this._setParam(this._layers.apu.source.frequency, 460 + apuRpm * 1480, 0.09, 0.5);
    this._setParam(this._layers.apu.filter.frequency, 1300 + apuRpm * 2800, 0.1, 2);
    this._setParam(this._layers.apu.gain.gain, 0.012 * apuLevel, 0.09);

    const airspeed = clamp(finite(state.airspeed) / 185, 0, 1.3);
    this._setParam(this._layers.airflow.filter.frequency, 420 + airspeed * 4600, 0.12, 2);
    this._setParam(this._layers.airflow.gain.gain, 0.06 * Math.pow(airspeed, 1.65), 0.1);
    this._setParam(this._layers.airflow.source.playbackRate, 0.72 + airspeed * 0.75, 0.12);

    const environment = state.environment || {};
    const wind = clamp(finite(environment.windSpeed, 2) / 35, 0, 1);
    const turbulence = clamp(finite(environment.turbulence), 0, 1);
    this._setParam(this._layers.wind.filter.frequency, 260 + wind * 1150 + turbulence * 500, 0.18, 2);
    this._setParam(this._layers.wind.gain.gain, 0.006 + wind * 0.025 + turbulence * 0.012, 0.16);

    const weather = String(environment.weather ?? 'clear').toLowerCase();
    const rain = /rain|storm|雨/.test(weather) ? 1 : 0;
    this._setParam(this._layers.rain.filter.frequency, 1600 + wind * 1700, 0.2, 2);
    this._setParam(this._layers.rain.gain.gain, rain * (0.018 + wind * 0.018), 0.2);

    const position = state.pos || {};
    const paved = isOnPavedSurface(finite(position.x), finite(position.z));
    const groundSpeed = clamp(finite(state.groundSpeed) / 90, 0, 1.25);
    const rolling = state.onGround ? groundSpeed : 0;
    this._setParam(this._layers.tires.filter.frequency, (paved ? 210 : 125) + rolling * (paved ? 950 : 520), 0.07, 2);
    this._setParam(this._layers.tires.source.playbackRate, 0.55 + rolling * 1.4, 0.07);
    this._setParam(this._layers.tires.gain.gain, (paved ? 0.047 : 0.068) * Math.pow(rolling, 0.8), 0.055);

    const brake = clamp(Math.max(finite(state.controls?.brake), finite(state.input?.brake)), 0, 1);
    this._setParam(this._layers.brakes.filter.frequency, 650 + rolling * 1850, 0.05, 2);
    this._setParam(this._layers.brakes.gain.gain, 0.032 * brake * Math.sqrt(rolling), 0.035);

    const flapsMoving = Boolean(state.flaps?.moving)
      || Math.abs(finite(state.flaps?.target) - finite(state.flaps?.left)) > 0.05;
    const gearMoving = Boolean(state.gear?.moving || state.gear?.inTransit);
    this._setParam(this._layers.flaps.source.frequency, 84 + Math.abs(finite(state.flaps?.target)) * 1.4, 0.04, 0.2);
    this._setParam(this._layers.flaps.gain.gain, flapsMoving ? 0.014 : 0, 0.035);
    this._setParam(this._layers.gear.gain.gain, gearMoving ? 0.024 : 0, 0.045);

    const shaker = Math.max(
      normalized(state.systems?.stickShaker),
      state.stallWarning || state.stalled ? 0.85 : 0
    );
    this._setParam(this._layers.shaker.gain.gain, 0.024 * shaker, 0.025);

    const warnings = Array.isArray(state.systems?.warnings) ? state.systems.warnings : [];
    const fire = engines.some((engine) => engine?.fire);
    const overspeed = Boolean(state.overspeed);
    const critical = fire || overspeed || Boolean(state.damage?.structuralFailure) || warnings.some(isCriticalWarning);
    const phase = this.context.currentTime;
    let warningGate = 0;
    let warningFrequency = 840;
    if (fire) {
      warningGate = phase % 1.15 < 0.58 ? 1 : 0.08;
      warningFrequency = 710;
    } else if (overspeed) {
      warningGate = phase % 0.19 < 0.085 ? 1 : 0;
      warningFrequency = 980;
    } else if (critical) {
      warningGate = phase % 0.8 < 0.18 ? 1 : 0;
    }
    this._setParam(this._layers.warning.source.frequency, warningFrequency, 0.025, 0.2);
    this._setParam(this._layers.warning.gain.gain, 0.018 * warningGate, 0.012);
  }

  _makeSnapshot(state) {
    const systems = state.systems || {};
    const controls = state.controls || {};
    const switchState = {
      battery: Boolean(systems.battery),
      externalPower: Boolean(systems.externalPower),
      avionics: Boolean(systems.avionics),
      apu: Boolean(systems.apu?.switch),
      apuBleed: Boolean(systems.apu?.bleed),
      bleedAir: Boolean(systems.bleedAir),
      generators: (systems.generators || []).map(Boolean).join(''),
      pumps: (systems.electricPumps || []).map(Boolean).join(''),
      packOff: Boolean(systems.packOff),
      probeHeat: Boolean(systems.probeHeat),
      windowHeat: Boolean(systems.windowHeat),
      beacon: Boolean(systems.beacon),
      navLights: Boolean(systems.navLights),
      landingLights: Boolean(systems.landingLights)
    };
    return {
      time: finite(state.time),
      onGround: Boolean(state.onGround),
      verticalSpeed: finite(state.verticalSpeed),
      hardLandings: finite(state.stats?.hardLandingCount),
      collisions: finite(state.stats?.collisions),
      birdStrike: Boolean(state.damage?.birdStrike),
      structuralFailure: Boolean(state.damage?.structuralFailure),
      treeStrike: finite(state.effects?.treeStrike),
      flapTarget: finite(state.flaps?.target, finite(controls.flapTarget)),
      gearTarget: finite(state.gear?.target, controls.gear === 'up' ? 0 : 1),
      reverse: Boolean(controls.reverse),
      parkingBrake: Boolean(controls.parkingBrake),
      switchState,
      warnings: new Set((systems.warnings || []).map(warningName).filter(Boolean))
    };
  }

  _processEvents(state, previous, current) {
    let clicks = 0;
    for (const [name, value] of Object.entries(current.switchState)) {
      if (previous.switchState[name] !== undefined && previous.switchState[name] !== value) {
        if (this.playClick('relay')) clicks += 1;
        if (clicks >= 4) break;
      }
    }

    if (current.flapTarget !== previous.flapTarget || current.gearTarget !== previous.gearTarget
      || current.reverse !== previous.reverse || current.parkingBrake !== previous.parkingBrake) {
      this.playClick('button');
    }

    const hardLanding = current.hardLandings > previous.hardLandings;
    if (!previous.onGround && current.onGround) {
      const sink = finite(state.stats?.touchdownSink, previous.verticalSpeed);
      const gLoad = finite(state.stats?.touchdownG, 1);
      const intensity = clamp(Math.max(Math.abs(Math.min(0, sink)) / 3.5, (gLoad - 0.8) / 1.8, 0.3), 0.25, 2);
      this._playImpact(intensity, hardLanding ? 'hard' : 'touchdown');
    } else if (hardLanding) {
      this._playImpact(1.45, 'hard');
    }

    if (current.collisions > previous.collisions) this._playImpact(1.55, 'collision');
    if (current.structuralFailure && !previous.structuralFailure) this._playImpact(2, 'structural');
    if (current.birdStrike && !previous.birdStrike) this._playImpact(0.65, 'bird');
    if (current.treeStrike > 0.55 && previous.treeStrike <= 0.55) this._playImpact(0.9, 'collision');

    for (const warning of current.warnings) {
      if (!previous.warnings.has(warning) && isCriticalWarning(warning)) {
        this._playWarningCue();
        break;
      }
    }
  }

  _playWarningCue() {
    if (!this._canPlayEvent() || this.muted || this.volume <= 0) return;
    const now = this.context.currentTime;
    if (now - this._lastWarningAt < 0.35) return;
    this._lastWarningAt = now;

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(920, now);
    oscillator.frequency.setValueAtTime(690, now + 0.12);
    gain.gain.setValueAtTime(SILENCE, now);
    gain.gain.exponentialRampToValueAtTime(0.026, now + 0.01);
    gain.gain.setValueAtTime(0.026, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.25);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.27);
    this._cleanAfter(oscillator, [oscillator, gain]);
  }

  _playImpact(intensity, kind) {
    if (!this._canPlayEvent() || this.muted || this.volume <= 0) return;
    const now = this.context.currentTime;
    if (now - this._lastImpactAt < 0.055) return;
    this._lastImpactAt = now;

    const strength = clamp(intensity, 0.15, 2);
    const duration = kind === 'structural' ? 0.75 : kind === 'collision' || kind === 'hard' ? 0.48 : 0.28;
    const oscillator = this.context.createOscillator();
    const oscillatorGain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'bird' ? 115 : 82 + strength * 16, now);
    oscillator.frequency.exponentialRampToValueAtTime(32, now + duration);
    oscillatorGain.gain.setValueAtTime(SILENCE, now);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.085 * strength, now + 0.006);
    oscillatorGain.gain.exponentialRampToValueAtTime(SILENCE, now + duration);
    oscillator.connect(oscillatorGain);
    oscillatorGain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    this._cleanAfter(oscillator, [oscillator, oscillatorGain]);

    const noise = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const noiseGain = this.context.createGain();
    noise.buffer = this._noiseBuffer;
    filter.type = kind === 'bird' ? 'bandpass' : 'lowpass';
    filter.frequency.value = kind === 'bird' ? 1250 : 480 + strength * 620;
    filter.Q.value = 0.8;
    noiseGain.gain.setValueAtTime(SILENCE, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.11 * strength, now + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(SILENCE, now + duration * 0.82);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.master);
    noise.start(now, Math.random() * Math.max(0.01, this._noiseBuffer.duration - duration));
    noise.stop(now + duration);
    this._cleanAfter(noise, [noise, filter, noiseGain]);
  }

  _speakRadio(text) {
    if (typeof window === 'undefined') return;
    try {
      const synthesis = window.speechSynthesis;
      const Utterance = window.SpeechSynthesisUtterance;
      if (!synthesis || !Utterance || synthesis.speaking) return;
      const utterance = new Utterance(text.slice(0, 180));
      utterance.lang = 'zh-CN';
      utterance.rate = 1.04;
      utterance.pitch = 0.95;
      utterance.volume = clamp(this.volume * 0.72, 0, 1);
      const voices = synthesis.getVoices?.() || [];
      const localChineseVoice = voices.find((voice) => voice.localService && /^zh/i.test(voice.lang));
      if (localChineseVoice) utterance.voice = localChineseVoice;
      this._speechUtterance = utterance;
      utterance.onend = () => {
        if (this._speechUtterance === utterance) this._speechUtterance = null;
      };
      utterance.onerror = utterance.onend;
      synthesis.speak(utterance);
    } catch {
      this._speechUtterance = null;
    }
  }

  _canPlayEvent() {
    return !this._disposed && this.context?.state === 'running' && this.master;
  }

  _cleanAfter(source, nodes) {
    source.onended = () => {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // The context may already have been disposed.
        }
      }
    };
  }
}
