/* =============================================================================
 * tools/balance.js — Step 7 balance workbench (no browser needed).
 *
 * Runs the player against a fixed "decent player" autopilot across all three
 * difficulties and reports win rates, so the numbers in CONFIG.difficulty can
 * be tuned against the Step 7 target:
 *   EASY   the player wins most of the time
 *   NORMAL about half the time
 *   HARD   rarely, but possibly
 *
 *   node tools/balance.js [racesPerLevel]
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

const context = { console, Math, Map };
context.window = context;
vm.createContext(context);
for (const file of ['config', 'utils', 'trackdata', 'track', 'car', 'race', 'difficulty', 'rivals', 'collisions', 'standings']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), context, { filename: file });
}
const { CONFIG, Utils, Track, Car, Race, Rivals, Collisions, Standings, Difficulty } = context.OR;
const STEP = CONFIG.race.fixedStep;

function angleDiff(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * The reference "decent player": full throttle with a modest lift for the
 * hairpin, steering on a look-ahead point. The project's own autopilot laps
 * this track in about 38 s with this control law.
 */
function decentPlayer(car, aim, lift) {
  const p = Track.pointAhead(car.x, car.y, aim, car.trackHint);
  const want = Math.atan2(p.x - car.x, -(p.y - car.y));
  const error = angleDiff(want - car.heading);
  return {
    steer: Utils.clamp(error * 4.2 - car.slip * 0.7, -1, 1),
    throttle: car.speed < lift,
    brake: false
  };
}

/** One full race; returns the classification (or null when nobody finished). */
function race(levelId, seed) {
  const player = new Car();
  player.race = Race;
  const random = Utils.mulberry32(seed >>> 0);
  // A little human variance in aim and commitment, consistent within a race.
  const aim = 240 + random() * 70;
  const lift = 800 + random() * 100;
  const level = Difficulty.get(levelId);
  Rivals.reset(player, seed, level);
  Race.reset(player);
  Collisions.reset();
  const cars = [player].concat(Rivals.items);
  Standings.reset(cars);

  const limit = 120 * 120;
  for (let i = 0; i < limit; i++) {
    const time = (i + 1) * STEP;
    if (!player.race.finished) player.update(STEP, decentPlayer(player, aim, lift));
    Rivals.update(STEP);
    Collisions.resolve(cars, STEP);
    Rivals.score(time * 1000);
    if (!player.race.finished) Race.update(player, time * 1000);
    Standings.update();
    if (cars.every(car => car.race.finished)) break;
  }
  return {
    playerMs: player.race.finished ? player.race.finishTimeMs : Infinity,
    playerLaps: player.race.lapTimes.length,
    rivalsMs: Rivals.items.map(car => car.race.finished ? car.race.finishTimeMs : Infinity),
    place: Standings.playerPlace,
    won: Standings.playerPlace === 1 && player.race.finished
  };
}

const perLevel = Number(process.argv[2]) || 24;
// Optional live overrides, e.g. `node tools/balance.js 24 normal.rivalSpeed=1.26`
for (const arg of process.argv.slice(3)) {
  const [target, value] = arg.split('=');
  const [levelId, field] = target.split('.');
  const level = Difficulty.get(levelId === 'band' ? 'normal' : levelId);
  if (levelId === 'band') CONFIG.rivals.rubberBand[field] = Number(value);
  else if (level && field in level) level[field] = Number(value);
}
const levels = Difficulty.levels.map(level => level.id);
const rows = {};
for (const id of levels) {
  const results = [];
  for (let seed = 1; seed <= perLevel; seed++) results.push(race(id, seed * 7919));
  const wins = results.filter(r => r.won).length;
  const laps = results.filter(r => r.playerLaps === CONFIG.race.laps).length;
  const playerTimes = results.map(r => r.playerMs).filter(ms => isFinite(ms));
  const rivalTimes = results.flatMap(r => r.rivalsMs).filter(ms => isFinite(ms));
  const margins = results.map(r => (r.playerMs - Math.min(...r.rivalsMs)) / 1000).filter(ms => isFinite(ms));
  margins.sort((a, b) => a - b);
  const margin = margins.length ? (margins[Math.floor(margins.length / 2)]).toFixed(2) + 's' : 'n/a';
  rows[id] = {
    level: Difficulty.get(id).label,
    races: perLevel,
    wins,
    winRate: wins / perLevel,
    playerLaps: laps,
    playerAvg: Utils.formatTime(playerTimes.reduce((a, b) => a + b, 0) / Math.max(1, playerTimes.length)),
    rivalAvg: Utils.formatTime(rivalTimes.reduce((a, b) => a + b, 0) / Math.max(1, rivalTimes.length)),
    margin: margin
  };
}

console.log('\nStep 7 balance workbench — ' + perLevel + ' races per difficulty');
console.log('-'.repeat(72));
console.log('level    wins/races   win rate   player avg   rival avg   median margin');
for (const id of levels) {
  const r = rows[id];
  console.log(
    r.level.padEnd(8) +
    String(r.wins + '/' + r.races).padEnd(13) +
    (r.winRate * 100).toFixed(0).padStart(6) + '%' +
    r.playerAvg.padStart(13) +
    r.rivalAvg.padStart(12) +
    r.margin.padStart(15) +
    (r.playerLaps < r.races ? '   [' + (r.races - r.playerLaps) + ' unfinished]' : '')
  );
}
console.log('-'.repeat(72));
console.log('target: EASY wins often, NORMAL about half, HARD rarely but possibly.\n');
