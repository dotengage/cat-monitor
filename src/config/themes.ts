/**
 * Themes.
 *
 * Each theme is a complete palette defined in CSS against
 * `:root[data-theme='<id>']`. Nothing in the interface hard-codes a colour -
 * buttons, pills, charts and meters all read the same tokens - so adding a
 * palette here and a matching block in the stylesheet is the whole job.
 *
 * `swatch` is only for the picker: the two colours a person actually uses to
 * recognise a theme at a glance, its page background and its accent.
 */
export interface ThemeMeta {
  id: ThemeName;
  label: string;
  group: 'Base' | 'Pastel' | 'Dark';
  /** [background, accent] - what the picker dot shows. */
  swatch: [string, string];
  /** Browser UI colour while this theme is active. */
  themeColor: string;
}

export const THEME_NAMES = [
  'system',
  'light',
  'dark',
  'mint',
  'lavender',
  'blush',
  'apricot',
  'sky',
  'sand',
  'midnight',
] as const;

export type ThemeName = (typeof THEME_NAMES)[number];

export const THEMES: ThemeMeta[] = [
  { id: 'system', label: 'System', group: 'Base', swatch: ['#fcfcfd', '#6366f1'], themeColor: '#fcfcfd' },
  { id: 'light', label: 'Light', group: 'Base', swatch: ['#fcfcfd', '#6366f1'], themeColor: '#fcfcfd' },
  { id: 'dark', label: 'Dark', group: 'Dark', swatch: ['#0f0f11', '#818cf8'], themeColor: '#0f0f11' },
  { id: 'mint', label: 'Mint', group: 'Pastel', swatch: ['#f2f8f4', '#1f8a63'], themeColor: '#f2f8f4' },
  { id: 'lavender', label: 'Lavender', group: 'Pastel', swatch: ['#f6f4fb', '#7c5cd6'], themeColor: '#f6f4fb' },
  { id: 'blush', label: 'Blush', group: 'Pastel', swatch: ['#fdf5f6', '#c44a70'], themeColor: '#fdf5f6' },
  { id: 'apricot', label: 'Apricot', group: 'Pastel', swatch: ['#fdf6f0', '#bc5b28'], themeColor: '#fdf6f0' },
  { id: 'sky', label: 'Sky', group: 'Pastel', swatch: ['#f1f7fc', '#2679bb'], themeColor: '#f1f7fc' },
  { id: 'sand', label: 'Sand', group: 'Pastel', swatch: ['#faf7f0', '#8d6f2b'], themeColor: '#faf7f0' },
  { id: 'midnight', label: 'Midnight', group: 'Dark', swatch: ['#14161d', '#9db4ff'], themeColor: '#14161d' },
];

export function themeMeta(id: string): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[1];
}

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && THEME_NAMES.includes(value as ThemeName);
}

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

export const DEFAULT_BRAND_NAME = 'CAT Monitor';
export const DEFAULT_BRAND_GLYPH = 'C';

/** Uploaded marks are squashed to this many pixels square before storing. */
export const BRAND_IMAGE_PX = 128;
