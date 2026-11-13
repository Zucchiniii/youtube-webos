/**
 * Illustrations for the settings entries. YouTube shows the focused setting's
 * thumbnail large in the detail pane, so each option gets a simple icon.
 *
 * Returned as base64 data URIs: YouTube inserts them as `url(<uri>)` without
 * quotes, so the URI must not contain spaces, quotes or parentheses.
 */

const GLYPHS = {
  shield:
    '<path d="M120 52 172 72v42c0 34-22 60-52 72-30-12-52-38-52-72V72z" fill="#fff"/><path d="m98 118 16 16 30-32" fill="none" stroke="COLOR" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>',
  image:
    '<rect x="56" y="70" width="128" height="100" rx="14" fill="#fff"/><text x="120" y="136" font-family="Arial,Helvetica,sans-serif" font-size="44" font-weight="700" text-anchor="middle" fill="COLOR">HD</text>',
  shorts:
    '<path d="M138 58c14-8 32-2 39 12 8 14 3 32-11 40l-8 5 10 5c13 7 18 23 12 36-4 9-12 15-21 17l-56 27c-14 8-32 2-39-12-8-14-3-32 11-40l8-5-10-5c-13-7-18-23-12-36 4-9 12-15 21-17z" fill="#fff"/><path d="M60 180 180 60" stroke="COLOR" stroke-width="14" stroke-linecap="round"/>',
  quality:
    '<rect x="50" y="74" width="140" height="92" rx="16" fill="#fff"/><text x="120" y="138" font-family="Arial,Helvetica,sans-serif" font-size="50" font-weight="700" text-anchor="middle" fill="COLOR">4K</text>',
  pulse:
    '<path d="M48 124h36l14-36 24 76 18-52 10 12h42" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>',
  endscreen:
    '<rect x="52" y="68" width="136" height="104" rx="14" fill="#fff"/><rect x="66" y="82" width="48" height="34" rx="6" fill="COLOR" opacity=".5"/><rect x="126" y="82" width="48" height="34" rx="6" fill="COLOR" opacity=".5"/><path d="m80 158 80-48" stroke="COLOR" stroke-width="10" stroke-linecap="round"/>',
  account:
    '<circle cx="104" cy="96" r="26" fill="#fff"/><path d="M58 172c4-28 24-44 46-44s42 16 46 44z" fill="#fff"/><path d="m150 98 20 20-20 20M134 118h34" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>',
  clock:
    '<circle cx="120" cy="120" r="62" fill="#fff"/><path d="M120 84v38l26 16" fill="none" stroke="COLOR" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>',
  eyeOff:
    '<path d="M48 120c18-30 44-46 72-46s54 16 72 46c-18 30-44 46-72 46s-54-16-72-46z" fill="#fff"/><circle cx="120" cy="120" r="22" fill="COLOR"/><path d="M64 176 176 64" stroke="COLOR" stroke-width="12" stroke-linecap="round"/><path d="M64 176 176 64" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
  skip: '<path d="M70 72v96l64-48zM134 72v96l64-48z" fill="#fff"/>',
  reset:
    '<path d="M168 120a48 48 0 1 1-14-34" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/><path d="M160 58v34h-34" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="120" cy="82" r="11" fill="#fff"/><rect x="109" y="104" width="22" height="64" rx="11" fill="#fff"/>'
} as const;

export type IconName = keyof typeof GLYPHS;

const cache = new Map<string, string>();

export function iconUri(name: IconName, color: string): string {
  const id = name + color;
  let uri = cache.get(id);
  if (uri) return uri;

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">' +
    `<circle cx="120" cy="120" r="112" fill="${color}"/>` +
    GLYPHS[name].replace(/COLOR/g, color) +
    '</svg>';
  uri = 'data:image/svg+xml;base64,' + btoa(svg);
  cache.set(id, uri);
  return uri;
}
