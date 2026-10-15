import type {
  BreakdownContentTypeDataPoint,
  BreakdownDiscussionTypeDataPoint,
  BreakdownEngageTypeDataPoint,
  BreakdownPlatformDataPoint,
  BreakdownSentimentDataPoint,
  ChartData,
  ComparisonDataPoint,
  FilterType,
  SentimentTrendsDataPoint,
  SeriesConfig,
  TotalDataPoint,
} from './types';

export const CHART_HEIGHT = 260;
export const TOOLTIP_BG = '#1F1F1F';

export const SERIES_CONFIG: Record<FilterType, SeriesConfig[]> = {
  total: [
    { key: 'volume', label: 'Topic Discussion Volume', color: '#4DAAFF' },
  ],
  breakdown_platform: [
    { key: 'fb_fanpage', label: 'FB Fanpage', color: '#1677FF' },
    { key: 'fb_group', label: 'FB Group', color: '#52C41A' },
    { key: 'instagram', label: 'Instagram', color: '#722ED1' },
    { key: 'tiktok', label: 'TikTok', color: '#595959' },
    { key: 'youtube', label: 'YouTube', color: '#FF4D4F' },
  ],
  breakdown_content_type: [
    { key: 'text_only', label: 'Text Only', color: '#1677FF' },
    { key: 'link', label: 'Link', color: '#52C41A' },
    { key: 'photo', label: 'Photo', color: '#FA8C16' },
    { key: 'video', label: 'Video', color: '#FF4D4F' },
  ],
  breakdown_discussion_type: [
    { key: 'post', label: 'Post', color: '#1677FF' },
    { key: 'discussion', label: 'Discussion', color: '#52C41A' },
    { key: 'share', label: 'Share', color: '#FA8C16' },
  ],
  breakdown_sentiment: [
    { key: 'positive', label: 'Positive', color: '#1677FF' },
    { key: 'negative', label: 'Negative', color: '#52C41A' },
    { key: 'neutral', label: 'Neutral', color: '#FA8C16' },
    { key: 'unclassified', label: 'Unclassified', color: '#FF4D4F' },
  ],
  comparison_platform: [
    { key: 'current', label: 'This Period', color: '#1677FF' },
    {
      key: 'comparison',
      label: 'Comparison Period',
      color: '#8C8C8C',
      strokeDasharray: '5 5',
    },
  ],
  comparison_content_type: [
    { key: 'current', label: 'This Period', color: '#1677FF' },
    {
      key: 'comparison',
      label: 'Comparison Period',
      color: '#8C8C8C',
      strokeDasharray: '5 5',
    },
  ],
  comparison_discussion_type: [
    { key: 'current', label: 'This Period', color: '#1677FF' },
    {
      key: 'comparison',
      label: 'Comparison Period',
      color: '#8C8C8C',
      strokeDasharray: '5 5',
    },
  ],
  comparison_sentiment: [
    { key: 'current', label: 'This Period', color: '#1677FF' },
    {
      key: 'comparison',
      label: 'Comparison Period',
      color: '#8C8C8C',
      strokeDasharray: '5 5',
    },
  ],
  breakdown_engage_type: [
    { key: 'comments', label: 'Comments', color: '#1677FF' },
    { key: 'shares', label: 'Shares', color: '#52C41A' },
    { key: 'likes', label: 'Likes', color: '#FA8C16' },
  ],
  comparison_engage_type: [
    { key: 'current', label: 'This Period', color: '#1677FF' },
    {
      key: 'comparison',
      label: 'Comparison Period',
      color: '#8C8C8C',
      strokeDasharray: '5 5',
    },
  ],
  sentiment_trends: [
    { key: 'positive', label: 'Positive', color: '#52C41A' },
    { key: 'negative', label: 'Negative', color: '#FF4D4F' },
    { key: 'neutral', label: 'Neutral', color: '#FA8C16' },
  ],
};

export const FILTER_OPTIONS = [
  {
    label: 'AGGREGATE',
    options: [{ value: 'total', label: 'Total' }],
  },
  {
    label: 'BREAKDOWN',
    options: [
      { value: 'breakdown_platform', label: 'by Platform' },
      { value: 'breakdown_content_type', label: 'by Content Type' },
      { value: 'breakdown_discussion_type', label: 'by Discussion Type' },
      { value: 'breakdown_sentiment', label: 'by Sentiment' },
    ],
  },
  {
    label: 'COMPARISON',
    options: [
      { value: 'comparison_platform', label: 'by Platform' },
      { value: 'comparison_content_type', label: 'by Content Type' },
      { value: 'comparison_discussion_type', label: 'by Discussion Type' },
      { value: 'comparison_sentiment', label: 'by Sentiment' },
    ],
  },
];

const totalPoints: TotalDataPoint[] = [
  { date: '21 Mar', volume: 33 },
  { date: '22 Mar', volume: 40 },
  { date: '23 Mar', volume: 46 },
  { date: '24 Mar', volume: 56 },
  { date: '25 Mar', volume: 59 },
  { date: '26 Mar', volume: 55 },
  { date: '27 Mar', volume: 53 },
];

const platformPoints: BreakdownPlatformDataPoint[] = [
  {
    date: '21 Mar',
    fb_fanpage: 8,
    fb_group: 4,
    instagram: 9,
    tiktok: 7,
    youtube: 5,
  },
  {
    date: '22 Mar',
    fb_fanpage: 10,
    fb_group: 5,
    instagram: 10,
    tiktok: 9,
    youtube: 6,
  },
  {
    date: '23 Mar',
    fb_fanpage: 12,
    fb_group: 6,
    instagram: 12,
    tiktok: 10,
    youtube: 6,
  },
  {
    date: '24 Mar',
    fb_fanpage: 14,
    fb_group: 7,
    instagram: 16,
    tiktok: 12,
    youtube: 7,
  },
  {
    date: '25 Mar',
    fb_fanpage: 14,
    fb_group: 8,
    instagram: 16,
    tiktok: 13,
    youtube: 8,
  },
  {
    date: '26 Mar',
    fb_fanpage: 14,
    fb_group: 7,
    instagram: 15,
    tiktok: 13,
    youtube: 6,
  },
  {
    date: '27 Mar',
    fb_fanpage: 14,
    fb_group: 8,
    instagram: 13,
    tiktok: 15,
    youtube: 3,
  },
];

const contentTypePoints: BreakdownContentTypeDataPoint[] = [
  { date: '21 Mar', text_only: 25, link: 2, photo: 3, video: 3 },
  { date: '22 Mar', text_only: 31, link: 2, photo: 4, video: 3 },
  { date: '23 Mar', text_only: 35, link: 3, photo: 5, video: 3 },
  { date: '24 Mar', text_only: 43, link: 4, photo: 5, video: 4 },
  { date: '25 Mar', text_only: 45, link: 4, photo: 6, video: 4 },
  { date: '26 Mar', text_only: 42, link: 5, photo: 6, video: 2 },
  { date: '27 Mar', text_only: 42, link: 4, photo: 5, video: 2 },
];

const discussionTypePoints: BreakdownDiscussionTypeDataPoint[] = [
  { date: '21 Mar', post: 10, discussion: 18, share: 5 },
  { date: '22 Mar', post: 13, discussion: 20, share: 7 },
  { date: '23 Mar', post: 14, discussion: 25, share: 7 },
  { date: '24 Mar', post: 14, discussion: 37, share: 5 },
  { date: '25 Mar', post: 19, discussion: 34, share: 6 },
  { date: '26 Mar', post: 18, discussion: 30, share: 7 },
  { date: '27 Mar', post: 18, discussion: 21, share: 14 },
];

const sentimentPoints: BreakdownSentimentDataPoint[] = [
  { date: '21 Mar', positive: 10, negative: 9, neutral: 14, unclassified: 0 },
  { date: '22 Mar', positive: 13, negative: 11, neutral: 16, unclassified: 0 },
  { date: '23 Mar', positive: 14, negative: 12, neutral: 20, unclassified: 0 },
  { date: '24 Mar', positive: 14, negative: 13, neutral: 29, unclassified: 0 },
  { date: '25 Mar', positive: 19, negative: 13, neutral: 27, unclassified: 0 },
  { date: '26 Mar', positive: 18, negative: 15, neutral: 22, unclassified: 0 },
  { date: '27 Mar', positive: 18, negative: 17, neutral: 18, unclassified: 0 },
];

const comparisonPlatformPoints: ComparisonDataPoint[] = [
  { date: '21 Mar', current: 10, comparison: 40 },
  { date: '22 Mar', current: 11, comparison: 48 },
  { date: '23 Mar', current: 11, comparison: 46 },
  { date: '24 Mar', current: 12, comparison: 65 },
  { date: '25 Mar', current: 12, comparison: 50 },
  { date: '26 Mar', current: 11, comparison: 60 },
  { date: '27 Mar', current: 11, comparison: 55 },
];

const comparisonContentTypePoints: ComparisonDataPoint[] = [
  { date: '21 Mar', current: 28, comparison: 42 },
  { date: '22 Mar', current: 34, comparison: 50 },
  { date: '23 Mar', current: 40, comparison: 48 },
  { date: '24 Mar', current: 43, comparison: 65 },
  { date: '25 Mar', current: 38, comparison: 50 },
  { date: '26 Mar', current: 41, comparison: 60 },
  { date: '27 Mar', current: 33, comparison: 55 },
];

const comparisonDiscussionTypePoints: ComparisonDataPoint[] = [
  { date: '21 Mar', current: 12, comparison: 42 },
  { date: '22 Mar', current: 16, comparison: 48 },
  { date: '23 Mar', current: 19, comparison: 46 },
  { date: '24 Mar', current: 10, comparison: 65 },
  { date: '25 Mar', current: 14, comparison: 52 },
  { date: '26 Mar', current: 20, comparison: 60 },
  { date: '27 Mar', current: 17, comparison: 55 },
];

const comparisonSentimentPoints: ComparisonDataPoint[] = [
  { date: '21 Mar', current: 15, comparison: 42 },
  { date: '22 Mar', current: 16, comparison: 49 },
  { date: '23 Mar', current: 19, comparison: 46 },
  { date: '24 Mar', current: 15, comparison: 65 },
  { date: '25 Mar', current: 16, comparison: 52 },
  { date: '26 Mar', current: 15, comparison: 61 },
  { date: '27 Mar', current: 13, comparison: 55 },
];

const engageTypePoints: BreakdownEngageTypeDataPoint[] = [
  { date: '21 Mar', comments: 51, shares: 26, likes: 85, dislikes: 8 },
  { date: '22 Mar', comments: 58, shares: 29, likes: 97, dislikes: 9 },
  { date: '23 Mar', comments: 69, shares: 34, likes: 115, dislikes: 11 },
  { date: '24 Mar', comments: 88, shares: 44, likes: 147, dislikes: 15 },
  { date: '25 Mar', comments: 65, shares: 33, likes: 109, dislikes: 11 },
  { date: '26 Mar', comments: 55, shares: 28, likes: 92, dislikes: 9 },
  { date: '27 Mar', comments: 48, shares: 24, likes: 80, dislikes: 7 },
];

const sentimentTrendsPoints: SentimentTrendsDataPoint[] = [
  { date: '21 Mar', positive: 8, negative: 6, neutral: 12 },
  { date: '22 Mar', positive: 10, negative: 9, neutral: 11 },
  { date: '23 Mar', positive: 13, negative: 5, neutral: 9 },
  { date: '24 Mar', positive: 13, negative: 8, neutral: 12 },
  { date: '25 Mar', positive: 7, negative: 7, neutral: 16 },
  { date: '26 Mar', positive: 8, negative: 6, neutral: 12 },
  { date: '27 Mar', positive: 11, negative: 5, neutral: 7 },
];

const comparisonEngageTypePoints: ComparisonDataPoint[] = [
  { date: '21 Mar', current: 170, comparison: 215 },
  { date: '22 Mar', current: 193, comparison: 248 },
  { date: '23 Mar', current: 229, comparison: 235 },
  { date: '24 Mar', current: 294, comparison: 330 },
  { date: '25 Mar', current: 218, comparison: 255 },
  { date: '26 Mar', current: 184, comparison: 305 },
  { date: '27 Mar', current: 159, comparison: 278 },
];

export const MOCK_CHART_DATA: Record<FilterType, ChartData> = {
  total: { filterType: 'total', points: totalPoints },
  breakdown_platform: {
    filterType: 'breakdown_platform',
    points: platformPoints,
  },
  breakdown_content_type: {
    filterType: 'breakdown_content_type',
    points: contentTypePoints,
  },
  breakdown_discussion_type: {
    filterType: 'breakdown_discussion_type',
    points: discussionTypePoints,
  },
  breakdown_sentiment: {
    filterType: 'breakdown_sentiment',
    points: sentimentPoints,
  },
  comparison_platform: {
    filterType: 'comparison_platform',
    points: comparisonPlatformPoints,
  },
  comparison_content_type: {
    filterType: 'comparison_content_type',
    points: comparisonContentTypePoints,
  },
  comparison_discussion_type: {
    filterType: 'comparison_discussion_type',
    points: comparisonDiscussionTypePoints,
  },
  comparison_sentiment: {
    filterType: 'comparison_sentiment',
    points: comparisonSentimentPoints,
  },
  breakdown_engage_type: {
    filterType: 'breakdown_engage_type',
    points: engageTypePoints,
  },
  comparison_engage_type: {
    filterType: 'comparison_engage_type',
    points: comparisonEngageTypePoints,
  },
  sentiment_trends: {
    filterType: 'sentiment_trends',
    points: sentimentTrendsPoints,
  },
};
