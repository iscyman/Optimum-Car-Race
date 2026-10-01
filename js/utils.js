/* =============================================================================
 * utils.js — small helpers shared by every module.
 * ========================================================================== */
(function () {
  'use strict';

  const Utils = {
    clamp(v, min, max) {
      return v < min ? min : v > max ? max : v;
    },

    lerp(a, b, t) {
      return a + (b - a) * t;
    },

    /* Frame-rate independent smoothing: pull `a` toward `b` at `rate`. */
    damp(a, b, rate, dt) {
      return Utils.lerp(a, b, 1 - Math.exp(-rate * dt));
    },

    /* Deterministic PRNG so the scenery looks the same on every run. */
    mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    /* 12345.6 -> "00:12.346" */
    formatTime(ms) {
      const safe = Math.max(0, ms);
      const minutes = Math.floor(safe / 60000);
      const seconds = Math.floor((safe % 60000) / 1000);
      const millis = Math.floor(safe % 1000);
      return (
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0') + '.' +
        String(millis).padStart(3, '0')
      );
    },

    /* "#22e1ff" + alpha -> "rgba(34,225,255,0.4)" */
    rgba(hex, alpha) {
      const h = hex.replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const num = parseInt(full, 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    },

    roundRect(ctx, x, y, w, h, r) {
      const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
  };

  OR.Utils = Utils;
})();
