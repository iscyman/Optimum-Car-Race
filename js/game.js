/* =============================================================================
 * game.js — state machine + fixed-timestep loop.
 *
 * States (Step 4):
 *   MENU -> COUNTDOWN -> RACING <-> PAUSED -> FINISHED -> (race again)
 *
 * RACING covers both the race and the short coast-out after the flag, so the
 * five states above are the whole state machine. Lap scoring lives in race.js.
 *
 * Extension points for later steps are marked with "STEP n" comments:
 *   STEP 5 — track data   : checkpoints come from Track.checkpoints.
 * Step 6: Game.entities contains the player and three independently scored rivals.
 * Step 7: startRace() captures the selected difficulty for the whole race, and
 * the flag records the best time for that difficulty.
 *   STEP 12 — events      : onRaceStart / onUpdate / onFinish hooks.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Track, Car, Input, Renderer, HUD, Audio, Race, Rivals, Collisions, Standings } = OR;

  /** Control presets */
  const IDLE = { left: false, right: false, throttle: false, brake: false };
  const COAST = { left: false, right: false, throttle: false, brake: true };

  /** The five race states. Keys are for code, values are the state strings. */
  const STATES = {
    MENU: 'menu',
    COUNTDOWN: 'countdown',
    RACING: 'racing',
    PAUSED: 'paused',
    FINISHED: 'finished'
  };

  /** Kept in Game.state as the canonical state machine value. */
  const GAME_STATES = STATES;

  const Game = {
    STATES: STATES,
    state: STATES.MENU,
    car: null,
    rivals: [],
    entities: [],
    difficulty: null,   // the level captured when the race started (Step 7)
    difficultyId: 'normal',
    gridView: null,
    controls: { left: false, right: false, throttle: false, brake: false },

    clock: 0,          // seconds since page load, drives cosmetic animation
    raceTimeMs: 0,     // live race timer (ms)
    finalTimeMs: 0,    // time shown on the finish screen
    cleanLaps: 0,        // Step 10: laps with no barrier contact
    lapWallBaseline: 0,  // car.wallHits at the start of the current lap
    countdown: 0,
    finishTimer: 0,
    coasting: false,   // true during the short roll-out after the flag
    pausedFrom: null,  // state to return to on resume
    menuS: 0,          // menu camera position along the lap
    results: null,
    prevY: 0,          // car y before the last step, for gate crossing

    _acc: 0,
    _last: 0,
    _raf: 0,
    _hooks: {},

    init(canvas) {
      Game.car = new Car();
      Game.car.race = Race;
      Game.entities = [Game.car];
      Game.menuS = Track.length * 0.62;
      Renderer.init(canvas);
      HUD.init();
      Game.controls = Input.state;

      window.addEventListener('resize', Game.handleResize);
      window.addEventListener('orientationchange', Game.handleResize);

      Game._last = performance.now();
      Game._raf = requestAnimationFrame(Game.loop);
      return Game;
    },

    /**
     * Lifecycle callbacks. Step 12 made this a list per event, so the events
     * engine can listen next to the finish screen (and the HUD) without
     * anyone stealing the hook from anyone else.
     */
    on(name, fn) {
      if (!Game._hooks[name]) Game._hooks[name] = [];
      Game._hooks[name].push(fn);
      return Game;
    },

    _emit(name, payload) {
      const list = Game._hooks[name];
      if (!list) return;
      list.slice().forEach(function (fn) { fn(payload); });
    },

    handleResize() {
      Renderer.resize();
      Renderer.buildMinimapPath();
    },

    /* ---- race flow ------------------------------------------------------- */

    /** Start (or restart) a race. Every bit of race state is reset here. */
    startRace(seed, difficultyId) {
      /* Step 11: a locked track can never be raced, however the selection got
         there (stale save, import, a hand-edited file). Hop to the first
         unlocked circuit before the grid is built. */
      if (OR.Cars) OR.Cars.ensureTrack();
      /* Step 12: onRaceStart. A modifier patch was applied by Events.start()
         before it called us, which is what makes the lap/shards override
         visible to Race.reset() and Shards.reset() below. */
      if (OR.Events) OR.Events.onRaceStart();
      Game.difficultyId = difficultyId || OR.Difficulty.currentId();
      Game.difficulty = OR.Difficulty.get(Game.difficultyId);
      Game.car.reset();
      OR.Shards.reset();          // Step 3: shards respawn on Race Again
      Game.rivals = Rivals.reset(Game.car, seed, Game.difficulty);
      Game.entities = [Game.car].concat(Game.rivals);
      Race.reset(Game.car);       // all grid slots begin before the line
      Collisions.reset();
      Standings.reset(Game.entities);
      Game.gridView = {
        x: Game.entities.reduce((sum, car) => sum + car.x, 0) / Game.entities.length,
        y: Game.entities.reduce((sum, car) => sum + car.y, 0) / Game.entities.length
      };
      Renderer.particles.length = 0;
      Renderer.marks.length = 0;
      Game.raceTimeMs = 0;
      Game.finalTimeMs = 0;
      Game.cleanLaps = 0;
      Game.lapWallBaseline = 0;
      Game._wasBoosting = false;
      Game._wasOnBarrier = false;
      Game._wasTouchingCar = false;
      Game.results = null;
      Game.finishTimer = 0;
      Game.coasting = false;
      Game.pausedFrom = null;
      Game.countdown = CONFIG.race.countdownSeconds;
      Game.prevY = Game.car.y;
      Input.reset();
      Game._setState(STATES.COUNTDOWN);
      Renderer.updateCamera(Game.car, 0, true, Game.gridView);
      Game._emit('raceStart');
    },

    /** Alias used by the pause menu. */
    restartRace() {
      Game.startRace();
    },

    returnToMenu() {
      /* Step 12: leaving the race (menu, quit) reverts any event modifier, so
         the next normal race runs on the shipped config. */
      if (OR.Events) OR.Events.stop();
      Game.car.reset();
      OR.Shards.reset();
      Race.reset();
      Rivals.clear();
      Game.gridView = null;
      Renderer.gridBlend = 0;
      Game.entities = [Game.car];
      Collisions.reset();
      Standings.reset(Game.entities);
      Renderer.particles.length = 0;
      Renderer.marks.length = 0;
      Game.coasting = false;
      Game.pausedFrom = null;
      Game.menuS = Track.length * 0.62;   // a photogenic part of the circuit
      Game._setState(STATES.MENU);
    },

    /* ---- pause (Step 4) -------------------------------------------------- */

    canPause() {
      return Game.state === STATES.RACING ||
        Game.state === STATES.COUNTDOWN ||
        Game.state === STATES.PAUSED;
    },

    pause() {
      if (Game.state !== STATES.RACING && Game.state !== STATES.COUNTDOWN) return false;
      Game.pausedFrom = Game.state;
      Input.reset();
      Game._setState(STATES.PAUSED);
      return true;
    },

    resume() {
      if (Game.state !== STATES.PAUSED) return false;
      Game._setState(Game.pausedFrom || STATES.RACING);
      Game.pausedFrom = null;
      return true;
    },

    togglePause() {
      if (Game.state === STATES.PAUSED) return Game.resume();
      return Game.pause();
    },

    _setState(next) {
      Game.state = next;
      Game._emit('stateChange', next);
    },

    /**
     * The flag. The clock stops here, the car rolls to a stop, and the results
     * overlay appears after `finishDelayMs` — still inside the RACING state so
     * the machine only ever has the five documented states.
     */
    _finishRace() {
      Game.finalTimeMs = Game.raceTimeMs;
      Game.finishTimer = CONFIG.race.finishDelayMs / 1000;
      Game.coasting = true;
      const laps = Race.summary();
      Game.results = {
        timeMs: Game.finalTimeMs,
        lapTimes: laps.lapTimes,
        laps: laps.laps,
        bestLapMs: laps.bestLapMs,
        maxSpeedKmh: Game.car.maxSpeed,
        /* Step 3: CODED BOOST stats */
        boostsUsed: Game.car.boost.used,
        peakBoostKmh: Game.car.boost.peakKmh,
        shardsCollected: OR.Shards.collected,
        /* Step 6: classify once, at the player's flag; never invent AI times. */
        standings: Standings.finalize(),
        place: Standings.playerPlace,
        fieldSize: Game.entities.length,
        /* Step 7: difficulty + the best time for that difficulty. */
        difficultyId: Game.difficultyId,
        difficulty: Game.difficulty.label,
        /* Step 8: which circuit the race was run on. */
        trackId: Track.id,
        trackName: Track.name,
        trackRating: Track.rating,
        /* Step 10: XP is awarded here, at the flag — and only here, so a race
           the player quit early can never pay out. */
        cleanLaps: Game.cleanLaps,
        /* Step 12: barrier touches are needed by STEADY STREAM. */
        wallHits: Game.car.wallHits
      };
      /* Step 12: onFinish — judge the objective while the race facts are
         fresh, then pay a first completion as its own XP line. */
      Game.results.event = OR.Events ? OR.Events.judge(Game.results) : null;
      if (Game.results.event && Game.results.event.firstCompletion) {
        OR.Save.completeEvent(Game.results.event.id);
      }
      /* Step 13: the daily rotation. If that was today's featured event,
         log the day and move the streak; then pay today's bonus if it is
         still on the table — once per day, ever. */
      Game.results.daily = OR.Daily ? OR.Daily.completeRace(Game.results) : null;
      const bonusLines = [];
      if (Game.results.event && Game.results.event.firstCompletion) {
        bonusLines.push({ id: 'event', label: 'EVENT COMPLETE — ' + Game.results.event.name,
          xp: Game.results.event.xp });
      }
      if (Game.results.daily && Game.results.daily.bonusXp > 0) {
        const featured = OR.Daily.featured();
        bonusLines.push({ id: 'daily', label: 'DAILY BONUS — ' + (featured ? featured.name : 'TODAY'),
          xp: Game.results.daily.bonusXp });
      }
      Game.results.xp = OR.XP.award({
        difficultyId: Game.difficultyId,
        place: Game.results.place,
        laps: Game.results.laps,
        cleanLaps: Game.cleanLaps,
        boostsUsed: Game.results.boostsUsed,
        timeMs: Game.finalTimeMs,
        trackId: Track.id,
        extras: bonusLines
      });
      if (OR.Events) OR.Events.onFinish(Game.results.event);
      /* Step 8: records are per track AND per difficulty (time and lap). */
      const trackBest = OR.Bests.record(Track.id, Game.difficultyId, {
        timeMs: Game.finalTimeMs,
        lapMs: laps.bestLapMs
      });
      Game.results.trackBestMs = trackBest.timeMs;
      Game.results.trackBestLapMs = trackBest.lapMs;
      Game.results.isNewTrackBest = trackBest.isNewTime;
      Game.results.isNewBestLap = trackBest.isNewLap;

      /* Step 9: career stats and the driver identity, booked once per race.
         Quitting early never reaches this method, so it cannot count. */
      Game.results.driver = OR.Save.profile().name;
      Game.results.driverColor = OR.Save.color().hex;
      Game.results.career = OR.Save.recordRace({
        trackId: Track.id,
        difficultyId: Game.difficultyId,
        timeMs: Game.finalTimeMs,
        place: Standings.playerPlace
      });

      /* Step 7's per-difficulty record is kept as well, so its storage key and
         wording keep working exactly as before. */
      const best = OR.Difficulty.recordBest(Game.difficultyId, Game.finalTimeMs);
      Game.results.bestMs = best.bestMs;
      Game.results.previousBestMs = best.previousMs;
      Game.results.isNewBest = trackBest.isNewTime || best.isNewBest;
      Game.results.bestText = best.isNewBest
        ? OR.Difficulty.bestText(Game.difficultyId)
        : OR.Bests.timeText(Track.id, Game.difficultyId);
      Game._emit('finish', Game.results);
    },

    /** Called once the coast-out is over. */
    _showResults() {
      Game.coasting = false;
      Game._setState(STATES.FINISHED);
    },

    /**
     * Step 4: hand the car's movement to the lap scorer. Crossing the line
     * always brings the car back round to the start of the track (the track
     * repeats every lap), but a lap only counts with all checkpoints passed.
     */
    _scoreLap() {
      const car = Game.car;
      Rivals.score(Game.raceTimeMs);
      const outcome = Race.update(car, Game.raceTimeMs);
      Standings.update();
      if (!outcome) return;

      if (outcome === 'finish') {
        Game._countLapCleanliness();
        Race.finished = true;
        Game._finishRace();
        return;
      }
      if (outcome === 'lap') {
        Game._countLapCleanliness();
        Game._onLap();
      }
    },

    /**
     * Step 10: was the lap just completed a clean one? A clean lap is one with
     * no barrier contact at all — `car.wallHits` counts contact EPISODES, so a
     * long scrape is still one hit and a tap is not cheaper than a crash.
     */
    _countLapCleanliness() {
      const car = Game.car;
      const hits = Math.max(0, car.wallHits - Game.lapWallBaseline);
      Game.lapWallBaseline = car.wallHits;
      const clean = hits === 0;
      if (clean) Game.cleanLaps += 1;
      Game._emit('lap-cleanliness', { lap: Race.lap, clean: clean, hits: hits });
      return clean;
    },

    /** A lap was completed: fresh pickups for the new lap, and a lap event. */
    _onLap() {
      OR.Shards.reset();
      Game._emit('lap', {
        lap: Race.lap,
        lapTimes: Race.lapTimes.slice(),
        bestLapMs: Race.bestLapMs
      });
    },

    /* ---- loop ------------------------------------------------------------ */

    loop(now) {
      Game._raf = requestAnimationFrame(Game.loop);
      const raw = (now - Game._last) / 1000;
      Game._last = now;
      const dt = Math.min(raw, CONFIG.race.maxStep);

      if (Game.state !== STATES.PAUSED) Game.clock += dt;
      Game._acc += dt;
      const step = CONFIG.race.fixedStep;
      let guard = 0;
      while (Game._acc >= step && guard < 20) {
        Game.step(step);
        Game._acc -= step;
        guard++;
      }
      if (guard >= 20) Game._acc = 0;

      Game.render(dt);
    },

    /** One fixed physics/state tick. */
    step(dt) {
      const car = Game.car;
      Input.update();
      Game.controls = Input.state;

      // Step 4: Escape / P / the pause button.
      if (Input.consumePause() && Game.canPause()) Game.togglePause();

      // Space / Enter on a menu screen starts the race.
      const confirm = Input.consumeConfirm();
      if (confirm && (Game.state === STATES.MENU || Game.state === STATES.FINISHED)) {
        Game._emit('confirm');
      }

      switch (Game.state) {
        case 'menu':
          /* Step 5: the menu camera drifts around the real circuit. */
          Game.menuS = (Game.menuS + 260 * dt) % Track.length;
          break;

        case 'countdown': {
          // Input is locked until GO: the car gets an empty control set.
          Game.countdown -= dt;
          car.update(dt, IDLE);
          Game.prevY = car.y;
          if (Game.countdown <= 0) {
            Game.countdown = 0;
            Game.raceTimeMs = 0;
            Race.lapStartMs = 0;
            Game._setState(STATES.RACING);
            Game._emit('go');
          }
          break;
        }

        case 'racing': {
          Game.prevY = car.y;
          if (!Game.coasting) {
            Game.raceTimeMs += dt * 1000;
            if (Input.consumeBoost()) car.requestBoost(true);
            car.update(dt, Game.controls);
            Rivals.update(dt);
            Collisions.resolve(Game.entities, dt);
            Game._scoreLap();
          } else {
            car.update(dt, COAST);
            Rivals.coast(dt);
            Game.finishTimer -= dt;
            if (Game.finishTimer <= 0) Game._showResults();
          }
          break;
        }

        case 'paused':
          // Nothing moves: the clock, the car and the effects all hold still.
          break;

        case 'finished':
          car.update(dt, COAST);
          Rivals.coast(dt);
          break;
      }

      // Pause freezes rival stall indicators, pickups and visual effects too.
      if (Game.state === STATES.PAUSED) { Audio.idle(); return; }

      /* Step 13: optional haptics — the boost firing, and contact with a
         barrier or a rival. Off by default and every call is guarded.
         Contacts are edge-triggered: `hitWall`/`hitCar` are per-frame flags,
         so buzzing on them directly would vibrate 120 times a second while
         the car slides along a barrier. `touchingBarrier` is the episode
         flag, and the car contact gets a matching edge of its own. */
      if (OR.Haptics && Game.state === STATES.RACING) {
        if (car.boost.active && !Game._wasBoosting) OR.Haptics.boost();
        Game._wasBoosting = car.boost.active;

        const onBarrier = car.touchingBarrier === true;
        if (onBarrier && !Game._wasOnBarrier) OR.Haptics.wall();
        Game._wasOnBarrier = onBarrier;

        const touchingCar = car.hitCar === true;
        if (touchingCar && !Game._wasTouchingCar) OR.Haptics.car();
        Game._wasTouchingCar = touchingCar;
      }

      /* Step 12: onUpdate — the events engine reads the live race state and
         repaints the objective line (position, time, shards, wall hits). */
      if (OR.Events) OR.Events.onUpdate(dt);

      // Step 3: shard pickups top up the CODED BOOST meter
      OR.Shards.update(car, dt, Game.state === STATES.RACING && !Game.coasting);

      // cosmetic effects
      if (car.boost.active && Game.state !== 'menu') Renderer.emitBoostFlames(car, dt);
      if (car.hitWall && car.speed > 150 && Math.random() < dt * 30) Renderer.emitSparks(car);

      // tire marks while drifting or braking hard
      const marks = CONFIG.effects.tireMarks;
      const onTrack = Game.state === STATES.RACING || Game.state === STATES.FINISHED;
      if (onTrack && ((car.drifting && car.speed > marks.minDrift) ||
                      (car.braking && car.speed > marks.minBrakeSpeed))) {
        Renderer.emitTireMarks(car, dt);
      }

      Renderer.updateParticles(dt);
      Renderer.updateMarks(dt);

      // engine sound (Steps 2+): silent unless the player switched it on
      const driving = (Game.state === STATES.RACING && !Game.coasting) ||
        Game.state === STATES.COUNTDOWN;
      if (driving) Audio.update(car, Game.state === STATES.RACING);
      else Audio.idle();
    },

    render(dt) {
      const car = Game.car;
      if (Game.state === STATES.MENU) {
        /* a slow fly-along of the circuit behind the menu */
        const p = Track.pointAt(Game.menuS);
        const look = { x: p.x + p.tx * 260, y: p.y + p.ty * 260 };
        Renderer.updateCamera(look, dt, false);
      } else if (Game.state !== STATES.PAUSED) {
        Renderer.updateCamera(car, dt, false,
          Game.state === STATES.COUNTDOWN ? Game.gridView : null);
      }
      Renderer.draw(Game);
      if (Game.state !== 'menu') {
        HUD.update(Game);
        Renderer.drawMinimap(Game);
      }
    }
  };


  OR.Game = Game;
})();
