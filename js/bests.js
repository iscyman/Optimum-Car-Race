/* =============================================================================
 * bests.js — Step 8's record book, now stored inside the Step 9 save.
 *
 * The public API is unchanged: best race time and best lap per TRACK and per
 * DIFFICULTY, `record()` returning what changed, and the "Best on Normal …"
 * wording the finish screen uses. What changed underneath is the storage: the
 * table lives in OR.Save, so there is one save file, one version and one
 * migration path (see js/save.js).
 *
 *   {
 *     "flexnode":       { "normal": { timeMs: 38900, lapMs: 12750 }, ... },
 *     "mesh-highway":   { ... },
 *     "shard-speedway": { ... }
 *   }
 * ========================================================================== */
(function () {
  'use strict';

  const { Utils, Save } = OR;

  function topos(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? value : 0;
  }

  function emptyCell() {
    return { timeMs: 0, lapMs: 0 };
  }

  const Bests = {
    /** The live table (do not mutate; use record()). */
    _table() {
      return Save.bests();
    },

    /** A plain copy of the whole table. */
    table() {
      return JSON.parse(JSON.stringify(Save.bests()));
    },

    /** { timeMs, lapMs } for one track + difficulty; zeroes when unset. */
    get(trackId, difficultyId) {
      const row = Save.bests()[trackId];
      const cell = row && row[difficultyId];
      return cell ? { timeMs: topos(cell.timeMs), lapMs: topos(cell.lapMs) } : emptyCell();
    },

    /** Race time only (0 = none). Used by the track select cards. */
    bestTime(trackId, difficultyId) {
      return Bests.get(trackId, difficultyId).timeMs;
    },

    /** Best lap only (0 = none). */
    bestLap(trackId, difficultyId) {
      return Bests.get(trackId, difficultyId).lapMs;
    },

    /**
     * Offer a finished race to the record book.
     * Returns the stored values plus what (if anything) improved.
     */
    record(trackId, difficultyId, result) {
      const table = Save.bests();
      if (!table[trackId]) table[trackId] = {};
      const row = table[trackId];
      if (!row[difficultyId]) row[difficultyId] = emptyCell();
      const cell = row[difficultyId];

      const previousTimeMs = topos(cell.timeMs);
      const previousLapMs = topos(cell.lapMs);
      const timeMs = topos(result && result.timeMs);
      const lapMs = topos(result && result.lapMs);

      const isNewTime = timeMs > 0 && (!previousTimeMs || timeMs < previousTimeMs);
      const isNewLap = lapMs > 0 && (!previousLapMs || lapMs < previousLapMs);
      if (isNewTime) cell.timeMs = timeMs;
      if (isNewLap) cell.lapMs = lapMs;
      if (isNewTime || isNewLap) Save.write();

      return {
        timeMs: cell.timeMs,
        lapMs: cell.lapMs,
        previousTimeMs: previousTimeMs,
        previousLapMs: previousLapMs,
        isNewTime: isNewTime,
        isNewLap: isNewLap
      };
    },

    /** "Best on Normal 00:38.141" — the same wording Step 7 used. */
    timeText(trackId, difficultyId) {
      const level = OR.Difficulty.get(difficultyId);
      const name = level.label.charAt(0) + level.label.slice(1).toLowerCase();
      const ms = Bests.bestTime(trackId, level.id);
      return ms ? 'Best on ' + name + ' ' + Utils.formatTime(ms)
        : 'No ' + name + ' time yet';
    },

    /** "Best lap 00:12.930", or a dash when none has been set. */
    lapText(trackId, difficultyId) {
      const ms = Bests.bestLap(trackId, difficultyId);
      return ms ? 'Best lap ' + Utils.formatTime(ms) : 'Best lap --:--.---';
    },

    /** Forget every record (the "Reset progress" button uses Save.reset()). */
    clear() {
      Save.setBests({});
      return Bests;
    }
  };

  OR.Bests = Bests;
})();
