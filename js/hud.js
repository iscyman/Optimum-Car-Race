/* =============================================================================
 * hud.js — thin wrapper over the DOM heads-up display.
 * Values are cached so we only touch the DOM when something actually changes.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Utils, Track, Race } = OR;
  const B = CONFIG.boost;

  const HUD = {
    el: {},
    _cache: {},

    init() {
      const id = name => document.getElementById(name);
      HUD.el = {
        root: id('hud'),
        speedValue: id('speedValue'),
        speedBar: id('speedBar'),
        timerValue: id('timerValue'),
        lapValue: id('lapValue'),
        lapTotal: id('lapTotal'),
        lapTimeValue: id('lapTimeValue'),
        bestLapValue: id('bestLapValue'),
        progressFill: id('progressFill'),
        distanceValue: id('distanceValue'),
        boostWidget: id('boostWidget'),
        boostRing: id('boostRing'),
        boostValue: id('boostValue'),
        boostStatus: id('boostStatus'),
        shardCount: id('shardCount'),
        pauseLap: id('pauseLap'),
        pauseTime: id('pauseTime')
      };
      HUD._cache = {};
      return HUD;
    },

    show() { HUD.el.root.classList.remove('hidden'); },
    hide() { HUD.el.root.classList.add('hidden'); },

    _set(key, value, apply) {
      if (HUD._cache[key] === value) return;
      HUD._cache[key] = value;
      apply(value);
    },

    update(game) {
      const el = HUD.el;
      const car = game.car;
      const kmh = Math.round(car.speedKmh());

      HUD._set('speed', kmh, v => { el.speedValue.textContent = v; });
      HUD._set('speedBar', Math.round((car.speed / CONFIG.car.maxSpeed) * 100),
        v => { el.speedBar.style.width = Utils.clamp(v, 0, 100) + '%'; });

      /* ---- total race clock ---------------------------------------------- */
      const running = game.state === 'racing' || game.state === 'countdown' ||
        game.state === 'paused';
      const timeMs = running ? game.raceTimeMs : game.finalTimeMs;
      HUD._set('time', Utils.formatTime(timeMs),
        v => { el.timerValue.textContent = v; });

      /* ---- lap card (Step 4) --------------------------------------------- */
      HUD._set('lap', Race.lap + '/' + Race.laps,
        v => { el.lapValue.textContent = String(Race.lap); });
      HUD._set('lapTotal', Race.laps, v => { el.lapTotal.textContent = String(v); });

      // the current lap timer freezes with the clock, and shows the final
      // lap's time once the flag is out
      const lapMs = Race.finished
        ? (Race.lapTimes.length ? Race.lapTimes[Race.lapTimes.length - 1] : 0)
        : Race.lapTimeMs(game.raceTimeMs);
      HUD._set('lapTime', Utils.formatTime(lapMs),
        v => { el.lapTimeValue.textContent = v; });

      HUD._set('bestLap', Race.bestLapMs ? Utils.formatTime(Race.bestLapMs) : '',
        v => {
          el.bestLapValue.textContent = v ? 'BEST ' + v : 'BEST --:--.---';
          el.bestLapValue.classList.toggle('is-set', !!v);
        });

      HUD._set('progress', Math.round(Race.lapProgress(car.x, car.y) * 100),
        v => { el.progressFill.style.width = Utils.clamp(v, 0, 100) + '%'; });

      HUD._set('distance', Math.round(Track.distanceRemaining(car.x, car.y, car.trackHint)),
        v => { el.distanceValue.textContent = v + ' m to go'; });

      /* ---- CODED BOOST meter (Step 3) ------------------------------------ */
      const meter = car.meter;
      const pct = Math.round(car.meterRatio() * 100);
      const boosting = car.boost.active;
      const cooling = !boosting && car.boost.cooldown > 0;
      const low = !boosting && !cooling && meter < B.threshold;

      HUD._set('boostMeter', Math.round(meter), v => {
        const colour = boosting ? CONFIG.theme.cyan
          : cooling ? CONFIG.theme.amber
            : low ? CONFIG.theme.magenta : CONFIG.theme.violet;
        el.boostRing.style.background =
          'conic-gradient(' + colour + ' ' + v + '%, rgba(255,255,255,0.08) 0)';
        el.boostValue.textContent = String(v);
        el.boostWidget.style.setProperty('--charge', v + '%');
      });

      let status;
      if (boosting) {
        status = 'BOOSTING ' + (meter / B.drainPerSecond).toFixed(1) + 's';
      } else if (cooling) {
        status = 'COOLING ' + car.boost.cooldown.toFixed(1) + 's';
      } else if (low) {
        status = 'NEED ' + B.threshold + '%';
      } else {
        status = 'READY';
      }
      HUD._set('boostStatus', status, v => { el.boostStatus.textContent = v; });

      let cls = 'boost-widget';
      if (boosting) cls += ' is-active';
      else if (cooling) cls += ' is-cooling';
      else if (low) cls += ' is-low';
      else cls += ' is-ready';
      HUD._set('boostCls', cls, v => { el.boostWidget.className = v; });

      HUD._set('boostPct', pct, v => {
        el.boostWidget.setAttribute('aria-label',
          'Coded boost ' + v + ' percent, ' + status);
      });

      const shards = OR.Shards;
      HUD._set('shards', shards.collected + '/' + shards.items.length,
        v => { el.shardCount.textContent = v; });

      /* ---- pause menu figures -------------------------------------------- */
      if (game.state === 'paused') {
        HUD._set('pauseLap', Race.lap + '/' + Race.laps,
          v => { el.pauseLap.textContent = v; });
        HUD._set('pauseTime', Utils.formatTime(game.raceTimeMs),
          v => { el.pauseTime.textContent = v; });
      }
    }
  };

  OR.HUD = HUD;
})();
