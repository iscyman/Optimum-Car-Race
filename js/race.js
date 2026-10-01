/* =============================================================================
 * race.js — laps, checkpoints, splits and best lap.
 *
 * Step 5 rewrote the track as a closed loop, so a lap is no longer measured
 * against a finish line's y position: the car's distance around the lap is
 * read from the track geometry and unwrapped into a continuous "progress" value U, where:
 *
 *   U = 0.0   the start line at the beginning of lap 1
 *   U = 0.5   half way round lap 1
 *   U = 1.0   the start line again, lap 1 complete (lap 2 begins)
 *   U = 3.0   the flag, on a 3 lap race
 *
 * A checkpoint at fraction f of lap L sits at U = (L - 1) + f, so passing the
 * gates in order falls out of the maths, and driving backwards simply winds U
 * back down without ever awarding a lap. A lap still only counts when every
 * checkpoint has been passed, so a shortcut cannot skip one.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Track } = OR;

  const Race = {
    laps: 0,                // set from the track in reset() (Step 8)
    lapsOverride: null,     // Step 12: one-race lap count for events
    lap: 1,                 // 1-based, for the HUD
    nextCheckpoint: 0,      // index of the gate we are waiting for
    checkpointsPassed: 0,
    lapTimes: [],           // completed laps, ms
    bestLapMs: 0,           // best of lapTimes, 0 = none yet
    lapStartMs: 0,          // race clock when the current lap began
    finished: false,        // the flag has been crossed for the last time
    lastEvent: null,        // { type: 'lap' | 'checkpoint', lap, index, timeMs }
    progress: 0,            // continuous lap progress U
    lapBase: 0,             // U at which the current lap began
    hint: 0,                // track index hint for fast nearest-point lookups
    lastFraction: 0,        // raw 0..1 fraction, before unwrapping

    reset(car) {
      /* Step 12: an event can patch the lap count for its own race only
         (BLOCK RUSH is a single lap); a normal race leaves this null. */
      this.laps = Race.lapsOverride || Track.laps || CONFIG.race.laps;
      this.lap = 1;
      this.nextCheckpoint = 0;
      this.checkpointsPassed = 0;
      this.lapTimes.length = 0;
      this.bestLapMs = 0;
      this.lapStartMs = 0;
      this.finished = false;
      this.lastEvent = null;
      this.progress = 0;
      this.lapBase = 0;
      this.hint = Track.startIndex;
      this.lastFraction = 0;
      this.started = true;
      this.finishTimeMs = 0;
      if (car) {
        const info = Track.nearest(car.x, car.y, car.trackHint);
        this.hint = info.index;
        this.lastFraction = (info.fraction - Track.start.s / Track.length + 1) % 1;
        // A grid slot just before the line is NEGATIVE progress, not lap 1 done.
        this.progress = this.lastFraction > 0.5 ? this.lastFraction - 1 : this.lastFraction;
        this.started = this.progress >= 0;
      }
      return this;
    },

    /** Time on the current lap, given the race clock. */
    lapTimeMs(raceTimeMs) {
      return Math.max(0, raceTimeMs - this.lapStartMs);
    },

    /** 1 -> the flag lap, 2 -> the last lap. Used for the HUD badge. */
    lapsRemaining() {
      return Math.max(0, this.laps - (this.lap - 1));
    },

    isFinalLap() {
      return this.lap >= this.laps;
    },

    /** How much of the current lap is done, 0 -> 1 (for the lap bar). */
    lapProgress(x, y) {
      const info = Track.nearest(x, y, this.hint);
      return this.started
        ? (info.fraction - Track.start.s / Track.length + 1) % 1 : 0;
    },

    /**
     * Called once per physics step while racing.
     * Returns 'lap' when a lap was completed, 'finish' on the final lap.
     */
    update(car, raceTimeMs) {
      this.lastEvent = null;
      if (this.finished) return null;

      const info = Track.nearest(car.x, car.y, this.hint);
      this.hint = info.index;
      const fraction = (info.fraction - Track.start.s / Track.length + 1) % 1;

      /* Unwrap the 0..1 lap position into a continuous value. A jump of more
         than half a lap between steps can only be a crossing of the line. */
      const delta = fraction - this.lastFraction;
      if (delta < -0.5) this.progress += 1 + delta;        // crossed forwards
      else if (delta > 0.5) this.progress -= 1 - delta;    // crossed backwards
      else this.progress += delta;
      this.lastFraction = fraction;

      if (this.progress < this.lapBase - 1) this.progress = this.lapBase;
      if (this.started && this.progress < 0) this.progress = 0;
      if (!this.started && this.progress >= 0) this.started = true;

      /* Checkpoints, strictly in order, at lapBase + fraction. A gate also
         has to be physically reached: otherwise a car that is picked up and
         put down the road could collect the whole lap for free. */
      const cps = Track.checkpoints;
      const gateRadius = Track.hardLimit * 1.4;
      while (this.nextCheckpoint < cps.length) {
        const cp = cps[this.nextCheckpoint];
        if (this.progress < this.lapBase + cp.fraction) break;
        const dx = car.x - cp.x, dy = car.y - cp.y;
        if (dx * dx + dy * dy > gateRadius * gateRadius) break;
        this.nextCheckpoint += 1;
        this.checkpointsPassed += 1;
        this.lastEvent = {
          type: 'checkpoint',
          lap: this.lap,
          index: this.nextCheckpoint - 1,
          timeMs: raceTimeMs
        };
      }

      /* The line itself. */
      if (this.progress < this.lapBase + 1) return null;

      if (this.nextCheckpoint < cps.length) {
        // somehow reached the line without the gates: do not score it
        this.lastEvent = { type: 'shortcut', lap: this.lap, timeMs: raceTimeMs };
        this.progress = this.lapBase + 0.999;
        this.lastFraction = 0.999;
        return 'shortcut';
      }

      const lapMs = raceTimeMs - this.lapStartMs;
      this.lapTimes.push(lapMs);
      if (!this.bestLapMs || lapMs < this.bestLapMs) this.bestLapMs = lapMs;
      this.lapStartMs = raceTimeMs;
      this.nextCheckpoint = 0;
      this.checkpointsPassed = 0;
      this.lapBase += 1;

      if (this.lap >= this.laps) {
        this.finished = true;
        this.finishTimeMs = raceTimeMs;
        this.lastEvent = { type: 'finish', lap: this.lap, timeMs: raceTimeMs, lapMs: lapMs };
        return 'finish';
      }

      this.lap += 1;
      this.lastEvent = { type: 'lap', lap: this.lap - 1, timeMs: raceTimeMs, lapMs: lapMs };
      return 'lap';
    },

    /** Ranking cannot credit progress beyond a checkpoint that was skipped. */
    validProgress() {
      if (this.finished) return this.laps;
      const cp = Track.checkpoints[this.nextCheckpoint];
      return Math.min(this.progress, this.lapBase + (cp ? cp.fraction : 1));
    },

    /** Everything the finish screen needs about the laps. */
    summary() {
      return {
        laps: this.lapTimes.length,
        lapTimes: this.lapTimes.slice(),
        bestLapMs: this.bestLapMs
      };
    }
  };

  /** Independent checkpoint/lap state; the existing singleton stays the player. */
  Race.create = function (car) {
    const tracker = Object.create(Race);
    tracker.lapTimes = [];
    return tracker.reset(car);
  };

  OR.Race = Race.reset();
})();
