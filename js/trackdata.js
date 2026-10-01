/* =============================================================================
 * trackdata.js — tracks as DATA, completely separate from game logic (Step 5).
 *
 * A track is a closed loop described by control points. The geometry module
 * (track.js) turns them into a smooth, evenly spaced centerline at load time —
 * nothing here knows about the car, the renderer or the race rules.
 *
 * Adding a track = adding an entry to OR.TRACKS. Step 8 does exactly that.
 *
 * Coordinate space: x = right, y = down, 1 unit = 0.1 m.
 *   roadHalf / kerbWidth / grassMargin are measured from the centerline.
 *   checkpointFractions are arc-length positions around a lap, in order, with
 *   0 = the start/finish line.
 * ========================================================================== */
(function () {
  'use strict';

  OR.TRACKS = [
    {
      id: 'flexnode',
      name: 'FLEXNODE CIRCUIT',
      subtitle: 'Fast, flowing, one big hairpin',

      /* Closed centerline. The game smooths these with centripetal
         Catmull-Rom, so corners are drawn by clustering points. */
      points: [
        [-800, -1000], [-100, -1000], [600, -1000], [1250, -995],
        [1750, -940], [2050, -780], [2210, -520], [2260, -220],
        [2210, 90], [2040, 370], [1800, 530], [1500, 640],
        [1220, 720], [980, 800], [760, 880], [430, 920],
        [60, 930], [-300, 930], [-640, 890], [-960, 810],
        [-1240, 690], [-1500, 530], [-1720, 320], [-1860, 60],
        [-1900, -220], [-1810, -470], [-1620, -660], [-1400, -820],
        [-1150, -940]
      ],

      /* Geometry */
      roadWidth: 420,
      kerbWidth: 34,
      grassMargin: 62,
      rowStep: 14,          // world units between centerline samples

      /* Race line */
      startIndex: 0,        // control point the start/finish line sits on
      checkpointFractions: [0.25, 0.5, 0.75],
      laps: 3,

      /* Scenery, generated deterministically outside the barriers */
      scenery: {
        seed: 20240917,
        spacing: 210,
        types: ['pylon', 'tree', 'crystal', 'node', 'billboard'],
        nodeChance: 0.5
      },

      /* Corner names, for the HUD/minimap and the track select screen.
         Positions are arc-length fractions around the lap. */
      corners: [
        { name: 'T1', at: 0.19, radius: 1250 },
        { name: 'T2', at: 0.24, radius: 900 },
        { name: 'T3', at: 0.31, radius: 1100 },
        { name: 'T4', at: 0.40, radius: 1000 },
        { name: 'T5', at: 0.47, radius: 1150 },
        { name: 'T6', at: 0.56, radius: 1300 },
        { name: 'T7', at: 0.66, radius: 1200 },
        { name: 'T8', at: 0.76, radius: 1050 },
        { name: 'MESH HAIRPIN', at: 0.88, radius: 381 },
        { name: 'T10', at: 0.95, radius: 1000 }
      ],

      /* Difficulty rating, used by the track select screen in Step 8 */
      rating: 2
    }
  ];

  /** The track currently being raced. Step 8 will change this at runtime. */
  OR.activeTrack = OR.TRACKS[0];
})();
