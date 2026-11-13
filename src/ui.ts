/**
 * Remote-control shortcuts and small UI tweaks.
 *
 * - GREEN: AdFree quick panel (the options also live in YouTube's Settings).
 * - BLUE: audio-only mode.
 */

import { configAddChangeListener, configRead } from './config';
import { t } from './i18n';
import { showNotification } from './notifications';
import { requireElement } from './player_api/helpers';
import {
  handlePanelKey,
  isSettingsPanelVisible,
  showSettingsPanel,
  toggleSettingsPanel
} from './settings/panel';
import './ui.css';

export { showNotification };

const COLOR_KEYS = new Map<number, 'red' | 'green' | 'yellow' | 'blue'>([
  [403, 'red'],
  [404, 'green'],
  [172, 'green'],
  [405, 'yellow'],
  [170, 'yellow'],
  [406, 'blue'],
  [167, 'blue'],
  [191, 'blue']
]);

function keyColor(evt: KeyboardEvent) {
  return COLOR_KEYS.get(evt.keyCode) ?? COLOR_KEYS.get(evt.charCode) ?? null;
}

const lastColorPress = new Map<string, number>();

/**
 * One key router for the whole app, on `window` in the capture phase.
 *
 * YouTube listens on `window` (capture) too and re-dispatches every key as a
 * synthetic `Event` with its own key codes (green 404 -> 172). Registering
 * first (our script runs before YouTube's app init) and stopping the event
 * there means YouTube never sees keys we consume – no double toggles and no
 * navigation behind the open panel. Synthetic re-dispatches that slip
 * through anyway are de-duplicated.
 */
function onKey(evt: KeyboardEvent) {
  const color = keyColor(evt);

  if (color === 'green' || color === 'blue') {
    evt.preventDefault();
    evt.stopImmediatePropagation();
    if (evt.type !== 'keydown' || evt.repeat) return;
    const now = Date.now();
    if (now - (lastColorPress.get(color) ?? 0) < 400) return;
    lastColorPress.set(color, now);
    if (color === 'green') toggleSettingsPanel();
    else void toggleAudioOnly();
    return;
  }

  if (isSettingsPanelVisible()) {
    evt.preventDefault();
    evt.stopImmediatePropagation();
    // Only real key presses act; YouTube's synthetic copies are just eaten.
    if (
      evt.type === 'keydown' &&
      evt.isTrusted &&
      evt instanceof KeyboardEvent
    ) {
      handlePanelKey(evt);
    }
  }
}

for (const type of ['keydown', 'keypress', 'keyup'] as const) {
  window.addEventListener(type, onKey, true);
}

/* ---------------- Hide logo ---------------- */

function initHideLogo() {
  const style = document.createElement('style');
  document.head.appendChild(style);
  const apply = (hide: boolean) => {
    style.textContent = hide
      ? 'ytlr-redux-connect-ytlr-logo-entity{visibility:hidden}'
      : '';
  };
  apply(configRead('hideLogo'));
  configAddChangeListener('hideLogo', apply);
}

/* ---------------- Body class fix ---------------- */

/**
 * YouTube adds `app-quality-root` to <body> on some TVs, which forces a
 * low-quality rendering mode. Keep it off.
 */
function applyUIFixes() {
  const bodyClasses = document.body.classList;
  const strip = () => {
    if (bodyClasses.contains('app-quality-root')) {
      bodyClasses.remove('app-quality-root');
    }
  };
  strip();
  new MutationObserver(strip).observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
}

/* ---------------- Audio-only mode ---------------- */

let audioOnlyEnabled = false;
let overlayObserver: MutationObserver | null = null;

export function isAudioOnly() {
  return audioOnlyEnabled;
}

async function toggleAudioOnly() {
  const video = await requireElement('video', HTMLVideoElement);

  audioOnlyEnabled = !audioOnlyEnabled;
  video.style.visibility = audioOnlyEnabled ? 'hidden' : '';

  const AUDIO_OVERLAY_SELECTOR = '.ytLrAudioPlayerOverlayAudioMode';
  const OVERLAY_CLASS = 'ytaf-ui-watchControl-overlayMessage';

  const applyAudioOverlayFilter = () => {
    const node = document.querySelector<HTMLElement>(AUDIO_OVERLAY_SELECTOR);
    if (!node) return;
    if (audioOnlyEnabled)
      node.style.setProperty('filter', 'brightness(0)', 'important');
    else node.style.removeProperty('filter');
  };
  applyAudioOverlayFilter();

  showNotification(
    audioOnlyEnabled
      ? t({ en: 'Audio-only mode on', sv: 'Endast ljud: på' })
      : t({ en: 'Audio-only mode off', sv: 'Endast ljud: av' }),
    2000,
    'blue'
  );

  const controls = await requireElement('[idomkey="controls"]', HTMLElement);

  const updateOverlay = () => {
    let overlay = controls.querySelector(`.${OVERLAY_CLASS}`);
    if (!audioOnlyEnabled) {
      overlay?.remove();
      return;
    }
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.textContent = t({
      en: 'Audio-only mode – press BLUE to turn off',
      sv: 'Endast ljud – tryck BLÅ för att stänga av'
    });
    controls.prepend(overlay);
  };
  updateOverlay();

  overlayObserver?.disconnect();
  overlayObserver = null;
  if (audioOnlyEnabled) {
    overlayObserver = new MutationObserver(() => {
      updateOverlay();
      applyAudioOverlayFilter();
    });
    overlayObserver.observe(controls, { childList: true, subtree: true });
  } else {
    controls.querySelector(`.${OVERLAY_CLASS}`)?.remove();
  }
}

/* ---------------- First-run tip ---------------- */

const TIP_KEY = 'ytaf-settings-tip';

function showSettingsTip() {
  let count = 0;
  try {
    count = Number(window.localStorage.getItem(TIP_KEY)) || 0;
    if (count >= 3) return;
    window.localStorage.setItem(TIP_KEY, String(count + 1));
  } catch {
    return;
  }
  setTimeout(() => {
    showNotification(
      t({
        en: 'AdFree options are now in YouTube Settings (top of the list)',
        sv: 'AdFree-inställningarna finns nu i YouTubes Inställningar (överst)'
      }),
      6000,
      'green'
    );
  }, 4000);
}

applyUIFixes();
initHideLogo();
showSettingsTip();

// Close the quick panel when leaving the page/app state changes drastically.
window.addEventListener('hashchange', () => showSettingsPanel(false));
