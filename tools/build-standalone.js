/* =============================================================================
 * tools/build-standalone.js — bundles index.html + css + js into a single
 * portable file (optimum-race.html) that can be emailed or opened offline.
 *   node tools/build-standalone.js
 * The generated file is a build artefact: edit the sources, not the bundle.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'optimum-race.html');

const SCRIPTS = [
  'js/config.js', 'js/utils.js', 'js/xp.js', 'js/trackdata.js', 'js/track.js', 'js/car.js', 'js/race.js', 'js/save.js', 'js/cars.js', 'js/difficulty.js', 'js/bests.js', 'js/rivals.js', 'js/collisions.js', 'js/standings.js', 'js/shards.js', 'js/input.js', 'js/audio.js',
  'js/renderer.js', 'js/hud.js', 'js/game.js', 'js/trackselect.js', 'js/main.js'
];

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

html = html.replace(
  /<link rel="stylesheet" href="[^"]*">/,
  '<style>\n' + css + '\n</style>'
);

const bundled = SCRIPTS.map(f =>
  '/* ==== ' + f + ' ==== */\n' + fs.readFileSync(path.join(ROOT, f), 'utf8')
).join('\n');

html = html.replace(/<script src="[^"]*"><\/script>\s*/g, '');
html = html.replace(
  '</body>',
  '<!-- ===== bundled sources: edit js/*.js and re-run `npm run build` ===== -->\n' +
  '<script>\n' + bundled + '\n</script>\n</body>'
);

fs.writeFileSync(OUT, html);
console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + (html.length / 1024).toFixed(1) + ' KB)');
