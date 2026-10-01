/* =============================================================================
 * standings.js — Step 6: checkpoint-valid race order and finish classification.
 *
 * Finished cars rank by recorded finish time. Others rank by validated lap +
 * distance, not by screen position or raw centreline fraction. When the player
 * takes the flag the classification is frozen. Unfinished rivals retain their
 * real remaining distance; no times are invented for them.
 * ========================================================================== */
(function () {
  'use strict';

  const { CONFIG, Track } = OR;

  const Standings = {
    cars: [],
    rows: [],
    playerPlace: 1,
    frozen: false,

    reset(cars) {
      Standings.cars = cars;
      Standings.frozen = false;
      Standings.rows = [];
      Standings.update();
    },

    update() {
      if (Standings.frozen) return Standings.rows;
      Standings.rows = Standings.cars.map(car => {
        const race = car.race;
        const progress = race.validProgress();
        return {
          id: car.id,
          name: car.name,
          color: car.color,
          isPlayer: !!car.isPlayer,
          gridSlot: car.gridSlot,
          progress: progress,
          lap: race.lap,
          finished: race.finished,
          timeMs: race.finished ? race.finishTimeMs : null,
          remainingMeters: Math.max(0,
            (race.laps - progress) * Track.length * CONFIG.track.metersPerUnit),
          stalled: !!(car.ai && car.ai.stalled)
        };
      }).sort((a, b) => {
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        if (a.finished && a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
        if (a.progress !== b.progress) return b.progress - a.progress;
        return a.gridSlot - b.gridSlot; // stable ties within a physics tick
      });
      Standings.rows.forEach((row, i) => { row.place = i + 1; });
      const player = Standings.rows.find(row => row.isPlayer);
      Standings.playerPlace = player ? player.place : 1;
      return Standings.rows;
    },

    finalize() {
      Standings.update();
      Standings.frozen = true;
      return Standings.rows.map(row => Object.assign({}, row, { stalled: false }));
    }
  };

  OR.Standings = Standings;
})();
