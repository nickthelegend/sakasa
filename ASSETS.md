# Assets and licences

Sakasa ships no third-party models, textures, images or audio files.

| Asset | Where | Source | Licence |
|---|---|---|---|
| Paper cubes, crumpled paper balls, paper rolls, the marble, paper blocks, goal ring, chevrons, wrist compass | `packages/app/src/game/fx.ts` | Procedural Three.js geometry written for Sakasa | MIT (this repo) |
| Surface highlight, trail, glow and beam shaders | `packages/app/src/game/fx.ts` | Written for Sakasa | MIT (this repo) |
| Glow and blob-shadow textures | `packages/app/src/game/fx.ts` | Canvas radial gradients generated at runtime | MIT (this repo) |
| Every sound (flip whoomp, bounces, slow-motion breath, solve chime, UI ticks) | `packages/app/src/game/audio.ts` | WebAudio synthesis at runtime (oscillators and a seeded noise buffer) | MIT (this repo) |
| Albert Sans Regular, SemiBold, Bold | `packages/app/public/fonts/AlbertSans-*.ttf` | Google Fonts static instances (WOFF converted to TTF with fontTools, unmodified glyphs) | SIL Open Font License 1.1, `public/fonts/OFL-AlbertSans.txt` (Copyright 2021 The Albert Sans Project Authors) |
| B612 Mono Regular, Bold | `packages/app/public/fonts/B612Mono-*.ttf` | Google Fonts (same conversion) | SIL Open Font License 1.1, `public/fonts/OFL-B612Mono.txt` (Copyright 2012 The B612 Project Authors) |
| In-headset type | generated at load | UIKit builds MSDF atlases from the TTFs above when the UIKitML panels load (`@font-face` in `public/ui/*.uikitml`) | same as the fonts |
| UI icons (arrows, pointer, hand, star, menu, chevrons, play, calendar, box, feather, glasses, volume, scan, log-out) | `public/ui/*.uikitml` | Lucide icons bundled with IWSDK's UIKit (`@pmndrs/uikit-lucide`) | ISC (Lucide) |
| Landing page fonts | `packages/landing/index.html` | Google Fonts stylesheet | SIL OFL 1.1 |
| Landing hero video and posters | `packages/landing/media/` | Recorded from Sakasa running in the IWER emulator (see `videos/sakasa/` in the grokbot folder) | MIT (this repo) |

Libraries (npm): Immersive Web SDK (`@iwsdk/*`, MIT), Three.js via `super-three` (MIT), pmndrs UIKit (MIT),
Havok physics through IWSDK (`@babylonjs/havok`, MIT), Vite (MIT), Vitest (MIT), TypeScript (Apache-2.0).
The scaffold came from `npm create @iwsdk@latest` (1.1.0-rc.2); its starter content was removed.
