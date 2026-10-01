/* =============================================================================
 * tools/ascii-preview.js — dev helper: prints a PNG as ASCII (brightness) and
 * as a hue map, so a frame can be inspected without an image viewer.
 *   node tools/ascii-preview.js screenshots/3-racing-desktop.png [cols] [rows]
 * ========================================================================== */
'use strict';

const { loadImage, createCanvas } = require('canvas');

const RAMP = ' .:-=+*#%@';

function hueLetter(r, g, b, lum) {
  if (lum < 0.06) return ' ';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.28) return lum > 0.55 ? 'W' : 'w';        // white / grey
  if (b > 150 && g > 150 && r < g - 40) return 'C';     // cyan
  if (b > 120 && r > 100 && b > g + 40) return 'V';     // violet
  if (r > 150 && b > 90 && g < r - 60) return 'M';      // magenta / red
  if (r > 150 && g > 120 && b < 120) return 'A';        // amber
  return 'o';
}

(async () => {
  const file = process.argv[2];
  const cols = Number(process.argv[3] || 100);
  const img = await loadImage(file);
  const rows = Number(process.argv[4] || Math.round(cols * (img.height / img.width) * 0.5));

  const canvas = createCanvas(cols, rows);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;

  let bright = '';
  let hues = '';
  for (let y = 0; y < rows; y++) {
    let bLine = '';
    let hLine = '';
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      bLine += RAMP[Math.min(RAMP.length - 1, Math.floor(Math.pow(lum, 0.6) * RAMP.length))];
      hLine += hueLetter(r, g, b, lum);
    }
    bright += bLine + '\n';
    hues += hLine + '\n';
  }

  console.log('=== ' + file + ' (' + img.width + 'x' + img.height + ') brightness ===');
  console.log(bright);
  console.log('=== hues  (C=cyan V=violet M=magenta A=amber W=white w=grey o=other) ===');
  console.log(hues);
})();
