/* =============================================================================
 * tests/rivals.js — deterministic Step 6 physics/race checks, no browser needed.
 * Run: node tests/rivals.js
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
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
function section(name) { console.log('\nStep 6 — ' + name); }
function setup(seed) {
  const player = new Car();
  player.race = Race;
  Rivals.reset(player, seed);
  Race.reset(player);
  Collisions.reset();
  const cars = [player].concat(Rivals.items);
  Standings.reset(cars);
  return { player, cars };
}
function park(car, s, lane, speed, headingOffset) {
  const p = Track.pointAt(s);
  car.x = p.x + p.nx * (lane || 0);
  car.y = p.y + p.ny * (lane || 0);
  car.heading = Math.atan2(p.tx, -p.ty) + (headingOffset || 0);
  car.trackHint = p.index;
  car.vx = Math.sin(car.heading) * (speed || 0);
  car.vy = -Math.cos(car.heading) * (speed || 0);
  car.steerInput = 0;
  car.syncVelocity();
  return p;
}
function playerControls(car, limit) {
  const p = Track.pointAhead(car.x, car.y, 260, car.trackHint);
  const want = Math.atan2(p.x - car.x, -(p.y - car.y));
  const error = Math.atan2(Math.sin(want - car.heading), Math.cos(want - car.heading));
  return { steer: Utils.clamp(error * 4.2 - car.slip * 0.7, -1, 1),
    throttle: car.speed < limit - 10, brake: car.speed > limit + 22 };
}

section('roster and grid');
let { player, cars } = setup(42);
check('exactly three named STANDARD GOSSIP rivals', Rivals.items.length === 3 &&
  Rivals.items.every((car, i) => car.name === 'STANDARD GOSSIP ' + (i + 1)));
check('four distinct car colours', new Set(cars.map(car => car.color)).size === 4);
check('three distinct, fixed speed and skill profiles',
  new Set(Rivals.items.map(car => car.topSpeedMultiplier)).size === 3 &&
  new Set(Rivals.items.map(car => car.ai.skill)).size === 3);
check('every car is behind the line, on the road, at rest', cars.every(car =>
  car.race.progress < 0 && car.race.progress > -0.05 && car.speed === 0 &&
  Track.isOnRoad(car.x, car.y, car.trackHint)));
check('grid slots are staggered, ordered and non-overlapping',
  cars.every((car, i) => car.gridSlot === i &&
    (i === 0 || car.race.progress < cars[i - 1].race.progress)) &&
  cars.every((a, i) => cars.slice(i + 1).every(b => !Collisions.overlap(a, b))));
check('initial position is POS 1/4, not a phantom completed lap',
  Standings.playerPlace === 1 && cars.every(car => car.race.lapTimes.length === 0));
Rivals.items[0].race.lapTimes.push(1234);
check('lap trackers and split arrays are independent', Race.lapTimes.length === 0 &&
  Rivals.items[1].race.lapTimes.length === 0 && Rivals.items[0].race !== Race);
({ player, cars } = setup(42));
for (let i = 0; i < 300 && !Rivals.items[0].race.started; i++) {
  Rivals.update(STEP); Rivals.score((i + 1) * STEP * 1000);
}
check('leaving the grid crosses the start without awarding a lap',
  Rivals.items[0].race.started && Rivals.items[0].race.lap === 1 &&
  Rivals.items[0].race.lapTimes.length === 0 && Rivals.items[0].race.nextCheckpoint === 0);
const aiSource = fs.readFileSync(path.join(ROOT, 'js', 'rivals.js'), 'utf8');
check('AI does not access private geometry or track control points',
  !/Track\.(points|corners|data|_[a-zA-Z])\b/.test(aiSource));

section('corner planning and gameplay stalls');
({ player, cars } = setup(7));
let rival = Rivals.items[0];
park(rival, Track.length * 0.04, rival.ai.lane, 800);
Rivals._think(rival);
const straightTarget = rival.ai.targetSpeed;
park(rival, Track.length * 0.85, rival.ai.lane, 800);
Rivals._think(rival);
check('AI brakes for the upcoming hairpin', rival.ai.controls.brake &&
  rival.ai.cornerTarget < straightTarget * 0.9,
  Math.round(straightTarget) + ' → ' + Math.round(rival.ai.cornerTarget) + ' u/s');
park(rival, Track.length * 0.04, rival.ai.lane, 840);
rival.ai.nextStall = 0;
let minStallSpeed = Infinity, began = false, durationSteps = 0;
for (let i = 0; i < 180; i++) {
  Rivals.update(STEP);
  if (rival.ai.stalled) {
    began = true; durationSteps++;
    minStallSpeed = Math.min(minStallSpeed, rival.speed);
  } else if (began) break;
}
check('a stall visibly slows the car but never stops it', minStallSpeed > 100 &&
  minStallSpeed < 840 * 0.75, Math.round(minStallSpeed) + ' u/s');
check('stall duration is 0.5–1 second', durationSteps * STEP >= 0.5 - STEP &&
  durationSteps * STEP <= 1 + STEP, (durationSteps * STEP).toFixed(3) + 's');
check('stall releases automatically and schedules a fair gap', !rival.ai.stalled &&
  rival.ai.stallRemaining === 0 && rival.ai.nextStall >= CONFIG.rivals.stall.intervalMin &&
  rival.ai.nextStall <= CONFIG.rivals.stall.intervalMax);
check('stall schedules are independent, not simultaneous',
  new Set(Rivals.items.map(car => car.ai.nextStall)).size === 3);

section('contact, chains and barriers');
({ player, cars } = setup(11));
const a = player, b = Rivals.items[0];
const contactS = Track.length * 0.06;
park(a, contactS, -20, 700); park(b, contactS, 20, 700);
const contacts = Collisions.resolve([a, b], STEP);
const afterImpact = a.speed;
check('contact pushes both cars apart', contacts > 0 && !Collisions.overlap(a, b) && a.hitCar && b.hitCar);
check('impact has a small, bounded speed loss', afterImpact > 700 * 0.9 && afterImpact < 700,
  '700 → ' + afterImpact.toFixed(1));
park(a, contactS, -20, afterImpact); park(b, contactS, 20, afterImpact);
Collisions.resolve([a, b], STEP);
check('persistent contact cannot repeatedly drain speed', Math.abs(a.speed - afterImpact) < 0.001);
for (const car of cars) park(car, contactS, 0, 0);
Collisions.reset();
for (let i = 0; i < 20; i++) Collisions.resolve(cars, STEP);
check('four exactly overlapping cars separate without NaNs or locks',
  cars.every(car => Number.isFinite(car.x) && Number.isFinite(car.y)) &&
  cars.every((car, i) => cars.slice(i + 1).every(other => !Collisions.overlap(car, other))));
park(a, contactS, Track.hardLimit, 0);
park(b, contactS, Track.hardLimit - 5, 0);
Collisions.reset();
for (let i = 0; i < 30; i++) Collisions.resolve([a, b], STEP);
check('contact at the barrier separates without escaping the playable area',
  !Collisions.overlap(a, b) && [a, b].every(car =>
    Math.abs(Track.nearest(car.x, car.y, car.trackHint).offset) <= Track.hardLimit + 0.01));
const beforeDrive = [a.x, a.y];
for (let i = 0; i < 120 * 5; i++) {
  a.update(STEP, playerControls(a, 600));
  Rivals.update(STEP);
  Collisions.resolve(cars, STEP);
}
check('cars can drive away after a wall-side collision', a.speed > 200 &&
  Math.hypot(a.x - beforeDrive[0], a.y - beforeDrive[1]) > 700 && b.speed > 200);
check('contact bookkeeping stays bounded to six pairs', Collisions.cooldowns.size <= 6);

section('finished rivals keep a cool-down lap');
({ player, cars } = setup(5));
let cooldownTime = 0;
for (let i = 0; i < 120 * 100 && !Rivals.items.some(car => car.race.finished); i++) {
  cooldownTime += STEP;
  Rivals.update(STEP);
  Collisions.resolve(cars, STEP);
  Rivals.score(cooldownTime * 1000);
}
const finishedRival = Rivals.items.find(car => car.race.finished);
check('a rival can finish before the player', !!finishedRival);
let cooldownStart = Track.nearest(finishedRival.x, finishedRival.y, finishedRival.trackHint);
let cooldownTravelled = 0, cooldownMinSpeed = Infinity, cooldownOffRoad = 0, previousS = cooldownStart.s;
for (let i = 0; i < 120 * 8; i++) {
  Rivals.update(STEP);
  Collisions.resolve(cars, STEP);
  const info = Track.nearest(finishedRival.x, finishedRival.y, finishedRival.trackHint);
  let delta = info.s - previousS;
  if (delta < -Track.length / 2) delta += Track.length;
  if (delta > Track.length / 2) delta -= Track.length;
  cooldownTravelled += delta;
  previousS = info.s;
  cooldownMinSpeed = Math.min(cooldownMinSpeed, finishedRival.speed);
  if (Math.abs(info.offset) > Track.halfRoad) cooldownOffRoad++;
}
check('a finished rival keeps driving slowly instead of parking on the line',
  cooldownMinSpeed > 120 && cooldownTravelled > 1500 && cooldownOffRoad === 0,
  'travelled ' + Math.round(cooldownTravelled) + ' u, slowest ' +
  Math.round(cooldownMinSpeed) + ' u/s, off-road steps ' + cooldownOffRoad);
check('the cool-down car never re-scores a lap or a stall',
  finishedRival.race.lapTimes.length === CONFIG.race.laps &&
  !finishedRival.ai.stalled && finishedRival.race.finishTimeMs > 0);

section('validated ordering and final classification');
({ player, cars } = setup(99));
player.race.progress = 0.9; player.race.nextCheckpoint = 3;
rival = Rivals.items[0];
rival.race.lapBase = 1; rival.race.lap = 2; rival.race.progress = 1.1;
Standings.update();
check('a rival on lap 2 ranks ahead of a player late on lap 1',
  Standings.rows[0].id === rival.id && Standings.playerPlace === 2);
// A shortcut may have a large raw fraction but not earned checkpoint progress.
rival.race.lapBase = 0; rival.race.progress = 0.9; rival.race.nextCheckpoint = 0;
player.race.progress = 0.4; player.race.nextCheckpoint = 1;
Standings.update();
check('skipped checkpoints cannot inflate the standings', Standings.rows[0].isPlayer &&
  rival.race.validProgress() === Track.checkpoints[0].fraction);
Rivals.items[0].race.finished = true; Rivals.items[0].race.finishTimeMs = 45000;
Rivals.items[1].race.finished = true; Rivals.items[1].race.finishTimeMs = 42000;
player.race.finished = true; player.race.finishTimeMs = 46000;
Standings.update();
check('finished drivers sort by finish time, not names or screen position',
  Standings.rows.map(row => row.id).join(',') === 'gossip-2,gossip-1,player,gossip-3' &&
  Standings.playerPlace === 3);
const final = Standings.finalize();
check('unfinished rivals retain real progress, not fictional finish times',
  final[3].timeMs === null && !final[3].finished && final[3].remainingMeters > 0);
const frozenOrder = final.map(row => row.id).join(',');
player.race.finishTimeMs = 1; Rivals.items[2].race.progress = 4;
Standings.update();
check('classification freezes at the player flag and is a detached snapshot',
  Standings.rows.map(row => row.id).join(',') === frozenOrder && final[2].timeMs === 46000);

section('eight complete four-car races');
let worstOffset = 0, wallSteps = 0, durationOK = true, intervalsOK = true, profilesOK = true;
const finishedTimes = [];
for (const seed of [1, 2, 7, 42, 99, 1234, 20261001, 4294967295]) {
  ({ player, cars } = setup(seed));
  const histories = Rivals.items.map(() => ({ start: null, end: null }));
  for (let i = 0; i < 120 * 100; i++) {
    const time = (i + 1) * STEP;
    player.update(STEP, player.race.finished
      ? { throttle: false, brake: true, steer: 0 } : playerControls(player, 560));
    Rivals.update(STEP);
    Collisions.resolve(cars, STEP);
    Rivals.score(time * 1000);
    player.race.update(player, time * 1000);
    Standings.update();
    Rivals.items.forEach((car, index) => {
      const h = histories[index], ai = car.ai;
      if (ai.stalled && h.start === null) {
        h.start = time;
        if (h.end !== null) {
          const interval = time - h.end;
          intervalsOK = intervalsOK && interval >= car.ai.stallIntervalMin - STEP * 3 &&
            interval <= car.ai.stallIntervalMax + STEP * 3;
        }
      } else if (!ai.stalled && h.start !== null) {
        const duration = time - h.start;
        if (!car.race.finished) durationOK = durationOK &&
          duration >= car.ai.stallDurationMin - STEP * 2 &&
          duration <= car.ai.stallDurationMax + STEP * 2;
        h.end = time; h.start = null;
      }
      // Step 7 scales the roster profile by the race's difficulty. The BASE
      // profile is what stays fixed; the live top speed may be nudged only
      // inside the documented rubber-band caps.
      const roster = CONFIG.rivals.roster[index];
      const level = Rivals.difficulty;
      const bandRatio = car.topSpeedMultiplier / car.baseTopSpeedMultiplier;
      profilesOK = profilesOK &&
        ai.level === level.id &&
        Math.abs(car.baseTopSpeedMultiplier - roster.speed * level.rivalSpeed) < 1e-9 &&
        Math.abs(ai.skill - Utils.clamp(roster.skill * level.cornerSkill, 0.5, 1.25)) < 1e-9 &&
        ai.baseSkill === roster.skill && ai.lane === roster.lane &&
        bandRatio >= 1 - CONFIG.rivals.rubberBand.easeMax - 1e-9 &&
        bandRatio <= 1 + CONFIG.rivals.rubberBand.pushMax + 1e-9;
      if (!car.race.finished) {
        worstOffset = Math.max(worstOffset, Math.abs(Track.nearest(car.x, car.y, car.trackHint).offset));
        if (car.hitWall) wallSteps++;
      }
    });
    if (cars.every(car => car.race.finished)) break;
  }
  const completed = cars.every(car => car.race.finished && car.race.lapTimes.length === CONFIG.race.laps &&
    car.race.lapTimes.every(ms => ms > 0) &&
    Math.abs(car.race.lapTimes.reduce((sum, ms) => sum + ms, 0) - car.race.finishTimeMs) < 0.01);
  check('seed ' + seed + ': all four complete three valid laps', completed,
    cars.map(car => (car.race.finishTimeMs / 1000).toFixed(2) + 's').join(' / '));
  const expected = cars.slice().sort((x, y) => x.race.finishTimeMs - y.race.finishTimeMs);
  check('seed ' + seed + ': standings match recorded finish times',
    Standings.rows.map(row => row.id).join(',') === expected.map(car => car.id).join(','));
  finishedTimes.push(...Rivals.items.map(car => car.race.finishTimeMs / 1000));
}
check('AI stays inside the road corridor without wall hits', worstOffset < Track.halfRoad && wallSteps === 0,
  'worst offset ' + worstOffset.toFixed(1) + ' u, wall steps ' + wallSteps);
check('every observed stall has a fair duration and gap', durationOK && intervalsOK);
check('speed, skill and lane profiles remain unchanged within every race', profilesOK);
check('all AI races finish promptly, without getting stuck',
  finishedTimes.every(seconds => seconds > 30 && seconds < 65),
  Math.min(...finishedTimes).toFixed(2) + '–' + Math.max(...finishedTimes).toFixed(2) + 's');

console.log('\n' + '-'.repeat(56));
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
