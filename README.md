# OPTIMUM RACE — Steps 1 to 5

**Race. React. Win.**

A lightweight single-player racing game that runs entirely in the browser.
Vanilla JavaScript + Canvas 2D. No frameworks, no build step, no backend, no
external assets, no audio files.

---

## Run it

```bash
npm start          # serves the game at http://localhost:3000
```

Or just open `index.html` in a browser — it works straight from the file system
(the scripts are plain classic scripts, not ES modules).

Single portable file (emailable, offline, one inline `<script>`):

```bash
npm run build      # regenerates optimum-race.html from the sources
```

---

## What is built so far

### Step 1 — the playable game

| Area | Status |
| --- | --- |
| Main menu (title, subtitle, START RACE) | done |
| Track, start line, finish line, scenery | done |
| Player car, speed + race timer HUD | done |
| Keyboard controls (desktop) | done |
| Large touch controls (mobile) | done |
| Boost with cooldown | done |
| Finish screen (time, max speed, boosts) + RACE AGAIN | done |
| Responsive dark neon UI | done |

### Step 2 — driving handling

| Requirement | Status |
| --- | --- |
| Steering scales with speed, none while stationary | done (`car.turnRateLow/High`, `steerDeadSpeed`) |
| Grip + light drift: velocity aligns with facing | done (`car.gripLow/High`, `driftThreshold`) |
| Grass slows the car strongly | done (`car.grass`) |
| Soft bounce at the edge instead of a hard stop | done (`car.bounce`) |
| Smooth follow camera with look-ahead | done (`camera.*`) |
| Car shape, headlights, rotation, tire marks (capped) | done (`effects.tireMarks`) |
| Optional engine sound, Web Audio, off by default, mute toggle | done (`js/audio.js`, `audio.*`) |
| Every tuning value in one config object | done (`js/config.js`) |

### Step 3 — CODED BOOST

| Requirement | Status |
| --- | --- |
| 0–100 boost meter in the HUD | done (`#boostWidget`, number inside the ring) |
| Charges on the road at speed + shard pickups (+20) | done (`boost.charge`, `js/shards.js`) |
| BOOST button / Space / Shift, ~1.5 s, drains the meter | done (`boost.drainPerSecond`) |
| Cannot start below 25 % | done (`boost.threshold`, HUD shows `NEED 25%`) |
| 3 s cooldown with a visible indicator | done (`boost.cooldown`, HUD shows `COOLING 3.0s`) |
| Speed lines, camera zoom, HUD glow | done (`boost.fx`, `Renderer.zoom`, `.is-active`) |
| Respects `prefers-reduced-motion` | done (`Renderer.reducedMotion`, `?motion=off`) |
| Boosts used + peak boosted speed on the finish screen | done (`Game.results`) |
| Shards respawn on Race Again, all tuning in config | done (`Shards.reset()`, `CONFIG.boost`) |

### Step 4 — the race system

| Requirement | Status |
| --- | --- |
| State machine: MENU, COUNTDOWN, RACING, PAUSED, FINISHED | done (`Game.STATES`) |
| 3-2-1-GO countdown, input locked until GO | done (car receives empty controls) |
| 3 laps, checkpoints in order, no shortcut laps | done (`js/race.js`, `Track.checkpoints`) |
| LAP 2/3 in the HUD | done (lap card with a per-lap progress bar) |
| Lap times recorded, current lap timer, best lap highlighted | done (HUD + finish screen) |
| Pause button + Escape or P, with Resume / Restart / Quit | done (`#pauseScreen`) |
| Finish screen: total, splits, best lap, max speed, boosts | done (+ peak boosted speed and shards) |
| Restart fully resets all race state | done (`Game.startRace()`) |

### Step 5 — FLEXNODE CIRCUIT (a data-driven track)

| Requirement | Status |
| --- | --- |
| Track defined as **data**: centreline control points, width, start/finish, checkpoints | done (`js/trackdata.js`, `OR.TRACKS.flexnode`) |
| Smooth closed curve + evenly spaced samples | done (centripetal Catmull-Rom, re-sampled every 14 u in `js/track.js`) |
| At least 8 turns, one hairpin, one long straight | done (14 corner features, MESH HAIRPIN, ~2050 u straight) |
| Helper API for the AI in the next step | done (`Track.isOnRoad(x, y)`, `Track.getNearestTrackPoint(x, y)`, `Track.pointAt`, `Track.pointAhead`) |
| Pre-rendered offscreen scenery | done (`Renderer.buildSceneryLayer()` — 96 items + node glows on one canvas) |
| Track map / minimap | done (HUD minimap: circuit outline, gates, live player dot) |
| Lap scoring on the loop, no shortcuts | done (`js/race.js` scores continuous lap progress, gates must be driven through) |

## Not built yet (deliberately)

AI rivals · Optimum network integration · networking of any kind · latency
measurement · blockchain / wallets / tokens · XP · levels · unlocks ·
leaderboards · multiplayer · events. Later steps add config sections and
modules rather than rewriting what exists.

---

## Controls

### Desktop (keyboard)

| Key | Action |
| --- | --- |
| `W` / `↑` | accelerate |
| `S` / `↓` | brake |
| `A` / `←` | steer left |
| `D` / `→` | steer right |
| `Space` (or `Shift`) | coded boost (needs 25 %+ charge) |
| `Enter` | start race / race again |
| `Esc` or `P` | pause / resume |
| SOUND button | engine sound on/off (menu and in-race HUD) |

### Mobile / tablet (touch)

Four large on-screen pads: **LEFT**, **RIGHT**, **BRAKE**, **BOOST**.
There is no accelerator pedal on touch devices — the car **accelerates
automatically** and you use BRAKE to slow down for corners, which keeps one
thumb free for steering.

Add `?touch=1` to the URL to force the touch pad on (handy on a laptop with a
touchscreen).

---

## The circuit (Step 5)

`FLEXNODE CIRCUIT` is a closed loop built from **data**, not code. The whole
track lives in `js/trackdata.js`:

```js
OR.TRACKS.flexnode = {
  name: 'FLEXNODE CIRCUIT',
  width: 420,                 // road width in world units (210 = half road)
  rowStep: 14,                // centreline sample spacing
  laps: 3,
  checkpointFractions: [0.25, 0.5, 0.75],
  controlPoints: [ ... 29 points ... ],     // the shape of the circuit
  corners: [ ... named corners, incl. MESH HAIRPIN ... ],
  scenery: { seed: 20240917, spacing: 210, nodeChance: 0.5 }
};
```

* **Shape** — the control points are smoothed with a *centripetal*
  Catmull-Rom spline (uniform Catmull-Rom overshoots and leaves cusps on
  unevenly spaced points) and then re-sampled at an even 14 u spacing. Every
  sample carries its tangent, normal, curvature and radius, so the renderer,
  the race logic and the future AI all read the same geometry.
* **Surfaces** — measured from the centreline: asphalt to 210 u, **kerb** to
  244 u (only painted where the track turns), **grass** to 306 u, then the
  run-off and the barrier rails at 346 u. A hard backstop keeps the car inside
  the playable area for good.
* **Checkpoints** — the data lists lap *fractions*. `js/race.js` unwraps the
  car's lap position into a continuous value, awards the gates strictly in
  order and only counts a lap when every gate has been driven through; a lap
  taken any other way is flagged as a shortcut and not scored.
* **Scenery** — deterministically generated from a seed (96 items: pylons,
  crystals, trees, billboards and glowing node markers) and drawn **once** into
  an offscreen canvas, then blitted as a single image per frame. The road
  itself stays vector so its edges stay crisp at any zoom.
* **Minimap** — drawn from the same geometry in the top-right card: the circuit
  outline, the gates (cyan until passed), the start line and a live player dot
  with a heading triangle. It hides on phone-width screens where the lap card
  carries the information.

Adding a track is a matter of adding an entry to `OR.TRACKS` — the geometry,
surface bands, scenery, checkpoints and minimap all read from the data.

---

## How a race works (Step 4)

`MENU → COUNTDOWN → RACING ⇄ PAUSED → FINISHED`

* **Countdown** — 3-2-1-GO. The car gets empty controls until GO, so nothing you
  hold down early moves it, and the clock stays at zero.
* **Laps** — the race is **3 laps** round the **FLEXNODE CIRCUIT** (1022 m). Each
  lap has checkpoints (25 %, 50 %, 75 % of the way round) that must be passed
  **in order**; the line only scores a lap once all of them are behind you *and*
  the gate was actually driven through, so a cut cannot skip a lap. Crossing the
  line starts the next lap with the car still carrying its speed, and the
  pickups are refreshed for the new lap.
* **Timing** — the total clock runs from GO, and each lap is timed separately.
  The lap card shows `LAP 2/3`, the current lap time, the lap progress bar and
  the best lap so far (highlighted cyan once set).
* **Pause** — the HUD pause button, `Esc` or `P`. The clock, the car and the
  effects all freeze; RESUME, RESTART and QUIT TO MENU are on the panel.
* **Finish** — on the last lap the flag freezes the clock, the car rolls to a
  stop, and the results panel shows the total time, **best lap**, per-lap splits
  (best highlighted), max speed, peak boosted speed, boosts used and shards.
* **Restart** — every bit of race state is rebuilt: laps, splits, clock, car,
  boost meter, shards and particles.

---

## CODED BOOST (Step 3)

The old "one charge then recharge" boost is now a **meter from 0 to 100**, shown
in the bottom-left of the HUD with the number inside the ring:

* **Charging** — the meter fills at 9/second while you are **on the road** at
  55 % or more of top speed. The kerb charges at half rate, the grass charges
  not at all, and charging is slower while the car is sliding.
* **Shard pickups** — 14 cyan diamonds lie along the track and are worth **+20**
  each. They are placed deterministically, always sit on the road, and all come
  back on **Race Again**. The HUD shows `collected/total`.
* **Boosting** — `BOOST`, `Space` or `Shift`. It cannot start below **25 %**.
  The boost drains the meter at 66.7/second, so a **full meter buys 1.5 s** and
  a minimum-charge boost buys about 0.4 s. While it lasts you get a 1.5× speed
  ceiling and a 2.2× acceleration kick.
* **Cooldown** — 3 seconds of lockout once the burst ends; the ring turns amber
  and the HUD counts it down (`COOLING 2.4s`). The states are `READY`,
  `BOOSTING`, `COOLING` and `NEED 25%`.
* **Effects** — speed lines, a brief exhaust trail, a subtle camera push-in and
  a pulsing HUD glow. All motion effects are suppressed when the operating
  system asks for **reduced motion** (or with `?motion=off` in the URL).
* **Results** — the finish screen adds **peak boosted speed** and **shards
  collected** next to boosts used.

---

## How the car handles (Step 2)

The car has a **heading** (where it points) and a separate **velocity** (where
it is actually going):

* **Steering** turns the heading at a rate that scales with speed — about
  3.0 rad/s at a crawl down to 1.05 rad/s flat out — and does nothing at all
  when the car is stationary, so it feels tight in the slow corners and stable
  at top speed.
* **Grip** pulls the velocity back in line with the heading. At low speed the
  car is planted; lean on it at 300 km/h and the tail steps out (a 10–15° slip
  angle), then grip reels it back in when you unwind the lock.
* **Surfaces**: asphalt gives full grip, the **kerb** is a light penalty
  (92 % top speed, a little less grip), and the **grass** run-off past it is a
  heavy one (55 % top speed, strong drag, less grip).
* **Barriers** are a soft spring, not a wall: the car is pushed back inside,
  scrubs a little speed, and is gently aligned with the track so a nose-first
  prang can never wedge it in place.
* **Camera** rides on the car plus a smoothed look-ahead that leans into the
  direction of travel and toward the road ahead, so fast corners open up in
  front of you.
* **Tire marks** are laid while drifting or braking hard and fade out after
  ~3.6 s, with a hard cap of 260 marks so the effect can never cost frames.

Everything above is a number in `js/config.js`.

---

## Project structure

```
index.html                 screens (menu, HUD, touch pad, finish) + script tags
css/style.css              theme tokens, HUD, panels, responsive rules
js/config.js               every tunable number in the game
js/utils.js                clamp / lerp / damp / seeded RNG / time formatting
js/trackdata.js            the track as DATA: OR.TRACKS (control points, width, checkpoints)
js/track.js                geometry engine: spline, samples, surfaces, lookups, scenery
js/car.js                  player car: physics, grip/drift, surfaces, boost meter
js/shards.js               CODED BOOST shard pickups: layout, collection
js/race.js                 laps, checkpoint order, splits and best lap
js/input.js                keyboard + touch pad -> one flat control state
js/audio.js                engine sound synthesised with Web Audio (no files)
js/renderer.js             all canvas drawing, camera, marks, particles
js/hud.js                  DOM HUD updates (cached, no layout thrash)
js/game.js                 state machine + fixed-timestep loop
js/main.js                 bootstrap, wires DOM screens to the state machine

tests/smoke.js             headless unit suite (jsdom) — npm test
tools/_trackcheck.js       dev tool: prints track metrics and an ASCII map (design aid)
tools/serve.js             zero-dependency dev server
tools/build-standalone.js  bundles everything into optimum-race.html
tools/visual-check.js      headless-Chrome pixel + performance check
tools/race-check.js        headless-Chrome: autopilots a full 3-lap race
tools/screenshots.js       screenshots of every screen
tools/ascii-preview.js     prints a PNG as ASCII (brightness + hue map)
optimum-race.html          GENERATED single-file build (npm run build)
```

### Game states

`menu → countdown → racing → finishing → finished → (race again)`

The timer starts at **GO**, runs while `racing`, and freezes the instant the car
crosses the finish line.

---

## Extension points (marked `STEP n` in the source)

* **More tracks (step 8)** — add an entry to `OR.TRACKS` in `js/trackdata.js`
  and point `OR.activeTrack` at it. The geometry, surface bands, checkpoints,
  scenery, minimap and lap scoring all read from the data; nothing else changes.
* **AI rivals (step 6)** — `Car` is a plain constructor, so rivals are more
  instances driven from `Game.step()`, and `Renderer._drawCar()` already draws
  an entity rather than a global. The helpers the AI needs are ready:
  `Track.getNearestTrackPoint(x, y)` (index, position, tangent, normal,
  distance, signed offset, lap fraction), `Track.isOnRoad(x, y)`,
  `Track.pointAhead(x, y, distance)` for looking through corners, and
  `Track.surfaceAt(x, y)` for the surface the car is on. Pass the previous
  index as the optional third argument (`Track.nearest(x, y, hint)`) and the
  lookup gets cheaper; without a hint it does a widening ring search and is
  still exact.
* **Difficulty, profile, XP, unlocks, events (steps 7–13)** — each gets a config
  block and a module; `js/config.js` and the `js/main.js` screen wiring are the
  seams.

---

## Testing

```bash
npm test          # 194 headless checks, ~1 s
npm run visual    # real-browser pixel + performance checks (needs Chrome)
npm run screenshots
```

`tests/smoke.js` boots the real game files inside jsdom with a stubbed canvas
and drives the full loop: the menu, starting a race, acceleration, braking,
coasting, steering (including "no steering while stationary" and steering
tighter at low speed), grip and drift, every surface, the soft bounce on both
barriers, the coded boost meter (charging rules per surface, shard pickups,
the 25 % threshold, drain, 3 s cooldown, HUD states, reduced motion), the race
timer, three laps of checkpoints and splits, the finish line, the payout
screen, RACE AGAIN, the pause menu (Escape, P, the button, Resume, Restart,
Quit), the touch pad (including a full autopilot run driven only through the
on-screen buttons), a 420-frame render soak, and a complete 3-lap race on the
circuit.

The track sections (Step 5) check the geometry itself: the loop closes, the
samples are evenly spaced, the surface bands sit at the right offsets, driving
through a checkpoint in order scores it, crossing the line without the gates is
flagged as a shortcut and never scores, the barrier holds the car inside the
playable area on both sides and lets it drive away again, and a full 3-lap
autopilot race completes with every gate taken.

`tools/visual-check.js` (28 checks) covers what a stubbed canvas cannot: it
samples real pixels to prove the asphalt, kerb, grass, barrier, car rotation,
tire marks, the cyan shard pickups and the checkpoint gates are actually drawn,
that the HUD meter reaches each of its states, that pause really freezes the
clock, that no road or grass is painted outside the playable area, and that the
frame rate holds. For Step 5 it also teleports the car round the lap and proves
the road is painted all the way round (12 points, all asphalt), that the
kerbs only appear on corners, that the start/finish checkered line is there,
that the scenery is pre-rendered into one offscreen layer, that the road is a
ribbon of the right width everywhere (cross sections ≈ 420 u) and that the
hairpin's two legs are separate pieces of road, plus the minimap (outline,
gates, and a player dot that follows the car).

The dev tooling (`jsdom`, `canvas`, `puppeteer`) is only used by the tests and
tools — the game ships with zero dependencies.
