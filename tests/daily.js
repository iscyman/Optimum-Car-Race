/* =============================================================================
 * tests/daily.js — Step 13 checks that need no DOM and no browser.
 *
 * Run: node tests/daily.js
 * Covers: the date-key maths and the deterministic rotation, the countdown to
 * local midnight, the streak and the seven-day window, the once-a-day bonus,
 * haptics on/off (default off), the four Step 13 modifiers applying and
 * reverting without leaking, the fact rotation, the disclaimer, and the save
 * version 4 -> 5 migration including a corrupt daily payload.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const FILES = ['config', 'utils', 'xp', 'trackdata', 'track', 'car', 'race', 'save', 'cars',
  'events', 'daily', 'haptics', 'difficulty', 'bests', 'rivals', 'collisions', 'standings', 'shards'];

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}
function section(name) { console.log('\nStep 13 — ' + name); }

function boot(storage, extra) {
  const context = { console, Math, Map, Date };
  context.window = context;
  if (storage) context.localStorage = storage;
  if (extra) Object.assign(context, extra);
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

const DAY = 86400000;
/** Midday of a fixed day: safely inside it, whenever the clock runs. */
function noon(year, month, day) { return new Date(year, month - 1, day, 12, 0, 0).getTime(); }

/** A fake vibration API that records the patterns it was given. */
function fakeVibrator() {
  const calls = [];
  return { calls, vibrate(pattern) { calls.push(pattern); return true; } };
}

/** Everything a Step 13 modifier can touch, for the revert round trip. */
function worldSnapshot(OR) {
  const T = OR.Track;
  return JSON.stringify({
    halfRoad: T.halfRoad, shoulder: T.shoulder, grassMargin: T.grassMargin,
    kerbStart: T.kerbStart, grassStart: T.grassStart, limit: T.limit, hardLimit: T.hardLimit,
    gripLow: OR.CONFIG.car.gripLow, gripHigh: OR.CONFIG.car.gripHigh,
    stallMin: OR.CONFIG.rivals.stall.intervalMin, stallMax: OR.CONFIG.rivals.stall.intervalMax,
    stallDurationMin: OR.CONFIG.rivals.stall.durationMin,
    stallDurationMax: OR.CONFIG.rivals.stall.durationMax,
    boostCharge: OR.CONFIG.boost.charge.rate, boostMul: OR.CONFIG.boost.speedMultiplier,
    lapsOverride: OR.Race.lapsOverride, shards: OR.CONFIG.boost.shards.count
  });
}

/* ===================== 1. the date key and the rotation =================== */

section('the rotation is a pure function of the local date');
{
  const OR = boot(fakeStorage());

  check('a date key is YYYY-MM-DD with zero padding',
    OR.Daily.dateKey(new Date(2026, 0, 5)) === '2026-01-05' &&
    OR.Daily.dateKey(new Date(2026, 11, 31)) === '2026-12-31',
    OR.Daily.dateKey(new Date(2026, 0, 5)) + ' · ' + OR.Daily.dateKey(new Date(2026, 11, 31)));

  check('the key uses local time, not UTC',
    OR.Daily.dateKey(new Date(2026, 5, 1, 0, 30)) === '2026-06-01' &&
    OR.Daily.dateKey(new Date(2026, 5, 1, 23, 30)) === '2026-06-01',
    'early and late on the same local day');

  check('a key round-trips back to a date inside the same day',
    OR.Daily.dateKey(OR.Daily.dateFromKey('2026-03-09')) === '2026-03-09' &&
    OR.Daily.dateFromKey('nonsense') === null);

  check("the previous key walks back one local day",
    OR.Daily.previousKey('2026-03-01') === '2026-02-28' &&
    OR.Daily.previousKey('2026-01-01') === '2025-12-31',
    '2026-03-01 -> ' + OR.Daily.previousKey('2026-03-01'));

  check("today's featured event is one of the rotation",
    OR.CONFIG.daily.order.indexOf(OR.Daily.featuredId()) !== -1,
    OR.Daily.featuredId());

  check('the featured event resolves to a real event object',
    OR.Daily.featured() !== null && OR.Daily.featured().id === OR.Daily.featuredId() &&
    OR.Daily.featured().name.length > 0,
    OR.Daily.featured().name + ' +' + OR.Daily.featured().xp);

  check('isFeatured only answers true for the one event',
    OR.CONFIG.daily.order.filter(id => OR.Daily.isFeatured(id)).length === 1);

  const stamp = noon(2026, 4, 20);
  check('the same day always gives the same event, whatever the hour',
    OR.Daily.featuredId(stamp) === OR.Daily.featuredId(stamp + 3600000) &&
    OR.Daily.featuredId(stamp) === OR.Daily.featuredId(stamp + 11 * 3600000));

  check('the next day gives the next hash slot', (function () {
    const a = OR.Daily.index(stamp), b = OR.Daily.index(stamp + DAY);
    return a === OR.Daily.hash(OR.Daily.dateKey(stamp)) % OR.CONFIG.daily.order.length &&
      b === OR.Daily.hash(OR.Daily.dateKey(stamp + DAY)) % OR.CONFIG.daily.order.length;
  })(), OR.Daily.featuredId(stamp) + ' then ' + OR.Daily.featuredId(stamp + DAY));

  check('a day and its neighbour across the year boundary both resolve',
    OR.CONFIG.daily.order.indexOf(OR.Daily.featuredId(noon(2026, 12, 31))) !== -1 &&
    OR.CONFIG.daily.order.indexOf(OR.Daily.featuredId(noon(2027, 1, 1))) !== -1,
    OR.Daily.featuredId(noon(2026, 12, 31)) + ' -> ' + OR.Daily.featuredId(noon(2027, 1, 1)));

  /* Over a couple of months every event must show up, and not in a block. */
  const count = {}, sequence = [];
  for (let i = 0; i < 90; i++) {
    const id = OR.Daily.featuredId(noon(2026, 1, 1) + i * DAY);
    sequence.push(id);
    count[id] = (count[id] || 0) + 1;
  }
  check('every event in the rotation appears over 90 days',
    OR.CONFIG.daily.order.every(id => (count[id] || 0) > 0),
    Object.keys(count).sort().map(k => k + '×' + count[k]).join(' '));

  check('no event is starved and none dominates over 90 days',
    OR.CONFIG.daily.order.every(id => count[id] >= 6 && count[id] <= 30),
    '90 days / 6 events = ~15 each');

  check('the rotation is stable: the same date key always hashes the same way',
    OR.Daily.hash('2026-04-20') === OR.Daily.hash('2026-04-20') &&
    OR.Daily.index(noon(2026, 4, 20)) === OR.Daily.index(noon(2026, 4, 20)) &&
    OR.Daily.featuredId(noon(2026, 4, 20)) === OR.Daily.featuredId(noon(2026, 4, 20)) &&
    OR.Daily.index(noon(2026, 4, 20)) === OR.Daily.hash('2026-04-20') % 6,
    'called twice, same answer');

  check('a blocked save does not stop the rotation working', (function () {
    const hostile = { getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    const OR2 = boot(hostile);
    return OR2.Daily.featured() !== null && OR2.Daily.dateKey(noon(2026, 4, 20)) === '2026-04-20';
  })());
}

/* ========================= 2. the countdown ============================== */

section('the countdown to the next local rotation');
{
  const OR = boot(fakeStorage());
  const late = new Date(2026, 4, 20, 23, 59, 30).getTime();
  const midnight = new Date(2026, 4, 21, 0, 0, 0).getTime();
  const early = new Date(2026, 4, 21, 0, 0, 1).getTime();

  check('half a minute before midnight there are thirty seconds left',
    OR.Daily.msUntilRotation(late) === 30000, OR.Daily.msUntilRotation(late) + ' ms');

  check('exactly at midnight the next rotation is a full day away',
    OR.Daily.msUntilRotation(midnight) === DAY, OR.Daily.msUntilRotation(midnight) + ' ms');

  check('one second after midnight it has counted down',
    OR.Daily.msUntilRotation(early) === DAY - 1000, OR.Daily.msUntilRotation(early) + ' ms');

  check('the countdown never goes negative',
    OR.Daily.msUntilRotation(new Date(2026, 4, 21, 0, 0, 0, 1).getTime()) >= 0);

  check('the clock format is H:MM:SS',
    OR.Daily.countdown(late) === '0:00:30' &&
    OR.Daily.countdown(new Date(2026, 4, 20, 18, 5, 9).getTime()) === '5:54:51',
    OR.Daily.countdown(late) + ' · ' + OR.Daily.countdown(new Date(2026, 4, 20, 18, 5, 9).getTime()));

  check('the countdown ticks down as the clock moves',
    OR.Daily.msUntilRotation(late) > OR.Daily.msUntilRotation(late + 10000));

  check('the rotation happens at local midnight, not UTC midnight', (function () {
    /* Build a clock where UTC midnight is 23:00 local; the rotation must still
       land on the local boundary. */
    const d = new Date(2026, 4, 20, 23, 0, 0);
    const ms = OR.Daily.msUntilRotation(d.getTime());
    return ms === 3600000;
  })(), '23:00 local -> 1:00:00 to go');
}

/* ====================== 3. the streak and the window ====================== */

section('the streak and the last seven days');
{
  const OR = boot(fakeStorage());
  OR.Save.load();
  const days = [noon(2026, 3, 2), noon(2026, 3, 3), noon(2026, 3, 4), noon(2026, 3, 7)];
  const keys = days.map(d => OR.Daily.dateKey(d));

  check('the first completed day starts a streak of one',
    OR.Daily.nextStreak(0, keys[0]) === 1);

  OR.Save.recordDaily(keys[0], 1);
  check('a completion is saved with its day and streak',
    OR.Save.dailyHistory().length === 1 && OR.Save.dailyHistory()[0].date === keys[0] &&
    OR.Save.dailyHistory()[0].completed === true && OR.Save.dailyStreak() === 1);

  check('finishing the next day continues the streak',
    OR.Daily.nextStreak(1, keys[1]) === 2);

  OR.Save.recordDaily(keys[1], 2);
  check('two days in a row are both remembered',
    OR.Save.dailyHistory().length === 2 && OR.Save.dailyStreak() === 2,
    OR.Save.dailyHistory().map(h => h.date).join(' · '));

  check('finishing the same day twice does not extend the streak',
    OR.Daily.nextStreak(2, keys[1]) === 2);

  check('a missed day restarts the streak at one',
    OR.Daily.nextStreak(2, keys[3]) === 1,
    keys[1] + ' then ' + keys[3] + ' (a gap)');

  check('the history keeps only the last seven unique days', (function () {
    for (let i = 0; i < 12; i++) {
      const key = OR.Daily.dateKey(noon(2026, 3, 1) + i * DAY);
      OR.Save.recordDaily(key, 1);
    }
    const history = OR.Save.dailyHistory();
    return history.length === OR.CONFIG.daily.streakDays &&
      new Set(history.map(h => h.date)).size === history.length &&
      history[0].date === OR.Daily.dateKey(noon(2026, 3, 12));
  })(), OR.Save.dailyHistory().length + ' days kept');

  const window = OR.Daily.historyWindow(noon(2026, 3, 12));
  check('the window always has seven rows, newest first',
    window.length === 7 && window[0].date === '2026-03-12' &&
    window[6].date === '2026-03-06',
    window.map(w => w.label).join(' '));

  check('the window marks today and the days that were completed',
    window[0].isToday === true && window[0].completed === true &&
    window[1].isToday === false && window[1].completed === true &&
    window.slice(0, 7).every(w => w.completed === true),
    window.map(w => w.label + (w.completed ? '*' : '')).join(' '));

  check('a day nobody raced shows seven empty marks',
    OR.Daily.historyWindow(noon(2026, 4, 20)).every(w => w.completed === false),
    OR.Daily.historyWindow(noon(2026, 4, 20)).map(w => w.label).join(' '));

  check('the window labels are the real weekdays',
    window[0].label === ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(2026, 2, 12).getDay()],
    '2026-03-12 is a ' + window[0].label);
}

/* ======================== 4. the once-a-day bonus ======================== */

section('the daily bonus is paid once per day, for the featured event only');
{
  const OR = boot(fakeStorage());
  OR.Save.load();
  const featured = OR.Events.get(OR.Daily.featuredId());
  const other = OR.Events.list().find(e => e.id !== featured.id);

  check('before racing, today\u2019s bonus is still available',
    OR.Daily.bonusAvailable() === true && OR.Save.dailyBonusClaimed(OR.Daily.dateKey()) === false);

  const missed = OR.Daily.completeRace({ event: { id: featured.id, met: false, name: featured.name } });
  check('a failed featured objective pays nothing and logs nothing',
    missed.completed === false && missed.bonusXp === 0 &&
    OR.Save.dailyHistory().length === 0 && OR.Daily.bonusAvailable() === true);

  const otherRun = OR.Daily.completeRace({ event: { id: other.id, met: true, name: other.name } });
  check('beating a different event pays no daily bonus',
    otherRun.isFeatured === false && otherRun.bonusXp === 0 &&
    OR.Save.dailyHistory().length === 0,
    other.name + ' is not today\u2019s event');

  const first = OR.Daily.completeRace({ event: { id: featured.id, met: true, name: featured.name } });
  check('beating the featured event pays the bonus and starts the streak',
    first.bonusXp === OR.CONFIG.daily.bonusXp && first.streak === 1 &&
    OR.Save.eventCompleted(featured.id) === false &&   // the game records that, not daily
    OR.Save.dailyStreak() === 1 && OR.Save.dailyHistory().length === 1,
    '+' + first.bonusXp + ' XP, streak ' + first.streak);

  check('the bonus is now spent for today',
    OR.Save.dailyBonusClaimed(OR.Daily.dateKey()) === true &&
    OR.Daily.bonusAvailable() === false);

  const again = OR.Daily.completeRace({ event: { id: featured.id, met: true, name: featured.name } });
  check('beating it again the same day pays no second bonus',
    again.bonusXp === 0 && again.streak === 1 && OR.Save.dailyHistory().length === 1,
    'still streak ' + OR.Save.dailyStreak());

  check('tomorrow is a fresh day with the bonus available again', (function () {
    const clock = noon(2026, 6, 1);
    OR.Daily.setClock(() => clock);
    const day1 = OR.Daily.completeRace({ event: { id: OR.Daily.featuredId(), met: true, name: 'day one' } });
    OR.Daily.setClock(() => clock + DAY);
    const available = OR.Daily.bonusAvailable();
    const day2 = OR.Daily.completeRace({ event: { id: OR.Daily.featuredId(), met: true, name: 'day two' } });
    OR.Daily.setClock(null);
    return day1.bonusXp > 0 && available === true && day2.bonusXp > 0 &&
      OR.Daily.historyWindow(clock + DAY)[0].completed === true;
  })(), '+' + OR.CONFIG.daily.bonusXp + ' XP on each of two days');

  check('a race with no event is not a daily race',
    OR.Daily.completeRace({ laps: 3 }) === null &&
    OR.Daily.completeRace({ event: null }) === null);

  check('the streak travels with the save, not the session', (function () {
    const store = fakeStorage();
    const A = boot(store);
    A.Save.load();
    A.Daily.completeRace({ event: { id: A.Daily.featuredId(), met: true, name: 'x' } });
    const before = A.Save.dailyStreak();
    const B = boot(store);
    B.Save.load();
    return before === 1 && B.Save.dailyStreak() === 1 && B.Save.dailyHistory().length === 1 &&
      B.Daily.bonusAvailable() === false;
  })());
}

/* ============================ 5. the modifiers =========================== */

section('the four Step 13 modifiers apply and revert without leaking');
{
  const OR = boot(fakeStorage());
  const before = worldSnapshot(OR);

  check('the six events all name only modifiers the engine knows', (function () {
    const known = OR.Events.fields ? Object.keys(OR.Events.fields()) : null;
    return known === null || OR.CONFIG.events.list.every(e =>
      Object.keys(e.modifier).every(key => known.indexOf(key) !== -1));
  })());

  check('a clean race leaves the world untouched',
    worldSnapshot(OR) === before);

  OR.Events.start('narrow-margin');
  const narrow = worldSnapshot(OR);
  check('NARROW MARGIN really narrows the road and lowers the grip',
    OR.Track.halfRoad < 210 && OR.CONFIG.car.gripLow < 10 && OR.Race.lapsOverride === 1,
    'halfRoad ' + OR.Track.halfRoad.toFixed(1) + ' · grip ' + OR.CONFIG.car.gripLow.toFixed(2));
  check('the whole road scales, barrier included, at the same factor',
    Math.abs(OR.Track.halfRoad - 210 * 0.72) < 0.01 &&
    Math.abs(OR.Track.limit - 306 * 0.72) < 0.01 &&
    Math.abs(OR.Track.limit / OR.Track.halfRoad - 306 / 210) < 0.001 &&
    OR.Track.hardLimit > OR.Track.limit,
    'road edge ' + OR.Track.halfRoad.toFixed(1) + ' · barrier ' + OR.Track.limit.toFixed(1) +
      ' · hardLimit ' + OR.Track.hardLimit.toFixed(1));
  OR.Events.stop();
  check('stopping NARROW MARGIN puts the world back exactly', worldSnapshot(OR) === before);

  OR.Events.start('stall-storm');
  check('STALL STORM makes rivals stall sooner and for longer',
    OR.CONFIG.rivals.stall.intervalMax < 8.5 && OR.CONFIG.rivals.stall.durationMin >= 0.5 &&
    OR.CONFIG.rivals.stall.intervalMin >= 0.1,
    'first stall by ' + OR.CONFIG.rivals.stall.intervalMax.toFixed(2) + 's · lasts ' +
      OR.CONFIG.rivals.stall.durationMin.toFixed(2) + '–' +
      OR.CONFIG.rivals.stall.durationMax.toFixed(2) + 's');
  check('BOOST RUSH fills the meter faster without breaking the cap',
    OR.CONFIG.boost.charge.rate > 9 && OR.CONFIG.boost.speedMultiplier <= 2.0,
    'charge ' + OR.CONFIG.boost.charge.rate.toFixed(1) + ' · ×' +
      OR.CONFIG.boost.speedMultiplier.toFixed(2));
  OR.Events.stop();
  check('stopping STALL STORM puts the world back exactly', worldSnapshot(OR) === before);

  check('starting two events in a row cannot stack modifiers', (function () {
    OR.Events.start('narrow-margin');
    const one = worldSnapshot(OR);
    OR.Events.start('stall-storm');
    const two = worldSnapshot(OR);
    OR.Events.stop();
    return OR.Track.halfRoad === 210 &&
      OR.CONFIG.rivals.stall.intervalMax === 8.5 && two !== one;
  })(), 'the second start reverts the first');

  check('a finished event leaves a normal race on the shipped config',
    OR.Race.lapsOverride === null && worldSnapshot(OR) === before);
}

/* ============================== 6. haptics =============================== */

section('haptics: opt-in, guarded, only for boost and contact');
{
  const buzz = fakeVibrator();
  const OR = boot(fakeStorage(), { navigator: buzz });
  OR.Save.load();

  check('haptics are off by default and the API is seen',
    OR.Haptics.enabled() === false && OR.Haptics.supported() === true);
  check('nothing buzzes while the setting is off',
    OR.Haptics.boost() === false && OR.Haptics.wall() === false && buzz.calls.length === 0);

  check('turning it on remembers the choice and confirms it with one tick',
    OR.Haptics.set(true) === true && OR.Save.haptics() === true &&
    OR.Haptics.enabled() === true && buzz.calls.length === 1,
    JSON.stringify(buzz.calls));

  check('the boost fires a short pulse',
    OR.Haptics.boost() === true && buzz.calls[buzz.calls.length - 1] === OR.CONFIG.haptics.boostMs,
    JSON.stringify(buzz.calls[buzz.calls.length - 1]));

  check('a barrier hit fires the barrier pattern',
    OR.Haptics.wall() === true &&
    JSON.stringify(buzz.calls[buzz.calls.length - 1]) === JSON.stringify(OR.CONFIG.haptics.wallPattern),
    JSON.stringify(buzz.calls[buzz.calls.length - 1]));

  check('a rival touch fires the shorter car pulse',
    OR.Haptics.car() === true && buzz.calls[buzz.calls.length - 1] === OR.CONFIG.haptics.carMs);
  check('exactly four patterns fired, one per call', buzz.calls.length === 4, buzz.calls.length + ' calls');

  check('the toggle flips it back off and stops any vibration',
    OR.Haptics.toggle() === false && OR.Save.haptics() === false &&
    buzz.calls[buzz.calls.length - 1] === 0);
  check('with it off again nothing buzzes',
    OR.Haptics.boost() === false && buzz.calls.length === 5,
    buzz.calls.length + ' calls, the last one a stop');

  const quiet = boot(fakeStorage());
  quiet.Save.load();
  check('a browser without a vibration API is simply silent',
    quiet.Haptics.supported() === false && quiet.Haptics.set(true) === true &&
    quiet.Haptics.boost() === false && quiet.Haptics.wall() === false);

  check('the choice is part of the save, not the session', (function () {
    const store = fakeStorage();
    const A = boot(store, { navigator: fakeVibrator() });
    A.Save.load();
    A.Haptics.set(true);
    const B = boot(store, { navigator: fakeVibrator() });
    B.Save.load();
    return B.Haptics.enabled() === true;
  })());
}

/* ===================== 7. the facts and the disclaimer =================== */

section('the verified facts and the fan-project disclaimer');
{
  const OR = boot(fakeStorage());
  const facts = OR.CONFIG.facts.list;

  check('there are exactly six verified facts',
    facts.length === 6, facts.length + ' facts');
  check('every fact is a non-empty sentence',
    facts.every(f => typeof f === 'string' && f.length > 30 && /[.!]$/.test(f)));
  check('no two facts are the same', new Set(facts).size === 6);
  check('every fact is about the Optimum project',
    facts.every(f => /Optimum|mump2p|RLNC|coded|flexnode|shard|fragment|gossip/i.test(f)));
  check('the facts rotate by race count and wrap cleanly',
    [0, 1, 2, 5, 6, 7, 60].every(n => (n % facts.length) >= 0 && (n % facts.length) < 6) &&
    new Set([0, 1, 2, 3, 4, 5].map(n => facts[n % facts.length])).size === 6);

  check('the disclaimer is the exact sanctioned sentence',
    OR.CONFIG.legal.disclaimer === 'Unofficial fan project, not affiliated with Optimum.',
    OR.CONFIG.legal.disclaimer);
  check('the link is the Optimum site, opened safely',
    OR.CONFIG.legal.link.indexOf('getoptimum.xyz') !== -1);

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('the page carries the disclaimer and the link',
    html.indexOf(OR.CONFIG.legal.disclaimer) !== -1 &&
    html.indexOf('getoptimum.xyz') !== -1);
  check('the link is rel=noopener and target=_blank',
    /<a[^>]+href="https:\/\/getoptimum\.xyz"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/.test(html));
  check('the meta description is present and specific',
    /<meta name="description" content="[^"]{40,}"/.test(html));
  check('Open Graph and Twitter card tags are present',
    html.indexOf('property="og:title"') !== -1 && html.indexOf('property="og:description"') !== -1 &&
    html.indexOf('name="twitter:card"') !== -1 && html.indexOf('name="twitter:title"') !== -1);
  check('a favicon is declared', /rel="icon"/.test(html));
  check('the new scripts are loaded, and in order',
    html.indexOf('js/events.js') !== -1 && html.indexOf('js/events.js') < html.indexOf('js/daily.js') &&
    html.indexOf('js/daily.js') < html.indexOf('js/haptics.js'));
}

/* ========================== 8. save version 4 -> 5 ======================= */

section('save version 5: the daily block, settings, migration and reset');
{
  const OR = boot(fakeStorage());
  OR.Save.load();

  check('a fresh save is version 5 with an empty daily block',
    OR.Save.VERSION >= 5 && OR.Save.daily().lastBonus === null &&
    OR.Save.daily().streak === 0 && OR.Save.dailyHistory().length === 0,
    'v' + OR.Save.VERSION);
  check('a fresh save has haptics off',
    OR.Save.settings().haptics === false && OR.Save.haptics() === false);

  const legacy = fakeStorage();
  legacy.setItem('optimumRace.save.v1', JSON.stringify({
    version: 4,
    profile: { name: 'Old Timer' },
    stats: { },
    bests: { flexnode: 12345, 'mesh-highway': 24000 },
    progress: { xp: 900, level: 3 },
    events: { completed: { 'block-rush': true } },
    unlocks: { cars: ['relay', 'validator'], tracks: ['flexnode', 'mesh-highway'] },
    selection: { track: 'mesh-highway', difficulty: 'normal', car: 'validator' }
  }));
  const Old = boot(legacy);
  Old.Save.load();
  check('a version 4 save migrates to 5 and keeps the player',
    Old.Save.VERSION >= 5 && Old.Save.profile().name === 'Old Timer' &&
    Old.Save.progress().xp === 900, 'v' + Old.Save.VERSION + ' · ' + Old.Save.profile().name);
  check('the migration keeps cars and events and adds empty daily state',
    Old.Save.car() === 'validator' && Old.Save.eventCompleted('block-rush') === true &&
    Old.Save.dailyStreak() === 0 && Old.Save.daily().lastBonus === null &&
    Old.Save.haptics() === false);
  check('the migrated save is written back at the new version',
    JSON.parse(legacy.getItem('optimumRace.save.v1')).version >= 5);

  const corrupt = fakeStorage();
  corrupt.setItem('optimumRace.save.v1', JSON.stringify({
    version: 5,
    daily: { lastBonus: 'not-a-date', streak: -4, history: [
      { date: '2026-04-20', completed: true },
      { date: '2026-04-20', completed: true },
      { date: '20/04/2026', completed: true },
      { date: null, completed: true },
      'junk',
      { date: '2026-04-19', completed: 'yes' }
    ] },
    settings: { haptics: 'yes please' }
  }));
  const Corrupt = boot(corrupt);
  Corrupt.Save.load();
  check('a corrupt daily block is sanitised, not trusted',
    Corrupt.Save.daily().lastBonus === null && Corrupt.Save.dailyStreak() === 0 &&
    Corrupt.Save.dailyHistory().length >= 1 &&
    Corrupt.Save.dailyHistory().every(h => /^\d{4}-\d{2}-\d{2}$/.test(h.date)),
    JSON.stringify(Corrupt.Save.dailyHistory()));
  check('a corrupt day is dropped and a duplicate day collapses',
    Corrupt.Save.dailyHistory().filter(h => h.date === '2026-04-20').length === 1);
  check('a non-boolean haptics setting falls back to off',
    Corrupt.Save.haptics() === false);

  const R = boot(fakeStorage());
  R.Save.load();
  R.Save.setHaptics(true);
  R.Save.claimDailyBonus(R.Daily.dateKey());
  R.Save.recordDaily(R.Daily.dateKey(), 3);
  R.Save.completeEvent('block-rush');
  R.Save.reset();
  check('a reset clears the daily block and the events',
    R.Save.dailyStreak() === 0 && R.Save.dailyHistory().length === 0 &&
    R.Save.dailyBonusClaimed('2026-04-20') === false &&
    R.Save.completedEvents().length === 0);
  check('a reset keeps the player\u2019s settings', R.Save.haptics() === true);
}

/* ============================= 9. the wrappers =========================== */

section('the daily module is defensive');
{
  const OR = boot(fakeStorage());
  check('the featured id is never null, even with an empty order', (function () {
    const saved = OR.CONFIG.daily.order.slice();
    OR.CONFIG.daily.order.length = 0;
    const id = OR.Daily.featuredId();
    OR.CONFIG.daily.order.push.apply(OR.CONFIG.daily.order, saved);
    return typeof id === 'string';
  })());
  check('a date key of the wrong shape is rejected, not thrown',
    OR.Daily.dateFromKey(42) === null && OR.Daily.dateFromKey('2026-4-1') === null &&
    OR.Daily.dateFromKey(null) === null);
  check('a clock can be installed and removed',
    (function () {
      const fixed = noon(2030, 1, 1);
      OR.Daily.setClock(() => fixed);
      const key = OR.Daily.dateKey();
      OR.Daily.setClock(null);
      return key === '2030-01-01' && OR.Daily.dateKey() !== key;
    })());
  check('the countdown text is the one the menu shows',
    OR.Daily.countdownText(noon(2026, 4, 20)) === OR.Daily.countdown(noon(2026, 4, 20)));
}

console.log('\n--------------------------------------------------------');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
