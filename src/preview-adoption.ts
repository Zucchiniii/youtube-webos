/**
 * Let OK on a playing preview continue that playback in full screen.
 *
 * YouTube TV's PlaybackPreviewService only hands a running preview over to
 * the watch page ("adoption") when the preview data says `blockAdoption:
 * false`. The server sends `true` to TVs, so pressing OK on a preview stops
 * it, reloads the video and shows a black screen meanwhile – while YouTube's
 * own automatic hand-over after a few seconds of preview is seamless (it is
 * allowed through by `forceSeamlessAutotransition`).
 *
 * Clearing the flag makes OK take that same seamless path: the playing
 * preview grows to full screen (see player-animation.ts) and keeps playing.
 * Measured on an LG C5: with the flag, OK gave ~0.5 s of stopped preview and
 * ~0.25 s of full black before the video came back.
 */

import { addJsonFilter } from './hooks/json-parse';

type Json = Record<string, unknown>;

function clear(node: unknown, depth: number) {
  if (depth > 40 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) clear(item, depth + 1);
    return;
  }
  const obj = node as Json;
  if (obj.blockAdoption === true) obj.blockAdoption = false;
  for (const key in obj) {
    const v = obj[key];
    if (v !== null && typeof v === 'object') clear(v, depth + 1);
  }
}

addJsonFilter('preview-adoption', (data, text) => {
  // Cheap native search first: only feeds with previews carry the flag.
  if (
    text.indexOf('"blockAdoption":true') === -1 &&
    text.indexOf('"blockAdoption": true') === -1
  )
    return;
  clear(data, 0);
});
