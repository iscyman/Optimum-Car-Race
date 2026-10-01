/* =============================================================================
 * track.js — geometry built from track data (Step 5).
 *
 * Turns the control points in trackdata.js into a closed, evenly spaced
 * centerline with tangents and normals, then exposes everything the rest of the
 * game needs. Nothing here draws anything or moves anything.
 *
 * Public surface:
 *   Track.points            evenly spaced centerline samples
 *   Track.length            lap length in world units
 *   Track.nearest(x, y, hint)        -> nearest sample + signed offset
 *   Track.getNearestTrackPoint(x, y) -> { x, y, index, offset, distance, ... }
 *   Track.isOnRoad(x, y)             -> boolean
 *   Track.surface(x, y)              -> 'road' | 'kerb' | 'grass'
 *   Track.pointAt(s)                 -> centerline point at arc length s
 *   Track.pointAhead(x, y, dist)     -> centerline point `dist` ahead of a car
 *   Track.progress(x, y, hint)       -> 0..1 around the lap
 *   Track.checkpoints                -> ordered gates
 *
 * `hint` is the index returned by the previous call: passing it back makes the
 * lookup search locally, which is both faster and immune to the two sides of a
 * hairpin being mistaken for each other.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils } = OR;
  const data = OR.activeTrack;

  const Track = {
    data: data,
    id: data.id,
    name: data.name,
    points: [],
    count: 0,
    length: 0,
    checkpoints: [],
    scenery: [],
    corners: data.corners || [],

    /* Surface bands, measured from the centerline */
    halfRoad: data.roadWidth / 2,
    shoulder: data.kerbWidth,
    grassMargin: data.grassMargin
  };

  Track.kerbStart = Track.halfRoad;
  Track.grassStart = Track.halfRoad + Track.shoulder;
  Track.limit = Track.grassStart + Track.grassMargin;          // soft bounce starts
  Track.hardLimit = Track.limit + CONFIG.car.bounce.hardMargin; // absolute backstop

  /* ---- smoothing ---------------------------------------------------------- */

  function distP(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  function lerpP(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

  /**
   * Centripetal Catmull-Rom (alpha = 0.5). Unlike the uniform version it does
   * not overshoot when control points are unevenly spaced, which matters where
   * a tight corner meets a long straight.
   */
  function catmullRom(pts, t) {
    const n = pts.length;
    const i = Math.floor(t) % n;
    const f = t - Math.floor(t);
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i];
    const p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const alpha = 0.5;
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.max(distP(p0, p1), 1e-4), alpha);
    const t2 = t1 + Math.pow(Math.max(distP(p1, p2), 1e-4), alpha);
    const t3 = t2 + Math.pow(Math.max(distP(p2, p3), 1e-4), alpha);
    const tt = t1 + (t2 - t1) * f;
    const A1 = lerpP(p0, p1, (tt - t0) / (t1 - t0));
    const A2 = lerpP(p1, p2, (tt - t1) / (t2 - t1));
    const A3 = lerpP(p2, p3, (tt - t2) / (t3 - t2));
    const B1 = lerpP(A1, A2, (tt - t0) / (t2 - t0));
    const B2 = lerpP(A2, A3, (tt - t1) / (t3 - t1));
    return lerpP(B1, B2, (tt - t1) / (t2 - t1));
  }

  /** Dense polyline from the control points, then even spacing by arc length. */
  function buildCenterline(pts, spacing) {
    const dense = [];
    const per = 24;
    for (let i = 0; i < pts.length; i++) {
      for (let k = 0; k < per; k++) dense.push(catmullRom(pts, i + k / per));
    }

    const n = dense.length;
    const seg = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = distP(dense[i], dense[(i + 1) % n]);
      seg.push(d);
      total += d;
    }
    const count = Math.max(32, Math.round(total / spacing));
    const step = total / count;
    const out = [];
    let target = 0, acc = 0, idx = 0;
    for (let k = 0; k < count; k++) {
      while (acc + seg[idx] < target) { acc += seg[idx]; idx = (idx + 1) % n; }
      const t = seg[idx] > 0 ? (target - acc) / seg[idx] : 0;
      out.push(lerpP(dense[idx], dense[(idx + 1) % n], t));
      target += step;
    }
    return { points: out, step: step, total: total };
  }

  /* ---- build -------------------------------------------------------------- */

  Track.build = function () {
    const built = buildCenterline(data.points, data.rowStep);
    const raw = built.points;
    const n = raw.length;
    Track.count = n;
    Track.length = built.total;
    Track.step = built.step;

    /* tangents, normals and arc length */
    const points = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = raw[(i - 1 + n) % n], b = raw[i], c = raw[(i + 1) % n];
      let tx = c[0] - a[0], ty = c[1] - a[1];
      const len = Math.hypot(tx, ty) || 1;
      tx /= len; ty /= len;
      points[i] = {
        x: b[0],
        y: b[1],
        tx: tx,           // unit tangent, direction of travel
        ty: ty,
        nx: -ty,          // unit normal, pointing to the right of travel
        ny: tx,
        s: i * built.step
      };
    }
    Track.points = points;

    /* curvature per point (unsigned; used for kerbs and for the AI later) */
    for (let i = 0; i < n; i++) {
      const a = raw[(i - 1 + n) % n], b = raw[i], c = raw[(i + 1) % n];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      points[i].radius = area < 1e-6 ? Infinity : (ab * bc * ca) / (4 * area);
      points[i].curvature = area < 1e-6 ? 0 : 1 / points[i].radius;
    }

    /* spatial grid for nearest-point lookups */
    Track._cell = 320;
    Track._grid = new Map();
    const key = (cx, cy) => cx + ':' + cy;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(points[i].x / Track._cell);
      const cy = Math.floor(points[i].y / Track._cell);
      const k = key(cx, cy);
      if (!Track._grid.has(k)) Track._grid.set(k, []);
      Track._grid.get(k).push(i);
    }

    /* bounds, for the minimap and the scenery canvas */
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, points[i].x); maxX = Math.max(maxX, points[i].x);
      minY = Math.min(minY, points[i].y); maxY = Math.max(maxY, points[i].y);
    }
    Track.bounds = { minX: minX, minY: minY, maxX: maxX, maxY: maxY,
      width: maxX - minX, height: maxY - minY,
      centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };

    /* start line + checkpoints from the data */
    const startIndex = Track._indexAtFraction(
      data.startIndex / data.points.length);
    Track.start = points[startIndex];
    Track.startIndex = startIndex;
    Track.checkpoints = (data.checkpointFractions || []).map(function (f, i) {
      const p = Track.pointAt(Track.length * f);
      return {
        index: i,
        fraction: f,
        s: Track.length * f,
        x: p.x, y: p.y,
        tx: p.tx, ty: p.ty, nx: p.nx, ny: p.ny
      };
    });

    Track.buildScenery();
    return Track;
  };

  Track._indexAtFraction = function (f) {
    const i = Math.round((f - Math.floor(f)) * Track.count) % Track.count;
    return (i + Track.count) % Track.count;
  };

  /* ---- lookups ------------------------------------------------------------ */

  /**
   * Nearest centerline sample to a world position.
   * With a `hint` index the search starts next to it and only widens if that
   * fails, which keeps the two legs of a hairpin from being confused and makes
   * the common case very cheap.
   */
  Track.nearest = function (x, y, hint) {
    const points = Track.points;
    const n = Track.count;
    let best = -1, bestD2 = Infinity;

    if (hint !== undefined && hint !== null && hint >= 0 && hint < n) {
      const span = 24;
      for (let k = -span; k <= span; k++) {
        const i = (hint + k + n) % n;
        const dx = x - points[i].x, dy = y - points[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
      // a local hit is only trusted when it is convincingly close
      if (bestD2 < Track._cell * Track._cell * 4) return Track._describe(best, x, y, bestD2);
    }

    /* Cold lookup for callers with no hint (AI spawns, scenery, probes).
       The search walks outwards ring by ring and only stops once the ring
       itself is further away than the best point found so far — stopping at
       the first ring that happens to contain anything can return a point up
       to a cell away from the true nearest. */
    const cell = Track._cell;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let ring = 0;
    while (ring <= 256) {
      if (best >= 0 && (ring - 1) * cell > Math.sqrt(bestD2)) break;
      for (let gx = cx - ring; gx <= cx + ring; gx++) {
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          if (ring > 0 && Math.abs(gx - cx) !== ring && Math.abs(gy - cy) !== ring) continue;
          const list = Track._grid.get(gx + ':' + gy);
          if (!list) continue;
          for (let k = 0; k < list.length; k++) {
            const i = list[k];
            const dx = x - points[i].x, dy = y - points[i].y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; best = i; }
          }
        }
      }
      ring++;
    }
    if (best < 0) {
      for (let i = 0; i < n; i++) {
        const dx = x - points[i].x, dy = y - points[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
    }
    return Track._describe(best, x, y, bestD2);
  };

  Track._describe = function (index, x, y, d2) {
    const p = Track.points[index];
    const dx = x - p.x, dy = y - p.y;
    return {
      index: index,
      x: p.x,
      y: p.y,
      tx: p.tx, ty: p.ty,
      nx: p.nx, ny: p.ny,
      radius: p.radius,
      distance: Math.sqrt(d2),
      /* signed: positive to the right of the direction of travel */
      offset: dx * p.nx + dy * p.ny,
      /* how far along the lap, 0..1 */
      fraction: p.s / Track.length,
      s: p.s,
      point: p
    };
  };

  /** Public helper for the AI in a later step. */
  Track.getNearestTrackPoint = function (x, y, hint) {
    const info = Track.nearest(x, y, hint);
    return {
      x: info.x,
      y: info.y,
      index: info.index,
      offset: info.offset,
      distance: info.distance,
      tangent: { x: info.tx, y: info.ty },
      normal: { x: info.nx, y: info.ny },
      fraction: info.fraction,
      radius: info.radius
    };
  };

  /** Public helper: is this position on the asphalt? */
  Track.isOnRoad = function (x, y, hint) {
    return Math.abs(Track.nearest(x, y, hint).offset) <= Track.kerbStart;
  };

  /** 'road' | 'kerb' | 'grass' */
  Track.surfaceAt = function (offset) {
    const d = Math.abs(offset);
    if (d <= Track.kerbStart) return 'road';
    if (d <= Track.grassStart) return 'kerb';
    return 'grass';
  };

  Track.surface = function (x, y, hint) {
    return Track.surfaceAt(Track.nearest(x, y, hint).offset);
  };

  /** Kept from Step 1: true whenever the car is off the asphalt. */
  Track.isOffRoad = function (x, y, hint) {
    return Track.surface(x, y, hint) !== 'road';
  };

  /** Centerline point `s` units around the lap from the start line. */
  Track.pointAt = function (s) {
    const n = Track.count;
    let f = (s / Track.length) % 1;
    if (f < 0) f += 1;
    const idx = f * n;
    const i0 = Math.floor(idx) % n;
    const i1 = (i0 + 1) % n;
    const t = idx - Math.floor(idx);
    const a = Track.points[i0], b = Track.points[i1];
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    let tx = a.tx + (b.tx - a.tx) * t, ty = a.ty + (b.ty - a.ty) * t;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    return { x: x, y: y, tx: tx, ty: ty, nx: -ty, ny: tx, s: Track.length * f };
  };

  /**
   * Centerline point `distance` ahead of a car along the direction of travel.
   * Used by the camera now and by the AI rivals in Step 6.
   */
  Track.pointAhead = function (x, y, distance, hint) {
    const info = Track.nearest(x, y, hint);
    return Track.pointAt(info.s + distance);
  };

  /** 0..1 around the lap. */
  Track.progress = function (x, y, hint) {
    return Track.nearest(x, y, hint).fraction;
  };

  /** Metres left in the lap, for the HUD. */
  Track.distanceRemaining = function (x, y, hint) {
    const info = Track.nearest(x, y, hint);
    return (Track.length - info.s) * CONFIG.track.metersPerUnit;
  };

  /** True when the car is heading the right way round the lap. */
  Track.directionOfTravel = function (info, vx, vy) {
    return (vx * info.tx + vy * info.ty) >= 0 ? 1 : -1;
  };

  Track.progressText = function (fraction) {
    return Math.round(Utils.clamp(fraction, 0, 1) * 100) + '%';
  };

  /* ---- scenery ------------------------------------------------------------ */

  Track.buildScenery = function () {
    const spec = data.scenery || {};
    const rand = Utils.mulberry32(spec.seed || 1);
    const spacing = spec.spacing || 220;
    const types = spec.types || ['pylon', 'tree'];
    const items = [];
    const steps = Math.max(4, Math.floor(Track.length / spacing));

    for (let i = 0; i < steps; i++) {
      const p = Track.pointAt((i / steps) * Track.length);
      for (let side = -1; side <= 1; side += 2) {
        const r1 = rand(), r2 = rand(), r3 = rand();
        let type = types[Math.floor(r1 * types.length)];
        if (type === 'node' && r3 > (spec.nodeChance || 0.2)) type = 'crystal';
        const lateral = Track.hardLimit + 70 + r2 * 300;
        items.push({
          x: p.x + p.nx * side * lateral,
          y: p.y + p.ny * side * lateral,
          side: side,
          type: type,
          size: 0.75 + r2 * 0.6,
          hue: r3,
          angle: Math.atan2(p.ty, p.tx)
        });
      }
    }
    Track.scenery = items;
    return Track;
  };

  OR.Track = Track.build();
})();
