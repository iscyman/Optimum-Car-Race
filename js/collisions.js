/* =============================================================================
 * collisions.js — Step 6: lightweight oriented-box car-to-car contact.
 *
 * Equal positional separation, a small impact speed loss, and a low-bounce
 * impulse. A per-pair cooldown prevents scraping from draining speed to zero.
 * The four-car field has just six pairs; bounded solver passes handle chains
 * and exact overlaps without queues, locks or an ever-growing contact list.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Track } = OR;
  const C = CONFIG.collisions;
  const halfW = CONFIG.car.width * C.widthScale / 2;
  const halfL = CONFIG.car.length * C.lengthScale / 2;

  function axes(car) {
    return {
      fx: Math.sin(car.heading), fy: -Math.cos(car.heading),
      rx: Math.cos(car.heading), ry: Math.sin(car.heading)
    };
  }

  /** Separating-axis test; returns the shallowest separation normal. */
  function overlap(a, b) {
    const aa = axes(a), ba = axes(b);
    const dx = b.x - a.x, dy = b.y - a.y;
    const list = [[aa.rx, aa.ry], [aa.fx, aa.fy], [ba.rx, ba.ry], [ba.fx, ba.fy]];
    let depth = Infinity, nx = 0, ny = 0;
    for (let i = 0; i < list.length; i++) {
      const x = list[i][0], y = list[i][1];
      const ar = halfW * Math.abs(aa.rx * x + aa.ry * y) +
        halfL * Math.abs(aa.fx * x + aa.fy * y);
      const br = halfW * Math.abs(ba.rx * x + ba.ry * y) +
        halfL * Math.abs(ba.fx * x + ba.fy * y);
      const d = dx * x + dy * y;
      const penetration = ar + br - Math.abs(d);
      if (penetration <= 0) return null;
      if (penetration < depth) {
        depth = penetration;
        const sign = d < 0 ? -1 : 1;
        nx = x * sign; ny = y * sign;
      }
    }
    return { depth: depth, nx: nx, ny: ny };
  }

  function constrain(car) {
    const hit = Track.nearest(car.x, car.y, car.trackHint);
    car.trackHint = hit.index;
    const excess = Math.abs(hit.offset) - Track.hardLimit;
    if (excess > 0) {
      const sign = hit.offset < 0 ? -1 : 1;
      car.x -= sign * hit.nx * excess;
      car.y -= sign * hit.ny * excess;
      const outward = (car.vx * hit.nx + car.vy * hit.ny) * sign;
      if (outward > 0) {
        car.vx -= sign * hit.nx * outward;
        car.vy -= sign * hit.ny * outward;
      }
    }
    car.syncVelocity();
  }

  const Collisions = {
    cooldowns: new Map(),
    overlap: overlap,

    reset() { Collisions.cooldowns.clear(); },

    resolve(cars, dt) {
      if (!C.enabled) return 0;
      let contacts = 0;
      for (const [key, seconds] of Collisions.cooldowns) {
        if (seconds <= dt) Collisions.cooldowns.delete(key);
        else Collisions.cooldowns.set(key, seconds - dt);
      }
      for (let i = 0; i < cars.length; i++) cars[i].hitCar = false;

      for (let pass = 0; pass < C.iterations; pass++) {
        for (let i = 0; i < cars.length; i++) {
          for (let j = i + 1; j < cars.length; j++) {
            const a = cars[i], b = cars[j];
            // A cheap broad-phase before the four-axis test.
            if (Math.abs(a.x - b.x) > CONFIG.car.length * 1.5 ||
                Math.abs(a.y - b.y) > CONFIG.car.length * 1.5) continue;
            const hit = overlap(a, b);
            if (!hit) continue;
            a.hitCar = b.hitCar = true;
            contacts++;
            const push = (hit.depth + C.clearance) / 2;
            a.x -= hit.nx * push; a.y -= hit.ny * push;
            b.x += hit.nx * push; b.y += hit.ny * push;

            const key = i + ':' + j;
            if (!Collisions.cooldowns.has(key)) {
              const keep = 1 - C.speedLoss;
              a.vx *= keep; a.vy *= keep;
              b.vx *= keep; b.vy *= keep;
              Collisions.cooldowns.set(key, C.cooldown);
            }
            const closing = (b.vx - a.vx) * hit.nx + (b.vy - a.vy) * hit.ny;
            if (closing < 0) {
              const impulse = -closing * (1 + C.restitution) / 2;
              a.vx -= hit.nx * impulse; a.vy -= hit.ny * impulse;
              b.vx += hit.nx * impulse; b.vy += hit.ny * impulse;
            }
            constrain(a);
            constrain(b);
          }
        }
      }
      return contacts;
    }
  };

  OR.Collisions = Collisions;
})();
