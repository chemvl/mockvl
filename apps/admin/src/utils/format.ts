const numberFormatter = new Intl.NumberFormat('en-US');

/**
 * Format a number with thousand separators.
 * Replaces numeral(val).format('0,0')
 */
export const formatNumber = (val: number | string): string => {
  const parsed = Number(val);
  return Number.isFinite(parsed) ? numberFormatter.format(parsed) : '';
};

/**
 * Format a number as yuan currency string.
 * Replaces `¥ ${numeral(val).format('0,0')}`
 */
export const formatYuan = (val: number | string) => `¥ ${formatNumber(val)}`;

export const formatKNumber = (num: number) => {
  if (num > 999 && num < 1000000) {
    return (num / 1000).toFixed(0) + 'K';
  } else if (num >= 1000000) {
    return (num / 1000000).toFixed(2).replace('.00', '') + 'M';
  }
  return num;
};