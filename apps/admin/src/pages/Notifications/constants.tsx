import type { NotificationSource, NotificationStatus } from './types';

export const NOTIFICATION_STATUSES: NotificationStatus[] = [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'failed',
  'canceled',
];

export const NOTIFICATION_SOURCES: NotificationSource[] = ['admin', 'system'];

// antd Tag colors per lifecycle state.
export const STATUS_COLORS: Record<NotificationStatus, string> = {
  draft: 'default',
  scheduled: 'blue',
  sending: 'processing',
  sent: 'success',
  failed: 'error',
  canceled: 'warning',
};

// Statuses that still accept edits / scheduling.
export const EDITABLE_STATUSES: NotificationStatus[] = ['draft', 'scheduled'];

// Statuses that allow deletion.
export const DELETABLE_STATUSES: NotificationStatus[] = [
  'draft',
  'canceled',
  'failed',
];
