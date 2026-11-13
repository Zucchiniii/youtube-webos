/**
 * Strips ads from InnerTube responses. A minimal reimplementation of the
 * relevant uBlock Origin rules
 * (https://github.com/uBlockOrigin/uAssets/blob/master/filters/filters.txt),
 * plus the TV-specific ad tiles and masthead.
 */

import { configRead } from './config';
import { addJsonFilter } from './hooks/json-parse';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function get(obj: unknown, ...path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function isAdItem(item: unknown) {
  return (
    isObj(item) && ('adSlotRenderer' in item || 'tvMastheadRenderer' in item)
  );
}

/** Remove ad slots from a list of shelves/sections and from each shelf. */
function cleanSections(contents: unknown) {
  if (!Array.isArray(contents)) return;

  for (let i = contents.length - 1; i >= 0; i--) {
    if (isAdItem(contents[i])) {
      contents.splice(i, 1);
      continue;
    }
    const shelfContent = get(contents[i], 'shelfRenderer', 'content');
    for (const listKey of ['horizontalListRenderer', 'gridRenderer']) {
      const items = get(shelfContent, listKey, 'items');
      if (Array.isArray(items)) {
        for (let j = items.length - 1; j >= 0; j--) {
          if (isAdItem(items[j])) items.splice(j, 1);
        }
      }
    }
  }
}

function adblockFilter(r: Json) {
  if (!configRead('enableAdBlock')) return;

  // Player response: in-video ads.
  if ('adPlacements' in r) delete r.adPlacements;
  if (Array.isArray(r.adSlots)) delete r.adSlots;
  if ('playerAds' in r) delete r.playerAds;

  // Home: masthead + ad tiles.
  cleanSections(
    get(
      r,
      'contents',
      'tvBrowseRenderer',
      'content',
      'tvSurfaceContentRenderer',
      'content',
      'sectionListRenderer',
      'contents'
    )
  );

  // Search results.
  cleanSections(get(r, 'contents', 'sectionListRenderer', 'contents'));

  // Continuations (scrolling further down / right).
  cleanSections(
    get(r, 'continuationContents', 'sectionListContinuation', 'contents')
  );
  const hItems = get(
    r,
    'continuationContents',
    'horizontalListContinuation',
    'items'
  );
  if (Array.isArray(hItems)) {
    for (let j = hItems.length - 1; j >= 0; j--) {
      if (isAdItem(hItems[j])) hItems.splice(j, 1);
    }
  }

  // Shorts player feed.
  if (Array.isArray(r.entries)) {
    r.entries = r.entries.filter(
      (e: unknown) =>
        !get(e, 'command', 'reelWatchEndpoint', 'adClientParams', 'isAd')
    );
  }
}

addJsonFilter('adblock', adblockFilter);
