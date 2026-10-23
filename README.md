# Sakasa (逆さ, "upside down")

**Your room is the level; you choose which way is down.** Point at a real surface in your room (floor, wall,
table, ceiling) and pinch: it becomes "down", and everything virtual falls onto it, rolls, stacks and bounces off
your real geometry. Guide a glowing marble into its ring in as few flips as you can. Twenty puzzles in three sets,
a daily puzzle, and a sandbox. Hands only.

Entry for the **Meta VR Start Developer Competition 2026**: New Experience division, Gaming track. Built with the
Immersive Web SDK (IWSDK 1.1.0-rc.2, WebXR, `immersive-ar`), Havok physics through IWSDK, and UIKitML panels.
Conceived and built after Sep 24, 2026 in a fresh repository.

> Status: runs and is tested end to end in the IWER emulator: hands-only Quest 3 flow 20/20, gaze + pinch Glasses
> flow 14/14, solver and Havok agree on 168/168 puzzles across the 8 IWER rooms, replays are bit-identical, M1 budget
> passes (CPU p95 2.2 ms, 86 draw calls). **Not yet run on a headset**: frame rate, real hand tracking and real
> plane detection are unverified on hardware. See [TESTING.md](TESTING.md).
>
> Emulator clips (test recordings): `grokbot/videos/sakasa/sakasa-whoa-ceiling-wall-floor.mp4`,
> `sakasa-puzzle-p14.mp4`, `sakasa-glasses-gaze-pinch.mp4`.

## What it does

| | |
|---|---|
| **Point, pinch, fall** | The hand ray (Quest) or eye gaze (Meta VR Glasses) hovers a surface: a grid and chevrons show which way things would fall. Pinch and release flips gravity (Havok world gravity, set at runtime) toward that surface, with a short slow-motion ramp and a synthesised "whoomp". |
| **Pinch-hold preview** | While the pinch is held, dots trace where the marble would travel. Release commits; pointing away cancels. |
| **Room as level** | WebXR planes (and labelled meshes) become an axis-aligned room model, static colliders and pinchable surfaces. Labels are optional: floors, walls and ceilings are also found from orientation, height and size. Missing ceiling or walls get labelled paper stand-ins; no planes at all gives a paper room on a virtual table. |
| **Solver-validated puzzles** | `packages/core` generates each puzzle *for this room* from a seed and proves it solvable at its par with a breadth-first search over flips (up to 4). A flip is modelled as a sphere sweep against radius-inflated boxes; glancing edge hits are flagged ambiguous and never used. Puzzles: 20 in 3 sets (Fall, Sideways, Upside down), a daily seed per UTC day, stars by flips vs par. |
| **Sandbox** | 12 bodies (paper cubes, crumpled paper balls, paper rolls, the marble). Pinch-hold a toy to grab it with a distance grab; release throws it. |
| **Juice** | Marble trail and point light, gravity-aligned blob shadows (they swing onto the wall when gravity does), impact sparks, HRTF-panned synthesised bounces pitched by surface, solve chime, slow motion on flips and on the solve. |
| **Menus** | Palm-up wrist menu (pauses the room), or the HUD menu button (the gaze path on Glasses): puzzle picker, daily, sandbox, gentle gravity, glasses mode, sound, rescan, resume, exit. |
| **Glasses mode** | Auto-on when a gaze input source appears. HUD moves into the centre of the 74 x 68 degree view, a surface must be gazed at for 400 ms before a pinch flips it (our own dwell; IWSDK's `dwellWindowSeconds` is a filter, not dwell-to-click), buttons are at least 5.8 cm tall at 75-85 cm (over 4 degrees). A FoV-aware hint says where "down" is when that surface is out of view. |
| **Comfort** | The real room never moves; only virtual objects fall. Seated, everything reachable by pointing. "Gentle gravity" option. |

### Spec corrections applied (VR judge, Oct 24)

1. **Quest 3 has no eye tracking**, and IWSDK rc.2 does not fall back to head direction. Onboarding on Quest is
   therefore "point at the ceiling (hand ray) and pinch"; eye gaze + pinch is used only where a gaze input source
   exists (Meta VR Glasses). No head-gaze reticle is shipped.
2. **Dwell** is implemented in `src/game/surface-system.ts` (`DWELL_SECONDS = 0.4`).
3. **Runtime gravity change works** in rc.2 (`PhysicsSystem.config.gravity` signal); the per-body force fallback was
   not needed. Sleeping bodies are woken with a tiny impulse on each flip; released grabbed bodies are woken with
   their release velocity.
4. **Planes may carry no labels**: classification falls back to orientation + height + size, and furniture also
   comes from `XRMesh.semanticLabel`.
5. **Quest WebXR defaults to 72 fps**: the frame budget is 13.9 ms; the CPU gate below is far tighter.
6. **Best First Five Minutes**: onboarding is three pinches with icon glyphs and two-word captions, no text wall.

### Not built yet (from the spec)

- Two-hand "pull apart to slow time": slow motion currently plays automatically on every flip and on the solve.
- Placing pieces from a tray (pinch-grab and snap to a plane): puzzles place their own paper blocks.
- Persistent anchors and the 15-degree twist for pieces.

## Repository layout

```
packages/core      pure TypeScript: room model, sweeps, BFS solver, seeded puzzle generator (Vitest)
packages/app       the IWSDK app (Vite + IWSDK CLI), e2e scripts in packages/app/e2e
packages/landing   static landing page (no build step; data.js generated from test artefacts)
TESTING.md         real test counts and measurements
ASSETS.md          every asset and its licence (all procedural or synthesised, fonts OFL)
HACKATHON_SUBMISSION_FORM.md   Devpost draft mapped to the four judging criteria
```

## Run it

Requirements: Node 20.19+ (tested on Node 26.5), npm.

```sh
cd packages/core && npm install && npm test        # unit tests
cd ../app && npm install
npm run typecheck
npx iwsdk dev up                                     # dev server + managed Chromium with the IWER emulator
```

In the emulator: press **Enter XR**, switch the input to **hands**, look around for a second, point at the
ceiling and pinch. Agent mode (headless) is `npx iwsdk dev up --ai-mode agent --allow-browser-automation`, which the
e2e scripts use.

### On a Meta Quest 3 / 3S (local, no hosting)

1. Enable developer mode on the headset and connect it over USB (`adb devices` lists it).
2. `cd packages/app && npx iwsdk dev up --no-open` (serves HTTPS on port 8081 with a local certificate).
3. `adb reverse tcp:8081 tcp:8081`
4. In the Quest browser open `https://localhost:8081/`, accept the certificate warning, press **Enter your room**.
   Allow hand tracking and spatial data. If the room has never been scanned, run Space Setup first.
5. Put the controllers down: the hands take over. Point at the ceiling and pinch.

Alternative on the same Wi-Fi: open the `data.runtimeUrls.network` URL from `npx iwsdk dev status` on the headset.
`iwsdk.config.json` keeps `handTracking`, `planeDetection`, `meshDetection`, `anchors` and `gazeTracking` optional,
so the session starts on Quest 3 (no eye tracking) and on Meta VR Glasses.

For the competition the app must be a public URL (GitHub Pages / Vercel). Nothing is deployed from this repo;
`npm run build` in `packages/app` produces `dist/` for whoever hosts it.

## Tests

See [TESTING.md](TESTING.md) for counts and numbers. Summary of the suites:

- `packages/core`: Vitest unit tests (room model, sweeps, solver, generator, every shipped puzzle solvable in 5
  synthetic rooms and in the 8 captured IWER rooms, determinism).
- `packages/app/e2e/hands-quest.mjs`: hands-only completion in the Quest 3 profile, no controller, no debug hooks.
- `packages/app/e2e/hands-glasses.mjs`: gaze + pinch completion in the Meta VR Glasses profile, FoV fit, gaze fallback.
- `packages/app/e2e/agreement.mjs`: every puzzle's solver solution replayed through Havok in all 8 IWER rooms.
- `packages/app/e2e/determinism.mjs`: fixed-timestep replays of a flip script are bit-identical across page loads.
- `packages/app/e2e/perf.mjs`: the M1 frame-time / draw-call budget gate.

## Licence

MIT, Copyright (c) 2026 Nivesh Gajengi. Fonts: SIL OFL 1.1 (see ASSETS.md).
