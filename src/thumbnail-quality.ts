/**
 * HD thumbnails.
 *
 * YouTube TV asks for 320×180 thumbnails (`hqdefault.jpg?sqp=…`, a signed
 * server-side resize) and shows them at ~530×300 or larger, so they look soft.
 * We swap them for the full 1280×720 `hq720.jpg` (or 640×480 `sddefault.jpg`
 * when a video has no HD frame).
 *
 * Why upstream still showed blurry thumbnails:
 * - It only handled `<ytlr-thumbnail-details>`; most tiles in the current UI
 *   are `<image>` elements, which were never upgraded.
 * - Thumbnails served from `i1…i9.ytimg.com` and `hq720.jpg?sqp=…` resizes
 *   were skipped.
 * - It watched every style change in the whole page with a MutationObserver,
 *   which also fires on every animation frame, and loaded each image twice.
 *
 * Here the swap happens when YouTube assigns the style (it sets
 * `style.cssText`) and when it preloads the image, before anything is drawn:
 * no observer, and the blurry version is never shown. Results are cached per
 * video, and a video without an HD frame falls back to `sddefault`, then to
 * the original.
 */

const Quality = { Pending: 0, HQ720: 1, SD: 2, None: 3 } as const;
type Quality = (typeof Quality)[keyof typeof Quality];

// i.ytimg.com / i9.ytimg.com, vi or vi_webp, 11-char id, base name, optional
// suffix, extension, optional query.
const THUMB_RE =
  /https?:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\/([a-z\d]+)(_live|_custom_\d+)?\.(?:jpg|webp)(?:\?[^"')\s]*)?/;

const UPGRADABLE = new Set([
  'default',
  'mqdefault',
  'hqdefault',
  'sddefault',
  'hq720'
]);

const MAX_CACHE = 3000;
const PROBE_TIMEOUT_MS = 15000;

const quality = new Map<string, Quality>();
/** Styles showing an optimistic URL while its probe runs: style -> original */
const waiting = new Map<string, Map<CSSStyleDeclaration, string>>();

function candidates(id: string, suffix: string): [string, string] {
  return [
    `https://i.ytimg.com/vi/${id}/hq720${suffix}.jpg`,
    `https://i.ytimg.com/vi/${id}/sddefault${suffix}.jpg`
  ];
}

interface Thumb {
  url: string;
  id: string;
  /** Suffix used for the HD candidates ('' or '_live'). */
  suffix: string;
  key: string;
}

/** Find an upgradable thumbnail URL in a string (URL or CSS text). */
function parseThumb(text: string): Thumb | null {
  const m = THUMB_RE.exec(text);
  if (!m) return null;

  const [url, id, name, rawSuffix = ''] = m as unknown as [
    string,
    string,
    string,
    string | undefined
  ];
  if (!UPGRADABLE.has(name)) return null;
  // Already the full-size image.
  if (name === 'hq720' && !url.includes('?')) return null;
  if (isPortraitCrop(url)) return null;

  // A/B-test variants (`_custom_N`) only exist as small signed resizes; use
  // the video's standard thumbnail instead.
  const suffix = rawSuffix === '_live' ? rawSuffix : '';
  return { url, id, suffix, key: id + suffix };
}

/**
 * The `sqp` parameter is a protobuf with the requested size. Skip portrait
 * crops (Shorts-style tiles): the full image is landscape.
 */
function isPortraitCrop(url: string): boolean {
  const m = /[?&]sqp=([^&]+)/.exec(url);
  if (!m) return false;
  try {
    const b64 = decodeURIComponent(m[1]!).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    let pos = 0;
    const varint = () => {
      let result = 0;
      let shift = 0;
      while (pos < bytes.length) {
        const b = bytes[pos++]!;
        result += (b & 0x7f) * 2 ** shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      return result;
    };

    // Outer message: one length-delimited field holding the size message.
    varint(); // tag
    const len = varint();
    const end = Math.min(bytes.length, pos + len);
    let width = 0;
    let height = 0;
    while (pos < end) {
      const tag = varint();
      const field = Math.floor(tag / 8);
      const type = tag & 7;
      if (type === 0) {
        const v = varint();
        if (field === 1) width = v;
        else if (field === 2) height = v;
      } else if (type === 2) {
        pos += varint();
      } else if (type === 5) {
        pos += 4;
      } else if (type === 1) {
        pos += 8;
      } else {
        break;
      }
    }
    return width > 0 && height > width;
  } catch {
    return false;
  }
}

function remember(key: string, q: Quality) {
  if (quality.size >= MAX_CACHE) {
    // Maps iterate in insertion order: drop the oldest entry.
    const oldest = quality.keys().next().value;
    if (oldest !== undefined) quality.delete(oldest);
  }
  quality.set(key, q);
}

function loads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
    function done(ok: boolean) {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(ok);
    }
    // Missing sizes come back as a 120×90 grey placeholder (HTTP 404).
    img.onload = () => done(img.naturalWidth > 120);
    img.onerror = () => done(false);
    nativeSrcSet.call(img, url);
  });
}

function retarget(key: string, from: string, to: string | null) {
  const styles = waiting.get(key);
  waiting.delete(key);
  if (!styles) return;
  for (const [style, original] of styles) {
    const bg = style.backgroundImage;
    if (bg.includes(from)) {
      nativeBgSet.call(style, `url("${to ?? original}")`);
    }
  }
}

async function probe(key: string, id: string, suffix: string) {
  const [hq, sd] = candidates(id, suffix);
  if (await loads(hq)) {
    remember(key, Quality.HQ720);
    waiting.delete(key);
    return;
  }
  if (await loads(sd)) {
    remember(key, Quality.SD);
    retarget(key, hq, sd);
    return;
  }
  remember(key, Quality.None);
  retarget(key, hq, null);
}

function startProbe(thumb: Thumb) {
  remember(thumb.key, Quality.Pending);
  void probe(thumb.key, thumb.id, thumb.suffix);
}

/** Returns the CSS text with the thumbnail URL upgraded (or unchanged). */
function upgradeCss(style: CSSStyleDeclaration, css: string): string {
  const thumb = parseThumb(css);
  if (!thumb) return css;

  const known = quality.get(thumb.key);
  if (known === Quality.None) return css;

  const [hq, sd] = candidates(thumb.id, thumb.suffix);
  const target = known === Quality.SD ? sd : hq;

  if (known === undefined) startProbe(thumb);
  if (known === undefined || known === Quality.Pending) {
    // Shown optimistically; reverted if the HD image turns out not to exist.
    let styles = waiting.get(thumb.key);
    if (!styles) waiting.set(thumb.key, (styles = new Map()));
    styles.set(style, thumb.url);
  }

  return css.replace(thumb.url, target);
}

/**
 * YouTube preloads each thumbnail with a detached `Image` before assigning
 * the background. Known-good HD URLs are swapped in right there (one
 * download); unknown ones start their probe early so the HD image is ready by
 * the time the background is set. Unknown URLs are not rewritten, because a
 * failed preload could make YouTube drop the tile.
 */
function upgradeSrc(url: string): string {
  const thumb = parseThumb(url);
  if (!thumb) return url;

  const known = quality.get(thumb.key);
  if (known === undefined) {
    startProbe(thumb);
    return url;
  }
  const [hq, sd] = candidates(thumb.id, thumb.suffix);
  if (known === Quality.HQ720) return hq;
  if (known === Quality.SD) return sd;
  return url;
}

/* ---------------- Setter hooks ---------------- */

const srcDesc = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  'src'
)!;
const nativeSrcSet = srcDesc.set!;

Object.defineProperty(HTMLImageElement.prototype, 'src', {
  ...srcDesc,
  set(this: HTMLImageElement, value: string) {
    if (typeof value === 'string' && value.includes('ytimg.com/vi')) {
      value = upgradeSrc(value);
    }
    nativeSrcSet.call(this, value);
  }
});

const proto = CSSStyleDeclaration.prototype;
const cssTextDesc = Object.getOwnPropertyDescriptor(proto, 'cssText')!;
const bgDesc = Object.getOwnPropertyDescriptor(proto, 'backgroundImage');
const nativeCssTextSet = cssTextDesc.set!;
const nativeBgSet: (this: CSSStyleDeclaration, v: string) => void =
  bgDesc?.set ??
  function (this: CSSStyleDeclaration, v: string) {
    this.setProperty('background-image', v);
  };

Object.defineProperty(proto, 'cssText', {
  ...cssTextDesc,
  set(this: CSSStyleDeclaration, value: string) {
    if (typeof value === 'string' && value.includes('ytimg.com/vi')) {
      value = upgradeCss(this, value);
    }
    nativeCssTextSet.call(this, value);
  }
});

if (bgDesc?.set) {
  Object.defineProperty(proto, 'backgroundImage', {
    ...bgDesc,
    set(this: CSSStyleDeclaration, value: string) {
      if (typeof value === 'string' && value.includes('ytimg.com/vi')) {
        value = upgradeCss(this, value);
      }
      nativeBgSet.call(this, value);
    }
  });
}
