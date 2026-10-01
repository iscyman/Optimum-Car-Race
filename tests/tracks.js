/* =============================================================================
 * tests/tracks.js — Step 8 checks that need no DOM and no browser.
 *
 * Run: node tests/tracks.js
 * Covers: the three tracks' data, the geometry they build, a full AI race on
 * each of them, the per-track race rules (laps, checkpoints, shards), track
 * previews matching the real circuit, and the per-track/per-difficulty records.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['config', 'utils', 'xp', 'trackdata', 'track', 'car', 'race', 'save', 'cars', 'events', 'difficulty',
  'bests', 'rivals', 'collisions', 'standings', 'shards'];
const STEP = 1 / 120;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
function section(name) { console.log('\nStep 8 — ' + name); }

/** A fresh page load with the given storage, exactly like the browser does. */
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

const SCHEMA = ['id', 'name', 'subtitle', 'blurb', 'points', 'roadWidth', 'kerbWidth',
  'grassMargin', 'rowStep', 'startIndex', 'checkpointFractions', 'laps', 'shards',
  'scenery', 'corners', 'rating'];

/* ============================ 1. track data =============================== */

section('the track catalogue');
{
  const OR = boot(fakeStorage());
  const tracks = OR.TRACKS;

  check('three tracks share one data schema',
    tracks.length === 3 && tracks.every(t => SCHEMA.every(key =>
      Object.prototype.hasOwnProperty.call(t, key))),
    tracks.map(t => t.id).join(', '));

  check('the documented circuits are present',
    tracks.map(t => t.id).join(',') === 'flexnode,mesh-highway,shard-speedway' &&
    tracks.map(t => t.name).join(',') === 'FLEXNODE CIRCUIT,MESH HIGHWAY,SHARD SPEEDWAY',
    tracks.map(t => t.name).join(' / '));

  check('every track carries a rating, a subtitle and a blurb',
    tracks.every(t => t.rating >= 1 && t.rating <= 3 &&
      t.subtitle.length > 10 && t.blurb.length > 20),
    tracks.map(t => t.id + ' ' + t.rating).join(', '));

  check('checkpoints are ordered fractions inside the lap',
    tracks.every(t => t.checkpointFractions.length >= 3 &&
      t.checkpointFractions.every((f, i) =>
        f > 0 && f < 1 && (i === 0 || f > t.checkpointFractions[i - 1]))),
    tracks.map(t => t.checkpointFractions.length + ' gates').join(', '));

  check('laps, pickups and scenery are defined per track in the data',
    tracks.every(t => t.laps >= 1 && t.shards.count >= 1 &&
      t.shards.count === Math.round(t.shards.count) &&
      t.shards.laneSpread > 0 && t.shards.laneSpread <= 1 &&
      t.shards.startClear > 0 && t.shards.endClear > 0 &&
      t.scenery.seed > 0 && t.scenery.types.length > 0),
    tracks.map(t => t.laps + ' laps/' + t.shards.count + ' shards').join(', '));

  check('the three circuits are genuinely different',
    new Set(tracks.map(t => t.points.length)).size === 3 &&
    Math.max(...tracks.map(t => t.roadWidth)) - Math.min(...tracks.map(t => t.roadWidth)) > 100,
    tracks.map(t => t.points.length + ' pts, ' + t.roadWidth + ' wide').join(' | '));

  check('corner names are present and inside the lap',
    tracks.every(t => t.corners.length >= 6 && t.corners.every(c =>
      typeof c.name === 'string' && c.name.length > 0 &&
      c.at > 0 && c.at < 1 && c.radius > 0)),
    tracks.map(t => t.corners.length + ' corners').join(', '));
}

/* ============================ 2. geometry ================================= */

section('geometry built from the data');
{
  const OR = boot(fakeStorage());
  const { Track } = OR;

  OR.TRACKS.forEach(track => {
    const measured = Track.measure(track);
    Track.use(track);
    check('[' + track.id + '] builds the measured lap length',
      Track.id === track.id && Math.abs(Track.length - measured.total) < 1e-9,
      Math.round(Track.length / 10) + ' m');

    /* The grid sits behind the line, so both have to be on the asphalt. */
    const behind = Track.pointAt(Track.start.s - 420);
    check('[' + track.id + '] start line and grid row sit on the road',
      Math.abs(Track.nearest(Track.start.x, Track.start.y).offset) < 1 &&
      Track.surfaceAt(Track.nearest(behind.x, behind.y).offset) === 'road',
      'line at ' + Math.round(Track.start.x) + ',' + Math.round(Track.start.y));

    /* Fractions are relative to the start line, not to arc length 0 — the
       bug that made MESH HIGHWAY rivals lap forever in development. */
    const offs = Track.checkpoints.map(cp =>
      Math.abs(Track.nearest(cp.x, cp.y, null).offset));
    check('[' + track.id + '] checkpoints sit on the start-relative fractions',
      Track.checkpoints.length === track.checkpointFractions.length &&
      offs.every(o => o < 1) &&
      Track.checkpoints.every((cp, i) => i === 0 || cp.fraction > Track.checkpoints[i - 1].fraction),
      Track.checkpoints.map(cp => Math.round(cp.fraction * 100) + '%').join(' -> '));
  });
}

/* ======================= 3. every track is completable ==================== */

section('a full AI race on every circuit');
{
  const OR = boot(fakeStorage());
  const results = {};
  OR.TRACKS.forEach(track => {
    const game = boot(fakeStorage());
    game.Track.use(track);
    game.Shards.reset();
    const player = new game.Car();
    player.race = game.Race;
    game.Rivals.reset(player, 4242, game.Difficulty.get('normal'));
    game.Race.reset(player);
    /* `checkpointsPassed` resets every lap, so watch the live gate counter:
       the highest gate each car reached on each of its laps. */
    const gatePeak = game.Rivals.items.map(() => []);
    let time = 0;
    for (let i = 0; i < 120 * 180; i++) {
      time += STEP;
      game.Rivals.update(STEP);
      game.Rivals.score(time * 1000);
      game.Rivals.items.forEach((car, index) => {
        const lap = Math.max(1, car.race.lap) - 1;
        gatePeak[index][lap] = Math.max(gatePeak[index][lap] || 0, car.race.nextCheckpoint);
      });
      if (game.Rivals.items.every(car => car.race.finished)) break;
    }
    results[track.id] = { game, cars: game.Rivals.items, time, gatePeak };
  });

  check('all three circuits are completable with rivals',
    OR.TRACKS.every(track => results[track.id].cars.every(car => {
      const ms = car.race.finishTimeMs / 1000;
      return car.race.finished && ms > 5 && ms < 180;
    })),
    OR.TRACKS.map(track => {
      const times = results[track.id].cars.map(car => (car.race.finishTimeMs / 1000).toFixed(1) + 's');
      return track.id + ' ' + times.join('/');
    }).join('  '));

  check('every rival scores the lap count of the track it raced',
    OR.TRACKS.every(track => results[track.id].cars.every(car =>
      car.race.lapTimes.length === results[track.id].game.Track.laps)),
    OR.TRACKS.map(track =>
      track.id + ' ' + results[track.id].game.Track.laps + ' laps').join(', '));

  check('nobody skips a checkpoint on the way round',
    OR.TRACKS.every(track => {
      const r = results[track.id];
      const gates = r.game.Track.checkpoints.length;
      return r.gatePeak.every(laps =>
        laps.length >= r.game.Track.laps &&
        laps.every(reached => reached === gates));
    }),
    OR.TRACKS.map(track => {
      const r = results[track.id];
      return track.id + ' ' + r.gatePeak.map(laps => laps.join('/')).join(' ');
    }).join('  '));
}

/* ======================= 4. per-track race rules ========================== */

section('laps, checkpoints and pickups come from the track');
{
  const game = boot(fakeStorage());
  const { Track, Race, Shards } = game;
  const player = new game.Car();
  player.race = Race;

  Track.use(game.trackById('mesh-highway'));
  Race.reset(player);
  check('the lap count follows the track data',
    Race.laps === 2 && Race.laps === Track.laps,
    'MESH HIGHWAY ' + Race.laps + ' laps');

  Track.use(game.trackById('shard-speedway'));
  Race.reset(player);
  check('switching track re-reads the lap count',
    Race.laps === 3 && Race.laps === Track.laps,
    'SHARD SPEEDWAY ' + Race.laps + ' laps');

  Shards.reset();
  const spec = game.trackById('shard-speedway').shards;
  check('the shard layout is the track\'s own',
    Shards.items.length === spec.count &&
    Shards.items.every(item => {
      const offset = Track.nearest(item.x, item.y, null).offset;
      return Math.abs(offset) <= Track.halfRoad;
    }),
    Shards.items.length + ' pickups');

  Track.use(game.trackById('flexnode'));
  Race.reset(player);
  Shards.reset();
  check('going back restores the original numbers exactly',
    Track.id === 'flexnode' && Track.checkpoints.length === 3 &&
    Race.laps === 3 && Shards.items.length === 14,
    'flexnode: ' + Race.laps + ' laps, ' + Track.checkpoints.length +
    ' gates, ' + Shards.items.length + ' shards');
}

/* ======================= 5. previews match the track ===================== */

section('the track-select preview is the real circuit');
{
  const game = boot(fakeStorage());
  const { Track } = game;
  const OR = game;

  OR.TRACKS.forEach(track => {
    const preview = Track.preview(track);
    Track.use(track);
    const built = Track.points;
    let worst = 0;
    preview.forEach(p => {
      let best = Infinity;
      for (let i = 0; i < built.length; i++) {
        const d = Math.hypot(built[i].x - p[0], built[i].y - p[1]);
        if (d < best) best = d;
      }
      if (best > worst) worst = best;
    });
    check('[' + track.id + '] every preview point sits on the built centreline',
      worst < 4 && preview.length > 40,
      'worst gap ' + worst.toFixed(2) + ' units over ' + preview.length + ' points');
  });
}

/* ======================= 6. records per track and difficulty ============== */

section('best time and best lap per track and difficulty');
{
  const storage = fakeStorage();
  const game = boot(storage);
  const { Bests } = game;

  const first = Bests.record('mesh-highway', 'normal', { timeMs: 47000, lapMs: 23000 });
  check('a finish stores the race time and the best lap',
    first.isNewTime && first.isNewLap &&
    first.timeMs === 47000 && first.lapMs === 23000,
    JSON.stringify({ timeMs: first.timeMs, lapMs: first.lapMs }));

  const slower = Bests.record('mesh-highway', 'normal', { timeMs: 48000, lapMs: 23500 });
  const faster = Bests.record('mesh-highway', 'normal', { timeMs: 46000, lapMs: 22500 });
  check('slower laps and times are ignored, faster ones replace',
    !slower.isNewTime && !slower.isNewLap && slower.timeMs === 47000 &&
    faster.isNewTime && faster.isNewLap &&
    Bests.bestTime('mesh-highway', 'normal') === 46000 &&
    Bests.bestLap('mesh-highway', 'normal') === 22500,
    'best ' + Bests.bestTime('mesh-highway', 'normal'));

  const lapOnly = Bests.record('mesh-highway', 'normal', { timeMs: 47000, lapMs: 22000 });
  check('a faster lap improves the lap record on its own',
    lapOnly.isNewLap && !lapOnly.isNewTime &&
    Bests.bestLap('mesh-highway', 'normal') === 22000 &&
    Bests.bestTime('mesh-highway', 'normal') === 46000);

  Bests.record('shard-speedway', 'normal', { timeMs: 52000, lapMs: 17000 });
  check('the same difficulty keeps separate records per track',
    Bests.bestTime('mesh-highway', 'normal') === 46000 &&
    Bests.bestTime('shard-speedway', 'normal') === 52000 &&
    Bests.bestTime('flexnode', 'normal') === 0,
    'mesh ' + Bests.bestTime('mesh-highway', 'normal') +
    ', shard ' + Bests.bestTime('shard-speedway', 'normal'));

  Bests.record('mesh-highway', 'hard', { timeMs: 44000, lapMs: 21500 });
  check('the same track keeps separate records per difficulty',
    Bests.bestTime('mesh-highway', 'hard') === 44000 &&
    Bests.bestTime('mesh-highway', 'easy') === 0 &&
    Bests.bestTime('mesh-highway', 'normal') === 46000,
    'hard ' + Bests.bestTime('mesh-highway', 'hard') +
    ', normal ' + Bests.bestTime('mesh-highway', 'normal'));

  const reloaded = boot(storage);
  check('records survive a reload',
    reloaded.Bests.bestTime('mesh-highway', 'normal') === 46000 &&
    reloaded.Bests.bestLap('mesh-highway', 'normal') === 22000 &&
    reloaded.Bests.bestTime('shard-speedway', 'normal') === 52000 &&
    reloaded.Bests.bestTime('mesh-highway', 'hard') === 44000);

  const legacy = fakeStorage();
  legacy.data[game.CONFIG.difficulty.keys.best] = JSON.stringify({ normal: 39999, hard: 37000 });
  const migrated = boot(legacy);
  check('a Step 7 flat record migrates to FLEXNODE',
    migrated.Bests.bestTime('flexnode', 'normal') === 39999 &&
    migrated.Bests.bestTime('flexnode', 'hard') === 37000 &&
    migrated.Bests.bestTime('mesh-highway', 'normal') === 0,
    'normal ' + migrated.Bests.bestTime('flexnode', 'normal'));
}

/* =============================== summary ================================== */

console.log('\n' + '-'.repeat(56));
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
