/* =============================================================================
 * car.js — shared car physics (player and Step 6 rivals).
 *
 * Step 2 handling model:
 *   - the car has a HEADING (where it points) and a VELOCITY (where it goes);
 *   - steering turns the heading, and grip pulls the velocity back in line,
 *     so hard cornering at speed produces a small, readable slide;
 *   - steering is tight at low speed, stable flat out, and does nothing when
 *     the car is stationary;
 *   - the barrier is a spring (soft bounce) with a hard backstop behind it.
 *
 * The model only knows about world coordinates, so the track can be swapped
 * for a closed circuit in a later step without touching this file.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils, Track } = OR;
  const C = CONFIG.car;
  const B = CONFIG.boost;

  function Car() {
    this.reset();
  }

  Car.prototype.reset = function () {
    /* Step 5: the car spawns on the start line facing along the circuit. */
    const start = Track.start;
    this.trackHint = Track.startIndex;
    this.x = start.x;
    this.y = start.y;
    this.heading = Math.atan2(start.tx, -start.ty);   // radians; 0 = north
    this.vx = 0;           // world velocity, units / second
    this.vy = 0;
    this.speed = 0;        // |velocity|
    this.vLong = 0;        // velocity along the heading
    this.vLat = 0;         // velocity sideways (the drift)
    this.slip = 0;         // angle between velocity and heading
    this.drifting = false;
    this.steerRaw = 0;     // -1, 0, 1 straight from the input
    this.steerInput = 0;   // smoothed version actually used for steering
    this.tilt = 0;         // visual body roll
    this.surface = 'road';
    this.offRoad = false;
    this.hitWall = false;
    /* Step 10: barrier contact as an EPISODE, not a per-step flag — scraping
       the wall for two seconds is one hit, so "clean lap" means something. */
    this.wallHits = 0;          // contacts since reset (the whole race)
    this.touchingBarrier = false;
    this.braking = false;
    this.maxSpeed = 0;     // km/h, for the finish screen
    this.topSpeedMultiplier = 1; // rivals set their fixed profile after reset
    this.hitCar = false;
    /* ---- CODED BOOST (Step 3): a 0-100 meter ------------------------------ */
    this.meter = B.startMeter;   // charge, 0 .. B.meterMax
    this.boost = {
      active: false,
      cooldown: 0,     // seconds of lockout left after the last boost
      used: 0,         // boosts fired this race
      peakKmh: 0,      // fastest speed reached while boosting
      refused: 0       // requests turned down because the meter was too low
    };
    return this;
  };

  /** Unit vector the car is pointing along. */
  Car.prototype.forward = function () {
    return { x: Math.sin(this.heading), y: -Math.cos(this.heading) };
  };

  /** 0 -> empty, 1 -> full. Drives the HUD meter. */
  Car.prototype.meterRatio = function () {
    return Utils.clamp(this.meter / B.meterMax, 0, 1);
  };

  /** Kept from Step 1: the same number as `meterRatio`, for the HUD ring. */
  Car.prototype.boostCharge = function () {
    return this.meterRatio();
  };

  /** Enough charge, no cooldown and not already boosting? */
  Car.prototype.boostReady = function () {
    return !this.boost.active && this.boost.cooldown <= 0 && this.meter >= B.threshold;
  };

  /** Called when the player presses the boost key/button. */
  Car.prototype.requestBoost = function (allowed) {
    if (!allowed) return false;
    if (this.boost.active || this.boost.cooldown > 0) return false;
    if (this.meter < B.threshold) {
      this.boost.refused += 1;   // let the HUD flash "not enough charge"
      return false;
    }
    this.boost.active = true;
    this.boost.used += 1;
    return true;
  };

  /** Shard pickups top the meter up; never past full. */
  Car.prototype.addMeter = function (amount) {
    this.meter = Utils.clamp(this.meter + amount, 0, B.meterMax);
    return this.meter;
  };

  /** How many seconds of boost the current charge buys. */
  Car.prototype.boostSecondsLeft = function () {
    return this.meter / B.drainPerSecond;
  };

  /**
   * Charging: only on the road, only at speed, and slower while the car is
   * sliding or running wide on the kerb. Called before the car moves, so it
   * uses last frame's speed and surface.
   */
  Car.prototype._chargeMeter = function (dt) {
    if (this.speed < C.maxSpeed * B.charge.speedRatio) return;
    let mul = B.charge.rate;
    if (this.surface === 'grass') {
      if (B.charge.grassMul <= 0) return;
      mul *= B.charge.grassMul;
    } else if (this.surface === 'kerb') {
      mul *= B.charge.kerbMul;
    }
    if (this.drifting) mul *= B.charge.driftMul;
    this.addMeter(mul * dt);
  };

  Car.prototype.update = function (dt, controls) {
    const boost = this.boost;

    /* ---- CODED BOOST meter ------------------------------------------------ */
    if (boost.active) {
      // The boost lasts as long as there is charge: a full meter buys ~1.5 s.
      this.meter = Math.max(0, this.meter - B.drainPerSecond * dt);
      if (this.meter <= 0) {
        boost.active = false;
        boost.cooldown = B.cooldown;   // lockout starts when the burst ends
      }
    } else {
      if (boost.cooldown > 0) boost.cooldown = Math.max(0, boost.cooldown - dt);
      if (this.meter > 0 && this.meter < B.meterMax) this._chargeMeter(dt);
    }

    /* ---- steering -------------------------------------------------------- */
    this.steerRaw = typeof controls.steer === 'number'
      ? Utils.clamp(controls.steer, -1, 1)
      : (controls.right ? 1 : 0) - (controls.left ? 1 : 0);
    this.steerInput = Utils.damp(this.steerInput, this.steerRaw, C.steerResponse, dt);

    const speedRatio = Utils.clamp(this.speed / C.maxSpeed, 0, 1);
    // tight at low speed, stable flat out, nothing at a standstill
    const turnRate = Utils.lerp(C.turnRateLow, C.turnRateHigh, speedRatio);
    const authority = Utils.clamp(this.speed / C.steerDeadSpeed, 0, 1);
    this.heading += this.steerInput * turnRate * authority * dt;

    const fx = Math.sin(this.heading), fy = -Math.cos(this.heading);
    const rx = Math.cos(this.heading), ry = Math.sin(this.heading);

    /* ---- split velocity into forward + sideways -------------------------- */
    let vLong = this.vx * fx + this.vy * fy;
    let vLat = this.vx * rx + this.vy * ry;

    /* ---- surface --------------------------------------------------------- */
    this.surface = Track.surface(this.x, this.y, this.trackHint);
    this.offRoad = this.surface !== 'road';
    const surf = this.surface === 'grass' ? C.grass
      : this.surface === 'kerb' ? C.kerb : null;

    /* ---- longitudinal ---------------------------------------------------- */
    const boosting = boost.active;
    let maxSpeed = C.maxSpeed * this.topSpeedMultiplier * (boosting ? B.speedMultiplier : 1);
    if (surf) maxSpeed *= surf.speedMul;

    this.braking = !!controls.brake;
    if (controls.throttle) vLong += C.accel * (boosting ? B.accelMultiplier : 1) * dt;
    if (controls.brake) vLong -= C.brakeDecel * dt;

    const drag = C.coastDrag + C.linearDrag * Math.abs(vLong) + (surf ? surf.drag : 0);
    vLong -= drag * dt;
    vLong = Utils.clamp(vLong, 0, maxSpeed);

    /* ---- grip: sideways speed bleeds off, so the car lines up ------------ */
    let gripRate = Utils.lerp(C.gripLow, C.gripHigh, speedRatio);
    if (surf) gripRate *= surf.gripMul;
    vLat *= Math.exp(-gripRate * dt);

    /* ---- rebuild the velocity and move ----------------------------------- */
    this.vx = fx * vLong + rx * vLat;
    this.vy = fy * vLong + ry * vLat;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    /* ---- barrier: soft bounce, with a hard backstop behind it ------------ */
    this.hitWall = false;
    const hit = Track.nearest(this.x, this.y, this.trackHint);
    this.trackHint = hit.index;

    const excess = Math.abs(hit.offset) - Track.limit;
    if (excess > 0) {
      const sign = hit.offset < 0 ? -1 : 1;
      const push = Math.min(excess * C.bounce.stiffness, C.bounce.maxPush);
      // push back along the track normal, towards the road
      this.vx -= sign * hit.nx * push * dt;
      this.vy -= sign * hit.ny * push * dt;
      const outward = this.vx * hit.nx * sign + this.vy * hit.ny * sign;
      if (outward > 0) {
        this.vx -= sign * hit.nx * outward * Math.min(1, C.bounce.damping * dt);
        this.vy -= sign * hit.ny * outward * Math.min(1, C.bounce.damping * dt);
      }
      const keep = Math.max(0, 1 - C.bounce.speedLoss * dt);
      this.vx *= keep;
      this.vy *= keep;

      // Wall-slide assist: nudge the car parallel to the track so it can
      // always drive itself out of the barrier instead of wedging nose-first.
      const dir = Track.directionOfTravel(hit, this.vx, this.vy);
      const want = Math.atan2(hit.tx * dir, -hit.ty * dir);
      let align = want - this.heading;
      while (align > Math.PI) align -= Math.PI * 2;
      while (align < -Math.PI) align += Math.PI * 2;
      const rate = C.bounce.alignRate * dt;
      this.heading += Utils.clamp(align, -rate, rate);
      this.heading = (this.heading + Math.PI) % (Math.PI * 2) - Math.PI;

      this.hitWall = true;
    }

    /* Step 10: one contact episode per visit to the barrier, not per physics
       step. The flag is raised while the car is out there and cleared the
       moment it is back inside the run-off. */
    const outside = excess > 0 || Math.abs(hit.offset) > Track.hardLimit;
    if (outside && !this.touchingBarrier) this.wallHits += 1;
    this.touchingBarrier = outside;

    // absolute backstop: the car can never leave the playable area
    if (Math.abs(hit.offset) > Track.hardLimit) {
      const sign = hit.offset < 0 ? -1 : 1;
      const pull = Math.abs(hit.offset) - Track.hardLimit;
      this.x -= sign * hit.nx * pull;
      this.y -= sign * hit.ny * pull;
      const outward = this.vx * hit.nx * sign + this.vy * hit.ny * sign;
      if (outward > 0) {
        this.vx -= sign * hit.nx * outward * 1.25;
        this.vy -= sign * hit.ny * outward * 1.25;
      }
      this.hitWall = true;
    }

    /* ---- derived values -------------------------------------------------- */
    this.syncVelocity();

    /* ---- cosmetics ------------------------------------------------------- */
    const roll = this.steerInput * C.rollPerSteer +
      Utils.clamp(this.vLat * C.rollPerDrift, -0.14, 0.14);
    this.tilt = Utils.damp(this.tilt, roll, 10, dt);

    this.maxSpeed = Math.max(this.maxSpeed, this.speedKmh());
    if (boost.active) boost.peakKmh = Math.max(boost.peakKmh, this.speedKmh());
  };

  /** Keep derived motion coherent after an external car-to-car impulse. */
  Car.prototype.syncVelocity = function () {
    const fx = Math.sin(this.heading), fy = -Math.cos(this.heading);
    const rx = Math.cos(this.heading), ry = Math.sin(this.heading);
    this.speed = Math.hypot(this.vx, this.vy);
    this.vLong = this.vx * fx + this.vy * fy;
    this.vLat = this.vx * rx + this.vy * ry;
    this.slip = Math.atan2(this.vLat, Math.max(1, this.vLong));
    this.drifting = Math.abs(this.vLat) > C.driftThreshold;
  };

  Car.prototype.speedKmh = function () {
    return this.speed * CONFIG.track.metersPerUnit * 3.6;
  };

  OR.Car = Car;
})();
