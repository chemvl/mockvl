import type { GlobalToken } from 'antd';

export type PlatformKey =
  | 'facebook'
  | 'fb_group'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'x';

/**
 * Maps every platform identifier scheme used across the app
 * (canonical keys, API short codes, display labels) to a canonical key.
 * Keys are compared case-insensitively against the raw input.
 */
const PLATFORM_ALIASES: Record<string, PlatformKey> = {
  facebook: 'facebook',
  fb: 'facebook',
  fb_fanpage: 'facebook',
  'fb fanpage': 'facebook',
  fb_group: 'fb_group',
  'fb group': 'fb_group',
  fg: 'fb_group',
  fp: 'facebook',
  instagram: 'instagram',
  ig: 'instagram',
  tiktok: 'tiktok',
  tt: 'tiktok',
  youtube: 'youtube',
  yt: 'youtube',
  x: 'x',
  twitter: 'x',
  'x/twitter': 'x',
};

export function normalizePlatform(input: string): PlatformKey | null {
  if (!input) return null;
  return PLATFORM_ALIASES[input.trim().toLowerCase()] ?? null;
}

const BRAND_COLORS: Record<PlatformKey, string> = {
  facebook: '#1877F2',
  fb_group: '#1877F2',
  instagram: '#E4405F',
  tiktok: '', // resolved to theme text color
  youtube: '#FF0000',
  x: '', // resolved to theme text color
};

/**
 * Returns the brand color for a platform. TikTok and X use the theme text color
 * so their (black) icons stay visible in dark mode.
 */
export function getPlatformBrandColor(
  key: PlatformKey,
  token: GlobalToken,
): string {
  if (key === 'tiktok' || key === 'x') return token.colorText;
  return BRAND_COLORS[key];
}
