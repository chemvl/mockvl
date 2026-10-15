import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Col,
  Descriptions,
  Divider,
  Drawer,
  message,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import {
  deleteApiAdminNotificationsByIdMutation,
  postApiAdminNotificationsByIdCancelMutation,
  postApiAdminNotificationsByIdSendMutation,
  postApiAdminNotificationsByIdTestSendMutation,
} from '@/client/@tanstack/react-query.gen';
import { showConfirm } from '@/utils/notification';
import {
  DELETABLE_STATUSES,
  EDITABLE_STATUSES,
  STATUS_COLORS,
} from './constants';
import {
  NOTIFICATIONS_LIST_KEY,
  notificationQueryOptions,
  notificationStatsQueryOptions,
} from './service';
import type { Notification, UserOption } from './types';
import { UserPicker } from './UserPicker';

const { Text } = Typography;
const SENDING_POLL_MS = 2000;

type DetailDrawerProps = {
  id: string | null;
  open: boolean;
  canMutate: boolean;
  onClose: () => void;
  onDuplicate: (notification: Notification) => void;
};

export function DetailDrawer({
  id,
  open,
  canMutate,
  onClose,
  onDuplicate,
}: DetailDrawerProps) {
  const { formatMessage } = useIntl();
  const queryClient = useQueryClient();
  const [testUser, setTestUser] = useState<UserOption[]>([]);

  const detailQuery = useQuery({
    ...notificationQueryOptions(id ?? ''),
    enabled: open && !!id,
    refetchInterval: (query) =>
      query.state.data?.data.status === 'sending' ? SENDING_POLL_MS : false,
  });
  const statsQuery = useQuery({
    ...notificationStatsQueryOptions(id ?? ''),
    enabled: open && !!id,
    refetchInterval: () =>
      detailQuery.data?.data.status === 'sending' ? SENDING_POLL_MS : false,
  });

  const sendMutation = useMutation(postApiAdminNotificationsByIdSendMutation());
  const cancelMutation = useMutation(
    postApiAdminNotificationsByIdCancelMutation(),
  );
  const deleteMutation = useMutation(deleteApiAdminNotificationsByIdMutation());
  const testSendMutation = useMutation(
    postApiAdminNotificationsByIdTestSendMutation(),
  );

  const notification = detailQuery.data?.data;
  const stats = statsQuery.data?.data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_LIST_KEY });
    detailQuery.refetch();
    statsQuery.refetch();
  };

  const handleSend = () => {
    if (!id) return;
    showConfirm({
      message: formatMessage({
        id: 'notifications.confirm.send',
        defaultMessage: 'Send this notification now?',
      }),
      onOk: async () => {
        await sendMutation.mutateAsync({ path: { id } });
        message.success(
          formatMessage({
            id: 'notifications.msg.sending',
            defaultMessage: 'Sending started',
          }),
        );
        refresh();
      },
    });
  };

  const handleCancel = () => {
    if (!id) return;
    showConfirm({
      message: formatMessage({
        id: 'notifications.confirm.cancel',
        defaultMessage: 'Cancel this scheduled send?',
      }),
      onOk: async () => {
        await cancelMutation.mutateAsync({ path: { id } });
        message.success(
          formatMessage({
            id: 'notifications.msg.canceled',
            defaultMessage: 'Canceled',
          }),
        );
        refresh();
      },
    });
  };

  const handleDelete = () => {
    if (!id) return;
    showConfirm({
      message: formatMessage({
        id: 'notifications.confirm.delete',
        defaultMessage: 'Delete this notification permanently?',
      }),
      onOk: async () => {
        await deleteMutation.mutateAsync({ path: { id } });
        message.success(
          formatMessage({
            id: 'notifications.msg.deleted',
            defaultMessage: 'Deleted',
          }),
        );
        queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_LIST_KEY });
        onClose();
      },
    });
  };

  const handleTestSend = async () => {
    const target = testUser[0];
    if (!id || !target) return;
    const result = await testSendMutation.mutateAsync({
      path: { id },
      body: { userId: target.value },
    });
    message.success(
      formatMessage(
        {
          id: 'notifications.msg.testSent',
          defaultMessage: 'Test sent: {sent} ok, {failed} failed',
        },
        { sent: result.data.sent, failed: result.data.failed },
      ),
    );
  };

  const status = notification?.status;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title={notification?.title ?? ''}
      extra={status ? <Tag color={STATUS_COLORS[status]}>{status}</Tag> : null}
    >
      {notification && (
        <>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item
              label={formatMessage({
                id: 'notifications.field.body',
                defaultMessage: 'Body',
              })}
            >
              {notification.body}
            </Descriptions.Item>
            <Descriptions.Item
              label={formatMessage({
                id: 'notifications.field.audience',
                defaultMessage: 'Audience',
              })}
            >
              {notification.audience === 'all'
                ? formatMessage({
                    id: 'notifications.audience.all',
                    defaultMessage: 'All users',
                  })
                : formatMessage(
                    {
                      id: 'notifications.audience.count',
                      defaultMessage: '{count} user(s)',
                    },
                    { count: notification.userIds?.length ?? 0 },
                  )}
            </Descriptions.Item>
            <Descriptions.Item
              label={formatMessage({
                id: 'notifications.field.deepLink',
                defaultMessage: 'Deep link',
              })}
            >
              {notification.deepLink ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item
              label={formatMessage({
                id: 'notifications.field.data',
                defaultMessage: 'Data',
              })}
            >
              <Text code style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(notification.data, null, 2)}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item
              label={formatMessage({
                id: 'notifications.field.scheduledAt',
                defaultMessage: 'Send at',
              })}
            >
              {notification.scheduledAt
                ? new Date(notification.scheduledAt).toLocaleString()
                : '—'}
            </Descriptions.Item>
          </Descriptions>

          <Divider>
            {formatMessage({
              id: 'notifications.stats.title',
              defaultMessage: 'Delivery',
            })}
          </Divider>
          <Row gutter={16}>
            <Col span={5}>
              <Statistic
                title={formatMessage({
                  id: 'notifications.stats.targeted',
                  defaultMessage: 'Targeted',
                })}
                value={stats?.targetedDevices ?? 0}
              />
            </Col>
            <Col span={5}>
              <Statistic
                title={formatMessage({
                  id: 'notifications.stats.sent',
                  defaultMessage: 'Sent',
                })}
                value={stats?.sentCount ?? 0}
              />
            </Col>
            <Col span={5}>
              <Statistic
                title={formatMessage({
                  id: 'notifications.stats.failed',
                  defaultMessage: 'Failed',
                })}
                value={stats?.failedCount ?? 0}
              />
            </Col>
            <Col span={5}>
              <Statistic
                title={formatMessage({
                  id: 'notifications.stats.inbox',
                  defaultMessage: 'Inbox',
                })}
                value={stats?.inboxCount ?? 0}
              />
            </Col>
            <Col span={4}>
              <Statistic
                title={formatMessage({
                  id: 'notifications.stats.read',
                  defaultMessage: 'Read',
                })}
                value={stats?.readCount ?? 0}
              />
            </Col>
          </Row>

          {canMutate && (
            <>
              <Divider>
                {formatMessage({
                  id: 'notifications.actions.title',
                  defaultMessage: 'Actions',
                })}
              </Divider>
              <Space wrap>
                {status && EDITABLE_STATUSES.includes(status) && (
                  <Button
                    type="primary"
                    onClick={handleSend}
                    loading={sendMutation.isPending}
                  >
                    {formatMessage({
                      id: 'notifications.actions.send',
                      defaultMessage: 'Send now',
                    })}
                  </Button>
                )}
                {status === 'scheduled' && (
                  <Button
                    onClick={handleCancel}
                    loading={cancelMutation.isPending}
                  >
                    {formatMessage({
                      id: 'notifications.actions.cancel',
                      defaultMessage: 'Cancel schedule',
                    })}
                  </Button>
                )}
                <Button onClick={() => onDuplicate(notification)}>
                  {formatMessage({
                    id: 'notifications.actions.duplicate',
                    defaultMessage: 'Duplicate',
                  })}
                </Button>
                {status && DELETABLE_STATUSES.includes(status) && (
                  <Button
                    danger
                    onClick={handleDelete}
                    loading={deleteMutation.isPending}
                  >
                    {formatMessage({
                      id: 'notifications.actions.delete',
                      defaultMessage: 'Delete',
                    })}
                  </Button>
                )}
              </Space>
              <Divider>
                {formatMessage({
                  id: 'notifications.testSend.title',
                  defaultMessage: 'Test send',
                })}
              </Divider>
              <Space.Compact block>
                <UserPicker
                  mode="single"
                  value={testUser}
                  onChange={setTestUser}
                />
                <Button
                  onClick={handleTestSend}
                  disabled={testUser.length === 0}
                  loading={testSendMutation.isPending}
                >
                  {formatMessage({
                    id: 'notifications.testSend.button',
                    defaultMessage: 'Send test',
                  })}
                </Button>
              </Space.Compact>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
