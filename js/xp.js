/* =============================================================================
 * xp.js — Step 10: XP earned by racing, and the level it buys.
 *
 * Pure arithmetic plus one save write, so everything here is testable without
 * a DOM: the award values and the curve live in CONFIG.xp, the save owns the
 * running total, and this module decides what a given race was worth.
 *
 * What a finished race is worth (before the difficulty multiplier):
 *   finishing the race        +50
 *   1st / 2nd / 3rd           +100 / +60 / +30
 *   every clean lap           +20   (a lap with no barrier contact)
 *   boost use                 +5 per boost, capped at +20
 * then the whole total is scaled by the difficulty: EASY ×0.8, NORMAL ×1,
 * HARD ×1.3.
 *
 * Levels: the total XP to BE at level N is `levelBase * N ^ levelExponent`
 * (level 1 is 0). XP is the single source of truth — the level stored in the
 * save is a cache that is recomputed from the total on every load, so a
 * hand-edited or half-written save can never strand a player on a wrong level.
 *
 * Only a FINISHED race is ever awarded: quitting early never reaches
 * Game._finishRace(), where the award happens.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils } = OR;
  const X = CONFIG.xp;

  /** Whole numbers, and numeric strings (levels can arrive from a URL or JSON). */
  function toInt(value) {
    const n = typeof value === 'number' ? value : Number(value);
    return isFinite(n) ? Math.floor(n) : 0;
  }

  function ordinal(n) {
    if (n === 1) return '1st';
    if (n === 2) return '2nd';
    if (n === 3) return '3rd';
    return n + 'th';
  }

  const XP = {
    config: X,

    /* ---- the curve --------------------------------------------------------- */

    /** Total XP required to be at `level`. Level 1 is 0; monotonic after that. */
    xpForLevel(level) {
      const n = Math.max(1, toInt(level) || 1);
      if (n <= 1) return 0;
      return Math.round(X.levelBase * Math.pow(n, X.levelExponent));
    },

    /** The level a running XP total corresponds to (1-based). */
    levelFor(totalXp) {
      const xp = Math.max(0, toInt(totalXp));
      let level = 1;
      while (level < 9999 && xp >= XP.xpForLevel(level + 1)) level += 1;
      return level;
    },

    /** XP needed to get from `level` to `level + 1`. */
    xpToNext(level) {
      const n = Math.max(1, toInt(level) || 1);
      return XP.xpForLevel(n + 1) - XP.xpForLevel(n);
    },

    /** Everything the UI needs to draw one level bar. */
    progress(totalXp) {
      const xp = Math.max(0, toInt(totalXp));
      const level = XP.levelFor(xp);
      const floorXp = XP.xpForLevel(level);
      const needed = XP.xpToNext(level);
      const into = xp - floorXp;
      return {
        xp: xp,
        level: level,
        floorXp: floorXp,
        into: into,
        needed: needed,
        remaining: Math.max(0, needed - into),
        ratio: needed > 0 ? Utils.clamp(into / needed, 0, 1) : 0
      };
    },

    /** The race difficulty's multiplier (unknown ids are treated as ×1). */
    multiplier(difficultyId) {
      const value = X.multipliers[difficultyId];
      return typeof value === 'number' && isFinite(value) && value >= 0 ? value : 1;
    },

    /** Human label for a difficulty id, for the breakdown line. */
    difficultyLabel(difficultyId) {
      if (OR.Difficulty) return OR.Difficulty.get(difficultyId).label;
      return String(difficultyId || 'normal').toUpperCase();
    },

    /* ---- what one race was worth ------------------------------------------- */

    /**
     * The line-by-line breakdown. `lines` always sums exactly to `total`:
     * the difficulty adjustment is shown as its own line so the player can add
     * them up and land on the same number the save was given.
     */
    breakdown(result) {
      const r = result || {};
      const difficultyId = r.difficultyId || 'normal';
      const multiplier = XP.multiplier(difficultyId);

      const place = toInt(r.place);
      const laps = Math.max(0, toInt(r.laps));
      const cleanLaps = Utils.clamp(toInt(r.cleanLaps), 0, Math.max(0, laps));
      const boostsUsed = Math.max(0, toInt(r.boostsUsed));
      const boostXp = Math.min(X.boost.max, boostsUsed * X.boost.per);
      const placeBonus = X.placement[place] || 0;

      const lines = [
        { id: 'finish', label: 'Finishing the race', xp: X.finish },
        {
          id: 'placement',
          label: place > 0 ? 'Finished ' + ordinal(place) : 'No place recorded',
          xp: placeBonus
        },
        {
          id: 'cleanLaps',
          label: cleanLaps + (cleanLaps === 1 ? ' clean lap' : ' clean laps') +
            ' × ' + X.cleanLap,
          xp: cleanLaps * X.cleanLap
        },
        {
          id: 'boost',
          label: 'Boost use (' + boostsUsed + ' × ' + X.boost.per +
            ', max ' + X.boost.max + ')',
          xp: boostXp
        }
      ];

      const base = lines.reduce(function (sum, line) { return sum + line.xp; }, 0);
      const scaled = Math.round(base * multiplier);
      lines.push({
        id: 'difficulty',
        label: XP.difficultyLabel(difficultyId) + ' × ' + multiplier.toFixed(2),
        xp: scaled - base
      });

      /* Step 12: extras are flat bonuses that ride on top of the scaled race
         award (an event completion). They are NOT multiplied by difficulty,
         and each one is its own line, so the rows still add up exactly. */
      const extras = (Array.isArray(r.extras) ? r.extras : [])
        .filter(function (extra) { return extra && toInt(extra.xp) > 0; })
        .map(function (extra) {
          return { id: String(extra.id || 'bonus'), label: String(extra.label || 'Bonus'), xp: toInt(extra.xp) };
        });
      const extraXp = extras.reduce(function (sum, extra) { return sum + extra.xp; }, 0);
      extras.forEach(function (extra) { lines.push(extra); });
      const total = scaled + extraXp;

      return {
        lines: lines,
        base: base,
        multiplier: multiplier,
        scaled: scaled,
        extras: extras,
        extraXp: extraXp,
        difficultyId: difficultyId,
        total: total,
        place: place,
        laps: laps,
        cleanLaps: cleanLaps,
        boostsUsed: boostsUsed,
        cleanLapXp: cleanLaps * X.cleanLap,
        boostXp: boostXp,
        placementXp: placeBonus
      };
    },

    /**
     * Award a finished race. Writes through the save and reports exactly what
     * happened, including whether this race pushed the driver up a level.
     */
    award(result) {
      const breakdown = XP.breakdown(result);
      const before = OR.Save.progress();
      const after = OR.Save.addXp(breakdown.total);

      return {
        earned: breakdown.total,
        total: breakdown.total,
        base: breakdown.base,
        multiplier: breakdown.multiplier,
        lines: breakdown.lines,
        breakdown: breakdown,
        before: { xp: before.xp, level: before.level },
        after: { xp: after.xp, level: after.level },
        levelsGained: after.level - before.level,
        leveledUp: after.level > before.level,
        level: after.level
      };
    },

    /** A one-line summary for logs and the toast: "LEVEL 4 · 1872 XP". */
    summary(totalXp) {
      const p = XP.progress(totalXp);
      return 'LEVEL ' + p.level + ' · ' + p.xp + ' XP';
    }
  };

  OR.XP = XP;
})();
