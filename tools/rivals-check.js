/* =============================================================================
 * tools/rivals-check.js — real-Chrome Step 6 integration and mobile performance.
 * Start the dev server, then: npm run rivals [-- URL]
 * Pass the standalone file's file:// URL to verify the offline build too.
 * Phone emulation checks native frame rate and 4×-throttled main-thread cost.
 * Step 7 also drives the difficulty picker, its persistence across a real
 * reload, the HUD/finish labels, the per-difficulty best time and blocked
 * localStorage.
 * Neither measurement is a claim about a physical handset.
 * ========================================================================== */
'use strict';

const puppeteer = require('puppeteer');
const URL = process.argv[2] || 'http://localhost:3000/';
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  (' + detail + ')' : ''));
}

(async () => {
  const browser = await puppeteer.launch({ args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'
  ] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window.OR && OR.Game.car);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
    await page.click('#startBtn');

    const visuals = await page.evaluate(() => {
      const { Game, Rivals, Renderer, Track, CONFIG } = OR;
      cancelAnimationFrame(Game._raf);
      Game.startRace(42);
      const image = () => {
        Renderer.draw(Game);
        return Renderer.ctx.getImageData(0, 0, Renderer.canvas.width, Renderer.canvas.height).data;
      };
      const changed = (a, b) => {
        let pixels = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) pixels++;
        }
        return pixels;
      };
      const withRivals = image();
      Game.rivals = [];
      const withoutRivals = image();
      Game.rivals = Rivals.items;
      const rival = Game.rivals[0];
      const withoutStall = image();
      rival.ai.stalled = true;
      const withStall = image();
      Renderer.reducedMotion = true;
      const staticStall = image();
      Renderer.reducedMotion = false;
      rival.ai.stalled = false;

      // Spread dots around the circuit so their three different colours can
      // be measured separately, then rebuild the real grid immediately after.
      Game.rivals.forEach((car, i) => {
        const p = Track.pointAt(Track.length * (0.2 + i * 0.25));
        car.x = p.x; car.y = p.y;
      });
      Renderer.buildMinimapPath();
      Renderer.drawMinimap(Game);
      const map = Renderer.minimap;
      const mapPixels = Game.rivals.map(car => {
        const x = Math.round((car.x * map.scale + map.offsetX) * map.dpr);
        const y = Math.round((car.y * map.scale + map.offsetY) * map.dpr);
        return Array.from(map.ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
      });
      Game.startRace(42);
      OR.HUD.update(Game);
      return {
        rivalPixels: changed(withRivals, withoutRivals),
        stallPixels: changed(withoutStall, withStall),
        staticStallPixels: changed(withoutStall, staticStall),
        mapPixels,
        names: Array.from(document.querySelectorAll('#standingsList .standing-name')).map(el => el.textContent),
        gridProgress: Game.entities.map(car => car.race.progress),
        fieldSize: Game.entities.length,
        step: CONFIG.race.fixedStep
      };
    });
    check('four cars start behind the line in the real browser', visuals.fieldSize === 4 &&
      visuals.gridProgress.every(progress => progress < 0));
    check('the three rival sprites are genuinely painted', visuals.rivalPixels > 1000,
      visuals.rivalPixels + ' changed pixels');
    check('gameplay-stall bolts are genuinely painted', visuals.stallPixels > 50,
      visuals.stallPixels + ' changed pixels');
    check('the stall indicator remains visible with reduced motion', visuals.staticStallPixels > 50);
    check('the minimap paints three distinct rival colours',
      visuals.mapPixels[0][0] > 200 && visuals.mapPixels[0][1] > 100 &&
      visuals.mapPixels[1][1] > 200 && visuals.mapPixels[1][0] < 150 &&
      visuals.mapPixels[2][0] > 200 && visuals.mapPixels[2][1] < 160,
      JSON.stringify(visuals.mapPixels));
    check('the HUD shows all four full names', visuals.names.length === 4 &&
      visuals.names.includes('YOU') && visuals.names.includes('STANDARD GOSSIP 3'));

    // ---- Step 7: difficulty selection, HUD, results, best times -------------
    await page.evaluate(() => { try { localStorage.clear(); } catch (error) { /* blocked */ } });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.OR && OR.Game.car);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
    const picker = await page.evaluate(() => ({
      labels: Array.from(document.querySelectorAll('#difficultyPicker .diff-btn')).map(b => b.textContent),
      selected: (document.querySelector('#difficultyPicker .is-selected') || { dataset: {} }).dataset.difficulty,
      current: OR.Difficulty.currentId(),
      hint: document.getElementById('difficultyHint').textContent,
      stored: (() => { try { return localStorage.getItem(OR.CONFIG.difficulty.keys.selection); } catch (e) { return null; } })()
    }));
    check('a fresh install shows three difficulty buttons with NORMAL preselected',
      picker.labels.join(',') === 'EASY,NORMAL,HARD' && picker.current === 'normal' &&
      picker.selected === 'normal' && picker.hint.length > 10, picker.labels.join(' / '));

    await page.click('#difficultyPicker [data-difficulty="hard"]');
    const chosen = await page.evaluate(() => ({
      current: OR.Difficulty.currentId(),
      selected: (document.querySelector('#difficultyPicker .is-selected') || { dataset: {} }).dataset.difficulty,
      stored: (() => { try { return localStorage.getItem(OR.CONFIG.difficulty.keys.selection); } catch (e) { return null; } })(),
      chip: document.getElementById('hudDifficulty').textContent
    }));
    check('clicking HARD selects it and writes it to storage',
      chosen.current === 'hard' && chosen.selected === 'hard' && chosen.stored === 'hard',
      'stored=' + chosen.stored);

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.OR && OR.Game.car);
    const persisted = await page.evaluate(() => ({
      current: OR.Difficulty.currentId(),
      selected: (document.querySelector('#difficultyPicker .is-selected') || { dataset: {} }).dataset.difficulty,
      chip: document.getElementById('hudDifficulty').textContent
    }));
    check('the choice survives a real page reload',
      persisted.current === 'hard' && persisted.selected === 'hard');

    const finished = await page.evaluate(() => {
      const { Game, Race, Track, Input, CONFIG } = OR;
      Input.enableTouchMode(false);
      Game.startRace(77);              // picks up the saved HARD level
      Game.countdown = 0;
      const p = Track.pointAt(Track.length - 420);
      const car = Game.car;
      car.trackHint = p.index; car.x = p.x; car.y = p.y;
      car.heading = Math.atan2(p.tx, -p.ty);
      car.vx = p.tx * 700; car.vy = p.ty * 700;
      car.syncVelocity();
      Race.lap = CONFIG.race.laps;
      Race.lapBase = 0;
      Race.progress = 0.955;
      Race.lastFraction = 0.955;
      Race.nextCheckpoint = Track.checkpoints.length;
      for (let i = 0; i < 120 * 3 && !Game.results; i++) {
        Input._keys.throttle = true;
        Game.step(CONFIG.race.fixedStep);
      }
      Input.reset();
      for (let i = 0; i < 240; i++) Game.step(CONFIG.race.fixedStep); // coast-out
      OR.HUD.update(Game);   // the HUD is refreshed by the render loop; force it
      return {
        done: !!Game.results,
        state: Game.state,
        results: Game.results,
        chip: document.getElementById('hudDifficulty').textContent,
        finishDifficulty: document.getElementById('finalDifficulty').textContent,
        finishBest: document.getElementById('finalBestTime').textContent,
        newBest: document.getElementById('finalBestTime').classList.contains('is-new'),
        storedBest: OR.Difficulty.best('hard'),
        otherBests: [OR.Difficulty.best('easy'), OR.Difficulty.best('normal')]
      };
    });
    check('a HARD race finishes with the difficulty recorded',
      finished.done && finished.results.difficultyId === 'hard' &&
      finished.results.difficulty === 'HARD' && finished.state === 'finished',
      'state ' + finished.state);
    check('the HUD and finish screen both label the difficulty',
      finished.chip === 'HARD' && finished.finishDifficulty === 'HARD',
      'HUD ' + finished.chip + ', results ' + finished.finishDifficulty);
    check('the finish screen shows the best-on-difficulty line',
      /Best on Hard/.test(finished.finishBest) && finished.newBest &&
      finished.results.isNewBest === true, finished.finishBest);
    check('only HARD stores that best time',
      finished.storedBest === finished.results.timeMs &&
      finished.otherBests.every(ms => ms === 0 || ms !== finished.results.timeMs),
      'hard ' + finished.storedBest + ' ms, others ' + JSON.stringify(finished.otherBests));

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.OR && OR.Game.car);
    const bestAfterReload = await page.evaluate(() => OR.Difficulty.best('hard'));
    check('the best time survives a reload and stays per difficulty',
      bestAfterReload === finished.results.timeMs &&
      bestAfterReload !== finished.otherBests[1], bestAfterReload + ' ms');

    const race = await page.evaluate(() => {
      const { Game, Track, Input, CONFIG, Standings } = OR;
      Input.enableTouchMode(false);
      Game.startRace(1234, 'normal');
      for (let i = 0; i < 120 * 100 && !Game.results; i++) {
        const car = Game.car;
        const ahead = Track.pointAhead(car.x, car.y, 260, car.trackHint);
        const want = Math.atan2(ahead.x - car.x, -(ahead.y - car.y));
        const error = Math.atan2(Math.sin(want - car.heading), Math.cos(want - car.heading));
        Input._keys.throttle = car.speed < 550;
        Input._keys.brake = car.speed > 575;
        Input._keys.left = error < -0.012;
        Input._keys.right = error > 0.012;
        Game.step(CONFIG.race.fixedStep);
      }
      Input.reset();
      const result = Game.results;
      if (!result) return { finished: false, state: Game.state };
      const frozen = JSON.stringify(result.standings);
      for (let i = 0; i < 240; i++) Game.step(CONFIG.race.fixedStep);
      Game.render(1 / 60);
      return {
        finished: Game.state === 'finished', place: result.place,
        playerLaps: result.lapTimes.length,
        rivalLaps: Game.rivals.map(car => car.race.lapTimes.length),
        standings: result.standings,
        frozen: frozen === JSON.stringify(Game.results.standings) && Standings.frozen,
        hudPlace: document.getElementById('positionValue').textContent,
        finishPlace: document.getElementById('finalPosition').textContent,
        finishNames: Array.from(document.querySelectorAll('#finalStandings .standing-name')).map(el => el.textContent)
      };
    });
    check('a complete four-car race reaches the results screen', race.finished && race.playerLaps === 3,
      'player place ' + race.place);
    check('AI rivals complete laps while the player races', race.rivalLaps && race.rivalLaps.every(laps => laps >= 2));
    check('final standings have correct finish-time/progress order', race.standings &&
      race.standings.every((row, i, rows) => {
        if (!i) return true;
        const previous = rows[i - 1];
        if (previous.finished !== row.finished) return previous.finished;
        return row.finished ? previous.timeMs <= row.timeMs : previous.progress >= row.progress;
      }));
    check('live position, result place and highlighted player agree', race.standings &&
      race.standings[race.place - 1].isPlayer && race.hudPlace === String(race.place) &&
      race.finishPlace === race.place + ' / 4' && race.finishNames.length === 4);
    check('results remain frozen throughout coast-out', race.frozen);
    check('uncompleted rivals are not assigned fabricated times', race.standings &&
      race.standings.filter(row => !row.finished).every(row => row.timeMs === null && row.remainingMeters > 0));

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(URL + (URL.includes('?') ? '&' : '?') + 'touch=1', { waitUntil: 'load' });
    await page.waitForFunction(() => window.OR && OR.Game.car);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
    await page.click('#startBtn');
    const client = await page.createCDPSession();
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const mobile = await page.evaluate(async () => {
      const { Game, Track, Input, Renderer, CONFIG } = OR;
      cancelAnimationFrame(Game._raf);
      Game.startRace(77);
      Game.countdown = 0;
      Game.step(CONFIG.race.fixedStep);
      Input.enableTouchMode(true);
      // All four sprites are close enough to share a phone-width viewport.
      Game.entities.forEach((car, i) => {
        const p = Track.pointAt(Track.start.s + 780 - i * 26);
        const lane = -120 + i * 80;
        car.x = p.x + p.nx * lane; car.y = p.y + p.ny * lane;
        car.heading = Math.atan2(p.tx, -p.ty); car.trackHint = p.index;
        car.race.reset(car);
      });
      Game.rivals[0].ai.nextStall = 0.2; // include indicator work in the load
      Renderer.updateCamera(Game.car, 0, true);
      for (let i = 0; i < 30; i++) Game.render(1 / 60); // warm paths and JIT
      window.__step6PhoneBench = async () => {
        const timings = [];
        const start = performance.now();
        let previous = start, frames = 0, accumulator = 0;
        await new Promise(resolve => {
          function tick(now) {
            const before = performance.now();
            const dt = Math.min((now - previous) / 1000, CONFIG.race.maxStep);
            previous = now;
            Game.clock += dt;
            accumulator += dt;
            while (accumulator >= CONFIG.race.fixedStep) {
              Game.step(CONFIG.race.fixedStep);
              accumulator -= CONFIG.race.fixedStep;
            }
            Game.render(dt);
            timings.push(performance.now() - before);
            frames++;
            if (performance.now() - start < 2500) requestAnimationFrame(tick);
            else resolve();
          }
          requestAnimationFrame(tick);
        });
        const elapsed = performance.now() - start;
        const average = timings.reduce((sum, ms) => sum + ms, 0) / timings.length;
        timings.sort((a, b) => a - b);
        const order = document.querySelector('.hud-race-order').getBoundingClientRect();
        return {
          fps: frames / (elapsed / 1000), averageMs: average,
          p95Ms: timings[Math.floor(timings.length * 0.95)],
          fieldSize: Game.entities.length,
          touch: !document.getElementById('touchControls').classList.contains('hidden'),
          fits: order.left >= 0 && order.right <= window.innerWidth,
          particles: Renderer.particles.length, marks: Renderer.marks.length,
          finite: Game.entities.every(car => Number.isFinite(car.x) && Number.isFinite(car.y)),
          renderDpr: Renderer.dpr,
          roadSize: Renderer.roadLayer ? [Renderer.roadLayer.canvas.width, Renderer.roadLayer.canvas.height] : []
        };
      };
      return await window.__step6PhoneBench();
    });
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const stress = await page.evaluate(() => window.__step6PhoneBench());
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    check('touch controls and standings fit a 390px phone', mobile.touch && mobile.fits && mobile.fieldSize === 4);
    check('four-car rendering is smooth at native speed in phone emulation',
      mobile.fps > 45 && mobile.averageMs < 16.7,
      mobile.fps.toFixed(1) + ' fps; mean ' + mobile.averageMs.toFixed(2) +
      ' ms, p95 ' + mobile.p95Ms.toFixed(2) + ' ms/frame (emulated)');
    check('4× CPU stress keeps simulation and draw submission within the main-thread budget',
      stress.averageMs < 16.7 && stress.finite,
      'mean ' + stress.averageMs.toFixed(2) + ' ms; p95 ' + stress.p95Ms.toFixed(2) +
      ' ms; software-rendered frame rate ' + stress.fps.toFixed(1) + ' fps');
    check('phone graphics have bounded density and static-cache memory',
      mobile.renderDpr <= 1 && mobile.roadSize.length === 2 && Math.max(...mobile.roadSize) <= 3073);
    check('phone load keeps finite physics and bounded effects', mobile.finite &&
      mobile.particles <= 320 && mobile.marks <= 260);
    // ---- Step 7: blocked localStorage must not break the game ---------------
    const blockedPage = await browser.newPage();
    const blockedErrors = [];
    blockedPage.on('pageerror', error => blockedErrors.push(error.message));
    await blockedPage.goto(URL, { waitUntil: 'load' });
    await blockedPage.evaluateOnNewDocument(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new Error('localStorage is blocked'); }
      });
    });
    await blockedPage.reload({ waitUntil: 'load' });
    await blockedPage.waitForFunction(() => window.OR && OR.Game.car);
    const blocked = await blockedPage.evaluate(() => {
      let threw = false;
      try {
        OR.Difficulty.select('easy');
        OR.Game.startRace(5);
      } catch (error) { threw = true; }
      const best = OR.Difficulty.recordBest('easy', 41000);
      return {
        threw: threw,
        level: OR.Difficulty.currentId(),
        chip: document.getElementById('hudDifficulty').textContent,
        best: best.bestMs,
        bestText: OR.Difficulty.bestText('easy')
      };
    });
    check('the game runs with localStorage blocked', !blocked.threw && blocked.level === 'easy' &&
      blocked.best === 41000 && /Best on Easy/.test(blocked.bestText),
      'level ' + blocked.level + ', ' + blocked.bestText);
    check('blocked storage logs no page errors', blockedErrors.length === 0, blockedErrors.join(' | '));
    await blockedPage.close();

    check('no page or console errors', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
  }
  console.log('\n' + '-'.repeat(56));
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
