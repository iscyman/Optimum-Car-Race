/* =============================================================================
 * tools/visual-check.js — headless-Chrome check of what is actually on screen.
 *
 * The unit suite (tests/smoke.js) uses a stubbed canvas, so it cannot tell you
 * whether anything is really drawn. This tool samples real pixels from the
 * rendered frame and measures frame cost. Dev only — needs puppeteer.
 *
 *   node tools/visual-check.js [url]      (start the dev server first)
 * ========================================================================== */
'use strict';

const path = require('path');
const puppeteer = require('puppeteer');

const URL = process.argv[2] || 'file://' + path.join(__dirname, '..', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  PASS  ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  (' + extra + ')' : '')); }
}

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'load' });
  await sleep(600);

  /* ---- sound toggle builds a real AudioContext ---------------------------- */
  await page.click('.menu-sound [data-action="sound"]');
  await sleep(250);
  const audio = await page.evaluate(() => ({
    enabled: OR.Audio.isEnabled(),
    ctx: !!OR.Audio.ctx,
    state: OR.Audio.ctx && OR.Audio.ctx.state
  }));
  check('the sound toggle starts a Web Audio context',
    audio.enabled && audio.ctx, 'state=' + audio.state);
  await page.click('.menu-sound [data-action="sound"]');

  /* ---- drive into a drift ------------------------------------------------ */
  await page.click('#startBtn');
  await sleep(4200);
  await page.keyboard.down('ArrowUp');
  await sleep(1600);
  await page.keyboard.down('ArrowRight');
  await sleep(750);
  await page.keyboard.up('ArrowRight');
  await sleep(150);

  const pixels = await page.evaluate(() => {
    const R = OR.Renderer, T = OR.Track, car = OR.Game.car, v = R.view;
    /* For pixel sampling the view is centred on the car by hand: this probe is
       about what is painted on and beside the road, not about the camera. */
    const centreOnCar = () => {
      v.scale = 0.889;
      v.camX = car.x;                 // car in the middle of the screen
      v.camY = car.y - 400 / v.scale;
      R.draw(OR.Game);
    };
    const px = (x, y) => {
      const sx = (x - v.camX) * v.scale + v.w / 2, sy = (y - v.camY) * v.scale;
      if (sx < 1 || sy < 1 || sx >= v.w - 1 || sy >= v.h - 1) return null;
      const d = R.ctx.getImageData(Math.round(sx * R.dpr), Math.round(sy * R.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const driftState = { heading: car.heading, drift: car.drifting };

    // A/B the tire marks while the car is still where it laid them
    const frame = () => {
      R.draw(OR.Game);
      const img = R.ctx.getImageData(0, 0, R.canvas.width, R.canvas.height).data;
      return img;
    };
    const withMarks = frame();
    const savedMarks = R.marks.slice();
    R.marks.length = 0;
    const withoutMarks = frame();
    R.marks.push(...savedMarks);
    let markPixels = 0;
    for (let i = 0; i < withMarks.length; i += 4) {
      if (withMarks[i] !== withoutMarks[i]) markPixels++;
    }

    // park on the hairpin: the kerbs are only painted where the track turns
    const hair = T.pointAt(0.88 * T.length);
    car.trackHint = hair.index;
    car.x = hair.x; car.y = hair.y;
    car.heading = Math.atan2(hair.tx, -hair.ty);
    car.vx = hair.tx * 400; car.vy = hair.ty * 400; car.speed = 400;
    R.updateCamera(car, 0, true);
    centreOnCar();

    // sample a little way up the road, across the track's normal, so the
    // car itself is never in the sample
    const info = T.nearest(car.x, car.y, null);
    const c = T.pointAt(info.s + 160);
    const side = (d) => [c.x + c.nx * d, c.y + c.ny * d];

    const kerbR = side(T.kerbStart + 16);
    const grassR = side(T.grassStart + 30);
    const grassL = side(-(T.grassStart + 30));
    const barrierR = side(T.hardLimit);
    const outsideR = side(T.hardLimit + 120);
    return {
      asphalt: px(c.x, c.y),
      kerb: px(kerbR[0], kerbR[1]),
      grassRight: px(grassR[0], grassR[1]),
      grassLeft: px(grassL[0], grassL[1]),
      barrierRight: px(barrierR[0], barrierR[1]),
      outside: px(outsideR[0], outsideR[1]),
      carPixel: px(car.x, car.y),
      markCount: savedMarks.length,
      markPixels: markPixels,
      outSamples: (function () {
        const out = [];
        for (let d = 80; d <= 700; d += 40) {
          const s = side(T.hardLimit + d);
          out.push(px(s[0], s[1]));
        }
        return out;
      })(),
      heading: driftState.heading,
      drift: driftState.drift
    };
  });

  const green = p => p && p[1] > p[0] + 3 && p[1] >= p[2];           // run-off is green
  const grey = p => p && Math.abs(p[0] - p[1]) < 16 && p[2] >= p[0]; // asphalt is neutral-cool
  const magenta = p => p && p[0] > 150 && p[2] > 100 && p[1] < 120;  // rumble stripes
  console.log('\nsurfaces sampled along the road:');
  console.log('  asphalt   rgb(' + pixels.asphalt + ')');
  console.log('  kerb      rgb(' + pixels.kerb + ')');
  console.log('  grass     rgb(' + pixels.grassRight + ') / rgb(' + pixels.grassLeft + ')');
  console.log('  barrier   rgb(' + pixels.barrierRight + ')');
  console.log('  outside   rgb(' + pixels.outside + ')');
  console.log('');
  check('asphalt is drawn on the road', grey(pixels.asphalt));
  check('the kerb / rumble strip is drawn',
    (grey(pixels.kerb) && pixels.kerb[0] > 120) || magenta(pixels.kerb),
    'white base with magenta dashes');
  check('grass run-off is drawn on both sides',
    green(pixels.grassRight) && green(pixels.grassLeft));
  check('the barrier is drawn at the edge', pixels.barrierRight[2] > pixels.barrierRight[1]);
  // Outside the barrier there is only dark ground and neon scenery — never the
  // road surface and never the grass run-off. Both are sampled in this same
  // frame, so this is an exact colour comparison rather than a guess.
  const close = (a, b) => a && b &&
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 15;
  const painted = pixels.outSamples.filter(p =>
    close(p, pixels.asphalt) || close(p, pixels.grassRight)).length;
  const visible = pixels.outSamples.filter(Boolean).length;
  check('no road or grass is drawn outside the playable area',
    painted === 0, painted + ' of ' + visible + ' samples past the barrier match the road/grass');
  check('the car is drawn at its own position',
    pixels.carPixel[0] + pixels.carPixel[1] + pixels.carPixel[2] > 150);
  check('the car is rotated while cornering', Math.abs(pixels.heading) > 0.2,
    (pixels.heading * 180 / Math.PI).toFixed(0) + ' deg');
  check('tire marks are really drawn on the road', pixels.markPixels > 200,
    pixels.markCount + ' marks change ' + pixels.markPixels + ' pixels');

  /* ---- CODED BOOST shards and meter (Step 3) ----------------------------- */
  const boost = await page.evaluate(() => {
    const R = OR.Renderer, T = OR.Track, car = OR.Game.car, v = R.view;
    // park the car just short of a shard and run the camera
    OR.Game.startRace();
    const shard = OR.Shards.items[0];
    const back = T.pointAt(shard.s - 380);   // just short of it, on the road
    car.trackHint = back.index;
    car.x = back.x; car.y = back.y;
    car.heading = Math.atan2(back.tx, -back.ty);
    car.vx = 0; car.vy = 0; car.speed = 0;
    R.updateCamera(car, 0, true);
    R.draw(OR.Game);

    const toScreen = (x, y) => {
      const sx = (x - v.camX) * v.scale + v.w / 2, sy = (y - v.camY) * v.scale;
      return (sx < 1 || sy < 1 || sx >= v.w - 1 || sy >= v.h - 1) ? null : [sx, sy];
    };
    const px = (x, y) => {
      const s = toScreen(x, y);
      if (!s) return null;
      const d = R.ctx.getImageData(Math.round(s[0] * R.dpr), Math.round(s[1] * R.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    // count cyan pixels in a box around the shard
    let cyan = 0, roadCyan = 0;
    for (let dy = -500; dy < 500; dy += 4) {
      for (let dx = -220; dx < 220; dx += 4) {
        const p = px(car.x + dx, car.y + dy);
        if (!p) continue;
        const isCyan = p[2] > 120 && p[1] > 90 && p[2] > p[0] + 30;
        if (isCyan) { cyan++; if (dy > -160) roadCyan++; }
      }
    }
    const shardPixel = px(shard.x, shard.y);
    return { shardCount: OR.Shards.items.length, cyan, roadCyan, shardPixel,
             shardOffset: Math.round(Math.abs(T.nearest(shard.x, shard.y, null).offset)) };
  });
  console.log('\nshards:');
  console.log('  shard at offset ' + boost.shardOffset + ' from the centreline, pixel rgb(' +
    boost.shardPixel + ')');
  check('shards are drawn on the road', boost.cyan > 20,
    boost.shardCount + ' shards, ' + boost.cyan + ' cyan pixels visible');
  check('shards sit on the track surface', boost.shardOffset < 210,
    'offset ' + boost.shardOffset + ' of 210');
  check('a shard has a visible cyan core',
    !!boost.shardPixel && boost.shardPixel[1] > 120 && boost.shardPixel[2] > 150,
    'rgb(' + boost.shardPixel + ')');

  const meterStates = await page.evaluate(() => {
    const car = OR.Game.car, out = {};
    const snap = () => ({
      status: document.getElementById('boostStatus').textContent,
      value: document.getElementById('boostValue').textContent,
      cls: document.getElementById('boostWidget').className
    });
    car.meter = 100; car.boost.cooldown = 0;
    OR.HUD.update(OR.Game); out.ready = snap();
    car.requestBoost(true);
    OR.HUD.update(OR.Game); out.boosting = snap();
    car.meter = 0; car.boost.active = false; car.boost.cooldown = 3;
    OR.HUD.update(OR.Game); out.cooling = snap();
    car.boost.cooldown = 0; car.meter = 10;
    OR.HUD.update(OR.Game); out.low = snap();
    car.meter = 40;
    OR.HUD.update(OR.Game);
    return out;
  });
  console.log('meter states: ' + JSON.stringify(meterStates));
  check('the HUD meter shows READY / BOOSTING / COOLING / NEED states',
    meterStates.ready.status === 'READY' &&
    /^BOOSTING/.test(meterStates.boosting.status) &&
    /^COOLING/.test(meterStates.cooling.status) &&
    /^NEED/.test(meterStates.low.status),
    meterStates.boosting.status + ' | ' + meterStates.cooling.status);

  /* ---- Step 4: checkpoint gates, lap card and pause ---------------------- */
  const step4 = await page.evaluate(async () => {
    const G = OR.Game, R = OR.Race, T = OR.Track, Renderer = OR.Renderer;
    G.startRace();
    const car = G.car;
    // park just short of a checkpoint so the gate is on screen
    const cp = T.checkpoints[0];
    const back = T.pointAt(cp.s - 500);
    car.trackHint = back.index;
    car.x = back.x; car.y = back.y;
    car.heading = Math.atan2(back.tx, -back.ty);
    car.vx = 0; car.vy = 0; car.speed = 0;
    R.nextCheckpoint = 0;
    Renderer.updateCamera(car, 0, true);
    Renderer.draw(G);

    const view = Renderer.view;
    const px = (x, y) => {
      const sx = (x - view.camX) * view.scale + view.w / 2;
      const sy = (y - view.camY) * view.scale;
      if (sx < 1 || sy < 1 || sx >= view.w - 1 || sy >= view.h - 1) return null;
      const d = Renderer.ctx.getImageData(Math.round(sx * Renderer.dpr), Math.round(sy * Renderer.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    // scan along the checkpoint line for cyan gate pixels
    const scanLine = (pt) => {
      let n = 0;
      for (let d = -T.halfRoad; d <= T.halfRoad; d += 6) {
        const p = px(pt.x + pt.nx * d, pt.y + pt.ny * d);
        if (p && p[2] > 90 && p[2] > p[0] + 25 && p[1] > 60) n++;
      }
      return n;
    };
    const gatePixels = scanLine(cp);
    // and along a stretch of road with no gate on it
    const controlPixels = scanLine(T.pointAt((cp.s + 900) % T.length));

    // pause freezes the clock
    G.startRace();
    await new Promise(r => setTimeout(r, 200));
    G.state = 'racing';
    G.raceTimeMs = 12345;
    OR.Input.queuePause();
    G.step(1 / 120);
    const t0 = G.raceTimeMs;
    for (let i = 0; i < 60; i++) G.step(1 / 120);
    const pausedState = G.state;
    const t1 = G.raceTimeMs;
    OR.Input.queuePause();
    G.step(1 / 120);
    return {
      gatePixels, controlPixels,
      pausedState, frozen: t0 === t1, resumed: G.state,
      pauseVisible: false
    };
  });
  console.log('\nstep 4:');
  check('checkpoint gates are drawn across the road', step4.gatePixels > 5,
    step4.gatePixels + ' gate pixels vs ' + step4.controlPixels + ' on plain road');
  check('pause freezes the race clock', step4.pausedState === 'paused' && step4.frozen,
    step4.pausedState + ', clock frozen=' + step4.frozen);
  check('pause toggles back to racing', step4.resumed === 'racing', step4.resumed);

  /* ---- Step 5: the circuit, its scenery and the minimap ------------------ */
  const step5 = await page.evaluate(() => {
    const G = OR.Game, R = OR.Renderer, T = OR.Track;
    G.startRace();
    const car = G.car;
    const out = {};

    const px = (x, y) => {
      const v = R.view;
      const sx = (x - v.camX) * v.scale + v.w / 2;
      const sy = (y - v.camY) * v.scale;
      if (sx < 1 || sy < 1 || sx >= v.w - 1 || sy >= v.h - 1) return null;
      const d = R.ctx.getImageData(Math.round(sx * R.dpr), Math.round(sy * R.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    /* asphalt is a mid-dark cool blue: brighter than the ground, bluer than
       the grass, and much less magenta than a kerb stripe */
    const isRoad = (q) => !!q && q[0] >= 16 && q[0] <= 140 &&
      q[2] > q[1] + 4 && q[2] - q[1] < 46 && q[2] >= q[0];
    const centre = () => {
      R.view.scale = 0.889;
      R.view.camX = car.x;
      R.view.camY = car.y - 400 / R.view.scale;
      R.draw(G);
    };
    const parkAt = (s) => {
      const p = T.pointAt(s);
      car.trackHint = p.index;
      car.x = p.x; car.y = p.y;
      car.heading = Math.atan2(p.tx, -p.ty);
      car.vx = p.tx * 400; car.vy = p.ty * 400; car.speed = 400;
      R.updateCamera(car, 0, true);
      centre();
      return p;
    };

    /* the road really does follow the loop data all the way round */
    out.roadSamples = [];
    for (let f = 0; f < 1; f += 1 / 12) {
      const p = parkAt(f * T.length);
      out.roadSamples.push(px(p.x + p.tx * 220, p.y + p.ty * 220));
    }
    out.roadOk = out.roadSamples.filter(isRoad).length;

    /* kerbs appear on the corners (the hairpin is at 0.88 of the lap) */
    const hair = parkAt(0.88 * T.length);
    const kL = px(hair.x - hair.nx * (T.kerbStart + 16), hair.y - hair.ny * (T.kerbStart + 16));
    const kR = px(hair.x + hair.nx * (T.kerbStart + 16), hair.y + hair.ny * (T.kerbStart + 16));
    out.hairpinKerbs = [kL, kR];
    out.hairpinRumble = [kL, kR].filter(p =>
      p && p[0] > 120 && p[2] > 80 && p[1] < 170).length;

    /* start / finish: the checkered band and its gantry */
    const start = T.start;
    const before = T.pointAt(T.length - 260);
    car.trackHint = before.index;
    car.x = before.x; car.y = before.y;
    car.heading = Math.atan2(before.tx, -before.ty);
    car.vx = 0; car.vy = 0; car.speed = 0;
    R.updateCamera(car, 0, true);
    R.draw(G);
    let checkered = 0;
    for (let d = -T.halfRoad + 20; d <= T.halfRoad - 20; d += 24) {
      const p = px(start.x + start.nx * d, start.y + start.ny * d);
      if (p && p[0] > 180 && p[1] > 180 && p[2] > 180) checkered++;
    }
    out.checkerPixels = checkered;

    /* the scenery is pre-rendered once into an offscreen layer */
    const layer = R.sceneryLayer;
    out.layer = layer ? { w: layer.canvas.width, h: layer.canvas.height } : null;
    if (layer) {
      const d = layer.canvas.getContext('2d')
        .getImageData(0, 0, layer.canvas.width, layer.canvas.height).data;
      let painted = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) painted++;
      out.layerPainted = painted;
    }
    out.sceneryItems = T.scenery.length;
    out.sceneryTypes = T.scenery.reduce((acc, it) => {
      acc[it.type] = (acc[it.type] || 0) + 1;
      return acc;
    }, {});

    /* the minimap: track outline, gates and a player dot that follows the car */
    const mm = document.getElementById('minimap');
    const readMap = () => {
      R.drawMinimap(G);
      const d = mm.getContext('2d').getImageData(0, 0, mm.width, mm.height).data;
      let lit = 0, violet = 0, cyan = 0, sx = 0, sy = 0, white = 0;
      for (let y = 0; y < mm.height; y++) {
        for (let x = 0; x < mm.width; x++) {
          const i = (y * mm.width + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
          if (a > 20) lit++;
          if (a > 60 && b > 90 && b > r + 25 && r > 60) violet++;
          if (a > 60 && b > 120 && g > 90 && b > r + 40 && g > r) cyan++;
          if (a > 200 && r > 200 && g > 200 && b > 200) { white++; sx += x; sy += y; }
        }
      }
      return { lit, violet, cyan, white, x: sx / Math.max(1, white), y: sy / Math.max(1, white) };
    };
    parkAt(0.05 * T.length);
    const mapA = readMap();
    parkAt(0.55 * T.length);
    const mapB = readMap();
    out.map = { lit: mapA.lit, violet: mapA.violet, cyan: mapA.cyan, white: mapA.white,
                dotMoved: Math.hypot(mapA.x - mapB.x, mapA.y - mapB.y),
                size: [mm.width, mm.height] };

    /* the road is a ribbon, not a filled area: scan across it and measure */
    const savedShards = OR.Shards.items.slice();
    const marksForScan = R.marks.slice();
    OR.Shards.items.length = 0;          // glows and rubber would blur the road edge
    R.marks.length = 0;
    const crossSection = (p) => {
      const half = (sign) => {
        let first = -1, second = -1, misses = 0, seen = false;
        for (let d = 150; d < 640; d += 6) {   // clear of the car and its shadow
          const q = px(p.x + p.nx * sign * d, p.y + p.ny * sign * d);
          if (isRoad(q)) {
            if (seen && misses >= 5 && second < 0) second = d;
            if (second < 0) first = d;
            seen = true;
            misses = 0;
          } else if (seen) {
            misses++;
          }
        }
        return { width: first, second: second };
      };
      return { right: half(1), left: half(-1) };
    };
    out.widths = [];
    out.hairpinSplit = false;
    for (const f of [0.02, 0.12, 0.37, 0.5, 0.63, 0.88]) {
      const p = parkAt(f * T.length);
      const cs = crossSection(p);
      out.widths.push([cs.right.width, cs.left.width]);
      // at the hairpin the scan runs across the infield into the other leg
      if (cs.right.second > 0 || cs.left.second > 0) out.hairpinSplit = true;
    }
    OR.Shards.items.push(...savedShards);
    R.marks.push(...marksForScan);
    return out;
  });
  console.log('\nstep 5 — circuit, scenery, minimap:');
  console.log('  the road follows the loop data: ' + step5.roadOk + '/12 points round the lap');
  console.log('  scenery: ' + step5.sceneryItems + ' items ' + JSON.stringify(step5.sceneryTypes) +
    ', offscreen layer ' + (step5.layer ? step5.layer.w + 'x' + step5.layer.h : 'missing'));
  console.log('  minimap: ' + JSON.stringify(step5.map));
  console.log('  road cross sections [right, left]: ' + JSON.stringify(step5.widths) +
    ' (half width is ' + 210 + ')');
  console.log('');
  check('the road is drawn all the way round the circuit', step5.roadOk >= 11,
    step5.roadOk + ' of 12 samples on the lap are asphalt');
  check('kerbs appear on the corners', step5.hairpinRumble >= 1,
    'hairpin kerb pixels ' + JSON.stringify(step5.hairpinKerbs));
  check('the start / finish line is painted across the road', step5.checkerPixels >= 3,
    step5.checkerPixels + ' white checker pixels');
  check('the scenery is pre-rendered into an offscreen layer',
    !!step5.layer && step5.layer.w >= 512 && step5.layerPainted > 2000,
    step5.layerPainted + ' painted pixels');
  check('the scene holds node markers as well as scenery',
    step5.sceneryItems > 20 && (step5.sceneryTypes.node || 0) >= 4,
    JSON.stringify(step5.sceneryTypes));
  check('the minimap draws the circuit', step5.map.lit > 300 && step5.map.violet > 100,
    step5.map.lit + ' lit pixels, ' + step5.map.violet + ' outline');
  check('the minimap shows the gates', step5.map.cyan > 4, step5.map.cyan + ' cyan pixels');
  check('the player dot follows the car on the minimap', step5.map.white > 3 &&
    step5.map.dotMoved > 10, 'dot moved ' + step5.map.dotMoved.toFixed(1) + ' px');
  check('the road is a ribbon of the right width everywhere',
    step5.widths.every(w => w[0] > 170 && w[0] < 260 && w[1] > 170 && w[1] < 260),
    JSON.stringify(step5.widths));
  check("the hairpin's two legs are separate pieces of road",
    step5.hairpinSplit, 'a cross section at the hairpin finds asphalt, grass, then asphalt');

  /* ---- performance ------------------------------------------------------- */
  const perf = await page.evaluate(async () => {
    let frames = 0;
    const t0 = performance.now();
    await new Promise(res => {
      (function tick() {
        frames++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else res();
      })();
    });
    const fps = frames / ((performance.now() - t0) / 1000);
    const t1 = performance.now();
    for (let i = 0; i < 120; i++) OR.Game.render(1 / 60);
    return { fps, drawMs: (performance.now() - t1) / 120 };
  });
  check('the frame rate stays smooth under load', perf.fps > 45,
    perf.fps.toFixed(1) + ' fps, ' + perf.drawMs.toFixed(3) + ' ms per frame');

  await page.keyboard.up('ArrowUp');
  check('no page or console errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('\n' + '='.repeat(56));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
