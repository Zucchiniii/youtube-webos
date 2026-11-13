/**
 * Marks player requests as "inline playback, no ads" so YouTube's server-side
 * ad back-off (fake buffering when ads were stripped) is not applied.
 *
 * Upstream deep-cloned *every* object passed to `JSON.stringify` with
 * `structuredClone` (to cope with frozen objects) – a big cost on TV CPUs since
 * YouTube stringifies constantly. Now only player requests are touched, and
 * only the three objects on the path are shallow-copied.
 */

import { configRead } from '../config';

const originalStringify = JSON.stringify;

type Replacer =
  | ((this: unknown, key: string, value: unknown) => unknown)
  | (string | number)[]
  | null
  | undefined;

function patchPlaybackContext(value: Record<string, unknown>) {
  const playbackContext = value.playbackContext;
  if (!playbackContext || typeof playbackContext !== 'object') return value;

  const ctx = (playbackContext as Record<string, unknown>)
    .contentPlaybackContext;
  if (!ctx || typeof ctx !== 'object') return value;
  if ((ctx as Record<string, unknown>).isInlinePlaybackNoAd === true)
    return value;

  return {
    ...value,
    playbackContext: {
      ...playbackContext,
      contentPlaybackContext: { ...ctx, isInlinePlaybackNoAd: true }
    }
  };
}

function stringify(
  this: unknown,
  value: unknown,
  replacer?: Replacer,
  space?: string | number
): string {
  if (
    value !== null &&
    typeof value === 'object' &&
    'playbackContext' in value &&
    configRead('enableAdBlock')
  ) {
    value = patchPlaybackContext(value as Record<string, unknown>);
  }

  return originalStringify.call(
    JSON,
    value,
    replacer as Parameters<typeof JSON.stringify>[1],
    space
  );
}

JSON.stringify = stringify as typeof JSON.stringify;
