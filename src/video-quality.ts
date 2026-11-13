/**
 * "Always highest quality".
 *
 * Upstream switched quality with `setPlaybackQualityRange('highres')` right
 * after playback started. That forces a format switch mid-start – visible as a
 * blink, and on webOS 25 a known trigger for the first video hanging on a
 * black buffering screen (upstream issues #379/#397).
 *
 * Instead the preference is stored *before* playback, the way YouTube stores a
 * manual quality pick (`yt-player-quality`), so the player starts in the best
 * format directly. There is deliberately no forced switch afterwards: on the
 * TV's hardware decoder any mid-playback format switch can show as a split
 * second of black, and YouTube's adaptive streaming steps up on its own.
 */

import { configAddChangeListener, configRead } from './config';
import { t } from './i18n';
import { showNotification } from './notifications';
import { getPlayerManager } from './player_api';

const QUALITY_KEY = 'yt-player-quality';
// YouTube ignores a stored preference older than 30 days; refresh it often.
const PREFERENCE_TTL_MS = 360 * 24 * 3600 * 1000;

function enabled() {
  return configRead('forceHighResVideo');
}

/** Store "highest" as the user's quality preference (read at video load). */
function writePreference() {
  try {
    const now = Date.now();
    window.localStorage.setItem(
      QUALITY_KEY,
      JSON.stringify({
        data: JSON.stringify({ quality: 4320, previousQuality: 4320 }),
        expiration: now + PREFERENCE_TTL_MS,
        creation: now
      })
    );
  } catch (err) {
    console.warn('[video-quality] could not store preference:', err);
  }
}

if (enabled()) writePreference();

configAddChangeListener('forceHighResVideo', (value) => {
  if (value) {
    writePreference();
    showNotification(
      t({
        en: 'Highest quality applies from the next video',
        sv: 'Högsta kvalitet gäller från nästa video'
      }),
      3000
    );
  }
});

// Re-assert after every video: a manual pick in the player overwrites it.
void getPlayerManager().then((manager) => {
  manager.addEventListener('newVideo', () => {
    if (enabled()) writePreference();
  });
});
