/* =============================================================================
 * daily.js — Step 13: the daily rotation, the streak and the once-a-day bonus.
 *
 * The featured event is a PURE FUNCTION OF THE LOCAL DATE:
 *
 *   index = hash('YYYY-MM-DD') mod CONFIG.daily.order.length
 *
 * so every player sees the same challenge on the same day, it changes at
 * local midnight, and nothing about it needs to be stored or fetched. That is
 * also why a corrupt or blocked save cannot break it.
 *
 * What IS stored (save version 5) is the player side: which day the bonus was
 * last claimed, the streak, and the last seven days of completions.
 *
 * The clock is injectable (`Daily.setClock`) so the tests can travel across
 * days and midnight without waiting.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG } = OR;
  const D = CONFIG.daily;

  function pad(value) { return value < 10 ? '0' + value : String(value); }

  const Daily = {
    _clock: null,       // tests only: a function returning a timestamp

    /** Wall-clock now, or the test clock when one is installed. */
    now() { return Daily._clock ? Daily._clock() : Date.now(); },

    /** Install a test clock (pass null to go back to the real one). */
    setClock(fn) {
      Daily._clock = typeof fn === 'function' ? fn : null;
      return Daily;
    },

    /* ---- the date key ---------------------------------------------------- */

    /** 'YYYY-MM-DD' in LOCAL time — the day the player is actually having. */
    dateKey(date) {
      const d = date instanceof Date ? date
        : new Date(typeof date === 'number' ? date : (date === undefined ? Daily.now() : date));
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    /** Midday of a date key, which is safely inside that local day. */
    dateFromKey(key) {
      if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
      const parts = key.split('-');
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
      return isNaN(date.getTime()) ? null : date;
    },

    /** The key for the day before a given one (used by the streak). */
    previousKey(key) {
      const date = Daily.dateFromKey(key);
      if (!date) return null;
      date.setDate(date.getDate() - 1);
      return Daily.dateKey(date);
    },

    /* ---- the rotation ---------------------------------------------------- */

    /**
     * FNV-1a over the date key, finished with an avalanche mix. The mix
     * matters: the modulo uses the low bits, and raw FNV-1a leaves them
     * clumpy, which would show a player the same challenge three days running
     * while others never appeared.
     */
    hash(key) {
      const text = String(key);
      let h = 2166136261;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      h ^= h >>> 16;
      h = Math.imul(h, 2246822507);
      h ^= h >>> 13;
      h = Math.imul(h, 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    },

    /** Which slot of the rotation today is. */
    index(date) {
      const order = D.order;
      if (!order.length) return 0;
      return Daily.hash(Daily.dateKey(date)) % order.length;
    },

    /** The featured event id for a day (defaults to today). '' if misconfigured. */
    featuredId(date) {
      if (!D.order.length) return '';
      return D.order[Daily.index(date)];
    },

    /** The featured event object, or null when Events is not loaded. */
    featured(date) {
      const id = Daily.featuredId(date);
      return OR.Events ? OR.Events.get(id) : null;
    },

    isFeatured(eventId, date) { return Daily.featuredId(date) === eventId; },

    /* ---- the countdown to local midnight --------------------------------- */

    /** Milliseconds until the next local midnight (the rotation). */
    msUntilRotation(now) {
      const t = typeof now === 'number' ? now : Daily.now();
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
      return Math.max(0, next.getTime() - t);
    },

    /** 'H:MM:SS' — the countdown the menu shows. */
    countdown(now) {
      const ms = Daily.msUntilRotation(now);
      const total = Math.floor(ms / 1000);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      return hours + ':' + pad(minutes) + ':' + pad(seconds);
    },

    /* ---- the streak and the last seven days ------------------------------ */

    /**
     * The player-side view of the last `streakDays` days, newest first:
     * { date, completed, label ('MON'), isToday }.
     */
    historyWindow(now) {
      const today = Daily.dateKey(now);
      const done = {};
      (OR.Save ? OR.Save.dailyHistory() : []).forEach(function (row) {
        if (row && row.completed) done[row.date] = true;
      });
      const labels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const out = [];
      const cursor = Daily.dateFromKey(today);
      for (let i = 0; i < D.streakDays; i++) {
        const date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - i, 12);
        const key = Daily.dateKey(date);
        out.push({
          date: key,
          completed: done[key] === true,
          label: labels[date.getDay()],
          isToday: i === 0
        });
      }
      return out;
    },

    /**
     * What the streak becomes after completing today: yesterday continued it,
     * a gap restarts it at one, and the same day twice never double-counts.
     */
    nextStreak(previous, dateKey) {
      const before = Daily.previousKey(dateKey);
      const history = OR.Save ? OR.Save.dailyHistory() : [];
      const yesterday = history.some(function (row) {
        return row.date === before && row.completed;
      });
      if (history.some(function (row) { return row.date === dateKey && row.completed; })) {
        return previous;                       // already logged today
      }
      const prev = typeof previous === 'number' && isFinite(previous) && previous > 0
        ? Math.floor(previous) : 0;
      return yesterday ? prev + 1 : 1;
    },

    /* ---- completing a daily run ------------------------------------------ */

    /**
     * Called at the flag, once the race (and any event objective) has been
     * judged. Handles two things:
     *   - if the featured event was completed, log the day and move the streak;
     *   - if today's bonus has not been paid yet and the featured event was
     *     just completed, pay it (once per day, ever).
     * Returns null when there is nothing daily about this race.
     */
    completeRace(results) {
      if (!results || !results.event) return null;
      const today = Daily.dateKey();
      const featuredId = Daily.featuredId();
      const isFeatured = results.event.id === featuredId;
      if (!isFeatured) {
        return { dateKey: today, featuredId: featuredId, isFeatured: false,
          completed: false, bonusXp: 0, streak: OR.Save ? OR.Save.dailyStreak() : 0 };
      }

      const completed = results.event.met === true;
      let streak = OR.Save ? OR.Save.dailyStreak() : 0;
      if (completed) {
        streak = Daily.nextStreak(streak, today);
        if (OR.Save) OR.Save.recordDaily(today, streak);
      }

      let bonusXp = 0;
      let claimed = OR.Save ? OR.Save.dailyBonusClaimed(today) : false;
      if (completed && !claimed && OR.Save) {
        claimed = OR.Save.claimDailyBonus(today) === true || claimed;
        if (claimed) bonusXp = D.bonusXp;
      }

      return {
        dateKey: today,
        featuredId: featuredId,
        isFeatured: true,
        completed: completed,
        bonusXp: bonusXp,
        claimed: claimed,
        streak: streak
      };
    },

    /** Is today's bonus still on the table? (The menu says so.) */
    bonusAvailable() {
      if (!OR.Save) return false;
      const today = Daily.dateKey();
      if (OR.Save.dailyBonusClaimed(today)) return false;
      const history = OR.Save.dailyHistory();
      return !history.some(function (row) { return row.date === today && row.completed; });
    },

    /** "NEXT ROTATION IN 5:12:33" for the menu card. */
    countdownText(now) { return Daily.countdown(now); }
  };

  OR.Daily = Daily;
})();
