/**
 * Preview → full screen, smooth on a TV.
 *
 * When a playing preview is handed over to the watch page (OK on the tile,
 * or YouTube's own hand-over after a few seconds), YouTube grows the player
 * from the tile to full screen (see player-animation.ts and
 * preview-adoption.ts). On webOS the video is a hardware plane under the page
 * that is repositioned only about every 300 ms, so any growth of the video
 * itself shows as ~3 fps steps (measured on an LG C5), and the page can't copy
 * the hardware-decoded frame either (canvas reads back black).
 *
 * So the motion is done in graphics, where it runs at full frame rate:
 *  1. The home screen is hidden (black) and the player jumps straight to full
 *     screen – one plane move instead of visible steps, hidden underneath.
 *  2. A card with the video's thumbnail starts exactly over the preview,
 *     fades in over it and grows to full screen.
 *  3. Once the video plane has settled, the card dissolves into the playing
 *     video – which never stopped (adoption), so sound and picture continue.
 *
 * The player is also kept visible during the switch: YouTube hides it for
 * ~0.2 s at the page change, and the TV blanks the video plane meanwhile.
 *
 * The hand-over is detected from the player itself – its target transform
 * becomes full screen while it is still small and a preview is playing – so
 * it works for both the remote's OK and the automatic hand-over.
 */

import { requireElement } from './player_api/helpers';
import './preview-zoom.css';

const ZOOM = 'ytaf-zoom';
const ZOOM_OUT = 'ytaf-zoom-out';
const BACKDROP = 'ytaf-zoom-bg';

const CARD_IN_MS = 140;
const GROW_MS = 520;
/** After the card lands: give the video plane time to settle under it. */
const SETTLE_MS = 160;
const REVEAL_MS = 300;
const FADE_BACK_MS = 260;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

const TILE_SELECTOR = 'yt-lockup-view-model, ytlr-tile-renderer';

let active = false;
let card: HTMLElement | null = null;
let timers: number[] = [];

/** Scale of a CSS transform (`matrix(...)`, `scale(...)` or `scaleX(...)`). */
function scaleOf(transform: string): number {
  if (!transform || transform === 'none') return 1;
  const m =
    /matrix\(\s*([-\d.e]+)/.exec(transform) ??
    /scaleX\(\s*([-\d.e]+)/.exec(transform) ??
    /scale\(\s*([-\d.e]+)/.exec(transform);
  return m ? parseFloat(m[1]!) : 1;
}

function isWatchHash() {
  return location.hash.startsWith('#/watch');
}

function later(fn: () => void, ms: number) {
  timers.push(window.setTimeout(fn, ms));
}

function markBackdrop() {
  // The app's own backdrop is dark grey; during the zoom it must be pure
  // black like the video hole, or the box edges would still show.
  const app = document.querySelector('ytlr-app');
  for (let el = app; el && el !== document.body; el = el.parentElement) {
    el.classList.add(BACKDROP);
  }
}

type Player = HTMLElement & {
  isInline?: () => boolean;
  getPlayerState?: () => number;
  getVideoData?: () => { video_id?: string };
};

function ytPlayer() {
  return document.querySelector<Player>('.html5-video-player');
}

function previewPlaying() {
  const p = ytPlayer();
  return !!p?.isInline?.() && p.getPlayerState?.() === 1;
}

/** The thumbnail the tile showed (already loaded), else the HD frame. */
function thumbnailFor(videoId: string | undefined): string | null {
  const tile = document.activeElement?.closest(TILE_SELECTOR);
  const thumb = tile?.querySelector<HTMLElement>('[style*="ytimg.com/vi"]');
  const url = thumb
    ? /url\("?([^")]+)"?\)/.exec(thumb.style.backgroundImage)?.[1]
    : undefined;
  if (url && (!videoId || url.includes(`/${videoId}/`))) return url;
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hq720.jpg` : null;
}

function removeCard() {
  card?.remove();
  card = null;
}

function endZoom() {
  if (!active) return;
  active = false;
  timers.forEach(clearTimeout);
  timers = [];
  removeCard();
  const root = document.documentElement.classList;
  root.add(ZOOM_OUT);
  root.remove(ZOOM);
  later(() => root.remove(ZOOM_OUT), FADE_BACK_MS);
}

function startZoom(rect: DOMRect) {
  if (active) return;
  active = true;
  markBackdrop();
  // On <html>: YouTube rewrites <body>'s class list when the page changes.
  const root = document.documentElement.classList;
  root.remove(ZOOM_OUT);
  root.add(ZOOM);

  const url = thumbnailFor(ytPlayer()?.getVideoData?.().video_id);
  if (!url) {
    later(endZoom, GROW_MS + SETTLE_MS);
    return;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const from = `translate(${rect.left}px, ${rect.top}px) scale(${
    rect.width / vw
  }, ${rect.height / vh})`;

  removeCard();
  // Layer = black backdrop (hides the full-screen video while the card
  // grows) + the card. Both fade in over the live preview, the whole layer
  // dissolves into the playing video at the end.
  const layer = document.createElement('ytaf-zoom-card');
  layer.className = 'ytaf-zoom-layer';
  layer.style.opacity = '0';
  const growing = document.createElement('div');
  growing.className = 'ytaf-zoom-card';
  growing.style.backgroundImage = `url("${url}")`;
  growing.style.transform = from;
  layer.appendChild(growing);
  document.body.appendChild(layer);
  card = layer;

  // Start on the next frame: YouTube's OK handling keeps the main thread
  // busy for ~200 ms, and animations created now would skip their start.
  requestAnimationFrame(() => {
    if (card !== layer) return;
    layer.style.opacity = '';
    layer.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: CARD_IN_MS,
      easing: 'linear'
    });
    growing.animate(
      [{ transform: from }, { transform: 'translate(0px, 0px) scale(1, 1)' }],
      { duration: GROW_MS, easing: EASE, fill: 'forwards' }
    );
    later(() => {
      const reveal = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: REVEAL_MS,
        easing: 'ease-in-out',
        fill: 'forwards'
      });
      reveal.onfinish = endZoom;
    }, GROW_MS + SETTLE_MS);
  });

  // Safety net if anything above does not finish.
  later(endZoom, GROW_MS + SETTLE_MS + REVEAL_MS + 600);
}

void requireElement('ytlr-player', HTMLElement).then((player) => {
  new MutationObserver(() => {
    if (active || isWatchHash()) return;
    const target = scaleOf(player.style.transform);
    if (target < 0.99) return;
    // Before the next style recalc the computed value and the box are still
    // the small, current preview.
    if (scaleOf(getComputedStyle(player).transform) >= 0.95) return;
    if (!previewPlaying()) return;
    startZoom(player.getBoundingClientRect());
  }).observe(player, { attributes: true, attributeFilter: ['style'] });
});

// Leaving the video during the zoom (Back): restore the UI at once.
window.addEventListener('hashchange', () => {
  if (active && !isWatchHash()) endZoom();
});
