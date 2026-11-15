# Testing

The emulator results below were re-measured on **2026-11-15** (after the Nov 15 headset-judge pass:
15 cm marble, 18 cm toys, the bigger flip, readable panels) on the development Mac, in the IWER
emulator (IWSDK 1.1.0-rc.2 agent mode: headless Playwright Chromium with hardware GPU via Metal).
Screenshots go to `e2e-out/` (not committed).

**Unverified on hardware:** nothing here ran on a Quest 3/3S or on Meta VR Glasses. Real hand-tracking jitter,
real plane detection in an unseen room, Quest frame rate (72 Hz target, 13.9 ms budget) and real eye-gaze accuracy
need a device pass.

## Summary

| Suite | Result (2026-11-15) | How to run |
|---|---|---|
| Core unit tests (Vitest) | **54 / 54 pass** (3 files) | `cd packages/core && npm test` |
| Core TypeScript | **PASS**, exit 0 | `cd packages/core && npm run typecheck` |
| App TypeScript | **PASS**, exit 0 | `cd packages/app && npm run typecheck` |
| Hands-only completion, Meta Quest 3 profile | **20 / 20 checks pass** | `cd packages/app && node e2e/hands-quest.mjs` |
| Gaze + pinch completion, Meta VR Glasses profile | **14 / 14 checks pass** | `node e2e/hands-glasses.mjs` |
| The flip, made big (beacon, slow motion, tilt cue, rain, sizes) | **14 / 14 checks pass** | `node e2e/flip-fx.mjs` |
| Solver vs Havok agreement, 8 IWER rooms x 21 puzzles | **168 / 168 solved by the solver's flips** | `node e2e/agreement.mjs` |
| Deterministic physics replays | **3 / 3 runs bit-identical** (12 bodies, max difference 0 m) | `node e2e/determinism.mjs` |
| M1 frame-time / draw-call budget | **PASS**: CPU p95 2.1 ms, 98 draw calls, 35,548 triangles | `node e2e/perf.mjs` |
| Landing page (375 / 768 / 1280 px) | **no horizontal overflow, 0 console errors** | `cd packages/landing && node scripts/check.mjs` |
| Production build | succeeds (dist 5.7 MB) | `cd packages/app && npm run build` |

## Core unit tests (54)

`packages/core/test/core.test.ts` (36), `packages/core/test/iwer-rooms.test.ts` (9) and
`packages/core/test/feel.test.ts` (9, Nov 15).

- Feel (Nov 15): the slow-motion profile holds at 0.15x then ramps monotonically to 1x and stays under half
  speed for more than 0.7 s; the ghost-room tilt cue tips the new floor toward the old one for all 24
  perpendicular flips, uses a perpendicular axis for opposite flips, peaks at 12 degrees (4.2 with gentle
  gravity) and settles to level; the toy pile fits a 1.1 x 0.55 m table without overlaps and stacks on a tiny
  support; room models carry the 7.5 cm marble radius (3 cm on a tabletop). Every older solver and puzzle
  test passes with the bigger marble.

- RNG determinism; the daily seed changes per UTC day and not within one.
- Sweeps: falling to the floor, landing on a block, flying sideways to a wall, stopping against a block side,
  sliding past an out-of-lane block, glancing edge hit reported ambiguous, sliding along a face it rests on,
  no-move when already resting, overlap detection, axis ray casts for shadows.
- Solver: shortest flip sequence + replay, unreachable goal returns null, deterministic exploration.
- Room model: box room from planes (real walls, floor, ceiling, table), frame alignment in a room rotated 23
  degrees (round trip world/room), labelled paper ceiling, virtual tabletop with no planes, paper wall for a
  missing wall, **unlabelled planes classified by orientation, height and size** (same box as the labelled room),
  furniture from labelled meshes, no furniture under the viewer, whole lattice cells wall to wall.
- Puzzles: 20 shipped in 3 sets (6 + 7 + 7) with distinct seeds; stars vs par; **every shipped puzzle is
  solvable within 4 flips at its par in each of 5 synthetic rooms** (small study, living room with the viewer
  off-centre, 6.5 x 7 m loft rotated 23 degrees, no ceiling, no planes); target par met in at least 90% of
  real-size rooms; **daily puzzles for 60 days solvable in every synthetic room**; generation and solving
  identical over 3 runs; the same seed produces a different level in every room; set 3 mostly needs the ceiling.
- IWER room fixtures (the exact planes and meshes IWSDK reported in the 8 emulator rooms, captured by
  `e2e/agreement.mjs`): every shipped puzzle plus a daily generates and verifies at its par in each room.

## Hands-only, Meta Quest 3 profile (20 checks)

`packages/app/e2e/hands-quest.mjs`, report `e2e/reports/hands-quest.json`. IWER hand input mode; every action is
the emulated right hand's ray plus a pinch (`xr look-at` + `xr select`), or a hand pose for the wrist menu. No
controller, no debug hooks, storage cleared first.

1. Cold load builds the room from planes (Meta Quest 3, 15 planes, 5 x 2.7 x 5.8 m)
2. Onboarding starts
3. Pinch ceiling flips gravity up (the table of toys falls up)
4. Pinch a wall flips gravity sideways
5. Pinch floor brings it home
6. Play button starts puzzle 1
7. Puzzle 1 solved with 1 pinch (par 1)
8. Puzzle 1 earns 3 stars at par
9. Next button loads puzzle 2
10. A flip counts
11. Undo restores the marble and the flip count
12. Reset puts the marble back on its start
13. Puzzle 2 solved with 1 pinch (par 1)
14. Palm-up opens the wrist menu and pauses (time scale 0)
15. Menu Sandbox button opens the sandbox
16. Pinch-hold on a toy grabs it (DistanceGrabbable), release throws it
17. HUD menu button opens the menu
18. Resume closes the menu and unpauses
19. Exit ends the XR session
20. Zero console errors

First payoff: **1 pinch** after the room is built (about 3 s including the CLI's aiming round trip). The whole
run used 17 hand actions.

## The flip, made big (14 checks, Nov 15)

`packages/app/e2e/flip-fx.mjs`, report `e2e/reports/flip-fx.json`. Real hand pinches in the Quest 3 profile; an
in-page sampler records what is drawn every 30 ms, because a CLI round trip is slower than the effects.

1. The onboarding beacon marks the ceiling on step 1 (at ceiling height)
2. 12 bodies in the toy pile
3. Marble is 15 cm across
4. Paper cube is 18 cm
5. HUD is at least 0.64 m wide (18 mm body cap height at 1 m)
6. Ceiling pinch: slow motion holds below 0.5x for at least 0.6 s (measured: minimum 0.15x, 809 ms)
7. Ceiling pinch: time returns to 1x
8. Ceiling pinch: the ghost-room tilt cue shows, then clears (visible 0 to 1,559 ms after the flip)
9. Ceiling pinch: gravity rain (0 to 2,218 ms) and the slow-motion read-out (dial and edge glow) show
10. The beacon moves to a wall on step 2
11. Menu Tilt cue toggles off
12. With Tilt cue off the ghost room never shows, the rain still does
13. Menu Tilt cue toggles back on
14. Zero console errors

## Gaze + pinch, Meta VR Glasses profile (14 checks)

`packages/app/e2e/hands-glasses.mjs`, report `e2e/reports/hands-glasses.json`. The script switches
`dev.emulator.device` to `metaVRGlasses` and restores it. Gaze aims (`xr look-at` with `device: gaze`), a hand
pinch commits after the gaze has rested at least 400 ms.

1. Glasses profile with gaze granted (`gaze-tracking`, `eye-tracking` in the enabled features)
2. Glasses mode turns on automatically from the gaze input source
3. HUD corners inside the glasses field of view with a 3 degree margin: horizontal -18.9 to 18.9 degrees,
   vertical -21.4 to 4.2 degrees (limits 37 left/right, 25 up, 43 down; the HUD is now 0.56 m wide)
4. Gaze at ceiling + pinch flips up
5. Gaze at a wall + pinch flips sideways
6. Gaze at floor + pinch brings it home
7. Gaze + pinch on Play starts puzzle 1
8. Puzzle 1 solved with gaze + pinch
9. Gaze + pinch on the HUD menu button opens the menu
10. Menu corners inside the field of view (-19.2 to 19.2, -27.5 to 19.5 degrees; menu now 0.5 m wide)
11. Menu Sandbox by gaze
12. With gaze disconnected the hand ray still flips (fallback)
13. Exit ends the session
14. Zero console errors

Findings fixed on the way:
- UIKit leaves some interaction meshes at an identity world matrix; IWSDK's gaze cone-caster unions every
  descendant's box, so the HUD's candidate box reached down to the floor origin and swallowed gaze rays near the
  head. Strays are now flagged `iwsdkRuntimeOnly` (`UiSystem.sanitizeGazeBounds`).
- Observation (not fixed, emulator only so far): in the living room, emulated gaze aimed at surfaces between
  about 22 and 35 degrees of elevation did not resolve any target, while the hand ray did. Looking higher works,
  so the script gazes at the ceiling at 45 degrees. Re-check on real glasses.
- Not automated: a pinch *before* the 400 ms dwell is rejected (logged as `flip-blocked`). CLI round trips are
  slower than 400 ms, so this negative case cannot be driven reliably from the CLI.

## Solver vs Havok agreement (168 / 168)

Nov 15 re-run with the 15 cm marble (radius 0.3 of a cell, was 0.24): **168 / 168** again, all 8 rooms 21 / 21.
The headless page crashed under the Mac's memory pressure after 5 rooms; the last 3 rooms were re-run in a
fresh browser and the two reports merged (`e2e/reports/solver-havok-agreement.json` says so).

`packages/app/e2e/agreement.mjs`, report `e2e/reports/solver-havok-agreement.json`. For each IWER room, each of
the 20 shipped puzzles and the daily puzzle is generated *in that room*, then the solver's flip sequence is applied
to the live Havok simulation (debug flip, real physics) and the marble must come to rest in the goal ring.

| IWER room | Room model | Planes | Solved |
|---|---|---|---|
| sunlit_living_room | 5.0 x 2.7 x 5.8 m | 15 | 21 / 21 |
| home_office | 3.5 x 2.7 x 4.0 m | 13 | 21 / 21 |
| conference_room | 4.5 x 2.75 x 3.57 m (far wall 5.4 m away: paper wall at 3 m) | 12 | 21 / 21 |
| open_office | 8.0 x 3.0 x 7.0 m | 17 | 21 / 21 |
| kitchen | 5.0 x 2.7 x 5.0 m | 14 | 21 / 21 |
| bedroom | 4.5 x 2.7 x 4.5 m | 14 | 21 / 21 |
| music_studio | 5.0 x 2.7 x 4.5 m | 11 | 21 / 21 |
| open_studio | 6.0 x 2.7 x 6.0 m | 9 | 21 / 21 |

The first run (living room only) solved 17 / 21. The misses showed two model errors, both fixed in
`packages/core/src/sweep.ts` with tests: a start resting 1.5 cm past a table edge (Havok rolls it off; such spots
are now ambiguous), and a hit 4 cm below a shelf top (Havok rounds box edges, so a clean stop now needs the centre a
full radius inside the face). Quantised positions that penetrate by a fraction of a millimetre count as contact.

## Deterministic replays (3 / 3)

`packages/app/e2e/determinism.mjs`, report `e2e/reports/determinism.json`. Three fresh page loads; the 12 sandbox
bodies are put back on their exact home spots, ECS is paused, then the same script runs with `ecs step` at a fixed
1/72 s: 30 steps, flip up + 140, flip -X + 140, flip -Z + 140, flip down + 160. All three runs leave every body at
the same position (maximum difference 0 m; Nov 15 run with the 15 cm marble: marble at -2.1948, 0.2179, -3.325).

## M1 frame-time budget

`packages/app/e2e/perf.mjs`, report `e2e/reports/perf.json`. Meta Quest 3 profile, living room, 12 bodies, four
gravity flips pinched by the emulated hand over about 10 s, 1,017 frames (viewport 1280 x 720, IWER stereo off).
CPU time per frame = ECS update + render submit (`performance.now()` around both).

| Measure | Result | Gate |
|---|---|---|
| CPU ms per frame | p50 1.4, **p95 2.1**, max 4.2 | p95 <= 4.0 |
| ECS update | p50 0.9, p95 1.4 | |
| Render submit | p50 0.5, p95 0.8 | |
| Draw calls per view | **98** max (p95 94) | <= 100 |
| Triangles per view | **35,548** max | <= 250k |

Nov 15: the new effects first measured 104 draw calls (fail). Fixes: the beacon's ring, ripple and glow are
one shader quad; the slow-motion dial is drawn inside the edge-glow quad; the progress bar is one track and
one fill; the wrist-compass arrow is one merged mesh. The first run also had one 80 ms frame on the first
flip (new shaders compiling); every effect is now drawn invisibly for three frames when the room is built.

The first measurement was 122 draw calls (fail). Fixes: idle surfaces skip drawing (raycasts still hit them),
transparent double-sided materials render in one pass, toy edge lines dropped, chevrons merged. Caveat: a desktop
CPU is several times faster than Quest 3 and GPU time is not measured; this is a relative proxy. In stereo on a
headset the per-view draw count is the number that matters (multiview) or doubles (two passes).

## Emulator clips (test recordings)

Recorded by `packages/app/e2e/record-clips.mjs` into `grokbot/videos/sakasa/`: a real-time DevTools screencast of
the managed IWER page, 60 frames per second captured, encoded at 30 fps 1280 x 720 with a one-line caption bar.
Input is the emulated hands or gaze driven through IWER (aim and pinch), no cuts, no speed changes.

| File | Length | Content |
|---|---|---|
| `sakasa-whoa-ceiling-wall-floor.mp4` | 27 s | Quest 3 profile, hands only: pinch the ceiling (the table of toys falls up), the wall (everything slams sideways, shadows swing onto the wall), the floor |
| `sakasa-puzzle-p14.mp4` | 27 s | Puzzle 14 loaded for the clip (stated in the caption), then solved by hand in 3 flips at par (-X wall, ceiling, -Z wall) |
| `sakasa-glasses-gaze-pinch.mp4` | 22 s | Meta VR Glasses profile with the field-of-view mask: gaze at the ceiling and a wall, pinch to flip |

## Not covered / known gaps

- No headset run (see the top of this file).
- Two-hand "pull to slow time" from the spec is not built; slow motion plays automatically on each flip and on
  the solve.
- Real Quest plane labels may be missing; the classifier handles that (unit tested), but real-room quality is
  unverified.
- `THREE.Clock` and `SVGLoader` deprecation warnings come from inside the IWSDK/UIKit packages (warnings, not
  errors).
