/* =============================================================================
 * shards.js — CODED BOOST pickups (Step 3).
 *
 * Small cyan diamonds laid along the track. Driving over one adds charge to
 * the boost meter. The layout is deterministic (seeded), so every race has the
 * same pickups in the same places and lap times stay comparable.
 *
 * The module only knows about world coordinates, so the closed-circuit track
 * in a later step can replace this layout by filling `items` itself.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils, Track } = OR;

  const Shards = {
    items: [],
    collected: 0,
    seed: 90210,

    /** The layout for the active track (Step 8: pickups come from track data). */
    spec() {
      return Track.shards || CONFIG.boost.shards;
    },

    /** Rebuild the layout and clear the collected count (Race Again, menu). */
    reset() {
      Shards.items.length = 0;
      Shards.collected = 0;

      const S = Shards.spec();
      const rand = Utils.mulberry32(S.seed || Shards.seed);
      const first = S.startClear;
      const last = Track.length - S.endClear;
      const step = (last - first) / Math.max(1, S.count - 1);

      for (let i = 0; i < S.count; i++) {
        const s = first + step * i;
        const p = Track.pointAt(s);
        // wander across the road, but always on the asphalt
        let lane = Math.sin(i * 1.9) * S.laneSpread + (rand() - 0.5) * 0.35;
        lane = Utils.clamp(lane, -0.85, 0.85) * Track.halfRoad;
        Shards.items.push({
          x: p.x + p.nx * lane,
          y: p.y + p.ny * lane,
          s: s,
          phase: rand() * Math.PI * 2,
          taken: false,
          pop: 0        // 0 -> 1 pickup animation
        });
      }
      return Shards;
    },

    remaining() {
      let n = 0;
      for (let i = 0; i < Shards.items.length; i++) {
        if (!Shards.items[i].taken) n++;
      }
      return n;
    },

    /**
     * Collect anything the car is touching and animate the rest.
     * `active` is false on menus so pickups are not eaten in the background.
     */
    update(car, dt, active) {
      const list = Shards.items;
      const S = Shards.spec();
      const r2 = S.radius * S.radius;

      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        s.phase += S.spin * dt;
        if (s.pop > 0) s.pop = Math.max(0, s.pop - dt * 2.2);
        if (s.taken || !active) continue;

        const dx = car.x - s.x;
        const dy = car.y - s.y;
        if (dx * dx + dy * dy <= r2) {
          s.taken = true;
          s.pop = 1;
          Shards.collected += 1;
          car.addMeter(S.value);
          OR.Renderer.emitShardPickup(s);
        }
      }
    }
  };

  OR.Shards = Shards.reset();
})();
