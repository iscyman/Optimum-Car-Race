/* =============================================================================
 * tests/save.js — Step 9 checks that need no DOM and no browser.
 *
 * Run: node tests/save.js
 * Covers: the versioned save object, profile name and colour handling, career
 * stats, best times kept per track/difficulty, export/import round trips,
 * reset, blocked storage, corrupt data, and the migrations from the keys that
 * Steps 7 and 8 wrote.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['config', 'utils', 'xp', 'trackdata', 'track', 'car', 'race', 'save', 'cars',
  'difficulty', 'bests', 'rivals', 'collisions', 'standings', 'shards'];

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
function section(name) { console.log('\nStep 9 — ' + name); }

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

/** Storage that throws on every access, like a browser in private mode. */
function blockedStorage() {
  const context = { console, Math, Map };
  context.window = context;
  Object.defineProperty(context, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage is blocked by the browser'); }
  });
  vm.createContext(context);
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file + '.js'), 'utf8'), context, { filename: file });
  }
  return context.OR;
}

/* ========================= 1. the save object ============================== */

section('one versioned save object');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  const key = OR.CONFIG.profile.keys.save;

  check('the save is versioned and lives under one key',
    OR.Save.VERSION === 3 && OR.Save.load().version === 3 &&
    typeof storage.data[key] === 'string',
    key + ' (version ' + OR.Save.VERSION + ')');

  check('the save carries XP and a level (Step 10)',
    OR.Save.load().progress && typeof OR.Save.load().progress.xp === 'number' &&
    typeof OR.Save.load().progress.level === 'number' &&
    OR.Save.xp() === 0 && OR.Save.level() === 1,
    OR.Save.level() + ' · ' + OR.Save.xp() + ' XP');

  const saved = JSON.parse(storage.data[key]);
  check('the save carries profile, stats, bests and selection',
    saved.profile && typeof saved.profile.name === 'string' &&
    saved.stats && typeof saved.stats.races === 'number' &&
    typeof saved.bests === 'object' && saved.selection &&
    Object.prototype.hasOwnProperty.call(saved.selection, 'track'),
    Object.keys(saved).join(', '));

  check('a fresh save has the documented defaults',
    OR.Save.profile().name === 'Racer' &&
    OR.Save.profile().color === 'violet' &&
    OR.Save.stats().races === 0 && OR.Save.stats().wins === 0 &&
    OR.Save.stats().podiums === 0 && OR.Save.stats().totalTimeMs === 0,
    OR.Save.profile().name + ' / ' + OR.Save.profile().color);

  check('every read and write is wrapped (no throw with blocked storage)',
    (function () {
      try {
        const blocked = blockedStorage();
        blocked.Save.setProfile({ name: 'Private' });
        blocked.Save.recordRace({ timeMs: 40000, place: 1 });
        return blocked.Save.profile().name === 'Private' &&
          blocked.Save.stats().races === 1;
      } catch (error) {
        return false;
      }
    })(), 'in-memory save');
}

/* ============================ 2. profile =================================== */

section('profile: name and colour');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  const U = OR.Utils;

  check('a name is trimmed, whitespace-collapsed and clamped',
    U.sanitiseName('  Turbo   Racer  ') === 'Turbo Racer' &&
    U.sanitiseName('ABCDEFGHIJKLMNOPQRSTUVWXYZ').length === 16 &&
    U.sanitiseName('ABCDEFGHIJKLMNOPQRSTUVWXYZ') === 'ABCDEFGHIJKLMNOP',
    U.sanitiseName('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));

  check('control characters and markup-ish characters are stripped',
    (function () {
      const clean = U.sanitiseName('a\u0000b<script>"alert"&amp;</script>\u001fc');
      return !/[\u0000-\u001f]/.test(clean) && !/[<>&"']/.test(clean) && clean.length <= 16;
    })(), U.sanitiseName('<b>Bo</b>b>'));

  check('an empty or non-string name falls back to the default',
    U.sanitiseName('   ') === 'Racer' && U.sanitiseName('') === 'Racer' &&
    U.sanitiseName(null) === 'Racer' && U.sanitiseName(42) === 'Racer' &&
    U.sanitiseName(undefined) === 'Racer');

  OR.Save.setProfile({ name: '  Nia  ', color: 'mint' });
  check('a chosen name and colour are stored',
    OR.Save.profile().name === 'Nia' && OR.Save.profile().color === 'mint',
    OR.Save.profile().name + ' / ' + OR.Save.profile().color);

  check('the profile survives a reload',
    (function () {
      const reloaded = boot(storage);
      return reloaded.Save.profile().name === 'Nia' &&
        reloaded.Save.profile().color === 'mint';
    })());

  check('an unknown colour is refused without breaking the current one',
    (function () {
      OR.Save.setProfile({ color: 'neon-green' });
      return OR.Save.profile().color === 'mint';
    })(), OR.Save.profile().color);

  check('six car colours are defined, each with a usable palette',
    OR.CONFIG.profile.colors.length === 6 &&
    OR.CONFIG.profile.colors.every(c =>
      typeof c.id === 'string' && typeof c.label === 'string' &&
      /^#[0-9a-f]{6}$/i.test(c.hex) &&
      Array.isArray(c.body) && c.body.length === 4 &&
      c.body.every(stop => /^#[0-9a-f]{6}$/i.test(stop))),
    OR.CONFIG.profile.colors.map(c => c.label).join(', '));

  check('Save.color() returns the palette of the selected colour',
    OR.Save.color().id === 'mint' && OR.Save.color().body.length === 4 &&
    OR.Save.color().hex === OR.CONFIG.profile.colors[4].hex,
    OR.Save.color().hex);

  check('the player car takes the profile name and paint',
    (function () {
      const player = new OR.Car();
      player.race = OR.Race;
      OR.Rivals.reset(player, 1234, OR.Difficulty.get('normal'));
      return player.name === 'Nia' &&
        player.color === OR.Save.color().hex &&
        player.palette && player.palette.length === 4 &&
        player.isPlayer === true;
    })(), 'Nia');
}

/* ============================= 3. stats ==================================== */

section('career stats');
{
  const storage = fakeStorage();
  const OR = boot(storage);

  OR.Save.recordRace({ timeMs: 41000, place: 1 });
  const after = OR.Save.recordRace({ timeMs: 43000, place: 3 });
  OR.Save.recordRace({ timeMs: 45000, place: 4 });

  check('races, wins, podiums and total time add up',
    after.races === 2 && after.wins === 1 && after.podiums === 2 &&
    OR.Save.stats().races === 3 && OR.Save.stats().wins === 1 &&
    OR.Save.stats().podiums === 2 &&
    OR.Save.stats().totalTimeMs === 129000,
    OR.Save.stats().races + ' races, ' + OR.Save.stats().wins + ' wins, ' +
    OR.Save.stats().podiums + ' podiums, ' + OR.Save.totalTimeText());

  check('the total time renders as a clock',
    OR.Save.totalTimeText() === OR.Utils.formatTime(129000),
    OR.Save.totalTimeText());

  check('stats survive a reload',
    (function () {
      const reloaded = boot(storage);
      return reloaded.Save.stats().races === 3 &&
        reloaded.Save.stats().totalTimeMs === 129000;
    })());

  check('a nonsense result cannot corrupt the numbers',
    (function () {
      OR.Save.recordRace({ timeMs: NaN, place: 0 });
      OR.Save.recordRace({});
      const stats = OR.Save.stats();
      return stats.races === 5 && isFinite(stats.totalTimeMs) &&
        stats.wins === 1 && stats.podiums === 2 &&
        JSON.stringify(stats) === JSON.stringify(JSON.parse(JSON.stringify(stats)));
    })(), OR.Save.stats().races + ' races');
}

/* ========================= 4. records per track ============================ */

section('best times live in the same save');
{
  const storage = fakeStorage();
  const OR = boot(storage);

  OR.Bests.record('shard-speedway', 'hard', { timeMs: 52000, lapMs: 17000 });
  OR.Bests.record('mesh-highway', 'normal', { timeMs: 47000, lapMs: 23000 });

  check('records are stored inside the save object',
    OR.Save.bests()['shard-speedway'].hard.timeMs === 52000 &&
    OR.Save.bests()['mesh-highway'].normal.lapMs === 23000,
    JSON.stringify(OR.Save.bests()['shard-speedway']));

  check('the Best API still reads them back per track and difficulty',
    OR.Bests.bestTime('shard-speedway', 'hard') === 52000 &&
    OR.Bests.bestLap('shard-speedway', 'hard') === 17000 &&
    OR.Bests.bestTime('mesh-highway', 'hard') === 0 &&
    OR.Bests.timeText('shard-speedway', 'hard') ===
      'Best on Hard ' + OR.Utils.formatTime(52000),
    OR.Bests.timeText('shard-speedway', 'hard'));

  check('records survive a reload',
    (function () {
      const reloaded = boot(storage);
      return reloaded.Save.bests()['shard-speedway'].hard.timeMs === 52000 &&
        reloaded.Bests.bestLap('mesh-highway', 'normal') === 23000;
    })());

  check('the difficulty table and the save agree on the active track',
    (function () {
      const game = boot(storage);
      game.Track.use(game.trackById('shard-speedway'));
      game.Difficulty.select('hard');
      const onShard = game.Difficulty.best('hard');
      game.Track.use(game.trackById('flexnode'));
      return onShard === 52000 && game.Difficulty.best('hard') === 0;
    })(), 'shard-speedway hard');
}

/* ========================== 5. export / import ============================= */

section('export and import');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  OR.Save.setProfile({ name: 'Export Test', color: 'amber' });
  OR.Save.recordRace({ timeMs: 40000, place: 2 });
  OR.Bests.record('flexnode', 'easy', { timeMs: 45000, lapMs: 15000 });
  OR.Save.setSelection('shard-speedway', 'hard');

  const blob = OR.Save.export();
  check('export produces a Base64 string',
    typeof blob === 'string' && blob.length > 40 && !/[^A-Za-z0-9+/=]/.test(blob),
    blob.slice(0, 24) + '… (' + blob.length + ' chars)');

  const restored = boot(fakeStorage()).Save.import(blob);
  check('import accepts the exported string', restored.ok === true);

  const target = boot(fakeStorage());
  const imported = target.Save.import(blob);
  check('import restores the profile, stats, records and selections',
    imported.ok === true &&
    target.Save.profile().name === 'Export Test' &&
    target.Save.profile().color === 'amber' &&
    target.Save.stats().races === 1 &&
    target.Save.stats().podiums === 1 &&
    target.Bests.bestTime('flexnode', 'easy') === 45000 &&
    target.Save.selection().track === 'shard-speedway' &&
    target.Save.selection().difficulty === 'hard',
    target.Save.profile().name + ' / ' + target.Bests.bestTime('flexnode', 'easy'));

  check('an imported save is written out, so it survives a reload',
    (function () {
      const storage2 = fakeStorage();
      boot(storage2).Save.import(blob);
      const reloaded = boot(storage2);
      return reloaded.Save.profile().name === 'Export Test' &&
        reloaded.Save.stats().races === 1 &&
        reloaded.Bests.bestTime('flexnode', 'easy') === 45000;
    })());

  check('a pasted save with line breaks and spaces still imports',
    (function () {
      const messy = blob.replace(/(.{20})/g, '$1\n  ');
      return boot(fakeStorage()).Save.import(messy).ok === true;
    })());

  check('junk is refused without touching the current save',
    (function () {
      const before = JSON.stringify(OR.Save.load());
      const bad = OR.Save.import('this is not a save!!!');
      const empty = OR.Save.import('');
      const missing = OR.Save.import(undefined);
      return bad.ok === false && empty.ok === false && missing.ok === false &&
        JSON.stringify(OR.Save.load()) === before &&
        typeof bad.error === 'string' && bad.error.length > 10;
    })());

  check('a save from a newer version is refused, not half-read',
    (function () {
      const future = Buffer.from(JSON.stringify({ version: 99, profile: { name: 'Future' } }))
        .toString('base64');
      const result = OR.Save.import(future);
      return result.ok === false && /newer version/.test(result.error) &&
        OR.Save.profile().name === 'Export Test';
    })());
}

/* ============================== 6. reset =================================== */

section('reset progress');
{
  const storage = fakeStorage();
  const OR = boot(storage);
  OR.Save.setProfile({ name: 'Keeper', color: 'crimson' });
  OR.Save.recordRace({ timeMs: 39000, place: 1 });
  OR.Bests.record('flexnode', 'normal', { timeMs: 39000, lapMs: 12500 });

  OR.Save.reset();
  check('reset clears stats, records and XP',
    OR.Save.stats().races === 0 && OR.Save.stats().wins === 0 &&
    OR.Save.stats().podiums === 0 && OR.Save.stats().totalTimeMs === 0 &&
    OR.Bests.bestTime('flexnode', 'normal') === 0 &&
    Object.keys(OR.Save.bests()).length === 0 &&
    OR.Save.xp() === 0 && OR.Save.level() === 1,
    OR.Save.stats().races + ' races, ' + OR.Save.xp() + ' XP');

  check('reset keeps the profile name and colour',
    OR.Save.profile().name === 'Keeper' &&
    OR.Save.profile().color === 'crimson');

  check('a reset save stays reset after a reload',
    (function () {
      const reloaded = boot(storage);
      return reloaded.Save.stats().races === 0 &&
        reloaded.Bests.bestTime('flexnode', 'normal') === 0 &&
        reloaded.Save.profile().name === 'Keeper';
    })());
}

/* ======================= 7. migrations and bad data ======================== */

section('migrations and corrupt data');
{
  const OR = boot(fakeStorage());
  /* Step 7 wrote a flat { difficulty: ms } table; Step 8 wrote per track. */
  const flat = fakeStorage();
  flat.data[OR.CONFIG.difficulty.keys.best] =
    JSON.stringify({ easy: 47000, normal: 39999, hard: 37000 });
  const migrated = boot(flat);
  check('Step 7 flat records migrate into the save, on FLEXNODE',
    migrated.Save.bests().flexnode.normal.timeMs === 39999 &&
    migrated.Save.bests().flexnode.hard.timeMs === 37000 &&
    migrated.Save.bests().flexnode.easy.timeMs === 47000,
    JSON.stringify(migrated.Save.bests().flexnode));

  const table = fakeStorage();
  table.data[OR.CONFIG.track.keys.best] = JSON.stringify({
    'mesh-highway': { normal: { timeMs: 46000, lapMs: 22000 } }
  });
  const perTrack = boot(table);
  check('Step 8 per-track records migrate with their lap times',
    perTrack.Save.bests()['mesh-highway'].normal.timeMs === 46000 &&
    perTrack.Save.bests()['mesh-highway'].normal.lapMs === 22000);

  const both = fakeStorage();
  both.data[OR.CONFIG.track.keys.best] = JSON.stringify({
    flexnode: { normal: { timeMs: 40000, lapMs: 13000 } }
  });
  both.data[OR.CONFIG.difficulty.keys.best] = JSON.stringify({ normal: 99999 });
  const merged = boot(both);
  check('the newer table wins when both legacy keys exist',
    merged.Save.bests().flexnode.normal.timeMs === 40000,
    String(merged.Save.bests().flexnode.normal.timeMs));

  check('legacy selections still decide the first boot',
    (function () {
      const legacy = fakeStorage();
      legacy.data[OR.CONFIG.track.keys.selection] = 'shard-speedway';
      legacy.data[OR.CONFIG.difficulty.keys.selection] = 'hard';
      const game = boot(legacy);
      return game.Save.selection().track === 'shard-speedway' &&
        game.Save.selection().difficulty === 'hard' &&
        game.Difficulty.currentId() === 'hard';
    })());

  const corrupt = fakeStorage();
  corrupt.data[OR.CONFIG.profile.keys.save] = '{{{ not json at all';
  check('a corrupt save falls back to defaults and does not throw',
    (function () {
      try {
        const game = boot(corrupt);
        return game.Save.profile().name === 'Racer' &&
          game.Save.stats().races === 0;
      } catch (error) {
        return false;
      }
    })());

  const wrongTypes = fakeStorage();
  wrongTypes.data[OR.CONFIG.profile.keys.save] = JSON.stringify({
    version: 1,
    profile: 42,
    stats: 'lots',
    bests: [1, 2, 3],
    selection: 'everywhere'
  });
  check('wrong types inside the save are replaced with sane values',
    (function () {
      try {
        const game = boot(wrongTypes);
        return game.Save.profile().name === 'Racer' &&
          game.Save.stats().races === 0 &&
          Object.keys(game.Save.bests()).length === 0 &&
          game.Save.selection().track === null;
      } catch (error) {
        return false;
      }
    })());

  const partial = fakeStorage();
  partial.data[OR.CONFIG.profile.keys.save] = JSON.stringify({
    version: 1,
    profile: { name: 'Half' },
    stats: { races: 4, wins: 9, podiums: 2 },
    bests: { flexnode: { normal: { timeMs: 'nope', lapMs: 12000 } } }
  });
  check('a partial save is repaired: missing keys, impossible counts, bad times',
    (function () {
      const game = boot(partial);
      const stats = game.Save.stats();
      return game.Save.profile().name === 'Half' &&
        game.Save.profile().color === 'violet' &&
        stats.races === 4 && stats.wins <= stats.races && stats.podiums >= stats.wins &&
        game.Bests.bestTime('flexnode', 'normal') === 0 &&
        game.Bests.bestLap('flexnode', 'normal') === 12000;
    })(), JSON.stringify(boot(partial).Save.stats()));

  const future = fakeStorage();
  future.data[OR.CONFIG.profile.keys.save] = JSON.stringify({ version: 99, profile: { name: 'Future' } });
  check('a save from a future version is ignored, not misinterpreted',
    boot(future).Save.profile().name === 'Racer');

  check('a version 1 save upgrades to version 3 without losing anything',
    (function () {
      const v1 = fakeStorage();
      v1.data[OR.CONFIG.profile.keys.save] = JSON.stringify({
        version: 1,
        profile: { name: 'Nine', color: 'mint' },
        stats: { races: 7, wins: 3, podiums: 5, totalTimeMs: 300000 },
        bests: { flexnode: { normal: { timeMs: 41000, lapMs: 13000 } } },
        selection: { track: 'flexnode', difficulty: 'normal' }
      });
      const game = boot(v1);
      const upgraded = JSON.parse(v1.data[OR.CONFIG.profile.keys.save]);
      return game.Save.load().version === 3 && upgraded.version === 3 &&
        game.Save.profile().name === 'Nine' &&
        game.Save.stats().races === 7 && game.Save.stats().wins === 3 &&
        game.Bests.bestTime('flexnode', 'normal') === 41000 &&
        game.Save.selection().difficulty === 'normal' &&
        game.Save.xp() === 0 && game.Save.level() === 1;
    })());

  check('the game still runs end to end with storage blocked',
    (function () {
      try {
        const game = blockedStorage();
        game.Save.setProfile({ name: 'Offline', color: 'cyan' });
        game.Save.recordRace({ timeMs: 42000, place: 1 });
        game.Bests.record('flexnode', 'normal', { timeMs: 42000, lapMs: 14000 });
        game.Difficulty.select('hard');
        const blob = game.Save.export();
        return game.Save.profile().name === 'Offline' &&
          game.Save.stats().races === 1 &&
          game.Bests.bestTime('flexnode', 'normal') === 42000 &&
          game.Difficulty.currentId() === 'hard' &&
          typeof blob === 'string' && blob.length > 20;
      } catch (error) {
        return false;
      }
    })());
}

/* =============================== summary ================================== */

console.log('\n' + '-'.repeat(56));
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
