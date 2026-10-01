/* =============================================================================
 * tests/cars.js — Step 11 checks that need no DOM and no browser.
 *
 * Run: node tests/cars.js
 * Covers: the four cars and their balance, the unlock levels, stat bars and
 * the physics each car produces, locked selection being refused, unlock
 * syncing (exactly once), persistence, the save version 2 -> 3 migration
 * (including "never lock out an existing player"), and reset behaviour.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['config', 'utils', 'xp', 'trackdata', 'track', 'car', 'race', 'save', 'cars', 'events',
  'difficulty', 'bests', 'rivals', 'collisions', 'standings', 'shards'];
const STEP = 1 / 120;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
function section(name) { console.log('\nStep 11 — ' + name); }

function boot(storage) {
  const context = { console, Math, Map };
  context.window = context;
  if (storage) context.localStorage = storage;
  vm.createContext(context);
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), context, { filename: file });
  }
  return context.OR;
}

function fakeStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; }
  };
}

/** A save that already has everything the tests want, at version 2. */
function v2Save(overrides) {
  const base = {
    version: 2,
    profile: { name: 'Veteran', color: 'amber' },
    stats: { races: 12, wins: 5, podiums: 8, totalTimeMs: 511000 },
    progress: { xp: 0, level: 1 },
    bests: {},
    selection: { track: null, difficulty: null }
  };
  const data = Object.assign({}, base, overrides || {});
  const storage = fakeStorage();
  storage.data['optimumRace.save.v1'] = JSON.stringify(data);
  return storage;
}

/**
 * Drive full throttle for `seconds` from the start line, with no traffic, and
 * report the speed reached. One second keeps every car on the start straight,
 * so the comparison is about the car, not about the corner.
 */
function accelerate(OR, id, seconds) {
  OR.Cars.apply(id);
  const car = new OR.Car();
  car.reset();
  const controls = { throttle: true, brake: false, steer: 0 };
  const collisions = OR.CONFIG.collisions.enabled;
  OR.CONFIG.collisions.enabled = false;
  try {
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i++) car.update(STEP, controls);
  } finally {
    OR.CONFIG.collisions.enabled = collisions;
  }
  return { speed: car.speed, surface: car.surface };
}

/**
 * Cornering: give every car the SAME entry speed on the straight, then hold
 * full left for half a second, and report how far the nose turned. This is
 * the handling stat made visible (grip and turn rates both scale with it).
 */
function corner(OR, id, entrySpeed, seconds) {
  OR.Cars.apply(id);
  const car = new OR.Car();
  car.reset();
  car.vx = Math.sin(car.heading) * entrySpeed;
  car.vy = -Math.cos(car.heading) * entrySpeed;
  const before = car.heading;
  const collisions = OR.CONFIG.collisions.enabled;
  OR.CONFIG.collisions.enabled = false;
  try {
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i++) {
      car.update(STEP, { throttle: false, brake: false, steer: -1 });
    }
  } finally {
    OR.CONFIG.collisions.enabled = collisions;
  }
  return { turn: (car.heading - before) * 180 / Math.PI, speed: car.speed, surface: car.surface };
}

/* ====================== 1. the cars and their balance ===================== */

section('the four cars, their stats and the balance rule');
{
  const OR = boot(fakeStorage());
  const CARS = OR.CONFIG.cars.list;
  const ids = CARS.map(c => c.id);

  check('there are four cars with the suggested names',
    CARS.length === 4 && ids.join(',') === 'relay,validator,shard,flexnode' &&
    CARS.map(c => c.name).join(',') === 'RELAY,VALIDATOR,SHARD,FLEXNODE',
    ids.join(' · '));

  check('every car carries all four stats',
    CARS.every(c => ['accel', 'topSpeed', 'handling', 'boost']
      .every(stat => typeof c.stats[stat] === 'number' && c.stats[stat] > 0)));

  check('the starter is the shipped Step 2 tuning (all 1.00)',
    OR.Cars.defaultId === 'relay' &&
    Object.keys(OR.Cars.stats('relay')).every(k => OR.Cars.stats('relay')[k] === 1));

  /* The balance rule: no car is >= another on every stat. */
  const dominates = [];
  for (const a of CARS) {
    for (const b of CARS) {
      if (a.id === b.id) continue;
      const stats = ['accel', 'topSpeed', 'handling', 'boost'];
      const neverWorse = stats.every(s => a.stats[s] >= b.stats[s]);
      const betterSomewhere = stats.some(s => a.stats[s] > b.stats[s]);
      if (neverWorse && betterSomewhere) dominates.push(a.id + '>' + b.id);
    }
  }
  check('no car is strictly better than another (every gain is paid for)',
    dominates.length === 0, dominates.length ? dominates.join(', ') : 'no dominance in either direction');

  check('the spread stays small enough to be a choice, not a wall',
    CARS.every(c => ['accel', 'topSpeed', 'handling'].every(s =>
      c.stats[s] >= 0.85 && c.stats[s] <= 1.15)) &&
    CARS.every(c => c.stats.boost >= 0.7 && c.stats.boost <= 1.5),
    CARS.map(c => c.id + ' ' + ['accel', 'topSpeed', 'handling', 'boost']
      .map(s => c.stats[s].toFixed(2)).join('/')).join('  '));

  check('the unlock levels are the ones from the spec',
    OR.Cars.unlockLevel('relay') === 1 && OR.Cars.unlockLevel('validator') === 3 &&
    OR.Cars.unlockLevel('shard') === 6 && OR.Cars.unlockLevel('flexnode') === 10,
    OR.Cars.ids.map(id => id + ':L' + OR.Cars.unlockLevel(id)).join(' '));

  check('the track unlock levels match too',
    OR.Cars.trackUnlockLevel('flexnode') === 1 &&
    OR.Cars.trackUnlockLevel('mesh-highway') === 2 &&
    OR.Cars.trackUnlockLevel('shard-speedway') === 5);

  check('the stat bars are 0..1 and marked with the percent from the base car',
    (function () {
      const rows = OR.Cars.barRows('validator');
      const accel = rows.filter(r => r.id === 'accel')[0];
      const top = rows.filter(r => r.id === 'topSpeed')[0];
      return rows.length === 4 &&
        rows.every(r => r.bar >= 0 && r.bar <= 1 && typeof r.label === 'string') &&
        accel.percent === -6 && accel.text === '-6%' &&
        top.percent === 8 && top.text === '+8%';
    })(), OR.Cars.barRows('shard').map(r => r.label + ' ' + r.text).join(' · '));
}

/* ==================== 2. applying a car to the physics ==================== */

section('applying a car writes the existing physics config');
{
  const OR = boot(fakeStorage());

  OR.Cars.apply('validator');
  check('top speed scales the live max speed',
    OR.CONFIG.car.maxSpeed === 900 * 1.08 &&
    OR.CONFIG.car.accel === 520 * 0.94,
    'maxSpeed ' + OR.CONFIG.car.maxSpeed.toFixed(1) + ' · accel ' + OR.CONFIG.car.accel.toFixed(1));

  OR.Cars.apply('shard');
  check('handling scales the turn rates and both grip values',
    OR.CONFIG.car.turnRateLow === 3.0 * 1.10 &&
    OR.CONFIG.car.turnRateHigh === 1.05 * 1.10 &&
    OR.CONFIG.car.gripLow === 10.0 * 1.10 &&
    OR.CONFIG.car.gripHigh === 4.2 * 1.10,
    'turn ' + OR.CONFIG.car.turnRateLow.toFixed(2) + ' · grip ' + OR.CONFIG.car.gripLow.toFixed(1));

  OR.Cars.apply('flexnode');
  check('boost capacity scales the tank and the starting charge',
    OR.CONFIG.boost.meterMax === 140 && OR.CONFIG.boost.startMeter === 56 &&
    OR.CONFIG.boost.threshold === OR.CONFIG.boost.threshold,
    'meterMax ' + OR.CONFIG.boost.meterMax + ' · start ' + OR.CONFIG.boost.startMeter);

  check('the drain rate is untouched, so a bigger tank is a longer boost',
    OR.CONFIG.boost.drainPerSecond === 66.7);

  OR.Cars.restore();
  check('restore() puts the shipped numbers back',
    OR.CONFIG.car.maxSpeed === 900 && OR.CONFIG.car.accel === 520 &&
    OR.CONFIG.car.turnRateLow === 3.0 && OR.CONFIG.boost.meterMax === 100 &&
    OR.CONFIG.boost.startMeter === 40);

  /* Each car must actually drive differently, in the order its stats say. */
  const seconds = 1;
  const relay = accelerate(OR, 'relay', seconds);
  const validator = accelerate(OR, 'validator', seconds);
  const shard = accelerate(OR, 'shard', seconds);
  const flexnode = accelerate(OR, 'flexnode', seconds);
  const speeds = [relay, validator, shard, flexnode].map(c => Math.round(c.speed));

  check('every car accelerates differently, in stat order',
    shard.speed > relay.speed && relay.speed > validator.speed &&
    validator.speed > flexnode.speed && speeds.every((v, i) =>
      new Set(speeds).size === 4 && speeds.indexOf(v) === i) &&
    [relay, validator, shard, flexnode].every(c => c.surface === 'road'),
    'after 1 s: shard ' + speeds[2] + ' > relay ' + speeds[0] +
    ' > validator ' + speeds[1] + ' > flexnode ' + speeds[3]);

  check('top speed differs, and the straight-line car is at the front',
    (function () {
      const ceiling = id => {
        OR.Cars.apply(id);
        return OR.CONFIG.car.maxSpeed;
      };
      const relayMax = ceiling('relay');
      const validatorMax = ceiling('validator');
      const shardMax = ceiling('shard');
      const flexnodeMax = ceiling('flexnode');
      OR.Cars.restore();
      return Math.round(relayMax) === 900 && Math.round(validatorMax) === 972 &&
        Math.round(shardMax) === 855 && Math.round(flexnodeMax) === 927 &&
        validatorMax > flexnodeMax &&
        flexnodeMax > relayMax && relayMax > shardMax;
    })(), OR.Cars.ids.map(id => id + ' ' + (900 * OR.Cars.stats(id).topSpeed).toFixed(0))
      .join(' / '));

  check('the cornering car turns sharpest and the boost car the least',
    (function () {
      const line = OR.Cars.ids.map(id => corner(OR, id, 400, 0.5));
      const byId = {};
      OR.Cars.ids.forEach((id, i) => { byId[id] = line[i]; });
      return byId.shard.turn < byId.relay.turn &&
        byId.relay.turn < byId.validator.turn &&
        byId.validator.turn < byId.flexnode.turn &&
        line.every(c => c.surface === 'road');
    })(), OR.Cars.ids.map(id => id + ' ' +
      corner(OR, id, 400, 0.5).turn.toFixed(1) + '°').join(' / '));

  check('the boost car carries a bigger tank than everyone else',
    OR.Cars.stats('flexnode').boost === 1.4 &&
    OR.Cars.stats('flexnode').boost > OR.Cars.stats('relay').boost &&
    OR.Cars.stats('shard').boost < 1,
    'flexnode 140 vs shard 80');
}

/* ==================== 3. locked cars cannot be picked ==================== */

section('locked cars are refused');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  OR.Save.load();

  check('a fresh save owns only the starter car and track',
    OR.Save.unlockedCars().join(',') === 'relay' &&
    OR.Save.unlockedTracks().join(',') === 'flexnode',
    'cars ' + OR.Save.unlockedCars().join(',') + ' · tracks ' + OR.Save.unlockedTracks().join(','));

  check('the locked list is the other three cars',
    OR.Cars.lockedIds().join(',') === 'validator,shard,flexnode');

  check('selecting a locked car changes nothing',
    OR.Cars.select('flexnode') === null &&
    OR.Save.car() === null && OR.Cars.activeId() === 'relay',
    'active ' + OR.Cars.activeId());

  check('a locked car is refused by the save too',
    OR.Save.setCar('validator') === null &&
    OR.Save.car() === null);

  check('an unknown car id is refused as well',
    OR.Cars.select('hovercraft') === null && OR.Cars.has('hovercraft') === false);

  check('an unlocked car can be selected and is saved',
    OR.Cars.select('relay') === 'relay' && OR.Save.car() === 'relay' &&
    OR.Cars.activeId() === 'relay');
}

/* ======================= 4. unlocking at the right level ================== */

section('unlocks happen at the right level, exactly once');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  OR.Save.load();

  check('a level 1 player has nothing new to grant',
    OR.Cars.sync(1).any === false);

  const level3 = OR.Cars.sync(3);
  check('level 3 unlocks the validator and mesh highway',
    level3.cars.join(',') === 'validator' && level3.tracks.join(',') === 'mesh-highway' &&
    level3.names.join(',') === 'VALIDATOR,MESH HIGHWAY',
    level3.names.join(' + '));

  check('calling sync again reports nothing new',
    OR.Cars.sync(3).any === false);

  const level5 = OR.Cars.sync(5);
  check('level 5 unlocks the shard speedway',
    level5.tracks.join(',') === 'shard-speedway' &&
    OR.Save.unlockedTracks().indexOf('shard-speedway') !== -1,
    level5.tracks.join(','));

  const level6 = OR.Cars.sync(6);
  check('level 6 unlocks the shard car',
    level6.cars.join(',') === 'shard' && OR.Save.unlockedCars().join(',') ===
      'relay,validator,shard');

  const level10 = OR.Cars.sync(10);
  check('level 10 unlocks the flexnode car — and then everything is open',
    level10.cars.join(',') === 'flexnode' &&
    OR.Save.unlockedCars().length === 4 &&
    OR.Cars.lockedIds().length === 0 &&
    OR.Save.unlockedTracks().length === 3,
    OR.Save.unlockedCars().join(',') + ' · ' + OR.Save.unlockedTracks().join(','));

  check('the next-unlock hint names the closest locked item',
    (function () {
      const fresh = boot(fakeStorage());
      fresh.Save.load();
      return fresh.Cars.nextUnlock(1).id === 'mesh-highway' &&
        fresh.Cars.nextUnlock(1).level === 2 && fresh.Cars.nextUnlock(1).kind === 'track' &&
        fresh.Cars.nextUnlock(4).id === 'shard-speedway' &&
        fresh.Cars.nextUnlock(4).levelsAway === 1 &&
        fresh.Cars.nextUnlock(9).id === 'flexnode' && fresh.Cars.nextUnlock(9).levelsAway === 1 &&
        fresh.Cars.sync(10) && fresh.Cars.nextUnlock(10) === null;
    })());

  check('quickest of all: every level from 1 to 10 grants the right set',
    (function () {
      const fresh = boot(fakeStorage());
      fresh.Save.load();
      let mismatches = 0;
      for (let level = 1; level <= 10; level++) {
        const granted = fresh.Cars.sync(level);
        fresh.Save.unlockedCars().forEach(function (id) {
          if (fresh.Cars.unlockLevel(id) > level) mismatches++;
        });
        granted.cars.concat(granted.tracks).forEach(function (id) {
          const table = fresh.CONFIG.unlocks.cars[id] ? fresh.CONFIG.unlocks.cars
            : fresh.CONFIG.unlocks.tracks;
          if (table[id] > level) mismatches++;
        });
      }
      return mismatches === 0;
    })());
}

/* ===================== 5. persistence of the choice ====================== */

section('the chosen car persists');
{
  const storage = fakeStorage();
  const first = boot(storage);
  first.Save.load();
  first.Cars.sync(6);
  first.Cars.select('shard');

  check('shard is saved along with the physics',
    first.Save.car() === 'shard' && first.CONFIG.car.maxSpeed === 900 * 0.95,
    'maxSpeed ' + first.CONFIG.car.maxSpeed.toFixed(1));

  /* Reload: a brand-new context on the same storage. */
  const second = boot(storage);
  second.Save.load();
  second.Cars.apply(second.Cars.activeId());

  check('a reload comes back with the same car and the same physics',
    second.Cars.activeId() === 'shard' &&
    second.CONFIG.car.maxSpeed === 900 * 0.95 &&
    second.CONFIG.car.turnRateLow === 3.0 * 1.10,
    'active ' + second.Cars.activeId());

  check('selection survives even before apply() is called',
    second.Save.car() === 'shard');

  /* A tampered save: the car is in the selection but not unlocked. */
  const tampered = fakeStorage();
  const raw = {
    version: 3,
    profile: { name: 'Cheat', color: 'violet' },
    stats: { races: 1, wins: 0, podiums: 0, totalTimeMs: 1000 },
    progress: { xp: 0, level: 1 },
    unlocks: { cars: ['relay'], tracks: ['flexnode'] },
    bests: {},
    selection: { track: 'flexnode', difficulty: 'normal', car: 'flexnode' }
  };
  tampered.data['optimumRace.save.v1'] = JSON.stringify(raw);
  const third = boot(tampered);
  check('a save that names a car it does not own falls back to the starter',
    third.Save.car() === null && third.Cars.activeId() === 'relay',
    'active ' + third.Cars.activeId());
}

/* ===================== 6. the version 2 -> 3 migration =================== */

section('saves from before Step 11 migrate without losing anything');
{
  /* A level 1 player who raced every track (they could, before Step 11). */
  const storage = v2Save({
    bests: {
      flexnode: { normal: { timeMs: 42000, lapMs: 14000 } },
      'mesh-highway': { hard: { timeMs: 90000, lapMs: 44000 } },
      'shard-speedway': { easy: { timeMs: 51000, lapMs: 17000 } }
    },
    selection: { track: 'shard-speedway', difficulty: 'hard' }
  });
  const OR = boot(storage);
  const upgraded = JSON.parse(storage.data['optimumRace.save.v1']);

  check('the save is upgraded to the current version on load',
    OR.Save.VERSION >= 4 && OR.Save.load().version === OR.Save.VERSION &&
    upgraded.version === OR.Save.VERSION,
    'version ' + upgraded.version);

  check('every track they had a time on stays unlocked (never locked out)',
    OR.Save.unlockedTracks().indexOf('mesh-highway') !== -1 &&
    OR.Save.unlockedTracks().indexOf('shard-speedway') !== -1 &&
    OR.Save.unlockedTracks().indexOf('flexnode') !== -1,
    OR.Save.unlockedTracks().join(','));

  check('and the track that was selected stays unlocked too',
    OR.Save.selection().track === 'shard-speedway' &&
    OR.Cars.trackUnlocked('shard-speedway'));

  check('cars they had not earned are still locked',
    OR.Save.unlockedCars().join(',') === 'relay' &&
    OR.Cars.select('validator') === null,
    OR.Save.unlockedCars().join(','));

  check('nothing else was lost in the migration',
    OR.Save.profile().name === 'Veteran' && OR.Save.stats().races === 12 &&
    OR.Bests.bestTime('mesh-highway', 'hard') === 90000 &&
    OR.Save.selection().difficulty === 'hard' &&
    OR.Save.xp() === 0);

  check('everyone keeps the car they were driving (the only one that existed)',
    OR.Save.unlockedCars().indexOf('relay') !== -1 &&
    OR.Cars.activeId() === 'relay');
}

section('a high-level save migrates with the right unlocks');
{
  /* Level 6 player: 100 x 6^1.5 = 1470 XP on the Step 10 curve. */
  const stats = v2Save({ progress: { xp: 1470, level: 6 } });
  const OR = boot(stats);
  OR.Save.load();

  check('a level 6 player keeps validator and shard, not flexnode',
    OR.Save.unlockedCars().join(',') === 'relay,validator,shard' &&
    OR.Cars.select('flexnode') === null,
    OR.Save.unlockedCars().join(','));

  check('level 6 also unlocks mesh highway and shard speedway (L5)',
    OR.Save.unlockedTracks().indexOf('mesh-highway') !== -1 &&
    OR.Save.unlockedTracks().indexOf('shard-speedway') !== -1);

  check('the level itself was not changed by the migration',
    OR.Save.level() === 6 && OR.Save.xp() === 1470);

  /* A version 1 save must walk the whole chain: 1 -> 2 -> 3. */
  const old = fakeStorage();
  old.data['optimumRace.save.v1'] = JSON.stringify({
    version: 1,
    profile: { name: 'Ancient', color: 'mint' },
    stats: { races: 3, wins: 1, podiums: 1, totalTimeMs: 120000 },
    bests: { flexnode: { normal: { timeMs: 41000, lapMs: 13000 } } },
    selection: { track: 'flexnode', difficulty: 'normal' }
  });
  const chain = boot(old);
  const chained = JSON.parse(old.data['optimumRace.save.v1']);

  check('a version 1 save walks the whole chain to the current version',
    chain.Save.load().version === OR.Save.VERSION && chained.version === OR.Save.VERSION &&
    chain.Save.profile().name === 'Ancient' &&
    chain.Save.stats().races === 3 &&
    chain.Bests.bestTime('flexnode', 'normal') === 41000 &&
    chain.Save.unlockedTracks().indexOf('flexnode') !== -1,
    'version ' + chained.version);
}

/* ================== 7. corruption, export/import, reset ================== */

section('junk data, export/import and reset');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  OR.Save.load();
  OR.Cars.sync(3);
  OR.Cars.select('validator');

  /* Corrupt unlock data cannot break the game or lock the starter out. */
  const bad = JSON.parse(storage.data['optimumRace.save.v1']);
  bad.unlocks = { cars: ['validator', 'not-a-car', 'validator'], tracks: 'nope' };
  storage.data['optimumRace.save.v1'] = JSON.stringify(bad);
  const corrupt = boot(storage);
  const healed = corrupt.Save.load();

  check('junk in the unlock list is dropped, duplicates collapse, the starter stays',
    healed.unlocks.cars.join(',') === 'relay,validator' &&
    healed.unlocks.tracks.join(',') === 'flexnode',
    'cars ' + healed.unlocks.cars.join(',') + ' · tracks ' + healed.unlocks.tracks.join(','));

  check('a car that is not owned is never selected by corrupt data',
    corrupt.Save.car() === null || corrupt.Save.unlockedCars().indexOf(corrupt.Save.car()) !== -1);

  /* Export/import round trip keeps the garage. */
  const exported = OR.Save.export();
  const other = boot(fakeStorage());
  other.Save.load();
  const result = other.Save.import(exported);

  check('export and import carry the unlocks and the chosen car',
    result.ok && other.Save.unlockedCars().join(',') === 'relay,validator' &&
    other.Save.car() === 'validator' &&
    other.Cars.activeId() === 'validator',
    other.Save.unlockedCars().join(',') + ' · car ' + other.Save.car());

  /* Reset goes back to the starter. */
  OR.Save.reset();
  check('reset clears unlocks and the chosen car back to the start',
    OR.Save.unlockedCars().join(',') === 'relay' &&
    OR.Save.unlockedTracks().join(',') === 'flexnode' &&
    OR.Save.car() === null && OR.Save.selection().track === null,
    OR.Save.unlockedCars().join(',') + ' · ' + OR.Save.unlockedTracks().join(','));

  check('reset keeps the profile but clears the level',
    OR.Save.profile().name === OR.CONFIG.profile.defaultName && OR.Save.level() === 1,
    OR.Save.profile().name);
}

/* ===================== 8. locked tracks are unraceable ==================== */

section('locked tracks cannot be raced');
{
  const OR = boot(fakeStorage());
  OR.Save.load();

  check('level 1 can race flexnode only',
    OR.Cars.trackUnlocked('flexnode') === true &&
    OR.Cars.trackLocked('mesh-highway') === true &&
    OR.Cars.trackLocked('shard-speedway') === true);

  check('the first unlocked track is the starter circuit',
    OR.Cars.firstUnlockedTrack().id === 'flexnode');

  /* Move the live track onto something locked, the way a stale save would. */
  OR.Track.use(OR.trackById('shard-speedway'));
  check('the live track really is the locked one', OR.Track.id === 'shard-speedway');

  const moved = OR.Cars.ensureTrack();
  check('ensureTrack() moves a locked selection to the first unlocked circuit',
    moved && moved.id === 'flexnode' && OR.Track.id === 'flexnode',
    'now on ' + OR.Track.id);

  /* With no TrackSelect in this context, ensureTrack still fixes the track. */
  OR.Track.use(OR.trackById('mesh-highway'));
  OR.Cars.ensureTrack();
  check('and it works without the track select screen loaded', OR.Track.id === 'flexnode');

  /* After unlocking, the track is legal again. */
  OR.Cars.sync(5);
  check('once unlocked, the speedway can be selected',
    OR.Cars.trackUnlocked('shard-speedway') &&
    OR.TrackSelect === undefined && OR.Cars.ensureTrack() === null);
}

/* =============================== summary ================================== */

console.log('\n' + '-'.repeat(56));
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
