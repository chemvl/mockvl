import { PlusOutlined } from '@ant-design/icons';
import type { ProColumns } from '@ant-design/pro-components';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { Button, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { useAdminStore } from '@/refine/adminStore';
import { ComposeModal, composeValuesFrom } from './ComposeModal';
import { STATUS_COLORS } from './constants';
import { DetailDrawer } from './DetailDrawer';
import { FilterBar } from './FilterBar';
import { notificationsListQueryOptions } from './service';
import type {
  ComposeValues,
  Notification,
  NotificationSource,
  NotificationStatus,
} from './types';

const { Text } = Typography;

export default function NotificationsPage() {
  const { formatMessage } = useIntl();
  const role = useAdminStore((s) => s.identity?.role);
  // Mirrors the API's route guards: viewers get a read-only console.
  const canMutate = role === 'editor' || role === 'owner';

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<NotificationStatus | undefined>();
  const [source, setSource] = useState<NotificationSource | undefined>();
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<ComposeValues | null>(
    null,
  );
  const [detailId, setDetailId] = useState<string | null>(null);

  const listQuery = useQuery(
    notificationsListQueryOptions({ page, pageSize, status, source, search }),
  );
  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.meta.total ?? 0;

  const openCompose = (initial: ComposeValues | null) => {
    setComposeInitial(initial);
    setComposeOpen(true);
  };

  const columns: ProColumns<Notification>[] = [
    {
      title: formatMessage({
        id: 'notifications.col.title',
        defaultMessage: 'Notification',
      }),
      dataIndex: 'title',
      render: (_, record) => (
        <div>
          <Text strong>{record.title}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
            {record.body}
          </Text>
        </div>
      ),
    },
    {
      title: formatMessage({
        id: 'notifications.col.source',
        defaultMessage: 'Source',
      }),
      dataIndex: 'source',
      width: 90,
      render: (_, record) => <Tag>{record.source}</Tag>,
    },
    {
      title: formatMessage({
        id: 'notifications.col.audience',
        defaultMessage: 'Audience',
      }),
      dataIndex: 'audience',
      width: 110,
      render: (_, record) =>
        record.audience === 'all'
          ? formatMessage({
              id: 'notifications.audience.all',
              defaultMessage: 'All users',
            })
          : formatMessage(
              {
                id: 'notifications.audience.count',
                defaultMessage: '{count} user(s)',
              },
              { count: record.userIds?.length ?? 0 },
            ),
    },
    {
      title: formatMessage({
        id: 'notifications.col.status',
        defaultMessage: 'Status',
      }),
      dataIndex: 'status',
      width: 110,
      render: (_, record) => (
        <Tag color={STATUS_COLORS[record.status]}>{record.status}</Tag>
      ),
    },
    {
      title: formatMessage({
        id: 'notifications.col.delivery',
        defaultMessage: 'Sent / Failed',
      }),
      key: 'delivery',
      width: 110,
      render: (_, record) => (
        <Text>
          {record.sentCount} / {record.failedCount}
        </Text>
      ),
    },
    {
      title: formatMessage({
        id: 'notifications.col.scheduledAt',
        defaultMessage: 'Scheduled',
      }),
      dataIndex: 'scheduledAt',
      width: 160,
      render: (_, record) =>
        record.scheduledAt
          ? new Date(record.scheduledAt).toLocaleString()
          : '—',
    },
    {
      title: formatMessage({
        id: 'notifications.col.sentAt',
        defaultMessage: 'Sent at',
      }),
      dataIndex: 'sentAt',
      width: 160,
      render: (_, record) =>
        record.sentAt ? new Date(record.sentAt).toLocaleString() : '—',
    },
  ];

  return (
    <PageContainer
      title={formatMessage({
        id: 'notifications.page.title',
        defaultMessage: 'Push Notifications',
      })}
    >
      <ProTable<Notification>
        rowKey="id"
        dataSource={rows}
        columns={columns}
        loading={listQuery.isLoading}
        search={false}
        defaultSize="medium"
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPageSize !== pageSize ? 1 : nextPage);
            setPageSize(nextPageSize);
          },
          showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} items`,
        }}
        headerTitle={
          <FilterBar
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            status={status}
            onStatusChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            source={source}
            onSourceChange={(value) => {
              setSource(value);
              setPage(1);
            }}
          />
        }
        toolBarRender={() =>
          canMutate
            ? [
                <Button
                  key="compose"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => openCompose(null)}
                >
                  {formatMessage({
                    id: 'notifications.compose.button',
                    defaultMessage: 'Compose',
                  })}
                </Button>,
              ]
            : []
        }
        onRow={(record) => ({
          onClick: () => setDetailId(record.id),
          style: { cursor: 'pointer' },
        })}
      />

      <DetailDrawer
        id={detailId}
        open={detailId !== null}
        canMutate={canMutate}
        onClose={() => setDetailId(null)}
        onDuplicate={(notification) => {
          setDetailId(null);
          openCompose(composeValuesFrom(notification));
        }}
      />

      <ComposeModal
        open={composeOpen}
        initial={composeInitial}
        onClose={() => setComposeOpen(false)}
      />
    </PageContainer>
  );
}
