/**
 * Video launch transition.
 *
 * YouTube TV shows a plain black screen from pressing a video until its first
 * frame (1–3 s on a TV, longer on a slow start). Instead:
 *
 *  1. The selected tile's thumbnail flies from the tile to full screen
 *     (~0.4 s, transform-only so it stays smooth on TV GPUs).
 *  2. It stays as a poster – HD thumbnail with a slow zoom, the title and a
 *     loading bar – until the video is really playing.
 *  3. It cross-fades into the video once playback time is advancing.
 *
 * Layering: the flying tile sits on top of everything for its short flight.
 * The poster is placed inside YouTube's player container (above the <video>,
 * below all of YouTube's own UI), so the player controls, sign-in and "are you
 * a bot" prompts, and dialogs always stay visible above it.
 *
 * Autoplay of the next video, deep links and casts get the poster with a
 * fade-in, since there is no tile to fly from.
 */

import { getPlayerManager, PlayerState } from './player_api';
import type { PlayerManager } from './player_api';
import './launch-transition.css';

const FLIGHT_MS = 420;
const FADE_OUT_MS = 450;
/** Give up waiting for playback (the watchdog handles real hangs). */
const MAX_POSTER_MS = 30000;
/** A selection older than this is not the one that opened the video. */
const SELECTION_TTL_MS = 2500;
const EASE_OUT = 'cubic-bezier(0.2, 0.75, 0.25, 1)';

interface Selection {
  videoId: string;
  thumbUrl: string;
  rect: DOMRect;
  title: string;
  subtitle: string;
  at: number;
}

let selection: Selection | null = null;
let manager: PlayerManager | null = null;

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

function captureSelection(start: Element | null) {
  for (
    let el: Element | null = start, depth = 0;
    el && depth < 6;
    el = el.parentElement, depth++
  ) {
    const thumb = el.querySelector<HTMLElement>('[style*="ytimg.com/vi"]');
    if (!thumb) continue;
    const rect = thumb.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 60) continue;

    const url = /url\("?([^")]+)"?\)/.exec(thumb.style.backgroundImage)?.[1];
    const id = url && /\/vi(?:_webp)?\/([\w-]{11})\//.exec(url)?.[1];
    if (!url || !id) return;

    selection = {
      videoId: id,
      thumbUrl: url,
      rect,
      ...tileText(el as HTMLElement),
      at: Date.now()
    };
    return;
  }
}

window.addEventListener(
  'keydown',
  (evt) => {
    if (evt.keyCode === 13 && evt.isTrusted) {
      captureSelection(document.activeElement);
    }
  },
  true
);
window.addEventListener(
  'click',
  (evt) => captureSelection(evt.target as Element),
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
    easing: 'ease-out',
    fill: 'forwards'
  });
  anim.onfinish = () => p.root.remove();
}

/** Close once playback time is really advancing. */
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

  if (player.getPlayerState() !== PlayerState.PLAYING) return;
  if (p.startTime === null) {
    p.startTime = video.currentTime;
    return;
  }
  if (video.currentTime - p.startTime > 0.15) closePoster();
}

function flyFromTile(thumbUrl: string, rect: DOMRect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const layer = document.createElement('ytaf-launch-flight');
  layer.className = 'ytaf-launch-flight';
  const backdrop = el('div', 'ytaf-launch-backdrop', layer);
  const card = el('div', 'ytaf-launch-card', layer);
  card.style.backgroundImage = `url("${thumbUrl}")`;
  document.body.appendChild(layer);

  const from = `translate(${rect.left}px, ${rect.top}px) scale(${
    rect.width / vw
  }, ${rect.height / vh})`;

  backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: FLIGHT_MS,
    easing: 'ease-out',
    fill: 'forwards'
  });
  const flight = card.animate(
    [{ transform: from }, { transform: 'translate(0px, 0px) scale(1, 1)' }],
    { duration: FLIGHT_MS, easing: EASE_OUT, fill: 'forwards' }
  );
  // The poster underneath is identical by now, so removing is seamless.
  flight.onfinish = () => layer.remove();
  setTimeout(() => layer.remove(), FLIGHT_MS + 500);
}

function showPoster(videoId: string) {
  if (poster?.videoId === videoId) return;
  closePoster(true);

  const sel =
    selection &&
    selection.videoId === videoId &&
    Date.now() - selection.at < SELECTION_TTL_MS
      ? selection
      : null;
  selection = null;

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

  if (sel) {
    flyFromTile(thumbUrl, sel.rect);
    root.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 1,
      delay: FLIGHT_MS - 40,
      fill: 'backwards'
    });
  } else {
    root.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 280,
      easing: 'ease-out'
    });
  }
}

/* ---------------- Navigation ---------------- */

function isWatchHash() {
  return location.hash.startsWith('#/watch');
}

function currentVideoIdFromHash(): string | null {
  // A regex instead of URLSearchParams, which would pull in a core-js
  // ponyfill for webOS 22's Chromium.
  return /[?&]v=([\w-]{11})/.exec(location.hash)?.[1] ?? null;
}

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

  // Already playing this video (e.g. the hero preview was running): no poster.
  const video = document.querySelector('video');
  if (
    manager?.currentVideoID === id &&
    manager.player.getPlayerState() === PlayerState.PLAYING &&
    video &&
    !video.paused
  ) {
    return;
  }
  showPoster(id);
}

window.addEventListener('hashchange', onNavigate);
void getPlayerManager().then((m) => {
  manager = m;
});
onNavigate();
