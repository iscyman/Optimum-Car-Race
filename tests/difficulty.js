/* =============================================================================
 * tests/difficulty.js — Step 7 checks that need no DOM and no browser.
 *
 * Run: node tests/difficulty.js
 * Covers: the config object, selection persistence (including a simulated
 * reload and blocked localStorage), best time per difficulty, the effect of a
 * level on the rivals, rubber banding caps, and a balance sanity check that a
 * decent player beats EASY often, NORMAL about half the time and HARD rarely.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['config', 'utils', 'trackdata', 'track', 'car', 'race', 'difficulty', 'bests', 'rivals', 'collisions', 'standings'];
const STEP = 1 / 120;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
function section(name) { console.log('\nStep 7 — ' + name); }

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

const OR = boot(fakeStorage());
const { CONFIG, Utils, Track, Car, Race, Rivals, Collisions, Standings, Difficulty } = OR;
const D = CONFIG.difficulty;

section('config object');
check('three selectable levels: EASY, NORMAL, HARD',
  D.levels.map(l => l.id).join(',') === 'easy,normal,hard' &&
  D.levels.map(l => l.label).join(',') === 'EASY,NORMAL,HARD',
  D.levels.map(l => l.label).join(' / '));
check('every level carries all five required settings', D.levels.every(l =>
  typeof l.rivalSpeed === 'number' && typeof l.cornerSkill === 'number' &&
  typeof l.stallIntervalScale === 'number' && typeof l.stallDurationScale === 'number' &&
  typeof l.rubberBand === 'number' && typeof l.blurb === 'string' && l.blurb.length > 10));
check('levels get harder in order (speed and corner skill rise)',
  D.levels[0].rivalSpeed < D.levels[1].rivalSpeed && D.levels[1].rivalSpeed < D.levels[2].rivalSpeed &&
  D.levels[0].cornerSkill < D.levels[1].cornerSkill && D.levels[1].cornerSkill < D.levels[2].cornerSkill,
  D.levels.map(l => l.rivalSpeed + '/' + l.cornerSkill).join('  '));
check('HARD stalls are rarer and shorter than EASY stalls',
  D.levels[2].stallIntervalScale > D.levels[0].stallIntervalScale &&
  D.levels[2].stallDurationScale < D.levels[0].stallDurationScale,
  'interval ×' + D.levels[0].stallIntervalScale + '→×' + D.levels[2].stallIntervalScale +
  ', duration ×' + D.levels[0].stallDurationScale + '→×' + D.levels[2].stallDurationScale);
check('rubber banding has explicit caps', CONFIG.rivals.rubberBand.easeMax > 0 &&
  CONFIG.rivals.rubberBand.easeMax <= 0.2 && CONFIG.rivals.rubberBand.pushMax <= 0.25 &&
  CONFIG.rivals.rubberBand.fullGapLaps > CONFIG.rivals.rubberBand.deadZoneLaps);

section('selection persistence');
{
  const storage = fakeStorage();
  const first = boot(storage);
  check('a fresh install preselects the documented default',
    first.Difficulty.currentId() === D.default, first.Difficulty.currentId());
  first.Difficulty.select('hard');
  check('the choice is written to localStorage',
    storage.data[D.keys.selection] === 'hard', String(storage.data[D.keys.selection]));
  const reloaded = boot(storage);
  check('a reload preselects the saved level',
    reloaded.Difficulty.currentId() === 'hard' && reloaded.Difficulty.current().label === 'HARD');
  reloaded.Difficulty.select('bogus-level');
  check('selecting an unknown level keeps the current one and stores nothing new',
    reloaded.Difficulty.currentId() === 'hard' && storage.data[D.keys.selection] === 'hard',
    reloaded.Difficulty.currentId());
  storage.data[D.keys.selection] = 'a-level-from-the-future';
  check('an unknown saved value falls back to the default',
    boot(storage).Difficulty.currentId() === D.default);
  storage.data[D.keys.selection] = '{{{ not json';
  check('corrupt selection data does not break the game',
    boot(storage).Difficulty.currentId() === D.default);
}

section('blocked localStorage');
{
  const context = { console, Math, Map };
  context.window = context;
  Object.defineProperty(context, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage is blocked (private mode)'); }
  });
  vm.createContext(context);
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), context, { filename: file });
  }
  const blocked = context.OR.Difficulty;
  check('reading the saved level does not throw', (() => {
    try { blocked.load(); return true; } catch (error) { return false; }
  })(), blocked.currentId());
  check('selecting a level does not throw', (() => {
    try { blocked.select('hard'); return true; } catch (error) { return false; }
  })(), blocked.currentId());
  check('the selected level still applies for this session', blocked.currentId() === 'hard');
  let recorded = null;
  try { recorded = blocked.recordBest('hard', 39123); } catch (error) { recorded = null; }
  check('best times still work in memory', recorded && recorded.isNewBest &&
    recorded.bestMs === 39123 && blocked.best('hard') === 39123, JSON.stringify(recorded));
  check('best text still renders', /Best on Hard/.test(blocked.bestText('hard')), blocked.bestText('hard'));
}

section('best time per difficulty');
{
  const storage = fakeStorage();
  const game = boot(storage);
  const diff = game.Difficulty;
  const first = diff.recordBest('normal', 41200);
  check('a first finish becomes the best', first.isNewBest && first.bestMs === 41200 && first.previousMs === 0);
  const slower = diff.recordBest('normal', 43000);
  check('a slower finish does not replace it',
    !slower.isNewBest && slower.bestMs === 41200 && slower.previousMs === 41200);
  const faster = diff.recordBest('normal', 38900);
  check('a faster finish does replace it',
    faster.isNewBest && faster.bestMs === 38900 && faster.previousMs === 41200);
  check('best times are kept per difficulty',
    diff.best('normal') === 38900 && diff.best('easy') === 0 && diff.best('hard') === 0);
  diff.recordBest('easy', 47000);
  diff.recordBest('hard', 36500);
  check('each difficulty keeps its own record',
    diff.best('easy') === 47000 && diff.best('normal') === 38900 && diff.best('hard') === 36500);
  const reloaded = boot(storage);
  check('best times survive a reload',
    reloaded.Difficulty.best('normal') === 38900 && reloaded.Difficulty.best('hard') === 36500);
  check('best text names the difficulty, e.g. "Best on Normal"',
    /^Best on Normal /.test(diff.bestText('normal')) &&
    diff.bestText('normal') === 'Best on Normal ' + game.Utils.formatTime(38900),
    diff.bestText('normal'));
  check('an empty record reads sensibly', /^No Easy time yet/.test(boot(fakeStorage()).Difficulty.bestText('easy')));
}

section('the level reaches the rivals');
{
  function rivalsFor(levelId) {
    const game = boot(fakeStorage());
    const player = new game.Car();
    player.race = game.Race;
    game.Rivals.reset(player, 4242, game.Difficulty.get(levelId));
    return game;
  }
  const easy = rivalsFor('easy');
  const hard = rivalsFor('hard');
  const easyCar = easy.Rivals.items[0];
  const hardCar = hard.Rivals.items[0];
  check('the race remembers which level it started at',
    easy.Rivals.difficulty.id === 'easy' && easyCar.ai.level === 'easy' &&
    hardCar.ai.level === 'hard');
  check('top speed multiplier is the roster profile × the level',
    Math.abs(easyCar.baseTopSpeedMultiplier -
      CONFIG.rivals.roster[0].speed * CONFIG.difficulty.levels[0].rivalSpeed) < 1e-9 &&
    Math.abs(hardCar.baseTopSpeedMultiplier -
      CONFIG.rivals.roster[0].speed * CONFIG.difficulty.levels[2].rivalSpeed) < 1e-9,
    easyCar.baseTopSpeedMultiplier.toFixed(3) + ' vs ' + hardCar.baseTopSpeedMultiplier.toFixed(3));
  check('HARD rivals corner better and start faster than EASY rivals',
    hardCar.ai.skill > easyCar.ai.skill &&
    hardCar.baseTopSpeedMultiplier > easyCar.baseTopSpeedMultiplier,
    'skill ' + easyCar.ai.skill.toFixed(2) + ' → ' + hardCar.ai.skill.toFixed(2));
  check('stall frequency and duration follow the level',
    easyCar.ai.stallIntervalMin < hardCar.ai.stallIntervalMin &&
    easyCar.ai.stallDurationMax > hardCar.ai.stallDurationMax,
    'EASY every ' + easyCar.ai.stallIntervalMin.toFixed(1) + 's for up to ' +
    easyCar.ai.stallDurationMax.toFixed(2) + 's; HARD every ' +
    hardCar.ai.stallIntervalMin.toFixed(1) + 's for up to ' + hardCar.ai.stallDurationMax.toFixed(2) + 's');
  check('the roster profile stays the base for the whole race',
    easyCar.ai.baseSkill === CONFIG.rivals.roster[0].skill &&
    easyCar.ai.lane === CONFIG.rivals.roster[0].lane);
}

section('rubber banding');
{
  const game = boot(fakeStorage());
  const player = new game.Car();
  player.race = game.Race;
  game.Rivals.reset(player, 99, game.Difficulty.get('normal'));
  game.Race.reset(player);
  const rival = game.Rivals.items[0];
  const caps = CONFIG.rivals.rubberBand;

  rival.race.progress = player.race.progress = 0;
  game.Race.progress = player.race.progress;
  check('no assist inside the dead zone', game.Rivals.rubberBandFactor(rival) === 1,
    'gap 0 laps');

  player.race.progress = 0;
  rival.race.progress = caps.fullGapLaps + 0.5;
  const ahead = game.Rivals.rubberBandFactor(rival);
  check('a leader far ahead eases off, capped', ahead < 1 &&
    ahead >= 1 - caps.easeMax - 1e-9, ahead.toFixed(4) + ' at +' +
    (rival.race.progress - player.race.progress).toFixed(2) + ' laps');

  rival.race.progress = -0.55;
  player.race.progress = 0.55;
  const behind = game.Rivals.rubberBandFactor(rival);
  check('a rival far behind pushes, capped', behind > 1 &&
    behind <= 1 + caps.pushMax + 1e-9, behind.toFixed(4) + ' at -' +
    (player.race.progress - rival.race.progress).toFixed(2) + ' laps');

  rival.race.progress = player.race.progress + 0.2;
  const gentle = game.Rivals.rubberBandFactor(rival);
  check('help arrives gradually, not as a step', gentle < 1 && gentle > ahead,
    gentle.toFixed(4) + ' at +0.20 laps vs ' + ahead.toFixed(4) + ' at +' + caps.fullGapLaps.toFixed(2));

  rival.ai.rubberBand = 0;
  check('a level with no assist returns exactly 1', game.Rivals.rubberBandFactor(rival) === 1);
  rival.ai.rubberBand = 1;
  rival.race.finished = true;
  check('finished rivals are not assisted', game.Rivals.rubberBandFactor(rival) === 1);
  rival.race.finished = false;
  game.Race.finished = true;
  check('assist stops once the player has finished', game.Rivals.rubberBandFactor(rival) === 1);
  game.Race.finished = false;

  rival.race.progress = rival.race.progress + 0.4;
  game.Rivals._think(rival);
  const ratio = rival.topSpeedMultiplier / rival.baseTopSpeedMultiplier;
  check('the live top speed carries the capped band factor',
    ratio >= 1 - caps.easeMax - 1e-9 && ratio <= 1 + caps.pushMax + 1e-9 && ratio < 1,
    'ratio ' + ratio.toFixed(4));
}

section('each difficulty feels different (AI-only pace)');
{
  const paces = {};
  for (const id of ['easy', 'normal', 'hard']) {
    const game = boot(fakeStorage());
    const player = new game.Car();
    player.race = game.Race;
    game.Rivals.reset(player, 31, game.Difficulty.get(id));
    game.Race.reset(player);
    let time = 0;
    for (let i = 0; i < 120 * 90; i++) {
      time += STEP;
      game.Rivals.update(STEP);
      game.Rivals.score(time * 1000);
      if (game.Rivals.items.every(car => car.race.finished)) break;
    }
    paces[id] = game.Rivals.items.map(car => car.race.finishTimeMs / 1000);
  }
  const avg = id => paces[id].reduce((a, b) => a + b, 0) / paces[id].length;
  check('all three levels complete the race', Object.keys(paces).every(id =>
    paces[id].every(ms => ms > 0)), ['easy', 'normal', 'hard']
    .map(id => id + ' ' + avg(id).toFixed(1) + 's').join(', '));
  check('EASY rivals are clearly slower than NORMAL, and NORMAL slower than HARD',
    avg('easy') > avg('normal') + 2 && avg('normal') > avg('hard') + 0.5,
    'easy ' + avg('easy').toFixed(1) + 's > normal ' + avg('normal').toFixed(1) +
    's > hard ' + avg('hard').toFixed(1) + 's');
}

section('balance target (reference decent player, no boost)');
{
  const RACES = 6;
  const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
  const results = {};
  for (const id of ['easy', 'normal', 'hard']) {
    let wins = 0;
    const margins = [];
    for (let seed = 1; seed <= RACES; seed++) {
      const game = boot(fakeStorage());
      const player = new game.Car();
      player.race = game.Race;
      const random = game.Utils.mulberry32((seed * 7919) >>> 0);
      const aim = 240 + random() * 70;
      const lift = 800 + random() * 100;
      game.Rivals.reset(player, seed * 7919, game.Difficulty.get(id));
      game.Race.reset(player);
      game.Collisions.reset();
      const cars = [player].concat(game.Rivals.items);
      game.Standings.reset(cars);
      for (let i = 0; i < 120 * 120; i++) {
        const time = (i + 1) * STEP;
        if (!player.race.finished) {
          const ahead = game.Track.pointAhead(player.x, player.y, aim, player.trackHint);
          const want = Math.atan2(ahead.x - player.x, -(ahead.y - player.y));
          player.update(STEP, {
            steer: game.Utils.clamp(angle(want - player.heading) * 4.2 - player.slip * 0.7, -1, 1),
            throttle: player.speed < lift, brake: false
          });
        }
        game.Rivals.update(STEP);
        game.Collisions.resolve(cars, STEP);
        game.Rivals.score(time * 1000);
        if (!player.race.finished) game.Race.update(player, time * 1000);
        game.Standings.update();
        if (cars.every(car => car.race.finished)) break;
      }
      if (game.Standings.playerPlace === 1 && player.race.finished) wins++;
      margins.push((player.race.finishTimeMs -
        Math.min.apply(null, game.Rivals.items.map(car => car.race.finishTimeMs))) / 1000);
    }
    results[id] = { wins, rate: wins / RACES, margin: margins.reduce((a, b) => a + b, 0) / RACES };
  }
  check('EASY is won most of the time', results.easy.rate >= 0.7,
    results.easy.wins + '/' + RACES);
  check('NORMAL is a real contest, not a formality', results.normal.rate <= 0.9,
    results.normal.wins + '/' + RACES);
  check('HARD is rarely won, but it is possible', results.hard.rate <= 0.5,
    results.hard.wins + '/' + RACES);
  check('the order of difficulty is respected',
    results.easy.rate >= results.normal.rate && results.normal.rate >= results.hard.rate,
    ['easy', 'normal', 'hard'].map(id => id + ' ' + Math.round(results[id].rate * 100) + '%').join('  '));
  console.log('      (6-race sample; `node tools/balance.js 28` gives the full table)');
}

section('difficulty × track (Step 8)');
{
  const storage = fakeStorage();
  const game = boot(storage);
  const diff = game.Difficulty;

  /* Picking a circuit must not touch the rival level. */
  diff.select('hard');
  game.Track.use(game.trackById('mesh-highway'));
  check('selecting a track does not change the difficulty',
    diff.currentId() === 'hard' && diff.current().label === 'HARD' &&
    game.activeTrack.id === 'mesh-highway',
    diff.currentId() + ' on ' + game.activeTrack.id);

  /* The same level keeps its own record on each circuit. */
  game.Bests.record('mesh-highway', 'hard', { timeMs: 45000, lapMs: 22000 });
  game.Bests.record('shard-speedway', 'hard', { timeMs: 52000, lapMs: 17000 });
  game.Bests.record('mesh-highway', 'easy', { timeMs: 49000, lapMs: 24000 });
  check('the same difficulty keeps a separate record per track',
    game.Bests.bestTime('mesh-highway', 'hard') === 45000 &&
    game.Bests.bestTime('shard-speedway', 'hard') === 52000 &&
    game.Bests.bestTime('flexnode', 'hard') === 0 &&
    game.Bests.bestTime('mesh-highway', 'easy') === 49000,
    'hard: mesh ' + game.Bests.bestTime('mesh-highway', 'hard') +
    ', shard ' + game.Bests.bestTime('shard-speedway', 'hard') +
    '; easy: mesh ' + game.Bests.bestTime('mesh-highway', 'easy'));

  /* Time and best lap are two records, not one. */
  game.Bests.record('mesh-highway', 'hard', { timeMs: 47000, lapMs: 21000 });
  check('time and best lap are tracked separately',
    game.Bests.bestTime('mesh-highway', 'hard') === 45000 &&
    game.Bests.bestLap('mesh-highway', 'hard') === 21000,
    game.Utils.formatTime(game.Bests.bestTime('mesh-highway', 'hard')) + ' / ' +
    game.Utils.formatTime(game.Bests.bestLap('mesh-highway', 'hard')));

  /* Step 7 stored flat records with no track: they belong to FLEXNODE. */
  const legacy = fakeStorage();
  legacy.data[D.keys.best] = JSON.stringify({ hard: 36500, normal: 38900 });
  const migrated = boot(legacy);
  check('Step 7 flat records migrate to FLEXNODE',
    migrated.Bests.bestTime('flexnode', 'hard') === 36500 &&
    migrated.Bests.bestTime('flexnode', 'normal') === 38900 &&
    migrated.Bests.bestTime('mesh-highway', 'hard') === 0,
    migrated.Bests.timeText('flexnode', 'hard'));
}

console.log('\n' + '-'.repeat(56));
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
