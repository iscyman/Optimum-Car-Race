/* =============================================================================
 * OPTIMUM RACE — Steps 1 to 6
 * config.js — EVERY tuning value in the game lives in this one object.
 * Change a number here and the handling changes in game; no other file needs
 * to be touched to tune the feel of the car.
 * Later steps add their own section here rather than scattering magic numbers.
 * ========================================================================== */
window.OR = window.OR || {};

OR.CONFIG = {
  /* ---- Track ------------------------------------------------------------ */
  track: {
    /* Step 5: the SHAPE of the circuit is data now — see js/trackdata.js.
       What is left here is the mapping between world units and the numbers
       shown to the player, plus the surface bands (which Track reads). */
    metersPerUnit: 0.1, // 10 world units == 1 m, so 10222 u == 1022 m per lap
    roadWidth: 420,     // drivable asphalt width (also in track data)
    shoulder: 34,       // kerb / rumble strip width on each side
    grassMargin: 62,    // run-off area between the kerb and the barrier
    rowStep: 18,        // fallback sample spacing if the track data omits one

    /* Step 8: which track is selected, and the best time / best lap per
       track AND per difficulty. */
    keys: {
      selection: 'optimumRace.track.v1',
      best: 'optimumRace.trackBests.v1'
    }
  },

  /* ---- Car physics (Steps 1 + 2) ----------------------------------------
   * World space: x = right, y = down the screen, FORWARD IS -y.
   * heading 0 = facing straight up the track, positive = turning right.
   * ---------------------------------------------------------------------- */
  car: {
    width: 62,
    length: 118,
    startOffset: 90,    // car starts this far behind the start line

    /* longitudinal */
    maxSpeed: 900,      // world units / second  (== 324 km/h)
    accel: 520,         // units / second^2
    brakeDecel: 1200,   // units / second^2
    coastDrag: 90,      // constant friction, units / second^2
    linearDrag: 0.25,   // friction proportional to speed

    /* steering (radians per second) — tight at low speed, stable flat out */
    turnRateLow: 3.0,   // turn rate near standstill
    turnRateHigh: 1.05, // turn rate at max speed
    steerDeadSpeed: 45, // steering fades out below this speed (0 == no steering)
    steerResponse: 14,  // how quickly steering input ramps in/out

    /* grip and drift — lateral velocity decays at this rate (1/second) */
    gripLow: 10.0,      // lots of grip at low speed
    gripHigh: 4.2,      // less grip flat out => a little slide in fast corners
    driftThreshold: 55, // lateral speed that counts as "drifting"

    /* surfaces: multiplier on max speed, extra drag, multiplier on grip */
    kerb: { speedMul: 0.92, drag: 60, gripMul: 0.9 },
    grass: { speedMul: 0.55, drag: 220, gripMul: 0.55 },

    /* barrier: soft bounce rather than a hard stop */
    bounce: {
      stiffness: 26,    // push-back acceleration per unit of overshoot
      damping: 8,       // bleed off outward speed (1/second)
      maxPush: 1600,    // clamp on the push-back acceleration
      hardMargin: 40,   // safety clamp so the car can never escape
      speedLoss: 0.45,  // how quickly scraping the wall scrubs speed off
      /* While touching a barrier the car is nudged parallel to the track, so
         that driving nose-first into the wall can never wedge it in place
         (steering does nothing at a standstill, so this is the way out). */
      alignRate: 1.7    // radians / second
    },

    /* cosmetics driven by physics */
    rollPerSteer: 0.06, // body roll from steering input
    rollPerDrift: 0.0016
  },

  /* ---- CODED BOOST (Step 3) ---------------------------------------------
   * A 0-100 meter replaces the Step 1 "one charge, then recharge" boost.
   * Every number the mechanic uses lives here.
   * ---------------------------------------------------------------------- */
  boost: {
    meterMax: 100,
    startMeter: 40,      // meter at the start of a race
    threshold: 25,       // cannot be started below this
    drainPerSecond: 66.7,// full meter == 1.5 s of boost, 25 left == 0.37 s
    cooldown: 3.0,       // seconds of lockout once the boost ends
    speedMultiplier: 1.5,
    accelMultiplier: 2.2,

    /* charging: slowly, on the road, at speed */
    charge: {
      rate: 9,           // meter per second
      speedRatio: 0.55,  // needs this fraction of max speed to charge at all
      kerbMul: 0.5,      // the kerb charges at half rate
      grassMul: 0,       // the grass charges not at all
      driftMul: 0.35     // charging while sliding sideways is reduced
    },

    /* shard pickups: cyan diamonds on the track, +20 each */
    shards: {
      value: 20,
      count: 14,
      radius: 46,        // collection radius in world units
      laneSpread: 0.62,  // fraction of the road half-width they wander to
      spin: 1.7,         // radians / second
      startClear: 900,   // keep the first stretch of road clear
      endClear: 900
    },

    /* effects, all suppressed for prefers-reduced-motion */
    fx: {
      cameraZoom: 1.07,
      zoomRate: 3.5,
      speedLines: 26,
      lineBoost: 0.5,    // extra screen streak intensity while boosting
      trail: true
    }
  },

  /* ---- AI rivals (Step 6; no difficulty or networking) ------------------- */
  rivals: {
    roster: [
      { name: 'STANDARD GOSSIP 1', color: '#ffb347', speed: 0.97, skill: 0.90, lane: -64 },
      { name: 'STANDARD GOSSIP 2', color: '#52f4b8', speed: 1.02, skill: 0.96, lane: 0 },
      { name: 'STANDARD GOSSIP 3', color: '#ff684e', speed: 1.05, skill: 1.02, lane: 64 }
    ],
    grid: { behind: 140, rowGap: 180, stagger: 75, lane: 82, screenOffset: 0.55 },
    thinkInterval: 0.06,       // decisions at ~17 Hz; physics still runs at 120 Hz
    lookAhead: 130,
    lookAheadTime: 0.33,
    maxLookAhead: 420,
    steeringGain: 3.8,
    slipCorrection: 0.65,
    cornerScan: 850,
    cornerScanStep: 70,
    lateralAccel: 850,        // corner speed = sqrt(radius * lateralAccel * skill)
    brakePlanning: 850,
    minCornerSpeed: 310,
    throttleMargin: 10,
    brakeMargin: 22,
    recoverySpeed: 370,
    coolDownSpeed: 0.42,      // finished rivals keep a slow lap; they never park
    stall: {
      intervalMin: 4.5,
      intervalMax: 8.5,
      durationMin: 0.5,
      durationMax: 1.0,
      speedRatio: 0.50,        // slows, never freezes or teleports a rival
      flashHz: 2              // gameplay indicator, NOT a network/latency metric
    },
    /* Light rubber banding (Step 7): ease off when far ahead, push when far
       behind. Both directions are capped so the race never feels rigged. */
    rubberBand: {
      easeMax: 0.10,           // most a leading rival slows down
      pushMax: 0.14,           // most a trailing rival speeds up
      deadZoneLaps: 0.10,      // no effect at all within this gap
      fullGapLaps: 0.60        // full effect once the gap reaches this
    }
  },

  /* ---- Car-to-car contact (Step 6) -------------------------------------- */
  collisions: {
    enabled: true,
    iterations: 4,
    widthScale: 0.96,
    lengthScale: 0.96,
    clearance: 1.5,
    speedLoss: 0.045,
    cooldown: 0.30,           // sustained contact cannot drain speed every tick
    restitution: 0.08
  },

  /* ---- Difficulty (Step 7; one entry per selectable level) -------------- */
  difficulty: {
    default: 'normal',
    keys: {
      selection: 'optimumRace.difficulty.v1',
      best: 'optimumRace.bestTimes.v1'
    },
    levels: [
      {
        id: 'easy',
        label: 'EASY',
        blurb: 'Relaxed rivals: slower, brake earlier and stall for longer.',
        rivalSpeed: 0.94,          // × the roster profile's top speed
        cornerSkill: 0.88,         // × corner braking / cornering skill
        stallIntervalScale: 0.85,  // < 1 means stalls come around more often
        stallDurationScale: 1.30,  // and last longer
        rubberBand: 0.60           // assist strength (see CONFIG.rivals.rubberBand)
      },
      {
        id: 'normal',
        label: 'NORMAL',
        blurb: 'Balanced rivals that keep the pack close.',
        rivalSpeed: 1.21,          // matches a decent unboosted player
        cornerSkill: 1.14,
        stallIntervalScale: 1.00,
        stallDurationScale: 1.00,
        rubberBand: 0.45
      },
      {
        id: 'hard',
        label: 'HARD',
        blurb: 'Fast, consistent rivals that rarely put a wheel wrong.',
        rivalSpeed: 1.26,
        cornerSkill: 1.16,
        stallIntervalScale: 1.35,  // stalls are rarer
        stallDurationScale: 0.65,  // and shorter
        rubberBand: 0.30           // less help, so the pace difference shows
      }
    ]
  },

  /* ---- Camera ------------------------------------------------------------ */
  camera: {
    visibleHeight: 900,    // world units we try to fit vertically
    minVisibleWidth: 620,  // never zoom in further than this horizontally
    carScreenOffset: 0.72, // 0 = top of screen, 1 = bottom of screen
    followRate: 6,         // how quickly the camera catches up
    gridBlendRate: 4.5,    // smooth transition from the four-car grid to the player
    lookAhead: 240,        // base look-ahead distance (world units)
    lookAheadSpeed: 220,   // extra look-ahead at top speed
    lookAheadRate: 2.5,    // smoothing of the look-ahead offset
    lookAheadMaxFrac: 0.2, // ...but never more than this much of the visible width,
                           // so the car cannot be pushed to the screen edge on phones
    centerBias: 0.35       // how much the camera also aims at the road ahead
  },

  /* ---- Effects ----------------------------------------------------------- */
  effects: {
    tireMarks: {
      max: 260,          // hard cap on live marks (performance)
      life: 3.6,         // seconds before a mark fades away
      emitInterval: 0.035,
      minGap: 14,        // world units between marks along the car
      length: 26,
      width: 9,
      minDrift: 55,      // sideways speed needed to lay rubber
      minBrakeSpeed: 420 // forward speed needed for brake marks
    },
    maxParticles: 320,  // hard cap on live boost / spark / pickup particles
    renderDpr: { mobileWidth: 720, mobileHeight: 480, mobileMax: 1, desktopMax: 2 },
    roadCache: { maxSize: 3072 } // bounded static road texture on phones
  },

  /* ---- Audio (Web Audio only, no audio files) ---------------------------- */
  audio: {
    defaultEnabled: false,   // sound is OFF until the player turns it on
    masterGain: 0.16,
    engine: {
      baseFreq: 58,          // Hz at the bottom of a gear
      gearCount: 5,
      gearRange: 125,        // Hz climbed across one gear
      filterBase: 420,
      filterSpeed: 1500
    },
    wind: { gain: 0.05, filter: 700 },
    boost: { filterAdd: 900, gainAdd: 0.05 }
  },

  /* ---- Race flow (Step 4) ------------------------------------------------ */
  race: {
    laps: 3,               // laps per race
    /* Checkpoints as a fraction of the lap, in order. A lap only counts when
       all of them have been passed, so a cut corner cannot skip a lap. */
    checkpoints: [0.25, 0.5, 0.75],
    countdownSeconds: 3,
    finishDelayMs: 900,    // let the car roll past the line before the overlay
    maxStep: 0.05,         // clamp for huge frame gaps
    fixedStep: 1 / 120     // physics timestep
  },

  /* ---- Player profile and the save file (Step 9) ------------------------------
   * One versioned save object holds everything the player keeps between
   * sessions: profile, career stats, best times and the menu selections.
   * `keys.save` is the single live key; the older per-feature keys are read
   * once, by the migration, and then left alone. */
  profile: {
    maxNameLength: 16,
    defaultName: 'Racer',
    defaultColor: 'violet',
    /* Six car colours. `body` is the four-stop body gradient used by the
       renderer: outer dark, inner light, then the mirrored pair. */
    colors: [
      { id: 'violet', label: 'VIOLET', hex: '#8b5cff', body: ['#3a2f6b', '#6f5bd6', '#5a49b8', '#2a2350'] },
      { id: 'cyan', label: 'CYAN', hex: '#22e1ff', body: ['#155166', '#3fd3ee', '#2fb2cd', '#0d3745'] },
      { id: 'amber', label: 'AMBER', hex: '#ffb347', body: ['#5c3f14', '#f0a94b', '#d18f38', '#3d2a0d'] },
      { id: 'magenta', label: 'MAGENTA', hex: '#ff3ea5', body: ['#5c1440', '#e64b96', '#c43c80', '#3d0d2b'] },
      { id: 'mint', label: 'MINT', hex: '#52f4b8', body: ['#155c46', '#4fd7a6', '#3fb98d', '#0d3d2e'] },
      { id: 'crimson', label: 'CRIMSON', hex: '#ff684e', body: ['#5c241a', '#e05f47', '#c04f3b', '#3d180f'] }
    ],
    keys: {
      save: 'optimumRace.save.v1'
    }
  },

  /* ---- XP and levels (Step 10) ---------------------------------------------
   * Racing earns XP; XP decides the level. `xpForLevel()` in js/xp.js reads
   * this block, so the curve and every award live in one place.
   *
   * Level curve: the total XP required to BE at level N is
   *   levelBase * N ^ levelExponent      (level 1 is always 0 XP)
   * With the defaults that is
   *   1: 0     2: 283   3: 520   4: 800   5: 1118
   *   6: 1476  7: 1872  8: 2300  9: 2760  10: 3162
   */
  xp: {
    finish: 50,                        // crossing the line at all
    placement: { 1: 100, 2: 60, 3: 30 }, // place bonus; 4th and beyond: nothing
    cleanLap: 20,                      // per lap with no barrier contact
    boost: { per: 5, max: 20 },        // small bonus for boost use, capped
    levelBase: 100,
    levelExponent: 1.5,
    multipliers: { easy: 0.8, normal: 1, hard: 1.3 },
    toastMs: 2600                      // how long the level-up toast stays up
  },

  /* ---- Theme ------------------------------------------------------------- */
  /* ---- CARS AND UNLOCKS (Step 11) ---------------------------------------
   * Four cars, each a set of multipliers on the Step 2 physics the game
   * shipped with (`base` below). RELAY is all 1.00, so it drives exactly
   * like Steps 1-10. car.js holds a reference to CONFIG.car and CONFIG.boost,
   * so applying a car just scales the numbers in place: no handling code
   * changes and no per-car special cases.
   *
   * The rule the tests enforce: no car is >= another car on every stat, so
   * every strength is paid for somewhere. trade in config, not in code.
   */
  cars: {
    defaultId: 'relay',
    base: {
      accel: 520,        // units / second^2
      maxSpeed: 900,     // world units / second
      turnRateLow: 3.0,
      turnRateHigh: 1.05,
      gripLow: 10.0,
      gripHigh: 4.2,
      meterMax: 100      // boost tank
    },
    list: [
      {
        id: 'relay', name: 'RELAY', subtitle: 'Balanced starter',
        blurb: 'The car the game shipped with. Even everywhere, no weak spot, ' +
               'happy on any circuit.',
        stats: { accel: 1.00, topSpeed: 1.00, handling: 1.00, boost: 1.00 }
      },
      {
        id: 'validator', name: 'VALIDATOR', subtitle: 'Straight-line speed',
        blurb: 'Pulls hardest on long straights, but charges and turns a ' +
               'little slower. MESH HIGHWAY is its home.',
        stats: { accel: 0.94, topSpeed: 1.08, handling: 0.97, boost: 1.00 }
      },
      {
        id: 'shard', name: 'SHARD', subtitle: 'Point and squirt',
        blurb: 'Fastest off the line and turns in sharpest, with a smaller ' +
               'boost tank and a lower top end. Built for tight corners.',
        stats: { accel: 1.12, topSpeed: 0.95, handling: 1.10, boost: 0.80 }
      },
      {
        id: 'flexnode', name: 'FLEXNODE', subtitle: 'Boost tank',
        blurb: 'A huge boost tank and a strong top end, traded against ' +
               'acceleration and grip. Rewards good lines.',
        stats: { accel: 0.92, topSpeed: 1.03, handling: 0.94, boost: 1.40 }
      }
    ],
    /* Display ranges for the stat bars, so a full bar always means "best in
       class" and the bars are comparable between cars. */
    bars: {
      accel: { min: 0.85, max: 1.15, label: 'ACCELERATION' },
      topSpeed: { min: 0.90, max: 1.10, label: 'TOP SPEED' },
      handling: { min: 0.85, max: 1.15, label: 'HANDLING' },
      boost: { min: 0.70, max: 1.50, label: 'BOOST CAPACITY' }
    }
  },

  /* ---- WHAT UNLOCKS WHEN (Step 11) --------------------------------------
   * Every number the unlock screens show comes from here. A kind that is not
   * listed is available from the start (level 1).
   */
  unlocks: {
    cars: { relay: 1, validator: 3, shard: 6, flexnode: 10 },
    tracks: { flexnode: 1, 'mesh-highway': 2, 'shard-speedway': 5 }
  },

  /* ---- EVENTS (Step 12) -------------------------------------------------
   * Four challenges, defined as pure data. Each entry carries:
   *   objective   what must be true at the flag (time / clean / win / collect)
   *   modifier    the patch applied for the event race only (laps, shards)
   *   difficulty  optional forced difficulty (and the one a win is judged on)
   *   xp          the one-off completion bonus, paid once ever
   * js/events.js never names an event, so a fifth event is one entry here.
   *
   * BLOCK RUSH targets are about 1.3x the measured NORMAL rival lap on each
   * circuit, so they are beatable but not free.
   */
  events: {
    bannerMs: 3400,
    list: [
      {
        id: 'block-rush',
        name: 'BLOCK RUSH',
        description: 'One lap. Beat the clock.',
        objective: {
          type: 'time',
          targets: { flexnode: 18, 'mesh-highway': 28, 'shard-speedway': 18 }
        },
        modifier: { laps: 1 },
        xp: 250
      },
      {
        id: 'steady-stream',
        name: 'STEADY STREAM',
        description: 'Two clean laps — not one barrier touch.',
        objective: { type: 'clean', laps: 2 },
        modifier: { laps: 2 },
        xp: 220
      },
      {
        id: 'rival-gauntlet',
        name: 'RIVAL GAUNTLET',
        description: 'Two laps on HARD, and win them.',
        objective: { type: 'win', laps: 2, difficulty: 'hard' },
        modifier: { laps: 2 },
        difficulty: 'hard',
        xp: 400
      },
      {
        id: 'shard-hunter',
        name: 'SHARD HUNTER',
        description: 'Collect five coded shards in one race.',
        objective: { type: 'collect', count: 5 },
        modifier: { shards: 16 },
        xp: 180
      }
    ]
  },

  theme: {
    cyan: '#22e1ff',
    violet: '#8b5cff',
    magenta: '#ff3ea5',
    amber: '#ffb347',
    white: '#eaf6ff',
    asphaltTop: '#232a3d',
    asphaltBottom: '#141824',
    groundTop: '#0a0c17',
    groundBottom: '#05060d',
    runoff: 'rgb(9, 20, 18)',
    grass: '#0c1a17',
    rumbleA: '#ff3ea5',
    rumbleB: '#f2f6ff'
  }
};
