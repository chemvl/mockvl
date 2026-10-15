import { Input, Select, Space } from 'antd';
import { useIntl } from 'react-intl';
import { NOTIFICATION_SOURCES, NOTIFICATION_STATUSES } from './constants';
import type { NotificationSource, NotificationStatus } from './types';

type FilterBarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  status?: NotificationStatus;
  onStatusChange: (value?: NotificationStatus) => void;
  source?: NotificationSource;
  onSourceChange: (value?: NotificationSource) => void;
};

export function FilterBar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  source,
  onSourceChange,
}: FilterBarProps) {
  const { formatMessage } = useIntl();

  return (
    <Space wrap>
      <Input.Search
        allowClear
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={formatMessage({
          id: 'notifications.filter.search',
          defaultMessage: 'Search title',
        })}
        style={{ width: 220 }}
      />
      <Select
        allowClear
        value={status}
        onChange={onStatusChange}
        placeholder={formatMessage({
          id: 'notifications.filter.status',
          defaultMessage: 'Status',
        })}
        options={NOTIFICATION_STATUSES.map((value) => ({
          value,
          label: value,
        }))}
        style={{ width: 140 }}
      />
      <Select
        allowClear
        value={source}
        onChange={onSourceChange}
        placeholder={formatMessage({
          id: 'notifications.filter.source',
          defaultMessage: 'Source',
        })}
        options={NOTIFICATION_SOURCES.map((value) => ({ value, label: value }))}
        style={{ width: 140 }}
      />
    </Space>
  );
}
