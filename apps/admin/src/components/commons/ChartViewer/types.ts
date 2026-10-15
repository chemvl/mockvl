export type FilterType =
  | 'total'
  | 'breakdown_platform'
  | 'breakdown_content_type'
  | 'breakdown_discussion_type'
  | 'breakdown_sentiment'
  | 'breakdown_engage_type'
  | 'comparison_platform'
  | 'comparison_content_type'
  | 'comparison_discussion_type'
  | 'comparison_sentiment'
  | 'comparison_engage_type'
  | 'sentiment_trends';

export type TotalDataPoint = {
  date: string;
  volume: number;
};

export type BreakdownPlatformDataPoint = {
  date: string;
  fb_fanpage: number;
  fb_group: number;
  instagram: number;
  tiktok: number;
  youtube: number;
};

export type BreakdownContentTypeDataPoint = {
  date: string;
  text_only: number;
  link: number;
  photo: number;
  video: number;
};

export type BreakdownDiscussionTypeDataPoint = {
  date: string;
  post: number;
  discussion: number;
  share: number;
};

export type BreakdownSentimentDataPoint = {
  date: string;
  positive: number;
  negative: number;
  neutral: number;
  unclassified: number;
};

export type BreakdownEngageTypeDataPoint = {
  date: string;
  comments: number;
  shares: number;
  likes: number;
  dislikes?: number;
};

export type ComparisonDataPoint = {
  date: string;
  current: number;
  comparison: number;
};

export type SentimentTrendsDataPoint = {
  date: string;
  positive: number;
  negative: number;
  neutral: number;
};

export type ChartData =
  | { filterType: 'total'; points: TotalDataPoint[] }
  | { filterType: 'breakdown_platform'; points: BreakdownPlatformDataPoint[] }
  | {
      filterType: 'breakdown_content_type';
      points: BreakdownContentTypeDataPoint[];
    }
  | {
      filterType: 'breakdown_discussion_type';
      points: BreakdownDiscussionTypeDataPoint[];
    }
  | { filterType: 'breakdown_sentiment'; points: BreakdownSentimentDataPoint[] }
  | {
      filterType: 'breakdown_engage_type';
      points: BreakdownEngageTypeDataPoint[];
    }
  | { filterType: 'comparison_platform'; points: ComparisonDataPoint[] }
  | { filterType: 'comparison_content_type'; points: ComparisonDataPoint[] }
  | { filterType: 'comparison_discussion_type'; points: ComparisonDataPoint[] }
  | { filterType: 'comparison_sentiment'; points: ComparisonDataPoint[] }
  | { filterType: 'comparison_engage_type'; points: ComparisonDataPoint[] }
  | { filterType: 'sentiment_trends'; points: SentimentTrendsDataPoint[] };

export type SeriesConfig = {
  key: string;
  label: string;
  color: string;
  strokeDasharray?: string;
};

export type ChartViewerProps = {
  filterType: FilterType;
  data: ChartData;
  onPointClick?: (date: string) => void;
  activeSeries?: string[];
};
