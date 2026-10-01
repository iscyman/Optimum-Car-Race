/* =============================================================================
 * main.js — bootstrap: wires the DOM screens to the game state machine.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Game, Input, Utils, Renderer, Audio, Difficulty, Save, Bests, TrackSelect } = OR;

  const Screens = {
    menu: null,
    pause: null,
    finish: null,
    hud: null,
    touch: null,
    /* Step 8: the menu has two panes — title ('main') and track select. */
    menuMain: null,
    menuTracks: null,
    menuProfile: null,
    view: 'main',

    init() {
      Screens.menu = document.getElementById('menuScreen');
      Screens.pause = document.getElementById('pauseScreen');
      Screens.finish = document.getElementById('finishScreen');
      Screens.hud = document.getElementById('hud');
      Screens.touch = document.getElementById('touchControls');
      Screens.menuMain = document.getElementById('menuMain');
      Screens.menuTracks = document.getElementById('menuTracks');
      Screens.menuProfile = document.getElementById('menuProfile');

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
          Screens.quitToMenu();
        });
      }

      // ---- difficulty picker (Step 7) ------------------------------------
      Screens.picker = document.getElementById('difficultyPicker');
      Screens.pickerHint = document.getElementById('difficultyHint');
      if (Screens.picker) {
        Difficulty.levels.forEach(level => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'diff-btn';
          btn.dataset.difficulty = level.id;
          btn.setAttribute('role', 'radio');
          btn.textContent = level.label;
          btn.title = level.blurb;
          btn.addEventListener('click', e => {
            e.preventDefault();
            Screens.selectDifficulty(level.id);
          });
          Screens.picker.appendChild(btn);
        });
        // Arrow keys move the selection while a button has focus.
        Screens.picker.addEventListener('keydown', e => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
            : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const ids = Difficulty.levels.map(l => l.id);
          const next = ids[(ids.indexOf(Difficulty.currentId()) + step + ids.length) % ids.length];
          Screens.selectDifficulty(next);
          const el = Screens.picker.querySelector('[data-difficulty="' + next + '"]');
          if (el) el.focus();
        });
        Screens.selectDifficulty(Difficulty.currentId());
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
          Screens.quitToMenu();
        });
      }

      /* ---- Step 8: track select pane ------------------------------------- */
      const trackBtn = document.getElementById('trackBtn');
      const trackStartBtn = document.getElementById('trackStartBtn');
      const trackBackBtn = document.getElementById('trackBackBtn');
      if (trackBtn) {
        trackBtn.addEventListener('click', e => {
          e.preventDefault();
          trackBtn.blur();
          Screens.showMenuView('tracks');
        });
      }
      if (trackStartBtn) {
        trackStartBtn.addEventListener('click', e => {
          e.preventDefault();
          trackStartBtn.blur();
          Game.startRace();
        });
      }
      if (trackBackBtn) {
        trackBackBtn.addEventListener('click', e => {
          e.preventDefault();
          trackBackBtn.blur();
          Screens.showMenuView('main');
        });
      }

      /* ---- Step 9: profile pane ------------------------------------------ */
      const profileBtn = document.getElementById('profileBtn');
      const profileBackBtn = document.getElementById('profileBackBtn');
      if (profileBtn) {
        profileBtn.addEventListener('click', e => {
          e.preventDefault();
          profileBtn.blur();
          Screens.showMenuView('profile');
        });
      }
      if (profileBackBtn) {
        profileBackBtn.addEventListener('click', e => {
          e.preventDefault();
          profileBackBtn.blur();
          Screens.showMenuView('main');
        });
      }

      Screens.nameInput = document.getElementById('profileName');
      Screens.nameCount = document.getElementById('profileNameCount');
      Screens.swatches = document.getElementById('profileColors');
      Screens.statsBox = document.getElementById('profileStats');
      Screens.recordsBox = document.getElementById('profileRecords');
      Screens.saveText = document.getElementById('profileSaveText');
      Screens.saveHint = document.getElementById('profileSaveHint');

      if (Screens.swatches) {
        CONFIG.profile.colors.forEach(color => {
          const swatch = document.createElement('button');
          swatch.type = 'button';
          swatch.className = 'color-swatch';
          swatch.dataset.color = color.id;
          swatch.setAttribute('role', 'radio');
          swatch.setAttribute('aria-checked', 'false');
          swatch.setAttribute('aria-label', color.label + ' car');
          swatch.title = color.label;
          swatch.style.setProperty('--swatch', color.hex);
          swatch.addEventListener('click', e => {
            e.preventDefault();
            Save.setProfile({ color: color.id });
            Screens.applyProfile();
          });
          Screens.swatches.appendChild(swatch);
        });
      }

      if (Screens.nameInput) {
        Screens.nameInput.addEventListener('input', () => {
          /* Live-sanitise while typing, so the field never shows junk. */
          const clean = Utils.sanitiseName(Screens.nameInput.value);
          if (Screens.nameInput.value !== clean) Screens.nameInput.value = clean;
          if (Screens.nameCount) {
            Screens.nameCount.textContent = clean.length + '/' + CONFIG.profile.maxNameLength;
          }
        });
        Screens.nameInput.addEventListener('change', () => {
          Save.setProfile({ name: Screens.nameInput.value });
          Screens.applyProfile();
        });
      }

      const exportBtn = document.getElementById('profileExportBtn');
      const importBtn = document.getElementById('profileImportBtn');
      const resetBtn = document.getElementById('profileResetBtn');
      if (exportBtn) {
        exportBtn.addEventListener('click', e => {
          e.preventDefault();
          exportBtn.blur();
          if (!Screens.saveText) return;
          Screens.saveText.value = Save.export();
          Screens.saveText.focus();
          Screens.saveText.select();
          let copied = false;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(Screens.saveText.value);
              copied = true;
            }
          } catch (error) { copied = false; }
          Screens.setSaveHint(copied
            ? 'Save copied to the clipboard. Keep it somewhere safe.'
            : 'Save shown below — copy the whole string to back it up.');
        });
      }
      if (importBtn) {
        importBtn.addEventListener('click', e => {
          e.preventDefault();
          importBtn.blur();
          if (!Screens.saveText || !Screens.saveText.value.trim()) {
            Screens.setSaveHint('Paste a Base64 save into the box first.');
            return;
          }
          const ok = window.confirm('Import this save? It replaces the current profile and progress.');
          if (!ok) return;
          const result = Save.import(Screens.saveText.value);
          if (!result.ok) {
            Screens.setSaveHint(result.error);
            return;
          }
          Screens.setSaveHint('Save imported. Profile and progress restored.');
          Screens.applyProfile();
          Difficulty.load();
          Screens.selectDifficulty(Difficulty.currentId());
          if (OR.TrackSelect) OR.TrackSelect.select(TrackSelect.savedId());
          Screens.showMenuView('profile');
        });
      }
      if (resetBtn) {
        resetBtn.addEventListener('click', e => {
          e.preventDefault();
          resetBtn.blur();
          const ok = window.confirm('Reset progress? Stats and every track record are deleted. ' +
            'Your name and colour are kept.');
          if (!ok) return;
          Save.reset();
          Screens.setSaveHint('Progress reset. Stats and records are empty again.');
          Screens.applyProfile();
          Screens.selectDifficulty(Difficulty.currentId());
          if (OR.TrackSelect) OR.TrackSelect.refresh();
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

    /**
     * Step 8/9: switch between the menu panes — title, track select, profile.
     */
    showMenuView(view) {
      Screens.view = view === 'tracks' ? 'tracks' : (view === 'profile' ? 'profile' : 'main');
      if (Screens.menuMain) Screens.menuMain.classList.toggle('hidden', Screens.view !== 'main');
      if (Screens.menuTracks) Screens.menuTracks.classList.toggle('hidden', Screens.view !== 'tracks');
      if (Screens.menuProfile) Screens.menuProfile.classList.toggle('hidden', Screens.view !== 'profile');
      if (Screens.view === 'tracks' && OR.TrackSelect) OR.TrackSelect.refresh();
      if (Screens.view === 'profile') Screens.refreshProfile();
      return Screens.view;
    },

    /** Quit to the menu — Step 8 lands on the track select screen. */
    quitToMenu() {
      Game.returnToMenu();
      Screens.showMenuView('tracks');
    },

    /** Highlight one difficulty button and explain what it does. */
    selectDifficulty(id) {
      const level = Difficulty.select(id);
      if (Screens.picker) {
        Array.from(Screens.picker.children).forEach(btn => {
          const on = btn.dataset.difficulty === level.id;
          btn.classList.toggle('is-selected', on);
          btn.setAttribute('aria-checked', on ? 'true' : 'false');
          btn.tabIndex = on ? 0 : -1;
        });
      }
      if (Screens.pickerHint) Screens.pickerHint.textContent = level.blurb;
      /* Track cards show the records for the selected difficulty. */
      if (OR.TrackSelect) OR.TrackSelect.refresh();
      return level;
    },

    /** Small helper for the save-file hint line. */
    setSaveHint(text) {
      if (Screens.saveHint) Screens.saveHint.textContent = text;
    },

    /** Paint the profile pane from the save (called whenever it opens). */
    refreshProfile() {
      const profile = Save.profile();
      const color = Save.color();
      if (Screens.nameInput) Screens.nameInput.value = profile.name;
      if (Screens.nameCount) {
        Screens.nameCount.textContent = profile.name.length + '/' + CONFIG.profile.maxNameLength;
      }
      if (Screens.swatches) {
        Array.from(Screens.swatches.children).forEach(swatch => {
          const on = swatch.dataset.color === color.id;
          swatch.classList.toggle('is-selected', on);
          swatch.setAttribute('aria-checked', on ? 'true' : 'false');
          swatch.tabIndex = on ? 0 : -1;
        });
      }
      if (Screens.statsBox) {
        const stats = Save.stats();
        const rows = [
          ['RACES', String(stats.races)],
          ['WINS', String(stats.wins)],
          ['PODIUMS', String(stats.podiums)],
          ['TOTAL TIME', Save.totalTimeText()]
        ];
        Screens.statsBox.replaceChildren();
        rows.forEach(([label, value]) => {
          const cell = document.createElement('div');
          cell.className = 'stat';
          const l = document.createElement('span');
          l.className = 'stat-label';
          l.textContent = label;
          const v = document.createElement('span');
          v.className = 'stat-value';
          v.textContent = value;
          cell.append(l, v);
          Screens.statsBox.appendChild(cell);
        });
      }
      if (Screens.recordsBox) {
        Screens.recordsBox.replaceChildren();
        Difficulty.levels.forEach(level => {
          const line = document.createElement('p');
          line.className = 'record-line';
          const best = OR.TRACKS.map(track =>
            track.name + ' ' + (Bests.bestTime(track.id, level.id)
              ? Utils.formatTime(Bests.bestTime(track.id, level.id)) : '—'));
          line.textContent = level.label + ' · ' + best.join(' · ');
          Screens.recordsBox.appendChild(line);
        });
      }
      return Screens;
    },

    /**
     * Push the profile into the running game: the car's paint, the name used
     * by the HUD standings, and the menu's "racing as" line.
     */
    applyProfile() {
      const profile = Save.profile();
      const color = Save.color();
      if (Game.car) {
        /* The HUD standings read the car's name/colour, so the change shows up
           on the next frame — no restart needed. Rivals keep their own. */
        Game.car.name = profile.name;
        Game.car.color = color.hex;
        Game.car.palette = color.body;
      }
      const racingAs = document.getElementById('racingAs');
      if (racingAs) {
        racingAs.textContent = 'Racing as ' + profile.name + ' · ' + color.label;
        racingAs.style.setProperty('--driver-color', color.hex);
      }
      Screens.refreshProfile();
      return Screens;
    },

    showFinish(results) {
      document.getElementById('finalDifficulty').textContent = results.difficulty || 'NORMAL';
      /* Step 8: which circuit, and its records for this difficulty. */
      const driver = document.getElementById('finalDriver');
      if (driver) {
        driver.textContent = results.driver || Save.profile().name;
        const dot = document.getElementById('finalDriverDot');
        if (dot) dot.style.background = results.driverColor || Save.color().hex;
      }
      const trackName = document.getElementById('finalTrack');
      if (trackName) trackName.textContent = results.trackName || OR.Track.name;
      const trackBest = document.getElementById('finalTrackBest');
      if (trackBest) {
        const time = results.trackBestMs ? Utils.formatTime(results.trackBestMs) : '--:--.---';
        const lap = results.trackBestLapMs ? Utils.formatTime(results.trackBestLapMs) : '--:--.---';
        trackBest.textContent = 'Track best ' + time + ' · best lap ' + lap;
        trackBest.classList.toggle('is-new', !!results.isNewTrackBest || !!results.isNewBestLap);
      }
      if (OR.TrackSelect) OR.TrackSelect.refresh();
      const bestTime = document.getElementById('finalBestTime');
      if (bestTime) {
        bestTime.textContent = results.isNewBest
          ? 'NEW ' + (results.bestText || '') : (results.bestText || '');
        bestTime.classList.toggle('is-new', !!results.isNewBest);
      }
      document.getElementById('finalPosition').textContent = results.place + ' / ' + results.fieldSize;
      const standings = document.getElementById('finalStandings');
      standings.replaceChildren();
      results.standings.forEach(driver => {
        const row = document.createElement('li');
        row.className = 'standing-row' + (driver.isPlayer ? ' is-player' : '');
        row.dataset.driver = driver.id;
        row.style.setProperty('--driver-color', driver.color);
        const rank = document.createElement('span');
        rank.className = 'standing-rank';
        rank.textContent = String(driver.place);
        const dot = document.createElement('span');
        dot.className = 'driver-dot';
        dot.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'standing-name';
        name.textContent = driver.name;
        const time = document.createElement('span');
        time.className = 'standing-time';
        time.textContent = driver.finished ? Utils.formatTime(driver.timeMs)
          : Math.ceil(driver.remainingMeters) + ' m left';
        row.append(rank, dot, name, time);
        standings.appendChild(row);
      });
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
    /* Step 8: build the track cards and restore the saved circuit. */
    if (OR.TrackSelect) OR.TrackSelect.init();
    /* Step 9: show the stored profile (name, colour, stats). */
    Screens.applyProfile();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  OR.Screens = Screens;
})();
