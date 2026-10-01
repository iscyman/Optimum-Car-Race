/* =============================================================================
 * tests/smoke.js — headless smoke test for Optimum Race (Steps 1 to 6).
 *
 * Runs the real game files inside jsdom with a stubbed 2D canvas context so the
 * full loop (input -> physics -> state machine -> HUD) can be exercised without
 * a browser.  Run with:  node tests/smoke.js
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['config', 'utils', 'xp', 'trackdata', 'track', 'car', 'race', 'save', 'difficulty', 'bests', 'rivals', 'collisions', 'standings', 'shards', 'input', 'audio', 'renderer', 'hud', 'game', 'trackselect', 'main']
  .map(f => path.join(ROOT, 'js', f + '.js'));

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name + (extra ? '  (' + extra + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '  (' + extra + ')' : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

/* ---- stub 2D context ----------------------------------------------------- */
function makeContext(canvas) {
  const grad = { addColorStop() {} };
  const base = {
    canvas: canvas,
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: [] }),
    setTransform() {}, save() {}, restore() {}
  };
  return new Proxy(base, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return function () { return undefined; };
    },
    set(t, prop, value) { t[prop] = value; return true; }
  });
}

/* ---- boot ---------------------------------------------------------------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/'
});
const win = dom.window;

win.HTMLCanvasElement.prototype.getContext = function () {
  if (!this.__ctx) this.__ctx = makeContext(this);
  return this.__ctx;
};
// jsdom has no layout: give the canvas a real size.
win.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
  return { width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0 };
};
win.devicePixelRatio = 1;

/* jsdom has no Path2D. Step 5 builds the circuit with Path2D objects, so give
   it a stub that records nothing — the stubbed 2D context ignores its input. */
win.Path2D = function Path2D() {
  this.moveTo = this.lineTo = this.closePath = this.arc = this.rect = this.ellipse =
    function () {};
};

FILES.forEach(file => win.eval(fs.readFileSync(file, 'utf8')));

const OR = win.OR;
const Game = OR.Game;
const Input = OR.Input;
const Track = OR.Track;
const Renderer = OR.Renderer;
const HUD = OR.HUD;
const Race = OR.Race;
const CONFIG = OR.CONFIG;
const doc = win.document;

function runTests() {
// Take manual control of the loop.
win.cancelAnimationFrame(Game._raf);
const STEP = CONFIG.race.fixedStep;
// Stable race seeds; rendering randomness must not make regressions flaky.
win.Math.random = OR.Utils.mulberry32(20261001);

/** Isolated handling/input probes exclude traffic impulses deliberately. */
function withoutContact(fn) {
  const enabled = CONFIG.collisions.enabled;
  CONFIG.collisions.enabled = false;
  try { return fn(); } finally { CONFIG.collisions.enabled = enabled; }
}

/**
 * Step 5 made the track a closed loop, so there is no finish line to run past
 * and nothing has to be teleported back. `LOOP` survives for the few sections
 * that want a clean lap count.
 */
const LOOP = { keepRacing: false };

function guard() {
  /* nothing to do on a closed circuit — kept so the sections read the same */
}

/** Track helper: nearest sample, keeping the car's lookup hint up to date. */
function near(x, y) {
  // cold lookup on purpose: the tests teleport the car, so a stale hint is
  // not trustworthy. (The game itself always passes a hint.)
  const info = Track.nearest(x === undefined ? Game.car.x : x,
                             y === undefined ? Game.car.y : y, null);
  Game.car.trackHint = info.index;
  return info;
}

/** Signed distance of the car from the centreline (right of travel positive). */
function carOffset() {
  return near().offset;
}

function advance(seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    guard();
    Game.step(STEP);
  }
}
function key(code, down) {
  win.dispatchEvent(new win.KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
}
function pressSpace() {
  key('Space', true);
  key('Space', false);
}
function render() {
  Game.render(STEP);
}
/** Put the car back in the middle of the road so wall contact stops skewing tests. */
function recenter() {
  const info = near();
  Game.car.x = info.point.x;
  Game.car.y = info.point.y;
  Game.car.heading = Math.atan2(info.tx, -info.ty);
}

/**
 * Drive for `seconds` while steering back toward the racing line, the way a
 * player would: aim at the centreline a little way ahead, then steer toward it
 * and let the car's grip pull it round. `offset` keeps the car at a fixed
 * distance from the centreline, which is how the surface tests stay on the
 * kerb or the grass on purpose. Throttle / brake stay under the control of
 * whatever key events the test dispatched, so the keyboard path is still what
 * is being exercised. Returns the top speed seen on each surface.
 */
function steerTo(seconds, offset, aim) {
  aim = aim === undefined ? 260 : aim;
  const top = { road: 0, kerb: 0, grass: 0 };
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    guard();
    const car = Game.car;
    const ahead = Track.pointAhead(car.x, car.y, aim, car.trackHint);
    const tx = ahead.x + ahead.nx * offset;         // offset: right of travel
    const ty = ahead.y + ahead.ny * offset;
    const want = Math.atan2(tx - car.x, -(ty - car.y));   // heading at the target
    let err = want - car.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    Input._keys.left = err < -0.012;
    Input._keys.right = err > 0.012;
    Game.step(STEP);
    if (car.speed > top[car.surface]) top[car.surface] = car.speed;
  }
  Input._keys.left = false;
  Input._keys.right = false;
  return top;
}
/** One step of the racing-line autopilot; used by the lap driving loops. */
function autoSteerStep(aim) {
  aim = aim === undefined ? 260 : aim;
  guard();
  const car = Game.car;
  const ahead = Track.pointAhead(car.x, car.y, aim, car.trackHint);
  const want = Math.atan2(ahead.x - car.x, -(ahead.y - car.y));
  let err = want - car.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  Input._keys.left = err < -0.012;
  Input._keys.right = err > 0.012;
  Game.step(STEP);
  Input._keys.left = false;
  Input._keys.right = false;
}

function autoSteer(seconds, aim) {
  return steerTo(seconds, 0, aim);
}

/** Hold full lock for a moment from a clean 900 u/s and report the sideways speed. */
function slipProbe(seconds) {
  place(900);
  key('ArrowRight', true);
  advance(seconds === undefined ? 0.45 : seconds);
  key('ArrowRight', false);
  return Math.abs(Game.car.vLat);
}

/**
 * Park the car in the middle of the road at a given speed, for physics probes.
 * `heading` is an offset from the direction of travel: 0 follows the circuit,
 * +0.5 rad points it at the right-hand barrier.
 */
function place(speed, heading) {
  const car = Game.car;
  const info = near();
  car.trackHint = info.index;
  car.x = info.point.x;
  car.y = info.point.y;
  car.heading = Math.atan2(info.tx, -info.ty) + (heading || 0);
  car.steerInput = 0;
  car.steerRaw = 0;
  const v = speed || 0;
  car.vx = info.tx * v;
  car.vy = info.ty * v;
  car.speed = v;
}

/**
 * Park the car at a fraction of the way round the lap, on the centreline,
 * optionally angled `headingOffset` from the direction of travel.
 */
function placeAt(fraction, speed, headingOffset) {
  const p = Track.pointAt(fraction * Track.length);
  const car = Game.car;
  car.trackHint = p.index;
  car.x = p.x;
  car.y = p.y;
  car.heading = Math.atan2(p.tx, -p.ty) + (headingOffset || 0);
  car.steerInput = 0;
  car.steerRaw = 0;
  const v = speed || 0;
  car.vx = p.tx * v;
  car.vy = p.ty * v;
  car.speed = v;
}

/**
 * Drive out of the road edge on the start straight (the long one, so a fixed
 * heading holds) and report the top speed seen on each surface on the way.
 * The car clips the kerb band, then runs onto the grass, then reaches the
 * barrier — exactly the way a player finds out what a surface costs.
 */
function surfaceSweep(seconds, angle) {
  const top = { road: 0, kerb: 0, grass: 0 };
  placeAt(0.02, 700, angle === undefined ? 0.2 : angle);
  key('ArrowUp', true);
  const n = Math.round((seconds || 2.6) / STEP);
  for (let i = 0; i < n; i++) {
    Game.step(STEP);
    if (Game.car.speed > top[Game.car.surface]) top[Game.car.surface] = Game.car.speed;
  }
  key('ArrowUp', false);
  return top;
}

/** Drive into a barrier on the start straight and report what happened. */
function barrierRun(angle, seconds) {
  placeAt(0.02, 600, angle);
  key('ArrowUp', true);
  let hit = false;
  let maxOffset = 0;
  const n = Math.round((seconds || 2.5) / 0.1);
  for (let i = 0; i < n; i++) {
    advance(0.1);
    if (Game.car.hitWall) hit = true;
    maxOffset = Math.max(maxOffset, Math.abs(carOffset()));
  }
  key('ArrowUp', false);
  return { hit: hit, maxOffset: maxOffset };
}

/** How far the car turns in 0.4 s of full lock at a given speed. */
function measureTurn(speed) {
  place(speed);
  Game.car.steerInput = 1;      // wheel already turned, so this is the steady rate
  const h0 = Game.car.heading;
  Input._keys.right = true;
  const n = Math.round(0.4 / STEP);
  for (let i = 0; i < n; i++) Game.step(STEP);
  Input._keys.right = false;
  return Game.car.heading - h0;
}

/* =========================== 1. main menu ================================= */
section('1. Main menu');
check('game boots into the menu state', Game.state === 'menu', Game.state);
check('title reads OPTIMUM RACE', doc.querySelector('.title').textContent.trim() === 'OPTIMUM RACE');
check('subtitle reads Race. React. Win.',
  doc.querySelector('.subtitle').textContent.trim() === 'Race. React. Win.');
check('START RACE button exists', !!doc.getElementById('startBtn'));
check('the menu badge shows no build-step wording',
  (function () {
    const badge = doc.querySelector('#menuScreen .badge');
    return badge && !/step|prototype|demo/i.test(badge.textContent);
  })(), doc.querySelector('#menuScreen .badge').textContent.trim());
check('menu screen visible, HUD hidden',
  !doc.getElementById('menuScreen').classList.contains('hidden') &&
  doc.getElementById('hud').classList.contains('hidden'));

/* =========================== 2. start race ================================ */
section('2. Start race');
doc.getElementById('startBtn').click();
check('clicking START RACE enters countdown', Game.state === 'countdown', Game.state);
check('car starts in its staggered grid slot, behind the line',
  Race.progress < 0 && Race.progress > -0.05 && Game.car.gridSlot === 0 &&
  Game.car.speed === 0 && Track.isOnRoad(Game.car.x, Game.car.y),
  'x=' + Game.car.x.toFixed(1) + ' y=' + Game.car.y.toFixed(1));
check('race timer is still zero', Game.raceTimeMs === 0);

advance(CONFIG.race.countdownSeconds + 0.05);
check('countdown ends and racing begins', Game.state === 'racing', Game.state);
check('HUD is visible while racing', !doc.getElementById('hud').classList.contains('hidden'));

/* =========================== 3. acceleration ============================== */
section('3. Acceleration');
// Steps 1–5 handling probes measure the engine, not rival impact impulses.
CONFIG.collisions.enabled = false;
const speed0 = Game.car.speed;
key('ArrowUp', true);
advance(1.0);
const speed1 = Game.car.speed;
check('Arrow Up accelerates the car', speed1 > speed0 + 100, 'v=' + speed1.toFixed(0));
key('ArrowUp', false);
key('KeyW', true);
advance(1.0);
check('W also accelerates', Game.car.speed > speed1, 'v=' + Game.car.speed.toFixed(0));
key('KeyW', false);

// Hold the throttle long enough to reach the speed ceiling.
key('ArrowUp', true);
autoSteer(8.0);
check('speed is capped at the maximum',
  Game.car.vLong <= CONFIG.car.maxSpeed + 0.001 &&
  Game.car.vLong > CONFIG.car.maxSpeed * 0.9,
  'v=' + Game.car.vLong.toFixed(0) + '/' + CONFIG.car.maxSpeed);
key('ArrowUp', false);

/* =========================== 4. braking =================================== */
section('4. Braking');
key('ArrowUp', true);
autoSteer(3.0);
key('ArrowUp', false);
const beforeBrake = Game.car.speed;
key('ArrowDown', true);
autoSteer(0.5);
const afterBrake = Game.car.speed;
check('Arrow Down brakes hard', afterBrake < beforeBrake - 300,
  beforeBrake.toFixed(0) + ' -> ' + afterBrake.toFixed(0));
key('ArrowDown', false);

key('ArrowUp', true);
autoSteer(2.0);
key('ArrowUp', false);
const beforeS = Game.car.speed;
key('KeyS', true);
autoSteer(0.3);
key('KeyS', false);
check('S also brakes', Game.car.speed < beforeS - 100,
  beforeS.toFixed(0) + ' -> ' + Game.car.speed.toFixed(0));

key('ArrowUp', true);
autoSteer(1.5);
key('ArrowUp', false);
const coastStart = Game.car.speed;
autoSteer(0.6);
check('car coasts down when nothing is held',
  Game.car.speed < coastStart && Game.car.speed >= 0,
  coastStart.toFixed(0) + ' -> ' + Game.car.speed.toFixed(0));

/* =========================== 5. steering ================================== */
section('5. Steering');
key('ArrowUp', true);
autoSteer(2.0);
key('ArrowUp', false);

// steering turns the HEADING; grip then carries the car round, so these
// probes start from a clean, centred car pointing up the road.
place(600);
const hLeft0 = Game.car.heading;
const xLeftStart = carOffset();
const leftFrame = (function () {
  const h = Game.car.heading;
  return { x: Game.car.x, y: Game.car.y, rx: Math.cos(h), ry: Math.sin(h) };
})();
key('ArrowLeft', true);
advance(0.5);
key('ArrowLeft', false);
check('Arrow Left turns the car left', Game.car.heading < hLeft0 - 0.05,
  'heading ' + (hLeft0 * 180 / Math.PI).toFixed(0) + ' -> ' +
  (Game.car.heading * 180 / Math.PI).toFixed(0) + ' deg');
const leftMove = (Game.car.x - leftFrame.x) * leftFrame.rx +
                 (Game.car.y - leftFrame.y) * leftFrame.ry;
check('steering left moves the car left', leftMove < -20,
  'moved ' + leftMove.toFixed(0) + ' u to its own left');

place(600);
const hRight0 = Game.car.heading;
const xRightStart = carOffset();
const rightFrame = (function () {
  const h = Game.car.heading;
  return { x: Game.car.x, y: Game.car.y, rx: Math.cos(h), ry: Math.sin(h) };
})();
key('KeyD', true);
advance(0.5);
key('KeyD', false);
check('D turns the car right', Game.car.heading > hRight0 + 0.05,
  'heading ' + (hRight0 * 180 / Math.PI).toFixed(0) + ' -> ' +
  (Game.car.heading * 180 / Math.PI).toFixed(0) + ' deg');
const rightMove = (Game.car.x - rightFrame.x) * rightFrame.rx +
                  (Game.car.y - rightFrame.y) * rightFrame.ry;
check('steering right moves the car right', rightMove > 20,
  'moved ' + rightMove.toFixed(0) + ' u to its own right');

const lowSpeedTurn = Math.abs(measureTurn(150));
const highSpeedTurn = Math.abs(measureTurn(860));
check('steering is tighter at low speed than at high speed',
  lowSpeedTurn > highSpeedTurn * 1.5,
  lowSpeedTurn.toFixed(2) + ' rad vs ' + highSpeedTurn.toFixed(2) + ' rad per 0.4 s');

// stop the car, then try to steer: nothing should happen
place(0);
const hStopped = Game.car.heading;
key('ArrowLeft', true);
withoutContact(() => advance(1.0));
key('ArrowLeft', false);
check('no steering while the car is stationary',
  Game.car.speed < 5 && Math.abs(Game.car.heading - hStopped) < 1e-9,
  'v=' + Game.car.speed.toFixed(1) + ' dh=' + (Game.car.heading - hStopped).toExponential(1));

// point the car at each barrier on the long start straight and drive into it
const rightWall = barrierRun(0.5);
check('the car reaches the right-hand barrier', rightWall.hit,
  'max offset ' + rightWall.maxOffset.toFixed(0) + ' of ' + Track.hardLimit);
check('the barrier holds the car inside the track',
  rightWall.maxOffset <= Track.hardLimit + 0.001,
  'max offset ' + rightWall.maxOffset.toFixed(0) + ' hard limit=' + Track.hardLimit);
check('soft bounce: the car keeps driving while scraping the barrier',
  Game.car.vLong > 80, 'vLong=' + Game.car.vLong.toFixed(0));

let alignErr = Game.car.heading - Math.atan2(near().tx, -near().ty);
while (alignErr > Math.PI) alignErr -= Math.PI * 2;
while (alignErr < -Math.PI) alignErr += Math.PI * 2;
check('the car is nudged parallel to the track instead of wedging',
  Math.abs(alignErr) < 0.8,
  'heading vs track=' + (alignErr * 180 / Math.PI).toFixed(1) + ' deg');

// it must be able to drive itself off the barrier again
placeAt(0.02, 600, 0.5);
key('ArrowUp', true);
key('ArrowLeft', true);
let escaped = false;
for (let i = 0; i < 30; i++) {
  advance(0.1);
  if (Math.abs(carOffset()) < Track.limit - 40) escaped = true;
}
key('ArrowLeft', false);
key('ArrowUp', false);
check('the car can drive away from the barrier', escaped,
  'offset=' + carOffset().toFixed(1));

// and into the left-hand barrier
const leftWall = barrierRun(-0.5);
check('the car reaches the left-hand barrier', leftWall.hit);
check('the left barrier holds the car inside the track',
  leftWall.maxOffset <= Track.hardLimit + 0.001,
  'max offset ' + leftWall.maxOffset.toFixed(0));
check('the car never escapes the playable area',
  Math.abs(carOffset()) <= Track.hardLimit + 0.001);

/* =========================== 6. coded boost ============================== */
section('6. Coded boost (meter, threshold, drain, cooldown)');
const BOOST = CONFIG.boost;
check('a fresh car starts with the configured meter charge',
  new OR.Car().meter === BOOST.startMeter,
  BOOST.startMeter + '/' + BOOST.meterMax + ' (the car in this section has been charging)');
check('boost starts unused', Game.car.boost.used === 0);

key('ArrowUp', true);
autoSteer(4.0);
check('the car is at speed', Game.car.speed > CONFIG.car.maxSpeed * 0.9,
  'v=' + Game.car.speed.toFixed(0));

Game.car.meter = BOOST.meterMax;
pressSpace();
autoSteer(0.4);            // the boost needs a moment to push past the ceiling
check('Space triggers the boost', Game.car.boost.active && Game.car.boost.used === 1);
check('boost raises the speed ceiling above maxSpeed',
  Game.car.speed > CONFIG.car.maxSpeed * 1.1, 'v=' + Game.car.speed.toFixed(0) +
  ' of a ' + Math.round(CONFIG.car.maxSpeed * CONFIG.boost.speedMultiplier) + ' u/s ceiling');

pressSpace();
check('boost cannot be spammed mid-boost', Game.car.boost.used === 1);

const meterDuring = Game.car.meter;
autoSteer(0.4);
check('boosting drains the meter', Game.car.meter < meterDuring,
  meterDuring.toFixed(1) + ' -> ' + Game.car.meter.toFixed(1));

// a full meter buys about 1.5 s
autoSteer(1.4);
check('a full meter lasts about 1.5 seconds of boost', !Game.car.boost.active,
  'ended with ' + Game.car.meter.toFixed(1) + ' left');

check('a cooldown starts when the boost ends', Game.car.boost.cooldown > 0,
  Game.car.boost.cooldown.toFixed(2) + 's');
check('boost is not ready during the cooldown', !Game.car.boostReady());
pressSpace();
check('boost cannot fire during the cooldown', Game.car.boost.used === 1);

autoSteer(BOOST.cooldown + 0.1);
check('the cooldown runs out', Game.car.boost.cooldown === 0);
key('ArrowUp', false);

check('Shift also fires the boost', (function () {
  Game.car.meter = 60;
  Game.car.boost.cooldown = 0;
  const before = Game.car.boost.used;
  key('ShiftLeft', true);
  Game.step(STEP);
  key('ShiftLeft', false);
  const ok = Game.car.boost.active && Game.car.boost.used === before + 1;
  Game.car.boost.active = false;
  Game.car.boost.cooldown = 0;
  return ok;
})());

check('boost cannot start below the threshold', (function () {
  Game.car.meter = BOOST.threshold - 1;
  Game.car.boost.cooldown = 0;
  const before = Game.car.boost.used;
  pressSpace();
  Game.step(STEP);
  return !Game.car.boost.active && Game.car.boost.used === before;
})(), 'meter at ' + (BOOST.threshold - 1) + '%, threshold ' + BOOST.threshold + '%');

check('boost does start at the threshold', (function () {
  Game.car.meter = BOOST.threshold;
  Game.car.boost.cooldown = 0;
  const before = Game.car.boost.used;
  pressSpace();
  Game.step(STEP);
  const ok = Game.car.boost.active && Game.car.boost.used === before + 1;
  Game.car.boost.active = false;
  Game.car.boost.cooldown = 0;
  Game.car.meter = BOOST.startMeter;
  return ok;
})());

/* =========================== 7. timer ===================================== */
section('7. Race timer');
const t0 = Game.raceTimeMs;
advance(1.0);
const t1 = Game.raceTimeMs;
check('timer advances while racing', Math.abs((t1 - t0) - 1000) < 25,
  OR.Utils.formatTime(t0) + ' -> ' + OR.Utils.formatTime(t1));
check('timer is formatted mm:ss.mmm', /^\d{2}:\d{2}\.\d{3}$/.test(doc.getElementById('timerValue').textContent),
  doc.getElementById('timerValue').textContent);

/* =========================== 8. laps and the flag ========================= */
section('8. Laps, checkpoints and the finish line');
LOOP.keepRacing = false;            // let the car drive a full lap for real
Game.startRace();                   // a clean race so the lap times are real
advance(CONFIG.race.countdownSeconds + 0.05);
const boostsBefore = Game.car.boost.used;
Game.car.meter = 50;                // make sure a boost is affordable
key('ArrowUp', true);

// drive forward until the first lap is scored
let laps = 0;
for (let i = 0; i < 60 * 120 && laps === 0; i++) {
  autoSteerStep();
  laps = Race.lapTimes.length;
}
key('ArrowUp', false);
check('crossing the line completes lap 1 of 3',
  laps === 1 && Race.lap === 2, 'lap=' + Race.lap + ', times=' + laps);
check('the lap time is recorded', Race.lapTimes[0] > 5000,
  OR.Utils.formatTime(Race.lapTimes[0]));
check('the best lap is set from the first lap', Race.bestLapMs === Race.lapTimes[0]);
check('the race keeps going after a lap', Game.state === 'racing', Game.state);
check('lap progress carries on past the line instead of jumping',
  Race.progress >= 1 && Race.progress < 1.2,
  'progress=' + Race.progress.toFixed(3));
check('the checkpoints reset for the new lap', Race.nextCheckpoint === 0);

// second lap
key('ArrowUp', true);
for (let i = 0; i < 60 * 120 && Race.lapTimes.length < 2; i++) autoSteerStep();
key('ArrowUp', false);
check('lap 2 is recorded as well', Race.lapTimes.length === 2 && Race.lap === 3,
  'lap=' + Race.lap);
check('the best lap is the quicker of the two',
  Race.bestLapMs === Math.min(Race.lapTimes[0], Race.lapTimes[1]),
  Race.lapTimes.map(t => OR.Utils.formatTime(t)).join(' vs '));

// final lap: this one ends the race
key('ArrowUp', true);
for (let i = 0; i < 60 * 120 && !Race.finished; i++) autoSteerStep();
key('ArrowUp', false);
check('the third lap ends the race', Race.finished && Race.lapTimes.length === 3,
  'laps=' + Race.lapTimes.length);
check('the clock stops at the flag', Game.finalTimeMs > 0,
  OR.Utils.formatTime(Game.finalTimeMs));
const frozen = Game.finalTimeMs;
advance(0.2);
check('the timer no longer moves after the flag', Game.finalTimeMs === frozen);
check('the car coasts after the flag instead of stopping dead',
  Game.coasting === true && Game.state === 'racing',
  'state=' + Game.state + ' coasting=' + Game.coasting);

advance(CONFIG.race.finishDelayMs / 1000 + 0.3);
check('the results screen appears after the coast-out',
  Game.state === 'finished' &&
  !doc.getElementById('finishScreen').classList.contains('hidden'), Game.state);
check('results contain the time, laps and splits',
  Game.results &&
  Game.results.timeMs > 0 &&
  Game.results.lapTimes.length === CONFIG.race.laps &&
  Game.results.bestLapMs > 0 &&
  Game.results.maxSpeedKmh > 0 &&
  Game.results.boostsUsed >= boostsBefore,
  JSON.stringify({
    time: OR.Utils.formatTime(Game.results.timeMs),
    best: OR.Utils.formatTime(Game.results.bestLapMs),
    lapTimes: Game.results.lapTimes.map(t => OR.Utils.formatTime(t)),
    max: Math.round(Game.results.maxSpeedKmh) + ' km/h'
  }));
check('the total time equals the sum of the lap times',
  Math.abs(Game.results.timeMs - Game.results.lapTimes.reduce((a, b) => a + b, 0)) < 40,
  OR.Utils.formatTime(Game.results.timeMs) + ' vs ' +
  OR.Utils.formatTime(Game.results.lapTimes.reduce((a, b) => a + b, 0)));
check('finish screen shows RACE FINISHED!',
  doc.querySelector('#finishScreen .title').textContent.trim() === 'RACE FINISHED!');
check('finish screen shows the total time',
  doc.getElementById('finalTime').textContent === OR.Utils.formatTime(Game.results.timeMs));
check('finish screen shows the best lap',
  doc.getElementById('finalBestLap').textContent === OR.Utils.formatTime(Game.results.bestLapMs),
  doc.getElementById('finalBestLap').textContent);
check('finish screen lists a split per lap',
  doc.querySelectorAll('#lapSplits .split').length === CONFIG.race.laps,
  doc.querySelectorAll('#lapSplits .split').length + ' rows');
check('the best lap is highlighted in the splits',
  doc.querySelectorAll('#lapSplits .split.is-best').length === 1,
  doc.querySelectorAll('#lapSplits .split.is-best').length + ' highlighted');
check('finish screen shows max speed and boosts used',
  /km\/h$/.test(doc.getElementById('finalTopSpeed').textContent) &&
  doc.getElementById('finalBoosts').textContent === String(Game.results.boostsUsed),
  doc.getElementById('finalTopSpeed').textContent + ' / ' +
  doc.getElementById('finalBoosts').textContent + ' boosts');

/* =========================== 9. race again ================================ */
section('9. Race again');
doc.getElementById('againBtn').click();
check('RACE AGAIN restarts into countdown', Game.state === 'countdown', Game.state);
check('car is reset to its grid slot', Race.progress < 0 &&
  Game.car.gridSlot === 0 && Game.car.speed === 0);
check('timer is reset', Game.raceTimeMs === 0);
check('boost counter is reset', Game.car.boost.used === 0);
check('finish screen hidden again', doc.getElementById('finishScreen').classList.contains('hidden'));

/* ================= 10. Step 2 handling, surfaces and effects ============= */
section('10. Step 2 — grip, drift, surfaces, camera, marks, audio');
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);

/* ---- grip and drift ------------------------------------------------------ */
key('ArrowUp', true);
autoSteer(2.0);
key('ArrowUp', false);

place(900);
key('ArrowRight', true);
advance(0.45);
const driftLat = Math.abs(Game.car.vLat);
const driftSlip = Math.abs(Game.car.slip);
check('hard cornering at speed breaks traction into a slide',
  Game.car.drifting && driftLat > CONFIG.car.driftThreshold,
  'vLat=' + driftLat.toFixed(0) + ' slip=' + (driftSlip * 180 / Math.PI).toFixed(1) + ' deg');
key('ArrowRight', false);

const latBeforeGrip = Math.abs(Game.car.vLat);
advance(0.5);
check('grip pulls the car straight again once you stop steering',
  Math.abs(Game.car.vLat) < latBeforeGrip * 0.4,
  latBeforeGrip.toFixed(0) + ' -> ' + Math.abs(Game.car.vLat).toFixed(0) + ' u/s sideways');

const lowSpeedSlip = (function () {
  place(180);
  key('ArrowRight', true);
  withoutContact(() => advance(0.45));
  key('ArrowRight', false);
  return Math.abs(Game.car.vLat);
})();
check('low-speed cornering stays planted (no slide)',
  lowSpeedSlip < CONFIG.car.driftThreshold,
  'vLat=' + lowSpeedSlip.toFixed(1) + ' at 180 u/s');

/* ---- surfaces ------------------------------------------------------------ */
const probe = near();
check('the asphalt is the middle of the road',
  Track.surface(probe.point.x, probe.point.y) === 'road');
check('the kerb sits outside the asphalt',
  Track.surface(probe.point.x + probe.nx * (Track.kerbStart + 12),
                probe.point.y + probe.ny * (Track.kerbStart + 12)) === 'kerb');
check('grass sits outside the kerb',
  Track.surface(probe.point.x + probe.nx * (Track.grassStart + 12),
                probe.point.y + probe.ny * (Track.grassStart + 12)) === 'grass');
check('the barrier limit is beyond the grass',
  Track.limit > Track.grassStart, 'limit=' + Track.limit);

const sweep = surfaceSweep();
check('the road is the fastest surface',
  sweep.road > sweep.kerb && sweep.kerb > sweep.grass,
  'road ' + sweep.road.toFixed(0) + ' > kerb ' + sweep.kerb.toFixed(0) +
  ' > grass ' + sweep.grass.toFixed(0));
check('driving on the grass slows the car strongly',
  sweep.grass > 0 && sweep.grass < CONFIG.car.maxSpeed * 0.62,
  'top speed on grass ' + sweep.grass.toFixed(0) +
  ' vs ' + sweep.road.toFixed(0) + ' on the road');
check('the kerb is a mild penalty compared with the grass',
  sweep.kerb > 0 && sweep.kerb > sweep.grass * 1.2,
  'kerb ' + sweep.kerb.toFixed(0) + ' vs grass ' + sweep.grass.toFixed(0));

/* ---- handling really is config driven ------------------------------------ */
const savedMax = CONFIG.car.maxSpeed;
CONFIG.car.maxSpeed = 420;
place(0);
key('ArrowUp', true);
autoSteer(6.0);
key('ArrowUp', false);
check('editing CONFIG.car.maxSpeed changes the car',
  Game.car.vLong > 410 && Game.car.vLong <= 420.5, 'v=' + Game.car.vLong.toFixed(0));
CONFIG.car.maxSpeed = savedMax;

const savedGrip = CONFIG.car.gripHigh;
CONFIG.car.gripHigh = 0.5;
const looseSlip = slipProbe(0.45);
CONFIG.car.gripHigh = savedGrip;
const grippySlip = slipProbe(0.45);
check('editing the grip config changes how much the car slides',
  looseSlip > grippySlip * 1.2,
  'gripHigh 0.5 -> ' + looseSlip.toFixed(0) + ' u/s sideways, ' +
  'gripHigh ' + savedGrip + ' -> ' + grippySlip.toFixed(0));

/* ---- camera -------------------------------------------------------------- */
place(800);
Renderer.updateCamera(Game.car, 0.5, true);
const laSp = Math.hypot(Game.car.vx, Game.car.vy) || 1;
const laFx = Game.car.vx / laSp, laFy = Game.car.vy / laSp;
const laForward = Renderer.view.laX * laFx + Renderer.view.laY * laFy;
const laSideways = Renderer.view.laX * -laFy + Renderer.view.laY * laFx;
check('camera looks ahead in the direction of travel',
  laForward > 200 && Math.abs(laSideways) < laForward * 0.6,
  'forward ' + laForward.toFixed(0) + ', sideways ' + laSideways.toFixed(0));

// and it leans back toward the racing line when the car runs wide
place(800);
const laN = near();
Game.car.x -= laN.nx * 300;
Game.car.y -= laN.ny * 300;
Renderer.updateCamera(Game.car, 0.5, true);
const lean = Renderer.view.laX * laN.nx + Renderer.view.laY * laN.ny;
check('the camera leans toward the racing line when the car runs wide',
  lean > 30, 'lean ' + lean.toFixed(0));

// and it keeps the car on screen through a long cornering run
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
key('ArrowUp', true);
let worstScreenOffset = 0;
for (let i = 0; i < 120; i++) {
  autoSteer(0.1);
  Renderer.updateCamera(Game.car, 0.1);      // the renderer owns the camera
  const view = Renderer.view;
  worstScreenOffset = Math.max(worstScreenOffset, Math.abs(Game.car.x - view.camX) * view.scale);
}
key('ArrowUp', false);
check('the camera keeps the car inside the middle of the screen',
  worstScreenOffset < Renderer.view.w * 0.35,
  'worst offset ' + worstScreenOffset.toFixed(0) + 'px of ' + Renderer.view.w + 'px');

/* ---- tire marks ---------------------------------------------------------- */
Renderer.marks.length = 0;
place(900);
key('ArrowRight', true);
advance(0.5);
key('ArrowRight', false);
check('tire marks are laid down while drifting',
  Renderer.marks.length > 0, Renderer.marks.length + ' marks');

for (let i = 0; i < CONFIG.effects.tireMarks.max + 120; i++) {
  Renderer.marks.push({ x: 0, y: 0, dx: 0, dy: 0, life: 1, maxLife: 1 });
}
place(900);
key('ArrowRight', true);
advance(0.2);
key('ArrowRight', false);
check('the tire mark list is capped for performance',
  Renderer.marks.length <= CONFIG.effects.tireMarks.max,
  Renderer.marks.length + ' marks, cap ' + CONFIG.effects.tireMarks.max);

Renderer.marks.length = 0;
place(900);
key('ArrowRight', true);
advance(0.4);
key('ArrowRight', false);
const marksLaid = Renderer.marks.length;
place(0);   // stop the car so nothing new is laid down
check('tire marks are left on the road after the drift',
  marksLaid > 0 && Renderer.marks.length === marksLaid, marksLaid + ' marks');
advance(CONFIG.effects.tireMarks.life + 0.3);
check('tire marks fade away again',
  Renderer.marks.length === 0, marksLaid + ' marks -> ' + Renderer.marks.length);

// braking hard also marks the road
Renderer.marks.length = 0;
place(900);
key('ArrowDown', true);
advance(0.5);
key('ArrowDown', false);
check('braking hard leaves marks too', Renderer.marks.length > 0,
  Renderer.marks.length + ' marks');

/* ---- engine sound (Web Audio, no files) ---------------------------------- */
const soundBtn = doc.querySelector('[data-action="sound"]');
check('a sound toggle is visible', !!soundBtn);
check('sound is off by default', OR.Audio.isEnabled() === false);
soundBtn.click();
check('the sound toggle turns audio on', OR.Audio.isEnabled() === true);
check('the toggle shows its state in the UI',
  soundBtn.classList.contains('is-on') &&
  soundBtn.querySelector('.sound-label').textContent === 'SOUND ON');
let audioError = null;
try {
  for (let i = 0; i < 30; i++) Game.step(STEP);   // jsdom has no Web Audio
} catch (err) {
  audioError = err;
}
check('the game runs even when Web Audio is unavailable', !audioError,
  audioError ? audioError.message : 'no AudioContext in jsdom, handled');
soundBtn.click();
check('the sound toggle turns audio back off', OR.Audio.isEnabled() === false);
check('the toggle label follows suit',
  soundBtn.querySelector('.sound-label').textContent === 'SOUND OFF');

Game.startRace();   // hand a fresh countdown to the next section

/* ================= 11. Step 3 — coded boost and shards =================== */
section('11. Step 3 — meter charging, shards, cooldown UI, effects');
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);

/* ---- the meter at the start of a race ----------------------------------- */
check('a new race starts with a part-charged meter',
  Game.car.meter === CONFIG.boost.startMeter, Game.car.meter + '/100');
check('the shard layout is built', OR.Shards.items.length === CONFIG.boost.shards.count,
  OR.Shards.items.length + ' shards');
check('shards start uncollected', OR.Shards.remaining() === OR.Shards.items.length);

/* ---- charging on the road at speed -------------------------------------- */
key('ArrowUp', true);
autoSteer(3.0);                       // get to speed; charging is already live
const chargedFrom = Game.car.meter;
autoSteer(1.5);
const chargeGain = Game.car.meter - chargedFrom;
check('the meter charges while driving on the road at speed',
  chargeGain > 5, '+' + chargeGain.toFixed(1) + ' in 1.5 s at ' +
  (Game.car.speed / CONFIG.car.maxSpeed * 100).toFixed(0) + '% speed');

/**
 * Charge rule probe: one second of charge on a given surface at a given speed,
 * with no steering involved. The real-driving check above proves charging works
 * at speed; this proves the per-surface and per-speed rules exactly.
 */
function chargeOn(surface, ratio, drifting) {
  const car = Game.car;
  car.meter = 50;
  car.surface = surface;
  car.speed = CONFIG.car.maxSpeed * ratio;
  car.drifting = !!drifting;
  car._chargeMeter(1.0);
  return car.meter - 50;
}
const chargeRoad = chargeOn('road', 1.0);
const chargeKerb = chargeOn('kerb', 1.0);
const chargeGrass = chargeOn('grass', 1.0);
const chargeSlow = chargeOn('road', CONFIG.boost.charge.speedRatio - 0.1);
const chargeDrift = chargeOn('road', 1.0, true);

check('the meter charges on the road at speed', chargeRoad > 0,
  '+' + chargeRoad.toFixed(1) + ' per second at full speed');
check('the meter does not charge on the grass at all', chargeGrass === 0,
  '+' + chargeGrass.toFixed(1) + ' per second');
check('the kerb charges at the reduced rate',
  chargeKerb > 0 && chargeKerb < chargeRoad, '+' + chargeKerb.toFixed(1) +
  ' on the kerb vs +' + chargeRoad.toFixed(1) + ' on the road');
check('the meter does not charge below the speed threshold', chargeSlow === 0,
  '+' + chargeSlow.toFixed(2) + ' per second at ' +
  Math.round((CONFIG.boost.charge.speedRatio - 0.1) * 100) + '% speed');
check('sliding sideways charges more slowly', chargeDrift < chargeRoad,
  '+' + chargeDrift.toFixed(1) + ' while drifting vs +' + chargeRoad.toFixed(1));

Game.car.meter = 50;
key('ArrowUp', false);
key('ArrowDown', true);
autoSteer(3.0);                            // brake all the way to a stop
key('ArrowDown', false);
autoSteer(0.5);                            // let it settle below the threshold
Game.car.meter = 50;
autoSteer(1.5);
check('the meter does not charge at low speed',
  Game.car.speed < CONFIG.car.maxSpeed * CONFIG.boost.charge.speedRatio &&
  Game.car.meter === 50,
  'v=' + Game.car.speed.toFixed(0) + ' meter=' + Game.car.meter.toFixed(1));

/* ---- shard pickups ------------------------------------------------------- */
OR.Shards.reset();                        // a clean slate: nothing collected yet
const shard = OR.Shards.items.find(s => !s.taken);
Game.car.meter = 10;
Game.car.x = shard.x;
Game.car.y = shard.y;
Game.car.vx = 0;
Game.car.vy = -400;
Game.step(STEP);
check('driving over a shard collects it', shard.taken === true);
check('a shard adds its value to the meter',
  Game.car.meter === 10 + CONFIG.boost.shards.value,
  '10 + ' + CONFIG.boost.shards.value + ' = ' + Game.car.meter.toFixed(0));
check('the collected count goes up', OR.Shards.collected === 1 &&
  OR.Shards.remaining() === OR.Shards.items.length - 1,
  OR.Shards.collected + ' collected, ' + OR.Shards.remaining() + ' left');

Game.step(STEP);
check('a collected shard cannot be collected twice',
  OR.Shards.collected === 1 && Game.car.meter <= 10 + CONFIG.boost.shards.value + 0.001);

Game.car.meter = 95;
const shard2 = OR.Shards.items.find(s => !s.taken);
Game.car.x = shard2.x;
Game.car.y = shard2.y;
Game.step(STEP);
check('the meter never goes over 100', Game.car.meter === CONFIG.boost.meterMax,
  Game.car.meter.toFixed(1));

const shardOffsets = OR.Shards.items.map(s =>
  Math.abs(Track.nearest(s.x, s.y, null).offset));
check('shards sit on the track, not in the scenery',
  shardOffsets.every(off => off < Track.halfRoad),
  'worst offset ' + Math.max.apply(null, shardOffsets).toFixed(0) +
  ' of ' + Track.halfRoad);

/* ---- cooldown and meter shown in the HUD -------------------------------- */
const boostWidget = doc.getElementById('boostWidget');
Game.car.meter = 100;
Game.car.boost.cooldown = 0;
pressSpace();
Game.step(STEP);
HUD.update(Game);
check('the HUD shows BOOSTING while boosting',
  doc.getElementById('boostStatus').textContent.indexOf('BOOSTING') === 0 &&
  boostWidget.className.indexOf('is-active') !== -1,
  doc.getElementById('boostStatus').textContent);
check('the HUD glows while boosting (is-active class)',
  boostWidget.className.indexOf('is-active') !== -1, boostWidget.className);

Game.car.meter = 0.5;
advance(0.2);
HUD.update(Game);
check('the HUD shows the cooldown with a countdown',
  /^COOLING \d\.\d+s$/.test(doc.getElementById('boostStatus').textContent) &&
  boostWidget.className.indexOf('is-cooling') !== -1,
  doc.getElementById('boostStatus').textContent);

check('the HUD meter shows the 0-100 value',
  doc.getElementById('boostValue').textContent ===
  String(Math.round(Game.car.meter)),
  doc.getElementById('boostValue').textContent + '%');

Game.car.boost.cooldown = 0;
Game.car.meter = 12;
HUD.update(Game);
check('the HUD warns when there is not enough charge',
  doc.getElementById('boostStatus').textContent === 'NEED 25%' &&
  boostWidget.className.indexOf('is-low') !== -1,
  doc.getElementById('boostStatus').textContent);

Game.car.meter = 80;
HUD.update(Game);
check('the HUD shows READY when the meter has enough charge',
  doc.getElementById('boostStatus').textContent === 'READY' &&
  boostWidget.className.indexOf('is-ready') !== -1,
  doc.getElementById('boostStatus').textContent);

/* ---- effects: trail, camera zoom, reduced motion ------------------------ */
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
key('ArrowUp', true);
autoSteer(3.0);
const baseScale = Renderer.view.scale;
Game.car.meter = 100;
Game.car.boost.cooldown = 0;
pressSpace();
for (let i = 0; i < 30; i++) {           // run the camera, which applies the zoom
  Game.step(STEP);
  Renderer.updateCamera(Game.car, STEP);
}
check('the camera zooms in slightly while boosting',
  Renderer.view.scale > baseScale * 1.02,
  baseScale.toFixed(3) + ' -> ' + Renderer.view.scale.toFixed(3));
check('boost flames particle trail is emitted',
  Renderer.particles.length > 0, Renderer.particles.length + ' particles');

Game.car.meter = 0;
Game.car.boost.active = false;
for (let i = 0; i < 60; i++) {
  Game.step(STEP);
  Renderer.updateCamera(Game.car, STEP);
}
check('the camera settles back after the boost',
  Math.abs(Renderer.view.scale - baseScale) < baseScale * 0.01,
  Renderer.view.scale.toFixed(3));

Renderer.reducedMotion = true;
const calmScale = Renderer.view.scale;
Game.car.meter = 100;
Game.car.boost.cooldown = 0;
pressSpace();
for (let i = 0; i < 30; i++) {
  Game.step(STEP);
  Renderer.updateCamera(Game.car, STEP);
}
check('reduced motion switches the camera zoom off',
  Math.abs(Renderer.view.scale - calmScale) < calmScale * 0.01,
  'scale ' + Renderer.view.scale.toFixed(3));
let speedLineError = null;
try { render(); } catch (err) { speedLineError = err; }
check('reduced motion renders without speed lines and without errors',
  !speedLineError, speedLineError ? speedLineError.message : 'ok');
Renderer.reducedMotion = false;
Game.car.meter = 0;
Game.car.boost.active = false;
Game.car.boost.cooldown = 0;
key('ArrowUp', false);

/* ---- Race Again resets everything --------------------------------------- */
OR.Shards.collected = 3;
Game.car.boost.peakKmh = 400;
Game.results = null;
Game.startRace();
check('Race Again refills the meter to the starting charge',
  Game.car.meter === CONFIG.boost.startMeter, Game.car.meter + '/100');
check('Race Again puts every shard back',
  OR.Shards.remaining() === OR.Shards.items.length &&
  OR.Shards.collected === 0,
  OR.Shards.remaining() + ' of ' + OR.Shards.items.length);
check('Race Again clears the boost stats',
  Game.car.boost.used === 0 && Game.car.boost.peakKmh === 0,
  'used=' + Game.car.boost.used + ' peak=' + Game.car.boost.peakKmh);

/* ---- results carry the Step 3 numbers ----------------------------------- */
LOOP.keepRacing = false;
advance(CONFIG.race.countdownSeconds + 0.05);
key('ArrowUp', true);
autoSteer(2.0);
Game.car.meter = 100;
Game.car.boost.cooldown = 0;
pressSpace();
autoSteer(0.8);
check('peak boosted speed is tracked',
  Game.car.boost.peakKmh > CONFIG.car.maxSpeed * CONFIG.track.metersPerUnit * 3.6 * 1.05,
  Math.round(Game.car.boost.peakKmh) + ' km/h');
// put the race on its final lap, just short of the line, so crossing it ends it
placeAt(0.985, 900);
Race.lap = Race.laps;
Race.nextCheckpoint = Track.checkpoints.length;
Race.progress = 0.985;
Race.lastFraction = 0.985;
Race.lapBase = 0;
Race.hint = near().index;
autoSteer(0.8);
key('ArrowUp', false);
advance(CONFIG.race.finishDelayMs / 1000 + 0.3);
check('the results include peak boosted speed and shards',
  Game.results && Game.results.peakBoostKmh >= Game.car.boost.peakKmh - 0.001 &&
  typeof Game.results.shardsCollected === 'number',
  'peak=' + Math.round(Game.results.peakBoostKmh) + ' km/h shards=' +
  Game.results.shardsCollected);
check('the finish screen shows peak boosted speed',
  doc.getElementById('finalBoostSpeed').textContent ===
  Math.round(Game.results.peakBoostKmh) + ' km/h',
  doc.getElementById('finalBoostSpeed').textContent);
check('the finish screen still shows boosts used and shards',
  doc.getElementById('finalBoosts').textContent === String(Game.results.boostsUsed) &&
  /^\d+\/\d+$/.test(doc.getElementById('finalShards').textContent),
  'boosts=' + doc.getElementById('finalBoosts').textContent +
  ' shards=' + doc.getElementById('finalShards').textContent);

Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);

/* =========================== 12. mobile controls ========================== */
section('12. Mobile controls');
// Traffic contact is on for touch racing, race flow, and the full-race check.
CONFIG.collisions.enabled = true;
Input.enableTouchMode();
const pad = doc.getElementById('touchControls');
Input.attachTouchPad(pad);
const btn = action => pad.querySelector('[data-action="' + action + '"]');
['left', 'right', 'brake', 'boost'].forEach(a => check('touch button "' + a + '" exists', !!btn(a)));

function touch(action, type) {
  const ev = new win.MouseEvent(type, { bubbles: true, cancelable: true });
  btn(action).dispatchEvent(ev);
}
touch('left', 'pointerdown');
Input.update();
check('LEFT button steers left', Input.state.left === true);
touch('left', 'pointerup');
Input.update();
check('LEFT button releases', Input.state.left === false);

touch('right', 'pointerdown');
Input.update();
check('RIGHT button steers right', Input.state.right === true);
touch('right', 'pointerup');

touch('brake', 'pointerdown');
Input.update();
check('BRAKE button brakes', Input.state.brake === true);
check('touch mode auto-accelerates unless braking', Input.state.throttle === false);
touch('brake', 'pointerup');
Input.update();
check('touch mode auto-accelerates when not braking', Input.state.throttle === true);

const usedBefore = Game.car.boost.used;
advance(CONFIG.race.countdownSeconds + 0.05);
touch('boost', 'pointerdown');
advance(STEP);
touch('boost', 'pointerup');
check('BOOST button fires the boost', Game.car.boost.used === usedBefore + 1,
  'used=' + Game.car.boost.used);

/* real physics through the touch path */
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
const touchX = Game.car.x;
touch('right', 'pointerdown');
withoutContact(() => advance(1.0));
touch('right', 'pointerup');
check('touch steering actually moves the car', Game.car.x > touchX + 20,
  touchX.toFixed(0) + ' -> ' + Game.car.x.toFixed(0));
check('touch throttle drives the car forward', Game.car.speed > 100, 'v=' + Game.car.speed.toFixed(0));

/* mobile steering with the Step 2 handling, driven only through the touch pad */
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
let heldPad = null;
let worstOffset = 0;
const touchFrames = Math.round(12 / STEP);
for (let i = 0; i < touchFrames; i++) {
  const car = Game.car;
  const ahead = Track.pointAhead(car.x, car.y, 260, car.trackHint);
  const want = Math.atan2(ahead.x - car.x, -(ahead.y - car.y));
  let err = want - car.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  const next = err < -0.02 ? 'left' : err > 0.02 ? 'right' : null;
  if (next !== heldPad) {
    if (heldPad) touch(heldPad, 'pointerup');
    heldPad = next;
    if (heldPad) touch(heldPad, 'pointerdown');
  }
  Game.step(STEP);
  worstOffset = Math.max(worstOffset, Math.abs(near(car.x, car.y).offset));
}
if (heldPad) touch(heldPad, 'pointerup');
check('a phone player can steer the car right round the track with the pads',
  worstOffset < Track.limit,
  'worst offset ' + worstOffset.toFixed(0) + ' of ' + Track.limit.toFixed(0));
const touchDistance = Track.nearest(Game.car.x, Game.car.y, Game.car.trackHint).s;
check('touch racing makes good progress',
  touchDistance > 2000, Math.round(touchDistance) + ' units round the lap');

/* ============ 13. Step 4 — laps, checkpoints, pause, restart ============ */
section('13. Step 4 — state machine, checkpoints, pause menu');
check('the five race states exist',
  Game.STATES.MENU === 'menu' && Game.STATES.COUNTDOWN === 'countdown' &&
  Game.STATES.RACING === 'racing' && Game.STATES.PAUSED === 'paused' &&
  Game.STATES.FINISHED === 'finished',
  Object.keys(Game.STATES).join(', '));

/* ---- countdown locks input ---------------------------------------------- */
Game.startRace();
check('a race begins in COUNTDOWN', Game.state === 'countdown');
const startY = Game.car.y;
key('ArrowUp', true);
advance(CONFIG.race.countdownSeconds - 0.5);
check('input is locked during the countdown',
  Math.abs(Game.car.y - startY) < 0.001 && Game.car.speed === 0,
  'moved ' + Math.abs(Game.car.y - startY).toFixed(3) + ' units');
check('the race clock stays at zero during the countdown', Game.raceTimeMs === 0);
advance(0.6);
check('the car drives once GO arrives', Game.state === 'racing' && Game.car.speed > 0,
  'state=' + Game.state + ' v=' + Game.car.speed.toFixed(0));
key('ArrowUp', false);

/* ---- checkpoints must be passed in order -------------------------------- */
check('the track defines its checkpoints',
  Track.checkpoints.length === CONFIG.race.checkpoints.length,
  Track.checkpoints.length + ' checkpoints');
check('checkpoints are in order down the lap',
  Track.checkpoints.every((cp, i) =>
    i === 0 || cp.fraction > Track.checkpoints[i - 1].fraction) &&
  Track.checkpoints.every(cp => Math.abs(Track.nearest(cp.x, cp.y, null).offset) < 1),
  Track.checkpoints.map(cp => Math.round(cp.fraction * 100) + '%').join(' -> '));

Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
Race.lapStartMs = 0;
Game.raceTimeMs = 0;

// drive until the first checkpoint (a quarter of the way round) is behind us
key('ArrowUp', true);
let hops = 0;
while (Race.nextCheckpoint === 0 && hops < 60 * 120) { autoSteerStep(); hops++; }
check('a checkpoint is registered when driven through',
  Race.nextCheckpoint === 1 && Race.checkpointsPassed === 1,
  'checkpoint ' + Race.nextCheckpoint + ' of ' + Track.checkpoints.length +
  ' after ' + (hops / 120).toFixed(1) + 's');
check('checkpoint progress tracks the lap bar',
  Race.lapProgress(Game.car.x, Game.car.y) > 0.2 &&
  Race.lapProgress(Game.car.x, Game.car.y) < 0.35,
  Math.round(Race.lapProgress(Game.car.x, Game.car.y) * 100) + '% of the lap');

// now skip the remaining checkpoints and cross the line on the racing line
const lapBefore = Race.lapTimes.length;
placeAt(0.995, 900);
Race.progress = 0.995;
Race.lastFraction = 0.995;
Race.lapBase = 0;
Race.hint = near().index;
autoSteer(0.6);
check('crossing the line without the checkpoints does not count a lap',
  Race.lapTimes.length === lapBefore && Race.lap === 1,
  'laps=' + Race.lapTimes.length + ' lap=' + Race.lap + ' checkpoints=' +
  Race.nextCheckpoint);
check('the shortcut is flagged rather than scored',
  Race.lastEvent && Race.lastEvent.type === 'shortcut',
  Race.lastEvent && Race.lastEvent.type);
check('a shortcut never scores a lap',
  Race.lapTimes.length === lapBefore && Race.lap === 1 && Race.progress >= 0.99,
  'progress=' + Race.progress.toFixed(3) + ' laps=' + Race.lapTimes.length);
key('ArrowUp', false);

/* ---- HUD lap card -------------------------------------------------------- */
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
autoSteer(1.5);
HUD.update(Game);
check('the HUD shows LAP 1/3',
  doc.getElementById('lapValue').textContent === '1' &&
  doc.getElementById('lapTotal').textContent === String(CONFIG.race.laps),
  doc.getElementById('lapValue').textContent + '/' +
  doc.getElementById('lapTotal').textContent);
check('the HUD shows a running lap timer',
  /^\d{2}:\d{2}\.\d{3}$/.test(doc.getElementById('lapTimeValue').textContent) &&
  doc.getElementById('lapTimeValue').textContent !== '00:00.000',
  doc.getElementById('lapTimeValue').textContent);
check('the HUD has no best lap yet',
  doc.getElementById('bestLapValue').textContent.indexOf('--') !== -1,
  doc.getElementById('bestLapValue').textContent);
Race.lapTimes.push(15000);
Race.bestLapMs = 15000;
HUD.update(Game);
check('the HUD highlights the best lap once one is set',
  doc.getElementById('bestLapValue').textContent === 'BEST ' +
  OR.Utils.formatTime(15000) &&
  doc.getElementById('bestLapValue').classList.contains('is-set'),
  doc.getElementById('bestLapValue').textContent);

/* ---- pause --------------------------------------------------------------- */
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
key('ArrowUp', true);
autoSteer(1.0);
key('ArrowUp', false);
Game.car.meter = 70;

key('Escape', true);
key('Escape', false);
Game.step(STEP);
check('Escape pauses the race', Game.state === 'paused', Game.state);
check('the pause menu is shown',
  !doc.getElementById('pauseScreen').classList.contains('hidden'));
HUD.update(Game);
check('the pause menu shows the lap and the clock',
  doc.getElementById('pauseLap').textContent === '1/' + CONFIG.race.laps &&
  /^\d{2}:\d{2}\.\d{3}$/.test(doc.getElementById('pauseTime').textContent),
  doc.getElementById('pauseLap').textContent + ' ' +
  doc.getElementById('pauseTime').textContent);

const pausedClock = Game.raceTimeMs;
const pausedY = Game.car.y;
const pausedSpeed = Game.car.speed;
const pausedMeter = Game.car.meter;
key('ArrowUp', true);
advance(2.0);
key('ArrowUp', false);
check('the clock is frozen while paused', Game.raceTimeMs === pausedClock,
  OR.Utils.formatTime(pausedClock));
check('the car does not move while paused',
  Game.car.y === pausedY && Game.car.speed === pausedSpeed,
  'y ' + pausedY.toFixed(0) + ' -> ' + Game.car.y.toFixed(0));
check('the boost meter does not charge while paused', Game.car.meter === pausedMeter,
  pausedMeter.toFixed(1) + ' -> ' + Game.car.meter.toFixed(1));

doc.getElementById('resumeBtn').click();
check('RESUME returns to racing', Game.state === 'racing', Game.state);
check('the pause menu is hidden again',
  doc.getElementById('pauseScreen').classList.contains('hidden'));
advance(0.5);
check('the clock runs again after resuming', Game.raceTimeMs > pausedClock,
  OR.Utils.formatTime(Game.raceTimeMs));

key('KeyP', true);
key('KeyP', false);
Game.step(STEP);
check('P also pauses', Game.state === 'paused', Game.state);
doc.getElementById('pauseBtn').click();
check('the pause button resumes', Game.state === 'racing', Game.state);

/* ---- restart from the pause menu ---------------------------------------- */
key('ArrowUp', true);
autoSteer(1.0);
key('ArrowUp', false);
Race.lapTimes.push(12345);
Race.bestLapMs = 12345;
OR.Shards.collected = 4;
Game.car.meter = 12;
doc.getElementById('pauseBtn').click();
doc.getElementById('restartBtn').click();
check('RESTART starts a fresh countdown', Game.state === 'countdown', Game.state);
check('restart clears the lap times', Race.lapTimes.length === 0 && Race.lap === 1,
  'laps=' + Race.lapTimes.length + ' lap=' + Race.lap);
check('restart clears the race clock', Game.raceTimeMs === 0 && Game.finalTimeMs === 0);
check('restart resets the car and the pickups',
  Race.progress < 0 && Game.car.gridSlot === 0 &&
  Game.car.speed === 0 &&
  Game.car.meter === CONFIG.boost.startMeter &&
  OR.Shards.collected === 0 &&
  OR.Shards.remaining() === OR.Shards.items.length,
  'meter=' + Game.car.meter + ' shards=' + OR.Shards.remaining() + '/' +
  OR.Shards.items.length);
check('restart clears the results', Game.results === null);

/* ---- quit from the pause menu ------------------------------------------- */
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
key('ArrowUp', true);
autoSteer(0.5);
key('ArrowUp', false);
doc.getElementById('pauseBtn').click();
doc.getElementById('quitBtn').click();
check('QUIT TO MENU returns to the menu', Game.state === 'menu', Game.state);
check('the menu is visible again',
  !doc.getElementById('menuScreen').classList.contains('hidden') &&
  doc.getElementById('pauseScreen').classList.contains('hidden'));

check('the race cannot be paused from the menu',
  (function () {
    Game.step(STEP);
    const before = Game.state;
    key('Escape', true);
    key('Escape', false);
    Game.step(STEP);
    return Game.state === before;
  })(), Game.state);

/* ---- a fresh race after Race Again -------------------------------------- */
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
key('ArrowUp', true);
autoSteer(1.2);
key('ArrowUp', false);
check('a new race starts on lap 1 with no splits',
  Race.lap === 1 && Race.lapTimes.length === 0 && Race.bestLapMs === 0,
  'lap=' + Race.lap + ' splits=' + Race.lapTimes.length);
check('a new race has the full lap count', Race.laps === CONFIG.race.laps,
  Race.laps + ' laps');
Game.returnToMenu();

/* =========================== 14. rendering ================================ */
section('14. Rendering');
let renderError = null;
try {
  Game.startRace();
  for (let i = 0; i < 120; i++) { Game.step(STEP); render(); }
  for (let i = 0; i < 240; i++) {          // past a checkpoint gate
    Game.car.meter = 100;                  // and boosting, for the fx
    autoSteerStep();
    render();
  }
  Game.returnToMenu();
  for (let i = 0; i < 60; i++) { Game.step(STEP); render(); }
} catch (err) {
  renderError = err;
}
check('full render loop runs without errors', !renderError,
  renderError ? renderError.message + '\n' + renderError.stack : '420 frames');
check('returnToMenu works', Game.state === 'menu');

/* =========================== 15. full race ================================ */
section('15. Full race (autopilot drives the whole track)');
LOOP.keepRacing = false;      // this time the car must actually reach the flag
Game.startRace();
advance(CONFIG.race.countdownSeconds + 0.05);
key('ArrowUp', true);
let elapsed = 0;
while (Game.state === 'racing' && elapsed < 90) {
  autoSteer(0.5);
  elapsed += 0.5;
}
key('ArrowUp', false);
check('the race can be driven from start to finish', Game.state !== 'racing', Game.state);
check('all the laps were completed',
  Game.results && Game.results.lapTimes.length === CONFIG.race.laps,
  (Game.results ? Game.results.lapTimes.length : 0) + ' of ' + CONFIG.race.laps +
  ' laps: ' + (Game.results ? Game.results.lapTimes.map(t => OR.Utils.formatTime(t)).join(' ') : ''));
check('a clean race takes a sensible amount of time',
  Game.finalTimeMs > 30000 && Game.finalTimeMs < 90000,
  OR.Utils.formatTime(Game.finalTimeMs) + ' over ' + CONFIG.race.laps + ' laps of ' +
  (Math.round(Track.length * CONFIG.track.metersPerUnit)) + ' m');
check('top speed reaches racing speeds',
  Game.results.maxSpeedKmh > 250 && Game.results.maxSpeedKmh < 500,
  Math.round(Game.results.maxSpeedKmh) + ' km/h');
const finishInfo = near();
check('the car crosses the line having taken every checkpoint',
  Race.finished && Race.lapTimes.length === CONFIG.race.laps &&
  Math.abs(finishInfo.offset) < Track.halfRoad,
  'offset=' + finishInfo.offset.toFixed(0));

/* =========================== 16. Step 6 integration ======================= */
section('16. Step 6 — rivals, HUD standings, pause, finish, reset');
Input.enableTouchMode(false);
Input.reset();
Game.startRace(501);
const gridSnapshot = Game.rivals.map(car => [car.x, car.y, car.ai.nextStall]);
advance(CONFIG.race.countdownSeconds - 0.4);
check('all three rivals stay on their grid slots during countdown',
  Game.rivals.every((car, i) => car.x === gridSnapshot[i][0] && car.y === gridSnapshot[i][1] &&
    car.speed === 0 && car.ai.nextStall === gridSnapshot[i][2]));
check('the race contains the player plus three rival entities', Game.entities.length === 4 && Game.rivals.length === 3);
check('every entity has an independent lap tracker',
  new Set(Game.entities.map(car => car.race)).size === 4);
advance(0.5);
check('rivals start moving only after GO', Game.state === 'racing' && Game.rivals.every(car => car.speed > 0));
const gossip = Game.rivals[0];
gossip.ai.nextStall = 0;
Game.step(STEP);
HUD.update(Game);
const stalledRow = doc.querySelector('#standingsList [data-driver="gossip-1"]');
check('the HUD identifies a gameplay stall with a bolt', gossip.ai.stalled &&
  stalledRow.classList.contains('is-stalled') &&
  stalledRow.querySelector('.standing-status').getAttribute('aria-label') === 'Gameplay stall');
check('all four full driver names appear in the live standings',
  doc.querySelectorAll('#standingsList .standing-name').length === 4 &&
  Array.from(doc.querySelectorAll('#standingsList .standing-name')).some(el => el.textContent === 'STANDARD GOSSIP 3'));
Renderer._spawnParticle(gossip.x, gossip.y, 20, 0, 3, 12, CONFIG.theme.amber);
Game.pause();
const pausedRivals = JSON.stringify(Game.rivals.map(car => [car.x, car.y, car.speed,
  car.ai.nextStall, car.ai.stallRemaining, car.ai.stallCount]));
const pausedParticles = JSON.stringify(Renderer.particles);
advance(2);
check('pause freezes every rival and its stall timers', pausedRivals === JSON.stringify(Game.rivals.map(car =>
  [car.x, car.y, car.speed, car.ai.nextStall, car.ai.stallRemaining, car.ai.stallCount])));
check('pause also freezes the visual effects', pausedParticles === JSON.stringify(Renderer.particles));
Game.resume();
advance(1.1);
check('stalls release after resuming, without a frozen car', !gossip.ai.stalled && gossip.speed > 100);
const standings = OR.Standings;
Race.progress = 0.35; Race.lapBase = 0; Race.nextCheckpoint = 1;
gossip.race.progress = 1.1; gossip.race.lapBase = 1; gossip.race.lap = 2;
standings.update();
HUD.update(Game);
check('the live position and list reflect validated overtaking across laps',
  doc.getElementById('positionValue').textContent === '2' &&
  doc.getElementById('positionTotal').textContent === '4' &&
  doc.querySelector('#standingsList li').dataset.driver === gossip.id);
Race.finished = true; Race.finishTimeMs = Game.raceTimeMs; Race.progress = 3;
gossip.race.finished = true; gossip.race.finishTimeMs = Game.raceTimeMs - 100;
Game._finishRace();
check('results include a four-driver classification and the player place',
  Game.results.standings.length === 4 && Game.results.place === 2 && Game.results.fieldSize === 4 &&
  Game.results.standings[1].isPlayer);
check('the finish screen shows the player place and all driver names',
  doc.getElementById('finalPosition').textContent === '2 / 4' &&
  doc.querySelectorAll('#finalStandings li').length === 4);
check('unfinished rivals have no invented finish times', Game.results.standings.filter(row => !row.finished)
  .every(row => row.timeMs === null && row.remainingMeters > 0));
const finalOrder = JSON.stringify(Game.results.standings);
advance(CONFIG.race.finishDelayMs / 1000 + 0.2);
Game.rivals[2].race.progress = 9;
standings.update();
check('coast-out cannot change the final classification', finalOrder === JSON.stringify(Game.results.standings) &&
  standings.frozen && Game.state === 'finished');
Game.restartRace();
check('restart clears rival laps, stalls and finish times', Game.rivals.every(car =>
  car.race.lap === 1 && car.race.lapTimes.length === 0 && !car.race.finished &&
  car.race.finishTimeMs === 0 && car.ai.stallCount === 0 && !car.ai.stalled && car.speed === 0));
check('restart restores POS 1/4 and clears the frozen result',
  standings.playerPlace === 1 && !standings.frozen && Game.results === null && Game.state === 'countdown');
Game.returnToMenu();
check('quit removes the rival field and stale contacts', Game.rivals.length === 0 && Game.entities.length === 1 &&
  OR.Collisions.cooldowns.size === 0 && Game.state === 'menu');

/* =========================== 17. Step 7 — difficulty ===================== */
section('17. Step 7 — EASY / NORMAL / HARD selection, HUD and results');
{
  const Diff = OR.Difficulty;
  const picker = doc.getElementById('difficultyPicker');
  const buttons = picker ? Array.from(picker.children) : [];
  check('the menu offers three difficulty buttons',
    buttons.length === 3 && buttons.map(b => b.textContent).join(',') === 'EASY,NORMAL,HARD',
    buttons.map(b => b.textContent).join(' / '));
  check('the saved level is selected on load',
    buttons.some(b => b.dataset.difficulty === Diff.currentId() &&
      b.classList.contains('is-selected') && b.getAttribute('aria-checked') === 'true'),
    Diff.currentId());
  check('each level explains itself', buttons.every(b => b.title.length > 10) &&
    doc.getElementById('difficultyHint').textContent.length > 10,
    doc.getElementById('difficultyHint').textContent);
  buttons[2].click();
  check('clicking HARD selects and stores it',
    Diff.currentId() === 'hard' && buttons[2].getAttribute('aria-checked') === 'true' &&
    buttons[2].classList.contains('is-selected'), Diff.currentId());
  buttons[2].dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  check('arrow keys move the selection', Diff.currentId() === 'normal', Diff.currentId());
  buttons[2].click();

  Game.startRace(909);
  Game.difficultyId = 'hard';
  check('the race captures the level it started with',
    Game.difficulty.label === 'HARD' && Game.rivals.every(car => car.ai.level === 'hard'));

  Diff.select('easy');
  advance(CONFIG.race.countdownSeconds + 0.2);
  HUD.update(Game);
  check('the HUD shows the race difficulty, not a later menu change',
    doc.getElementById('hudDifficulty').textContent === 'HARD' &&
    Game.state === 'racing' && Game.rivals.every(car => car.ai.level === 'hard'));
  check('changing the menu level mid-race does not retune the rivals',
    Game.rivals.every(car => Math.abs(car.baseTopSpeedMultiplier -
      CONFIG.rivals.roster[car.number - 1].speed *
      CONFIG.difficulty.levels[2].rivalSpeed) < 1e-9));

  // Force the flag so the results screen can be checked without a full race.
  Race.lap = CONFIG.race.laps;
  Race.lapBase = 0;
  Race.progress = 0.96;
  Race.lastFraction = 0.96;
  Race.nextCheckpoint = Track.checkpoints.length;
  Game.car.trackHint = Track.pointAt(Track.length * 0.99).index;
  const otherBests = { easy: Diff.best('easy'), normal: Diff.best('normal') };
  Game._finishRace();
  const results = Game.results;
  check('results carry the difficulty and a best time for it',
    results.difficulty === 'HARD' && results.difficultyId === 'hard' &&
    results.bestMs === results.timeMs && results.isNewBest === true &&
    /^Best on Hard/.test(results.bestText), results.bestText);
  Game._emit('finish', results); // the real hook the finish screen uses
  check('the finish screen labels the difficulty',
    doc.getElementById('finalDifficulty').textContent === 'HARD');
  check('the finish screen shows the best-on-difficulty line',
    /Best on Hard/.test(doc.getElementById('finalBestTime').textContent) &&
    doc.getElementById('finalBestTime').classList.contains('is-new'),
    doc.getElementById('finalBestTime').textContent);
  check('the best time is stored for that difficulty only',
    Diff.best('hard') === results.timeMs &&
    Diff.best('easy') === otherBests.easy && Diff.best('normal') === otherBests.normal,
    'hard ' + OR.Utils.formatTime(Diff.best('hard')) +
    ', easy ' + (otherBests.easy ? OR.Utils.formatTime(otherBests.easy) : '—') +
    ', normal ' + (otherBests.normal ? OR.Utils.formatTime(otherBests.normal) : '—'));

  const slower = Diff.recordBest('hard', results.timeMs + 5000);
  check('a slower race does not overwrite the best', !slower.isNewBest &&
    slower.bestMs === results.timeMs && Diff.best('hard') === results.timeMs);
  Diff.select('normal');
  Game._emit('finish', { difficulty: 'NORMAL', difficultyId: 'normal', bestMs: 0,
    isNewBest: false, bestText: 'No Normal time yet', place: 1, fieldSize: 4,
    standings: [], lapTimes: [], bestLapMs: 0, maxSpeedKmh: 0, boostsUsed: 0,
    peakBoostKmh: 0, shardsCollected: 0, timeMs: 0 });
  check('an empty record still renders sensibly',
    doc.getElementById('finalDifficulty').textContent === 'NORMAL' &&
    !doc.getElementById('finalBestTime').classList.contains('is-new'),
    doc.getElementById('finalBestTime').textContent);
}

/* ====================== 18. Step 8 — tracks and records =================== */
section('18. Step 8 — multiple tracks, track select and records');
{
  const TrackSelect = OR.TrackSelect;
  const Bests = OR.Bests;
  const Diff = OR.Difficulty;
  const cards = () => Array.from(doc.querySelectorAll('#trackList .track-card'));
  const pane = doc.getElementById('menuTracks');
  const mainPane = doc.getElementById('menuMain');

  check('the menu lists a card for every track',
    cards().length === OR.TRACKS.length &&
    cards().map(c => c.dataset.track).join(',') === OR.TRACKS.map(t => t.id).join(','),
    cards().map(c => c.dataset.track).join(', '));
  check('every card draws its circuit and shows the name and subtitle',
    cards().every(card => {
      const track = OR.trackById(card.dataset.track);
      const canvas = card.querySelector('canvas.track-preview');
      return canvas && canvas.width > 0 && canvas.height > 0 &&
        canvas.getAttribute('data-track-length') ===
          String(Math.round(Track.measure(track).total)) &&
        card.querySelector('.track-name').textContent === track.name &&
        card.querySelector('.track-subtitle').textContent === track.subtitle;
    }));
  check('every card shows the measured lap length in metres',
    cards().every(card => {
      const track = OR.trackById(card.dataset.track);
      return card.querySelector('.track-meta').textContent.indexOf(
        TrackSelect.lengthMeters(track) + ' m') !== -1;
    }),
    OR.TRACKS.map(t => TrackSelect.lengthMeters(t) + ' m').join(', '));
  check('every card shows laps, checkpoints and shards from its data',
    cards().every(card => {
      const track = OR.trackById(card.dataset.track);
      const meta = card.querySelector('.track-meta').textContent;
      return meta.indexOf(track.laps + ' laps') !== -1 &&
        meta.indexOf(track.checkpointFractions.length + ' checkpoints') !== -1 &&
        meta.indexOf(track.shards.count + ' shards') !== -1;
    }));
  check('every card carries a difficulty rating',
    cards().every(card => {
      const track = OR.trackById(card.dataset.track);
      const badge = card.querySelector('.rating-badge');
      return badge.textContent === TrackSelect.ratingStars(track) &&
        badge.title.indexOf(TrackSelect.ratingLabel(track)) === 0;
    }),
    OR.TRACKS.map(t => t.id + ' ' + TrackSelect.ratingLabel(t)).join(', '));

  check('the original circuit is selected by default',
    Track.id === 'flexnode' && TrackSelect.current().id === 'flexnode' &&
    cards()[0].classList.contains('is-selected') &&
    cards()[0].getAttribute('aria-checked') === 'true');

  check('clicking a card selects that circuit',
    (function () {
      cards()[1].click();
      return Track.id === 'mesh-highway' &&
        cards()[1].classList.contains('is-selected') &&
        !cards()[0].classList.contains('is-selected');
    })(), Track.id);
  check('selecting a circuit rebuilds the live geometry',
    Math.abs(Track.length - Track.measure(OR.trackById('mesh-highway')).total) < 1e-9 &&
    Track.length > 15000,
    Math.round(Track.length / 10) + ' m');
  check('the pickups follow the selected circuit',
    OR.Shards.items.length === OR.trackById('mesh-highway').shards.count &&
    OR.Shards.items.length === 18,
    OR.Shards.items.length + ' shards');

  doc.getElementById('trackStartBtn').click();
  check('RACE THIS TRACK starts a race on the selected circuit',
    Game.state === 'countdown' && Track.id === 'mesh-highway');
  check('the lap count for the race comes from the track',
    Race.laps === 2 && Race.laps === Track.laps, Race.laps + ' laps');
  check('the checkpoints for the race come from the track',
    Track.checkpoints.length === 4 &&
    Track.checkpoints.every(cp => Math.abs(Track.nearest(cp.x, cp.y, null).offset) < 1),
    Track.checkpoints.map(cp => Math.round(cp.fraction * 100) + '%').join(' -> '));
  check('the grid lines up on the selected circuit',
    Track.isOnRoad(Game.car.x, Game.car.y) && Race.progress < 0,
    'x=' + Game.car.x.toFixed(0) + ' y=' + Game.car.y.toFixed(0));

  advance(CONFIG.race.countdownSeconds + 0.05);
  doc.getElementById('pauseBtn').click();
  doc.getElementById('quitBtn').click();
  check('QUIT TO MENU returns to the track select pane',
    Game.state === 'menu' && !pane.classList.contains('hidden') &&
    mainPane.classList.contains('hidden') &&
    !doc.getElementById('menuScreen').classList.contains('hidden'));
  doc.getElementById('trackBackBtn').click();
  const backToTitle = mainPane.classList.contains('hidden') === false &&
    pane.classList.contains('hidden') === true;
  doc.getElementById('trackBtn').click();
  check('BACK and CHANGE TRACK move between the menu panes',
    backToTitle && !pane.classList.contains('hidden') && mainPane.classList.contains('hidden'));

  /* RACE AGAIN must keep the circuit that was just raced. */
  doc.getElementById('trackStartBtn').click();
  advance(CONFIG.race.countdownSeconds + 0.05);
  doc.getElementById('againBtn').click();
  check('RACE AGAIN keeps the same circuit',
    Track.id === 'mesh-highway' && Game.state === 'countdown');

  /* Force the flag so the results and the record book can be checked. */
  advance(CONFIG.race.countdownSeconds + 0.05);
  Race.lap = Race.laps;
  Race.lapBase = 0;
  Race.progress = 0.96;
  Race.lastFraction = 0.96;
  Race.nextCheckpoint = Track.checkpoints.length;
  Race.lapTimes.push(22500);
  Race.bestLapMs = 22500;
  Game.car.trackHint = Track.pointAt(Track.length * 0.99).index;
  Game.raceTimeMs = 47000;
  Game._finishRace();
  const trackResults = Game.results;

  Game._emit('finish', trackResults);
  check('the finish screen names the circuit',
    doc.getElementById('finalTrack').textContent === 'MESH HIGHWAY');
  check('the finish screen shows the track-best time and lap',
    /Track best/.test(doc.getElementById('finalTrackBest').textContent) &&
    doc.getElementById('finalTrackBest').textContent.indexOf(
      OR.Utils.formatTime(47000)) !== -1 &&
    doc.getElementById('finalTrackBest').textContent.indexOf(
      OR.Utils.formatTime(22500)) !== -1,
    doc.getElementById('finalTrackBest').textContent);
  check('the finish records the best time and lap for that track and difficulty',
    trackResults.trackId === 'mesh-highway' &&
    trackResults.trackBestMs === 47000 &&
    trackResults.trackBestLapMs === 22500 &&
    Bests.bestTime('mesh-highway', Diff.currentId()) === 47000 &&
    Bests.bestLap('mesh-highway', Diff.currentId()) === 22500,
    Bests.timeText('mesh-highway', Diff.currentId()));
  check('a slower finish does not replace the record',
    !Bests.record('mesh-highway', Diff.currentId(), { timeMs: 48000, lapMs: 23000 }).isNewTime &&
    Bests.bestTime('mesh-highway', Diff.currentId()) === 47000);
  check('the choice is remembered in the save object',
    OR.Save.selection().track === 'mesh-highway' &&
    OR.TrackSelect.savedId() === 'mesh-highway',
    OR.Save.selection().track);
}

/* ====================== 19. Step 9 — profile and saves ==================== */
section('19. Step 9 — profile screen, stats and the save file');
{
  const Save = OR.Save;
  const profilePane = doc.getElementById('menuProfile');
  const nameInput = doc.getElementById('profileName');
  const colors = doc.getElementById('profileColors');
  const statsBox = doc.getElementById('profileStats');
  const saveText = doc.getElementById('profileSaveText');
  const saveHint = doc.getElementById('profileSaveHint');
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));

  check('the menu offers a profile pane',
    !!doc.getElementById('profileBtn') && !!profilePane &&
    profilePane.classList.contains('hidden'));

  doc.getElementById('profileBtn').click();
  check('PROFILE opens it and BACK returns to the title pane',
    (function () {
      const opened = !profilePane.classList.contains('hidden') &&
        doc.getElementById('menuMain').classList.contains('hidden');
      doc.getElementById('profileBackBtn').click();
      return opened && profilePane.classList.contains('hidden') &&
        !doc.getElementById('menuMain').classList.contains('hidden');
    })());

  check('the name field is capped at 16 characters',
    nameInput.getAttribute('maxlength') === '16' &&
    OR.CONFIG.profile.maxNameLength === 16 &&
    nameInput.value === Save.profile().name,
    'maxlength=' + nameInput.getAttribute('maxlength') + ', starts as ' + nameInput.value);

  doc.getElementById('profileBtn').click();
  nameInput.value = '  <b>Ace</b>  Pilot  ';
  fire(nameInput, 'input');
  check('junk typed into the name field is sanitised as you type',
    !/[<>&"']/.test(nameInput.value) && nameInput.value.length <= 16 &&
    nameInput.value === OR.Utils.sanitiseName('  <b>Ace</b>  Pilot  ') &&
    doc.getElementById('profileNameCount').textContent ===
      nameInput.value.length + '/16',
    JSON.stringify(nameInput.value));

  nameInput.value = 'Smoke Tester';
  fire(nameInput, 'input');
  fire(nameInput, 'change');
  check('changing the name saves it', Save.profile().name === 'Smoke Tester',
    Save.profile().name);

  const swatches = Array.from(colors.querySelectorAll('.color-swatch'));
  check('six car colours are offered',
    swatches.length === 6 && swatches.every(sw => sw.getAttribute('role') === 'radio'),
    swatches.map(sw => sw.dataset.color).join(', '));

  swatches[3].click();
  check('picking a colour paints the car and marks the swatch',
    Save.profile().color === 'amber' || Save.profile().color === 'magenta'
      ? swatches[3].classList.contains('is-selected') &&
        Save.color().hex === Game.car.color &&
        Array.isArray(Game.car.palette) && Game.car.palette.length === 4
      : false,
    Save.profile().color + ' → ' + Save.color().hex);
  check('the menu says who you are racing as',
    /Racing as Smoke Tester/.test(doc.getElementById('racingAs').textContent) &&
    doc.getElementById('racingAs').textContent.indexOf(Save.color().label) !== -1,
    doc.getElementById('racingAs').textContent);

  check('career tiles show races, wins, podiums and total time',
    statsBox.querySelectorAll('.stat').length === 4 &&
    statsBox.textContent.indexOf(String(Save.stats().races)) !== -1 &&
    statsBox.textContent.indexOf(Save.totalTimeText()) !== -1,
    statsBox.querySelectorAll('.stat').length + ' tiles');
  check('one record line per difficulty is listed',
    doc.getElementById('profileRecords').querySelectorAll('.record-line').length ===
      OR.Difficulty.levels.length);

  doc.getElementById('profileExportBtn').click();
  const exported = saveText.value;
  check('EXPORT puts a Base64 save in the box',
    exported.length > 40 && !/[^A-Za-z0-9+/=]/.test(exported) &&
    /copied|save/i.test(saveHint.textContent),
    exported.slice(0, 20) + '… (' + exported.length + ' chars)');

  const nameBefore = Save.profile().name;
  saveText.value = 'this is definitely not a save';
  win.confirm = () => true;
  doc.getElementById('profileImportBtn').click();
  check('IMPORT refuses junk and says why',
    Save.profile().name === nameBefore &&
    /not look like/i.test(saveHint.textContent),
    saveHint.textContent);

  Save.recordRace({ timeMs: 40000, place: 1 });
  OR.Bests.record('flexnode', 'normal', { timeMs: 40000, lapMs: 13000 });
  saveText.value = exported;
  doc.getElementById('profileImportBtn').click();
  check('IMPORT restores an exported save',
    Save.profile().name === 'Smoke Tester' &&
    Save.profile().color === 'magenta' &&
    Save.bests().flexnode && Save.bests().flexnode.normal &&
    Save.bests().flexnode.normal.timeMs === OR.Bests.bestTime('flexnode', 'normal'),
    'restored as ' + Save.profile().name);
  check('export, import and export again is stable',
    (function () {
      const once = Save.export();
      Save.import(once);
      return Save.export() === once && Save.profile().name === 'Smoke Tester';
    })(), Save.profile().name);

  const keepName = Save.profile().name;
  doc.getElementById('profileResetBtn').click();
  check('RESET (confirmed) clears progress but keeps the profile',
    Save.stats().races === 0 &&
    Object.keys(Save.bests()).length === 0 &&
    Save.profile().name === keepName,
    Save.profile().name + ', ' + Save.stats().races + ' races');
  doc.getElementById('profileBackBtn').click();

  /* The profile must reach the HUD and the finish screen. */
  Game.startRace();
  advance(CONFIG.race.countdownSeconds + 0.05);
  HUD.update(Game);
  const playerRow = doc.querySelector('#standingsList .standing-row.is-player .standing-name');
  check('the HUD standings show the profile name',
    playerRow && playerRow.textContent === Save.profile().name,
    playerRow && playerRow.textContent);

  Race.lap = Race.laps;
  Race.lapBase = 0;
  Race.progress = 0.96;
  Race.lastFraction = 0.96;
  Race.nextCheckpoint = Track.checkpoints.length;
  Race.lapTimes.push(15000);
  Race.bestLapMs = 15000;
  Game.car.trackHint = Track.pointAt(Track.length * 0.99).index;
  Game.raceTimeMs = 45000;
  Game._finishRace();
  Game._emit('finish', Game.results);
  check('the finish screen names the driver in their colour',
    doc.getElementById('finalDriver').textContent === Save.profile().name &&
    /rgb|#/.test(doc.getElementById('finalDriverDot').style.background || Save.color().hex),
    doc.getElementById('finalDriver').textContent);
  check('the race is booked into the career stats',
    Game.results.career && Game.results.career.races === 1 &&
    Game.results.driver === Save.profile().name &&
    Save.stats().races === 1,
    JSON.stringify(Save.stats()));
}

/* ====================== 20. Step 10 — XP and levels ====================== */
section('20. Step 10 — XP, levels, the breakdown and the toast');
{
  const XP = OR.XP;
  const Save = OR.Save;
  const levelBar = doc.getElementById('menuLevelBar');
  const levelBadge = doc.getElementById('menuLevel');

  check('the menu shows the level and a progress bar',
    /LEVEL \d+/.test(levelBadge.textContent) &&
    levelBar.dataset.target === String(Math.round(XP.progress(Save.xp()).ratio * 100)) &&
    levelBar.dataset.level === String(XP.progress(Save.xp()).level),
    levelBadge.textContent + ' · bar ' + levelBar.dataset.target + '%');

  const profileLevel = doc.getElementById('profileLevel');
  const profileBar = doc.getElementById('profileLevelBar');
  check('the profile shows the same level and bar',
    profileLevel.dataset.level === levelBadge.dataset.level &&
    profileBar.dataset.target === levelBar.dataset.target &&
    /XP/.test(doc.getElementById('profileLevelXp').textContent),
    profileLevel.textContent + ' — ' + doc.getElementById('profileLevelXp').textContent);

  /* ---- a finished race pays out, line by line ------------------------- */
  const xpBefore = Save.xp();
  Game.startRace();
  advance(CONFIG.race.countdownSeconds + 0.05);

  /* Drive a clean lap: no barrier contact at all. */
  Game.car.wallHits = 0;
  Race.lap = Race.laps;
  Race.lapBase = 0;
  Race.progress = 0.96;
  Race.lastFraction = 0.96;
  Race.nextCheckpoint = Track.checkpoints.length;
  Race.lapTimes.push(15000);
  Race.bestLapMs = 15000;
  Game.car.trackHint = Track.pointAt(Track.length * 0.99).index;
  Game.raceTimeMs = 45000;
  Game._countLapCleanliness();   // what _scoreLap does when the line is crossed
  Game._finishRace();
  const results = Game.results;

  check('the race records which laps were clean',
    results.cleanLaps === 1 && results.laps >= 1 &&
    results.xp.breakdown.cleanLaps === 1,
    results.cleanLaps + ' clean of ' + results.laps);

  check('the XP award matches the breakdown shown on screen',
    results.xp.earned === results.xp.lines.reduce((sum, line) => sum + line.xp, 0) &&
    Save.xp() === xpBefore + results.xp.earned,
    '+' + results.xp.earned + ' XP (' + results.xp.lines.map(l => l.id + ' ' + l.xp).join(', ') + ')');

  Game._emit('finish', results);
  const rows = Array.from(doc.querySelectorAll('#finalXpLines .xp-line'));
  check('the results screen lists the breakdown line by line',
    rows.length === results.xp.lines.length &&
    rows.map(r => r.dataset.xpLine).join(',') ===
      results.xp.lines.map(l => l.id).join(',') &&
    rows.every((row, i) => row.querySelector('.xp-label').textContent === results.xp.lines[i].label),
    rows.map(r => r.dataset.xpLine).join(' → '));

  check('the screen total is the XP that was banked',
    doc.getElementById('finalXpTotal').dataset.earned === String(results.xp.earned) &&
    doc.getElementById('finalXpTotal').textContent === '+' + results.xp.earned + ' XP',
    doc.getElementById('finalXpTotal').textContent);

  check('the results bar shows the level and the progress towards the next one',
    doc.getElementById('finalLevel').dataset.level === String(Save.progress().level) &&
    doc.getElementById('finalLevelBar').dataset.target ===
      String(Math.round(XP.progress(Save.xp()).ratio * 100)) &&
    doc.getElementById('finalLevelXp').textContent ===
      XP.progress(Save.xp()).into + ' / ' + XP.progress(Save.xp()).needed + ' XP',
    doc.getElementById('finalLevel').textContent + ' — ' + doc.getElementById('finalLevelXp').textContent);

  check('the note explains the clean laps and the multiplier',
    /clean lap/.test(doc.getElementById('finalXpNote').textContent) &&
    doc.getElementById('finalXpNote').textContent.indexOf(
      results.xp.multiplier.toFixed(2) + '×') !== -1,
    doc.getElementById('finalXpNote').textContent);

  /* ---- the toast fires on a level-up, and only then ------------------- */
  check('a level-up shows the toast exactly once',
    (function () {
      const toast = doc.getElementById('levelToast');
      /* Bank XP right up to the threshold so the next small award levels up. */
      const progress = XP.progress(Save.xp());
      Save.addXp(Math.max(0, progress.remaining - 1));
      const levelBefore = Save.progress().level;

      Game.startRace();
      advance(CONFIG.race.countdownSeconds + 0.05);
      Race.lap = Race.laps;
      Race.lapBase = 0;
      Race.progress = 0.96;
      Race.lastFraction = 0.96;
      Race.nextCheckpoint = Track.checkpoints.length;
      Game.car.trackHint = Track.pointAt(Track.length * 0.99).index;
      Game.raceTimeMs = 30000;
      Game._finishRace();
      Game._emit('finish', Game.results);

      const shown = !toast.classList.contains('hidden') &&
        toast.classList.contains('is-visible');
      const leveled = Game.results.xp.leveledUp === true &&
        Save.progress().level === levelBefore + Game.results.xp.levelsGained;
      const labelled = doc.getElementById('levelToastValue').textContent ===
        'LEVEL ' + Save.progress().level;
      const oneNode = doc.querySelectorAll('#levelToast').length === 1;

      /* A second race that does not level up must hide it again. */
      Game.results.xp = { leveledUp: false, lines: [], earned: 0, multiplier: 1 };
      Game._emit('finish', Game.results);
      const hidden = toast.classList.contains('hidden');
      return shown && leveled && labelled && oneNode && hidden;
    })(),
    'toast shown at level ' + Save.progress().level + ', hidden on a normal race');

  /* ---- quitting early pays nothing ------------------------------------ */
  check('quitting a race early earns no XP',
    (function () {
      const before = Save.xp();
      Game.startRace();
      advance(CONFIG.race.countdownSeconds + 0.5);
      Game.returnToMenu();
      return Save.xp() === before && Game.state === 'menu';
    })(), Save.xp() + ' XP unchanged');

  /* ---- a dirty lap is not clean --------------------------------------- */
  check('a lap with a barrier hit is not counted as clean',
    (function () {
      Game.startRace();
      advance(CONFIG.race.countdownSeconds + 0.05);
      Game.cleanLaps = 0;
      Game.lapWallBaseline = 0;
      Game.car.wallHits = 2;            // two contacts earlier in the lap
      const clean = Game._countLapCleanliness();
      Game.car.wallHits = 0;
      const cleanAfter = Game._countLapCleanliness();
      return clean === false && Game.cleanLaps === 1 && cleanAfter === true;
    })(), 'dirty lap ignored, clean lap counted');

  /* ---- the level display follows the saved XP ------------------------- */
  check('the menu and profile level bars follow the saved XP',
    (function () {
      Save.addXp(400);
      OR.Screens.renderLevels(false);
      const progress = XP.progress(Save.xp());
      return doc.getElementById('menuLevelBar').dataset.target ===
          String(Math.round(progress.ratio * 100)) &&
        doc.getElementById('menuLevel').dataset.level === String(progress.level) &&
        doc.getElementById('profileLevelBar').dataset.target ===
          String(Math.round(progress.ratio * 100));
    })(), 'level ' + Save.progress().level + ' · ' + Save.xp() + ' XP');
}

/* =========================== summary ====================================== */
console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
}

if (doc.readyState === 'complete') {
  runTests();
} else {
  win.addEventListener('load', runTests);
}
