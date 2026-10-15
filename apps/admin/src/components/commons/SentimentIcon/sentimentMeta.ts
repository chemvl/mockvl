export type SentimentKey = 'positive' | 'negative' | 'neutral' | 'unclassified';

/**
 * Maps every sentiment identifier scheme used across the app
 * (canonical keys, API values, display labels) to a canonical key.
 * Keys are compared case-insensitively against the raw input.
 */
const SENTIMENT_ALIASES: Record<string, SentimentKey> = {
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutral',
  unclassified: 'unclassified',
};

export function normalizeSentiment(input: string): SentimentKey | null {
  if (!input) return null;
  return SENTIMENT_ALIASES[input.trim().toLowerCase()] ?? null;
}

/**
 * Semantic color for each sentiment: positive=green, negative=red,
 * neutral=yellow, unclassified=gray.
 */
export const SENTIMENT_COLORS: Record<SentimentKey, string> = {
  positive: '#52c41a',
  negative: '#ff4d4f',
  neutral: '#faad14',
  unclassified: '#8c8c8c',
};
