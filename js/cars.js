/* =============================================================================
 * cars.js — Step 11: the four cars, their stat bars, and what unlocks when.
 *
 * Everything here is data-driven from CONFIG.cars and CONFIG.unlocks:
 *
 *   - `apply(id)` scales the numbers inside CONFIG.car / CONFIG.boost. car.js
 *     holds a reference to those same objects, so the physics picks the new
 *     values up on the next frame — there are no per-car code paths;
 *   - `select(id)` refuses a locked car, so a locked car can never be raced;
 *   - `sync()` grants whatever the player's level has earned and reports what
 *     is new, which is what the unlock toast is built from;
 *   - the same level rules cover tracks (`trackUnlocked`), so the track select
 *     screen and the race start share one source of truth.
 *
 * Locked never means "stuck": a save that predates Step 11 is migrated to
 * grant everything the player could already use (see js/save.js, version 3).
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils } = OR;
  const CARS = CONFIG.cars;
  const UN = CONFIG.unlocks;

  /* The pristine Step 2 tuning, captured before any car is applied, so
     restore() and every apply() start from the same numbers. */
  const BASE = {
    accel: CARS.base.accel,
    maxSpeed: CARS.base.maxSpeed,
    turnRateLow: CARS.base.turnRateLow,
    turnRateHigh: CARS.base.turnRateHigh,
    gripLow: CARS.base.gripLow,
    gripHigh: CARS.base.gripHigh,
    meterMax: CARS.base.meterMax,
    startShare: CONFIG.boost.startMeter / CONFIG.boost.meterMax
  };

  const STAT_ORDER = ['accel', 'topSpeed', 'handling', 'boost'];

  function byId(id) {
    for (let i = 0; i < CARS.list.length; i++) {
      if (CARS.list[i].id === id) return CARS.list[i];
    }
    return null;
  }

  /** The unlock level for an id in one of the tables (missing => level 1). */
  function levelOf(table, id) {
    const level = table[id];
    return typeof level === 'number' && isFinite(level) && level > 1 ? Math.floor(level) : 1;
  }

  /** Save may not be loaded yet in a bare vm; treat a missing save as empty. */
  function unlockedList(kind) {
    if (!OR.Save) return [];
    const unlocks = OR.Save.unlocks();
    const list = unlocks && unlocks[kind];
    return Array.isArray(list) ? list : [];
  }

  function granted(kind, id) {
    return unlockedList(kind).indexOf(id) !== -1;
  }

  const Cars = {
    ids: CARS.list.map(function (car) { return car.id; }),
    defaultId: byId(CARS.defaultId) ? CARS.defaultId : CARS.list[0].id,
    statOrder: STAT_ORDER.slice(),

    list() { return CARS.list.slice(); },

    has(id) { return !!byId(id); },

    get(id) { return byId(id) || byId(Cars.defaultId); },

    /** A copy of one car's multipliers (never the live config object). */
    stats(id) {
      const car = Cars.get(id);
      const out = {};
      STAT_ORDER.forEach(function (stat) { out[stat] = car.stats[stat]; });
      return out;
    },

    /* ---- unlocking ------------------------------------------------------ */

    unlockLevel(id) { return levelOf(UN.cars, id); },

    unlocked(id) { return granted('cars', id); },

    /** Every car id the player owns right now. */
    unlockedIds() {
      return Cars.ids.filter(function (id) { return Cars.unlocked(id); });
    },

    lockedIds() {
      return Cars.ids.filter(function (id) { return !Cars.unlocked(id); });
    },

    trackUnlockLevel(id) { return levelOf(UN.tracks, id); },

    trackUnlocked(id) { return granted('tracks', id); },

    trackLocked(id) { return !Cars.trackUnlocked(id); },

    /** The first track the player may race — the fallback for a stale pick. */
    firstUnlockedTrack() {
      const tracks = OR.TRACKS || [];
      for (let i = 0; i < tracks.length; i++) {
        if (Cars.trackUnlocked(tracks[i].id)) return tracks[i];
      }
      return tracks[0] || null;
    },

    /**
     * If the live track is locked (a stale selection, an imported save, a
     * hand-edited file) hop to the first one that is not. Returns the new
     * track, or null when nothing needed to change. Game.startRace() calls
     * this so a locked track can never be raced, whatever the UI says.
     */
    ensureTrack() {
      if (!OR.Track) return null;
      if (Cars.trackUnlocked(OR.Track.id)) return null;
      const fallback = Cars.firstUnlockedTrack();
      if (!fallback) return null;
      if (OR.TrackSelect) return OR.TrackSelect.select(fallback.id);
      OR.Track.use(fallback);
      return fallback;
    },

    /**
     * Grant everything the level has earned. Called on load and after every
     * finish. Returns { cars, tracks, names, any } where the arrays are only
     * the NEWLY granted items (so the toast can say what is new), and calling
     * it twice in a row reports nothing new the second time.
     */
    sync(level) {
      const current = typeof level === 'number' && isFinite(level) && level > 0
        ? Math.floor(level) : (OR.Save ? OR.Save.level() : 1);
      const fresh = { cars: [], tracks: [], names: [], any: false };

      Cars.ids.forEach(function (id) {
        if (!Cars.unlocked(id) && Cars.unlockLevel(id) <= current) fresh.cars.push(id);
      });
      (OR.TRACKS || []).forEach(function (track) {
        if (Cars.trackLocked(track.id) && Cars.trackUnlockLevel(track.id) <= current) {
          fresh.tracks.push(track.id);
        }
      });

      if (fresh.cars.length || fresh.tracks.length) {
        if (OR.Save) OR.Save.grantUnlocks(fresh);
        fresh.cars.forEach(function (id) { fresh.names.push(Cars.get(id).name); });
        fresh.tracks.forEach(function (id) {
          const track = OR.trackById ? OR.trackById(id) : null;
          fresh.names.push(track ? track.name : String(id).toUpperCase());
        });
        fresh.any = true;
      }
      return fresh;
    },

    /**
     * The next thing levels will bring, for the menu hint: the closest item
     * whose unlock level is still AHEAD of the player. Anything already at or
     * below the current level is skipped — sync() grants those, so they are
     * never what the player is working towards.
     */
    nextUnlock(level) {
      const current = typeof level === 'number' && isFinite(level) && level > 0
        ? Math.floor(level) : (OR.Save ? OR.Save.level() : 1);
      let best = null;
      function consider(kind, id, name, at) {
        if (at <= current) return;
        if (!best || at < best.level) {
          best = { kind: kind, id: id, name: name, level: at };
        }
      }
      Cars.ids.forEach(function (id) {
        if (Cars.unlocked(id)) return;
        consider('car', id, Cars.get(id).name, Cars.unlockLevel(id));
      });
      (OR.TRACKS || []).forEach(function (track) {
        if (!Cars.trackLocked(track.id)) return;
        consider('track', track.id, track.name, Cars.trackUnlockLevel(track.id));
      });
      if (best) best.levelsAway = Math.max(0, best.level - current);
      return best;
    },

    /* ---- applying a car to the physics ---------------------------------- */

    /** The car that should be driving: the saved pick, if it is unlocked. */
    activeId() {
      const saved = OR.Save ? OR.Save.car() : null;
      if (saved && Cars.has(saved) && Cars.unlocked(saved)) return saved;
      return Cars.defaultId;
    },

    /**
     * Write one car's multipliers into the live physics config. car.js and
     * every other physics reader sees the change immediately.
     */
    apply(id) {
      const stats = Cars.stats(id || Cars.activeId());
      CONFIG.car.accel = BASE.accel * stats.accel;
      CONFIG.car.maxSpeed = BASE.maxSpeed * stats.topSpeed;
      CONFIG.car.turnRateLow = BASE.turnRateLow * stats.handling;
      CONFIG.car.turnRateHigh = BASE.turnRateHigh * stats.handling;
      CONFIG.car.gripLow = BASE.gripLow * stats.handling;
      CONFIG.car.gripHigh = BASE.gripHigh * stats.handling;
      CONFIG.boost.meterMax = Math.round(BASE.meterMax * stats.boost);
      CONFIG.boost.startMeter = Math.round(CONFIG.boost.meterMax * BASE.startShare);
      return id || Cars.activeId();
    },

    /** Put the shipped Step 2 numbers back (tests, and the profile reset). */
    restore() {
      CONFIG.car.accel = BASE.accel;
      CONFIG.car.maxSpeed = BASE.maxSpeed;
      CONFIG.car.turnRateLow = BASE.turnRateLow;
      CONFIG.car.turnRateHigh = BASE.turnRateHigh;
      CONFIG.car.gripLow = BASE.gripLow;
      CONFIG.car.gripHigh = BASE.gripHigh;
      CONFIG.boost.meterMax = BASE.meterMax;
      CONFIG.boost.startMeter = Math.round(BASE.meterMax * BASE.startShare);
      return BASE;
    },

    /**
     * Choose a car: only an unlocked one is accepted. A locked id returns
     * null and changes nothing — that is what makes a locked car unraceable.
     */
    select(id) {
      if (!Cars.has(id) || !Cars.unlocked(id)) return null;
      Cars.apply(id);
      if (OR.Save) OR.Save.setCar(id);
      Cars.refresh();
      /* The menu's "X selected" line lives in main.js; keep it in step. */
      if (OR.Screens && OR.Screens.refreshCars) OR.Screens.refreshCars();
      return id;
    },

    /* ---- the stat bars -------------------------------------------------- */

    /**
     * One row per stat for the display bars: { id, label, value (0..1),
     * percent (how far from the base car), text ('+8%') }.
     */
    barRows(id) {
      const car = Cars.get(id);
      const bars = CARS.bars;
      return STAT_ORDER.map(function (stat) {
        const range = bars[stat];
        const value = car.stats[stat];
        const span = range.max - range.min;
        const percent = Math.round((value - 1) * 100);
        return {
          id: stat,
          label: range.label,
          value: value,
          bar: span > 0 ? Utils.clamp((value - range.min) / span, 0, 1) : 0,
          percent: percent,
          text: (percent > 0 ? '+' : '') + percent + '%'
        };
      });
    },

    /* ---- the car select screen ------------------------------------------ */

    /** Build the cards once, from the config. Locked state is refreshed after. */
    init(root) {
      if (!root) return null;
      const doc = root.ownerDocument || document;
      Cars.el = { root: root, cards: [] };
      root.replaceChildren();

      CARS.list.forEach(function (car) {
        const card = doc.createElement('button');
        card.type = 'button';
        card.className = 'car-card';
        card.dataset.car = car.id;
        card.dataset.unlockLevel = String(Cars.unlockLevel(car.id));
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', 'false');

        const lock = doc.createElement('span');
        lock.className = 'car-lock';
        const lockIcon = doc.createElement('span');
        lockIcon.className = 'lock-icon';
        lockIcon.textContent = '🔒';
        lockIcon.setAttribute('aria-hidden', 'true');
        const lockText = doc.createElement('span');
        lockText.className = 'lock-text';
        lock.append(lockIcon, lockText);

        const preview = doc.createElement('canvas');
        preview.className = 'car-preview';
        preview.width = 220;
        preview.height = 130;
        preview.setAttribute('aria-hidden', 'true');

        const head = doc.createElement('div');
        head.className = 'car-head';
        const name = doc.createElement('h3');
        name.className = 'car-name';
        name.textContent = car.name;
        const sub = doc.createElement('span');
        sub.className = 'car-subtitle';
        sub.textContent = car.subtitle;
        head.append(name, sub);

        const stats = doc.createElement('div');
        stats.className = 'stat-list';
        const fills = {};
        Cars.barRows(car.id).forEach(function (row) {
          const line = doc.createElement('div');
          line.className = 'stat-row';
          line.dataset.stat = row.id;
          const label = doc.createElement('span');
          label.className = 'stat-label';
          label.textContent = row.label;
          const bar = doc.createElement('span');
          bar.className = 'stat-bar';
          const fill = doc.createElement('span');
          fill.className = 'stat-fill';
          bar.appendChild(fill);
          const value = doc.createElement('span');
          value.className = 'stat-value';
          line.append(label, bar, value);
          stats.appendChild(line);
          fills[row.id] = { fill: fill, value: value };
        });

        const blurb = doc.createElement('p');
        blurb.className = 'car-blurb';
        blurb.textContent = car.blurb;

        const pick = doc.createElement('span');
        pick.className = 'car-pick';
        pick.textContent = 'SELECTED';

        card.append(lock, preview, head, stats, blurb, pick);
        card.addEventListener('click', function (e) {
          e.preventDefault();
          card.blur();
          if (!Cars.unlocked(car.id)) {
            card.classList.remove('is-refused');
            void card.offsetWidth;      // restart the shake animation
            card.classList.add('is-refused');
            return;
          }
          Cars.select(car.id);
        });

        root.appendChild(card);
        Cars.el.cards.push({ car: car, node: card, lock: lockText, preview: preview, fills: fills });
      });

      Cars.refresh();
      return Cars.el;
    },

    /** Repaint selection, lock badges, bars and previews. */
    refresh() {
      if (!Cars.el) return null;
      const activeId = Cars.activeId();
      const level = OR.Save ? OR.Save.level() : 1;
      Cars.el.cards.forEach(function (card) {
        const id = card.car.id;
        const unlocked = Cars.unlocked(id);
        const selected = unlocked && id === activeId;
        const need = Cars.unlockLevel(id);

        card.node.classList.toggle('is-locked', !unlocked);
        card.node.classList.toggle('is-selected', selected);
        card.node.dataset.locked = unlocked ? 'false' : 'true';
        card.node.dataset.selected = selected ? 'true' : 'false';
        card.node.setAttribute('aria-checked', selected ? 'true' : 'false');
        card.node.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
        card.node.tabIndex = unlocked ? 0 : -1;
        card.node.setAttribute('aria-label', card.car.name + ' — ' +
          (unlocked ? (selected ? 'selected' : 'available')
                    : 'locked, unlocks at level ' + need));
        card.lock.textContent = 'LOCKED · LEVEL ' + need + ' (now ' + level + ')';

        Cars.barRows(id).forEach(function (row) {
          const parts = card.fills[row.id];
          if (!parts) return;
          parts.fill.dataset.value = String(Math.round(row.bar * 100));
          parts.fill.style.width = Math.round(row.bar * 100) + '%';
          parts.value.textContent = row.text;
        });

        Cars.drawPreview(card.preview, id, unlocked);
      });
      return activeId;
    },

    /**
     * A small top-down car for the cards, painted in the player's chosen
     * colours. Deliberately self-contained: no game state, no camera.
     */
    drawPreview(canvas, id, unlocked) {
      if (!canvas || !canvas.getContext) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const color = OR.Save ? OR.Save.color() : null;
      const body = (color && color.body) || ['#3a2f6b', '#6f5bd6', '#5a49b8', '#2a2350'];
      const accent = (color && color.hex) || '#8f7bff';
      const w = canvas.width, h = canvas.height;
      const carW = w * 0.34, carL = h * 0.72;

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);

      // ground glow
      const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, w * 0.42);
      glow.addColorStop(0, Utils.rgba(accent, unlocked ? 0.30 : 0.10));
      glow.addColorStop(1, Utils.rgba(accent, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.42, 0, Math.PI * 2);
      ctx.fill();

      // wheels
      ctx.fillStyle = '#0a0c14';
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
        Utils.roundRect(ctx, s[0] * (carW / 2 - 2) - (s[0] < 0 ? 11 : 0),
          s[1] * (carL * 0.30) - 13, 11, 26, 4);
        ctx.fill();
      });

      // body
      const paint = ctx.createLinearGradient(-carW / 2, 0, carW / 2, 0);
      paint.addColorStop(0, body[0]);
      paint.addColorStop(0.45, body[1]);
      paint.addColorStop(0.55, body[2]);
      paint.addColorStop(1, body[3]);
      ctx.fillStyle = paint;
      Utils.roundRect(ctx, -carW / 2, -carL / 2, carW, carL, 14);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = Utils.rgba(accent, unlocked ? 0.7 : 0.3);
      ctx.stroke();

      // nose, cockpit and spoiler
      ctx.fillStyle = Utils.rgba(accent, unlocked ? 0.9 : 0.35);
      Utils.roundRect(ctx, -carW * 0.3, -carL / 2 + 5, carW * 0.6, 7, 4);
      ctx.fill();
      ctx.fillStyle = '#0c1020';
      Utils.roundRect(ctx, -carW * 0.26, -carL * 0.14, carW * 0.52, carL * 0.28, 8);
      ctx.fill();
      ctx.fillStyle = '#191430';
      Utils.roundRect(ctx, -carW * 0.45, carL / 2 - 18, carW * 0.9, 10, 4);
      ctx.fill();

      if (!unlocked) {
        /* A padlock over a locked car. */
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, -6, 11, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = 'rgba(12,15,28,0.85)';
        Utils.roundRect(ctx, -16, -6, 32, 26, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        Utils.roundRect(ctx, -16, -6, 32, 26, 6);
        ctx.stroke();
      }
      ctx.restore();
      return true;
    }
  };

  OR.Cars = Cars;
})();
