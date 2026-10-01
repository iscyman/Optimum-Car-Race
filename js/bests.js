/* =============================================================================
 * bests.js — Step 8: the record book, per TRACK and per DIFFICULTY.
 *
 * One storage key holds the whole table:
 *
 *   { "flexnode":       { "normal": { timeMs: 38900, lapMs: 12750 }, ... },
 *     "mesh-highway":   { ... },
 *     "shard-speedway": { ... } }
 *
 * Both numbers are stored per cell: the best race time and the best lap.
 * Everything is defensive — blocked storage (private mode, file://, quotas)
 * simply falls back to an in-memory table for the session, exactly like
 * Step 7's difficulty module.
 *
 * A flat Step 7 record ("best time per difficulty", no track) is migrated to
 * FLEXNODE on first read, so old saves are not thrown away.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils } = OR;
  const K = CONFIG.track.keys;

  /** localStorage that never throws. */
  function readRaw(key) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? null : value;
    } catch (error) {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  /** Positive finite number or 0. */
  function topos(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? value : 0;
  }

  function emptyCell() {
    return { timeMs: 0, lapMs: 0 };
  }

  /** Only keep the shape the game understands; junk is dropped silently. */
  function sanitise(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (trackId) {
      const byDifficulty = raw[trackId];
      if (!byDifficulty || typeof byDifficulty !== 'object') return;
      const row = {};
      Object.keys(byDifficulty).forEach(function (diffId) {
        const cell = byDifficulty[diffId];
        if (!cell || typeof cell !== 'object') return;
        const timeMs = topos(cell.timeMs);
        const lapMs = topos(cell.lapMs);
        if (timeMs || lapMs) row[diffId] = { timeMs: timeMs, lapMs: lapMs };
      });
      if (Object.keys(row).length) out[trackId] = row;
    });
    return out;
  }

  /** Step 7 records are per difficulty only: they belong to the default track. */
  function legacyTable() {
    const raw = readRaw(CONFIG.difficulty.keys.best);
    if (!raw) return null;
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const row = {};
    CONFIG.difficulty.levels.forEach(function (level) {
      const ms = topos(parsed[level.id]);
      if (ms) row[level.id] = { timeMs: ms, lapMs: 0 };
    });
    return Object.keys(row).length ? { flexnode: row } : null;
  }

  const Bests = {
    /* Session mirror: blocked storage must not break the current race. */
    _memory: null,

    _load() {
      if (Bests._memory) return Bests._memory;
      const raw = readRaw(K.best);
      let table = null;
      if (raw) {
        try {
          table = sanitise(JSON.parse(raw));
        } catch (error) {
          table = null;
        }
      }
      if (!table || !Object.keys(table).length) {
        const migrated = legacyTable();
        if (migrated) table = migrated;
      }
      Bests._memory = table || {};
      return Bests._memory;
    },

    _save() {
      writeRaw(K.best, JSON.stringify(Bests._memory));
      return Bests._memory;
    },

    /** Forget everything (used by tests and a future "reset records"). */
    clear() {
      Bests._memory = {};
      writeRaw(K.best, '{}');
      return Bests;
    },

    /** The whole table, as a plain object copy. */
    table() {
      return JSON.parse(JSON.stringify(Bests._load()));
    },

    /** { timeMs, lapMs } for one track + difficulty; zeroes when unset. */
    get(trackId, difficultyId) {
      const table = Bests._load();
      const row = table[trackId];
      const cell = row && row[difficultyId];
      return cell || emptyCell();
    },

    /** Race time only (0 = none). Used by the track select cards. */
    bestTime(trackId, difficultyId) {
      return topos(Bests.get(trackId, difficultyId).timeMs);
    },

    /** Best lap only (0 = none). */
    bestLap(trackId, difficultyId) {
      return topos(Bests.get(trackId, difficultyId).lapMs);
    },

    /**
     * Offer a finished race to the record book.
     * Returns the stored values plus what (if anything) improved.
     */
    record(trackId, difficultyId, result) {
      const table = Bests._load();
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
      if (isNewTime || isNewLap) Bests._save();

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
    }
  };

  OR.Bests = Bests;
})();
