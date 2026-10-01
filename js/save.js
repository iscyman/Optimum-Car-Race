/* =============================================================================
 * save.js — Step 9: the one save object, its version and its migrations.
 *
 * Everything the player keeps between sessions lives in a single versioned
 * object under one key (CONFIG.profile.keys.save):
 *
 *   {
 *     version: 1,
 *     profile:   { name: 'Racer', color: 'violet' },
 *     stats:     { races: 0, wins: 0, podiums: 0, totalTimeMs: 0 },
 *     bests:     { <trackId>: { <difficultyId>: { timeMs, lapMs } } },
 *     selection: { track: 'flexnode', difficulty: 'normal' }
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

  const VERSION = 1;

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
      bests: {},
      selection: { track: null, difficulty: null }
    };
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

    base.bests = sanitiseBests(raw.bests);

    const selection = raw.selection && typeof raw.selection === 'object' ? raw.selection : {};
    base.selection.track = typeof selection.track === 'string' ? selection.track : null;
    base.selection.difficulty = typeof selection.difficulty === 'string' ? selection.difficulty : null;

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
    0: function (data) { return data; }
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

      try {
        Save._data = migrate(JSON.parse(raw));
      } catch (error) {
        Save._lastError = String(error && error.message || error);
        Save._data = defaults();
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
      fresh.selection = Save.load().selection;
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
