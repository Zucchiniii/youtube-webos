/**
 * Hides Shorts from browse feeds (home, subscriptions, search, continuations).
 *
 * Handles both tile formats YouTube TV uses: the classic `tileRenderer` and
 * the newer `lockupViewModel` (which upstream's filter did not recognise), and
 * removes whole Shorts shelves. Runs as a single pass over the response.
 */

import { configRead } from './config';
import { addJsonFilter } from './hooks/json-parse';

type Json = Record<string, unknown>;

const SHELF_SHORTS = 'TVHTML5_SHELF_RENDERER_TYPE_SHORTS';
const LOCKUP_SHORT = 'LOCKUP_CONTENT_TYPE_SHORT';

// Subtrees that never contain feed items; skipping them keeps the walk cheap.
const SKIP_KEYS = new Set([
  'responseContext',
  'frameworkUpdates',
  'trackingParams',
  'rendererContext',
  'onLongPress',
  'menu',
  'thumbnail',
  'thumbnails',
  'accessibility',
  'metadata'
]);

const isObj = (v: unknown): v is Json =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function isShortsItem(item: unknown): boolean {
  if (!isObj(item)) return false;

  const tile = item.tileRenderer;
  if (isObj(tile)) {
    const cmd = tile.onSelectCommand;
    return isObj(cmd) && cmd.reelWatchEndpoint != null;
  }

  const lockup = item.lockupViewModel;
  if (isObj(lockup)) {
    if (lockup.contentType === LOCKUP_SHORT) return true;
    const onTap = (
      (lockup.rendererContext as Json | undefined)?.commandContext as
        | Json
        | undefined
    )?.onTap as Json | undefined;
    const innertube = onTap?.innertubeCommand as Json | undefined;
    return !!innertube && innertube.reelWatchEndpoint != null;
  }

  const shelf = item.shelfRenderer;
  if (isObj(shelf)) return shelf.tvhtml5ShelfRendererType === SHELF_SHORTS;

  return false;
}

function walk(node: unknown, depth: number) {
  if (depth > 18) return;

  if (Array.isArray(node)) {
    let w = 0;
    for (let i = 0; i < node.length; i++) {
      const item: unknown = node[i];
      if (isShortsItem(item)) continue;
      node[w++] = item;
      walk(item, depth + 1);
    }
    node.length = w;
    return;
  }

  if (!isObj(node)) return;
  for (const key in node) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (v !== null && typeof v === 'object') walk(v, depth + 1);
  }
}

function shortsFilter(r: Json) {
  if (!configRead('removeShorts')) return;
  // Only feed-like responses; never the Shorts player's own sequence.
  if ('entries' in r) return;
  if (r.contents) walk(r.contents, 0);
  if (r.continuationContents) walk(r.continuationContents, 0);
}

addJsonFilter('shorts', shortsFilter);
