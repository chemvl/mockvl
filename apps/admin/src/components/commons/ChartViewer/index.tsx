import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_HEIGHT, SERIES_CONFIG, TOOLTIP_BG } from './constants';
import type { ChartViewerProps, FilterType } from './types';

type TooltipPayloadEntry = {
  name: string;
  value: number;
  color: string;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  filterType: FilterType;
};

function CustomTooltip({
  active,
  payload,
  label,
  filterType,
}: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const isBreakdown = filterType.startsWith('breakdown_');
  const total = isBreakdown
    ? payload.reduce((sum, e) => sum + (e.value ?? 0), 0)
    : null;

  return (
    <div
      style={{
        background: TOOLTIP_BG,
        borderRadius: 6,
        padding: '10px 14px',
        minWidth: 210,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          color: '#fff',
          fontWeight: 600,
          fontSize: 13,
          marginBottom: 8,
          borderBottom: '1px solid #333',
          paddingBottom: 6,
        }}
      >
        {label}
      </div>
      {payload.map((entry) => (
        <div
          key={entry.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: entry.color,
              flexShrink: 0,
            }}
          />
          <span style={{ color: '#ccc', fontSize: 12, flex: 1 }}>
            {entry.name}
          </span>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>
            {entry.value}
          </span>
        </div>
      ))}
      {isBreakdown && total !== null && (
        <div
          style={{
            borderTop: '1px solid #333',
            paddingTop: 4,
            marginTop: 4,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>
            Total
          </span>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>
            {total}
          </span>
        </div>
      )}
      <div
        style={{
          color: '#1677FF',
          fontSize: 11,
          marginTop: 6,
          textAlign: 'center',
        }}
      >
        Click chart to view discussions
      </div>
    </div>
  );
}

type LegendPayloadEntry = {
  value: string;
  color: string;
};

type CustomLegendProps = {
  payload?: LegendPayloadEntry[];
  filterType: FilterType;
};

function CustomLegend({ payload, filterType }: CustomLegendProps) {
  if (!payload?.length) return null;
  const isComparison = filterType.startsWith('comparison_');

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginTop: 8,
        paddingBottom: 4,
      }}
    >
      {payload.map((entry) => {
        const isDashed = isComparison && entry.value === 'Comparison Period';
        return (
          <div
            key={entry.value}
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            {isDashed ? (
              <svg width="18" height="8" style={{ flexShrink: 0 }}>
                <title>Comparison Period</title>
                <line
                  x1="0"
                  y1="4"
                  x2="18"
                  y2="4"
                  stroke={entry.color}
                  strokeWidth={2}
                  strokeDasharray="4 2"
                />
              </svg>
            ) : (
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: entry.color,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
            )}
            <span style={{ fontSize: 12, color: '#595959' }}>
              {entry.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ChartViewer({
  filterType,
  data,
  onPointClick,
  activeSeries,
}: ChartViewerProps) {
  const rawSeries = SERIES_CONFIG[filterType];
  const series = activeSeries
    ? rawSeries.filter((s) => activeSeries.includes(s.key))
    : rawSeries;
  const isComparison = filterType.startsWith('comparison_');
  const isSentimentTrends = filterType === 'sentiment_trends';
  const isEngageType = filterType === 'breakdown_engage_type';
  const isTotal = filterType === 'total';

  // biome-ignore lint/suspicious/noExplicitAny: recharts click state type not exported cleanly
  function handleClick(state: any) {
    if (state?.activeLabel !== undefined && onPointClick) {
      onPointClick(String(state.activeLabel));
    }
  }

  const sharedChartProps = {
    // biome-ignore lint/suspicious/noExplicitAny: recharts data accepts any object array
    data: data.points as any[],
    onClick: handleClick,
    margin: { top: 5, right: 10, left: -20, bottom: 5 },
  };

  const gridAndAxes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
      <XAxis
        dataKey="date"
        tick={{ fontSize: 11, fill: '#8C8C8C' }}
        axisLine={false}
        tickLine={false}
      />
      <YAxis
        tick={{ fontSize: 11, fill: '#8C8C8C' }}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip
        content={<CustomTooltip filterType={filterType} />}
        cursor={{ stroke: '#D9D9D9', strokeDasharray: '4 2' }}
      />
      {!isTotal && (
        <Legend content={<CustomLegend filterType={filterType} />} />
      )}
    </>
  );

  if (isSentimentTrends || isEngageType) {
    return (
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart {...sharedChartProps}>
          {gridAndAxes}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (isComparison) {
    return (
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart {...sharedChartProps}>
          {gridAndAxes}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.strokeDasharray}
              dot={{ fill: s.color, r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart {...sharedChartProps}>
        {gridAndAxes}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={isTotal ? undefined : 'stack'}
            stroke={s.color}
            strokeWidth={isTotal ? 1.5 : 0}
            fill={isTotal ? '#BAE0FF' : s.color}
            fillOpacity={1}
            dot={false}
            activeDot={
              isTotal
                ? { r: 4, fill: s.color, strokeWidth: 2, stroke: '#fff' }
                : false
            }
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
