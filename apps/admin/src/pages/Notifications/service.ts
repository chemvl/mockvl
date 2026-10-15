import type {
  GetApiAdminNotificationsData,
  GetApiAdminUsersData,
} from '@/client';
import {
  getApiAdminNotificationsByIdOptions,
  getApiAdminNotificationsByIdStatsOptions,
  getApiAdminNotificationsOptions,
  getApiAdminUsersOptions,
} from '@/client/@tanstack/react-query.gen';
import type { NotificationListParams, UserOption } from './types';

// Partial-match key for invalidating every notifications list query
// (TanStack matches object keys partially).
export const NOTIFICATIONS_LIST_KEY = [{ _id: 'getApiAdminNotifications' }];

// Maps the page's filter state onto the API's list query contract
// (page, pageSize, sort, filter[field][op]=value). The generated query type
// only names page/pageSize/sort, so the filter keys ride through a cast.
export function notificationsListQueryOptions(params: NotificationListParams) {
  const query: Record<string, string> = {
    page: String(params.page),
    pageSize: String(params.pageSize),
    sort: 'createdAt:desc',
  };
  if (params.status) query['filter[status][eq]'] = params.status;
  if (params.source) query['filter[source][eq]'] = params.source;
  if (params.search) query['filter[title][like]'] = params.search;
  return getApiAdminNotificationsOptions({
    query: query as GetApiAdminNotificationsData['query'],
  });
}

export function notificationQueryOptions(id: string) {
  return getApiAdminNotificationsByIdOptions({ path: { id } });
}

export function notificationStatsQueryOptions(id: string) {
  return getApiAdminNotificationsByIdStatsOptions({ path: { id } });
}

// Debounced caller feeds this from UserPicker; the users resource is the
// generic admin CRUD endpoint, searched by email.
export function userSearchQueryOptions(search: string) {
  const query: Record<string, string> = { page: '1', pageSize: '20' };
  if (search) query['filter[email][like]'] = search;
  return getApiAdminUsersOptions({
    query: query as GetApiAdminUsersData['query'],
  });
}

export function toUserOptions(
  data: { data: { id: string; email: string }[] } | undefined,
): UserOption[] {
  return (data?.data ?? []).map((user) => ({
    label: user.email,
    value: user.id,
  }));
}
