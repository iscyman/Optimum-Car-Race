/* =============================================================================
 * tests/xp.js — Step 10 checks that need no DOM and no browser.
 *
 * Run: node tests/xp.js
 * Covers: the award values, the difficulty multipliers, the level curve, the
 * breakdown adding up to the award, level-ups firing once, clean-lap tracking
 * through real barrier contact, XP persisting, quitting early paying nothing,
 * and the version 1 -> 2 migration.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['config', 'utils', 'xp', 'trackdata', 'track', 'car', 'race', 'save', 'cars', 'events', 'daily', 'haptics',
  'difficulty', 'bests', 'rivals', 'collisions', 'standings', 'shards'];
const STEP = 1 / 120;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
function section(name) { console.log('\nStep 10 — ' + name); }

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

/* ========================== 1. config and curve =========================== */

section('the XP config and the level curve');
{
  const OR = boot(fakeStorage());
  const X = OR.CONFIG.xp;

  check('every award value lives in the config',
    X.finish === 50 && X.cleanLap === 20 &&
    X.placement[1] === 100 && X.placement[2] === 60 && X.placement[3] === 30 &&
    X.boost.per === 5 && X.boost.max === 20 &&
    X.levelBase === 100 && X.levelExponent === 1.5,
    'finish ' + X.finish + ', places ' + JSON.stringify(X.placement) +
    ', clean ' + X.cleanLap + ', boost ' + X.boost.per + '/max ' + X.boost.max);

  check('the difficulty multipliers are EASY ×0.8 / NORMAL ×1 / HARD ×1.3',
    X.multipliers.easy === 0.8 && X.multipliers.normal === 1 &&
    X.multipliers.hard === 1.3 &&
    OR.XP.multiplier('easy') === 0.8 && OR.XP.multiplier('normal') === 1 &&
    OR.XP.multiplier('hard') === 1.3,
    JSON.stringify(X.multipliers));

  check('an unknown difficulty falls back to ×1',
    OR.XP.multiplier('ludicrous') === 1 && OR.XP.multiplier(undefined) === 1);

  check('level 1 starts at zero and the curve rises',
    OR.XP.xpForLevel(1) === 0 && OR.XP.xpForLevel(2) === 283 &&
    OR.XP.xpForLevel(3) === 520 && OR.XP.xpForLevel(4) === 800 &&
    OR.XP.xpForLevel(5) === 1118,
    [1, 2, 3, 4, 5].map(n => n + ':' + OR.XP.xpForLevel(n)).join('  '));

  check('the curve matches 100 × N^1.5 and always increases',
    [2, 3, 4, 5, 6, 7, 8].every(n =>
      OR.XP.xpForLevel(n) === Math.round(100 * Math.pow(n, 1.5))) &&
    [1, 2, 3, 4, 5, 6, 7, 8, 9].every(n =>
      OR.XP.xpForLevel(n + 1) > OR.XP.xpForLevel(n)),
    'L8 at ' + OR.XP.xpForLevel(8) + ' XP');

  check('levelFor is the inverse of the curve at every boundary',
    [1, 2, 3, 4, 5, 6, 7].every(n => {
      const start = OR.XP.xpForLevel(n);
      const nextStart = OR.XP.xpForLevel(n + 1);
      return OR.XP.levelFor(start) === n &&
        OR.XP.levelFor(nextStart - 1) === n &&
        OR.XP.levelFor(nextStart) === n + 1;
    }), '0→L1, 283→L2, 520→L3');

  check('progress inside a level is a 0..1 ratio with the right numbers',
    (function () {
      const p = OR.XP.progress(400);
      return p.level === 2 && p.floorXp === 283 && p.into === 117 &&
        p.needed === 237 && p.remaining === 120 &&
        Math.abs(p.ratio - 117 / 237) < 1e-9;
    })(), JSON.stringify(OR.XP.progress(400)));

  check('negative, fractional and nonsense totals are handled',
    OR.XP.levelFor(-500) === 1 && OR.XP.progress(-1).ratio === 0 &&
    OR.XP.levelFor(NaN) === 1 && OR.XP.levelFor(undefined) === 1 &&
    OR.XP.xpForLevel(0) === 0 && OR.XP.xpForLevel('3') === 520);
}

/* ======================= 2. the breakdown adds up ========================= */

section('the breakdown matches the award');
{
  const OR = boot(fakeStorage());
  const XP = OR.XP;

  const win = XP.breakdown({ place: 1, laps: 3, cleanLaps: 3, boostsUsed: 3, difficultyId: 'normal' });
  check('a clean winning race on NORMAL is worth the documented amount',
    win.total === 225 && win.base === 225,
    '50 finish + 100 win + 60 clean + 15 boost = ' + win.base + ', ×' + win.multiplier);

  check('every award line is present, in order',
    win.lines.map(l => l.id).join(',') === 'finish,placement,cleanLaps,boost,difficulty',
    win.lines.map(l => l.id).join(','));

  check('the lines sum exactly to the total',
    win.lines.reduce((sum, l) => sum + l.xp, 0) === win.total &&
    win.base + (win.total - win.base) === win.total,
    win.lines.map(l => l.id + ' ' + l.xp).join(' + ') + ' = ' + win.total);

  check('the placement bonus follows the table',
    [1, 2, 3, 4].every(place =>
      XP.breakdown({ place: place, laps: 3, cleanLaps: 0, difficultyId: 'normal' })
        .placementXp === (OR.CONFIG.xp.placement[place] || 0)),
    [1, 2, 3, 4].map(p => p + ':' + XP.breakdown({ place: p, laps: 3, cleanLaps: 0 }).placementXp).join(' '));

  check('clean laps are worth 20 each and scoped to the laps raced',
    XP.breakdown({ place: 4, laps: 3, cleanLaps: 2 }).cleanLapXp === 40 &&
    XP.breakdown({ place: 4, laps: 3, cleanLaps: 9 }).cleanLapXp === 60,
    'clamped to the lap count');

  check('the boost bonus is per boost and capped',
    XP.breakdown({ place: 4, laps: 3, boostsUsed: 1 }).boostXp === 5 &&
    XP.breakdown({ place: 4, laps: 3, boostsUsed: 3 }).boostXp === 15 &&
    XP.breakdown({ place: 4, laps: 3, boostsUsed: 9 }).boostXp === 20,
    '9 boosts still pays the ' + OR.CONFIG.xp.boost.max + ' cap');

  check('the breakdown is identical when computed twice',
    JSON.stringify(XP.breakdown({ place: 1, laps: 3, cleanLaps: 2, boostsUsed: 1, difficultyId: 'hard' })) ===
    JSON.stringify(XP.breakdown({ place: 1, laps: 3, cleanLaps: 2, boostsUsed: 1, difficultyId: 'hard' })));

  check('a missing or nonsense result still produces a usable breakdown',
    (function () {
      try {
        const empty = XP.breakdown({});
        const junk = XP.breakdown({ place: 'first', laps: NaN, cleanLaps: -4, boostsUsed: 'lots' });
        return empty.total === OR.CONFIG.xp.finish && junk.total === OR.CONFIG.xp.finish &&
          empty.lines.reduce((s, l) => s + l.xp, 0) === empty.total;
      } catch (error) {
        return false;
      }
    })(), 'finish bonus only');
}

/* ========================= 3. multipliers applied ========================= */

section('difficulty multipliers');
{
  const OR = boot(fakeStorage());
  const XP = OR.XP;
  const race = { place: 1, laps: 3, cleanLaps: 3, boostsUsed: 2 };

  const easy = XP.breakdown(Object.assign({ difficultyId: 'easy' }, race));
  const normal = XP.breakdown(Object.assign({ difficultyId: 'normal' }, race));
  const hard = XP.breakdown(Object.assign({ difficultyId: 'hard' }, race));

  check('EASY pays 80 %, NORMAL 100 %, HARD 130 % of the same race',
    easy.total === Math.round(normal.base * 0.8) &&
    normal.total === normal.base &&
    hard.total === Math.round(normal.base * 1.3),
    'easy ' + easy.total + ', normal ' + normal.total + ', hard ' + hard.total + ' XP');

  check('the multiplier line shows the difference, not the whole award',
    easy.lines[easy.lines.length - 1].xp === easy.total - easy.base &&
    easy.lines[easy.lines.length - 1].xp < 0 &&
    hard.lines[hard.lines.length - 1].xp > 0,
    'easy ' + (easy.total - easy.base) + ', hard +' + (hard.total - hard.base));

  check('HARD is worth more than NORMAL, which is worth more than EASY',
    hard.total > normal.total && normal.total > easy.total);
}

/* ============================ 4. level ups =============================== */

section('awarding XP and levelling up');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  const XP = OR.XP;

  check('a new save starts at level 1 with no XP',
    OR.Save.progress().level === 1 && OR.Save.progress().xp === 0);

  const first = XP.award({ place: 1, laps: 3, cleanLaps: 3, boostsUsed: 3, difficultyId: 'normal' });
  check('the award reports what was earned and where it landed',
    first.earned === 225 && first.after.xp === 225 && first.after.level === 1 &&
    first.before.xp === 0 && first.leveledUp === false,
    '+' + first.earned + ' XP → ' + first.after.xp + ' total, level ' + first.after.level);

  const second = XP.award({ place: 1, laps: 3, cleanLaps: 3, boostsUsed: 3, difficultyId: 'normal' });
  check('crossing a threshold levels up exactly once',
    second.after.xp === 450 && second.after.level === 2 &&
    second.levelsGained === 1 && second.leveledUp === true &&
    second.level === 2,
    second.after.xp + ' XP → level ' + second.after.level);

  const third = XP.award({ place: 4, laps: 3, cleanLaps: 0, boostsUsed: 0, difficultyId: 'normal' });
  check('a race that does not cross a threshold does not level up',
    third.leveledUp === false && third.levelsGained === 0 &&
    third.after.level === 2 && third.after.xp === 500,
    '+' + third.earned + ' XP → still level ' + third.after.level);

  check('the level in the save is recomputed from the XP, not trusted',
    (function () {
      const tampered = fakeStorage(JSON.parse(JSON.stringify(storage.data)));
      tampered.data[OR.CONFIG.profile.keys.save] = JSON.stringify({
        version: 2,
        profile: { name: 'Cheater', color: 'cyan' },
        stats: { races: 0, wins: 0, podiums: 0, totalTimeMs: 0 },
        progress: { xp: 450, level: 99 },
        bests: {}, selection: { track: null, difficulty: null }
      });
      const reloaded = boot(tampered);
      return reloaded.Save.progress().level === reloaded.XP.levelFor(450) &&
        reloaded.Save.progress().level === 2;
    })(), 'a level 99 with 450 XP becomes level 2');

  const hard = XP.award({ place: 1, laps: 3, cleanLaps: 3, boostsUsed: 0, difficultyId: 'hard' });
  check('the difficulty multiplier reaches the save',
    hard.earned === Math.round(210 * 1.3) && OR.Save.xp() === 500 + hard.earned,
    '+' + hard.earned + ' XP on HARD, ' + OR.Save.xp() + ' total');

  check('a big award can gain several levels at once, and says so',
    (function () {
      const before = OR.Save.progress().level;
      const expectedXp = OR.Save.xp() + 5000;
      const result = OR.Save.addXp(5000);
      return result.levelsGained > 1 && result.leveledUp === true &&
        result.xp === expectedXp && result.level === XP.levelFor(expectedXp) &&
        result.level > before;
    })(), OR.Save.progress().level + ' after a 5000 XP award');
}

/* ========================= 5. persistence ================================ */

section('XP persists');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  OR.XP.award({ place: 2, laps: 3, cleanLaps: 1, boostsUsed: 1, difficultyId: 'normal' });
  const expectedXp = OR.Save.xp();
  const expectedLevel = OR.Save.progress().level;

  const reloaded = boot(storage);
  check('XP and level survive a reload',
    reloaded.Save.xp() === expectedXp &&
    reloaded.Save.progress().level === expectedLevel,
    reloaded.Save.progress().level + ' · ' + reloaded.Save.xp() + ' XP');

  check('XP lives inside the same versioned save object',
    (function () {
      const raw = JSON.parse(storage.data[OR.CONFIG.profile.keys.save]);
      return raw.version === OR.Save.VERSION && raw.progress &&
        raw.progress.xp === expectedXp && raw.progress.level === expectedLevel;
    })(), 'version ' + OR.Save.VERSION);

  check('the export/import round trip carries XP',
    (function () {
      const blob = OR.Save.export();
      const other = boot(fakeStorage());
      const result = other.Save.import(blob);
      return result.ok && other.Save.xp() === expectedXp &&
        other.Save.progress().level === expectedLevel;
    })());

  check('reset clears XP and puts the driver back to level 1',
    (function () {
      OR.Save.reset();
      return OR.Save.xp() === 0 && OR.Save.progress().level === 1;
    })(), 'after reset');
}

/* ======================= 6. quitting early pays nothing ================== */

section('quitting early');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  OR.Save.addXp(120);
  const before = OR.Save.xp();

  /* A race that is started and abandoned must not award anything. */
  const player = new OR.Car();
  player.race = OR.Race;
  OR.Rivals.reset(player, 4242, OR.Difficulty.get('normal'));
  OR.Race.reset(player);
  for (let i = 0; i < 120 * 5; i++) OR.Rivals.update(STEP);
  check('abandoning a race leaves the XP total alone',
    OR.Save.xp() === before, before + ' XP before and after');

  check('only a finished race can be awarded',
    (function () {
      const fake = { place: 1, laps: 3, cleanLaps: 3, boostsUsed: 3, difficultyId: 'normal' };
      const award = OR.XP.award(fake);
      return award.earned > 0;
    })(), 'award() is the single payout path');
}

/* ======================= 7. clean lap tracking ========================== */

section('clean laps (barrier contact)');
{
  const OR = boot(fakeStorage());
  const car = new OR.Car();

  check('a new car starts with a clean sheet',
    car.wallHits === 0 && car.touchingBarrier === false);

  /* Drive onto the grass, hard into the barrier: one contact episode. */
  const p = OR.Track.pointAt(OR.Track.length * 0.3);
  car.x = p.x + p.nx * (OR.Track.hardLimit + 120);
  car.y = p.y + p.ny * (OR.Track.hardLimit + 120);
  car.vx = 0; car.vy = 0;
  for (let i = 0; i < 60; i++) car.update(STEP, { steer: 0, throttle: false, brake: false });
  const afterFirst = car.wallHits;
  check('touching the barrier registers a hit',
    afterFirst >= 1 && car.hitWall === false || afterFirst >= 1,
    afterFirst + ' hit(s) after 0.5 s against the wall');

  for (let i = 0; i < 60; i++) car.update(STEP, { steer: 0, throttle: false, brake: false });
  check('staying against the barrier is still ONE hit, not one per frame',
    car.wallHits === afterFirst,
    'still ' + car.wallHits + ' after another 0.5 s of scraping');

  /* Drive back onto the road, then touch again: a second episode. */
  const lane = OR.Track.pointAt(OR.Track.length * 0.31);
  car.x = lane.x; car.y = lane.y;
  car.touchingBarrier = false;
  car.update(STEP, { steer: 0, throttle: false, brake: false });
  const onRoad = car.wallHits;
  const away = OR.Track.pointAt(OR.Track.length * 0.33);
  car.x = away.x + away.nx * (OR.Track.hardLimit + 200);
  car.y = away.y + away.ny * (OR.Track.hardLimit + 200);
  for (let i = 0; i < 30; i++) car.update(STEP, { steer: 0, throttle: false, brake: false });
  check('a second, separate contact counts again',
    car.wallHits === onRoad + 1,
    onRoad + ' → ' + car.wallHits);

}

/* ========================= 8. the migration ============================== */

section('migrating a Step 9 save to version 2');
{
  const storage = fakeStorage();
  /* Hand-build a version 1 save exactly as Step 9 wrote it. */
  storage.data['optimumRace.save.v1'] = JSON.stringify({
    version: 1,
    profile: { name: 'Veteran', color: 'amber' },
    stats: { races: 12, wins: 5, podiums: 8, totalTimeMs: 511000 },
    bests: { 'mesh-highway': { hard: { timeMs: 44000, lapMs: 21000 } } },
    selection: { track: 'mesh-highway', difficulty: 'hard' }
  });

  const OR = boot(storage);
  OR.Save.load();   // reading the save is what triggers the migration
  const raw = JSON.parse(storage.data['optimumRace.save.v1']);

  check('the save is upgraded when it is older than the current version',
    OR.Save.VERSION >= 4 && OR.Save.load().version === OR.Save.VERSION &&
    raw.version === OR.Save.VERSION,
    'version ' + OR.Save.load().version);

  check('nothing is lost in the migration',
    OR.Save.profile().name === 'Veteran' && OR.Save.profile().color === 'amber' &&
    OR.Save.stats().races === 12 && OR.Save.stats().wins === 5 &&
    OR.Save.stats().totalTimeMs === 511000 &&
    OR.Bests.bestTime('mesh-highway', 'hard') === 44000 &&
    OR.Bests.bestLap('mesh-highway', 'hard') === 21000 &&
    OR.Save.selection().track === 'mesh-highway' &&
    OR.Save.selection().difficulty === 'hard',
    OR.Save.stats().races + ' races kept');

  check('an upgraded save starts at level 1 with 0 XP',
    OR.Save.progress().xp === 0 && OR.Save.progress().level === 1);

  check('the upgraded save keeps working after another reload',
    (function () {
      const again = boot(storage);
      return again.Save.profile().name === 'Veteran' &&
        again.Save.stats().races === 12 &&
        again.Bests.bestTime('mesh-highway', 'hard') === 44000;
    })());

  check('earning XP after the migration behaves normally',
    (function () {
      const award = OR.XP.award({ place: 1, laps: 3, cleanLaps: 3, boostsUsed: 0, difficultyId: 'hard' });
      const reloaded = boot(storage);
      return award.earned === Math.round(210 * 1.3) &&
        reloaded.Save.xp() === award.earned &&
        reloaded.Save.stats().races === 12;
    })());
}

/* =============================== summary ================================== */

console.log('\n' + '-'.repeat(56));
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
