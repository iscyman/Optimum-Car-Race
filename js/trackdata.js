/* =============================================================================
 * trackdata.js — tracks as DATA, completely separate from game logic (Step 5).
 *
 * A track is a closed loop described by control points. The geometry module
 * (track.js) turns them into a smooth, evenly spaced centerline at load time —
 * nothing here knows about the car, the renderer or the race rules.
 *
 * Adding a track = adding an entry to OR.TRACKS. Step 8 does exactly that:
 *   FLEXNODE CIRCUIT   fast, flowing, one big hairpin        (rating 2)
 *   MESH HIGHWAY       fast, wide, long straights            (rating 1)
 *   SHARD SPEEDWAY     tight and technical                   (rating 3)
 *
 * Every track carries the same keys, and the game reads nothing else:
 *   geometry   points, roadWidth, kerbWidth, grassMargin, rowStep
 *   race line  startIndex, checkpointFractions, laps
 *   pickups    shards { count, laneSpread, startClear, endClear }
 *   dressing   scenery { seed, spacing, types, nodeChance }
 *   display    subtitle, corners, rating, blurb
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
      blurb: 'The original loop. Long sweepers, one proper hairpin, plenty of room.',

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

      /* Shard pickups, laid along the centerline (Step 8: per track) */
      shards: { count: 14, laneSpread: 0.62, startClear: 900, endClear: 900, seed: 90210 },

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
    },

    {
      id: 'mesh-highway',
      name: 'MESH HIGHWAY',
      subtitle: 'Fast, wide, long straights',
      blurb: 'Two enormous straights, a gentle kink and a wide road. Top speed country.',

      /* A big, fast stadium: two ~4000-unit straights joined by wide bends,
         with a shallow S on the top straight that can be taken flat out. */
      points: [
        [-3400, -1200], [-2400, -1250], [-1400, -1230], [-400, -1120],
        [600, -1180], [1600, -1260], [2600, -1250], [3400, -1000],
        [3850, -560], [3950, -40], [3760, 480], [3350, 880],
        [2750, 1160], [2000, 1330], [1150, 1410], [250, 1420],
        [-650, 1400], [-1550, 1330], [-2400, 1180], [-3150, 950],
        [-3750, 620], [-4100, 180], [-4150, -320], [-3950, -800]
      ],

      /* Geometry: wide road, wide kerbs, generous run-off */
      roadWidth: 560,
      kerbWidth: 36,
      grassMargin: 70,
      rowStep: 16,

      /* Race line: the line sits on the top straight, with a full straight
         behind it so the four-car grid lines up cleanly. */
      startIndex: 2,
      checkpointFractions: [0.2, 0.4, 0.6, 0.8],
      laps: 2,

      shards: { count: 18, laneSpread: 0.58, startClear: 1100, endClear: 1100, seed: 77120 },

      scenery: {
        seed: 20260101,
        spacing: 260,
        types: ['billboard', 'pylon', 'crystal', 'node', 'tree'],
        nodeChance: 0.42
      },

      /* The tightest real corners, measured on the built centerline. */
      corners: [
        { name: 'T1 HIGHWAY BEND', at: 0.03, radius: 401 },
        { name: 'T2', at: 0.16, radius: 1101 },
        { name: 'MESH KINK', at: 0.32, radius: 1053 },
        { name: 'T4', at: 0.35, radius: 985 },
        { name: 'T5 RIGHT SWEEP', at: 0.43, radius: 670 },
        { name: 'T6', at: 0.49, radius: 944 },
        { name: 'T7', at: 0.87, radius: 856 },
        { name: 'T8', at: 0.91, radius: 513 },
        { name: 'T9', at: 0.99, radius: 687 }
      ],

      rating: 1
    },

    {
      id: 'shard-speedway',
      name: 'SHARD SPEEDWAY',
      subtitle: 'Tight and technical',
      blurb: 'Short straights, a narrow road and a proper hairpin. Brake late, exit clean.',

      /* A compact, wiggly loop: 63 control points keep the corners coming,
         with almost nothing that counts as a straight. */
      points: [
        [1329, 0], [1233, 122], [1163, 231], [1128, 343], [1120, 464],
        [1124, 601], [1118, 747], [1088, 893], [1028, 1028], [938, 1143],
        [828, 1239], [702, 1313], [567, 1368], [425, 1400], [280, 1407],
        [137, 1387], [0, 1342], [-126, 1279], [-241, 1208], [-345, 1138],
        [-444, 1072], [-538, 1007], [-626, 938], [-704, 857], [-764, 764],
        [-809, 664], [-847, 566], [-897, 479], [-974, 404], [-1091, 332],
        [-1248, 248], [-1425, 140], [-1591, 0], [-1716, -169], [-1774, -353],
        [-1754, -532], [-1666, -690], [-1528, -817], [-1363, -911], [-1192, -977],
        [-1024, -1024], [-866, -1056], [-717, -1074], [-576, -1079], [-445, -1073],
        [-322, -1061], [-209, -1050], [-103, -1045], [0, -1048], [104, -1057],
        [212, -1063], [322, -1062], [434, -1047], [547, -1024], [666, -996],
        [795, -969], [939, -939], [1097, -900], [1255, -839], [1395, -745],
        [1492, -618], [1529, -464], [1505, -299], [1429, -141]
      ],

      /* Geometry: the narrowest road of the three, little run-off */
      roadWidth: 340,
      kerbWidth: 30,
      grassMargin: 54,
      rowStep: 12,

      /* Race line: the line sits on the least twisty part of the lap */
      startIndex: 42,
      checkpointFractions: [0.2, 0.4, 0.6, 0.8],
      laps: 3,

      shards: { count: 10, laneSpread: 0.5, startClear: 650, endClear: 650, seed: 5150 },

      scenery: {
        seed: 20260202,
        spacing: 170,
        types: ['crystal', 'pylon', 'node', 'tree', 'billboard'],
        nodeChance: 0.55
      },

      corners: [
        { name: 'T1', at: 0.03, radius: 323 },
        { name: 'T2', at: 0.09, radius: 650 },
        { name: 'T3 SHARD CHICANE', at: 0.12, radius: 500 },
        { name: 'T4', at: 0.18, radius: 800 },
        { name: 'T5', at: 0.34, radius: 463 },
        { name: 'SHARD HAIRPIN', at: 0.39, radius: 284 },
        { name: 'T7', at: 0.5, radius: 482 },
        { name: 'T8', at: 0.52, radius: 350 },
        { name: 'T9', at: 0.79, radius: 621 },
        { name: 'T10', at: 0.93, radius: 316 },
        { name: 'T11', at: 0.96, radius: 416 }
      ],

      rating: 3
    }
  ];

  /** Look a track up by id; null when it does not exist. */
  OR.trackById = function (id) {
    for (let i = 0; i < OR.TRACKS.length; i++) {
      if (OR.TRACKS[i].id === id) return OR.TRACKS[i];
    }
    return null;
  };

  /** The track currently being raced. Step 8 changes this at runtime. */
  OR.activeTrack = OR.TRACKS[0];
})();
