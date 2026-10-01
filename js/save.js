/* =============================================================================
 * save.js — Step 9: the one save object, its version and its migrations.
 *
 * Everything the player keeps between sessions lives in a single versioned
 * object under one key (CONFIG.profile.keys.save):
 *
 *   {
 *     version: 3,
 *     profile:   { name: 'Racer', color: 'violet' },
 *     stats:     { races: 0, wins: 0, podiums: 0, totalTimeMs: 0 },
 *     progress:  { xp: 0, level: 1 },        <- Step 10
 *     unlocks:   { cars: ['relay'], tracks: ['flexnode'] },   <- Step 11
 *     bests:     { <trackId>: { <difficultyId>: { timeMs, lapMs } } },
 *     selection: { track: 'flexnode', difficulty: 'normal', car: 'relay' }
 *   }
 *
 * Rules the rest of the game relies on:
 *   - every read and write is wrapped in try/catch (private mode, file://,
 *     quotas and blocked storage all fall back to an in-memory save);
 *   - unknown or corrupt data never throws and never crashes the game — it is
 *     replaced by sane defaults, and the bad blob is simply ignored;
 *   - older versions migrate forward, including the pre-Step-9 keys that
 *     Steps 7 and 8 wrote, so no best time is ever lost.
 *
 * Base64 for export/import is implemented locally (UTF-8 safe) so the module
 * behaves identically in a browser, in jsdom and in a bare vm.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils } = OR;
  const P = CONFIG.profile;
  const K = P.keys;

  const VERSION = 3;

  /* ---- storage that never throws ------------------------------------------ */

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

  /* ---- base64 (UTF-8 safe, no environment dependency) --------------------- */

  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function toUtf8Bytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(++i);
        const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return bytes;
  }

  function fromUtf8Bytes(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i++];
      if (b < 0x80) {
        out += String.fromCharCode(b);
      } else if (b >= 0xc0 && b < 0xe0) {
        out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
      } else if (b >= 0xe0 && b < 0xf0) {
        out += String.fromCharCode(((b & 0x0f) << 12) |
          ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
      } else {
        const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) |
          ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        const off = cp - 0x10000;
        out += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
      }
    }
    return out;
  }

  function base64Encode(str) {
    const bytes = toUtf8Bytes(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : NaN;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : NaN;
      out += ALPHABET[b0 >> 2];
      out += ALPHABET[((b0 & 3) << 4) | (isNaN(b1) ? 0 : b1 >> 4)];
      out += isNaN(b1) ? '=' : ALPHABET[((b1 & 15) << 2) | (isNaN(b2) ? 0 : b2 >> 6)];
      out += isNaN(b2) ? '=' : ALPHABET[b2 & 63];
    }
    return out;
  }

  function base64Decode(text) {
    const clean = String(text).replace(/[\s=]+$/g, '').replace(/\s+/g, '');
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
      const value = ALPHABET.indexOf(clean[i]);
      if (value < 0) throw new Error('not base64');
      buffer = (buffer << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return fromUtf8Bytes(bytes);
  }

  /* ---- defaults and sanitising -------------------------------------------- */

  function defaults() {
    return {
      version: VERSION,
      profile: { name: P.defaultName, color: P.defaultColor },
      stats: { races: 0, wins: 0, podiums: 0, totalTimeMs: 0 },
      progress: { xp: 0, level: 1 },
      unlocks: starterUnlocks(),
      bests: {},
      selection: { track: null, difficulty: null, car: null }
    };
  }

  /** The level a total is worth, from the XP module when it is loaded. */
  function levelForXp(xp) {
    return OR.XP ? OR.XP.levelFor(xp) : 1;
  }

  /**
   * What every player has from the first launch: the starter car and every
   * item that unlocks at level 1. Step 11's whole unlock table lives in
   * CONFIG.unlocks, so this stays in sync with the screens for free.
   */
  function starterUnlocks() {
    const UN = CONFIG.unlocks;
    const cars = [CONFIG.cars.defaultId];
    const tracks = [];
    Object.keys(UN.cars).forEach(function (id) {
      if (UN.cars[id] <= 1 && cars.indexOf(id) === -1) cars.push(id);
    });
    Object.keys(UN.tracks).forEach(function (id) {
      if (UN.tracks[id] <= 1 && tracks.indexOf(id) === -1) tracks.push(id);
    });
    return { cars: cars, tracks: tracks };
  }

  /**
   * Keep only ids the game knows, in the config's own order, plus anything in
   * `always` (the starters). Junk from an import or a half-written save simply
   * disappears and duplicates cannot pile up, so the garage always lists cars
   * in the same order whatever the stored blob said.
   */
  function sanitiseIds(raw, table, always) {
    const out = [];
    const granted = Array.isArray(raw) ? raw : [];
    const keep = always || [];
    Object.keys(table).forEach(function (id) {
      if ((granted.indexOf(id) !== -1 || keep.indexOf(id) !== -1) &&
        out.indexOf(id) === -1) {
        out.push(id);
      }
    });
    return out;
  }

  function topos(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? Math.round(value) : 0;
  }

  function tocount(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function colorById(id) {
    for (let i = 0; i < P.colors.length; i++) {
      if (P.colors[i].id === id) return P.colors[i];
    }
    return null;
  }

  /** Only the shape the game understands survives; junk is dropped. */
  function sanitiseBests(raw) {
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

  function sanitise(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;

    const profile = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
    base.profile.name = Utils.sanitiseName(profile.name);
    base.profile.color = colorById(profile.color) ? profile.color : P.defaultColor;

    const stats = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
    base.stats.races = tocount(stats.races);
    base.stats.wins = Math.min(base.stats.races, tocount(stats.wins));
    base.stats.podiums = Math.min(base.stats.races, Math.max(base.stats.wins, tocount(stats.podiums)));
    base.stats.totalTimeMs = topos(stats.totalTimeMs);

    /* Step 10: XP is the source of truth; the stored level is a cache that is
       recomputed here, so a tampered or half-written save self-heals. */
    const progress = raw.progress && typeof raw.progress === 'object' ? raw.progress : {};
    base.progress.xp = Math.max(0, topos(progress.xp));
    base.progress.level = Math.max(1, levelForXp(base.progress.xp));

    base.bests = sanitiseBests(raw.bests);

    /* Step 11: unlocks are a stored list, validated against the config table.
       The starter items can never be missing, so a corrupt save cannot even
       lock the player out of the first car or the first track. */
    const unlocks = raw.unlocks && typeof raw.unlocks === 'object' ? raw.unlocks : {};
    const starter = starterUnlocks();
    base.unlocks.cars = sanitiseIds(unlocks.cars, CONFIG.unlocks.cars, starter.cars);
    base.unlocks.tracks = sanitiseIds(unlocks.tracks, CONFIG.unlocks.tracks, starter.tracks);

    const selection = raw.selection && typeof raw.selection === 'object' ? raw.selection : {};
    base.selection.track = typeof selection.track === 'string' ? selection.track : null;
    base.selection.difficulty = typeof selection.difficulty === 'string' ? selection.difficulty : null;
    /* A car that is not owned is not selected: fall back to the starter. */
    base.selection.car = typeof selection.car === 'string' &&
      base.unlocks.cars.indexOf(selection.car) !== -1 ? selection.car : null;

    return base;
  }

  /* ---- migrations ---------------------------------------------------------- */

  /**
   * Version chain. Each entry takes the previous shape and returns the next.
   * There is nothing to do for 0 -> 1 beyond the sanitising above (the import
   * of the pre-Step-9 keys is handled by readLegacy()); future steps append
   * `2: function (data) { ... }` here.
   */
  const MIGRATIONS = {
    0: function (data) { return data; },
    /* 1 -> 2 (Step 10): saves written before XP existed start at level 1 with
       nothing earned. Profile, stats, records and selections are untouched. */
    1: function (data) {
      if (!data.progress || typeof data.progress !== 'object') {
        data.progress = { xp: 0, level: 1 };
      }
      return data;
    },
    /* 2 -> 3 (Step 11): grant everything the player's level has earned, and
       — the important part — never lock anyone out of what they already had.
       A pre-Step-11 save could race every track and had only one car, so any
       track with a recorded time, and the track that was selected, are kept. */
    2: function (data) {
      const progress = data.progress && typeof data.progress === 'object' ? data.progress : {};
      const level = Math.max(1, levelForXp(Math.max(0, topos(progress.xp))));
      const fresh = starterUnlocks();

      Object.keys(CONFIG.unlocks.cars).forEach(function (id) {
        if (CONFIG.unlocks.cars[id] <= level && fresh.cars.indexOf(id) === -1) {
          fresh.cars.push(id);
        }
      });
      Object.keys(CONFIG.unlocks.tracks).forEach(function (id) {
        if (CONFIG.unlocks.tracks[id] <= level && fresh.tracks.indexOf(id) === -1) {
          fresh.tracks.push(id);
        }
      });
      /* Evidence of use: a best time on the track, or it was the selection. */
      Object.keys(sanitiseBests(data.bests)).forEach(function (trackId) {
        if (CONFIG.unlocks.tracks[trackId] && fresh.tracks.indexOf(trackId) === -1) {
          fresh.tracks.push(trackId);
        }
      });
      const chosen = data.selection && typeof data.selection.track === 'string'
        ? data.selection.track : null;
      if (chosen && CONFIG.unlocks.tracks[chosen] && fresh.tracks.indexOf(chosen) === -1) {
        fresh.tracks.push(chosen);
      }

      data.unlocks = fresh;
      if (!data.selection || typeof data.selection !== 'object') data.selection = {};
      /* Everyone drove the only car that existed before Step 11. */
      if (!data.selection.car) data.selection.car = CONFIG.cars.defaultId;
      return data;
    }
  };

  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return defaults();
    let data = raw;
    let version = typeof data.version === 'number' && isFinite(data.version)
      ? Math.floor(data.version) : 0;
    /* A save from a future build is not understood: start clean rather than
       half-read it, and never crash. */
    if (version > VERSION) return defaults();
    let guard = 0;
    while (version < VERSION && guard++ < 32) {
      const step = MIGRATIONS[version];
      data = step ? step(data) : data;
      version += 1;
      data.version = version;
    }
    return sanitise(data);
  }

  /**
   * Fold the older per-feature keys into a save object. Steps 7 and 8 wrote
   * best times under their own keys; those records must survive Step 9.
   */
  function readLegacy() {
    const legacy = { bests: {}, selection: {} };

    const tableRaw = readRaw(CONFIG.track.keys.best);
    if (tableRaw) {
      try {
        legacy.bests = sanitiseBests(JSON.parse(tableRaw));
      } catch (error) {
        legacy.bests = {};
      }
    }
    /* Still nothing? Step 7 stored a flat { difficulty: ms } table. */
    if (!Object.keys(legacy.bests).length) {
      const flatRaw = readRaw(CONFIG.difficulty.keys.best);
      if (flatRaw) {
        try {
          const flat = JSON.parse(flatRaw);
          if (flat && typeof flat === 'object') {
            CONFIG.difficulty.levels.forEach(function (level) {
              const ms = topos(flat[level.id]);
              if (ms) {
                if (!legacy.bests.flexnode) legacy.bests.flexnode = {};
                legacy.bests.flexnode[level.id] = { timeMs: ms, lapMs: 0 };
              }
            });
          }
        } catch (error) { /* ignored: treated as no legacy records */ }
      }
    }

    legacy.selection.track = readRaw(CONFIG.track.keys.selection);
    legacy.selection.difficulty = readRaw(CONFIG.difficulty.keys.selection);
    return legacy;
  }

  /* ---- the module ---------------------------------------------------------- */

  const Save = {
    VERSION: VERSION,
    key: K.save,
    _data: null,
    _lastError: null,

    /** The whole save (loaded and migrated once per page). */
    load() {
      if (Save._data) return Save._data;
      const raw = readRaw(K.save);

      if (raw === null) {
        /* First run of Step 9: adopt whatever earlier steps left behind and
           write the migrated save out, so the file exists from the first visit. */
        const legacy = readLegacy();
        const fresh = defaults();
        fresh.bests = legacy.bests;
        fresh.selection.track = legacy.selection.track;
        fresh.selection.difficulty = legacy.selection.difficulty;
        Save._data = sanitise(fresh);
        Save.write();
        return Save._data;
      }

      let storedVersion = 0;
      try {
        const parsed = JSON.parse(raw);
        /* Read the version BEFORE migrating: migrate() rewrites data.version
           in place, so afterwards it always looks current. */
        storedVersion = typeof parsed.version === 'number' ? parsed.version : 0;
        Save._data = migrate(parsed);
      } catch (error) {
        Save._lastError = String(error && error.message || error);
        Save._data = defaults();
      }
      /* An older save is upgraded on disk as soon as it is read, so the
         migration runs once rather than on every page load. */
      if (storedVersion !== VERSION) {
        writeRaw(K.save, JSON.stringify(Save._data));
      }
      return Save._data;
    },

    /** Replace the in-memory save (used by import and by migrations). */
    adopt(data) {
      Save._data = migrate(data);
      Save.write();
      return Save._data;
    },

    /** Persist. Returns false when storage is unavailable, never throws. */
    write() {
      if (!Save._data) return false;
      const ok = writeRaw(K.save, JSON.stringify(Save._data));
      if (!ok) Save._lastError = 'storage unavailable';
      return ok;
    },

    /** Force a re-read from storage (used by the tests). */
    reload() {
      Save._data = null;
      return Save.load();
    },

    /* ---- accessors ------------------------------------------------------ */

    profile() { return Save.load().profile; },
    stats() { return Save.load().stats; },
    /**
     * A snapshot of { xp, level }. It is deliberately a copy: an award takes a
     * "before" reading and then mutates the save, and a live reference would
     * show every caller the same, already-updated numbers.
     */
    progress() {
      const progress = Save.load().progress;
      return { xp: progress.xp, level: progress.level };
    },
    xp() { return Save.load().progress.xp; },
    level() { return Save.load().progress.level; },

    /**
     * Add XP (Step 10) and recompute the level. Returns the new totals plus
     * what changed, so the caller can show a toast without re-reading.
     */
    addXp(amount) {
      const progress = Save.load().progress;   // the live object: mutated here
      const gained = typeof amount === 'number' && isFinite(amount) && amount > 0
        ? Math.round(amount) : 0;
      const beforeLevel = progress.level;
      progress.xp += gained;
      progress.level = Math.max(1, levelForXp(progress.xp));
      if (gained > 0) Save.write();
      return {
        xp: progress.xp,
        level: progress.level,
        gained: gained,
        levelsGained: progress.level - beforeLevel,
        leveledUp: progress.level > beforeLevel
      };
    },
    bests() { return Save.load().bests; },
    selection() { return Save.load().selection; },

    /** The colour object for the profile (never null). */
    color() {
      return colorById(Save.load().profile.color) || colorById(P.defaultColor);
    },

    /**
     * Set the player name and/or colour. The name is sanitised and clamped to
     * CONFIG.profile.maxNameLength; an unknown colour is ignored.
     */
    setProfile(changes) {
      const profile = Save.load().profile;
      if (changes && typeof changes.name !== 'undefined') {
        profile.name = Utils.sanitiseName(changes.name);
      }
      if (changes && typeof changes.color !== 'undefined' && colorById(changes.color)) {
        profile.color = changes.color;
      }
      Save.write();
      return profile;
    },

    setBests(bests) {
      Save.load().bests = sanitiseBests(bests);
      Save.write();
      return Save.load().bests;
    },

    setSelection(trackId, difficultyId) {
      const selection = Save.load().selection;
      if (typeof trackId === 'string' && trackId) selection.track = trackId;
      if (typeof difficultyId === 'string' && difficultyId) selection.difficulty = difficultyId;
      Save.write();
      return selection;
    },

    /* ---- Step 11: what is unlocked, and the chosen car ------------------- */

    unlocks() { return Save.load().unlocks; },
    unlockedCars() { return Save.load().unlocks.cars.slice(); },
    unlockedTracks() { return Save.load().unlocks.tracks.slice(); },

    /**
     * Add granted ids. Only ids the config knows are stored, and the write
     * only happens when something actually changed, so sync() is cheap to
     * call after every race.
     */
    grantUnlocks(granted) {
      const unlocks = Save.load().unlocks;
      let changed = false;
      ['cars', 'tracks'].forEach(function (kind) {
        if (!granted || !Array.isArray(granted[kind])) return;
        granted[kind].forEach(function (id) {
          if (CONFIG.unlocks[kind][id] && unlocks[kind].indexOf(id) === -1) {
            unlocks[kind].push(id);
            changed = true;
          }
        });
      });
      if (changed) Save.write();
      return unlocks;
    },

    /** The saved car id, or null when none is set (or it is not owned). */
    car() {
      const selection = Save.load().selection;
      const unlocked = Save.load().unlocks.cars;
      return typeof selection.car === 'string' && unlocked.indexOf(selection.car) !== -1
        ? selection.car : null;
    },

    /** Only an owned car can be selected; a locked id is refused. */
    setCar(id) {
      const unlocked = Save.load().unlocks.cars;
      if (typeof id !== 'string' || unlocked.indexOf(id) === -1) return Save.car();
      Save.load().selection.car = id;
      Save.write();
      return id;
    },

    /* ---- career stats ---------------------------------------------------- */

    /**
     * Book a finished race. Called once, at the flag — quitting early must not
     * count as a race played (nor, in Step 10, as XP earned).
     */
    recordRace(result) {
      const stats = Save.load().stats;
      const timeMs = topos(result && result.timeMs);
      /* No place (0, missing, nonsense) counts the race but credits nothing. */
      const place = tocount(result && result.place);
      stats.races += 1;
      if (place === 1) stats.wins += 1;
      if (place >= 1 && place <= 3) stats.podiums += 1;
      stats.totalTimeMs += timeMs;
      Save.write();
      return {
        races: stats.races,
        wins: stats.wins,
        podiums: stats.podiums,
        totalTimeMs: stats.totalTimeMs,
        place: place
      };
    },

    /** "2:34.912" style total, or a dash when nothing has been raced. */
    totalTimeText() {
      return Save.load().stats.totalTimeMs ? Utils.formatTime(Save.load().stats.totalTimeMs) : '--:--.---';
    },

    /* ---- export / import / reset ----------------------------------------- */

    /** The whole save as a Base64 string that can be pasted anywhere. */
    export() {
      return base64Encode(JSON.stringify(Save.load()));
    },

    /**
     * Adopt a Base64 save. Returns { ok: true, data } or { ok: false, error }.
     * Corrupt input is reported, never thrown, and never destroys the current
     * save.
     */
    import(text) {
      if (typeof text !== 'string' || !text.trim()) {
        return { ok: false, error: 'Nothing to import.' };
      }
      let parsed = null;
      try {
        parsed = JSON.parse(base64Decode(text));
      } catch (error) {
        return { ok: false, error: 'That does not look like an Optimum Race save.' };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'That does not look like an Optimum Race save.' };
      }
      if (typeof parsed.version === 'number' && parsed.version > VERSION) {
        return { ok: false, error: 'That save comes from a newer version of the game.' };
      }
      Save.adopt(parsed);
      return { ok: true, data: Save._data };
    },

    /**
     * Wipe progress (stats and every record) and keep the profile: the player
     * is still the same person, just back at zero.
     */
    reset() {
      const fresh = defaults();
      fresh.profile = Save.load().profile;
      /* Step 11: unlocking is progress too, so it goes back to the starter
         car and track; the chosen track/difficulty/car are cleared. */
      fresh.selection.track = null;
      fresh.selection.difficulty = null;
      fresh.selection.car = null;
      /* Progress (XP and level) is part of "progress", so it goes back to 1. */
      Save._data = fresh;
      /* Make sure the older keys cannot resurrect deleted records. */
      writeRaw(CONFIG.track.keys.best, '{}');
      writeRaw(CONFIG.difficulty.keys.best, '{}');
      Save.write();
      return Save._data;
    }
  };

  OR.Save = Save;
})();
