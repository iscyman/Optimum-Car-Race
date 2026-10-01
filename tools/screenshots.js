/* =============================================================================
 * tools/screenshots.js — dev helper: drives the game in headless Chrome and
 * writes PNGs of every screen to /screenshots.  Not part of the game runtime.
 *   node tools/screenshots.js
 * ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const URL = 'file://' + path.join(ROOT, 'index.html');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Park the car on the racing line `s` units round the lap (for Step 5 shots). */
async function parkAt(page, fraction, speed) {
  await page.evaluate((f, v) => {
    const p = OR.Track.pointAt(f * OR.Track.length);
    const car = OR.Game.car;
    car.trackHint = p.index;
    car.x = p.x; car.y = p.y;
    car.heading = Math.atan2(p.tx, -p.ty);
    car.vx = -p.ty * 0; car.vy = 0;
    car.vx = p.tx * v; car.vy = p.ty * v; car.speed = v;
  }, fraction, speed || 0);
}

async function shoot(page, name) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file });
  console.log('  wrote ' + path.relative(ROOT, file));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files']
  });

  /* ---------------- desktop ---------------- */
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('  PAGE ERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('  CONSOLE: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(600);
  await shoot(page, '1-menu-desktop');

  await page.click('#startBtn');
  await sleep(1200);
  await shoot(page, '2-countdown-desktop');

  await sleep(2200);
  await page.keyboard.down('ArrowUp');
  await sleep(2500);
  await shoot(page, '3-racing-desktop');

  // hard cornering: the car slides and lays rubber (Step 2)
  await page.keyboard.down('ArrowRight');
  await sleep(800);
  await page.keyboard.up('ArrowRight');
  await sleep(160);
  await shoot(page, '4-drift-desktop');

  // run-off area: the grass slows the car right down (Step 2)
  await page.keyboard.up('ArrowUp');
  await page.evaluate(() => {
    const p = OR.Track.nearest(OR.Game.car.x, OR.Game.car.y, null).point;
    OR.Game.car.x = p.x + p.nx * (OR.Track.grassStart + 30);
    OR.Game.car.y = p.y + p.ny * (OR.Track.grassStart + 30);
  });
  await sleep(1400);
  await shoot(page, '5-grass-desktop');

  // Step 3: line the car up on a shard so the pickups and the meter show
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => {
    const shard = OR.Shards.items[2];
    const back = OR.Track.pointAt(shard.s - 320);
    const car = OR.Game.car;
    car.trackHint = back.index;
    car.x = back.x; car.y = back.y;
    car.heading = Math.atan2(back.tx, -back.ty);
    car.vx = back.tx * 500; car.vy = back.ty * 500; car.speed = 500;
  });
  await sleep(500);
  await shoot(page, '6-shards-desktop');

  // and fire the coded boost
  await page.evaluate(() => { OR.Game.car.meter = 100; OR.Game.car.boost.cooldown = 0; });
  await page.keyboard.press('Space');
  await sleep(420);
  await shoot(page, '7-boost-desktop');

  await sleep(1600);
  await page.keyboard.down('ArrowLeft');
  await sleep(900);
  await page.keyboard.up('ArrowLeft');
  await sleep(200);
  await shoot(page, '8-cornering-desktop');

  // Step 4: the lap card mid-race, then the pause menu
  await page.evaluate(() => {
    const R = OR.Race;
    R.lapTimes.push(15420, 15110);
    R.bestLapMs = 15110;
    R.lap = 3;
    R.nextCheckpoint = 1;
    const cp = OR.Track.checkpoints[1];
    const back = OR.Track.pointAt(cp.s - 420);
    const car = OR.Game.car;
    car.trackHint = back.index;
    car.x = back.x; car.y = back.y;
    car.heading = Math.atan2(back.tx, -back.ty);
    car.vx = back.tx * 600; car.vy = back.ty * 600; car.speed = 600;
  });
  await sleep(300);
  await shoot(page, '9-laps-desktop');

  await page.keyboard.press('Escape');
  await sleep(400);
  await shoot(page, '10-pause-desktop');
  await page.click('#resumeBtn');
  await sleep(300);

  // finish the race so the splits show
  await page.evaluate(() => {
    const p = OR.Track.pointAt(OR.Track.length - 500);   // just before the line
    const car = OR.Game.car;
    car.trackHint = p.index;
    car.x = p.x; car.y = p.y;
    car.heading = Math.atan2(p.tx, -p.ty);
    car.vx = p.tx * 700; car.vy = p.ty * 700; car.speed = 700;
    OR.Race.lap = OR.Race.laps;
    OR.Race.lapBase = 0;
    OR.Race.progress = 0.951;
    OR.Race.lastFraction = 0.951;
    OR.Race.nextCheckpoint = OR.Track.checkpoints.length;
  });
  await sleep(2600);
  await page.keyboard.up('ArrowUp');
  await sleep(1600);
  await shoot(page, '11-finishscreen-desktop');

  /* ---------------- mobile ---------------- */
  const mobile = await browser.newPage();
  await mobile.setViewport({
    width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true
  });
  mobile.on('pageerror', e => console.log('  MOBILE PAGE ERROR: ' + e.message));
  await mobile.goto(URL, { waitUntil: 'load' });
  await sleep(600);
  await shoot(mobile, '12-menu-mobile');

  await mobile.tap('#startBtn');
  await sleep(4200);
  await shoot(mobile, '13-racing-mobile');

  // hold the RIGHT pad button for a moment
  const rightBtn = await mobile.$('[data-action="right"]');
  const box = await rightBtn.boundingBox();
  await mobile.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(700);
  await shoot(mobile, '14-steering-mobile');
  await mobile.touchscreen.touchEnd();

  await sleep(1500);
  await shoot(mobile, '15-hud-mobile');

  await browser.close();
  console.log('\nDone.');
})();
