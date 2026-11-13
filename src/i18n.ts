/**
 * Tiny two-language string table. Swedish when the TV/YouTube runs in Swedish,
 * English otherwise.
 */

export interface L10n {
  en: string;
  sv: string;
}

function detectLang(): keyof L10n {
  const candidates = [
    document.documentElement.lang,
    ...(navigator.languages ?? []),
    navigator.language
  ];
  for (const c of candidates) {
    if (!c) continue;
    const lc = c.toLowerCase();
    if (lc.startsWith('sv')) return 'sv';
    return 'en';
  }
  return 'en';
}

let lang: keyof L10n | null = null;

export function t(s: L10n): string {
  lang ??= detectLang();
  return s[lang];
}

export function tf(s: L10n, vars: Record<string, string | number>): string {
  return t(s).replace(/\{(\w+)\}/g, (m, k: string) =>
    k in vars ? String(vars[k]) : m
  );
}
