/* =============================================================================
 * difficulty.js — Step 7: EASY / NORMAL / HARD for the rivals.
 *
 * One place owns everything difficulty-shaped:
 *   - the selectable levels, straight from CONFIG.difficulty.levels;
 *   - which level is selected, remembered in localStorage (always try/catch,
 *     so blocked storage simply falls back to the default);
 *   - the best race time per level.
 *
 * The rivals read the selected level once, at Rivals.reset(), so a race keeps
 * the difficulty it started with even if the menu selection changes later.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG } = OR;
  const D = CONFIG.difficulty;

  /** localStorage that never throws: private mode, file://, quotas, all fine. */
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

  function readJson(key, fallback) {
    const raw = readRaw(key);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function byId(id) {
    for (let i = 0; i < D.levels.length; i++) {
      if (D.levels[i].id === id) return D.levels[i];
    }
    return null;
  }

  const Difficulty = {
    levels: D.levels,
    defaultId: D.default,
    _id: D.default,
    /* Session mirror: blocked storage must not break the current race. */
    _memoryBest: {},

    /** The level object for an id, or the default when the id is unknown. */
    get(id) {
      return byId(id) || byId(Difficulty._id) || byId(D.default) || D.levels[0];
    },

    /**
     * Re-read the saved selection (called at boot and after storage errors).
     * Step 9: the choice lives inside the one save object; the old per-feature
     * key is only read by the migration when no save exists yet.
     */
    load() {
      const saved = OR.Save ? OR.Save.selection().difficulty : readRaw(D.keys.selection);
      Difficulty._id = byId(saved) ? saved : Difficulty.defaultId;
      return Difficulty._id;
    },

    currentId() {
      return Difficulty._id;
    },

    current() {
      return Difficulty.get(Difficulty._id);
    },

    /** Config numbers used by the rivals; a fresh object each call. */
    settings() {
      const level = Difficulty.current();
      return {
        id: level.id,
        label: level.label,
        rivalSpeed: level.rivalSpeed,
        cornerSkill: level.cornerSkill,
        stallIntervalScale: level.stallIntervalScale,
        stallDurationScale: level.stallDurationScale,
        rubberBand: level.rubberBand
      };
    },

    /** Choose a level and remember it. Never throws if storage is blocked. */
    select(id) {
      const level = byId(id) || Difficulty.current();
      Difficulty._id = level.id;
      if (OR.Save) OR.Save.setSelection(null, level.id);
      else writeRaw(D.keys.selection, level.id);
      return level;
    },

    /* ---- best race time per difficulty ---------------------------------- */

    /**
     * Best race time per difficulty. Step 8 made records per track, so this is
     * the best on the ACTIVE track — the number the finish screen is showing.
     */
    bestTimes() {
      const table = OR.Save ? OR.Save.bests() : null;
      const trackId = (OR.activeTrack && OR.activeTrack.id) || 'flexnode';
      const stored = table ? (table[trackId] || {}) : readJson(D.keys.best, {});
      const out = {};
      for (let i = 0; i < D.levels.length; i++) {
        const id = D.levels[i].id;
        const raw = table ? (stored[id] && stored[id].timeMs) : stored[id];
        out[id] = Math.max(topos(raw), topos(Difficulty._memoryBest[id]));
      }
      return out;
    },

    best(id) {
      return Difficulty.bestTimes()[Difficulty.get(id).id] || 0;
    },

    /**
     * Store a finish time if it beats the saved one.
     * Returns { bestMs, previousMs, isNewBest } even when storage is blocked.
     */
    recordBest(id, timeMs) {
      const level = Difficulty.get(id);
      const previousMs = Difficulty.best(level.id);
      const best = Difficulty.bestTimes();
      const isNewBest = timeMs > 0 && (!previousMs || timeMs < previousMs);
      if (isNewBest) {
        best[level.id] = timeMs;
        Difficulty._memoryBest[level.id] = timeMs;
        if (OR.Save) {
          /* One storage path for the whole game (Step 9): the record goes into
             the active track's row of the shared save. */
          const trackId = (OR.activeTrack && OR.activeTrack.id) || 'flexnode';
          const table = OR.Save.bests();
          if (!table[trackId]) table[trackId] = {};
          if (!table[trackId][level.id]) table[trackId][level.id] = { timeMs: 0, lapMs: 0 };
          table[trackId][level.id].timeMs = timeMs;
          OR.Save.write();
        } else {
          writeRaw(D.keys.best, JSON.stringify(best));
        }
      }
      return {
        bestMs: isNewBest ? timeMs : previousMs,
        previousMs: previousMs,
        isNewBest: isNewBest
      };
    },

    /** "Best on Normal 00:38.141" style text for the results screen. */
    bestText(id) {
      const level = Difficulty.get(id);
      const ms = Difficulty.best(level.id);
      const name = level.label.charAt(0) + level.label.slice(1).toLowerCase();
      return ms ? 'Best on ' + name + ' ' + OR.Utils.formatTime(ms) : 'No ' + name + ' time yet';
    }
  };

  Difficulty.load();
  OR.Difficulty = Difficulty;
})();
