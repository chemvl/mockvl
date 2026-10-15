import {
  IconHelpOctagon,
  IconMoodNeutral,
  IconMoodSad,
  IconMoodSmile,
  type IconProps,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import {
  normalizeSentiment,
  SENTIMENT_COLORS,
  type SentimentKey,
} from './sentimentMeta';

type SentimentIconProps = {
  sentiment: string;
  size?: number;
  /** Overrides the semantic color when provided. */
  color?: string;
};

const SENTIMENT_ICON_MAP: Record<SentimentKey, ComponentType<IconProps>> = {
  positive: IconMoodSmile,
  negative: IconMoodSad,
  neutral: IconMoodNeutral,
  unclassified: IconHelpOctagon,
};

export function SentimentIcon({
  sentiment,
  size = 16,
  color,
}: SentimentIconProps) {
  const key = normalizeSentiment(sentiment) ?? 'unclassified';
  const Icon = SENTIMENT_ICON_MAP[key];
  return <Icon size={size} color={color ?? SENTIMENT_COLORS[key]} />;
}
