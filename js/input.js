/* =============================================================================
 * input.js — keyboard (desktop) + large touch buttons (mobile).
 *
 * Everything downstream reads the flat `Input.state` object:
 *   { left, right, throttle, brake }
 * Boost is edge-triggered via `Input.consumeBoost()`.
 * ========================================================================== */
(function () {
  'use strict';

  const KEY_MAP = {
    ArrowUp: 'throttle', KeyW: 'throttle',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
  };

  const BOOST_KEYS = ['Space', 'ShiftLeft', 'ShiftRight'];
  const PAUSE_KEYS = ['Escape', 'KeyP'];          // Step 4
  const SWALLOW = new Set(Object.keys(KEY_MAP).concat(BOOST_KEYS, PAUSE_KEYS));

  const Input = {
    /** Live, per-frame control state consumed by the car. */
    state: { left: false, right: false, throttle: false, brake: false },
    /** True when the on-screen touch pad is being used. */
    touchMode: false,
    /** One-shot "start race" / "race again" request (Enter / Space on menus). */
    confirmQueued: false,

    _keys: Object.create(null),
    _touch: { left: false, right: false, brake: false, throttle: false },
    _boostQueued: false,
    _pauseQueued: false,
    _onBoost: null,

    init() {
      window.addEventListener('keydown', onKeyDown, { passive: false });
      window.addEventListener('keyup', onKeyUp, { passive: false });
      window.addEventListener('blur', Input.reset);
      return Input;
    },

    /** Wire up the DOM touch pad. `boostBtn` fires boost on press-down. */
    attachTouchPad(root, boostHandler) {
      Input._onBoost = boostHandler || null;
      const buttons = root.querySelectorAll('[data-action]');
      buttons.forEach(btn => {
        const action = btn.dataset.action;
        btn.addEventListener('pointerdown', e => {
          e.preventDefault();
          if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
          btn.classList.add('is-active');
          if (action === 'boost') {
            Input.queueBoost();
          } else {
            Input._touch[action] = true;
          }
        });
        const release = e => {
          if (e && e.preventDefault) e.preventDefault();
          btn.classList.remove('is-active');
          if (action !== 'boost') Input._touch[action] = false;
        };
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('lostpointercapture', release);
        btn.addEventListener('contextmenu', e => e.preventDefault());
      });
      return Input;
    },

    /** Pass `false` to force the keyboard/gamepad style controls back on. */
    enableTouchMode(flag) {
      Input.touchMode = flag !== false;
      return Input;
    },

    /** Recompute `state` from keyboard + touch. Call once per frame. */
    update() {
      const k = Input._keys;
      const t = Input._touch;
      const left = !!(k.left || t.left);
      const right = !!(k.right || t.right);
      const brake = !!(k.brake || t.brake);
      // On touch devices there is no accelerator pedal: the car drives itself
      // and BRAKE is how you slow down (see README).
      const throttle = Input.touchMode ? !brake : !!k.throttle;
      Input.state.left = left;
      Input.state.right = right;
      Input.state.brake = brake;
      Input.state.throttle = throttle;
      return Input.state;
    },

    queueBoost() {
      Input._boostQueued = true;
      if (Input._onBoost) Input._onBoost();
    },

    /** Returns true at most once per physical boost press. */
    consumeBoost() {
      if (!Input._boostQueued) return false;
      Input._boostQueued = false;
      return true;
    },

    consumeConfirm() {
      if (!Input.confirmQueued) return false;
      Input.confirmQueued = false;
      return true;
    },

    /** Step 4: Escape / P, or the on-screen pause button. Edge triggered. */
    queuePause() {
      Input._pauseQueued = true;
    },

    consumePause() {
      if (!Input._pauseQueued) return false;
      Input._pauseQueued = false;
      return true;
    },

    /** Clear every held input (used on race start and when the tab loses focus). */
    reset() {
      Input._keys = Object.create(null);
      Input._touch.left = Input._touch.right = false;
      Input._touch.brake = Input._touch.throttle = false;
      Input._boostQueued = false;
      Input._pauseQueued = false;
      Input.state.left = Input.state.right = false;
      Input.state.throttle = Input.state.brake = false;
    }
  };

  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const boost = BOOST_KEYS.indexOf(e.code) !== -1;
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (e.repeat) return;

    if (boost) {
      Input.queueBoost();
      Input.confirmQueued = true;
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      Input.confirmQueued = true;
      return;
    }
    if (PAUSE_KEYS.indexOf(e.code) !== -1) {
      Input.queuePause();
      return;
    }
    const action = KEY_MAP[e.code];
    if (action) Input._keys[action] = true;
  }

  function onKeyUp(e) {
    const action = KEY_MAP[e.code];
    if (action) {
      if (SWALLOW.has(e.code)) e.preventDefault();
      Input._keys[action] = false;
    }
  }

  OR.Input = Input.init();
})();
