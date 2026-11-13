/**
 * Let a playing preview grow seamlessly into the full-screen video.
 *
 * When you open a video whose preview is already playing in its tile, YouTube
 * TV "grafts" that playback into the watch page (no reload) – but on TVs it
 * then jumps the player to full screen in one frame, because its player
 * resize animation is switched off for this device class
 * (`featureSwitches.supportsPlayerResizeAnimation`). With it on, YouTube
 * animates the player from the tile to full screen with its own transform
 * transition, so the preview simply becomes the video.
 *
 * YouTube reads the switch each time it lays out the player, so patching the
 * live config is enough; the accessor keeps it patched if YouTube replaces
 * the config object.
 */

type FeatureSwitches = Record<string, unknown>;
interface TectonicConfig {
  featureSwitches?: FeatureSwitches;
}

declare global {
  interface Window {
    tectonicConfig?: TectonicConfig;
  }
}

const SWITCHES: FeatureSwitches = {
  supportsPlayerResizeAnimation: true
};

function patch(config: TectonicConfig | undefined) {
  if (!config || typeof config !== 'object') return;
  config.featureSwitches ??= {};
  Object.assign(config.featureSwitches, SWITCHES);
}

let current = window.tectonicConfig;
patch(current);

try {
  Object.defineProperty(window, 'tectonicConfig', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: TectonicConfig | undefined) => {
      current = value;
      patch(current);
    }
  });
} catch (err) {
  console.warn('[player-animation] could not watch tectonicConfig:', err);
}
