# Sakasa: headset-judge pass (Nov 15, 2026)

Judged as a Meta VR Start judge would see it: from the player's eye in the IWER emulator (Meta Quest 3
profile, living room), plus the three Oct 24 emulator clips in `grokbot/videos/sakasa/`. Scores are out
of 10 per criterion (the four criteria weigh 25% each). No inflation: a 7 means "good, a judge would
remember one thing about it", not "nearly perfect".

## Before (build 5705f15, Oct 25 art wave)

Looked at: the Oct 24 clips (contact sheets at 1 frame / 3 s) and the e2e screenshots from the same build
(`e2e-out/quest-00-onboarding.png`, `quest-03-puzzle1.png`, `quest-05-wrist-menu.png`,
`glasses-00-onboarding.png`).

| Criterion | Score | Why |
|---|---|---|
| Innovation & Creativity | 7 | Pinching a real ceiling so the coffee-table toys fall up is a genuinely new verb, and puzzles are generated for *your* room and proven solvable. Nobody else in the field does this. |
| Experience Design | 6 | First payoff is one pinch, seated, hands only, good. But the guidance lives only on a small HUD, the target surface pulses faintly, and there is no sense of progress through the three first-session pinches. |
| Technical Implementation | 8 | Solver and Havok agree on 168/168 puzzles across 8 rooms, bit-identical replays, perf gate, Glasses dwell + FoV layout. Strongest criterion. |
| Polish & Presentation | 5 | The hero moment is under-sold: small objects, a thin ring pulse, slow motion nobody can see. Clips are 1280 x 720 with the emulator toolbar visible and no sound. No film yet. |
| **Average** | **6.5** | |

### The 5 biggest problems

1. **Text is too small to read in a headset.** HUD body text: 18 units on a 440-unit panel 0.42 m wide is
   17.2 mm type, 12.0 mm cap height at 1.0 m (the floor is 18 mm). The eyebrow and stats were 8.7 to 9.4 mm.
   Menu labels at 0.7 m were 11.4 mm (floor 12.6 mm). In a 1080p frame the HUD reads as a smudge.
2. **The marble and toys are specks.** The marble was 12 cm across, toys 12 cm cubes, viewed from 1.5 to 2.5 m.
   In the clips the marble is a dot, and the goal ring is a thin hairline.
3. **The gravity flip is under-sold.** A thin ring pulse on the pinched surface and objects falling. Nothing
   says "the room's down just changed": no tilt cue, slow motion (0.2x back to 1x in under a second) is not
   visible as such, and only the marble left a trail.
4. **Onboarding cues are not on the target.** "Point up. Pinch." and three small glyphs sit on the HUD; the
   ceiling itself barely glows. For Best First Five Minutes the cue has to be where the player should point.
5. **Presentation.** Test clips only (20-27 s, 720p, toolbar in frame, B612 caption bar), no walkthrough film,
   no app audio in any clip.

### What I will fix (in this order)

1. Scale: 15 cm marble (core radius 0.3 of a cell, solver re-verified), 18 cm toys fitted to the table and
   stacked, a thick goal ring with a 1 m light beam and an outward ripple, a much bigger marble glow.
2. The flip: a ghost outline of the room that kicks 12 degrees toward the new floor and settles (the real
   room never moves; gentle gravity softens it, a Tilt cue option turns it off), gravity rain (180 light
   streaks falling the new way through the room), a visible slow-motion ramp (hold at 0.15x, a dial reading
   0.15x to 1.00x, a flip-blue edge glow), a shock ring that lights the pinched surface's grid, trails on
   every toy.
3. Text: HUD 0.66 m (body cap 18.9 mm at 1 m), Glasses HUD 0.56 m at 0.85 m, menus 0.52 m at 0.7 m, larger
   labels.
4. Onboarding: a pulsing ring with an animated pinch glyph on the exact surface each step wants, plus a
   three-step progress bar on the HUD.
5. A 1920 x 1080 walkthrough film with the app's own recorded audio and no emulator chrome.

## After (main at the end of Nov 15)

Looked at: the 1080p film takes (contact sheets at 1 frame / s and full-size stills of the flip), plus the
measured e2e numbers in [TESTING.md](../TESTING.md).

| Criterion | Before | After | Why it moved (or did not) |
|---|---|---|---|
| Innovation & Creativity | 7 | 7 | Same idea; the new staging sells it but does not change it. |
| Experience Design | 6 | 7 | The first-session cue is now on the real surface (ring + animated pinch glyph), with a progress bar; text reads at headset distance (18.9 mm cap height at 1 m); Tilt cue off is a real comfort option. Still unproven on a real headset and real hand tracking. |
| Technical Implementation | 8 | 8 | Solver and Havok still agree 168/168 with the bigger marble; 98 draw calls with the new effects (budget 100); a first-flip shader hitch found and fixed; an Undo bug found by the film take and fixed with a regression check. |
| Polish & Presentation | 5 | 7 | The flip is now unmistakable on screen: slow-motion dial, ghost-room kick, light rain, shock ring, trails, a 15 cm marble and 18 cm toys. A 2:49 1080p film with the app's own audio and no emulator chrome. |
| **Average** | **6.5** | **7.25** | |

### What is still weak (honest)

1. Emulator only: frame rate, real plane quality and real hand tracking on a Quest 3 are unverified.
2. The ghost-room tilt is a rotating outline around the player; it is bright but brief (1.3 s), can be turned off and is
   softened by gentle gravity, but nobody has tried it in a headset for comfort yet.
3. The slow-motion dial is head-locked for about 1.5 s per flip; fine in the emulator, may feel sticky in a headset.
4. App audio is sparse between impacts, so the film is quiet in places (no music bed by design).
5. Draw calls sit at 98 of the 100 budget; any further effect needs something else merged.

### Fixed in this pass

Commits on `main` (pushed): core marble and feel module, the flip effects, readable UI, the e2e flip suite and film
tools, the first-flip shader warm-up, the Undo gravity fix, docs and test counts.
