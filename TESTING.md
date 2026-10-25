# Testing

Everything below was run on Oct 24, 2026 and reverified on Oct 25, 2026 on the development Mac, in the IWER emulator (IWSDK 1.1.0-rc.2 agent mode:
headless Playwright Chromium with hardware GPU via Metal). Zero skipped tests. JSON reports are committed in
`packages/app/e2e/reports/`; screenshots go to `e2e-out/` (not committed).

**Unverified on hardware:** nothing here ran on a Quest 3/3S or on Meta VR Glasses. Real hand-tracking jitter,
real plane detection in an unseen room, Quest frame rate (72 Hz target, 13.9 ms budget) and real eye-gaze accuracy
need a device pass.

## Summary

| Suite | Result | How to run |
|---|---|---|
| Core unit tests (Vitest) | **45 / 45 pass** (2 files) | `cd packages/core && npm test` |
| Hands-only completion, Meta Quest 3 profile | **20 / 20 checks pass** | `cd packages/app && node e2e/hands-quest.mjs` |
| Gaze + pinch completion, Meta VR Glasses profile | **14 / 14 checks pass** | `node e2e/hands-glasses.mjs` |
| Solver vs Havok agreement, 8 IWER rooms x 21 puzzles | **168 / 168 solved by the solver's flips** | `node e2e/agreement.mjs` |
| Deterministic physics replays | **3 / 3 runs bit-identical** (12 bodies, max difference 0 m) | `node e2e/determinism.mjs` |
| M1 frame-time / draw-call budget | **PASS**: CPU p95 2.1 ms, 86 draw calls, 26,928 triangles | `node e2e/perf.mjs` |
| Landing page (375 / 768 / 1280 px) | **no horizontal overflow, 0 console errors** | `cd packages/landing && node scripts/check.mjs` |
| TypeScript / production build | `npm run typecheck` clean; `npm run build` succeeds (dist 5.7 MB) | `cd packages/app` |

The e2e scripts need the dev server in agent mode:
`cd packages/app && npx iwsdk dev up --ai-mode agent --allow-browser-automation`.

## Core unit tests (45)

`packages/core/test/core.test.ts` (36) and `packages/core/test/iwer-rooms.test.ts` (9).

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

## Gaze + pinch, Meta VR Glasses profile (14 checks)

`packages/app/e2e/hands-glasses.mjs`, report `e2e/reports/hands-glasses.json`. The script switches
`dev.emulator.device` to `metaVRGlasses` and restores it. Gaze aims (`xr look-at` with `device: gaze`), a hand
pinch commits after the gaze has rested at least 400 ms.

1. Glasses profile with gaze granted (`gaze-tracking`, `eye-tracking` in the enabled features)
2. Glasses mode turns on automatically from the gaze input source
3. HUD corners inside the glasses field of view with a 3 degree margin: horizontal -16.3 to 16.3 degrees,
   vertical -18.3 to 2.2 degrees (limits 37 left/right, 25 up, 43 down)
4. Gaze at ceiling + pinch flips up
5. Gaze at a wall + pinch flips sideways
6. Gaze at floor + pinch brings it home
7. Gaze + pinch on Play starts puzzle 1
8. Puzzle 1 solved with gaze + pinch
9. Gaze + pinch on the HUD menu button opens the menu
10. Menu corners inside the field of view (-16.3 to 16.3, -21.9 to 13.2 degrees)
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
the same position (maximum difference 0 m; marble at -2.0908, 0.06, -3.0344).

## M1 frame-time budget

`packages/app/e2e/perf.mjs`, report `e2e/reports/perf.json`. Meta Quest 3 profile, living room, 12 bodies, four
gravity flips pinched by the emulated hand over about 10 s, 1,017 frames (viewport 1280 x 720, IWER stereo off).
CPU time per frame = ECS update + render submit (`performance.now()` around both).

| Measure | Result | Gate |
|---|---|---|
| CPU ms per frame | p50 1.4, **p95 2.1**, max 4.1 | p95 <= 4.0 |
| ECS update | p50 0.9, p95 1.6 | |
| Render submit | p50 0.5, p95 0.7 | |
| Draw calls per view | **86** max | <= 100 |
| Triangles per view | **26,928** max | <= 250k |

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
