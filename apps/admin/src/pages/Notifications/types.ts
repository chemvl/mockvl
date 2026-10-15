import type dayjs from 'dayjs';
import type {
  Notification,
  NotificationAudience,
  NotificationSource,
  NotificationStats,
  NotificationStatus,
} from '@/client';

export type {
  Notification,
  NotificationAudience,
  NotificationSource,
  NotificationStats,
  NotificationStatus,
};

export type NotificationListParams = {
  page: number;
  pageSize: number;
  status?: NotificationStatus;
  source?: NotificationSource;
  search?: string;
};

export type UserOption = {
  label: string;
  value: string;
};

export type ComposeValues = {
  title: string;
  body: string;
  imageUrl: string;
  deepLink: string;
  dataPairs: { key: string; value: string }[];
  audience: NotificationAudience;
  userIds: UserOption[];
  schedule: boolean;
  scheduledAt: dayjs.Dayjs | null;
};
