import {
  IconBrandFacebookFilled,
  IconBrandInstagramFilled,
  IconBrandTiktokFilled,
  IconBrandXFilled,
  IconBrandYoutubeFilled,
  type IconProps,
  IconUsers,
  IconWorld,
} from '@tabler/icons-react';
import { theme } from 'antd';
import type { ComponentType } from 'react';
import {
  getPlatformBrandColor,
  normalizePlatform,
  type PlatformKey,
} from './platformMeta';

type PlatformIconProps = {
  platform: string;
  size?: number;
  /** Overrides the brand color when provided. */
  color?: string;
};

const PLATFORM_ICON_MAP: Record<PlatformKey, ComponentType<IconProps>> = {
  facebook: IconBrandFacebookFilled,
  fb_group: IconUsers,
  instagram: IconBrandInstagramFilled,
  tiktok: IconBrandTiktokFilled,
  youtube: IconBrandYoutubeFilled,
  x: IconBrandXFilled,
};

export function PlatformIcon({
  platform,
  size = 16,
  color,
}: PlatformIconProps) {
  const { token } = theme.useToken();
  const key = normalizePlatform(platform);

  if (!key) {
    return <IconWorld size={size} color={color ?? token.colorTextSecondary} />;
  }

  const Icon = PLATFORM_ICON_MAP[key];
  return (
    <Icon size={size} color={color ?? getPlatformBrandColor(key, token)} />
  );
}
