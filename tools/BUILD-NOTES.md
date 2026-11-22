# BREAKWATER v2 — PASS 1 build notes (foundation)

Run it: `node main.ts` (serves `game/` on http://127.0.0.1:8081/, `--port N` to change).
Everything is seeded (`?seed=1337` is the default); no network at runtime, three.js r187 from `game/vendor/three.min.js` only.

## Gate (headless, raw line from `node tools/gate.mjs`)

```
{"fps":26,"calls":114,"triangles":565438,"geometries":73,"textures":38,"consoleErrors":0,"offsiteRequests":0,"frameMs":8.35,"fpsCapacity":119.8,"seconds":10,"mode":"headless"}
```

Same build, `node tools/gate.mjs --headed` (same CDP driver, a visible Chrome window):

```
{"fps":59.7,"calls":114,"triangles":565438,"geometries":73,"textures":38,"consoleErrors":0,"offsiteRequests":0,"frameMs":8.18,"fpsCapacity":122.3,"seconds":10,"mode":"headed"}
```

| Budget (1280×720) | Limit | Headless | Headed |
|---|---|---|---|
| fps (rAF cadence, 10 s) | ≥ 55 | **26 (fails)** | 59.7 |
| frame cost (GPU-synced, see below) | — | 8.35 ms (≈120 fps) | 8.18 ms (≈122 fps) |
| draw calls (max per frame, incl. shadow + post passes) | < 500 | 114 | 114 |
| triangles (max per frame, incl. shadow pass) | < 900 000 | 565 438 | 565 438 |
| geometries / textures | — | 73 / 38 | 73 / 38 |
| console errors | 0 | 0 | 0 |
| off-site requests | 0 | 0 | 0 |

**The headless fps line misses the budget. That comes from this machine's headless Chrome, not the game.**
In the same session, headless Chrome showing a *blank page* (or a WebGL page doing only `gl.clear`)
ran requestAnimationFrame at 25–33 fps (`blank 26 / webgl clear 29` right after the gate run above).
Headed Chrome on the same machine runs the game at a locked 60 fps.
To measure the game itself regardless of display cadence, the gate also reports `frameMs`/`fpsCapacity`:
`window.__game.bench()` runs sim + render back to back, forcing GPU completion with a 1-pixel readback after each frame.
That gives ~8 ms per frame, i.e. ~120 fps of headroom. I tried `--disable-gpu-vsync`, `--disable-frame-rate-limit`,
occlusion/throttling feature flags and `taskpolicy` tiers, and none lifted the blank-page cap. The machine was under load
from other apps at the time (load average 4–8). On a quiet machine the headless number should be re-checked.
Your earlier project's notes show this same machine reaching 60 headless at times.

The gate samples while an autopilot runs the player around a downtown block (sprinting on two legs),
so the numbers come from moving gameplay, not an idle spawn view.

## Screenshots (`node tools/shots.mjs`, 1280×720 JPEG, staged through `window.__game.stage()` with the real game code)

Two consecutive runs produce byte-identical files (same seed, fixed-step simulation, grain seeded by sim time).

1. `screenshots/01-waterfront-dusk.jpg`: The player jogs along the waterfront promenade at sunset, with sunlit brick and pastel buildings, street lamps and trees on the right, and the harbour railing and teal water on the left.
2. `screenshots/02-avenue-crossing.jpg`: The player crosses a zebra crossing at a downtown intersection, with a green traffic light, a corner hotel with neon fascia signs, a lit KARAOKE shopfront, and the avenue running down to the harbour under a dusk sky.
3. `screenshots/03-harbour-jetty.jpg`: The player stands at the end of the timber jetty looking over the rippling harbour toward the far shore's town lights and the lighthouse, whose beam sweeps across the pink sunset sky.
4. `screenshots/04-downtown-sprint.jpg`: The player sprints across a crossing between office towers with lit window bands, shop rows with neon signs, a red signal and a blade sign, looking down a long street canyon.

## Modules (line counts)

| File | Lines | Job |
|---|---|---|
| `main.ts` | 35 | Node 22 static server for `game/` (port 8081, `--port`) |
| `game/index.html` | 42 | canvas, HUD, start card, loading screen |
| `game/style.css` | 38 | HUD / menu styling (system fonts only) |
| `game/src/main.js` | 161 | boot, loop wiring, `window.__game` tool API (ready, frame stats, autopilot, stage, bench, probeCamera) |
| `game/src/loop.js` | 47 | fixed 60 Hz timestep with render interpolation, deterministic `advance()` |
| `game/src/rng.js` | 48 | mulberry32 seeded RNG with named forks |
| `game/src/input.js` | 68 | keyboard, pointer-lock / drag mouse look, wheel, virtual input |
| `game/src/config.js` | 35 | city dimensions, dusk palette, neon colours |
| `game/src/hud.js` | 35 | loading bar, start card, clock, F3 perf readout |
| `game/src/debug.js` | 29 | autopilot route and staged shot poses for the tools |
| `game/src/camera/chaseCamera.js` | 84 | damped chase cam, orbit, auto-recentre, wall pull-in, sprint FOV breathing |
| `game/src/player/character.js` | 189 | primitive-built character, two-bone-IK gait (planted feet), arm swing, lean |
| `game/src/player/player.js` | 131 | camera-relative movement, accel/friction, sprint/walk, jump, kerbs, collision |
| `game/src/render/renderer.js` | 33 | WebGLRenderer, resize, per-frame call/triangle stats |
| `game/src/render/post.js` | 154 | HDR MSAA target, soft-knee bloom pyramid, halation, ACES, grade, vignette, grain |
| `game/src/render/sky.js` | 99 | dusk sky dome with sun and lit stratus; PMREM environment for reflections |
| `game/src/world/world.js` | 105 | assembles the district, sun + hemisphere light, fog, shadow follow |
| `game/src/world/layout.js` | 75 | street grid, blocks, segments, outer ring, promenade, jetty, ground height, walkable area |
| `game/src/world/buildings.js` | 420 | lot subdivision and buildings: arcades/flush shopfronts, signs, awnings, towers, roofs, billboards, fire escapes |
| `game/src/world/roads.js` | 77 | pavement slabs, granite kerbs, lane paint, stop lines, zebras, manholes |
| `game/src/world/props.js` | 373 | instanced lamps, cycling traffic signals, trees, bins, benches, hydrants, planters, rails, plazas |
| `game/src/world/harbour.js` | 254 | water shader with lamp reflections, quay, jetty, terminal + cranes, breakwater, lighthouse beam, far shore |
| `game/src/world/skyline.js` | 55 | outer-ring buildings around downtown |
| `game/src/world/textures.js` | 387 | all canvas-painted textures (asphalt, paving, 4 facades, shopfronts, neon, billboards) |
| `game/src/world/lightmap.js` | 139 | baked top-down lamp/shop/neon light + contact-shadow AO, injected into materials |
| `game/src/world/materials.js` | 80 | materials and per-material merge builders |
| `game/src/world/geobuilder.js` | 120 | geometry merging, world UVs, baked base darkening, instancing helper |
| `game/src/world/colliders.js` | 100 | AABB spatial hash: circle push-out and ray casts |
| `tools/cdp.mjs` | 114 | Chrome launcher + raw CDP over Node's WebSocket, server bootstrap, error/request watch |
| `tools/gate.mjs` | 62 | budget gate (one JSON line) |
| `tools/shots.mjs` | 43 | screenshot capture |

Total: 3,632 lines (game source 3,415).

## What PASS 1 delivers

- **Engine shell**: ES modules, fixed-timestep loop with interpolation (player position, yaw and gait phase are interpolated), resize handling, seeded RNG with named sub-streams, loading screen → start card → pointer-lock play. `?autostart` skips the card for tools.
- **Camera**: damped follow of an over-the-shoulder pivot, mouse orbit (pointer lock or drag), wheel zoom, auto-recentre behind a running player after 1.4 s without mouse input, raycast pull-in (instant in, eased out) against the collision world, ground clamp, FOV 60→67 with a stride-rate pulse while sprinting. `probeCamera` orbits 360° at four spots, including flat against walls: 0 samples inside geometry.
- **Player**: head, hair, torso, two-segment arms and legs, shoes, built from primitives. The gait uses analytic two-bone IK: the stance ankle target moves backward at exactly the measured ground speed, and the cycle time is derived from speed, duty factor and stride, so feet don't slide. The model blends walk (inverted-pendulum bob) into run (flight phase, lower hips, bent elbows, forward lean). Arms counter-swing and the spine twists. The body also leans with acceleration and rolls into turns, and the legs tuck mid-jump. Movement is camera-relative with acceleration 22 m/s², friction 16 m/s², walk 1.7 / jog 4.3 / sprint 7.0 m/s (verified with real CDP key events), plus kerb step-up and jump. Collision is a capsule against AABBs, and velocity follows the resolved motion so walls absorb momentum.
- **Downtown**: a 6×6 street grid (25 blocks) with 12 m carriageways, 4 m raised pavements and granite kerbs. Paint layer: dashed lanes, double yellow centre line, stop lines on the inbound half, zebra crossings, manholes. 117 buildings in 4 facade styles (glass curtain, brick, concrete ribbon, pastel stucco), with podium + tower massing on tall ones. Ground floors are either colonnaded arcades or flush shopfronts, all recessed with soffits. The district also has 727 neon fascia signs, 421 striped awnings, blade signs, string courses, cornices, parapets, roof plant (AC units, water tanks, stair houses, antennas with red lights), crown light strips, 33 rooftop billboards (original brands) and fire escapes. Plazas have fountains, trees and benches. Street furniture is instanced: lamps, traffic signals (144, cycling red/amber/green per axis), trees (with clearance checks against awnings and blade signs), bins, benches, hydrants, planters and bollards. A 368-building outer ring gives the district a skyline.
- **Harbour**: animated teal water with fresnel sky reflection, a sun glitter path and ray-traced reflections of the quay lamps and city glow. Also a quay wall with coping, the promenade with railing, lamps, benches and trees, a walkable timber jetty on pilings, and a container terminal with 4 gantry cranes and floodlights. Out in the bay are a breakwater arm with a lighthouse and sweeping beam, and the far shore's town lights.
- **Look**: low sun over the harbour (south-west), a dusk sky gradient with lit stratus, exponential fog, and a PMREM environment for glass and wet-ground reflections. Wet asphalt comes from roughness puddles plus baked lamp glints. A 2048² baked light map paints amber lamp pools, shop-window spill and neon spill, and an AO map gives contact shadows under props and at building bases and kerbs. The sun shadow map is texel-snapped and follows the player. The post pass has HDR bloom with warm halation on neon and lamps, ACES filmic, split-tone grade, vignette and grain.
- **Tools**: `tools/cdp.mjs` (no npm), `tools/gate.mjs`, `tools/shots.mjs`, all on raw CDP via `--remote-debugging-port`.

## Known limits / notes for the operator

- Port 8081 was already taken during this pass by a `python3 -m http.server` serving `/Users/mac/breakwater/game` (the old project). I left it running. The tools start `main.ts` on port 8091 by default (`--port` to change).
- Headless fps: see the gate section. The game's frame cost is ~8 ms, but headless Chrome here caps rAF at ~26 fps even on a blank page.
- The camera can pull in to 0.7 m when backed against a wall. Fading the character at very close range is not done yet.
- Lamp light on the ground is baked (light map), so the player and props get lamp light only through the same map, not from real-time lights.

## What PASS 2 must add

1. **Vehicles**: drivable cars (arcade physics, steering, handbrake, damage), a car camera, entering and exiting, stealing parked cars. Then traffic AI on the existing lane geometry, obeying the signals that already cycle (`props.update` holds the per-axis state).
2. **Pedestrians**: crowd agents on the pavements, reusing `character.js` with varied colours. Also flee/react behaviour and instancing or LOD for the crowd.
3. **HUD**: minimap (render from `layout` blocks and streets), health, money, wanted stars, mission objective text, and a pause menu.
4. **Wanted level and police**: crime detection, police cars and officers, pursuit and search AI.
5. **Combat**: melee, then firearms with aim mode on the chase camera (shoulder offset is already in).
6. **Missions and story**: a mission framework with markers, triggers and fail/complete, plus a save system (localStorage).
7. **More districts** beyond downtown: the outer ring in `layout.outerBlocks` is already laid out and lit, ready to be made walkable (extend `CITY.bounds`, add props and lightmap coverage).
8. **Audio**: city ambience, footsteps synced to the IK foot plants (stance start in `character.pose`), water, and radio.
9. **Hand-in**: `main.ts` must switch from dev server to the bounty's hand-in program (copy `game/` and `screenshots/` to `/output`, write `dossier.json` via `vendor/makefun-game.ts`), keeping a serve mode for local play.
10. Budget headroom for all that: 114 calls / 565k triangles now, against 500 / 900k. Cars and pedestrians must be instanced and LODed, and the shadow pass currently doubles everything, so later passes should consider distance-limited shadow casters.

## PASS 3 — living city

Implemented and verified with Node v22.23.1. Run `node main.ts` for play, or use the self-contained CDP tools below. Runtime remains offline, uses the vendored three.js, and has no added dependencies.

- **Crowd:** a fixed pool of 18 people, drawn in six instance batches (heads, hair, torsos, arms, legs, shoes). Seeded heights, skin/clothing colours, walking speeds and stride frequencies; limbs rotate with measured walking speed. Pavement edges follow the street grid, join at corners, and cross on zebra links. The promenade and jetty have ground-level paths. Spawn samples exclude crossing lanes, static solids and cars. Distant walkers recycle to clear pavement samples within 43 m of the player; body spacing, car contacts and static collision checks prevent penetration. Blocked walkers pause and reverse their graph leg.
- **Reactions:** nearby moving cars make walkers retreat at running speed; cars arriving at stationary people also resolve contact. Sprinting/chases and gunfire trigger flight. `window.__game.gunfire(x,z)` and `.chase(active)` expose the events for the next combat/police passes. Gunfire events are capped at eight and expire; resetting clears threats and chase state. These hooks do not add weapons or police missions.
- **Traffic:** 24 AI cars, ten parked/player cars, hard cap **34 vehicles**. Existing lane-following vehicle dynamics, turn paths, signals, obstacle braking and swept contacts remain in use. Drivers have seeded 7–13 m/s cruise speeds and see every crowd agent as a hazard. Every half second the manager checks local moving density, recycles distant traffic into clear lane slots biased ahead, and recovers prolonged stationary traffic when local movement is sparse. Spawn clearance tests vehicle contact shapes, allowing cars in adjacent/opposite lanes. Parked cars recycle into kerb slots. No per-frame vehicle/mesh creation.
- **Props:** existing bins, benches, planters, hydrants, traffic lights, shelters and vending machines are joined by instanced road signs and downtown corner bollards. Existing building awnings now use a shared instanced prototype with per-instance tint/width. Street-furniture instance batches are compacted within 145 m of the camera; their static collider/placement registries remain fixed.
- **Rendering budget:** district geometry is grouped into 240 m spatial cells so camera and shadow frusta can reject distant geometry. Fixed render scale 0.8 (1024×576 scene at a 1280×720 viewport), HDR/bloom retained, MSAA disabled, 1024² shadows refreshed at 30 Hz (camera jumps invalidate immediately). Simulation and animation remain 60 Hz. The HUD/output images remain 1280×720. Preliminary headed runs missed the target (44.9 fps before spatial batching; 52.6 after filling startup traffic). Spatial culling plus the shadow cadence change gives the final passing gate below.

### Final gates (raw JSON)

`node tools/gate.mjs`:

```json
{"fps":24.1,"calls":216,"triangles":490394,"geometries":185,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":9.08,"fpsCapacity":110.2,"seconds":10,"mode":"headless"}
```

`node tools/gate.mjs --headed`:

```json
{"fps":60,"calls":216,"triangles":490398,"geometries":185,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":8.47,"fpsCapacity":118,"seconds":10,"mode":"headed"}
```

The ≥55 fps requirement applies to headed play and passes. Headless cadence remains below 55 on this host; the raw result is retained rather than substituted with `fpsCapacity`. The synchronized benchmark measures sim/render cost separately from rAF cadence.

### Density, placement and lifecycle

`node tools/probe_density.mjs` was authored for this pass. It teleports to five points (including the end of the jetty), advances five simulated seconds at each, and reports the **minimum** local moving counts across ten half-second samples. “Moving” means AI speed >0.7 m/s. It checks every active pedestrian/vehicle against building volumes and ground height, nearby prop anchors against buildings/ground, pedestrian walkable bounds, and pairwise pedestrian/vehicle contact shapes. Any failed threshold, placement/contact violation, console error or off-site request fails the process.

Final raw output:

```json
{"point":[32.2,150],"seconds":5,"peds50":18,"movingVehicles120":19,"props60":78,"violations":0,"details":[],"pedContacts":0,"vehicleContacts":0,"active":{"peds":18,"vehicles":34}}
{"point":[-112.5,-160],"seconds":5,"peds50":18,"movingVehicles120":20,"props60":87,"violations":0,"details":[],"pedContacts":0,"vehicleContacts":0,"active":{"peds":18,"vehicles":34}}
{"point":[127.5,-65],"seconds":5,"peds50":18,"movingVehicles120":20,"props60":70,"violations":0,"details":[],"pedContacts":0,"vehicleContacts":0,"active":{"peds":18,"vehicles":34}}
{"point":[150,217],"seconds":5,"peds50":18,"movingVehicles120":23,"props60":59,"violations":0,"details":[],"pedContacts":0,"vehicleContacts":0,"active":{"peds":18,"vehicles":34}}
{"point":[-60,290],"seconds":5,"peds50":18,"movingVehicles120":12,"props60":24,"violations":0,"details":[],"pedContacts":0,"vehicleContacts":0,"active":{"peds":18,"vehicles":34}}
{"test":"lifecycle","simulatedSeconds":245,"before":{"peds":18,"vehicles":34},"after":{"peds":18,"vehicles":34},"minPeds50":18,"minMoving120":12,"resourcesBefore":{"objects":15,"geometries":223,"textures":39},"resources":{"objects":15,"geometries":223,"textures":39},"gunfireReacted":17,"chaseReacted":17}
{"consoleErrors":0,"offsiteRequests":0,"pass":true}
```

Lifecycle covers twelve resets with five seconds of simulation each, 180 further seconds sampled every five seconds, then another reset and five seconds. Counts return to 18/34, with identical scene-root object, GPU geometry and texture counts before/after the final reset. GPU counts can rise during the initial district tour as previously unseen static cells upload; all static cells and instance capacities are allocated once. No entity count growth occurs.

Tool API additions: `.population()` returns real agents/props/contact data; `.teleport(x,z,reset)` stops the loop and relocates through the real spawn/population systems; `.advance(seconds)` executes fixed 60 Hz updates and draws once; `.ground()` / `.walkable()` support independent placement checks. `.resume()` restores interactive play.

### Screenshots and determinism

`node tools/shots.mjs` now captures six 1280×720 JPEGs. All six SHA-256 hashes matched across two consecutive runs. `05` and `06` use a close observation camera on actual simulated pedestrians; they were visually reviewed at full image size and are readable when reduced. Original four views remain available. Maximum across these six views, including the shadow refresh frame: **344 calls / 584,092 triangles**; no console errors. `stage()` reports the maximum of its two draw frames so cached-shadow captures do not understate the budget.

```json
{"file":"screenshots/01-waterfront-dusk.jpg","quality":88,"bytes":157647,"calls":334,"triangles":584092,"player":[146.1,221.5]}
{"file":"screenshots/02-avenue-crossing.jpg","quality":88,"bytes":154482,"calls":215,"triangles":511976,"player":[32.2,121.7]}
{"file":"screenshots/03-harbour-jetty.jpg","quality":88,"bytes":132625,"calls":155,"triangles":215888,"player":[-60,289.8]}
{"file":"screenshots/04-downtown-sprint.jpg","quality":88,"bytes":151557,"calls":294,"triangles":456331,"player":[-32.2,44.3]}
{"file":"screenshots/05-pavement-life.jpg","quality":88,"bytes":148771,"calls":344,"triangles":553326,"player":[32.2,150]}
{"file":"screenshots/06-market-walkers.jpg","quality":88,"bytes":131275,"calls":257,"triangles":374840,"player":[-112.5,-160]}
```

- `screenshots/05-pavement-life.jpg`: close pavement walker, second pedestrian down the sidewalk, coloured cars and shop awnings.
- `screenshots/06-market-walkers.jpg`: three clearly separated pedestrians beside the illuminated liquor-store arcade.

No commit, push or submission was performed.


## PASS 4 — police, wanted, combat

Run as before (`node main.ts`). Still offline, vendored three.js only, no new dependencies; tools are Node 22 stdlib over raw CDP.

### What is in the game

- **Wanted 0–5** (`police/wanted.js`). Heat 0–100 with star thresholds 0.01 / 20 / 45 / 70 / 95. Crimes add heat and set the last-reported position: hitting a car with the player's car +5, hitting a pedestrian +19, each shot +4, ramming a cruiser +24 (a 1.1 s cooldown per kind, except shots). Heat decays at 4/s once no unit or the helicopter has seen the player for 9 s, and resets at 0. The HUD stars, SPOTTED / SEARCHING tag, health, money and ammo come from the live values every frame (`hud.playerStatus`).
- **Police state machine** (`police/police.js`): patrol → detect → investigate → pursue / intercept → search → lose → return → patrol. Each unit is a real cruiser on the road graph, driven by the same `TrafficDriver` and vehicle dynamics as traffic. One unit at wanted 1–2, a second at 3+, a third at 4+. Line of sight is a ray against the collision world (54 m). Unseen for 2.6 s → search (sweeping offsets around the last sighting). Search runs 9 s, then lose and return. Pursuing units ignore signals, cut corners at junctions (`cutCorners` tightens the turn curve), and lead the target when intercepting. At wanted 3+ a unit that sees the player's car rams it (steers straight at it and drops it from its follow corridor). Against a player on foot, the cruiser stops nearby and an officer gets out on the side facing the player, walks round obstacles and arrests within 1.35 m.
- **New driving for police (this pass)**:
  - three-point turns when turning back is clearly shorter than driving on to the next junction;
  - overtaking: first squeezing between traffic that has pulled over on both sides, otherwise straddling the centre line;
  - pushing through a civilian that has held a siren unit up for 1.5 s (≤ 4 m/s, contact physics shoves it aside);
  - dispatch spawns units behind a moving target, travelling the same way.

  Before this, the first unit spawned head-on, passed the player and drove off round a block (probe distance grew to 134 m while "pursuing").
- **Traffic fixes found while testing the chase** (`vehicles/traffic.js`; these change PASS 3 behaviour):
  - left-turners yield to oncoming traffic;
  - a deadlock breaker: after 2.5 s waiting, if a ring of cars all wait on each other, the lowest id backs off;
  - civilians pull ~1.1 m towards the kerb and stop for a siren closing from behind or head-on.

  The 20 s chase used to freeze in a three-car deadlock at the harbour T-junction.
- **Helicopter** (`police/visuals.js`) at wanted 4+: model built from primitives, spinning main and tail rotors, a lazy 24 m orbit that eases towards the last sighting, an additive searchlight cone and ground pool, and a descent from 78 m to 41 m (always ≥ 9 m above the roofs below) while it has the player in sight. It counts as a spotter for heat decay.
- **Sirens and lights**: alternating red/blue light bars on responding cruisers, plus a tinted additive pool on the road that flashes with them. Three siren voices (Web Audio) wail, pan by bearing, attenuate with distance (`0.23 / (1 + (d/22)²)`) and Doppler-shift with closing speed.
- **Arrest and damage**: arrest → ARRESTED screen, fine `15 × stars + 10`, wanted cleared, release after 2.6 s at the nearest clear safe point with full health. Rammed by a siren cruiser above 6 m/s, in a car or on foot: up to 46 / 42 damage, then 0.55 s of immunity. Death → WASTED, lose up to $25, respawn at the nearest safe point.
- **Combat** (`player/combat.js`): pistol (RMB or Q to aim, LMB or X to fire, R to reload). 10-round magazine, 30 in reserve, 18 damage, 75 m range, 0.18 s between shots, 1.35 s reload. Recoil kicks the camera and the arms, and there's a muzzle flash and a shot sound. The camera ray is re-traced from the muzzle so you can't shoot round corners. Hits on pedestrians (four body spheres), officers on foot and cruiser bodies, with hit reactions (stagger, then down at 0 hp for pedestrians; officers flinch). Each shot is a crime and a gunfire event for the crowd. Five ammo pickups (+12, 45 s respawn).

### Tool API added

`forceWanted(n)`, `status()` (wanted, heat, hp, money, incident, units with state, distance, hp, hit timer, wall/kerb overlap, hard-stop count, three-point turns; helicopter; combat), `probeStep({steps, move, shot, reload, drawFrame})`, `aimClear`, `exposed(x,z)` (would any unit see a player here), `sightline(ax,az,bx,bz)`, `debugUnits()`, `debugCar(id)`. `tools/gate.mjs --wanted N` forces a wanted level during the gate drive.

### Probes (raw output, final build)

`node tools/probe_police.mjs`: the hero car (AI chauffeur standing in for the player, heading south down the x = 40 avenue) is forced to wanted 3 and the real simulation runs for 20 s at a fixed 60 Hz. The probe then "hides" the player on foot at the nearest pavement spot 45–110 m away that is out of sight both of the units and of every road point within 70 m of them. The teleport is a staging shortcut; police keep their state and last sighting. Wall and kerb overlap are checked for every cruiser on every tick, after collision resolution.

```json
{"forced":3,"chaseSeconds":20,"unitsSpawned":2,"pursuing":2,"concurrent":2,"distances":[{"t":2,"at":[38.3,174.1],"units":[[34,65,"pursue"],[35,58,"investigate"]]},{"t":4,"at":[38.5,191.4],"units":[[34,60.7,"search"],[35,70.7,"investigate"]]},{"t":6,"at":[39.3,193.8],"units":[[34,35,"pursue"],[35,70.6,"investigate"]]},{"t":8,"at":[40.8,196.7],"units":[[34,15.2,"pursue"],[35,62,"investigate"]]},{"t":10,"at":[40.8,196.7],"units":[[34,12.4,"pursue"],[35,37.8,"pursue"]]},{"t":12,"at":[39.8,195],"units":[[34,8.8,"pursue"],[35,17.1,"pursue"]]},{"t":14,"at":[41.6,197.4],"units":[[34,11.3,"pursue"],[35,17.4,"pursue"]]},{"t":16,"at":[41.7,197.5],"units":[[34,9.4,"pursue"],[35,16.8,"pursue"]]},{"t":18,"at":[42,197.8],"units":[[34,9.1,"pursue"],[35,15.2,"pursue"]]},{"t":20,"at":[43.5,199],"units":[[34,10.2,"pursue"],[35,16.2,"pursue"]]}],"minDistance":{"34":8.7,"35":14.9},"turnabouts":[[34,1],[35,0]],"hardStops":[[34,1],[35,0]],"beforeHide":{"level":3,"seen":true,"incident":null},"hiddenAt":[112.5,180],"hideDistance":71.5,"seenWhileHiddenFrames":0,"lostChaseSeconds":11.62,"clearedSeconds":22.98,"wallFrames":0,"kerbFrames":0,"states":[["patrol","detect","investigate","pursue","search","lose","return"],["patrol","detect","investigate","search","pursue","intercept","lose","return"]],"end":{"wanted":0,"seen":false,"incident":null},"consoleErrors":0,"offsiteRequests":0,"pass":true}
```

How to read it: penetrations are 0. The cruiser hard stop (a move that would overlap a wall or kerb is rolled back) fired once, during unit 34's three-point turn, so the 0 is partly enforced by that mechanism. Both units reached pursue at the same time. The chase was lost 11.6 s after hiding and the stars cleared at 23.0 s (target ≤ 45 s). From t = 6 s the chauffeur sits in harbour-front traffic, waiting for a gap to turn left, and both units close to 9–17 m and hold there. Unit 34 can't reach the car because a civilian queues between them right at the junction (no overtaking within 6 m of a junction).

`node tools/probe_combat.mjs` fires 10 rounds through the real `Combat.fire` path at the nearest pedestrian in clear sight, reloads, shoots a cruiser, then stands on a pickup:

```json
{"rounds":[{"aim":1,"hit":{"kind":"pedestrian","id":1,"damage":18},"ammo":9},{"aim":1,"hit":{"kind":"pedestrian","id":1,"damage":18},"ammo":8},{"aim":1,"hit":{"kind":"pedestrian","id":1,"damage":18},"ammo":7},{"aim":1,"hit":{"kind":"pedestrian","id":1,"damage":6},"ammo":6},{"aim":12,"hit":{"kind":"pedestrian","id":12,"damage":18},"ammo":5},{"aim":12,"hit":{"kind":"pedestrian","id":12,"damage":18},"ammo":4},{"aim":12,"hit":{"kind":"pedestrian","id":12,"damage":18},"ammo":3},{"aim":12,"hit":{"kind":"pedestrian","id":12,"damage":6},"ammo":2},{"aim":6,"hit":{"kind":"pedestrian","id":6,"damage":18},"ammo":1},{"aim":6,"hit":{"kind":"pedestrian","id":6,"damage":18},"ammo":0}],"shots":10,"hits":10,"damageApplied":156,"ammoBefore":10,"ammoAfter":0,"ammoAfterReload":10,"reserveBefore":30,"reserveAfter":20,"reloadSeconds":1.35,"heatBefore":0,"heatAfter":40,"wantedAfter":2,"shotFrame":{"recoil":0.049,"flash":true},"policeShot":{"unit":34,"hit":{"kind":"cruiser","id":34,"damage":18},"hpBefore":100,"hpAfter":82,"reacting":true},"pickup":{"reserveBefore":20,"reserveAfter":32},"consoleErrors":0,"offsiteRequests":0,"pass":true}
```

The 6-damage rounds finish a pedestrian at 60 hp (18 × 3 + 6), and the next round goes to the next target. Heat +40 = 10 × 4, which is wanted 2.

Extra check (dev script, not a committed tool), `teleport(32.2,150)` + `forceWanted(4)` on foot: 3 units and the helicopter were active, and it spotted the player on the first tick. An officer got out on the player's side and made the arrest at 7.5 s (money 250 → 180 = 4 × 15 + 10), with release at 10.1 s, 100 HP, 0 errors. Before the officer pathing fix, an officer who got out on the far side of the cruiser froze against it for 40 s.

`node tools/probe_density.mjs` (PASS 3 regression check after the traffic changes): passes. Minimum moving cars within 120 m are 18 / 20 / 16 / 20 / 12 at the five points (PASS 3: 19 / 20 / 20 / 23 / 12; left-turners now wait for gaps), lifecycle 18/34 → 18/34, no resource growth, 0 errors.

### Gate (raw lines)

`node tools/gate.mjs` / `--headed` (standard gate drive, wanted 0):

```json
{"fps":24.7,"calls":170,"triangles":500142,"geometries":157,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":8.82,"fpsCapacity":113.4,"seconds":10,"mode":"headless"}
{"fps":60.1,"calls":171,"triangles":500144,"geometries":157,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":7.53,"fpsCapacity":132.8,"seconds":10,"mode":"headed"}
```

`node tools/gate.mjs --wanted 4` / `--headed --wanted 4` (3 cruisers with light bars and pools, helicopter):

```json
{"fps":26.3,"calls":221,"triangles":417305,"geometries":193,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":9.05,"fpsCapacity":110.5,"seconds":10,"mode":"headless","wanted":4,"units":3,"sirens":3,"helicopter":true}
{"fps":60.1,"calls":221,"triangles":417457,"geometries":193,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":7.5,"fpsCapacity":133.4,"seconds":10,"mode":"headed","wanted":4,"units":3,"sirens":3,"helicopter":true}
```

No budget regression against PASS 3 (216 calls / 490k triangles): max 221 calls (< 500) and 500k triangles (< 900k). Headed is 60.1 fps (≥ 55). Headless is still capped by this host's headless Chrome (load average 3–5 during the run), as in earlier passes; frame cost is 7.5–9 ms. 0 errors and 0 off-site requests everywhere.

### Screenshots / determinism

`node tools/shots.mjs` was run twice: all six SHA-256 hashes matched between the runs. The images differ from the PASS 3 set because the traffic changes move the cars. Max per staged view: 346 calls / 584,128 triangles.

### Known limits

- The police probe's fugitive is an AI chauffeur. It obeys traffic, so the 20 s chase is mostly a jam at the harbour junction rather than a high-speed run. In dense traffic, units still lose time to queues, especially within 6 m of junctions where they don't overtake.
- A three-point turn takes 5–7 s when parked cars are close.
- Units are never removed after a chase; they go back to patrolling the grid (cap of 3).
- Officers only get out against a player on foot; there's no "busted while sitting in a stopped car".
- Release after an arrest uses the nearest safe point (there is no police station yet).
- Debug hooks `debugUnits`/`debugCar` and the per-car `blocked` counter remain in the build as tool API.

No commit, push or submission was performed.

## PASS 17 — Opus review and repair

Full audit, method and raw lines: `tools/REVIEW.md`. New probe: `node tools/probe_review.mjs`.
"Before" is the PASS 4 code copied aside before any edit (plus read-only tool hooks); the same probe runs on both.

### Fixed (before → after)

| Defect | Before | After |
|---|---|---|
| Stolen police cruiser stayed a unit (`driving.js` / `police.js`) | its own car saw the driver 2400/2400 frames, wanted could not decay | detached, 0 frames, replacement unit dispatched |
| Cruiser light bar: model bar dead (negative `%`, `sirenOn` never set) + duplicate floating bar | lit 0, floating 1 | lit 1, floating 0 (scene objects 33 → 30) |
| `police.lastSeen` survived wanted reset | (32.2, 150) | null |
| View ray traced from the camera hit pedestrians behind the shooter (`combat.js`) | 3/3 hits behind | 0/3 |
| Pedestrian limbs pivoted at their centres, feet slid, idle frozen (`crowd.js`) | hip detach 0.268 m, foot slip 1.174 m/s, idle moving 3 % | 0.009 m, 0.049 m/s, 97 % |
| District label never updated (`hud.js`) | "Downtown" on jetty / waterfront | Harbour Jetty / Waterfront |
| No minimap | — | rotating 2D-canvas minimap (city pre-drawn from `layout`), police blips, search area |
| `probe_density` pedestrian count true by construction | passed with 0 peds on screen | asserts moving ≥ 8 (12–16) and best-view ≥ 3 (5–12) |
| `gate.mjs` never judged the budget | exit 0 always | `pass` field, exit 1 on failure |

Checked, not defects: `_track` loop (0 reseats in 110 826 starts), heap churn (2–6 KB/s total), scripted-control
clobber (holds), wanted-4 frame cost (7–9 ms; one 51–62 ms reading was host load: another app at ~195 % CPU, load avg 6–14).

### Final gates (raw)

```json
{"fps":24.7,"calls":171,"triangles":500142,"geometries":158,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":8.7,"fpsCapacity":114.9,"seconds":10,"mode":"headless","pass":true}
{"fps":60,"calls":171,"triangles":500142,"geometries":158,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":7.62,"fpsCapacity":131.2,"seconds":10,"mode":"headed","pass":true}
{"fps":23.4,"calls":221,"triangles":415422,"geometries":192,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":7.06,"fpsCapacity":141.7,"seconds":10,"mode":"headless","wanted":4,"units":3,"sirens":3,"helicopter":true,"pass":true}
{"fps":55.5,"calls":221,"triangles":425168,"geometries":192,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":9.16,"fpsCapacity":109.2,"seconds":10,"mode":"headed","wanted":4,"units":3,"sirens":3,"helicopter":true,"pass":true}
```

The headed wanted-4 run passes at 55.5 under load average 6.6 (60 in the earlier A/B run). `probe_density`,
`probe_combat` and `probe_police` pass; combat and police numbers are identical to PASS 4. `shots.mjs` was run
twice: all six hashes match. The images changed from PASS 4 (minimap, district label, gait).

### Still open

README badge owner `Lolod17` (not verifiable offline). Player charged for a collision a cruiser shoved them into.
Facade repetition, street-edge depth and wet-road reflection are not done. `props60` is still static by construction.
Headless fps is capped by the host. See `tools/REVIEW.md` §7.

No commit, push or submission was performed.

## PASS 5 — missions, story, save

### Starting point

A previous attempt at this pass had left `game/src/missions/{missions,story,marker}.js`, `game/src/save.js`, the HUD panels,
`tools/mission_driver.mjs` and a `tools/probe_missions.mjs` in the tree, undocumented. Run as found, the mission probe completed
**1 of 5**: THE PICKUP stalled at its last objective and every later mission never got a briefing. `probe_save.mjs` did not exist.
This pass kept that structure, fixed what stopped it working (game and tools), rebalanced two missions, and wrote the save probe.

### The five missions (`game/src/missions/missions.js`)

Walk onto the coral contact marker to get the briefing card, then E to start. Each objective has a yellow beam in the world and a pin
on the minimap (clamped to the rim when off-map). Mission cars, hostiles, the truck and watch zones also show on the minimap.
A fail shows a card with the reason; E retries from the contact. Rewards go into `life.money`, the same counter the HUD,
arrests and collisions already use, and are paid on the first completion only (replays pay nothing).

| # | Mission | Gameplay beat (existing systems) | Success | Failure | Reward |
|---|---|---|---|---|---|
| 1 | THE PICKUP | take any car (F; carjack or parked), drive to the old market, stop by the parcel prop | stop at the courier depot with the parcel | out of time (240 s), arrested, wasted | $300 |
| 2 | HOT CARGO | drive the van along Customs Row past two parked-cruiser watch posts; over 12 m/s (43 km/h) inside a 28 m zone raises **wanted 2** through `wanted.force` | reach the Halden warehouse in the van with **wanted 0** | van abandoned (> 50 m), arrested, wasted | $450 |
| 3 | NO WITNESSES | the clerk's grey sedan idles until you are within 30 m (or 30 s pass), then flees on a TrafficDriver route that obeys signals; ramming (contact speed × 6) and tailgating within 11 m (7/s) drain its NERVE meter | nerve 0, sedan stops; get out and take the drive within 45 s | clerk > 150 m away for 5 s, clerk reaches the terminal, drive wipes (45 s), arrested, wasted | $600 |
| 4 | THE ESCORT | a truck drives a fixed route through the industrial blocks; two ambush crews (one from behind and overtaking, one head-on) ram it; ram them back to disable them (hp 60, contact speed × 9) | truck reaches the Halden yard | TRUCK meter 0, more than 110 m from the truck, arrested, wasted | $800 |
| 5 | THE LAST ROUTE | drive round the dock-road corner to the port gate on the harbour road: **wanted 3** plus two Halden hunter sedans. Within 28 m a hunter switches to a direct ram driver (`RamDriver`, same `v.ctrl` path as every AI car). Hits drain the LEDGER meter (min(20, contact speed × 3), 4 s per hunter); a hunter retires after 4 hits; you can ram them back | reach the harbour jetty, then choose 1 / 2 | LEDGER 0 ("Halden's crew took the ledger"), arrested, wasted | $500 (press) / $2500 (deal) |

Collisions with hostile mission cars are not reported as crimes; everything else (other cars, pedestrians, speeding past posts) feeds the
existing wanted system, so a careless run gets real police attention.

### Story spine (`game/src/missions/story.js`)

Told only in short lines: the intro, three-line briefings, mid-mission beats and success lines, all spoken by Marlow (the dispatcher) and a few others.
A night-shift courier picks up what turns out to be a decoy parcel. Halden Maritime's ledger has gone missing. The "concrete" crates in HOT CARGO are
refrigeration units for berths the port expansion is hiding. A clerk's drive holds half the ledger and the truck carries the rest. Locker nine at the port gate
holds the whole ledger, and at the jetty you choose: give it to the harbour press (**THE TIDE TURNS**) or sell it back to Halden (**QUIET WATER**).
Both endings are reached and paid in the probe.

### Save / load (`game/src/save.js`, `main.js`)

`localStorage['breakwater.save']` = `{ v: 1, money, mission (0-5), ending, checkpoint {x,z,yaw}, wanted (heat 0-100), owned {type, paint} | null }`.
Every field is validated: integer ranges, finite numbers, checkpoint inside `CITY.bounds`, vehicle type in `VEHICLE_TYPES`, paint `#rrggbb`,
no ending before the last mission. Anything else (bad JSON, other versions, wrong types) rejects the whole save, the start card says so
and New game starts fresh. Autosave happens on mission success, after a failure card, every 20 s while idle (no mission running), after an incident and on `pagehide`.
The checkpoint is the next mission's contact. Mid-mission state is deliberately not saved: a reload resumes at that mission's contact.
Load rebuilds the seeded world, then lays the save over it. The owned car takes the hero car's slot in the fleet, so the vehicle count is the same as a fresh start.
The start card shows Continue only for a valid save, with "Saved: mission N of 5 · $money".

### Game defects found and fixed this pass

| Defect | Effect | Fix |
|---|---|---|
| `loop.stop()` + `loop.start()` in one tick left the old `requestAnimationFrame` pending (`loop.js`) | after New game / Continue / teleport two frame chains ran: every frame was rendered twice | keep the request id, cancel it on stop/start |
| a failed mission left the car you sat in; retry spawned a second one on the same kerb slot | overlapping cars on retry / replay | `begin()` removes the previous attempt's car (`fromMission`) unless you are in it |
| mission props and police dispatch evict traffic to stay under the 34-car cap; nothing refilled it | the city thinned out mission by mission (34 → 32 after HOT CARGO) | `VehicleManager.refill()` tops the fleet up with traffic 60-108 m away when a mission ends |
| a click anywhere on the start card started a New game | one stray click wiped a save | the card background now continues a valid save; only the New game button resets |
| New game kept the city that had been ticking behind the start card | a fresh start was not the seeded state | New game always rebuilds the seeded world |
| NO WITNESSES clerk started 74 m ahead, ran every red light at 12 m/s and sped up when approached | not catchable in normal traffic | idles until you close in, then flees on a longer route obeying signals at 8.5-11 m/s |
| THE LAST ROUTE: wanted 3 alone was no threat in a car (officers only arrest a player on foot) | "survive the final chase" had no fail state | Halden hunters + LEDGER meter; gate moved off the map-corner junction, which gridlocked |
| the mission clock was not reset with the world | log timestamps (and so `simSeconds`) depended on how many real frames ran before New game; 0.1 s drift under load | `Missions.reset()` zeroes it |
| owned car was only flagged `owned` after a reload | census differed between a session and its reload | flag it at mission success |

Tool-path changes: a scripted driver (`__game.drive`) now still sees the F key, so the bot can get out of a car (the keyboard path is unchanged).
New hooks: `missions()`, `missionLog()`, `missionDefs()`, `tap(code)`, `car()`, `nearby()`, `drive()`, `walk()`, `step()`, `drawNow()`,
`save()`, `readSave()`, `lastSave()`, `continueGame()`, `newGame()`, `entities()`.

### Probes

**`node tools/probe_missions.mjs`**: plays the story in order on the seeded build at fixed 60 Hz. The scripted courier (`tools/mission_driver.mjs`) uses only
what a player uses: throttle/brake/steer/handbrake written where the keyboard writes them, a WASD walk direction, and E / F / 1 / 2 key taps.
It never moves cars or edits mission state. Transitions come from the game's own mission log. Money is read from `life.money` before and after.
A beat sampler reads the live systems every 0.5 s (wanted level, police units in pursue/intercept, nearest hostile car, meters).
NO WITNESSES is deliberately failed once (the courier sits still) and the deal run of THE LAST ROUTE deliberately parks at the gate until the hunters take the ledger,
which exercises both fail → retry paths. THE LAST ROUTE runs twice from the same pre-finale save, once per ending.

```json
{"missions":[{"mission":"pickup","ok":true,"attempts":1,"failures":[],"moneyBefore":250,"moneyAfter":550,"transitions":["briefing:pickup","started","objective:0","objective:1","objective:2","success:+300"],"simSeconds":157.1,"beat":{"maxWanted":1,"maxPursuing":1,"closestUnit":3.3}},{"mission":"cargo","ok":true,"attempts":1,"failures":[],"moneyBefore":550,"moneyAfter":1000,"transitions":["briefing:cargo","started","objective:0","objective:1","objective:2","objective:3","objective:4","success:+450"],"simSeconds":87.7,"beat":{"maxWanted":0,"maxPursuing":0}},{"mission":"witness","ok":true,"attempts":2,"failures":["You lost the clerk"],"moneyBefore":1000,"moneyAfter":1600,"transitions":["briefing:witness","started","objective:0","objective:1","clerk-flees","fail:You lost the clerk","retry","objective:0","objective:1","clerk-flees","ram:9.3","objective:2","success:+600"],"simSeconds":80.5,"beat":{"maxWanted":0,"maxPursuing":0,"minNerve":-0.1,"closestHostile":2.8}},{"mission":"escort","ok":true,"attempts":1,"failures":[],"moneyBefore":1600,"moneyAfter":2400,"transitions":["briefing:escort","started","objective:0","objective:1","ambush-wave-1","ambush-wave-2","truck-hit:77","success:+800"],"simSeconds":35.6,"beat":{"maxWanted":0,"maxPursuing":0,"minTruckHp":77.4292272956605,"closestHostile":3}},{"mission":"finale","ok":true,"attempts":1,"failures":[],"moneyBefore":2400,"moneyAfter":2900,"transitions":["briefing:finale","started","objective:0","wanted-3","hunters-2","objective:1","rammed:80","choice","ending:press","success:+500"],"simSeconds":60.1,"beat":{"maxWanted":3,"maxPursuing":0,"minLedger":80,"closestHostile":2.9},"ending":"press"},{"mission":"finale","ok":true,"attempts":2,"failures":["Halden's crew took the ledger"],"moneyBefore":2400,"moneyAfter":4900,"transitions":["briefing:finale","started","objective:0","wanted-3","hunters-2","objective:1","rammed:80","rammed:65","rammed:45","rammed:25","hunter-spent","rammed:8","rammed:0","fail:Halden's crew took the ledger","retry","objective:0","wanted-3","hunters-2","objective:1","hunter-shaken","choice","ending:deal","success:+2500"],"simSeconds":222,"beat":{"maxWanted":3,"maxPursuing":2,"closestUnit":3.3,"minLedger":8,"closestHostile":2.7},"ending":"deal"}],"notCompleted":[],"endings":["press","deal"],"failThenRetry":true,"ledgerFailThenRetry":true,"consoleErrors":0,"offsiteRequests":0,"pass":true}
```

Runs are byte-identical: two back-to-back runs, and a run made while `probe_save` used the machine at the same time, printed the same line. THE ESCORT passed on the first attempt in the final build. In earlier builds the bot sometimes
fell more than 110 m behind and passed on retry: the bot is a careful lane-following driver, not a perfect one.
The press run took one ram (LEDGER 80) and police never caught it (maxPursuing 0). In the deal run, two units pursued and the hunters drained the ledger to 0 on the parked attempt.
`--only N`, `--demo`, `--upto N` and `TRACE=1` are dev shortcuts, not used for the pass line.

Extra check (dev script, not a committed tool): HOT CARGO driven at 17 m/s through the first watch post produced `watch-post-tripped` at 12 m/s in the zone, wanted 2,
and the last objective switches to "Lose the police before the drop". The probe's courier keeps under the limit, so the probe itself never trips a post.

Tool fixes needed to get here (in `mission_driver.mjs`): the planner chose U-turns the pilot cannot drive (turning back now costs 2000 m, so it loops round the block),
replanning reset the manoeuvre timers, the "oncoming lane clear?" test looked at the kerb side (lateral sign flipped), and reversing used the same lock as driving forward,
so K-turns cancelled out. Also added: abandon an overtake when something comes the other way, back out of a gridlocked junction box after 6 s, and wait at most 5 s at a junction.

**`node tools/probe_save.mjs`**: through the real start card (no `?autostart`), with real CDP mouse clicks. Fresh profile → New game → play THE PICKUP (autosaves) →
force wanted 2 and save → reload → Continue → load again in the same session → play HOT CARGO from the loaded game → reload → Continue → 13 corrupt saves.

```json
{"steps":{"fresh":{"continueShown":false,"info":"","save":{"none":true},"started":{"started":true,"cardHidden":true}},"played":{"pickup":{"ok":true,"transitions":["briefing:pickup","started","objective:0","objective:1","objective:2","success:+300"],"moneyBefore":250,"moneyAfter":550},"autosaved":{"reason":"mission","ok":true,"error":null,"at":233.58},"saved":{"v":1,"money":550,"mission":1,"ending":null,"checkpoint":{"x":-112.2,"z":172,"yaw":3.141592653589793},"wanted":21,"owned":{"type":"suv","paint":"#d8d9db"}},"before":{"money":550,"mission":1,"ending":null,"owned":{"type":"suv","paint":"#d8d9db"},"heat":21,"wanted":2,"phase":"idle","player":{"x":-121.75,"z":186.42,"driving":true},"entities":{"sceneObjects":32,"vehicles":34,"ownedCars":1,"missionCars":0,"peds":18,"policeUnits":1,"missionEntities":0,"markers":2,"geometries":134,"textures":39}}},"reloaded":{"card":{"continueShown":true,"info":"Saved: mission 2 of 5 · $550","save":{"data":{"v":1,"money":550,"mission":1,"ending":null,"checkpoint":{"x":-112.2,"z":172,"yaw":3.141592653589793},"wanted":21,"owned":{"type":"suv","paint":"#d8d9db"}}}},"after":{"money":550,"mission":1,"ending":null,"owned":{"type":"suv","paint":"#d8d9db"},"heat":21,"wanted":2,"phase":"idle","player":{"x":-112.2,"z":172,"driving":false},"entities":{"sceneObjects":32,"vehicles":34,"ownedCars":1,"missionCars":0,"peds":18,"policeUnits":1,"missionEntities":0,"markers":2,"geometries":293,"textures":39}},"censusDiff":[]},"loadedTwice":{"again":{"money":550,"mission":1,"ending":null,"owned":{"type":"suv","paint":"#d8d9db"},"heat":21,"wanted":2,"phase":"idle","player":{"x":-112.2,"z":172,"driving":false},"entities":{"sceneObjects":32,"vehicles":34,"ownedCars":1,"missionCars":0,"peds":18,"policeUnits":0,"missionEntities":0,"markers":2,"geometries":293,"textures":39}},"censusDiff":[]},"continued":{"cargo":{"ok":true,"failures":[],"transitions":["briefing:cargo","started","objective:0","objective:1","objective:2","objective:3","objective:4","success:+450"],"moneyBefore":550,"moneyAfter":1000},"card":{"continueShown":true,"info":"Saved: mission 3 of 5 · $1000","save":{"data":{"v":1,"money":1000,"mission":2,"ending":null,"checkpoint":{"x":112.2,"z":-108,"yaw":0},"wanted":0,"owned":{"type":"van","paint":"#f2f2ee"}}}},"beforeTwo":{"money":1000,"mission":2,"ending":null,"owned":{"type":"van","paint":"#f2f2ee"},"heat":0,"wanted":0,"phase":"idle","player":{"x":184.15,"z":-118.25,"driving":true},"entities":{"sceneObjects":32,"vehicles":34,"ownedCars":1,"missionCars":0,"peds":18,"policeUnits":1,"missionEntities":0,"markers":2,"geometries":293,"textures":39}},"afterTwo":{"money":1000,"mission":2,"ending":null,"owned":{"type":"van","paint":"#f2f2ee"},"heat":0,"wanted":0,"phase":"idle","player":{"x":112.2,"z":-108,"driving":false},"entities":{"sceneObjects":32,"vehicles":34,"ownedCars":1,"missionCars":0,"peds":18,"policeUnits":0,"missionEntities":0,"markers":2,"geometries":190,"textures":39}},"censusDiff":[]},"corrupt":{"bad JSON":{"rejected":"unreadable JSON","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"wrong version":{"rejected":"unsupported version 99","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"no version":{"rejected":"unsupported version undefined","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"money as string":{"rejected":"money","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"negative money":{"rejected":"money","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"mission out of range":{"rejected":"mission","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"checkpoint off the map":{"rejected":"checkpoint","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"checkpoint missing":{"rejected":"checkpoint","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"unknown vehicle":{"rejected":"owned vehicle","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"wanted NaN (null)":{"rejected":"wanted","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"ending before finale":{"rejected":"ending before the last mission","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"null":{"rejected":"not an object","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0},"array":{"rejected":"not an object","continueShown":false,"info":"Save data was damaged and has been ignored. Starting fresh.","newGame":true,"saveCleared":true,"errors":0}}},"checks":{"freshNoSave":true,"newGameStarted":true,"pickupPassed":true,"autosavedOnSuccess":true,"saveHoldsState":true,"continueOffered":true,"continueStarted":true,"moneyMatches":true,"missionMatches":true,"ownedMatches":true,"wantedMatches":true,"atCheckpoint":true,"censusMatches":true,"secondLoadNoDuplicates":true,"playAfterLoad":true,"secondReloadCarries":true,"corruptSavesHandled":true},"consoleErrors":0,"offsiteRequests":0,"pass":true}
```

Before → after reload (from the line above): money 550 → 550, mission 1 → 1, owned suv → suv, heat 21 → 21 (wanted 2 → 2), player at the checkpoint, census
`{sceneObjects 32, vehicles 34, ownedCars 1, missionCars 0, peds 18, markers 2, missionEntities 0}` identical. Loading a second time in the same session changes nothing, GPU geometries and textures included.
Across a reload the GPU geometry count is *not* compared: it counts geometry uploaded on first draw, so it depends on what the camera has seen
(134 in the session that played, 293 after the start card's view). Police units are not compared either: dispatch depends on how many frames ran before the first sample.
Each corrupt save boots with 0 errors, hides Continue, shows "Save data was damaged…", and New game runs at $250, mission 1.

### Gate (raw lines, final build)

`node tools/gate.mjs` / `--headed` / `--wanted 4` / `--headed --wanted 4` on the final build (load average 12.3-12.7 during the runs):

```json
{"fps":21.2,"calls":175,"triangles":500972,"geometries":160,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":7.31,"fpsCapacity":136.9,"seconds":10,"mode":"headless","pass":true}
{"fps":58.3,"calls":175,"triangles":500976,"geometries":159,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":11.67,"fpsCapacity":85.7,"seconds":10,"mode":"headed","pass":true}
{"fps":22.9,"calls":225,"triangles":418137,"geometries":194,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":11.05,"fpsCapacity":90.5,"seconds":10,"mode":"headless","wanted":4,"units":3,"sirens":3,"helicopter":true,"pass":true}
{"fps":60.1,"calls":225,"triangles":426000,"geometries":194,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":7.71,"fpsCapacity":129.7,"seconds":10,"mode":"headed","wanted":4,"units":3,"sirens":3,"helicopter":true,"pass":true}
```

+3 to +4 calls against PASS 17 (mission beam, ring, parcel). Headed fps 58.3 and 60.1 (≥ 55); max calls 225 (< 500) and 501k triangles (< 900k); 0 errors; 0 off-site requests. Headless fps is still this host's
headless rAF cap (frame cost 7-12 ms under that load, 83-137 fps capacity), as in every earlier pass. Ten minutes earlier, one build
step before (only the mission-clock reset and the `drawNow` hook differ), at load 8.5: headless 25.2 / headed 59.9 / wanted-4 headless 21.6 / headed 59.9, same calls and triangles.

### Regression and determinism

`probe_police`, `probe_combat` and `probe_density` pass. `probe_review` prints the same AFTER lines as `tools/REVIEW.md` §4. `shots.mjs` was run twice:
all six SHA-256 hashes matched between the runs. The images differ from PASS 17 because the HUD now shows the next mission and the contact beam is in view.

### Known limits

- Mid-mission progress is not saved; a reload restarts the current mission from its contact.
- The finale's `RamDriver` leaves the lanes inside 28 m (it steers straight at the car), which is intended but can look abrupt; hunters hand back to lane driving beyond 45 m.
- The probe's courier is cautious and only lane-follows. Before the tool fixes above it failed THE ESCORT and NO WITNESSES in some traffic states. Difficulty for a human player was not measured; the tuning numbers are in the mission table.
- Watch posts are parked cruisers with zones, not units; tripping one uses the normal wanted response.

No commit, push or submission was performed.

## PASS 6c — facades and skyline (visual only)

Files: `world/facadeDepth.js` (new), `world/materials.js` (hooks it onto the 4 facade materials), `world/buildings.js`, `world/skyline.js`, `world/farcity.js`.
All new variation comes from position hashes, not the seeded RNG, so the city layout, colliders and missions are the same as before.

- **Recessed windows**: a parallax pass on the facade shaders. Glass texels (low roughness in the surface map) are sampled where the view ray lands 0.14–0.38 m inside the wall. Rays that hit wall first are drawn as a dark reveal (jamb/head/sill) with no window light, and glass next to a reveal gets a contact shadow. No geometry and no draw calls. It applies to downtown and the outer ring, and fades out past 180–320 m.
- **Facade variants**: two kit treatments per style, 8 in total: glass with floor caps or a fin grid; brick with lintels and AC or with paired pilasters and a plinth; concrete ribbons with AC or with deep sun fins; stucco with balconies or with hooded windows and corner quoins. Tint gets a small HSL jitter. Count per district (`__game.stats.variants`): core 7, midtown 8, waterfront 6.
- **Depth details**: neon fascia letters now stand on a dark raceway box. Brick buildings and the second variant of every style get a two-step projecting cornice, and every parapet has an overhanging coping. Kit parts are instanced and range-limited (`facade-kit`, 1 call, no shadow pass); cornices and coping go into the merged trim.
- **Outer ring**: roof cornice/coping bands, a string course over the shops on brick and stucco, and set-back penthouses on taller blocks.
- **Far city**: setback tiers and spires. The shader paints a window pattern per building (punched, office ribbons lit floor by floor, glass grid, warm residential) with per-building light share and colour temperature. It also adds lit crown bands, a sun-side rim, street glow at the base and lighter fog, so towers read as lit volumes instead of cards. Still 1 draw call.

Gate (`node tools/gate.mjs --headed --seconds=20`), before → after:
```
{"fps":59.7,"calls":228,"triangles":600156,"geometries":183,"textures":40,"consoleErrors":0,"offsiteRequests":0,"frameMs":9.62,"fpsCapacity":104,"seconds":20,"mode":"headed","pass":true}
{"fps":58.6,"calls":228,"triangles":650936,"geometries":183,"textures":40,"consoleErrors":0,"offsiteRequests":0,"frameMs":8.5,"fpsCapacity":117.6,"seconds":20,"mode":"headed","pass":true}
```
`probe_visuals --headed`: max 365 calls / 787,307 triangles (traffic and line-up views), pass. Screenshots in `screenshots/` were not regenerated this pass.

## PASS 10c — car customisation, 8 categories (visual)

Files: `econ/customs.js` (new: catalogue, ids and prices), `econ/garage.js` (extended: `custom` field on each vehicle, `active` link to the street car,
`adopt`, `setActive`, `active`, `customPrice`, `customise`, `reset`; older saves without these fields load with factory defaults),
`vehicles/customParts.js` (new: record → look, bolt-on geometry, per-type mounting points), `vehicles/vehicleMaterial.js` (finish / tint /
headlight / livery in the shared vehicle shader), `vehicles/vehicleRenderer.js`, `garageMenu.js` (new: site, menu, turntable), `main.js`, `style.css`.
`wallet.js`, `shop.js`, `save.js` are untouched (called only).

- **Site**: no garage interior exists, so the shop is at door `door-3-4-0-0` (x 63, z 130): roller door, neon sign, a turntable in the kerb lane (2 draws when in view).
  Stop a car on it, G opens the menu (not during a mission, with a wanted level, or in a cruiser). The sim pauses, the car turns under a fixed camera,
  the player's spotlight becomes the key light, other cars within 7.5 m are not drawn.
- **Categories**: paint (12 colours × gloss / matte / metallic / pearl), wheels (factory + 8 designs from `WHEEL_STYLES`), spoiler (none / lip / wing / GT),
  bumpers & splitters (factory / splitter / sport kit / track kit), ride height (raised +5 / lowered −4 / slammed −8 cm), tint (clear / 35 / 15 / 5 %),
  lights (5 headlight colours, 6 underglow states), livery (5 designs × 6 colours). Engine / brakes / grip / suspension levels from `garage.js` are shown.
- **Cost**: finish, tint, headlight colour and livery are two more instance attributes on the existing body draw (all-zero = factory, so traffic is unchanged).
  Wheels reuse the per-style instanced meshes. Bolt-ons are one shared instanced mesh per part (8 parts) plus one underglow mesh, hidden unless a car
  wearing them is within 90 m. No per-frame allocation.
- **Money**: purchases call `garage.customise` → `wallet.spend` at the catalogue price. The gameplay balance (`life.money`) is reconciled into the wallet
  on entry and read back after each purchase, so the HUD, the wallet and the save agree.
- **Save**: the customised car becomes the owned car; leaving the garage autosaves. `garage_vehicles.active` names its record, and Continue dresses the
  restored car from it.

`node tools/probe_custom.mjs` (headless; `--shots DIR` saves JPEGs): G on the bay opens the menu; $520 track kit refused at $250 with nothing charged or fitted;
then one option per category: every purchase charged exactly its price and changed the drawn car (iPaint, iCustom, iLivery, the `dish6` wheel mesh,
the `spoilerGT` / `splitterTrack` / `skirts` / `diffuserFins` meshes, body y −0.08 m, underglow count, spotlight colour); unbought previews revert; the street car
matches the menu; after reload + Continue the owned car has the same paint, look, drawn attributes, parts and balance. Menu frame 225 calls / 722k triangles,
street 218 / 641k. 0 console errors, `pass: true`.

Gate `node tools/gate.mjs --headed --seconds=20`, before → after:
```
{"fps":60,"calls":272,"triangles":783988,"geometries":220,"textures":40,"consoleErrors":0,"offsiteRequests":0,"frameMs":11.06,"fpsCapacity":90.4,"seconds":20,"mode":"headed","pass":true}
{"fps":60,"calls":273,"triangles":784552,"geometries":221,"textures":40,"consoleErrors":0,"offsiteRequests":0,"frameMs":11.1,"fpsCapacity":90.1,"seconds":20,"mode":"headed","pass":true}
```
Regression: `probe_garage`, `probe_save`, `probe_save2`, `probe_wallet`, `probe_shop`, `probe_inventory`, `probe_cars`, `probe_visuals` pass.
Known limits: performance upgrades are shown but not sold here, and `handlingFor` is still not applied to driving (unchanged from before). Spoilers mount
on the measured rear deck, which on vans, SUVs and trucks is the roof.

## PASS 7 — HUD, minimap, title screen, radio, feedback

New: `ui/title.js` (menu focus/keyboard + title camera drift), `ui/feedback.js` (cues + sounds), `audio/radio.js` (stations + code-synthesised loops),
`tools/probe_ui.mjs`. Changed: `index.html`, `style.css` (HUD/title/loading rewritten; customs section kept), `hud.js`, `main.js`, `env/time.js`
(day counter + `reset()`), `save.js` (clock section accepts an optional integer `day`; older saves without it still load), `debug.js` (`marketFoot` shot), `tools/shots.mjs`.

- **HUD** in four groups. **Objective** (top-left): mission title + objective, with a gold edge. **Status** (top-right): `DAY n` + clock from `env/time.js`
  (the saved clock; it used to be `simTime`), five wanted stars (outlined when empty, amber when filled), a health bar with its number, and money at 28 px.
  **Map** (bottom-left). **Vehicle** (bottom-right): radio station / frequency / "title — artist", car name, speed at 54 px, and gear on a cyan chip with the rev bar.
  On foot this group shows `PISTOL mag / reserve` while armed (aiming, reloading, or within 6 s of a shot). Key hints sit bottom-centre and fade 7 s after each foot/car switch.
- **Minimap**: one canvas, 100 × 100 px CSS (200 px backing store), circular, `3px solid #00E6FF`, drop shadow plus a faint cyan glow, 24 px from the bottom-left corner.
  High-contrast palette: light roads, near-black lots, saturated water. It rotates with the **player's heading** (the car's when driving), so the bold white
  arrow, drawn last, always points up. The view radius is 120 m, widening to 190 m with speed. Mission pins are 28 px diamonds with a dark outline and a
  pulsing ring, clamped to the rim when far away. The district label sits beside the map at 17 px / 800 on a dark plate.
- **Title screen**: the live city renders behind it. The camera sits on the waterfront promenade at sunset, with a 48 s eased dolly plus sway
  (`titleCamera`). Every 13 s a car (cycling sports / sedan / SUV / sports) drives up the waterfront street past the camera into the frame.
  The player is hidden and takes no input. A left gradient covers about a third of the screen. The logo is 68 px / 800 with amber → deep-orange gradient
  text, a glow and −0.025em tracking. Beneath it: `THE LAST ROUTE` in cyan between two fading rules, and two lore lines. Rows: `CONTINUE  DAY n — $m`
  (only with a valid save) and `START NEW STORY`, dark translucent with a blurred backdrop and a 4 px cyan bar. Mouse hover and keyboard focus are one state
  (Up/Down or W/S, Tab, Enter/Space); focus widens the bar to 6 px with a glow, nudges the row 6 px, loosens the label tracking and shows a chevron,
  all over 220 ms. Without a save, Continue is hidden and a note says why. Controls block bottom-left: orange header, light keycaps in one grid column.
  Footer: build version · seed · live day and clock · navigation hint.
  Type scale: 1.25 steps from 14 px (11 / 14 / 17 / 22 / 28, logo 68). Tracking loosens as size drops (+.16em at 11 px → −.025em at 68 px).
- **Loading → menu**: the loading screen uses the same column (logo + subtitle at identical coordinates, with a cyan progress bar in place of the menu).
  The canvas and body are black, so the loading layer fades over 1.1 s to the title already rendered behind it, while the menu rises in.
  The first frames and the shader warm-up already use the title camera.
- **Radio** (`R` or `.` next, `,` previous, in a car only; it fades out on foot): BREAKWATER FM 98.1 (synthwave), LOW TIDE 91.4 (lo-fi),
  DOCKSIDE 104.7 (house), THE NIGHT SHIFT 88.3 (soul), then RADIO OFF. Three tracks each, all original and named in `STATIONS`. Each track is a
  4-bar loop synthesised from its own record (bpm, key, mode, progression, style, seed): saw pads/arps, sine kicks, noise snares/hats, walking bass and so on.
  Synthesis is queued as jobs and run in 3 ms slices per frame, so there is no hitch; the tuned station is pre-built while the player walks.
  The `AudioBuffer` carries the track id, and the HUD reads `nowPlaying()` from the live source node, so the label is the record that made the audio.
  A track loops 4× and then the station crossfades to the next one.
- **Feedback** (watched after every fixed step, so step-only tools see it too): new objective → two-note chime + "NEW OBJECTIVE" tag and flash;
  wanted level up → two-tone alarm + stars pulse red; mission passed → rising arpeggio + gold sweep over the card; failed → falling minor tones + thud +
  red sweep; damage → low thump + red edge vignette + health bar shake. All sounds are WebAudio, nothing loaded.
- **Determinism**: `stage()` sets `body.ui-still` (HUD animations off, key hints pinned) and draws the minimap at a fixed time. `stageTitle(s)` resets
  world and clock and simulates `s` seconds of title time. The new rAF waits in `stage()` have a 100 ms fallback (see Known limits).

### probe_ui (`node tools/probe_ui.mjs`, headless, raw summary)

```
{"checks": {"noWhiteFlash": true, "darkBackdrops": true, "titleOverLiveCity": true, "titleLayout": true, "continueHiddenWithoutSave": true, "keyboardFocusNoSave": true, "hoverFocuses": true, "enterStartsGame": true, "hudGroupsOnFoot": true, "minimapSpec": true, "hudGroupsDriving": true, "radioMatchesAudio": true, "feedbackEvents": true, "continueOnlyWithSave": true, "everyRowKeyboardFocus": true, "continueResumes": true}, "transition": {"frames": 8, "maxMean": 0.226, "maxBrightShare": 0.003}, "minimap": {"count": 1, "w": 100, "h": 100, "left": 24, "bottom": 24, "border": "3px", "borderColor": "rgb(0, 230, 255)", "radius": "50%", "drawnShare": 0.7894, "label": "Downtown"}, "radio": [{"station": "BREAKWATER FM", "trackId": "bwfm-1", "buffer": {"trackId": "bwfm-1", "duration": 9.6, "channels": 2}}, {"station": "LOW TIDE", "trackId": "lowtide-1", "buffer": {"trackId": "lowtide-1", "duration": 12.632, "channels": 2}}], "feedback": ["wanted+sound@36.6", "damage+sound@36.63", "objective+sound@0.03", "fail+sound@0.08", "objective+sound@11.43", "objective+sound@14.92", "wanted+sound@67.98", "objective+sound@82.35", "wanted+sound@148.38", "complete+sound@159.22"], "consoleErrors": 0, "offsiteRequests": 0, "pass": true}
```
All input is real CDP key/mouse events. The fail case uses a new tool hook, `__game.missionFail`, which calls `Missions.fail` (the path every in-game fail takes),
because the scripted courier does not fail on demand. The pass comes from the courier playing THE PICKUP. The no-white-flash check decodes PNG frames
captured throughout the load → title transition (brightest frame: mean luma 0.226, 0.3 % of pixels above 0.85).

### Gate (raw lines, final build)

```
{"fps":12.5,"calls":220,"triangles":784550,"geometries":165,"textures":40,"consoleErrors":0,"offsiteRequests":0,"frameMs":9.06,"fpsCapacity":110.4,"seconds":10,"mode":"headless","pass":true}
{"fps":60.1,"calls":220,"triangles":784552,"geometries":165,"textures":40,"consoleErrors":0,"offsiteRequests":0,"frameMs":9.99,"fpsCapacity":100.1,"seconds":10,"mode":"headed","pass":true}
```
Title screen, headed, 10 s sample (scratch script, same `frame()` counters as the gate):
`{"fps":59.9,"calls":280,"triangles":681439,"title":true,"consoleErrors":0,"offsiteRequests":0,"mode":"headed","screen":"title"}`.
Headless fps is again this host's headless rAF cap (frame cost 9 ms ≈ 110 fps capacity), as in every earlier pass.

### Screenshots

`node tools/shots.mjs` was run twice: all nine SHA-256 hashes matched. New: `07-title-screen.jpg` (the menu over the waterfront at sunset, traffic and walkers
on the promenade, the passing car in the street), `08-driving-hud.jpg` (the drive stage with every HUD group), and `09-market-on-foot.jpg` (walking in the Old Market).
01–06 were regenerated and now show the new HUD.

### Regression

`probe_clock`, `probe_save2` and `probe_save` pass. probe_save drives the new title through real clicks on `#play` and `#continue`; the ids are kept.

### Known limits

- Headless Chrome on this host intermittently stops delivering requestAnimationFrame. A CDP key event carrying `nativeVirtualKeyCode` (macOS reads it as
  a different physical key) caused it reliably; probe_ui no longer sends one. Unrelated stalls also hit `shots.mjs` once. Hence the 100 ms fallback on the
  rAF wait inside `stage()`, and per-call timeouts in probe_ui, so a stall fails loudly instead of hanging.
- The title hides at once on Start/Continue (probe_save expects `#start` hidden immediately); the HUD fades in over 0.5 s instead.
- The radio only plays in a car. Its loops are 8–13 s and repeat 4× per track, so a station cycles through its three tracks in about 2 minutes.

No commit, push or submission was performed.

## PASS 11 — enterable interiors and safehouse

New: `world/interiors.js`, `tools/probe_interiors.mjs`. Changed: `main.js` (wiring + tool hooks `interiors()`, `interiorGoto(id)`), `player/character.js`
(the police badge/radio now keys off a `badge` palette flag instead of `cap`, so a civilian cap has no badge), `style.css`, `README.md`.
Not touched: econ/**, env/**, core/events.js, missions/**, vehicleModels.js, save.js, vendor/**, doors.js (used through `doors()` / `nearestDoor()` / `doorRadius()` only).

- Five registry doors, each the nearest to an anchor: SAFEHOUSE `door-2-4-0-0`, TIDELINE clothing `door-2-3-0-0`, HARBOUR HARDWARE `door-3-3-0-0`,
  BREAKWATER CUSTOMS workshop `door-3-4-0-0` (the roller door), THE SALT LANTERN bar `door-4-4-0-0`. On the street, one merged mesh (1 draw call)
  draws a lit doorway and sign for each (the safehouse is unmarked; customs already has its sign).
- E on foot at a door (idle story, no side job, not aiming) builds the room into its own scene: shell + emissive mesh + sign + a few lights,
  under a fixed corner camera. The street simulation and street render are skipped while inside. The player's `world` is swapped for a room shim
  (box colliders, flat floor). The exit door (E) disposes the room and spawns the player at the street door's x/z and yaw.
- Safehouse bed: sleeps to 07:00 if that is 6–12 h away, otherwise 8 h (`Time.advance`), heals, clears up to 2 stars with `wanted.force` only if
  no police saw the entry (`police.seen` or `wanted.unseen < 2 s` at the door), then `autosave('sleep')`. Wardrobe: wear owned clothing
  (inventory items cap / windbreaker / jacket / boots), persisted in a new `wardrobe` save section through `registerSection`.
- Shops call `shop.buy` (wallet synced the same way customs does it). The garage terminal lists `garage.list()` and opens the existing GarageMenu
  on the player's car (owned or last driven, within 150 m), placed on the turntable.

Results: probe_interiors pass (5/5 rooms entered via door + E, exit returns to door pose, room geometry released, shops, garage → customs menu open,
wardrobe, sleep seen → wanted 2→2 / unseen → 2→0, clock 19:20 → 07:00 day 2 and +8 h, saved, consoleErrors 0). Interior frames: 26–27 calls, 5–8k tris.
Gate `--headed --seconds=20`: `{"fps":60,"calls":274,"triangles":784580,"consoleErrors":0,"offsiteRequests":0,"pass":true}`.
Regression pass: probe_doors, probe_shop, probe_inventory, probe_wallet, probe_garage, probe_save, probe_save2, probe_custom, probe_ui, probe_clock.
Known limits: the safehouse save keeps the existing checkpoint rule (Continue resumes at the next mission's contact, not at the bed).
On-foot key hints still show while inside.
No commit, push or submission was performed.

## PASS 15b — photo mode, radio to eight stations, polish

New: `ui/photoMode.js`, `ui/speedLines.js`, `player/outfit.js`, `tools/probe_photo.mjs`, `tools/probe_radio.mjs`, `tools/probe_polish.mjs`.
Changed: `audio/radio.js` (extended, not rewritten), `render/post.js`, `main.js` (wiring + tool hooks), `hud.js`, `ui/feedback.js`, `index.html`, `style.css`, `README.md`.
Not touched: econ/**, core/**, missions/**, save.js, vendor/** (checked by mtime against this file before the pass).

- Photo mode (P; not on the title, in customs, inside a room or during WASTED/ARRESTED). `update()` returns before `simStep` while it is open, so
  nothing is stepped (clock, traffic, crowd, police, missions); the AudioContext is suspended. The free camera flies on a 60 m leash above the
  ground. The post pipeline gets an optional `photo` pass: on first use it allocates its own scene target with a depth texture plus an LDR composite
  target, then a 40-tap disc DOF (auto focus reads the depth under the subject's screen position) and the four looks. The normal path is unchanged
  (photo off = the same passes as before). PNG = `canvas.toBlob` in the same task as the draw, downloaded with an `<a download>`.
  Exit restores the render camera pose and FOV; `photoSnaps()` records the world on entry and exit for the probe.
- Radio: four new stations and four synth styles in `planTrack` (ambient, talk, industrial, news) with a shared `speak()` chatter-beep voice;
  industrial gets more drive at the soft clip. `tunedAt` marks player retunes; the HUD station panel (`#radio-panel`) shows for 2.6 s after one.
- Polish: dip-and-sweep overlay when leaving the title (the title itself still hides at once, as probe_save expects); objective panel slides in
  and a new objective fades in; mission toasts (objective, passed, failed, wanted; max 3, ~3.4 s); low-health vignette (from 55 hp, heartbeat
  at 30 and below) under the existing damage flash; speed lines on a 2D canvas above ~95 km/h (no draw calls; off in `ui-still`); briefing,
  choice, customs and interior panels animate in. The result card moved to 27vh so it sits below the toast stack.
- Outfit: the wardrobe section already rebuilds the body on Continue. The save schema has no `outfitId` / colours field, so `player/outfit.js`
  only *reads* them if some writer stored them (top level, `player` or `wardrobe`): a preset id from `OUTFIT_PRESETS` and/or `#rrggbb`
  palette keys. Unknown ids/keys/values are ignored. Nothing writes them.
- Legibility: the smallest type step is now 13 px (7.8 px at 768x432), with weight ≥ 600 and a panel or text shadow; customs/interior panel
  text raised from 10–12 px to 13 px; the minimap N marker is larger.

### Results

- `probe_photo` pass 22/22: frozen for 1.5 s (time, clock, player, fleet, crowd identical), camera moves/turns/rolls, FOV keys + slider, DOF
  (edge energy 2.6 blurred vs 9.6 sharp), noir sat 0 / neutral 0.43, warm red/blue 1.74 vs 1.27, neon sat 0.85; H hides the panel; Enter
  saved a 1024x576 PNG; exit snapshot == entry snapshot exactly (on foot and in a car at speed); audio suspended → running; sim resumes.
- `probe_radio` pass 12/12: 8 stations, genre coverage, every station plays its own loop via real R presses (rms 0.08–0.27), panel lit on the
  right row, RADIO OFF silent, wrap and comma, panel closes, off on foot and after leaving the car, R on foot does not retune.
- `probe_polish` pass 12/12: transition, toasts (objective / wanted / failed, capped, expire), objective fade, vignette, speed lines (138 km/h
  0.48 vs 29 km/h 0), legibility (min 13 px in foot / drive / photo states), outfit from save.
- Regression: probe_ui (16/16), probe_save, probe_save2, probe_interiors, probe_garage, probe_clock pass. probe_ui prints its result after
  ~17 s but the process then lingers until its uncleared 600 s `runMission` timeout race expires (pre-existing; not changed here).
- Gate `--headed --seconds=20`, four runs on a loaded host (load average 10–17 from desktop apps):
  `{"fps":29.2,...,"pass":false}` (first launch), `{"fps":55.4,"calls":274,"frameMs":13.02,"pass":true}`,
  `{"fps":59.6,"calls":274,"triangles":784568,"consoleErrors":0,"offsiteRequests":0,"frameMs":10.16,"fpsCapacity":98.4,"pass":true}`,
  `{"fps":54.2,"calls":274,"frameMs":11.73,"pass":false}`. Calls and frame cost match PASS 11 (274 calls, ~10 ms); the fps misses track host load.

No commit, push or submission was performed.

## PASS 16 — final audit and polish (Opus)

Audit of the fallback-written systems (env/time, env/weather, econ/wallet, shop, inventory, garage, factions, audio/radio, world/doors, missions/side):
- **Missing:** `econ/collectibles.js` and `core/achievements.js` did not exist (save.js only reserved their sections). Both were written:
  12 seeded harbour tags (pavements + jetty, 30 m apart, clear of doors and side spots; walk or drive through one for $50, one instanced
  draw) and 11 event-driven achievements (toast on unlock). Both persist and are reset by a new game.
- **Bug:** money paid straight into `life.money` (mission rewards, arrest fines, grants) never reached the wallet until a customs/interior sync,
  so shops priced against a stale balance and a wallet `patchSection` could write a stale balance. `simStep` now syncs whenever they differ.
- **Bug (tool):** `__game.daylight()` reported the look from the last *draw*, so after `setClock`/`step` it was one state behind. It now applies first.
- **Weak probes:** `probe_daynight` measured luma from a camera facing a shaded canyon (noon == night) and compared rain draw calls across
  different world states; it now uses a fixed open pose and the same frame with rain off/on (exactly +1 call). `probe_weather` gained a save
  round trip that must continue the same schedule. `probe_side` gained the in-city spots and generated routes. `probe_ui` now exits on its result
  (it used to linger ~600 s). New: `probe_collectibles`, `probe_achievements`, and `probe_reach` (real E/F presses: HUD money, tag pickup and
  toasts, door prompt, side job start, radio in a car and off on foot, HUD clock and weather).
- Day/night: the clock and weather drive the sun, sky, fog, lamps, windows, exposure, rain streaks and wet ground (`render/daylight.js`,
  `render/rain.js`); the 19:20 clear start equals the dusk MOOD exactly.

Results: all 29 `tools/probe_*.mjs` + `gate.mjs` exit 0 headless and with `--headed --seconds=20`.
Gate headed: `{"fps":60,"calls":275,"triangles":784664,"geometries":223,"textures":41,"consoleErrors":0,"offsiteRequests":0,"frameMs":11.42,"fpsCapacity":87.6,"seconds":20,"mode":"headed","pass":true}`
Gate headless: `{"fps":24.2,"calls":222,"triangles":784664,...,"frameMs":10.7,"fpsCapacity":93.5,"mode":"headless","pass":true}` (headless rAF cap on this host, as in every pass).

Still open: shop stock is not saved (shelves refill on reload). The first frame at a new camera pose can reach ~424 calls while the prop batches re-sort (under 500).
No commit, push or submission was performed.

## PASS 17c — invisible walls

`node tools/probe_walls.mjs` (about 3 min; `--static` for the collider/bounds scan only, `--only=walk|drive`). It indexes the drawn triangles
at body height (merged district, every instanced prop, plazas, harbour, customs site) and, for every collider face and bound edge
next to reachable ground, casts rays back at it: a face more than 0.3 m in front of anything drawn counts as an invisible blocker.
Then it walks 101 lanes (both pavements and both carriageway lanes of all 12 streets, the promenade, the jetty) and drives 24
keep-right lanes end to end with the real controllers, and sorts every stall into traffic, drawn obstacle, drawn road end or invisible.

Causes found, fixed:
- **Street exits at the district edge.** All 18 streets are drawn on past `CITY.bounds` into the skyline ring, and the bound (and the
  vehicle bound boxes) stopped people and cars on open road. `world/roadEnds.js` puts a drawn road closure at each exit, from building
  line to building line (to the quay rail on the waterfront): jersey blocks, a striped plank barricade on posts, amber blinkers.
  Its collider sits on the bound. Promenade benches keep clear of it.
- **Promenade quay strip.** `bounds.z1` was 224.5, so people stopped 1.1 m short of the drawn railing. It is now 225.6 (the rail collider face).
- **Jetty.** The walkable deck and rail colliders stopped 0.5 m inside the drawn railings (`JETTY_IN` 0.6 → 0.15). The quay rail now meets
  the jetty rails, which start at the quay. Rail collider tops match the drawn top rail. The jetty bollards now have colliders, since the deck reaches them.
- **Fountains.** The round basin had its bounding square as a collider (up to 1.7 m of air at the corners). It is now 0.4 m slices.
- **Bus shelters.** A solid 2.56 × 0.92 × 2.2 m box covered an open-fronted shelter. Colliders now follow the posts, back glass and seat.
- **Party walls facing a plaza.** Where a plaza sat beside a cell in the other column, that side had a solid collider but no ground-floor
  wall, so the plaza looked into an open void under the upper floors. That wall is drawn now.

Checked and clean: the building podium/tower/recess boxes, columns, lamps, signals, bins, bollards, signs, vending machines, trees, hydrants,
benches and planters (all on the pavement, none on the carriageway). The terminal and water-tower boxes are outside reachable ground.

Results on this build: probe_walls 0 invisible (static 0, dynamic 0), probe_density / probe_police / probe_side / probe_interiors pass,
gate headed 20 s `{"fps":59.7,"calls":275,"consoleErrors":0,"pass":true}`. **probe_missions fails NO WITNESSES**: the scripted chase car
wedges against a parked SUV at (42, 65) for 12 s and loses the clerk. No static collider is within 4 m of it. The same probe passed with
these changes reverted. With only the road closures removed it passed NO WITNESSES and stalled THE LAST ROUTE in traffic instead, so the
chase bot is sensitive to any change in the world, not to a wall. Not changed in this pass.

No commit, push or submission was performed.

## PASS 17f — probe_walls regression after 17d

`probe_walls` reported 2 dynamic "unknown" stalls after 17d (x=-200 -, z=-40 +; which lanes it hits changes with traffic timing).
None was a wall or a traffic car on a prop. Traced step by step: the probe's own scripted car (driving the lane at 13 m/s through
live traffic) was knocked 130-150° off its lane heading (a crash with a traffic car, a kerb clip), then came about on full lock with
wheelspin (`slip 1`, throttle 1, ~1 m/s and accelerating, nothing within reach). The probe counted any second under 1.2 m/s as a
stall, and with no collider, bound or car in contact it called it invisible. 17d's traffic changes only moved where cars were.
The `visibleAt` pole/bollard rows are drawn stalls (not counted), from the same knocks onto the pavement.

Fix (tool only): a car more than 0.5 rad off the lane heading and still moving (> 0.3 m/s) is not stalled. A car held by anything is
at rest, so a real blocker still counts whatever the heading. `traffic.js` and `missions.js` are unchanged.

Results: probe_walls 0 invisible (static 0, dynamic 0; all 24 drive lanes reach their end), probe_missions / probe_police /
probe_density / probe_brake exit 0, gate headed 20 s `{"fps":59.8,"calls":276,"consoleErrors":0,"pass":true}`.
No commit, push or submission was performed.

## PASS 14b — weapon wheel, stealth, outfits (logic)

- **Weapons** (`player/weapons.js`): data table (fists, pistol, crowbar) with damage, interval, range, magazine, reload, ammo type, noise.
  Fists and pistol are innate; others are held only while their item is in the bag (`inventory.js`). `combat.js` reads all numbers from
  the equipped weapon; each firearm has its own magazine, ammo pools are per type, melee needs no ammo. Saved in a `loadout` section.
- **Weapon wheel** (`player/weaponWheel.js`, DOM in `hud.js`): hold Tab on foot; the sim runs at 20 % (`simStep(dt * 0.2)`); mouse
  direction, scroll or 1-9 highlight; release equips. Only held weapons are listed; `Weapons.equip` refuses anything else.
- **Stealth** (`player/stealth.js`): noise (still 0, crouch 0.06, jog 0.3, sprint 0.6, car 0.18+, gunshot 1, crash bang) and visibility
  (daylight from `env/time.js`, weather blend from `env/weather.js`, crouch 0.65). Every crime goes through `reportCrime` in main.js:
  reported if noise >= 0.7, or visibility >= 0.35 and a police unit or bystander (not the victim) has a sightline within 45 m x visibility.
  C toggles crouch (no longer a walk key); melee hits on people are a new `assault` crime (heat 8).
- **Outfits** (`player/outfits.js`): five outfits keyed to owned clothing; O cycles. Changing while wanted and unseen drops one star
  after 3 s unseen (`Wanted.dropStar`), re-arming after 30 s. Saved as `outfit: { outfitId, colours }`; `outfit.js` does not read
  this section yet; the visual pass applies the look.

Results: probe_stealth pass; probe_combat, probe_police, probe_save, probe_save2, probe_inventory, probe_shop, probe_factions,
probe_achievements, probe_ui, probe_review, probe_polish all exit 0. No commit, push or submission was performed.

## PASS 8 — QA, dossier, final screenshots

Every number below is from the final build (this pass's last edit to `game/` came before every run listed). Node v22.23.1.
Every probe launches a fresh temp Chrome profile, so every run is cold.

### What changed (game)

- **HUD overlaps (real layout defects at 1280×720).** The on-foot key-hint bar (~920 px, centred) ran under the district label
  ("WATERFRONT" over "WASD MOVE") and touched the ammo group; long toasts (centred, up to 560 px) covered the objective panel.
  `#keys` is now held to the band between the minimap label and the right-hand group (`max-width: calc(100% - 620px)`), wrapping
  between key/action pairs (`hud.js` emits one nowrap span per pair); `#toasts` sits between the objective panel and the status group.
- **Police stand down after a chase** (`police.js` `standDown`). Units used to stay on patrol forever (cap 3), so a 3-minute run ended
  with 2 extra units. With wanted 0, a unit that has patrolled 6 s and is out of the player's sight beyond 50 m (or beyond 110 m) leaves;
  `fleet.refill` tops the 43-car fleet back up. probe_police is unchanged (min distances 3.1/3.3/16.6, cleared at 27.7 s).
- **Tool API only:** `sceneCensus()` (unique geometries/textures in the scene graph), `carLook(orbit, pitch)` (sets the car camera's
  orbit as a mouse drag does), `vehicleDims(id)`, `debugCar().slip`. `stage()` now also resets the weather (it already reset the clock),
  and in the tools' still mode (`ui-still`, set only by `stage()`) the HUD's clock is simulation time, so staged frames don't depend on
  how long a tool waited. Play is unchanged.

### What changed (tools)

- `tools/shots_final.mjs` (left unfinished by an earlier attempt: it referenced an undefined `SCENES_VIEW`): four scenes, a fresh load per
  scene (simulation streams carried state from one staged scene into the next), and a scene check computed from game state: lifted
  people (> 0.5 m: on a roof) and cars (> 0.3 m), overlapping cars, people inside cars or the player, the camera inside a car body, and
  HUD boxes outside the viewport. Exits 1 on any failure.
- `tools/probe_longrun.mjs`: the leak check now compares `sceneCensus()` (allocation) rather than `renderer.info` (GPU uploads). The settle
  phase clears wanted and stops the autopilot (its crashes are crimes) before the end sample.
- `probe_reach` expected 12 harbour tags; the game has had 20 since `collectibles.js` changed. It now takes the game's count.
- `probe_polish` looked for the damage flash 60 ms after `hurt()`; headless Chrome here runs rAF at ~16 fps (61 ms), so it raced one frame.
  It waits 250 ms (the class stays on until the next cue). Headed, the unchanged probe passed 12/12.
- `tools/shots.mjs` writes to `tools/screenshots-archive/`; the 15 earlier development shots moved there. `screenshots/` holds only the 4
  hand-in images (the scorer allows 4).

### Why the GPU geometry count climbs and is not a leak

First long run (before these changes): `gpu geometries 199 → 413`, `policeUnits 0 → 2`, heap +0.5 %, fail. A trace hooked on
`BufferGeometry.addEventListener('dispose')` (three.js registers it at the first upload) showed every one of them uploaded from
`renderer.render` on first view, and the same 4-minute cycle run twice added 242 then 9 (`408 → 417`). `sceneCensus()` stays at 496
geometries / 27 textures the whole time while the GPU count goes 150 → 401: static geometry uploaded the first time it is seen.
The +1 GPU texture is a 512×128 sign texture, same pattern.

### Regression (final build, raw)

`probe_density` / `probe_police` / `probe_combat` / `probe_missions` / `probe_save` / `probe_ui` exit 0 (lines in the hand-off message).
probe_missions: all 5 missions completed, both endings (press, deal), fail-then-retry on NO WITNESSES and on the finale.
Also exit 0: probe_polish 12/12, probe_reach 14/14, probe_review, probe_radio.

```
{"fps":16.3,"calls":223,"triangles":801147,"geometries":168,"textures":42,"consoleErrors":0,"offsiteRequests":0,"frameMs":10.25,"fpsCapacity":97.6,"seconds":10,"mode":"headless","render":"1280x720 @1","renderLowest":"1280x720 @1","pass":true}
{"fps":60,"calls":276,"triangles":801061,"geometries":224,"textures":42,"consoleErrors":0,"offsiteRequests":0,"frameMs":11.85,"fpsCapacity":84.4,"seconds":20,"mode":"headed","render":"1280x720 @1","renderLowest":"1280x720 @1","pass":true}
```

Headless fps is this host's headless rAF cap (as in every pass); its GPU-synced frame cost is 10.25 ms (≈98 fps).

### Cold start and long run (`node tools/probe_longrun.mjs --headed --minutes 3`)

```
{"mode":"headed","minutes":3,"coldTitleMs":1497,"coldReadyMs":1235,"samples":[[0,"baseline",137.32,40,43,18,0,496,27,188,42,224],[15,"drive",138.61,40,43,18,0,496,27,228,42,152],[30,"drive",137.95,40,43,18,0,496,27,347,42,268],[46,"drive",138.15,40,43,18,0,496,27,385,43,237],[61,"drive",138.23,40,43,18,0,496,27,387,43,187],[77,"chase",139.11,40,43,18,2,496,27,392,43,262],[92,"chase",138.75,40,43,18,2,496,27,393,43,159],[107,"chase",138.72,40,43,18,2,496,27,393,43,245],[123,"chase",139.48,40,43,18,2,496,27,393,43,265],[138,"foot",138.62,40,43,18,1,496,27,393,43,151],[153,"foot",138.37,40,43,18,0,496,27,393,43,241],[169,"foot",139.34,40,43,18,0,496,27,394,43,302],[184,"foot",139.53,40,43,18,0,496,27,395,43,287],[210,"end",139.43,40,43,18,0,496,27,395,43,382]],"columns":["t","phase","heapMB","sceneObjects","vehicles","peds","policeUnits","sceneGeometries","sceneTextures","gpuGeometries","gpuTextures","calls"],"peak":{"heapMB":139.53,"policeUnits":2,"vehicles":43},"entityDrift":{"sceneObjects":0,"vehicles":0,"peds":0,"policeUnits":0,"sceneGeometries":0,"sceneTextures":0},"gpuDrift":{"geometries":207,"textures":1},"gpuWithinScene":true,"heapDriftPct":1.5,"requests":172,"failedRequests":[],"consoleErrors":0,"offsiteRequests":0,"pass":true}
```

`coldTitleMs` is the first load in an empty profile (navigation → title menu up). `coldReadyMs` is the second navigation (cache warm).

### Final screenshots (`node tools/shots_final.mjs`, exit 0; two runs, all four SHA-256 identical)

| File | Bytes | Calls / tris | Check |
|---|---|---|---|
| `1-city.jpg` waterfront promenade: skyline, 98.4 FM billboard, waterfront traffic, 8 walkers, harbour, cranes | 206 383 | 246 / 451 898 | ok |
| `2-chase.jpg` dock road toward the port at wanted 3, cruiser lights on 17.6 m away, cranes and bay | 196 894 | 125 / 336 397 | ok |
| `3-street.jpg` on foot in the Old Market, 7 walkers, traffic, PAWN & LOAN / LIQUOR fronts | 198 280 | 201 / 400 819 | ok |
| `4-last-route.jpg` THE LAST ROUTE past the port gate: objective + LEDGER meter, story line, wanted 3, cranes | 206 611 | 211 / 581 815 | ok |

`50aed92b…` `93c3d6bb…` `0505eed1…` `c0529770…`. Every check: lift 0, overlaps 0, camera-in-car 0, HUD clipped 0, 0 errors, 0 off-site.

### Hand-in

`MAKEFUN_OUTPUT_DIR=out node main.ts` twice → identical trees. dossier.json 1 245 511 bytes (≤ 1.5 MiB), 4 images, text 163 762 bytes;
game/ 101 entries, 1 750 836 bytes, no symlinks, longest path 38; index.html 7 459 bytes; 108 entries in the output; screenshots
1280×720 JPEG ≤ 206 611 bytes. `vendor/makefun-game.ts` is byte-identical to the kit's. `makefun check --worktree` (kit v27):
4 passed, 0 failed, 17 skipped, 5 at submission.

### Known limits

- The car camera only pulls in against static colliders: orbited with the mouse next to a truck, it can end up inside the truck's body
  (seen while framing shot 4, not in any final shot; `shots_final` now checks for it).
- Pursuing units lose ground in traffic queues (1–2 m/s closing on a stopped car in the waterfront jam), so a fast chase rarely ends
  with a cruiser on the bumper. Shot 2 is a slow car with units arriving head-on.
- The gold box in the middle of shot 3 is a harbour tag (a collectible), not a placeholder.
- Shot 2 holds wanted at 3 (`forceWanted`) for the duration of the staging; shot 4's wanted 3 comes from the mission's own gate beat.
- The district label reads DOWNTOWN on the dock road by the port.

No commit, push or submission was performed.
