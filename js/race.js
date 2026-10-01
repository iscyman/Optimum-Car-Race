/* =============================================================================
 * race.js — laps, checkpoints, splits and best lap.
 *
 * Step 5 rewrote the track as a closed loop, so a lap is no longer measured
 * against a finish line's y position: the car's distance around the lap is
 * read from the track geometry and unwrapped into a continuous, always
 * increasing "progress" value U, where:
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

  const { CONFIG, Track, Utils } = OR;

  const Race = {
    laps: CONFIG.race.laps,
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

    reset() {
      Race.laps = CONFIG.race.laps;
      Race.lap = 1;
      Race.nextCheckpoint = 0;
      Race.checkpointsPassed = 0;
      Race.lapTimes.length = 0;
      Race.bestLapMs = 0;
      Race.lapStartMs = 0;
      Race.finished = false;
      Race.lastEvent = null;
      Race.progress = 0;
      Race.lapBase = 0;
      Race.hint = Track.startIndex;
      Race.lastFraction = 0;
      return Race;
    },

    /** Time on the current lap, given the race clock. */
    lapTimeMs(raceTimeMs) {
      return Math.max(0, raceTimeMs - Race.lapStartMs);
    },

    /** 1 -> the flag lap, 2 -> the last lap. Used for the HUD badge. */
    lapsRemaining() {
      return Math.max(0, Race.laps - (Race.lap - 1));
    },

    isFinalLap() {
      return Race.lap >= Race.laps;
    },

    /** How much of the current lap is done, 0 -> 1 (for the lap bar). */
    lapProgress(x, y) {
      const info = Track.nearest(x, y, Race.hint);
      return Utils.clamp(info.fraction, 0, 1);
    },

    /**
     * Called once per physics step while racing.
     * Returns 'lap' when a lap was completed, 'finish' on the final lap.
     */
    update(car, raceTimeMs) {
      Race.lastEvent = null;
      if (Race.finished) return null;

      const info = Track.nearest(car.x, car.y, Race.hint);
      Race.hint = info.index;
      const fraction = info.fraction;

      /* Unwrap the 0..1 lap position into a continuous value. A jump of more
         than half a lap between steps can only be a crossing of the line. */
      const delta = fraction - Race.lastFraction;
      if (delta < -0.5) Race.progress += 1 + delta;        // crossed forwards
      else if (delta > 0.5) Race.progress -= 1 - delta;    // crossed backwards
      else Race.progress += delta;
      Race.lastFraction = fraction;

      if (Race.progress < Race.lapBase - 1) Race.progress = Race.lapBase;
      if (Race.progress < 0) { Race.progress = 0; }

      /* Checkpoints, strictly in order, at lapBase + fraction. A gate also
         has to be physically reached: otherwise a car that is picked up and
         put down the road could collect the whole lap for free. */
      const cps = Track.checkpoints;
      const gateRadius = Track.hardLimit * 1.4;
      while (Race.nextCheckpoint < cps.length) {
        const cp = cps[Race.nextCheckpoint];
        if (Race.progress < Race.lapBase + cp.fraction) break;
        const dx = car.x - cp.x, dy = car.y - cp.y;
        if (dx * dx + dy * dy > gateRadius * gateRadius) break;
        Race.nextCheckpoint += 1;
        Race.checkpointsPassed += 1;
        Race.lastEvent = {
          type: 'checkpoint',
          lap: Race.lap,
          index: Race.nextCheckpoint - 1,
          timeMs: raceTimeMs
        };
      }

      /* The line itself. */
      if (Race.progress < Race.lapBase + 1) return null;

      if (Race.nextCheckpoint < cps.length) {
        // somehow reached the line without the gates: do not score it
        Race.lastEvent = { type: 'shortcut', lap: Race.lap, timeMs: raceTimeMs };
        Race.progress = Race.lapBase + 0.999;
        Race.lastFraction = 0.999;
        return 'shortcut';
      }

      const lapMs = raceTimeMs - Race.lapStartMs;
      Race.lapTimes.push(lapMs);
      if (!Race.bestLapMs || lapMs < Race.bestLapMs) Race.bestLapMs = lapMs;
      Race.lapStartMs = raceTimeMs;
      Race.nextCheckpoint = 0;
      Race.checkpointsPassed = 0;
      Race.lapBase += 1;

      if (Race.lap >= Race.laps) {
        Race.finished = true;
        Race.lastEvent = { type: 'finish', lap: Race.lap, timeMs: raceTimeMs, lapMs: lapMs };
        return 'finish';
      }

      Race.lap += 1;
      Race.lastEvent = { type: 'lap', lap: Race.lap - 1, timeMs: raceTimeMs, lapMs: lapMs };
      return 'lap';
    },

    /** Everything the finish screen needs about the laps. */
    summary() {
      return {
        laps: Race.lapTimes.length,
        lapTimes: Race.lapTimes.slice(),
        bestLapMs: Race.bestLapMs
      };
    }
  };

  OR.Race = Race.reset();
})();
