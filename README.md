# BREAKWATER v2

An original open-world crime game set in a harbour city. You play a night-shift courier: explore the downtown district on foot, take a car and drive it through live traffic, dodge the police, run side jobs, and play a five-mission story with two endings. The clock runs from the dusk start through night, dawn and day, and the weather turns from clear to overcast, rain or fog. It runs in desktop Chrome from plain static files with three.js; every model, texture, sound and radio track is made in code.

[![make.fun bounty gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Lolod17/breakwater-v2/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Lolod17/breakwater-v2/reward.svg)](https://make.fun/bounty/gta6-01)

## Run it

```sh
node serve.ts             # serves game/ on http://127.0.0.1:8081/  (same as: node main.ts --serve)
node serve.ts --port 9000
```

`node main.ts` with no arguments is the hand-in program: it copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json`. To try it outside the grader: `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`.

You need Node 22 and nothing else: no `npm install`, no build step, and no network at runtime (three.js is vendored in `game/vendor/`). Open the printed URL in desktop Chrome and click to play. **Continue** on the title screen loads the autosave and **Start new story** begins a new game. `?seed=N` changes the seeded city layout, traffic and weather.

## Controls

| On foot | |
|---|---|
| WASD, mouse | move, look |
| Shift / Space | sprint / jump |
| Right mouse or Q | aim |
| Left mouse or X (while aiming) | fire |
| R | reload |
| F | enter a car (or take it from its driver) |
| E | interact: doors, mission markers, side-job spots |
| P | photo mode |
| Esc | release the mouse |
| F3 | performance readout |

| In a car | |
|---|---|
| W / S | throttle / brake and reverse |
| A / D | steer |
| Space | handbrake |
| H | horn |
| R or . / , | next / previous radio station |
| G | open the customs menu (on the turntable at Breakwater Customs) |
| E | start a side job at its spot |
| F | get out |

Story choices are made with **1** and **2**. In menus, ↑↓ or W/S move, Enter selects and Esc leaves.

## What there is to do

- **Story.** Five missions (THE PICKUP, HOT CARGO, NO WITNESSES, THE ESCORT, THE LAST ROUTE) with two endings. Walk onto the red marker for a briefing, press E to start, and E again to retry after a fail.
- **Side jobs.** Three spots show as blips on the minimap: the TAXI RANK (needs a car; the fare is metered on distance and time), the COURIER DEPOT (on foot or driving; deliver before the timer runs out) and the STREET RACE (needs a car; checkpoints in order, beat the rival's time). Each one starts with E.
- **Harbour tags.** Twenty glowing gold tags are hidden on the pavements and the jetty. Walk or drive through one to collect it for $50.
- **Achievements.** Eleven, for example first fare, winning a race, finishing the story, finding every tag, or sleeping at the safehouse. Each one shows a toast when you unlock it.
- **Interiors.** Five lit doors open with E: the SAFEHOUSE (unmarked, on the waterfront street west of the start), TIDELINE clothing, HARBOUR HARDWARE, the BREAKWATER CUSTOMS workshop (the roller door) and THE SALT LANTERN bar. The safehouse bed sleeps until morning (or for 8 hours), heals you and saves. It also clears up to two wanted stars if no police saw you go in. The wardrobe wears clothes you bought. The shops sell clothing and tools; prices depend on your standing with the district's faction.
- **Customs.** Stop a car on the turntable at BREAKWATER CUSTOMS (waterfront street, a block south-east of the start) and press G. You can change paint and finish, wheels, spoiler, bumpers, ride height, tint, headlight and underglow colour, and livery. The car you customise becomes your car and is saved with its parts.
- **Police.** Crimes raise up to five wanted stars. Cruisers patrol and give chase, and a helicopter joins at four stars. Stay out of sight and the stars fade.
- **Radio.** Eight stations synthesised in the browser: BREAKWATER FM (synthwave), LOW TIDE (lo-fi), DOCKSIDE 104 (house), THE NIGHT SHIFT (soul), TIDEWATER AMBIENT, PIER TALK (talk show in chatter beeps), FOUNDRY 107 (industrial) and HARBOUR NEWS 24. The radio plays only in a car.
- **Day, night and weather.** The game starts at dusk (19:20) and one game minute takes 20 real seconds. The sun, sky, fog, street lamps, lit windows and exposure follow the clock. Every few game hours the weather changes. Rain draws streaks and leaves the roads wet until they dry out.
- **Photo mode.** P freezes the world and frees the camera:
  - WASD to fly, Space/E up, Q/Ctrl down, Shift for speed.
  - Mouse or arrow keys to look, Z/C to roll.
  - Wheel or -/= for field of view, [ ] for depth of field.
  - 1–4 or T for filters, H hides the panel.
  - Enter saves a PNG; P leaves photo mode.

Progress autosaves: money, story progress, your car and its parts, the clock and weather, inventory, outfit, faction standing, tags found and achievements.

## For developers

- `game/src/` holds the game (ES modules, no build step). `serve.ts` is the local static server and `main.ts` the hand-in program.
- `tools/` holds the headless-Chrome tooling (raw CDP over Node 22's WebSocket, no dependencies):
  - `node tools/gate.mjs [--headed] [--seconds=20]`: the performance budget (fps ≥ 55 headed, < 500 draw calls, < 900k triangles, no console errors, no off-site requests).
  - `node tools/probe_*.mjs`: one probe per system. Each prints one JSON line and exits 0 only when every check passes.
  - `node tools/shots_final.mjs`: regenerates the four hand-in screenshots in `screenshots/` (each staged from a fresh load, scene-checked, byte-identical run to run).
  - `node tools/probe_longrun.mjs [--headed]`: cold load time, then 3 minutes of play checked for leaks (entities, scene geometries/textures, heap) and for errors and failed or off-site requests.
  - `node tools/shots.mjs`: the earlier development shots (archived in `tools/screenshots-archive/`).
- `tools/BUILD-NOTES.md` and `tools/REVIEW.md` record what each pass built and measured.

## Licence

MIT. See [LICENSE](LICENSE).
