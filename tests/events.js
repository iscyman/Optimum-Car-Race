/* =============================================================================
 * tests/events.js — Step 12 checks that need no DOM and no browser.
 *
 * Run: node tests/events.js
 * Covers: the four events as data, every objective type both ways, the
 * objective text, the modifier patch/revert round trip (nothing may leak into
 * a normal race), the hook registry, live progress, the one-off XP bonus
 * riding on top of the race award, and the save version 3 -> 4 migration.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['config', 'utils', 'xp', 'trackdata', 'track', 'car', 'race', 'save', 'cars',
  'difficulty', 'bests', 'rivals', 'collisions', 'standings', 'shards', 'events'];

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
function section(name) { console.log('\nStep 12 — ' + name); }

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

/** A snapshot of every value an event modifier may touch. */
function configSnapshot(OR) {
  return JSON.stringify({
    lapsOverride: OR.Race.lapsOverride,
    shardCount: OR.CONFIG.boost.shards.count,
    laps: OR.CONFIG.race.laps,
    difficulty: OR.CONFIG.difficulty.default
  });
}

/** Results shaped exactly like the ones Game._finishRace builds. */
function results(overrides) {
  return Object.assign({
    timeMs: 20000,
    laps: 3,
    cleanLaps: 1,
    wallHits: 0,
    shardsCollected: 0,
    place: 1,
    difficultyId: 'normal',
    trackId: 'flexnode'
  }, overrides || {});
}

/* ========================== 1. the four events ============================ */

section('the events, defined as data (four from Step 12, two from Step 13)');
{
  const OR = boot(fakeStorage());
  const list = OR.Events.list();
  const ids = list.map(e => e.id);

  check('the four Step 12 events keep their names, and Step 13 adds two more',
    list.length === 6 &&
    list.slice(0, 4).map(e => e.name).join(',') ===
      'BLOCK RUSH,STEADY STREAM,RIVAL GAUNTLET,SHARD HUNTER' &&
    ids.indexOf('narrow-margin') !== -1 && ids.indexOf('stall-storm') !== -1,
    ids.join(', '));

  check('an event is nothing but data',
    list.every(e => typeof e.id === 'string' && typeof e.name === 'string' &&
      typeof e.description === 'string' && e.objective && typeof e.objective.type === 'string' &&
      e.modifier && typeof e.modifier === 'object' && typeof e.xp === 'number' && e.xp > 0),
    list.map(e => e.id + ' +' + e.xp).join(' · '));

  check('BLOCK RUSH is one lap against a per-track target time',
    OR.Events.get('block-rush').objective.type === 'time' &&
    OR.Events.get('block-rush').modifier.laps === 1 &&
    OR.TRACKS.every(t => typeof OR.Events.get('block-rush').objective.targets[t.id] === 'number'),
    OR.TRACKS.map(t => t.id + ' ' +
      OR.Events.get('block-rush').objective.targets[t.id] + 's').join(' · '));

  check('STEADY STREAM is two clean laps',
    OR.Events.get('steady-stream').objective.type === 'clean' &&
    OR.Events.get('steady-stream').modifier.laps === 2);

  check('RIVAL GAUNTLET is a win on HARD and forces that difficulty',
    OR.Events.get('rival-gauntlet').objective.type === 'win' &&
    OR.Events.get('rival-gauntlet').objective.difficulty === 'hard' &&
    OR.Events.get('rival-gauntlet').difficulty === 'hard');

  check('SHARD HUNTER wants five shards and widens the field so it is possible',
    OR.Events.get('shard-hunter').objective.type === 'collect' &&
    OR.Events.get('shard-hunter').objective.count === 5 &&
    OR.Events.get('shard-hunter').modifier.shards >= 5,
    OR.Events.get('shard-hunter').modifier.shards + ' shards on track');

  check('only the objective types the engine knows are used',
    list.every(e => ['time', 'clean', 'win', 'collect'].indexOf(e.objective.type) !== -1));

  check('thinking about it: every id is unique and get() finds them all',
    new Set(ids).size === 6 && ids.every(id => OR.Events.get(id) &&
      OR.Events.get(id).id === id) && OR.Events.get('nope') === null);
}

/* =========================== 2. the objectives ============================ */

section('every objective can be met and missed');
{
  const OR = boot(fakeStorage());
  const at = id => OR.Events.get(id).objective;

  check('time: under the target completes, over it fails',
    OR.Events.met(at('block-rush'), results({ timeMs: 17500 })) === true &&
    OR.Events.met(at('block-rush'), results({ timeMs: 18500 })) === false &&
    OR.Events.met(at('block-rush'), results({ timeMs: 18000 })) === true,
    'target 18 s');

  check('time: the target is per circuit and follows the race',
    OR.Events.met(at('block-rush'), results({ trackId: 'mesh-highway', timeMs: 27000 })) === true &&
    OR.Events.met(at('block-rush'), results({ trackId: 'mesh-highway', timeMs: 29000 })) === false,
    'mesh highway target 28 s');

  check('clean: no barrier touches completes, one touch fails',
    OR.Events.met(at('steady-stream'), results({ wallHits: 0 })) === true &&
    OR.Events.met(at('steady-stream'), results({ wallHits: 1 })) === false);

  check('clean: an unfinished lap count also fails',
    OR.Events.met(at('steady-stream'), results({ wallHits: 0, laps: 1 })) === false);

  check('win: first place on HARD completes',
    OR.Events.met(at('rival-gauntlet'), results({ place: 1, difficultyId: 'hard' })) === true &&
    OR.Events.met(at('rival-gauntlet'), results({ place: 2, difficultyId: 'hard' })) === false);

  check('win: first place on NORMAL does not (it is a HARD event)',
    OR.Events.met(at('rival-gauntlet'), results({ place: 1, difficultyId: 'normal' })) === false);

  check('collect: five shards completes, four fails',
    OR.Events.met(at('shard-hunter'), results({ shardsCollected: 5 })) === true &&
    OR.Events.met(at('shard-hunter'), results({ shardsCollected: 4 })) === false);

  check('junk never throws and never completes',
    OR.Events.met(null, results()) === false &&
    OR.Events.met(at('shard-hunter'), null) === false &&
    OR.Events.met({ type: 'mystery' }, results()) === false &&
    OR.Events.met(at('block-rush'), results({ timeMs: 0 })) === false);

  check('objective text spells each one out',
    OR.Events.objectiveText(OR.Events.get('block-rush'), 'flexnode') === 'BEAT 0:18.0 OVER 1 LAP' &&
    /WITHOUT TOUCHING A WALL/.test(OR.Events.objectiveText(OR.Events.get('steady-stream'))) &&
    /WIN 2 LAPS ON HARD/.test(OR.Events.objectiveText(OR.Events.get('rival-gauntlet'))) &&
    /COLLECT 5 SHARDS/.test(OR.Events.objectiveText(OR.Events.get('shard-hunter'))),
    OR.Events.objectiveText(OR.Events.get('block-rush'), 'flexnode'));
}

/* ======================= 3. modifiers: patch and revert =================== */

section('modifiers patch the config, and give it back every time');
{
  const OR = boot(fakeStorage());
  const before = configSnapshot(OR);

  check('the shipped config starts unpatched',
    OR.Events.patched() === false && OR.Race.lapsOverride === null &&
    OR.CONFIG.boost.shards.count === 14,
    'shards ' + OR.CONFIG.boost.shards.count);

  OR.Events._applyPatch({ laps: 1, shards: 16 });
  check('applying a patch changes the live race config',
    OR.Race.lapsOverride === 1 && OR.CONFIG.boost.shards.count === 16 &&
    OR.Events.patched() === true);

  OR.Events._revertPatch();
  check('reverting restores the exact previous values',
    OR.Race.lapsOverride === null && OR.CONFIG.boost.shards.count === 14 &&
    OR.Events.patched() === false && configSnapshot(OR) === before);

  /* Starting one event straight after another must not stack patches. */
  OR.Events._applyPatch({ laps: 1 });
  OR.Events._applyPatch({ shards: 16 });
  check('a second patch replaces the first, it does not stack',
    OR.Race.lapsOverride === null && OR.CONFIG.boost.shards.count === 16,
    'laps ' + OR.Race.lapsOverride + ' · shards ' + OR.CONFIG.boost.shards.count);
  OR.Events._revertPatch();

  /* Unknown keys are ignored rather than written. */
  OR.Events._applyPatch({ laps: 2, nonsense: 99, difficulty: 'hard' });
  check('unknown modifier fields are ignored',
    OR.Race.lapsOverride === 2 && OR.CONFIG.boost.shards.count === 14 &&
    OR.Events.patched() === true);
  OR.Events._revertPatch();

  check('stopping when nothing is running is safe',
    OR.Events.stop() === null && OR.Events.patched() === false &&
    configSnapshot(OR) === before);

  /* The whole point: a normal race after an event is untouched. */
  OR.Events._applyPatch(OR.Events.get('steady-stream').modifier);
  const during = OR.Race.lapsOverride;
  OR.Events.stop();
  check('after an event, a normal race runs on the shipped config',
    during === 2 && OR.Race.lapsOverride === null &&
    OR.CONFIG.boost.shards.count === 14 && configSnapshot(OR) === before,
    'laps were ' + during + ', now ' + OR.Race.lapsOverride);

  /* Race.reset reads the override, so an event really is one lap. */
  OR.Track.use(OR.trackById('flexnode'));
  OR.Race.reset(new OR.Car());
  const normalLaps = OR.Race.laps;
  OR.Events._applyPatch({ laps: 1 });
  OR.Race.reset(new OR.Car());
  const eventLaps = OR.Race.laps;
  OR.Events.stop();
  OR.Race.reset(new OR.Car());
  check('Race.reset honours the override for the event race only',
    normalLaps === 3 && eventLaps === 1 && OR.Race.laps === 3,
    normalLaps + ' → ' + eventLaps + ' → ' + OR.Race.laps);
}

/* ============================== 4. the hooks ============================== */

section('the onRaceStart / onUpdate / onFinish hooks');
{
  const OR = boot(fakeStorage());
  const seen = [];
  const listener = (name) => (payload) => seen.push(name);

  OR.Events.on('raceStart', listener('start'));
  OR.Events.on('update', listener('update'));
  OR.Events.on('finish', listener('finish'));
  check('listeners register on all three hooks',
    OR.Events._listeners.raceStart.length === 1 &&
    OR.Events._listeners.update.length === 1 &&
    OR.Events._listeners.finish.length === 1);

  OR.Events.onRaceStart();
  OR.Events.onUpdate(1 / 120);
  OR.Events.onFinish({ id: 'block-rush', met: true });
  check('the core calls reach every listener, in order',
    seen.join(',') === 'start,update,finish', seen.join(','));

  OR.Events.off('update', listener('update'));
  /* off() with a fresh function reference must not remove the original. */
  OR.Events.off('update', function () {});
  OR.Events.onUpdate(1 / 120);
  check('off() removes exactly the listener it was given',
    OR.Events._listeners.update.length === 1 && seen.length === 4);

  check('registering junk is ignored rather than fatal',
    OR.Events.on('nope', listener('x')) === OR.Events &&
    OR.Events.on('update', null) === OR.Events &&
    OR.Events._listeners.update.length === 1);

  /* Live progress needs a running race; fake the parts of Game it reads. */
  OR.Events._active = 'shard-hunter';
  OR.Game = { state: 'racing', raceTimeMs: 5000, car: { wallHits: 0 }, entities: [1, 2, 3, 4] };
  OR.Standings = { playerPlace: 2 };

  const progress = OR.Events.progress();
  check('progress reads the live shard count',
    progress.type === 'collect' && progress.value === 0 && progress.target === 5 &&
    progress.text === '0 / 5', progress.text);

  OR.Shards.collected = 5;
  check('progress follows the race as it happens',
    OR.Events.progress().met === true && OR.Events.progress().ratio === 1);

  OR.Events._active = 'rival-gauntlet';
  check('progress shows the live position and the difficulty',
    OR.Events.progress().text === 'P2 / 1 ON HARD' && OR.Events.progress().met === false,
    OR.Events.progress().text);

  OR.Events._active = 'steady-stream';
  OR.Game.car.wallHits = 2;
  check('progress shows barrier touches', OR.Events.progress().value === 2);

  OR.Events._active = 'block-rush';
  OR.Game.raceTimeMs = 9000;
  check('progress shows the clock against the target',
    OR.Events.progress().text === '0:09.0 / 0:18.0' && OR.Events.progress().met === true,
    OR.Events.progress().text);

  OR.Events.stop();
  check('no event means no progress', OR.Events.progress() === null);
}

/* ====================== 5. judging and the XP bonus ======================= */

section('judging a finished race, and the bonus that is paid once');
{
  const OR = boot(fakeStorage());
  OR.Save.load();

  check('an event race is judged against its objective',
    OR.Events.judge(results()) === null, 'no event active');

  OR.Events._active = 'block-rush';
  const first = OR.Events.judge(results({ timeMs: 17000 }));
  check('a first completion carries the bonus',
    first.met === true && first.completed === true && first.firstCompletion === true &&
    first.replay === false && first.bonusXp === 250,
    '+' + first.bonusXp + ' XP');

  OR.Save.completeEvent('block-rush');
  const second = OR.Events.judge(results({ timeMs: 17000 }));
  check('beating it again is a replay: completed, but no bonus',
    second.met === true && second.replay === true &&
    second.firstCompletion === false && second.bonusXp === 0);

  const missed = OR.Events.judge(results({ timeMs: 25000 }));
  check('a missed objective is a failure with no bonus',
    missed.met === false && missed.completed === false && missed.bonusXp === 0 &&
    /BEAT 0:18.0/.test(missed.objective), missed.objective);

  OR.Events._active = 'rival-gauntlet';
  check('the judged result keeps the race facts for the banner',
    OR.Events.judge(results({ place: 1, difficultyId: 'hard' })).results.place === 1 &&
    OR.Events.last().name === 'RIVAL GAUNTLET');
  OR.Events.stop();

  /* The bonus rides on the race award as a flat, unmultiplied line. */
  const plain = OR.XP.breakdown({
    difficultyId: 'hard', place: 1, laps: 3, cleanLaps: 3, boostsUsed: 3
  });
  const withBonus = OR.XP.breakdown({
    difficultyId: 'hard', place: 1, laps: 3, cleanLaps: 3, boostsUsed: 3,
    extras: [{ id: 'event', label: 'EVENT COMPLETE — BLOCK RUSH', xp: 250 }]
  });
  check('the event bonus is flat: it is not multiplied by difficulty',
    withBonus.total === plain.total + 250 &&
    withBonus.lines.reduce((sum, line) => sum + line.xp, 0) === withBonus.total,
    plain.total + ' + 250 = ' + withBonus.total);

  check('the bonus is its own labelled line',
    withBonus.lines[withBonus.lines.length - 1].id === 'event' &&
    withBonus.lines[withBonus.lines.length - 1].xp === 250 &&
    withBonus.extraXp === 250);

  check('a zero or junk bonus is dropped',
    (function () {
      const none = OR.XP.breakdown({
        difficultyId: 'normal', place: 1, laps: 1, cleanLaps: 0, boostsUsed: 0,
        extras: [{ id: 'event', label: 'x', xp: 0 }, null, { id: 'event', label: 'y', xp: 'nope' }]
      });
      return none.extraXp === 0 && none.lines.length === 5;
    })());
}

/* ==================== 6. completions through the save (v4) ================ */

section('completion state, the migration and reset');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  OR.Save.load();

  check('the save is at version 4 or later with no completions yet',
    OR.Save.VERSION >= 4 && OR.Save.load().version === OR.Save.VERSION &&
    OR.Save.completedEvents().length === 0 && OR.Save.eventCompleted('block-rush') === false,
    'version ' + OR.Save.load().version);

  check('a completion is recorded once and only once',
    OR.Save.completeEvent('block-rush') === true &&
    OR.Save.completeEvent('block-rush') === false &&
    OR.Save.eventCompleted('block-rush') === true);

  check('an unknown event id cannot be recorded',
    OR.Save.completeEvent('made-up') === false && OR.Save.completedEvents().join(',') === 'block-rush');

  /* A version 3 save (Step 11) must migrate with everything intact. */
  const v3 = fakeStorage();
  v3.data['optimumRace.save.v1'] = JSON.stringify({
    version: 3,
    profile: { name: 'Eleven', color: 'mint' },
    stats: { races: 9, wins: 4, podiums: 6, totalTimeMs: 400000 },
    progress: { xp: 1470, level: 6 },
    unlocks: { cars: ['relay', 'validator', 'shard'], tracks: ['flexnode', 'mesh-highway'] },
    bests: { flexnode: { normal: { timeMs: 41000, lapMs: 13000 } } },
    selection: { track: 'mesh-highway', difficulty: 'hard', car: 'shard' }
  });
  const upgraded = boot(v3);
  const after = JSON.parse(v3.data['optimumRace.save.v1']);

  check('a version 3 save upgrades and gains an empty event log',
    upgraded.Save.load().version === upgraded.Save.VERSION &&
    after.version === upgraded.Save.VERSION && after.events &&
    Object.keys(after.events.completed).length === 0,
    'version ' + after.version);

  check('nothing else was lost in the 3 -> 4 migration',
    upgraded.Save.profile().name === 'Eleven' &&
    upgraded.Save.stats().races === 9 && upgraded.Save.xp() === 1470 &&
    upgraded.Save.car() === 'shard' &&
    upgraded.Save.unlockedCars().join(',') === 'relay,validator,shard' &&
    upgraded.Bests.bestTime('flexnode', 'normal') === 41000);

  /* Junk in the event log is dropped, and only true counts. */
  const junk = fakeStorage();
  junk.data['optimumRace.save.v1'] = JSON.stringify({
    version: 4,
    profile: { name: 'Junk', color: 'violet' },
    stats: { races: 1, wins: 0, podiums: 0, totalTimeMs: 1000 },
    progress: { xp: 10, level: 1 },
    unlocks: { cars: ['relay'], tracks: ['flexnode'] },
    events: { completed: { 'block-rush': true, 'not-an-event': true, 'steady-stream': 'yes' } },
    bests: {},
    selection: { track: 'flexnode', difficulty: 'normal', car: 'relay' }
  });
  const cleaned = boot(junk);
  cleaned.Save.load();
  check('junk in the event log is dropped and only true counts',
    cleaned.Save.completedEvents().join(',') === 'block-rush',
    cleaned.Save.completedEvents().join(',') || '(none)');

  /* Export / import carries completions. */
  OR.Save.completeEvent('shard-hunter');
  const copy = boot(fakeStorage());
  copy.Save.load();
  const imported = copy.Save.import(OR.Save.export());
  check('export and import carry event completions',
    imported.ok && copy.Save.eventCompleted('block-rush') &&
    copy.Save.eventCompleted('shard-hunter') &&
    copy.Save.completedEvents().join(',') === 'block-rush,shard-hunter',
    copy.Save.completedEvents().join(','));

  /* Reset clears progress, completions included. */
  OR.Save.reset();
  check('reset clears every completion and keeps the profile',
    OR.Save.completedEvents().length === 0 &&
    OR.Save.eventCompleted('block-rush') === false &&
    OR.Save.profile().name === OR.CONFIG.profile.defaultName,
    OR.Save.profile().name);
}

/* =============================== summary ================================== */

console.log('\n' + '-'.repeat(56));
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
