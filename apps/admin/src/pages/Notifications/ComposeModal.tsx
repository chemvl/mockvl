import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Form as AntdForm,
  Button,
  Col,
  DatePicker,
  Input,
  Modal,
  message,
  Radio,
  Row,
  Space,
  Switch,
} from 'antd';
import dayjs from 'dayjs';
import { useEffect, useRef } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useIntl } from 'react-intl';
import { z } from 'zod/v4';
import type { NotificationCreate } from '@/client';
import {
  postApiAdminNotificationsByIdScheduleMutation,
  postApiAdminNotificationsByIdSendMutation,
  postApiAdminNotificationsMutation,
} from '@/client/@tanstack/react-query.gen';
import { FormItem } from '@/components/Form/FormItem';
import { NOTIFICATIONS_LIST_KEY } from './service';
import type { ComposeValues, Notification } from './types';
import { UserPicker } from './UserPicker';

const composeSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(200),
    body: z.string().min(1, 'Body is required').max(1000),
    imageUrl: z.union([z.literal(''), z.string().url('Must be a valid URL')]),
    deepLink: z.string().max(500),
    dataPairs: z.array(
      z.object({
        key: z.string().min(1, 'Key is required'),
        value: z.string(),
      }),
    ),
    audience: z.enum(['all', 'users']),
    userIds: z.array(z.object({ label: z.string(), value: z.string() })),
    schedule: z.boolean(),
    scheduledAt: z.custom<dayjs.Dayjs>((v) => dayjs.isDayjs(v)).nullable(),
  })
  .superRefine((values, ctx) => {
    if (values.audience === 'users' && values.userIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'Pick at least one user',
      });
    }
    if (values.schedule) {
      if (!values.scheduledAt) {
        ctx.addIssue({
          code: 'custom',
          path: ['scheduledAt'],
          message: 'Pick a time',
        });
      } else if (!values.scheduledAt.isAfter(dayjs())) {
        ctx.addIssue({
          code: 'custom',
          path: ['scheduledAt'],
          message: 'Must be in the future',
        });
      }
    }
  });

const DEFAULT_VALUES: ComposeValues = {
  title: '',
  body: '',
  imageUrl: '',
  deepLink: '',
  dataPairs: [],
  audience: 'all',
  userIds: [],
  schedule: false,
  scheduledAt: null,
};

function toCreateBody(values: ComposeValues): NotificationCreate {
  return {
    title: values.title,
    body: values.body,
    imageUrl: values.imageUrl || null,
    deepLink: values.deepLink || null,
    data: Object.fromEntries(
      values.dataPairs.map((pair) => [pair.key, pair.value]),
    ),
    audience: values.audience,
    userIds:
      values.audience === 'users' ? values.userIds.map((u) => u.value) : null,
  };
}

// Prefill for "duplicate": everything except lifecycle fields.
export function composeValuesFrom(notification: Notification): ComposeValues {
  return {
    ...DEFAULT_VALUES,
    title: notification.title,
    body: notification.body,
    imageUrl: notification.imageUrl ?? '',
    deepLink: notification.deepLink ?? '',
    dataPairs: Object.entries(notification.data).map(([key, value]) => ({
      key,
      value,
    })),
    audience: notification.audience,
    userIds: (notification.userIds ?? []).map((id) => ({
      label: id,
      value: id,
    })),
  };
}

type ComposeModalProps = {
  open: boolean;
  initial: ComposeValues | null;
  onClose: () => void;
};

type SubmitMode = 'draft' | 'send' | 'schedule';

export function ComposeModal({ open, initial, onClose }: ComposeModalProps) {
  const { formatMessage } = useIntl();
  const queryClient = useQueryClient();
  const [antdForm] = AntdForm.useForm();
  const modeRef = useRef<SubmitMode>('draft');

  const { control, handleSubmit, reset, watch } = useForm<ComposeValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(composeSchema),
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'dataPairs',
  });
  const audience = watch('audience');
  const schedule = watch('schedule');

  useEffect(() => {
    if (open) reset(initial ?? DEFAULT_VALUES);
  }, [open, initial, reset]);

  const createMutation = useMutation(postApiAdminNotificationsMutation());
  const sendMutation = useMutation(postApiAdminNotificationsByIdSendMutation());
  const scheduleMutation = useMutation(
    postApiAdminNotificationsByIdScheduleMutation(),
  );
  const busy =
    createMutation.isPending ||
    sendMutation.isPending ||
    scheduleMutation.isPending;

  const submit = handleSubmit(async (values) => {
    const created = await createMutation.mutateAsync({
      body: toCreateBody(values),
    });
    const id = created.data.id;
    if (modeRef.current === 'send') {
      await sendMutation.mutateAsync({ path: { id } });
      message.success(
        formatMessage({
          id: 'notifications.msg.sending',
          defaultMessage: 'Sending started',
        }),
      );
    } else if (modeRef.current === 'schedule' && values.scheduledAt) {
      await scheduleMutation.mutateAsync({
        path: { id },
        body: { scheduledAt: values.scheduledAt.toISOString() },
      });
      message.success(
        formatMessage({
          id: 'notifications.msg.scheduled',
          defaultMessage: 'Scheduled',
        }),
      );
    } else {
      message.success(
        formatMessage({
          id: 'notifications.msg.draftSaved',
          defaultMessage: 'Draft saved',
        }),
      );
    }
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_LIST_KEY });
    onClose();
  });

  const submitAs = (mode: SubmitMode) => {
    modeRef.current = mode;
    void submit();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={640}
      title={formatMessage({
        id: 'notifications.compose.title',
        defaultMessage: 'Compose notification',
      })}
      footer={
        <Space>
          <Button onClick={onClose} disabled={busy}>
            {formatMessage({
              id: 'notifications.compose.cancel',
              defaultMessage: 'Cancel',
            })}
          </Button>
          <Button onClick={() => submitAs('draft')} loading={busy}>
            {formatMessage({
              id: 'notifications.compose.saveDraft',
              defaultMessage: 'Save draft',
            })}
          </Button>
          <Button
            type="primary"
            loading={busy}
            onClick={() => submitAs(schedule ? 'schedule' : 'send')}
          >
            {schedule
              ? formatMessage({
                  id: 'notifications.compose.schedule',
                  defaultMessage: 'Schedule',
                })
              : formatMessage({
                  id: 'notifications.compose.sendNow',
                  defaultMessage: 'Send now',
                })}
          </Button>
        </Space>
      }
    >
      <AntdForm form={antdForm} layout="vertical">
        <FormItem
          control={control}
          name="title"
          label={formatMessage({
            id: 'notifications.field.title',
            defaultMessage: 'Title',
          })}
          required
        >
          <Input maxLength={200} showCount />
        </FormItem>
        <FormItem
          control={control}
          name="body"
          label={formatMessage({
            id: 'notifications.field.body',
            defaultMessage: 'Body',
          })}
          required
        >
          <Input.TextArea rows={3} maxLength={1000} showCount />
        </FormItem>
        <Row gutter={12}>
          <Col span={12}>
            <FormItem
              control={control}
              name="imageUrl"
              label={formatMessage({
                id: 'notifications.field.imageUrl',
                defaultMessage: 'Image URL',
              })}
            >
              <Input placeholder="https://" />
            </FormItem>
          </Col>
          <Col span={12}>
            <FormItem
              control={control}
              name="deepLink"
              label={formatMessage({
                id: 'notifications.field.deepLink',
                defaultMessage: 'Deep link',
              })}
            >
              <Input placeholder="/posts/123" />
            </FormItem>
          </Col>
        </Row>
        <FormItem
          control={control}
          name="audience"
          label={formatMessage({
            id: 'notifications.field.audience',
            defaultMessage: 'Audience',
          })}
        >
          <Radio.Group
            options={[
              {
                value: 'all',
                label: formatMessage({
                  id: 'notifications.audience.all',
                  defaultMessage: 'All users',
                }),
              },
              {
                value: 'users',
                label: formatMessage({
                  id: 'notifications.audience.users',
                  defaultMessage: 'Specific users',
                }),
              },
            ]}
          />
        </FormItem>
        {audience === 'users' && (
          <FormItem
            control={control}
            name="userIds"
            label={formatMessage({
              id: 'notifications.field.users',
              defaultMessage: 'Users',
            })}
          >
            <UserPicker />
          </FormItem>
        )}
        <AntdForm.Item
          label={formatMessage({
            id: 'notifications.field.data',
            defaultMessage: 'Data payload (key/value)',
          })}
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {fields.map((field, index) => (
              <Space.Compact key={field.id} block>
                <FormItem
                  control={control}
                  name={`dataPairs.${index}.key`}
                  noStyle
                >
                  <Input placeholder="key" style={{ width: '40%' }} />
                </FormItem>
                <FormItem
                  control={control}
                  name={`dataPairs.${index}.value`}
                  noStyle
                >
                  <Input placeholder="value" style={{ width: '50%' }} />
                </FormItem>
                <Button
                  icon={<DeleteOutlined />}
                  onClick={() => remove(index)}
                />
              </Space.Compact>
            ))}
            <Button
              icon={<PlusOutlined />}
              onClick={() => append({ key: '', value: '' })}
              size="small"
            >
              {formatMessage({
                id: 'notifications.field.addPair',
                defaultMessage: 'Add pair',
              })}
            </Button>
          </Space>
        </AntdForm.Item>
        <Row gutter={12} align="middle">
          <Col>
            <FormItem
              control={control}
              name="schedule"
              label={formatMessage({
                id: 'notifications.field.schedule',
                defaultMessage: 'Schedule for later',
              })}
              valuePropName="checked"
            >
              <Switch />
            </FormItem>
          </Col>
          {schedule && (
            <Col flex="auto">
              <FormItem
                control={control}
                name="scheduledAt"
                label={formatMessage({
                  id: 'notifications.field.scheduledAt',
                  defaultMessage: 'Send at',
                })}
              >
                <DatePicker
                  showTime
                  style={{ width: '100%' }}
                  disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
                />
              </FormItem>
            </Col>
          )}
        </Row>
      </AntdForm>
    </Modal>
  );
}
