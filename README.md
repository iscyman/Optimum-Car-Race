# OPTIMUM RACE — Steps 1 to 12

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

### Step 6 — AI rivals

| Requirement | Status |
| --- | --- |
| Three **STANDARD GOSSIP 1–3** rivals, distinctly coloured | done (amber, mint, orange-red; player remains violet) |
| Centreline following, small lane offsets, upcoming-corner braking | done (`js/rivals.js`, public Track helpers only) |
| Slightly different, fixed speed and skill per driver | done (`CONFIG.rivals.roster`) |
| Random 0.5–1 s gameplay stalls every few seconds + flash icon | done (independent seeded schedules, 4.5–8.5 s between stalls, never stops a car) |
| Car-to-car contact: push apart, small speed loss, no contact lock | done (`js/collisions.js`, bounded solver + impact cooldown) |
| Live **POS 2/4** and compact standings | done (checkpoint-valid lap progress, finished drivers by time) |
| Staggered grid behind the start line | done (all four cars visible during countdown, no phantom opening lap) |
| Final classification and player place | done (frozen at the player's flag; no invented times for unfinished rivals) |
| Finished rivals never block a still-racing player | done (they keep a slow cool-down lap instead of braking on the racing line) |
| Minimap rival dots, pause/restart/quit integration | done (stall timers and effects freeze on pause; field resets on restart) |
| Phone rendering budget with four cars | done (bounded caches, 1× canvas density on phones; native-resolution DOM HUD) |

### Step 7 — difficulty

| Requirement | Status |
| --- | --- |
| EASY / NORMAL / HARD chosen before the race | done (menu picker: click or arrow keys, `role="radiogroup"`) |
| Settings in a config object | done (`CONFIG.difficulty.levels`: rival speed, corner skill, stall interval + duration, rubber band strength) |
| Light rubber banding, capped | done (`CONFIG.rivals.rubberBand`, +14 % / −10 % caps, dead zone, 0.60/0.45/0.30 strength per level) |
| Selection saved in localStorage, preselected next time | done (try/catch throughout; blocked storage falls back to the default and keeps working in memory) |
| Difficulty shown in the HUD and on the finish screen | done (`#hudDifficulty` chip, `#finalDifficulty` tile) |
| Balance target | done (see the measured table below: a decent reference player wins EASY ~100 %, NORMAL ~46 %, HARD ~21 %) |
| Best race time per difficulty | done (`Best on Normal 00:38.141` on the results screen, `NEW Best on …` when beaten) |


### Step 8 — multiple tracks + track select

| Requirement | Status |
| --- | --- |
| Keep FLEXNODE CIRCUIT, add MESH HIGHWAY (fast, wide, long straights) | done (`js/trackdata.js`, 1879 m lap, 560 u road) |
| … and SHARD SPEEDWAY (tight, technical) | done (923 m lap, 340 u road, min corner radius 284 u) |
| All tracks use the Step 5 data format, no per-track hacks | done (identical schema; `Track.use()` rebuilds in place) |
| Track select screen: name, centreline preview, length, difficulty rating | done (menu pane, cards with canvases drawn from `Track.measure()`) |
| Best time **and best lap** per track **and** difficulty | done (`js/bests.js`, `optimumRace.trackBests.v1`; Step 7 flat records migrate to FLEXNODE) |
| Shards, checkpoints and lap count defined per track in data | done (`shards`, `checkpointFractions`, `laps` per entry; fall back to the Step 3/4 config) |
| Race Again keeps the same track, Menu returns to track select | done (`#againBtn` restarts on the track; QUIT/MAIN MENU open the track pane) |
| Track select works on mobile | done (cards stack to one column, ≥ 84 px previews, tap targets are full-width buttons) |


### Step 9 — profile and saves

| Requirement | Status |
| --- | --- |
| One versioned save object with migrations; every read/write in try/catch | done (`js/save.js`, `version: 1`, migration chain, blocked storage keeps working in memory) |
| Profile screen: name (max 16, sanitised, default `Racer`) and 6 car colours | done (menu pane; live-sanitised input; 6 swatches with palettes) |
| Stats: races, wins, podiums, total race time, best time per track | done (`Save.stats()` + the Step 8 record book, all inside the save) |
| Stats update automatically after each race | done (`Game._finishRace()` books the race; quitting early never reaches it) |
| Export save (Base64) and Import with confirmation | done (EXPORT fills/copies the string, IMPORT asks first, junk and future versions are refused) |
| Reset progress with confirmation | done (clears stats and records, keeps name and colour) |
| Player name and car colour in the HUD and finish screen | done (HUD standings, finish DRIVER tile, car paint, menu "racing as" line) |
| Preserve best times from earlier steps | done (Step 7 flat and Step 8 per-track records migrate on first load) |


### Step 10 — XP and levels

| Requirement | Status |
| --- | --- |
| Award XP: finish +50; 1st/2nd/3rd +100/+60/+30; +20 per clean lap; small capped boost bonus | done (`js/xp.js`, all numbers in `CONFIG.xp`; clean lap = a lap with no barrier contact, rival bumps do not count; boost bonus +5 each, capped at +20) |
| Difficulty multipliers ×0.8 / ×1 / ×1.3 | done (`CONFIG.xp.multipliers`, applied to everything except the clean-lap bonus, which already pays for skill) |
| Level curve ≈ 100·N^1.5 in config | done (`CONFIG.xp.levelBase`/`levelExponent`; L2 at 283, L3 at 520, L4 at 800, L5 at 1118 XP) |
| Results screen: XP breakdown line by line + animated bar | done (one row per source with its own XP, then the difficulty line as the difference so the rows always add up to the total; the bar animates to `data-target`) |
| Level + progress bar on the main menu and the profile | done (both bars refresh at the flag, on load and after a profile change) |
| Level-up toast | done (`#levelToast`, slides in once per level-up and hides again on the next race) |
| XP and level saved through the storage module, with a migration | done (save `version: 2`, migration 1→2, XP is the source of truth and the level is recomputed on load so the save self-heals) |
| Quitting early gives no XP | done (the award happens at the flag only, same as the Step 9 career stats) |

### Step 11 — cars and level unlocks

| Requirement | Status |
| --- | --- |
| Four cars with different stats, none strictly best | done (`CONFIG.cars`: RELAY, VALIDATOR, SHARD, FLEXNODE; acceleration, top speed, handling and boost capacity, all as multipliers on the Step 2 tuning, and the tests prove no car dominates another) |
| Car select screen with stat bars and a preview | done (CARS pane: four cards, a drawn preview in the player's colours, four stat bars per car, plus a summary line) |
| Unlock by level, numbers in config | done (`CONFIG.unlocks`: cars at level 1/3/6/10, MESH HIGHWAY at 2, SHARD SPEEDWAY at 5) |
| Locked items show a lock icon and the required level, and cannot be selected | done (lock badge with `LEVEL n (now m)`, dimmed card, shake on click; locked tracks in the track list too, and `Game.startRace()` refuses one whatever the UI says) |
| Unlock toast when something becomes available | done (`#unlockToast`: names the item, or "and N more", hidden again on the next race that unlocks nothing) |
| Save the selected car and apply its stats through the existing physics config | done (`Cars.apply()` scales `CONFIG.car` / `CONFIG.boost` in place — car.js holds a reference, so no handling code changed; the choice is stored in the save) |
| A migration for saves with no unlock data | done (save `version: 3`; 2 → 3 grants what the level earned and keeps every track the player had raced or selected, so nobody is locked out) |

### Step 12 — events

| Requirement | Status |
| --- | --- |
| Each event is data: id, name, description, objective, modifier, XP reward | done (`CONFIG.events.list`; `js/events.js` never names an event, so a fifth one is a single config entry) |
| Four events: BLOCK RUSH, STEADY STREAM, RIVAL GAUNTLET, SHARD HUNTER | done (1-lap time attack · two clean laps · win two laps on HARD · collect five shards) |
| Events screen with objective, reward and status | done (EVENTS pane; each card shows the objective spelled out, the XP and AVAILABLE / COMPLETED) |
| Starting an event applies its modifier and tracks the objective live in the HUD | done (an EVENT card in the HUD shows the clock / wall hits / position / shard count with a progress bar) |
| Event complete / failed at the finish, XP paid once | done (a results banner says EVENT COMPLETE or EVENT FAILED; the first completion rides on the XP breakdown as its own flat line, a replay pays nothing) |
| Save completion state | done (save `version: 4`, `events.completed`; a corrupt log is dropped and only `true` counts) |
| Modifiers through a small hook system (onRaceStart / onUpdate / onFinish) | done (a patch-and-revert table plus three hooks the core calls; a test proves the config comes back byte-for-byte, so normal races are untouched) |

## Not built yet (deliberately)

Optimum network integration ·
networking of any kind · simulated latency or fake network behaviour ·
blockchain / wallets / tokens · leaderboards ·
multiplayer · daily rotations · real-world rewards. Later steps add config
sections and modules rather than rewriting what exists.

---

## The tracks (Step 8)

Every circuit is one entry in `OR.TRACKS` (`js/trackdata.js`) using the same
keys; nothing outside that file knows which track is loaded.

| | FLEXNODE CIRCUIT | MESH HIGHWAY | SHARD SPEEDWAY |
| --- | --- | --- | --- |
| Character | fast and flowing | two huge straights | tight and technical |
| Lap | 1022 m | 1879 m | 923 m |
| Laps | 3 | 2 | 3 |
| Road width | 420 u | 560 u | 340 u |
| Checkpoints | 3 | 4 | 4 |
| Shards | 14 | 18 | 10 |
| Rating | MEDIUM ★★☆ | EASY ★☆☆ | HARD ★★★ |
| Tightest corner | MESH HAIRPIN, r 381 | T5 RIGHT SWEEP, r 670 | SHARD HAIRPIN, r 284 |

Measured with the AI at NORMAL, a full race takes 40–44 s on FLEXNODE,
43–47 s on MESH HIGHWAY and 41–45 s on SHARD SPEEDWAY, so the three sit in the
same competitive window while driving completely differently.

The track select screen draws each preview from the same centreline builder the
game races on (`Track.measure()`), so a preview cannot drift from the circuit.
The lap length printed on a card is that same measurement. Selecting a track
calls `Track.use()`, which rebuilds the geometry in place and swaps the per-track
laps, checkpoints and shard layout; the renderer drops its cached shapes and the
menu camera flies the new circuit immediately.

**Records.** `js/bests.js` stores `{ track → difficulty → { timeMs, lapMs } }`
under `optimumRace.trackBests.v1`, with the same defensive try/catch storage as
Step 7. Both numbers are shown: the finish screen prints the track best and best
lap for the difficulty just raced, and every card shows the record for the
difficulty currently selected on the menu. A race that beats either number is
labelled `NEW`. Flat Step 7 saves (per difficulty, no track) are migrated to
FLEXNODE on first read, so nobody loses a record.

## Profile and the save file (Step 9)

Everything the player keeps lives in **one object under one key**
(`optimumRace.save.v1`):

```json
{
  "version": 1,
  "profile":   { "name": "Racer", "color": "violet" },
  "stats":     { "races": 0, "wins": 0, "podiums": 0, "totalTimeMs": 0 },
  "bests":     { "mesh-highway": { "normal": { "timeMs": 47000, "lapMs": 22500 } } },
  "selection": { "track": "flexnode", "difficulty": "normal" }
}
```

* **Migrations.** `version` drives a chain (`MIGRATIONS[from]`). On first run of
  Step 9 the loader folds in the keys Steps 7 and 8 wrote — the flat
  `{ difficulty: ms }` table and the per-track table — so no record is lost.
  A save from a *newer* build is refused rather than half-read.
* **Never crashes.** Corrupt JSON, wrong types, impossible counts (more wins
  than races) and partial objects are repaired or replaced by defaults; blocked
  storage (private mode, `file://`, quota) keeps the whole game working from an
  in-memory save, and every boundary is a try/catch.
* **Export / import.** EXPORT shows (and copies) the save as a Base64 string.
  IMPORT asks for confirmation and then replaces profile, stats, records and
  selections. Whitespace and line breaks from a chat paste are tolerated.
* **Reset progress** clears stats and every record but keeps the driver's name
  and colour, and removes the old per-feature keys so nothing can resurrect.

`js/bests.js` and `js/difficulty.js` kept their public APIs but now read and
write through `OR.Save`, so there is exactly one file to back up.

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
  the race logic and the AI all read the same geometry.
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
  itself stays vector on desktop; phone-sized views use a bounded road cache
  to avoid re-tessellating long dashed paths each frame.
* **Minimap** — drawn from the same geometry in the top-right card: the circuit
  outline, the gates (cyan until passed), the start line and a live player dot
  with a heading triangle, plus three coloured rival dots. It hides on phone-width screens where the lap card
  carries the information.

Adding a track is a matter of adding an entry to `OR.TRACKS` — the geometry,
surface bands, scenery, checkpoints and minimap all read from the data.

---

## How a race works (Step 4)

`MENU → COUNTDOWN → RACING ⇄ PAUSED → FINISHED`

* **Countdown** — 3-2-1-GO. All four cars wait on a staggered grid behind the
  start line. The player gets empty controls until GO, so nothing you
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
  boost meter, shards, particles, rival profiles/stalls, collisions and standings.

---

## Racing the rivals (Step 6)

* **Drivers** — STANDARD GOSSIP 1, 2 and 3 use the same car physics as the player.
  Their top-speed multipliers are 0.97, 1.02 and 1.05; steering/cornering skill
  and small lane offsets differ too, and remain fixed throughout a race.
* **Corners** — the AI aims ahead on the centreline and scans upcoming curvature
  through the Step 5 helper API. A braking-distance envelope lowers its target
  speed before sharp bends; there is no teleporting or rubber banding.
* **Stalls** — a rival occasionally slows to about half its normal top speed
  for 0.5–1 second, still steering and moving. The bolt above the car and in the
  standings identifies a **gameplay stall**. This is not network behaviour,
  latency measurement, or an Optimum integration. Reduced motion keeps the
  indicator static instead of pulsing. Each rival has its own random schedule.
* **Contact** — oriented car-sized boxes separate gently with a 4.5% impact
  speed loss. A per-pair cooldown prevents sustained scraping from draining
  speed to zero; a bounded solver handles exact overlaps and wall-side contact.
* **Order** — the HUD ranks validated lap progress, not the raw 0–1 position on
  the track. Skipped checkpoints cannot inflate the standings. Completed
  drivers rank by finish time; physics-tick ties use stable grid order.
* **Cool-down** — a rival that finishes before you stays on track at about
  42% of its top speed, following the racing line. It is still solid to touch,
  but it never parks across the road while you are still racing.
* **Results** — the race ends when **you** take the flag. Final order freezes
  then: finished drivers show recorded times, while unfinished rivals show
  remaining metres and rank by checkpoint-valid progress. Their times are not
  estimated. The finish screen explains this classification rule.
* **Phone budget** — the main canvas is capped at 1× pixel density on narrow or
  short views, while the DOM HUD stays native-resolution. The road is cached
  once in a texture no larger than 3072 px (about 22 MB on this circuit), the
  vignette is cached, effects remain capped, and phone HUD surfaces avoid
  expensive backdrop blur. Desktop keeps vector road drawing and up to 2× DPR.

---

## Difficulty (Step 7)

Pick **EASY**, **NORMAL** or **HARD** on the menu before you start; the choice is
remembered and preselected next time. Each level is one entry in
`CONFIG.difficulty.levels` and scales the same five numbers:

| | rival top speed | corner skill | stall interval | stall duration | rubber band |
| --- | --- | --- | --- | --- | --- |
| EASY | ×0.94 | ×0.88 | ×0.85 (more often) | ×1.30 (longer) | 0.60 |
| NORMAL | ×1.21 | ×1.14 | ×1.00 | ×1.00 | 0.45 |
| HARD | ×1.26 | ×1.16 | ×1.35 (rarer) | ×0.65 (shorter) | 0.30 |

The rubber band is deliberately light and symmetric-capped: a rival more than
0.10 laps ahead eases off by at most 10 %, one more than 0.60 laps behind
pushes by at most 14 %, and inside the dead zone nothing happens at all. The
caps live in `CONFIG.rivals.rubberBand`; the per-level strength only scales how
much of that cap is used. Nothing is applied to the player, and nothing is
applied after the flag.

Best race time is stored **per difficulty** (`localStorage`, try/catch, with an
in-memory fallback), and the results screen shows `Best on Normal 00:38.141` or
`NEW Best on Normal …` when you beat it.

### Measured balance

`node tools/balance.js 28` drives a fixed, deliberately conservative reference
player (perfect line, no boost, no shard pickups) against each level:

| level | wins | player avg | rival avg | median margin |
| --- | --- | --- | --- | --- |
| EASY | 28/28 (100 %) | 00:40.03 | 00:47.49 | −4.67 s |
| NORMAL | 13/28 (46 %) | 00:40.26 | 00:41.78 | +0.07 s |
| HARD | 6/28 (21 %) | 00:40.22 | 00:40.81 | +0.92 s |

Because the model never boosts, a real player who uses the coded boost will do
slightly better on every level.

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
js/car.js                  shared car physics, grip/drift, surfaces, boost meter
js/shards.js               CODED BOOST shard pickups: layout, collection
js/race.js                 independent lap/checkpoint trackers; player singleton retained
js/difficulty.js           EASY/NORMAL/HARD levels, saved selection, best times
js/rivals.js               three AI drivers, corner planning, grid, gameplay stalls
js/collisions.js           bounded oriented-box contact and impact cooldowns
js/standings.js            validated live order and frozen finish classification
js/input.js                keyboard + touch pad -> one flat control state
js/audio.js                engine sound synthesised with Web Audio (no files)
js/renderer.js             all canvas drawing, camera, marks, particles
js/hud.js                  DOM HUD updates (cached, no layout thrash)
js/game.js                 state machine + fixed-timestep loop
js/main.js                 bootstrap, wires DOM screens to the state machine

tests/smoke.js             211 jsdom gameplay/UI regression checks
tests/rivals.js            49 deterministic AI/contact/race checks
tests/difficulty.js        43 difficulty, persistence, rubber-band and balance checks
tools/_trackcheck.js       dev tool: prints track metrics and an ASCII map (design aid)
tools/serve.js             zero-dependency dev server
tools/build-standalone.js  bundles everything into optimum-race.html
tools/visual-check.js      headless-Chrome pixel + performance check
tools/race-check.js        headless-Chrome: autopilots a full 3-lap race
tools/rivals-check.js      28 real-Chrome rival, difficulty, standings and mobile checks
tools/balance.js           win-rate workbench for tuning the difficulty levels
tools/screenshots.js       screenshots of every screen
tools/ascii-preview.js     prints a PNG as ASCII (brightness + hue map)
optimum-race.html          GENERATED single-file build (npm run build)
```

### Game states

`menu → countdown → racing ⇄ paused → finished → (race again)`

The timer starts at **GO**, runs while `racing`, and freezes the instant the car
crosses the finish line.

---

## Extension points (marked `STEP n` in the source)

* **More tracks (step 8)** — add an entry to `OR.TRACKS` in `js/trackdata.js`
  and point `OR.activeTrack` at it. The geometry, surface bands, checkpoints,
  scenery, minimap and lap scoring all read from the data; nothing else changes.
* **AI rivals (step 6, implemented)** — `Game.entities` contains four `Car`
  instances. `Race.create(car)` supplies independent trackers. The AI uses
  `Track.getNearestTrackPoint`, `Track.pointAhead`, `Track.pointAt` (including
  interpolated radius/index) and `Track.isOnRoad`, without reading private
  samples or control points. Tuning is in `CONFIG.rivals` / `CONFIG.collisions`.
* **Difficulty (step 7, implemented)** — levels live in `CONFIG.difficulty`,
  are applied in `Rivals.reset()` via `Rivals.difficulty`, and are owned by
  `js/difficulty.js` (selection, persistence, best times). Retune with
  `node tools/balance.js`.
* **Profile, XP, unlocks, events (steps 8–13)** — each gets a config block and
  a module; `js/config.js` and the `js/main.js` screen wiring are the seams.

---

## Testing

```bash
npm test          # 433 checks: gameplay/UI, rival races, difficulty, tracks, save file
npm run visual    # earlier-step real-browser pixel/performance regressions
npm run rivals    # Steps 6–7 pixels, races, difficulty, phone emulation (needs Chrome)
npm run balance   # tune the difficulty levels against the reference player
npm run screenshots
```

`tests/smoke.js` boots the real game files inside jsdom with a stubbed canvas
and drives the full loop: the menu, starting a race, acceleration, braking,
coasting, steering (including "no steering while stationary" and steering
tighter at low speed), grip and drift, every surface, the soft bounce on both
barriers, the coded boost meter (charging rules per surface, shard pickups,
the 25 % threshold, drain, 3 s cooldown, HUD states, reduced motion), the race
timer, three laps of checkpoints and splits, the finish line, the results
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

### Step 6 verification and manual checks

`tests/rivals.js` drives **eight seeded four-car races**, including all three
laps, ordered gates, stalls, collisions, cool-down laps and exact finish-time
ordering. Rivals
complete these races in roughly **42–56 seconds** (including traffic), with no
wall hits in those normal-racing scenarios. Additional probes cover the grid's
first crossing, independent split arrays, sharp-corner braking, stall duration
and separation, sustained contact, four exactly overlapping cars, and contact
at a barrier. The original handling probes isolate traffic impulses where
necessary; touch racing and the complete race exercise real contact.

`tests/smoke.js` adds integration checks for countdown locking, live position,
full driver names, stall indicators, pause freezing, final classification,
coast-out freezing, restart and quit cleanup. `tools/rivals-check.js` checks
real canvas pixels (sprites, stall bolts, reduced motion, coloured minimap
dots), drives a complete browser race and benchmarks a **390×844**, touch,
2×-device-density phone viewport. The canvas itself uses the 1× mobile budget.
Native-speed emulation runs at about **58–60 fps**; a separate 4× CPU stress run
reports main-thread simulation/draw-submission cost and the software-rendered
frame rate. These are emulation measurements, **not a physical-phone test**.

Manual test:

1. Run `npm start`, open the live preview, and press **START RACE**. Confirm the
   four staggered cars wait behind the line and move only at GO.
2. Drive with W/↑, A/D (or arrows), brake with S/↓ and use Space to boost. Let
   rivals pass, then overtake; **POS** and the list should change together.
3. Watch the coloured cars approach the hairpin and slow. Every few seconds a
   rival briefly slows with a bolt; it must continue steering and recover.
4. Bump a rival from the side or rear, including beside a barrier. Both cars
   should separate and be able to drive away.
5. Pause during a stall, wait, and resume. Cars and stall timers must freeze.
   **RESTART** restores all four grid slots, fresh laps/stalls and POS 1/4.
6. Complete three laps. Check your place and all four names in final standings,
   recorded times for finishers, and remaining metres for unfinished rivals.
7. Use `?touch=1` on a phone-sized viewport (also `?motion=off` to check the
   static indicator). Check the pads and standings fit. **RACE AGAIN** and
   **QUIT TO MENU** must not retain old rivals/results.
8. Run `npm run build` and open `optimum-race.html` offline; the same rivals and
   standings are bundled with no network or external assets.

### Step 7 verification and manual checks

`tests/difficulty.js` (43 checks) covers the config object, selection
persistence across a simulated reload, blocked/corrupt localStorage, best times
per difficulty, the level actually reaching the rivals (speed, skill, stall
timing), rubber-band caps and gradual engagement, an AI-only pace check that
the three levels really differ (46.9 s / 41.2 s / 40.5 s), and a small balance
sample. `tools/rivals-check.js` does the browser half: the picker, a real
reload, the HUD chip, the finish screen, the stored best, and a run with
`localStorage` throwing.

Manual test:

1. `npm start`, open the preview, and pick **HARD** — then reload. HARD should
   still be selected.
2. Start a race: the HUD shows `HARD`, and the rivals pull away from a
   no-boost lap. Restart on **EASY** and they brake earlier, stall longer and
   are beatable.
3. Finish a race: the results show the difficulty and `Best on …` (or
   `NEW Best on …`). Beat it and the line updates; play a different level and
   its own record is untouched.
4. Block storage (or open the file in a private window) — the game still loads,
   plays and shows the best time for the session.
5. Watch a pack race on NORMAL: a rival more than a few seconds behind will
   close up, and one far ahead will ease slightly — never more than the caps.

Only Steps 1–7 are implemented; later steps remain untouched.

### Files changed for Step 6

- Added: `js/rivals.js`, `js/collisions.js`, `js/standings.js`, `tests/rivals.js`,
  `tools/rivals-check.js`.
- Updated gameplay: `js/config.js`, `js/car.js`, `js/track.js`, `js/race.js`,
  `js/game.js`.
- Updated rendering/UI: `js/renderer.js`, `js/hud.js`, `js/main.js`,
  `index.html`, `css/style.css`.
- Updated tooling/docs: `tests/smoke.js`, `tools/build-standalone.js`,
  `package.json`, `package-lock.json`, `README.md`.
- Regenerated deliverable: `optimum-race.html`.

### Files changed for Step 7

- Added: `js/difficulty.js`, `tests/difficulty.js`, `tools/balance.js`.
- Updated: `js/config.js` (levels + rubber-band caps), `js/rivals.js`,
  `js/game.js`, `js/hud.js`, `js/main.js`, `index.html`, `css/style.css`,
  `tests/smoke.js` (section 17), `tests/rivals.js`, `tools/rivals-check.js`,
  `tools/build-standalone.js`, `package.json`, `package-lock.json`, `README.md`.
- Regenerated: `optimum-race.html` (now 191.7 KB).

### Step 8 verification and manual checks

`npm test` runs four suites — 375 checks, 0 failures:

| Suite | Checks | What it covers |
| --- | --- | --- |
| `tests/smoke.js` | 246 | Steps 1–7 plus section 18: the cards, previews, selection, pane navigation, race start on the selected track, RACE AGAIN, and the records written at the flag |
| `tests/rivals.js` | 49 | AI racing, collisions, standings |
| `tests/difficulty.js` | 47 | EASY / NORMAL / HARD plus the difficulty × track section: selection unaffected by track, per-track records, time vs lap |
| `tests/tracks.js` | 33 | Track data schema, geometry per track, a full AI race on each circuit (laps and gates), per-track laps/checkpoints/shards, previews matching the built centreline, and the record book |

Manual pass:

1. `npm start` → **CHANGE TRACK**. The three cards appear with previews, lengths,
   ratings and your records for the selected difficulty.
2. Arrow keys or a click move the selection; the menu background flies the chosen
   circuit immediately.
3. **RACE THIS TRACK** → the HUD shows that track's lap count; the minimap, road
   width, scenery, shard count and checkpoints all change with it.
4. Finish a race: the results screen names the circuit and prints the track best
   and best lap for that difficulty; **RACE AGAIN** keeps the track.
5. **MAIN MENU** lands on the track select pane; the card now shows the new record.
6. Race a second circuit at the same difficulty: its records are separate, and
   both remain after a reload.
7. Phone/tablet: the cards stack into one column and scroll inside the menu panel.

### Files changed for Step 8

- Added: `js/bests.js`, `js/trackselect.js`, `tests/tracks.js`.
- Updated gameplay: `js/trackdata.js` (two new circuits, per-track shards),
  `js/track.js` (`Track.use()`, `Track.measure()`, start-relative checkpoints,
  `Track.laps`), `js/race.js` (lap count from the track), `js/shards.js`
  (per-track layout), `js/game.js` (track-aware results + records),
  `js/config.js` (storage keys), `js/renderer.js` (`invalidateTrack()`),
  `js/main.js` (menu panes, finish screen).
- Updated UI/docs: `index.html`, `css/style.css`, `tests/smoke.js` (section 18),
  `tests/difficulty.js`, `tools/build-standalone.js`, `package.json`,
  `README.md`.
- Regenerated deliverable: `optimum-race.html`.

### Step 9 verification and manual checks

`npm test` runs five suites — 433 checks, 0 failures:

| Suite | Checks | What it covers |
| --- | --- | --- |
| `tests/smoke.js` | 264 | Steps 1–8 plus section 19: the profile pane, name sanitising, colour swatches, EXPORT/IMPORT/RESET through the real buttons, the HUD standings name, the finish DRIVER tile, and the race being booked into the career stats |
| `tests/rivals.js` | 49 | AI racing, collisions, standings |
| `tests/difficulty.js` | 47 | EASY / NORMAL / HARD, per-track records, corrupt and legacy selection data |
| `tests/tracks.js` | 33 | Track data, geometry, a full AI race per circuit, previews, record book |
| `tests/save.js` | 40 | The versioned save: defaults, profile/colour rules, stats, export→import round trips, reset, migrations from Steps 7–8, corrupt data, blocked storage |

Manual pass:

1. `npm start` → **PROFILE**. Type a name with odd characters and spaces: the
   field cleans itself and caps at 16. Pick one of the six colours.
2. Go back to the menu: the "racing as" line and the car's paint change.
3. Race and finish: the HUD standings and the finish screen show your name and
   colour; the profile's RACES/WINS/PODIUMS/TOTAL TIME have gone up.
4. **PROFILE → EXPORT**, copy the string somewhere safe. Then **RESET** (confirm):
   stats and records are empty, the name and colour stay.
5. Paste the string back into the box and **IMPORT** (confirm): everything
   returns, and it is still there after a reload.
6. Break it on purpose: paste garbage into the box — the game says so and keeps
   your save. Open a private window (blocked storage) — the game still plays.

### Files changed for Step 9

- Added: `js/save.js`, `tests/save.js`.
- Updated: `js/utils.js` (`sanitiseName`), `js/config.js` (profile section,
  6 colours, save key), `js/bests.js` (records now inside the save),
  `js/difficulty.js` (selection + best time through the save),
  `js/trackselect.js` (selection through the save), `js/rivals.js` (player name
  and paint from the profile), `js/renderer.js` (player body palette),
  `js/game.js` (career stats + driver identity at the flag), `js/hud.js`
  (standings keep up with a renamed driver), `js/main.js` (profile pane,
  export/import/reset, finish tile), `index.html`, `css/style.css`,
  `tests/smoke.js` (section 19), `tests/difficulty.js` (save-backed keys),
  `tools/build-standalone.js`, `package.json`, `README.md`.
- Regenerated deliverable: `optimum-race.html` (254.8 KB).

### Step 10 verification and manual checks

`npm test` runs six suites — 488 checks, 0 failures:

| Suite | Checks | What it covers |
| --- | --- | --- |
| `tests/smoke.js` | 276 | Steps 1–9 plus section 20: the menu and profile level bars, a race paying out exactly the breakdown shown, the results bar and clean-lap note, the level-up toast firing once, quitting early earning nothing, and a barrier hit spoiling a lap |
| `tests/rivals.js` | 49 | AI racing, collisions, standings |
| `tests/difficulty.js` | 47 | EASY / NORMAL / HARD, per-track records, corrupt and legacy selection data |
| `tests/tracks.js` | 33 | Track data, geometry, a full AI race per circuit, previews, record book |
| `tests/save.js` | 42 | The versioned save: defaults, profile/colour rules, stats, export→import round trips, reset, migrations from Steps 7–9, corrupt data, blocked storage |
| `tests/xp.js` | 41 | The XP maths: every award source, difficulty multipliers, the level curve and its inverse, clamping, the clean-lap rule, and the version 1 → 2 migration |

Manual pass:

1. `npm start`. The menu shows `LEVEL 1` and an empty bar; the profile shows the
   same bar with `0 / 283 XP`.
2. Win a clean race on NORMAL: the finish screen lists finish +50, 1st +100,
   clean laps +20 each and the boost bonus, then the difficulty line; the rows
   add up to the total, and the bar animates.
3. Cross a level: the toast slides in once, and the menu and profile bars are
   already updated when you get back to them.
4. Hit a wall on a lap, then finish: that lap pays no clean-lap XP.
5. Start a race and quit before the flag: XP is unchanged.
6. Race on EASY and on HARD: the same race pays less / more, and the difficulty
   line on the results screen shows the multiplier.
7. Reload mid-career: XP, level and the bars come back from the save.

### Files changed for Step 10

- Added: `js/xp.js` (awards, level curve, breakdown lines), `tests/xp.js`.
- Updated: `js/config.js` (the `xp` section), `js/car.js` (barrier-contact
  episodes per lap), `js/save.js` (**version 2**, `progress`, `addXp()`,
  the 1 → 2 migration, upgraded saves written back immediately),
  `js/game.js` (clean-lap counting, the award at the flag),
  `js/main.js` (level bars, the results XP panel, the toast),
  `index.html`, `css/style.css`, `tests/smoke.js` (section 20),
  `tests/save.js` (v2 + a v1 upgrade regression), `tests/difficulty.js`,
  `tests/tracks.js`, `tools/build-standalone.js`, `package.json`, `README.md`.
- Regenerated deliverable: `optimum-race.html`.

### Step 11 verification and manual checks

`npm test` runs seven suites — 558 checks, 0 failures:

| Suite | Checks | What it covers |
| --- | --- | --- |
| `tests/smoke.js` | 290 | Steps 1–10 plus section 21: the garage opening from the CARS button, lock badges and required levels, a locked car and a locked track refusing to be picked, a finish that crosses a level unlocking exactly the right items and showing the toast, and a reset re-locking everything |
| `tests/rivals.js` | 49 | AI racing, collisions, standings |
| `tests/difficulty.js` | 47 | EASY / NORMAL / HARD, per-track records, corrupt and legacy selection data |
| `tests/tracks.js` | 33 | Track data, geometry, a full AI race per circuit, previews, record book |
| `tests/save.js` | 42 | The versioned save: defaults, profile/colour rules, stats, export→import round trips, reset, migrations from Steps 7–9, corrupt data, blocked storage |
| `tests/xp.js` | 41 | The XP maths: every award source, difficulty multipliers, the level curve and its inverse, clamping, the clean-lap rule, migrations |
| `tests/cars.js` | 56 | The four cars, the balance rule (no car dominates), stat bars, the physics each car writes, locked selection refused, unlocking at exactly the right level, persistence, the 2 → 3 migration and "never lock out an existing player", corrupt unlock data, export/import, reset |

Manual pass:

1. `npm start`. The menu shows `NEXT UNLOCK: MESH HIGHWAY AT LEVEL 2`. Open **CARS**:
   RELAY is selected, the other three are dimmed with a padlock and their level.
2. Click a locked car: nothing is selected (the card shakes). Click RELAY: the
   summary line updates and the menu hint stays.
3. Win a race or two until you reach level 2, then level 3: the toast announces
   MESH HIGHWAY and VALIDATOR, the garage and the track list unlock them, and
   the results screen still shows the XP breakdown.
4. **CHANGE TRACK**: MESH HIGHWAY is greyed out until then, with `LOCKED · LEVEL 2`.
   Clicking it does nothing; racing it is impossible even with a stale save.
5. Pick VALIDATOR: the car pulls harder at the top end and turns a little
   slower; the physics numbers really changed, not just the paint.
6. Reload: the chosen car and the unlocked items are still there. **PROFILE →
   RESET** returns the garage to RELAY and locks the rest again.
7. Paste a Step 10 save into **PROFILE → IMPORT**: everything migrates, and any
   track you had a time on stays unlocked.

### Files changed for Step 11

- Added: `js/cars.js` (the cars, stat bars, unlocks, track locks, previews),
  `tests/cars.js`.
- Updated: `js/config.js` (`cars` and `unlocks` sections), `js/save.js`
  (**version 3**: `unlocks`, `selection.car`, the 2 → 3 migration, ordered
  unlock sanitising, `grantUnlocks`/`car`/`setCar`), `js/trackselect.js`
  (lock badges, refusals, stale-selection fallback), `js/game.js`
  (`startRace` refuses a locked circuit), `js/main.js` (the garage pane, the
  next-unlock hint, the unlock toast, boot/import/reset wiring),
  `index.html`, `css/style.css`, `tests/smoke.js` (section 21),
  `tests/save.js` and `tests/xp.js` (version 3), `tests/difficulty.js`,
  `tests/tracks.js`, `tools/build-standalone.js`, `package.json`, `README.md`.
- Regenerated deliverable: `optimum-race.html`.

### Step 12 verification and manual checks

`npm test` runs eight suites — 626 checks, 0 failures:

| Suite | Checks | What it covers |
| --- | --- | --- |
| `tests/smoke.js` | 307 | Steps 1–11 plus section 22: all four events raced end to end, complete and failed, the live HUD objective, the results banner, XP paid once, RACE AGAIN restarting the event, and a normal race afterwards running on the shipped config |
| `tests/rivals.js` | 49 | AI racing, collisions, standings |
| `tests/difficulty.js` | 47 | EASY / NORMAL / HARD, per-track records, corrupt and legacy selection data |
| `tests/tracks.js` | 33 | Track data, geometry, a full AI race per circuit, previews, record book |
| `tests/save.js` | 42 | The versioned save: defaults, profile/colour rules, stats, export→import round trips, reset, migrations, corrupt data, blocked storage |
| `tests/xp.js` | 41 | The XP maths: every award source, difficulty multipliers, the level curve, the clean-lap rule, migrations |
| `tests/cars.js` | 56 | The four cars, the balance rule, stat bars, the physics each car writes, locked selection, unlocking, migrations |
| `tests/events.js` | 51 | The events as data, every objective met and missed, the objective text, the modifier patch/revert round trip, the hook registry, live progress, the flat one-off bonus, and the 3 → 4 migration |

Manual pass:

1. `npm start` → **EVENTS**. Four cards, each with its objective, its XP and
   AVAILABLE.
2. **RACE EVENT** on BLOCK RUSH: the HUD shows `EVENT BLOCK RUSH` and
   `TIME 0:00.0 / 0:18.0` counting up against the target. Cross the line under
   the target: the results banner says EVENT COMPLETE with `+250 XP`, and the
   XP breakdown has an `EVENT COMPLETE — BLOCK RUSH` line.
3. Race it again and beat it: the banner says it was already completed and no
   bonus is paid. Miss the target: EVENT FAILED, no bonus.
4. STEADY STREAM: touch a wall and watch the HUD's wall-hit count; finish dirty
   and the event fails. RIVAL GAUNTLET: note the HUD says `ON HARD` and the
   difficulty chip is HARD — but your menu difficulty is unchanged afterwards.
   SHARD HUNTER: `SHARDS 0 / 5` fills as you collect.
5. Back in EVENTS, completed challenges show a green COMPLETED badge. **RACE
   AGAIN** on an event results screen restarts that event.
6. Start a normal race from the menu: no EVENT card, normal lap count, normal
   shard count — the modifiers are always given back.
7. Reload: completions are still there. **PROFILE → RESET** clears them.

### Files changed for Step 12

- Added: `js/events.js` (the engine: modifiers, objectives, hooks, the events
  screen and the HUD objective), `tests/events.js`.
- Updated: `js/config.js` (the `events` section), `js/xp.js` (flat `extras`
  lines on the breakdown), `js/save.js` (**version 4**: `events.completed`,
  the 3 → 4 migration, completion API, reset), `js/race.js` (`lapsOverride`),
  `js/game.js` (multi-listener hooks, `onRaceStart`/`onUpdate`/`onFinish`
  calls, `wallHits` in the results, judging + first-completion bonus at the
  flag, `returnToMenu` reverting), `js/main.js` (events pane, results banner,
  RACE AGAIN restarting an event, boot), `index.html`, `css/style.css`,
  `tests/smoke.js` (section 22), `tests/save.js`/`tests/xp.js`/`tests/cars.js`
  (version-agnostic save assertions), `tests/difficulty.js`, `tests/tracks.js`,
  `tools/build-standalone.js`, `package.json`, `README.md`.
- Regenerated deliverable: `optimum-race.html`.
