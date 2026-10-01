/* =============================================================================
 * main.js — bootstrap: wires the DOM screens to the game state machine.
 * ========================================================================== */
(function () {
  'use strict';

  const { Game, Input, Utils, Renderer, Audio } = OR;

  const Screens = {
    menu: null,
    pause: null,
    finish: null,
    hud: null,
    touch: null,

    init() {
      Screens.menu = document.getElementById('menuScreen');
      Screens.pause = document.getElementById('pauseScreen');
      Screens.finish = document.getElementById('finishScreen');
      Screens.hud = document.getElementById('hud');
      Screens.touch = document.getElementById('touchControls');

      // ---- pause menu (Step 4) -------------------------------------------
      const pauseBtn = document.getElementById('pauseBtn');
      const resumeBtn = document.getElementById('resumeBtn');
      const restartBtn = document.getElementById('restartBtn');
      const quitBtn = document.getElementById('quitBtn');
      if (pauseBtn) {
        pauseBtn.addEventListener('click', e => {
          e.preventDefault();
          pauseBtn.blur();
          Game.togglePause();
        });
      }
      if (resumeBtn) {
        resumeBtn.addEventListener('click', e => {
          e.preventDefault();
          resumeBtn.blur();
          Game.resume();
        });
      }
      if (restartBtn) {
        restartBtn.addEventListener('click', e => {
          e.preventDefault();
          restartBtn.blur();
          Game.restartRace();
        });
      }
      if (quitBtn) {
        quitBtn.addEventListener('click', e => {
          e.preventDefault();
          quitBtn.blur();
          Game.returnToMenu();
        });
      }

      const startBtn = document.getElementById('startBtn');
      const againBtn = document.getElementById('againBtn');
      const menuBtn = document.getElementById('menuBtn');

      const start = e => {
        if (e) e.preventDefault();
        if (startBtn) startBtn.blur();
        Game.startRace();
      };
      if (startBtn) startBtn.addEventListener('click', start);
      if (againBtn) {
        againBtn.addEventListener('click', e => {
          e.preventDefault();
          againBtn.blur();
          Game.startRace();
        });
      }
      if (menuBtn) {
        menuBtn.addEventListener('click', e => {
          e.preventDefault();
          menuBtn.blur();
          Game.returnToMenu();
        });
      }

      // Engine sound: off until the player turns it on.
      const soundButtons = document.querySelectorAll('[data-action="sound"]');
      function syncSound() {
        const on = Audio.isEnabled();
        soundButtons.forEach(btn => {
          btn.classList.toggle('is-on', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          const label = btn.querySelector('.sound-label');
          if (label) label.textContent = on ? 'SOUND ON' : 'SOUND OFF';
        });
      }
      soundButtons.forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          btn.blur();
          Audio.toggle();
        });
      });
      Audio.onChange(syncSound);
      syncSound();

      // Large touch controls on real phones / tablets only: a coarse pointer
      // AND touch support. `?touch=1` forces the pad on for testing.
      const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
      const coarsePointer = window.matchMedia
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
      const forced = /[?&]touch=1/.test(window.location.search);
      if ((touchCapable && coarsePointer) || forced) {
        Input.enableTouchMode(true);
        Input.attachTouchPad(Screens.touch);
        document.body.classList.add('touch-mode');
      }

      Game.on('stateChange', Screens.setState);
      Game.on('finish', Screens.showFinish);
      Game.on('confirm', () => {
        if (Game.state === 'menu' || Game.state === 'finished') Game.startRace();
      });

      Screens.setState('menu');
      return Screens;
    },

    setState(state) {
      const inRace = state === 'countdown' || state === 'racing' ||
        state === 'paused';
      Screens.menu.classList.toggle('hidden', state !== 'menu');
      Screens.pause.classList.toggle('hidden', state !== 'paused');
      Screens.finish.classList.toggle('hidden', state !== 'finished');
      Screens.hud.classList.toggle('hidden', state === 'menu');
      const showTouch = inRace && state !== 'paused' &&
        document.body.classList.contains('touch-mode');
      Screens.touch.classList.toggle('hidden', !showTouch);
      document.body.classList.toggle('is-paused', state === 'paused');
    },

    showFinish(results) {
      document.getElementById('finalTime').textContent = Utils.formatTime(results.timeMs);
      document.getElementById('finalTopSpeed').textContent =
        Math.round(results.maxSpeedKmh) + ' km/h';
      document.getElementById('finalBoosts').textContent = String(results.boostsUsed);
      document.getElementById('finalBoostSpeed').textContent =
        Math.round(results.peakBoostKmh || 0) + ' km/h';
      document.getElementById('finalShards').textContent =
        results.shardsCollected + '/' + OR.Shards.items.length;

      /* ---- Step 4: lap splits, with the best lap highlighted ------------- */
      document.getElementById('finalBestLap').textContent =
        results.bestLapMs ? Utils.formatTime(results.bestLapMs) : '--:--.---';

      const splits = document.getElementById('lapSplits');
      if (splits) {
        splits.innerHTML = '';
        const times = results.lapTimes || [];
        let cumulative = 0;
        times.forEach((ms, i) => {
          cumulative += ms;
          const row = document.createElement('div');
          row.className = 'split' + (ms === results.bestLapMs ? ' is-best' : '');
          const name = document.createElement('span');
          name.className = 'split-label';
          name.textContent = 'LAP ' + (i + 1);
          const value = document.createElement('span');
          value.className = 'split-value';
          value.textContent = Utils.formatTime(ms);
          const total = document.createElement('span');
          total.className = 'split-total';
          total.textContent = Utils.formatTime(cumulative);
          row.appendChild(name);
          row.appendChild(value);
          row.appendChild(total);
          splits.appendChild(row);
        });
        const best = document.createElement('div');
        best.className = 'splits-note';
        best.textContent = results.bestLapMs
          ? 'BEST LAP ' + Utils.formatTime(results.bestLapMs) + ' highlighted'
          : '';
        splits.appendChild(best);
      }
    }
  };

  /**
   * Step 3: honour the OS "reduce motion" setting. Speed lines and the boost
   * camera zoom are skipped when it is on. `?motion=off` / `?motion=on`
   * override it, which is also how the automated checks exercise both paths.
   */
  function applyMotionPreference() {
    let reduced = false;
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      reduced = false;
    }
    const override = /[?&]motion=(off|on)/.exec(window.location.search);
    if (override) reduced = override[1] === 'off';
    Renderer.reducedMotion = reduced;
    document.body.classList.toggle('reduced-motion', reduced);
    return reduced;
  }

  function boot() {
    applyMotionPreference();
    const canvas = document.getElementById('gameCanvas');
    Game.init(canvas);
    Renderer.initMinimap(document.getElementById('minimap'));
    Renderer.buildSceneryLayer();
    window.setTimeout(() => {
      Renderer.buildMinimapPath();
    }, 120);
    Screens.init();
    // Keep the canvas crisp if the layout settles after fonts/images load.
    window.setTimeout(() => {
      Renderer.resize();
      Renderer.buildMinimapPath();
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  OR.Screens = Screens;
})();
