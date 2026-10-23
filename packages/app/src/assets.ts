import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const uikitml = (fileName: string, name: string) => ({
  url: publicAssetUrl(`ui/${fileName}`),
  type: AssetType.UIKitML,
  name,
});

/**
 * Sakasa ships no models or audio files: every body, block and effect is
 * procedural (src/game/fx.ts) and every sound is synthesised (src/game/audio.ts).
 * The manifest only carries the two UIKitML panels.
 */
export default defineAssets({
  hud: uikitml('hud.uikitml', 'Sakasa HUD'),
  menu: uikitml('menu.uikitml', 'Sakasa Menu'),
});
