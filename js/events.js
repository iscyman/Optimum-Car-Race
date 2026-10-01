/* =============================================================================
 * events.js — Step 12: challenge events, defined as data, run through hooks.
 *
 * Everything an event is lives in CONFIG.events.list. This module supplies
 * three things and names no event anywhere:
 *
 *   1. MODIFIERS as patch + revert. A modifier is a small declarative patch
 *      ({ laps: 1, shards: 16 }) applied before the race is built and reverted
 *      on every way out — finish, quit, menu, race again, reload. Nothing can
 *      leak into a normal race.
 *   2. OBJECTIVES with a tiny vocabulary: time / clean / win / collect. The
 *      engine reads the same race facts the results screen does (time, place,
 *      wall hits, shards), so an objective can never disagree with the race.
 *   3. HOOKS — onRaceStart / onUpdate / onFinish — that the core calls and
 *      that anything can listen to, so a new event is one config entry.
 *
 * The completion bonus is paid exactly once ever: the first time an event is
 * beaten it rides on the results screen as its own XP line, and `Save` records
 * it. Beating it again still shows EVENT COMPLETE, but pays nothing.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils } = OR;
  const E = CONFIG.events;

  /**
   * The fields a modifier may patch, with a getter and setter for each. This
   * table is the whole "hook system" for modifiers: adding a new patched
   * field later is one row here plus one line of config.
   */
  const FIELDS = {
    laps: {
      label: 'laps',
      get() { return OR.Race.lapsOverride; },
      set(value) { OR.Race.lapsOverride = value; }
    },
    shards: {
      label: 'shards',
      get() { return CONFIG.boost.shards.count; },
      set(value) { CONFIG.boost.shards.count = value; }
    },

    /* ---- Step 13 modifiers ------------------------------------------------
     * Each one exposes a get() that snapshots every value it touches and a
     * scale(factor) for the number form used in config, so the same patch and
     * revert path serves them all and nothing can leak.
     */

    /* A thinner road: the physics limit and the drawn road shrink together,
       so the barrier is where the tarmac ends. */
    narrowRoad: {
      label: 'narrow road',
      get() {
        const T = OR.Track;
        return {
          halfRoad: T.halfRoad, shoulder: T.shoulder, grassMargin: T.grassMargin,
          kerbStart: T.kerbStart, grassStart: T.grassStart,
          limit: T.limit, hardLimit: T.hardLimit
        };
      },
      set(snapshot) { Object.assign(OR.Track, snapshot); },
      scale(factor) {
        const T = OR.Track;
        const backstop = T.hardLimit - T.limit;   // the backstop keeps its margin
        return {
          halfRoad: T.halfRoad * factor,
          shoulder: T.shoulder * factor,
          grassMargin: T.grassMargin * factor,
          kerbStart: T.kerbStart * factor,
          grassStart: T.grassStart * factor,
          limit: T.limit * factor,
          hardLimit: T.limit * factor + backstop
        };
      }
    },

    /* Less grip: both ends of the grip curve come down together. */
    lowGrip: {
      label: 'low grip',
      get() { return { gripLow: CONFIG.car.gripLow, gripHigh: CONFIG.car.gripHigh }; },
      set(snapshot) {
        CONFIG.car.gripLow = snapshot.gripLow;
        CONFIG.car.gripHigh = snapshot.gripHigh;
      },
      scale(factor) {
        return {
          gripLow: CONFIG.car.gripLow * factor,
          gripHigh: CONFIG.car.gripHigh * factor
        };
      }
    },

    /* Rivals stall far more often (factor > 1 = more stalling). */
    stallStorm: {
      label: 'stall storm',
      get() {
        const stall = CONFIG.rivals.stall;
        return {
          intervalMin: stall.intervalMin, intervalMax: stall.intervalMax,
          durationMin: stall.durationMin, durationMax: stall.durationMax
        };
      },
      set(snapshot) { Object.assign(CONFIG.rivals.stall, snapshot); },
      scale(factor) {
        const stall = CONFIG.rivals.stall;
        const safe = Math.max(0.1, factor);
        return {
          intervalMin: stall.intervalMin / safe,
          intervalMax: stall.intervalMax / safe,
          durationMin: stall.durationMin * Math.min(safe, 2),
          durationMax: stall.durationMax * Math.min(safe, 2)
        };
      }
    },

    /* Boost charges faster and hits a little harder. */
    boostRush: {
      label: 'boost rush',
      get() {
        return {
          chargeRate: CONFIG.boost.charge.rate,
          speedMultiplier: CONFIG.boost.speedMultiplier
        };
      },
      set(snapshot) {
        CONFIG.boost.charge.rate = snapshot.chargeRate;
        CONFIG.boost.speedMultiplier = snapshot.speedMultiplier;
      },
      scale(factor) {
        return {
          chargeRate: CONFIG.boost.charge.rate * factor,
          speedMultiplier: 1 + (CONFIG.boost.speedMultiplier - 1) * factor
        };
      }
    }
  };

  function secondsText(seconds) {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const rest = safe - minutes * 60;
    return minutes + ':' + (rest < 10 ? '0' : '') + rest.toFixed(1);
  }

  const Events = {
    _active: null,       // the running event id, or null
    _patch: null,        // previous values of every patched field
    _progress: null,     // the last live progress object (HUD)
    _last: null,         // the last judged result (results screen)
    _listeners: { raceStart: [], update: [], finish: [] },

    list() { return E.list.slice(); },

    get(id) {
      for (let i = 0; i < E.list.length; i++) {
        if (E.list[i].id === id) return E.list[i];
      }
      return null;
    },

    active() { return Events._active ? Events.get(Events._active) : null; },
    activeId() { return Events._active; },
    isActive(id) { return Events._active === id; },

    /* ---- hooks ---------------------------------------------------------- */

    /** Listen to one of the three lifecycle hooks. Returns the module. */
    on(name, fn) {
      if (Events._listeners[name] && typeof fn === 'function') {
        Events._listeners[name].push(fn);
      }
      return Events;
    },

    off(name, fn) {
      const list = Events._listeners[name];
      if (!list) return Events;
      const at = list.indexOf(fn);
      if (at !== -1) list.splice(at, 1);
      return Events;
    },

    _emit(name, payload) {
      Events._listeners[name].slice().forEach(function (fn) { fn(payload); });
    },

    /* ---- modifiers: patch, then always give it back ---------------------- */

    /** The road geometry changed: drop the cached road layer so it redraws. */
    _refreshTrack() {
      if (OR.Renderer && OR.Renderer.invalidateTrack) OR.Renderer.invalidateTrack();
    },

    /** Apply (or replace) a modifier patch, remembering what it overwrote. */
    _applyPatch(modifier) {
      Events._revertPatch();
      Events._patch = {};
      Object.keys(modifier || {}).forEach(function (key) {
        const field = FIELDS[key];
        if (!field) return;
        /* A number means "scale from where it is now"; an object is a value. */
        const value = typeof modifier[key] === 'number' && field.scale
          ? field.scale(modifier[key]) : modifier[key];
        Events._patch[key] = { key: key, get: field.get, set: field.set, was: field.get() };
        field.set(value);
      });
      if (Events._patch.narrowRoad) Events._refreshTrack();
      return Events._patch;
    },

    /** Put every patched field back exactly as it was. */
    _revertPatch() {
      if (!Events._patch) return null;
      const patch = Events._patch;
      Object.keys(patch).forEach(function (key) { patch[key].set(patch[key].was); });
      Events._patch = null;
      if (patch.narrowRoad) Events._refreshTrack();
      return patch;
    },

    /** True while an event modifier is changing the config. */
    patched() { return !!Events._patch; },

    /* ---- running an event ----------------------------------------------- */

    /**
     * Start an event race: patch the config, then hand over to the normal race
     * start (which reads the patched laps and shard count). Difficulty, when
     * the event forces one, is passed per race so the player's own selection
     * is never touched.
     */
    start(id) {
      const event = Events.get(id);
      if (!event) return null;
      Events.stop();
      Events._active = event.id;
      Events._progress = null;
      Events._last = null;
      Events._applyPatch(event.modifier);
      if (OR.Game && OR.Game.startRace) {
        OR.Game.startRace(undefined, event.difficulty || undefined);
      }
      return event;
    },

    /**
     * Leave whichever event is running and give the config back. Safe to call
     * when nothing is running. Called from Game.returnToMenu(), and by the
     * menu when a normal race starts, so a normal race can never inherit an
     * event's laps or shard count.
     */
    stop() {
      const was = Events._active;
      Events._active = null;
      Events._progress = null;
      Events._revertPatch();
      Events.setHud(null);
      return was;
    },

    /* ---- objectives ------------------------------------------------------ */

    /** The time a BLOCK RUSH run must beat on this circuit (seconds). */
    targetSeconds(objective, trackId) {
      const targets = objective && objective.targets ? objective.targets : {};
      const id = trackId || (OR.Track ? OR.Track.id : null);
      const value = targets[id];
      return typeof value === 'number' && isFinite(value) && value > 0 ? value : 0;
    },

    /** One line of human text for an objective (events screen, results). */
    objectiveText(event, trackId) {
      const objective = event.objective;
      const laps = objective.laps || (event.modifier && event.modifier.laps) || 0;
      const lapText = laps ? laps + (laps === 1 ? ' lap' : ' laps') : 'the race';
      if (objective.type === 'time') {
        return 'BEAT ' + secondsText(Events.targetSeconds(objective, trackId)) +
          ' OVER ' + lapText.toUpperCase();
      }
      if (objective.type === 'clean') {
        return 'FINISH ' + lapText.toUpperCase() + ' WITHOUT TOUCHING A WALL';
      }
      if (objective.type === 'win') {
        return 'WIN ' + lapText.toUpperCase() +
          (objective.difficulty ? ' ON ' + String(objective.difficulty).toUpperCase() : '');
      }
      if (objective.type === 'collect') {
        return 'COLLECT ' + objective.count + ' SHARDS IN ONE RACE';
      }
      return 'COMPLETE THE RACE';
    },

    /** Did this finished race meet the objective? */
    met(objective, results) {
      if (!objective || !results) return false;
      if (objective.type === 'time') {
        const target = Events.targetSeconds(objective, results.trackId);
        return target > 0 && results.timeMs > 0 && results.timeMs / 1000 <= target;
      }
      if (objective.type === 'clean') {
        return (results.wallHits || 0) === 0 &&
          (!objective.laps || results.laps >= objective.laps);
      }
      if (objective.type === 'win') {
        return results.place === 1 &&
          (!objective.difficulty || results.difficultyId === objective.difficulty);
      }
      if (objective.type === 'collect') {
        return (results.shardsCollected || 0) >= (objective.count || 1);
      }
      return false;
    },

    /**
     * Judge a finished race. Called from Game at the flag, before XP is
     * awarded, so a first completion can ride along as its own XP line.
     */
    judge(results) {
      const event = Events.active();
      if (!event) return null;
      const already = OR.Save ? OR.Save.eventCompleted(event.id) : false;
      const beat = Events.met(event.objective, results);
      const first = beat && !already;
      const last = {
        id: event.id,
        name: event.name,
        description: event.description,
        xp: event.xp,
        met: beat,
        completed: beat,
        firstCompletion: first,
        replay: beat && already,
        bonusXp: first ? event.xp : 0,
        objective: Events.objectiveText(event, results.trackId),
        results: {
          timeMs: results.timeMs || 0,
          place: results.place || 0,
          wallHits: results.wallHits || 0,
          shardsCollected: results.shardsCollected || 0,
          trackId: results.trackId || null
        }
      };
      Events._last = last;
      return last;
    },

    /** The result of the most recent judged race (the results banner). */
    last() { return Events._last; },

    /* ---- live progress (the HUD line) ------------------------------------- */

    /**
     * Where the objective stands right now, read from the running race. Also
     * what the HUD shows, so the two can never drift apart.
     */
    progress() {
      const event = Events.active();
      if (!event) return null;
      const objective = event.objective;
      const game = OR.Game || {};
      const state = game.state;
      const racing = state === 'racing' || state === 'countdown';

      if (objective.type === 'time') {
        const target = Events.targetSeconds(objective);
        const elapsed = racing ? (game.raceTimeMs || 0) / 1000 : 0;
        return {
          id: event.id, type: 'time', label: 'TIME',
          text: secondsText(elapsed) + ' / ' + secondsText(target),
          value: elapsed, target: target,
          ratio: target > 0 ? Utils.clamp(elapsed / target, 0, 1) : 0,
          met: target > 0 && elapsed <= target
        };
      }
      if (objective.type === 'clean') {
        const hits = racing && game.car ? game.car.wallHits : 0;
        return {
          id: event.id, type: 'clean', label: 'WALL HITS',
          text: hits + ' ' + (hits === 1 ? 'HIT' : 'HITS') + ' · STAY CLEAN',
          value: hits, target: 0,
          ratio: hits === 0 ? 0 : 1,
          met: racing ? hits === 0 : true
        };
      }
      if (objective.type === 'win') {
        const place = racing && OR.Standings ? (OR.Standings.playerPlace || 1) : 1;
        return {
          id: event.id, type: 'win', label: 'PLACE',
          text: 'P' + place + ' / 1' +
            (objective.difficulty ? ' ON ' + String(objective.difficulty).toUpperCase() : ''),
          value: place, target: 1,
          ratio: Utils.clamp(place / Math.max(1, game.entities ? game.entities.length : 4), 0, 1),
          met: place === 1
        };
      }
      if (objective.type === 'collect') {
        const got = racing && OR.Shards ? OR.Shards.collected : 0;
        return {
          id: event.id, type: 'collect', label: 'SHARDS',
          text: got + ' / ' + objective.count,
          value: got, target: objective.count,
          ratio: Utils.clamp(got / Math.max(1, objective.count), 0, 1),
          met: got >= objective.count
        };
      }
      return null;
    },

    /** The last computed progress (used by the tests and the HUD). */
    current() { return Events._progress; },

    /** Hooks: called by the core. */
    onRaceStart() {
      Events._progress = null;
      Events.setHud(null);
      Events._emit('raceStart', Events.active());
    },

    onUpdate(dt) {
      /* The hook fires on every tick of every race, event or not — listeners
         decide what to do with it. Progress is null while none runs. */
      Events._progress = Events._active ? Events.progress() : null;
      Events.setHud(Events._progress);
      Events._emit('update', Events._progress, dt);
      return Events._progress;
    },

    onFinish(result) {
      Events.setHud(null);
      Events._emit('finish', result);
      return result;
    },

    /* ---- the events screen ----------------------------------------------- */

    /** Build one card per event. Called once, by main.js, with the container. */
    init(root) {
      if (!root) return null;
      const doc = root.ownerDocument || document;
      Events.el = { root: root, cards: [] };
      root.replaceChildren();

      E.list.forEach(function (event) {
        const card = doc.createElement('div');
        card.className = 'event-card';
        card.dataset.event = event.id;

        const head = doc.createElement('div');
        head.className = 'event-head';
        const name = doc.createElement('h3');
        name.className = 'event-name';
        name.textContent = event.name;
        const badge = doc.createElement('span');
        badge.className = 'event-badge';
        const today = doc.createElement('span');
        today.className = 'event-today';
        today.textContent = 'TODAY';
        head.append(name, today, badge);

        const description = doc.createElement('p');
        description.className = 'event-description';
        description.textContent = event.description;

        const objective = doc.createElement('p');
        objective.className = 'event-objective';
        objective.textContent = Events.objectiveText(event);

        const foot = doc.createElement('div');
        foot.className = 'event-foot';
        const reward = doc.createElement('span');
        reward.className = 'event-reward';
        reward.textContent = '+' + event.xp + ' XP';
        const race = doc.createElement('button');
        race.type = 'button';
        race.className = 'btn btn-ghost btn-inline event-race';
        race.textContent = 'RACE EVENT';
        race.addEventListener('click', function (e) {
          e.preventDefault();
          race.blur();
          Events.start(event.id);
        });
        foot.append(reward, race);

        card.append(head, description, objective, foot);
        root.appendChild(card);
        Events.el.cards.push({ event: event, node: card, badge: badge, race: race });
      });

      Events.refresh();
      return Events.el;
    },

    /** Repaint the completion state of every card. */
    refresh() {
      if (!Events.el) return null;
      Events.el.cards.forEach(function (card) {
        const done = OR.Save ? OR.Save.eventCompleted(card.event.id) : false;
        const featured = OR.Daily ? OR.Daily.isFeatured(card.event.id) : false;
        card.node.classList.toggle('is-completed', done);
        card.node.classList.toggle('is-today', featured);
        card.node.dataset.completed = done ? 'true' : 'false';
        card.node.dataset.today = featured ? 'true' : 'false';
        card.badge.textContent = done ? 'COMPLETED' : 'AVAILABLE';
        card.badge.classList.toggle('is-done', done);
        card.race.textContent = done ? 'RACE AGAIN' : 'RACE EVENT';
      });
      return Events.el;
    },

    /* ---- the HUD objective line ------------------------------------------ */

    /** Hand the HUD element over to the engine (called once by main.js). */
    initHud(card) {
      Events.hud = {
        card: card,
        name: card ? card.querySelector('.event-name') : null,
        objective: card ? card.querySelector('.event-objective-value') : null,
        bar: card ? card.querySelector('.event-fill') : null
      };
      return Events.hud;
    },

    /** Show/hide and fill the objective line. `null` hides it. */
    setHud(progress) {
      if (!Events.hud || !Events.hud.card) return null;
      const card = Events.hud.card;
      const event = Events.active();
      if (!progress || !event) {
        card.classList.add('hidden');
        card.classList.remove('is-met');
        card.dataset.event = '';
        return null;
      }
      card.classList.remove('hidden');
      card.classList.toggle('is-met', !!progress.met);
      card.dataset.event = event.id;
      card.dataset.value = String(progress.value);
      card.dataset.target = String(progress.target);
      card.dataset.met = progress.met ? 'true' : 'false';
      if (Events.hud.name) Events.hud.name.textContent = event.name;
      if (Events.hud.objective) {
        Events.hud.objective.textContent = progress.label + ' ' + progress.text;
      }
      if (Events.hud.bar) {
        Events.hud.bar.dataset.value = String(Math.round(progress.ratio * 100));
        Events.hud.bar.style.width = Math.round(progress.ratio * 100) + '%';
      }
      return progress;
    }
  };

  OR.Events = Events;
})();
