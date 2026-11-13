/**
 * "Always highest quality".
 *
 * Upstream switched quality with `setPlaybackQualityRange('highres')` right
 * after playback started. That forces a format switch mid-start – visible as a
 * blink, and on webOS 25 a known trigger for the first video hanging on a
 * black buffering screen (upstream issues #379/#397).
 *
 * Now the preference is set *before* playback, the way YouTube stores a
 * manual quality pick (`yt-player-quality`), so the player starts in the best
 * format directly. Only if it still started lower (bandwidth estimate, etc.)
 * do we switch once, after playback has settled.
 */

import { configAddChangeListener, configRead } from './config';
import { t, tf } from './i18n';
import { showNotification } from './notifications';
import { getPlayerManager, PlayerMode, PlayerState } from './player_api';
import type { PlayerManager, VideoID } from './player_api';

const QUALITY_KEY = 'yt-player-quality';
// YouTube ignores a stored preference older than 30 days; refresh it often.
const PREFERENCE_TTL_MS = 360 * 24 * 3600 * 1000;
const SETTLE_MS = 2500;

const LABELS: Record<string, string> = {
  highres: '4320p',
  hd2880: '2880p',
  hd2160: '2160p',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p'
};

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

function bestPlayable(manager: PlayerManager) {
  const data = manager.player.getAvailableQualityData();
  return data.find((d) => d.isPlayable && !d.paygatedQualityDetails) ?? null;
}

const corrected = new Set<VideoID>();

function scheduleCorrection(manager: PlayerManager) {
  const id = manager.currentVideoID;
  if (!id || corrected.has(id)) return;
  corrected.add(id);
  if (corrected.size > 200) corrected.clear();

  setTimeout(() => {
    try {
      if (!enabled()) return;
      if (manager.currentVideoID !== id) return;
      if (manager.playerMode !== PlayerMode.NORMAL) return;
      // Only switch while healthy playback is underway.
      if (manager.player.getPlayerState() !== PlayerState.PLAYING) return;

      const best = bestPlayable(manager);
      if (!best) return;
      const current = manager.player.getPlaybackQuality();
      if (current === best.quality) return;

      console.info('[video-quality]', current, '->', best.quality);
      manager.player.setPlaybackQualityRange(
        best.quality,
        best.quality,
        best.formatId
      );
      showNotification(
        tf(
          { en: 'Quality raised to {q}', sv: 'Kvaliteten höjd till {q}' },
          { q: best.qualityLabel || LABELS[best.quality] || best.quality }
        ),
        2500
      );
    } catch (err) {
      console.warn('[video-quality] correction failed:', err);
    }
  }, SETTLE_MS);
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

void getPlayerManager().then((manager) => {
  manager.addEventListener('newVideo', () => {
    if (enabled()) writePreference();
  });
  manager.addEventListener('playbackStart', () => {
    if (enabled() && manager.playerMode === PlayerMode.NORMAL) {
      scheduleCorrection(manager);
    }
  });
});
