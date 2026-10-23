# Devpost submission draft: Sakasa

Meta VR Start Developer Competition 2026. Deadline Nov 18, 2026 12:00 PM PST (Nov 18 20:00 UTC). Our target:
Nov 17 18:00 UTC. **Nick submits**; nothing here has been submitted or published.

| Field | Draft |
|---|---|
| Project name | Sakasa |
| Tagline (<= 140 chars) | Point at a real wall, pinch, and it becomes the floor. A hands-only gravity puzzle generated from your own room. |
| Track | Gaming (also fits Boldest Original Concept and Best First Five Minutes) |
| Division | New Experience (conceived and built after Sep 24, 2026; fresh repo) |
| Platform | Immersive Web SDK (WebXR), public URL, Meta Quest 3 / 3S, Meta VR Glasses ready |
| Build link | TODO (Nick): public HTTPS URL after hosting `packages/app/dist` (GitHub Pages or Vercel). No pushes to it from Nov 18 20:00 UTC until winners (~Dec 11). |
| Video | TODO (Nick): < 3:00, public YouTube or Vimeo, IWER emulator footage (allowed), best moment in the first 10 s |
| Target launch date | TODO (Nick) |
| Team | Nivesh Gajengi (solo): design, code, testing. Email: TODO (Nick) |

## Description (about 450 words)

**Inspiration.** Every mixed reality demo puts virtual things *on* your table. We wanted the room itself to be the
toy. Sakasa (Japanese for "upside down") asks one question: what if any real surface could be the floor? Point at
your ceiling and pinch, and the toys on your coffee table fall up. Pinch the wall and they slam sideways onto it,
with their shadows swinging round to the wall too. Nothing about that works without your real room, your real
hands and passthrough.

**What it is.** A hands-only physics puzzle toy. A glowing marble must come to rest in a ring placed on one of
your room's surfaces. You can never touch the marble; you can only choose which way is down. Twenty puzzles in
three sets (Fall, Sideways, Upside down), a daily puzzle that is the same seed for everyone but laid out in each
player's own room, stars for solving at par, and a sandbox where you can throw everything around and flip gravity
mid-flight.

**How we built it.** IWSDK scene understanding gives us planes and labelled meshes. A pure TypeScript core turns
them into an axis-aligned room model (classifying unlabelled planes by orientation, height and size, and standing
in labelled paper walls or a paper ceiling when a room lacks them), then generates each puzzle *for that room* and
proves it solvable at its par with a breadth-first search over gravity flips. The search models a flip as a sphere
sweep and refuses any move that would glance off an edge, so the solver and the real-time Havok simulation agree:
in all 8 IWER emulator rooms we replay every puzzle's solution through Havok and the marble lands in the ring.
Gravity is the live Havok world gravity, changed at runtime, with a short slow-motion ramp on each flip. Every
sound is synthesised with WebAudio and HRTF-panned; every object is procedural. UI is UIKitML with Albert Sans and
B612 Mono.

**Hands first.** Point with the hand ray and pinch for everything: flips, buttons, grabbing toys. A palm-up wrist
menu pauses the room. On Meta VR Glasses, eye gaze picks the surface, a pinch flips it after a 400 ms gaze dwell,
and the HUD moves into the centre of the narrower field of view. There is no controller code at all.

**Future plans.** Persistent anchors so a puzzle you set up stays on your wall; shared rooms where a friend
flips gravity in your space; a level editor that lets you place paper blocks and share seeds.

## How hand interactions are implemented (optional field)

IWSDK `RayInteractable` on every room surface and UI panel; IWSDK pointer events (enter, move, down, up) drive
hover highlights, the pinch-hold path preview, and the flip on release. On Quest the pointer is the hand's far
ray (pinch = select); on Glasses it is the gaze input source, with our own 400 ms dwell gate. Toys use
`DistanceGrabbable` (pinch-hold to grab and carry, release to throw). The wrist menu opens from WebXR hand joint
poses (palm normal from the wrist and metacarpal joints). The wrist compass rides on the back of the left wrist and
always points "down".

## Mapping to the judging criteria (25% each)

| Criterion | What Sakasa shows | Evidence |
|---|---|---|
| Innovation & Creativity | Gravity bound to *your* surfaces; every room is a new level from the same seed; a daily puzzle for repeat play | Room plans of puzzle 10 in three IWER rooms (landing); 20 puzzles x 8 rooms replayed through Havok (TESTING.md) |
| Experience Design | First payoff from one pinch (the table of toys falls up); seated, point-and-pinch within arm's reach; text-free onboarding with glyphs; purposeful passthrough (your walls, ceiling and table are the mechanics); FoV-aware glasses layout | hands-only e2e in the Quest 3 profile; glasses e2e with FoV angle checks |
| Technical Implementation | Scene understanding to colliders; solver-validated room-adaptive puzzles; runtime Havok gravity; deterministic fixed-step replays; gaze + pinch with dwell; perf budget gate | TESTING.md: unit tests, e2e counts, M1 numbers, determinism |
| Polish & Presentation | Ink / flip-blue / paper art direction, synthesised spatial audio, slow motion, gravity-aligned shadows, honest emulator video | `videos/sakasa/` clips, landing page |

## Honesty notes for the form

- All footage is IWER emulator footage (allowed by the rules), not a headset capture, and is labelled as such.
- Frame-time numbers are a desktop headless-browser proxy; the Quest 3 frame rate is unverified until a device test.
- Planes in IWER are synthetic; real Quest plane quality in unseen rooms is unverified on hardware.
