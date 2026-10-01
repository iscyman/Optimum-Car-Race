/* Dev tool: build a closed loop from control points, measure its features. */
function build(pts, samplesPerSeg) {
  const out = [];
  for (let i = 0; i < pts.length; i++)
    for (let s = 0; s < samplesPerSeg; s++) out.push(catmullRom(pts, i + s / samplesPerSeg));
  return out;
}
/* Centripetal Catmull-Rom (alpha = 0.5): well behaved even when the control
   points are unevenly spaced, which is essential for tight corners next to
   long straights. */
function lerpP(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
function distP(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function catmullRom(pts, t) {
  const n = pts.length;
  const i = Math.floor(t) % n, f = t - Math.floor(t);
  const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
  const alpha = 0.5;
  const t0 = 0;
  const t1 = t0 + Math.pow(Math.max(distP(p0, p1), 1e-4), alpha);
  const t2 = t1 + Math.pow(Math.max(distP(p1, p2), 1e-4), alpha);
  const t3 = t2 + Math.pow(Math.max(distP(p2, p3), 1e-4), alpha);
  const tt = t1 + (t2 - t1) * f;
  const A1 = lerpP(p0, p1, (tt - t0) / (t1 - t0));
  const A2 = lerpP(p1, p2, (tt - t1) / (t2 - t1));
  const A3 = lerpP(p2, p3, (tt - t2) / (t3 - t2));
  const B1 = lerpP(A1, A2, (tt - t0) / (t2 - t0));
  const B2 = lerpP(A2, A3, (tt - t1) / (t3 - t1));
  return lerpP(B1, B2, (tt - t1) / (t2 - t1));
}
function resample(poly, spacing) {
  const n = poly.length;
  const segLen = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLen.push(d); total += d;
  }
  const count = Math.max(3, Math.round(total / spacing));
  const step = total / count;
  const out = [];
  let target = 0, acc = 0, idx = 0;
  for (let k = 0; k < count; k++) {
    while (acc + segLen[idx] < target) { acc += segLen[idx]; idx = (idx + 1) % n; }
    const t = segLen[idx] > 0 ? (target - acc) / segLen[idx] : 0;
    const a = poly[idx], b = poly[(idx + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    target += step;
  }
  return out;
}
function analyse(pts, spacing) {
  const raw = build(pts, 24);
  const p = resample(raw, spacing);
  const n = p.length;
  // curvature via circumradius of 3 consecutive points
  const curv = new Array(n).fill(0);
  let length = 0, minR = Infinity, maxR = 0;
  const radii = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const ab = Math.hypot(b[0]-a[0], b[1]-a[1]), bc = Math.hypot(c[0]-b[0], c[1]-b[1]), ca = Math.hypot(a[0]-c[0], a[1]-c[1]);
    length += ab;
    const area = Math.abs((b[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(b[1]-a[1])) / 2;
    const r = area < 1e-6 ? Infinity : (ab*bc*ca)/(4*area);
    const cross = (b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0]);
    curv[i] = (cross > 0 ? 1 : -1) / (r === Infinity ? 1e6 : r);
    radii.push(r);
  }
  // longest straight: longest run where |curv| < 1/4000
  let run = 0, bestRun = 0, bestStart = 0, curStart = 0;
  for (let i = 0; i < n * 2; i++) {
    const k = i % n;
    if (Math.abs(curv[k]) < 1/4000) { if (run === 0) curStart = i; run++; if (run > bestRun) { bestRun = run; bestStart = curStart; } }
    else run = 0;
  }
  // turns: runs of real curvature separated by straighter stretches
  const isCorner = i => Math.abs(curv[i % n]) > 1 / 1200;
  const turnList = [];
  let cornerRun = 0;
  for (let i = 0; i < n * 2; i++) {
    if (isCorner(i)) cornerRun++;
    else {
      if (cornerRun >= 8) { turnList.push(cornerRun); cornerRun = 0; } else cornerRun = 0;
      if (turnList.length && i > n) break;
    }
  }
  if (cornerRun > 0) turnList.push(cornerRun);
  const turns = turnList.filter(len => len * spacing > 200).length;
  const corners = turnList.filter(len => len * spacing > 200).map(len => Math.round(len * spacing));
  const minRadius = Math.min.apply(null, radii.filter(r => isFinite(r)));
  const minRadiusAt = radii.indexOf(minRadius);
  // bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  p.forEach(q => { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); });
  // self intersection (grid-accelerated)
  let hits = 0;
  const cell = 300, grid = new Map();
  const key = (x, y) => Math.floor(x/cell) + ':' + Math.floor(y/cell);
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i+1)%n];
    for (let gx = Math.floor(Math.min(a[0],b[0])/cell)-1; gx <= Math.floor(Math.max(a[0],b[0])/cell)+1; gx++)
      for (let gy = Math.floor(Math.min(a[1],b[1])/cell)-1; gy <= Math.floor(Math.max(a[1],b[1])/cell)+1; gy++) {
        const list = grid.get(gx+':'+gy);
        if (list) for (const j of list) {
          if (Math.abs(i-j) < 3 || Math.abs(i-j) > n-3) continue;
          const c = p[j], d = p[(j+1)%n];
          const d1 = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
          const d2 = (b[0]-a[0])*(d[1]-a[1]) - (b[1]-a[1])*(d[0]-a[0]);
          const d3 = (d[0]-c[0])*(a[1]-c[1]) - (d[1]-c[1])*(a[0]-c[0]);
          const d4 = (d[0]-c[0])*(b[1]-c[1]) - (d[1]-c[1])*(b[0]-c[0]);
          if (((d1>0)!==(d2>0)) && ((d3>0)!==(d4>0))) hits++;
        }
      }
    const k = key(a[0], a[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  // minimum distance between parts of the track that are far apart along it
  let minSep = Infinity, sepAt = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const arc = Math.min(j - i, n - (j - i)) * spacing;
      if (arc < 900) continue;
      const d = Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
      if (d < minSep) { minSep = d; sepAt = [i, j]; }
    }
  }
  return { n, length, minRadius, minRadiusAt, minSeparation: minSep, sepAt, longestStraight: bestRun * spacing,
    turns, corners, hits, bounds: { w: Math.round(maxX-minX), h: Math.round(maxY-minY) } };
}
function ascii(points, cols, rows) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  points.forEach(q => { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); });
  const pad = 400;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const w = maxX - minX, h = maxY - minY;
  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(' '));
  points.forEach(q => {
    const c = Math.round((q[0] - minX) / w * (cols - 1));
    const r = Math.round((q[1] - minY) / h * (rows - 1));
    if (grid[r] && grid[r][c] !== undefined) grid[r][c] = '.';
  });
  // mark the start/finish
  const s0 = points[0];
  const c0 = Math.round((s0[0] - minX) / w * (cols - 1)), r0 = Math.round((s0[1] - minY) / h * (rows - 1));
  grid[r0][c0] = 'S';
  return grid.map(r => r.join('')).join('\n');
}
/* Distinct corners: local peaks of curvature, at least 250 units apart, whose
   radius is under 3000 units (i.e. a corner rather than a gentle bend). */
function findCorners(p, spacing) {
  const n = p.length;
  const R = new Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const ab = Math.hypot(b[0]-a[0], b[1]-a[1]), bc = Math.hypot(c[0]-b[0], c[1]-b[1]);
    const ca = Math.hypot(a[0]-c[0], a[1]-c[1]);
    const area = Math.abs((b[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(b[1]-a[1])) / 2;
    R[i] = area < 1e-6 ? Infinity : (ab*bc*ca)/(4*area);
  }
  const gap = Math.round(250 / spacing);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (R[i] > 3000) continue;
    let isPeak = true;
    for (let k = -gap; k <= gap; k++) {
      if (k === 0) continue;
      if (R[(i + k + n) % n] < R[i] - 1e-6) { isPeak = false; break; }
    }
    if (isPeak) out.push({ at: [Math.round(p[i][0]), Math.round(p[i][1])], radius: Math.round(R[i]) });
  }
  return out;
}
const pts = JSON.parse(process.argv[2]);
const raw = build(pts, 24);
const p = resample(raw, 12);
const r = analyse(pts, 12);
console.log(JSON.stringify(r, null, 1));
const corners = findCorners(p, 12);
console.log('corners: ' + corners.length);
corners.forEach((c, i) => console.log('  ' + (i + 1) + '. ' + c.dir + ' ' + c.deg + ' deg at ' +
  c.at + ' (' + c.len + ' units long)'));
console.log(ascii(p, 104, 34));
