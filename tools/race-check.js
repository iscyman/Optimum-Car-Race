/* =============================================================================
 * tools/race-check.js — dev helper: drives a whole 3-lap race in real Chrome
 * with a simple autopilot and reports what happened (gates, lap times, finish
 * results, off-track steps). Useful as an end-to-end check that a change to
 * the track, the physics or the race logic did not break real lap scoring.
 *
 *   node tools/race-check.js [url]        (defaults to the dev server)
 * ========================================================================== */
const puppeteer=require('puppeteer'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const URL = process.argv[2] || 'http://localhost:3000/';
(async()=>{
  const b=await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox','--allow-file-access-from-files']});
  const p=await b.newPage(); await p.setViewport({width:1280,height:800});
  const errs=[]; p.on('pageerror',e=>errs.push('PAGE: '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
  await p.goto(URL,{waitUntil:'load'}); await sleep(800);
  await p.click('#startBtn'); await sleep(300);
  const res = await p.evaluate(()=>{
    const {Game, Track, Input, Renderer, Race, CONFIG}=OR;
    const STEP=CONFIG.race.fixedStep;
    Game.countdown=0;
    const log=[]; let lastCheck=0, lastLap=1, offTrackSteps=0, worstOffset=0;
    for(let i=0;i<120*260 && !Game.results;i++){
      const car=Game.car;
      const info=Track.nearest(car.x,car.y,car.trackHint);
      car.trackHint=info.index;
      worstOffset=Math.max(worstOffset,Math.abs(info.offset));
      if(car.surface!=='road') offTrackSteps++;
      const ahead=Track.pointAhead(car.x,car.y,Math.max(200,car.speed*0.55),car.trackHint);
      const want=Math.atan2(ahead.x-car.x,-(ahead.y-car.y));
      let err=want-car.heading;
      while(err>Math.PI)err-=Math.PI*2; while(err<-Math.PI)err+=Math.PI*2;
      const ratio=car.speed/CONFIG.car.maxSpeed;
      Input._keys.throttle = ratio<0.97;
      Input._keys.brake = ratio>0.99 && info.radius<620;
      Input._keys.left = err<-0.015;
      Input._keys.right = err>0.015;
      Game.step(STEP);
      if(Race.nextCheckpoint!==lastCheck){lastCheck=Race.nextCheckpoint;
        if(i%1===0) log.push('cp '+lastCheck+' at '+Game.raceTimeMs.toFixed(0)+'ms progress '+(Race.progress-Race.lapBase).toFixed(2));}
      if(Race.lap>lastLap){log.push('LAP '+lastLap+' done at '+Game.raceTimeMs.toFixed(0)+'ms');lastLap=Race.lap;}
    }
    Input._keys.throttle=Input._keys.brake=Input._keys.left=Input._keys.right=false;
    return {log, state:Game.state, lap:Race.lap, finished:Race.finished,
      lapTimes:Race.lapTimes.map(t=>Math.round(t)),
      checkpointsPassed:Race.checkpointsPassed, offTrackSteps, worstOffset:Math.round(worstOffset),
      raceMs:Math.round(Game.raceTimeMs), results:Game.results?{t:Math.round(Game.results.timeMs),laps:Game.results.laps,best:Math.round(Game.results.bestLapMs),shards:Game.results.shardsCollected,maxKmh:Math.round(Game.results.maxSpeedKmh)}:null,
      coords:[Math.round(Game.car.x),Math.round(Game.car.y)]};
  });
  console.log(JSON.stringify(res,null,1));
  await b.close();
  console.log(errs.length?('ERRORS '+errs.slice(0,6).join(' | ')):'no page/console errors');
})();
