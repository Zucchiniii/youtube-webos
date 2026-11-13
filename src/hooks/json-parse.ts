/**
 * A single `JSON.parse` wrapper that runs every response filter.
 *
 * Upstream wrapped `JSON.parse` once per feature (adblock, Shorts, end
 * screens), so every parse – YouTube parses constantly, mostly tiny storage
 * values – went through three wrappers, and the Shorts filter walked the whole
 * object three times. Here there is one wrapper, small payloads are skipped
 * outright, and each filter is isolated so one failure can never break
 * YouTube's own parsing.
 */

/** `text` is the raw JSON, handy for a cheap `indexOf` pre-check. */
export type JsonFilter = (data: Record<string, unknown>, text: string) => void;

const filters: { name: string; fn: JsonFilter }[] = [];

// Responses we care about are big; storage reads and RPC acks are tiny.
const MIN_LENGTH = 200;

const originalParse = JSON.parse;

function parse(
  this: unknown,
  text: string,
  reviver?: (this: unknown, key: string, value: unknown) => unknown
): unknown {
  const result: unknown = originalParse.call(JSON, text, reviver);

  if (
    filters.length !== 0 &&
    result !== null &&
    typeof result === 'object' &&
    typeof text === 'string' &&
    text.length >= MIN_LENGTH
  ) {
    const data = result as Record<string, unknown>;
    for (const { name, fn } of filters) {
      try {
        fn(data, text);
      } catch (err) {
        console.warn(`[json-parse] filter "${name}" failed:`, err);
      }
    }
  }

  return result;
}

JSON.parse = parse as typeof JSON.parse;

export function addJsonFilter(name: string, fn: JsonFilter) {
  filters.push({ name, fn });
}

/** The unwrapped parser, for our own use. */
export const rawJsonParse: typeof JSON.parse = (text, reviver) =>
  originalParse.call(JSON, text, reviver) as ReturnType<typeof JSON.parse>;
