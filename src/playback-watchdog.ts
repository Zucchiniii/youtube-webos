/**
 * Playback watchdog: recovers videos stuck on a black loading screen.
 *
 * On webOS 25 TVs a video – most often the first of a session – can hang in
 * the BUFFERING state with nothing loaded while the screen stays black
 * (upstream #379/#397). Users found that briefly hiding and showing the video
 * (toggling audio-only mode) or backing out and reopening the video fixes it.
 *
 * While a video is on screen and should be playing, we watch whether its
 * time advances. If it is stuck, we apply increasingly strong remedies, each
 * only after the previous one had time to work:
 *   1. re-show the video surface (what the audio-only toggle did)
 *   2. ask the player to play
 *   3. seek to the current position (flushes the media pipeline)
 *   4. reopen the video at the same position (what backing out did)
 * A user pause, the end of a video, seeking, being offline, or data still
 * arriving (ordinary buffering) never counts as stuck.
 */

import { t } from './i18n';
import { showNotification } from './notifications';
import { getPlayerManager, PlayerMode, PlayerState } from './player_api';
import type { PlayerManager } from './player_api';
import { ResolveCommandRegistry } from './app_api';
import { isAudioOnly } from './ui';

const TICK_MS = 1000;
/** How long playback may stall before each remedy. */
const STALL_LIMITS_MS = [4000, 3000, 4000, 6000];

interface Watch {
  videoId: string;
  lastTime: number;
  lastBuffered: number;
  lastProgressAt: number;
  attempt: number;
  gaveUp: boolean;
}

let watch: Watch | null = null;
let timer: number | undefined;

function isWatchPage() {
  return document.body.classList.contains('WEB_PAGE_TYPE_WATCH');
}

function getVideo() {
  return document.querySelector('video');
}

/** End of the furthest buffered range (seconds), 0 if nothing is buffered. */
function bufferedEnd(video: HTMLVideoElement) {
  const b = video.buffered;
  return b.length ? b.end(b.length - 1) : 0;
}

function nudgeSurface(video: HTMLVideoElement) {
  const restore = isAudioOnly() ? 'hidden' : '';
  video.style.visibility = 'hidden';
  requestAnimationFrame(() =>
    setTimeout(() => {
      video.style.visibility = restore;
    }, 150)
  );
}

function remedy(manager: PlayerManager, video: HTMLVideoElement, w: Watch) {
  const player = manager.player;
  const step = w.attempt;
  console.warn(`[watchdog] ${w.videoId} stuck, remedy ${step + 1}`);

  switch (step) {
    case 0:
      nudgeSurface(video);
      break;
    case 1:
      nudgeSurface(video);
      player.playVideo();
      break;
    case 2: {
      showNotification(
        t({ en: 'Restarting playback…', sv: 'Startar om uppspelningen…' }),
        2500
      );
      const time = Math.max(0, player.getCurrentTime() - 0.05);
      player.seekTo(time, true);
      player.playVideo();
      break;
    }
    case 3: {
      const registry = ResolveCommandRegistry.peek();
      const start = Math.floor(player.getCurrentTime());
      if (registry) {
        registry.dispatchCommand({
          watchEndpoint: {
            videoId: w.videoId,
            ...(start > 0 ? { startTimeSeconds: start } : {})
          }
        });
      }
      w.gaveUp = true;
      break;
    }
  }
  w.attempt++;
}

function tick(manager: PlayerManager) {
  if (!isWatchPage()) {
    stop();
    return;
  }

  const video = getVideo();
  const id = manager.currentVideoID;
  if (!video || !id || manager.playerMode !== PlayerMode.NORMAL) return;

  const now = Date.now();
  if (!watch || watch.videoId !== id) {
    watch = {
      videoId: id,
      lastTime: video.currentTime,
      lastBuffered: bufferedEnd(video),
      lastProgressAt: now,
      attempt: 0,
      gaveUp: false
    };
    return;
  }

  const w = watch;
  if (video.currentTime !== w.lastTime) {
    w.lastTime = video.currentTime;
    w.lastProgressAt = now;
    if (w.attempt > 0 && !video.paused) {
      console.info(`[watchdog] ${id} recovered after ${w.attempt} remedies`);
      w.attempt = 0;
      w.gaveUp = false;
    }
    return;
  }

  // Data still arriving: ordinary buffering on a slow connection.
  const buffered = bufferedEnd(video);
  if (buffered > w.lastBuffered + 0.1) {
    w.lastBuffered = buffered;
    w.lastProgressAt = now;
    return;
  }

  // Only BUFFERING, or PLAYING with a frozen clock, counts as stuck. Anything
  // else means YouTube is waiting on something legitimate: a user pause, the
  // end of the video, or a screen in front of the player (sign-in or "confirm
  // you're not a bot" prompts, age gates, account picker – all UNSTARTED/CUED).
  const state = manager.player.getPlayerState();
  const so = manager.player.getPlayerStateObject();
  // Once we have intervened, UNSTARTED can be the result of our own seek, so
  // keep escalating then.
  const shouldBePlaying =
    state === PlayerState.BUFFERING ||
    state === PlayerState.PLAYING ||
    (w.attempt > 0 && state === PlayerState.UNSTARTED);
  // `isUiSeeking` is the user scrubbing. A programmatic seek that never
  // completes (`isSeeking` stuck) is exactly the kind of hang we fix.
  if (
    !shouldBePlaying ||
    so.isUiSeeking ||
    so.isError ||
    !navigator.onLine ||
    w.gaveUp
  ) {
    w.lastProgressAt = now;
    return;
  }

  const limit = STALL_LIMITS_MS[w.attempt];
  if (limit === undefined) return;
  if (now - w.lastProgressAt >= limit) {
    try {
      remedy(manager, video, w);
    } catch (err) {
      console.warn('[watchdog] remedy failed:', err);
      w.attempt++;
    }
    w.lastProgressAt = now;
  }
}

function start(manager: PlayerManager) {
  if (timer !== undefined) return;
  timer = window.setInterval(() => tick(manager), TICK_MS);
}

function stop() {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  watch = null;
}

void getPlayerManager().then((manager) => {
  const maybeStart = () => {
    if (isWatchPage()) start(manager);
  };
  manager.addEventListener('newVideo', maybeStart);
  manager.addEventListener('stateChange', maybeStart);
  new MutationObserver(maybeStart).observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
  maybeStart();
});
