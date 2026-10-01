/* =============================================================================
 * renderer.js — all canvas drawing. Owns the camera and the (visual only)
 * particle system. Reads game state, never mutates it.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils, Track } = OR;
  const T = CONFIG.theme;

  const Renderer = {
    canvas: null,
    ctx: null,
    dpr: 1,
    view: { w: 0, h: 0, scale: 1, camX: 0, camY: 0, laX: 0, laY: 0 },
    particles: [],
    marks: [],            // tire marks left while drifting or braking hard
    _markClock: 0,
    _lastMarkX: 0,
    _lastMarkY: 0,
    _streaks: [],
    _vignette: null,
    /** Step 3: effects that move are suppressed for prefers-reduced-motion. */
    reducedMotion: false,
    zoom: 1,

    init(canvas) {
      Renderer.canvas = canvas;
      Renderer.ctx = canvas.getContext('2d');
      for (let i = 0; i < 14; i++) {
        Renderer._streaks.push({
          x: (i + 0.5) / 14 + ((i * 37) % 11) / 220,
          phase: (i * 133) % 1000 / 1000
        });
      }
      Renderer.resize();
      return Renderer;
    },

    resize() {
      const canvas = Renderer.canvas;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      Renderer.dpr = dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      Renderer.view.w = w;
      Renderer.view.h = h;
      Renderer._vignette = null;
      return Renderer;
    },

    /* ---- camera ----------------------------------------------------------
     * The camera sits exactly on the car (no positional lag, so the car never
     * drifts off screen) plus a SMOOTHED look-ahead offset that leans toward
     * the direction of travel and toward the road ahead.
     * -------------------------------------------------------------------- */
    updateCamera(car, dt, snap) {
      const view = Renderer.view;
      const cam = CONFIG.camera;
      view.scale = Math.min(view.h / cam.visibleHeight, view.w / cam.minVisibleWidth);

      const speed = car.speed || 0;
      const ratio = Utils.clamp(speed / CONFIG.car.maxSpeed, 0, 1);
      /* The look-ahead is capped as a fraction of the visible width: a narrow
         (phone) view is zoomed in, and an uncapped lead would push the car to
         the very edge of the screen. */
      const visibleWidth = view.w / view.scale;
      const dist = Math.min(cam.lookAhead + cam.lookAheadSpeed * ratio,
                            visibleWidth * cam.lookAheadMaxFrac);
      const dirX = speed > 1 ? car.vx / speed : 0;
      const dirY = speed > 1 ? car.vy / speed : -1;

      /* Look ahead along the direction of travel, blended towards the way the
         track actually goes so the camera leads into corners without ever
         pushing the car off the middle of the screen: the offset is always
         exactly `dist` long, only its direction changes. */
      const ahead = Track.pointAhead(car.x, car.y, dist, car.trackHint);
      let ax = ahead.x - car.x, ay = ahead.y - car.y;
      const alen = Math.hypot(ax, ay) || 1;
      ax /= alen; ay /= alen;
      let bx = dirX * (1 - cam.centerBias) + ax * cam.centerBias;
      let by = dirY * (1 - cam.centerBias) + ay * cam.centerBias;
      const blen = Math.hypot(bx, by) || 1;
      const wantLaX = (bx / blen) * dist;
      const wantLaY = (by / blen) * dist;

      view.laX = snap ? wantLaX : Utils.damp(view.laX, wantLaX, cam.lookAheadRate, dt);
      view.laY = snap ? wantLaY : Utils.damp(view.laY, wantLaY, cam.lookAheadRate, dt);

      // Step 3: a subtle push-in while boosting (skipped if motion is reduced).
      // The menu drives this with a plain {x, y} stand-in, so guard for that.
      const fx = CONFIG.boost.fx;
      const boosting = !!(car.boost && car.boost.active);
      const wantZoom = (boosting && !Renderer.reducedMotion) ? fx.cameraZoom : 1;
      Renderer.zoom = snap ? wantZoom : Utils.damp(Renderer.zoom, wantZoom, fx.zoomRate, dt);
      view.scale *= Renderer.zoom;

      view.camX = car.x + view.laX;
      view.camY = car.y + view.laY - (cam.carScreenOffset * view.h) / view.scale;
      return view;
    },

    /* ---- tire marks ------------------------------------------------------ */
    emitTireMarks(car, dt) {
      const cfg = CONFIG.effects.tireMarks;
      Renderer._markClock -= dt;
      if (Renderer._markClock > 0) return;
      Renderer._markClock = cfg.emitInterval;

      const dx = car.x - Renderer._lastMarkX;
      const dy = car.y - Renderer._lastMarkY;
      if (dx * dx + dy * dy < cfg.minGap * cfg.minGap) return;
      Renderer._lastMarkX = car.x;
      Renderer._lastMarkY = car.y;

      const fx = Math.sin(car.heading), fy = -Math.cos(car.heading);
      const rx = Math.cos(car.heading), ry = Math.sin(car.heading);
      const back = CONFIG.car.length * 0.3;
      const half = CONFIG.car.width * 0.42;
      const half_len = cfg.length * 0.5;

      for (let side = -1; side <= 1; side += 2) {
        Renderer.marks.push({
          x: car.x - fx * back + rx * half * side,
          y: car.y - fy * back + ry * half * side,
          dx: fx * half_len,
          dy: fy * half_len,
          life: cfg.life,
          maxLife: cfg.life
        });
      }
      if (Renderer.marks.length > cfg.max) {
        Renderer.marks.splice(0, Renderer.marks.length - cfg.max);
      }
    },

    updateMarks(dt) {
      const list = Renderer.marks;
      let write = 0;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        m.life -= dt;
        if (m.life > 0) list[write++] = m;
      }
      list.length = write;
    },

    /* ---- helpers --------------------------------------------------------- */
    _applyWorldTransform() {
      const ctx = Renderer.ctx;
      const view = Renderer.view;
      ctx.save();
      ctx.translate(view.w / 2, 0);
      ctx.scale(view.scale, view.scale);
      ctx.translate(-view.camX, -view.camY);
    },

    /** World-space rectangle currently on screen (plus a margin). */
    _visibleBounds() {
      const view = Renderer.view;
      const halfW = view.w / view.scale / 2;
      const halfH = view.h / view.scale / 2;
      return {
        minX: view.camX - halfW - 1200,
        maxX: view.camX + halfW + 1200,
        minY: view.camY - halfH - 1200,
        maxY: view.camY + halfH + 1200,
        halfW: halfW,
        halfH: halfH
      };
    },

    /* ---- track paths (cached; Step 5) ------------------------------------ */

    /**
     * Builds the Path2D objects used to draw the circuit from track data.
     * Called once per track — everything is in world coordinates, so they are
     * simply stroked with the camera transform applied.
     */
    buildTrackPaths() {
      const pts = Track.points;
      const n = Track.count;

      const loop = new Path2D();
      loop.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) loop.lineTo(pts[i].x, pts[i].y);
      loop.closePath();

      const offsetPath = (offset, filter) => {
        const path = new Path2D();
        let started = false;
        for (let i = 0; i <= n; i++) {
          const p = pts[i % n];
          if (filter && !filter(p)) { started = false; continue; }
          const x = p.x + p.nx * offset;
          const y = p.y + p.ny * offset;
          if (!started) { path.moveTo(x, y); started = true; }
          else path.lineTo(x, y);
        }
        return path;
      };

      // kerbs only where the track actually turns
      const onCorner = p => p.radius < 2600;
      Renderer.paths = {
        loop: loop,
        edgeLeft: offsetPath(-(Track.kerbStart - 8), null),
        edgeRight: offsetPath(Track.kerbStart - 8, null),
        kerbLeft: offsetPath(-(Track.kerbStart + Track.shoulder / 2), onCorner),
        kerbRight: offsetPath(Track.kerbStart + Track.shoulder / 2, onCorner)
      };
      return Renderer.paths;
    },

    /* ---- main draw -------------------------------------------------------- */
    draw(game) {
      const ctx = Renderer.ctx;
      const view = Renderer.view;
      if (!ctx) return;

      ctx.setTransform(Renderer.dpr, 0, 0, Renderer.dpr, 0, 0);
      ctx.clearRect(0, 0, view.w, view.h);

      // cached track geometry and the pre-rendered scenery layer
      if (!Renderer.paths) Renderer.buildTrackPaths();
      if (!Renderer.sceneryLayer) Renderer.buildSceneryLayer();

      Renderer._drawGround();

      Renderer._applyWorldTransform();
      Renderer._drawRoad();
      Renderer._drawStartFinish();
      Renderer._drawCheckpoints(game);
      Renderer._drawScenery();
      Renderer._drawMarks();
      Renderer._drawShards(game);
      Renderer._drawParticles();
      Renderer._drawCar(game);
      ctx.restore();

      Renderer._drawSpeedLines(game);
      Renderer._drawCountdown(game);
      Renderer._drawVignette();
    },

    /* ---- ground ---------------------------------------------------------- */
    _drawGround() {
      const ctx = Renderer.ctx;
      const view = Renderer.view;
      const g = ctx.createLinearGradient(0, 0, 0, view.h);
      g.addColorStop(0, T.groundTop);
      g.addColorStop(1, T.groundBottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.w, view.h);

      // faint world grid for a sense of motion
      const b = Renderer._visibleBounds();
      const step = 240;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = Utils.rgba(T.violet, 0.07);
      ctx.beginPath();
      for (let wx = Math.floor(b.minX / step) * step; wx < b.maxX; wx += step) {
        const sx = view.w / 2 + (wx - view.camX) * view.scale;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, view.h);
      }
      for (let wy = Math.floor(b.minY / step) * step; wy < b.maxY; wy += step) {
        const sy = (wy - view.camY) * view.scale;
        ctx.moveTo(0, sy);
        ctx.lineTo(view.w, sy);
      }
      ctx.stroke();
      ctx.restore();
    },

    /* ---- road ------------------------------------------------------------ */
    _drawRoad() {
      const ctx = Renderer.ctx;
      const paths = Renderer.paths || Renderer.buildTrackPaths();
      const half = Track.halfRoad;

      // 1. run-off: everything between the barriers is a surface, so the
      //    asphalt never floats on the background colour
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = T.runoff;
      ctx.lineWidth = Track.hardLimit * 2;
      ctx.stroke(paths.loop);

      // 2. the grass verge, between the kerb and the barrier
      ctx.strokeStyle = T.grass;
      ctx.lineWidth = Track.limit * 2;
      ctx.stroke(paths.loop);

      // 3. kerbs, on the corners only
      const kerbW = Track.shoulder * 0.78;
      ctx.setLineDash([]);
      ctx.strokeStyle = Utils.rgba(T.rumbleB, 0.92);
      ctx.lineWidth = kerbW;
      ctx.stroke(paths.kerbLeft);
      ctx.stroke(paths.kerbRight);
      ctx.setLineDash([26, 26]);
      ctx.strokeStyle = Utils.rgba(T.rumbleA, 0.95);
      ctx.lineWidth = kerbW * 0.86;
      ctx.stroke(paths.kerbLeft);
      ctx.stroke(paths.kerbRight);
      ctx.setLineDash([]);

      // 4. asphalt
      const g = ctx.createLinearGradient(0, Track.bounds.minY, 0, Track.bounds.maxY);
      g.addColorStop(0, T.asphaltTop);
      g.addColorStop(1, T.asphaltBottom);
      ctx.strokeStyle = g;
      ctx.lineWidth = half * 2;
      ctx.stroke(paths.loop);

      // 5. edge lines
      ctx.strokeStyle = Utils.rgba('#ffffff', 0.5);
      ctx.lineWidth = 4;
      ctx.stroke(paths.edgeLeft);
      ctx.stroke(paths.edgeRight);

      // 6. centre dashes
      ctx.setLineDash([46, 54]);
      ctx.strokeStyle = Utils.rgba('#ffffff', 0.16);
      ctx.lineWidth = 5;
      ctx.stroke(paths.loop);
      ctx.setLineDash([]);

      // 7. barriers: a dark band with a neon edge, at the limit
      const barrier = Renderer._barrierPath || Renderer.buildBarrierPath();
      ctx.strokeStyle = Utils.rgba('#0b0e18', 0.95);
      ctx.lineWidth = 13;
      ctx.stroke(barrier.outer);
      ctx.stroke(barrier.inner);

      const edge = Math.max(1, 3.5 / Renderer.zoom);
      ctx.lineWidth = edge;
      ctx.strokeStyle = Utils.rgba(T.cyan, 0.75);
      ctx.stroke(barrier.outer);
      ctx.strokeStyle = Utils.rgba(T.violet, 0.75);
      ctx.stroke(barrier.inner);
      ctx.restore();
    },

    /** The two barrier rails, offset either side of the centreline. */
    buildBarrierPath() {
      const pts = Track.points;
      const n = Track.count;
      const outer = new Path2D();
      const inner = new Path2D();
      for (let i = 0; i <= n; i++) {
        const p = pts[i % n];
        const ox = p.x + p.nx * Track.hardLimit;
        const oy = p.y + p.ny * Track.hardLimit;
        const ix = p.x - p.nx * Track.hardLimit;
        const iy = p.y - p.ny * Track.hardLimit;
        if (i === 0) { outer.moveTo(ox, oy); inner.moveTo(ix, iy); }
        else { outer.lineTo(ox, oy); inner.lineTo(ix, iy); }
      }
      Renderer._barrierPath = { outer: outer, inner: inner };
      return Renderer._barrierPath;
    },

    /* ---- start / finish line -------------------------------------------- */
    _drawStartFinish() {
      const ctx = Renderer.ctx;
      const view = Renderer.view;
      const start = Track.start;
      const b = Renderer._visibleBounds();
      const span = Track.halfRoad * 2;
      if (start.x < b.minX - span || start.x > b.maxX + span ||
          start.y < b.minY - span || start.y > b.maxY + span) return;

      const half = Track.halfRoad;
      const depth = 76;
      const cols = 8;
      const cell = (half * 2) / cols;
      const angle = Math.atan2(start.ty, start.tx) + Math.PI / 2; // across the road

      ctx.save();
      ctx.translate(start.x, start.y);
      ctx.rotate(angle);

      // checkered band
      for (let i = 0; i < cols; i++) {
        for (let j = -1; j <= 1; j++) {
          ctx.fillStyle = (i + j + 2) % 2 === 0 ? '#f4f8ff' : '#12151f';
          ctx.fillRect(-half + i * cell, j * (depth / 2), cell, depth / 2);
        }
      }

      // neon gantry glow at both ends of the line
      [-(half + 26), half + 26].forEach((offset, k) => {
        const gg = ctx.createRadialGradient(offset, 30, 4, offset, 30, 120);
        gg.addColorStop(0, Utils.rgba(k === 0 ? T.cyan : T.violet, 0.85));
        gg.addColorStop(1, Utils.rgba(k === 0 ? T.cyan : T.violet, 0));
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.arc(offset, 30, 120, 0, Math.PI * 2);
        ctx.fill();
      });

      // gantry bar a little way back down the road
      const bar = ctx.createLinearGradient(-half, 0, half, 0);
      bar.addColorStop(0, Utils.rgba(T.cyan, 0.12));
      bar.addColorStop(0.5, Utils.rgba(T.cyan, 0.95));
      bar.addColorStop(1, Utils.rgba(T.violet, 0.12));
      ctx.fillStyle = bar;
      Utils.roundRect(ctx, -half, -84, half * 2, 22, 8);
      ctx.fill();
      ctx.restore();

      // billboard label, drawn flat so it is always readable
      if (view.scale > 0.2) {
        const sx = view.w / 2 + (start.x - view.camX) * view.scale;
        const sy = (start.y - view.camY) * view.scale;
        if (sx > -180 && sx < view.w + 180 && sy > -80 && sy < view.h + 80) {
          ctx.save();
          ctx.font = '800 20px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#05060d';
          ctx.fillText('START / FINISH', sx, sy + 6);
          ctx.fillStyle = Utils.rgba(T.cyan, 0.95);
          ctx.fillText('START / FINISH', sx, sy + 5);
          ctx.restore();
        }
      }
    },

    /* ---- scenery --------------------------------------------------------- */

    /**
     * All the static decoration is drawn ONCE into an offscreen canvas at a
     * fixed world-to-pixel scale (Step 5), then blitted as a single image each
     * frame. The road itself stays vector so its edges remain crisp.
     */
    buildSceneryLayer() {
      const spec = OR.activeTrack.scenery || {};
      const b = Track.bounds;
      const pad = 700;
      const maxSize = 2048;
      const w = b.width + pad * 2;
      const h = b.height + pad * 2;
      const scale = Math.min(1, maxSize / Math.max(w, h));

      if (typeof document === 'undefined') return null;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(w * scale));
      canvas.height = Math.max(2, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const originX = b.minX - pad;
      const originY = b.minY - pad;
      ctx.scale(scale, scale);
      ctx.translate(-originX, -originY);

      // grass tufts first, so scenery sits on top
      const rand = Utils.mulberry32((spec.seed || 7) + 99);
      ctx.fillStyle = Utils.rgba('#1d3a2c', 0.5);
      const tufts = Math.round((w * h) / 90000);
      for (let i = 0; i < tufts; i++) {
        const tx = originX + rand() * w;
        const ty = originY + rand() * h;
        const d = Track.nearest(tx, ty, null).distance;
        if (d < Track.limit) continue;             // not on the track
        ctx.beginPath();
        ctx.ellipse(tx, ty, 8 + rand() * 16, 4 + rand() * 7, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }

      const items = Track.scenery;
      for (let i = 0; i < items.length; i++) drawSceneryItem(ctx, items[i]);

      // glowing node markers, the thematic bit
      ctx.save();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type !== 'node') continue;
        const pulse = 0.5 + 0.5 * Math.sin(it.hue * 9);
        const r = 104 * it.size;
        const g = ctx.createRadialGradient(it.x, it.y, 2, it.x, it.y, r);
        g.addColorStop(0, Utils.rgba(T.cyan, 0.22 + pulse * 0.16));
        g.addColorStop(1, Utils.rgba(T.cyan, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(it.x, it.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      Renderer.sceneryLayer = {
        canvas: canvas,
        x: originX,
        y: originY,
        w: w,
        h: h,
        scale: scale
      };
      return Renderer.sceneryLayer;
    },

    _drawScenery() {
      const layer = Renderer.sceneryLayer;
      if (!layer) return;
      const ctx = Renderer.ctx;
      // drawImage takes the world rectangle; the camera transform scales it
      ctx.drawImage(layer.canvas, layer.x, layer.y, layer.w, layer.h);
    },

    /* ---- CODED BOOST shards (Step 3) -------------------------------------- */
    _drawShards(game) {
      const Shards = OR.Shards;
      if (!Shards || !Shards.items.length) return;
      const ctx = Renderer.ctx;
      const items = Shards.items;
      const r = 17;
      const bobbed = !Renderer.reducedMotion;

      ctx.save();
      for (let i = 0; i < items.length; i++) {
        const s = items[i];
        const lift = bobbed ? Math.sin(s.phase) * 4 : 0;
        const y = s.y + lift;
        if (y > Renderer.view.camY + Renderer.view.h / Renderer.view.scale + 80) continue;
        if (y < Renderer.view.camY - 80) continue;

        if (!s.taken) {
          // glow puddle on the road
          const g = ctx.createRadialGradient(s.x, y, 0, s.x, y, 58);
          g.addColorStop(0, Utils.rgba(T.cyan, 0.30));
          g.addColorStop(1, Utils.rgba(T.cyan, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(s.x, y, 58, 0, Math.PI * 2);
          ctx.fill();
        }

        const scale = s.taken ? 1 + (1 - s.pop) * 1.6 : 1;
        const alpha = s.taken ? s.pop : 1;
        if (alpha <= 0.01) continue;

        ctx.save();
        ctx.translate(s.x, y);
        // spin about the vertical axis so it reads as a 3D diamond
        ctx.scale(Math.max(0.18, Math.abs(Math.cos(s.phase * 0.6))) * scale, scale);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.72, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.72, 0);
        ctx.closePath();
        ctx.fillStyle = T.cyan;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = Utils.rgba('#ffffff', 0.75);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    },

    /**
     * Step 4: subtle gates so the checkpoint order is visible while driving.
     * Passed gates fade away; the next one is the brightest.
     */
    _drawCheckpoints(game) {
      const Race = OR.Race;
      if (!Race || !Track.checkpoints.length) return;
      const ctx = Renderer.ctx;
      const b = Renderer._visibleBounds();
      const half = Track.halfRoad;
      const fade = !Renderer.reducedMotion ? (Math.sin(game.clock * 2.4) * 0.5 + 0.5) : 1;

      for (let i = 0; i < Track.checkpoints.length; i++) {
        const cp = Track.checkpoints[i];
        if (cp.x < b.minX - half || cp.x > b.maxX + half) continue;
        if (cp.y < b.minY - half || cp.y > b.maxY + half) continue;

        const passed = i < Race.nextCheckpoint;
        const next = i === Race.nextCheckpoint;
        const alpha = passed ? 0.1 : (next ? 0.3 + fade * 0.25 : 0.16);
        const colour = passed ? T.white : T.cyan;

        ctx.save();
        ctx.translate(cp.x, cp.y);
        ctx.rotate(Math.atan2(cp.ty, cp.tx) + Math.PI / 2);
        ctx.setLineDash([26, 30]);
        ctx.lineWidth = 4;
        ctx.strokeStyle = Utils.rgba(colour, alpha);
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(half, 0);
        ctx.stroke();
        ctx.restore();
      }
    },

    _drawMarks() {
      const ctx = Renderer.ctx;
      const list = Renderer.marks;
      if (!list.length) return;
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        const t = m.life / m.maxLife;
        ctx.strokeStyle = 'rgba(3,4,9,' + (0.62 * t).toFixed(3) + ')';
        ctx.lineWidth = CONFIG.effects.tireMarks.width * (0.7 + 0.3 * t);
        ctx.beginPath();
        ctx.moveTo(m.x - m.dx, m.y - m.dy);
        ctx.lineTo(m.x + m.dx, m.y + m.dy);
        ctx.stroke();
      }
      ctx.restore();
    },

    /* ---- particles (visual only) ------------------------------------------ */

    /** Adds one short-lived glow. Particles never touch gameplay state. */
    _spawnParticle(x, y, vx, vy, life, size, color) {
      Renderer.particles.push({
        x: x, y: y, vx: vx, vy: vy,
        life: life, maxLife: life, size: size, color: color
      });
      const cap = CONFIG.effects.maxParticles;
      if (Renderer.particles.length > cap) {
        Renderer.particles.splice(0, Renderer.particles.length - cap);
      }
    },

    /** Boost exhaust: two jets of flame out of the back of the car. */
    emitBoostFlames(car, dt) {
      const fx = Math.sin(car.heading), fy = -Math.cos(car.heading);
      const rx = Math.cos(car.heading), ry = Math.sin(car.heading);
      const back = -CONFIG.car.length * 0.55;
      const rate = 90 * dt;
      let count = Math.floor(rate) + (Math.random() < (rate % 1) ? 1 : 0);
      while (count-- > 0) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const jitter = (Math.random() - 0.5) * 0.5;
        const speed = 160 + Math.random() * 180;
        Renderer._spawnParticle(
          car.x + fx * back + rx * CONFIG.car.width * 0.26 * side,
          car.y + fy * back + ry * CONFIG.car.width * 0.26 * side,
          -(fx + rx * jitter) * speed + car.vx * 0.25,
          -(fy + ry * jitter) * speed + car.vy * 0.25,
          0.22 + Math.random() * 0.26,
          16 + Math.random() * 16,
          Math.random() < 0.4 ? T.magenta : T.cyan
        );
      }
    },

    /** Sparks when the car scrapes a barrier. */
    emitSparks(car) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 90 + Math.random() * 220;
        Renderer._spawnParticle(
          car.x, car.y,
          Math.cos(a) * speed, Math.sin(a) * speed,
          0.18 + Math.random() * 0.22,
          7 + Math.random() * 9,
          Math.random() < 0.5 ? T.white : T.magenta
        );
      }
    },

    /** Pickup burst when a CODED BOOST shard is collected. */
    emitShardPickup(shard) {
      if (!shard) return;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 120 + Math.random() * 200;
        Renderer._spawnParticle(
          shard.x, shard.y,
          Math.cos(a) * speed, Math.sin(a) * speed,
          0.3 + Math.random() * 0.3,
          12 + Math.random() * 14,
          T.cyan
        );
      }
    },

    /** Integrate the particle system; called once per frame by the game. */
    updateParticles(dt) {
      const list = Renderer.particles;
      let write = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const drag = Math.max(0, 1 - 3.4 * dt);
        p.vx *= drag;
        p.vy *= drag;
        p.size *= 1 + 0.9 * dt;
        list[write++] = p;
      }
      list.length = write;
    },

    _drawParticles() {
      const ctx = Renderer.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < Renderer.particles.length; i++) {
        const p = Renderer.particles[i];
        const t = p.life / p.maxLife;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, Utils.rgba(p.color, 0.75 * t));
        g.addColorStop(1, Utils.rgba(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },

    /* ---- car ------------------------------------------------------------- */
    _drawCar(game) {
      const ctx = Renderer.ctx;
      const car = game.car;
      const w = CONFIG.car.width;
      const L = CONFIG.car.length;

      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.heading + car.tilt);

      // underglow
      const glowColor = car.boost.active ? T.cyan : T.violet;
      const glowR = car.boost.active ? 150 : 105;
      const glow = ctx.createRadialGradient(0, 0, 6, 0, 0, glowR);
      glow.addColorStop(0, Utils.rgba(glowColor, car.boost.active ? 0.55 : 0.3));
      glow.addColorStop(1, Utils.rgba(glowColor, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, glowR, 0, Math.PI * 2);
      ctx.fill();

      // wheels
      ctx.fillStyle = '#0a0c14';
      const wheelW = 14, wheelL = 30;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
        Utils.roundRect(
          ctx,
          s[0] * (w / 2 - 3) - (s[0] < 0 ? wheelW : 0),
          s[1] * (L * 0.29) - wheelL / 2,
          wheelW, wheelL, 5
        );
        ctx.fill();
      });

      // body
      const body = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      body.addColorStop(0, '#3a2f6b');
      body.addColorStop(0.45, '#6f5bd6');
      body.addColorStop(0.55, '#5a49b8');
      body.addColorStop(1, '#2a2350');
      ctx.fillStyle = body;
      Utils.roundRect(ctx, -w / 2, -L / 2, w, L, 18);
      ctx.fill();

      // body outline
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = Utils.rgba(T.cyan, 0.65);
      ctx.stroke();

      // nose + side stripes
      ctx.fillStyle = Utils.rgba(T.cyan, 0.85);
      Utils.roundRect(ctx, -w * 0.30, -L / 2 + 6, w * 0.60, 8, 4);
      ctx.fill();
      ctx.fillStyle = Utils.rgba('#ffffff', 0.12);
      ctx.fillRect(-w / 2 + 6, -L * 0.12, 4, L * 0.34);
      ctx.fillRect(w / 2 - 10, -L * 0.12, 4, L * 0.34);

      // spoiler
      ctx.fillStyle = '#191430';
      Utils.roundRect(ctx, -w * 0.46, L / 2 - 22, w * 0.92, 12, 5);
      ctx.fill();

      // cockpit
      ctx.fillStyle = '#0c1020';
      Utils.roundRect(ctx, -w * 0.27, -L * 0.16, w * 0.54, L * 0.30, 9);
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = Utils.rgba(T.cyan, 0.5);
      ctx.stroke();

      // driver helmet
      ctx.fillStyle = Utils.rgba(T.white, 0.85);
      ctx.beginPath();
      ctx.arc(0, -L * 0.02, 9, 0, Math.PI * 2);
      ctx.fill();

      // brake lights
      if (game.controls.brake && car.speed > 20) {
        ctx.fillStyle = '#ff2d55';
        ctx.shadowColor = '#ff2d55';
        ctx.shadowBlur = 18;
        ctx.fillRect(-w * 0.42, L / 2 - 12, w * 0.26, 6);
        ctx.fillRect(w * 0.16, L / 2 - 12, w * 0.26, 6);
        ctx.shadowBlur = 0;
      }

      // headlight cones
      const beam = ctx.createLinearGradient(0, -L / 2, 0, -L / 2 - 220);
      beam.addColorStop(0, Utils.rgba(T.cyan, 0.22));
      beam.addColorStop(1, Utils.rgba(T.cyan, 0));
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(-w * 0.34, -L / 2);
      ctx.lineTo(w * 0.34, -L / 2);
      ctx.lineTo(w * 0.9, -L / 2 - 220);
      ctx.lineTo(-w * 0.9, -L / 2 - 220);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    },

    /* ---- screen-space overlays ------------------------------------------- */

    /* ---- minimap (Step 5) ------------------------------------------------ */

    /** Cheap overview: the track outline plus a dot for the player. */
    initMinimap(canvas) {
      Renderer.minimap = canvas
        ? { canvas: canvas, ctx: canvas.getContext('2d'), dpr: 1, path: null, w: 0, h: 0 }
        : null;
      Renderer.buildMinimapPath();
      return Renderer.minimap;
    },

    buildMinimapPath() {
      const mm = Renderer.minimap;
      if (!mm) return null;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = mm.canvas.getBoundingClientRect();
      const cssW = Math.max(80, Math.round(rect.width || 132));
      const cssH = Math.max(80, Math.round(rect.height || 132));
      mm.canvas.width = Math.round(cssW * dpr);
      mm.canvas.height = Math.round(cssH * dpr);
      mm.dpr = dpr;
      mm.w = cssW;
      mm.h = cssH;

      const b = Track.bounds;
      const pad = 0.12;
      const scale = Math.min(
        (cssW * (1 - pad * 2)) / b.width,
        (cssH * (1 - pad * 2)) / b.height
      );
      mm.scale = scale;
      mm.offsetX = cssW / 2 - b.centerX * scale;
      mm.offsetY = cssH / 2 - b.centerY * scale;

      mm.path = new Path2D();
      for (let i = 0; i <= Track.count; i++) {
        const p = Track.points[i % Track.count];
        const x = p.x * scale + mm.offsetX;
        const y = p.y * scale + mm.offsetY;
        if (i === 0) mm.path.moveTo(x, y);
        else mm.path.lineTo(x, y);
      }
      return mm;
    },

    drawMinimap(game) {
      const mm = Renderer.minimap;
      if (!mm || !mm.path) return;
      const ctx = mm.ctx;
      const car = game.car;

      ctx.setTransform(mm.dpr, 0, 0, mm.dpr, 0, 0);
      ctx.clearRect(0, 0, mm.w, mm.h);

      // the circuit
      ctx.lineJoin = 'round';
      ctx.strokeStyle = Utils.rgba('#05060d', 0.85);
      ctx.lineWidth = 9;
      ctx.stroke(mm.path);
      ctx.strokeStyle = Utils.rgba(T.violet, 0.85);
      ctx.lineWidth = 5;
      ctx.stroke(mm.path);

      // start line
      const st = Track.start;
      const sx = st.x * mm.scale + mm.offsetX;
      const sy = st.y * mm.scale + mm.offsetY;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(st.ty, st.tx));
      ctx.fillStyle = Utils.rgba('#f4f8ff', 0.95);
      ctx.fillRect(-2, -6, 4, 12);
      ctx.restore();

      // checkpoints the player still has to take
      const Race = OR.Race;
      for (let i = 0; i < Track.checkpoints.length; i++) {
        const cp = Track.checkpoints[i];
        const cx = cp.x * mm.scale + mm.offsetX;
        const cy = cp.y * mm.scale + mm.offsetY;
        const passed = Race && i < Race.nextCheckpoint;
        ctx.beginPath();
        ctx.arc(cx, cy, passed ? 2.2 : 3.2, 0, Math.PI * 2);
        ctx.fillStyle = passed ? Utils.rgba('#ffffff', 0.35) : Utils.rgba(T.cyan, 0.95);
        ctx.fill();
      }

      // the player
      const px = car.x * mm.scale + mm.offsetX;
      const py = car.y * mm.scale + mm.offsetY;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = Utils.rgba(T.cyan, 0.22);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // and which way the car is pointing
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(car.vy, car.vx));
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(0, -4.5);
      ctx.lineTo(0, 4.5);
      ctx.closePath();
      ctx.fillStyle = Utils.rgba(T.cyan, 0.95);
      ctx.fill();
      ctx.restore();
    },

    _drawSpeedLines(game) {
      if (Renderer.reducedMotion) return;
      const ctx = Renderer.ctx;
      const view = Renderer.view;
      const ratio = game.car.speed / CONFIG.car.maxSpeed;
      const intensity = Math.max(0, ratio - 0.55) / 0.45 +
        (game.car.boost.active ? CONFIG.boost.fx.lineBoost : 0);
      if (intensity <= 0.02) return;

      const t = game.clock;
      const car = game.car;
      // on a circuit the car can face any direction, so the streaks travel
      // along the projected velocity instead of always downwards
      const flow = Math.atan2(car.vy, car.vx) - Math.PI / 2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 2;
      ctx.translate(view.w / 2, view.h / 2);
      ctx.rotate(flow);
      ctx.translate(-view.w / 2, -view.h / 2);
      for (let i = 0; i < Renderer._streaks.length; i++) {
        const s = Renderer._streaks[i];
        const speedPx = 900 + ratio * 2200;
        const y = ((t * speedPx + s.phase * view.h * 3) % (view.h + 420)) - 210;
        const len = 60 + intensity * 150;
        const x = s.x * view.w;
        const g = ctx.createLinearGradient(x, y, x, y + len);
        g.addColorStop(0, Utils.rgba(T.cyan, 0));
        g.addColorStop(0.5, Utils.rgba(T.cyan, 0.22 * Math.min(1, intensity)));
        g.addColorStop(1, Utils.rgba(T.cyan, 0));
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + len);
        ctx.stroke();
      }
      ctx.restore();
    },

    _drawCountdown(game) {
      if (game.state !== 'countdown') return;
      const ctx = Renderer.ctx;
      const view = Renderer.view;
      const remaining = game.countdown;
      const value = remaining > 0 ? Math.ceil(remaining) : 0;
      const label = value > 0 ? String(value) : 'GO!';
      const frac = 1 - (remaining - Math.floor(remaining));

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = Utils.clamp(1.25 - frac * 0.5, 0, 1);
      const size = Math.min(view.w, view.h) * (value > 0 ? 0.22 : 0.18);
      ctx.font = '800 ' + size + 'px "Segoe UI", system-ui, sans-serif';
      ctx.shadowColor = value > 0 ? T.cyan : T.magenta;
      ctx.shadowBlur = 40;
      ctx.fillStyle = value > 0 ? T.white : T.magenta;
      ctx.fillText(label, view.w / 2, view.h * 0.42);
      ctx.restore();
    },

    _drawVignette() {
      const ctx = Renderer.ctx;
      const view = Renderer.view;
      if (!Renderer._vignette) {
        const g = ctx.createRadialGradient(
          view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.25,
          view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.78
        );
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.55)');
        Renderer._vignette = g;
      }
      ctx.fillStyle = Renderer._vignette;
      ctx.fillRect(0, 0, view.w, view.h);
    }
  };

  function drawSceneryItem(ctx, it) {
    const s = it.size;
    const neon = it.hue < 0.4 ? T.cyan : it.hue < 0.75 ? T.violet : T.magenta;

    switch (it.type) {
      case 'pylon': {
        const h = 130 * s;
        const w = 22 * s;
        const glow = ctx.createRadialGradient(it.x, it.y, 2, it.x, it.y, 120 * s);
        glow.addColorStop(0, Utils.rgba(neon, 0.5));
        glow.addColorStop(1, Utils.rgba(neon, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(it.x, it.y, 120 * s, 0, Math.PI * 2);
        ctx.fill();

        const g = ctx.createLinearGradient(it.x - w, it.y - h / 2, it.x + w, it.y + h / 2);
        g.addColorStop(0, '#141a2b');
        g.addColorStop(0.5, Utils.rgba(neon, 0.95));
        g.addColorStop(1, '#141a2b');
        ctx.fillStyle = g;
        Utils.roundRect(ctx, it.x - w / 2, it.y - h / 2, w, h, w / 2);
        ctx.fill();
        break;
      }
      case 'tree': {
        const r = 46 * s;
        ctx.fillStyle = 'rgba(6,10,18,0.9)';
        ctx.beginPath();
        ctx.arc(it.x, it.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = Utils.rgba(neon, 0.55);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(it.x, it.y, r * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = Utils.rgba(neon, 0.22);
        ctx.beginPath();
        ctx.arc(it.x, it.y, r * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'crystal': {
        const r = 40 * s;
        const glow = ctx.createRadialGradient(it.x, it.y, 2, it.x, it.y, r * 2.4);
        glow.addColorStop(0, Utils.rgba(neon, 0.45));
        glow.addColorStop(1, Utils.rgba(neon, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(it.x, it.y, r * 2.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(it.x, it.y - r);
        ctx.lineTo(it.x + r * 0.62, it.y);
        ctx.lineTo(it.x, it.y + r);
        ctx.lineTo(it.x - r * 0.62, it.y);
        ctx.closePath();
        ctx.fillStyle = Utils.rgba(neon, 0.35);
        ctx.fill();
        ctx.strokeStyle = Utils.rgba(neon, 0.95);
        ctx.lineWidth = 3;
        ctx.stroke();
        break;
      }
      default: { // billboard
        const w = 150 * s;
        const h = 86 * s;
        const glow = ctx.createRadialGradient(it.x, it.y, 4, it.x, it.y, w);
        glow.addColorStop(0, Utils.rgba(neon, 0.35));
        glow.addColorStop(1, Utils.rgba(neon, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(it.x - w, it.y - h, w * 2, h * 2);

        ctx.fillStyle = 'rgba(10,14,26,0.95)';
        Utils.roundRect(ctx, it.x - w / 2, it.y - h / 2, w, h, 10);
        ctx.fill();
        ctx.strokeStyle = Utils.rgba(neon, 0.9);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = Utils.rgba(neon, 0.16);
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(it.x - w / 2 + 12, it.y - h / 2 + 14 + i * 18, w * (0.7 - i * 0.18), 6);
        }
      }
    }
  }

  OR.Renderer = Renderer;
})();
