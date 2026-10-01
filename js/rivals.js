/* =============================================================================
 * rivals.js — Step 6: STANDARD GOSSIP, three local computer-controlled drivers.
 *
 * The AI reads ONLY Track's public query helpers, never its sample array or
 * track control points. Every car uses the player's Car physics and its own
 * Race tracker.
 *
 * Step 7 layers difficulty on top: the roster profile is the BASE speed/skill,
 * CONFIG.difficulty scales it (speed, corner skill, stall frequency/duration),
 * and a light, capped rubber band nudges the target speed when a rival is far
 * ahead of or behind the player. Rival profiles are still fixed for the whole
 * race once Rivals.reset() has read the level. No networking or latency.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils, Track, Car, Race } = OR;
  const A = CONFIG.rivals;

  function angleError(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  function range(random, min, max) {
    return min + random() * (max - min);
  }

  const Rivals = {
    items: [],
    seed: 0,

    /** Put all four cars in staggered slots, entirely behind the start line. */
    placeOnGrid(car, slot) {
      const g = A.grid;
      const behind = g.behind + Math.floor(slot / 2) * g.rowGap + (slot % 2) * g.stagger;
      const lane = slot % 2 ? g.lane : -g.lane;
      const p = Track.pointAt(Track.start.s - behind);
      car.x = p.x + p.nx * lane;
      car.y = p.y + p.ny * lane;
      car.heading = Math.atan2(p.tx, -p.ty);
      car.trackHint = Track.getNearestTrackPoint(car.x, car.y, p.index).index;
      car.gridSlot = slot;
    },

    /** `level` defaults to the saved selection; Game passes the race's level. */
    reset(player, seed, level) {
      Rivals.seed = seed === undefined ? Math.floor(Math.random() * 4294967296) : seed >>> 0;
      Rivals.items.length = 0;
      Rivals.player = player;
      level = level || OR.Difficulty.settings();
      Rivals.difficulty = level;
      player.id = 'player';
      player.name = 'YOU';
      player.color = CONFIG.theme.violet;
      player.isPlayer = true;
      Rivals.placeOnGrid(player, 0);

      A.roster.forEach((profile, i) => {
        const car = new Car();
        const random = Utils.mulberry32((Rivals.seed + Math.imul(i + 1, 2654435761)) >>> 0);
        car.id = 'gossip-' + (i + 1);
        car.name = profile.name;
        car.color = profile.color;
        car.isPlayer = false;
        car.number = i + 1;
        car.baseTopSpeedMultiplier = profile.speed * level.rivalSpeed;
        car.topSpeedMultiplier = car.baseTopSpeedMultiplier;
        // Stall timing scales with difficulty but stays in a fair band.
        const stallIntervalMin = A.stall.intervalMin * level.stallIntervalScale;
        const stallIntervalMax = A.stall.intervalMax * level.stallIntervalScale;
        car.ai = {
          level: level.id,
          // corner braking / cornering skill, scaled by the difficulty
          skill: Utils.clamp(profile.skill * level.cornerSkill, 0.5, 1.25),
          baseSkill: profile.skill,
          stallIntervalMin: stallIntervalMin,
          stallIntervalMax: stallIntervalMax,
          stallDurationMin: A.stall.durationMin * level.stallDurationScale,
          stallDurationMax: A.stall.durationMax * level.stallDurationScale,
          rubberBand: level.rubberBand,
          lane: profile.lane,
          random: random,
          thinkTimer: 0,
          targetSpeed: 0,
          cornerTarget: 0,
          controls: { steer: 0, throttle: false, brake: false },
          stallRemaining: 0,
          nextStall: range(random, stallIntervalMin, stallIntervalMax),
          stallCount: 0,
          stallDuration: 0,
          stalled: false
        };
        Rivals.placeOnGrid(car, i + 1);
        car.race = Race.create(car);
        Rivals.items.push(car);
      });
      return Rivals.items;
    },

    _stall(car, dt) {
      const ai = car.ai;
      if (ai.stallRemaining > 0) {
        ai.stallRemaining = Math.max(0, ai.stallRemaining - dt);
        if (ai.stallRemaining === 0) {
          ai.nextStall = range(ai.random, ai.stallIntervalMin, ai.stallIntervalMax);
        }
      } else {
        ai.nextStall -= dt;
        if (ai.nextStall <= 0) {
          ai.stallDuration = range(ai.random, ai.stallDurationMin, ai.stallDurationMax);
          ai.stallRemaining = ai.stallDuration;
          ai.stallCount += 1;
        }
      }
      const stalled = ai.stallRemaining > 0;
      if (stalled !== ai.stalled) ai.thinkTimer = 0;
      ai.stalled = stalled;
    },

    /**
     * Light rubber banding: ease off when far ahead of the player, push when
     * far behind. Returns a multiplier capped by CONFIG.rivals.rubberBand so
     * it can never feel unfair. 1 means no assist.
     */
    rubberBandFactor(car) {
      const caps = A.rubberBand;
      const strength = car.ai.rubberBand;
      if (!strength || !Rivals.player || car.race.finished || Race.finished) return 1;
      const hero = Rivals.player.race;
      if (hero.finished || hero.progress < 0) return 1;
      const gap = car.race.progress - hero.progress; // > 0: rival is ahead
      const span = Math.max(0.01, caps.fullGapLaps - caps.deadZoneLaps);
      const t = Utils.clamp((Math.abs(gap) - caps.deadZoneLaps) / span, 0, 1);
      if (t <= 0) return 1;
      const factor = gap > 0
        ? 1 - caps.easeMax * strength * t
        : 1 + caps.pushMax * strength * t;
      return Utils.clamp(factor, 1 - caps.easeMax, 1 + caps.pushMax);
    },

    /** Pure pursuit + a braking-distance envelope for upcoming corners. */
    _think(car) {
      const ai = car.ai;
      const info = Track.getNearestTrackPoint(car.x, car.y, car.trackHint);
      car.trackHint = info.index;
      const lead = Utils.clamp(A.lookAhead + car.speed * A.lookAheadTime,
        A.lookAhead, A.maxLookAhead);
      const target = Track.pointAhead(car.x, car.y, lead, car.trackHint);
      const want = Math.atan2(target.x + target.nx * ai.lane - car.x,
        -(target.y + target.ny * ai.lane - car.y));
      const error = angleError(want - car.heading);
      ai.controls.steer = Utils.clamp(
        (error - car.slip * A.slipCorrection) * A.steeringGain * ai.skill, -1, 1);

      const baseMax = CONFIG.car.maxSpeed * car.baseTopSpeedMultiplier;
      let speed = baseMax;
      const s = info.fraction * Track.length;
      for (let distance = 0; distance <= A.cornerScan; distance += A.cornerScanStep) {
        const p = Track.pointAt(s + distance);
        // The inner lane tightens a bend slightly; leave room for both lanes.
        const radius = Math.max(100, p.radius - Math.abs(ai.lane));
        const cornerSpeed = Math.max(A.minCornerSpeed,
          Math.sqrt(radius * A.lateralAccel * ai.skill));
        speed = Math.min(speed,
          Math.sqrt(cornerSpeed * cornerSpeed + 2 * A.brakePlanning * distance));
      }
      if (Math.abs(error) > 0.85 || !Track.isOnRoad(car.x, car.y, car.trackHint)) {
        speed = Math.min(speed, A.recoverySpeed);
      }
      // Step 7: difficulty-capped rubber band, applied to the whole envelope
      // (straights and corners alike) so a pushed rival really can catch up.
      const band = Rivals.rubberBandFactor(car);
      car.topSpeedMultiplier = car.baseTopSpeedMultiplier * band;
      speed *= band;
      ai.bandFactor = band;
      ai.cornerTarget = speed;
      if (ai.stalled) speed = Math.min(speed,
        CONFIG.car.maxSpeed * car.topSpeedMultiplier * A.stall.speedRatio);
      ai.targetSpeed = speed;
      ai.controls.throttle = car.speed < speed - A.throttleMargin;
      ai.controls.brake = car.speed > speed + A.brakeMargin;
    },

    update(dt) {
      for (let i = 0; i < Rivals.items.length; i++) {
        const car = Rivals.items[i];
        const ai = car.ai;
        if (car.race.finished) {
          Rivals._coolDown(car, dt);
          continue;
        }
        Rivals._stall(car, dt);
        ai.thinkTimer -= dt;
        if (ai.thinkTimer <= 0) {
          ai.thinkTimer = A.thinkInterval;
          Rivals._think(car);
        }
        car.update(dt, ai.controls);
      }
    },

    /** Score AFTER contact resolution, with independent gates and lap times. */
    score(timeMs) {
      for (let i = 0; i < Rivals.items.length; i++) {
        const car = Rivals.items[i];
        car.race.update(car, timeMs);
      }
    },

    /**
     * After the flag a rival keeps a slow cool-down lap. It is still an
     * obstacle the player can bump, but it never parks across the racing line.
     */
    _coolDown(car, dt) {
      const ai = car.ai;
      ai.stalled = false;
      ai.stallRemaining = 0;
      ai.thinkTimer -= dt;
      if (ai.thinkTimer <= 0) {
        ai.thinkTimer = A.thinkInterval;
        Rivals._think(car);
      }
      const cruise = CONFIG.car.maxSpeed * car.baseTopSpeedMultiplier * A.coolDownSpeed;
      if (ai.targetSpeed > cruise) ai.targetSpeed = cruise;
      ai.controls.throttle = car.speed < ai.targetSpeed - A.throttleMargin;
      ai.controls.brake = car.speed > ai.targetSpeed + A.brakeMargin;
      car.update(dt, ai.controls);
    },

    coast(dt) {
      for (let i = 0; i < Rivals.items.length; i++) {
        Rivals._coolDown(Rivals.items[i], dt);
      }
    },

    clear() {
      Rivals.items.length = 0;
    }
  };

  OR.Rivals = Rivals;
})();
