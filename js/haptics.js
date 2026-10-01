/* =============================================================================
 * haptics.js — Step 13: optional vibration feedback, off by default.
 *
 * A player opts in from the menu or the pause screen, and the choice lives in
 * the save (Step 13, save version 5). Every call is guarded twice: the
 * preference and the browser API. A device without `navigator.vibrate`, or a
 * blocked save, simply gets nothing — never an error.
 *
 * Only two things buzz: firing the boost, and a collision (barrier or rival).
 * Nothing fires on a timer.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG } = OR;
  const H = CONFIG.haptics;

  const Haptics = {
    /** The stored preference (default off). */
    enabled() { return OR.Save ? OR.Save.haptics() === true : H.enabled === true; },

    /** Does this browser have a vibration API at all? */
    supported() {
      return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    },

    /** Turn it on or off and remember it. Returns the new state. */
    set(on) {
      const next = on === true;
      if (OR.Save) OR.Save.setHaptics(next);
      if (!next) Haptics.stop();
      else Haptics.pulse(H.boostMs);        // confirm the choice with a tick
      return next;
    },

    toggle() { return Haptics.set(!Haptics.enabled()); },

    stop() {
      if (!Haptics.supported()) return false;
      try { navigator.vibrate(0); return true; } catch (error) { return false; }
    },

    /** Fire one pattern. Returns true only when something really buzzed. */
    pulse(pattern) {
      if (!Haptics.enabled() || !Haptics.supported()) return false;
      try {
        navigator.vibrate(pattern);
        return true;
      } catch (error) {
        return false;
      }
    },

    boost() { return Haptics.pulse(H.boostMs); },
    wall() { return Haptics.pulse(H.wallPattern); },
    car() { return Haptics.pulse(H.carMs); }
  };

  OR.Haptics = Haptics;
})();
