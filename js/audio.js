/* =============================================================================
 * audio.js — engine sound synthesised with the Web Audio API. No audio files.
 *
 * Sound is OFF by default. The AudioContext is only created when the player
 * presses the sound toggle, which is a user gesture, so autoplay policies are
 * respected and nothing runs until the player asks for it.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils } = OR;

  const Audio = {
    enabled: CONFIG.audio.defaultEnabled,
    ctx: null,
    nodes: null,
    _listeners: [],

    isEnabled() {
      return Audio.enabled;
    },

    /** Called by the UI whenever the on/off state changes. */
    onChange(fn) {
      Audio._listeners.push(fn);
      return Audio;
    },

    _notify() {
      for (let i = 0; i < Audio._listeners.length; i++) Audio._listeners[i](Audio.enabled);
    },

    setEnabled(on) {
      const next = !!on;
      if (next === Audio.enabled && Audio.ctx) {
        Audio._notify();
        return Audio;
      }
      Audio.enabled = next;
      if (next) {
        Audio._start();
      } else if (Audio.ctx) {
        // keep the graph alive but silent so toggling back on is instant
        Audio._setMasterGain(0);
        if (Audio.ctx.state === 'running') Audio.ctx.suspend();
      }
      Audio._notify();
      return Audio;
    },

    toggle() {
      return Audio.setEnabled(!Audio.enabled);
    },

    /** Build the synth graph. Must run inside a user gesture. */
    _start() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!Audio.ctx) {
        try {
          Audio.ctx = new Ctx();
        } catch (err) {
          return; // audio simply unavailable
        }
        Audio._build();
      }
      if (Audio.ctx.state === 'suspended') Audio.ctx.resume();
      Audio._setMasterGain(CONFIG.audio.masterGain);
    },

    _build() {
      const ctx = Audio.ctx;
      const cfg = CONFIG.audio;

      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      // --- engine: two detuned oscillators through a low-pass --------------
      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.5;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cfg.engine.filterBase;
      filter.Q.value = 6;

      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      const osc2Gain = ctx.createGain();
      osc2Gain.gain.value = 0.35;

      osc1.connect(engineGain);
      osc2.connect(osc2Gain);
      osc2Gain.connect(engineGain);
      engineGain.connect(filter);
      filter.connect(master);

      // --- wind / road noise: one looping noise buffer ---------------------
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = cfg.wind.filter;
      noiseFilter.Q.value = 0.8;

      const seconds = 2;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);

      osc1.start();
      osc2.start();
      noise.start();

      Audio.nodes = { master, engineGain, filter, osc1, osc2, noiseGain, noiseFilter };
    },

    _setMasterGain(value) {
      if (!Audio.nodes) return;
      const t = Audio.ctx.currentTime;
      Audio.nodes.master.gain.cancelScheduledValues(t);
      Audio.nodes.master.gain.setTargetAtTime(value, t, 0.08);
    },

    /** Called every physics step while the race is running. */
    update(car, racing) {
      if (!Audio.enabled || !Audio.nodes || !Audio.ctx) return;
      const ctx = Audio.ctx;
      const cfg = CONFIG.audio;
      const n = Audio.nodes;
      const t = ctx.currentTime;
      const ratio = Utils.clamp(car.speed / CONFIG.car.maxSpeed, 0, 1);

      // fake gearbox: pitch rises through a gear, then drops on the change
      const gears = cfg.engine.gearCount;
      const withinGear = (ratio * gears) % 1;
      const freq = cfg.engine.baseFreq
        + withinGear * cfg.engine.gearRange
        + ratio * 30;
      n.osc1.frequency.setTargetAtTime(freq, t, 0.05);
      n.osc2.frequency.setTargetAtTime(freq * 0.5, t, 0.05);

      const boostAdd = car.boost.active ? cfg.boost.filterAdd : 0;
      n.filter.frequency.setTargetAtTime(
        cfg.engine.filterBase + ratio * cfg.engine.filterSpeed + boostAdd, t, 0.08);

      const throttle = racing ? 1 : 0.45;
      n.engineGain.gain.setTargetAtTime(0.32 + ratio * 0.35 * throttle, t, 0.1);

      // wind rises with speed, and rumble rises off-road
      const surfaceBoost = car.surface === 'grass' ? 2.2 : car.surface === 'kerb' ? 1.4 : 1;
      n.noiseGain.gain.setTargetAtTime(
        cfg.wind.gain * ratio * surfaceBoost + (car.boost.active ? cfg.boost.gainAdd : 0),
        t, 0.12);
      n.noiseFilter.frequency.setTargetAtTime(
        cfg.wind.filter + ratio * 900 + boostAdd * 0.5, t, 0.12);
    },

    /** Silence the engine (menu, pause, finish) without turning audio off. */
    idle() {
      if (!Audio.enabled || !Audio.nodes) return;
      const t = Audio.ctx.currentTime;
      Audio.nodes.engineGain.gain.setTargetAtTime(0.06, t, 0.2);
      Audio.nodes.noiseGain.gain.setTargetAtTime(0, t, 0.2);
    }
  };

  OR.Audio = Audio;
})();
