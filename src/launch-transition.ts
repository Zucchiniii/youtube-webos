/**
 * Video launch transition.
 *
 * YouTube TV shows a plain black screen from pressing a video until its first
 * frame (1–3 s on a TV, longer on a slow start). Instead:
 *
 *  1. The moment OK is pressed on a tile, the screen dims to the video's
 *     thumbnail and the tile flies to full screen (~0.4 s, transform-only so
 *     it stays smooth on TV GPUs). This starts in the key handler itself –
 *     before YouTube swaps the page – so there is never a black frame.
 *  2. It stays as a poster – HD thumbnail with a slow zoom, title, channel and
 *     a loading bar – until the video is really playing.
 *  3. It cross-fades into the video once playback has been running for a
 *     moment (the TV's video plane shows its first frames a little after the
 *     clock starts, so fading earlier would reveal black).
 *
 * If a preview of that video is already playing in the tile, none of this
 * happens: YouTube grafts the preview into the full-screen player and grows it
 * (its own player resize animation, which we switch on in `utils.ts`), so the
 * preview simply becomes the video.
 *
 * Layering: the flying tile sits on top of everything for its short flight.
 * The poster is placed inside YouTube's player container (above the <video>,
 * below all of YouTube's own UI), so player controls, sign-in and "are you a
 * bot" prompts, and dialogs always stay visible above it.
 *
 * Autoplay of the next video, deep links and casts get the poster with a
 * fade-in, since there is no tile to fly from.
 */

import { getPlayerManager, PlayerState } from './player_api';
import type { PlayerManager } from './player_api';
import './launch-transition.css';

const FLIGHT_MS = 460;
const FADE_OUT_MS = 600;
/** Playback must have run this long before the poster fades. */
const SETTLE_PLAYBACK_S = 0.5;
/** Give up waiting for playback (the watchdog handles real hangs). */
const MAX_POSTER_MS = 30000;
/** No watch page this soon after OK: the tile was not a video. */
const NAVIGATION_TIMEOUT_MS = 900;
/** Material standard easing: gentle start, so a late first frame shows no jump. */
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

interface Selection {
  videoId: string;
  thumbUrl: string;
  rect: DOMRect;
  title: string;
  subtitle: string;
}

interface Flight {
  sel: Selection;
  layer: HTMLElement;
  landed: boolean;
  onLanded: (() => void) | null;
  cancelTimer: number;
}

let manager: PlayerManager | null = null;
let flight: Flight | null = null;

/* ---------------- Helpers ---------------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement
) {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
}

function isWatchHash() {
  return location.hash.startsWith('#/watch');
}

function currentVideoIdFromHash(): string | null {
  // A regex instead of URLSearchParams, which would pull in a core-js
  // ponyfill for webOS 22's Chromium.
  return /[?&]v=([\w-]{11})/.exec(location.hash)?.[1] ?? null;
}

/** A preview (or the video itself) is already playing for this id. */
function alreadyPlaying(videoId: string) {
  const player = manager?.player;
  const video = document.querySelector('video');
  return (
    !!player &&
    !!video &&
    manager?.currentVideoID === videoId &&
    player.getPlayerState() === PlayerState.PLAYING &&
    !video.paused
  );
}

/* ---------------- Capturing the selected tile ---------------- */

const DURATION_RE = /^\d{1,2}(?::\d{2}){1,2}$/;

function tileText(tile: HTMLElement) {
  const lines = (tile.innerText || '')
    .split('\n')
    .map((l) => l.trim())
    // Drop duration badges ("12:34") and short badges ("4K", "NY", "LIVE").
    .filter((l) => l.length > 4 && !DURATION_RE.test(l));
  return { title: lines[0] ?? '', subtitle: lines[1] ?? '' };
}

/** Elements YouTube TV uses for video tiles (new lockup and classic tile). */
const TILE_SELECTOR = 'yt-lockup-view-model, ytlr-tile-renderer';

function captureSelection(start: Element | null): Selection | null {
  // Only a focused/clicked video tile counts. Walking up to any ancestor with
  // a thumbnail also matched the player's controls on the watch page, so
  // pressing OK to pause launched a flying thumbnail over the video.
  const tile = start?.closest<HTMLElement>(TILE_SELECTOR);
  if (!tile) return null;

  const thumb = tile.querySelector<HTMLElement>('[style*="ytimg.com/vi"]');
  if (!thumb) return null;
  const rect = thumb.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 60) return null;
  // Portrait tiles are Shorts; they open the Shorts player, not a video.
  if (rect.height > rect.width) return null;

  const url = /url\("?([^")]+)"?\)/.exec(thumb.style.backgroundImage)?.[1];
  const id = url && /\/vi(?:_webp)?\/([\w-]{11})\//.exec(url)?.[1];
  if (!url || !id) return null;

  return { videoId: id, thumbUrl: url, rect, ...tileText(tile) };
}

/* ---------------- Flight ---------------- */

function removeFlight(fade: boolean) {
  const f = flight;
  if (!f) return;
  flight = null;
  clearTimeout(f.cancelTimer);
  if (!fade) {
    f.layer.remove();
    return;
  }
  const anim = f.layer.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 160,
    easing: 'ease-out',
    fill: 'forwards'
  });
  anim.onfinish = () => f.layer.remove();
}

/**
 * Set up on OK, animate from the next frame.
 *
 * YouTube's own OK handling blocks the main thread for ~200 ms (measured on
 * an LG C5). Animations created in the key handler had their clock running
 * during that block, so the first visible frame was already well into the
 * flight – a jump. Creating the layer now (so it is in the very next frame,
 * covering the page swap) but starting the motion in that frame avoids it.
 */
function startFlight(sel: Selection) {
  removeFlight(false);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { rect } = sel;
  const from = `translate(${rect.left}px, ${rect.top}px) scale(${
    rect.width / vw
  }, ${rect.height / vh})`;

  const layer = document.createElement('ytaf-launch-flight');
  layer.className = 'ytaf-launch-flight';
  // One pre-darkened copy of the thumbnail behind the card (gradient over
  // the image in a single layer): whatever YouTube shows underneath while it
  // swaps pages, the screen never goes black.
  const backdrop = el('div', 'ytaf-launch-backdrop', layer);
  backdrop.style.backgroundImage = `linear-gradient(rgba(0,0,0,.62),rgba(0,0,0,.62)),url("${sel.thumbUrl}")`;
  backdrop.style.opacity = '0';
  const card = el('div', 'ytaf-launch-card', layer);
  card.style.backgroundImage = `url("${sel.thumbUrl}")`;
  card.style.transform = from;
  document.body.appendChild(layer);

  const f: Flight = {
    sel,
    layer,
    landed: false,
    onLanded: null,
    // Not a video after all (channel, playlist page…): fade away.
    cancelTimer: window.setTimeout(() => {
      if (!isWatchHash() || currentVideoIdFromHash() !== sel.videoId) {
        removeFlight(true);
      }
    }, NAVIGATION_TIMEOUT_MS)
  };
  flight = f;

  requestAnimationFrame(() => {
    if (flight !== f) return;
    backdrop.style.opacity = '';
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      easing: 'linear'
    });
    const move = card.animate(
      [{ transform: from }, { transform: 'translate(0px, 0px) scale(1, 1)' }],
      { duration: FLIGHT_MS, easing: EASE, fill: 'forwards' }
    );
    move.onfinish = () => {
      f.landed = true;
      f.onLanded?.();
    };
  });
}

function onSelect(target: Element | null) {
  const sel = captureSelection(target);
  if (!sel) return;
  // A running preview grows into the video by itself (YouTube's grafting).
  if (alreadyPlaying(sel.videoId)) return;
  startFlight(sel);
}

window.addEventListener(
  'keydown',
  (evt) => {
    if (evt.keyCode === 13 && evt.isTrusted && !evt.repeat) {
      onSelect(document.activeElement);
    }
  },
  true
);
window.addEventListener(
  'click',
  (evt) => onSelect(evt.target as Element),
  true
);

/* ---------------- Poster ---------------- */

interface Poster {
  videoId: string;
  root: HTMLElement;
  shownAt: number;
  startTime: number | null;
  timer: number;
  closing: boolean;
}

let poster: Poster | null = null;

function buildPoster(thumbUrl: string, title: string, subtitle: string) {
  // A custom tag: YouTube's incremental DOM recycles foreign <div>s.
  const root = document.createElement('ytaf-launch-poster');
  root.className = 'ytaf-launch';

  const img = el('div', 'ytaf-launch-image', root);
  img.style.backgroundImage = `url("${thumbUrl}")`;
  el('div', 'ytaf-launch-scrim', root);

  const meta = el('div', 'ytaf-launch-meta', root);
  if (title) el('div', 'ytaf-launch-title', meta).textContent = title;
  if (subtitle) el('div', 'ytaf-launch-subtitle', meta).textContent = subtitle;

  const bar = el('div', 'ytaf-launch-loading', root);
  el('div', 'ytaf-launch-loading-fill', bar);
  return root;
}

function upgradePosterImage(root: HTMLElement, videoId: string) {
  const hd = `https://i.ytimg.com/vi/${videoId}/hq720.jpg`;
  const probe = new Image();
  probe.onload = () => {
    // Missing sizes are a 120×90 placeholder.
    if (probe.naturalWidth <= 120) return;
    const img = root.querySelector<HTMLElement>('.ytaf-launch-image');
    if (img) img.style.backgroundImage = `url("${hd}")`;
  };
  probe.src = hd;
}

function playerContainer() {
  return document.querySelector<HTMLElement>('ytlr-player-container');
}

function mountPoster(p: Poster) {
  if (p.root.isConnected) return;
  const container = playerContainer();
  (container ?? document.body).appendChild(p.root);
  p.root.classList.toggle('ytaf-launch-fallback', !container);
}

function closePoster(immediate = false) {
  const p = poster;
  if (!p || p.closing) return;
  p.closing = true;
  clearInterval(p.timer);
  poster = null;

  if (immediate || !p.root.isConnected) {
    p.root.remove();
    return;
  }
  const anim = p.root.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: FADE_OUT_MS,
    easing: 'ease-in-out',
    fill: 'forwards'
  });
  anim.onfinish = () => p.root.remove();
}

/** Close once playback has been running for a moment. */
function checkPoster() {
  const p = poster;
  if (!p) return;

  if (!isWatchHash() || currentVideoIdFromHash() !== p.videoId) {
    closePoster(true);
    return;
  }
  if (Date.now() - p.shownAt > MAX_POSTER_MS) {
    closePoster();
    return;
  }

  // YouTube may drop unknown children when it re-renders the container.
  mountPoster(p);

  const video = document.querySelector('video');
  const player = manager?.player;
  if (!video || !player) return;
  if (manager?.currentVideoID !== p.videoId) return;

  if (player.getPlayerState() !== PlayerState.PLAYING || video.paused) return;
  if (p.startTime === null) {
    p.startTime = video.currentTime;
    return;
  }
  if (video.currentTime - p.startTime >= SETTLE_PLAYBACK_S) closePoster();
}

function showPoster(videoId: string) {
  if (poster?.videoId === videoId) return;
  closePoster(true);

  const f = flight && flight.sel.videoId === videoId ? flight : null;
  const sel = f?.sel;

  // Without a tile (autoplay, deep link, cast): hqdefault always exists;
  // swap to the HD frame if the video has one.
  const thumbUrl =
    sel?.thumbUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const root = buildPoster(thumbUrl, sel?.title ?? '', sel?.subtitle ?? '');
  if (!sel) upgradePosterImage(root, videoId);

  poster = {
    videoId,
    root,
    shownAt: Date.now(),
    startTime: null,
    timer: window.setInterval(checkPoster, 150),
    closing: false
  };
  mountPoster(poster);

  if (f) {
    // Hidden until the card lands; then swap in the (identical) poster and
    // drop the flight layer a frame later.
    clearTimeout(f.cancelTimer);
    const reveal = () => {
      root.style.opacity = '';
      root.classList.add('ytaf-launch-shown');
      requestAnimationFrame(() => {
        if (flight === f) removeFlight(false);
      });
    };
    if (f.landed) reveal();
    else {
      root.style.opacity = '0';
      f.onLanded = reveal;
    }
  } else {
    // No fade-in from transparent: YouTube has usually cleared the page by
    // now, and a fade would show the black underneath (measured on the TV).
    root.classList.add('ytaf-launch-shown');
    removeFlight(true);
  }
}

/* ---------------- Navigation ---------------- */

let lastVideoId: string | null = null;

function onNavigate() {
  if (!isWatchHash()) {
    lastVideoId = null;
    closePoster(true);
    return;
  }
  const id = currentVideoIdFromHash();
  if (!id || id === lastVideoId) return;
  lastVideoId = id;

  // A preview grafted into the player keeps playing: nothing to cover.
  if (alreadyPlaying(id)) {
    removeFlight(false);
    return;
  }
  showPoster(id);
}

window.addEventListener('hashchange', onNavigate);
void getPlayerManager().then((m) => {
  manager = m;
});
onNavigate();
