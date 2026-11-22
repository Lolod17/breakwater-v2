# BREAKWATER v2 — PASS 17 review and repair

Reviewer: Opus 5.5. Scope: find what is weak or wrong in passes 2–4, fix it, prove each fix with a probe line.
No new content was added except the minimap, which was on the list of things that make the game look worse than it plays.
No commit, push or submission.

## How the numbers were taken

- **Before** = the PASS 4 code exactly as found, copied to `/tmp/bw17/before/` before any edit. Every game file is
  untracked in git, so there was no git baseline. The only additions to that copy are read-only tool hooks the new
  probe needs (`vehicleIdOfPlayer`, `sirenLamps`, `player().vehicle.id`, `population()` yaw/los/onScreen/camera,
  `snapshot` `sees`/`lastSeen`, `probeStep({shotFrom})`). None of them change simulation or rendering.
- **After** = this repository. The same probe file runs against both trees.
- New probe: `tools/probe_review.mjs`, one section per suspected defect, all through real game paths: the real
  F `keydown` for the carjack, `Combat.fire(cameraPos, dir)` exactly as the mouse calls it, and instance matrices
  read back from the GPU batches for the gait.
- **Host load.** During this pass another desktop app's renderer used ~195 % CPU and the load average was 6–14
  on 8 cores. Gate fps and `frameMs` swing with that: the same unchanged build gave 7.6 ms and 62 ms per frame
  in the same hour. So the gate comparisons below are **A/B runs, before tree and after tree back to back**.
  A CPU profile at wanted 4 showed 66 % of frame time in `readPixels`, i.e. waiting on the GPU, which the
  other process also uses. I did not stop the other process: it is the user's.

## 1. Audit — claim vs code

### Provenance checks

| Item | Claim | Found | Gap |
|---|---|---|---|
| `game/vendor/three.min.js` | 748 760 bytes, r187 | 748 760 bytes, header `Lf="187"`, sha256 `07db7ffc…6b9a` | none |
| `.makefun/owner.json` wallet | correct wallet | `ChreKpMp…1dZayH`: 44 chars, valid base58, decodes to 32 bytes, identical to `.makefun/freshness.json` and to the author of both commits | none found |
| `README.md` badges | correct URLs | `make.fun/badge/gta6-01.svg`, `…/gta6-01/Lolod17/breakwater-v2/{rank,reward}.svg` | **unverifiable here**: no git remote is configured, and the local git user is `Lolod`, not `Lolod17`. I did not query make.fun or GitHub (no network use). The operator should confirm that `Lolod17` is the account that will host the repo. |
| `README.md` controls | — | match `input.js` / `index.html` (Q/RMB aim, X/LMB fire, R reload are on the start card, not in the README) | README omits the combat keys (cosmetic) |
| PASS 2 "TRACK_LOOP stall fix" | fixed by qwen4-max | the identifier `TRACK_LOOP` exists nowhere in the repo, and BUILD-NOTES has **no PASS 2 section**. The only loop protection in `traffic.js` `_track` is `guard > 64 → _reseat()` (line 108). | Documentation gap. Behaviour verified below (`track`): not a live defect. |
| PASS 2 "scripted-control clobber fix" | fixed | `driving.js:49` skips keyboard input when `scripted`; `driveTest({throttle:1},3)` reaches 62.9 km/h, and a throttle-then-brake script gives 10.2 → 31.4 → 14.3 → −7.4 km/h | none: holds |

### Per file (files read line by line marked ✔)

| File | What it claims | What the code does | Gap |
|---|---|---|---|
| ✔ `player/driving.js` | enter/exit, carjack, tools may script `ctrl` | as claimed | **Carjacking a police cruiser** kept it a police unit (see D1) |
| ✔ `vehicles/traffic.js` | lane following, signals, left-turn yield, deadlock breaker, pull-over, police overtaking / 3-point turns | as claimed. `_track` guard (l.108) can in theory loop forever (it resets `guard` after each reseat), but from 110 826 start states over the whole map it never reseated even once | none live |
| ✔ `vehicles/vehicleManager.js` | fixed pool, swept substeps, cap 34 | as claimed. `nearestEnterable` (l.207) does not exclude police units, which is fine once D1 is fixed. `dispatch` allocates a `Vehicle` before its clearance test (l.118); this is only reached while units < count, so it is negligible | — |
| ✔ `vehicles/vehicle.js` | dynamics, lamps incl. siren | **siren phase (l.204) used JS `%` on a negative number and never reached 1, so the model's light bar could not light**, and nothing set `sirenOn > 0` anyway (D2) | dead system |
| ✔ `vehicles/vehicleCollisions.js` | impulses, kerbs, cruiser obstruction | as claimed. Police wall/kerb "0 penetrations" is enforced by rolling the move back (`vehicleManager.js:189-195`), which PASS 4 disclosed | — |
| part `vehicles/vehicleModels.js`, `vehicleMaterial.js` | police livery + light bar | the model **has** a red/blue bar (l.268-270) driven by `iLamp.w`, and PASS 4 drew a **second floating bar** above it in `police/visuals.js` (D2) | duplicate system |
| ✔ `pedestrians/crowd.js` | 18 instanced walkers, "limbs rotate with measured walking speed" | legs and arms rotated about their **own centre**, not hip/shoulder. The stance foot moved with the body at 1.17 m/s (it slid the whole time). Idle agents were frozen (D5). `setColorAt(new THREE.Color(css))` ran 180×/step, but the sampled heap shows only 4–6 KB/s for the whole sim (V8 removes the temporaries), so that part is **not** a defect | animation weak |
| ✔ `world/props.js` | instanced furniture, compaction within 145 m | as claimed. Compaction calls `mat4()` (2 allocs/instance) every 6 m of camera travel, which is inside the measured 3–6 KB/s total | — |
| part `world/*` (layout, world, colliders by use) | — | consistent with use; buildings/roads/materials/textures/harbour/lightmap were **not** read line by line this pass | see still open |
| ✔ `police/police.js` | patrol→…→return state machine, dispatch, arrest | as claimed, plus D1 (stolen unit), D3 (`lastSeen` never cleared, l.147) | |
| ✔ `police/visuals.js` | light bars, pools, helicopter | floating duplicate bar (D2) | |
| ✔ `police/wanted.js` | heat 0–100, thresholds, decay | as claimed. Single source of truth for wanted; HUD reads it directly | none |
| ✔ `player/combat.js` | camera ray re-traced from the muzzle "so you can't shoot round corners" | the first trace starts **at the camera**, so a pedestrian between camera and player was hit, i.e. shot backwards (D4) | |
| ✔ `main.js` | tool API, single `life` record | money/hp live only in `life`, ammo only in `Combat`, wanted only in `Wanted`, so there are no duplicate sources | none |
| ✔ `hud.js` | "district banner" | the district element was **never written**, so it read "Downtown" on the jetty and the waterfront (D6). No minimap (D7) | |
| ✔ `tools/probe_density.mjs` | "minimum local moving counts" | `peds50` counts every agent of a pool that is always placed within 43 m of the player (dead and stuck ones too), so it is **18 by construction**. `props60` counts a static placement list, so it is **constant by construction**. With the camera it stages, the waterfront point had **0 pedestrians on screen** and still passed | probe weaker than claimed (P1) |
| ✔ `tools/probe_police.mjs`, `probe_combat.mjs` | as documented | honest. Combat shots in the probe fire from the chest, not the camera, so they could not see D4 | |
| ✔ `tools/gate.mjs` | budget gate | printed numbers but **never judged them** (no pass field, exit 0 always) (P2) | |

## 2. Defects (original file:line)

- **D1** `player/driving.js:76` + `police/police.js:131-225`: taking a police unit's cruiser left `car.policeUnit` set.
  The unit kept "seeing" from the car the player sat in (2400/2400 frames), so wanted could never decay while
  driving it. The unit slot stayed occupied, so no real unit replaced it, and the car kept its siren state.
- **D2** `vehicles/vehicle.js:204`, `police/visuals.js:117-158`: two light-bar systems. The model's own bar never lit
  (negative `%`, and `sirenOn` never set). A second box bar floated 6 cm above the roof, 0.35 m off the model's bar.
- **D3** `police/police.js:147`: `lastSeen` survived arrest/wanted reset, so the next incident's pursue/search goal
  started at the previous sighting until the player was seen again.
- **D4** `player/combat.js:114-116`: view ray traced from the camera, so a pedestrian behind the shooter could be hit.
- **D5** `pedestrians/crowd.js:207-253, 354`: limb pivots at the segment centres, foot sliding, no idle motion.
- **D6** `hud.js:79-87` / `index.html:17`: district label never updated from the real position.
- **D7** no minimap.
- **P1** `tools/probe_density.mjs:22,29`: tautological pedestrian and prop counts (above).
- **P2** `tools/gate.mjs`: no verdict.

Checked and **not** defects: `_track` loop (0 reseats in 110 826 trials), per-frame allocation (3–6 KB/s total, both
trees), scripted-control clobber (holds), the wanted-4 frame cost (7.6 ms profiled; the 51–62 ms readings were host load,
and A/B runs below are 7.6–8.5 ms in both trees).

## 3. Fixes

1. **D1** `Driving.onTake` → `Police.detach(car)`: the unit is removed, `policeUnit` and `sirenOn` are cleared, and
   dispatch replaces it. Also applied in `enterNow` (tools). `Police.reset()` clears stale links.
2. **D2** `police.js` sets `car.sirenOn` from `unit.siren`, and `vehicle.js` keeps the phase in [1, 2).
   `PoliceVisuals` no longer builds the box bar. The road pool now uses the model bar's own phase and strobe
   (red when phase ≥ 0.5, as in `vehicleMaterial.js`).
3. **D3** `Police.update` drops `lastSeen` whenever wanted is 0.
4. **D4** `Combat.fire` starts the view ray at the point level with the shooter's chest (projection of the chest onto
   the ray). Everything after that (muzzle re-trace, corners) is unchanged.
5. **D5** `crowd.js` `_writeInstances` rewritten:
   - legs hang from a hip socket and reach an ankle target; capsules are stretched to the hip–ankle distance;
   - gait rate is `0.72·1.72/height` cycles per metre, and the stance foot sweeps back exactly 1/(2·rate) m per
     half cycle, so it stays planted;
   - inverted-pendulum hip bob from the stance leg, torso counter-twist, lean when fleeing;
   - arms swing from the shoulder against the same-side leg;
   - standing agents breathe, look around and shift their arms; gait amplitude eases in and out over 0.2 s;
   - colours are parsed once per agent.
6. **D6** `Hud.districtAt` from the real position: Harbour Jetty / Waterfront / Downtown / Outer Ring.
7. **D7** minimap (`hud.js` `initMap`/`minimap`, `#minimap` canvas). The city is pre-drawn once from `layout`
   (water, quay, pavements, lots, outer ring, jetty). Each frame (≤ 30 Hz) it is drawn rotated to the camera view,
   with police blips (flashing while responding), the search area around the last sighting, a player arrow and an
   N marker. It uses 2D canvas only, so it adds no WebGL draw calls.
8. **P1** `probe_density.mjs` adds `movingPeds50` (alive and walking > 0.3 m/s within 50 m), `pedsOnScreen` (inside
   the current camera frustum with a clear line, report only) and `pedsBestView` (best of 8 headings from the same
   eye). It now asserts `movingPeds50 ≥ 8` and `pedsBestView ≥ 3`.
9. **P2** `gate.mjs` prints `pass` (calls < 500, triangles < 900 000, 0 errors, 0 off-site, and fps ≥ 55 when headed)
   and exits 1 on failure.

## 4. Proof — raw probe lines

`node tools/probe_review.mjs`, before tree, then this repo:

```
BEFORE {"carjack":{"stolenId":34,"inStolen":true,"stillPoliceUnitAfterTheft":true,"unitStateAfterTheft":"pursue","ownCarSeesDriverFrames":2400,"seenFrames40s":2400,"wantedAfter40s":1,"heatAfter40s":1,"units":[[34,"pursue"]]}}
AFTER  {"carjack":{"stolenId":34,"inStolen":true,"stillPoliceUnitAfterTheft":false,"unitStateAfterTheft":null,"ownCarSeesDriverFrames":0,"seenFrames40s":2400,"wantedAfter40s":1,"heatAfter40s":6,"units":[[35,"pursue"]]}}
BEFORE {"siren":{"responding":1,"modelBarLit":0,"floatingBars":1}}
AFTER  {"siren":{"responding":1,"modelBarLit":1,"floatingBars":0}}
BEFORE {"stale":{"sightingBeforeClear":[32.2,150],"lastSeenAfterClear":{"x":32.2,"z":150}}}
AFTER  {"stale":{"sightingBeforeClear":[32.2,150],"lastSeenAfterClear":null}}
BEFORE {"behind":{"trials":4,"hitBehind":3, ... "ped":1,"hit":{"kind":"pedestrian","id":1} ... "ped":0,"hit":{"kind":"pedestrian","id":0} ... "ped":13,"hit":{"kind":"pedestrian","id":13} ...}}
AFTER  {"behind":{"trials":4,"hitBehind":0, ... "ped":1,"hit":{"kind":null} ... "ped":0,"hit":{"kind":"pedestrian","id":8} ... "ped":13,"hit":{"kind":"pedestrian","id":0} ...}}
BEFORE {"gait":{"hipDetachMaxM":0.268,"stanceFootSlipMs":1.174,"idleFramesAnimated":0.03,"idleSamples":154}}
AFTER  {"gait":{"hipDetachMaxM":0.009,"stanceFootSlipMs":0.049,"idleFramesAnimated":0.97,"idleSamples":154}}
BEFORE {"hud":{"jetty":"Downtown","waterfront":"Downtown","avenue":"Downtown","minimap":false}}
AFTER  {"hud":{"jetty":"Harbour Jetty","waterfront":"Waterfront","avenue":"Downtown","minimap":true,"minimapDrawnPixels":30952}}
BOTH   {"track":{"calls":110826,"multiReseat":0,"maxReseats":0,"worst":null}}
BEFORE {"alloc":{"simulatedSeconds":10,"kbPerSimSecond":6, ...}}   AFTER {"alloc":{"simulatedSeconds":10,"kbPerSimSecond":3, ...}}
```

Notes on reading them:
- *carjack after*: the stolen car is no longer a unit, and **unit 35 was dispatched** and sees the player sitting in
  the stopped car, which is correct, so `seenFrames40s` stays 2400. Heat 1 → 6 is one `collision` crime: unit 35
  shoved the parked stolen cruiser into another car and the player was charged (see still open).
- *behind after*: the shots carry on past the player and hit whoever is in front (ped 8, ped 0), never the one behind.
- *alloc*: both trees are tiny; the gait rewrite did not add heap churn.

`node tools/probe_density.mjs` (stricter version), identical in both trees, since the gait does not touch movement:

```
{"point":[32.2,150],"peds50":18,"movingPeds50":16,"pedsOnScreen":6,"pedsBestView":7,"movingVehicles120":18,"props60":78,"violations":0,...}
{"point":[-112.5,-160],"peds50":18,"movingPeds50":12,"pedsOnScreen":4,"pedsBestView":5,"movingVehicles120":20,"props60":87,"violations":0,...}
{"point":[127.5,-65],"peds50":18,"movingPeds50":16,"pedsOnScreen":2,"pedsBestView":6,"movingVehicles120":16,"props60":70,"violations":0,...}
{"point":[150,217],"peds50":18,"movingPeds50":14,"pedsOnScreen":0,"pedsBestView":7,"movingVehicles120":20,"props60":59,"violations":0,...}
{"point":[-60,290],"peds50":18,"movingPeds50":13,"pedsOnScreen":2,"pedsBestView":12,"movingVehicles120":12,"props60":24,"violations":0,...}
```

The `pedsOnScreen: 0` at [150, 217] is the case P1 is about: the staged camera faces the water, and the old probe
passed with nobody in view. Measured honestly, PASS 3's density claim **holds**: 12–16 live walkers within 50 m and
5–12 people in the best view at every point.

Gate A/B (same session, before then after, back to back; `pass` judged by the new gate):

```
before --headed           {"fps":59,  "calls":171,"triangles":500142,"frameMs":7.94,"mode":"headed","pass":true}
after  --headed           {"fps":60,  "calls":171,"triangles":500142,"frameMs":8.31,"mode":"headed","pass":true}
before --headed --wanted 4 {"fps":58.5,"calls":349,"triangles":617800,"frameMs":7.64,"mode":"headed","wanted":4,"units":3,"helicopter":true,"pass":true}
after  --headed --wanted 4 {"fps":60,  "calls":221,"triangles":425168,"frameMs":8.5, "mode":"headed","wanted":4,"units":3,"helicopter":true,"pass":true}
before (headless)          {"fps":24.8,"calls":171,"triangles":500144,"frameMs":7.82,"mode":"headless","pass":true}
after  (headless)          {"fps":24.3,"calls":171,"triangles":500144,"frameMs":6.56,"mode":"headless","pass":true}
before --wanted 4          {"fps":25.5,"calls":221,"triangles":417225,"frameMs":8.14,"mode":"headless","pass":true}
after  --wanted 4          {"fps":20.7,"calls":221,"triangles":424936,"frameMs":7.86,"mode":"headless","pass":true}
```

The gate drive runs on wall-clock rAF, so the traffic in view differs between runs. The 349-call peak in the
before tree's wanted-4 run is one frame of that and cannot be compared one-to-one. Headless fps stays at
this host's rAF cap (~20–26 fps even for a blank page, see PASS 1), as in every earlier pass.

## 5. Final runs on the final code (sequential, one process at a time)

```
node tools/probe_density.mjs   -> pass (exit 0); lifecycle 18/34 -> 18/34, resources {objects 30, geometries 228, textures 39} before = after, minMoving120 14
node tools/probe_combat.mjs    -> pass (exit 0); 10/10 hits, 156 damage, reload 1.35 s, heat +40, cruiser 100 -> 82, pickup +12  (identical to PASS 4)
node tools/probe_police.mjs    -> pass (exit 0); 2 units pursuing, wall/kerb frames 0, chase lost 11.62 s, cleared 22.98 s     (identical to PASS 4)
node tools/probe_review.mjs    -> the AFTER lines in section 4, 0 console errors, 0 off-site
node tools/shots.mjs  x2       -> all six SHA-256 identical between the two runs; max 346 calls / 584 128 triangles per staged view
```

Gates (load average in brackets):

```
[6.99] node tools/gate.mjs                     {"fps":24.7,"calls":171,"triangles":500142,"geometries":158,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":8.7,"fpsCapacity":114.9,"seconds":10,"mode":"headless","pass":true}
[6.80] node tools/gate.mjs --headed            {"fps":60,"calls":171,"triangles":500142,"geometries":158,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":7.62,"fpsCapacity":131.2,"seconds":10,"mode":"headed","pass":true}
[6.99] node tools/gate.mjs --wanted 4          {"fps":23.4,"calls":221,"triangles":415422,"geometries":192,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":7.06,"fpsCapacity":141.7,"seconds":10,"mode":"headless","wanted":4,"units":3,"sirens":3,"helicopter":true,"pass":true}
[6.61] node tools/gate.mjs --headed --wanted 4 {"fps":55.5,"calls":221,"triangles":425168,"geometries":192,"textures":39,"consoleErrors":0,"offsiteRequests":0,"frameMs":9.16,"fpsCapacity":109.2,"seconds":10,"mode":"headed","wanted":4,"units":3,"sirens":3,"helicopter":true,"pass":true}
```

Headed wanted 4 passes, but only just (55.5) under this load. The A/B run an hour earlier gave 60 for the same code.
Frame cost is 7–9 ms (109–142 fps of capacity), so the margin is the host's, not the game's.
Draw calls ≤ 221 in the gate drive and ≤ 346 in the staged views (< 500). Triangles ≤ 584 128 (< 900 000).
0 console errors and 0 off-site requests everywhere. Three.js comes only from `game/vendor/three.min.js`; the
minimap is plain 2D canvas.

Screenshots changed from the PASS 4 set, as expected: they now show the minimap and the district label
(`03-harbour-jetty.jpg` reads HARBOUR JETTY), and the walkers use the new gait. `05` and `06` were checked at full size.

## 6. Summary

| Item | Was | Now | Verified by |
|---|---|---|---|
| Stolen police cruiser stays a unit (D1) | still a unit in `pursue`; its own car saw the driver 2400/2400 frames; wanted could not decay | detached; 0 frames; replacement unit 35 dispatched | `probe_review` carjack |
| Cruiser light bar (D2) | model bar never lit (0); duplicate floating bar (1) | model bar lit (1); 0 floating bars; scene objects 33 → 30 | `probe_review` siren; `probe_density` lifecycle resources |
| Stale sighting after wanted clears (D3) | `lastSeen` (32.2, 150) survived | `null` | `probe_review` stale |
| Shooting backwards from the camera ray (D4) | 3 of 3 shots hit the pedestrian behind the shooter | 0 of 3 | `probe_review` behind |
| Pedestrian walk/idle (D5) | hip detachment 0.268 m; stance foot slip 1.174 m/s; 3 % of idle frames move | 0.009 m; 0.049 m/s; 97 % | `probe_review` gait; screenshots 05/06 |
| District label (D6) | "Downtown" on jetty and waterfront | Harbour Jetty / Waterfront / Downtown | `probe_review` hud; screenshot 03 |
| Minimap (D7) | none | rotating minimap, 30 952 drawn px, police blips, search area | `probe_review` hud; screenshots 01–06 |
| Density probe honesty (P1) | `peds50` = 18 by construction; passed with 0 peds on screen | asserts `movingPeds50 ≥ 8` (12–16) and `pedsBestView ≥ 3` (5–12) | `probe_density` |
| Gate verdict (P2) | printed only, exit 0 | `pass` field, exit 1 on failure | `gate.mjs` output |
| `_track` unbounded loop (PASS 2 "TRACK_LOOP") | suspected | not a defect: 0 reseats in 110 826 starts | `probe_review` track |
| Per-frame heap churn | suspected (180 `Color`/step, `mat4` in prop compaction) | not a defect: 2–6 KB/s total in both trees | `probe_review` alloc |
| Scripted-control clobber (PASS 2) | claimed fixed | holds: 62.9 km/h at full scripted throttle | `probe.mjs` driveTest |
| Wanted-4 frame cost | 51–62 ms in one gate run | 7.1–9.2 ms; the spike was host load (A/B same in both trees) | gate A/B, CPU profile |
| Wallet / vendor size | claimed correct | correct (valid base58, matches anchor; 748 760 bytes, r187) | shell checks above |

## 7. Still open

- **README badge owner `Lolod17`.** It cannot be verified offline: there is no git remote, and the local git user is `Lolod`. Needs the operator.
- **Player charged for a collision they did not start.** A cruiser shoving the player's parked car into another car
  counts as the player's `collision` crime (+5 heat; seen in the carjack run). Fixing it needs contact history (who
  was pushed by whom), and I did not want to rework crime attribution in a repair pass.
- **Facade repetition, street-edge depth, wet-road reflection.** Not done. `buildings.js`, `roads.js`,
  `materials.js`, `textures.js` and `lightmap.js` were not read line by line in this pass. The changes would touch
  the look of every screenshot and the frame budget, and they need their own pass with before/after captures.
- **`props60` in the density probe** is still a count of a static placement list, so it cannot fail. It is reported,
  and labelled as such here.
- **Headless fps** stays below 55 on this host (rAF cap, see PASS 1). The requirement is judged headed.
- **The `_track` guard** can in theory loop forever (it resets after each reseat). It is unreachable from any of
  110 826 tested start states, so I left it unchanged rather than alter the traffic code without a failing case.
- **PASS 4 known limits** are unchanged: units never despawn, there is no busted-in-car, and the arrest release uses the nearest safe point.
- **BUILD-NOTES has no PASS 2 section.** What PASS 2 changed is only inferable from the code.
